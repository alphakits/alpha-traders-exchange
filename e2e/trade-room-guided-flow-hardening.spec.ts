import { test, expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { E2E_BASE_URL } from "./support/base-url";

const scrypt = promisify(scryptCallback);
const SUPPORT_HEADERS = {
  "content-type": "application/json",
  "x-alpha-test-support": "enabled",
};
const BUYER_WALLET = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const TEST_FILE_BUFFER = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAsMB9JfJ8b4AAAAASUVORK5CYII=", "base64");

const sellerPassword = `GhSeller!${randomBytes(14).toString("base64url")}`;
const buyerPassword = `GhBuyer!${randomBytes(14).toString("base64url")}`;

const ids = {
  seller: `gh-seller-${randomUUID()}`,
  buyer: `gh-buyer-${randomUUID()}`,
  listing: `gh-listing-${randomUUID()}`,
};

const sellerEmail = `${ids.seller}@example.test`;
const buyerEmail = `${ids.buyer}@example.test`;
const trackedIds = new Set<string>(Object.values(ids));

const iso = (deltaMs = 0) => new Date(Date.now() + deltaMs).toISOString();

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function readDb(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers: SUPPORT_HEADERS });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Record<string, unknown>;
}

async function writeDb(api: APIRequestContext, db: Record<string, unknown>) {
  const response = await api.put("/api/testing/alpha-exchange-state", { headers: SUPPORT_HEADERS, data: db });
  expect(response.ok()).toBeTruthy();
}

function referencesTrackedIds(value: unknown, idSet: Set<string>): boolean {
  if (typeof value === "string") return idSet.has(value);
  if (Array.isArray(value)) return value.some((entry) => referencesTrackedIds(entry, idSet));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => referencesTrackedIds(entry, idSet));
  }
  return false;
}

function makeSellerUser(passwordHash: string) {
  const now = iso();
  return {
    id: ids.seller,
    fullName: "Guided Flow Seller",
    email: sellerEmail,
    passwordHash,
    whatsappNumber: "+972500000100",
    role: "approved_seller",
    roles: ["approved_seller"],
    sellerStatus: "approved_seller",
    availabilityStatus: "available",
    onlineStatus: "online",
    preferredNetworks: ["TRC20"],
    preferredPaymentMethods: ["Face-to-Face (Meet in Person)"],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "Guided flow seller",
    country: "Israel",
    createdAt: now,
    updatedAt: now,
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: "+972500000100",
    phoneVerifiedAt: now,
    isProfileHidden: false,
    sellerPrestigeRank: "bronze",
  };
}

function makeBuyerUser(passwordHash: string) {
  const now = iso();
  return {
    id: ids.buyer,
    fullName: "Guided Flow Buyer",
    email: buyerEmail,
    passwordHash,
    whatsappNumber: "+972500000101",
    role: "buyer",
    roles: ["buyer"],
    sellerStatus: "buyer",
    availabilityStatus: "available",
    onlineStatus: "online",
    preferredNetworks: [],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    country: "Israel",
    createdAt: now,
    updatedAt: now,
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: "+972500000101",
    phoneVerifiedAt: now,
    buyerVerificationStatus: "verified",
    buyerFirstName: "Guided",
    buyerLastName: "Buyer",
    buyerDisplayName: "Guided Buyer",
    onboardingSelection: "buyer",
    onboardingCompletedAt: now,
  };
}

function makeListing() {
  const now = iso();
  return {
    id: ids.listing,
    sellerId: ids.seller,
    sellerDisplayName: "Guided Flow Seller",
    photos: [],
    originalAmount: "1500",
    availableAmount: "1500",
    price: "3.60",
    currency: "ILS",
    network: "TRC20",
    paymentMethods: ["Face-to-Face (Meet in Person)"],
    paymentMethod: "Face-to-Face (Meet in Person)",
    minimumTrade: "50",
    maximumTrade: "1500",
    expiresAt: iso(24 * 60 * 60 * 1000),
    notes: "",
    sellerDescription: "Guided flow listing",
    responseTime: "5 min",
    status: "active",
    approvalStatus: "approved",
    createdAt: now,
    updatedAt: now,
  };
}

async function provisionState(api: APIRequestContext) {
  const db = await readDb(api);
  const sellerHash = await hashPassword(sellerPassword);
  const buyerHash = await hashPassword(buyerPassword);

  db.users = [
    ...(Array.isArray(db.users) ? db.users : []),
    makeSellerUser(sellerHash),
    makeBuyerUser(buyerHash),
  ];

  db.marketplaceListings = [
    ...(Array.isArray(db.marketplaceListings) ? db.marketplaceListings : []),
    makeListing(),
  ];

  await writeDb(api, db);
}

async function cleanupState(api: APIRequestContext) {
  const db = await readDb(api);
  const idSet = new Set(trackedIds);
  idSet.add(sellerEmail);
  idSet.add(buyerEmail);

  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const value of Object.values(db)) {
      if (!Array.isArray(value)) continue;
      for (const row of value) {
        if (!row || typeof row !== "object") continue;
        if (!referencesTrackedIds(row, idSet)) continue;
        const rowId = (row as { id?: unknown }).id;
        if (typeof rowId === "string" && !idSet.has(rowId)) {
          idSet.add(rowId);
          expanded = true;
        }
      }
    }
  }

  for (const [key, value] of Object.entries(db)) {
    if (!Array.isArray(value)) continue;
    db[key] = value.filter((row) => !referencesTrackedIds(row, idSet));
  }

  await writeDb(api, db);
}

async function login(request: APIRequestContext, email: string, password: string) {
  const response = await request.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.20" },
    data: { email, password, rememberMe: true },
  });
  expect(response.ok(), `login failed for ${email}`).toBeTruthy();
}

async function logout(request: APIRequestContext) {
  await request.post("/api/auth/logout").catch(() => {});
}

function purchaseRequestPayload(usdtAmount = "300") {
  return {
    listingId: ids.listing,
    usdtAmount,
    buyerName: "Guided Buyer",
    buyerWhatsapp: "+972500000101",
    buyerNotes: "Guided hardening flow",
    buyerReceivingWalletAddress: BUYER_WALLET,
    safetyAcknowledged: true,
  };
}

async function createTradeRequest(request: APIRequestContext, usdtAmount = "300") {
  const response = await request.post("/api/alpha-exchange/purchase-requests", {
    data: purchaseRequestPayload(usdtAmount),
  });
  if (!response.ok()) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(
      `createTradeRequest failed with HTTP ${response.status()}: ${responseBody || "empty response body"}`,
    );
  }
  const payload = (await response.json()) as { purchase?: { id?: string } };
  const requestId = payload.purchase?.id;
  expect(requestId).toBeTruthy();
  if (!requestId) throw new Error("request id missing");
  trackedIds.add(requestId);
  return requestId;
}

async function seedActiveTradeWithPendingCommission(api: APIRequestContext) {
  const db = await readDb(api);
  // Keep the commission due on a separate completed trade. The Trade Room
  // deliberately redirects a seller away from a completed request; using a
  // still-active request here exercises the Pay Now action without racing that
  // established lifecycle redirect.
  const completedRequestId = `commission-completed-trade-${randomUUID()}`;
  const activeRequestId = `commission-active-trade-${randomUUID()}`;
  const commissionId = `commission-${randomUUID()}`;
  trackedIds.add(completedRequestId);
  trackedIds.add(activeRequestId);
  trackedIds.add(commissionId);
  const now = iso();

  db.purchaseRequests = [
    ...(Array.isArray(db.purchaseRequests) ? db.purchaseRequests : []),
    {
      id: completedRequestId,
      tradeId: `trade-${completedRequestId}`,
      listingId: ids.listing,
      sellerId: ids.seller,
      buyerId: ids.buyer,
      buyerName: "Guided Buyer",
      buyerWhatsapp: "+972500000101",
      buyerNotes: "Completed trade with a commission due",
      usdtAmount: "300",
      fiatAmount: "1080",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Face-to-Face (Meet in Person)",
      timeline: [],
      status: "review_open",
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: activeRequestId,
      tradeId: `trade-${activeRequestId}`,
      listingId: ids.listing,
      sellerId: ids.seller,
      buyerId: ids.buyer,
      buyerName: "Guided Buyer",
      buyerWhatsapp: "+972500000101",
      buyerNotes: "Active trade with an existing commission due",
      usdtAmount: "300",
      fiatAmount: "1080",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Face-to-Face (Meet in Person)",
      timeline: [],
      status: "accepted",
      acceptedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];
  db.commissionRecords = [
    ...(Array.isArray(db.commissionRecords) ? db.commissionRecords : []),
    {
      id: commissionId,
      purchaseRequestId: completedRequestId,
      tradeId: `trade-${completedRequestId}`,
      listingId: ids.listing,
      sellerId: ids.seller,
      buyerId: ids.buyer,
      rate: 0.01,
      grossAmount: 300,
      commissionAmount: 3,
      paymentStatus: "pending",
      createdAt: now,
      updatedAt: now,
    },
  ];

  await writeDb(api, db);
  return activeRequestId;
}

async function getUserIdByEmail(api: APIRequestContext, email: string) {
  const db = await readDb(api);
  const users = Array.isArray(db.users) ? db.users : [];
  const user = users.find((row) => {
    if (!row || typeof row !== "object") return false;
    const candidate = (row as { email?: unknown }).email;
    return typeof candidate === "string" && candidate.toLowerCase() === email.toLowerCase();
  }) as { id?: unknown } | undefined;
  expect(typeof user?.id).toBe("string");
  if (typeof user?.id !== "string") throw new Error(`User not found for ${email}`);
  return user.id;
}

async function waitForNotification(api: APIRequestContext, email: string, title: RegExp, requestId: string, timeoutMs = 20_000) {
  const userId = await getUserIdByEmail(api, email);
  const endAt = Date.now() + timeoutMs;

  while (Date.now() < endAt) {
    const db = await readDb(api);
    const notifications = Array.isArray(db.notifications) ? db.notifications : [];
    const match = notifications.find((row) => {
      if (!row || typeof row !== "object") return false;
      const item = row as { userId?: unknown; title?: unknown; relatedRequestId?: unknown; id?: unknown };
      if (item.userId !== userId) return false;
      if (item.relatedRequestId !== requestId) return false;
      return typeof item.title === "string" && title.test(item.title) && typeof item.id === "string";
    }) as { id: string; title: string } | undefined;
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${title} notification for ${email}`);
}

async function injectTradeNotification(api: APIRequestContext, email: string, title: string, requestId: string) {
  const userId = await getUserIdByEmail(api, email);
  const db = await readDb(api);
  const notifications = Array.isArray(db.notifications) ? db.notifications : [];
  const notificationId = `notif-guided-${randomUUID()}`;
  trackedIds.add(notificationId);
  notifications.unshift({
    id: notificationId,
    userId,
    category: "trade",
    title,
    message: "Action required for guided trade-room flow.",
    isRead: false,
    relatedRequestId: requestId,
    relatedListingId: ids.listing,
    relatedHref: `/trade-room/${requestId}`,
    actionHref: `/trade-room/${requestId}`,
    createdAt: iso(),
    updatedAt: iso(),
    state: "unread",
  });
  db.notifications = notifications;
  await writeDb(api, db);
}

async function openNotificationAndNavigate(input: {
  page: Page;
  title: RegExp;
  requestId: string;
  expectedAction: string;
  expectedHash: "action-required" | "evidence" | "status-banner";
  viewport: { width: number; height: number };
  useNotificationUi?: boolean;
}) {
  const { page, title, requestId, expectedAction, expectedHash, viewport, useNotificationUi = true } = input;

  await page.setViewportSize(viewport);
  let destinationRegex = new RegExp(`/(?:ar|en)/trade-room/${requestId}\\?action=${expectedAction}`);

  if (useNotificationUi) {
    await page.goto("/en/usdt-exchange");
    const bellToggle = page.locator('button[aria-label="Notifications"]').first();
    const panel = page.getByTestId("notification-panel");
    const bodyOverflowBeforeOpen = await page.evaluate(() => getComputedStyle(document.body).overflow);

    const ensurePanelOpen = async () => {
      if (await panel.isVisible()) return;
      await bellToggle.click();
      await expect(panel).toBeVisible({ timeout: 20_000 });
    };

    await ensurePanelOpen();
    const panelGeometry = await page.getByTestId("notification-panel").evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      const list = panel.querySelector(".overflow-y-auto");
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
        bodyOverflow: getComputedStyle(document.body).overflow,
        listOverflowY: list ? getComputedStyle(list).overflowY : "",
      };
    });
    // The bell is a bounded, scrollable panel rather than a modal. It must not
    // mutate the document scroll state, which would shift the sticky header.
    expect(panelGeometry.bodyOverflow).toBe(bodyOverflowBeforeOpen);
    expect(panelGeometry.top).toBeGreaterThanOrEqual(0);
    expect(panelGeometry.bottom).toBeLessThanOrEqual(panelGeometry.viewportHeight);
    expect(panelGeometry.listOverflowY).toBe("auto");

    const actionLabelMatcher = /Continue Trade|Open Trade Room|Open/i;
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const titleElement = panel.locator("p.text-sm.font-medium.text-white, p.text-sm.font-medium.text-slate-100").filter({ hasText: title }).first();
    await expect(titleElement).toBeVisible({ timeout: 20_000 });
    const targetCard = titleElement.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]").first();
    await expect(targetCard).toBeVisible({ timeout: 20_000 });
    const actionButton = targetCard.locator("button:visible").filter({ hasText: actionLabelMatcher }).first();
    await expect(actionButton).toBeVisible({ timeout: 20_000 });
    await Promise.all([
      page.waitForURL(destinationRegex, { timeout: 10_000 }),
      actionButton.click(),
    ]);
    await expect(page).toHaveURL(destinationRegex, { timeout: 10_000 });
  } else {
    await page.goto(`/en/trade-room/${requestId}?action=${expectedAction}#${expectedHash}`);
  }

  const navPathnames: string[] = [];
  const navHandler = (frame: { url: () => string; parentFrame: () => unknown }) => {
    if (frame.parentFrame()) return;
    navPathnames.push(new URL(frame.url()).pathname);
  };
  page.on("framenavigated", navHandler);

  try {
    await expect(page).toHaveURL(destinationRegex);
    await expect(page).toHaveURL(new RegExp(`#${expectedHash}$`));

    const roomResponse = await page.request.get(`/api/alpha-exchange/trade-room/${requestId}`);
    expect(roomResponse.ok()).toBeTruthy();
    const roomPayload = (await roomResponse.json()) as { request?: { id?: string } };
    expect(roomPayload.request?.id).toBe(requestId);

    const disallowed = navPathnames.filter((pathname) => pathname.includes("/login") || pathname.includes("/dashboard"));
    expect(disallowed, `wrong-page flash while opening ${title}`).toEqual([]);

    const section = page.locator(`#${expectedHash}`);
    await expect(section).toBeVisible({ timeout: 20_000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);

    const sectionTop = await section.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top;
    });
    expect(sectionTop, "target section should not be hidden under sticky header").toBeGreaterThanOrEqual(0);
    expect(sectionTop, "target section should be near viewport top for direct focus").toBeLessThanOrEqual(180);

    const actionButton = page.getByRole("button", { name: localizedTradeActionMatcher(expectedAction) }).first();
    await expect(actionButton).toBeVisible({ timeout: 20_000 });
    await actionButton.scrollIntoViewIfNeeded();
    await expect(actionButton).toBeInViewport();

    const beforeReload = new URL(page.url());
    await page.reload({ waitUntil: "commit" });
    await expect(section).toBeVisible({ timeout: 20_000 });
    const afterReload = new URL(page.url());
    expect(afterReload.pathname).toBe(beforeReload.pathname);
    expect(afterReload.searchParams.get("action")).toBe(beforeReload.searchParams.get("action"));
    expect(afterReload.hash).toBe(beforeReload.hash);
  } finally {
    page.off("framenavigated", navHandler);
  }
}

function localizedTradeActionMatcher(expectedAction: string) {
  if (expectedAction === "upload-payment-receipt") return /Upload Payment Receipt|Submit Payment|إرسال الدفع|رفع إيصال الدفع/i;
  if (expectedAction === "upload-seller-evidence") return /Upload Seller Evidence|Release USDT|رفع إثبات البائع|إطلاق USDT/i;
  if (expectedAction === "accept-trade") return /Accept Trade|قبول الطلب/i;
  if (expectedAction === "confirm-money-received") return /Confirm Money Received|تأكيد استلام الأموال/i;
  if (expectedAction === "confirm-usdt-received") return /Confirm USDT Received|تأكيد استلام USDT/i;
  return /Submit Rating|إرسال التقييم/i;
}

async function uploadEvidenceInUi(page: Page, side: "buyer" | "seller") {
  const section = page.locator("#evidence");
  await expect(section).toBeVisible({ timeout: 20_000 });

  const card = side === "buyer"
    ? section.locator("div.rounded-xl.border.border-white\\/10.bg-black\\/25.p-3").first()
    : section.locator("div.rounded-xl.border.border-white\\/10.bg-black\\/25.p-3").nth(1);

  await card.locator("input[type='file']").setInputFiles({
    name: side === "buyer" ? "buyer-proof.png" : "seller-proof.png",
    mimeType: "image/png",
    buffer: TEST_FILE_BUFFER,
  });

  if (side === "buyer") {
    await page.getByRole("button", { name: localizedTradeActionMatcher("upload-payment-receipt") }).first().click();
  } else {
    await page.getByRole("button", { name: localizedTradeActionMatcher("upload-seller-evidence") }).first().click();
  }

  await expect(page.getByText(/Evidence Uploaded|Payment Submitted|USDT released|تم رفع الإثبات|تم إرسال الدفع|تم إصدار USDT/i).first()).toBeVisible({ timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
  await cleanupState(api);
  await provisionState(api);
  await api.dispose();
});

test.afterAll(async () => {
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
  await cleanupState(api);
  await api.dispose();
});

test("authenticated purchase creation is durable and duplicate-safe before UI navigation", async ({ request }) => {
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL });

  try {
    await logout(request);
    await login(request, buyerEmail, buyerPassword);
    const requestId = await createTradeRequest(request, "300");

    const roomResponse = await request.get(`/api/alpha-exchange/trade-room/${requestId}`);
    expect(roomResponse.status()).toBe(200);
    await expect(roomResponse.json()).resolves.toMatchObject({
      request: {
        id: requestId,
        listingId: ids.listing,
        buyerId: ids.buyer,
        sellerId: ids.seller,
        usdtAmount: "300",
        paymentMethod: "Face-to-Face (Meet in Person)",
        status: "pending",
      },
    });

    const duplicateResponse = await request.post("/api/alpha-exchange/purchase-requests", {
      data: purchaseRequestPayload("300"),
    });
    expect(duplicateResponse.status()).toBe(400);
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      code: "PURCHASE_REQUEST_ALREADY_SUBMITTED",
      details: { purchaseRequestId: requestId },
    });

    const db = await readDb(api);
    const requests = Array.isArray(db.purchaseRequests) ? db.purchaseRequests : [];
    const matchingRequests = requests.filter((row) => (
      row
      && typeof row === "object"
      && (row as { buyerId?: unknown }).buyerId === ids.buyer
      && (row as { listingId?: unknown }).listingId === ids.listing
    ));
    expect(matchingRequests).toHaveLength(1);

    const notifications = Array.isArray(db.notifications) ? db.notifications : [];
    const matchingSellerNotifications = notifications.filter((row) => (
      row
      && typeof row === "object"
      && (row as { userId?: unknown }).userId === ids.seller
      && (row as { relatedRequestId?: unknown }).relatedRequestId === requestId
      && (row as { title?: unknown }).title === "New trade request"
    ));
    expect(matchingSellerNotifications).toHaveLength(1);
  } finally {
    await api.dispose();
  }
});

test("mobile guided flow: notifications, payment/evidence, live updates, and security gate", async ({ page }) => {
  test.setTimeout(240_000);
  const viewport = { width: 390, height: 844 };
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL });

  await logout(page.request);
  await login(page.request, buyerEmail, buyerPassword);
  const requestId = await createTradeRequest(page.request, "320");

  await login(page.request, sellerEmail, sellerPassword);
  await waitForNotification(api, sellerEmail, /new trade request/i, requestId);
  const sellerOpenTitle = "E2E Guided Accept Step";
  await injectTradeNotification(api, sellerEmail, sellerOpenTitle, requestId);
  await openNotificationAndNavigate({
    page,
    title: new RegExp(`^${escapeRegex(sellerOpenTitle)}$`, "i"),
    requestId,
    expectedAction: "accept-trade",
    expectedHash: "action-required",
    viewport,
  });

  await page.getByRole("button", { name: localizedTradeActionMatcher("accept-trade") }).first().click();
  await expect(page.getByText(/Trade status updated|Trade Accepted|تم تحديث حالة الصفقة|تم قبول الطلب/i).first()).toBeVisible({ timeout: 20_000 });

  await login(page.request, buyerEmail, buyerPassword);
  await waitForNotification(api, buyerEmail, /trade request accepted/i, requestId);
  const buyerAcceptedTitle = "E2E Guided Upload Payment";
  await injectTradeNotification(api, buyerEmail, buyerAcceptedTitle, requestId);
  await openNotificationAndNavigate({
    page,
    title: new RegExp(`^${escapeRegex(buyerAcceptedTitle)}$`, "i"),
    requestId,
    expectedAction: "upload-payment-receipt",
    expectedHash: "evidence",
    viewport,
  });

  await uploadEvidenceInUi(page, "buyer");
  await expect(page.getByText(/Waiting for Seller to Confirm Payment|No action now|بانتظار البائع لتأكيد الدفع|لا يوجد إجراء الآن/i).first()).toBeVisible({ timeout: 20_000 });

  await login(page.request, sellerEmail, sellerPassword);
  await waitForNotification(api, sellerEmail, /buyer marked payment sent/i, requestId);
  const sellerConfirmTitle = "E2E Guided Confirm Money";
  await injectTradeNotification(api, sellerEmail, sellerConfirmTitle, requestId);

  const beforeConfirmResponse = await page.request.get(`/api/alpha-exchange/trade-room/${requestId}`);
  expect(beforeConfirmResponse.ok()).toBeTruthy();
  const beforeConfirmRoom = (await beforeConfirmResponse.json()) as { request?: { buyerReceivingWalletAddress?: string } };
  expect(beforeConfirmRoom.request?.buyerReceivingWalletAddress).toBeUndefined();

  await openNotificationAndNavigate({
    page,
    title: new RegExp(`^${escapeRegex(sellerConfirmTitle)}$`, "i"),
    requestId,
    expectedAction: "confirm-money-received",
    expectedHash: "action-required",
    viewport,
  });

  await expect(page.getByText(/Buyer Receiving Wallet/i)).toHaveCount(0);

  await page.getByRole("button", { name: /Confirm Money Received/i }).first().click();
  await expect(page.getByRole("button", { name: /Release USDT/i }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Buyer Receiving Wallet/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(BUYER_WALLET).first()).toBeVisible({ timeout: 20_000 });

  const afterConfirmResponse = await page.request.get(`/api/alpha-exchange/trade-room/${requestId}`);
  expect(afterConfirmResponse.ok()).toBeTruthy();
  const afterConfirmRoom = (await afterConfirmResponse.json()) as { request?: { buyerReceivingWalletAddress?: string } };
  expect(afterConfirmRoom.request?.buyerReceivingWalletAddress).toBe(BUYER_WALLET);

  await page.getByRole("button", { name: /Release USDT/i }).first().click();
  await expect(page.getByRole("button", { name: /Upload Seller Evidence/i }).first()).toBeVisible({ timeout: 20_000 });
  await uploadEvidenceInUi(page, "seller");
  await expect(page.getByText(/Waiting for Buyer to Confirm Receipt/i).first()).toBeVisible({ timeout: 20_000 });

  await login(page.request, buyerEmail, buyerPassword);
  await waitForNotification(api, buyerEmail, /seller marked usdt sent/i, requestId);
  const buyerConfirmTitle = "E2E Guided Confirm USDT";
  await injectTradeNotification(api, buyerEmail, buyerConfirmTitle, requestId);
  await openNotificationAndNavigate({
    page,
    title: new RegExp(`^${escapeRegex(buyerConfirmTitle)}$`, "i"),
    requestId,
    expectedAction: "confirm-usdt-received",
    expectedHash: "action-required",
    viewport,
  });

  await page.getByRole("button", { name: /Confirm USDT Received/i }).first().click();
  await expect(page.getByRole("button", { name: /Submit Rating|إرسال التقييم/i }).first()).toBeVisible({ timeout: 20_000 });

  await api.dispose();
});

test("trade-room Pay Now opens the canonical commission flow without an external generic-wallet destination", async ({ page }) => {
  test.setTimeout(120_000);
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
  const requestId = await seedActiveTradeWithPendingCommission(api);
  const popupUrls: string[] = [];
  const onPopup = (popup: Page) => popupUrls.push(popup.url());
  page.on("popup", onPopup);

  try {
    await logout(page.request);
    await login(page.request, sellerEmail, sellerPassword);
    await page.goto(`/en/trade-room/${requestId}`);
    await expect(page.getByText(/Commission Due/i).first()).toBeVisible({ timeout: 20_000 });

    await Promise.all([
      page.waitForURL(/\/en\/usdt-exchange/, { timeout: 20_000 }),
      page.getByRole("button", { name: "Pay Now" }).first().click(),
    ]);

    await expect(page).toHaveURL(/\/en\/usdt-exchange#commission-payment$/, { timeout: 20_000 });
    await expect(page.getByText("Commission Payment").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(100);
    expect(popupUrls).toEqual([]);
  } finally {
    page.off("popup", onPopup);
    await api.dispose();
  }
});

test("action transition matrix: destination query/hash + focused section + CTA across required states", async ({ page }) => {
  test.setTimeout(300_000);
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL });

  await logout(page.request);
  await login(page.request, buyerEmail, buyerPassword);
  const requestId = await createTradeRequest(page.request, "340");

  type MatrixCase = {
    label: string;
    status: "pending" | "accepted" | "payment_sent" | "funds_received" | "usdt_release_pending" | "usdt_sent" | "review_open";
    actor: "buyer" | "seller";
    expectedAction: string;
    expectedHash: "action-required" | "evidence" | "status-banner";
    viewport: { width: number; height: number };
  };

  const cases: MatrixCase[] = [
    { label: "pending seller", status: "pending", actor: "seller", expectedAction: "accept-trade", expectedHash: "action-required", viewport: { width: 1440, height: 900 } },
    { label: "accepted buyer", status: "accepted", actor: "buyer", expectedAction: "upload-payment-receipt", expectedHash: "evidence", viewport: { width: 1440, height: 900 } },
    { label: "payment_sent seller", status: "payment_sent", actor: "seller", expectedAction: "confirm-money-received", expectedHash: "action-required", viewport: { width: 1440, height: 900 } },
    { label: "funds_received seller", status: "funds_received", actor: "seller", expectedAction: "upload-seller-evidence", expectedHash: "evidence", viewport: { width: 1440, height: 900 } },
    { label: "usdt_release_pending seller", status: "usdt_release_pending", actor: "seller", expectedAction: "upload-seller-evidence", expectedHash: "evidence", viewport: { width: 1440, height: 900 } },
    { label: "usdt_sent buyer", status: "usdt_sent", actor: "buyer", expectedAction: "confirm-usdt-received", expectedHash: "action-required", viewport: { width: 1440, height: 900 } },
    { label: "review_open buyer", status: "review_open", actor: "buyer", expectedAction: "review-trade", expectedHash: "status-banner", viewport: { width: 1440, height: 900 } },
  ];

  for (const item of cases) {
    const db = await readDb(api);
    const purchaseRequests = Array.isArray(db.purchaseRequests) ? db.purchaseRequests : [];
    const requestIndex = purchaseRequests.findIndex((row) => row && typeof row === "object" && (row as { id?: unknown }).id === requestId);
    expect(requestIndex).toBeGreaterThan(-1);

    const currentRequest = purchaseRequests[requestIndex] as Record<string, unknown>;
    purchaseRequests[requestIndex] = {
      ...currentRequest,
      status: item.status,
      buyerEvidence: item.status === "pending" ? undefined : (currentRequest.buyerEvidence ?? {
        id: `be-${randomUUID()}`,
        purchaseRequestId: requestId,
        side: "buyer",
        uploadedByUserId: ids.buyer,
        uploadedAt: iso(-5_000),
        fileName: "buyer-proof.png",
        mimeType: "image/png",
        sizeBytes: TEST_FILE_BUFFER.length,
        storagePath: `db://alpha-exchange-evidence/${requestId}/buyer-proof.png`,
        status: "uploaded",
      }),
      sellerEvidence: (item.status === "review_open" || item.status === "usdt_sent")
        ? (currentRequest.sellerEvidence ?? {
          id: `se-${randomUUID()}`,
          purchaseRequestId: requestId,
          side: "seller",
          uploadedByUserId: ids.seller,
          uploadedAt: iso(-4_000),
          fileName: "seller-proof.png",
          mimeType: "image/png",
          sizeBytes: TEST_FILE_BUFFER.length,
          storagePath: `db://alpha-exchange-evidence/${requestId}/seller-proof.png`,
          status: "uploaded",
        })
        : undefined,
      updatedAt: iso(),
    };

    db.purchaseRequests = purchaseRequests;
    const notifications = Array.isArray(db.notifications) ? db.notifications : [];
    const actorUserId = item.actor === "seller" ? ids.seller : ids.buyer;
    const notificationId = `notif-${item.actor}-${item.status}-${randomUUID()}`;
    trackedIds.add(notificationId);
    notifications.unshift({
      id: notificationId,
      userId: actorUserId,
      category: "trade",
      title: `Matrix action ${item.label}`,
      message: "Action required for guided flow matrix",
      isRead: false,
      relatedRequestId: requestId,
      relatedListingId: ids.listing,
      relatedHref: `/trade-room/${requestId}`,
      actionHref: `/trade-room/${requestId}`,
      createdAt: iso(),
      updatedAt: iso(),
      state: "unread",
    });
    db.notifications = notifications;
    await writeDb(api, db);

    const email = item.actor === "seller" ? sellerEmail : buyerEmail;
    const password = item.actor === "seller" ? sellerPassword : buyerPassword;
    await logout(page.request);
    await login(page.request, email, password);

    const activeResponse = await page.request.get(`/api/alpha-exchange/trade-room/active?notificationId=${encodeURIComponent(notificationId)}&includePending=1`);
    expect(activeResponse.ok(), `active route failed for ${item.label}`).toBeTruthy();
    const activePayload = (await activeResponse.json()) as { destination?: string | null };
    expect(activePayload.destination).toContain(`/trade-room/${requestId}`);
    expect(activePayload.destination).toContain(`action=${item.expectedAction}`);
    expect(activePayload.destination).toContain(`#${item.expectedHash}`);

    await openNotificationAndNavigate({
      page,
      title: new RegExp(`Matrix action ${item.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
      requestId,
      expectedAction: item.expectedAction,
      expectedHash: item.expectedHash,
      viewport: item.viewport,
      useNotificationUi: false,
    });
  }

  await api.dispose();
});

test("mobile targeted notification open keeps correct section and CTA without overflow", async ({ page }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL });

  await logout(page.request);
  await login(page.request, buyerEmail, buyerPassword);
  const requestId = await createTradeRequest(page.request, "280");

  await login(page.request, sellerEmail, sellerPassword);
  await waitForNotification(api, sellerEmail, /new trade request/i, requestId);
  const mobileOpenTitle = "E2E Guided Mobile Accept";
  await injectTradeNotification(api, sellerEmail, mobileOpenTitle, requestId);

  await openNotificationAndNavigate({
    page,
    title: new RegExp(`^${escapeRegex(mobileOpenTitle)}$`, "i"),
    requestId,
    expectedAction: "accept-trade",
    expectedHash: "action-required",
    viewport: { width: 390, height: 844 },
  });

  await api.dispose();
});

test("Trade Room Poke is recipient-only, cooldown-protected, reconnect-safe, and mobile-visible", async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
  const buyerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sellerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const buyerPage = await buyerContext.newPage();
  const sellerPage = await sellerContext.newPage();

  try {
    await login(buyerPage.request, buyerEmail, buyerPassword);
    const requestId = await createTradeRequest(buyerPage.request, "310");

    await login(sellerPage.request, sellerEmail, sellerPassword);
    await sellerPage.goto(`/en/trade-room/${requestId}`);
    await sellerPage.getByRole("button", { name: /Accept Trade/i }).first().click();
    await expect(sellerPage.getByText(/Trade status updated|Trade Accepted/i).first()).toBeVisible({ timeout: 20_000 });

    await buyerPage.goto(`/en/trade-room/${requestId}`);
    const buyerChatForm = buyerPage.locator("#chat form");
    const buyerChatDraft = buyerChatForm.getByPlaceholder("Type a message...");
    await buyerChatDraft.fill("0532490321 hada rkme");
    await buyerChatForm.getByRole("button", { name: "Send Message" }).click();
    const inlineChatError = buyerChatForm.getByTestId("trade-chat-error");
    await expect(inlineChatError).toContainText("phone numbers", { timeout: 20_000 });
    await expect(inlineChatError).toContainText("inside this Trade Room");
    await expect(buyerChatDraft).toHaveValue("0532490321 hada rkme");

    let forcedChatNetworkFailures = 0;
    let hiddenCommittedChatStatus = 0;
    await buyerPage.route(`**/api/alpha-exchange/purchase-requests/${requestId}/messages`, async (route) => {
      if (forcedChatNetworkFailures === 0) {
        forcedChatNetworkFailures += 1;
        const committedResponse = await route.fetch();
        hiddenCommittedChatStatus = committedResponse.status();
        await route.abort("connectionfailed");
        return;
      }
      await route.continue();
    });
    const validChatMessage = `Secure in-room message ${randomUUID()}`;
    await buyerChatDraft.fill(validChatMessage);
    await expect(inlineChatError).toBeHidden();
    await buyerChatForm.getByRole("button", { name: "Send Message" }).click();
    await expect(buyerPage.getByText(validChatMessage, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(sellerPage.getByText(validChatMessage, { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(forcedChatNetworkFailures).toBe(1);
    expect(hiddenCommittedChatStatus).toBe(201);
    await buyerPage.unroute(`**/api/alpha-exchange/purchase-requests/${requestId}/messages`);
    const dbAfterRetriedChat = await readDb(api);
    const retriedChatRequest = (dbAfterRetriedChat.purchaseRequests as Array<Record<string, unknown>>)
      .find((item) => item.id === requestId);
    const retriedChatMessages = (retriedChatRequest?.messages as Array<Record<string, unknown>>)
      .filter((entry) => entry.message === validChatMessage);
    expect(retriedChatMessages).toHaveLength(1);

    const buyerPoke = buyerPage.getByRole("button", { name: /Poke Seller/i });
    await expect(buyerPoke).toBeVisible({ timeout: 20_000 });
    await buyerPoke.scrollIntoViewIfNeeded();
    await expect(buyerPoke).toBeInViewport();
    await buyerPoke.click();

    await expect(buyerPage.getByRole("button", { name: /Poke again in/i })).toBeDisabled({ timeout: 20_000 });
    await expect(sellerPage.getByText("Buyer sent a reminder to continue this Trade Room.").first()).toBeVisible({ timeout: 20_000 });

    const dbAfterBuyerPoke = await readDb(api);
    const requestAfterBuyerPoke = (dbAfterBuyerPoke.purchaseRequests as Array<Record<string, unknown>>)
      .find((item) => item.id === requestId);
    expect(requestAfterBuyerPoke?.pokeState).toMatchObject({ buyerToSellerAt: expect.any(String) });
    const chatPokes = (requestAfterBuyerPoke?.messages as Array<Record<string, unknown>>)
      .filter((message) => message.kind === "system" && message.message === "Buyer sent a reminder to continue this Trade Room.");
    expect(chatPokes).toHaveLength(1);
    const notificationsAfterBuyerPoke = dbAfterBuyerPoke.notifications as Array<Record<string, unknown>>;
    const sellerPokeNotifications = notificationsAfterBuyerPoke.filter((notification) =>
      notification.userId === ids.seller
      && notification.relatedRequestId === requestId
      && notification.reason === "trade_room_poke",
    );
    const buyerPokeNotifications = notificationsAfterBuyerPoke.filter((notification) =>
      notification.userId === ids.buyer
      && notification.relatedRequestId === requestId
      && notification.reason === "trade_room_poke",
    );
    expect(sellerPokeNotifications).toHaveLength(1);
    expect(buyerPokeNotifications).toHaveLength(0);
    expect(sellerPokeNotifications[0]).toMatchObject({
      title: "Trade Room reminder",
      message: "Your Buyer is waiting for you in an active trade.",
      actionHref: `/trade-room/${requestId}#chat`,
    });
    const sellerPokeNotificationId = String(sellerPokeNotifications[0]?.id ?? "");
    expect(sellerPokeNotificationId).toBeTruthy();

    // The recipient's delivered API DTO—not only the persisted row—must keep
    // the Poke-specific conversation metadata used by the bell destination.
    const deliveredNotificationsResponse = await sellerPage.request.get("/api/alpha-exchange/notifications?limit=20&includeActivity=0");
    expect(deliveredNotificationsResponse.ok()).toBeTruthy();
    const deliveredNotifications = await deliveredNotificationsResponse.json() as {
      notifications?: Array<Record<string, unknown>>;
    };
    expect(deliveredNotifications.notifications?.find((notification) => notification.id === sellerPokeNotificationId)).toMatchObject({
      id: sellerPokeNotificationId,
      category: "trade",
      reason: "trade_room_poke",
      relatedRequestId: requestId,
      actionHref: `/trade-room/${requestId}#chat`,
    });

    const replay = await buyerPage.request.post(`/api/alpha-exchange/purchase-requests/${requestId}/poke`);
    expect(replay.status()).toBe(429);

    // A separately authenticated browser for the same Buyer cannot sidestep the
    // durable per-trade/per-direction server cooldown.
    const buyerSecondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const buyerSecondPage = await buyerSecondContext.newPage();
      await login(buyerSecondPage.request, buyerEmail, buyerPassword);
      const secondBrowserReplay = await buyerSecondPage.request.post(`/api/alpha-exchange/purchase-requests/${requestId}/poke`);
      expect(secondBrowserReplay.status()).toBe(429);
    } finally {
      await buyerSecondContext.close();
    }

    // The live recipient has the single canonical reminder, and the server's
    // persisted Poke state survives direct replay attempts. The focused store
    // regression covers a fresh canonical read after cache invalidation.
    await expect(sellerPage.getByText("Buyer sent a reminder to continue this Trade Room.")).toHaveCount(1);

    // Use the actual bell action—not a synthetic href—to prove conversation
    // notifications retain their precise chat destination after the panel closes.
    await sellerPage.goto("/en/usdt-exchange", { waitUntil: "domcontentloaded", timeout: 20_000 });
    await sellerPage.locator('button[aria-label="Notifications"]').first().click();
    const notificationPanel = sellerPage.getByTestId("notification-panel");
    const reminderCard = notificationPanel.locator(`[data-notification-id="${sellerPokeNotificationId}"]`);
    await expect(reminderCard.getByText("Trade Room reminder", { exact: true })).toBeVisible({ timeout: 20_000 });
    await Promise.all([
      sellerPage.waitForURL((url) => (
        url.pathname === `/en/trade-room/${requestId}`
        && url.searchParams.get("action") === "open-trade"
        && url.hash === "#chat"
      ), { timeout: 20_000 }),
      reminderCard.getByRole("button", { name: "Continue Trade" }).click(),
    ]);
    await expect(sellerPage.locator("#chat")).toBeVisible({ timeout: 20_000 });
    await expect(sellerPage.getByText("Buyer sent a reminder to continue this Trade Room.")).toHaveCount(1);

    const sellerPoke = sellerPage.getByRole("button", { name: /Poke Buyer/i });
    await expect(sellerPoke).toBeVisible({ timeout: 20_000 });
    await sellerPoke.click();
    await waitForNotification(api, buyerEmail, /trade room reminder/i, requestId);
    await expect(buyerPage.getByText("Seller sent a reminder to continue this Trade Room.").first()).toBeVisible({ timeout: 20_000 });

    const dbAfterSellerPoke = await readDb(api);
    const requestAfterSellerPoke = (dbAfterSellerPoke.purchaseRequests as Array<Record<string, unknown>>)
      .find((item) => item.id === requestId);
    expect(requestAfterSellerPoke?.pokeState).toMatchObject({
      buyerToSellerAt: expect.any(String),
      sellerToBuyerAt: expect.any(String),
    });
    const buyerReminderNotifications = (dbAfterSellerPoke.notifications as Array<Record<string, unknown>>).filter((notification) =>
      notification.userId === ids.buyer
      && notification.relatedRequestId === requestId
      && notification.reason === "trade_room_poke",
    );
    expect(buyerReminderNotifications).toHaveLength(1);

    for (const width of [320, 360, 375, 390, 430]) {
      await buyerPage.setViewportSize({ width, height: 844 });
      await expect(buyerPage.getByRole("button", { name: /Poke again in/i })).toBeVisible({ timeout: 20_000 });
      await expect(buyerPage.locator('form[method="post"], form').filter({ has: buyerPage.getByRole("button", { name: /Send Message/i }) }).first()).toBeVisible();
      const overflow = await buyerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    }

    for (const width of [1366, 1920]) {
      await sellerPage.setViewportSize({ width, height: 900 });
      await expect(sellerPage.getByRole("button", { name: /Poke again in/i })).toBeVisible({ timeout: 20_000 });
      const overflow = await sellerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
  } finally {
    await buyerContext.close();
    await sellerContext.close();
    await api.dispose();
  }
});
