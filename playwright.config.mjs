import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  forbidOnly: true,
  outputDir: process.env.PW_OUTPUT_DIR || "test-results",
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: process.env.PW_REPORT_DIR || "playwright-report",
      },
    ],
    [
      "json",
      {
        outputFile: `${process.env.PW_OUTPUT_DIR || "test-results"}/results.json`,
      },
    ],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.STOREFRONT_URL || "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  projects: [
    { name: "smoke", testMatch: "storefront.spec.mjs" },
    { name: "catalog", testMatch: "cart.spec.mjs" },
  ],
});
