import { expect, test, type Page } from "@playwright/test";

import {
  cleanupBuyerFixture,
  resolveBuyerFixture,
  type BuyerFixture,
} from "./support/buyer-fixture";

let buyer: BuyerFixture;

test.beforeAll(async () => {
  buyer = await resolveBuyerFixture(
    (process.env.E2E_BUYER_EMAIL ?? "").toLowerCase(),
    process.env.E2E_BUYER_PASSWORD ?? "",
  );
});

test.afterAll(async () => {
  await cleanupBuyerFixture(buyer);
});

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: {
      email: buyer.email,
      password: buyer.password,
      rememberMe: false,
    },
  });
  expect(response.ok()).toBeTruthy();
}

for (const width of [320, 390, 1280]) {
  test(`Disconnected Discord account connection is visible by default at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.route("**/api/discord/identity", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ connection: null }),
      });
    });

    await page.goto("/en/settings");
    await expect(page.getByRole("heading", { name: "Connected Accounts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Discord" })).toBeVisible();
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`Failed Discord unlink preserves connected state at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.route("**/api/discord/identity", async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            unlinked: false,
            error: "Discord is not connected to this account. Refresh and try again.",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          connection: {
            discordUserId: "987654321098765432",
            username: "alpha_user",
            globalName: "Alpha User",
            linkedAt: "2026-08-07T12:00:00.000Z",
            lastSyncedAt: null,
          },
        }),
      });
    });

    await page.goto("/en/settings?discord=linked");
    await expect(page.getByRole("heading", { name: "Connected Accounts" })).toBeVisible();
    await expect(page.getByText("@alpha_user")).toBeVisible();
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByText(/removes managed seller roles/i)).toBeVisible();
    await page.getByRole("button", { name: "Confirm disconnect" }).click();
    await expect(page.getByText(
      "Discord is not connected to this account. Refresh and try again.",
    )).toBeVisible();
    await expect(page.getByText("@alpha_user")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Discord" })).toHaveCount(0);
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
