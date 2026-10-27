import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type TestInfo } from "@playwright/test";
import sharp from "sharp";
import { OFFLINE_ACCOUNTS, OFFLINE_HEADERS, OFFLINE_PASSWORD, seedOfflineFixture } from "../scripts/usdt-request-offline-fixture.mjs";
import type { AlphaExchangeDb, PurchaseRequest } from "../src/types/alpha-exchange";
import type { DemandWorkspace } from "../src/types/usdt-demand";
import { calculateCardlessUsdtAmount, calculateTradePaymentTotal } from "@alpha-traders/contracts";
import { createHardNavigationErrorAudit } from "./support/hard-navigation-errors";

const axePath = createRequire(`${process.cwd()}/package.json`).resolve("axe-core/axe.min.js");

const root = "/api/alpha-exchange/usdt-requests";
const terms = { amount: "1000", price: "3.30", network: "TRC20", paymentMethod: "Bank Transfer", city: "" };
const wallet = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
let browserErrorAudit: ReturnType<typeof createHardNavigationErrorAudit>;

// The fixture is intentionally destructive only inside the dedicated isolated
// launcher. Ordinary release suites must not run this file against their state.
test.beforeEach(async ({ baseURL, request, browserName }, info) => {
  browserErrorAudit = createHardNavigationErrorAudit(browserName);
  test.skip(!info.project.name.startsWith("usdt-offline-"), "Use the dedicated offline configuration.");
  // Fresh identities isolate account rate-limit windows between cases without
  // relaxing or bypassing any real per-account request limit.
  await seedOfflineFixture(baseURL!, { accountNamespace: randomUUID() });
  await expect.poll(async () => (await (await request.get("/api/alpha-exchange/market-rate")).json()).market.pairs.usdtIls,
    { message: "The isolated quote reset must reach the actual market service", timeout: 15_000 }).toMatchObject({ price: 3.3, quoteStatus: "live" });
});
test.afterEach(async ({}, info) => {
  await info.attach("browser-error-audit", { body: JSON.stringify(browserErrorAudit.report(), null, 2), contentType: "application/json" });
  expect(browserErrorAudit.errors, "No uncaught browser application errors in any buyer, seller or profile tab").toEqual([]);
});

async function login(api: APIRequestContext, role: keyof typeof OFFLINE_ACCOUNTS) {
  const response = await api.post("/api/auth/login", {
    data: { email: OFFLINE_ACCOUNTS[role].email, password: OFFLINE_PASSWORD, rememberMe: false },
    headers: { "x-forwarded-for": `2001:db8::${randomUUID().slice(0, 4)}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function blockExternalBrowserRequests(context: BrowserContext) {
  const observePage = (page: import("@playwright/test").Page) => {
    browserErrorAudit.observe(page);
  };
  for (const page of context.pages()) observePage(page);
  context.on("page", observePage);
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
  await expectGreenMoney(breakdown);
}
async function renderedColors(element: Locator) {
  // Test the browser's rendered color rather than a particular CSS class.
  // Canvas also resolves modern CSS color syntax to comparable sRGB channels.
  const measure = () => element.evaluate(node => {
    // Responsive hydration can replace a locator's resolved element before
    // evaluate runs. Detached nodes have empty computed styles, not UI colors.
    if (!node.isConnected || node.getClientRects().length === 0) return null;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = "#000"; context.fillRect(0, 0, 1, 1);
    const ancestry: Element[] = [];
    for (let parent: Element | null = node; parent; parent = parent.parentElement) ancestry.unshift(parent);
    for (const parent of ancestry) {
      context.fillStyle = getComputedStyle(parent).backgroundColor; context.fillRect(0, 0, 1, 1);
    }
    const background = Array.from(context.getImageData(0, 0, 1, 1).data);
    context.fillStyle = getComputedStyle(node).color; context.fillRect(0, 0, 1, 1);
    const rgba = Array.from(context.getImageData(0, 0, 1, 1).data);
    const luminance = (channels: number[]) => channels.slice(0, 3).reduce((sum, channel, index) => {
      const value = channel / 255;
      return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
    }, 0);
    const foregroundLuminance = luminance(rgba); const backgroundLuminance = luminance(background);
    return { rgba, background, contrast: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05) };
  });
  let colors = await measure();
  if (colors === null) {
    await expect.poll(async () => {
      colors = await measure();
      return colors !== null;
    }, { message: "Measure the current connected, visible control after responsive hydration", timeout: 5_000 }).toBe(true);
  }
  return colors!;
}
async function expectGreenText(element: Locator) {
  const { rgba: [red, green, blue, alpha], contrast } = await renderedColors(element);
  expect(green, "Money is visibly green, including inherited text colors").toBeGreaterThan(red + 30);
  expect(green).toBeGreaterThan(blue + 15);
  expect(green, "Money stays bright against the dark form background").toBeGreaterThanOrEqual(150);
  expect(alpha).toBe(255);
  expect(contrast, "Money is legible against its composited solid background").toBeGreaterThanOrEqual(4.5);
}
async function expectBlueAction(element: Locator) {
  const { background: [red, green, blue], contrast } = await renderedColors(element);
  expect(blue, "Primary actions use a blue surface").toBeGreaterThan(red + 35);
  expect(blue).toBeGreaterThan(green + 20);
  expect(contrast, "Blue action labels stay readable").toBeGreaterThanOrEqual(4.5);
  let bounds = await element.boundingBox();
  if (bounds === null) {
    await expect.poll(async () => {
      bounds = await element.boundingBox();
      return bounds !== null;
    }, { message: "Measure current action geometry after responsive hydration", timeout: 5_000 }).toBe(true);
  }
  expect(bounds).not.toBeNull();
  expect(bounds!.height, "Actions preserve a usable touch target").toBeGreaterThanOrEqual(44);
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
}
async function expectBlueText(element: Locator) {
  const { rgba: [red, green, blue], contrast } = await renderedColors(element);
  expect(blue, "Navigation and current-step accents are blue").toBeGreaterThan(red + 30);
  expect(blue).toBeGreaterThan(green + 15);
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}
async function expectGreenMoney(container: Locator) {
  const values = container.locator("bdi").filter({ hasText: /[₪$]\s*\d/ });
  expect(await values.count(), "The checked section contains actual currency values").toBeGreaterThan(0);
  for (const value of await values.all()) await expectGreenText(value);
}
async function expectReadableSelectPaint(select: Locator, info: TestInfo, name: string) {
  // Native select painting can ignore the CSS background in WebKit. Measure
  // rendered pixels, not just the computed styles used by the color helpers.
  // Measurement setup runs after native-focus assertions; it must not be used
  // to make those interaction checks pass.
  await select.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
  await expect.poll(() => select.evaluate(node => {
    const rect = node.getBoundingClientRect(); const y = rect.top + rect.height / 2;
    return [rect.left + 8, rect.right - 8].every(x => {
      const hit = document.elementFromPoint(x, y);
      return hit === node || (hit !== null && node.contains(hit));
    });
  }), { message: "Select paint samples are not covered by fixed navigation" }).toBe(true);
  const bounds = await select.boundingBox();
  expect(bounds).not.toBeNull();
  const screenshot = await select.screenshot();
  await info.attach(name, { body: screenshot, contentType: "image/png" });
  const { data, info: pixels } = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const foreground = await select.evaluate(node => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = getComputedStyle(node).color; context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  });
  const luminance = (channels: number[]) => channels.slice(0, 3).reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  expect(foreground[3], "Enabled selection text is opaque").toBe(255);
  // Both padding edges are outside the label and chevron, in LTR and RTL.
  for (const cssX of [8, bounds!.width - 8]) {
    const x = Math.min(pixels.width - 1, Math.round(cssX / bounds!.width * pixels.width));
    const y = Math.floor(pixels.height / 2);
    const background = Array.from(data.subarray((y * pixels.width + x) * pixels.channels, (y * pixels.width + x) * pixels.channels + 3));
    expect(Math.max(...background), "Native select surface stays dark in the actual screenshot").toBeLessThan(100);
    const light = luminance(foreground); const dark = luminance(background);
    expect((Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05), "Selected text contrasts with its actual painted surface").toBeGreaterThanOrEqual(4.5);
  }
}
async function expectTextFits(element: Locator) {
  expect(await element.evaluate(node => {
    const bounds = node.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(node);
    return Array.from(range.getClientRects()).every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1);
  }), "Rendered text must wrap within its own container, even when the page clips horizontal overflow").toBe(true);
}
async function expectVisibleTextFits(element: Locator) {
  expect(await element.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      if (!textNode.textContent?.trim() || textNode.parentElement?.closest('.sr-only,[aria-hidden="true"]')) continue;
      const range = document.createRange(); range.selectNodeContents(textNode);
      if (Array.from(range.getClientRects()).some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) return false;
    }
    return true;
  }), "Every visible identity label fits at the actual rendered text bounds").toBe(true);
}
async function expectFocusedControlUnobscured(control: Locator) {
  await expect(control).toBeFocused();
  await expect.poll(() => control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    if (document.activeElement !== element) return "focus moved";
    if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0
      || rect.right > innerWidth || rect.bottom > innerHeight) return "focused control is outside the viewport";
    const inset = Math.min(8, rect.width / 4, rect.height / 4);
    const points = [[rect.left + inset, rect.top + inset], [rect.right - inset, rect.top + inset],
      [rect.left + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset],
      [rect.left + rect.width / 2, rect.top + rect.height / 2]];
    return points.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit === element || (hit !== null && element.contains(hit));
    }) ? "unobscured" : "focused control is covered by another element";
  }), { message: "Keyboard focus remains fully visible and usable above fixed navigation", timeout: 10_000 }).toBe("unobscured");
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

async function setSyntheticQuote(api: APIRequestContext, price: string, mode: "live" | "unavailable" | "stale" = "live") {
  const changed = await api.put(`/__usdt-offline-quote?price=${price}&mode=${mode}`, { headers: OFFLINE_HEADERS });
  expect(changed.ok(), await changed.text()).toBe(true);
  const quote = expect.poll(async () => (await (await api.get(root)).json() as DemandWorkspace).reference,
    { message: "Wait for the real server quote cache to observe the synthetic provider", timeout: 15_000 });
  if (mode === "live") await quote.toMatchObject({ price: String(Number(price)) });
  else await quote.toBe(null);
}

async function matchDemand(api: APIRequestContext, demandId: string, offerId: string, revision = 1, extra: Record<string, unknown> = {}) {
  return api.post("/api/alpha-exchange/purchase-requests", { data: {
    listingId: "listing-offline-seller", usdtAmount: "1000", receivingNetwork: "TRC20", paymentMethod: "Bank Transfer",
    buyerReceivingWalletAddress: wallet, feePolicyVersion: "buyer_seller_1pct_v1", usdtDemandId: demandId,
    usdtDemandOfferId: offerId, usdtDemandRevision: revision, safetyAcknowledged: true, ...extra,
  } });
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
    expect(buyerView.requests[0].requester).toMatchObject({ accountId: expect.stringMatching(/^AT-\d{6,7}$/), profileHref: expect.stringMatching(/^\/u\/seller-[a-f0-9]+$/), approvedSeller: false, sellerRank: null, completedPurchases: 0 });
    expect(buyerView.requests[0].offers[0].seller).toMatchObject({ accountId: expect.stringMatching(/^AT-\d{6,7}$/), profileHref: expect.stringMatching(/^\/u\/seller-[a-f0-9]+$/), approvedSeller: true, sellerRank: "bronze" });
    expect(JSON.stringify(buyerView)).not.toMatch(/Demo Buyer|Demo Seller|example\.test|passwordHash|verifiedPhone|90000900/);
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
    await expectBlueAction(buyerPage.getByRole("button", { name: "Create a request", exact: true }));
    await expectBlueAction(buyerPage.getByRole("button", { name: "My buying requests", exact: true }));
    await expectBlueText(buyerPage.getByRole("list", { name: "Request steps" }).locator('[aria-current="step"]'));
    await buyerPage.getByRole("button", { name: "Create a request", exact: true }).click();
    const amount = buyerPage.getByLabel("Amount (USDT)", { exact: true });
    await amount.pressSequentially("5000");
    await expect(amount).toHaveValue("5,000");
    await pasteAmount(amount, "5,000");
    await expect(amount).toHaveValue("5,000");
    await buyerPage.getByLabel("Requested price per USDT (ILS)", { exact: true }).fill("3.30");
    await expectGreenText(amount);
    await expectGreenText(buyerPage.getByLabel("Requested price per USDT (ILS)", { exact: true }));
    await expectGreenMoney(buyerPage.getByRole("region", { name: "Price reference" }));
    await expectFees(buyerPage.getByRole("form", { name: "Request details" }), "16,500.00", "165.00", "16,665.00");
    await expectBlueAction(buyerPage.getByRole("button", { name: "Publish request", exact: true }));
    await buyerPage.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await buyerPage.screenshot({ path: testInfo.outputPath("polished-buyer-form.png"), fullPage: true });
    const publication = buyerPage.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === root);
    await buyerPage.getByRole("button", { name: "Publish request", exact: true }).click();
    expect((await publication).postDataJSON().terms.amount).toBe("5000");
    await expect(buyerPage).toHaveURL(/\/en\/usdt-exchange\/requests\/[^/]+$/);
    const demandId = buyerPage.url().split("/").pop()!;
    await expect(buyerPage.getByTestId("request-card")).toContainText("5,000");
    await expectGreenMoney(buyerPage.getByTestId("request-card"));
    const buyerIdentity = buyerPage.getByTestId("request-card").getByTestId("request-counterparty-identity");
    await expect(buyerIdentity).toContainText(/AT-\d{6,7}/);
    await expect(buyerIdentity).toContainText("0 completed purchases");
    await expect(buyerIdentity.getByText("Bronze Buyer", { exact: true })).toBeVisible();
    await expect(buyerIdentity.getByRole("progressbar", { name: "Buyer rank progress" })).toHaveAttribute("aria-valuenow", "0");
    await expect(buyerIdentity).not.toContainText("Demo Buyer");
    const buyerProfileLink = buyerIdentity.getByRole("link", { name: /^View profile:/ });
    await expect(buyerProfileLink).toHaveAttribute("href", /^\/en\/u\/seller-[a-f0-9]+$/);
    const buyerProfileOpened = buyerPage.waitForEvent("popup"); await buyerProfileLink.click();
    const buyerProfile = await buyerProfileOpened;
    await buyerProfile.waitForLoadState("domcontentloaded");
    await expect(buyerProfile).toHaveURL(/\/en\/u\/seller-[a-f0-9]+$/);
    await expect(buyerProfile.getByRole("main")).toContainText(/AT-\d{6,7}/);
    await buyerProfile.close();
    await expect(buyerPage.getByTestId("offer-card")).toHaveCount(0);
    await expect(buyerPage.getByTestId("next-step-panel")).toBeVisible();
    await buyerPage.evaluate(() => window.scrollTo(0, 0));
    await buyerPage.screenshot({ path: testInfo.outputPath("buyer-request-desktop.png"), fullPage: true });

    await sellerPage.goto(`/en/usdt-exchange/requests/${demandId}`);
    await sellerPage.getByLabel("Your listing", { exact: false }).selectOption("listing-offline-seller");
    await sellerPage.getByLabel("Your response price (ILS)", { exact: true }).fill("3.25");
    await expectGreenText(sellerPage.getByLabel("Your response price (ILS)", { exact: true }));
    await expectGreenText(sellerPage.getByLabel("Your listing", { exact: false }));
    await expectGreenMoney(sellerPage.getByRole("form", { name: "Seller response" }));
    await expectFees(sellerPage.getByRole("form", { name: "Seller response" }), "16,250.00", "162.50", "16,412.50", true);
    await expectBlueAction(sellerPage.getByRole("button", { name: "Send response", exact: true }));
    await sellerPage.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sellerPage.screenshot({ path: testInfo.outputPath("polished-seller-form.png"), fullPage: true });
    await sellerPage.getByRole("button", { name: "Send response", exact: true }).click();
    await expect(sellerPage.getByTestId("offer-card")).toContainText("3.25");
    await expectGreenMoney(sellerPage.getByTestId("offer-card"));
    await expect(sellerPage.getByTestId("next-step-panel")).toBeVisible();
    await sellerPage.evaluate(() => window.scrollTo(0, 0));
    await sellerPage.screenshot({ path: testInfo.outputPath("seller-response-mobile.png"), fullPage: true });
    await sellerPage.screenshot({ path: testInfo.outputPath("seller-response-mobile-viewport.png") });

    const beforeReloadResponse = await buyer.request.get(`${root}/${demandId}`);
    expect(beforeReloadResponse.status()).toBe(200);
    const beforeReload = await beforeReloadResponse.json() as DemandWorkspace;
    expect(beforeReload.actorId).toBeTruthy();
    expect(beforeReload.requests[0]).toMatchObject({ id: demandId, revision: 1, isMine: true });
    expect(beforeReload.requests[0].offers).toHaveLength(1);
    const expectedOfferId = beforeReload.requests[0].offers[0].id;
    // WebKit can report a native fetch refusal before a hard reload commits,
    // despite the workspace catching the cancelled fetch. Accept only that
    // exact old demand endpoint, retain the diagnostic, and prove the new
    // document fetched the same actor/revision and newly submitted offer.
    await browserErrorAudit.navigate(buyerPage, () => buyerPage.reload(), {
      url: new URL(`${root}/${demandId}`, baseURL).href,
      label: "same-demand workspace",
      validateBody: (body) => {
        const next = body as Partial<DemandWorkspace> | null;
        const request = next?.requests?.[0];
        return next?.actorId === beforeReload.actorId && next?.requests?.length === 1
          && request?.id === demandId && request.revision === 1 && request.isMine
          && request.offers.some(offer => offer.id === expectedOfferId && offer.price === "3.25" && offer.state === "open");
      },
    });
    const sellerIdentity = buyerPage.getByTestId("offer-card").getByTestId("request-counterparty-identity");
    await expect(sellerIdentity).toContainText("Approved Seller");
    await expect(sellerIdentity.getByText("Bronze Seller", { exact: true })).toBeVisible();
    await expect(sellerIdentity.getByText("Bronze Buyer", { exact: true })).toBeVisible();
    await expect(sellerIdentity).toContainText("0 completed purchases");
    await expect(sellerIdentity).not.toContainText("Demo Seller");
    const sellerProfileLink = sellerIdentity.getByRole("link", { name: /^View profile:/ });
    const sellerProfileOpened = buyerPage.waitForEvent("popup"); await sellerProfileLink.click();
    const sellerProfile = await sellerProfileOpened;
    await sellerProfile.waitForLoadState("domcontentloaded");
    await expect(sellerProfile).toHaveURL(/\/en\/u\/seller-[a-f0-9]+$/);
    await expect(sellerProfile.getByRole("main")).toContainText(/AT-\d{6,7}/);
    await sellerProfile.close();
    await expectBlueAction(buyerPage.getByRole("button", { name: "Review response", exact: true }));
    await buyerPage.getByRole("button", { name: "Review response", exact: true }).click();
    const review = buyerPage.getByRole("form", { name: "Trade review" });
    await expectFees(review, "16,250.00", "162.50", "16,412.50");
    const receivingWallet = review.getByLabel("Your receiving wallet", { exact: false });
    await receivingWallet.fill("invalid-wallet");
    await expect(receivingWallet).toHaveAttribute("aria-invalid", "true");
    await expect(review.getByRole("button", { name: "Open Trade Room", exact: true })).toBeDisabled();
    await receivingWallet.fill(wallet);
    await buyerPage.getByRole("checkbox", { name: "I checked the amount", exact: false }).check();
    await expectBlueAction(buyerPage.getByRole("button", { name: "Open Trade Room", exact: true }));
    await expectBlueText(buyerPage.getByRole("list", { name: "Request steps" }).locator('[aria-current="step"]'));
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

test("buyer and seller buyer-rank progress uses completed purchases and stays private and readable at 320px", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const buyer = await browser.newContext({ baseURL, viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
  const seller = await browser.newContext({ baseURL, viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
  await blockExternalBrowserRequests(buyer); await blockExternalBrowserRequests(seller);
  try {
    await login(buyer.request, "buyer"); await login(seller.request, "seller");
    const demand = await createDemand(buyer.request);
    const offered = await seller.request.post(`${root}/${demand.id}/offers`, { data: { revision: 1, listingId: "listing-offline-seller", price: "3.30", operationId: randomUUID() } });
    expect(offered.ok(), await offered.text()).toBe(true);
    const snapshot = await state(buyer.request);
    const buyerUser = snapshot.users.find(user => user.email === OFFLINE_ACCOUNTS.buyer.email)!;
    const sellerUser = snapshot.users.find(user => user.email === OFFLINE_ACCOUNTS.seller.email)!;
    const otherBuyer = snapshot.users.find(user => user.email === OFFLINE_ACCOUNTS.otherBuyer.email)!;
    const otherSeller = snapshot.users.find(user => user.email === OFFLINE_ACCOUNTS.otherSeller.email)!;
    const past = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const history = (buyerId: string, sellerId: string, amount: string, status: PurchaseRequest["status"], completed = status === "completed"): PurchaseRequest => ({
      id: `offline-history-${randomUUID()}`, buyerId, sellerId, listingId: sellerId === sellerUser.id ? "listing-offline-seller" : "listing-offline-seller-two",
      buyerName: snapshot.users.find(user => user.id === buyerId)!.fullName, usdtAmount: amount, pricePerUsdt: "3.30",
      fiatAmount: calculateTradePaymentTotal(amount, "3.30", true)!, currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer",
      timeline: [], status, createdAt: past, updatedAt: past, completedAt: completed ? past : undefined,
    });
    // Seed only this isolated case's canonical purchase history, never cached rank
    // labels. Sales, pending and uncompleted terminal-looking states must not count.
    snapshot.purchaseRequests.push(
      history(buyerUser.id, otherSeller.id, "15000", "completed"),
      history(buyerUser.id, otherSeller.id, "7500", "review_open", true),
      history(sellerUser.id, otherSeller.id, "52500", "completed"),
      history(otherBuyer.id, sellerUser.id, "150000", "completed"),
      history(buyerUser.id, otherSeller.id, "500000", "pending"),
      history(buyerUser.id, otherSeller.id, "500000", "review_open", false),
      history(sellerUser.id, otherSeller.id, "500000", "cancelled"),
    );
    const saved = await buyer.request.put("/api/testing/alpha-exchange-state", { headers: OFFLINE_HEADERS, data: snapshot });
    expect(saved.ok(), await saved.text()).toBe(true);
    const projected = (await (await buyer.request.get(`${root}/${demand.id}`)).json() as DemandWorkspace).requests[0];
    expect(projected.requester).toMatchObject({ completedPurchases: 2, buyerProgress: { rank: "silver", nextRank: "gold", progressPercent: 21.43 } });
    expect(projected.offers[0].seller).toMatchObject({ approvedSeller: true, sellerRank: "diamond", completedPurchases: 1,
      buyerProgress: { rank: "gold", nextRank: "diamond", progressPercent: 2.5 } });
    for (const identity of [projected.requester!, projected.offers[0].seller!]) {
      expect(Object.keys(identity.buyerProgress!).sort()).toEqual(["nextRank", "progressPercent", "rank"]);
    }
    const publicSellerView = (await (await seller.request.get(`${root}/${demand.id}`)).json() as DemandWorkspace).requests[0];
    expect(publicSellerView.requester).toMatchObject({ completedPurchases: 2, buyerProgress: projected.requester!.buyerProgress });
    expect(publicSellerView.offers[0].seller).toMatchObject({ completedPurchases: 1, buyerProgress: projected.offers[0].seller!.buyerProgress });

    const buyerPage = await buyer.newPage(); const sellerPage = await seller.newPage();
    // Both identities are rendered in each locale, with each role viewing the
    // counterparty once. Avoid a redundant four-render cross product on CI.
    for (const [locale, page] of [["en", buyerPage], ["ar", sellerPage]] as const) {
        await page.goto(`/${locale}/usdt-exchange/requests/${demand.id}`);
        await expect(page.getByRole("region", { name: locale === "ar" ? "طلبات الشراء" : "Buy Requests", exact: true })).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
        const requester = page.getByTestId("request-card").getByTestId("request-counterparty-identity");
        const responder = page.getByTestId("offer-card").getByTestId("request-counterparty-identity");
        for (const [identity, rankLabel, progress] of [
          [requester, locale === "ar" ? "مشتري فضي" : "Silver Buyer", "21.43"],
          [responder, locale === "ar" ? "مشتري ذهبي" : "Gold Buyer", "2.5"],
        ] as const) {
          await expect(identity.getByText(rankLabel, { exact: true })).toBeVisible();
          const bar = identity.getByRole("progressbar", { name: locale === "ar" ? "تقدم رتبة المشتري" : "Buyer rank progress" });
          await expect(bar).toHaveAttribute("aria-valuenow", progress);
          await expect(bar).toHaveAttribute("aria-valuemin", "0"); await expect(bar).toHaveAttribute("aria-valuemax", "100");
          const ratio = await bar.evaluate(node => node.firstElementChild!.getBoundingClientRect().width / node.getBoundingClientRect().width);
          expect(ratio).toBeCloseTo(Number(progress) / 100, 2);
          await expectVisibleTextFits(identity);
          const profile = identity.getByRole("link");
          await expect(profile).toHaveAttribute("href", new RegExp(`^/${locale}/u/seller-[a-f0-9]+$`));
          await expectBlueText(profile);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await requester.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath(`buyer-progress-${locale}-320px.png`) });
        await responder.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath(`seller-buyer-progress-${locale}-320px.png`) });
    }

    const privateState = await state(buyer.request);
    for (const user of privateState.users.filter(user => [buyerUser.id, sellerUser.id].includes(user.id))) user.showTradeStats = false;
    const hidden = await buyer.request.put("/api/testing/alpha-exchange-state", { headers: OFFLINE_HEADERS, data: privateState });
    expect(hidden.ok(), await hidden.text()).toBe(true);
    const buyerView = (await (await buyer.request.get(`${root}/${demand.id}`)).json() as DemandWorkspace).requests[0];
    const sellerView = (await (await seller.request.get(`${root}/${demand.id}`)).json() as DemandWorkspace).requests[0];
    expect(buyerView.offers[0].seller).toMatchObject({ completedPurchases: null, buyerProgress: null });
    expect(sellerView.requester).toMatchObject({ completedPurchases: null, buyerProgress: null });
    for (const [page, hiddenCard, ownCard] of [[buyerPage, "offer-card", "request-card"], [sellerPage, "request-card", "offer-card"]] as const) {
      await page.reload();
      const hiddenIdentity = page.getByTestId(hiddenCard).getByTestId("request-counterparty-identity");
      await expect(hiddenIdentity.getByRole("progressbar")).toHaveCount(0);
      await expect(hiddenIdentity).not.toContainText(/completed purchases?|عملية شراء مكتملة/);
      await expect(page.getByTestId(ownCard).getByRole("progressbar")).toHaveCount(1);
    }
  } finally { await buyer.close(); await seller.close(); }
});

for (const paymentMethod of ["Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"]) {
  test(`${paymentMethod}: real request, response, match and cancellation preserve payment totals`, async ({ playwright, browser, baseURL }, testInfo) => {
    const buyer = await playwright.request.newContext({ baseURL });
    const seller = await playwright.request.newContext({ baseURL });
    try {
      await login(buyer, "buyer"); await login(seller, "seller");
      const cardless = paymentMethod === "Cardless ATM Withdrawal";
      const amount = cardless ? calculateCardlessUsdtAmount("1000", "3.30", true)! : "1000";
      const requestedTerms = { ...terms, amount, paymentMethod, city: cardless ? "" : "Haifa" };
      if (cardless) {
        const draft = await browser.newContext({ baseURL, storageState: await buyer.storageState(), viewport: { width: 390, height: 844 } });
        try {
          await blockExternalBrowserRequests(draft);
          const page = await draft.newPage(); await page.goto("/en/usdt-exchange/requests?scope=mine");
          await page.getByRole("button", { name: "Create a request", exact: true }).click();
          const form = page.getByRole("form", { name: "Request details" });
          await form.getByLabel("Payment method", { exact: true }).selectOption(paymentMethod);
          const cash = form.getByLabel("ATM cash total incl. 1% fee (ILS)", { exact: true });
          await cash.selectOption("1000"); await expectGreenText(cash);
          await expectReadableSelectPaint(cash, testInfo, "atm-cash-select-paint");
          await expectFees(form, "990.10", "9.90", "1,000.00");
          await expect(form).toContainText("≈300");
          await cash.scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath("atm-cash-selection-mobile.png") });
        } finally { await draft.close(); }
      }
      const created = await buyer.post(root, { data: { terms: requestedTerms, operationId: randomUUID() } });
      expect(created.ok(), await created.text()).toBe(true);
      const demand = await created.json();
      const response = await seller.post(`${root}/${demand.id}/offers`, { data: { revision: 1, listingId: "listing-offline-seller", price: "3.30", operationId: randomUUID() } });
      expect(response.ok(), await response.text()).toBe(true);
      const offer = await response.json();
      if (cardless) {
        const preview = await browser.newContext({ baseURL, storageState: await buyer.storageState(), viewport: { width: 390, height: 844 } });
        try {
          await blockExternalBrowserRequests(preview);
          const page = await preview.newPage(); await page.goto(`/en/usdt-exchange/requests/${demand.id}`);
          await expect(page.getByTestId("request-card")).toContainText(`≈${Math.round(Number(amount)).toLocaleString("en-US")}`);
          await page.getByRole("button", { name: "Review response", exact: true }).click();
          const review = page.getByRole("form", { name: "Trade review" });
          await expect(review.getByTestId("fee-breakdown")).toContainText("1,000.00");
          await expectFees(review, "990.10", "9.90", "1,000.00");
          await review.locator("summary").filter({ hasText: /exact USDT amount/i }).click();
          await expect(review).toContainText(amount);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
          await page.screenshot({ path: testInfo.outputPath("atm-review-mobile.png"), fullPage: true });
          await review.getByTestId("fee-breakdown").scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath("atm-fees-exact-mobile.png") });
        } finally { await preview.close(); }
      }
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
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/ar/usdt-exchange/requests");
  const workspace = page.getByRole("region", { name: "طلبات الشراء", exact: true });
  await expect(workspace).toBeVisible();
  await expect(workspace).toHaveAttribute("dir", "rtl");
  await expectBlueAction(page.getByRole("button", { name: "إنشاء طلب", exact: true }));
  await page.getByRole("button", { name: "إنشاء طلب", exact: true }).click();
  const amount = page.getByLabel("المبلغ (USDT)", { exact: true });
  await pasteAmount(amount, "٥٬٠٠٠٫١٢");
  await expect(amount).toHaveValue("5,000.12");
  await page.getByLabel("السعر المطلوب لكل USDT (شيكل)", { exact: true }).fill("3.30");
  await expectGreenText(amount);
  await expectGreenText(page.getByLabel("السعر المطلوب لكل USDT (شيكل)", { exact: true }));
  await expectGreenMoney(page.getByRole("form"));
  await expectBlueAction(page.getByRole("button", { name: "نشر الطلب", exact: true }));
  await page.getByRole("button", { name: "نشر الطلب", exact: true }).click();
  await expect(page).toHaveURL(/\/ar\/usdt-exchange\/requests\/[^/]+$/);
  await expect(page.getByTestId("request-card")).toContainText("≈5,000");
  await expectGreenMoney(page.getByTestId("request-card"));
  await expectVisibleTextFits(page.getByTestId("request-card").getByTestId("request-counterparty-identity"));
  expect((await state(page.request)).usdtDemands?.[0].amount).toBe("5000.12");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("buyer-request-arabic-mobile.png"), fullPage: true });
});

for (const locale of ["en", "ar"] as const) {
  test(`${locale}: buyer form, seller response and review pass automated accessibility at 320px`, async ({ browser, baseURL }, info) => {
    test.setTimeout(300_000);
    const buyer = await browser.newContext({ baseURL, viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
    const seller = await browser.newContext({ baseURL, viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
    await blockExternalBrowserRequests(buyer); await blockExternalBrowserRequests(seller);
    const buyerPage = await buyer.newPage(); const sellerPage = await seller.newPage();
    const ar = locale === "ar";
    const audit = async (page: import("@playwright/test").Page, stage: string) => {
      await expect(page.getByRole("main").first()).toBeVisible();
      await expectFocusedControlUnobscured(page.locator("input:focus, select:focus, textarea:focus, button:focus, [tabindex='-1']:focus"));
      // Let the reveal and native-focus visibility frames finish before the
      // scan's deliberate scroll, then verify keyboard focus remains usable.
      await page.evaluate(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      await expectFocusedControlUnobscured(page.locator("input:focus, select:focus, textarea:focus, button:focus, [tabindex='-1']:focus"));
      // Scan a deterministic document position, not a non-focused control
      // partly passing beneath the sticky header after form navigation.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.addScriptTag({ path: axePath });
      const result = await page.evaluate(async () => {
        const axe = (window as unknown as Window & { axe: typeof import("axe-core") }).axe;
        return axe.run(document.querySelector("main")!, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
        });
      });
      await info.attach(`${locale}-${stage}-accessibility`, { body: Buffer.from(JSON.stringify({ violations: result.violations, incomplete: result.incomplete }, null, 2)), contentType: "application/json" });
      await page.screenshot({ path: info.outputPath(`${locale}-${stage}-accessibility.png`), fullPage: true });
      // Collect every stage's diagnostics while retaining both failing checks.
      expect.soft(await page.getByRole("main").count(), `${locale} ${stage}: one main landmark per page`).toBe(1);
      if (stage === "buyer-form") expect.soft(await page.getByRole("group", { name: ar ? "كميات سريعة" : "Quick amounts", exact: true }).count()).toBe(1);
      expect.soft(result.violations, `${locale} ${stage}: automated WCAG A/AA violations in the Buy Requests main content`).toEqual([]);
    };
    try {
      await login(buyer.request, "buyer"); await login(seller.request, "seller");
      await buyerPage.goto(`/${locale}/usdt-exchange/requests`);
      const create = buyerPage.getByRole("button", { name: ar ? "إنشاء طلب" : "Create a request", exact: true });
      await create.focus(); await create.press("Enter");
      await expectFocusedControlUnobscured(buyerPage.getByLabel(ar ? "طريقة الدفع" : "Payment method", { exact: true }));
      await buyerPage.keyboard.press("Tab");
      await expectFocusedControlUnobscured(buyerPage.getByLabel(ar ? "الشبكة" : "Network", { exact: true }));
      await buyerPage.keyboard.press("Tab");
      const amount = buyerPage.getByLabel(ar ? "المبلغ (USDT)" : "Amount (USDT)", { exact: true });
      await expectFocusedControlUnobscured(amount); await amount.fill("1000");
      for (const label of ["500 USDT", "1,000 USDT", "5,000 USDT"]) {
        await buyerPage.keyboard.press("Tab");
        await expectFocusedControlUnobscured(buyerPage.getByRole("button", { name: label, exact: true }));
      }
      await buyerPage.keyboard.press("Tab");
      const price = buyerPage.getByLabel(ar ? "السعر المطلوب لكل USDT (شيكل)" : "Requested price per USDT (ILS)", { exact: true });
      await expectFocusedControlUnobscured(price); await price.fill("3.30");
      await audit(buyerPage, "buyer-form");
      await expectReadableSelectPaint(buyerPage.getByLabel(ar ? "طريقة الدفع" : "Payment method", { exact: true }), info, `${locale}-payment-select-paint`);
      await expectReadableSelectPaint(buyerPage.getByLabel(ar ? "الشبكة" : "Network", { exact: true }), info, `${locale}-network-select-paint`);

      const demand = await createDemand(buyer.request);
      await sellerPage.goto(`/${locale}/usdt-exchange/requests/${demand.id}`);
      await expect(sellerPage.getByRole("form", { name: ar ? "رد البائع" : "Seller response", exact: true })).toBeVisible();
      await sellerPage.getByLabel(ar ? "عرضك" : "Your listing", { exact: true }).selectOption("listing-offline-seller");
      const sellerPrice = sellerPage.getByLabel(ar ? "سعر ردك (شيكل)" : "Your response price (ILS)", { exact: true });
      await sellerPrice.fill("3.25");
      // Native keyboard navigation scrolls the field into view, unlike a
      // programmatic fill that may focus an offscreen input without scrolling.
      await sellerPrice.press("Shift+Tab"); await sellerPage.keyboard.press("Tab");
      await audit(sellerPage, "seller-response");
      await expectReadableSelectPaint(sellerPage.getByLabel(ar ? "عرضك" : "Your listing", { exact: true }), info, `${locale}-listing-select-paint`);
      const response = await seller.request.post(`${root}/${demand.id}/offers`, { data: { revision: 1, listingId: "listing-offline-seller", price: "3.25", operationId: randomUUID() } });
      expect(response.ok(), await response.text()).toBe(true);
      // The retained WebKit trace reports a native market-fetch refusal 18ms
      // into this hard navigation, before the new document commits. Preserve
      // that diagnostic and require a healthy destination feed on this
      // isolated server's port; unrelated or steady-state errors still fail.
      await browserErrorAudit.navigate(buyerPage, () => buyerPage.goto(`/${locale}/usdt-exchange/requests/${demand.id}`), {
        url: new URL("/api/market/center", baseURL).href,
        label: "market feed",
        validateBody: (body) => {
          const snapshot = body as { snapshot?: { pairs?: Record<string, { price?: number }> } } | null;
          return ["btcUsdt", "ethUsdt", "usdtIls"].every(key => {
            const price = snapshot?.snapshot?.pairs?.[key]?.price;
            return typeof price === "number" && Number.isFinite(price) && price > 0;
          });
        },
      });
      const review = buyerPage.getByRole("button", { name: ar ? "مراجعة الرد" : "Review response", exact: true });
      await review.focus(); await review.press("Enter");
      const reviewForm = buyerPage.getByRole("form", { name: ar ? "مراجعة الصفقة" : "Trade review" });
      await expect(reviewForm).toBeVisible();
      await expectFocusedControlUnobscured(reviewForm.locator("legend[tabindex='-1']"));
      await audit(buyerPage, "trade-review");
    } finally { await buyer.close(); await seller.close(); }
  });
}

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
    const sellerId = snapshot.users.find(user => user.email === OFFLINE_ACCOUNTS.seller.email)!.id;
    snapshot.marketplaceListings = snapshot.marketplaceListings.filter(listing => listing.sellerId !== sellerId);
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

test("a 3.10 server reference enforces 2.75–3.45 on publishing, renewal, response and matching", async ({ playwright, baseURL }) => {
  const buyer = await playwright.request.newContext({ baseURL });
  const seller = await playwright.request.newContext({ baseURL });
  try {
    await login(buyer, "buyer"); await login(seller, "seller");
    await setSyntheticQuote(buyer, "3.10");
    expect((await (await buyer.get(root)).json() as DemandWorkspace).reference).toMatchObject({ price: "3.1", minimum: "2.75", maximum: "3.45" });
    for (const price of ["2.74", "3.46"]) {
      const rejected = await buyer.post(root, { data: { terms: { ...terms, price }, operationId: randomUUID() } });
      expect(rejected.status()).toBe(409); expect((await rejected.json()).code).toBe("PRICE_OUTSIDE_BAND");
    }
    const created = await buyer.post(root, { data: { terms: { ...terms, price: "2.75" }, operationId: randomUUID() } });
    expect(created.ok(), await created.text()).toBe(true);
    const demand = await created.json();
    await ageDemandPastCooldown(buyer, demand.id);
    for (const price of ["2.74", "3.46"]) {
      const rejected = await buyer.patch(`${root}/${demand.id}`, { data: { action: "renew", revision: 1, terms: { ...terms, price } } });
      expect(rejected.status()).toBe(409); expect((await rejected.json()).code).toBe("PRICE_OUTSIDE_BAND");
      const rejectedOffer = await seller.post(`${root}/${demand.id}/offers`, { data: { revision: 1, listingId: "listing-offline-seller", price, operationId: randomUUID() } });
      expect(rejectedOffer.status()).toBe(409); expect((await rejectedOffer.json()).code).toBe("PRICE_OUTSIDE_BAND");
    }
    const renewed = await buyer.patch(`${root}/${demand.id}`, { data: { action: "renew", revision: 1, terms: { ...terms, price: "3.45" } } });
    expect(renewed.ok(), await renewed.text()).toBe(true);
    const offered = await seller.post(`${root}/${demand.id}/offers`, { data: { revision: 2, listingId: "listing-offline-seller", price: "2.75", operationId: randomUUID() } });
    expect(offered.ok(), await offered.text()).toBe(true);
    const offer = await offered.json();
    const matched = await matchDemand(buyer, demand.id, offer.id, 2);
    expect(matched.status(), await matched.text()).toBe(201);
    expect((await matched.json()).purchase).toMatchObject({ pricePerUsdt: "2.75", fiatAmount: "2777.50" });
    expect((await state(buyer)).purchaseRequests).toHaveLength(1);
  } finally { await buyer.dispose(); await seller.dispose(); }
});

test("buyer and seller forms clearly show the 3.10 quote and its inclusive price limits", async ({ page, context, browser, baseURL }, testInfo) => {
  await blockExternalBrowserRequests(context); await login(page.request, "buyer");
  const seller = await browser.newContext({ baseURL, viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
  await blockExternalBrowserRequests(seller);
  try {
    await login(seller.request, "seller"); await setSyntheticQuote(page.request, "3.10");
    await page.goto("/en/usdt-exchange/requests?scope=mine");
    await page.getByRole("button", { name: "Create a request", exact: true }).click();
    const form = page.getByRole("form", { name: "Request details" });
    await form.getByLabel("Amount (USDT)", { exact: true }).fill("5000");
    const price = form.getByLabel("Requested price per USDT (ILS)", { exact: true });
    const publish = form.getByRole("button", { name: "Publish request", exact: true });
    await expect(page.getByRole("region", { name: "Price reference" })).toContainText("3.10");
    await expectGreenMoney(page.getByRole("region", { name: "Price reference" }));
    for (const boundary of ["2.74", "3.46"]) {
      await price.fill(boundary); await expect(publish).toBeDisabled();
      await expectGreenText(price); await expectGreenMoney(form);
      await expectGreenMoney(form.locator("#request-submit-help"));
    }
    for (const boundary of ["2.75", "3.45"]) { await price.fill(boundary); await expect(publish).toBeEnabled(); }
    await price.fill("3.10"); await publish.click();
    await expect(page).toHaveURL(/\/en\/usdt-exchange\/requests\/[^/]+$/);
    const sellerPage = await seller.newPage(); await sellerPage.goto(page.url());
    const responseForm = sellerPage.getByRole("form", { name: "Seller response" });
    await responseForm.getByLabel("Your listing", { exact: false }).selectOption("listing-offline-seller");
    const offerPrice = responseForm.getByLabel("Your response price (ILS)", { exact: true });
    const send = responseForm.getByRole("button", { name: "Send response", exact: true });
    for (const boundary of ["2.74", "3.46"]) {
      await offerPrice.fill(boundary); await expect(send).toBeDisabled();
      await expectGreenText(offerPrice); await expectGreenMoney(responseForm);
      await expectGreenMoney(responseForm.locator('p[id$="-reason"]'));
    }
    for (const boundary of ["2.75", "3.45"]) { await offerPrice.fill(boundary); await expect(send).toBeEnabled(); }
    await expect(responseForm).toContainText("2.75"); await expect(responseForm).toContainText("3.45");
    await expectFees(responseForm, "17,250.00", "172.50", "17,422.50", true);
    expect(await sellerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await sellerPage.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sellerPage.screenshot({ path: testInfo.outputPath("seller-price-limits-320px.png"), fullPage: true });
    await offerPrice.scrollIntoViewIfNeeded();
    await sellerPage.screenshot({ path: testInfo.outputPath("seller-price-input-320px.png") });
  } finally { await seller.close(); }
});

test("provider movement and unavailable quotes block stale acceptance until the request is reviewed again", async ({ playwright, baseURL }) => {
  const buyer = await playwright.request.newContext({ baseURL });
  const seller = await playwright.request.newContext({ baseURL });
  const newBuyer = await playwright.request.newContext({ baseURL });
  try {
    await login(buyer, "buyer"); await login(seller, "seller"); await login(newBuyer, "otherBuyer");
    const created = await buyer.post(root, { data: { terms: { ...terms, price: "3.60" }, operationId: randomUUID() } });
    expect(created.ok(), await created.text()).toBe(true);
    const demand = await created.json();
    const offered = await seller.post(`${root}/${demand.id}/offers`, { data: { revision: 1, listingId: "listing-offline-seller", price: "3.60", operationId: randomUUID() } });
    expect(offered.ok(), await offered.text()).toBe(true); const offer = await offered.json();
    await setSyntheticQuote(buyer, "3.10");
    const paused = (await (await buyer.get(`${root}/${demand.id}`)).json() as DemandWorkspace).requests[0];
    expect(paused.state).toBe("paused"); expect(paused.offers.every(item => !item.available)).toBe(true);
    const moved = await matchDemand(buyer, demand.id, offer.id);
    expect(moved.status()).toBe(400); expect((await moved.json()).code).toBe("PRICE_OUTSIDE_BAND");
    expect((await state(buyer)).purchaseRequests).toHaveLength(0);
    await ageDemandPastCooldown(buyer, demand.id);
    const renewed = await buyer.patch(`${root}/${demand.id}`, { data: { action: "renew", revision: 1, terms: { ...terms, price: "3.10" } } });
    expect(renewed.ok(), await renewed.text()).toBe(true);
    const freshResponse = await seller.post(`${root}/${demand.id}/offers`, { data: { revision: 2, listingId: "listing-offline-seller", price: "3.10", operationId: randomUUID() } });
    expect(freshResponse.ok(), await freshResponse.text()).toBe(true); const currentOffer = await freshResponse.json();
    await ageDemandPastCooldown(buyer, demand.id);
    for (const mode of ["unavailable", "stale"] as const) {
      await setSyntheticQuote(buyer, "3.10", mode);
      const unpublished = await newBuyer.post(root, { data: { terms: { ...terms, price: "3.10" }, operationId: randomUUID() } });
      expect(unpublished.status()).toBe(409); expect((await unpublished.json()).code).toBe("QUOTE_UNAVAILABLE");
      const unrenewed = await buyer.patch(`${root}/${demand.id}`, { data: { action: "renew", revision: 2, terms: { ...terms, price: "3.10" } } });
      expect(unrenewed.status()).toBe(409); expect((await unrenewed.json()).code).toBe("QUOTE_UNAVAILABLE");
      const unoffered = await seller.post(`${root}/${demand.id}/offers`, { data: { revision: 2, listingId: "listing-offline-seller", price: "3.10", operationId: randomUUID() } });
      expect(unoffered.status()).toBe(409); expect((await unoffered.json()).code).toBe("REQUEST_CHANGED");
      const rejected = await matchDemand(buyer, demand.id, currentOffer.id, 2);
      expect(rejected.status()).toBe(400); expect((await rejected.json()).code).toBe("QUOTE_UNAVAILABLE");
      expect((await state(buyer)).purchaseRequests).toHaveLength(0);
    }
    await setSyntheticQuote(buyer, "3.10");
    const staleRevision = await matchDemand(buyer, demand.id, offer.id);
    expect(staleRevision.status()).toBe(400);
    const accepted = await matchDemand(buyer, demand.id, currentOffer.id, 2);
    expect(accepted.status(), await accepted.text()).toBe(201);
    const snapshot = await state(buyer);
    expect(snapshot.purchaseRequests).toHaveLength(1);
    expect(snapshot.purchaseRequests[0]).toMatchObject({ pricePerUsdt: "3.10", fiatAmount: "3131.00" });
  } finally { await buyer.dispose(); await seller.dispose(); await newBuyer.dispose(); }
});

for (const role of ["buyer", "seller"] as const) {
  test(`${role}: mobile Buy Requests entry lands on the correct workspace at narrow and tablet widths`, async ({ page, context, playwright, baseURL }, testInfo) => {
    test.setTimeout(300_000); // Several viewport journeys and captures on shared Windows hosts.
    await blockExternalBrowserRequests(context); await login(page.request, role);
    const buyer = await playwright.request.newContext({ baseURL });
    try {
      // The account permits one active session. Reuse the browser buyer's
      // session rather than replacing it with a second API login.
      if (role === "seller") await login(buyer, "buyer");
      const demand = await createDemand(role === "buyer" ? page.request : buyer, "5000");
      const scope = role === "seller" ? "available" : "mine";
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(role === "seller" ? "/en/dashboard/seller" : "/en/dashboard");
        await expect(page).toHaveURL(new RegExp(`/en/dashboard${role === "seller" ? "/seller" : ""}$`));
        const dashboardEntry = page.getByTestId("welcome-buy-requests");
        const welcome = page.locator(".account-welcome").filter({ has: dashboardEntry });
        await expect(welcome.getByRole("heading", { name: /Welcome back,/ })).toBeVisible();
        await expect(dashboardEntry).toHaveAccessibleName("Buy Requests");
        await expect(dashboardEntry).toHaveAttribute("href", `/en/usdt-exchange/requests?scope=${scope}`);
        await expectBlueAction(dashboardEntry);
        await expectVisibleTextFits(dashboardEntry);
        for (const action of await welcome.locator(".account-welcome__actions").locator("a,button").all()) {
          if (!await action.isVisible()) continue;
          const { background: [red, green, blue] } = await renderedColors(action);
          if (blue > red + 35 && blue > green + 20) await expectBlueAction(action);
          else await expectBlueText(action);
          await expectVisibleTextFits(action);
          const bounds = await action.boundingBox();
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        }
        await dashboardEntry.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${role}-dashboard-shortcut-${width}px.png`) });
        await dashboardEntry.click();
        await expect(page).toHaveURL(new RegExp(`/en/usdt-exchange/requests\\?scope=${scope}$`));
        await expect(page.getByRole("button", { name: role === "seller" ? "Buyer requests · Sell USDT" : "My buying requests", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByTestId("request-card")).toContainText("5,000");
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/en/usdt-exchange");
      const exchangeEntry = page.getByRole("main").locator('a:not([data-testid="welcome-buy-requests"])').filter({ hasText: /^Buy Requests$/ });
      await expect(exchangeEntry).toHaveAttribute("href", `/en/usdt-exchange/requests?scope=${scope}`);
      await expectBlueAction(exchangeEntry);
      await exchangeEntry.click();
      await expect(page).toHaveURL(new RegExp(`/en/usdt-exchange/requests\\?scope=${scope}$`));
      for (const width of [320, 390, 768, 1024]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`/en/usdt-exchange/requests/${demand.id}`);
        const toggle = page.locator('summary[aria-label="Open menu"]');
        await toggle.click();
        const menu = toggle.locator("..");
        const entry = menu.getByRole("link", { name: "Buy Requests", exact: true });
        await expect(entry).toHaveAttribute("href", `/en/usdt-exchange/requests?scope=${scope}`);
        await expectBlueText(entry);
        expect(await entry.evaluate(element => element.previousElementSibling?.textContent)).toMatch(/Alpha Exchange/);
        if (width === 320 || width === 390) {
          await entry.scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath(`${role}-menu-${width}px.png`) });
        }
        await entry.click();
        await expect(page).toHaveURL(new RegExp(`/en/usdt-exchange/requests\\?scope=${scope}$`));
        await expect(page.getByRole("button", { name: role === "seller" ? "Buyer requests · Sell USDT" : "My buying requests", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expectBlueAction(page.getByRole("button", { name: role === "seller" ? "Buyer requests · Sell USDT" : "My buying requests", exact: true }));
        await expect(page.getByTestId("request-card")).toContainText("5,000");
        await expect(toggle.locator("..")).not.toHaveAttribute("open", "");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      await page.setViewportSize({ width: 568, height: 320 });
      const landscapeToggle = page.locator('summary[aria-label="Open menu"]');
      await landscapeToggle.click();
      const landscapeEntry = landscapeToggle.locator("..").getByRole("link", { name: "Buy Requests", exact: true });
      await landscapeEntry.scrollIntoViewIfNeeded();
      // A native scroll can move the page beneath its sticky header without
      // exposing the link inside the menu. Verify actionability before measuring.
      await landscapeEntry.click({ trial: true });
      await expect(landscapeEntry).toBeInViewport({ ratio: 1 });
      const bounds = await landscapeEntry.boundingBox();
      expect(bounds).not.toBeNull(); expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(320);
      await landscapeEntry.click();
      await expect(page.getByTestId("request-card")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.setViewportSize({ width: 1024, height: 844 });
      await page.screenshot({ path: testInfo.outputPath(`${role}-tablet-request-list.png`) });
    } finally { await buyer.dispose(); }
  });
}

test("buyer form stays readable without horizontal overflow from 320 to 1920 pixels", async ({ page, context, browser, baseURL }, testInfo) => {
  test.setTimeout(300_000); // Seven sizes plus both maximum-value forms; action timeouts stay bounded.
  await blockExternalBrowserRequests(context); await login(page.request, "buyer");
  await page.goto("/en/usdt-exchange/requests?scope=mine");
  await page.getByRole("button", { name: "Create a request", exact: true }).click();
  const form = page.getByRole("form", { name: "Request details" });
  await form.getByLabel("Amount (USDT)", { exact: true }).fill("5000");
  await form.getByLabel("Requested price per USDT (ILS)", { exact: true }).fill("3.30");
  await expectGreenText(form.getByLabel("Amount (USDT)", { exact: true }));
  await expectGreenText(form.getByLabel("Requested price per USDT (ILS)", { exact: true }));
  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(form.getByRole("button", { name: "Publish request", exact: true })).toBeEnabled();
    await expectBlueAction(form.getByRole("button", { name: "Publish request", exact: true }));
    await expectFees(form, "16,500.00", "165.00", "16,665.00");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `No overflow at ${width}px`).toBe(true);
    if (width === 320) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({ path: testInfo.outputPath("buyer-form-320px.png"), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await form.getByLabel("Amount (USDT)", { exact: true }).fill("999999999.999999");
  await form.getByLabel("Payment method", { exact: true }).selectOption("Face-to-Face (Meet in Person)");
  const longCity = "A".repeat(80);
  await form.getByLabel("Meeting city", { exact: true }).fill(longCity);
  await expect(form.getByLabel("Amount (USDT)", { exact: true })).toHaveValue("999,999,999.999999");
  await expectFees(form, "3,300,000,000.00", "33,000,000.00", "3,333,000,000.00");
  for (const value of await form.getByTestId("fee-breakdown").locator("dd").all()) await expectTextFits(value);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: testInfo.outputPath("buyer-max-amount-320px.png"), fullPage: true });
  await form.getByTestId("fee-breakdown").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("buyer-max-fees-320px.png") });
  await form.getByRole("button", { name: "Publish request", exact: true }).click();
  await expect(page.getByTestId("request-card")).toContainText("≈1,000,000,000");
  await expect(page.getByTestId("request-card")).toContainText(longCity);
  await expectTextFits(page.getByTestId("request-card").getByText(longCity, { exact: false }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Keep the stress case eligible for a seller response so the same maximum
  // values are checked in the seller form, not just on the buyer's card.
  const snapshot = await state(page.request);
  const listing = snapshot.marketplaceListings.find(item => item.id === "listing-offline-seller")!;
  listing.originalAmount = listing.availableAmount = listing.maximumTrade = "999999999.999999";
  snapshot.users.find(user => user.id === listing.sellerId)!.city = longCity;
  const saved = await page.request.put("/api/testing/alpha-exchange-state", { headers: OFFLINE_HEADERS, data: snapshot });
  expect(saved.ok(), await saved.text()).toBe(true);
  const seller = await browser.newContext({ baseURL, viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await blockExternalBrowserRequests(seller); await login(seller.request, "seller");
    const sellerPage = await seller.newPage(); await sellerPage.goto(page.url());
    const responseForm = sellerPage.getByRole("form", { name: "Seller response" });
    await expect(responseForm).toBeVisible();
    await expectTextFits(responseForm.locator("..").locator("p").filter({ hasText: longCity }).first());
    await responseForm.getByLabel("Your listing", { exact: false }).selectOption("listing-offline-seller");
    await responseForm.getByLabel("Your response price (ILS)", { exact: true }).fill("3.30");
    await expectGreenText(responseForm.getByLabel("Your response price (ILS)", { exact: true }));
    await expectGreenMoney(responseForm);
    for (const value of await responseForm.getByTestId("fee-breakdown").locator("dd").all()) await expectTextFits(value);
    expect(await sellerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await sellerPage.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sellerPage.screenshot({ path: testInfo.outputPath("seller-max-amount-city-320px.png"), fullPage: true });
    await responseForm.getByTestId("fee-breakdown").scrollIntoViewIfNeeded();
    await sellerPage.screenshot({ path: testInfo.outputPath("seller-max-fees-320px.png") });
  } finally { await seller.close(); }
});

test("buyer can keep or cancel a request and then publish it again after the cooldown", async ({ page, context }) => {
  await blockExternalBrowserRequests(context); await login(page.request, "buyer");
  const demand = await createDemand(page.request, "5000");
  await page.goto(`/en/usdt-exchange/requests/${demand.id}`);
  await page.getByRole("button", { name: "Cancel request", exact: true }).click();
  await page.getByRole("button", { name: "Keep request", exact: true }).click();
  expect((await state(page.request)).usdtDemands?.[0].state).toBe("open");
  await page.getByRole("button", { name: "Cancel request", exact: true }).click();
  // A click only dispatches the mutation. Read the committed state after the
  // matching response, never race the browser's PATCH with the fixture GET.
  const [cancellation] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `${root}/${demand.id}`
      && response.request().method() === "PATCH" && response.request().postDataJSON()?.action === "cancel", { timeout: 5_000 }),
    page.getByRole("button", { name: "Confirm cancellation", exact: true }).click(),
  ]);
  expect(cancellation.status(), await cancellation.text()).toBe(200);
  await expect(page.getByRole("button", { name: "Confirm cancellation", exact: true })).toHaveCount(0);
  expect((await state(page.request)).usdtDemands?.find(item => item.id === demand.id)?.state).toBe("cancelled");
  await ageDemandPastCooldown(page.request, demand.id); await page.reload();
  await page.getByRole("button", { name: "Publish again", exact: true }).click();
  const form = page.getByRole("form", { name: "Request details" });
  await expect(form.getByLabel("Amount (USDT)", { exact: true })).toHaveValue("5,000");
  await form.getByLabel("Requested price per USDT (ILS)", { exact: true }).fill("3.10");
  await form.getByRole("button", { name: "Publish again", exact: true }).click();
  await expect(page.getByTestId("request-card")).toContainText("3.10");
  expect((await state(page.request)).usdtDemands?.[0]).toMatchObject({ state: "open", revision: 3, amount: "5000", price: "3.10" });
});

test("12-hour requests allow free edits, enforce two publications, and lock after acceptance", async ({ page, context, playwright, baseURL }, info) => {
  await blockExternalBrowserRequests(context); await login(page.request, "buyer");
  const seller = await playwright.request.newContext({ baseURL });
  try {
    await login(seller, "seller");
    const demand = await createDemand(page.request);
    const initial = (await state(page.request)).usdtDemands!.find(item => item.id === demand.id)!;
    expect(Date.parse(initial.expiresAt) - Date.parse(initial.createdAt)).toBe(12 * 60 * 60_000);
    const offerResponse = await seller.post(`${root}/${demand.id}/offers`, { data: { revision: 1, listingId: "listing-offline-seller", price: "3.30", operationId: randomUUID() } });
    expect(offerResponse.ok(), await offerResponse.text()).toBe(true);
    const originalOffer = await offerResponse.json();
    await page.goto(`/en/usdt-exchange/requests/${demand.id}`);
    await page.getByRole("button", { name: "Edit request", exact: true }).click();
    const form = page.getByRole("form", { name: "Request details" });
    await form.getByLabel("Requested price per USDT (ILS)", { exact: true }).fill("3.25");
    await form.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByTestId("request-card")).toContainText("3.25");
    let saved = (await state(page.request)).usdtDemands!.find(item => item.id === demand.id)!;
    expect(saved).toMatchObject({ expiresAt: initial.expiresAt, revision: 2, state: "open" });
    expect(saved.offers.find(item => item.id === originalOffer.id)?.state).toBe("superseded");
    expect((await (await page.request.get(root)).json()).publishing.remaining).toBe(1);
    const staleMatch = await matchDemand(page.request, demand.id, originalOffer.id);
    expect(staleMatch.ok()).toBe(false);
    expect((await state(page.request)).purchaseRequests).toHaveLength(0);
    const cancelled = await page.request.patch(`${root}/${demand.id}`, { data: { action: "cancel", revision: 2 } });
    expect(cancelled.ok(), await cancelled.text()).toBe(true);
    await ageDemandPastCooldown(page.request, demand.id);
    const renewed = await page.request.patch(`${root}/${demand.id}`, { data: { action: "renew", revision: 3, terms } });
    expect(renewed.ok(), await renewed.text()).toBe(true);
    expect((await (await page.request.get(root)).json()).publishing.remaining).toBe(0);
    // Quota exhaustion must not prevent editing the currently open request.
    const edit = await page.request.patch(`${root}/${demand.id}`, { data: { action: "edit", revision: 4, terms: { ...terms, price: "3.20" } } });
    expect(edit.ok(), await edit.text()).toBe(true);
    const expiredCancel = await page.request.patch(`${root}/${demand.id}`, { data: { action: "cancel", revision: 5 } });
    expect(expiredCancel.ok(), await expiredCancel.text()).toBe(true);
    await ageDemandPastCooldown(page.request, demand.id);
    const third = await page.request.post(root, { data: { terms, operationId: randomUUID() } });
    expect(third.status()).toBe(429); expect((await third.json()).code).toBe("DAILY_LIMIT");

    // Start a fresh isolated account for the accepted-request lock assertion.
    const buyerTwo = await playwright.request.newContext({ baseURL });
    try {
      await login(buyerTwo, "otherBuyer");
      const other = await createDemand(buyerTwo);
      const offered = await seller.post(`${root}/${other.id}/offers`, { data: { revision: 1, listingId: "listing-offline-seller", price: "3.30", operationId: randomUUID() } });
      expect(offered.ok(), await offered.text()).toBe(true);
      const matched = await matchDemand(buyerTwo, other.id, (await offered.json()).id);
      expect(matched.status(), await matched.text()).toBe(201);
      const trade = (await matched.json()).purchase;
      saved = (await state(buyerTwo)).usdtDemands!.find(item => item.id === other.id)!;
      for (const action of ["edit", "renew"]) {
        const rejected = await buyerTwo.patch(`${root}/${other.id}`, { data: { action, revision: saved.revision, terms } });
        // Existing buyer eligibility blocks writes before the request-specific lock.
        expect(rejected.status()).toBe(409); expect((await rejected.json()).code).toBe("ACTIVE_TRADE_EXISTS");
      }
      const tradeCancelled = await buyerTwo.patch(`/api/alpha-exchange/purchase-requests/${trade.id}`, { data: { status: "cancelled" } });
      expect(tradeCancelled.ok(), await tradeCancelled.text()).toBe(true);
      for (const action of ["edit", "renew"]) {
        const rejected = await buyerTwo.patch(`${root}/${other.id}`, { data: { action, revision: saved.revision, terms } });
        expect(rejected.status()).toBe(409); expect((await rejected.json()).code).toBe("TRADE_EXISTS");
      }
      expect((await state(buyerTwo)).purchaseRequests).toHaveLength(1);
      expect((await state(buyerTwo)).usdtDemands!.find(item => item.id === other.id)).toEqual(saved);
    } finally { await buyerTwo.dispose(); }
    // A native WebKit refusal can arrive while this hard navigation tears
    // down the old market poll. Require the new document's exact same-origin
    // feed to succeed before classifying that bounded cancellation.
    await browserErrorAudit.navigate(page, () => page.goto(`/en/usdt-exchange/requests/${demand.id}`), {
      url: new URL("/api/market/center", baseURL).href,
      label: "offline market feed",
      validateBody: (body) => {
        const snapshot = body as { snapshot?: { pairs?: Record<string, { price?: number }> } } | null;
        return ["btcUsdt", "ethUsdt", "usdtIls"].every((key) => {
          const price = snapshot?.snapshot?.pairs?.[key]?.price;
          return typeof price === "number" && Number.isFinite(price) && price > 0;
        });
      },
    });
    await expect(page.getByTestId("request-card")).toBeVisible();
    await page.screenshot({ path: info.outputPath("two-request-policy.png"), fullPage: true });
  } finally { await seller.dispose(); }
});

test("a demand-origin Bank Transfer completes through payment proof, release and seller completion", async ({ page, context, playwright, baseURL }) => {
  await blockExternalBrowserRequests(context); await login(page.request, "buyer");
  const seller = await playwright.request.newContext({ baseURL });
  try {
    await login(seller, "seller"); const demand = await createDemand(page.request);
    const offered = await seller.post(`${root}/${demand.id}/offers`, { data: { revision: 1, listingId: "listing-offline-seller", price: "3.30", operationId: randomUUID() } });
    expect(offered.ok(), await offered.text()).toBe(true);
    const matched = await matchDemand(page.request, demand.id, (await offered.json()).id);
    expect(matched.status(), await matched.text()).toBe(201); const trade = (await matched.json()).purchase;
    const path = `/api/alpha-exchange/purchase-requests/${trade.id}`;
    const premature = await seller.patch(path, { data: { action: "complete_trade", usdtSentConfirmed: true } });
    expect(premature.ok()).toBe(false);
    const accepted = await seller.patch(path, { data: { status: "accepted", safetyAcknowledged: true } });
    expect(accepted.ok(), await accepted.text()).toBe(true);
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=";
    const evidence = async (api: APIRequestContext, side: "buyer" | "seller") => {
      const response = await api.post(`${path}/evidence`, { data: { side, fileName: `${side}-proof.png`, mimeType: "image/png",
        sizeBytes: Buffer.from(png, "base64").length, fileData: `data:image/png;base64,${png}` } });
      expect(response.ok(), await response.text()).toBe(true); return (await response.json()).request;
    };
    expect((await evidence(page.request, "buyer")).status).toBe("payment_sent");
    for (const status of ["funds_received", "usdt_release_pending"]) {
      const advanced = await seller.patch(path, { data: { status } });
      expect(advanced.ok(), await advanced.text()).toBe(true); expect((await advanced.json()).request.status).toBe(status);
    }
    expect((await evidence(seller, "seller")).status).toBe("usdt_sent");
    const denied = await page.request.patch(path, { data: { status: "completed" } });
    expect(denied.ok()).toBe(false); expect((await denied.json()).code).toBe("seller-completion-required");
    const completed = await seller.patch(path, { data: { action: "complete_trade" } });
    expect(completed.ok(), await completed.text()).toBe(true);
    expect((await completed.json()).request.status).toBe("review_open");
    // Retrying completion must never debit inventory or create either fee twice.
    await seller.patch(path, { data: { action: "complete_trade" } });
    const snapshot = await state(page.request);
    expect(snapshot.marketplaceListings.find(listing => listing.id === "listing-offline-seller")?.availableAmount).toBe("9000");
    const commissions = snapshot.commissionRecords.filter(commission => commission.purchaseRequestId === trade.id);
    expect(commissions).toHaveLength(1);
    expect(commissions[0]).toMatchObject({ purchaseRequestId: trade.id, sellerFeeAmount: 10, buyerFeeCollectedAmount: 10,
      commissionAmount: 20, grossAmount: 3333, paymentStatus: "pending", feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2" });
    await page.goto(`/en/usdt-exchange/requests/${demand.id}`);
    await expect(page.getByTestId("request-card")).toContainText(/fulfilled|completed/i);
    await expect(page.getByTestId("request-card").getByTestId("request-counterparty-identity")).toContainText("1 completed purchase");
    expect((await (await page.request.get(`${root}/${demand.id}`)).json() as DemandWorkspace).requests[0].state).toBe("fulfilled");
  } finally { await seller.dispose(); }
});
