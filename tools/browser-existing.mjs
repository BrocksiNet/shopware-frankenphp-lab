#!/usr/bin/env node
// Browser-only runner. Does not seed data, recreate services or change shop settings.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import os from "node:os";
import { benchmark, validateOptions } from "./browser-benchmark.mjs";

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    output: { type: "string" },
    repeats: { type: "string", default: "3" },
    samples: { type: "string", default: "6" },
    users: { type: "string", default: "1,5,10" },
    warmup: { type: "string", default: "2" },
  },
});
if (!values.config || !values.output)
  throw new Error("--config and a NEW --output directory are required");
const config = JSON.parse(await readFile(values.config, "utf8"));
if (!["h2", "http/1.1"].includes(config.expectedProtocol))
  throw new Error("Set expectedProtocol explicitly to h2 or http/1.1");
const repeats = Number(values.repeats),
  users = values.users.split(",").map(Number);
if (
  !Number.isInteger(repeats) ||
  repeats < 1 ||
  repeats > 10 ||
  !config.targets?.length ||
  config.targets.length > 3 ||
  new Set(config.targets.map((t) => t.name)).size !== config.targets.length ||
  new Set(users).size !== users.length
)
  throw new Error("Invalid target/repeat/concurrency configuration");
for (const target of config.targets) {
  if (!/^[a-z0-9-]+$/.test(target.name))
    throw new Error("Use simple unique target names");
  for (const concurrency of users)
    validateOptions({
      ...target,
      existingStorefront: true,
      users: concurrency,
      samples: Number(values.samples),
      warmup: Number(values.warmup),
      settleMs: 500,
    });
}
await mkdir(values.output, { recursive: false });
const report = {
  completed: false,
  startedAt: new Date().toISOString(),
  targets: config.targets,
  title: config.title || "Populated storefronts",
  configuration: {
    repeats,
    users,
    samplesPerRoutePerUser: Number(values.samples),
    warmupCycles: Number(values.warmup),
    settleMs: 500,
    httpCacheEnabled: config.httpCacheEnabled,
    expectedProtocol: config.expectedProtocol,
    encoding: "gzip",
    requireImages: true,
  },
  environment: config.environment,
  host: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
  },
  runs: [],
};
const save = () =>
  writeFile(
    join(values.output, "matrix.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
await save();
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    console.error("Stopping after the active bounded browser run closes.");
  });
try {
  for (let repeat = 0; repeat < repeats; repeat++) {
    const offset = repeat % config.targets.length;
    const order = [
      ...config.targets.slice(offset),
      ...config.targets.slice(0, offset),
    ];
    const loadOffset = repeat % users.length;
    const loads = [...users.slice(loadOffset), ...users.slice(0, loadOffset)];
    for (const target of order)
      for (const concurrency of loads) {
        if (interrupted) throw new Error("Interrupted");
        const name = `${repeat + 1}-${target.name}-${concurrency}.json`;
        const run = await benchmark({
          existingStorefront: true,
          url: target.url,
          routes: target.routes,
          runtime: target.name,
          expectedProtocol: config.expectedProtocol,
          requireImages: true,
          users: concurrency,
          samples: Number(values.samples),
          warmup: Number(values.warmup),
          settleMs: 500,
          output: join(values.output, name),
        });
        report.runs.push({
          repeat: repeat + 1,
          runtime: target.name,
          users: concurrency,
          file: name,
          completed: true,
          navigations: run.samples.length,
          summary: run.summary,
          browserVersion: run.browserVersion,
        });
        await save();
        console.log(
          `PASS repeat ${repeat + 1} ${target.name} / ${concurrency}: ${run.samples.length} pages with images`,
        );
      }
  }
  if (interrupted) throw new Error("Interrupted");
  report.completed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  report.finishedAt = new Date().toISOString();
  await save();
}
