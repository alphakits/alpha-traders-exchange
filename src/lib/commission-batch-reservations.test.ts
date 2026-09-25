import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
let db: PGlite;
const migration = readFileSync(new URL("../../db/migrations/20260925_commission_batch_receipt_reservations.sql", import.meta.url), "utf8");
const signature = "a".repeat(64);
const approval = { kind: "commission_batch_receipt_approval_v1", batch: { id: "batch-test", kind: "owner_confirmed_receipt",
  sellerId: "seller", commissionIds: ["cm42", "cm43"], signature: `0x${signature.toUpperCase()}`, network: "BEP20", approvedByUserId: "owner" } };
async function approve(value = approval, id = "batch-test:approved") {
  await db.query("INSERT INTO alpha_exchange.audit_logs(id, actor_user_id, created_at, payload) VALUES ($1, 'owner', now(), $2)",
    [id, JSON.stringify({ newValue: value })]);
}
async function commission(id: string, seller = "seller", tx = signature) {
  return db.query("INSERT INTO alpha_exchange.commissions(id, seller_id, payload) VALUES ($1,$2,$3)",
    [id, seller, JSON.stringify({ id, sellerId: seller, paymentSignature: tx, paymentStatus: "paid" })]);
}
beforeEach(async () => {
  db = new PGlite();
  await db.exec("CREATE SCHEMA alpha_exchange; CREATE TABLE alpha_exchange.commissions(id text primary key, seller_id text, payload jsonb); CREATE TABLE alpha_exchange.audit_logs(id text primary key, actor_user_id text, created_at timestamptz, payload jsonb);");
  await db.exec(migration);
});
afterEach(async () => { await db.close(); });
describe("durable cross-path receipt reservation", () => {
  it("allows all members of the approved group to share one original receipt", async () => {
    await approve(); await commission("cm42"); await commission("cm43");
    expect((await db.query("select * from alpha_exchange.commissions")).rows).toHaveLength(2);
  });
  it("rejects a legacy single-payment write for a different seller", async () => {
    await approve(); await expect(commission("other", "different")).rejects.toThrow(/another authorized payment group/);
  });
  it("rejects another invoice even from the same seller", async () => {
    await approve(); await expect(commission("other")).rejects.toThrow(/another authorized payment group/);
  });
  it("deduplicates hexadecimal case and 0x-prefix aliases", async () => {
    await approve(); await expect(commission("other", "different", `0x${signature.toUpperCase()}`)).rejects.toThrow();
  });
  it("reservation survives whole-table snapshot replacement and audit pruning", async () => {
    await approve(); await commission("cm42"); await db.exec("delete from alpha_exchange.audit_logs; delete from alpha_exchange.commissions;");
    await expect(commission("other", "different")).rejects.toThrow();
    await commission("cm42"); await approve();
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(1);
  });
  it("rolls back a partial group when another row violates ownership", async () => {
    await approve(); await db.exec("begin"); await commission("cm42");
    await expect(commission("other", "different")).rejects.toThrow(); await db.exec("rollback");
    expect((await db.query("select * from alpha_exchange.commissions")).rows).toHaveLength(0);
  });
  it("rejects group reassignment even if the old audit is removed", async () => {
    await approve(); await db.exec("delete from alpha_exchange.audit_logs");
    await expect(approve({ ...approval, batch: { ...approval.batch, sellerId: "different" } })).rejects.toThrow(/already reserved/);
  });
  it("refuses a receipt already used by the old single-payment path", async () => {
    await commission("legacy", "different"); await expect(approve()).rejects.toThrow(/already assigned/);
  });
  it("does not alter unrelated legacy payments", async () => {
    await approve(); await commission("legacy", "different", "b".repeat(64));
    expect((await db.query("select * from alpha_exchange.commissions")).rows).toHaveLength(1);
  });
  it("rejects an audit with spoofed approving-owner metadata", async () => {
    await expect(approve({ ...approval, batch: { ...approval.batch, approvedByUserId: "other" } })).rejects.toThrow(/Invalid commission batch/);
  });
  it("rejects duplicate group ids and remains safe on repeated migration", async () => {
    await expect(approve({ ...approval, batch: { ...approval.batch, commissionIds: ["cm42", "cm42"] } })).rejects.toThrow();
    await approve(); await db.exec(migration);
    expect((await db.query("select * from alpha_exchange.commission_batch_receipt_reservations")).rows).toHaveLength(1);
  });
});
