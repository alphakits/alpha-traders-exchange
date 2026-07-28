import { request, test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const OWNER_EMAIL = (process.env.E2E_OWNER_EMAIL ?? "").toLowerCase();
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "";
const SELLER_EMAIL = (process.env.E2E_SELLER_EMAIL ?? "").toLowerCase();
const SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD ?? "";
const TEST_EVIDENCE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";
const TEST_SUPPORT_HEADERS = {
  "x-alpha-test-support": "enabled",
};

async function readRuntimeDb(request: APIRequestContext) {
  const response = await request.get("/api/testing/alpha-exchange-state", { headers: TEST_SUPPORT_HEADERS });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Record<string, unknown>;
}

async function writeRuntimeDb(request: APIRequestContext, db: Record<string, unknown>) {
  const response = await request.put("/api/testing/alpha-exchange-state", {
    headers: TEST_SUPPORT_HEADERS,
    data: db as AlphaExchangeDb,
  });
  expect(response.ok()).toBeTruthy();
}

async function updateRuntimeDb(request: APIRequestContext, mutator: (db: Record<string, unknown>) => void) {
  const db = await readRuntimeDb(request);
  mutator(db);
  await writeRuntimeDb(request, db);
}

async function waitForPersistence() {
  await new Promise((resolve) => setTimeout(resolve, 450));
}

async function login(page: Page, email: string, password: string) {
  const existingSession = await page.request.get("/api/auth/me");
  if (existingSession.ok()) {
    const existingPayload = (await existingSession.json()) as { user?: { id?: string } | null };
    if (existingPayload.user?.id) {
      return;
    }
  }
  await page.goto("/en/login");
  if (!page.url().includes("/login")) {
    return;
  }
  await page.waitForSelector('form[data-hydrated="true"]', { timeout: 15_000 });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.locator('form[data-hydrated="true"]').getByRole("button", { name: /login|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20_000 });
}

async function createSession(browser: Browser, email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

async function resetLifecycleFixtures() {
  if (!OWNER_EMAIL || !OWNER_PASSWORD || !SELLER_EMAIL || !SELLER_PASSWORD) {
    return false;
  }
  const api = await request.newContext({ baseURL: "http://localhost:3000" });
  const db = await readRuntimeDb(api);
  const users = Array.isArray(db.users) ? (db.users as Array<Record<string, unknown>>) : [];
  const seller = users.find((user) => String(user.email ?? "").toLowerCase() === SELLER_EMAIL);
  const owner = users.find((user) => String(user.email ?? "").toLowerCase() === OWNER_EMAIL);
  if (!seller || !owner) {
    await api.dispose();
    return false;
  }

  const sellerId = String(seller.id);
  const ownerId = String(owner.id);
  const relatedUserIds = new Set([sellerId, ownerId]);
  const relatedListingIds = new Set(
    (Array.isArray(db.marketplaceListings) ? (db.marketplaceListings as Array<Record<string, unknown>>) : [])
      .filter((listing) => relatedUserIds.has(String(listing.sellerId ?? "")))
      .map((listing) => String(listing.id)),
  );
  const relatedRequestIds = new Set(
    (Array.isArray(db.purchaseRequests) ? (db.purchaseRequests as Array<Record<string, unknown>>) : [])
      .filter((request) => relatedUserIds.has(String(request.sellerId ?? "")) || relatedUserIds.has(String(request.buyerId ?? "")) || relatedListingIds.has(String(request.listingId ?? "")))
      .map((request) => String(request.id)),
  );

  db.marketplaceListings = (Array.isArray(db.marketplaceListings) ? (db.marketplaceListings as Array<Record<string, unknown>>) : []).filter(
    (listing) => !relatedUserIds.has(String(listing.sellerId ?? "")),
  );
  db.purchaseRequests = (Array.isArray(db.purchaseRequests) ? (db.purchaseRequests as Array<Record<string, unknown>>) : []).filter(
    (request) => !relatedRequestIds.has(String(request.id ?? "")),
  );
  db.commissionRecords = (Array.isArray(db.commissionRecords) ? (db.commissionRecords as Array<Record<string, unknown>>) : []).filter(
    (record) => !relatedRequestIds.has(String(record.purchaseRequestId ?? "")) && !relatedUserIds.has(String(record.sellerId ?? "")),
  );
  db.tradeEvidenceFiles = (Array.isArray(db.tradeEvidenceFiles) ? (db.tradeEvidenceFiles as Array<Record<string, unknown>>) : []).filter(
    (entry) => !relatedRequestIds.has(String(entry.purchaseRequestId ?? "")),
  );
  db.notifications = (Array.isArray(db.notifications) ? (db.notifications as Array<Record<string, unknown>>) : []).filter(
    (entry) => !relatedUserIds.has(String(entry.userId ?? "")),
  );
  db.activityLog = (Array.isArray(db.activityLog) ? (db.activityLog as Array<Record<string, unknown>>) : []).filter(
    (entry) => !relatedUserIds.has(String(entry.userId ?? "")),
  );
  db.auditLogs = (Array.isArray(db.auditLogs) ? (db.auditLogs as Array<Record<string, unknown>>) : []).filter(
    (entry) => !relatedRequestIds.has(String(entry.purchaseRequestId ?? "")) && !relatedListingIds.has(String(entry.listingId ?? "")),
  );
  db.users = users.map((user) => {
    if (String(user.id) !== sellerId) return user;
    return {
      ...user,
      availabilityStatus: "available",
      onlineStatus: "online",
      lastActiveAt: new Date().toISOString(),
    };
  });

  await writeRuntimeDb(api, db);
  await api.dispose();
  await waitForPersistence();
  return true;
}

async function uploadEvidence(request: APIRequestContext, requestId: string, side: "buyer" | "seller") {
  const response = await request.post(`/api/alpha-exchange/purchase-requests/${requestId}/evidence`, {
    data: {
      side,
      fileName: `${side}-proof.png`,
      mimeType: "image/png",
      sizeBytes: Buffer.from(TEST_EVIDENCE_BASE64, "base64").length,
      fileData: `data:image/png;base64,${TEST_EVIDENCE_BASE64}`,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function createRequest(request: APIRequestContext, listingId: string, usdtAmount: string) {
  const response = await request.post("/api/alpha-exchange/purchase-requests", {
    data: {
      listingId,
      usdtAmount,
      buyerName: "Lifecycle Buyer",
      buyerWhatsapp: "+972500000000",
      buyerNotes: `Buying ${usdtAmount} USDT`,
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { purchase: { id: string } };
}

async function createListing(request: APIRequestContext, input: { availableAmount: string; price: string; minimumTrade?: string; maximumTrade?: string }) {
  const response = await request.post("/api/alpha-exchange/listings", {
    data: {
      availableAmount: input.availableAmount,
      price: input.price,
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank transfer"],
      minimumTrade: input.minimumTrade ?? "50",
      maximumTrade: input.maximumTrade ?? input.availableAmount,
      expirationHours: 24,
      notes: "",
      sellerDescription: "",
      responseTime: "5 min",
      photos: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { listing: { id: string; status: string; expiresAt?: string } };
}

async function getDbNotificationsForEmail(email: string) {
  const api = await request.newContext({ baseURL: "http://localhost:3000" });
  const db = await readRuntimeDb(api);
  await api.dispose();
  const users = Array.isArray(db.users) ? (db.users as Array<Record<string, unknown>>) : [];
  const user = users.find((entry) => String(entry.email ?? "").toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`Notification user ${email} not found.`);
  const userId = String(user.id);
  const notifications = Array.isArray(db.notifications) ? (db.notifications as Array<Record<string, unknown>>) : [];
  return notifications
    .filter((entry) => String(entry.userId ?? "") === userId)
    .map((entry) => ({
      title: String(entry.title ?? ""),
      message: String(entry.message ?? ""),
    }));
}

async function getAdminPrep(request: APIRequestContext) {
  const response = await request.get("/api/alpha-exchange/admin-prep");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    listings: Array<{ id: string; status: string; expiresAt?: string; expiredAt?: string; lastRenewedAt?: string }>;
    purchaseRequests: Array<{ id: string; listingId: string; status: string; timedOutAt?: string; timeoutReason?: string }>;
    auditLogs: Array<{ action: string; listingId?: string; purchaseRequestId?: string; details?: string; reason?: string }>;
    notifications: Array<{ userId: string; title: string; message: string; relatedListingId?: string; relatedTradeId?: string }>;
  };
}

async function expectOkWithBody(response: Awaited<ReturnType<APIRequestContext["get"]>>, label: string) {
  if (!response.ok()) {
    throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
  }
}

test.describe.configure({ mode: "serial" });

test("seller listing lifecycle is enforced end-to-end", async ({ browser }) => {
  test.setTimeout(60_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);
  await seller.page.goto("/en/usdt-exchange");
  const createListingForm = seller.page.locator("form").filter({ has: seller.page.getByRole("button", { name: "Create Live Listing" }) });

  await createListingForm.getByPlaceholder("Available Amount", { exact: true }).fill("1000");
  await createListingForm.getByPlaceholder("Price", { exact: true }).fill("3.70");
  await createListingForm.getByPlaceholder("Minimum Trade", { exact: true }).fill("100");
  await createListingForm.getByPlaceholder("Maximum Trade", { exact: true }).fill("1000");
  await seller.page.getByRole("button", { name: "Create Live Listing" }).click();
  await expect(seller.page.getByText("Listing is now live.")).toBeVisible({ timeout: 10_000 });

  await createListingForm.getByPlaceholder("Available Amount", { exact: true }).fill("500");
  await createListingForm.getByPlaceholder("Price", { exact: true }).fill("3.65");
  await createListingForm.getByPlaceholder("Minimum Trade", { exact: true }).fill("50");
  await createListingForm.getByPlaceholder("Maximum Trade", { exact: true }).fill("500");
  await seller.page.getByRole("button", { name: "Create Live Listing" }).click();
  await expect(seller.page.getByText("Listing is now live.")).toBeVisible({ timeout: 10_000 });

  await createListingForm.getByPlaceholder("Available Amount", { exact: true }).fill("250");
  await createListingForm.getByPlaceholder("Price", { exact: true }).fill("3.60");
  await createListingForm.getByPlaceholder("Minimum Trade", { exact: true }).fill("25");
  await createListingForm.getByPlaceholder("Maximum Trade", { exact: true }).fill("250");
  await seller.page.getByRole("button", { name: "Create Live Listing" }).click();
  await expect(seller.page.getByText("You already have 2 active listings. Close one before creating another.")).toBeVisible({ timeout: 10_000 });

  const sellerListingsResponse = await seller.page.request.get("/api/alpha-exchange/my-listings");
  const sellerListingsPayload = (await sellerListingsResponse.json()) as { listings: Array<{ id: string; status: string; availableAmount: string }> };
  const [primaryListing] = sellerListingsPayload.listings;
  expect(primaryListing.status).toBe("active");

  const buyer = await createSession(browser, OWNER_EMAIL, OWNER_PASSWORD);
  const firstRequest = await createRequest(buyer.page.request, primaryListing.id, "300");

  let response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "accepted" } });
  expect(response.ok()).toBeTruthy();
  await seller.page.reload();
  await expect(seller.page.getByText("This listing is locked by an active trade. Editing, pausing, and closing are unavailable until the trade finishes.")).toBeVisible({ timeout: 10_000 });

  response = await seller.page.request.patch(`/api/alpha-exchange/listings/${primaryListing.id}`, {
    data: { price: "4.00" },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({
    error: expect.stringMatching(/locked by an active trade/i),
  });

  await uploadEvidence(buyer.page.request, firstRequest.purchase.id, "buyer");
  response = await buyer.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "payment_sent" } });
  expect(response.ok()).toBeTruthy();

  await uploadEvidence(seller.page.request, firstRequest.purchase.id, "seller");
  response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "usdt_sent" } });
  expect(response.ok()).toBeTruthy();

  response = await buyer.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "completed" } });
  expect(response.ok()).toBeTruthy();

  response = await seller.page.request.get("/api/alpha-exchange/my-listings");
  let payload = (await response.json()) as { listings: Array<{ id: string; status: string; availableAmount: string }> };
  const reopenedListing = payload.listings.find((listing) => listing.id === primaryListing.id);
  expect(reopenedListing).toMatchObject({ status: "active", availableAmount: "700" });

  const secondRequest = await createRequest(buyer.page.request, primaryListing.id, "700");
  response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${secondRequest.purchase.id}`, { data: { status: "accepted" } });
  expect(response.ok()).toBeTruthy();
  await uploadEvidence(buyer.page.request, secondRequest.purchase.id, "buyer");
  response = await buyer.page.request.patch(`/api/alpha-exchange/purchase-requests/${secondRequest.purchase.id}`, { data: { status: "payment_sent" } });
  expect(response.ok()).toBeTruthy();
  await uploadEvidence(seller.page.request, secondRequest.purchase.id, "seller");
  response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${secondRequest.purchase.id}`, { data: { status: "usdt_sent" } });
  expect(response.ok()).toBeTruthy();
  response = await buyer.page.request.patch(`/api/alpha-exchange/purchase-requests/${secondRequest.purchase.id}`, { data: { status: "completed" } });
  expect(response.ok()).toBeTruthy();

  response = await seller.page.request.get("/api/alpha-exchange/my-listings");
  payload = (await response.json()) as { listings: Array<{ id: string; status: string; availableAmount: string }> };
  const completedListing = payload.listings.find((listing) => listing.id === primaryListing.id);
  expect(completedListing).toMatchObject({ status: "completed", availableAmount: "0" });

  response = await buyer.page.request.get("/api/alpha-exchange/admin-prep");
  expect(response.ok()).toBeTruthy();
  const adminPayload = (await response.json()) as {
    listings: Array<{ id: string; status: string }>;
    purchaseRequests: Array<{ listingId: string; status: string }>;
    commissionRecords: Array<{ listingId: string; paymentStatus: string }>;
  };
  expect(adminPayload.listings.some((listing) => listing.id === primaryListing.id && listing.status === "completed")).toBeTruthy();
  expect(adminPayload.purchaseRequests.filter((request) => request.listingId === primaryListing.id && request.status === "review_open")).toHaveLength(2);
  expect(adminPayload.commissionRecords.filter((record) => record.listingId === primaryListing.id && record.paymentStatus === "pending")).toHaveLength(2);

  await Promise.all([seller.context.close(), buyer.context.close()]);
});

test("listing expiration, renewal, vacation mode, timeout notifications, and audit history work end-to-end", async ({ browser }) => {
  test.setTimeout(60_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);
  const owner = await createSession(browser, OWNER_EMAIL, OWNER_PASSWORD);

  const created = await createListing(seller.page.request, { availableAmount: "901", price: "3.71", minimumTrade: "100", maximumTrade: "901" });
  await updateRuntimeDb(owner.page.request, (db) => {
    const listings = Array.isArray(db.marketplaceListings) ? (db.marketplaceListings as Array<Record<string, unknown>>) : [];
    const listing = listings.find((item) => String(item.id) === created.listing.id);
    if (!listing) throw new Error("Listing fixture not found.");
    const expiredAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    listing.expiresAt = expiredAt;
    listing.status = "active";
    listing.updatedAt = expiredAt;
  });
  await waitForPersistence();
  await getAdminPrep(owner.page.request);

  await seller.page.goto("/en/usdt-exchange");
  await seller.page.reload();
  await expect(seller.page.getByRole("button", { name: "Renew" }).first()).toBeVisible({ timeout: 10_000 });
  await seller.page.getByRole("button", { name: "Renew" }).first().click();
  await expect(seller.page.getByText("Listing renewed and visible to buyers again.")).toBeVisible({ timeout: 10_000 });

  const sellerListingsAfterRenew = await seller.page.request.get("/api/alpha-exchange/my-listings");
  expect(sellerListingsAfterRenew.ok()).toBeTruthy();
  const sellerRenewPayload = (await sellerListingsAfterRenew.json()) as { listings: Array<{ id: string; status: string }> };
  expect(sellerRenewPayload.listings.find((listing) => listing.id === created.listing.id)?.status).toBe("active");

  const sellerNotifications = await getDbNotificationsForEmail(SELLER_EMAIL);
  expect(sellerNotifications.some((item) => item.title === "Listing expired")).toBeTruthy();
  expect(sellerNotifications.some((item) => item.title === "Listing renewed")).toBeTruthy();

  let adminPrep = await getAdminPrep(owner.page.request);
  expect(adminPrep.notifications.some((item) => item.title === "Listing expired" && item.relatedListingId === created.listing.id)).toBeTruthy();
  expect(adminPrep.auditLogs.some((item) => item.action === "listing_expired" && item.listingId === created.listing.id)).toBeTruthy();
  expect(adminPrep.auditLogs.some((item) => item.action === "listing_renewed" && item.listingId === created.listing.id)).toBeTruthy();

  let response = await seller.page.request.patch("/api/alpha-exchange/seller-settings", { data: { availabilityStatus: "vacation" } });
  await expectOkWithBody(response, "Enable seller vacation mode");
  await owner.page.goto("/en/usdt-exchange");
  response = await owner.page.request.get("/api/alpha-exchange/listings");
  expect(response.ok()).toBeTruthy();
  const hiddenListings = (await response.json()) as { listings: Array<{ id: string }> };
  expect(hiddenListings.listings.some((listing) => listing.id === created.listing.id)).toBeFalsy();
  response = await owner.page.request.post("/api/alpha-exchange/purchase-requests", {
    data: {
      listingId: created.listing.id,
      usdtAmount: "100",
      buyerName: "Vacation Buyer",
      buyerWhatsapp: "+972500000001",
      buyerNotes: "Testing vacation mode",
    },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: expect.stringMatching(/unavailable/i) });

  const buyerNotificationsAfterBlock = await getDbNotificationsForEmail(OWNER_EMAIL);
  expect(buyerNotificationsAfterBlock.some((item) => item.title === "Listing unavailable")).toBeTruthy();
  const sellerNotificationsAfterVacation = await getDbNotificationsForEmail(SELLER_EMAIL);
  expect(sellerNotificationsAfterVacation.some((item) => item.title === "Vacation enabled")).toBeTruthy();

  adminPrep = await getAdminPrep(owner.page.request);
  expect(adminPrep.notifications.some((item) => item.title === "Seller entered Vacation Mode")).toBeTruthy();
  expect(adminPrep.auditLogs.some((item) => item.action === "seller_vacation_enabled")).toBeTruthy();

  response = await seller.page.request.patch("/api/alpha-exchange/seller-settings", { data: { availabilityStatus: "available" } });
  await expectOkWithBody(response, "Disable seller vacation mode");
  response = await owner.page.request.get("/api/alpha-exchange/listings");
  expect(response.ok()).toBeTruthy();
  const visibleListings = (await response.json()) as { listings: Array<{ id: string }> };
  expect(visibleListings.listings.some((listing) => listing.id === created.listing.id)).toBeTruthy();
  const sellerNotificationsAfterAvailable = await getDbNotificationsForEmail(SELLER_EMAIL);
  expect(sellerNotificationsAfterAvailable.some((item) => item.title === "Vacation disabled")).toBeTruthy();
  adminPrep = await getAdminPrep(owner.page.request);
  expect(adminPrep.auditLogs.some((item) => item.action === "seller_vacation_disabled")).toBeTruthy();

  const timedRequest = await createRequest(owner.page.request, created.listing.id, "100");
  response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${timedRequest.purchase.id}`, { data: { status: "accepted" } });
  expect(response.ok()).toBeTruthy();
  await updateRuntimeDb(owner.page.request, (db) => {
    const requests = Array.isArray(db.purchaseRequests) ? (db.purchaseRequests as Array<Record<string, unknown>>) : [];
    const request = requests.find((item) => String(item.id) === timedRequest.purchase.id);
    if (!request) throw new Error("Timed request fixture missing.");
    const staleAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    request.tradeCreatedAt = staleAt;
    request.updatedAt = staleAt;
  });
  await waitForPersistence();
  adminPrep = await getAdminPrep(owner.page.request);
  const timedOutRequest = adminPrep.purchaseRequests.find((request) => request.id === timedRequest.purchase.id);
  expect(timedOutRequest).toMatchObject({ status: "cancelled" });
  expect(Boolean(timedOutRequest?.timedOutAt)).toBeTruthy();
  const timedOutListing = adminPrep.listings.find((listing) => listing.id === created.listing.id);
  expect(timedOutListing?.status).toBe("active");
  expect(adminPrep.auditLogs.some((item) => item.action === "trade_timed_out" && item.purchaseRequestId === timedRequest.purchase.id)).toBeTruthy();
  expect(adminPrep.notifications.some((item) => item.title === "Trade timed out")).toBeTruthy();

  const sellerNotificationsAfterTimeout = await getDbNotificationsForEmail(SELLER_EMAIL);
  const buyerNotificationsAfterTimeout = await getDbNotificationsForEmail(OWNER_EMAIL);
  expect(sellerNotificationsAfterTimeout.some((item) => item.title === "Trade timed out")).toBeTruthy();
  expect(buyerNotificationsAfterTimeout.some((item) => item.title === "Trade timed out")).toBeTruthy();

  await owner.page.goto("/en/admin/alpha-exchange");
  await owner.page.getByText("Marketplace Listings", { exact: true }).click();
  await expect(owner.page.getByText("Expiration History")).toBeVisible();
  await owner.page.getByText("Purchase Requests", { exact: true }).click();
  await expect(owner.page.getByText("Timeout History")).toBeVisible();
  await owner.page.getByText("Audit Logs", { exact: true }).click();
  await expect(owner.page.getByText("Notification History")).toBeVisible();
  await expect(owner.page.locator("tbody tr").filter({ hasText: "Trade timed out" }).first()).toBeVisible();

  await Promise.all([seller.context.close(), owner.context.close()]);
});

test("admin dashboard listing overrides update state, notifications, and audit history", async ({ browser, page }) => {
  test.setTimeout(60_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);

  const renewCandidate = await createListing(seller.page.request, { availableAmount: "111", price: "3.11" });
  await updateRuntimeDb(seller.page.request, (db) => {
    const listings = Array.isArray(db.marketplaceListings) ? (db.marketplaceListings as Array<Record<string, unknown>>) : [];
    const listing = listings.find((item) => String(item.id) === renewCandidate.listing.id);
    if (!listing) throw new Error("Renew candidate missing.");
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    listing.status = "expired";
    listing.expiresAt = past;
    listing.expiredAt = past;
    listing.updatedAt = past;
  });
  await waitForPersistence();
  await createListing(seller.page.request, { availableAmount: "222", price: "3.22" });
  await waitForPersistence();

  await login(page, OWNER_EMAIL, OWNER_PASSWORD);
  await page.goto("/en/admin/alpha-exchange");
  await page.getByText("Marketplace Listings", { exact: true }).click();

  const renewRow = page.locator("tr").filter({ hasText: "111" }).first();
  await renewRow.getByRole("button", { name: "Renew" }).click();
  await expect(page.getByText("Listing renewed by admin.")).toBeVisible({ timeout: 10_000 });

  const extendRow = page.locator("tr").filter({ hasText: "222" }).first();
  page.once("dialog", (dialog) => dialog.accept("24"));
  await extendRow.getByRole("button", { name: "Extend Expiration" }).click();
  await expect(page.getByText("Listing expiration extended.")).toBeVisible({ timeout: 10_000 });

  const closeRow = page.locator("tr").filter({ hasText: "111" }).first();
  await closeRow.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Listing closed by admin.")).toBeVisible({ timeout: 10_000 });

  const forceCloseCandidate = await createListing(seller.page.request, { availableAmount: "444", price: "3.44" });
  const forceRequest = await createRequest(page.request, forceCloseCandidate.listing.id, "100");
  const response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${forceRequest.purchase.id}`, { data: { status: "accepted" } });
  expect(response.ok()).toBeTruthy();

  await page.reload();
  await page.getByText("Marketplace Listings", { exact: true }).click();
  const forceRow = page.locator("tr").filter({ hasText: "444" }).first();
  page.once("dialog", (dialog) => dialog.accept("Owner override"));
  await forceRow.getByRole("button", { name: "Force Close" }).click();
  await expect(page.getByText("Listing force closed.")).toBeVisible({ timeout: 10_000 });

  const adminPrep = await getAdminPrep(page.request);
  expect(adminPrep.listings.some((listing) => listing.id === renewCandidate.listing.id && listing.status === "closed")).toBeTruthy();
  expect(adminPrep.listings.some((listing) => listing.id === forceCloseCandidate.listing.id && listing.status === "closed")).toBeTruthy();
  expect(adminPrep.purchaseRequests.some((request) => request.id === forceRequest.purchase.id && request.status === "cancelled")).toBeTruthy();
  expect(adminPrep.auditLogs.some((entry) => entry.action === "listing_renewed" && entry.listingId === renewCandidate.listing.id)).toBeTruthy();
  expect(adminPrep.auditLogs.some((entry) => entry.action === "listing_expiration_extended")).toBeTruthy();
  expect(adminPrep.auditLogs.some((entry) => entry.action === "admin_override" && entry.reason === "Owner override")).toBeTruthy();
  expect(adminPrep.notifications.some((entry) => entry.title === "Listing force closed")).toBeTruthy();

  const sellerNotifications = await getDbNotificationsForEmail(SELLER_EMAIL);
  const buyerNotifications = await getDbNotificationsForEmail(OWNER_EMAIL);
  expect(sellerNotifications.some((item) => item.title === "Listing renewed")).toBeTruthy();
  expect(sellerNotifications.some((item) => item.title === "Listing closed" || item.title === "Listing force closed")).toBeTruthy();
  expect(buyerNotifications.some((item) => item.title === "Trade cancelled")).toBeTruthy();

  await page.getByText("Audit Logs", { exact: true }).click();
  await expect(page.getByText("Notification History")).toBeVisible();
  await expect(page.locator("tbody tr").filter({ hasText: "Listing force closed" }).first()).toBeVisible();

  await seller.context.close();
});
