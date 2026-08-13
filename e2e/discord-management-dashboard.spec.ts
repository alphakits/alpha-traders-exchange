import { expect, test, type Page } from "@playwright/test";

import {
  cleanupQaWorld,
  provisionQaWorld,
  type QaWorld,
} from "./support/qa-accounts";

let world: QaWorld;

const diagnostics = {
  generatedAt: "2026-08-08T06:00:00.000Z",
  status: "healthy",
  worker: {
    status: "healthy",
    connected: true,
    ready: true,
    readyState: "ready",
    apiLatencyMs: 21,
    connectionUptimeMs: 60_000,
    deployment: { revision: "de96c1b", environment: "production" },
    error: null,
  },
  resources: {
    status: "ready",
    total: 13,
    ready: 13,
    missing: 0,
    errorCode: null,
  },
  database: {
    identities: { connected: 5 },
    approvedSellerRoleSync: { synced: 3, pending: 1, failed: 0 },
    listings: {
      lifecycle: {
        queued: 0,
        publishing: 0,
        active: 2,
        update_pending: 0,
        delete_pending: 0,
        sold: 1,
        deleted: 0,
        failed: 0,
      },
      activePosts: 2,
      cooldownClaims: 1,
      jobs: {
        pending: 0,
        processing: 0,
        completed: 3,
        dead: 0,
        staleLeases: 0,
        failures: 0,
      },
    },
    marketContent: [
      {
        key: "live_market_pulse",
        state: "active",
        lastSuccessAt: "2026-08-08T05:00:00.000Z",
        errorCode: null,
      },
      {
        key: "market_activity_digest",
        state: "active",
        lastSuccessAt: "2026-08-08T05:00:00.000Z",
        errorCode: null,
      },
      {
        key: "weekly_top_sellers",
        state: "active",
        lastSuccessAt: "2026-08-08T05:00:00.000Z",
        errorCode: null,
      },
    ],
    notifications: {
      pending: 0,
      processing: 0,
      completed: 3,
      dead: 0,
      suppressed: 1,
    },
    interactions: {
      accepted24h: 4,
      rateLimited24h: 1,
      replayed24h: 0,
    },
    operatorRequests: {
      pending: 0,
      processing: 0,
      dead: 0,
      staleLeases: 0,
      latest: null,
    },
    recentErrors: [],
  },
  commands: {
    names: ["market", "profile", "listing", "share", "website", "help", "pulse"],
    registered: 7,
    expected: 7,
    lastReconciledAt: "2026-08-08T05:00:00.000Z",
    status: "ready",
    errorCode: null,
  },
  topology: [
    { key: "seller_category", type: "category", name: "Seller Lounge" },
    { key: "marketplace_listings", type: "text", name: "marketplace-listings" },
  ],
  privilegedIntents: ["GuildMembers"],
};

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.14" },
    data: {
      email: world.admin.email,
      password: world.admin.password,
      rememberMe: false,
    },
  });
  expect(response.ok()).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  world = await provisionQaWorld(request);
});

test.afterAll(async ({ request }) => {
  await cleanupQaWorld(request, world);
});

for (const width of [320, 390, 430, 1280]) {
  test(`Discord Management has no overflow and accessible controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.route("**/api/admin/discord/diagnostics", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(diagnostics),
      });
    });

    await page.goto("/en/admin/discord");
    await expect(page.getByRole("heading", { name: "Discord Management" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Integration status: healthy" })).toBeVisible();
    const control = page.getByRole("button", {
      name: "Reconcile managed resources, commands, and content",
    });
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("reconciliation confirmation sends no arbitrary Discord target", async ({ page }) => {
  await login(page);
  await page.route("**/api/admin/discord/diagnostics", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(diagnostics),
    });
  });
  let requestBody = "";
  await page.route("**/api/admin/discord/reconcile", async (route) => {
    requestBody = route.request().postData() ?? "";
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        disposition: "accepted",
        status: "pending",
      }),
    });
  });

  await page.goto("/en/admin/discord");
  await page.getByRole("button", {
    name: "Reconcile managed resources, commands, and content",
  }).click();
  await page.getByRole("button", { name: "Confirm and enqueue" }).click();
  await expect(page.getByText(
    "Reconciliation was accepted and is pending Railway processing.",
  )).toBeVisible();
  expect(requestBody).toContain("reconcile_managed_integration");
  expect(requestBody).not.toMatch(/channelId|messageId|userId|cooldown|delete/i);
});
