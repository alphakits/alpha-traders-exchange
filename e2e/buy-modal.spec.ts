import { test, expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { cleanupBuyerFixture, resolveBuyerFixture, type BuyerFixture } from "./support/buyer-fixture";
import { E2E_BASE_URL } from "./support/base-url";

const TEST_SUPPORT_HEADERS = { "x-alpha-test-support": "enabled" };

let buyerFixture: BuyerFixture | undefined;
const sellerId = `seller-e2e-${randomUUID()}`;
const listingId = `listing-e2e-${randomUUID()}`;

async function readRuntimeDb(request: APIRequestContext) {
  const response = await request.get("/api/testing/alpha-exchange-state", { headers: TEST_SUPPORT_HEADERS });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Record<string, unknown>;
}

async function writeRuntimeDb(request: APIRequestContext, db: Record<string, unknown>) {
  const response = await request.put("/api/testing/alpha-exchange-state", { headers: TEST_SUPPORT_HEADERS, data: db });
  expect(response.ok()).toBeTruthy();
}

async function seedSellerAndListing(request: APIRequestContext) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const db = await readRuntimeDb(request);
  const users = Array.isArray(db.users) ? db.users : [];
  db.users = [
    ...users,
    {
      id: sellerId,
      fullName: "E2E Modal Seller",
      email: `e2e-seller-${randomUUID()}@example.test`,
      passwordHash: "unused",
      role: "approved_seller",
      roles: ["approved_seller"],
      sellerStatus: "approved_seller",
      whatsappNumber: "+972500000055",
      preferredNetworks: ["TRC20"],
      preferredPaymentMethods: ["Bank Transfer"],
      profilePhotoUrl: "",
      languages: ["English"],
      bio: "E2E seller",
      country: "Israel",
      createdAt: now,
      updatedAt: now,
      emailVerified: true,
      emailVerifiedAt: now,
      verifiedPhone: "+972500000055",
      phoneVerifiedAt: now,
      onlineStatus: "online",
      availabilityStatus: "available",
      isProfileHidden: false,
    },
  ];
  const listings = Array.isArray(db.marketplaceListings) ? db.marketplaceListings : [];
  db.marketplaceListings = [
    ...listings,
    {
      id: listingId,
      sellerId,
      sellerDisplayName: "E2E Modal Seller",
      photos: [],
      originalAmount: "1000",
      availableAmount: "1000",
      price: "3.60",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Bank Transfer",
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: "100",
      maximumTrade: "1000",
      expiresAt,
      sellerDescription: "E2E listing for direct Buy modal test.",
      responseTime: "5 min",
      status: "active",
      approvalStatus: "approved",
      createdAt: now,
      updatedAt: now,
    },
  ];
  await writeRuntimeDb(request, db);
}

async function login(page: Page, email: string, password: string) {
  const response = await page.request.post("/api/auth/login", { data: { email, password, rememberMe: true } });
  expect(response.ok()).toBeTruthy();
}

test.beforeAll(async () => {
  buyerFixture = await resolveBuyerFixture(
    (process.env.E2E_BUYER_EMAIL ?? "").toLowerCase(),
    process.env.E2E_BUYER_PASSWORD ?? "",
  );
});

test.afterAll(async () => {
  const context = await request.newContext({ baseURL: E2E_BASE_URL });
  const db = await readRuntimeDb(context);
  for (const key of ["users", "marketplaceListings"]) {
    const rows = db[key];
    if (Array.isArray(rows)) {
      db[key] = rows.filter((row) => {
        const record = row as Record<string, unknown>;
        return record.id !== sellerId && record.id !== listingId;
      });
    }
  }
  await writeRuntimeDb(context, db);
  await context.dispose();
  await cleanupBuyerFixture(buyerFixture);
});

test.describe("Direct Buy USDT modal", () => {
  test.beforeEach(async ({ page }) => {
    await seedSellerAndListing(page.request);
    await login(page, buyerFixture!.email, buyerFixture!.password);
  });

  test("opens a purchase-first modal with the form immediately visible (desktop)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/en/usdt-exchange");

    const buyButton = page.getByRole("button", { name: /Buy USDT/i }).first();
    await buyButton.scrollIntoViewIfNeeded();
    await buyButton.click();

    // The modal is a direct purchase modal, not the seller profile.
    await expect(page.getByRole("heading", { name: /^Buy USDT$/ })).toBeVisible();
    // The amount field is available immediately — no profile-first scrolling.
    await expect(page.getByLabel(/USDT Amount/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Start Trade/i })).toBeVisible();
  });

  test("renders without horizontal overflow at 320px and keeps the form reachable", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/en/usdt-exchange");

    const buyButton = page.getByRole("button", { name: /Buy USDT/i }).first();
    await buyButton.scrollIntoViewIfNeeded();
    await buyButton.click();

    await expect(page.getByRole("heading", { name: /^Buy USDT$/ })).toBeVisible();
    await expect(page.getByLabel(/USDT Amount/i)).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
