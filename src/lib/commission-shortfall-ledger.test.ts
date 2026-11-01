// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import { commissionShortfallBalances, materializeCommissionShortfalls, recordCommissionShortfall } from "./commission-shortfall-ledger";
const now = "2026-10-17T10:00:00.000Z";
const empty = () => ({ commissionRecords: [], auditLogs: [] } as unknown as AlphaExchangeDb);
const settle = (db: AlphaExchangeDb, id = "payment-1", shortfall = 2_000_000, excess = 0, sellerId = "seller") =>
  recordCommissionShortfall(db, { settlementId: id, sellerId, shortfallMicros: shortfall, excessMicros: excess, createdAt: now });
const due = (db: AlphaExchangeDb, sellerId = "seller") => db.commissionRecords.push({ id: `new-${sellerId}`, sellerId,
  rate: .01, grossAmount: 2000, commissionAmount: 40, paymentStatus: "pending", createdAt: now, updatedAt: now });
describe("future commission shortfalls", () => {
  it("preserves historical settled waivers and original paid records", () => {
    const db = empty(); due(db); db.commissionRecords[0].paymentStatus = "paid";
    db.auditLogs.push({ id: "historical:settled", action: "commission_paid", actorUserId: "seller", targetUserId: "seller", createdAt: now,
      details: "Historical waiver", newValue: { kind: "commission_checkout_settled_v1", plan: { waivedMicros: 2_000_000 } } });
    const historical = structuredClone(db);
    expect(materializeCommissionShortfalls(db, now)).toBe(false);
    expect(db).toEqual(historical); expect(commissionShortfallBalances(db).size).toBe(0);
  });
  it("persists a single deferred balance and applies it once when another commission becomes payable", () => {
    let db = empty(); settle(db); settle(db);
    expect(materializeCommissionShortfalls(db, now)).toBe(false);
    db = JSON.parse(JSON.stringify(db)); due(db);
    expect(materializeCommissionShortfalls(db, now)).toBe(true);
    expect(materializeCommissionShortfalls(db, now)).toBe(false);
    expect(db.commissionRecords.map(row => row.commissionAmount)).toEqual([40, 2]);
    expect(db.commissionRecords[1]).toMatchObject({ source: "tolerance_carry_forward", rate: 0, grossAmount: 0 });
    expect(commissionShortfallBalances(db).get("seller")).toBe(0);
  });
  it("does not leave concurrent pre-issued shortfalls accumulating above the allowance", () => {
    const db = empty(); settle(db); settle(db, "payment-2");
    expect(materializeCommissionShortfalls(db, now)).toBe(true);
    expect(db.commissionRecords).toHaveLength(1);
    expect(db.commissionRecords[0].commissionAmount).toBe(4);
    expect(commissionShortfallBalances(db).get("seller")).toBe(0);
  });
  it("uses excess against an existing deferred balance without creating a negative credit or double offset", () => {
    const db = empty(); settle(db);
    expect(settle(db, "payment-2", 0, 3_000_000)).toBe(2_000_000);
    expect(settle(db, "payment-2", 0, 3_000_000)).toBe(2_000_000);
    expect(commissionShortfallBalances(db).get("seller")).toBe(0);
    expect(materializeCommissionShortfalls(db, now)).toBe(false);
  });
  it("keeps a one-micro-USDT balance and separates sellers", () => {
    const db = empty(); settle(db, "a", 1); settle(db, "b", 2_000_000, 0, "other"); due(db);
    materializeCommissionShortfalls(db, now);
    expect(db.commissionRecords[1].commissionAmount).toBe(.000001);
    expect(commissionShortfallBalances(db).get("other")).toBe(2_000_000);
    expect(db.commissionRecords.every(row => row.sellerId === "seller")).toBe(true);
  });
  it("rejects changed settlement retries and invalid precision before mutation", () => {
    const db = empty(); settle(db); const before = structuredClone(db);
    expect(() => settle(db, "payment-1", 1)).toThrow("changed");
    expect(() => settle(db, "bad", .5)).toThrow("Invalid");
    expect(db).toEqual(before);
  });
});
