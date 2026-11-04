// @vitest-environment node
import { mkdtemp, rm, writeFile, unlink, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRehearsalServer, type RehearsalServer } from "../../../scripts/alpha-wallet/rehearsal-server";
import { rehearsalPage } from "../../../scripts/alpha-wallet/rehearsal-page";
import { walletDigest } from "./commands";

// These are real loopback HTTP integration tests with synthetic disk-backed
// fixtures. No browser actor, production session, external provider, or database
// connection is available through this rehearsal surface.
type View = {
  mode: string; rehearsalId: string; csrf: string; role: string; revision: number; paused: string | null;
  assets: Array<{ id: string; custody: string; available: string; listing: string; reserved: string; delivered: string; commissionAvailable: string; commissionDue: string; revenue: string }>;
  listings: Array<{ id: string; status: string; funded: boolean; approved: boolean; available: string }>;
  funding: Array<{ id: string; status: string; amount: string | null; purpose: string }>;
  trades: Array<{ id: string; status: string; amount: string; fiatTotal: string; disputed: boolean }>;
  payouts: Array<{ id: string; state: string; providerStatus: string; dispatchCount: number; held: string; recovery: string; destination: string }>;
};
const ASSET = "tron-sim-usdt";
const apps: RehearsalServer[] = [];
const directories: string[] = [];
const pages: Array<{ close(): void }> = [];

async function app(dataDir?: string, port?: number) {
  const directory = dataDir ?? await mkdtemp(join(tmpdir(), "alpha-wallet-http-test-"));
  if (!dataDir) directories.push(directory);
  const instance = await createRehearsalServer({ mode: "simulation-only", dataDir: directory, port });
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
      "Content-Type": "application/json", Origin: instance.url, Cookie: cookie, "X-Alpha-Rehearsal-CSRF": state.csrf, "X-Alpha-Rehearsal-ID": state.rehearsalId,
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

type PageWindow = Window & typeof globalThis;
// jsdom is already a locked test dependency. Its DOM executes the delivered
// script; requests go to the actual loopback server. This is not visual QA.
const { JSDOM, VirtualConsole } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { url: string; runScripts: "dangerously"; virtualConsole: unknown; beforeParse(window: PageWindow): void }) => { window: PageWindow };
  VirtualConsole: new () => { on(event: string, callback: (error: Error) => void): void };
};
const PENDING_KEY = "alpha-wallet-rehearsal-pending-v1";
type Retained = { path: string; role: string; rehearsalId: string; body: Record<string, unknown>; outcome: string; message?: string };

async function renderedClient(instance: RehearsalServer, initialCookie: string, options: { retained?: string; storageUnavailable?: boolean } = {}) {
  let cookie = initialCookie, dom: { window: PageWindow } | undefined, inFlight = 0;
  let retained = options.retained;
  let fault: { path: string; kind: "lose-after-commit" | "reject-before-send" } | undefined;
  const errors: string[] = [];
  const requests: Array<{ path: string; body: Record<string, unknown>; rehearsalId: string | null }> = [];
  const committedResponses: View[] = [];
  async function transport(input: RequestInfo | URL, init: RequestInit = {}) {
    if (typeof input !== "string") throw new Error("The fixture page must use an explicit local route");
    const url = new URL(input, instance.url);
    if (url.origin !== instance.url) throw new Error("No external page request is allowed");
    const headers = new Headers(init.headers);
    headers.set("Cookie", cookie);
    const post = init.method === "POST";
    if (post) {
      headers.set("Origin", instance.url);
      requests.push({ path: url.pathname, body: JSON.parse(String(init.body)), rehearsalId: headers.get("X-Alpha-Rehearsal-ID") });
    }
    const inject = post && fault?.path === url.pathname ? fault : undefined;
    if (inject) fault = undefined;
    inFlight++;
    try {
      if (inject?.kind === "reject-before-send") return new Response(JSON.stringify({ error: "FIXTURE_REJECTION", outcome: "not_applied", message: "Synthetic pre-action rejection on a later retry" }), { status: 403, headers: { "Content-Type": "application/json" } });
      const response = await fetch(url, { ...init, headers });
      const nextCookie = response.headers.get("set-cookie");
      if (nextCookie) cookie = nextCookie.split(";")[0];
      if (inject?.kind === "lose-after-commit") {
        expect(response.status).toBe(200);
        committedResponses.push(await response.json() as View);
        throw new TypeError("Synthetic HTTP response loss after real commit");
      }
      return response;
    } finally { inFlight--; }
  }
  async function settled() {
    await vi.waitFor(() => {
      expect(inFlight).toBe(0);
      expect(dom?.window.document.querySelector("#role")).not.toBeNull();
      expect(dom?.window.document.querySelector("#app")?.getAttribute("aria-busy")).toBe("false");
    }, { timeout: 10_000, interval: 10 });
  }
  async function reload() {
    if (dom) { retained = dom.window.sessionStorage.getItem(PENDING_KEY) ?? undefined; dom.window.close(); }
    const response = await transport("/");
    expect(response.status).toBe(200);
    const console = new VirtualConsole();
    console.on("jsdomError", error => errors.push(error.message));
    dom = new JSDOM(await response.text(), {
      url: instance.url, runScripts: "dangerously", virtualConsole: console,
      beforeParse(window) {
        window.fetch = transport;
        Object.defineProperty(window.crypto, "randomUUID", { value: randomUUID });
        window.addEventListener("error", event => errors.push(event.message));
        window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
        if (retained !== undefined) window.sessionStorage.setItem(PENDING_KEY, retained);
        if (options.storageUnavailable) Object.defineProperty(window.Storage.prototype, "setItem", { value: () => { throw new Error("Synthetic session storage failure"); } });
      },
    });
    await settled();
  }
  const page = {
    errors, requests, committedResponses, reload,
    get window() { return dom!.window; },
    get document() { return dom!.window.document; },
    pending(): Retained | null { const value = dom!.window.sessionStorage.getItem(PENDING_KEY); return value ? JSON.parse(value) as Retained : null; },
    failNext(path: string, kind: "lose-after-commit" | "reject-before-send") { fault = { path, kind }; },
    async snapshot() { const response = await transport("/api/state"); expect(response.status).toBe(200); return await response.json() as View; },
    async submit(action: string, fields: Record<string, string> = {}) {
      const form = dom!.window.document.querySelector<HTMLFormElement>(`form[data-action="${action}"]`)!;
      expect(form).not.toBeNull();
      for (const [name, value] of Object.entries(fields)) {
        const field = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
        expect(field).not.toBeNull(); field.value = value;
      }
      form.dispatchEvent(new dom!.window.Event("submit", { bubbles: true, cancelable: true }));
      await settled();
    },
    async click(selector: string) {
      const button = dom!.window.document.querySelector<HTMLButtonElement>(selector)!;
      expect(button).not.toBeNull(); button.click(); await settled();
    },
    close() { dom?.window.close(); },
  };
  pages.push(page);
  await reload();
  return page;
}

async function fundAvailable(instance: RehearsalServer, quantity = "100") {
  const api = await client(instance);
  await api.action("funding-create", { assetId: ASSET, purpose: "principal" });
  const intentId = api.current().funding[0].id;
  await api.role("verifier");
  await api.action("funding-observe", { intentId, amount: quantity, finalized: false });
  await api.action("funding-observe", { intentId, amount: quantity, finalized: true });
  await api.action("custody-reconcile", { assetId: ASSET });
  await api.role("owner");
  await api.action("gas-ready", { assetId: ASSET, ready: true });
  await api.role("seller");
  return api;
}

beforeAll(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
});
afterAll(async () => {
  for (const page of pages) page.close();
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
    const headers = { "Content-Type": "application/json", Cookie: browser.cookie, "X-Alpha-Rehearsal-CSRF": browser.current().csrf, "X-Alpha-Rehearsal-ID": browser.current().rehearsalId };
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
    const headers = { Cookie: browser.cookie, Origin: instance.url, "X-Alpha-Rehearsal-CSRF": browser.current().csrf, "X-Alpha-Rehearsal-ID": browser.current().rehearsalId };
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

describe.sequential("rendered request recovery against the real loopback ledger", () => {
  it("retains a committed reservation across response loss, reload and same-directory restart without reserving twice", async () => {
    let instance = await app();
    const api = await fundAvailable(instance, "500");
    await api.action("listing-create", { assetId: ASSET, amount: "500", price: "3.20" });
    const listingId = api.current().listings[0].id;
    await api.role("owner"); await api.action("listing-approve", { listingId }); await api.role("buyer");
    const before = api.current(), ui = await renderedClient(instance, api.cookie);
    ui.failNext("/api/actions/trade-reserve", "lose-after-commit");
    await ui.submit("trade-reserve", { amount: "200" });
    const original = ui.pending()!;
    expect(original).toMatchObject({ path: "/api/actions/trade-reserve", role: "buyer", rehearsalId: before.rehearsalId, outcome: "unknown", body: { listingId, amount: "200" } });
    expect(ui.committedResponses[0].revision).toBe(before.revision + 1);
    expect(ui.committedResponses[0].trades).toHaveLength(1);
    expect(ui.document.querySelector<HTMLSelectElement>("#role")!.disabled).toBe(true);
    expect(ui.document.querySelector("#dismiss-pending")).toBeNull();
    await ui.submit("trade-reserve", { amount: "50" });
    expect(ui.requests).toHaveLength(1);
    await ui.reload();
    expect(ui.pending()).toEqual(original);

    const directory = instance.dataDir, port = Number(new URL(instance.url).port);
    await instance.close(); instance = await app(directory, port);
    await ui.reload();
    expect((await ui.snapshot()).role).toBe("seller"); // In-memory session roles reset.
    expect((await ui.snapshot()).rehearsalId).toBe(original.rehearsalId);
    expect(ui.pending()).toEqual(original);
    await ui.click("#retry-pending");
    const recovered = await ui.snapshot();
    expect(recovered.role).toBe("buyer");
    expect(recovered.revision).toBe(before.revision + 1);
    expect(recovered.trades).toEqual(ui.committedResponses[0].trades);
    expect(recovered.assets[0]).toMatchObject({ custody: "500", listing: "300", reserved: "200" });
    expect(ui.requests.filter(request => request.path === original.path)).toEqual([
      { path: original.path, body: original.body, rehearsalId: original.rehearsalId },
      { path: original.path, body: original.body, rehearsalId: original.rehearsalId },
    ]);
    expect(ui.requests.find(request => request.path === "/api/session/role")?.body).toEqual({ role: "buyer" });
    expect(ui.pending()).toBeNull(); expect(ui.errors).toEqual([]);
  }, 60_000);

  it("keeps an uncertain withdrawal sticky after a later known rejection and retries only the original intent", async () => {
    const instance = await app(), api = await fundAvailable(instance);
    const ui = await renderedClient(instance, api.cookie), before = await ui.snapshot();
    ui.failNext("/api/actions/withdrawal-create", "lose-after-commit");
    await ui.submit("withdrawal-create", { amount: "25" });
    const original = ui.pending()!;
    expect(original.outcome).toBe("unknown");
    expect(ui.committedResponses[0].payouts).toHaveLength(1);
    expect(ui.committedResponses[0].assets[0]).toMatchObject({ custody: "100", available: "75", reserved: "25" });
    await ui.reload();
    ui.failNext(original.path, "reject-before-send");
    await ui.click("#retry-pending");
    expect(ui.pending()).toMatchObject({ ...original, outcome: "unknown", message: "Synthetic pre-action rejection on a later retry" });
    expect(ui.document.querySelector("#dismiss-pending")).toBeNull();
    expect(ui.document.querySelector<HTMLSelectElement>("#role")!.disabled).toBe(true);
    await ui.reload(); await ui.click("#retry-pending");
    const recovered = await ui.snapshot();
    expect(recovered.revision).toBe(before.revision + 1);
    expect(recovered.payouts).toEqual(ui.committedResponses[0].payouts);
    expect(recovered.payouts[0]).toMatchObject({ held: "25", dispatchCount: 0, providerStatus: "not_found" });
    expect(ui.requests).toHaveLength(3);
    expect(ui.requests.every(request => JSON.stringify(request.body) === JSON.stringify(original.body) && request.rehearsalId === original.rehearsalId)).toBe(true);
    expect(ui.pending()).toBeNull(); expect(ui.errors).toEqual([]);
  }, 60_000);

  it("holds the old withdrawal if the same origin is reused for a different funded ledger", async () => {
    let instance = await app();
    const api = await fundAvailable(instance), ui = await renderedClient(instance, api.cookie);
    ui.failNext("/api/actions/withdrawal-create", "lose-after-commit");
    await ui.submit("withdrawal-create", { amount: "25" });
    const original = ui.pending()!, directory = instance.dataDir, port = Number(new URL(instance.url).port);
    await instance.close(); instance = await app(undefined, port);
    const replacement = await fundAvailable(instance);
    const fresh = replacement.current();
    expect(fresh.rehearsalId).not.toBe(original.rehearsalId);
    await ui.reload();
    const attempts = ui.requests.length;
    await ui.click("#retry-pending");
    expect(ui.requests).toHaveLength(attempts); // Not even a role change crosses ledger identity.
    expect(ui.pending()).toMatchObject({ body: original.body, rehearsalId: original.rehearsalId, outcome: "unknown" });
    expect(ui.document.querySelector("#pending-operation")?.textContent).toContain("different local rehearsal");
    const refused = await fetch(`${instance.url}${original.path}`, { method: "POST", headers: {
      "Content-Type": "application/json", Cookie: replacement.cookie, Origin: instance.url,
      "X-Alpha-Rehearsal-CSRF": fresh.csrf, "X-Alpha-Rehearsal-ID": original.rehearsalId,
    }, body: JSON.stringify(original.body) });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "REHEARSAL_CONTEXT_CHANGED", outcome: "not_applied" });
    const untouched = await replacement.refresh();
    expect(untouched.revision).toBe(fresh.revision); expect(untouched.payouts).toEqual([]);
    expect(untouched.assets[0]).toMatchObject({ custody: "100", available: "100", reserved: "0" });

    await instance.close(); instance = await app(directory, port);
    await ui.reload(); await ui.click("#retry-pending");
    expect((await ui.snapshot()).payouts).toEqual(ui.committedResponses[0].payouts);
    expect(ui.pending()).toBeNull(); expect(ui.errors).toEqual([]);
  }, 60_000);

  it("classifies a failed state projection after commit as unknown and preserves the same funding request", async () => {
    const instance = await app(), api = await fundAvailable(instance);
    await api.action("withdrawal-create", { assetId: ASSET, amount: "25" });
    const payout = api.current().payouts[0], ui = await renderedClient(instance, api.cookie);
    // A malformed offline provider record breaks view(), after createDepositIntent
    // has already committed. No financial domain command or commit is mocked.
    const broken = join(instance.dataDir, "provider", `${walletDigest(`sim-payout-${payout.id}`)}.broadcast.json`);
    await writeFile(broken, "{", { mode: 0o600 });
    await ui.submit("funding-create", { purpose: "principal" });
    const original = ui.pending()!;
    expect(original.outcome).toBe("unknown"); expect(ui.document.querySelector("#dismiss-pending")).toBeNull();
    await unlink(broken);
    const committed = await ui.snapshot();
    expect(committed.funding).toHaveLength(2);
    expect(committed.revision).toBe(api.current().revision + 1);
    await ui.reload(); await ui.click("#retry-pending");
    const recovered = await ui.snapshot();
    expect(recovered.revision).toBe(committed.revision); expect(recovered.funding).toEqual(committed.funding);
    expect(ui.requests).toEqual([
      { path: original.path, body: original.body, rehearsalId: original.rehearsalId },
      { path: original.path, body: original.body, rehearsalId: original.rehearsalId },
    ]);
    expect(ui.pending()).toBeNull(); expect(ui.errors).toEqual([]);
  }, 60_000);

  it("does not send or crash for invalid decimal input or unavailable session storage", async () => {
    const instance = await app(), api = await client(instance), ui = await renderedClient(instance, api.cookie);
    for (const amount of ["abc", "-1", "1e2"]) {
      await ui.submit("listing-create", { amount });
      expect(ui.requests).toEqual([]); expect(ui.pending()).toBeNull();
      expect(ui.document.querySelector("#toast")?.textContent).toContain("No operation was sent");
    }
    expect(ui.errors).toEqual([]);
    const blocked = await renderedClient(instance, api.cookie, { storageUnavailable: true });
    await blocked.submit("listing-create");
    expect(blocked.requests).toEqual([]); expect((await blocked.snapshot()).listings).toEqual([]);
    expect(blocked.document.querySelector("#pending-operation")?.textContent).toContain("No operation was sent");
    expect(blocked.errors).toEqual([]);
  }, 30_000);

  it("keeps legacy or malformed retained operations held without discarding their evidence", async () => {
    const instance = await app(), api = await client(instance);
    const legacy = JSON.stringify({ path: "/api/actions/withdrawal-create", role: "seller", outcome: "unknown", body: { requestId: "legacy-pending-123", assetId: ASSET, amount: "25" } });
    for (const retained of [legacy, "{malformed"]) {
      const ui = await renderedClient(instance, api.cookie, { retained });
      expect(ui.window.sessionStorage.getItem(PENDING_KEY)).toBe(retained);
      expect(ui.document.querySelector("#pending-operation")?.textContent).toContain("needs inspection");
      expect(ui.document.querySelector("#retry-pending")).toBeNull();
      expect(ui.document.querySelector("#dismiss-pending")).toBeNull();
      expect(ui.document.querySelector<HTMLSelectElement>("#role")!.disabled).toBe(true);
      await ui.submit("listing-create"); expect(ui.requests).toEqual([]); expect(ui.errors).toEqual([]);
    }
  }, 30_000);

  it("refuses a missing or wrong rehearsal ID before role changes, and refuses unsafe saved identity files", async () => {
    const instance = await app(), api = await client(instance), before = api.current();
    for (const header of [undefined, "f".repeat(64)]) {
      const response = await fetch(`${instance.url}/api/session/role`, { method: "POST", headers: {
        "Content-Type": "application/json", Origin: instance.url, Cookie: api.cookie,
        "X-Alpha-Rehearsal-CSRF": before.csrf, ...(header ? { "X-Alpha-Rehearsal-ID": header } : {}),
      }, body: JSON.stringify({ role: "owner" }) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "REHEARSAL_CONTEXT_CHANGED", outcome: "not_applied" });
    }
    expect((await api.refresh()).role).toBe("seller");
    await instance.close();
    const identity = join(instance.dataDir, "alpha-wallet-rehearsal-id");
    await writeFile(identity, "invalid\n");
    await expect(app(instance.dataDir)).rejects.toThrow("Invalid rehearsal directory identity");
    await unlink(identity);
    const target = join(instance.dataDir, "other-identity");
    await writeFile(target, `${before.rehearsalId}\n`); await symlink(target, identity);
    await expect(app(instance.dataDir)).rejects.toThrow("Invalid rehearsal directory identity");
  }, 30_000);
});
