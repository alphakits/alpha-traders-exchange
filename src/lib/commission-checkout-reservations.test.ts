// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const previous = readFileSync(resolve(process.cwd(), "db/migrations/20260925_commission_batch_receipt_reservations.sql"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "db/migrations/20260925_commission_self_service_checkout.sql"), "utf8");
const roundedMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261003195633_commission_checkout_rounded_receipts.sql"), "utf8");
let db: PGlite;
const createdAt = "2026-09-25T16:00:00.000Z";
const checkout = { id: "checkout-test", sellerId: "seller", network: "BEP20", createdAt,
  expectedMicros: 39_000_000, requestedMicros: 39_000_000, dueMicros: 40_000_000,
  commissions: [{ id: "cm", dueMicros: 40_000_000, createdAt: "2026-09-25T15:00:00.000Z" }] };
const signature = `0x${"a".repeat(64)}`;
function issue(value: typeof checkout & { roundedMicros?: number } = checkout) { return insertAudit(`${value.id}:issued`, { kind: "commission_checkout_issued_v1", checkout: value }); }
async function insertAudit(id: string, newValue: unknown, actor = "seller") {
  const payload = { id, actorUserId: actor, targetUserId: "seller", createdAt, newValue };
  await db.query("insert into alpha_exchange.audit_logs(id,actor_user_id,target_user_id,created_at,payload) values($1,$2,'seller',$3,$4)", [id, actor, createdAt, JSON.stringify(payload)]);
}
async function settleAudit() {
  await insertAudit("checkout-test:settled", { kind: "commission_checkout_settled_v1", checkoutId: checkout.id, checkout,
    receipt: { signature, network: "BEP20", amountMicros: 39_000_000, timestamp: Date.parse(createdAt) + 1000 } });
}
async function paid() {
  await db.query("update alpha_exchange.commissions set payment_status='paid', payload=payload || $1::jsonb where id='cm'", [JSON.stringify({ paymentStatus: "paid", paymentVerificationStatus: "verified", paymentSignature: signature, paymentBatchSettlement: { batchId: checkout.id } })]);
}
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create schema alpha_exchange;
    create table alpha_exchange.users(id text primary key,payload jsonb);
    create table alpha_exchange.commissions(id text primary key,seller_id text,payment_status text,payload jsonb);
    create table alpha_exchange.audit_logs(id text primary key,actor_user_id text,target_user_id text,created_at timestamptz,payload jsonb);`);
  await db.exec(previous); await db.exec(migration); await db.exec(roundedMigration);
  const payload = { id: "cm", sellerId: "seller", commissionAmount: 40, paymentExpectedAmount: 40.000001,
    createdAt: checkout.commissions[0].createdAt, paymentStatus: "pending" };
  await db.query("insert into alpha_exchange.commissions values('cm','seller','pending',$1)", [JSON.stringify(payload)]);
}, 30_000);
afterEach(async () => { await db?.close(); });
describe("durable self-service checkout reservations", () => {
  it("reserves seller-created instructions without inventing an approving owner", async () => { await issue(); const result = await db.query<{ seller_id: string }>("select seller_id from alpha_exchange.commission_checkouts"); expect(result.rows[0].seller_id).toBe("seller"); });
  it("rejects actor and commission ownership spoofing", async () => { await expect(insertAudit("checkout-test:issued", { kind: "commission_checkout_issued_v1", checkout }, "attacker")).rejects.toThrow(); });
  it("refuses a changed immutable checkout on snapshot replacement", async () => { await issue(); await db.exec("delete from alpha_exchange.audit_logs"); await expect(issue({ ...checkout, expectedMicros: 39_100_000 })).rejects.toThrow(); });
  it("rejects a second checkout with an already issued amount", async () => { await issue(); await expect(issue({ ...checkout, id: "checkout-other" })).rejects.toThrow(); });
  it("legacy allocation cannot claim the checkout's payment amount", async () => { await issue(); await expect(db.query("insert into alpha_exchange.commissions values('other','other','pending',$1)", [JSON.stringify({ paymentExpectedAmount: 39 })])).rejects.toThrow(); });
  it("an all-paid group reserves its receipt permanently", async () => { await issue(); await paid(); await settleAudit(); const result = await db.query<{ signature_key: string; approved_by_user_id: string }>("select signature_key,approved_by_user_id from alpha_exchange.commission_batch_receipt_reservations"); expect(result.rows[0].signature_key).toBe("a".repeat(64)); expect(result.rows[0].approved_by_user_id).toBe("seller"); });
  it("settlement is refused when a group member was not paid atomically", async () => { await issue(); await expect(settleAudit()).rejects.toThrow(); const result = await db.query("select * from alpha_exchange.commission_batch_receipt_reservations"); expect(result.rows).toHaveLength(0); });
  it("legacy single-payment path cannot reuse a self-service receipt", async () => { await issue(); await paid(); await settleAudit(); await expect(db.query("insert into alpha_exchange.commissions values('other','other','paid',$1)", [JSON.stringify({ paymentSignature: "A".repeat(64) })])).rejects.toThrow(); });
  it("receipt reservation survives audit deletion and replay", async () => { await issue(); await paid(); await settleAudit(); await db.exec("delete from alpha_exchange.audit_logs"); await issue(); await settleAudit(); expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(1); });
  it("migration is repeatable and never marks customer commissions paid", async () => { await db.exec(migration); expect((await db.query<{ payment_status: string }>("select payment_status from alpha_exchange.commissions")).rows[0].payment_status).toBe("pending"); });
  async function fractionalCheckout(rounded = true) {
    const value = { ...checkout, expectedMicros: 29_200_000, requestedMicros: 29_200_000, dueMicros: 29_200_000,
      ...(rounded ? { roundedMicros: 30_000_000 } : {}), commissions: [{ ...checkout.commissions[0], dueMicros: 29_200_000 }] };
    await db.query("update alpha_exchange.commissions set payload=payload || $1::jsonb where id='cm'", [JSON.stringify({ commissionAmount: 29.2, paymentExpectedAmount: 29.200001 })]);
    await issue(value);
    return value;
  }
  function roundedSettlement(value: Awaited<ReturnType<typeof fractionalCheckout>>) {
    return insertAudit("checkout-test:settled", { kind: "commission_checkout_settled_v1", checkoutId: value.id, checkout: value,
      receipt: { signature, network: "BEP20", amountMicros: 30_000_000, timestamp: Date.parse(createdAt) + 1000 } });
  }
  it("reserves exact and rounded amounts in one durable uniqueness domain", async () => {
    await fractionalCheckout();
    expect((await db.query("select amount_micros from alpha_exchange.commission_checkout_amount_reservations order by amount_micros")).rows).toEqual([{ amount_micros: 29_200_000 }, { amount_micros: 30_000_000 }]);
    await expect(issue({ ...checkout, id: "other", expectedMicros: 30_000_000, requestedMicros: 30_000_000, dueMicros: 30_000_000,
      commissions: [{ ...checkout.commissions[0], dueMicros: 30_000_000 }] })).rejects.toThrow();
    await expect(db.query("insert into alpha_exchange.commissions values('other','other','pending',$1)", [JSON.stringify({ paymentExpectedAmount: 30 })])).rejects.toThrow();
  });
  it("accepts a verified 30 receipt only when its rounded option was issued before payment", async () => {
    const value = await fractionalCheckout(); await paid(); await roundedSettlement(value);
    expect((await db.query("select signature_key from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(1);
  });
  it("legacy checkout cannot acquire a rounded option by rewriting its original instructions", async () => {
    const value = await fractionalCheckout(false);
    await expect(issue({ ...value, roundedMicros: 30_000_000 })).rejects.toThrow();
    await paid(); await expect(roundedSettlement(value)).rejects.toThrow();
  });
  it("specific owner recovery requires a current enabled owner and the identified deposit time", async () => {
    const value = await fractionalCheckout(false); await paid();
    await db.query("insert into alpha_exchange.users values('owner',$1)", [JSON.stringify({ role: "buyer" })]);
    const recovery = { kind: "commission_checkout_receipt_recovery_v1", checkoutId: value.id,
      network: "BEP20", amountMicros: 30_000_000, timestamp: Date.parse(createdAt) + 1000, timestampToleranceMs: 60_000 };
    await expect(insertAudit("checkout-test:receipt-recovery", recovery, "owner")).rejects.toThrow();
    await db.query("update alpha_exchange.users set payload=$1 where id='owner'", [JSON.stringify({ role: "owner" })]);
    await insertAudit("checkout-test:receipt-recovery", recovery, "owner");
    await db.query("update alpha_exchange.users set payload=$1 where id='owner'", [JSON.stringify({ role: "buyer" })]);
    await expect(roundedSettlement(value)).rejects.toThrow();
    await db.query("update alpha_exchange.users set payload=$1 where id='owner'", [JSON.stringify({ role: "owner", disabled: true })]);
    await expect(roundedSettlement(value)).rejects.toThrow();
    await db.query("update alpha_exchange.users set payload=$1 where id='owner'", [JSON.stringify({ role: "owner" })]);
    await roundedSettlement(value);
  });
  it("recovery survives audit replacement and cannot be rewritten to a different deposit", async () => {
    const value = await fractionalCheckout(false); await paid();
    await db.query("insert into alpha_exchange.users values('owner',$1)", [JSON.stringify({ role: "owner" })]);
    const recovery = { kind: "commission_checkout_receipt_recovery_v1", checkoutId: value.id,
      network: "BEP20", amountMicros: 30_000_000, timestamp: Date.parse(createdAt) + 1000, timestampToleranceMs: 60_000 };
    await insertAudit("checkout-test:receipt-recovery", recovery, "owner");
    await db.exec("delete from alpha_exchange.audit_logs");
    await roundedSettlement(value);
    await expect(insertAudit("checkout-test:receipt-recovery", { ...recovery, amountMicros: 31_000_000 }, "owner")).rejects.toThrow();
    await insertAudit("checkout-test:receipt-recovery", recovery, "owner");
    expect((await db.query("select * from alpha_exchange.commission_checkout_receipt_recoveries")).rows).toHaveLength(1);
  });
  it("rounded migration is repeatable and preserves historical exact reservations", async () => {
    await issue(); await db.exec(roundedMigration);
    expect((await db.query("select amount_micros from alpha_exchange.commission_checkout_amount_reservations")).rows).toEqual([{ amount_micros: 39_000_000 }]);
    expect((await db.query<{ payment_status: string }>("select payment_status from alpha_exchange.commissions")).rows[0].payment_status).toBe("pending");
  });
});
