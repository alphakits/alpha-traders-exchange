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

let world: QaWorld | undefined;

async function login(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", {
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
  const request = await playwrightRequest.newContext({ baseURL: "http://localhost:3000" });
  world = await provisionQaWorld(request);
  await request.dispose();
});

test.afterAll(async () => {
  const request = await playwrightRequest.newContext({ baseURL: "http://localhost:3000" });
  await cleanupQaWorld(request, world);
  await request.dispose();
});

for (const width of [320, 390, 430, 1280]) {
  test(`Discord listing cooldown is responsive and preserves seller actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page.request);
    await mockCooldown(page);
    await page.goto("/en/usdt-exchange");

    const workspace = page.locator("#my-listings-section");
    await expect(workspace).toBeVisible();
    await workspace.scrollIntoViewIfNeeded();

    const shareButtons = workspace.getByRole("button", {
      name: /Shared|Next Share/,
    });
    await expect(shareButtons).toHaveCount(2);
    for (const button of await shareButtons.all()) {
      await expect(button).toBeDisabled();
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeLessThanOrEqual(width);
    }

    await expect(workspace.getByRole("timer").first()).toContainText(/Next Share (11h 59m|12h 0m)/);
    await expect(workspace.getByRole("button", { name: "Edit" })).toHaveCount(2);
    await expect(workspace.getByRole("button", { name: "Pause" })).toHaveCount(2);
    await expect(workspace.getByRole("button", { name: "Renew" })).toHaveCount(2);
    await expect(workspace.getByRole("button", { name: "Delete" })).toHaveCount(2);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
