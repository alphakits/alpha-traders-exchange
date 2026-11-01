// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { receiptRequest, receiptCommission } from "@/test-utils/trade-receipt";
import { buildTradeReceipt } from "@/lib/trade-receipt";
const mocks = vi.hoisted(() => ({ pool: null as Pool | null, prepare: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => mocks.pool }));
vi.mock("@/lib/marketplace-email-events", () => ({ prepareTradeEventEmails: mocks.prepare }));
import { enqueueMarketplaceEmail, MARKETPLACE_EMAIL_OUTBOX_SCHEMA, runMarketplaceEmailSweep } from "@/lib/marketplace-email-outbox";
import { recoverTradeReceiptEmails } from "@/lib/trade-receipt-delivery";

let db: PGlite;
let tail = Promise.resolve();
async function lock() { const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await previous; return release; }
async function query(sql: string, values?: unknown[]) {
  const result = sql === MARKETPLACE_EMAIL_OUTBOX_SCHEMA ? (await db.exec(sql)).at(-1)! : await db.query(sql, values);
  return { rows: result.rows, rowCount: result.affectedRows };
}
const pool = {
  async query(sql: string, values?: unknown[]) { const release = await lock(); try { return await query(sql, values); } finally { release(); } },
  async connect() { return { query, release: await lock() }; },
} as unknown as Pool;
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create schema alpha_exchange;
    create table alpha_exchange.users(id text primary key,email text,payload jsonb);
    create table alpha_exchange.purchase_requests(id text primary key,buyer_id text,seller_id text,status text,payload jsonb);`);
}, 20_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  vi.clearAllMocks(); mocks.pool = pool;
  await db.exec(MARKETPLACE_EMAIL_OUTBOX_SCHEMA);
  await db.exec(`truncate alpha_exchange.marketplace_email_outbox, alpha_exchange.users, alpha_exchange.purchase_requests;
    insert into alpha_exchange.users values ('buyer','buyer@example.test','{}'),('seller','seller@example.test','{}'),('outsider','outsider@example.test','{}');
    update alpha_exchange.marketplace_email_gate set available_at = now() + interval '1 hour';`);
  mocks.send.mockResolvedValue({ ok: true });
  mocks.prepare.mockImplementation(async ({ request }) => async () => Promise.all(["buyer", "seller"].map(id => enqueueMarketplaceEmail({
    event: "trade_completed", recipientEmail: `${id}@example.test`, recipientId: id, requestId: request.id, requiredTradeStatuses: ["review_open", "completed", "locked"],
    body: JSON.stringify({ to: [`${id}@example.test`], receipt: request.completionReceipt }), idempotencyKey: `trade-lifecycle:${request.id}:trade_completed:${id}`,
  }, mocks.send))));
});
async function insert(kind: "completion" | "historical_record" | "missing" = "completion") {
  const request = receiptRequest();
  if (kind !== "missing") request.completionReceipt = buildTradeReceipt(request, receiptCommission, kind);
  await db.query("insert into alpha_exchange.purchase_requests values($1,'buyer','seller','review_open',$2)", [request.id, JSON.stringify(request)]);
}
it("recovers both notices after a crash between completion commit and after(), without duplicating concurrent retries", async () => {
  await insert();
  await Promise.all([recoverTradeReceiptEmails(), recoverTradeReceiptEmails()]);
  expect((await db.query("select recipient_id,status from alpha_exchange.marketplace_email_outbox order by recipient_id")).rows).toEqual([{ recipient_id: "buyer", status: "pending" }, { recipient_id: "seller", status: "pending" }]);
  await expect(recoverTradeReceiptEmails()).resolves.toEqual({ recoveredTrades: 0 });
  await db.exec("update alpha_exchange.marketplace_email_gate set available_at = now()");
  expect((await runMarketplaceEmailSweep(mocks.send)).sent).toBe(2);
  expect(mocks.send).toHaveBeenCalledTimes(2);
  await recoverTradeReceiptEmails();
  expect((await db.query("select count(*)::int as count from alpha_exchange.marketplace_email_outbox")).rows[0]).toEqual({ count: 2 });
});
it.each(["historical_record", "missing"] as const)("does not email existing history when its receipt is %s", async kind => {
  await insert(kind); await expect(recoverTradeReceiptEmails()).resolves.toEqual({ recoveredTrades: 0 });
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("checks membership again before delivering a queued completion receipt", async () => {
  await insert(); await recoverTradeReceiptEmails();
  await db.exec("update alpha_exchange.purchase_requests set buyer_id = 'outsider'; update alpha_exchange.marketplace_email_gate set available_at = now()");
  const summary = await runMarketplaceEmailSweep(mocks.send);
  expect(summary).toMatchObject({ suppressed: 1, sent: 1 });
  expect(mocks.send.mock.calls[0][0].recipientEmail).toBe("seller@example.test");
});
it("does not claim the buyer's receipt key for a reassigned address, so a later refresh can recover it", async () => {
  await insert();
  await db.exec("update alpha_exchange.users set email='new@example.test' where id='buyer'; update alpha_exchange.users set email='buyer@example.test' where id='outsider'");
  await expect(recoverTradeReceiptEmails()).rejects.toThrow();
  expect((await db.query("select recipient_id from alpha_exchange.marketplace_email_outbox")).rows).toEqual([{ recipient_id: "seller" }]);
  await db.exec("update alpha_exchange.users set email='outsider@example.test' where id='outsider'; update alpha_exchange.users set email='buyer@example.test' where id='buyer'");
  await expect(recoverTradeReceiptEmails()).resolves.toEqual({ recoveredTrades: 1 });
  expect((await db.query("select recipient_id from alpha_exchange.marketplace_email_outbox order by recipient_id")).rows).toEqual([{ recipient_id: "buyer" }, { recipient_id: "seller" }]);
});
it("continues preserving the receipt when the provider is down and retries the identical payload", async () => {
  await insert(); await recoverTradeReceiptEmails();
  mocks.send.mockResolvedValue({ ok: false, reason: "network_failure", retryable: true });
  await db.exec("update alpha_exchange.marketplace_email_gate set available_at = now()");
  expect((await runMarketplaceEmailSweep(mocks.send)).pending).toBe(2);
  const bodies = mocks.send.mock.calls.map(([message]) => message.body);
  mocks.send.mockResolvedValue({ ok: true });
  await db.exec("update alpha_exchange.marketplace_email_outbox set available_at=now(); update alpha_exchange.marketplace_email_gate set available_at=now()");
  expect((await runMarketplaceEmailSweep(mocks.send)).sent).toBe(2);
  expect(mocks.send.mock.calls.slice(2).map(([message]) => message.body)).toEqual(bodies);
});
