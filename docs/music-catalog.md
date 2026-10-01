# Test a populated music storefront

The [Shopware Catalog Generator](https://github.com/shopwareLabs/shopware-catalog-generator)
can import the pre-generated `music` template, including product photography and
CMS content. Its matching-template path skips AI generation. Template retrieval
needs Git access; `--no-template` instead requests fresh AI generation.

## Import into a disposable shop

Follow the generator's current setup instructions. In a separate checkout:

```bash
git clone https://github.com/shopwareLabs/shopware-catalog-generator.git
cd shopware-catalog-generator
bun install
```

Create a local `.env` with `SW_ENV_URL=http://localhost:8080`, `SW_CLIENT_ID` and
`SW_CLIENT_SECRET` from an integration in the disposable shop's Administration.
Keep credentials out of reports and Git. Then:

```bash
bun run generate --name=music
```

Confirm the log selects the template. Inspect the created sales-channel domains
in Administration; use their actual port, language and currency in browser tests.
The generator creates English/USD and, when German is installed, German/EUR domains.

This is upstream's documented import workflow, not a newly executed import in this
benchmark. We measured already populated installations and did not regenerate them.
Record generator/template revisions and preserve one resulting database/media
snapshot for all runtimes. Reusing a template name alone does not guarantee equal
product counts, theme state or search ordering across independently generated shops.

## Measure the existing shop

From the FrankenPHP lab repository:

```bash
npm ci
npx playwright install chromium
mkdir -p measurements
cp docs/music-targets.example.json measurements/my-music-targets.json
# Edit origins, route paths, expected text and environment notes.
node tools/browser-existing.mjs --config measurements/my-music-targets.json \
  --output measurements/my-music-run
uv run --with matplotlib tools/plot-browser-benchmark.py measurements/my-music-run
```

Copy the actual canonical
product URL from your storefront into the config; generated IDs can differ.
Use a homepage phrase and product/search text that your chosen language renders.
Add up to three targets with distinct names and descriptive labels. For a controlled
runtime comparison, keep the same database, code, theme, language and currency.
Set `expectedProtocol` to the observed browser protocol (`h2` for HTTPS/HTTP/2 or
`http/1.1` for these plain HTTP listeners). Do not label h2c support as browser HTTP/2.

This runner only visits pages. It does not import a catalog, change caching,
restart services or switch modes. Ctrl+C stops after the active bounded run
closes its browser and leaves an incomplete report. Prepare those settings yourself and record them
in the config. It requests gzip on all targets without intercepting network traffic.
The default is three repeats at 1/5/10 sessions, with two warm-up and six measured
cycles over homepage, search and product detail. Target and concurrency order rotate.

Visible images must finish loading with nonzero natural dimensions, alongside the
existing content, JavaScript, font, origin and response checks. Reports retain image
paths, dimensions and the observed LCP image. The observation cutoff is 500 ms after
load, fonts and visible-image readiness. It measures the initial viewport without
scrolling; it does not assert all lazy images farther down the page.

Browser contexts retain cookies and asset caches within a run. Timings are local,
unthrottled and warm-browser observations. Neither complete checkout nor maximum
server capacity follows from passing these pages. See the
[browser methodology](browser-benchmarking.md) for metric definitions and limitations.
