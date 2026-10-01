#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { id } from "./seed-benchmark.mjs";
import { observe } from "../tests/browser/helpers.mjs";

export const routes = [
  { name: "homepage", path: "/", route: "frontend-home-page" },
  { name: "search", path: "/search?search=Lab", route: "frontend-search-page" },
  {
    name: "product",
    path: `/detail/${id("product", 0)}`,
    route: "frontend-detail-page",
  },
];
export function percentile(values, fraction) {
  if (!values.length || values.some((v) => !Number.isFinite(v)))
    throw new Error("Invalid samples");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
export function summarize(samples) {
  if (!samples.length || samples.some((s) => s.error))
    throw new Error("Cannot summarize failed or empty samples");
  return Object.fromEntries(
    routes.map(({ name }) => {
      const selected = samples.filter((s) => s.route === name);
      return [
        name,
        Object.fromEntries(
          [
            "ttfbMs",
            "domContentLoadedMs",
            "loadMs",
            "fcpMs",
            "lcpObservedMs",
          ].map((field) => [
            field,
            {
              median: percentile(
                selected.map((s) => s[field]),
                0.5,
              ),
              p95: percentile(
                selected.map((s) => s[field]),
                0.95,
              ),
            },
          ]),
        ),
      ];
    }),
  );
}
export function validateOptions(options) {
  for (const key of ["users", "samples", "warmup", "settleMs"]) {
    if (!Number.isInteger(options[key]) || options[key] < 1)
      throw new Error(`${key} must be a positive integer`);
  }
  if (options.users > 20)
    throw new Error(
      "This browser harness is bounded to 20 concurrent sessions",
    );
  const url = new URL(options.url);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "localhost" ||
    url.port !== "8443" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Use the disposable lab's https://localhost:8443 origin");
}

export async function benchmark(options) {
  validateOptions(options);
  const report = {
    schemaVersion: 1,
    completed: false,
    startedAt: new Date().toISOString(),
    options,
    samples: [],
    warmupNavigations: 0,
  };
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, JSON.stringify(report, null, 2), {
    flag: "wx",
  });
  const persist = () =>
    writeFile(options.output, JSON.stringify(report, null, 2) + "\n");
  let browser;
  const sessions = [];
  try {
    browser = await chromium.launch({
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    report.browserVersion = browser.version();
    for (let user = 0; user < options.users; user++) {
      const context = await browser.newContext({
        baseURL: options.url,
        ignoreHTTPSErrors: true,
        serviceWorkers: "block",
        viewport: { width: 1280, height: 720 },
        locale: "en-GB",
        timezoneId: "UTC",
      });
      await context.addInitScript(() => {
        window.__labPaint = { lcp: null, lcpElement: null };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__labPaint.lcp = entry.startTime;
            window.__labPaint.lcpElement = entry.element?.tagName || null;
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      sessions.push({ context, page, errors: observe(page), user });
    }
    async function navigate(session, route, cycle, measured) {
      const { page, errors, user } = session;
      const previousErrors = errors.length;
      try {
        const response = await page.goto(route.path, { waitUntil: "load" });
        if (response.status() !== 200)
          throw new Error(`HTTP ${response.status()}`);
        await page
          .locator(`body.is-active-route-${route.route} main`)
          .waitFor({ state: "visible" });
        await page.waitForFunction(() => Boolean(window.PluginManager));
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        // Fixed post-load observation window; this is not field LCP or INP.
        await page.waitForTimeout(options.settleMs);
        const result = await page.evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0];
          const fonts = Array.from(document.fonts);
          const origins = Array.from(
            document.querySelectorAll(
              'script[src], link[rel="stylesheet"], link[as="font"]',
            ),
          )
            .map((e) => e.src || e.href)
            .filter((url) => new URL(url).origin !== location.origin);
          return {
            ttfbMs: nav.responseStart - nav.startTime,
            domContentLoadedMs: nav.domContentLoadedEventEnd - nav.startTime,
            loadMs: nav.loadEventEnd - nav.startTime,
            fcpMs:
              performance.getEntriesByName("first-contentful-paint")[0]
                ?.startTime ?? null,
            lcpObservedMs: window.__labPaint.lcp,
            lcpElement: window.__labPaint.lcpElement,
            observedAtMs: performance.now(),
            protocol: nav.nextHopProtocol,
            transferSize: nav.transferSize,
            encodedBodySize: nav.encodedBodySize,
            fontLoaded: fonts.some((f) => f.status === "loaded"),
            fontErrors: fonts.filter((f) => f.status === "error").length,
            wrongOrigins: origins,
            productPresent: Array.from(
              document.querySelectorAll(".product-name, h1"),
            ).some((element) => element.textContent.includes("Lab product")),
          };
        });
        const problems = errors.slice(previousErrors);
        if (
          problems.length ||
          !result.fontLoaded ||
          result.fontErrors ||
          result.wrongOrigins.length
        )
          throw new Error(JSON.stringify({ problems, ...result }));
        if (result.protocol !== "h2")
          throw new Error(`Expected h2; got ${result.protocol}`);
        if (route.name !== "homepage" && !result.productPresent)
          throw new Error("Seeded product content missing");
        for (const field of [
          "ttfbMs",
          "domContentLoadedMs",
          "loadMs",
          "fcpMs",
          "lcpObservedMs",
        ])
          if (!Number.isFinite(result[field]) || result[field] <= 0)
            throw new Error(`Missing ${field}`);
        const headers = await response.allHeaders();
        if (headers["content-encoding"] !== "gzip")
          throw new Error(`Expected gzip; got ${headers["content-encoding"]}`);
        if (measured)
          report.samples.push({
            user,
            cycle,
            route: route.name,
            ...result,
            cacheControl: headers["cache-control"] ?? null,
            age: headers.age ?? null,
            contentEncoding: headers["content-encoding"] ?? null,
          });
        else report.warmupNavigations++;
      } catch (error) {
        const screenshot = join(
          dirname(options.output),
          `failure-${options.runtime}-${options.users}-${user}-${route.name}-${cycle}.png`,
        );
        await page.screenshot({ path: screenshot }).catch(() => {});
        report.samples.push({
          user,
          cycle,
          route: route.name,
          measured,
          error: error.message,
          screenshot,
        });
        throw error;
      }
    }
    async function phase(cycles, measured) {
      // Each round starts together; the next begins only when every page passes.
      for (let cycle = 0; cycle < cycles; cycle++) {
        for (const route of routes) {
          const results = await Promise.allSettled(
            sessions.map((session) =>
              navigate(session, route, cycle, measured),
            ),
          );
          await persist();
          const failure = results.find(
            (result) => result.status === "rejected",
          );
          if (failure) throw failure.reason;
        }
      }
    }
    await phase(options.warmup, false);
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    await phase(options.samples, true);
    report.measuredSeconds = (performance.now() - start) / 1000;
    const cpu = process.cpuUsage(cpuStart);
    report.driverCpuSeconds = (cpu.user + cpu.system) / 1e6; // excludes Chromium subprocesses
    report.completedNavigationsPerSecond =
      report.samples.length / report.measuredSeconds;
    report.summary = summarize(report.samples);
    report.completed = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    await Promise.allSettled(sessions.map(({ context }) => context.close()));
    await browser?.close();
    report.finishedAt = new Date().toISOString();
    await persist();
  }
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "https://localhost:8443" },
      runtime: { type: "string", default: "classic" },
      users: { type: "string", default: "1" },
      samples: { type: "string", default: "6" },
      warmup: { type: "string", default: "2" },
      "settle-ms": { type: "string", default: "250" },
      output: { type: "string" },
    },
  });
  if (!values.output)
    throw new Error(
      "--output is required; existing reports are never overwritten",
    );
  benchmark({
    url: values.url,
    runtime: values.runtime,
    users: Number(values.users),
    samples: Number(values.samples),
    warmup: Number(values.warmup),
    settleMs: Number(values["settle-ms"]),
    output: values.output,
  })
    .then((report) =>
      console.log(
        JSON.stringify({
          completed: report.completed,
          navigations: report.samples.length,
          summary: report.summary,
        }),
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
