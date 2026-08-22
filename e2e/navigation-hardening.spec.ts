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
  test("buyer Workspace Summary replaces Quick Actions and routes cards to canonical destinations", async ({ page }) => {
    test.skip(!buyerFixture, "Buyer fixture not available");

    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.goto("/en/dashboard");

    const main = page.getByRole("main");
    await expect(main.getByText("Workspace Summary").first()).toBeVisible();
    await expect(main.getByText("Quick Actions", { exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: /^Create Listing:/ })).toHaveCount(0);

    const tradeRequests = main.getByRole("button", { name: /^My Trade Requests:/ });
    await expect(tradeRequests).toHaveCount(1);
    await tradeRequests.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/en\/dashboard$/);
    await expect(main.locator("#my-trade-requests-section")).toBeVisible();
    await expect(main.locator("#my-trade-requests-section")).toBeFocused();

    await main.getByRole("button", { name: /^Browse Marketplace:/ }).click();
    await expect(page).toHaveURL(/\/en\/usdt-exchange#marketplace$/);
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

  test("buyer dashboard refresh keeps the canonical workspace route", async ({ page }) => {
    test.skip(!buyerFixture, "Buyer fixture not available");

    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.goto("/en/dashboard");
    await page.reload({ waitUntil: "commit" });

    await expect(page).toHaveURL(/\/en\/dashboard$/);
    await expect(page.getByRole("main").getByText("Workspace Summary").first()).toBeVisible();
  });

  test("seller refresh keeps the approved workspace stable", async ({ page }) => {
    test.skip(!SELLER_EMAIL || !SELLER_PASSWORD, "Set E2E_SELLER_EMAIL and E2E_SELLER_PASSWORD to run seller refresh checks.");

    await login(page.request, SELLER_EMAIL, SELLER_PASSWORD);
    await page.goto("/en/dashboard/seller");
    const main = page.getByRole("main");
    await expect(main.getByText(/seller status/i).first()).toBeVisible();
    await expect(main.getByText("Workspace Summary").first()).toBeVisible();
    await expect(main.getByText("Quick Actions", { exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: /Seller Dashboard/i })).toHaveCount(0);

    const purchaseRequests = main.getByRole("button", { name: /^Purchase Requests:/ });
    await expect(purchaseRequests).toHaveCount(1);
    await purchaseRequests.focus();
    await page.keyboard.press("Enter");
    await expect(main.locator("#purchase-requests-section")).toBeFocused();

    await page.reload({ waitUntil: "commit" });

    await expect(page).toHaveURL(/\/en\/dashboard\/seller$/);
    await expect(main.getByText(/seller status/i).first()).toBeVisible();
    const manageListings = main.getByRole("button", { name: /^My Listings:/ });
    await expect(manageListings).toHaveCount(1);
    await manageListings.focus();
    await page.keyboard.press("Enter");
    await expect(main.locator("#my-listings-section")).toBeFocused();
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
