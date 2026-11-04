/** Actual Chromium rehearsal on an automatically created loopback-only server. */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { createRehearsalServer } from "./rehearsal-server";

type View = {
  role: string; revision: number;
  assets: Array<{ id: string; custody: string; reserved: string; listing: string; delivered: string; commissionDue: string; revenue: string }>;
  listings: Array<{ id: string; status: string }>;
  funding: Array<{ id: string; status: string; purpose: string }>;
  trades: Array<{ id: string; status: string; amount: string }>;
  payouts: Array<{ id: string; state: string; providerStatus: string; held: string; dispatchCount: number }>;
};

async function main() {
  assertSimulationRuntime("simulation-only");
  if (process.argv.length !== 2) throw new Error("The browser rehearsal accepts no hosts, URLs, or production credentials");
  const output = resolve("test-results/alpha-wallet/rehearsal");
  await mkdir(output, { recursive: true });
  const app = await createRehearsalServer({ mode: "simulation-only" });
  const localChromium = "/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(localChromium) ? { executablePath: localChromium } : {}) }).catch(async error => { await app.close(); throw error; });
  const errors: string[] = [];
  const screenshotPaths: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, colorScheme: "dark", reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    // The only permitted browser network origin is the local rehearsal server.
    await page.route("**/*", route => {
      const url = route.request().url();
      if (url.startsWith(app.url + "/") || url.startsWith("data:")) return route.continue();
      errors.push(`Unexpected browser network origin: ${new URL(url).origin}`);
      return route.abort();
    });
    await page.goto(app.url);
    await page.locator("#role").waitFor();
    const view = () => page.evaluate(async () => await (await fetch("/api/state", { cache: "no-store" })).json() as View);
    const idle = () => page.waitForFunction(() => !document.querySelector("button:disabled"));
    async function mutation(path: string, operation: () => Promise<unknown>) {
      const response = page.waitForResponse(response => response.url() === app.url + path && response.request().method() === "POST");
      await operation();
      const received = await response, body = await received.json();
      assert.equal(received.status(), 200, JSON.stringify(body));
      await idle();
      return body as View;
    }
    async function role(value: string) {
      if ((await view()).role === value) return;
      await mutation("/api/session/role", () => page.locator("#role").selectOption(value));
    }
    async function submit(action: string, values: Record<string, string> = {}, index = 0) {
      const form = page.locator(`form[data-action="${action}"]`).nth(index);
      for (const [name, value] of Object.entries(values)) {
        const element = form.locator(`[name="${name}"]`);
        if (await element.evaluate(node => node.tagName === "SELECT")) await element.selectOption(value);
        else await element.fill(value);
      }
      return mutation(`/api/actions/${action}`, () => form.locator('button[type="submit"]').click());
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
    async function shot(name: string) {
      await page.locator("#toast").evaluate(node => { (node as HTMLElement).hidden = true; });
      await page.evaluate(() => window.scrollTo(0, 0));
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth, direction: document.documentElement.dir }));
      assert(dimensions.scroll <= dimensions.width, `Horizontal overflow: ${dimensions.scroll} > ${dimensions.width}`);
      const path = join(output, name);
      await page.screenshot({ path, fullPage: true });
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
    await submit("trade-reserve", { amount: "200" });
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
    assert.deepEqual(errors, []);
    const report = { mode: "simulation-only", driver: "Chromium through rendered UI actions", desktop: { width: 1440, language: "en" }, mobile: { width: 390, language: "ar", direction: mobile.direction, horizontalOverflow: false },
      assertions: ["Full 500-USDT funding and independent owner approval", "200 + 300 principal reservations", "Separate buyer, verifier, seller, and worker actions", "Unknown provider response held until recovery", "Provider finality does not itself settle the ledger", "Full 500 USDT delivered with 10 USDT fees separately funded and recognized"],
      amounts, consoleErrors: errors, screenshots: screenshotPaths };
    await writeFile(join(output, "browser-check.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); await app.close(); }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Browser rehearsal failed"); process.exitCode = 1; });
