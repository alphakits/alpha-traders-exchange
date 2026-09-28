// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pool: null as Pool | null, log: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => mocks.pool }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.log }));
import { enqueueMarketplaceEmail, runMarketplaceEmailSweep, MARKETPLACE_EMAIL_OUTBOX_SCHEMA, type PreparedMarketplaceEmail } from "@/lib/marketplace-email-outbox";

let db: PGlite;
// PGlite supplies real PostgreSQL SQL semantics on one connection. Serialize
// checkouts so a transaction keeps its connection until COMMIT/ROLLBACK.
let tail = Promise.resolve();
async function lock() {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  return release;
}
async function query(sql: string, values?: unknown[]) {
  const result = sql === MARKETPLACE_EMAIL_OUTBOX_SCHEMA
    ? (await db.exec(sql)).at(-1)!
    : await db.query(sql, values);
  return { rows: result.rows, rowCount: result.affectedRows };
}
const pool = {
  async query(sql: string, values?: unknown[]) {
    const release = await lock();
    try { return await query(sql, values); } finally { release(); }
  },
  async connect() { return { query, release: await lock() }; },
} as unknown as Pool;

const email: PreparedMarketplaceEmail = {
  event: "trade_accepted", recipientEmail: "buyer@example.com", idempotencyKey: "trade:one:buyer",
  body: JSON.stringify({ from: "Alpha <test@example.com>", to: ["buyer@example.com"], subject: "Accepted", html: "Original" }),
};
const sender = () => vi.fn().mockResolvedValue({ ok: true });
const openGate = () => db.exec("update alpha_exchange.marketplace_email_gate set available_at = now() - interval '1 second'");
const rows = () => db.query<{ status: string; request_body: string | null; attempts: number; last_reason: string; recipient_email: string | null }>("select * from alpha_exchange.marketplace_email_outbox order by created_at");

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create schema alpha_exchange;
    create table alpha_exchange.users (id text primary key, email text not null, payload jsonb not null);
    create table alpha_exchange.purchase_requests (id text primary key, status text not null);
    create role email_client; grant usage on schema alpha_exchange to email_client;`);
}, 20_000);
beforeEach(async () => {
  vi.clearAllMocks(); mocks.pool = pool;
  await db.exec(MARKETPLACE_EMAIL_OUTBOX_SCHEMA);
  await db.exec(`truncate alpha_exchange.marketplace_email_outbox, alpha_exchange.users, alpha_exchange.purchase_requests;
    insert into alpha_exchange.users values ('buyer','buyer@example.com','{}');
    update alpha_exchange.marketplace_email_gate set available_at = now() - interval '1 second';`);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await db.close(); });

describe("durable marketplace email delivery", () => {
  it("persists before sending, deduplicates concurrent submissions and erases sent contents", async () => {
    const send = sender().mockImplementation(async () => {
      expect((await rows()).rows[0]).toMatchObject({ status: "processing", request_body: email.body, attempts: 1 });
      return { ok: true };
    });
    const results = await Promise.all(Array.from({ length: 6 }, () => enqueueMarketplaceEmail(email, send)));
    expect(results.every((result) => result?.ok)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await rows()).rows).toHaveLength(1);
    expect((await rows()).rows[0]).toMatchObject({ status: "sent", request_body: null, recipient_email: null });
  });

  it("preserves a throttled message and shared cooldown without waiting in the action", async () => {
    const send = sender().mockResolvedValue({ ok: false, reason: "resend_request_failed", providerStatus: 429, retryAfterMs: 120_000, retryable: true });
    expect(await enqueueMarketplaceEmail(email, send)).toMatchObject({ ok: true, queued: true });
    expect((await rows()).rows[0]).toMatchObject({ status: "pending", request_body: email.body });
    const waits = await db.query<{ job: number; gate: number }>(`select
      extract(epoch from (job.available_at - now())) as job,
      extract(epoch from (gate.available_at - now())) as gate
      from alpha_exchange.marketplace_email_outbox job cross join alpha_exchange.marketplace_email_gate gate`);
    expect(Number(waits.rows[0].job)).toBeGreaterThan(119);
    expect(Number(waits.rows[0].gate)).toBeGreaterThan(119);
    await enqueueMarketplaceEmail({ ...email, idempotencyKey: "another-event" }, send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("resumes the exact frozen request with the same key after a retry becomes due", async () => {
    const send = sender().mockResolvedValueOnce({ ok: false, reason: "resend_timeout", retryable: true });
    await enqueueMarketplaceEmail(email, send);
    await db.exec("update alpha_exchange.marketplace_email_outbox set available_at = now() - interval '1 second'");
    await openGate();
    await enqueueMarketplaceEmail({ ...email, body: "changed after deployment" }, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual(email);
    expect((await rows()).rows[0].status).toBe("sent");
  });

  it("reclaims a crashed lease without changing the provider idempotency key", async () => {
    const send = sender().mockRejectedValueOnce(new Error("function interrupted"));
    expect(await enqueueMarketplaceEmail(email, send)).toMatchObject({ ok: true });
    expect((await rows()).rows[0].status).toBe("processing");
    await db.exec("update alpha_exchange.marketplace_email_outbox set lease_until = now() - interval '1 second'");
    await openGate();
    await enqueueMarketplaceEmail(email, send);
    expect(send.mock.calls[1][0]).toEqual(email);
    expect((await rows()).rows[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("fences an old worker result when a newer lease owns the job", async () => {
    const send = sender().mockImplementation(async () => {
      await db.exec("update alpha_exchange.marketplace_email_outbox set lease_token = 'new-worker'");
      return { ok: true };
    });
    await enqueueMarketplaceEmail(email, send);
    expect((await rows()).rows[0].status).toBe("processing");
  });

  it.each(["email_changed", "disabled", "deleted"])("does not send queued contents after the account is %s", async (change) => {
    await db.exec("update alpha_exchange.marketplace_email_gate set available_at = now() + interval '2 minutes'");
    const send = sender();
    await enqueueMarketplaceEmail(email, send);
    if (change === "email_changed") await db.exec("update alpha_exchange.users set email = 'new@example.com'");
    if (change === "disabled") await db.exec(`update alpha_exchange.users set payload = '{"disabled":true}'`);
    if (change === "deleted") await db.exec("delete from alpha_exchange.users");
    await openGate();
    await runMarketplaceEmailSweep(send);
    expect(send).not.toHaveBeenCalled();
    if (change === "deleted") expect((await rows()).rows).toHaveLength(0);
    else expect((await rows()).rows[0]).toMatchObject({ status: "suppressed", request_body: null });
  });

  it("does not retry permanent provider rejections", async () => {
    const send = sender().mockResolvedValue({ ok: false, reason: "resend_request_failed", providerStatus: 422, retryable: false });
    expect(await enqueueMarketplaceEmail(email, send)).toMatchObject({ ok: false });
    await openGate();
    await enqueueMarketplaceEmail(email, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await rows()).rows[0]).toMatchObject({ status: "failed", request_body: null });
  });

  it("parks exhausted quotas for later recovery instead of discarding the email", async () => {
    const send = sender().mockResolvedValue({ ok: false, reason: "resend_request_failed", providerStatus: 429, retryable: false, quotaExceeded: true });
    await enqueueMarketplaceEmail(email, send);
    expect((await rows()).rows[0]).toMatchObject({ status: "pending", request_body: email.body });
    expect((await runMarketplaceEmailSweep(send)).backlog).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("expires stale requests before the provider's deduplication window ends", async () => {
    await db.exec("update alpha_exchange.marketplace_email_gate set available_at = now() + interval '2 minutes'");
    const send = sender();
    await enqueueMarketplaceEmail(email, send);
    await db.exec("update alpha_exchange.marketplace_email_outbox set expires_at = now() - interval '1 second'");
    const result = await runMarketplaceEmailSweep(send);
    expect(result.failed).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect((await rows()).rows[0]).toMatchObject({ status: "failed", request_body: null, last_reason: "retry_window_expired" });
  });

  it("sends due work from the scheduled sweep", async () => {
    await db.exec("update alpha_exchange.marketplace_email_gate set available_at = now() + interval '2 minutes'");
    const send = sender();
    await enqueueMarketplaceEmail(email, send);
    await openGate();
    const result = await runMarketplaceEmailSweep(send);
    expect(result).toMatchObject({ sent: 1, backlog: 0 });
    expect(send).toHaveBeenCalledWith(email);
  });

  it("blocks client-role reads even if generic table privileges are granted", async () => {
    await db.exec("update alpha_exchange.marketplace_email_gate set available_at = now() + interval '2 minutes'");
    await enqueueMarketplaceEmail(email, sender());
    await db.exec("grant select on alpha_exchange.marketplace_email_outbox to email_client; set role email_client");
    try { expect((await rows()).rows).toHaveLength(0); }
    finally { await db.exec("reset role"); }
  });

  it("does not bypass the queue when production storage is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production"); mocks.pool = null;
    const send = sender();
    expect(await enqueueMarketplaceEmail(email, send)).toMatchObject({ ok: false, reason: "email_storage_unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("suppresses a delayed action email after the trade advances", async () => {
    await db.exec("insert into alpha_exchange.purchase_requests values ('trade-one', 'accepted'); update alpha_exchange.marketplace_email_gate set available_at = now() + interval '2 minutes'");
    const send = sender();
    await enqueueMarketplaceEmail({ ...email, requestId: "trade-one", requiredTradeStatuses: ["accepted"] }, send);
    await db.exec("update alpha_exchange.purchase_requests set status = 'completed'");
    await openGate();
    expect((await runMarketplaceEmailSweep(send)).suppressed).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("bootstraps an absent queue schema before accepting messages", async () => {
    await db.exec("drop table alpha_exchange.marketplace_email_outbox, alpha_exchange.marketplace_email_gate");
    mocks.pool = { query: pool.query.bind(pool), connect: pool.connect.bind(pool) } as Pool;
    const send = sender();
    expect(await enqueueMarketplaceEmail(email, send)).toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
