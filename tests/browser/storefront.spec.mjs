import { test, expect } from "@playwright/test";
import { observe, ready } from "./helpers.mjs";

for (const [path, route] of [
  ["/", "frontend-home-page"],
  ["/account/login", "frontend-account-login-page"],
  ["/search?search=Lab", "frontend-search-page"],
]) {
  test(`${route}: rendered page, JavaScript and fonts`, async ({
    page,
  }, testInfo) => {
    const errors = observe(page);
    await ready(page, path, route, errors, testInfo);
    if (path === "/account/login") {
      await expect(
        page.locator('form[action$="/account/login"] input[name="username"]'),
      ).toBeVisible();
      await expect(
        page.locator('form[action$="/account/login"] input[name="password"]'),
      ).toBeVisible();
    }
  });
}

test("search form navigates to rendered results", async ({
  page,
}, testInfo) => {
  const errors = observe(page);
  await ready(page, "/", "frontend-home-page", errors, testInfo);
  const input = page.locator('input[name="search"]').first();
  await input.fill("Lab");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?search=Lab/);
  await expect(page.locator("body")).toHaveClass(
    /is-active-route-frontend-search-page/,
  );
  await expect(page.locator("main")).toBeVisible();
  expect(errors).toEqual([]);
});
