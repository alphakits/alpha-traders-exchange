// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import type { MarketSnapshot } from "@/types/market";

const state = vi.hoisted(() => ({ pool: null as Pool | null, db: null as AlphaExchangeDb | null,
  market: null as MarketSnapshot | null, enqueue: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => state.pool }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/alpha-exchange-repository", () => ({ getAlphaExchangeRepository: async () => ({
  loadSelectedSnapshot: async () => structuredClone(state.db),
}) }));
vi.mock("@/lib/market-service", () => ({ getMarketSnapshot: async () => state.market }));
vi.mock("@/lib/usdt-demand-store", () => ({ DEMAND_TABLES: [], mutateDemands: async (fn: (db: AlphaExchangeDb) => unknown) => fn(state.db!) }));
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
  vi.clearAllMocks(); state.pool = pool; state.db = demandTestDb(); state.market = demandTestMarket();
  createDemand(state.db, "buyer", { terms: demandTestTerms(), operationId: randomUUID() }, state.market);
  await sql.exec(MARKETPLACE_EMAIL_OUTBOX_SCHEMA);
  await sql.exec("truncate alpha_exchange.marketplace_email_outbox, alpha_exchange.users; update alpha_exchange.marketplace_email_gate set available_at = now() - interval '1 second'");
  for (const user of state.db.users) await sql.query("insert into alpha_exchange.users values ($1,$2,$3::jsonb)", [user.id, user.email, JSON.stringify(user)]);
  state.enqueue.mockResolvedValue({ ok: true, queued: true });
});
afterEach(() => { vi.unstubAllEnvs(); });
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
    ["quote stale", () => { state.market = demandTestMarket(3.2, 300_000); }],
    ["feature disabled", () => { vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "0"); }],
    ["delivery disabled", () => { vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0"); }],
    ["notice missing", () => { state.db!.notifications = []; }],
    ["notice recipient changed", () => { state.db!.notifications.find(n => n.userId === "seller")!.userId = "seller-two"; }],
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
});
