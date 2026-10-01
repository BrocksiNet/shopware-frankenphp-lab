#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { parseArgs } from "node:util";
import { benchmark } from "./browser-benchmark.mjs";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    repeats: { type: "string", default: "3" },
    users: { type: "string", default: "1,5,10" },
    samples: { type: "string", default: "6" },
    warmup: { type: "string", default: "2" },
    "settle-ms": { type: "string", default: "250" },
  },
});
if (!values.output) throw new Error("--output must name a NEW directory");
const repeats = Number(values.repeats);
const users = values.users.split(",").map(Number);
if (
  !Number.isInteger(repeats) ||
  repeats < 1 ||
  repeats > 10 ||
  !users.length ||
  new Set(users).size !== users.length ||
  users.some((n) => !Number.isInteger(n) || n < 1 || n > 20)
)
  throw new Error(
    "Use 1–10 repeats and unique concurrency levels between 1 and 20",
  );
for (const option of ["samples", "warmup", "settle-ms"])
  if (!Number.isInteger(Number(values[option])) || Number(values[option]) < 1)
    throw new Error(`Invalid ${option}`);
await mkdir(values.output, { recursive: false });
const report = {
  completed: false,
  startedAt: new Date().toISOString(),
  configuration: {
    repeats,
    users,
    samplesPerRoutePerUser: Number(values.samples),
    warmupCycles: Number(values.warmup),
    settleMs: Number(values["settle-ms"]),
    httpCacheEnabled: true,
    encoding: "gzip",
    workerLoopMax: 0,
    phpSlots: 5,
  },
  host: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
  },
  imagePins: await readFile("benchmark.env", "utf8"),
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
  });
function compose(runtime, restore = false) {
  const files = ["-f", "compose.yaml"];
  if (!restore && runtime !== "classic")
    files.push("-f", `compose.${runtime}.yaml`);
  if (!restore) files.push("-f", "compose.browser.yaml");
  execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      "benchmark.env",
      ...files,
      "up",
      "-d",
      "--no-deps",
      "--force-recreate",
      "--wait",
      "--wait-timeout",
      "120",
      "web",
    ],
    {
      stdio: "inherit",
      timeout: 150_000,
      env: {
        ...process.env,
        BROWSER_RUNTIME_CONFIG: runtime === "fpm" ? "fpm" : "frankenphp",
        BROWSER_HTTP_CACHE: "1",
        FRANKENPHP_LOOP_MAX: "0",
      },
    },
  );
}
try {
  const runtimes = ["fpm", "classic", "worker"];
  for (let repeat = 0; repeat < repeats; repeat++) {
    const order = [
      ...runtimes.slice(repeat % 3),
      ...runtimes.slice(0, repeat % 3),
    ];
    const loadOrder = [
      ...users.slice(repeat % users.length),
      ...users.slice(0, repeat % users.length),
    ];
    for (const runtime of order) {
      if (interrupted) throw new Error("Interrupted");
      console.log(`Starting repeat ${repeat + 1}: ${runtime}`);
      compose(runtime);
      const runtimeEvidence = execFileSync(
        "docker",
        [
          "compose",
          "exec",
          "-T",
          "web",
          "sh",
          "-c",
          "php -v && printenv SHOPWARE_HTTP_CACHE_ENABLED FRANKENPHP_LOOP_MAX && cat .git/HEAD && sha256sum src/Core/Kernel.php src/Core/Framework/Log/Monolog/ExcludeFlowEventHandler.php src/Core/Framework/Log/Monolog/ErrorCodeLogLevelHandler.php src/Core/Framework/Log/Monolog/ExcludeExceptionHandler.php",
        ],
        { encoding: "utf8" },
      );
      const threads =
        runtime === "fpm"
          ? null
          : JSON.parse(
              execFileSync(
                "docker",
                [
                  "compose",
                  "exec",
                  "-T",
                  "web",
                  "curl",
                  "--fail",
                  "--silent",
                  "http://localhost:2019/frankenphp/threads",
                ],
                { encoding: "utf8" },
              ),
            );
      if (threads) {
        const workers = threads.ThreadDebugStates.filter((t) =>
          t.Name.startsWith("Worker PHP"),
        );
        if (workers.length !== (runtime === "worker" ? 5 : 0))
          throw new Error("Unexpected runtime mode");
      }
      for (const concurrency of loadOrder) {
        if (interrupted) throw new Error("Interrupted");
        const name = `${repeat + 1}-${runtime}-${concurrency}.json`;
        const run = await benchmark({
          runtime,
          url: "https://localhost:8443",
          users: concurrency,
          samples: Number(values.samples),
          warmup: Number(values.warmup),
          settleMs: Number(values["settle-ms"]),
          output: join(values.output, name),
        });
        report.runs.push({
          repeat: repeat + 1,
          runtime,
          users: concurrency,
          file: name,
          runtimeEvidence,
          browserVersion: run.browserVersion,
          completed: run.completed,
          navigations: run.samples.length,
          completedNavigationsPerSecond: run.completedNavigationsPerSecond,
          summary: run.summary,
        });
        await save();
        console.log(
          `PASS ${runtime} / ${concurrency} sessions: ${run.samples.length} navigations`,
        );
      }
    }
  }
  report.completed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  try {
    compose("classic", true);
    report.restoredClassic = true;
  } catch (error) {
    report.restoredClassic = false;
    report.restoreError = error.message;
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await save();
}
