// @vitest-environment node
// Actual canonical SQL + an independently authorized synthetic wallet pause.
// This proves shared transaction mechanics, not authentication or a principal return.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mutateDevelopmentInitialAcceptanceInTransaction, withDevelopmentPrepaymentCancellationInTransaction,
  type DevelopmentPrepaymentCancellationDecision, type DevelopmentPrepaymentCancellationParticipant } from "@/lib/alpha-exchange-repository";
import type { AlphaExchangeNotification, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { FIXTURE_TIME, OPERATOR, TRON, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { createDurableWallet, initializeDurableWallet, walletCommand, type DurableWallet } from "./durable";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createInitialAcceptanceFixture } from "./initial-acceptance-fixture";
import { planDevelopmentPrepaymentCancellation } from "./prepayment-cancellation";
import { balance, expectedCustody } from "./ledger";
import { parseUnits } from "./amounts";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 90_000;
const TABLES = ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions", "marketplace_enforcement_records",
  "evidence", "disputes", "notifications", "audit_logs"] as const;
let directory: string, store: WalletStore, wallet: DurableWallet;
let fixture: Awaited<ReturnType<typeof createInitialAcceptanceFixture>>;
function boundWallet(tx: WalletSql) {
  return createDurableWallet({ mode: MODE, clock: () => FIXTURE_TIME + 2000,
    store: { transaction: work => work(tx), close: async () => undefined } });
}
async function setup(method: "Bank Transfer" | "Face-to-Face" = "Bank Transfer") {
  if (store) { await store.close(); await rm(directory, { recursive: true, force: true }); }
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-prepayment-cancellation-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory }); await initializeDurableWallet(store);
  fixture = await store.transaction(tx => createInitialAcceptanceFixture({ mode: MODE, tx, paymentMethod: method, tradeProjection: "pending" }));
  wallet = createDurableWallet({ mode: MODE, store, clock: () => FIXTURE_TIME });
  await durableFixture(wallet).fundedListing("500", fixture.listingId);
  await store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => ({
    requestId: fixture.requestId, tradeId: fixture.tradeId, actorUserId: fixture.sellerId, acceptedAtMs: fixture.acceptedAtMs,
    ...(method === "Face-to-Face" ? { safetyAcknowledged: true as const } : {}),
  })));
}
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
  await setup();
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); } }
}, TIMEOUT);
function decision(extra: Partial<DevelopmentPrepaymentCancellationDecision> = {}): DevelopmentPrepaymentCancellationDecision {
  return { requestId: fixture.requestId, tradeId: fixture.tradeId, actorUserId: fixture.sellerId, cancelledAtMs: fixture.acceptedAtMs + 1000, ...extra };
}
async function pause(tx: WalletSql) { return boundWallet(tx).execute(walletCommand("pause", OPERATOR, "independent-cancellation-pause", null)); }
async function cancel(tx: WalletSql, companion = true, extra: Partial<DevelopmentPrepaymentCancellationDecision> = {}) {
  return withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
    if (companion) await pause(tx);
    return participant.cancel(decision(extra));
  });
}
async function footprint() {
  return store.transaction(async tx => {
    const canonical: Record<string, Record<string, unknown>[]> = {};
    for (const table of TABLES) canonical[table] = (await tx.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.row);
    return { canonical, wallet: await boundWallet(tx).snapshot() };
  });
}
async function patchRequest(patch: (request: PurchaseRequest) => void, requestId = fixture.requestId, syncTrade = true) {
  await store.transaction(async tx => {
    const request = (await tx.query<{ payload: PurchaseRequest }>("SELECT payload FROM alpha_exchange.purchase_requests WHERE id=$1", [requestId])).rows[0].payload;
    patch(request);
    await tx.query(`UPDATE alpha_exchange.purchase_requests SET trade_id=$2,listing_id=$3,seller_id=$4,buyer_id=$5,status=$6,
      timed_out_at=$7::timestamptz,completed_at=$8::timestamptz,created_at=$9::timestamptz,updated_at=$10::timestamptz,payload=$11::jsonb WHERE id=$1`,
    [requestId, request.tradeId ?? null, request.listingId, request.sellerId, request.buyerId, request.status, request.timedOutAt ?? null,
      request.completedAt ?? null, request.createdAt, request.updatedAt, JSON.stringify(request)]);
    if (syncTrade) {
      const trade = { id: request.tradeId, purchaseRequestId: request.id, listingId: request.listingId, sellerId: request.sellerId,
        buyerId: request.buyerId, status: request.status, completedAt: request.completedAt,
        createdAt: request.tradeCreatedAt ?? request.createdAt, updatedAt: request.updatedAt, timeline: request.timeline };
      await tx.query(`UPDATE alpha_exchange.trades SET status=$2,completed_at=$3::timestamptz,updated_at=$4::timestamptz,payload=$5::jsonb WHERE id=$1`,
      [request.tradeId, request.status, request.completedAt ?? null, request.updatedAt, JSON.stringify(trade)]);
    }
  });
}
async function patchListing(patch: (listing: MarketplaceListing) => void) {
  await store.transaction(async tx => {
    const listing = (await tx.query<{ payload: MarketplaceListing }>("SELECT payload FROM alpha_exchange.listings WHERE id=$1", [fixture.listingId])).rows[0].payload;
    patch(listing);
    await tx.query(`UPDATE alpha_exchange.listings SET status=$2,active_trade_request_id=$3,expires_at=$4::timestamptz,
      updated_at=$5::timestamptz,payload=$6::jsonb WHERE id=$1`,
    [listing.id, listing.status, listing.activeTradeRequestId ?? null, listing.expiresAt ?? null, listing.updatedAt, JSON.stringify(listing)]);
  });
}
async function insertNotification(row: AlphaExchangeNotification, sortIndex = 77) {
  await store.transaction(tx => tx.query("INSERT INTO alpha_exchange.notifications VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7::jsonb)",
    [row.id, row.userId, row.category, row.isRead, row.createdAt, sortIndex, JSON.stringify(row)]));
}

describe("separate canonical prepayment cancellation transaction participant", () => {
  it.each(["seller", "buyer"] as const)("commits exact %s effects and an independent synthetic pause in one physical transaction", async side => {
    const before = await footprint(), statements: string[] = [];
    const result = await store.transaction(async owner => {
      const tx: WalletSql = { query: (sql, params) => { statements.push(sql); return owner.query(sql, params); }, exec: sql => owner.exec(sql) };
      return cancel(tx, true, { actorUserId: side === "seller" ? fixture.sellerId : fixture.buyerId });
    });
    const after = await footprint();
    expect(after.canonical.purchase_requests.find(row => row.id === fixture.requestId)?.payload).toEqual(JSON.parse(JSON.stringify(result.request)));
    expect(after.canonical.listings.find(row => row.id === fixture.listingId)?.payload).toEqual(JSON.parse(JSON.stringify(result.listing)));
    expect(after.canonical.trades).toHaveLength(1);
    expect(after.canonical.trades[0]).toMatchObject({ id: fixture.tradeId, status: "cancelled", created_at: before.canonical.trades[0].created_at,
      completed_at: null, sort_index: 31, payload: result.trade });
    expect(result.request.usdtAmount).toBe("200"); expect(result.request.pricePerUsdt).toBe("3.20"); expect(result.listing.availableAmount).toBe("500");
    expect(result.request.closedAt).toBeUndefined(); expect(result.request.closeReason).toBeUndefined();
    expect(result.request.trustReconciliation).toEqual({ requestedAt: result.request.updatedAt, requestedByUserId: side === "seller" ? fixture.sellerId : fixture.buyerId });
    expect(after.canonical.notifications).toHaveLength(before.canonical.notifications.length + 2);
    expect(after.canonical.audit_logs).toHaveLength(before.canonical.audit_logs.length + 1);
    expect(after.canonical.runtime_meta[0].version).toBe(9);
    for (const table of ["users", "commissions", "marketplace_enforcement_records", "evidence", "disputes"]) expect(after.canonical[table]).toEqual(before.canonical[table]);
    for (const table of ["purchase_requests", "listings"]) {
      const id = table === "purchase_requests" ? fixture.requestId : fixture.listingId;
      expect(after.canonical[table].filter(row => row.id !== id)).toEqual(before.canonical[table].filter(row => row.id !== id));
      expect(after.canonical[table].find(row => row.id === id)?.sort_index).toBe(before.canonical[table].find(row => row.id === id)?.sort_index);
    }
    expect(after.wallet.revision).toBe(before.wallet.revision + 1); expect(after.wallet.state.haltReason).toBeTruthy();
    expect(after.wallet.state.trades.size).toBe(0); expect(balance(after.wallet.state, TRON, `listing:${fixture.listingId}`)).toBe(parseUnits("500", 6));
    expect(expectedCustody(after.wallet.state, TRON)).toBe(expectedCustody(before.wallet.state, TRON));
    const requestFence = statements.findIndex(sql => sql.includes("pg_advisory_xact_lock(61422919"));
    const globalFence = statements.findIndex(sql => sql.includes("pg_advisory_xact_lock(61422917"));
    const runtimeFence = statements.findIndex(sql => /runtime_meta.*FOR UPDATE/i.test(sql));
    const listingFence = statements.findIndex(sql => sql.includes("prepayment cancellation: listing fence"));
    const read = statements.findIndex(sql => sql.includes("initial acceptance: authoritative read"));
    expect(requestFence).toBeLessThan(globalFence); expect(globalFence).toBeLessThan(runtimeFence); expect(runtimeFence).toBeLessThan(listingFence);
    expect(listingFence).toBeLessThan(read); expect(statements.some(sql => /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(sql))).toBe(false);
    result.request.usdtAmount = "999"; result.listing.availableAmount = "0"; expect(await footprint()).toEqual(after);
  }, TIMEOUT);

  it("supports Face-to-Face cancellation without creating a transfer or changing consent", async () => {
    await setup("Face-to-Face"); const result = await store.transaction(tx => cancel(tx));
    expect(result.request.status).toBe("cancelled"); expect(result.request.sellerSafetyAcknowledged).toBe(true);
  }, TIMEOUT);
  it("persists proposal withdrawal and exact reminder archives while retaining unrelated notification rows", async () => {
    const at = new Date(fixture.acceptedAtMs).toISOString();
    await patchRequest(request => {
      request.termsProposal = { id: "pending-cancellation-proposal", kind: "amount_correction", status: "pending", pricePerUsdt: "3.20", usdtAmount: "250", fiatAmount: "808.00", createdAt: at };
      request.actionReminderState = { stage: "accepted", actionStartedAt: at,
        buyer: { userId: fixture.buyerId, lastSentAt: at, reminderCount: 1 } }; request.inactivityWarningSentAt = at;
    });
    const reminder: AlphaExchangeNotification = { id: "retained-buyer-reminder", userId: fixture.buyerId, category: "trade", title: "Action required", message: "Synthetic",
      isRead: false, state: "unread", reason: "automatic_trade_action_reminder", relatedRequestId: fixture.requestId, createdAt: at };
    await insertNotification(reminder); await insertNotification({ ...reminder, id: "retained-seller-reminder", userId: fixture.sellerId }, 78);
    const before = await footprint(), result = await store.transaction(tx => cancel(tx)), after = await footprint();
    expect(result.request.termsProposal).toMatchObject({ status: "withdrawn", resolvedAt: result.request.updatedAt });
    expect(result.request.actionReminderState).toBeUndefined(); expect(result.request.inactivityWarningSentAt).toBeUndefined();
    expect(result.notificationUpdates).toEqual([{ ...reminder, state: "archived", isRead: true, archivedAt: result.request.updatedAt, updatedAt: result.request.updatedAt }]);
    const retained = after.canonical.notifications.find(row => row.id === reminder.id)!;
    expect(retained).toMatchObject({ is_read: true, sort_index: 77, created_at: before.canonical.notifications.find(row => row.id === reminder.id)?.created_at, payload: result.notificationUpdates[0] });
    expect(after.canonical.notifications.find(row => row.id === "retained-seller-reminder")).toEqual(before.canonical.notifications.find(row => row.id === "retained-seller-reminder"));
  }, TIMEOUT);
  it("allows seller cancellation after retained bank disclosure but rejects buyer cancellation atomically", async () => {
    await patchRequest(request => { request.sensitivePaymentKind = "bank_details"; request.sensitivePaymentSharedAt = new Date(fixture.acceptedAtMs).toISOString(); });
    const before = await footprint();
    await expect(store.transaction(tx => cancel(tx, true, { actorUserId: fixture.buyerId }))).rejects.toThrow("bank details");
    expect(await footprint()).toEqual(before);
    expect((await store.transaction(tx => cancel(tx))).request.sensitivePaymentSharedAt).toBe(new Date(fixture.acceptedAtMs).toISOString());
  }, TIMEOUT);
  it("rolls back all canonical effects and companion writes after caller failure", async () => {
    const before = await footprint(); let persisted = false;
    await expect(store.transaction(async tx => {
      await cancel(tx); persisted = (await tx.query<{ status: string }>("SELECT status FROM alpha_exchange.trades WHERE id=$1", [fixture.tradeId])).rows[0].status === "cancelled";
      throw new Error("Synthetic caller failure after cancellation");
    })).rejects.toThrow("Synthetic caller failure");
    expect(persisted).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it("rejects a later retry instead of inventing a financial cancellation receipt", async () => {
    await store.transaction(tx => cancel(tx)); const before = await footprint();
    await expect(store.transaction(tx => cancel(tx))).rejects.toThrow("no idempotent receipt"); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it.each([
    ["owner override", { actorUserId: "unrelated-owner" }], ["replacement trade", { tradeId: "new-trade" }],
    ["different request", { requestId: "different-request" }], ["supplied amount", { usdtAmount: "999" }],
    ["caller role", { role: "owner" }], ["uncloneable decision", { callback: () => true }],
  ])("poisons a swallowed %s after a real companion write", async (_label, extra) => {
    const before = await footprint(); let rejected = false;
    await expect(store.transaction(async tx => {
      try { await withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
        await pause(tx); return participant.cancel({ ...decision(), ...extra } as DevelopmentPrepaymentCancellationDecision);
      }); } catch { rejected = true; }
    })).rejects.toThrow();
    expect(rejected).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it("clones the detached view and decision before an asynchronous boundary", async () => {
    let participant!: DevelopmentPrepaymentCancellationParticipant, retained!: DevelopmentPrepaymentCancellationDecision;
    let changed = false;
    const result = await store.transaction(async owner => {
      const tx: WalletSql = { async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (sql.includes("prepayment cancellation: request persistence")) {
          changed = true; (retained as { actorUserId: string }).actorUserId = fixture.buyerId;
          participant.marketplace.purchaseRequests[0].usdtAmount = "999";
        }
        return owner.query<Row>(sql, params);
      }, exec: sql => owner.exec(sql) };
      return withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async value => {
        participant = value; retained = decision(); return value.cancel(retained);
      });
    });
    expect(changed).toBe(true); expect(result.request.usdtAmount).toBe("200"); expect(result.request.timeline.at(-1)?.actorUserId).toBe(fixture.sellerId);
    await expect(participant.cancel(decision())).rejects.toThrow();
  }, TIMEOUT);
  it("refuses a second invocation even if its failure is swallowed", async () => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      try { await withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
        await pause(tx); await participant.cancel(decision()); try { await participant.cancel(decision()); } catch { /* Deliberately swallowed. */ }
      }); } catch { /* Outer transaction owner also swallows. */ }
    })).rejects.toThrow(); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it("refuses a callback that starts cancellation without awaiting its completion", async () => {
    const before = await footprint(); let running: Promise<unknown> | undefined;
    await expect(store.transaction(async tx => {
      try { await withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
        await pause(tx); running = participant.cancel(decision()).catch(error => error);
      }); } catch { /* Owner attempts to commit anyway. */ }
    })).rejects.toThrow();
    await running; expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it.each(["before cancellation", "after cancellation"])("rejects changed canonical dependencies %s", async when => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      try { await withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
        await pause(tx);
        if (when === "after cancellation") await participant.cancel(decision());
        await tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true'::jsonb) WHERE id=$1", [fixture.sellerId]);
        if (when === "before cancellation") await participant.cancel(decision());
      }); } catch { /* Owner attempts to commit both writes. */ }
    })).rejects.toThrow(); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it("detects submillisecond runtime-fence drift after persistence instead of rounding it away", async () => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      try { await withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
        await pause(tx); await participant.cancel(decision());
        await tx.query("UPDATE alpha_exchange.runtime_meta SET updated_at=updated_at+interval '1 microsecond' WHERE singleton=true");
      }); } catch { /* Deliberately swallowed to exercise physical transaction abortion. */ }
    })).rejects.toThrow(); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it.each(["alpha_wallet_marketplace_simulation", "alpha_wallet_initial_marketplace_simulation"])("refuses the frozen %s cohort without dropping its guards", async schema => {
    await store.transaction(tx => tx.exec(`CREATE SCHEMA ${schema}`)); const before = await footprint();
    await expect(store.transaction(tx => cancel(tx))).rejects.toThrow("existing coordinated or recovered"); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it.each([
    ["normalized request state", "UPDATE alpha_exchange.purchase_requests SET status='pending' WHERE id=$1"],
    ["normalized actor role", "UPDATE alpha_exchange.users SET role='owner' WHERE id=$1"],
    ["submillisecond time", "UPDATE alpha_exchange.purchase_requests SET updated_at=updated_at+interval '1 microsecond' WHERE id=$1"],
    ["lossy JSON integer", "UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{privatePrecisionProbe}','9007199254740993'::jsonb) WHERE id=$1"],
    ["inexact amount", "UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{usdtAmount}','\"200.0000001\"'::jsonb) WHERE id=$1"],
    ["missing physical trade", "DELETE FROM alpha_exchange.trades WHERE purchase_request_id=$1"],
    ["changed physical trade creation", "UPDATE alpha_exchange.trades SET created_at=created_at+interval '1 second' WHERE purchase_request_id=$1"],
  ])("refuses %s before exposing the callback", async (_label, sql) => {
    await store.transaction(tx => tx.query(sql, [sql.includes("alpha_exchange.users") ? fixture.sellerId : fixture.requestId]));
    const before = await footprint(); let called = false;
    await expect(store.transaction(tx => withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => { called = true; }))).rejects.toThrow();
    expect(called).toBe(false); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it.each(["normalized notification user", "normalized notification read state", "lossy event JSON"])("rejects %s", async condition => {
    const row: AlphaExchangeNotification = { id: "malformed-reminder", userId: fixture.buyerId, category: "trade", title: "Reminder", message: "Synthetic", isRead: false,
      relatedRequestId: fixture.requestId, createdAt: new Date(fixture.acceptedAtMs).toISOString() };
    await insertNotification(row);
    await store.transaction(tx => tx.query(condition === "normalized notification user" ? "UPDATE alpha_exchange.notifications SET user_id=$2 WHERE id=$1"
      : condition === "normalized notification read state" ? "UPDATE alpha_exchange.notifications SET is_read=true WHERE id=$1"
        : "UPDATE alpha_exchange.notifications SET payload=jsonb_set(payload,'{precisionProbe}','9007199254740993'::jsonb) WHERE id=$1",
    condition === "normalized notification user" ? [row.id, fixture.sellerId] : [row.id]));
    const before = await footprint(); await expect(store.transaction(tx => cancel(tx))).rejects.toThrow(); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it("refuses expiry at the trusted cancellation clock and competing reservations", async () => {
    await patchListing(listing => { listing.expiresAt = new Date(decision().cancelledAtMs).toISOString(); });
    const expired = await footprint(); await expect(store.transaction(tx => cancel(tx))).rejects.toThrow("unexpired"); expect(await footprint()).toEqual(expired);
    await patchListing(listing => { delete listing.expiresAt; });
    await patchRequest(request => { request.status = "accepted"; }, fixture.otherRequestId, false);
    const competing = await footprint(); await expect(store.transaction(tx => cancel(tx))).rejects.toThrow("competing"); expect(await footprint()).toEqual(competing);
  }, TIMEOUT);
  it("reads a trade-linked dispute even when its request link is inconsistent", async () => {
    const at = new Date(fixture.acceptedAtMs).toISOString();
    const dispute = { id: "wrong-request-dispute", tradeId: fixture.tradeId, purchaseRequestId: fixture.otherRequestId,
      sellerId: fixture.sellerId, buyerId: fixture.buyerId, status: "open", createdAt: at, updatedAt: at };
    await store.transaction(tx => tx.query(`INSERT INTO alpha_exchange.disputes VALUES ($1,$2,$3,$4,$5,'open',$6::timestamptz,$6::timestamptz,91,$7::jsonb)`,
      [dispute.id, dispute.tradeId, dispute.purchaseRequestId, dispute.sellerId, dispute.buyerId, at, JSON.stringify(dispute)]));
    const before = await footprint();
    await expect(store.transaction(tx => cancel(tx))).rejects.toThrow("dispute linkage"); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it("rejects contradictory payment history in matching canonical request and trade projections atomically", async () => {
    await patchRequest(request => { request.timeline.push({ id: "retained-payment-history", type: "payment_sent",
      actorUserId: fixture.buyerId, actorRole: "buyer", message: "Synthetic retained payment event",
      createdAt: new Date(fixture.acceptedAtMs).toISOString() }); });
    const before = await footprint();
    expect((before.canonical.purchase_requests.find(row => row.id === fixture.requestId)?.payload as PurchaseRequest).paymentSentAt).toBeUndefined();
    expect(before.canonical.evidence).toEqual([]);
    await expect(store.transaction(tx => cancel(tx))).rejects.toThrow("timeline progress that contradicts unpaid state");
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it("refuses an event identity collision rather than overwriting outside history", async () => {
    const notification = await store.transaction(tx => withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId },
      async participant => planDevelopmentPrepaymentCancellation(participant.marketplace, decision()).notifications[0]));
    await insertNotification({ ...notification, title: "Existing outside record" }); const before = await footprint();
    await expect(store.transaction(tx => cancel(tx))).rejects.toThrow("notification identity"); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it.each(["runtime flag", "transaction marker"])("poisons a swallowed %s change even when the owner restores it", async condition => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      try { await withDevelopmentPrepaymentCancellationInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async participant => {
        await pause(tx);
        if (condition === "runtime flag") vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", "1");
        else await tx.exec("SET LOCAL alpha_wallet.development_schema='disabled'");
        return participant.cancel(decision());
      }); } catch {
        if (condition === "runtime flag") vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", undefined);
        else await tx.exec("SET LOCAL alpha_wallet.development_schema='simulation-only'");
      }
    })).rejects.toThrow(); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
});
