// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import type { MarketSnapshot } from "@/types/market";

const state = vi.hoisted(() => ({ pool: null as Pool | null, db: null as AlphaExchangeDb | null,
  market: null as MarketSnapshot | null, enqueue: vi.fn(), marketRead: vi.fn(), mutate: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => state.pool }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/alpha-exchange-repository", () => ({ getAlphaExchangeRepository: async () => ({
  loadSelectedSnapshot: async () => structuredClone(state.db),
}) }));
vi.mock("@/lib/market-service", () => ({ getMarketSnapshot: state.marketRead }));
vi.mock("@/lib/usdt-demand-store", () => ({ DEMAND_TABLES: [], mutateDemands: state.mutate }));
vi.mock("@/lib/marketplace-email-delivery", () => ({ sendMarketplaceEmail: state.enqueue }));
import { createDemand, respondToDemand } from "@/lib/usdt-demand-engine";
import { queueDemandEmails } from "@/lib/usdt-demand-email";
import { enqueueMarketplaceEmail, runMarketplaceEmailSweep, MARKETPLACE_EMAIL_OUTBOX_SCHEMA, type PreparedMarketplaceEmail } from "@/lib/marketplace-email-outbox";
import { demandTestDb, demandTestMarket, demandTestTerms } from "@/test-utils/usdt-demand-fixtures";

let sql: PGlite;
let tail = Promise.resolve();
async function lock() {
  const previous = tail; let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; }); await previous; return release;
}
async function query(text: string, values?: unknown[]) {
  const result = text === MARKETPLACE_EMAIL_OUTBOX_SCHEMA ? (await sql.exec(text)).at(-1)! : await sql.query(text, values);
  return { rows: result.rows, rowCount: result.affectedRows };
}
const pool = {
  async query(text: string, values?: unknown[]) { const release = await lock(); try { return await query(text, values); } finally { release(); } },
  async connect() { return { query, release: await lock() }; },
} as unknown as Pool;
const job = async () => (await sql.query<{ status: string; last_reason: string; request_body: string | null; attempts: number }>(
  "select * from alpha_exchange.marketplace_email_outbox" )).rows[0];
const due = () => sql.exec("update alpha_exchange.marketplace_email_gate set available_at = now() - interval '1 second'; update alpha_exchange.marketplace_email_outbox set available_at = now() - interval '1 second'");
function pendingEmail(response = false): PreparedMarketplaceEmail {
  const db = state.db!;
  const demand = db.usdtDemands![0];
  if (response) respondToDemand(db, "seller", demand.id, {
    revision: 1, listingId: "listing-seller", price: "3.10", operationId: randomUUID(),
  }, state.market!);
  const notice = db.notifications.find(n => response ? n.userId === "buyer" : n.userId === "seller")!;
  return { event: response ? "usdt_demand_response" : "usdt_demand_published",
    recipientEmail: response ? "buyer@example.test" : "seller@example.test", idempotencyKey: notice.id,
    body: JSON.stringify({ subject: notice.title, text: notice.message }) };
}
async function delayEmail(response = false) {
  const email = pendingEmail(response); const send = vi.fn().mockResolvedValue({ ok: true });
  await sql.exec("update alpha_exchange.marketplace_email_gate set available_at = now() + interval '2 minutes'");
  expect(await enqueueMarketplaceEmail(email, send)).toMatchObject({ ok: true, queued: true });
  state.db!.notifications.find(n => n.id === email.idempotencyKey)!.demandEmail!.state = "queued";
  expect(send).not.toHaveBeenCalled(); return { email, send };
}

beforeAll(async () => {
  sql = await PGlite.create();
  await sql.exec("create schema alpha_exchange; create table alpha_exchange.users (id text primary key, email text not null, payload jsonb not null); create table alpha_exchange.purchase_requests (id text primary key, status text not null)");
}, 20_000);
beforeEach(async () => {
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1"); vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "1");
  vi.resetAllMocks(); state.pool = pool; state.db = demandTestDb(); state.market = demandTestMarket();
  state.marketRead.mockImplementation(async () => state.market);
  state.mutate.mockImplementation(async (fn: (db: AlphaExchangeDb) => unknown) => fn(state.db!));
  createDemand(state.db, "buyer", { terms: demandTestTerms(), operationId: randomUUID() }, state.market);
  await sql.exec(MARKETPLACE_EMAIL_OUTBOX_SCHEMA);
  await sql.exec("truncate alpha_exchange.marketplace_email_outbox, alpha_exchange.users; update alpha_exchange.marketplace_email_gate set available_at = now() - interval '1 second'");
  for (const user of state.db.users) await sql.query("insert into alpha_exchange.users values ($1,$2,$3::jsonb)", [user.id, user.email, JSON.stringify(user)]);
  state.enqueue.mockResolvedValue({ ok: true, queued: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await sql.close(); });

describe("demand email eligibility at durable delivery", () => {
  it("delivers the unchanged frozen publication notice after a queue delay", async () => {
    const { email, send } = await delayEmail(); await due();
    expect(await runMarketplaceEmailSweep(send)).toMatchObject({ sent: 1, suppressed: 0 });
    expect(send).toHaveBeenCalledWith(email); expect(await job()).toMatchObject({ status: "sent", request_body: null });
  });
  const changes: Array<[string, () => void]> = [
    ["email preference disabled", () => { state.db!.users.find(u => u.id === "seller")!.notificationPreferences!.email = false; }],
    ["buyer blocks seller", () => { state.db!.users[0].blockedUserIds = ["seller"]; }],
    ["seller blocks buyer", () => { state.db!.users.find(u => u.id === "seller")!.blockedUserIds = ["buyer"]; }],
    ["seller suspended", () => { state.db!.users.find(u => u.id === "seller")!.sellerStatus = "suspended"; }],
    ["buyer disabled", () => { state.db!.users[0].disabled = true; }],
    ["request cancelled", () => { state.db!.usdtDemands![0].state = "cancelled"; }],
    ["request matched", () => { state.db!.usdtDemands![0].state = "matched"; }],
    ["request renewed", () => { state.db!.usdtDemands![0].revision += 1; }],
    ["request expired", () => { state.db!.usdtDemands![0].expiresAt = new Date(Date.now() - 1).toISOString(); }],
    ["price outside new band", () => { state.market = demandTestMarket(4); }],
    ["feature disabled", () => { vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "0"); }],
    ["delivery disabled", () => { vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0"); }],
    ["notice missing", () => { state.db!.notifications = []; }],
    ["notice recipient changed", () => { state.db!.notifications.find(n => n.userId === "seller")!.userId = "seller-two"; }],
    ["recipient email changed", () => { state.db!.users.find(u => u.id === "seller")!.email = "changed@example.test"; }],
    ["recipient email no longer verified", () => { state.db!.users.find(u => u.id === "seller")!.emailVerified = false; }],
    ["recipient phone verification removed", () => { delete state.db!.users.find(u => u.id === "seller")!.phoneVerifiedAt; }],
    ["recipient adult confirmation removed", () => { delete state.db!.users.find(u => u.id === "seller")!.ageEligibility; }],
    ["seller profile hidden", () => { state.db!.users.find(u => u.id === "seller")!.isProfileHidden = true; }],
    ["seller on vacation", () => { state.db!.users.find(u => u.id === "seller")!.availabilityStatus = "vacation"; }],
    ["notice exceeds delivery window", () => { state.db!.notifications.find(n => n.userId === "seller")!.createdAt = new Date(Date.now() - 23 * 3600_000).toISOString(); }],
    ["notice timestamp invalid", () => { state.db!.notifications.find(n => n.userId === "seller")!.createdAt = "invalid"; }],
  ];
  it.each(changes)("suppresses queued publication after %s", async (_label, change) => {
    const { send } = await delayEmail(); change(); await due();
    expect(await runMarketplaceEmailSweep(send)).toMatchObject({ sent: 0, suppressed: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(await job()).toMatchObject({ status: "suppressed", request_body: null, last_reason: "demand_no_longer_eligible" });
  });
  it.each(["withdrawn", "listing_changed", "inventory_reserved", "event_changed"])("suppresses a delayed response when %s", async change => {
    const { send } = await delayEmail(true);
    if (change === "withdrawn") state.db!.usdtDemands![0].offers[0].state = "withdrawn";
    if (change === "listing_changed") state.db!.marketplaceListings[0].updatedAt = new Date(Date.now() + 10).toISOString();
    if (change === "inventory_reserved") state.db!.marketplaceListings[0].availableAmount = "1";
    if (change === "event_changed") await sql.exec("update alpha_exchange.marketplace_email_outbox set event = 'usdt_demand_published'");
    await due(); expect((await runMarketplaceEmailSweep(send)).suppressed).toBe(1); expect(send).not.toHaveBeenCalled();
  });
  it("rechecks demand eligibility before a provider retry", async () => {
    const email = pendingEmail(); const send = vi.fn().mockResolvedValueOnce({ ok: false, reason: "timeout", retryable: true }).mockResolvedValue({ ok: true });
    await enqueueMarketplaceEmail(email, send); expect((await job()).status).toBe("pending");
    state.db!.users.find(u => u.id === "seller")!.notificationPreferences!.email = false;
    await due(); expect((await runMarketplaceEmailSweep(send)).suppressed).toBe(1); expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(["stale", "unavailable"])("pauses a queued notice during a %s quote and recovers without sending stale terms", async status => {
    const { send } = await delayEmail();
    state.market = demandTestMarket(3.2, status === "stale" ? 300_000 : 0);
    if (status === "unavailable") state.market.unavailablePairs.push("usdtIls");
    await due();
    expect(await runMarketplaceEmailSweep(send)).toMatchObject({ sent: 0, pending: 1, suppressed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await job()).toMatchObject({ status: "pending", attempts: 1, last_reason: "attempt_interrupted_retry_preserved" });
    state.market = demandTestMarket();
    await due();
    expect(await runMarketplaceEmailSweep(send)).toMatchObject({ sent: 1, pending: 0, suppressed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retains new intents during a temporary quote outage and queues them after recovery", async () => {
    state.market = demandTestMarket(3.2, 300_000);
    await expect(queueDemandEmails()).rejects.toThrow("reference temporarily unavailable");
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.db!.notifications.every(notice => notice.demandEmail?.state === "pending")).toBe(true);
    state.market = demandTestMarket();
    await queueDemandEmails();
    expect(state.enqueue).toHaveBeenCalledTimes(2);
    expect(state.db!.notifications.every(notice => notice.demandEmail?.state === "queued")).toBe(true);
  });
  it("preserves exact response deep links and marks a durable enqueue once", async () => {
    const email = pendingEmail(true); await queueDemandEmails();
    expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: email.idempotencyKey,
      event: "usdt_demand_response", actionPath: expect.stringMatching(/\?offer=offer-/) }));
    state.enqueue.mockClear(); await queueDemandEmails(); expect(state.enqueue).not.toHaveBeenCalled();
  });
  it("retires terminal outbox failures so they cannot starve the recovery batch", async () => {
    state.enqueue.mockResolvedValue({ ok: false, reason: "email_delivery_terminal" });
    await queueDemandEmails();
    expect(state.db!.notifications.every(n => n.demandEmail?.state === "suppressed")).toBe(true);
    state.enqueue.mockClear(); await queueDemandEmails(); expect(state.enqueue).not.toHaveBeenCalled();
  });
  it("retains retryable delivery intents when the provider is not configured", async () => {
    state.enqueue.mockResolvedValue({ ok: false, reason: "resend_not_configured" });
    await queueDemandEmails();
    expect(state.db!.notifications.every(n => n.demandEmail?.state === "pending")).toBe(true);
  });

  it("does not fetch a market quote when no notification intents need preparation", async () => {
    state.db!.notifications.forEach(notice => { notice.demandEmail!.state = "queued"; });
    state.marketRead.mockRejectedValueOnce(new Error("quote temporarily unavailable"));
    await queueDemandEmails();
    expect(state.marketRead).not.toHaveBeenCalled();
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it.each(["ALPHA_USDT_REQUESTS_ENABLED", "ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED"])("keeps preparation off unless %s is explicitly enabled", async flag => {
    vi.stubEnv(flag, "");
    await queueDemandEmails();
    expect(state.marketRead).not.toHaveBeenCalled();
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.db!.notifications.every(notice => notice.demandEmail?.state === "pending")).toBe(true);
  });

  it("delivers the real localized response through a captured transport and deduplicates recovery after intent persistence fails", async () => {
    const delivery = await vi.importActual<typeof import("@/lib/marketplace-email-delivery")>("@/lib/marketplace-email-delivery");
    vi.stubEnv("RESEND_API_KEY", "synthetic-captured-transport-only");
    vi.stubEnv("EMAIL_FROM", "Alpha <sender@example.test>");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://offline.example.test");
    const response = pendingEmail(true);
    state.db!.notifications = state.db!.notifications.filter(notice => notice.id === response.idempotencyKey);
    state.db!.users.find(user => user.id === "buyer")!.preferredLocale = "ar";
    const capture = vi.fn<typeof fetch>(async () => new Response('{"id":"synthetic-capture"}', { status: 200 }));
    vi.stubGlobal("fetch", capture);
    state.enqueue.mockImplementation(delivery.sendMarketplaceEmail);
    state.mutate.mockRejectedValueOnce(new Error("intent persistence interrupted"));
    await expect(queueDemandEmails()).rejects.toThrow("intent persistence interrupted");
    expect(state.db!.notifications[0].demandEmail!.state).toBe("pending");
    expect(await job()).toMatchObject({ status: "sent", request_body: null });
    await queueDemandEmails();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(state.db!.notifications[0].demandEmail!.state).toBe("queued");
    const [url, request] = capture.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(request?.headers).get("Idempotency-Key")).toBe(response.idempotencyKey);
    const body = JSON.parse(String(request?.body)) as { to: string[]; text: string; html: string };
    expect(body.to).toEqual(["buyer@example.test"]);
    expect(body.text).toContain(`https://offline.example.test/ar${state.db!.notifications[0].relatedHref}`);
    expect(body.html).toContain('lang="ar" dir="rtl"');
    expect(body.text).not.toContain("/en/");
    expect(body.text + body.html).not.toMatch(/Private seller|seller@example|972500000001|100000001|fixture-only|passwordHash|bankAccount|walletAddress/);
  });

  it("retains and retries an actual rendered message with the same provider key after throttling", async () => {
    const delivery = await vi.importActual<typeof import("@/lib/marketplace-email-delivery")>("@/lib/marketplace-email-delivery");
    vi.stubEnv("RESEND_API_KEY", "synthetic-captured-transport-only");
    vi.stubEnv("EMAIL_FROM", "Alpha <sender@example.test>");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://offline.example.test");
    state.db!.notifications = state.db!.notifications.filter(notice => notice.userId === "seller");
    const capture = vi.fn<typeof fetch>(async () => new Response('{"id":"synthetic-capture"}', { status: 200 }));
    capture.mockResolvedValueOnce(new Response('{"message":"Synthetic throttle"}', { status: 429, headers: { "Retry-After": "120" } }));
    vi.stubGlobal("fetch", capture);
    state.enqueue.mockImplementation(delivery.sendMarketplaceEmail);
    await queueDemandEmails();
    expect(await job()).toMatchObject({ status: "pending", attempts: 1 });
    expect(capture).toHaveBeenCalledTimes(1);
    const original = capture.mock.calls[0][1];
    await due();
    expect(await delivery.deliverMarketplaceEmailQueue()).toMatchObject({ sent: 1, backlog: 0 });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[1][1]?.body).toBe(original?.body);
    expect(new Headers(capture.mock.calls[1][1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(original?.headers).get("Idempotency-Key"));
    expect(await job()).toMatchObject({ status: "sent", attempts: 2, request_body: null });
    await queueDemandEmails();
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
