// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
const previous = readFileSync(resolve(process.cwd(), "db/migrations/20260925_commission_batch_receipt_reservations.sql"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "db/migrations/20260925_commission_self_service_checkout.sql"), "utf8");
const roundedMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261003195633_commission_checkout_rounded_receipts.sql"), "utf8");
const toleranceMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261004215723_commission_checkout_bidirectional_tolerance.sql"), "utf8");
const attributionMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261006212309_commission_checkout_active_payment_attribution.sql"), "utf8");
const collisionMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011145429_commission_checkout_collision_tolerance.sql"), "utf8");
const repeatedMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011203949_commission_checkout_repeated_received_amounts.sql"), "utf8");
const unsubmittedRepair = readFileSync(resolve(process.cwd(), "scripts/repair-unsubmitted-commission-verification.sql"), "utf8");
let db: PGlite;
const createdAt = "2026-09-25T16:00:00.000Z";
const checkout = { id: "checkout-test", sellerId: "seller", network: "BEP20", createdAt,
  expectedMicros: 39_000_000, requestedMicros: 39_000_000, dueMicros: 40_000_000,
  commissions: [{ id: "cm", dueMicros: 40_000_000, createdAt: "2026-09-25T15:00:00.000Z" }] };
const signature = `0x${"a".repeat(64)}`;
function issue(value: typeof checkout & { roundedMicros?: number } = checkout) { return insertAudit(`${value.id}:issued`, { kind: "commission_checkout_issued_v1", checkout: value }, "seller", value.createdAt); }
async function insertAudit(id: string, newValue: unknown, actor = "seller", auditAt = createdAt) {
  const payload = { id, actorUserId: actor, targetUserId: "seller", createdAt: auditAt, newValue };
  await db.query("insert into alpha_exchange.audit_logs(id,actor_user_id,target_user_id,created_at,payload) values($1,$2,'seller',$3,$4)", [id, actor, auditAt, JSON.stringify(payload)]);
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
  await db.exec(previous); await db.exec(migration); await db.exec(roundedMigration); await db.exec(toleranceMigration); await db.exec(attributionMigration); await db.exec(collisionMigration); await db.exec(repeatedMigration);
  const payload = { id: "cm", sellerId: "seller", commissionAmount: 40, paymentExpectedAmount: 40.000001,
    createdAt: checkout.commissions[0].createdAt, paymentStatus: "pending" };
  await db.query("insert into alpha_exchange.commissions values('cm','seller','pending',$1)", [JSON.stringify(payload)]);
}, 30_000);
afterEach(async () => { await db?.close(); });
describe("durable self-service checkout reservations", () => {
  it("keeps both network instructions immutable and settles the newly selected network once", async () => {
    const original = { ...checkout, network: "TRC20" };
    const alternative = { ...checkout, id: "checkout-bep20", expectedMicros: 39_000_002 };
    await issue(original); await issue(alternative);
    await insertAudit("seller:checkout-network", { kind: "commission_checkout_network_selected_v1", checkoutId: alternative.id });
    expect((await db.query("select checkout_id from alpha_exchange.commission_checkouts")).rows).toHaveLength(2);
    expect((await db.query("select amount_micros from alpha_exchange.commission_checkout_amount_reservations order by amount_micros")).rows)
      .toEqual([{ amount_micros: 39_000_000 }, { amount_micros: 39_000_002 }]);
    await paid();
    await db.query("update alpha_exchange.commissions set payload=jsonb_set(payload,'{paymentBatchSettlement,batchId}',to_jsonb($1::text)) where id='cm'", [alternative.id]);
    await insertAudit(`${alternative.id}:settled`, { kind: "commission_checkout_settled_v1", checkoutId: alternative.id, checkout: alternative,
      receipt: { signature, network: "BEP20", amountMicros: alternative.expectedMicros, timestamp: Date.parse(createdAt) + 1000 } });
    expect((await db.query("select batch_id from alpha_exchange.commission_batch_receipt_reservations")).rows).toEqual([{ batch_id: alternative.id }]);
    await expect(insertAudit(`${original.id}:settled`, { kind: "commission_checkout_settled_v1", checkoutId: original.id, checkout: original,
      receipt: { signature, network: "TRC20", amountMicros: original.expectedMicros, timestamp: Date.parse(createdAt) + 1000 } })).rejects.toThrow();
  });
  it("repairs only unsubmitted flags, preserves payment guards, and restores overdue checkout", async () => {
    await db.exec(`alter table alpha_exchange.commissions add column updated_at timestamptz default now();
      alter table alpha_exchange.audit_logs add column action text, add column sort_index integer;
      create table alpha_exchange.runtime_meta(singleton boolean primary key, version bigint, updated_at timestamptz);
      insert into alpha_exchange.runtime_meta values(true, 1, now());`);
    await db.query("update alpha_exchange.commissions set payment_status='overdue',payload=payload || $1::jsonb where id='cm'", [JSON.stringify({
      paymentStatus: "overdue", paymentVerificationStatus: "pending_verification", paymentVerificationNotes: "Commission reset to pending.",
    })]);
    await expect(issue()).rejects.toThrow("Checkout commissions changed");
    for (const [id, fields] of [
      ["submitted", { paymentSubmittedAt: createdAt }],
      ["signed", { paymentSignature: signature }],
      ["verified", { paymentVerificationStatus: "verified" }],
      ["failed", { paymentVerificationStatus: "failed" }],
    ] as const) {
      await db.query("insert into alpha_exchange.commissions(id,seller_id,payment_status,payload) values($1,'seller','overdue',$2)", [id,
        JSON.stringify({ id, commissionAmount: 2, paymentVerificationStatus: "pending_verification", ...fields })]);
    }
    const untouched = await db.query("select id,payload from alpha_exchange.commissions where id<>'cm' order by id");
    await db.exec(unsubmittedRepair);
    await issue();
    expect((await db.query<{ payload: Record<string, unknown>; payment_status: string }>("select payload,payment_status from alpha_exchange.commissions where id='cm'")).rows[0]).toMatchObject({
      payment_status: "overdue", payload: { commissionAmount: 40, paymentExpectedAmount: 40.000001, paymentVerificationNotes: "Commission reset to pending." },
    });
    expect((await db.query<{ payload: Record<string, unknown> }>("select payload from alpha_exchange.commissions where id='cm'")).rows[0].payload.paymentVerificationStatus).toBeUndefined();
    await db.exec(unsubmittedRepair);
    expect((await db.query("select id,payload from alpha_exchange.commissions where id<>'cm' order by id")).rows).toEqual(untouched.rows);
    expect((await db.query("select version from alpha_exchange.runtime_meta")).rows).toEqual([{ version: 2 }]);
    expect((await db.query("select id from alpha_exchange.audit_logs where payload->'newValue'->>'kind'='commission_unsubmitted_verification_repair_v1'")).rows).toHaveLength(1);
  });

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
  function tolerantSettlement(amountMicros: number) {
    return insertAudit("checkout-test:settled", { kind: "commission_checkout_settled_v1", checkoutId: checkout.id, checkout,
      attribution: "unambiguous_checkout_tolerance_v1",
      receipt: { signature, network: "BEP20", amountMicros, timestamp: Date.parse(createdAt) + 1000 } });
  }
  it.each([39_500_000, 40_000_001, 40_500_000, 41_000_000])("persists a verified tolerance receipt and reserves its actual amount: %s", async (amount) => {
    await issue(); await paid(); await tolerantSettlement(amount);
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(1);
    expect((await db.query("select * from alpha_exchange.commission_checkout_amount_reservations where amount_micros=$1", [amount])).rows).toHaveLength(1);
    await expect(db.query("insert into alpha_exchange.commissions values('other','other','pending',$1)", [JSON.stringify({ paymentExpectedAmount: amount / 1e6 })])).rejects.toThrow();
    await db.exec("delete from alpha_exchange.audit_logs"); await issue(); await tolerantSettlement(amount);
    await paid();
  });
  it.each([0, 38_999_999, 41_000_001, 39_500_000.5])("database rejects an invalid or out-of-policy receipt: %s", async (amount) => {
    await issue(); await paid(); await expect(tolerantSettlement(amount)).rejects.toThrow();
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(0);
  });
  it("a nearby exact-only invoice does not reserve a tolerance range", async () => {
    await issue(); await paid();
    await db.query("insert into alpha_exchange.commissions values('other','other','pending',$1)", [JSON.stringify({ commissionAmount: 39.6, paymentExpectedAmount: 39.600001, createdAt })]);
    await tolerantSettlement(39_500_000);
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(1);
  });
  it.each([undefined, "2026-09-25T16:00:01.000Z", "2026-09-25T16:00:02.000Z"])("a competing checkout still blocks without a payment before the receipt: %s", async (paidAt) => {
    await issue();
    await db.query("insert into alpha_exchange.commissions values('other','seller','pending',$1)", [JSON.stringify({ commissionAmount: 39.6, paymentExpectedAmount: 39.600001, createdAt })]);
    await issue({ ...checkout, id: "checkout-other", expectedMicros: 39_600_000, requestedMicros: 39_600_000, dueMicros: 39_600_000,
      commissions: [{ id: "other", dueMicros: 39_600_000, createdAt }] });
    await db.query("update alpha_exchange.commissions set payment_status='paid',payload=payload || $1::jsonb where id='other'", [JSON.stringify({ paidAt })]);
    await paid(); await expect(tolerantSettlement(39_500_000)).rejects.toThrow();
  });
  it("a checkout fully paid before the new receipt no longer blocks it", async () => {
    await issue();
    await db.query("insert into alpha_exchange.commissions values('other','seller','pending',$1)", [JSON.stringify({ commissionAmount: 39.6, paymentExpectedAmount: 39.600001, createdAt })]);
    await issue({ ...checkout, id: "checkout-other", expectedMicros: 39_600_000, requestedMicros: 39_600_000, dueMicros: 39_600_000,
      commissions: [{ id: "other", dueMicros: 39_600_000, createdAt }] });
    await db.query("update alpha_exchange.commissions set payment_status='paid',payload=payload || $1::jsonb where id='other'", [JSON.stringify({ paidAt: "2026-09-25T16:00:00.500Z" })]);
    await paid(); await tolerantSettlement(39_500_000);
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(1);
  });
  it("a legacy exact reference remains protected even with a different base invoice", async () => {
    await issue(); await paid();
    await db.query("insert into alpha_exchange.commissions values('other','other','pending',$1)", [JSON.stringify({ commissionAmount: 39.6, paymentExpectedAmount: 39.5, createdAt })]);
    await expect(tolerantSettlement(39_500_000)).rejects.toThrow();
  });
  it.each([2_540_000, 3_600_000, 4_540_000])("a suffixed checkout accepts a verified tolerance receipt: %s", async (amountMicros) => {
    const value = { ...checkout, expectedMicros: 3_542_520, requestedMicros: 3_540_000, dueMicros: 3_540_000,
      commissions: [{ ...checkout.commissions[0], dueMicros: 3_540_000 }] };
    await db.query("update alpha_exchange.commissions set payload=payload || $1::jsonb where id='cm'", [JSON.stringify({ commissionAmount: 3.54, paymentExpectedAmount: 3.540002 })]);
    await db.query("insert into alpha_exchange.commissions values('historical','other','paid',$1)", [JSON.stringify({ commissionAmount: 3.54, paymentExpectedAmount: 3.540001 })]);
    await issue(value); await paid();
    await insertAudit(`${value.id}:settled`, { kind: "commission_checkout_settled_v1", checkoutId: value.id, checkout: value,
      attribution: "unambiguous_checkout_tolerance_v1",
      receipt: { signature, network: "BEP20", amountMicros, timestamp: Date.parse(createdAt) + 1000 } });
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(1);
    expect((await db.query("select * from alpha_exchange.commission_checkout_amount_reservations where amount_micros=$1", [amountMicros])).rows).toHaveLength(1);
    await expect(db.query("insert into alpha_exchange.commissions values('duplicate','other','paid',$1)", [JSON.stringify({ paymentSignature: signature })])).rejects.toThrow();
  });
  it("a suffixed competing checkout cannot be ignored when attributing a tolerance receipt", async () => {
    await issue();
    await db.query("insert into alpha_exchange.commissions values('other','seller','pending',$1)", [JSON.stringify({ commissionAmount: 39.6, paymentExpectedAmount: 39.600001, createdAt })]);
    await issue({ ...checkout, id: "checkout-other", expectedMicros: 39_602_520, requestedMicros: 39_600_000, dueMicros: 39_600_000,
      commissions: [{ id: "other", dueMicros: 39_600_000, createdAt }] });
    await paid(); await expect(tolerantSettlement(39_500_000)).rejects.toThrow();
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(0);
  });
  it("collision migration is repeatable and does not credit payments or expose the matcher", async () => {
    await issue(); const before = await db.query("select * from alpha_exchange.commissions");
    await db.exec(collisionMigration); await db.exec(collisionMigration);
    expect((await db.query("select * from alpha_exchange.commissions")).rows).toEqual(before.rows);
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(0);
    const result = await db.query<{ prosecdef: boolean; proacl: string[] }>("select prosecdef,proacl from pg_proc where oid='alpha_exchange.commission_checkout_tolerance_matches(jsonb,jsonb)'::regprocedure");
    expect(result.rows[0].prosecdef).toBe(false);
    expect(result.rows[0].proacl.some((grant) => grant.startsWith("=X/"))).toBe(false);
  });
  it("attribution migration is repeatable and leaves all financial records untouched", async () => {
    await issue(); const before = await db.query("select * from alpha_exchange.commissions");
    await db.exec(attributionMigration); await db.exec(attributionMigration);
    expect((await db.query("select * from alpha_exchange.commissions")).rows).toEqual(before.rows);
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(0);
  });
  it("tolerance migration is repeatable and never credits a payment itself", async () => {
    await issue(); await db.exec(toleranceMigration);
    expect((await db.query<{ payment_status: string }>("select payment_status from alpha_exchange.commissions")).rows[0].payment_status).toBe("pending");
  });
  async function repeatedCheckout(n: number) {
    const time = new Date(Date.parse(createdAt) + n * 10_000).toISOString();
    const id = n ? `cm${n}` : "cm";
    const value = { ...checkout, id: `checkout-repeat-${n}`, createdAt: time,
      expectedMicros: 3_540_000 + n * 10, requestedMicros: 3_540_000, dueMicros: 3_540_000,
      commissions: [{ id, dueMicros: 3_540_000, createdAt: time }] };
    const payload = { id, sellerId: "seller", commissionAmount: 3.54, createdAt: time,
      paymentExpectedAmount: 3.54 + (n + 1) / 1e6, paymentExpectedAmountMode: "unique_v1" };
    if (n) await db.query("insert into alpha_exchange.commissions values($1,'seller','pending',$2)", [id, JSON.stringify(payload)]);
    else await db.query("update alpha_exchange.commissions set payload=$1 where id='cm'", [JSON.stringify(payload)]);
    await issue(value);
    return value;
  }
  async function settleRepeated(value: Awaited<ReturnType<typeof repeatedCheckout>>, hash: string) {
    const paidAt = new Date(Date.parse(value.createdAt) + 2000).toISOString();
    await db.exec("begin");
    try {
      await db.query("update alpha_exchange.commissions set payment_status='paid',payload=payload || $1::jsonb where id=$2", [JSON.stringify({
        paidAt, paymentStatus: "paid", paymentVerificationStatus: "verified", paymentSignature: hash,
        paymentReservedExpectedAmounts: [value.expectedMicros / 1e6, 3.6],
        paymentBatchSettlement: { batchId: value.id, groupReceivedMicros: 3_600_000 },
      }), value.commissions[0].id]);
      await insertAudit(`${value.id}:settled`, { kind: "commission_checkout_settled_v1", checkoutId: value.id,
        checkout: value, attribution: "unambiguous_checkout_tolerance_v1",
        receipt: { signature: hash, network: "BEP20", amountMicros: 3_600_000, timestamp: Date.parse(value.createdAt) + 1000 },
      }, "seller", paidAt);
      await db.exec("commit");
    } catch (error) { await db.exec("rollback"); throw error; }
  }
  it("three new transactions can repeat a previously received amount without deleting reservations", async () => {
    for (let n = 0; n < 3; n++) {
      await settleRepeated(await repeatedCheckout(n), `0x${String(n + 1).repeat(64)}`);
    }
    expect((await db.query("select * from alpha_exchange.commissions where payment_status='paid'")).rows).toHaveLength(3);
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(3);
    expect((await db.query("select checkout_id from alpha_exchange.commission_checkout_amount_reservations where amount_micros=3600000")).rows)
      .toEqual([{ checkout_id: "checkout-repeat-0" }]);
    // The repository replaces audit snapshots; replay in reverse chronological
    // order must not retroactively make previous payments conflict.
    const audits = await db.query<{ id: string; payload: { newValue: unknown }; created_at: string }>("select * from alpha_exchange.audit_logs order by created_at desc");
    await db.exec("delete from alpha_exchange.audit_logs");
    for (const row of audits.rows) await insertAudit(row.id, row.payload.newValue, "seller", row.created_at);
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(3);
    const settled = audits.rows.find(row => row.id === "checkout-repeat-0:settled")!;
    const altered = structuredClone(settled.payload.newValue) as { receipt: { timestamp: number } };
    altered.receipt.timestamp++;
    await db.query("delete from alpha_exchange.audit_logs where id=$1", [settled.id]);
    await expect(insertAudit(settled.id, altered)).rejects.toThrow("Immutable checkout settlement changed");
    await expect(db.query("insert into alpha_exchange.commissions values('legacy','other','pending',$1)", [JSON.stringify({ paymentExpectedAmount: 3.6 })])).rejects.toThrow();
  });
  it.each([null, "invalid", "2026-09-25T16:00:11.000Z", "2026-09-25T16:00:12.000Z"])("repeated amount remains blocked without prior closure before receipt: %s", async (paidAt) => {
    await settleRepeated(await repeatedCheckout(0), signature);
    const next = await repeatedCheckout(1);
    await db.query("update alpha_exchange.commissions set payload=payload || $1::jsonb where id='cm'", [JSON.stringify({ paidAt })]);
    await expect(settleRepeated(next, `0x${"b".repeat(64)}`)).rejects.toThrow();
    expect((await db.query<{ payment_status: string }>("select payment_status from alpha_exchange.commissions where id='cm1'")).rows[0].payment_status).toBe("pending");
  });
  it("the old transaction cannot settle a new commission even if the amount and timestamp match", async () => {
    await settleRepeated(await repeatedCheckout(0), signature);
    const next = await repeatedCheckout(1);
    await expect(settleRepeated(next, signature.toUpperCase().replace("0X", "0x"))).rejects.toThrow();
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(1);
  });
  it("repeated amount migration is idempotent, private, and leaves financial records untouched", async () => {
    await settleRepeated(await repeatedCheckout(0), signature);
    const before = (await db.query("select * from alpha_exchange.commissions")).rows;
    await db.exec(repeatedMigration); await db.exec(repeatedMigration);
    expect((await db.query("select * from alpha_exchange.commissions")).rows).toEqual(before);
    const fn = await db.query<{ prosecdef: boolean; proacl: string[] }>("select prosecdef,proacl from pg_proc where oid='alpha_exchange.is_earlier_checkout_received_amount(text,bigint,numeric)'::regprocedure");
    expect(fn.rows[0].prosecdef).toBe(false);
    expect(fn.rows[0].proacl.some(grant => grant.startsWith("=X/"))).toBe(false);
  });
});
