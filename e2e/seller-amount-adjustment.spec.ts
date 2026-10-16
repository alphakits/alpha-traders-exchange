import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { E2E_BASE_URL } from "./support/base-url";
import { createE2eSellerApprovalVerification } from "./support/seller-verification";

const headers = { "x-alpha-test-support": "enabled" };
const methods = ["Bank Transfer", "Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

async function readDb(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function fixture(api: APIRequestContext, method: string) {
  const db = await readDb(api);
  const now = new Date().toISOString();
  const id = `amount-qa-${randomUUID()}`;
  const sellerId = `${id}-seller`, buyerId = `${id}-buyer`, listingId = `${id}-listing`;
  const password = randomBytes(18).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const users = [sellerId, buyerId].map((userId, index) => ({
    id: userId, fullName: index ? "Demo Buyer" : "Demo Seller", email: `${userId}@example.test`, passwordHash,
    role: index ? "buyer" : "approved_seller", roles: [index ? "buyer" : "approved_seller"], sellerStatus: index ? "buyer" : "approved_seller",
    sellerApprovalVerification: index ? undefined : createE2eSellerApprovalVerification(now),
    availabilityStatus: "available", onlineStatus: "online", preferredNetworks: ["TRC20"], preferredPaymentMethods: methods,
    whatsappNumber: index ? "+972500000101" : "+972500000100", verifiedPhone: index ? "+972500000101" : "+972500000100", phoneVerifiedAt: now,
    emailVerified: true, emailVerifiedAt: now, buyerVerificationStatus: "verified", buyerFirstName: "Demo", buyerLastName: "Buyer",
    buyerDisplayName: "Demo Buyer", onboardingSelection: index ? "buyer" : "seller", onboardingCompletedAt: now,
    country: "Israel", languages: ["English"], preferredLocale: "en", createdAt: now, updatedAt: now,
    notificationPreferences: { inApp: true, email: false, sms: false },
  }));
  db.users.push(...users);
  db.marketplaceListings.push({ id: listingId, sellerId, sellerDisplayName: "Demo Seller", originalAmount: "1500", availableAmount: "1500", price: "3.20", currency: "ILS", network: "TRC20", paymentMethods: [method], paymentMethod: method, minimumTrade: "50", maximumTrade: "1500", status: "active", approvalStatus: "approved", createdAt: now, updatedAt: now });
  db.purchaseRequests.push({ id, tradeId: `${id}-trade`, listingId, sellerId, buyerId, buyerName: "Demo Buyer", usdtAmount: method === methods[2] ? "618.811881" : "600", fiatAmount: method === methods[2] ? "2000.00" : "1939.20", pricePerUsdt: "3.20", listingPriceAtRequest: "3.20", feePolicyVersion: "buyer_seller_1pct_v1", currency: "ILS", network: "TRC20", paymentMethod: method, sellerBankAccountId: method === methods[0] ? "demo-bank-account" : undefined, sellerBankAccountSnapshot: method === methods[0] ? { accountHolderName: "Demo Seller", bankName: "Bank Leumi", branchNumber: "123", accountNumber: "12345678", accountLast4: "5678" } : undefined, bankName: method === methods[2] ? "Bank Leumi" : undefined, buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", status: "pending", sellerSafetyAcknowledged: true, priceMode: "listing_price", createdAt: now, updatedAt: now, timeline: [], messages: [] });
  const saved = await api.put("/api/testing/alpha-exchange-state", { headers, data: db });
  expect(saved.ok()).toBeTruthy();
  return { id, sellerId, buyerId, listingId, password };
}

async function login(api: APIRequestContext, id: string, password: string) {
  const response = await api.post("/api/auth/login", { headers: { "x-forwarded-for": "198.51.100.30" }, data: { email: `${id}@example.test`, password, rememberMe: true } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

for (const method of methods) {
  test(`seller adjustment through approval and settlement: ${method}`, async ({ browser, request }, info) => {
    test.setTimeout(150_000);
    const f = await fixture(request, method);
    const seller = await browser.newContext({ baseURL: E2E_BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const buyer = await browser.newContext({ baseURL: E2E_BASE_URL, viewport: { width: 390, height: 844 } });
    try {
      await login(seller.request, f.sellerId, f.password);
      await login(buyer.request, f.buyerId, f.password);
      const sellerPage = await seller.newPage(), buyerPage = await buyer.newPage();
      seller.setDefaultTimeout(15_000); buyer.setDefaultTimeout(15_000);
      seller.setDefaultNavigationTimeout(20_000); buyer.setDefaultNavigationTimeout(20_000);
      const errors: string[] = [];
      for (const page of [sellerPage, buyerPage]) { page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => void d.accept()); }
      const path = `/en/trade-room/${f.id}`;
      await sellerPage.goto(path);
      const adjust = sellerPage.getByRole("button", { name: "Adjust Amount", exact: true });
      await expect(adjust).toBeEnabled();
      await expect(adjust).toBeInViewport();
      await expect(adjust).toHaveAttribute("aria-expanded", "false");
      await expect(sellerPage.locator("#trade-amount-editor")).toHaveCount(0);
      expect(await sellerPage.getByTestId("trade-amount-action").evaluate(el => !!(el.compareDocumentPosition(document.getElementById("status-banner")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
      if (method === methods[1]) {
        for (const [locale, width] of [["en", 390], ["ar", 390], ["en", 1440]] as const) {
          await sellerPage.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await sellerPage.goto(`/${locale}/trade-room/${f.id}`);
          await expect(sellerPage.getByRole("button", { name: locale === "ar" ? "تعديل المبلغ" : "Adjust Amount", exact: true })).toBeInViewport();
          expect(await sellerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
          await sellerPage.screenshot({ path: info.outputPath(`adjust-location-${locale}-${width}.png`) });
        }
        await sellerPage.setViewportSize({ width: 390, height: 844 });
        await sellerPage.goto(path);
      }
      await buyerPage.goto(path);
      // Both participants keep the room open; proposals and accepted totals must sync without a reload.
      // First increase, then reduce: both directions share the two-turn limit.
      await adjust.click();
      await sellerPage.getByLabel(method === methods[2] ? "New withdrawal amount (ILS)" : "Correct USDT amount", {exact:true}).fill(method === methods[2] ? "3000" : "1500");
      await sellerPage.getByRole("button", {name:"Propose corrected amount", exact:true}).click();
      await expect(sellerPage.getByRole("button", {name:"Withdraw proposal", exact:true})).toBeVisible();
      await expect(buyerPage.getByRole("button", {name:"Accept these terms", exact:true})).toBeVisible({ timeout: 20_000 });
      await buyerPage.getByRole("button", {name:"Accept these terms", exact:true}).click();
      await expect(adjust).toBeEnabled();
      await expect(sellerPage.getByTestId("trade-adjustment-count")).toContainText("1 / 2");
      await adjust.click();
      await expect(adjust).toHaveAttribute("aria-expanded", "true");
      await expect(sellerPage.locator("#trade-amount-editor")).toBeVisible();
      await sellerPage.getByLabel(method === methods[2] ? "New withdrawal amount (ILS)" : "Correct USDT amount", { exact: true }).fill(method === methods[2] ? "500" : "150");
      const newAmount = method === methods[2] ? "154.70297" : "150";
      await expect(sellerPage.getByTestId("trade-adjustment-preview")).toContainText(`${newAmount} USDT`);
      if (method === methods[1]) await sellerPage.screenshot({ path: info.outputPath("adjust-600-to-150.png") });
      await sellerPage.getByRole("button", { name: "Propose corrected amount", exact: true }).click();
      await expect(sellerPage.getByRole("button", { name: "Withdraw proposal", exact: true })).toBeVisible();
      await expect(buyerPage.getByRole("button", { name: "Accept these terms", exact: true })).toBeVisible({ timeout: 20_000 });
      await buyerPage.getByRole("button", { name: "Accept these terms", exact: true }).click();
      await expect(sellerPage.getByTestId("trade-room-summary")).toContainText(newAmount, { timeout: 20_000 });
      await expect(buyerPage.getByTestId("trade-room-summary")).toContainText(newAmount);
      const newTotal = method === methods[2] ? "500.00" : "484.80";
      await expect(sellerPage.getByTestId("trade-room-summary")).toContainText(newTotal);
      await expect(buyerPage.getByTestId("trade-room-summary")).toContainText(newTotal);
      await sellerPage.reload();
      await expect(sellerPage.getByTestId("trade-room-summary")).toContainText(newAmount);
      await expect(adjust).toBeDisabled();
      await expect(sellerPage.getByTestId("trade-adjustment-count")).toContainText("2/2");
      const limitState = await readDb(request);
      const limited = limitState.purchaseRequests.find((r:{id:string}) => r.id === f.id);
      expect(limited.amountAdjustmentCount).toBe(2);
      for (const action of ["propose_amount", "propose_ils_amount", "counter_offer", "recalculate_cardless_amount"]) {
        const denied = await seller.request.patch(`/api/alpha-exchange/purchase-requests/${f.id}`, {data:{action,value:"100",ilsAmount:"100",amountAdjustmentCount:0,expectedUpdatedAt:limited.updatedAt}});
        expect(denied.ok()).toBe(false);
      }
      await sellerPage.getByRole("button", { name: "Accept Trade", exact: true }).click();
      await expect(sellerPage.getByRole("button", { name: "Adjust Amount", exact: true })).toBeDisabled();
      await expect(sellerPage.getByTestId("trade-amount-locked")).toBeVisible();
      await buyerPage.reload();
      const before = await readDb(request);
      const locked = before.purchaseRequests.find((r: {id: string}) => r.id === f.id);
      for (const action of ["propose_amount", "propose_ils_amount", "recalculate_cardless_amount"]) {
        const denied = await seller.request.patch(`/api/alpha-exchange/purchase-requests/${f.id}`, {data:{action,value:"100",ilsAmount:"100",expectedUpdatedAt:locked.updatedAt}});
        expect(denied.ok()).toBe(false);
      }
      const staleApproval = await buyer.request.patch(`/api/alpha-exchange/purchase-requests/${f.id}`, {data:{action:"accept_amount",proposalId:locked.termsProposal.id}});
      expect(staleApproval.ok()).toBe(false);
      expect(before.marketplaceListings.find((l: {id: string}) => l.id === f.listingId).availableAmount).toBe("1500");
      expect(before.commissionRecords.filter((c: {purchaseRequestId: string}) => c.purchaseRequestId === f.id)).toHaveLength(0);
      if (method === methods[0]) {
        await buyerPage.getByLabel("Choose payment receipt", { exact: true }).setInputFiles({ name: "payment.png", mimeType: "image/png", buffer: png });
        await buyerPage.getByRole("button", { name: "Upload Payment Receipt", exact: true }).click();
      } else if (method === methods[2]) {
        await buyerPage.locator("#cardless-withdrawal-code").fill("923814");
        await buyerPage.locator("#cardless-verification-value").fill("123456789");
        await buyerPage.getByRole("button", { name: "Send & Confirm Withdrawal Details", exact: true }).click();
      } else await buyerPage.getByRole("button", { name: "I Handed Over the Cash", exact: true }).click();
      await expect(sellerPage.getByRole("button", { name: "Adjust Amount", exact: true })).toBeDisabled();
      if (method === methods[1]) {
        // Either participant may confirm face-to-face cash receipt. The buyer's
        // confirmation already advances both rooms; it must not need repeating.
        await expect(buyerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
        await expect(sellerPage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
        await expect(sellerPage.getByRole("button", { name: "I Received the Cash", exact: true })).toHaveCount(0);
        const cashState = await readDb(request);
        expect(cashState.purchaseRequests.find((r: { id: string }) => r.id === f.id)).toMatchObject({
          status: "funds_received", usdtAmount: newAmount, fiatAmount: newTotal,
        });
      } else {
        await sellerPage.getByRole("button", { name: method === methods[0] ? "Confirm Money Received" : "I Collected the ATM Cash", exact: true }).click();
      }
      if (method === methods[0]) {
        await sellerPage.getByRole("button", { name: "Release USDT", exact: true }).click();
        await sellerPage.getByLabel("Choose USDT release proof", { exact: true }).setInputFiles({ name: "release.png", mimeType: "image/png", buffer: png });
        await sellerPage.getByRole("button", { name: "Upload Seller Evidence", exact: true }).click();
      } else if (method === methods[2]) await sellerPage.getByRole("button", { name: "Confirm USDT Sent", exact: true }).click();
      await sellerPage.getByRole("button", { name: "Mark Trade as Completed", exact: true }).click();
      await expect(sellerPage.getByRole("heading", { name: "Trade Completed Successfully", exact: true })).toBeVisible({ timeout: 20_000 });
      const repeat = await seller.request.patch(`/api/alpha-exchange/purchase-requests/${f.id}`, { data: { action: "complete_trade", usdtSentConfirmed: true } });
      expect(repeat.ok(), await repeat.text()).toBeTruthy();
      const after = await readDb(request);
      expect(after.marketplaceListings.find((l: {id: string}) => l.id === f.listingId).availableAmount).toBe(method === methods[2] ? "1345.29703" : "1350");
      expect(after.commissionRecords.filter((c: {purchaseRequestId: string}) => c.purchaseRequestId === f.id)).toEqual([expect.objectContaining({ commissionAmount: method === methods[2] ? 3.1 : 3, sellerFeeAmount: method === methods[2] ? 1.55 : 1.5, buyerFeeCollectedAmount: method === methods[2] ? 1.55 : 1.5, grossAmount: method === methods[2] ? 500 : 484.8 })]);
      expect(errors).toEqual([]);
    } finally { await buyer.close(); await seller.close(); }
  });
}
