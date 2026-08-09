import { request, test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import { cleanupBuyerFixture, resolveBuyerFixture, type BuyerFixture } from "./support/buyer-fixture";

const OWNER_EMAIL = (process.env.E2E_OWNER_EMAIL ?? "").toLowerCase();
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "";
const ADMIN_EMAIL = (process.env.E2E_ADMIN_EMAIL ?? "").toLowerCase();
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
let BUYER_EMAIL = (process.env.E2E_BUYER_EMAIL ?? "").toLowerCase();
let BUYER_PASSWORD = process.env.E2E_BUYER_PASSWORD ?? "";
const SELLER_EMAIL = (process.env.E2E_SELLER_EMAIL ?? "").toLowerCase();
const SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD ?? "";
const TEST_EVIDENCE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";
const TEST_SUPPORT_HEADERS = {
  "x-alpha-test-support": "enabled",
};
let buyerFixture: BuyerFixture | undefined;

function toRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as unknown as Array<Record<string, unknown>>) : [];
}

test.beforeAll(async () => {
  buyerFixture = await resolveBuyerFixture(BUYER_EMAIL, BUYER_PASSWORD);
  BUYER_EMAIL = buyerFixture.email;
  BUYER_PASSWORD = buyerFixture.password;
});

test.afterAll(async () => {
  await cleanupBuyerFixture(buyerFixture);
});

async function readRuntimeDb(request: APIRequestContext) {
  const response = await request.get("/api/testing/alpha-exchange-state", { headers: TEST_SUPPORT_HEADERS });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as unknown as AlphaExchangeDb;
}

async function writeRuntimeDb(request: APIRequestContext, db: AlphaExchangeDb) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request.put("/api/testing/alpha-exchange-state", {
      headers: TEST_SUPPORT_HEADERS,
      data: db,
    });
    if (response.ok()) return;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("writeRuntimeDb: PUT /api/testing/alpha-exchange-state failed after 3 attempts");
}

async function updateRuntimeDb(request: APIRequestContext, mutator: (db: AlphaExchangeDb) => void) {
  const db = await readRuntimeDb(request);
  mutator(db);
  await writeRuntimeDb(request, db);
}

async function waitForPersistence() {
  await new Promise((resolve) => setTimeout(resolve, 450));
}

async function waitForSellerTrustSnapshot(request: APIRequestContext, sellerEmail: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtimeDb = await readRuntimeDb(request);
    const trustSnapshots = toRecords(runtimeDb.trustSnapshots);
    const users = toRecords(runtimeDb.users);
    const sellerUser = users.find((user) => String(user.email ?? "").toLowerCase() === sellerEmail);
    if (sellerUser) {
      const sellerTrustSnapshot = trustSnapshots.find((entry) => String(entry.sellerId ?? "") === String(sellerUser.id ?? ""));
      const reputation = (sellerTrustSnapshot?.snapshot ?? null) as Record<string, unknown> | null;
      if (Number(reputation?.completedTrades ?? 0) >= 1 && Number(reputation?.totalUsdtVolume ?? 0) >= 300) {
        return { runtimeDb, sellerUser, reputation };
      }
    }
    await waitForPersistence();
  }
  throw new Error("Timed out waiting for seller trust snapshot to persist.");
}

async function login(page: Page, email: string, password: string) {
  const existingSession = await page.request.get("/api/auth/me");
  if (existingSession.ok()) {
    const existingPayload = (await existingSession.json()) as { user?: { id?: string } | null };
    if (existingPayload.user?.id) {
      return;
    }
  }
  const loginResponse = await page.request.post("/api/auth/login", {
    data: { email, password, rememberMe: true },
  });
  if (!loginResponse.ok()) {
    throw new Error(`Login failed for ${email} (${loginResponse.status()}): ${await loginResponse.text()}`);
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const meResponse = await page.request.get("/api/auth/me");
    if (meResponse.ok()) {
      const mePayload = (await meResponse.json()) as { user?: { id?: string } | null };
      if (mePayload.user?.id) {
        await page.goto("/en/usdt-exchange");
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for authenticated session after login.");
}

async function createSession(browser: Browser, email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

async function runWithDialogs(
  page: Page,
  action: () => Promise<unknown>,
  steps: Array<{ type: "confirm" | "prompt"; value?: string }>,
) {
  const pendingAction = action();
  for (const step of steps) {
    const dialog = await page.waitForEvent("dialog");
    expect(dialog.type()).toBe(step.type);
    if (step.type === "prompt") {
      await dialog.accept(step.value ?? "");
    } else {
      await dialog.accept();
    }
  }
  await pendingAction;
}

async function resetLifecycleFixtures() {
  if (!OWNER_EMAIL || !OWNER_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD || !BUYER_EMAIL || !BUYER_PASSWORD || !SELLER_EMAIL || !SELLER_PASSWORD) {
    return false;
  }
  const api = await request.newContext({ baseURL: "http://localhost:3000" });
  const db = await readRuntimeDb(api);
  const users = toRecords(db.users);
  const seller = users.find((user) => String(user.email ?? "").toLowerCase() === SELLER_EMAIL);
  const owner = users.find((user) => String(user.email ?? "").toLowerCase() === OWNER_EMAIL);
  const admin = users.find((user) => String(user.email ?? "").toLowerCase() === ADMIN_EMAIL);
  const buyer = users.find((user) => String(user.email ?? "").toLowerCase() === BUYER_EMAIL);
  if (!seller || !owner || !admin || !buyer) {
    await api.dispose();
    return false;
  }

  const sellerId = String(seller.id);
  const ownerId = String(owner.id);
  const adminId = String(admin.id);
  const buyerId = String(buyer.id);
  const relatedUserIds = new Set([sellerId, ownerId, adminId, buyerId]);
  const relatedListingIds = new Set(
    toRecords(db.marketplaceListings)
      .filter((listing) => relatedUserIds.has(String(listing.sellerId ?? "")))
      .map((listing) => String(listing.id)),
  );
  const relatedRequestIds = new Set(
    toRecords(db.purchaseRequests)
      .filter((request) => relatedUserIds.has(String(request.sellerId ?? "")) || relatedUserIds.has(String(request.buyerId ?? "")) || relatedListingIds.has(String(request.listingId ?? "")))
      .map((request) => String(request.id)),
  );

  db.marketplaceListings = toRecords(db.marketplaceListings).filter(
    (listing) => !relatedUserIds.has(String(listing.sellerId ?? "")),
  ) as unknown as AlphaExchangeDb["marketplaceListings"];
  db.purchaseRequests = toRecords(db.purchaseRequests).filter(
    (request) => !relatedRequestIds.has(String(request.id ?? "")),
  ) as unknown as AlphaExchangeDb["purchaseRequests"];
  db.commissionRecords = toRecords(db.commissionRecords).filter(
    (record) => !relatedRequestIds.has(String(record.purchaseRequestId ?? "")) && !relatedUserIds.has(String(record.sellerId ?? "")),
  ) as unknown as AlphaExchangeDb["commissionRecords"];
  db.tradeEvidenceFiles = toRecords(db.tradeEvidenceFiles).filter(
    (entry) => !relatedRequestIds.has(String(entry.purchaseRequestId ?? "")),
  ) as unknown as AlphaExchangeDb["tradeEvidenceFiles"];
  db.notifications = toRecords(db.notifications).filter(
    (entry) => !relatedUserIds.has(String(entry.userId ?? "")),
  ) as unknown as AlphaExchangeDb["notifications"];
  db.activityLog = toRecords(db.activityLog).filter(
    (entry) => !relatedUserIds.has(String(entry.userId ?? "")),
  ) as unknown as AlphaExchangeDb["activityLog"];
  db.auditLogs = toRecords(db.auditLogs).filter(
    (entry) => !relatedRequestIds.has(String(entry.purchaseRequestId ?? "")) && !relatedListingIds.has(String(entry.listingId ?? "")),
  ) as unknown as AlphaExchangeDb["auditLogs"];
  // Prune accumulated sessions and trust records for test users so the snapshot
  // stays small between lifecycle test runs (prevents body-size failures).
  db.authSessions = toRecords(db.authSessions).filter(
    (session) => !relatedUserIds.has(String(session.userId ?? "")),
  ) as unknown as AlphaExchangeDb["authSessions"];
  db.trustSnapshots = toRecords(db.trustSnapshots).filter(
    (snap) => !relatedUserIds.has(String(snap.sellerId ?? "")),
  ) as unknown as AlphaExchangeDb["trustSnapshots"];
  db.trustScoreHistory = toRecords(db.trustScoreHistory).filter(
    (entry) => !relatedUserIds.has(String(entry.sellerId ?? "")),
  ) as unknown as AlphaExchangeDb["trustScoreHistory"];
  db.users = users.map((user) => {
    if (String(user.id) !== sellerId && String(user.id) !== buyerId) return user;
    return {
      ...user,
      verifiedPhone: String(user.id) === sellerId ? "+972500000003" : "+972500000000",
      phoneVerifiedAt: new Date().toISOString(),
      availabilityStatus: "available",
      onlineStatus: "online",
      lastActiveAt: new Date().toISOString(),
    };
  }) as unknown as AlphaExchangeDb["users"];

  await writeRuntimeDb(api, db);
  await api.dispose();
  await waitForPersistence();
  return true;
}

async function uploadEvidence(page: Page, requestId: string, side: "buyer" | "seller") {
  const response = await page.evaluate(
    async ({ targetRequestId, targetSide, evidenceBase64 }) => {
      const fetchResponse = await fetch(`/api/alpha-exchange/purchase-requests/${targetRequestId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          side: targetSide,
          fileName: `${targetSide}-proof.png`,
          mimeType: "image/png",
          sizeBytes: Math.ceil((evidenceBase64.length * 3) / 4),
          fileData: `data:image/png;base64,${evidenceBase64}`,
        }),
      });

      return {
        ok: fetchResponse.ok,
        status: fetchResponse.status,
        text: await fetchResponse.text(),
      };
    },
    {
      targetRequestId: requestId,
      targetSide: side,
      evidenceBase64: TEST_EVIDENCE_BASE64,
    },
  );

  expect(response.ok, `Upload ${side} evidence failed (${response.status}): ${response.text}`).toBeTruthy();
}

async function createRequest(request: APIRequestContext, listingId: string, usdtAmount: string) {
  const response = await request.post("/api/alpha-exchange/purchase-requests", {
    data: {
      listingId,
      usdtAmount,
      buyerName: "Lifecycle Buyer",
      buyerWhatsapp: "+972500000000",
      buyerNotes: `Buying ${usdtAmount} USDT`,
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
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
      paymentMethods: ["Bank Transfer"],
      bankName: "Bank Hapoalim",
      minimumTrade: input.minimumTrade ?? "50",
      maximumTrade: input.maximumTrade ?? input.availableAmount,
      expirationHours: 24,
      notes: "",
      sellerDescription: "",
      responseTime: "5 min",
      photos: [],
      acceptedCommissionPolicy: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { listing: { id: string; status: string; expiresAt?: string } };
}

async function submitListingFromSellerWorkspace(page: Page, expectedListing: { availableAmount: string; price: string }) {
  const submitButton = page.getByRole("button", { name: "Submit Listing" });
  await page.getByRole("textbox", { name: "Available USDT *" }).fill(expectedListing.availableAmount);
  await page.getByRole("textbox", { name: "Price" }).fill(expectedListing.price);
  await page.getByRole("textbox", { name: "Minimum Trade (Required)" }).fill("50");
  await page.getByRole("textbox", { name: "Maximum Trade (Required)" }).fill(expectedListing.availableAmount);
  await page.getByRole("button", { name: /Bank Hapoalim/i }).click();
  const commissionCheckbox = page.getByRole("checkbox", { name: /1% commission policy/i });
  if (!(await commissionCheckbox.isChecked())) {
    await commissionCheckbox.check();
  }
  await expect(submitButton).toBeEnabled({ timeout: 60_000 });
  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/alpha-exchange/listings",
      { timeout: 120_000 },
    ),
    submitButton.click(),
  ]);

  expect([200, 201]).toContain(createResponse.status());

  const payload = (await createResponse.json()) as { listing?: { id: string; status: string; availableAmount?: string; price?: string } };
  if (!payload.listing?.id) {
    throw new Error("Listing create response did not include a listing id.");
  }
  await expect(page.getByText("My Listings")).toBeVisible({ timeout: 30_000 });
  return { listing: payload.listing };
}

async function getDbNotificationsForEmail(email: string) {
  const api = await request.newContext({ baseURL: "http://localhost:3000" });
  const db = await readRuntimeDb(api);
  await api.dispose();
  const users = toRecords(db.users);
  const user = users.find((entry) => String(entry.email ?? "").toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`Notification user ${email} not found.`);
  const userId = String(user.id);
  const notifications = toRecords(db.notifications);
  return notifications
    .filter((entry) => String(entry.userId ?? "") === userId)
    .map((entry) => ({
      title: String(entry.title ?? ""),
      message: String(entry.message ?? ""),
    }));
}

async function waitForNotificationTitles(email: string, titles: string[], timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const notifications = await getDbNotificationsForEmail(email);
    if (titles.every((title) => notifications.some((item) => item.title === title))) {
      return notifications;
    }
    await waitForPersistence();
  }
  const notifications = await getDbNotificationsForEmail(email);
  throw new Error(`Timed out waiting for notifications for ${email}: ${titles.join(", ")}. Received: ${notifications.map((item) => item.title).join(", ")}`);
}

async function getAdminPrep(request: APIRequestContext) {
  const response = await request.get("/api/alpha-exchange/admin-prep");
  if (!response.ok()) {
    throw new Error(`Admin prep failed (${response.status()}): ${await response.text()}`);
  }
  return (await response.json()) as {
    listings: Array<{ id: string; status: string; expiresAt?: string; expiredAt?: string; lastRenewedAt?: string }>;
    purchaseRequests: Array<{
      id: string;
      listingId: string;
      sellerId?: string;
      buyerId?: string;
      status: string;
      timedOutAt?: string;
      timeoutReason?: string;
      tradeCreatedAt?: string;
      paymentSentAt?: string;
      fundsReceivedAt?: string;
      usdtReleaseStartedAt?: string;
      usdtReleaseDeadlineAt?: string;
      usdtSentAt?: string;
      completedAt?: string;
      buyerEvidence?: { fileName?: string } | null;
      sellerEvidence?: { fileName?: string } | null;
    }>;
    auditLogs: Array<{ action: string; listingId?: string; purchaseRequestId?: string; details?: string; reason?: string }>;
    notifications: Array<{ userId: string; title: string; message: string; relatedListingId?: string; relatedTradeId?: string }>;
  };
}

async function expectOkWithBody(response: Awaited<ReturnType<APIRequestContext["get"]>>, label: string) {
  if (!response.ok()) {
    throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
  }
}

type PurchasePayload = {
  id: string;
  status: string;
  buyerEvidence?: { fileName?: string } | null;
  sellerEvidence?: { fileName?: string } | null;
  fundsReceivedAt?: string;
  usdtReleaseStartedAt?: string;
  usdtReleaseDeadlineAt?: string;
  usdtSentAt?: string;
  completedAt?: string;
};

async function readPurchaseFromPatchResponse(response: Awaited<ReturnType<APIRequestContext["patch"]>>) {
  const payload = (await response.json()) as { purchase?: PurchasePayload; request?: PurchasePayload };
  const purchase = payload.purchase ?? payload.request;
  if (!purchase) {
    throw new Error("Missing purchase payload in response.");
  }
  return purchase;
}

test.describe.configure({ mode: "serial" });

test("seller listing lifecycle is enforced end-to-end", async ({ browser }) => {
  test.setTimeout(600_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);
  await seller.page.goto("/en/usdt-exchange");
  await expect(seller.page.getByRole("button", { name: "Submit Listing" })).toBeVisible({ timeout: 60_000 });
  const firstListingCreate = await submitListingFromSellerWorkspace(seller.page, { availableAmount: "1000", price: "3.20" });
  expect(firstListingCreate.listing?.id).toBeTruthy();

  const secondListingCreate = await submitListingFromSellerWorkspace(seller.page, { availableAmount: "500", price: "3.18" });
  expect(secondListingCreate.listing?.id).toBeTruthy();
  await expect(seller.page.getByText("You already have 2 active listings. Close one before creating another.").first()).toBeVisible({ timeout: 30_000 });

  await seller.page.getByRole("textbox", { name: "Available USDT *" }).fill("250");
  await seller.page.getByRole("textbox", { name: "Price" }).fill("3.10");
  await seller.page.getByRole("textbox", { name: "Minimum Trade (Required)" }).fill("25");
  await seller.page.getByRole("textbox", { name: "Maximum Trade (Required)" }).fill("250");
  await expect(seller.page.getByRole("button", { name: "Submit Listing" })).toBeDisabled();
  await expect(seller.page.getByText("You already have 2 active listings. Close one before creating another.").first()).toBeVisible({ timeout: 10_000 });

  const sellerListingsResponse = await seller.page.request.get("/api/alpha-exchange/my-listings");
  const sellerListingsPayload = (await sellerListingsResponse.json()) as {
    listings: Array<{ id: string; status: string; approvalStatus?: string; availableAmount: string }>;
  };
  const [primaryListing] = sellerListingsPayload.listings;
  expect(primaryListing).toMatchObject({ status: "draft", approvalStatus: "pending" });

  const owner = await createSession(browser, OWNER_EMAIL, OWNER_PASSWORD);
  const approvalResponse = await owner.page.request.patch(`/api/alpha-exchange/admin/listings/${primaryListing.id}`, {
    data: { action: "approve" },
  });
  expect(approvalResponse.ok()).toBeTruthy();
  expect(await approvalResponse.json()).toMatchObject({
    listing: { id: primaryListing.id, status: "active", approvalStatus: "approved" },
  });

  const buyer = await createSession(browser, BUYER_EMAIL, BUYER_PASSWORD);
  const firstRequest = await createRequest(buyer.page.request, primaryListing.id, "300");

  let response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "accepted" } });
  expect(response.ok()).toBeTruthy();
  let firstTrade = await readPurchaseFromPatchResponse(response);
  expect(firstTrade.status).toBe("accepted");
  await seller.page.reload();
  await expect(seller.page).toHaveURL(`/en/trade-room/${firstRequest.purchase.id}`, { timeout: 10_000 });

  response = await seller.page.request.patch(`/api/alpha-exchange/listings/${primaryListing.id}`, {
    data: { price: "3.30" },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({
    error: expect.stringMatching(/locked by an active trade/i),
  });

  await uploadEvidence(buyer.page, firstRequest.purchase.id, "buyer");
  let refreshedTrade = await getAdminPrep(owner.page.request);
  const paymentSentTrade = refreshedTrade.purchaseRequests.find((request) => request.id === firstRequest.purchase.id);
  expect(paymentSentTrade?.status).toBe("payment_sent");
  firstTrade = paymentSentTrade as PurchasePayload;
  expect(firstTrade.status).toBe("payment_sent");
  expect(firstTrade.buyerEvidence?.fileName).toBe("buyer-proof.png");

  response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "funds_received" } });
  expect(response.ok()).toBeTruthy();
  firstTrade = await readPurchaseFromPatchResponse(response);
  expect(firstTrade.status).toBe("funds_received");
  expect(Boolean(firstTrade.fundsReceivedAt)).toBeTruthy();

  response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "usdt_release_pending" } });
  expect(response.ok()).toBeTruthy();
  firstTrade = await readPurchaseFromPatchResponse(response);
  expect(firstTrade.status).toBe("usdt_release_pending");
  expect(Boolean(firstTrade.usdtReleaseStartedAt)).toBeTruthy();
  expect(Boolean(firstTrade.usdtReleaseDeadlineAt)).toBeTruthy();
  const startedAtMs = new Date(String(firstTrade.usdtReleaseStartedAt)).getTime();
  const deadlineAtMs = new Date(String(firstTrade.usdtReleaseDeadlineAt)).getTime();
  expect(deadlineAtMs - startedAtMs).toBe(45 * 60 * 1000);

  await uploadEvidence(seller.page, firstRequest.purchase.id, "seller");
  response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "usdt_sent" } });
  expect(response.ok()).toBeTruthy();
  firstTrade = await readPurchaseFromPatchResponse(response);
  expect(firstTrade.status).toBe("usdt_sent");
  expect(firstTrade.sellerEvidence?.fileName).toBe("seller-proof.png");

  response = await buyer.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "completed" } });
  expect(response.ok()).toBeTruthy();
  firstTrade = await readPurchaseFromPatchResponse(response);
  expect(firstTrade.status).toBe("review_open");
  expect(Boolean(firstTrade.completedAt)).toBeTruthy();

  let adminPrep = await getAdminPrep(owner.page.request);
  let firstTradeAdmin = adminPrep.purchaseRequests.find((request) => request.id === firstRequest.purchase.id);
  expect(firstTradeAdmin?.status).toBe("review_open");
  expect(firstTradeAdmin?.buyerEvidence?.fileName).toBe("buyer-proof.png");
  expect(firstTradeAdmin?.sellerEvidence?.fileName).toBe("seller-proof.png");
  expect(Boolean(firstTradeAdmin?.fundsReceivedAt)).toBeTruthy();
  expect(Boolean(firstTradeAdmin?.usdtReleaseStartedAt)).toBeTruthy();
  expect(Boolean(firstTradeAdmin?.usdtReleaseDeadlineAt)).toBeTruthy();
  expect(Boolean(firstTradeAdmin?.usdtSentAt)).toBeTruthy();
  expect(Boolean(firstTradeAdmin?.completedAt)).toBeTruthy();

  const sellerNotificationsAfterFirstTrade = await waitForNotificationTitles(SELLER_EMAIL, [
    "Buyer marked payment sent",
    "Trade completed",
  ]);
  expect(sellerNotificationsAfterFirstTrade.some((item) => item.title === "Buyer marked payment sent")).toBeTruthy();
  expect(sellerNotificationsAfterFirstTrade.some((item) => item.title === "Trade completed")).toBeTruthy();
  const buyerNotificationsAfterFirstTrade = await waitForNotificationTitles(BUYER_EMAIL, [
    "Trade request accepted",
    "Seller confirmed funds received",
    "USDT release pending",
    "Seller marked USDT sent",
    "Trade completed",
    "Review available",
  ]);
  expect(buyerNotificationsAfterFirstTrade.some((item) => item.title === "Trade request accepted")).toBeTruthy();
  expect(buyerNotificationsAfterFirstTrade.some((item) => item.title === "Seller confirmed funds received")).toBeTruthy();
  expect(buyerNotificationsAfterFirstTrade.some((item) => item.title === "USDT release pending")).toBeTruthy();
  expect(buyerNotificationsAfterFirstTrade.some((item) => item.title === "Seller marked USDT sent")).toBeTruthy();
  expect(buyerNotificationsAfterFirstTrade.some((item) => item.title === "Trade completed")).toBeTruthy();
  expect(buyerNotificationsAfterFirstTrade.some((item) => item.title === "Review available")).toBeTruthy();

  response = await buyer.page.request.post(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}/review`, {
    data: {
      mode: "buyer_review",
      rating: 5,
      comment: "Lifecycle verification completed successfully.",
    },
  });
  expect(response.ok()).toBeTruthy();

  response = await seller.page.request.get("/api/alpha-exchange/my-listings");
  const payload = (await response.json()) as { listings: Array<{ id: string; status: string; availableAmount: string }> };
  const reopenedListing = payload.listings.find((listing) => listing.id === primaryListing.id);
  expect(reopenedListing).toMatchObject({ status: "active", availableAmount: "700" });

  const { reputation } = await waitForSellerTrustSnapshot(seller.page.request, SELLER_EMAIL);
  expect(Number(reputation?.completedTrades ?? 0)).toBeGreaterThanOrEqual(1);
  expect(Number(reputation?.totalUsdtVolume ?? 0)).toBeGreaterThanOrEqual(300);
  expect(Number(reputation?.completionRate ?? 0)).toBeGreaterThan(0);

  await Promise.all([seller.context.close(), buyer.context.close(), owner.context.close()]);
});

test("listing expiration, renewal, vacation mode, timeout notifications, and audit history work end-to-end", async ({ browser }) => {
  test.setTimeout(180_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);
  const owner = await createSession(browser, OWNER_EMAIL, OWNER_PASSWORD);
  const buyer = await createSession(browser, BUYER_EMAIL, BUYER_PASSWORD);

  const created = await createListing(seller.page.request, { availableAmount: "901", price: "3.20", minimumTrade: "100", maximumTrade: "901" });
  await updateRuntimeDb(owner.page.request, (db) => {
    const listings = toRecords(db.marketplaceListings);
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
  await expect(seller.page.getByText(/Listing renewed.*refreshed expiry/)).toBeVisible({ timeout: 10_000 });

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
  await buyer.page.goto("/en/usdt-exchange");
  response = await buyer.page.request.get("/api/alpha-exchange/listings");
  expect(response.ok()).toBeTruthy();
  const hiddenListings = (await response.json()) as { listings: Array<{ id: string }> };
  expect(hiddenListings.listings.some((listing) => listing.id === created.listing.id)).toBeFalsy();
  response = await buyer.page.request.post("/api/alpha-exchange/purchase-requests", {
    data: {
      listingId: created.listing.id,
      usdtAmount: "100",
      buyerName: "Vacation Buyer",
      buyerWhatsapp: "+972500000001",
      buyerNotes: "Testing vacation mode",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
    },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({
    code: "PURCHASE_REQUEST_VALIDATION_FAILED",
    message: expect.stringMatching(/unavailable/i),
  });

  const buyerNotificationsAfterBlock = await getDbNotificationsForEmail(BUYER_EMAIL);
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

  const timedRequest = await createRequest(buyer.page.request, created.listing.id, "100");
  response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${timedRequest.purchase.id}`, { data: { status: "accepted" } });
  expect(response.ok()).toBeTruthy();
  await updateRuntimeDb(owner.page.request, (db) => {
    const requests = toRecords(db.purchaseRequests);
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
  const buyerNotificationsAfterTimeout = await getDbNotificationsForEmail(BUYER_EMAIL);
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

  await Promise.all([seller.context.close(), owner.context.close(), buyer.context.close()]);
});

test("admin dashboard listing overrides update state, notifications, and audit history", async ({ browser }) => {
  test.setTimeout(180_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);

  const renewCandidate = await createListing(seller.page.request, { availableAmount: "111", price: "3.11" });
  await updateRuntimeDb(seller.page.request, (db) => {
    const listings = toRecords(db.marketplaceListings);
    const listing = listings.find((item) => String(item.id) === renewCandidate.listing.id);
    if (!listing) throw new Error("Renew candidate missing.");
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    listing.status = "expired";
    listing.expiresAt = past;
    listing.expiredAt = past;
    listing.updatedAt = past;
  });
  await waitForPersistence();
  await createListing(seller.page.request, { availableAmount: "222", price: "3.12" });
  await waitForPersistence();

  const admin = await createSession(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
  const page = admin.page;
  await page.goto("/en/admin/alpha-exchange");
  await page.getByText("Marketplace Listings", { exact: true }).click();

  const renewRow = page.locator("tr").filter({ hasText: "111" }).first();
  await runWithDialogs(page, () => renewRow.getByRole("button", { name: "Renew" }).click(), [
    { type: "confirm" },
    { type: "prompt", value: "Admin renewal for launch QA" },
  ]);
  await expect(page.getByText("Listing renewed by admin.")).toBeVisible({ timeout: 10_000 });

  const extendRow = page.locator("tr").filter({ hasText: "222" }).first();
  await runWithDialogs(page, () => extendRow.getByRole("button", { name: "Extend Expiration" }).click(), [
    { type: "confirm" },
    { type: "prompt", value: "24" },
    { type: "prompt", value: "Extend listing for launch QA" },
  ]);
  await expect(page.getByText("Listing expiration extended.")).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await page.getByText("Marketplace Listings", { exact: true }).click();
  const closeRow = page.locator("tr").filter({ hasText: "111" }).first();
  const closeButton = closeRow.getByRole("button", { name: "Close" });
  await expect(closeButton).toBeVisible({ timeout: 30_000 });
  await runWithDialogs(page, () => closeButton.click(), [
    { type: "confirm" },
    { type: "prompt", value: "Closing listing for launch QA" },
  ]);
  await expect(page.getByText("Listing closed by admin.")).toBeVisible({ timeout: 10_000 });

  const forceCloseCandidate = await createListing(seller.page.request, { availableAmount: "444", price: "3.14" });
  const approvalResponse = await page.request.patch(`/api/alpha-exchange/admin/listings/${forceCloseCandidate.listing.id}`, {
    data: { action: "approve" },
  });
  expect(approvalResponse.ok()).toBeTruthy();
  const buyer = await createSession(browser, BUYER_EMAIL, BUYER_PASSWORD);
  const forceRequest = await createRequest(buyer.page.request, forceCloseCandidate.listing.id, "100");
  const response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${forceRequest.purchase.id}`, { data: { status: "accepted" } });
  expect(response.ok()).toBeTruthy();

  await page.reload();
  await page.getByText("Marketplace Listings", { exact: true }).click();
  const forceRow = page.locator("tr").filter({ hasText: "444" }).first();
  await runWithDialogs(page, () => forceRow.getByRole("button", { name: "Force Close" }).click(), [
    { type: "prompt", value: "Admin override" },
  ]);
  await expect(page.getByText("Listing force closed.")).toBeVisible({ timeout: 10_000 });

  const adminPrep = await getAdminPrep(page.request);
  expect(adminPrep.listings.some((listing) => listing.id === renewCandidate.listing.id && listing.status === "closed")).toBeTruthy();
  expect(adminPrep.listings.some((listing) => listing.id === forceCloseCandidate.listing.id && listing.status === "closed")).toBeTruthy();
  expect(adminPrep.purchaseRequests.some((request) => request.id === forceRequest.purchase.id && request.status === "cancelled")).toBeTruthy();
  expect(adminPrep.auditLogs.some((entry) => entry.action === "listing_renewed" && entry.listingId === renewCandidate.listing.id)).toBeTruthy();
  expect(adminPrep.auditLogs.some((entry) => entry.action === "listing_expiration_extended")).toBeTruthy();
  expect(adminPrep.auditLogs.some((entry) => entry.action === "admin_override" && entry.reason === "Admin override")).toBeTruthy();
  expect(adminPrep.notifications.some((entry) => entry.title === "Listing force closed")).toBeTruthy();

  const sellerNotifications = await getDbNotificationsForEmail(SELLER_EMAIL);
  const buyerNotifications = await getDbNotificationsForEmail(BUYER_EMAIL);
  expect(sellerNotifications.some((item) => item.title === "Listing renewed")).toBeTruthy();
  expect(sellerNotifications.some((item) => item.title === "Listing closed" || item.title === "Listing force closed")).toBeTruthy();
  expect(buyerNotifications.some((item) => item.title === "Trade cancelled")).toBeTruthy();

  await page.getByText("Audit Logs", { exact: true }).click();
  await expect(page.getByText("Notification History")).toBeVisible();
  await expect(page.locator("tbody tr").filter({ hasText: "Listing force closed" }).first()).toBeVisible();

  await Promise.all([seller.context.close(), buyer.context.close(), admin.context.close()]);
});
