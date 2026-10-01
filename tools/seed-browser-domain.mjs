// Add one lab-only HTTPS domain, preserving the existing HTTP storefront domain.
import { id } from "./seed-benchmark.mjs";

if (!process.argv.includes("--seed-lab") || !process.env.ADMIN_BENCH_PASSWORD)
  throw new Error(
    "Use --seed-lab and set ADMIN_BENCH_PASSWORD for the disposable lab",
  );
const base = "http://localhost:8080";
let token;
async function api(path, data) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
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
if (!token) throw new Error("No Admin token returned");
const { data } = await api("/api/search/sales-channel-domain", {
  limit: 1,
  filter: [{ type: "equals", field: "url", value: base }],
});
if (data.length !== 1)
  throw new Error("Expected the starter's localhost:8080 storefront domain");
const { salesChannelId, languageId, currencyId, snippetSetId } = data[0];
await api("/api/_action/sync", {
  domain: {
    entity: "sales_channel_domain",
    action: "upsert",
    payload: [
      {
        id: id("browser-domain", 0),
        url: "https://localhost:8443",
        salesChannelId,
        languageId,
        currencyId,
        snippetSetId,
      },
    ],
  },
});
const verified = await api("/api/search/sales-channel-domain", {
  limit: 1,
  filter: [{ type: "equals", field: "id", value: id("browser-domain", 0) }],
});
if (
  verified.data.length !== 1 ||
  verified.data[0].url !== "https://localhost:8443" ||
  verified.data[0].salesChannelId !== salesChannelId
)
  throw new Error("HTTPS domain verification failed");
console.log("HTTPS storefront domain ready: https://localhost:8443");
