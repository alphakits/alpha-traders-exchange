import { test, expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "../src/types/alpha-exchange";
import { E2E_BASE_URL } from "./support/base-url";
import { createE2eSellerApprovalVerification } from "./support/seller-verification";
import { createHardNavigationErrorAudit } from "./support/hard-navigation-errors";
import { clickConfirmedTradeAction } from "./support/action-dialog";

const supportHeaders = { "x-alpha-test-support": "enabled" };
const paymentMethod = "Cardless ATM Withdrawal";
const buyerWallet = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";

async function readDb(api: APIRequestContext): Promise<AlphaExchangeDb> {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers: supportHeaders });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function fixture(api: APIRequestContext) {
  const db = await readDb(api);
  const id = `counter-qa-${randomUUID()}`;
  const sellerId = `${id}-seller`, buyerId = `${id}-buyer`, listingId = `${id}-listing`;
  const now = new Date().toISOString();
  const password = randomBytes(18).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const users = [sellerId, buyerId].map((userId, index) => ({
    id: userId, fullName: index ? "Counter Buyer" : "Counter Seller", email: `${userId}@example.test`, passwordHash,
    role: index ? "buyer" : "approved_seller", roles: [index ? "buyer" : "approved_seller"], sellerStatus: index ? "buyer" : "approved_seller",
    sellerApprovalVerification: index ? undefined : createE2eSellerApprovalVerification(now),
    availabilityStatus: "available", onlineStatus: "online", preferredNetworks: ["TRC20"], preferredPaymentMethods: [paymentMethod],
    whatsappNumber: index ? "+972500000101" : "+972500000100", verifiedPhone: index ? "+972500000101" : "+972500000100", phoneVerifiedAt: now,
    emailVerified: true, emailVerifiedAt: now, buyerVerificationStatus: "verified", buyerFirstName: "Counter", buyerLastName: "Buyer",
    buyerDisplayName: "Counter Buyer", onboardingSelection: index ? "buyer" : "seller_applicant", onboardingCompletedAt: now,
    country: "Israel", languages: ["English", "Arabic"], preferredLocale: "en", createdAt: now, updatedAt: now,
    notificationPreferences: { inApp: true, email: false, sms: false, browserPush: false },
  } as AlphaExchangeUser));
  db.users.push(...users);
  db.marketplaceListings.push({
    id: listingId, sellerId, sellerDisplayName: "Counter Seller", sellerDescription: "Synthetic counter-offer verification", responseTime: "Within 5 minutes", photos: [], originalAmount: "1500", availableAmount: "1500",
    price: "3.40", currency: "ILS", network: "TRC20", paymentMethods: [paymentMethod], paymentMethod, bankName: "Bank Leumi",
    minimumTrade: "50", maximumTrade: "1500", status: "active", approvalStatus: "approved", createdAt: now, updatedAt: now,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
  } as MarketplaceListing);
  const saved = await api.put("/api/testing/alpha-exchange-state", { headers: supportHeaders, data: db });
  expect(saved.ok(), await saved.text()).toBe(true);
  return { sellerId, buyerId, listingId, password };
}

async function cleanupFixture(api: APIRequestContext, f: Awaited<ReturnType<typeof fixture>>) {
  const db = await readDb(api);
  const ids = new Set([f.sellerId, f.buyerId, f.listingId, `${f.sellerId}@example.test`, `${f.buyerId}@example.test`]);
  for (const trade of db.purchaseRequests) {
    if (trade.sellerId === f.sellerId || trade.buyerId === f.buyerId || trade.listingId === f.listingId) ids.add(trade.id);
  }
  const referencesFixture = (value: unknown): boolean => {
    if (typeof value === "string") return ids.has(value);
    if (Array.isArray(value)) return value.some(referencesFixture);
    if (value && typeof value === "object") return Object.values(value).some(referencesFixture);
    return false;
  };
  // The browser suites share one isolated server. Remove only this scenario's
  // rows so its completed ATM seller cannot change later marketplace choices.
  for (const [key, rows] of Object.entries(db)) {
    if (Array.isArray(rows)) (db as unknown as Record<string, unknown>)[key] = rows.filter(row => !referencesFixture(row));
  }
  const saved = await api.put("/api/testing/alpha-exchange-state", { headers: supportHeaders, data: db });
  expect(saved.ok(), await saved.text()).toBe(true);
  const cleaned = await readDb(api);
  expect(Object.values(cleaned).filter(Array.isArray).flat().some(referencesFixture), "scenario rows must not leak into later tests").toBe(false);
}

async function login(api: APIRequestContext, userId: string, password: string) {
  const response = await api.post("/api/auth/login", {
    headers: { "x-forwarded-for": `2001:db8::${randomBytes(2).toString("hex")}` },
    data: { email: `${userId}@example.test`, password, rememberMe: false },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function blockExternalBrowserRequests(context: BrowserContext) {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort("blockedbyclient");
  });
}

test("ATM counter-offer recalculates ILS and fees through explicit cash selection, approval and settlement", async ({ browser, request, browserName }, info) => {
  test.setTimeout(150_000);
  const f = await fixture(request);
  const contexts: BrowserContext[] = [];
  const audit = createHardNavigationErrorAudit(browserName);
  try {
    const seller = await browser.newContext({ baseURL: E2E_BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    contexts.push(seller);
    const buyer = await browser.newContext({ baseURL: E2E_BASE_URL, viewport: { width: 1440, height: 900 } });
    contexts.push(buyer);
    await Promise.all([blockExternalBrowserRequests(seller), blockExternalBrowserRequests(buyer)]);
    await Promise.all([login(seller.request, f.sellerId, f.password), login(buyer.request, f.buyerId, f.password)]);
    // Create the request through the real API, including private prepared ATM details.
    const created = await buyer.request.post("/api/alpha-exchange/purchase-requests", { data: {
      listingId: f.listingId, usdtAmount: "92.821782", paymentMethod, bankName: "Bank Leumi",
      receivingNetwork: "TRC20", buyerReceivingWalletAddress: buyerWallet, feePolicyVersion: "buyer_seller_1pct_v1",
      priceMode: "buyer_offer", offeredPrice: "3.20", cardlessIlsAmount: "300",
      cardlessWithdrawalCode: "923814", cardlessVerificationKind: "id_number", cardlessVerificationValue: "123456789",
    } });
    expect(created.ok(), await created.text()).toBe(true);
    const { purchase } = await created.json() as { purchase: PurchaseRequest };
    expect(purchase).toMatchObject({ status: "pending", pricePerUsdt: "3.20", usdtAmount: "92.821782", fiatAmount: "300.00" });
    const apiPath = `/api/alpha-exchange/purchase-requests/${purchase.id}`;
    const tradePath = `/en/trade-room/${purchase.id}`;
    const [sellerPage, buyerPage] = await Promise.all([seller.newPage(), buyer.newPage()]);
    for (const page of [sellerPage, buyerPage]) {
      page.setDefaultTimeout(15_000);
      audit.observe(page);
      await page.addInitScript(() => { window.confirm = () => false; });
    }
    await audit.navigate(sellerPage, () => sellerPage.goto(tradePath));
    const counter = sellerPage.getByRole("button", { name: "Make a counter-offer", exact: true });
    await expect(counter).toBeEnabled();
    const appearance = await counter.evaluate(button => {
      const style = getComputedStyle(button);
      return { background: style.backgroundColor, image: style.backgroundImage, weight: Number(style.fontWeight), height: button.getBoundingClientRect().height };
    });
    expect(appearance.image !== "none" || !["transparent", "rgba(0, 0, 0, 0)"].includes(appearance.background)).toBe(true);
    expect(appearance.weight).toBeGreaterThanOrEqual(600);
    expect(appearance.height).toBeGreaterThanOrEqual(44);
    await counter.click();
    const rate = sellerPage.getByLabel("Counter price in ILS per USDT", { exact: true });
    const send = sellerPage.getByRole("button", { name: "Send counter-offer", exact: true });
    for (const invalid of ["3.20", "3.41"]) {
      await rate.fill(invalid);
      await expect(send).toBeDisabled();
    }
    await rate.fill("3.40");
    const preview = sellerPage.getByTestId("trade-adjustment-preview");
    await expect(preview).toContainText("92.821782");
    await expect(preview).toContainText("318.75");
    await expect(preview.getByTestId("trade-subtotal")).toContainText("315.59");
    await expect(preview.getByTestId("trade-buyer-fee")).toContainText("3.16");
    await expect(sellerPage.getByTestId("inclusive-payment-total")).toContainText("Draft total — not sent yet");
    await expect(sellerPage.getByTestId("inclusive-payment-total")).toContainText("318.75");
    await expect(preview).toContainText("1%");
    await expect(send).toBeDisabled();
    const incompatibleCash = await seller.request.patch(apiPath, { data: { action: "counter_offer", value: "3.40", expectedUpdatedAt: purchase.updatedAt } });
    expect(incompatibleCash.status()).toBe(409);
    await sellerPage.getByRole("combobox", { name: "ATM cash amount for counter-offer" }).selectOption("400");
    await expect(preview).toContainText("116.482236");
    await expect(preview).toContainText("400.00");
    await expect(preview.getByTestId("trade-total-commission")).toContainText("2.329644");
    await expect(send).toBeEnabled();
    expect(await sellerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await sellerPage.screenshot({ path: info.outputPath("atm-counter-offer-en-mobile.png") });

    // The Arabic phone screen must show the same financial proposal before submission.
    await audit.navigate(sellerPage, () => sellerPage.goto(`/ar/trade-room/${purchase.id}`));
    await sellerPage.getByRole("button", { name: "تقديم عرض مقابل", exact: true }).click();
    await sellerPage.getByLabel("السعر المقابل بالشيكل لكل USDT", { exact: true }).fill("3.40");
    await expect(sellerPage.getByTestId("trade-adjustment-preview")).toContainText("318.75");
    await expect(sellerPage.getByTestId("inclusive-payment-total")).toContainText("318.75");
    await sellerPage.getByRole("combobox", { name: "مبلغ رمز السحب للعرض المقابل" }).selectOption("400");
    await expect(sellerPage.getByTestId("trade-adjustment-preview")).toContainText("116.482236");
    await expect(sellerPage.getByTestId("trade-adjustment-preview")).toContainText("400.00");
    expect(await sellerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await sellerPage.screenshot({ path: info.outputPath("atm-counter-offer-ar-mobile.png") });
    await audit.navigate(sellerPage, () => sellerPage.goto(tradePath));
    await sellerPage.getByRole("button", { name: "Make a counter-offer", exact: true }).click();
    await sellerPage.getByLabel("Counter price in ILS per USDT", { exact: true }).fill("3.40");
    await sellerPage.getByRole("combobox", { name: "ATM cash amount for counter-offer" }).selectOption("400");
    const submittedResponse = sellerPage.waitForResponse(response => new URL(response.url()).pathname === apiPath && response.request().method() === "PATCH");
    await sellerPage.getByRole("button", { name: "Send counter-offer", exact: true }).click();
    const submitted = await submittedResponse;
    expect(submitted.ok(), await submitted.text()).toBe(true);
    const proposed = (await submitted.json()).request as PurchaseRequest;
    expect(proposed).toMatchObject({ status: "pending", usdtAmount: "92.821782", fiatAmount: "300.00", amountAdjustmentCount: 1,
      termsProposal: { kind: "counter_offer", status: "pending", usdtAmount: "116.482236", fiatAmount: "400.00", pricePerUsdt: "3.40", calculationPolicy: "cardless_selected_cash_v2" } });
    await audit.navigate(sellerPage, () => sellerPage.reload());
    await expect(sellerPage.getByRole("button", { name: "Withdraw proposal", exact: true })).toBeVisible();
    const blockedSellerAcceptance = await seller.request.patch(apiPath, { data: { status: "accepted" } });
    expect(blockedSellerAcceptance.status()).toBe(409);
    const blockedPayment = await buyer.request.patch(apiPath, { data: { action: "submit_cardless_code", usePreparedDetails: true, clientOperationId: randomUUID() } });
    expect(blockedPayment.status()).toBe(409);

    await audit.navigate(buyerPage, () => buyerPage.goto(tradePath));
    const buyerTerms = buyerPage.getByTestId("trade-amount-action");
    await expect(buyerTerms).toContainText("92.821782");
    await expect(buyerTerms).toContainText("116.482236");
    await expect(buyerTerms).toContainText("400.00");
    await expect(buyerTerms).toContainText("3.40");
    await expect(buyerPage.getByTestId("inclusive-payment-total")).toContainText("Proposed total — awaiting buyer approval");
    await expect(buyerPage.getByTestId("inclusive-payment-total")).toContainText("400.00");
    await expect(buyerPage.getByRole("button", { name: "Send & Confirm Withdrawal Details", exact: true })).toHaveCount(0);
    await buyerPage.screenshot({ path: info.outputPath("atm-counter-offer-buyer-desktop.png") });
    const acceptedResponse = buyerPage.waitForResponse(response => new URL(response.url()).pathname === apiPath && response.request().method() === "PATCH");
    await buyerPage.getByRole("button", { name: "Accept these terms", exact: true }).click();
    const accepted = await acceptedResponse;
    expect(accepted.ok(), await accepted.text()).toBe(true);
    expect((await accepted.json()).request).toMatchObject({ status: "accepted", usdtAmount: "116.482236", fiatAmount: "400.00", pricePerUsdt: "3.40", cardlessCodeAwaitingBuyerConfirmation: false });
    await audit.navigate(sellerPage, () => sellerPage.reload());
    for (const page of [buyerPage, sellerPage]) {
      await expect(page.getByTestId("trade-room-summary")).toContainText("116.482236");
      await expect(page.getByTestId("inclusive-payment-total")).toContainText("400.00");
      await expect(page.getByTestId("inclusive-payment-total")).not.toContainText("awaiting buyer approval");
    }
    await expect(sellerPage.getByTestId("trade-chat-messages")).not.toContainText("923814");
    const duplicateApproval = await buyer.request.patch(apiPath, { data: { action: "accept_counter_offer", proposalId: proposed.termsProposal!.id } });
    expect(duplicateApproval.ok(), await duplicateApproval.text()).toBe(true);
    const beforePayment = await readDb(request);
    expect(beforePayment.marketplaceListings.find(listing => listing.id === f.listingId)?.availableAmount).toBe("1500");
    expect(beforePayment.commissionRecords.filter(record => record.purchaseRequestId === purchase.id)).toHaveLength(0);

    const wrongCashCode = await buyer.request.patch(apiPath, { data: { action: "submit_cardless_code", withdrawalCode: "943815", verificationKind: "id_number", verificationValue: "123456789", ilsAmount: "300", clientOperationId: randomUUID() } });
    expect(wrongCashCode.status()).toBe(409);
    await buyerPage.getByLabel("1. Withdrawal code", { exact: true }).fill("943815");
    await buyerPage.getByLabel("2. ID number", { exact: true }).fill("123456789");
    await buyerPage.getByLabel("3. Cash amount of this withdrawal code (ILS)", { exact: true }).fill("400");
    await clickConfirmedTradeAction(buyerPage, buyerPage.getByRole("button", { name: "Send & Confirm Withdrawal Details", exact: true }));
    await expect(sellerPage.getByRole("button", { name: "I Collected the ATM Cash", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(sellerPage.getByTestId("trade-amount-locked")).toBeVisible();
    await expect(sellerPage.getByTestId("trade-chat-messages")).not.toContainText("923814");
    await expect(sellerPage.getByTestId("trade-chat-messages")).toContainText("943815");
    await expect(sellerPage.getByTestId("trade-chat-messages")).toContainText("400.00");
    const locked = (await readDb(request)).purchaseRequests.find(trade => trade.id === purchase.id)!;
    const deniedCounter = await seller.request.patch(apiPath, { data: { action: "counter_offer", value: "3.40", expectedUpdatedAt: locked.updatedAt } });
    expect(deniedCounter.status()).toBe(409);
    await clickConfirmedTradeAction(sellerPage, sellerPage.getByRole("button", { name: "I Collected the ATM Cash", exact: true }));
    await clickConfirmedTradeAction(sellerPage, sellerPage.getByRole("button", { name: "Confirm USDT Sent", exact: true }));
    await clickConfirmedTradeAction(sellerPage, sellerPage.getByRole("button", { name: "Mark Trade as Completed", exact: true }));
    await expect(sellerPage.getByRole("heading", { name: "Trade Completed Successfully", exact: true })).toBeVisible({ timeout: 20_000 });
    const repeatedCompletion = await seller.request.patch(apiPath, { data: { action: "complete_trade", usdtSentConfirmed: true } });
    expect(repeatedCompletion.ok(), await repeatedCompletion.text()).toBe(true);
    const after = await readDb(request);
    expect(after.purchaseRequests.find(trade => trade.id === purchase.id)).toMatchObject({ status: "review_open", usdtAmount: "116.482236", fiatAmount: "400.00", pricePerUsdt: "3.40", amountAdjustmentCount: 1 });
    expect(after.marketplaceListings.find(listing => listing.id === f.listingId)?.availableAmount).toBe("1383.517764");
    expect(after.commissionRecords.filter(record => record.purchaseRequestId === purchase.id)).toEqual([expect.objectContaining({ sellerFeeAmount: 1.164822, buyerFeeCollectedAmount: 1.164822, commissionAmount: 2.329644, grossAmount: 400 })]);
    for (const api of [buyer.request, seller.request]) {
      const receipt = await api.get(`${apiPath}/receipt`);
      expect(receipt.ok(), await receipt.text()).toBe(true);
      expect((await receipt.json()).receipt).toMatchObject({ usdtAmount: "116.482236", fiatAmount: "400.00", pricePerUsdt: "3.40", buyerFeeUsdt: "1.164822", sellerFeeUsdt: "1.164822", totalPlatformFeeUsdt: "2.329644" });
    }
    expect(audit.errors).toEqual([]);
  } finally {
    try {
      await info.attach("browser-error-audit", { body: JSON.stringify(audit.report(), null, 2), contentType: "application/json" });
    } finally {
      try {
        await Promise.all(contexts.map(context => context.close()));
      } finally {
        await cleanupFixture(request, f);
      }
    }
  }
});
