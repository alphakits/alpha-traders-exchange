import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { OFFLINE_ACCOUNTS, OFFLINE_PASSWORD, OFFLINE_HEADERS, seedOfflineFixture } from "../scripts/usdt-request-offline-fixture.mjs";
import type { DemandWorkspace } from "../src/types/usdt-demand";
import { createHardNavigationErrorAudit, unblockedAccountDestinationFeed } from "./support/hard-navigation-errors";
import { clickConfirmedTradeAction } from "./support/action-dialog";

async function ok(response: Pick<APIResponse, "ok" | "status" | "text" | "json">) {
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  return response.json();
}
async function login(api: APIRequestContext, email: string) {
  await ok(await api.post("/api/auth/login", { data: { email, password: OFFLINE_PASSWORD, rememberMe: false },
    headers: { "x-forwarded-for": `2001:db8::${randomUUID().slice(0, 4)}` } }));
}

test("personal Wise USD accounts and Buy Request complete locally with private payment instructions", async ({ page, context, playwright, baseURL, browserName }, info) => {
  const browserErrorAudit = createHardNavigationErrorAudit(browserName);
  browserErrorAudit.observe(page);
  let phase = "fixture setup";
  const pageErrors: Array<{ phase: string; path: string; message: string; stack?: string }> = [];
  page.on("pageerror", error => {
    pageErrors.push({ phase, path: new URL(page.url()).pathname, message: error.message, stack: error.stack?.split("\n").slice(0,16).join("\n") });
  });
  await context.route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort("blockedbyclient"));
  await seedOfflineFixture(baseURL!);
  const state = await ok(await page.request.get("/api/testing/alpha-exchange-state", { headers: OFFLINE_HEADERS }));
  const buyerFixture = state.users.find((user: { id: string }) => user.id === OFFLINE_ACCOUNTS.buyer.id);
  state.users.push({ ...buyerFixture, id: "offline-wise-reviewer", email: "reviewer@offline.example.test", fullName: "Demo Reviewer",
    role: "admin", roles: ["admin"], verifiedPhone: "+972500009099", whatsappNumber: "+972500009099" });
  await ok(await page.request.put("/api/testing/alpha-exchange-state", { headers: OFFLINE_HEADERS, data: state }));
  const seller = await playwright.request.newContext({ baseURL });
  const reviewer = await playwright.request.newContext({ baseURL });
  const outsider = await playwright.request.newContext({ baseURL });
  try {
    await login(page.request, OFFLINE_ACCOUNTS.buyer.email);
    await login(seller, OFFLINE_ACCOUNTS.seller.email);
    await login(reviewer, "reviewer@offline.example.test");
    await login(outsider, OFFLINE_ACCOUNTS.otherBuyer.email);
    const makeAccount = async (api: APIRequestContext, accountHolderName: string, accountNumber: string) => {
      const created = await ok(await api.post("/api/alpha-exchange/wise-accounts", { data: {
        provider: "wise", currency: "USD", countryCode: "US", accountHolderType: "personal", accountType: "checking",
        accountHolderName, bankName: "Synthetic Test Bank", bankAddress: "1 Example Street, Test City, US",
        routingNumber: "021000021", accountNumber,
      } }));
      expect(created.account.ownershipReviewStatus).toBe("pending_review");
      expect(JSON.stringify(created)).not.toContain(accountNumber);
      return created.account.id as string;
    };
    phase = "account settings";
    await page.goto("/en/settings?tab=profile#wise-accounts");
    const buyerAccountForm = page.getByRole("region", { name: "Personal Wise accounts · USD", exact: true });
    await buyerAccountForm.getByLabel("Legal account holder name", { exact: true }).fill("Demo Buyer");
    await buyerAccountForm.getByLabel("Bank name shown in Wise", { exact: true }).fill("Synthetic Test Bank");
    await buyerAccountForm.getByLabel("ACH routing number (9 digits)", { exact: true }).fill("021000021");
    await buyerAccountForm.getByLabel("Account number", { exact: true }).fill("00001001001");
    await buyerAccountForm.getByLabel("Bank address (optional)", { exact: true }).fill("1 Example Street, Test City, US");
    const accountSaved = page.waitForResponse(response => response.url().endsWith("/api/alpha-exchange/wise-accounts") && response.request().method() === "POST");
    await buyerAccountForm.getByRole("button", { name: "Save for review", exact: true }).click();
    const buyerCreated = await ok(await accountSaved);
    expect(buyerCreated.account.ownershipReviewStatus).toBe("pending_review");
    expect(JSON.stringify(buyerCreated)).not.toContain("00001001001");
    const buyerAccount = buyerCreated.account.id as string;
    await expect(buyerAccountForm.getByText("Ownership review pending", { exact: true })).toBeVisible();
    await buyerAccountForm.screenshot({ path: info.outputPath("wise-usd-account.png") });
    const sellerAccount = await makeAccount(seller, "Demo Seller", "00002002002");
    const queue = await ok(await reviewer.get("/api/alpha-exchange/admin/wise-accounts"));
    for (const entry of queue.accounts) {
      await ok(await reviewer.patch("/api/alpha-exchange/admin/wise-accounts", { data: {
        userId: entry.userId, accountId: entry.id, decision: "approve", expectedReviewVersion: entry.reviewVersion,
        evidenceReference: `synthetic-local-document:${entry.id}`, verifiedAccountHolderName: entry.accountHolderName, identityMatched: true,
      } }));
    }
    const created = await ok(await seller.post("/api/alpha-exchange/listings", { data: {
      availableAmount: "10000", price: "1.00", currency: "USD", network: "TRC20", paymentMethods: ["Bank Transfer"],
      bankTransferProvider: "wise", wiseAccountId: sellerAccount, minimumTrade: "100", maximumTrade: "10000",
      responseTime: "5 min", expirationHours: 24, acceptedCommissionPolicy: true,
    } }));
    const listingId = created.listing.id as string;
    await ok(await reviewer.patch(`/api/alpha-exchange/admin/listings/${listingId}`, { data: { action: "approve" } }));
    const publicListings = await ok(await outsider.get("/api/alpha-exchange/listings"));
    expect(JSON.stringify(publicListings)).not.toContain("00002002002");
    expect(JSON.stringify(publicListings)).not.toContain("00001001001");

    phase = "request creation";
    await page.goto("/en/usdt-exchange/requests");
    await page.getByRole("button", { name: "Create a request", exact: true }).click();
    await page.getByLabel("Bank transfer provider", { exact: true }).selectOption("wise");
    await page.getByLabel("Amount (USDT)", { exact: true }).fill("1000");
    await page.getByLabel("Requested price per USDT (USD)", { exact: true }).fill("1.00");
    await expect(page.getByTestId("fee-breakdown")).toContainText("USD 1,010.00");
    await expect(page.getByLabel(/transaction reason|transaction purpose/i)).toHaveCount(0);
    await page.getByRole("form", { name: "Request details", exact: true }).screenshot({ path: info.outputPath("wise-usd-request.png") });
    const published = page.waitForResponse(response => response.url().endsWith("/api/alpha-exchange/usdt-requests") && response.request().method() === "POST");
    phase = "publish request";
    await page.getByRole("button", { name: "Publish request", exact: true }).click();
    const demand = await ok(await published);
    // Publication responds before router.push and the new workspace's first
    // fetch finish. Observe the user's destination before initiating another
    // document navigation; otherwise those two transitions overlap in WebKit.
    await expect(page).toHaveURL(new RegExp(`/en/usdt-exchange/requests/${demand.id}$`));
    const publishedCard = page.getByTestId("request-card");
    await expect(publishedCard).toHaveCount(1);
    await expect(publishedCard.getByRole("heading", { name: /1,000\s+USDT/ })).toBeVisible();
    await expect(publishedCard).toContainText("USD 1.00");
    await expect(publishedCard).toContainText(/Bank Transfer.*Wise.*USD/);
    await expect(page.getByRole("region", { name: "Seller responses", exact: true })).toBeVisible();
    const publishedWorkspace = await ok(await page.request.get(`/api/alpha-exchange/usdt-requests/${demand.id}`));
    const revision = publishedWorkspace.requests.find((entry: { id: string }) => entry.id === demand.id).revision;
    const offered = await ok(await seller.post(`/api/alpha-exchange/usdt-requests/${demand.id}/offers`, { data: {
      listingId, revision, price: "1.00", operationId: randomUUID(),
    } }));
    // The hard navigation can cancel the departing document's demand refresh.
    // Retain WebKit's exact native diagnostic only if the newly committed
    // document proves the same owner's Wise request and the seller's new offer.
    phase = "reload request with seller response";
    await browserErrorAudit.navigate(page, () => page.goto(`/en/usdt-exchange/requests/${demand.id}?offer=${offered.id}`), {
      url: new URL(`/api/alpha-exchange/usdt-requests/${demand.id}`, baseURL).href,
      label: "same Wise demand workspace",
      validateBody: body => {
        const next = body as Partial<DemandWorkspace> | null;
        const request = next?.requests?.[0];
        if (!request) return false;
        return next?.actorId === OFFLINE_ACCOUNTS.buyer.id && next?.requests?.length === 1
          && request.id === demand.id && request.revision === revision && request.isMine
          && request.currency === "USD" && request.bankTransferProvider === "wise"
          && request.offers.some(offer => offer.id === offered.id && offer.price === "1.00" && offer.state === "open" && offer.available);
      },
    });
    phase = "review response";
    await page.getByRole("button", { name: "Review response", exact: true }).click();
    await page.getByLabel("Your personal Wise account for sending USD", { exact: true }).selectOption(buyerAccount);
    await page.getByLabel(/Your receiving wallet/).fill("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE");
    await page.getByRole("checkbox", { name: /I checked the amount/ }).check();
    await expect(page.getByRole("region", { name: "Your final payment" })).toContainText("USD 1,010.00");
    await page.getByRole("form", { name: "Trade review", exact: true }).screenshot({
      path: info.outputPath("wise-usd-review.png"), style: ".alpha-site-header { visibility: hidden !important; }",
    });
    const matching = page.waitForResponse(response => response.url().endsWith("/api/alpha-exchange/purchase-requests") && response.request().method() === "POST");
    phase = "open Trade Room";
    await page.getByRole("button", { name: "Open Trade Room", exact: true }).click();
    const matched = await ok(await matching);
    const trade = matched.purchase;
    await expect(page).toHaveURL(new RegExp(`/trade-room/${trade.id}`));
    expect(trade.currency).toBe("USD");
    expect(trade.bankTransferProvider).toBe("wise");
    expect(JSON.stringify(matched)).not.toContain("00002002002");
    expect(JSON.stringify(matched)).not.toContain("00001001001");
    const path = `/api/alpha-exchange/purchase-requests/${trade.id}`;
    const deniedDetails = await outsider.post(`/api/alpha-exchange/trade-room/${trade.id}/bank-details`);
    expect([400, 403, 404]).toContain(deniedDetails.status());
    expect(await deniedDetails.text()).not.toContain("00002002002");
    const premature = await seller.patch(path, { data: { status: "usdt_release_pending" } });
    expect(premature.ok()).toBe(false);
    await ok(await seller.patch(path, { data: { status: "accepted", safetyAcknowledged: true } }));
    phase = "reload accepted Trade Room";
    // The departing document can cancel its account-safety read in WebKit.
    // Preserve that exact native diagnostic only if the new main document
    // reads the same counterparty and proves the expected unblocked state.
    await browserErrorAudit.navigate(page, () => page.reload(), unblockedAccountDestinationFeed(
      new URL(`/api/alpha-exchange/user-blocks/${OFFLINE_ACCOUNTS.seller.id}`, baseURL).href,
    ));
    await expect(page.getByRole("button", { name: "Reveal Bank Details", exact: true })).toBeVisible();
    phase = "reveal payment instructions";
    await clickConfirmedTradeAction(page, page.getByRole("button", { name: "Reveal Bank Details", exact: true }));
    await expect(page.getByText("00002002002", { exact: true })).toBeVisible();
    await expect(page.getByText("00001001001", { exact: true })).toBeVisible();
    await expect(page.getByText("ACH routing number", { exact: false })).toBeVisible();
    await page.screenshot({ path: info.outputPath("wise-usd-trade.png"), fullPage: true });
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";
    const evidence = async (api: APIRequestContext, side: "buyer" | "seller") => ok(await api.post(`${path}/evidence`, { data: {
      side, fileName: `${side}-synthetic-proof.png`, mimeType: "image/png", sizeBytes: Buffer.from(png, "base64").length, fileData: `data:image/png;base64,${png}`,
    } }));
    phase = "complete trade and verify final state";
    expect((await evidence(page.request, "buyer")).request.status).toBe("payment_sent");
    for (const status of ["funds_received", "usdt_release_pending"]) await ok(await seller.patch(path, { data: { status } }));
    expect((await evidence(seller, "seller")).request.status).toBe("usdt_sent");
    expect((await ok(await seller.patch(path, { data: { action: "complete_trade" } }))).request.status).toBe("review_open");
    await seller.patch(path, { data: { action: "complete_trade" } });
    const final = await ok(await page.request.get("/api/testing/alpha-exchange-state", { headers: OFFLINE_HEADERS }));
    expect(final.marketplaceListings.find((listing: { id: string }) => listing.id === listingId).availableAmount).toBe("9000");
    const commissions = final.commissionRecords.filter((commission: { purchaseRequestId: string }) => commission.purchaseRequestId === trade.id);
    expect(commissions).toHaveLength(1);
    expect(commissions[0]).toMatchObject({ sellerFeeAmount: 10, buyerFeeCollectedAmount: 10, commissionAmount: 20, grossAmount: 1010, grossCurrency: "USD" });
    expect(final.usdtDemands.find((entry: { id: string }) => entry.id === demand.id).state).toBe("matched");
    expect(browserErrorAudit.errors, JSON.stringify({ pageErrors, audit: browserErrorAudit.report() }, null, 2)).toEqual([]);
  } finally {
    await info.attach("browser-error-audit", { body: JSON.stringify({ pageErrors, audit: browserErrorAudit.report() }, null, 2), contentType: "application/json" });
    await seller.dispose(); await reviewer.dispose(); await outsider.dispose();
  }
});
