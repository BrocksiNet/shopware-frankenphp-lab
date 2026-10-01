#!/usr/bin/env node
// Synthetic, idempotent Admin API fixtures for this disposable lab only.
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export function id(kind, index) {
  return createHash("sha256")
    .update(`frankenphp-lab-v1:${kind}:${index}`)
    .digest("hex")
    .slice(0, 32);
}

export function fixtures(ref) {
  return {
    product_manufacturer: Array.from({ length: 10 }, (_, i) => ({
      id: id("manufacturer", i),
      name: `Lab manufacturer ${i}`,
    })),
    category: Array.from({ length: 50 }, (_, i) => ({
      id: id("category", i),
      name: `Lab category ${i}`,
      active: true,
      parentId: ref.root,
    })),
    media: Array.from({ length: 100 }, (_, i) => ({
      id: id("media", i),
      title: `Lab placeholder ${i}`,
    })),
    product: Array.from({ length: 500 }, (_, i) => ({
      id: id("product", i),
      productNumber: `FP-LAB-${String(i).padStart(5, "0")}`,
      name: `Lab product ${i}`,
      stock: 100,
      active: true,
      taxId: ref.tax,
      manufacturerId: id("manufacturer", i % 10),
      price: [
        { currencyId: ref.currency, gross: 119, net: 100, linked: false },
      ],
      categories: [{ id: id("category", i % 50) }],
      visibilities: [
        {
          id: id("visibility", i),
          salesChannelId: ref.channel,
          visibility: 30,
        },
      ],
    })),
    customer: Array.from({ length: 100 }, (_, i) => ({
      id: id("customer", i),
      customerNumber: `FP-LAB-${i}`,
      firstName: "Synthetic",
      lastName: `Customer ${i}`,
      email: `lab-${i}@example.invalid`,
      guest: true,
      accountType: "private",
      groupId: ref.group,
      salesChannelId: ref.channel,
      languageId: ref.language,
      defaultBillingAddressId: id("address", i),
      defaultShippingAddressId: id("address", i),
      addresses: [
        {
          id: id("address", i),
          firstName: "Synthetic",
          lastName: `Customer ${i}`,
          street: "Example street 1",
          zipcode: "00000",
          city: "Fixture town",
          countryId: ref.country,
        },
      ],
    })),
  };
}

export function checkTarget(value, confirmed) {
  const url = new URL(value);
  if (
    !confirmed ||
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Seeding requires --seed-lab and a loopback HTTP origin; use only the disposable lab",
    );
  }
  return url.origin;
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "http://localhost:8080" },
      "seed-lab": { type: "boolean", default: false },
    },
  });
  const base = checkTarget(values.url, values["seed-lab"]);
  if (!process.env.ADMIN_BENCH_PASSWORD)
    throw new Error("Set ADMIN_BENCH_PASSWORD");
  let token;
  async function api(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(120000),
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || data.errors?.length)
      throw new Error(
        `${path}: HTTP ${response.status}: ${JSON.stringify(data.errors)}`,
      );
    return data;
  }
  token = (
    await api("/api/oauth/token", {
      grant_type: "password",
      client_id: "administration",
      scopes: "write",
      username: "admin",
      password: process.env.ADMIN_BENCH_PASSWORD,
    })
  ).access_token;
  if (!token) throw new Error("Authentication returned no token");
  async function first(entity, filter = []) {
    const result = await api(`/api/search/${entity}`, {
      limit: 1,
      filter,
      sort: [{ field: "id", order: "ASC" }],
    });
    if (!result.data?.length)
      throw new Error(`Missing installation prerequisite: ${entity}`);
    return result.data[0];
  }
  const channel = await first("sales-channel", [
    {
      type: "equals",
      field: "typeId",
      value: "8a243080f92e4c719546314b577cf82b",
    },
  ]);
  const dataset = fixtures({
    channel: channel.id,
    root: channel.navigationCategoryId,
    currency: channel.currencyId,
    language: channel.languageId,
    tax: (await first("tax", [{ type: "equals", field: "taxRate", value: 19 }]))
      .id,
    country: (
      await first("country", [{ type: "equals", field: "iso", value: "DE" }])
    ).id,
    group: channel.customerGroupId,
  });
  for (const [entity, payload] of Object.entries(dataset)) {
    for (let offset = 0; offset < payload.length; offset += 50) {
      await api("/api/_action/sync", {
        fixture: {
          entity,
          action: "upsert",
          payload: payload.slice(offset, offset + 50),
        },
      });
    }
    console.log(`${entity}: ${payload.length} synthetic records upserted`);
  }
  for (const [entity, payload] of Object.entries(dataset)) {
    const result = await api(`/api/search/${entity.replaceAll("_", "-")}`, {
      limit: 1,
      "total-count-mode": 1,
      filter: [
        { type: "equalsAny", field: "id", value: payload.map((row) => row.id) },
      ],
    });
    if (result.total !== payload.length)
      throw new Error(`Fixture verification failed for ${entity}`);
  }
  console.log(
    "Fixture v1 verified. Media are metadata placeholders, not uploaded files.",
  );
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
