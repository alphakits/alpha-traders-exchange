import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  cleanupQaWorld,
  provisionQaWorld,
  type QaWorld,
} from "./support/qa-accounts";
import { E2E_BASE_URL } from "./support/base-url";

let world: QaWorld | undefined;

async function login(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.13" },
    data: {
      email: world!.seller.email,
      password: world!.seller.password,
      rememberMe: true,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function mockCooldown(page: Page) {
  await page.route("**/api/alpha-exchange/discord-sharing", async (route) => {
    const serverTime = new Date();
    const nextEligibleAt = new Date(serverTime.getTime() + 12 * 60 * 60 * 1000);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        serverTime: serverTime.toISOString(),
        nextEligibleAt: nextEligibleAt.toISOString(),
        cooldownSecondsRemaining: 43_200,
        linked: true,
        available: true,
        listings: [{
          listingId: world!.listingId,
          state: "active",
          publishedAt: serverTime.toISOString(),
          updatedAt: serverTime.toISOString(),
          errorCode: null,
        }],
      }),
    });
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const request = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL });
  world = await provisionQaWorld(request);
  await request.dispose();
});

test.afterAll(async () => {
  const request = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL });
  await cleanupQaWorld(request, world);
  await request.dispose();
});

for (const width of [320, 390, 430, 1280]) {
  test(`Discord listing cooldown is responsive and preserves seller actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page.request);
    await mockCooldown(page);
    await page.goto("/en/usdt-exchange");

    const workspace = page.getByRole("main").locator("#my-listings-section");
    await expect(workspace).toBeVisible();
    await workspace.scrollIntoViewIfNeeded();
    await workspace.getByRole("button", { name: "Manage Listings" }).click();

    const compactListings = workspace.locator('[data-seller-compact-listing="true"]');
    await expect(compactListings).toHaveCount(2, { timeout: 20_000 });

    let validatedShareControls = 0;
    for (let index = 0; index < 2; index += 1) {
      const listing = compactListings.nth(index);
      const toggle = listing.locator(":scope > button");
      if (await toggle.getAttribute("aria-expanded") !== "true") {
        await toggle.click();
      }
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(compactListings.nth(1 - index).locator(":scope > button")).toHaveAttribute("aria-expanded", "false");

      const shareButton = listing.getByRole("button", {
        name: /Share to Discord|Shared|Next Share/,
      });
      await expect(listing.getByRole("timer")).toContainText(/Next Share (11h 59m|12h 0m)/, { timeout: 20_000 });
      await expect(shareButton).toHaveCount(1);
      await expect(shareButton).toBeDisabled();
      const box = await shareButton.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeLessThanOrEqual(width);
      validatedShareControls += 1;

      await expect(listing.getByRole("button", { name: "Edit" })).toHaveCount(1);
      await expect(listing.getByRole("button", { name: "Pause" })).toHaveCount(1);
      await expect(listing.getByRole("button", { name: "Renew" })).toHaveCount(1);
      await expect(listing.getByRole("button", { name: "Delete" })).toHaveCount(1);
    }
    expect(validatedShareControls).toBe(2);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
