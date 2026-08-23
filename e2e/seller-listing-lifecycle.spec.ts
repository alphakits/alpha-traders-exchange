import { request, test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import { cleanupBuyerFixture, resolveBuyerFixture, type BuyerFixture } from "./support/buyer-fixture";
import { E2E_BASE_URL } from "./support/base-url";

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
  if (!buyerFixture) return;
  await Promise.race([
    cleanupBuyerFixture(buyerFixture),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const loginResponse = await page.request.post("/api/auth/login", {
      headers: { "x-forwarded-for": "198.51.100.21" },
      data: { email, password, rememberMe: true },
    });
    if (!loginResponse.ok()) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    const meDeadline = Date.now() + 12_000;
    while (Date.now() < meDeadline) {
      const meResponse = await page.request.get("/api/auth/me");
      if (meResponse.ok()) {
        const mePayload = (await meResponse.json()) as { user?: { id?: string; email?: string } | null };
        const meEmail = String(mePayload.user?.email ?? "").toLowerCase();
        if (mePayload.user?.id && meEmail === email.toLowerCase()) {
          await page.goto("/en/usdt-exchange");
          await page.waitForLoadState("domcontentloaded");
          if (!/\/en\/login(?:\?|$)/.test(page.url())) {
            return;
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for authenticated session after login.");
}

async function createSession(browser: Browser, email: string, password: string) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, email, password);
      return { context, page };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await context.close();
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError ?? new Error("Unable to establish authenticated browser session.");
}

function fakeSellerBankSeed(index: number) {
  const normalized = index + 1;
  const bankName = normalized % 2 === 0 ? "Bank Leumi" : "Bank Hapoalim";
  return {
    accountHolderName: `QA Seller ${normalized}`,
    bankName,
    branchNumber: String(100 + normalized),
    accountNumber: `90000000${String(normalized).padStart(2, "0")}`,
    isDefault: normalized === 1,
  };
}

async function readSellerBankAccounts(request: APIRequestContext) {
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request.get("/api/alpha-exchange/seller-settings");
    if (response.ok()) {
      const payload = (await response.json()) as {
        bankAccounts?: Array<{ id: string; bankName: string; accountLast4: string; maskedAccountNumber?: string; branchNumber?: string; accountNumber?: string }>;
      };
      return payload.bankAccounts ?? [];
    }
    lastStatus = response.status();
    lastBody = await response.text();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`readSellerBankAccounts failed after retries (${lastStatus}): ${lastBody}`);
}

async function addSellerBankAccountViaApi(request: APIRequestContext, index: number) {
  const bank = fakeSellerBankSeed(index);
  let response: Awaited<ReturnType<APIRequestContext["patch"]>> | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await request.patch("/api/alpha-exchange/seller-settings", {
      data: {
        action: "add_bank_account",
        ...bank,
      },
    });
    if (response.ok()) break;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  expect(response?.ok(), `Add seller bank account failed: ${await response?.text()}`).toBeTruthy();
  const payload = (await response!.json()) as { bankAccount?: { id: string } };
  expect(payload.bankAccount?.id).toBeTruthy();
  return payload.bankAccount!.id;
}

async function ensureSellerBankAccounts(request: APIRequestContext, count: 1 | 2) {
  const accounts = await readSellerBankAccounts(request);
  for (let index = accounts.length; index < count; index += 1) {
    await addSellerBankAccountViaApi(request, index);
  }
  return await readSellerBankAccounts(request);
}

async function chooseCreatePayoutBankAccountByLast4(page: Page, last4: string) {
  const selects = page.getByRole("main").locator("#create-listing form select");
  const count = await selects.count();
  for (let index = 0; index < count; index += 1) {
    const select = selects.nth(index);
    const optionLabels = await select.locator("option").allTextContents();
    const label = optionLabels.find((entry) => entry.includes(last4));
    if (!label) continue;
    await select.selectOption({ label });
    return await select.inputValue();
  }
  const diagnostics: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const optionLabels = await selects.nth(index).locator("option").allTextContents();
    diagnostics.push(`[select-${index}] ${optionLabels.join(" | ")}`);
  }
  throw new Error(`Could not find payout bank account option with last4 ${last4}. ${diagnostics.join(" ; ")}`);
}

async function runWithDialogs(
  page: Page,
  action: () => Promise<unknown>,
  steps: Array<{ type: "confirm" | "prompt"; value?: string }>,
) {
  let pendingDialog = page.waitForEvent("dialog");
  const pendingAction = action();
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const dialog = await pendingDialog;
    expect(dialog.type()).toBe(step.type);
    if (index < steps.length - 1) {
      pendingDialog = page.waitForEvent("dialog");
    }
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
  const api = await request.newContext({ baseURL: E2E_BASE_URL });
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
    const base = {
      ...user,
      verifiedPhone: String(user.id) === sellerId ? "+972500000003" : "+972500000000",
      phoneVerifiedAt: new Date().toISOString(),
      availabilityStatus: "available",
      onlineStatus: "online",
      lastActiveAt: new Date().toISOString(),
    };
    if (String(user.id) === sellerId) {
      return {
        ...base,
        sellerBankAccounts: [],
      };
    }
    return {
      ...base,
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
  return JSON.parse(response.text) as { request?: PurchasePayload };
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
  const sellerAccounts = await ensureSellerBankAccounts(request, 1);
  const selectedAccount = sellerAccounts[0];
  if (!selectedAccount) throw new Error("Seller bank account provisioning failed for fixture listing creation.");
  const response = await request.post("/api/alpha-exchange/listings", {
    data: {
      availableAmount: input.availableAmount,
      price: input.price,
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankAccountId: selectedAccount.id,
      bankName: selectedAccount.bankName,
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
  const main = page.getByRole("main");
  await expect(main.locator("#create-listing")).toBeVisible({ timeout: 60_000 });
  await main.locator("#create-available").fill(expectedListing.availableAmount);
  await main.locator("#create-price").fill(expectedListing.price);
  await main.locator("#create-min-trade").fill("50");
  await main.locator("#create-max-trade").fill(expectedListing.availableAmount);
  await page.getByRole("button", { name: /Bank Hapoalim/i }).click();
  const commissionCheckbox = page.getByRole("checkbox", { name: /1% commission policy/i });
  if (!(await commissionCheckbox.isChecked())) {
    await commissionCheckbox.check();
  }
  const sellerAccounts = await readSellerBankAccounts(page.request);
  expect(sellerAccounts.length).toBeGreaterThan(0);
  await chooseCreatePayoutBankAccountByLast4(page, sellerAccounts[0].accountLast4);
  await expect(submitButton).toBeEnabled({ timeout: 60_000 });
  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/alpha-exchange/listings",
      { timeout: 120_000 },
    ),
    submitButton.click(),
  ]);

  expect([200, 201]).toContain(createResponse.status());

  const payload = (await createResponse.json()) as { listing?: { id: string; status: string; approvalStatus?: string; availableAmount?: string; price?: string }; destination?: string };
  if (!payload.listing?.id) {
    throw new Error("Listing create response did not include a listing id.");
  }
  await expect(page.getByRole("heading", { name: "My Listings" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#listing-publish-result")).toContainText("awaiting Alpha Traders admin approval", { timeout: 30_000 });
  await expect(page).toHaveURL(/#listing-publish-result$/);
  await expect(page.locator(`[id="seller-listing-${payload.listing.id}"]`)).toContainText("not visible to buyers yet");
  await expect(page.locator(`[id="listing-${payload.listing.id}"]`)).toHaveCount(0);
  expect(payload.listing).toMatchObject({ status: "draft", approvalStatus: "pending" });
  expect(payload.destination).toBe(`/usdt-exchange#seller-listing-${payload.listing.id}`);
  return { listing: payload.listing };
}

async function getDbNotificationsForEmail(email: string) {
  const api = await request.newContext({ baseURL: E2E_BASE_URL });
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
      inactivityWarningSentAt?: string;
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

test("bank-transfer listing requires selected seller bank account and preserves privacy in public listings", async ({ browser }) => {
  test.setTimeout(240_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);
  await seller.page.goto("/en/usdt-exchange");
  const sellerMain = seller.page.getByRole("main");
  await expect(sellerMain.locator("#create-listing")).toBeVisible({ timeout: 60_000 });

  await sellerMain.locator("#create-available").fill("1000");
  await sellerMain.locator("#create-price").fill("3.20");
  await sellerMain.locator("#create-min-trade").fill("50");
  await sellerMain.locator("#create-max-trade").fill("1000");
  await seller.page.getByRole("button", { name: /Bank Hapoalim/i }).click();
  const commissionCheckbox = seller.page.getByRole("checkbox", { name: /1% commission policy/i });
  if (!(await commissionCheckbox.isChecked())) {
    await commissionCheckbox.check();
  }

  await expect(seller.page.getByText(/No saved bank accounts found/i)).toBeVisible({ timeout: 20_000 });
  await expect(seller.page.getByRole("button", { name: "Submit Listing" })).toBeDisabled();
  await sellerMain.locator("#create-listing").getByRole("link", { name: "Settings" }).click();
  await expect(seller.page).toHaveURL(/\/en\/settings/);
  await seller.page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(seller.page.locator("#seller-bank-accounts")).toBeVisible({ timeout: 20_000 });
  await seller.page.goBack();
  await expect(sellerMain.locator("#create-listing")).toBeVisible({ timeout: 60_000 });

  const oneBank = await ensureSellerBankAccounts(seller.page.request, 1);
  expect(oneBank).toHaveLength(1);
  await seller.page.reload();
  await expect(sellerMain.locator("#create-listing")).toBeVisible({ timeout: 60_000 });
  await sellerMain.locator("#create-available").fill("1000");
  await sellerMain.locator("#create-price").fill("3.20");
  await sellerMain.locator("#create-min-trade").fill("50");
  await sellerMain.locator("#create-max-trade").fill("1000");
  await seller.page.getByRole("button", { name: /Bank Hapoalim/i }).click();
  if (!(await commissionCheckbox.isChecked())) {
    await commissionCheckbox.check();
  }

  const selectedSingleAccountId = await chooseCreatePayoutBankAccountByLast4(seller.page, oneBank[0].accountLast4);
  let capturedSingleBankAccountId: string | undefined;
  const [singleCreateResponse] = await Promise.all([
    seller.page.waitForResponse((response) => {
      if (response.request().method() !== "POST") return false;
      return new URL(response.url()).pathname === "/api/alpha-exchange/listings";
    }, { timeout: 120_000 }),
    seller.page.getByRole("button", { name: "Submit Listing" }).click(),
  ]);
  const singleCreateRequestPayload = singleCreateResponse.request().postDataJSON() as { bankAccountId?: string };
  capturedSingleBankAccountId = singleCreateRequestPayload.bankAccountId;
  expect(capturedSingleBankAccountId).toBe(selectedSingleAccountId);
  expect([200, 201]).toContain(singleCreateResponse.status());

  const singlePayload = (await singleCreateResponse.json()) as { listing?: { id: string } };
  expect(singlePayload.listing?.id).toBeTruthy();

  const twoBanks = await ensureSellerBankAccounts(seller.page.request, 2);
  expect(twoBanks).toHaveLength(2);
  const secondBank = twoBanks[1];
  expect(secondBank).toBeDefined();

  await seller.page.reload();
  await expect(sellerMain.locator("#create-listing")).toBeVisible({ timeout: 60_000 });
  await sellerMain.locator("#create-available").fill("500");
  await sellerMain.locator("#create-price").fill("3.18");
  await sellerMain.locator("#create-min-trade").fill("50");
  await sellerMain.locator("#create-max-trade").fill("500");
  await seller.page.getByRole("button", { name: /Bank Hapoalim/i }).click();
  await seller.page.getByRole("button", { name: /Bank Leumi/i }).click();
  if (!(await commissionCheckbox.isChecked())) {
    await commissionCheckbox.check();
  }

  const selectedSecondAccountId = await chooseCreatePayoutBankAccountByLast4(seller.page, secondBank.accountLast4);
  const [dualCreateResponse] = await Promise.all([
    seller.page.waitForResponse((response) => {
      if (response.request().method() !== "POST") return false;
      return new URL(response.url()).pathname === "/api/alpha-exchange/listings";
    }, { timeout: 120_000 }),
    seller.page.getByRole("button", { name: "Submit Listing" }).click(),
  ]);
  expect([200, 201]).toContain(dualCreateResponse.status());
  const dualCreateRequestPayload = dualCreateResponse.request().postDataJSON() as { bankAccountId?: string };
  expect(dualCreateRequestPayload.bankAccountId).toBe(selectedSecondAccountId);

  const dualPayload = (await dualCreateResponse.json()) as { listing?: { id: string } };
  expect(dualPayload.listing?.id).toBeTruthy();

  const owner = await createSession(browser, OWNER_EMAIL, OWNER_PASSWORD);
  const approvalResponse = await owner.page.request.patch(`/api/alpha-exchange/admin/listings/${dualPayload.listing!.id}`, {
    data: { action: "approve" },
  });
  expect(approvalResponse.ok(), `Owner approval failed: ${await approvalResponse.text()}`).toBeTruthy();

  const publicListingsResponse = await seller.page.request.get("/api/alpha-exchange/listings");
  expect(publicListingsResponse.ok()).toBeTruthy();
  const publicListingsPayload = (await publicListingsResponse.json()) as {
    listings: Array<Record<string, unknown>>;
  };
  const privacyTarget = publicListingsPayload.listings.find((listing) => String(listing.id ?? "") === String(dualPayload.listing?.id ?? ""));
  expect(privacyTarget).toBeDefined();
  expect(privacyTarget).not.toHaveProperty("accountNumber");
  expect(privacyTarget).not.toHaveProperty("branchNumber");
  expect(privacyTarget).not.toHaveProperty("bankAccountId");

  await owner.context.close();
  await seller.context.close();
});

test("seller dashboard consolidates recent work, exact commission actions, and listing management", async ({ browser }) => {
  test.setTimeout(180_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);
  const suffix = Date.now().toString(36);
  const listingId = `dashboard-listing-latest-${suffix}`;
  const middleListingId = `dashboard-listing-middle-${suffix}`;
  const oldestListingId = `dashboard-listing-oldest-${suffix}`;
  const latestRequestId = `dashboard-request-latest-${suffix}`;
  const middleRequestId = `dashboard-request-middle-${suffix}`;
  const oldestRequestId = `dashboard-request-oldest-${suffix}`;

  await updateRuntimeDb(seller.page.request, (db) => {
    const users = toRecords(db.users);
    const sellerUser = users.find((user) => String(user.email ?? "").toLowerCase() === SELLER_EMAIL);
    const buyerUser = users.find((user) => String(user.email ?? "").toLowerCase() === BUYER_EMAIL);
    if (!sellerUser?.id || !buyerUser?.id) throw new Error("Dashboard test users were not found in the seeded runtime.");

    const sellerId = String(sellerUser.id);
    const buyerId = String(buyerUser.id);
    const createdAt = "2030-01-01T00:00:00.000Z";
    const addListing = (id: string, displayNumber: number, updatedAt: string) => {
      db.marketplaceListings.push({
        id,
        displayNumber,
        sellerId,
        sellerDisplayName: "Dashboard Seller",
        photos: [],
        originalAmount: "500",
        availableAmount: "500",
        price: "3.2",
        currency: "ILS",
        network: "TRC20",
        paymentMethod: "Bank Transfer",
        paymentMethods: ["Bank Transfer"],
        minimumTrade: "50",
        maximumTrade: "500",
        expiresAt: "2031-01-01T00:00:00.000Z",
        sellerDescription: "Dashboard regression listing",
        responseTime: "5 min",
        status: "draft",
        approvalStatus: "pending",
        createdAt,
        updatedAt,
      });
    };
    const addRequest = (id: string, displayNumber: number, updatedAt: string, status: "pending" | "accepted" | "declined") => {
      db.purchaseRequests.push({
        id,
        tradeId: `trade-${id}`,
        displayNumber,
        listingId,
        sellerId,
        buyerId,
        buyerName: "Dashboard Buyer",
        usdtAmount: "100",
        fiatAmount: "320",
        currency: "ILS",
        network: "TRC20",
        paymentMethod: "Bank Transfer",
        timeline: [],
        status,
        createdAt,
        updatedAt,
      });
    };

    addListing(oldestListingId, 9301, "2030-01-05T00:00:00.000Z");
    addListing(listingId, 9303, "2030-01-07T00:00:00.000Z");
    addListing(middleListingId, 9302, "2030-01-06T00:00:00.000Z");
    addRequest(oldestRequestId, 9201, "2030-01-02T00:00:00.000Z", "declined");
    addRequest(middleRequestId, 9202, "2030-01-03T00:00:00.000Z", "accepted");
    addRequest(latestRequestId, 9203, "2030-01-04T00:00:00.000Z", "pending");
    db.commissionRecords.push(
      {
        id: `dashboard-commission-a-${suffix}`,
        purchaseRequestId: oldestRequestId,
        listingId,
        sellerId,
        buyerId,
        rate: 0.01,
        grossAmount: 200,
        commissionAmount: 2,
        paymentStatus: "pending",
        dueAt: "2030-02-01T00:00:00.000Z",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: `dashboard-commission-b-${suffix}`,
        purchaseRequestId: middleRequestId,
        listingId,
        sellerId,
        buyerId,
        rate: 0.01,
        grossAmount: 300,
        commissionAmount: 3,
        paymentStatus: "pending",
        dueAt: "2030-02-02T00:00:00.000Z",
        createdAt,
        updatedAt: createdAt,
      },
    );
    db.notifications.push({
      id: `dashboard-notification-${suffix}`,
      userId: sellerId,
      category: "listing",
      title: "Dashboard notification",
      message: "Unread dashboard notification",
      isRead: false,
      state: "unread",
      createdAt,
      updatedAt: createdAt,
    });
  });

  await seller.page.goto("/en/dashboard/seller");
  const main = seller.page.getByRole("main");
  await expect(main.getByText("Workspace Summary").first()).toBeVisible({ timeout: 60_000 });
  await expect(main.getByText("Quick Actions", { exact: true })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /^My Listings:/ })).toContainText("3");
  await expect(main.getByRole("button", { name: /^Purchase Requests:/ })).toContainText("3");
  await expect(main.getByRole("button", { name: /^Notifications:/ })).toContainText("1");

  const latestToggle = main.locator(`#trade-${latestRequestId} > button`);
  const middleToggle = main.locator(`#trade-${middleRequestId} > button`);
  await expect(latestToggle).toBeVisible();
  await expect(latestToggle).toHaveAttribute("aria-expanded", "true");
  await expect(middleToggle).toHaveAttribute("aria-expanded", "false");
  await middleToggle.click();
  await expect(latestToggle).toHaveAttribute("aria-expanded", "false");
  await expect(middleToggle).toHaveAttribute("aria-expanded", "true");
  const requestsSection = main.locator("#purchase-requests-section");
  await expect(requestsSection.getByRole("button", { name: /^View All \(/ })).toBeVisible();
  await requestsSection.getByRole("button", { name: /^View All \(/ }).click();
  await expect(main.locator(`#trade-${oldestRequestId}`)).toBeVisible();

  const listingsSection = main.locator("#my-listings-section");
  await expect(listingsSection.getByRole("heading", { name: "My Listings" })).toBeVisible();
  await expect(listingsSection.getByRole("button", { name: "Manage Listings" })).toBeVisible();
  const compactListings = listingsSection.locator('[data-dashboard-compact-listing="true"]');
  await expect(compactListings).toHaveCount(2);
  await expect(compactListings.first()).toHaveAttribute("data-listing-id", listingId);
  await expect(compactListings.nth(1)).toHaveAttribute("data-listing-id", middleListingId);
  const latestListingToggle = compactListings.first().locator("> button");
  const middleListingToggle = compactListings.nth(1).locator("> button");
  await expect(latestListingToggle).toHaveAttribute("aria-expanded", "true");
  await expect(middleListingToggle).toHaveAttribute("aria-expanded", "false");
  await expect(compactListings.nth(1).getByRole("button", { name: "Edit" })).toHaveCount(0);
  await middleListingToggle.click();
  await expect(latestListingToggle).toHaveAttribute("aria-expanded", "false");
  await expect(middleListingToggle).toHaveAttribute("aria-expanded", "true");
  await listingsSection.getByRole("button", { name: "Manage Listings" }).click();
  await expect(listingsSection.locator(`[data-listing-id="${oldestListingId}"]`)).toBeVisible();

  const sectionOrder = await seller.page.evaluate(() => {
    const requests = document.getElementById("purchase-requests-section");
    const listings = document.getElementById("my-listings-section");
    return {
      requestsTop: requests?.getBoundingClientRect().top ?? Number.NaN,
      listingsTop: listings?.getBoundingClientRect().top ?? Number.NaN,
    };
  });
  expect(sectionOrder.requestsTop).toBeLessThan(sectionOrder.listingsTop);

  const commissionStatus = main.locator("#commission-status");
  await expect(commissionStatus).toContainText("Choose one unpaid commission to pay.");
  await expect(commissionStatus.getByRole("button", { name: /Trade #9201/ })).toHaveCount(1);
  await expect(commissionStatus.getByRole("button", { name: /Trade #9202/ })).toHaveCount(1);
  await expect(main.getByRole("button", { name: /^Commission Due:/ })).toContainText("2");

  await updateRuntimeDb(seller.page.request, (db) => {
    for (const record of db.commissionRecords) {
      if (record.id.startsWith("dashboard-commission-")) {
        record.paymentStatus = "paid";
        record.paidAt = "2030-02-03T00:00:00.000Z";
        record.updatedAt = record.paidAt;
      }
    }
  });
  await seller.page.reload({ waitUntil: "domcontentloaded" });
  await expect(main.getByRole("button", { name: /^Commission Due:/ })).toHaveCount(0);
  await expect(main.locator("#commission-status")).toContainText("No commission due");

  await seller.context.close();
});

test("owner listing notification destination survives login, refresh, and history navigation", async ({ browser }) => {
  test.setTimeout(240_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);
  const created = await createListing(seller.page.request, { availableAmount: "750", price: "3.21" });
  const listingId = created.listing.id;
  const destination = `/en/admin/alpha-exchange?section=marketplace-listings&listing=${encodeURIComponent(listingId)}`;

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(destination);
  await expect(ownerPage).toHaveURL(/\/en\/login(?:\?|$)/, { timeout: 30_000 });
  const loginUrl = new URL(ownerPage.url());
  expect(loginUrl.searchParams.get("redirectTo")).toBe(destination);

  await ownerPage.getByLabel("Email").fill(OWNER_EMAIL);
  await ownerPage.getByLabel("Password").fill(OWNER_PASSWORD);
  await Promise.all([
    ownerPage.waitForURL(destination, { timeout: 30_000 }),
    ownerPage.getByRole("button", { name: "Login", exact: true }).click(),
  ]);

  const listingRow = ownerPage.locator(`#marketplace-listing-${listingId}`);
  await expect(listingRow).toBeVisible({ timeout: 30_000 });
  await expect(listingRow).toBeFocused({ timeout: 30_000 });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
    await ownerPage.setViewportSize(viewport);
    await expect(listingRow).toBeVisible();
    await expect(listingRow).toHaveClass(/outline/);
    const overflow = await ownerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
  }

  await ownerPage.goto("/en/admin/alpha-exchange?section=overview");
  await ownerPage.goBack();
  await expect(ownerPage).toHaveURL(destination);
  await expect(listingRow).toBeFocused({ timeout: 30_000 });
  await ownerPage.goForward();
  await expect(ownerPage).toHaveURL(/section=overview/);

  await Promise.all([seller.context.close(), ownerContext.close()]);
});

test("seller listing lifecycle is enforced end-to-end", async ({ browser }) => {
  test.setTimeout(600_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);
  await ensureSellerBankAccounts(seller.page.request, 1);
  await seller.page.goto("/en/usdt-exchange");
  const sellerMain = seller.page.getByRole("main");
  await expect(seller.page.getByRole("button", { name: "Submit Listing" })).toBeVisible({ timeout: 60_000 });
  const firstListingCreate = await submitListingFromSellerWorkspace(seller.page, { availableAmount: "1000", price: "3.20" });
  expect(firstListingCreate.listing?.id).toBeTruthy();

  const firstListingResult = seller.page.locator("#listing-publish-result");
  const firstSellerListing = seller.page.locator(`[id="seller-listing-${firstListingCreate.listing!.id}"]`);
  for (const width of [320, 360, 375, 390, 430]) {
    await seller.page.setViewportSize({ width, height: 844 });
    await firstListingResult.scrollIntoViewIfNeeded();
    await expect(firstListingResult).toBeVisible();
    await expect(firstSellerListing).toBeVisible();
    const overflow = await seller.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
  for (const width of [1366, 1920]) {
    await seller.page.setViewportSize({ width, height: 900 });
    await firstListingResult.scrollIntoViewIfNeeded();
    await expect(firstListingResult).toBeVisible();
    await expect(firstSellerListing).toBeVisible();
    const overflow = await seller.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }

  const secondListingCreate = await submitListingFromSellerWorkspace(seller.page, { availableAmount: "500", price: "3.18" });
  expect(secondListingCreate.listing?.id).toBeTruthy();
  await expect(seller.page.getByText("You already have 2 open listings, including listings awaiting review. Close one before creating another.").first()).toBeVisible({ timeout: 30_000 });

  await sellerMain.locator("#create-available").fill("250");
  await sellerMain.locator("#create-price").fill("3.10");
  await sellerMain.locator("#create-min-trade").fill("25");
  await sellerMain.locator("#create-max-trade").fill("250");
  await expect(seller.page.getByRole("button", { name: "Submit Listing" })).toBeDisabled();
  await expect(seller.page.getByText("You already have 2 open listings, including listings awaiting review. Close one before creating another.").first()).toBeVisible({ timeout: 10_000 });

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
  if (!seller.page.url().includes(`/trade-room/${firstRequest.purchase.id}`)) {
    await seller.page.goto(`/en/trade-room/${firstRequest.purchase.id}`);
  }
  await expect(seller.page).toHaveURL(new RegExp(`/trade-room/${firstRequest.purchase.id}(?:[?#].*)?$`), { timeout: 10_000 });

  response = await seller.page.request.patch(`/api/alpha-exchange/listings/${primaryListing.id}`, {
    data: {
      price: "3.30",
      changeReason: "Price updated",
      changeExplanation: "Lifecycle lock validation",
    },
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
  expect(firstTrade.buyerEvidence?.fileName).toBe("buyer-payment-evidence.png");

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

  const sellerEvidenceResponse = await uploadEvidence(seller.page, firstRequest.purchase.id, "seller");
  firstTrade = sellerEvidenceResponse.request as PurchasePayload;
  expect(firstTrade.status).toBe("usdt_sent");
  expect(firstTrade.sellerEvidence?.fileName).toBe("seller-release-evidence.png");

  response = await buyer.page.request.patch(`/api/alpha-exchange/purchase-requests/${firstRequest.purchase.id}`, { data: { status: "completed" } });
  expect(response.ok()).toBeTruthy();
  firstTrade = await readPurchaseFromPatchResponse(response);
  expect(firstTrade.status).toBe("review_open");
  expect(Boolean(firstTrade.completedAt)).toBeTruthy();

  await expect(seller.page).toHaveURL(new RegExp(`/usdt-exchange\\?trade=${firstRequest.purchase.id}#my-trade-requests-section$`), { timeout: 20_000 });
  await seller.page.reload();
  await expect(seller.page).toHaveURL(new RegExp(`/usdt-exchange\\?trade=${firstRequest.purchase.id}#my-trade-requests-section$`), { timeout: 20_000 });

  let adminPrep = await getAdminPrep(owner.page.request);
  let firstTradeAdmin = adminPrep.purchaseRequests.find((request) => request.id === firstRequest.purchase.id);
  expect(firstTradeAdmin?.status).toBe("review_open");
  expect(firstTradeAdmin?.buyerEvidence?.fileName).toBe("buyer-payment-evidence.png");
  expect(firstTradeAdmin?.sellerEvidence?.fileName).toBe("seller-release-evidence.png");
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
  // This scenario exercises a full lifecycle (expiration, renewal, vacation mode,
  // timeout transitions, admin/history verification) and routinely exceeds 180s
  // in single-worker E2E with repository fallback I/O. Allow enough headroom for
  // the full flow rather than failing on the default 300s ceiling.
  test.setTimeout(420_000);
  const hasFixtures = await resetLifecycleFixtures();
  test.skip(!hasFixtures, "Set E2E owner/seller credentials and seed matching runtime accounts to run lifecycle tests.");

  const seller = await createSession(browser, SELLER_EMAIL, SELLER_PASSWORD);
  const buyer = await createSession(browser, BUYER_EMAIL, BUYER_PASSWORD);

  const created = await createListing(seller.page.request, { availableAmount: "901", price: "3.20", minimumTrade: "100", maximumTrade: "901" });
  await updateRuntimeDb(seller.page.request, (db) => {
    const listings = toRecords(db.marketplaceListings);
    const listing = listings.find((item) => String(item.id) === created.listing.id);
    if (!listing) throw new Error("Listing fixture not found.");
    const expiredAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    listing.expiresAt = expiredAt;
    listing.status = "active";
    listing.updatedAt = expiredAt;
  });
  await waitForPersistence();
  await readRuntimeDb(seller.page.request);

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

  let runtimeDb = await readRuntimeDb(seller.page.request);
  expect(toRecords(runtimeDb.notifications).some((item) => String(item.title ?? "") === "Listing expired" && String(item.relatedListingId ?? "") === created.listing.id)).toBeTruthy();
  expect(toRecords(runtimeDb.auditLogs).some((item) => String(item.action ?? "") === "listing_expired" && String(item.listingId ?? "") === created.listing.id)).toBeTruthy();
  expect(toRecords(runtimeDb.auditLogs).some((item) => String(item.action ?? "") === "listing_renewed" && String(item.listingId ?? "") === created.listing.id)).toBeTruthy();

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

  runtimeDb = await readRuntimeDb(seller.page.request);
  expect(toRecords(runtimeDb.notifications).some((item) => String(item.title ?? "") === "Seller entered Vacation Mode")).toBeTruthy();
  expect(toRecords(runtimeDb.auditLogs).some((item) => String(item.action ?? "") === "seller_vacation_enabled")).toBeTruthy();

  response = await seller.page.request.patch("/api/alpha-exchange/seller-settings", { data: { availabilityStatus: "available" } });
  await expectOkWithBody(response, "Disable seller vacation mode");
  response = await seller.page.request.get("/api/alpha-exchange/listings");
  expect(response.ok()).toBeTruthy();
  const visibleListings = (await response.json()) as { listings: Array<{ id: string }> };
  expect(visibleListings.listings.some((listing) => listing.id === created.listing.id)).toBeTruthy();
  const sellerNotificationsAfterAvailable = await getDbNotificationsForEmail(SELLER_EMAIL);
  expect(sellerNotificationsAfterAvailable.some((item) => item.title === "Vacation disabled")).toBeTruthy();

  const timedRequest = await createRequest(buyer.page.request, created.listing.id, "100");
  response = await seller.page.request.patch(`/api/alpha-exchange/purchase-requests/${timedRequest.purchase.id}`, { data: { status: "accepted" } });
  expect(response.ok()).toBeTruthy();
  await updateRuntimeDb(seller.page.request, (db) => {
    const requests = toRecords(db.purchaseRequests);
    const request = requests.find((item) => String(item.id) === timedRequest.purchase.id);
    if (!request) throw new Error("Timed request fixture missing.");
    const staleAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    request.tradeCreatedAt = staleAt;
    request.updatedAt = staleAt;
  });
  await waitForPersistence();

  const sellerNotificationsAfterTimeout = await getDbNotificationsForEmail(SELLER_EMAIL);
  const buyerNotificationsAfterTimeout = await getDbNotificationsForEmail(BUYER_EMAIL);
  expect(sellerNotificationsAfterTimeout.some((item) => item.title === "Buyer inactivity warning sent")).toBeTruthy();
  expect(buyerNotificationsAfterTimeout.some((item) => item.title === "Action required on your trade")).toBeTruthy();

  await Promise.all([seller.context.close(), buyer.context.close()]);
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
