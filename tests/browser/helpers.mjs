import { expect } from "@playwright/test";

// Install before navigation, so failed bootstrap scripts cannot go unnoticed.
export function observe(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`JavaScript: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`Console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    errors.push(`Request: ${request.url()} ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return errors;
}

export async function ready(page, path, route, errors, testInfo) {
  const response = await page.goto(path, { waitUntil: "load" });
  expect(response.status()).toBe(200);
  await expect(page.locator("body")).toHaveClass(
    new RegExp(`is-active-route-${route}(?: |$)`),
  );
  await expect(page.locator("main")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.PluginManager)))
    .toBe(true);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts, (font) => ({
      family: font.family,
      status: font.status,
    }));
  });
  expect(
    fonts.some((font) => font.status === "loaded"),
    "At least one web font must load",
  ).toBe(true);
  expect(
    fonts.filter((font) => font.status === "error"),
    "Web font failures",
  ).toEqual([]);
  const wrongOrigins = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        'script[src], link[rel="stylesheet"], link[as="font"]',
      ),
    )
      .map((element) => element.src || element.href)
      .filter((url) => new URL(url).origin !== location.origin),
  );
  expect(
    wrongOrigins,
    "The starter has no CDN; assets must follow the current origin",
  ).toEqual([]);
  const timing = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    return {
      url: location.href,
      ttfbMs: navigation.responseStart - navigation.startTime,
      domContentLoadedMs:
        navigation.domContentLoadedEventEnd - navigation.startTime,
      loadMs: navigation.loadEventEnd - navigation.startTime,
      protocol: navigation.nextHopProtocol,
    };
  });
  await testInfo.attach(`navigation-${route}`, {
    body: JSON.stringify({ timing, fonts, errors }, null, 2),
    contentType: "application/json",
  });
  expect(errors, "Browser/network failures").toEqual([]);
}
