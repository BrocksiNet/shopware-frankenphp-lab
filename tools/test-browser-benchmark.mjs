import test from "node:test";
import assert from "node:assert/strict";
import {
  percentile,
  summarize,
  validateOptions,
  routes,
} from "./browser-benchmark.mjs";

test("nearest-rank percentiles retain tail observations", () => {
  const samples = Array.from({ length: 100 }, (_, index) => 100 - index);
  assert.equal(percentile(samples, 0.5), 50);
  assert.equal(percentile(samples, 0.95), 95);
  assert.throws(() => percentile([], 0.5));
  assert.throws(() => percentile([1, NaN], 0.5));
});
test("summary refuses missing routes, metrics and failed pages", () => {
  const samples = routes.map(({ name }) => ({
    route: name,
    ttfbMs: 10,
    domContentLoadedMs: 20,
    loadMs: 30,
    fcpMs: 25,
    lcpObservedMs: 28,
  }));
  assert.equal(summarize(samples).search.ttfbMs.median, 10);
  assert.throws(() => summarize(samples.slice(1)));
  assert.throws(() =>
    summarize([...samples, { route: "search", error: "Font blocked" }]),
  );
  assert.throws(() =>
    summarize(samples.map((s) => ({ ...s, lcpObservedMs: null }))),
  );
});
test("benchmark rejects remote origins and invalid concurrency", () => {
  const options = {
    url: "https://localhost:8443",
    users: 5,
    samples: 6,
    warmup: 2,
    settleMs: 250,
  };
  assert.doesNotThrow(() => validateOptions(options));
  for (const update of [
    { url: "https://example.com" },
    { users: 0 },
    { users: 21 },
    { users: 1.5 },
    { warmup: 0 },
    { samples: NaN },
  ])
    assert.throws(() => validateOptions({ ...options, ...update }));
});
