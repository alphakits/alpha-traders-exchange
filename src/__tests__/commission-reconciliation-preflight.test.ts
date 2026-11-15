// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntry, CommissionRecord } from "@/types/alpha-exchange";
import * as repositoryModule from "@/lib/alpha-exchange-repository";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { getCommissionRecordsForAutomaticReconciliation, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";

const canonicalRead = new Error("Full canonical reconciliation required");
const now = new Date().toISOString();
const later = new Date(Date.now() + 86_400_000).toISOString();
const earlier = new Date(Date.now() - 86_400_000).toISOString();

function commission(overrides: Partial<CommissionRecord> = {}): CommissionRecord {
  return {
    id: "commission-1", sellerId: "seller", source: "admin_manual", issueReason: "Test obligation",
    rate: 0.01, grossAmount: 500, commissionAmount: 5, paymentStatus: "pending",
    paymentExpectedAmount: 5.000001, paymentExpectedAmountMode: "unique_v1",
    paymentExpectedAmountAssignedAt: now, createdAt: now, updatedAt: now, dueAt: later,
    ...overrides,
  };
}

function ledger(id: string, kind: string, deltaMicros: number): AuditLogEntry {
  return {
    id, action: "commission_recorded", actorUserId: "seller", targetUserId: "seller",
    createdAt: now, details: "Shortfall ledger fixture",
    newValue: { kind, policy: "carry_forward_v1", sellerId: "seller", deltaMicros },
  };
}

describe("commission reconciliation PostgreSQL preflight", () => {
  let db: PGlite;
  let repository: AlphaExchangeRepository;
  let query: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    db = new PGlite();
    // No users, listings, evidence, chat or other history tables exist here.
    // The real probe must depend only on these three payload tables and version.
    await db.exec(`create schema alpha_exchange;
      create table alpha_exchange.runtime_meta (singleton boolean, version bigint);
      create table alpha_exchange.commissions (id text primary key, sort_index bigint, payload jsonb);
      create table alpha_exchange.purchase_requests (id text primary key, sort_index bigint, payload jsonb);
      create table alpha_exchange.audit_logs (id text primary key, sort_index bigint, payload jsonb);`);
  });

  beforeEach(async () => {
    await db.exec(`truncate alpha_exchange.runtime_meta, alpha_exchange.commissions,
      alpha_exchange.purchase_requests, alpha_exchange.audit_logs;
      insert into alpha_exchange.runtime_meta values (true, 7);`);
    query = vi.fn((sql: string, parameters?: unknown[]) => db.query(sql, parameters));
    repository = new AlphaExchangeRepository({ query } as unknown as Pool);
    vi.spyOn(repository, "ensureReady").mockResolvedValue();
    vi.spyOn(repository, "loadSnapshot").mockRejectedValue(canonicalRead);
    vi.spyOn(repository, "saveSnapshot").mockRejectedValue(new Error("A probe must never be persisted"));
    vi.spyOn(repositoryModule, "getAlphaExchangeRepository").mockResolvedValue(repository);
    vi.stubEnv("ALPHA_EXCHANGE_QA_COMMISSION_MODE", "0");
    invalidateAlphaExchangeStoreCache();
  });

  afterEach(() => {
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    invalidateAlphaExchangeStoreCache();
  });

  afterAll(async () => { await db.close(); });

  async function insert<Payload extends { id: string }>(table: "commissions" | "purchase_requests" | "audit_logs", payload: Payload, order = 0) {
    await db.query(`insert into alpha_exchange.${table} values ($1, $2, $3)`, [payload.id, order, JSON.stringify(payload)]);
  }

  async function payloads() {
    return (await db.query("select payload from alpha_exchange.commissions order by sort_index")).rows;
  }

  it("projects linked trade amount/policy and shortfall ledger while omitting large chat and unrelated audit payloads", async () => {
    const largePrivateContent = "private-chat-and-evidence:" + "x".repeat(500_000);
    await insert("commissions", commission({ id: "later", purchaseRequestId: "linked", paymentExpectedAmount: 5.000002 }), 20);
    await insert("commissions", commission({ id: "first", purchaseRequestId: "linked" }), 10);
    await insert("purchase_requests", {
      id: "linked", usdtAmount: "500.1234", feePolicyVersion: "buyer_seller_1pct_v1",
      messages: [{ message: largePrivateContent }], timeline: [{ receipt: largePrivateContent }],
    });
    await insert("purchase_requests", { id: "unrelated", usdtAmount: "999999", messages: [largePrivateContent] });
    const balance = ledger("balance", "commission_shortfall_balance_v1", 1_000_000);
    const applied = ledger("applied", "commission_shortfall_applied_v1", -1_000_000);
    await insert("audit_logs", applied, 2);
    await insert("audit_logs", balance, 1);
    await insert("audit_logs", { ...balance, id: "irrelevant", details: largePrivateContent, newValue: { kind: "other" } });

    const probe = await repository.loadCommissionReconciliationProbe();

    expect(probe.__runtimeVersion).toBe(7);
    expect(probe.commissionRecords.map(row => row.id)).toEqual(["first", "later"]);
    expect(probe.purchaseRequests).toEqual([{ id: "linked", usdtAmount: "500.1234", feePolicyVersion: "buyer_seller_1pct_v1" }]);
    expect(probe.auditLogs).toEqual([balance, applied]);
    expect(probe.users).toEqual([]);
    expect(JSON.stringify(probe).length).toBeLessThan(5_000);
    expect(JSON.stringify(probe)).not.toContain("private-chat-and-evidence");
    expect(query).toHaveBeenCalledTimes(1);
    expect(repository.loadSnapshot).not.toHaveBeenCalled();
  });

  it("returns initialized intents without full reads or writes and observes the next committed version on each poll", async () => {
    await insert("commissions", commission());
    await expect(getCommissionRecordsForAutomaticReconciliation()).resolves.toMatchObject([
      { id: "commission-1", paymentExpectedAmount: 5.000001 },
    ]);
    await db.query("update alpha_exchange.commissions set payload = $1", [JSON.stringify(commission({ paymentExpectedAmount: 5.000002 }))]);
    await db.exec("update alpha_exchange.runtime_meta set version = 8");

    await expect(getCommissionRecordsForAutomaticReconciliation()).resolves.toMatchObject([
      { id: "commission-1", paymentExpectedAmount: 5.000002 },
    ]);
    expect((await repository.loadCommissionReconciliationProbe()).__runtimeVersion).toBe(8);
    expect(query).toHaveBeenCalledTimes(3);
    expect(repository.loadSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    { name: "trade policy combines both fee shares", record: { commissionAmount: 1, paymentExpectedAmount: 20.000001 }, trade: { usdtAmount: "1000", feePolicyVersion: "buyer_seller_1pct_v1" } },
    { name: "record policy combines both fee shares", record: { commissionAmount: 1, paymentExpectedAmount: 10.000001, feePolicyVersion: "buyer_seller_1pct_v1" }, trade: { usdtAmount: "500" } },
    { name: "legacy trade quantity overrides recorded amount", record: { commissionAmount: 1, paymentExpectedAmount: 5.000001 }, trade: { usdtAmount: "500" } },
    { name: "precise trade fees preserve six decimals", record: { commissionAmount: 1, paymentExpectedAmount: 10.002469, commissionCalculationVersion: "usdt_6dp_v2" }, trade: { usdtAmount: "500.1234", feePolicyVersion: "buyer_seller_1pct_v1" } },
    { name: "missing linked trade uses legacy recorded amount", record: { commissionAmount: 7.125, paymentExpectedAmount: 7.130001 }, trade: null },
    { name: "missing linked trade uses precise recorded amount", record: { commissionAmount: 7.125001, paymentExpectedAmount: 7.125002, commissionCalculationVersion: "usdt_6dp_v2" }, trade: null },
  ])("validates $name without manufacturing a new payment intent", async ({ record, trade }) => {
    await insert("commissions", commission({ purchaseRequestId: "linked", ...record } as Partial<CommissionRecord>));
    if (trade) await insert("purchase_requests", { id: "linked", ...trade });
    const before = await payloads();

    await expect(getCommissionRecordsForAutomaticReconciliation()).resolves.toMatchObject([
      { paymentExpectedAmount: record.paymentExpectedAmount },
    ]);

    expect(repository.loadSnapshot).not.toHaveBeenCalled();
    expect(await payloads()).toEqual(before);
  });

  it.each([
    { name: "new unassigned obligation", record: { paymentExpectedAmount: undefined, paymentExpectedAmountMode: undefined, paymentExpectedAmountAssignedAt: undefined } },
    { name: "missing issue timestamp", record: { paymentExpectedAmountAssignedAt: undefined } },
    { name: "new overdue notification", record: { dueAt: earlier } },
    { name: "verified but unpaid obligation", record: { paymentVerificationStatus: "verified" } },
    { name: "materializable shortfall", record: {}, shortfall: true },
  ])("rereads canonical state for $name without persisting the scratch projection", async ({ record, shortfall }) => {
    await insert("commissions", commission(record as Partial<CommissionRecord>));
    if (shortfall) await insert("audit_logs", ledger("balance", "commission_shortfall_balance_v1", 1_000_000));
    const before = await payloads();
    const beforeAudit = (await db.query("select payload from alpha_exchange.audit_logs order by sort_index")).rows;

    await expect(getCommissionRecordsForAutomaticReconciliation()).rejects.toBe(canonicalRead);

    expect(repository.loadSnapshot).toHaveBeenCalledOnce();
    expect(await payloads()).toEqual(before);
    expect((await db.query("select payload from alpha_exchange.audit_logs order by sort_index")).rows).toEqual(beforeAudit);
  });

  it("keeps a small shortfall deferred when no unpaid obligation exists", async () => {
    await insert("commissions", commission({ paymentStatus: "paid" }));
    await insert("audit_logs", ledger("balance", "commission_shortfall_balance_v1", 1_000_000));

    await expect(getCommissionRecordsForAutomaticReconciliation()).resolves.toMatchObject([{ paymentStatus: "paid" }]);

    expect(repository.loadSnapshot).not.toHaveBeenCalled();
  });

  it("does not repeat an already-recorded overdue notification", async () => {
    await insert("commissions", commission({ paymentStatus: "overdue", dueAt: earlier, overdueNotifiedAt: now }));

    await expect(getCommissionRecordsForAutomaticReconciliation()).resolves.toMatchObject([{ paymentStatus: "overdue" }]);

    expect(repository.loadSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    { name: "underpayment assignment", record: { paymentExpectedAmount: 4.999999 }, error: /invalid exact payment amount/ },
    { name: "invalid issue timestamp", record: { paymentExpectedAmountAssignedAt: "invalid" }, error: /invalid payment amount issue time/ },
    { name: "duplicate exact assignment", record: {}, duplicate: true, error: /payment amount collision/ },
    { name: "amount based on stale recorded debt", record: {}, canonicalTrade: true, error: /invalid exact payment amount/ },
  ])("fails closed for $name without a broad read fallback", async ({ record, duplicate, canonicalTrade, error }) => {
    await insert("commissions", commission({ ...record, ...(canonicalTrade ? { purchaseRequestId: "linked" } : {}) }));
    if (duplicate) await insert("commissions", commission({ id: "commission-2" }), 1);
    if (canonicalTrade) await insert("purchase_requests", { id: "linked", usdtAmount: "1000", feePolicyVersion: "buyer_seller_1pct_v1" });
    const before = await payloads();

    await expect(getCommissionRecordsForAutomaticReconciliation()).rejects.toThrow(error);

    expect(repository.loadSnapshot).not.toHaveBeenCalled();
    expect(await payloads()).toEqual(before);
  });

  it("does not turn a failed probe query into a full snapshot load", async () => {
    query.mockRejectedValueOnce(new Error("Probe source unavailable"));

    await expect(getCommissionRecordsForAutomaticReconciliation()).rejects.toThrow("Probe source unavailable");

    expect(repository.loadSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a probe without its canonical version", async () => {
    await db.exec("delete from alpha_exchange.runtime_meta");

    await expect(getCommissionRecordsForAutomaticReconciliation()).rejects.toThrow("Commission reconciliation state is unavailable");

    expect(repository.loadSnapshot).not.toHaveBeenCalled();
  });
});
