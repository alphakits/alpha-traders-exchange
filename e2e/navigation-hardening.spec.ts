import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  cleanupBuyerFixture,
  resolveBuyerFixture,
  type BuyerFixture,
} from "./support/buyer-fixture";

let buyerFixture: BuyerFixture | undefined;
const SELLER_EMAIL = (process.env.E2E_SELLER_EMAIL ?? "").toLowerCase();
const SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD ?? "";

async function login(request: APIRequestContext, email: string, password: string) {
  const response = await request.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.16" },
    data: {
      email,
      password,
      rememberMe: true,
    },
  });
  expect(response.ok(), `login failed for ${email}`).toBeTruthy();
}

test.beforeAll(async () => {
  buyerFixture = await resolveBuyerFixture(
    (process.env.E2E_BUYER_EMAIL ?? "").toLowerCase(),
    process.env.E2E_BUYER_PASSWORD ?? "",
  );
});

test.afterAll(async () => {
  await cleanupBuyerFixture(buyerFixture);
});

test.describe("Navigation hardening", () => {
  test("buyer My Trade Requests stays on exchange and opens trade history section", async ({ page }) => {
    test.skip(!buyerFixture, "Buyer fixture not available");

    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.goto("/en/usdt-exchange");

    await page.getByRole("button", { name: /^My Trade Requests$/ }).first().click();

    await expect(page).toHaveURL(/\/en\/usdt-exchange(#my-trade-requests-section)?$/);
    await expect(page).not.toHaveURL(/\/en\/trade-room(\/|$)/);
    await expect(page.locator("#my-trade-requests-section")).toBeVisible();
  });

  test("buyer direct /trade-room navigation resolves to a stable non-dashboard destination", async ({ page }) => {
    test.skip(!buyerFixture, "Buyer fixture not available");

    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.goto("/en/trade-room");

    await expect(page).not.toHaveURL(/\/en\/dashboard$/);
    await expect(page).toHaveURL(
      /\/en\/(trade-room\/[\w-]+|usdt-exchange#my-trade-requests-section)$/,
      { timeout: 20_000 },
    );
  });

  test("buyer refresh on My Trade Requests section keeps stable route", async ({ page }) => {
    test.skip(!buyerFixture, "Buyer fixture not available");

    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.goto("/en/usdt-exchange#my-trade-requests-section");
    await page.reload({ waitUntil: "commit" });

    await expect(page).not.toHaveURL(/\/en\/dashboard$/);
    await expect(page).toHaveURL(/\/en\/usdt-exchange(#my-trade-requests-section)?$/);
  });

  test("seller refresh keeps the approved workspace stable", async ({ page }) => {
    test.skip(!SELLER_EMAIL || !SELLER_PASSWORD, "Set E2E_SELLER_EMAIL and E2E_SELLER_PASSWORD to run seller refresh checks.");

    await login(page.request, SELLER_EMAIL, SELLER_PASSWORD);
    await page.goto("/en/dashboard/seller");
    await expect(page.getByText(/seller status/i).first()).toBeVisible();

    await page.reload({ waitUntil: "commit" });

    await expect(page).toHaveURL(/\/en\/dashboard\/seller$/);
    await expect(page.getByText(/seller status/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Manage Listings$/ }).first()).toBeVisible();
  });

  test("guest protected trade-room route redirects to login with redirectTo", async ({ page }) => {
    await page.request.post("/api/auth/logout").catch(() => {});
    await page.goto("/en/trade-room");

    await expect(page).toHaveURL(/\/en\/login\?redirectTo=%2Fen%2Ftrade-room/);
  });

  test("mobile menu can navigate to Alpha Exchange without refresh loops", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.request.post("/api/auth/logout").catch(() => {});
    await page.goto("/en");

    await page.locator("summary").first().click();
    await page.locator("details[open] a[href$='/en/usdt-exchange']").first().click();

    await expect(page).toHaveURL(/\/en\/(usdt-exchange|login\?redirectTo=%2Fen%2Fusdt-exchange)$/);
  });
});
