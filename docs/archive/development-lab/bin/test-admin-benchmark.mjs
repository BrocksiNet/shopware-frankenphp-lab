import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import http2 from "node:http2";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import {
  Client,
  identity,
  percentile,
  validResponse,
} from "./admin-benchmark.mjs";

test("validates status, protocol and dataset, not merely JSON", () => {
  const data = { data: [{ id: "a" }], total: 1 };
  const good = { data, status: 200, version: "2", error: null };
  assert.equal(validResponse(good, identity(data), "h2"), true);
  for (const change of [
    { status: 401 },
    { version: "1.1" },
    { error: "timeout" },
    { data: { data: [{ id: "b" }], total: 1 } },
    { data: { errors: [] } },
  ]) {
    assert.equal(
      validResponse({ ...good, ...change }, identity(data), "h2"),
      false,
    );
  }
  assert.equal(identity({ data: [] }), null);
  assert.equal(percentile([3, 1, 2, 4], 0.95), 4);
  assert.equal(percentile([], 0.95), null);
});

for (const protocol of ["h1", "h2"]) {
  test(`${protocol}: parallel requests, gzip decoding, connection reuse and timeout`, async () => {
    const server =
      protocol === "h2" ? http2.createServer() : http.createServer();
    let inFlight = 0,
      peak = 0,
      connections = 0;
    server.on("connection", () => connections++);
    server.on("request", (req, res) => {
      req.resume();
      if (req.url === "/timeout") return;
      inFlight++;
      peak = Math.max(peak, inFlight);
      setTimeout(() => {
        inFlight--;
        res.writeHead(200, {
          "content-type": "application/json",
          "content-encoding": "gzip",
        });
        res.end(gzipSync(JSON.stringify({ data: [{ id: "a" }], total: 1 })));
      }, 30);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = new Client(
      `http://127.0.0.1:${server.address().port}`,
      protocol,
      undefined,
      200,
    );
    try {
      const first = await Promise.all(
        Array.from({ length: 4 }, () => client.request("/data", {})),
      );
      assert.equal(peak, 4);
      assert.ok(
        first.every((response) =>
          validResponse(
            response,
            identity({ data: [{ id: "a" }], total: 1 }),
            protocol,
          ),
        ),
      );
      const established = connections;
      await Promise.all(
        Array.from({ length: 4 }, () => client.request("/data", {})),
      );
      assert.equal(connections, established);
      assert.equal(connections, protocol === "h2" ? 1 : 4);
      assert.equal((await client.request("/timeout", {})).error, "timeout");
    } finally {
      client.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
