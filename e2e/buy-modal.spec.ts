import { test, expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { cleanupBuyerFixture, resolveBuyerFixture, type BuyerFixture } from "./support/buyer-fixture";
import { E2E_BASE_URL } from "./support/base-url";

const TEST_SUPPORT_HEADERS = { "x-alpha-test-support": "enabled" };

let buyerFixture: BuyerFixture | undefined;
let originalBuyerRecord: Record<string, unknown> | null = null;
const sellerId = `seller-e2e-${randomUUID()}`;
const listingId = `listing-e2e-${randomUUID()}`;
const sellerPrivateEmail = "e2e-modal-seller-private@example.test";

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
      email: sellerPrivateEmail,
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

async function makeBuyerEmailVerifiedWithoutPhone(request: APIRequestContext) {
  const db = await readRuntimeDb(request);
  const users = Array.isArray(db.users) ? db.users : [];
  const buyerIndex = users.findIndex((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return String((entry as Record<string, unknown>).email ?? "").toLowerCase() === buyerFixture?.email.toLowerCase();
  });
  if (buyerIndex === -1) throw new Error("Buyer fixture missing from the seeded runtime.");
  const buyer = users[buyerIndex] as Record<string, unknown>;
  if (!originalBuyerRecord) originalBuyerRecord = { ...buyer };
  const {
    verifiedPhone: _verifiedPhone,
    phoneVerifiedAt: _phoneVerifiedAt,
    ...emailOnlyBuyer
  } = buyer;
  users[buyerIndex] = {
    ...emailOnlyBuyer,
    // Match the persisted registration shape for a user who chooses not to
    // provide a phone number: the field is an empty string, not absent.
    whatsappNumber: "",
    emailVerified: true,
    emailVerifiedAt: String(buyer.emailVerifiedAt ?? new Date().toISOString()),
    buyerVerificationStatus: "not_started",
  };
  db.users = users;
  await writeRuntimeDb(request, db);
}

async function restoreBuyerPhoneFixture(request: APIRequestContext) {
  if (!buyerFixture || !originalBuyerRecord) return;
  const db = await readRuntimeDb(request);
  const users = Array.isArray(db.users) ? db.users : [];
  db.users = users.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const record = entry as Record<string, unknown>;
    return String(record.email ?? "").toLowerCase() === buyerFixture!.email.toLowerCase()
      ? originalBuyerRecord
      : entry;
  });
  await writeRuntimeDb(request, db);
}

async function login(page: Page, email: string, password: string) {
  const response = await page.request.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.11" }, data: { email, password, rememberMe: true } });
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
  await restoreBuyerPhoneFixture(context);
  await context.dispose();
  await cleanupBuyerFixture(buyerFixture);
});

test.describe("Direct Buy USDT modal", () => {
  test.beforeEach(async ({ page }) => {
    await seedSellerAndListing(page.request);
    await makeBuyerEmailVerifiedWithoutPhone(page.request);
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
    await expect(page.getByLabel(/WhatsApp/i)).toHaveCount(0);
    await expect(page.getByLabel(/Buyer notes/i)).toHaveCount(0);
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
    await expect(page.getByLabel(/WhatsApp/i)).toHaveCount(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("lets a verified-email Buyer without a verified phone create a trade without contact fields", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en/usdt-exchange");
    const listingsResponse = await page.request.get("/api/alpha-exchange/listings");
    expect(listingsResponse.ok()).toBeTruthy();
    const listingsPayload = JSON.stringify(await listingsResponse.json());
    expect(listingsPayload).not.toContain("+972500000055");
    expect(listingsPayload).not.toContain(sellerPrivateEmail);

    const buyButton = page.getByRole("button", { name: /Buy USDT/i }).first();
    await buyButton.scrollIntoViewIfNeeded();
    await buyButton.click();
    await page.getByLabel(/Receiving Wallet Address/i).fill("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE");
    await Promise.all([
      page.waitForURL(new RegExp(`/en/trade-room/`)),
      page.getByRole("button", { name: /^Start Trade$/i }).click(),
    ]);
  });
});
