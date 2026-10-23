import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext, type Locator } from "@playwright/test";
import { OFFLINE_ACCOUNTS, OFFLINE_HEADERS, OFFLINE_PASSWORD, seedOfflineFixture } from "../scripts/usdt-request-offline-fixture.mjs";
import type { AlphaExchangeDb } from "../src/types/alpha-exchange";
import type { DemandWorkspace } from "../src/types/usdt-demand";
import { calculateCardlessUsdtAmount } from "@alpha-traders/contracts";

const root = "/api/alpha-exchange/usdt-requests";
const terms = { amount: "1000", price: "3.30", network: "TRC20", paymentMethod: "Bank Transfer", city: "" };
const wallet = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";

// The fixture is intentionally destructive only inside the dedicated isolated
// launcher. Ordinary release suites must not run this file against their state.
test.beforeEach(async ({ baseURL }, info) => {
  test.skip(!info.project.name.startsWith("usdt-offline-"), "Use the dedicated offline configuration.");
  await seedOfflineFixture(baseURL!);
});

async function login(api: APIRequestContext, role: keyof typeof OFFLINE_ACCOUNTS) {
  const response = await api.post("/api/auth/login", {
    data: { email: OFFLINE_ACCOUNTS[role].email, password: OFFLINE_PASSWORD, rememberMe: false },
    headers: { "x-forwarded-for": `2001:db8::${randomUUID().slice(0, 4)}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function blockExternalBrowserRequests(context: BrowserContext) {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort("blockedbyclient");
  });
}
async function state(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers: OFFLINE_HEADERS });
  expect(response.ok()).toBe(true);
  return await response.json() as AlphaExchangeDb;
}
async function pasteAmount(input: Locator, text: string) {
  // Exercise the actual paste handler without changing the user's clipboard.
  await input.evaluate((element, pasted) => {
    const field = element as HTMLInputElement;
    field.focus(); field.setSelectionRange(0, field.value.length);
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", pasted);
    field.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, text);
}
async function expectFees(container: Locator, subtotal: string, fee: string, total: string, seller = false) {
  const breakdown = container.getByTestId("fee-breakdown");
  for (const [label, value] of [["Subtotal", subtotal], ["Buyer fee (1%)", fee], [seller ? "Buyer pays in total" : "You pay in total", total]]) {
    await expect(breakdown.getByText(label, { exact: true }).locator("xpath=following-sibling::dd[1]")).toContainText(value);
  }
}
async function createDemand(api: APIRequestContext, amount = "1000") {
  const response = await api.post(root, { data: { terms: { ...terms, amount }, operationId: randomUUID() } });
  expect(response.ok(), await response.text()).toBe(true);
  const { id } = await response.json() as { id: string };
  const detail = await api.get(`${root}/${id}`);
  expect(detail.ok(), await detail.text()).toBe(true);
  return (await detail.json() as DemandWorkspace).requests.find(request => request.id === id)!;
}
async function ageDemandPastCooldown(api: APIRequestContext, id: string) {
  // Only the owned test server is seeded by beforeEach. Age its synthetic
  // record instead of waiting minutes or weakening the real rate limits.
  const snapshot = await state(api);
  const demand = snapshot.usdtDemands!.find(request => request.id === id)!;
  const earlier = new Date(Date.now() - 6 * 60_000).toISOString();
  demand.createdAt = earlier; demand.updatedAt = earlier;
  for (const action of demand.history) action.at = earlier;
  for (const offer of demand.offers) offer.createdAt = earlier;
  const saved = await api.put("/api/testing/alpha-exchange-state", { headers: OFFLINE_HEADERS, data: snapshot });
  expect(saved.ok(), await saved.text()).toBe(true);
}

test("real API enforces the price band, operation replay, ownership and private response views", async ({ playwright, baseURL }) => {
  const buyer = await playwright.request.newContext({ baseURL });
  const seller = await playwright.request.newContext({ baseURL });
  const rival = await playwright.request.newContext({ baseURL });
  try {
    expect((await buyer.get(root)).status()).toBe(401);
    await login(buyer, "buyer"); await login(seller, "seller"); await login(rival, "otherSeller");
    const reference = await (await buyer.get(root)).json() as DemandWorkspace;
    expect(reference.reference).toMatchObject({ price: "3.3", minimum: "2.95", maximum: "3.65" });
    for (const price of ["2.94", "3.66"]) {
      const rejected = await buyer.post(root, { data: { terms: { ...terms, price }, operationId: randomUUID() } });
      expect(rejected.status()).toBe(409);
      expect((await rejected.json()).code).toBe("PRICE_OUTSIDE_BAND");
    }
    const body = { terms: { ...terms, price: "2.95" }, operationId: randomUUID() };
    const first = await buyer.post(root, { data: body }); expect(first.ok(), await first.text()).toBe(true);
    const demand = await first.json();
    const replay = await buyer.post(root, { data: body }); expect((await replay.json()).id).toBe(demand.id);
    const denied = await rival.patch(`${root}/${demand.id}`, { data: { action: "cancel", revision: 1 } });
    expect(denied.status()).toBe(404);
    const offer = await seller.post(`${root}/${demand.id}/offers`, { data: { revision: 1, listingId: "listing-offline-seller", price: "3.65", operationId: randomUUID() } });
    expect(offer.ok(), await offer.text()).toBe(true);
    const rivalView = await (await rival.get(`${root}/${demand.id}`)).json() as DemandWorkspace;
    expect(rivalView.requests[0].offers).toHaveLength(0);
    expect(JSON.stringify(rivalView)).not.toMatch(/example\.test|passwordHash|requesterId|verifiedPhone/);
    const buyerView = await (await buyer.get(`${root}/${demand.id}`)).json() as DemandWorkspace;
    expect(buyerView.requests[0].offers).toHaveLength(1);
    const stored = await state(buyer);
    expect(stored.usdtDemands).toHaveLength(1);
    expect(stored.notifications.filter(n => n.id.startsWith(`demand-notice:${demand.id}:`))).toHaveLength(3);
    expect(stored.notifications.every(n => n.demandEmail?.state !== "queued")).toBe(true);
  } finally { await buyer.dispose(); await seller.dispose(); await rival.dispose(); }
});

test("buyer publishes, seller responds, buyer reviews and the canonical Trade Room opens", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000); // The optional dev mode compiles several existing pages on first use.
  const buyer = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const seller = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockExternalBrowserRequests(buyer); await blockExternalBrowserRequests(seller);
  const buyerPage = await buyer.newPage(); const sellerPage = await seller.newPage();
  try {
    await login(buyer.request, "buyer"); await login(seller.request, "seller");
    await buyerPage.goto("/en/usdt-exchange/requests");
    await expect(buyerPage.getByRole("heading", { name: "Request USDT", exact: true })).toBeVisible();
    await buyerPage.getByRole("button", { name: "Create a request", exact: true }).click();
    const amount = buyerPage.getByLabel("Amount (USDT)", { exact: true });
    await amount.pressSequentially("5000");
    await expect(amount).toHaveValue("5,000");
    await pasteAmount(amount, "5,000");
    await expect(amount).toHaveValue("5,000");
    await buyerPage.getByLabel("Requested price per USDT (ILS)", { exact: true }).fill("3.30");
    await expectFees(buyerPage.getByRole("form", { name: "Request details" }), "16,500.00", "165.00", "16,665.00");
    await buyerPage.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await buyerPage.screenshot({ path: testInfo.outputPath("polished-buyer-form.png"), fullPage: true });
    const publication = buyerPage.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === root);
    await buyerPage.getByRole("button", { name: "Publish request", exact: true }).click();
    expect((await publication).postDataJSON().terms.amount).toBe("5000");
    await expect(buyerPage).toHaveURL(/\/en\/usdt-exchange\/requests\/[^/]+$/);
    const demandId = buyerPage.url().split("/").pop()!;
    await expect(buyerPage.getByTestId("request-card")).toContainText("5,000");
    await expect(buyerPage.getByTestId("offer-card")).toHaveCount(0);
    await expect(buyerPage.getByTestId("next-step-panel")).toBeVisible();
    await buyerPage.evaluate(() => window.scrollTo(0, 0));
    await buyerPage.screenshot({ path: testInfo.outputPath("buyer-request-desktop.png"), fullPage: true });

    await sellerPage.goto(`/en/usdt-exchange/requests/${demandId}`);
    await sellerPage.getByLabel("Your listing", { exact: false }).selectOption("listing-offline-seller");
    await sellerPage.getByLabel("Your response price (ILS)", { exact: true }).fill("3.25");
    await expectFees(sellerPage.getByRole("form", { name: "Seller response" }), "16,250.00", "162.50", "16,412.50", true);
    await sellerPage.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sellerPage.screenshot({ path: testInfo.outputPath("polished-seller-form.png"), fullPage: true });
    await sellerPage.getByRole("button", { name: "Send response", exact: true }).click();
    await expect(sellerPage.getByTestId("offer-card")).toContainText("3.25");
    await expect(sellerPage.getByTestId("next-step-panel")).toBeVisible();
    await sellerPage.evaluate(() => window.scrollTo(0, 0));
    await sellerPage.screenshot({ path: testInfo.outputPath("seller-response-mobile.png"), fullPage: true });
    await sellerPage.screenshot({ path: testInfo.outputPath("seller-response-mobile-viewport.png") });

    await buyerPage.reload();
    await buyerPage.getByRole("button", { name: "Review response", exact: true }).click();
    const review = buyerPage.getByRole("form", { name: "Trade review" });
    await expectFees(review, "16,250.00", "162.50", "16,412.50");
    const receivingWallet = review.getByLabel("Your receiving wallet", { exact: false });
    await receivingWallet.fill("invalid-wallet");
    await expect(receivingWallet).toHaveAttribute("aria-invalid", "true");
    await expect(review.getByRole("button", { name: "Open Trade Room", exact: true })).toBeDisabled();
    await receivingWallet.fill(wallet);
    await buyerPage.getByRole("checkbox", { name: "I checked the amount", exact: false }).check();
    await buyerPage.evaluate(() => window.scrollTo(0, 0));
    await buyerPage.screenshot({ path: testInfo.outputPath("buyer-review-desktop.png"), fullPage: true });
    await buyerPage.getByRole("button", { name: "Open Trade Room", exact: true }).click();
    await expect(buyerPage).toHaveURL(/\/en\/trade-room\/[^/?]+(?:\?.*)?$/);
    const tradeId = new URL(buyerPage.url()).pathname.split("/").pop()!;
    await expect(buyerPage.getByTestId("trade-room-summary")).toBeVisible();
    const stored = await state(buyer.request);
    expect(stored.purchaseRequests).toHaveLength(1);
    expect(stored.purchaseRequests[0]).toMatchObject({ id: tradeId, usdtAmount: "5000", pricePerUsdt: "3.25", fiatAmount: "16412.50", usdtDemandId: demandId, status: "pending" });
    expect(stored.usdtDemands?.[0]).toMatchObject({ state: "matched", purchaseRequestId: tradeId });
    await buyerPage.reload(); await expect(buyerPage.getByTestId("trade-room-summary")).toBeVisible();
    await buyerPage.evaluate(() => window.scrollTo(0, 0));
    await buyerPage.screenshot({ path: testInfo.outputPath("trade-room-desktop.png"), fullPage: true });
    await sellerPage.goto(`/en/trade-room/${tradeId}`);
    await expect(sellerPage.getByTestId("trade-room-summary")).toBeVisible();
    const accepted = await seller.request.patch(`/api/alpha-exchange/purchase-requests/${tradeId}`, { data: { status: "accepted", safetyAcknowledged: true } });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    expect((await accepted.json()).request.status).toBe("accepted");
    const room = await buyer.request.get(`/api/alpha-exchange/trade-room/${tradeId}`);
    expect((await room.json()).request.status).toBe("accepted");
  } finally { await buyer.close(); await seller.close(); }
});

for (const paymentMethod of ["Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"]) {
  test(`${paymentMethod}: real request, response, match and cancellation preserve payment totals`, async ({ playwright, baseURL }) => {
    const buyer = await playwright.request.newContext({ baseURL });
    const seller = await playwright.request.newContext({ baseURL });
    try {
      await login(buyer, "buyer"); await login(seller, "seller");
      const cardless = paymentMethod === "Cardless ATM Withdrawal";
      const amount = cardless ? calculateCardlessUsdtAmount("1000", "3.30", true)! : "1000";
      const requestedTerms = { ...terms, amount, paymentMethod, city: cardless ? "" : "Haifa" };
      const created = await buyer.post(root, { data: { terms: requestedTerms, operationId: randomUUID() } });
      expect(created.ok(), await created.text()).toBe(true);
      const demand = await created.json();
      const response = await seller.post(`${root}/${demand.id}/offers`, { data: { revision: 1, listingId: "listing-offline-seller", price: "3.30", operationId: randomUUID() } });
      expect(response.ok(), await response.text()).toBe(true);
      const offer = await response.json();
      const matchBody = { listingId: "listing-offline-seller", usdtAmount: amount, receivingNetwork: "TRC20", paymentMethod,
        buyerReceivingWalletAddress: wallet, feePolicyVersion: "buyer_seller_1pct_v1", usdtDemandId: demand.id,
        usdtDemandOfferId: offer.id, usdtDemandRevision: 1, safetyAcknowledged: true,
        ...(cardless ? { bankName: "Bank Hapoalim", cardlessWithdrawalCode: "482913", cardlessVerificationKind: "date_of_birth",
          cardlessVerificationValue: "25/08/1995", cardlessIlsAmount: "1000" } : {}) };
      const matched = await buyer.post("/api/alpha-exchange/purchase-requests", { data: matchBody });
      expect(matched.status(), await matched.text()).toBe(201);
      const trade = (await matched.json()).purchase;
      expect(trade).toMatchObject({ usdtAmount: amount, fiatAmount: cardless ? "1000.00" : "3333.00", paymentMethod, status: "pending", usdtDemandId: demand.id });
      const replay = await buyer.post("/api/alpha-exchange/purchase-requests", { data: matchBody });
      expect(replay.status(), await replay.text()).toBe(201);
      expect((await replay.json()).purchase.id).toBe(trade.id);
      expect((await buyer.get(`/api/alpha-exchange/trade-room/${trade.id}`)).status()).toBe(200);
      expect((await seller.get(`/api/alpha-exchange/trade-room/${trade.id}`)).status()).toBe(200);
      const cancelled = await buyer.patch(`/api/alpha-exchange/purchase-requests/${trade.id}`, { data: { status: "cancelled" } });
      expect(cancelled.ok(), await cancelled.text()).toBe(true);
      const view = await (await buyer.get(`${root}/${demand.id}`)).json() as DemandWorkspace;
      expect(view.requests[0].state).toBe("trade_cancelled");
      const stored = await state(buyer);
      expect(stored.purchaseRequests).toHaveLength(1);
      if (cardless) expect(JSON.stringify(stored.purchaseRequests[0])).not.toContain("482913");
    } finally { await buyer.dispose(); await seller.dispose(); }
  });
}

test("Arabic mobile request form renders RTL and publishes through the same API", async ({ page, context }, testInfo) => {
  await blockExternalBrowserRequests(context); await login(page.request, "buyer");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/usdt-exchange/requests");
  await expect(page.locator("main[dir=rtl]")).toBeVisible();
  await page.getByRole("button", { name: "إنشاء طلب", exact: true }).click();
  const amount = page.getByLabel("المبلغ (USDT)", { exact: true });
  await pasteAmount(amount, "٥٬٠٠٠٫١٢");
  await expect(amount).toHaveValue("5,000.12");
  await page.getByLabel("السعر المطلوب لكل USDT (شيكل)", { exact: true }).fill("3.30");
  await page.getByRole("button", { name: "نشر الطلب", exact: true }).click();
  await expect(page).toHaveURL(/\/ar\/usdt-exchange\/requests\/[^/]+$/);
  await expect(page.getByTestId("request-card")).toContainText("5,000.12");
  expect((await state(page.request)).usdtDemands?.[0].amount).toBe("5000.12");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("buyer-request-arabic-mobile.png"), fullPage: true });
});

test("grouped drafts and invalid prices cannot publish, and a fresh quote restores the form", async ({ page, context }) => {
  await blockExternalBrowserRequests(context); await login(page.request, "buyer");
  let quoteAvailable = false;
  await page.route("**/api/alpha-exchange/usdt-requests**", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const workspace = await response.json() as DemandWorkspace;
    await route.fulfill({ response, json: { ...workspace, reference: quoteAvailable ? workspace.reference : null } });
  });
  await page.goto("/en/usdt-exchange/requests");
  await page.getByRole("button", { name: "Create a request", exact: true }).click();
  const form = page.getByRole("form", { name: "Request details" });
  const amount = form.getByLabel("Amount (USDT)", { exact: true });
  const price = form.getByLabel("Requested price per USDT (ILS)", { exact: true });
  const publish = form.getByRole("button", { name: "Publish request", exact: true });
  await pasteAmount(amount, "5,000"); await price.fill("3.30");
  await expect(publish).toBeDisabled();
  await expect(page.getByRole("region", { name: "Price reference" })).toContainText(/fresh|unavailable/i);
  quoteAvailable = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(publish).toBeEnabled();

  await pasteAmount(amount, "5,00");
  await expect(amount).toHaveValue("5,00");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  expect(await amount.evaluate(element => (element as HTMLInputElement).checkValidity())).toBe(false);
  await publish.click();
  await expect(form.getByRole("alert")).toBeVisible();
  expect((await state(page.request)).usdtDemands).toHaveLength(0);
  await pasteAmount(amount, "5,000");
  expect(await amount.evaluate(element => (element as HTMLInputElement).checkValidity())).toBe(true);
  await expect(form.getByRole("alert")).toHaveCount(0);
  await price.fill("3.66");
  await expect(price).toHaveAttribute("aria-invalid", "true");
  await expect(publish).toBeDisabled();
  await expect(form).toContainText("3.65");
  expect((await state(page.request)).usdtDemands).toHaveLength(0);
  await price.fill("3.30");
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.getByTestId("request-card")).toContainText("5,000");
  expect((await state(page.request)).usdtDemands?.[0].amount).toBe("5000");
});

test("seller can update a response, reload its waiting state and confirm withdrawal", async ({ page, context, playwright, baseURL }) => {
  await blockExternalBrowserRequests(context); await login(page.request, "seller");
  const buyer = await playwright.request.newContext({ baseURL });
  try {
    await login(buyer, "buyer");
    const demand = await createDemand(buyer, "5000");
    const offered = await page.request.post(`${root}/${demand.id}/offers`, {
      data: { revision: demand.revision, listingId: "listing-offline-seller", price: "3.25", operationId: randomUUID() },
    });
    expect(offered.ok(), await offered.text()).toBe(true);
    await ageDemandPastCooldown(buyer, demand.id);
    await page.goto(`/en/usdt-exchange/requests/${demand.id}`);
    await expect(page.getByTestId("next-step-panel")).toContainText(/buyer|waiting/i);
    const responseForm = page.getByRole("form", { name: "Seller response" });
    await responseForm.getByLabel("Your listing", { exact: false }).selectOption("listing-offline-seller");
    await responseForm.getByLabel("Your response price (ILS)", { exact: true }).fill("3.20");
    await expectFees(responseForm, "16,000.00", "160.00", "16,160.00", true);
    await responseForm.getByRole("button", { name: "Update response", exact: true }).click();
    const updated = page.getByTestId("offer-card").filter({ hasText: "3.20" });
    await expect(updated).toBeVisible();
    let snapshot = await state(buyer);
    expect(snapshot.usdtDemands?.[0].offers.map(offer => offer.state)).toEqual(["superseded", "open"]);
    await page.reload();
    await expect(page.getByTestId("next-step-panel")).toContainText(/buyer|waiting/i);
    await expect(updated).toBeVisible();
    await updated.getByRole("button", { name: "Withdraw response", exact: true }).click();
    await updated.getByRole("button", { name: "Keep response", exact: true }).click();
    expect((await state(buyer)).usdtDemands?.[0].offers.at(-1)?.state).toBe("open");
    await updated.getByRole("button", { name: "Withdraw response", exact: true }).click();
    await updated.getByRole("button", { name: "Confirm withdrawal", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Response history" }).click();
    await expect(updated).toBeVisible();
    await expect(updated).toContainText(/withdrawn/i);
    snapshot = await state(buyer);
    expect(snapshot.usdtDemands?.[0].offers.at(-1)?.state).toBe("withdrawn");
    expect(snapshot.purchaseRequests).toHaveLength(0);
    await page.reload();
    await page.locator("summary").filter({ hasText: "Response history" }).click();
    await expect(updated).toBeVisible();
    await expect(updated).toContainText(/withdrawn/i);
    const buyerView = await (await buyer.get(`${root}/${demand.id}`)).json() as DemandWorkspace;
    expect(buyerView.requests[0].offers.every(offer => !offer.available)).toBe(true);
  } finally { await buyer.dispose(); }
});

test("a seller without an eligible listing gets a clear path to the prefilled listing form", async ({ page, context, playwright, baseURL }) => {
  await blockExternalBrowserRequests(context); await login(page.request, "seller");
  const buyer = await playwright.request.newContext({ baseURL });
  try {
    await login(buyer, "buyer");
    const demand = await createDemand(buyer, "5000");
    const snapshot = await state(buyer);
    snapshot.marketplaceListings = snapshot.marketplaceListings.filter(listing => listing.sellerId !== OFFLINE_ACCOUNTS.seller.id);
    const saved = await buyer.put("/api/testing/alpha-exchange-state", { headers: OFFLINE_HEADERS, data: snapshot });
    expect(saved.ok(), await saved.text()).toBe(true);
    await page.goto(`/en/usdt-exchange/requests/${demand.id}`);
    await expect(page.getByRole("heading", { name: "No eligible listing yet", exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "Seller response" })).toHaveCount(0);
    await expect(page.getByTestId("next-step-panel")).toBeVisible();
    await page.getByRole("link", { name: "Create a listing for this request", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`demand=${demand.id}#create-listing$`));
    await expect(page.locator("#create-available")).toHaveValue("5,000");
    await expect(page.locator("#create-price")).toHaveValue("3.30");
    await expect(page.locator("#create-network")).toHaveValue("TRC20");
  } finally { await buyer.dispose(); }
});

test("refreshing a changed request clears the seller's stale selection before sending", async ({ page, context, playwright, baseURL }) => {
  await blockExternalBrowserRequests(context); await login(page.request, "seller");
  const buyer = await playwright.request.newContext({ baseURL });
  try {
    await login(buyer, "buyer");
    const demand = await createDemand(buyer);
    await page.goto(`/en/usdt-exchange/requests/${demand.id}`);
    const responseForm = page.getByRole("form", { name: "Seller response" });
    const listing = responseForm.getByLabel("Your listing", { exact: false });
    await listing.selectOption("listing-offline-seller");
    await responseForm.getByLabel("Your response price (ILS)", { exact: true }).fill("3.25");
    await ageDemandPastCooldown(buyer, demand.id);
    const renewed = await buyer.patch(`${root}/${demand.id}`, { data: { action: "renew", revision: demand.revision, terms: { ...terms, amount: "5000" } } });
    expect(renewed.ok(), await renewed.text()).toBe(true);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByTestId("request-card")).toContainText("5,000");
    await expect(listing).toHaveValue("");
    await expect(responseForm.getByRole("button", { name: "Send response", exact: true })).toBeDisabled();
    expect((await state(buyer)).usdtDemands?.[0].offers).toHaveLength(0);
    await listing.selectOption("listing-offline-seller");
    await responseForm.getByLabel("Your response price (ILS)", { exact: true }).fill("3.25");
    const sent = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === `${root}/${demand.id}/offers`);
    await responseForm.getByRole("button", { name: "Send response", exact: true }).click();
    expect((await sent).postDataJSON().revision).toBe(2);
    await expect(page.getByTestId("offer-card")).toContainText("3.25");
    expect((await state(buyer)).usdtDemands?.[0].offers[0].revision).toBe(2);
  } finally { await buyer.dispose(); }
});
