#!/usr/bin/env node
// Read-only Admin API bursts. Secrets stay in memory; no request bodies or tokens in reports.
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import { gunzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const workload = [
  {
    name: "products",
    path: "/api/search/product",
    body: {
      limit: 25,
      "total-count-mode": 1,
      sort: [{ field: "productNumber", order: "ASC" }],
      associations: { manufacturer: {} },
    },
  },
  {
    name: "categories",
    path: "/api/search/category",
    body: {
      limit: 25,
      "total-count-mode": 1,
      sort: [{ field: "id", order: "ASC" }],
    },
  },
  {
    name: "customers",
    path: "/api/search/customer",
    body: {
      limit: 25,
      "total-count-mode": 1,
      sort: [{ field: "id", order: "ASC" }],
    },
  },
  {
    name: "media",
    path: "/api/search/media",
    body: {
      limit: 25,
      "total-count-mode": 1,
      sort: [{ field: "id", order: "ASC" }],
    },
  },
];

export function identity(body) {
  if (
    !body ||
    body.errors ||
    !Array.isArray(body.data) ||
    !body.data.length ||
    !body.data.every((x) => typeof x.id === "string")
  )
    return null;
  return JSON.stringify({
    total: body.total,
    ids: body.data.map((x) => x.id).sort(),
  });
}

export function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

export class Client {
  constructor(base, protocol, token, timeout = 15000) {
    this.base = new URL(base);
    this.protocol = protocol;
    this.token = token;
    this.timeout = timeout;
    this.connections = 0;
    if (protocol === "h2") {
      this.session = http2.connect(base);
      this.session.on("error", () => {});
      this.connections = 1;
    } else {
      const Agent = this.base.protocol === "https:" ? https.Agent : http.Agent;
      this.agent = new Agent({ keepAlive: true, maxSockets: workload.length });
    }
  }

  request(path, body) {
    return new Promise((resolve) => {
      const start = performance.now();
      const payload = JSON.stringify(body);
      const headers = {
        "content-type": "application/json",
        accept: "application/json",
        "accept-encoding": "gzip",
      };
      if (this.token) headers.authorization = `Bearer ${this.token}`;
      let status = 0,
        version = null,
        encoding,
        bytes = 0,
        done = false;
      const chunks = [];
      let request;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const ms = performance.now() - start;
        let data = null;
        if (!error) {
          try {
            const raw = Buffer.concat(chunks);
            data = JSON.parse(
              (encoding === "gzip" ? gunzipSync(raw) : raw).toString(),
            );
          } catch {
            error = "invalid_json";
          }
        }
        resolve({ status, version, ms, bytes, error: error || null, data });
      };
      const timer = setTimeout(() => {
        finish("timeout");
        request?.destroy();
      }, this.timeout);
      const receive = (stream) => {
        stream.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) {
            finish("response_too_large");
            stream.destroy();
          } else chunks.push(chunk);
        });
        stream.on("end", () => finish());
        stream.on("aborted", () => finish("aborted"));
        stream.on("error", () => finish("transport_error"));
      };
      try {
        if (this.protocol === "h2") {
          request = this.session.request({
            ":method": "POST",
            ":path": path,
            ...headers,
          });
          request.on("response", (response) => {
            status = response[":status"];
            version = "2";
            encoding = response["content-encoding"];
          });
          receive(request);
        } else {
          const transport = this.base.protocol === "https:" ? https : http;
          request = transport.request(
            new URL(path, this.base),
            { method: "POST", headers, agent: this.agent },
            (response) => {
              status = response.statusCode;
              version = response.httpVersion;
              encoding = response.headers["content-encoding"];
              receive(response);
            },
          );
          request.on("socket", (socket) => {
            if (socket.connecting) this.connections++;
          });
          request.on("error", () => finish("transport_error"));
        }
        request.end(payload);
      } catch {
        finish("transport_error");
      }
    });
  }

  close() {
    this.session?.destroy();
    this.agent?.destroy();
  }
}

export function validResponse(response, expected, protocol) {
  return (
    !response.error &&
    response.status === 200 &&
    response.version === (protocol === "h2" ? "2" : "1.1") &&
    identity(response.data) === expected
  );
}

async function phase(clients, seconds, expected, protocol) {
  const samples = [],
    batches = [];
  let failures = 0;
  const start = performance.now();
  const deadline = start + seconds * 1000;
  await Promise.all(
    clients.map(async (client) => {
      while (performance.now() < deadline && failures < 5) {
        const batchStart = performance.now();
        const responses = await Promise.all(
          workload.map((item) => client.request(item.path, item.body)),
        );
        batches.push(performance.now() - batchStart);
        responses.forEach((response, endpoint) => {
          const valid = validResponse(response, expected[endpoint], protocol);
          if (!valid) failures++;
          samples.push({
            endpoint,
            status: response.status,
            protocol: response.version,
            ms: response.ms,
            bytes: response.bytes,
            valid,
            error: response.error,
          });
        });
      }
    }),
  );
  const elapsedSeconds = (performance.now() - start) / 1000;
  return {
    elapsedSeconds,
    requests: samples.length,
    failures,
    successfulRps: (samples.length - failures) / elapsedSeconds,
    requestP50Ms: percentile(
      samples.map((x) => x.ms),
      0.5,
    ),
    requestP95Ms: percentile(
      samples.map((x) => x.ms),
      0.95,
    ),
    requestP99Ms: percentile(
      samples.map((x) => x.ms),
      0.99,
    ),
    batchP95Ms: percentile(batches, 0.95),
    samples,
  };
}

function containerStats(name) {
  if (!name) return null;
  const output = execFileSync(
    "podman",
    [
      "exec",
      name,
      "sh",
      "-c",
      "cat /sys/fs/cgroup/cpu.stat; cat /sys/fs/cgroup/memory.current",
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  return {
    cpuUsec: Number(output.match(/usage_usec (\d+)/)[1]),
    memoryBytes: Number(output.trim().split("\n").at(-1)),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      target: { type: "string", multiple: true },
      container: { type: "string", multiple: true },
      username: { type: "string", default: "admin" },
      "password-env": { type: "string", default: "ADMIN_BENCH_PASSWORD" },
      users: { type: "string", default: "1,5,10,20" },
      protocols: { type: "string", default: "h1,h2" },
      seconds: { type: "string", default: "8" },
      warmup: { type: "string", default: "2" },
      repeats: { type: "string", default: "3" },
      output: { type: "string" },
    },
  });
  const password = process.env[values["password-env"]];
  if (!password || !values.output || !values.target?.length)
    throw new Error(
      "Specify --target name=URL, --output NEW_FILE and the password environment variable",
    );
  const targets = values.target.map((value) => {
    const split = value.indexOf("=");
    return { name: value.slice(0, split), url: value.slice(split + 1) };
  });
  for (const target of targets) {
    const url = new URL(target.url);
    if (
      !target.name ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Targets must be named HTTP(S) origins without credentials",
      );
  }
  const containers = Object.fromEntries(
    (values.container || []).map((value) => value.split("=")),
  );
  const levels = values.users.split(",").map(Number);
  const protocols = values.protocols.split(",");
  const seconds = Number(values.seconds),
    warmup = Number(values.warmup),
    repeats = Number(values.repeats);
  if (
    ![seconds, warmup].every((x) => Number.isFinite(x) && x > 0) ||
    ![...levels, repeats].every((x) => Number.isInteger(x) && x > 0) ||
    protocols.some((x) => !["h1", "h2"].includes(x))
  )
    throw new Error("Invalid workload parameters");
  const report = {
    startedAt: new Date().toISOString(),
    targets,
    workload,
    configuration: {
      levels,
      protocols,
      seconds,
      warmup,
      repeats,
      requestsPerUserBurst: workload.length,
      authentication: "separate OAuth tokens, same admin account",
      tls: targets.map((x) => new URL(x.url).protocol === "https:"),
    },
    runs: [],
  };
  writeFileSync(values.output, JSON.stringify(report), {
    flag: "wx",
    mode: 0o600,
  });
  const persist = () =>
    writeFileSync(values.output, JSON.stringify(report, null, 2) + "\n");
  const banks = new Map();
  async function tokens(target) {
    const saved = banks.get(target.name);
    if (saved && saved.expires > Date.now() + 60000) return saved.tokens;
    const client = new Client(target.url, "h2");
    const bank = { tokens: [], expires: Infinity };
    try {
      for (let i = 0; i < Math.max(...levels); i++) {
        const response = await client.request("/api/oauth/token", {
          grant_type: "password",
          client_id: "administration",
          scopes: "write",
          username: values.username,
          password,
        });
        if (response.status !== 200 || !response.data?.access_token)
          throw new Error(
            `Authentication failed for ${target.name} (HTTP ${response.status})`,
          );
        bank.tokens.push(response.data.access_token);
        bank.expires = Math.min(
          bank.expires,
          Date.now() + response.data.expires_in * 1000,
        );
      }
    } finally {
      client.close();
    }
    banks.set(target.name, bank);
    return bank.tokens;
  }
  try {
    const expected = [];
    for (const target of targets) {
      const bank = await tokens(target);
      const client = new Client(target.url, "h2", bank[0]);
      try {
        for (let i = 0; i < workload.length; i++) {
          const response = await client.request(
            workload[i].path,
            workload[i].body,
          );
          const signature = identity(response.data);
          if (
            response.status !== 200 ||
            !signature ||
            (expected[i] && expected[i] !== signature)
          )
            throw new Error(
              "Preflight failed: endpoints must return the same nonempty dataset on every target",
            );
          expected[i] = signature;
        }
      } finally {
        client.close();
      }
    }
    // Alternating target and protocol order reduces simple first/last-run bias.
    for (let repeat = 0; repeat < repeats; repeat++)
      for (const users of levels) {
        for (const protocol of repeat % 2
          ? [...protocols].reverse()
          : protocols) {
          for (const target of (repeat + levels.indexOf(users)) % 2
            ? [...targets].reverse()
            : targets) {
            const bank = await tokens(target);
            const clients = bank
              .slice(0, users)
              .map((token) => new Client(target.url, protocol, token));
            try {
              const warm = await phase(clients, warmup, expected, protocol);
              if (warm.failures)
                throw new Error(
                  `Warm-up failed for ${target.name}: ${warm.failures} invalid responses`,
                );
              const before = containerStats(containers[target.name]);
              const connectionsBefore = clients.reduce(
                (n, client) => n + client.connections,
                0,
              );
              const generatorStart = process.cpuUsage();
              const result = await phase(clients, seconds, expected, protocol);
              const generatorCpu = process.cpuUsage(generatorStart);
              const after = containerStats(containers[target.name]);
              const run = {
                target: target.name,
                protocol,
                users,
                maxInFlight: users * workload.length,
                repeat: repeat + 1,
                ...result,
                connectionsAfterWarmup: connectionsBefore,
                newConnectionsDuringMeasurement:
                  clients.reduce((n, client) => n + client.connections, 0) -
                  connectionsBefore,
                generatorCpuSeconds:
                  (generatorCpu.user + generatorCpu.system) / 1e6,
                container:
                  before && after
                    ? {
                        cpuSeconds: (after.cpuUsec - before.cpuUsec) / 1e6,
                        memoryBeforeBytes: before.memoryBytes,
                        memoryAfterBytes: after.memoryBytes,
                      }
                    : null,
              };
              report.runs.push(run);
              persist();
              console.log(
                JSON.stringify({
                  target: run.target,
                  protocol,
                  users,
                  repeat: repeat + 1,
                  rps: +run.successfulRps.toFixed(1),
                  p95ms: +run.requestP95Ms.toFixed(1),
                  errors: run.failures,
                }),
              );
              if (run.failures)
                throw new Error(
                  "Stopped after invalid measured responses; inspect the saved report",
                );
            } finally {
              clients.forEach((client) => client.close());
            }
          }
        }
      }
    report.completed = true;
  } catch (error) {
    report.completed = false;
    report.failure = error.message;
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    persist();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
