import { expect, request as pwRequest, type APIRequestContext, type Page, type Locator } from "@playwright/test";
import { test } from "./support/focus-diagnostics";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { E2E_BASE_URL } from "./support/base-url";
import { createE2eSellerApprovalVerification } from "./support/seller-verification";
import { createHardNavigationErrorAudit } from "./support/hard-navigation-errors";

const scrypt = promisify(scryptCallback);
const SUPPORT_HEADERS = {
  "content-type": "application/json",
  "x-alpha-test-support": "enabled",
};
const BUYER_WALLET = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";

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
    sellerApprovalVerification: createE2eSellerApprovalVerification(now),
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
    feePolicyVersion: "buyer_seller_1pct_v1",
    listingId: ids.listing,
    usdtAmount,
    buyerName: "Guided Buyer",
    buyerWhatsapp: "+972500000101",
    buyerNotes: "Guided hardening flow",
    buyerReceivingWalletAddress: BUYER_WALLET,
    safetyAcknowledged: true,
  };
}

async function createTradeRequest(request: APIRequestContext, usdtAmount = "300", overrides: Record<string, unknown> = {}) {
  const response = await request.post("/api/alpha-exchange/purchase-requests", {
    data: { ...purchaseRequestPayload(usdtAmount), ...overrides },
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
  const destinationRegex = new RegExp(`/(?:ar|en)/trade-room/${requestId}\\?action=${expectedAction}`);

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

    const expectedNotificationLabels: Record<string, string> = {
      "accept-trade": "Review trade request",
      "confirm-cash-payment": "Confirm cash or code sent",
      "confirm-money-received": "Confirm payment received",
      "complete-cash-trade": "Mark trade as completed",
      "review-trade": "Leave a trade review",
    };
    const expectedNotificationLabel = expectedNotificationLabels[expectedAction];
    expect(expectedNotificationLabel, `Expected notification label for ${expectedAction}`).toBeTruthy();
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const titleElement = panel.locator("p.text-sm.font-medium.text-white, p.text-sm.font-medium.text-slate-100").filter({ hasText: title }).first();
    await expect(titleElement).toBeVisible({ timeout: 20_000 });
    const targetCard = titleElement.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]").first();
    await expect(targetCard).toBeVisible({ timeout: 20_000 });
    const actionButton = targetCard.getByRole("button", { name: expectedNotificationLabel, exact: true });
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

    const uploadAction = expectedAction === "upload-payment-receipt" || expectedAction === "upload-seller-evidence";
    const section = page.locator(uploadAction ? "#action-required" : `#${expectedHash}`);
    await expect(section).toBeVisible({ timeout: 20_000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);

    await expect.poll(async () => section.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const headerBottom = document.querySelector<HTMLElement>("header")?.getBoundingClientRect().bottom ?? 0;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
      return {
        clearsHeader: rect.top >= Math.max(viewportTop, headerBottom - 1),
        visibleTarget: rect.top + Math.min(rect.height, 160) <= viewportBottom - 24,
      };
    }), {
      message: "The focused notification target must remain visible below the sticky header",
      timeout: 5_000,
    }).toEqual({ clearsHeader: true, visibleTarget: true });
    await expect(section).toBeFocused({ timeout: 5_000 });

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
  if (expectedAction === "confirm-cash-payment") return /I Sent the Withdrawal Code|I Handed Over the Cash|أرسلت رمز السحب|سلّمت النقد/i;
  if (expectedAction === "confirm-money-received") return /Confirm Money Received|I Collected the ATM Cash|I Received the Cash|تأكيد استلام الأموال|استلمت النقد/i;
  if (expectedAction === "confirm-usdt-sent") return /Confirm USDT Sent|تأكيد إرسال USDT/i;
  if (expectedAction === "complete-cash-trade" || expectedAction === "send-usdt-complete") return /Mark Trade as Completed|تحديد الصفقة كمكتملة/i;
  if (expectedAction === "confirm-usdt-received") return /Confirm USDT Received|تأكيد استلام USDT/i;
  return /Submit Rating|إرسال التقييم/i;
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

async function wheelAndSettle(page: Page, target: Locator, deltaY: number) {
  await target.hover();
  const token = randomUUID();
  const diagnostics = await target.evaluateHandle((element, id) => {
    // Geometry and element identifiers only; never record entered text or values.
    const describe = (node: EventTarget | null) => node instanceof Element ? {
      tag: node.tagName.toLowerCase(),
      id: node.id.slice(0, 100),
      testId: node.getAttribute("data-testid")?.slice(0, 100) ?? null,
      ancestorTestId: node.closest("[data-testid]")?.getAttribute("data-testid")?.slice(0, 100) ?? null,
    } : null;
    const snapshot = () => {
      const rect = element.getBoundingClientRect();
      const x = (Math.max(0, rect.left) + Math.min(window.innerWidth, rect.right)) / 2;
      const y = (Math.max(0, rect.top) + Math.min(window.innerHeight, rect.bottom)) / 2;
      const hit = document.elementFromPoint(x, y);
      const style = getComputedStyle(element);
      return {
        panel: describe(element), connected: element.isConnected,
        rect: rect.toJSON(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: {
          scrollX: window.scrollX, scrollY: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
          focused: document.hasFocus(), visibility: document.visibilityState,
        },
        panelScroll: { top: element.scrollTop, height: element.scrollHeight, clientHeight: element.clientHeight },
        style: { overflowY: style.overflowY, overscrollBehaviorY: style.overscrollBehaviorY },
        visibleCenter: { x, y, hit: describe(hit), insidePanel: hit !== null && element.contains(hit) },
      };
    };
    const before = snapshot();
    const wheels: unknown[] = [];
    const onDocumentWheel = (event: WheelEvent) => {
      if (wheels.length >= 8) return;
      wheels.push({
        trusted: event.isTrusted,
        deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
        clientX: event.clientX, clientY: event.clientY,
        target: describe(event.target),
        hit: describe(document.elementFromPoint(event.clientX, event.clientY)),
        insidePanel: event.target instanceof Node && element.contains(event.target),
        panelTop: element.scrollTop, documentTop: window.scrollY,
      });
    };
    document.addEventListener("wheel", onDocumentWheel, { capture: true, passive: true });
    element.setAttribute("data-scroll-audit", `${id}:waiting`);
    const onWheel = () => {
      let previous = "";
      let stable = 0;
      let frames = 0;
      const sample = () => {
        const current = `${window.scrollY}:${element.scrollTop}`;
        stable = current === previous ? stable + 1 : 0;
        previous = current;
        frames += 1;
        if (stable >= 6) {
          element.setAttribute("data-scroll-audit", `${id}:settled`);
        } else if (frames < 180) {
          requestAnimationFrame(sample);
        } else {
          element.setAttribute("data-scroll-audit", `${id}:unstable`);
        }
      };
      requestAnimationFrame(sample);
    };
    element.addEventListener("wheel", onWheel, { once: true });
    return {
      read: () => ({ before, after: snapshot(), wheels, status: element.getAttribute("data-scroll-audit") }),
      dispose: () => {
        document.removeEventListener("wheel", onDocumentWheel, true);
        element.removeEventListener("wheel", onWheel);
        element.removeAttribute("data-scroll-audit");
      },
    };
  }, token);
  try {
    await page.mouse.wheel(0, deltaY);
    await expect.poll(() => target.getAttribute("data-scroll-audit"), { timeout: 5_000 }).toBe(`${token}:settled`);
  } catch (error) {
    try {
      const snapshot = await diagnostics.evaluate(state => state.read());
      await test.info().attach("chat-wheel-diagnostics", {
        body: Buffer.from(JSON.stringify({ version: 1, deltaY, ...snapshot }, null, 2)),
        contentType: "application/json",
      });
    } catch {
      // A closed browser context must not replace the original wheel failure.
    }
    throw error;
  } finally {
    await diagnostics.evaluate(state => state.dispose()).catch(() => {});
    await diagnostics.dispose().catch(() => {});
  }
}

async function expectChatScrollIsolation(page: Page, messagePanel: Locator, locale: "en" | "ar", outsideList: Locator) {
  await expect.poll(() => messagePanel.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(300);
  await messagePanel.hover();
  // Both boundary probes need room for the document to move, otherwise
  // an unconstrained scroller could appear to pass at a page boundary.
  await page.evaluate(() => {
    if (window.scrollY < 100) window.scrollTo({ top: 100, behavior: "instant" });
  });
  await messagePanel.hover();
  const documentTop = await page.evaluate(() => window.scrollY);
  expect(documentTop).toBeGreaterThan(30);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight - window.scrollY)).toBeGreaterThan(30);

  await messagePanel.evaluate(element => { element.scrollTop = (element.scrollHeight - element.clientHeight) / 2; });
  const interiorTop = await messagePanel.evaluate(element => element.scrollTop);
  await wheelAndSettle(page, messagePanel, 80);
  expect(await messagePanel.evaluate(element => element.scrollTop)).toBeGreaterThan(interiorTop + 10);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(documentTop, 0);

  await messagePanel.evaluate(element => { element.scrollTop = 0; });
  await wheelAndSettle(page, messagePanel, -600);
  expect(await messagePanel.evaluate(element => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(documentTop, 0);

  await messagePanel.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await wheelAndSettle(page, messagePanel, 600);
  expect(await messagePanel.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(documentTop, 0);

  // Keyboard access must operate the list, without trapping page navigation.
  await expect(messagePanel).toHaveAttribute("role", "region");
  await expect(messagePanel).toHaveAttribute("aria-label", locale === "ar" ? "رسائل الدردشة" : "Chat messages");
  await messagePanel.evaluate(element => { element.scrollTop = 0; });
  await messagePanel.focus();
  await expect(messagePanel).toBeFocused();
  await messagePanel.press("ArrowDown");
  await expect.poll(() => messagePanel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(documentTop, 0);

  // Hover outside the list; the ordinary document must remain scrollable.
  await outsideList.hover();
  const beforeOutside = await page.evaluate(() => window.scrollY);
  expect(beforeOutside).toBeGreaterThan(30);
  await page.mouse.wheel(0, -120);
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 }).toBeLessThan(beforeOutside - 10);
}

for (const locale of ["en", "ar"] as const) {
  for (const width of [390, 1440]) {
    test(`commission notices and mixed-language chat: ${locale}, ${width}px`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      await login(page.request, buyerEmail, buyerPassword);
      const requestId = await createTradeRequest(page.request);
      await page.goto(`/${locale}/trade-room/${requestId}`);
      const notice = page.locator('[data-testid="inclusive-payment-total"] .commission-notice');
      await expect(notice).toHaveCSS("color", "rgb(248, 226, 124)");
      await expect(page.locator('[data-testid="inclusive-payment-total"] .currency-money').first()).toHaveCSS("color", "rgb(52, 211, 153)");
      const form = page.locator("#chat form");
      const draft = form.locator("textarea");
      await expect(draft).toHaveAttribute("dir", "auto");
      await expect(draft).toHaveCSS("unicode-bidi", "plaintext");
      const messagePanel = page.getByTestId("trade-chat-messages");
      const initialPanelHeight = await messagePanel.evaluate(element => element.clientHeight);
      for (const [message, direction] of [
        ["بدي كل المبلغ 1,500 USDT", "rtl"],
        ["Send 1,500 USDT تمام", "ltr"],
        ["عندي 80 ILS\nPlease confirm 80 ILS", "rtl"],
        [Array.from({ length: 32 }, () => "Earlier conversation line.").join("\n"), "ltr"],
      ] as const) {
        await draft.fill(message);
        await expect(draft).toHaveValue(message);
        await expect(draft).toHaveCSS("direction", direction);
        const [sent] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === `/api/alpha-exchange/purchase-requests/${requestId}/messages` && response.request().method() === "POST"),
          form.locator('button[type="submit"]').click(),
        ]);
        expect(sent.ok()).toBeTruthy();
        const payload = await sent.json() as { message: { id: string; message: string } };
        expect(payload.message.message).toBe(message);
        const body = page.locator(`[data-trade-message-id="${payload.message.id}"]`);
        await expect(body).toContainText(message);
        await expect(body).toHaveCSS("direction", direction);
        await expect(body).toHaveCSS("unicode-bidi", "plaintext");
        await expect(draft).toHaveValue("");
      }
      expect(await messagePanel.evaluate(element => element.clientHeight)).toBe(initialPanelHeight);
      await expectChatScrollIsolation(page, messagePanel, locale, page.locator("#chat summary").first());

      await draft.fill("1,500.25");
      await expect(draft).toHaveValue("1,500.25");
      await expect(page.locator("#chat")).toBeVisible();
      await page.locator("#chat").screenshot({ path: testInfo.outputPath("mixed-chat.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // The owner history/management route has a separate conversation renderer.
      // Reuse this authenticated trade and the same physical scroll assertions.
      const ownerEmail = process.env.E2E_OWNER_EMAIL;
      const ownerPassword = process.env.E2E_OWNER_PASSWORD;
      expect(ownerEmail).toMatch(/@example\.test$/);
      expect(ownerPassword).toBeTruthy();
      await logout(page.request);
      await login(page.request, ownerEmail!, ownerPassword!);
      await page.goto(`/${locale}/trade-room/${requestId}?view=history`);
      expect(new URL(page.url()).searchParams.get("view")).toBe("history");
      const ownerPanel = page.getByTestId("owner-trade-chat-messages");
      await expect(ownerPanel).toBeVisible();
      const ownerInitialHeight = await ownerPanel.evaluate(element => element.clientHeight);
      await expect.poll(() => ownerPanel.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
      const ownerDraft = page.locator("#owner-chat-message");
      await expect(ownerDraft).toBeVisible();
      await expect(ownerPanel.locator("textarea")).toHaveCount(0);

      // Polling a new buyer message must preserve an owner's earlier reading position.
      await ownerPanel.evaluate(element => { element.scrollTop = 0; });
      await wheelAndSettle(page, ownerPanel, 80);
      const ownerReadingTop = await ownerPanel.evaluate(element => element.scrollTop);
      const ownerReadingDocumentTop = await page.evaluate(() => window.scrollY);
      expect(ownerReadingTop).toBeGreaterThan(10);
      expect(ownerReadingDocumentTop).toBeGreaterThan(30);
      expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight - window.scrollY)).toBeGreaterThan(30);
      const incomingMessage = `Incoming owner-history scroll audit: ${locale}, ${width}px.`;
      const buyerApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
      try {
        await login(buyerApi, buyerEmail, buyerPassword);
        const incoming = await buyerApi.post(`/api/alpha-exchange/purchase-requests/${requestId}/messages`, {
          data: { message: incomingMessage, clientMessageId: randomUUID() },
        });
        expect(incoming.ok()).toBeTruthy();
      } finally {
        await buyerApi.dispose();
      }
      await expect(ownerPanel).toContainText(incomingMessage, { timeout: 20_000 });
      expect(await ownerPanel.evaluate(element => element.scrollTop)).toBeCloseTo(ownerReadingTop, 0);
      expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(ownerReadingDocumentTop, 0);

      // A confirmed own reply follows the inner list, without moving the document.
      const ownerMessage = locale === "ar"
        ? "رسالة المالك للتحقق من استقلال تمرير المحادثة."
        : "Owner message verifying independent conversation scrolling.";
      await ownerDraft.fill(ownerMessage);
      const ownerSend = page.locator("#history-chat").getByRole("button", { name: locale === "ar" ? "إرسال باسم المالك" : "Send as Owner", exact: true });
      await ownerSend.scrollIntoViewIfNeeded();
      const ownerSendDocumentTop = await page.evaluate(() => window.scrollY);
      const [ownerSent] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === `/api/alpha-exchange/purchase-requests/${requestId}/messages` && response.request().method() === "POST"),
        ownerSend.click(),
      ]);
      expect(ownerSent.ok()).toBeTruthy();
      const ownerPayload = await ownerSent.json() as { message: { senderRole: string; message: string } };
      expect(ownerPayload.message.senderRole).toBe("owner");
      expect(ownerPayload.message.message).toBe(ownerMessage);
      await expect(ownerPanel).toContainText(ownerMessage);
      await expect(ownerDraft).toHaveValue("");
      await expect.poll(() => ownerPanel.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(ownerSendDocumentTop, 0);
      expect(await ownerPanel.evaluate(element => element.clientHeight)).toBe(ownerInitialHeight);
      await expectChatScrollIsolation(page, ownerPanel, locale, page.locator("#history-chat-heading"));
      await ownerPanel.screenshot({ path: testInfo.outputPath("owner-chat-scroll.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}

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

test("mobile guided cash flow: no photos, wallet privacy, seller-only completion", async ({ page }) => {
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

  const acceptedConfirmations: string[] = [];
  const confirmAcceptance = async (dialog: import("@playwright/test").Dialog) => {
    acceptedConfirmations.push(dialog.message());
    await dialog.accept();
  };
  // Face-to-face acceptance requires the terms confirmation and the separate
  // safe-meeting acknowledgement. A once handler dismisses the second dialog.
  page.on("dialog", confirmAcceptance);
  try {
    const [accepted] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === `/api/alpha-exchange/purchase-requests/${requestId}`
        && response.request().method() === "PATCH"),
      page.getByRole("button", { name: localizedTradeActionMatcher("accept-trade") }).first().click(),
    ]);
    expect(accepted.ok(), await accepted.text()).toBeTruthy();
    expect(acceptedConfirmations).toHaveLength(2);
    expect(acceptedConfirmations[1]).toMatch(/safe public place/i);
  } finally {
    page.off("dialog", confirmAcceptance);
  }
  await expect(page.getByText(/Receive the Cash, Then Confirm|استلم النقد ثم أكد/i).first()).toBeVisible({ timeout: 20_000 });

  const beforeCashReceipt = await page.request.get(`/api/alpha-exchange/trade-room/${requestId}`);
  expect(beforeCashReceipt.ok()).toBeTruthy();
  const privateRoom = (await beforeCashReceipt.json()) as { request: { status: string; buyerReceivingWalletAddress?: string } };
  expect(privateRoom.request.status).toBe("accepted");
  expect(privateRoom.request.buyerReceivingWalletAddress).toBeUndefined();
  await expect(page.getByText(BUYER_WALLET, { exact: true })).toHaveCount(0);

  await login(page.request, buyerEmail, buyerPassword);
  await waitForNotification(api, buyerEmail, /trade request accepted/i, requestId);
  const buyerAcceptedTitle = "E2E Guided Confirm Cash";
  await injectTradeNotification(api, buyerEmail, buyerAcceptedTitle, requestId);
  await openNotificationAndNavigate({
    page,
    title: new RegExp(`^${escapeRegex(buyerAcceptedTitle)}$`, "i"),
    requestId,
    expectedAction: "confirm-cash-payment",
    expectedHash: "action-required",
    viewport,
  });

  page.once("dialog", (dialog) => dialog.accept());
  const [cashConfirmed] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `/api/alpha-exchange/purchase-requests/${requestId}`
      && response.request().method() === "PATCH"),
    page.getByRole("button", { name: localizedTradeActionMatcher("confirm-cash-payment") }).first().click(),
  ]);
  expect(cashConfirmed.ok(), await cashConfirmed.text()).toBeTruthy();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  await expect(page.getByTestId("trade-progress-details").locator("summary")).toContainText("Cash Receipt Confirmed");
  await expect(page.getByRole("heading", { name: "Waiting for Seller to Send USDT", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: localizedTradeActionMatcher("complete-cash-trade") })).toHaveCount(0);

  await login(page.request, sellerEmail, sellerPassword);
  await waitForNotification(api, sellerEmail, /^Buyer confirmed cash received$/i, requestId);
  const sellerConfirmTitle = "E2E Guided Send USDT and Complete";
  await injectTradeNotification(api, sellerEmail, sellerConfirmTitle, requestId);

  await openNotificationAndNavigate({
    page,
    title: new RegExp(`^${escapeRegex(sellerConfirmTitle)}$`, "i"),
    requestId,
    expectedAction: "complete-cash-trade",
    expectedHash: "action-required",
    viewport,
  });

  // Either participant may confirm face-to-face cash receipt. The buyer's
  // confirmation reveals the wallet immediately; a second seller receipt
  // confirmation is neither required nor offered.
  await expect(page.getByRole("button", { name: /I Received the Cash/i })).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  await expect(page.getByTestId("trade-progress-details").locator("summary")).toContainText("Cash Receipt Confirmed");
  await expect(page.getByRole("button", { name: localizedTradeActionMatcher("complete-cash-trade") }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Buyer Receiving Wallet/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(BUYER_WALLET).first()).toBeVisible({ timeout: 20_000 });

  const afterConfirmResponse = await page.request.get(`/api/alpha-exchange/trade-room/${requestId}`);
  expect(afterConfirmResponse.ok()).toBeTruthy();
  const afterConfirmRoom = (await afterConfirmResponse.json()) as { request?: { status?: string; buyerReceivingWalletAddress?: string } };
  expect(afterConfirmRoom.request?.status).toBe("funds_received");
  expect(afterConfirmRoom.request?.buyerReceivingWalletAddress).toBe(BUYER_WALLET);

  await expect(page.getByText(/How this trade works/i).first()).toBeVisible({ timeout: 20_000 });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: localizedTradeActionMatcher("complete-cash-trade") }).first().click();
  await expect(page.getByRole("button", { name: "Return home", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

  await login(page.request, buyerEmail, buyerPassword);
  await waitForNotification(api, buyerEmail, /^Trade completed$/i, requestId);
  const buyerConfirmTitle = "E2E Guided Review Completed Trade";
  await injectTradeNotification(api, buyerEmail, buyerConfirmTitle, requestId);
  await openNotificationAndNavigate({
    page,
    title: new RegExp(`^${escapeRegex(buyerConfirmTitle)}$`, "i"),
    requestId,
    expectedAction: "review-trade",
    expectedHash: "status-banner",
    viewport,
  });

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
    await expect(page.locator("#commission-payment").getByRole("heading", { name: "Pay commission", exact: true })).toBeVisible({ timeout: 20_000 });
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
    { label: "accepted buyer", status: "accepted", actor: "buyer", expectedAction: "confirm-cash-payment", expectedHash: "action-required", viewport: { width: 1440, height: 900 } },
    { label: "payment_sent seller", status: "payment_sent", actor: "seller", expectedAction: "confirm-money-received", expectedHash: "action-required", viewport: { width: 1440, height: 900 } },
    { label: "funds_received seller", status: "funds_received", actor: "seller", expectedAction: "complete-cash-trade", expectedHash: "action-required", viewport: { width: 1440, height: 900 } },
    { label: "usdt_release_pending seller", status: "usdt_release_pending", actor: "seller", expectedAction: "complete-cash-trade", expectedHash: "action-required", viewport: { width: 1440, height: 900 } },
    { label: "usdt_sent seller", status: "usdt_sent", actor: "seller", expectedAction: "complete-cash-trade", expectedHash: "action-required", viewport: { width: 1440, height: 900 } },
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
      buyerEvidence: undefined,
      sellerEvidence: undefined,
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
    // Stop the previous Trade Room's authenticated fetches/SSE before changing
    // actors so a stale 401 cannot overwrite the newly established session.
    await page.goto("about:blank");
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

for (const locale of ["en", "ar"] as const) {
  test(`legacy receipt notification history restores the current buyer and seller action (${locale})`, async ({ page }) => {
    test.setTimeout(120_000);
    const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
    try {
      await login(page.request, buyerEmail, buyerPassword);
      const requestId = await createTradeRequest(page.request, "270");
      for (const actor of ["buyer", "seller"] as const) {
        await page.goto("about:blank");
        const db = await readDb(api);
        const requests = db.purchaseRequests as Record<string, unknown>[];
        const purchase = requests.find(row => row.id === requestId)!;
        Object.assign(purchase, {
          paymentMethod: "Bank Transfer", status: actor === "buyer" ? "accepted" : "usdt_release_pending",
          buyerEvidence: undefined, sellerEvidence: undefined, updatedAt: iso(),
        });
        await writeDb(api, db);
        await logout(page.request);
        await login(page.request, actor === "buyer" ? buyerEmail : sellerEmail, actor === "buyer" ? buyerPassword : sellerPassword);
        await page.setViewportSize(locale === "en" ? { width: 390, height: 844 } : { width: 844, height: 390 });
        const action = actor === "buyer" ? "upload-payment-receipt" : "upload-seller-evidence";
        await page.goto(`/${locale}/trade-room/${requestId}?action=${action}#evidence`);
        const currentAction = page.locator("#action-required");
        const label = actor === "buyer"
          ? locale === "ar" ? "رفع إيصال الدفع" : "Upload Payment Receipt"
          : locale === "ar" ? "تأكيد إرسال USDT" : "Mark USDT Sent";
        const primaryAction = currentAction.getByTestId("trade-primary-action").getByRole("button", { name: label, exact: true });
        await expect(primaryAction).toBeEnabled();
        if (actor === "buyer") await expect(currentAction.locator('input[type="file"]')).toHaveCount(1);
        // Exercise the actual history event after the room has mounted. Older
        // notification links still use #evidence for the current participant action.
        await page.evaluate(() => window.history.pushState({}, "", "#chat"));
        await page.goBack();
        await expect(page).toHaveURL(/#evidence$/);
        await expect(currentAction).toBeFocused();
        await expect(primaryAction).toBeInViewport();
      }
    } finally {
      await api.dispose();
    }
  });
}

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
    const acceptedConfirmations: string[] = [];
    const confirmAcceptance = async (dialog: import("@playwright/test").Dialog) => {
      acceptedConfirmations.push(dialog.message());
      await dialog.accept();
    };
    sellerPage.on("dialog", confirmAcceptance);
    try {
      const [accepted] = await Promise.all([
        sellerPage.waitForResponse(response => new URL(response.url()).pathname === `/api/alpha-exchange/purchase-requests/${requestId}`
          && response.request().method() === "PATCH"),
        sellerPage.getByRole("button", { name: /Accept Trade/i }).first().click(),
      ]);
      expect(accepted.ok(), await accepted.text()).toBeTruthy();
      expect(acceptedConfirmations).toHaveLength(2);
      expect(acceptedConfirmations[1]).toMatch(/safe public place/i);
    } finally {
      sellerPage.off("dialog", confirmAcceptance);
    }
    await expect(sellerPage.getByText(/Receive the Cash, Then Confirm/i).first()).toBeVisible({ timeout: 20_000 });

    await buyerPage.goto(`/en/trade-room/${requestId}`);
    const buyerChatForm = buyerPage.locator("#chat form");
    const buyerChatDraft = buyerChatForm.getByPlaceholder("Type a message...");
    await buyerChatDraft.fill("0532490321 hada rkme");
    await expect(buyerChatDraft).toBeFocused();
    await expect(buyerChatDraft).toHaveValue("0532490321 hada rkme");
    await buyerChatForm.getByRole("button", { name: "Send Message" }).click();
    const inlineChatError = buyerChatForm.getByTestId("trade-chat-error");
    await expect(inlineChatError).toContainText("Keep contact details private.", { timeout: 20_000 });
    await expect(inlineChatError).toContainText("Chat inside this trade.");
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
    await expect(buyerChatDraft).toBeFocused();
    await expect(buyerChatDraft).toHaveValue(validChatMessage);
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
      expect((await buyerPage.request.get("/api/alpha-exchange/account-sessions")).status()).toBe(401);
    } finally {
      await buyerSecondContext.close();
    }

    // Signing in elsewhere replaces the original session. Reconnect the buyer
    // before asserting live delivery; closing the other browser cannot restore it.
    await login(buyerPage.request, buyerEmail, buyerPassword);
    await buyerPage.goto(`/en/trade-room/${requestId}`);
    await expect(buyerPage.getByRole("button", { name: /Poke again in/i })).toBeDisabled({ timeout: 20_000 });
    expect((await buyerPage.request.post(`/api/alpha-exchange/purchase-requests/${requestId}/poke`)).status()).toBe(429);

    // The live recipient has the single canonical reminder, and the server's
    // persisted Poke state survives direct replay attempts. The focused store
    // regression covers a fresh canonical read after cache invalidation.
    await expect(sellerPage.getByText("Buyer sent a reminder to continue this Trade Room.")).toHaveCount(1);

    // Use the actual bell action—not a synthetic href—to prove conversation
    // notifications retain their precise chat destination after the panel closes.
    // An existing active trade must not redirect the seller away while they
    // browse the marketplace and select a notification.
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
      reminderCard.getByRole("button", { name: "Open Trade Room", exact: true }).click(),
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

for (const paymentMethod of ["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"]) {
  test(`stable trade room across the complete ${paymentMethod} flow`, async ({ browser, browserName }, testInfo) => {
    test.setTimeout(180_000);
    const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL });
    const buyerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const sellerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const buyerPage = await buyerContext.newPage();
    const sellerPage = await sellerContext.newPage();
    const errorAudit = createHardNavigationErrorAudit(browserName);
    for (const page of [buyerPage, sellerPage]) {
      errorAudit.observe(page);
      page.on("dialog", (dialog) => void dialog.accept());
    }
    try {
      await login(buyerContext.request, buyerEmail, buyerPassword);
      await login(sellerContext.request, sellerEmail, sellerPassword);
      if (paymentMethod === "Cardless ATM Withdrawal") {
        const setup = await readDb(api);
        const listing = (setup.marketplaceListings as Array<Record<string, unknown>>).find(row => row.id === ids.listing)!;
        Object.assign(listing, { paymentMethod, paymentMethods: [paymentMethod], price: "3.00" });
        await writeDb(api, setup);
      }
      const requestId = await createTradeRequest(buyerContext.request, paymentMethod === "Cardless ATM Withdrawal" ? "297.029703" : "300",
        paymentMethod === "Cardless ATM Withdrawal" ? {
          paymentMethod, bankName: "Bank Hapoalim", cardlessWithdrawalCode: "123456", cardlessVerificationKind: "date_of_birth",
          cardlessVerificationValue: "01/01/1990", cardlessIlsAmount: "900", receivingNetwork: "TRC20",
        } : {});
      const db = await readDb(api);
      const trade = (db.purchaseRequests as Array<Record<string, unknown>>).find((row) => row.id === requestId)!;
      // The cardless cash total must be a multiple of 100 and include the
      // current buyer fee: 900 / (3 × 1.01) = 297.029703 USDT.
      Object.assign(trade, { paymentMethod, usdtAmount: paymentMethod === "Cardless ATM Withdrawal" ? "297.029703" : "300", fiatAmount: paymentMethod === "Cardless ATM Withdrawal" ? "900" : "909", pricePerUsdt: "3.00", listingPriceAtRequest: "3.00", sellerBankAccountId: `bank-${ids.seller}`, updatedAt: iso() });
      const sellerUser = (db.users as Array<Record<string, unknown>>).find((row) => row.id === ids.seller)!;
      sellerUser.sellerBankAccounts = [{ id: `bank-${ids.seller}`, sellerId: ids.seller, accountHolderName: "Guided Flow Seller", bankName: "Bank Hapoalim", branchNumber: "123", accountNumber: "9000000000", accountLast4: "0000", isDefault: true, createdAt: iso(), updatedAt: iso() }];
      await writeDb(api, db);
      const path = `/en/trade-room/${requestId}`;
      if (paymentMethod === "Bank Transfer") {
        await errorAudit.navigate(buyerPage, () => buyerPage.goto(path));
        await expect(buyerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
        await buyerPage.getByRole("button", { name: "Reveal Bank Details", exact: true }).click();
        await expect(buyerPage.getByText("9000000000", { exact: true })).toBeVisible();
        await expect(buyerPage.getByText("Guided Flow Seller", { exact: true })).toHaveCount(0);
        await buyerPage.screenshot({ path: testInfo.outputPath("bank-details-before-acceptance-mobile.png"), fullPage: true });
      }
      await errorAudit.navigate(sellerPage, () => sellerPage.goto(path));
      await expect(sellerPage.getByTestId("trade-header-notice")).toHaveCount(0);
      await expect(sellerPage.getByRole("button", { name: "Accept Trade", exact: true })).toBeInViewport();
      await sellerPage.getByRole("button", { name: "Accept Trade", exact: true }).click();
      await expect(sellerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
      await errorAudit.navigate(buyerPage, () => buyerPage.goto(path));
      await expect(buyerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
      if (paymentMethod === "Bank Transfer") {
        await buyerPage.getByRole("button", { name: "Reveal Bank Details", exact: true }).click();
        await expect(buyerPage.getByText("9000000000", { exact: true })).toBeVisible();
        await buyerPage.getByLabel("Choose payment receipt", { exact: true }).setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png });
        await buyerPage.getByRole("button", { name: "Upload Payment Receipt", exact: true }).click();
      } else if (paymentMethod === "Cardless ATM Withdrawal") {
        await expect(buyerPage.getByText(/Your saved withdrawal details are still private/)).toBeVisible();
        await expect(buyerPage.locator("#cardless-withdrawal-code")).toHaveCount(0);
        await expect(sellerPage.getByText(/123456/)).toHaveCount(0);
        await expect(sellerPage.getByRole("button", { name: "I Collected the ATM Cash", exact: true })).toHaveCount(0);
        const premature = await sellerContext.request.patch(`/api/alpha-exchange/purchase-requests/${requestId}`, { data: { status: "funds_received" } });
        expect(premature.ok()).toBe(false);
        await errorAudit.navigate(buyerPage, () => buyerPage.reload());
        await expect(buyerPage.getByText(/Your saved withdrawal details are still private/)).toBeVisible();
        await buyerPage.screenshot({ path: testInfo.outputPath("atm-private-before-confirmation-mobile.png"), fullPage: true });
        const [submitted] = await Promise.all([
          buyerPage.waitForResponse(response => new URL(response.url()).pathname === `/api/alpha-exchange/purchase-requests/${requestId}`
            && response.request().method() === "PATCH", { timeout: 15_000 }),
          buyerPage.getByRole("button", { name: "Send & Confirm Withdrawal Details", exact: true }).click(),
        ]);
        expect(submitted.ok(), await submitted.text()).toBeTruthy();
        await expect(sellerPage.getByText(/123456/).first()).toBeVisible();
        await sellerPage.screenshot({ path: testInfo.outputPath("atm-shared-after-confirmation-mobile.png"), fullPage: true });
      } else {
        await buyerPage.getByRole("button", { name: "I Handed Over the Cash", exact: true }).click();
      }
      if (paymentMethod === "Face-to-Face (Meet in Person)") {
        await expect(buyerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
        await expect(sellerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
        await expect(sellerPage.getByText(BUYER_WALLET, { exact: true })).toBeVisible();
      } else {
      await expect(buyerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
      const receiveLabel = paymentMethod === "Bank Transfer" ? "Confirm Money Received" : paymentMethod === "Cardless ATM Withdrawal" ? "I Collected the ATM Cash" : "I Received the Cash";
      await expect(sellerPage.getByRole("button", { name: receiveLabel, exact: true })).toHaveCount(1);
      await expect(sellerPage.getByRole("button", { name: receiveLabel, exact: true })).toBeInViewport();
      await expect(sellerPage.getByText("Buyer Receiving Wallet", { exact: true })).toHaveCount(0);
      // Hold the acknowledgement so the unchanged stage and one pending action
      // can be verified without timing-dependent sleeps.
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      await sellerPage.route(`**/api/alpha-exchange/purchase-requests/${requestId}`, async (route) => {
        if (route.request().method() === "PATCH") await held;
        await route.continue();
      });
      await sellerPage.getByRole("button", { name: receiveLabel, exact: true }).click();
      await expect(sellerPage.getByRole("button", { name: "Processing...", exact: true })).toBeDisabled();
      await expect(sellerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
      release();
      await expect(sellerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
      }
      const feedback = sellerPage.getByTestId("trade-action-feedback");
      if (paymentMethod !== "Face-to-Face (Meet in Person)") {
        await expect(feedback).toBeInViewport();
        await expect(sellerPage.locator("#action-required").getByTestId("trade-action-feedback")).toBeVisible();
      }
      for (const width of [320, 390, 1440]) {
        await sellerPage.setViewportSize({ width, height: 844 });
        expect(await sellerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      }
      await sellerPage.setViewportSize({ width: 390, height: 844 });
      await sellerPage.screenshot({ path: testInfo.outputPath("confirmed-step.png"), fullPage: true });
      if (paymentMethod === "Bank Transfer") {
        await sellerPage.getByRole("button", { name: "Release USDT", exact: true }).click();
        await sellerPage.getByLabel("Choose USDT release proof", { exact: true }).setInputFiles({ name: "release.png", mimeType: "image/png", buffer: png });
        await sellerPage.getByRole("button", { name: "Upload Seller Evidence", exact: true }).click();
      } else if (paymentMethod === "Cardless ATM Withdrawal") {
        await expect(sellerPage.getByText(BUYER_WALLET, { exact: true })).toBeVisible();
        await sellerPage.getByRole("button", { name: "Confirm USDT Sent", exact: true }).click();
        await expect(sellerPage.getByRole("button", { name: "Mark Trade as Completed", exact: true })).toBeVisible();
      } else {
        await expect(sellerPage.getByText(BUYER_WALLET, { exact: true })).toBeVisible();
      }
      if (paymentMethod !== "Face-to-Face (Meet in Person)") {
        await expect(sellerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "80");
      }
      await errorAudit.navigate(buyerPage, () => buyerPage.reload());
      await expect(buyerPage.getByRole("button", { name: /Confirm USDT Received|Mark Trade as Completed|Confirm Trade Completed/i })).toHaveCount(0);
      const beforeRejection = await readDb(api);
      const rejected = await buyerContext.request.patch(`/api/alpha-exchange/purchase-requests/${requestId}`, { data: { status: "completed" } });
      expect(rejected.ok()).toBe(false);
      expect(await rejected.json()).toMatchObject({ code: "seller-completion-required" });
      const afterRejection = await readDb(api);
      const settlementFields = (snapshot: Record<string, unknown>) => {
        const current = (snapshot.purchaseRequests as Array<Record<string, unknown>>).find(row => row.id === requestId)!;
        return { status: current.status, completedAt: current.completedAt, usdtAmount: current.usdtAmount,
          fiatAmount: current.fiatAmount, pricePerUsdt: current.pricePerUsdt, timeline: current.timeline };
      };
      expect(settlementFields(afterRejection)).toEqual(settlementFields(beforeRejection));
      for (const table of ["commissionRecords", "marketplaceListings"]) {
        expect(afterRejection[table]).toEqual(beforeRejection[table]);
      }
      await buyerPage.screenshot({ path: testInfo.outputPath("seller-only-buyer-mobile.png"), fullPage: true });
      await sellerPage.setViewportSize({ width: 1440, height: 900 });
      await expect(sellerPage.getByRole("button", { name: "Mark Trade as Completed", exact: true })).toBeVisible();
      await sellerPage.screenshot({ path: testInfo.outputPath("seller-only-seller-desktop.png"), fullPage: true });
      await sellerPage.getByRole("button", { name: "Mark Trade as Completed", exact: true }).click();
      await expect(buyerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
      await buyerPage.getByPlaceholder("Share your seller feedback...").fill("Completed smoothly in the browser rehearsal.");
      await buyerPage.getByRole("button", { name: "Submit Rating", exact: true }).click();
      await expect(buyerPage).toHaveURL(/\/en\/usdt-exchange/, { timeout: 10_000 });
      await expect(buyerPage.getByTestId("trade-header-notice")).toHaveCount(0);
      await expect(sellerPage.getByRole("button", { name: "Return home", exact: true })).toBeVisible();
      await sellerPage.getByText("Review buyer", { exact: true }).click();
      await sellerPage.getByLabel("Buyer feedback", { exact: true }).fill("Prompt buyer in the browser rehearsal.");
      await sellerPage.getByRole("button", { name: "Submit buyer review", exact: true }).click();
      await expect(sellerPage.getByText(/Your buyer review is saved/)).toBeVisible();
      const saved = await (await buyerContext.request.get(`/api/alpha-exchange/trade-room/${requestId}`)).json();
      expect(saved.request.status).toMatch(/review_open|completed|locked/);
      expect(saved.request.buyerReview).toBeTruthy();
      expect(saved.request.sellerBuyerReview).toBeTruthy();
      expect(errorAudit.errors).toEqual([]);
    } finally {
      try { await testInfo.attach("browser-error-audit", { body: JSON.stringify(errorAudit.report(), null, 2), contentType: "application/json" }); }
      finally {
        await buyerContext.close();
        await sellerContext.close();
        await api.dispose();
      }
    }
  });
}

