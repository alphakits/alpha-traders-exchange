// @vitest-environment node
// Real canonical SQL. A synthetic operator pause proves transaction mechanics;
// it is not a seller reservation, authentication proof or live execution path.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mutateDevelopmentInitialAcceptanceInTransaction, type DevelopmentInitialAcceptanceDecision,
  type DevelopmentInitialAcceptanceMarketplace } from "@/lib/alpha-exchange-repository";
import type { AlphaExchangeNotification, CommissionRecord, MarketplaceEnforcementRecord, PurchaseRequest } from "@/types/alpha-exchange";
import { FIXTURE_TIME, OPERATOR, TRON, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { parseUnits } from "./amounts";
import { createDurableWallet, initializeDurableWallet, walletCommand, type DurableWallet } from "./durable";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { planDevelopmentInitialAcceptance } from "./initial-acceptance";
import { createInitialAcceptanceFixture } from "./initial-acceptance-fixture";
import { balance, expectedCustody } from "./ledger";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));

const TIMEOUT = 90_000, MODE = "simulation-only" as const;
const TABLES = ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions", "marketplace_enforcement_records",
  "evidence", "disputes", "notifications", "audit_logs"] as const;
let directory: string, store: WalletStore, wallet: DurableWallet;
let fixture: Awaited<ReturnType<typeof createInitialAcceptanceFixture>>;

function boundWallet(tx: WalletSql) {
  return createDurableWallet({ mode: MODE, clock: () => FIXTURE_TIME + 1000,
    store: { transaction: work => work(tx), close: async () => undefined } });
}
async function setup(paymentMethod: "Bank Transfer" | "Face-to-Face" = "Bank Transfer", tradeProjection: "absent" | "pending" = "absent") {
  if (store) { await store.close(); await rm(directory, { recursive: true, force: true }); }
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-initial-acceptance-"));
  store = await createFileWalletStore({ mode: MODE, dataDir: directory });
  await initializeDurableWallet(store);
  fixture = await store.transaction(tx => createInitialAcceptanceFixture({ mode: MODE, tx, paymentMethod, tradeProjection }));
  wallet = createDurableWallet({ mode: MODE, store, clock: () => FIXTURE_TIME });
  await durableFixture(wallet).fundedListing("500", fixture.listingId);
}
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  await setup();
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); } }
}, TIMEOUT);

function decision(): DevelopmentInitialAcceptanceDecision {
  return { requestId: fixture.requestId, actorUserId: fixture.sellerId, tradeId: fixture.tradeId, acceptedAtMs: fixture.acceptedAtMs,
    ...(fixture.initialRequest.paymentMethod === "Face-to-Face" ? { safetyAcknowledged: true as const } : {}) };
}
async function pause(tx: WalletSql, requestId = "independent-initial-acceptance-pause") {
  return boundWallet(tx).execute(walletCommand("pause", OPERATOR, requestId, null));
}
async function planned(tx: WalletSql, marketplace: DevelopmentInitialAcceptanceMarketplace) {
  return planDevelopmentInitialAcceptance({ mode: MODE, actorUserId: fixture.sellerId, requestId: fixture.requestId,
    operationId: "initial-planner-operation", acceptedAtMs: fixture.acceptedAtMs, safetyAcknowledged: true,
    mapping: { assetId: TRON, walletListingId: fixture.listingId, walletTradeId: fixture.tradeId },
    marketplace, wallet: await boundWallet(tx).snapshot() });
}
async function accept(tx: WalletSql, companion = true) {
  return mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async marketplace => {
    const plan = await planned(tx, marketplace);
    expect(plan.executionAuthority).toBe(false);
    if (companion) await pause(tx);
    return plan.canonicalAcceptance;
  });
}
async function footprint() {
  return store.transaction(async tx => {
    const canonical: Record<string, Record<string, unknown>[]> = {};
    for (const table of TABLES) canonical[table] = (await tx.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.row);
    return { wallet: await boundWallet(tx).snapshot(), canonical };
  });
}
async function patchRequest(id: string, patch: (request: PurchaseRequest) => void) {
  await store.transaction(async tx => {
    const request = (await tx.query<{ payload: PurchaseRequest }>("SELECT payload FROM alpha_exchange.purchase_requests WHERE id=$1", [id])).rows[0].payload;
    patch(request);
    await tx.query(`UPDATE alpha_exchange.purchase_requests SET trade_id=$2,listing_id=$3,seller_id=$4,buyer_id=$5,status=$6,
      timed_out_at=$7::timestamptz,completed_at=$8::timestamptz,created_at=$9::timestamptz,updated_at=$10::timestamptz,payload=$11::jsonb WHERE id=$1`,
    [id, request.tradeId ?? null, request.listingId, request.sellerId, request.buyerId, request.status, request.timedOutAt ?? null,
      request.completedAt ?? null, request.createdAt, request.updatedAt, JSON.stringify(request)]);
  });
}
async function insertRequest(request: PurchaseRequest) {
  await store.transaction(tx => tx.query(`INSERT INTO alpha_exchange.purchase_requests
    VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7::timestamptz,$8::timestamptz,99,$9::jsonb)`,
  [request.id, request.tradeId, request.listingId, request.sellerId, request.buyerId, request.status, request.createdAt, request.updatedAt, JSON.stringify(request)]));
}
async function insertCommission(sellerId: string, requestId?: string) {
  const row: CommissionRecord = { id: "initial-test-commission", sellerId, purchaseRequestId: requestId, source: "admin_manual",
    rate: 0.01, grossAmount: 1, commissionAmount: 0.01, paymentStatus: "pending", createdAt: fixture.at, updatedAt: fixture.at };
  await store.transaction(tx => tx.query(`INSERT INTO alpha_exchange.commissions VALUES ($1,$2,NULL,$3,NULL,$4,NULL,$5::timestamptz,$5::timestamptz,0,$6::jsonb)`,
    [row.id, requestId ?? null, sellerId, row.paymentStatus, fixture.at, JSON.stringify(row)]));
}
async function insertEnforcement(sellerId: string) {
  const row: MarketplaceEnforcementRecord = { id: "initial-test-enforcement", sellerId, violationNumber: 1, status: "active",
    feeAmount: 1, feeCurrency: "USDT", reason: "Synthetic retained restriction", issuedByUserId: fixture.otherSellerId,
    issuedAt: fixture.at, createdAt: fixture.at, updatedAt: fixture.at };
  await store.transaction(tx => tx.query(`INSERT INTO alpha_exchange.marketplace_enforcement_records
    VALUES ($1,$2,$3,1,$4::timestamptz,NULL,$4::timestamptz,$4::timestamptz,0,$5::jsonb)`, [row.id, sellerId, row.status, fixture.at, JSON.stringify(row)]));
}

describe("separate initial seller acceptance SQL participant", () => {
  it.each(["absent", "pending"] as const)("commits the real planner decision and independent pause with %s projection", async projection => {
    if (projection === "pending") await setup("Bank Transfer", projection);
    const before = await footprint(), statements: string[] = [];
    const result = await store.transaction(async owner => {
      const tx: WalletSql = { query: (sql, params) => { statements.push(sql); return owner.query(sql, params); }, exec: sql => owner.exec(sql) };
      return accept(tx);
    });
    const after = await footprint();
    const request = after.canonical.purchase_requests.find(row => row.id === fixture.requestId)!;
    const listing = after.canonical.listings.find(row => row.id === fixture.listingId)!;
    expect(request.status).toBe("accepted"); expect(request.trade_id).toBe(fixture.tradeId);
    expect(request.payload).toEqual(result.request);
    expect(result.request).toMatchObject({ usdtAmount: "200", fiatAmount: "646.40", pricePerUsdt: "3.20", tradeCreatedAt: new Date(fixture.acceptedAtMs).toISOString() });
    expect(result.request.timeline[0]).toEqual(fixture.initialRequest.timeline[0]);
    expect(result.request.timeline).toHaveLength(2);
    expect(listing.status).toBe("matched"); expect(listing.active_trade_request_id).toBe(fixture.requestId);
    expect(result.listing.availableAmount).toBe("500");
    expect(after.canonical.trades).toHaveLength(1);
    expect(after.canonical.trades[0]).toMatchObject({ id: fixture.tradeId, purchase_request_id: fixture.requestId, status: "accepted", payload: result.trade });
    if (projection === "pending") expect(after.canonical.trades[0].sort_index).toBe(31);
    expect(after.canonical.notifications.map(row => row.payload)).toEqual(result.notifications);
    expect(after.canonical.audit_logs.map(row => row.payload)).toEqual(result.auditLogs);
    expect(after.canonical.runtime_meta[0].version).toBe(8);
    for (const table of ["users", "commissions", "marketplace_enforcement_records", "evidence", "disputes"]) expect(after.canonical[table]).toEqual(before.canonical[table]);
    for (const table of ["purchase_requests", "listings"]) {
      const id = table === "purchase_requests" ? fixture.requestId : fixture.listingId;
      expect(after.canonical[table].filter(row => row.id !== id)).toEqual(before.canonical[table].filter(row => row.id !== id));
      expect(after.canonical[table].find(row => row.id === id)?.sort_index).toBe(before.canonical[table].find(row => row.id === id)?.sort_index);
    }
    expect(after.wallet.revision).toBe(before.wallet.revision + 1);
    expect(after.wallet.state.haltReason).toBeTruthy(); expect(after.wallet.state.trades.size).toBe(0);
    expect(balance(after.wallet.state, TRON, `listing:${fixture.listingId}`)).toBe(parseUnits("500", 6));
    expect(expectedCustody(after.wallet.state, TRON)).toBe(parseUnits("500", 6));
    const requestLock = statements.findIndex(sql => sql.includes("pg_advisory_xact_lock(61422919"));
    const globalLock = statements.findIndex(sql => sql.includes("pg_advisory_xact_lock(61422917"));
    const runtimeLock = statements.findIndex(sql => /runtime_meta.*FOR UPDATE/i.test(sql));
    const read = statements.findIndex(sql => sql.includes("initial acceptance: authoritative read"));
    expect(requestLock).toBeLessThan(globalLock); expect(globalLock).toBeLessThan(runtimeLock); expect(runtimeLock).toBeLessThan(read);
    expect(statements.some(sql => /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(sql))).toBe(false);
    expect(statements.some(sql => /(?:INSERT INTO|UPDATE) alpha_exchange\.trades/i.test(sql))).toBe(true);
    expect(statements.some(sql => /(?:UPDATE|DELETE FROM) alpha_exchange\.(notifications|audit_logs)/i.test(sql))).toBe(false);
    result.request.usdtAmount = "999"; result.listing.availableAmount = "0";
    expect(await footprint()).toEqual(after);
  }, TIMEOUT);

  it("requires seller Face-to-Face consent and retains canonical principal", async () => {
    await setup("Face-to-Face", "pending");
    const before = await footprint();
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId },
      () => ({ ...decision(), safetyAcknowledged: undefined })))).rejects.toThrow("consent");
    expect(await footprint()).toEqual(before);
    const result = await store.transaction(tx => accept(tx));
    expect(result.request.sellerSafetyAcknowledged).toBe(true); expect(result.listing.availableAmount).toBe("500");
  }, TIMEOUT);

  it("rolls back all actual canonical effects and pause when the caller fails after persistence", async () => {
    const before = await footprint(); let persisted = false;
    await expect(store.transaction(async tx => {
      await accept(tx);
      persisted = (await tx.query<{ status: string }>("SELECT status FROM alpha_exchange.trades WHERE id=$1", [fixture.tradeId])).rows[0].status === "accepted";
      throw new Error("Synthetic owner failure after persistence");
    })).rejects.toThrow("Synthetic owner failure");
    expect(persisted).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rejects a later call instead of inventing an acceptance idempotency receipt", async () => {
    await store.transaction(tx => accept(tx));
    const committed = await footprint();
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId },
      () => ({ ...decision(), acceptedAtMs: fixture.acceptedAtMs + 1 }))))
      .rejects.toThrow("pending request");
    expect(await footprint()).toEqual(committed);
  }, TIMEOUT);

  it.each([
    ["caller role substitution", { actorUserId: "fixture-buyer" }],
    ["new trade identity", { tradeId: "replacement-trade" }],
    ["different request", { requestId: "another-request" }],
    ["old clock", { acceptedAtMs: FIXTURE_TIME }],
    ["arbitrary lifecycle fields", { status: "completed" }],
    ["caller financial replacement", { usdtAmount: "300" }],
  ])("poisons a swallowed %s decision after a real companion write", async (_label, changes) => {
    const before = await footprint(); let rejected = false;
    await expect(store.transaction(async tx => {
      try {
        await mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => {
          await pause(tx); return { ...decision(), ...changes } as DevelopmentInitialAcceptanceDecision;
        });
      } catch { rejected = true; }
    })).rejects.toThrow();
    expect(rejected).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("clones the decision and constructs effects independently of retained callback objects", async () => {
    let retainedView!: DevelopmentInitialAcceptanceMarketplace, retainedDecision!: DevelopmentInitialAcceptanceDecision;
    let intercepted = false;
    const result = await store.transaction(async owner => {
      const tx: WalletSql = { async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (sql.includes("initial acceptance: request persistence")) {
          intercepted = true;
          retainedView.purchaseRequests[0].usdtAmount = "999";
          (retainedDecision as { actorUserId: string }).actorUserId = fixture.buyerId;
        }
        return owner.query<Row>(sql, params);
      }, exec: sql => owner.exec(sql) };
      return mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async view => {
        retainedView = view; retainedDecision = { ...(await planned(tx, view)).canonicalAcceptance }; return retainedDecision;
      });
    });
    expect(intercepted).toBe(true); expect(result.request.usdtAmount).toBe("200");
    expect(result.request.timeline.at(-1)?.actorUserId).toBe(fixture.sellerId);
  }, TIMEOUT);

  it.each(["accepted", "completed"] as const)("reads the buyer's %s history across another seller before deciding", async status => {
    await patchRequest(fixture.buyerHistoryRequestId, request => { request.status = status; });
    const before = await footprint(); let observed = false;
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async view => {
      observed = view.purchaseRequests.some(request => request.id === fixture.buyerHistoryRequestId && request.sellerId === fixture.otherSellerId);
      return (await planned(tx, view)).canonicalAcceptance;
    }))).rejects.toThrow(status === "accepted" ? "active trade" : "review");
    expect(observed).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["seller", "buyer"] as const)("reads and refuses the %s's outstanding seller commission", async party => {
    const id = party === "seller" ? fixture.sellerId : fixture.buyerId;
    await insertCommission(id); const before = await footprint(); let observed = false;
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async view => {
      observed = view.commissionRecords.some(row => row.sellerId === id); return (await planned(tx, view)).canonicalAcceptance;
    }))).rejects.toThrow("commission");
    expect(observed).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("reads enforcement for both parties while applying the seller restriction to the actual seller", async () => {
    await insertEnforcement(fixture.buyerId);
    let observed = false;
    await store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async view => {
      observed = view.marketplaceEnforcementRecords.some(row => row.sellerId === fixture.buyerId);
      return (await planned(tx, view)).canonicalAcceptance;
    }));
    expect(observed).toBe(true);
  }, TIMEOUT);

  it("does not omit target-listing inventory whose two parties differ from the target", async () => {
    await insertRequest({ ...structuredClone(fixture.initialRequest), id: "hidden-listing-reservation", tradeId: "hidden-trade",
      sellerId: fixture.otherSellerId, buyerId: fixture.otherBuyerId, status: "accepted" });
    const before = await footprint(); let observed = false;
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async view => {
      observed = view.purchaseRequests.some(row => row.id === "hidden-listing-reservation"); return (await planned(tx, view)).canonicalAcceptance;
    }))).rejects.toThrow("another seller");
    expect(observed).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("detects a duplicated preallocated trade identity outside the target parties and listing", async () => {
    await insertRequest({ ...structuredClone(fixture.initialRequest), id: "hidden-trade-collision", listingId: fixture.otherListingId,
      sellerId: fixture.otherSellerId, buyerId: fixture.otherBuyerId });
    const before = await footprint(); let called = false;
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, () => {
      called = true; return decision();
    }))).rejects.toThrow("duplicated");
    expect(called).toBe(false); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each([
    ["normalized request status", "UPDATE alpha_exchange.purchase_requests SET status='accepted' WHERE id=$1"],
    ["normalized user role", "UPDATE alpha_exchange.users SET role='owner' WHERE id=$1"],
    ["sub-millisecond timestamp mismatch", "UPDATE alpha_exchange.purchase_requests SET updated_at=updated_at+interval '1 microsecond' WHERE id=$1"],
    ["lossy JSON integer", "UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{privatePrecisionProbe}','9007199254740993'::jsonb) WHERE id=$1"],
    ["excess quantity precision", "UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{usdtAmount}','\"200.0000001\"'::jsonb) WHERE id=$1"],
  ])("rejects %s before exposing a decision basis", async (_label, sql) => {
    await store.transaction(tx => tx.query(sql, [sql.includes("alpha_exchange.users") ? fixture.sellerId : fixture.requestId]));
    const before = await footprint(); let called = false;
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, () => {
      called = true; return decision();
    }))).rejects.toThrow();
    expect(called).toBe(false); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("uses exact canonical request identity and never accepts a trade alias", async () => {
    const before = await footprint();
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.tradeId }, decision)))
      .rejects.toThrow("exact canonical request");
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("refuses direct decisions that have lost frozen bank instructions", async () => {
    await patchRequest(fixture.requestId, request => { delete request.sellerBankAccountSnapshot; });
    const before = await footprint();
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, decision)))
      .rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("surfaces a valid normalized dispute and denies prior dispute history", async () => {
    const dispute = { id: "initial-dispute", purchaseRequestId: fixture.requestId, tradeId: fixture.tradeId,
      sellerId: fixture.sellerId, buyerId: fixture.buyerId, status: "resolved", createdAt: fixture.at, updatedAt: fixture.at };
    await store.transaction(tx => tx.query(`INSERT INTO alpha_exchange.disputes VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$7::timestamptz,0,$8::jsonb)`,
      [dispute.id, dispute.tradeId, dispute.purchaseRequestId, dispute.sellerId, dispute.buyerId, dispute.status, fixture.at, JSON.stringify(dispute)]));
    let observed = false; const before = await footprint();
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, view => {
      observed = view.disputes[0]?.id === dispute.id; return decision();
    }))).rejects.toThrow("lifecycle progress");
    expect(observed).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rejects a physical pending projection whose history differs from its request", async () => {
    await setup("Bank Transfer", "pending");
    await store.transaction(tx => tx.query("UPDATE alpha_exchange.trades SET payload=jsonb_set(payload,'{timeline}','[]'::jsonb) WHERE id=$1", [fixture.tradeId]));
    const before = await footprint();
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, decision)))
      .rejects.toThrow("projection differs");
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rejects canonical writes performed by the callback instead of allowing them into its decision basis", async () => {
    const before = await footprint();
    await expect(store.transaction(tx => mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => {
      await pause(tx);
      await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{buyerNotes}','\"changed inside callback\"'::jsonb) WHERE id=$1", [fixture.requestId]);
      return decision();
    }))).rejects.toThrow("decision basis changed");
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it.each(["before", "during"] as const)("refuses the frozen cohort/recovery namespace installed %s the decision", async when => {
    if (when === "before") await store.transaction(tx => tx.exec("CREATE SCHEMA alpha_wallet_marketplace_simulation"));
    const before = await footprint();
    await expect(store.transaction(async tx => {
      await pause(tx);
      try {
        await mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => {
          if (when === "during") await tx.exec("CREATE SCHEMA alpha_wallet_marketplace_simulation");
          return decision();
        });
      } catch { /* A caught participant rejection must still abort its owner. */ }
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rolls back a caught failure after the callback disables the transaction guard", async () => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      try {
        await mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => {
          await pause(tx); await tx.exec("SET LOCAL alpha_wallet.development_schema='disabled'"); return decision();
        });
      } catch { await tx.exec("SET LOCAL alpha_wallet.development_schema='simulation-only'"); }
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("rolls back a swallowed runtime change even when the outer caller restores its environment", async () => {
    const before = await footprint();
    await expect(store.transaction(async tx => {
      try {
        await mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx, requestId: fixture.requestId }, async () => {
          await pause(tx); vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", "true"); return decision();
        });
      } catch { vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", undefined); }
    })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("does not overwrite an existing deterministic notification if a partial outside record collides", async () => {
    let notification!: AlphaExchangeNotification;
    await expect(store.transaction(async tx => {
      notification = (await accept(tx, false)).notifications[0]; throw new Error("Capture only, roll back every effect");
    })).rejects.toThrow("Capture only");
    const preserved = { ...notification, title: "Existing immutable outside record" };
    await store.transaction(tx => tx.query("INSERT INTO alpha_exchange.notifications VALUES ($1,$2,$3,false,$4::timestamptz,99,$5::jsonb)",
      [preserved.id, preserved.userId, preserved.category, preserved.createdAt, JSON.stringify(preserved)]));
    const before = await footprint(); let tradePersisted = false;
    await expect(store.transaction(async owner => {
      const tx: WalletSql = { async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await owner.query<Row>(sql, params);
        if (/INSERT INTO alpha_exchange\.trades/.test(sql)) tradePersisted = true;
        return result;
      }, exec: sql => owner.exec(sql) };
      await accept(tx);
    })).rejects.toThrow();
    expect(tradePersisted).toBe(true); expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("refuses a retained transaction handle after its owner has committed", async () => {
    let retained!: WalletSql;
    await store.transaction(async tx => { retained = tx; });
    const before = await footprint();
    await expect(mutateDevelopmentInitialAcceptanceInTransaction({ mode: MODE, tx: retained, requestId: fixture.requestId }, decision))
      .rejects.toThrow("no longer active");
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);

  it("refuses fixture creation over an existing canonical schema", async () => {
    const before = await footprint();
    await expect(store.transaction(tx => createInitialAcceptanceFixture({ mode: MODE, tx }))).rejects.toThrow("existing canonical schema");
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);
});
