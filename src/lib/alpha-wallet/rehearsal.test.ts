// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRehearsalServer, type RehearsalServer } from "../../../scripts/alpha-wallet/rehearsal-server";
import { rehearsalPage } from "../../../scripts/alpha-wallet/rehearsal-page";

// These are real loopback HTTP integration tests with synthetic disk-backed
// fixtures. No browser actor, production session, external provider, or database
// connection is available through this rehearsal surface.
type View = {
  mode: string; csrf: string; role: string; revision: number; paused: string | null;
  assets: Array<{ id: string; custody: string; listing: string; reserved: string; delivered: string; commissionAvailable: string; commissionDue: string; revenue: string }>;
  listings: Array<{ id: string; status: string; funded: boolean; approved: boolean; available: string }>;
  funding: Array<{ id: string; status: string; amount: string | null; purpose: string }>;
  trades: Array<{ id: string; status: string; amount: string; fiatTotal: string; disputed: boolean }>;
  payouts: Array<{ id: string; state: string; providerStatus: string; dispatchCount: number; held: string; recovery: string; destination: string }>;
};
const ASSET = "tron-sim-usdt";
const apps: RehearsalServer[] = [];
const directories: string[] = [];

async function app(dataDir?: string) {
  const directory = dataDir ?? await mkdtemp(join(tmpdir(), "alpha-wallet-http-test-"));
  if (!dataDir) directories.push(directory);
  const instance = await createRehearsalServer({ mode: "simulation-only", dataDir: directory });
  apps.push(instance);
  return instance;
}

async function client(instance: RehearsalServer) {
  let sequence = 0;
  const first = await fetch(`${instance.url}/api/state`);
  expect(first.status).toBe(200);
  const cookie = first.headers.get("set-cookie")!.split(";")[0];
  let state = await first.json() as View;
  async function post(path: string, body: unknown, expected = 200) {
    const response = await fetch(`${instance.url}${path}`, { method: "POST", headers: {
      "Content-Type": "application/json", Origin: instance.url, Cookie: cookie, "X-Alpha-Rehearsal-CSRF": state.csrf,
    }, body: JSON.stringify(body) });
    const json = await response.json();
    expect(response.status, JSON.stringify(json)).toBe(expected);
    if (response.ok) state = json as View;
    return json;
  }
  return {
    cookie,
    current: () => state,
    asset: () => state.assets.find(item => item.id === ASSET)!,
    async role(role: string) { await post("/api/session/role", { role }); return state; },
    async action(action: string, fields: Record<string, unknown>, expected = 200) {
      return post(`/api/actions/${action}`, { requestId: `http-fixture-${++sequence}`, ...fields }, expected);
    },
    post,
    async refresh() {
      const response = await fetch(`${instance.url}/api/state`, { headers: { Cookie: cookie } });
      expect(response.status).toBe(200); state = await response.json() as View; return state;
    },
  };
}

beforeAll(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
});
afterAll(async () => {
  await Promise.allSettled(apps.map(instance => instance.close()));
  await Promise.all(directories.map(directory => rm(directory, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

describe.sequential("isolated rehearsal HTTP boundary", () => {
  let instance: RehearsalServer;
  beforeAll(async () => { instance = await app(); }, 20000);

  it("binds an exact loopback origin and serves a self-contained bilingual page with a nonce CSP", async () => {
    expect(instance.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(instance.url);
    const page = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    expect(page).toContain("SYNTHETIC FUNDS ONLY");
    expect(page).toContain("أموال اصطناعية فقط");
    expect(page).toContain("not account authentication");
    expect(page).toContain("ليس مصادقة لحسابات حقيقية");
    expect(page).toContain("document.documentElement.dir=language==='ar'?'rtl':'ltr'");
    expect(page).not.toMatch(/<(?:script|link)[^>]*(?:src|href)=["']https?:/);
    const script = page.match(/<script nonce="([a-f0-9]{48})">([\s\S]*?)<\/script>/)!;
    expect(response.headers.get("content-security-policy")).toContain(`'nonce-${script[1]}'`);
    expect(() => new Function(script[2])).not.toThrow();
    expect(() => rehearsalPage('" onload="alert(1)')).toThrow("Invalid page nonce");
  });

  it("rejects a forged Host even when the TCP connection is local", async () => {
    const result = await new Promise<number>(resolve => {
      const request = httpRequest(`${instance.url}/api/state`, { headers: { Host: "attacker.invalid" } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode!)); });
      request.end();
    });
    expect(result).toBe(403);
  });

  it("requires both exact Origin and the session CSRF token", async () => {
    const browser = await client(instance);
    const headers = { "Content-Type": "application/json", Cookie: browser.cookie, "X-Alpha-Rehearsal-CSRF": browser.current().csrf };
    for (const origin of [undefined, "null", "http://localhost:4318", "https://attacker.invalid"]) {
      const response = await fetch(`${instance.url}/api/session/role`, { method: "POST", headers: { ...headers, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ role: "owner" }) });
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
    const noCsrf = await fetch(`${instance.url}/api/session/role`, { method: "POST", headers: { "Content-Type": "application/json", Origin: instance.url, Cookie: browser.cookie }, body: JSON.stringify({ role: "owner" }) });
    expect(noCsrf.status).toBe(403);
    const another = await client(instance);
    const wrongSession = await fetch(`${instance.url}/api/session/role`, { method: "POST", headers: { ...headers, Origin: instance.url, Cookie: another.cookie }, body: JSON.stringify({ role: "owner" }) });
    expect(wrongSession.status).toBe(403);
    expect((await browser.refresh()).role).toBe("seller");
  });

  it("rejects cross-site fetch metadata and unknown methods and routes", async () => {
    const crossSite = await fetch(`${instance.url}/api/state`, { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(crossSite.status).toBe(403);
    expect((await fetch(`${instance.url}/api/state?actor=owner`)).status).toBe(404);
    expect((await fetch(`${instance.url}/api/state`, { method: "OPTIONS" })).status).toBe(405);
    expect((await fetch(`${instance.url}/api/production`)).status).toBe(404);
  });

  it("never accepts actors, raw commands, extra role fields, or wrong-role actions", async () => {
    const browser = await client(instance);
    const before = browser.current().revision;
    await browser.action("funding-create", { assetId: ASSET, purpose: "principal", actor: { kind: "operator", id: "forged" } }, 400);
    await browser.action("funding-create", { assetId: ASSET, purpose: "principal", unexpected: "field" }, 400);
    await browser.post("/api/session/role", { role: "owner", actor: "forged" }, 400);
    await browser.action("execute", { command: { type: "pause" } }, 400);
    await browser.action("wallet-pause", {}, 403);
    await browser.role("buyer");
    await browser.action("funding-create", { assetId: ASSET, purpose: "principal" }, 403);
    expect((await browser.refresh()).revision).toBe(before);
  });

  it("limits JSON request size and refuses non-JSON requests", async () => {
    const browser = await client(instance);
    const headers = { Cookie: browser.cookie, Origin: instance.url, "X-Alpha-Rehearsal-CSRF": browser.current().csrf };
    const tooLarge = await fetch(`${instance.url}/api/session/role`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ role: "seller", padding: "x".repeat(5000) }) });
    expect(tooLarge.status).toBe(413);
    const nonJson = await fetch(`${instance.url}/api/session/role`, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: '{"role":"seller"}' });
    expect(nonJson.status).toBe(415);
    const broken = await fetch(`${instance.url}/api/session/role`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{" });
    expect(broken.status).toBe(400);
  });

  it("rechecks the actual runtime on requests and before creating a server", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(createRehearsalServer({ mode: "simulation-only" })).rejects.toThrow("local development or test");
      const response = await fetch(`${instance.url}/api/state`);
      expect(response.status).toBe(409);
      expect(await response.text()).toContain("local development or test");
    } finally { vi.stubEnv("NODE_ENV", "test"); }
  });

  it("refuses unrelated persistent directories and public-host CLI options", async () => {
    const directory = await mkdtemp(join(tmpdir(), "alpha-wallet-http-unrelated-"));
    directories.push(directory);
    await writeFile(join(directory, "unrelated.txt"), "unrelated fixture");
    await expect(createRehearsalServer({ mode: "simulation-only", dataDir: directory })).rejects.toThrow("unmarked nonempty");
    await expect(createRehearsalServer({ mode: "simulation-only", dataDir: "/" })).rejects.toThrow("absolute local rehearsal");
    await expect(createRehearsalServer({ mode: "simulation-only", port: -1 })).rejects.toThrow("Invalid rehearsal port");
  });
});

describe("durable rehearsal journey through HTTP", () => {
  it("delivers 200 + 300 principal, recovers a lost provider response, and settles fees separately", async () => {
    const instance = await app();
    const browser = await client(instance);
    await browser.action("listing-create", { assetId: ASSET, amount: "500", price: "3.20" });
    const listingId = browser.current().listings[0].id;
    await browser.action("funding-create", { assetId: ASSET, purpose: "principal" });
    const intentId = browser.current().funding[0].id;
    await browser.role("owner");
    await browser.action("listing-approve", { listingId });
    expect(browser.current().listings[0].status).toBe("awaiting_funding");
    await browser.role("buyer");
    await browser.action("trade-reserve", { listingId, amount: "200" }, 409);
    await browser.role("verifier");
    await browser.action("funding-observe", { intentId, amount: "500", finalized: true }, 409);
    await browser.action("funding-observe", { intentId, amount: "500", finalized: false });
    expect(browser.asset().custody).toBe("0");
    expect(browser.current().funding[0].status).toBe("pending");
    await browser.action("funding-observe", { intentId, amount: "500", finalized: true });
    expect(browser.current().listings[0].status).toBe("active");
    expect(browser.asset().listing).toBe("500");
    await browser.role("buyer");
    await browser.action("trade-reserve", { listingId, amount: "200" });
    await browser.action("trade-reserve", { listingId, amount: "300" });
    const [first, second] = browser.current().trades;
    expect(first.fiatTotal).toBe("646.40");
    expect(browser.asset().reserved).toBe("500");
    expect(browser.asset().listing).toBe("0");
    await browser.action("trade-reserve", { listingId, amount: "1" }, 409);

    for (const [index, trade] of [first, second].entries()) {
      await browser.role("buyer");
      await browser.action("payment-claim", { tradeId: trade.id });
      await browser.role("seller");
      await browser.action("release-authorize", { tradeId: trade.id }, 409);
      await browser.role("verifier");
      await browser.action("payment-verify", { tradeId: trade.id });
      await browser.role("seller");
      await browser.action("release-authorize", { tradeId: trade.id });
      if (index === 0) {
        await browser.role("worker");
        await browser.action("payout-queue", { tradeId: trade.id }, 409);
        await browser.role("owner");
        await browser.action("gas-ready", { assetId: ASSET, ready: true });
      }
      await browser.role("verifier");
      await browser.action("custody-reconcile", { assetId: ASSET });
      await browser.role("worker");
      await browser.action("payout-queue", { tradeId: trade.id });
      const payoutId = browser.current().payouts[index].id;
      await browser.action("payout-step", { payoutId, loseResponse: index === 0 });
      if (index === 0) {
        expect(browser.current().payouts[0]).toMatchObject({ state: "submission_unknown", providerStatus: "broadcast", dispatchCount: 1, held: "200" });
        expect(browser.asset().delivered).toBe("0");
        await browser.action("payout-step", { payoutId, loseResponse: false });
        expect(browser.current().payouts[0].state).toBe("broadcast");
      }
      await browser.role("verifier");
      await browser.action("payout-finalize", { payoutId, successful: true });
      expect(browser.current().payouts[index]).toMatchObject({ state: "broadcast", providerStatus: "finalized_success" });
      expect(browser.asset().delivered).toBe(index === 0 ? "0" : "200");
      await browser.role("worker");
      await browser.action("payout-step", { payoutId, loseResponse: false });
      expect(browser.current().payouts[index]).toMatchObject({ state: "confirmed", held: "0", dispatchCount: 1 });
      if (index === 0) {
        expect(browser.asset()).toMatchObject({ custody: "300", reserved: "300", delivered: "200", commissionDue: "4", revenue: "0" });
        await browser.role("seller");
        await browser.action("listing-create", { assetId: ASSET, amount: "1", price: "3.20" }, 409);
        await browser.action("funding-create", { assetId: ASSET, purpose: "commission" });
        const feeIntent = browser.current().funding.find(item => item.purpose === "commission")!.id;
        await browser.role("verifier");
        await browser.action("funding-observe", { intentId: feeIntent, amount: "10", finalized: false });
        await browser.action("funding-observe", { intentId: feeIntent, amount: "10", finalized: true });
        expect(browser.asset()).toMatchObject({ custody: "310", commissionAvailable: "6", commissionDue: "0", revenue: "4", reserved: "300" });
      }
    }
    expect(browser.asset()).toMatchObject({ custody: "10", listing: "0", reserved: "0", delivered: "500", commissionAvailable: "0", commissionDue: "0", revenue: "10" });
    const final = browser.current();
    await instance.close();
    const reopened = await app(instance.dataDir);
    const recovered = await client(reopened);
    expect(recovered.current().revision).toBe(final.revision);
    expect(recovered.current().payouts).toEqual(final.payouts);
    expect(recovered.asset()).toEqual(final.assets.find(item => item.id === ASSET));
  }, 60000);

  it("keeps a crash-before-submit withdrawal held across retries and reopening", async () => {
    const instance = await app();
    const browser = await client(instance);
    await browser.action("funding-create", { assetId: ASSET, purpose: "principal" });
    const intentId = browser.current().funding[0].id;
    await browser.role("verifier");
    await browser.action("funding-observe", { intentId, amount: "100", finalized: false });
    await browser.action("funding-observe", { intentId, amount: "100", finalized: true });
    await browser.action("custody-reconcile", { assetId: ASSET });
    await browser.role("owner");
    await browser.action("gas-ready", { assetId: ASSET, ready: true });
    await browser.role("seller");
    await browser.action("withdrawal-create", { assetId: ASSET, amount: "25", destination: "real-address" }, 400);
    await browser.action("withdrawal-create", { assetId: ASSET, amount: "25" });
    const payoutId = browser.current().payouts[0].id;
    expect(browser.current().payouts[0].destination).toBe("sim://tron-sim-usdt/recipient/rehearsal-seller");
    await browser.role("worker");
    await browser.action("payout-claim-only", { payoutId });
    await browser.action("payout-step", { payoutId, loseResponse: false });
    await browser.action("payout-step", { payoutId, loseResponse: false });
    expect(browser.current().payouts[0]).toMatchObject({ state: "submitting", providerStatus: "not_found", dispatchCount: 1, held: "25", recovery: "lookup_original_reference" });
    expect(browser.asset().custody).toBe("100");
    await instance.close();
    const recovered = await client(await app(instance.dataDir));
    await recovered.role("worker");
    await recovered.action("payout-step", { payoutId, loseResponse: false });
    expect(recovered.current().payouts[0]).toMatchObject({ state: "submitting", providerStatus: "not_found", dispatchCount: 1, held: "25" });
    await recovered.role("owner");
    await recovered.action("wallet-pause", {});
    await recovered.role("seller");
    await recovered.action("withdrawal-create", { assetId: ASSET, amount: "1" }, 409);
    expect(recovered.asset().custody).toBe("100");
  }, 60000);
});
