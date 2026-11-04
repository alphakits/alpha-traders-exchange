/** Actual Chromium rehearsal on an automatically created loopback-only server. */
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { createRehearsalServer, type RehearsalServer } from "./rehearsal-server";

type View = {
  rehearsalId: string; role: string; revision: number;
  assets: Array<{ id: string; custody: string; available: string; reserved: string; listing: string; delivered: string; commissionDue: string; revenue: string }>;
  listings: Array<{ id: string; status: string }>;
  funding: Array<{ id: string; status: string; purpose: string }>;
  trades: Array<{ id: string; status: string; amount: string }>;
  payouts: Array<{ id: string; state: string; providerStatus: string; held: string; dispatchCount: number }>;
};

const PENDING_KEY = "alpha-wallet-rehearsal-pending-v1";
type Pending = { path: string; role: string; rehearsalId: string; body: Record<string, unknown>; outcome: string };

function driver(page: Page, app: RehearsalServer) {
  const view = () => page.evaluate(async () => await (await fetch("/api/state", { cache: "no-store" })).json() as View);
  const idle = () => page.waitForFunction(() => document.querySelector("#app")?.getAttribute("aria-busy") === "false");
  async function mutation(path: string, operation: () => Promise<unknown>) {
    const response = page.waitForResponse(response => response.url() === app.url + path && response.request().method() === "POST");
    await operation();
    const received = await response, body = await received.json();
    assert.equal(received.status(), 200, JSON.stringify(body));
    await idle();
    assert.equal(await page.locator("#pending-operation").count(), 0, "Successful response must resolve the original request");
    return body as View;
  }
  async function role(value: string) {
    if ((await view()).role === value) return;
    await mutation("/api/session/role", () => page.locator("#role").selectOption(value));
  }
  async function submitForm(action: string, values: Record<string, string> = {}, index = 0) {
    const form = page.locator(`form[data-action="${action}"]`).nth(index);
    for (const [name, value] of Object.entries(values)) {
      const element = form.locator(`[name="${name}"]`);
      if (await element.evaluate(node => node.tagName === "SELECT")) await element.selectOption(value);
      else await element.fill(value);
    }
    await form.locator('button[type="submit"]').click();
  }
  async function submit(action: string, values: Record<string, string> = {}, index = 0) {
    return mutation(`/api/actions/${action}`, () => submitForm(action, values, index));
  }
  async function click(action: string, match: Record<string, unknown> = {}) {
    const buttons = page.locator(`button[data-action="${action}"]`);
    const index = await buttons.evaluateAll((nodes, expected) => nodes.findIndex(node => {
      const fields = JSON.parse((node as HTMLElement).dataset.fields || "{}");
      return Object.entries(expected).every(([key, value]) => fields[key] === value);
    }), match);
    assert(index >= 0, `No visible ${action} action matched the fixture`);
    return mutation(`/api/actions/${action}`, () => buttons.nth(index).click());
  }
  async function interruptedSubmit(action: string, values: Record<string, string>) {
    const path = `/api/actions/${action}`, url = app.url + path;
    let committed: View | undefined, sentBody: Record<string, unknown> | undefined;
    // The actual local server commits first. Only the HTTP response delivered
    // to the page is truncated. No request, ledger result or console is faked.
    await page.route(url, async route => {
      sentBody = route.request().postDataJSON() as Record<string, unknown>;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      committed = await response.json() as View;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{" });
    }, { times: 1 });
    await submitForm(action, values);
    await page.waitForFunction(key => {
      const raw = sessionStorage.getItem(key);
      return raw && JSON.parse(raw).outcome === "unknown" && document.querySelector("#app")?.getAttribute("aria-busy") === "false";
    }, PENDING_KEY);
    assert(committed && sentBody, "Fault must follow a real successful commit");
    const pending = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!) as Pending, PENDING_KEY);
    assert.deepEqual(pending.body, sentBody);
    assert.equal(pending.rehearsalId, committed.rehearsalId);
    assert.equal(await page.locator("#role").isDisabled(), true);
    assert.equal(await page.locator("#dismiss-pending").count(), 0);
    assert.equal(await page.locator('button[data-action],form[data-action] button').evaluateAll(nodes => nodes.every(node => (node as HTMLButtonElement).disabled)), true);
    await page.reload(); await page.locator("#role").waitFor(); await idle();
    const resumed = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!) as Pending, PENDING_KEY);
    assert.deepEqual(resumed, pending);
    const retry = page.waitForRequest(request => request.url() === url && request.method() === "POST");
    const recovered = await mutation(path, () => page.locator("#retry-pending").click());
    const request = await retry;
    assert.deepEqual(request.postDataJSON(), sentBody);
    assert.equal(request.headers()["x-alpha-rehearsal-id"], pending.rehearsalId);
    assert.equal(recovered.revision, committed.revision);
    assert.deepEqual(recovered.trades, committed.trades);
    assert.deepEqual(recovered.payouts, committed.payouts);
    return { action, fault: "truncated JSON response after actual server commit", requestId: sentBody.requestId,
      sameRequestAfterReload: true, committedRevision: committed.revision, recoveredRevision: recovered.revision };
  }
  return { view, idle, role, submit, click, interruptedSubmit };
}

async function observePage(page: Page, app: RehearsalServer, errors: string[]) {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(app.url + "/") || url.startsWith("data:")) return route.continue();
    errors.push(`Unexpected browser network origin: ${new URL(url).origin}`);
    return route.abort();
  });
  await page.goto(app.url); await page.locator("#role").waitFor();
}

async function withdrawalRetry(browser: Browser, errors: string[]) {
  const app = await createRehearsalServer({ mode: "simulation-only" });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
    const page = await context.newPage(); await observePage(page, app, errors);
    const flow = driver(page, app);
    await flow.submit("funding-create", { purpose: "principal" });
    await flow.role("verifier"); await flow.submit("funding-observe", { amount: "100" }); await flow.submit("funding-observe");
    await flow.click("custody-reconcile"); await flow.role("owner"); await flow.click("gas-ready", { ready: true }); await flow.role("seller");
    const check = await flow.interruptedSubmit("withdrawal-create", { amount: "25" });
    const final = await flow.view();
    assert.equal(final.payouts.length, 1);
    assert.equal(final.payouts[0].held, "25"); assert.equal(final.payouts[0].dispatchCount, 0);
    assert.equal(final.payouts[0].providerStatus, "not_found");
    assert.equal(final.assets[0].available, "75"); assert.equal(final.assets[0].custody, "100");
    return { ...check, payoutCount: final.payouts.length, heldUSDT: "25", availableUSDT: "75", providerSubmissions: 0 };
  } finally { try { await context?.close(); } finally { await app.close(); } }
}

async function main() {
  assertSimulationRuntime("simulation-only");
  if (process.argv.length !== 2) throw new Error("The browser rehearsal accepts no hosts, URLs, or production credentials");
  const output = resolve("test-results/alpha-wallet/rehearsal");
  await mkdir(output, { recursive: true });
  const app = await createRehearsalServer({ mode: "simulation-only" });
  const browser = await chromium.launch({ headless: true }).catch(async error => { await app.close(); throw error; });
  const errors: string[] = [];
  const screenshotPaths: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, colorScheme: "dark", reducedMotion: "reduce" });
    const page = await context.newPage();
    await observePage(page, app, errors);
    const { view, idle, role, submit, click, interruptedSubmit } = driver(page, app);
    async function shot(name: string, fullPage = true) {
      await page.locator("#toast").evaluate(node => { (node as HTMLElement).hidden = true; });
      await page.evaluate(() => window.scrollTo(0, 0));
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth, direction: document.documentElement.dir }));
      assert(dimensions.scroll <= dimensions.width, `Horizontal overflow: ${dimensions.scroll} > ${dimensions.width}`);
      const path = join(output, name);
      await page.screenshot({ path, fullPage });
      screenshotPaths.push(path);
      return dimensions;
    }

    await submit("listing-create", { amount: "500", price: "3.20" });
    await submit("funding-create", { purpose: "principal" });
    await role("verifier");
    await submit("funding-observe", { amount: "500" });
    await submit("funding-observe");
    await role("owner");
    await click("listing-approve");
    await click("gas-ready", { ready: true });
    await role("buyer");
    const reservationRecovery = await interruptedSubmit("trade-reserve", { amount: "200" });
    await submit("trade-reserve", { amount: "300" });
    const firstView = await view(), [first, second] = firstView.trades;
    assert.deepEqual(firstView.assets[0].reserved, "500");
    await shot("english-desktop-funded-reservations.png");

    await click("payment-claim", { tradeId: first.id });
    await role("verifier");
    await click("payment-verify", { tradeId: first.id });
    await role("seller");
    await click("release-authorize", { tradeId: first.id });
    await role("verifier");
    await click("custody-reconcile");
    await role("worker");
    await click("payout-queue", { tradeId: first.id });
    const firstPayout = (await view()).payouts[0];
    await click("payout-step", { payoutId: firstPayout.id, loseResponse: true });
    assert.equal((await view()).payouts[0].state, "submission_unknown");
    await shot("english-desktop-unknown-submission.png");
    await click("payout-step", { payoutId: firstPayout.id, loseResponse: false });
    await role("verifier");
    await click("payout-finalize", { payoutId: firstPayout.id, successful: true });
    assert.equal((await view()).payouts[0].state, "broadcast");
    await role("worker");
    await click("payout-step", { payoutId: firstPayout.id, loseResponse: false });

    await role("seller");
    await submit("funding-create", { purpose: "commission" });
    await role("verifier");
    await submit("funding-observe", { amount: "10" });
    await submit("funding-observe");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#language").click();
    await page.waitForFunction(() => document.documentElement.dir === "rtl");
    await role("buyer");
    await shot("arabic-mobile-partial-settlement.png");
    await click("payment-claim", { tradeId: second.id });
    await role("verifier");
    await click("payment-verify", { tradeId: second.id });
    await role("seller");
    await click("release-authorize", { tradeId: second.id });
    await role("verifier");
    await click("custody-reconcile");
    await role("worker");
    await click("payout-queue", { tradeId: second.id });
    const secondPayout = (await view()).payouts[1];
    await click("payout-step", { payoutId: secondPayout.id, loseResponse: false });
    await role("verifier");
    await click("payout-finalize", { payoutId: secondPayout.id, successful: true });
    await role("worker");
    await click("payout-step", { payoutId: secondPayout.id, loseResponse: false });
    await role("seller");
    const final = await view(), amounts = final.assets[0];
    assert.equal(amounts.delivered, "500");
    assert.equal(amounts.custody, "10");
    assert.equal(amounts.revenue, "10");
    assert.equal(amounts.commissionDue, "0");
    assert.equal(amounts.reserved, "0");
    const mobile = await shot("arabic-mobile-full-settlement.png");
    assert.equal(mobile.direction, "rtl");
    await shot("arabic-mobile-final-viewport.png", false);
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.locator("#language").click();
    await page.waitForFunction(() => document.documentElement.dir === "ltr"); await idle();
    await shot("english-desktop-final-viewport.png", false);
    const withdrawalRecovery = await withdrawalRetry(browser, errors);
    assert.deepEqual(errors, []);
    const report = { mode: "simulation-only", driver: "Chromium through rendered UI actions", browserVersion: browser.version(), desktop: { width: 1440, language: "en" }, mobile: { width: 390, language: "ar", direction: mobile.direction, horizontalOverflow: false },
      assertions: ["Full 500-USDT funding and independent owner approval", "200 + 300 principal reservations", "Separate buyer, verifier, seller, and worker actions", "Unknown provider response held until recovery", "Provider finality does not itself settle the ledger", "Full 500 USDT delivered with 10 USDT fees separately funded and recognized", "Interrupted reservation and withdrawal HTTP responses retain the exact operation across reload without duplicate allocation"],
      amounts, requestRecovery: { reservation: reservationRecovery, withdrawal: withdrawalRecovery }, consoleErrors: errors, screenshots: screenshotPaths };
    await writeFile(join(output, "browser-check.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { try { await browser.close(); } finally { await app.close(); } }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Browser rehearsal failed"); process.exitCode = 1; });
