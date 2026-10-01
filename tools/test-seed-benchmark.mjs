import test from "node:test";
import assert from "node:assert/strict";
import { checkTarget, fixtures, id } from "./seed-benchmark.mjs";

test("seeding rejects remote targets, credentials and missing acknowledgement", () => {
  for (const url of [
    "https://localhost",
    "http://shop.example",
    "http://localhost.example",
    "http://user:pass@localhost",
    "http://localhost/path",
  ]) {
    assert.throws(() => checkTarget(url, true));
  }
  assert.throws(() => checkTarget("http://localhost:8080", false));
  assert.equal(
    checkTarget("http://localhost:8080", true),
    "http://localhost:8080",
  );
});

test("fixtures have stable IDs and valid internal relations for repeated upserts", () => {
  const data = fixtures({});
  assert.deepEqual(data, fixtures({}));
  const ids = Object.values(data)
    .flat()
    .map((row) => row.id);
  assert.equal(new Set(ids).size, 760);
  assert.ok(ids.every((value) => /^[0-9a-f]{32}$/.test(value)));
  for (const product of data.product) {
    assert.ok(data.category.some((row) => row.id === product.categories[0].id));
    assert.ok(
      data.product_manufacturer.some(
        (row) => row.id === product.manufacturerId,
      ),
    );
  }
  for (const customer of data.customer) {
    assert.equal(customer.addresses[0].id, customer.defaultBillingAddressId);
    assert.match(customer.email, /@example\.invalid$/);
  }
  assert.notEqual(id("product", 1), id("customer", 1));
});
