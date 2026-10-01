import { test, expect } from "@playwright/test";
import { id } from "../../tools/seed-benchmark.mjs";
import { observe, ready } from "./helpers.mjs";

test("seeded product can be added and removed without leaking to another guest", async ({
  browser,
  baseURL,
}, testInfo) => {
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  try {
    const [a, b] = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    const errorsA = observe(a);
    const errorsB = observe(b);
    await ready(
      a,
      `/detail/${id("product", 0)}`,
      "frontend-detail-page",
      errorsA,
      testInfo,
    );
    await expect(a.locator("h1")).toContainText("Lab product 0");
    await a
      .locator('form[action$="/checkout/line-item/add"] button[type="submit"]')
      .click();
    await expect(
      a.locator(".offcanvas.is-open, .offcanvas.show").first(),
    ).toBeVisible();
    for (let round = 0; round < 3; round++) {
      for (const [page, errors, filled] of round % 2
        ? [
            [b, errorsB, false],
            [a, errorsA, true],
          ]
        : [
            [a, errorsA, true],
            [b, errorsB, false],
          ]) {
        await ready(
          page,
          "/checkout/cart",
          "frontend-checkout-cart-page",
          errors,
          testInfo,
        );
        await expect(page.locator(".line-item-product")).toHaveCount(
          filled ? 1 : 0,
        );
        if (filled)
          await expect(page.locator(".line-item-product")).toContainText(
            "Lab product 0",
          );
      }
    }
    await a.locator(".line-item-remove-button").click();
    await expect(a.locator(".line-item-product")).toHaveCount(0);
    expect(errorsA).toEqual([]);
    expect(errorsB).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
