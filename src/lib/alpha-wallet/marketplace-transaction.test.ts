// @vitest-environment node
// Real focused marketplace SQL and real wallet commands in one disposable PGlite
// transaction. Native PostgreSQL waiting/snapshot/COMMIT faults have their own CLI.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlphaExchangeRepository, mutateDevelopmentFocusedTradeInTransaction } from "@/lib/alpha-exchange-repository";
import type { AlphaExchangeDb, AlphaExchangeNotification, AuditLogEntry, PurchaseRequest } from "@/types/alpha-exchange";
import { BUYER, FIXTURE_TIME, TRON, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { parseUnits } from "./amounts";
import { createDurableWallet, initializeDurableWallet, walletCommand, type DurableWallet } from "./durable";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import { createMarketplaceTransactionFixture } from "./marketplace-transaction-fixture";
import { simulatedDestination } from "./sandbox";

// Any accidental production pool discovery is a failing test, not a fallback.
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden in this fixture"); } }));

const TIMEOUT = 90_000;
let directory: string;
let store: WalletStore;
let wallet: DurableWallet;
let fixture: Awaited<ReturnType<typeof createMarketplaceTransactionFixture>>;

/** The real outer store owns every transaction boundary; this adapter owns none. */
function boundWallet(tx: WalletSql) {
  const bound: WalletStore = { transaction: work => work(tx), close: async () => undefined };
  return createDurableWallet({ mode: "simulation-only", store: bound, clock: () => FIXTURE_TIME });
}

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-marketplace-"));
  store = await createFileWalletStore({ mode: "simulation-only", dataDir: directory });
  await initializeDurableWallet(store);
  wallet = createDurableWallet({ store, mode: "simulation-only", clock: () => FIXTURE_TIME });
  fixture = await store.transaction(tx => createMarketplaceTransactionFixture({ mode: "simulation-only", tx }));
}, TIMEOUT);

afterEach(async () => {
  try { await store?.close(); }
  finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

function reserve() {
  return walletCommand("reserveTrade", BUYER, "marketplace-fixture-reservation", {
    id: fixture.tradeId, listingId: fixture.listingId, amount: "200", destination: simulatedDestination(TRON, BUYER.id),
  });
}

function target(snapshot: AlphaExchangeDb) {
  return snapshot.purchaseRequests.find(row => row.id === fixture.requestId)!;
}

function note(snapshot: AlphaExchangeDb, value = "committed synthetic note") {
  Object.assign(target(snapshot), { buyerNotes: value, updatedAt: new Date(FIXTURE_TIME + 1000).toISOString() });
  return snapshot;
}

function notification(id = "marketplace-fixture-notification"): AlphaExchangeNotification {
  return { id, userId: fixture.buyerId, category: "trade", title: "Synthetic fixture update", message: "Isolated transaction proof",
    isRead: false, relatedRequestId: fixture.requestId, relatedTradeId: fixture.tradeId, relatedListingId: fixture.listingId, createdAt: fixture.at };
}

function audit(id = "marketplace-fixture-audit"): AuditLogEntry {
  return { id, actorUserId: fixture.buyerId, action: "purchase_request_submitted", purchaseRequestId: fixture.requestId,
    listingId: fixture.listingId, details: "Synthetic fixture event, not a live action", createdAt: fixture.at };
}

async function footprint() {
  return store.transaction(async tx => ({
    wallet: await boundWallet(tx).snapshot(),
    requests: (await tx.query<{ id: string; payload: PurchaseRequest }>("SELECT id, payload FROM alpha_exchange.purchase_requests ORDER BY id")).rows,
    listings: (await tx.query("SELECT id, payload FROM alpha_exchange.listings ORDER BY id")).rows,
    version: (await tx.query<{ version: string }>("SELECT version::text FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0].version,
    notifications: (await tx.query<{ payload: AlphaExchangeNotification }>("SELECT payload FROM alpha_exchange.notifications ORDER BY id")).rows,
    audits: (await tx.query<{ payload: AuditLogEntry }>("SELECT payload FROM alpha_exchange.audit_logs ORDER BY id")).rows,
  }));
}

async function mutate(apply: (snapshot: AlphaExchangeDb) => AlphaExchangeDb | Promise<AlphaExchangeDb>, requestId = fixture.requestId) {
  return store.transaction(tx => mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId }, apply));
}

describe("actual focused marketplace participant in a shared simulation transaction", () => {
  it("commits the real target, append-only events and a wallet reservation together; exact retry is a no-op", async () => {
    await durableFixture(wallet).fundedListing("500", fixture.listingId);
    const initial = await footprint();
    const statements: string[] = [];
    const run = () => store.transaction(async ownerTx => {
      const tx: WalletSql = {
        query: (sql, parameters) => { statements.push(sql); return ownerTx.query(sql, parameters); },
        exec: sql => { statements.push(sql); return ownerTx.exec(sql); },
      };
      let receipt: Awaited<ReturnType<DurableWallet["execute"]>> | undefined;
      const snapshot = await mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.tradeId }, async current => {
        receipt = await boundWallet(tx).execute(reserve());
        if (!receipt.replayed) {
          note(current);
          current.notifications.push(notification());
          current.auditLogs.push(audit());
        }
        return current;
      });
      return { receipt: receipt!, snapshot };
    });
    const first = await run();
    const committed = await footprint();
    expect(first.receipt.replayed).toBe(false);
    expect(target(first.snapshot).buyerNotes).toBe("committed synthetic note");
    expect(committed.requests.find(row => row.id === fixture.requestId)?.payload.buyerNotes).toBe("committed synthetic note");
    expect(committed.requests.find(row => row.id === fixture.otherRequestId)).toEqual(initial.requests.find(row => row.id === fixture.otherRequestId));
    expect(committed.listings).toEqual(initial.listings);
    expect(committed.version).toBe("8");
    expect(committed.notifications.map(row => row.payload)).toEqual([notification()]);
    expect(committed.audits.map(row => row.payload)).toEqual([audit()]);
    expect(balance(committed.wallet.state, TRON, `listing:${fixture.listingId}`)).toBe(parseUnits("300", 6));
    expect(balance(committed.wallet.state, TRON, `trade:${fixture.tradeId}`)).toBe(parseUnits("200", 6));
    expect(expectedCustody(committed.wallet.state, TRON)).toBe(parseUnits("500", 6));
    assertLedgerInvariants(committed.wallet.state);
    expect(statements.some(sql => /jsonb_build_object/.test(sql) && /as target_id/.test(sql))).toBe(true);
    expect(statements.some(sql => /alpha_exchange\.runtime_meta.*for update/i.test(sql))).toBe(true);
    expect(statements.some(sql => /^\s*(begin|commit|rollback|savepoint)\b/i.test(sql))).toBe(false);
    const replay = await run();
    expect(replay.receipt).toEqual({ ...first.receipt, replayed: true });
    expect(await footprint()).toEqual(committed);
    // Returned objects are values, not a writable handle surviving the owner.
    target(first.snapshot).buyerNotes = "escaped local edit";
    expect(await footprint()).toEqual(committed);
  }, TIMEOUT);

  it("rolls back real marketplace and wallet rows when their single outer owner fails after persistence", async () => {
    await durableFixture(wallet).fundedListing("500", fixture.listingId);
    const initial = await footprint();
    await expect(store.transaction(async tx => {
      await mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.requestId }, async snapshot => {
        await boundWallet(tx).execute(reserve());
        snapshot.notifications.push(notification());
        return note(snapshot);
      });
      throw new Error("synthetic owner failure after both writes");
    })).rejects.toThrow("synthetic owner failure after both writes");
    expect(await footprint()).toEqual(initial);
  }, TIMEOUT);

  it("seals the validated write set against retained callback references during awaited persistence", async () => {
    let retained!: AlphaExchangeDb;
    let changedDuringPersistence = false;
    await store.transaction(async owner => {
      const tx: WalletSql = {
        async query<Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]) {
          if (sql.startsWith("update alpha_exchange.purchase_requests")) {
            changedDuringPersistence = true;
            target(retained).buyerNotes = "late escaped mutation";
            retained.notifications[0].userId = "late outsider";
            retained.auditLogs[0].purchaseRequestId = fixture.otherRequestId;
          }
          return owner.query<Row>(sql, parameters);
        },
        exec: sql => owner.exec(sql),
      };
      await mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.requestId }, snapshot => {
        retained = note(snapshot);
        snapshot.notifications.push(notification()); snapshot.auditLogs.push(audit());
        return snapshot;
      });
    });
    expect(changedDuringPersistence).toBe(true);
    const committed = await footprint();
    expect(committed.requests.find(row => row.id === fixture.requestId)?.payload.buyerNotes).toBe("committed synthetic note");
    expect(committed.notifications.map(row => row.payload)).toEqual([notification()]);
    expect(committed.audits.map(row => row.payload)).toEqual([audit()]);
  }, TIMEOUT);

  it("poisons a certified transaction on an apply error even if its owner catches the original exception", async () => {
    await durableFixture(wallet).fundedListing("500", fixture.listingId);
    const initial = await footprint();
    const original = new Error("synthetic semantic failure after wallet projection write");
    let caught: unknown;
    await expect(store.transaction(async tx => {
      try {
        await mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.requestId }, async snapshot => {
          await boundWallet(tx).execute(reserve());
          note(snapshot);
          throw original;
        });
      } catch (error) { caught = error; }
      return "caller attempted to swallow a failed shared decision";
    })).rejects.toThrow(/division by zero|transaction.*aborted/i);
    expect(caught).toBe(original);
    expect(await footprint()).toEqual(initial);
  }, TIMEOUT);

  it("rolls back prior focused/event/wallet writes on an actual final SQL failure", async () => {
    await durableFixture(wallet).fundedListing("500", fixture.listingId);
    const initial = await footprint();
    await expect(store.transaction(async tx => {
      const failed: WalletSql = {
        query: (sql, parameters) => /^update alpha_exchange\.runtime_meta/.test(sql)
          ? tx.query("SELECT 1 / 0 /* isolated fault after preceding real writes */") : tx.query(sql, parameters),
        exec: sql => tx.exec(sql),
      };
      await mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx: failed, requestId: fixture.requestId }, async snapshot => {
        await boundWallet(tx).execute(reserve());
        snapshot.notifications.push(notification()); snapshot.auditLogs.push(audit());
        return note(snapshot);
      });
    })).rejects.toThrow("division by zero");
    expect(await footprint()).toEqual(initial);
  }, TIMEOUT);

  it("also poisons a verified transaction when its local simulation guard changes after wallet writes", async () => {
    await durableFixture(wallet).fundedListing("500", fixture.listingId);
    const initial = await footprint();
    let caught: unknown;
    await expect(store.transaction(async tx => {
      try {
        await mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.requestId }, async snapshot => {
          await boundWallet(tx).execute(reserve());
          await tx.exec("SET LOCAL alpha_wallet.development_schema = 'disabled'");
          return note(snapshot);
        });
      } catch (error) { caught = error; }
    })).rejects.toThrow(/division by zero|transaction.*aborted/i);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("writable SERIALIZABLE simulation transaction");
    expect(await footprint()).toEqual(initial);
  }, TIMEOUT);

  it("refuses commit after a swallowed runtime rejection even when the caller restores its environment", async () => {
    await durableFixture(wallet).fundedListing("500", fixture.listingId);
    const initial = await footprint();
    let caught: unknown, reservationPersisted = false;
    await expect(store.transaction(async tx => {
      try {
        await mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.requestId }, async snapshot => {
          await boundWallet(tx).execute(reserve());
          const current = await boundWallet(tx).snapshot();
          reservationPersisted = balance(current.state, TRON, `trade:${fixture.tradeId}`) === parseUnits("200", 6);
          snapshot.notifications.push(notification());
          note(snapshot);
          vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", "true");
          return snapshot;
        });
      } catch (error) { caught = error; }
      finally { vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", undefined); }
      return "caller attempted to commit after restoring runtime settings";
    })).rejects.toThrow("cannot enable mainnet or signing");
    expect(reservationPersisted).toBe(true);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("cannot enable mainnet or signing");
    expect(await footprint()).toEqual(initial);
  }, TIMEOUT);

  it("freezes canonical identity, lifecycle evidence, other requests and every read-only collection", async () => {
    const initial = await footprint();
    const changes: Array<(snapshot: AlphaExchangeDb) => void> = [
      snapshot => { target(snapshot).id = "other-id"; },
      snapshot => { target(snapshot).tradeId = "other-trade"; },
      snapshot => { target(snapshot).status = "completed"; },
      snapshot => { target(snapshot).buyerId = "another-buyer"; },
      snapshot => { target(snapshot).listingId = "another-listing"; },
      snapshot => { target(snapshot).network = "ERC20"; },
      snapshot => { target(snapshot).buyerReceivingWalletAddress = "changed-destination"; },
      snapshot => { delete target(snapshot).feePolicyVersion; },
      snapshot => { target(snapshot).sellerBankAccountSnapshot!.accountNumber = "123456"; },
      snapshot => { target(snapshot).completedAt = fixture.at; },
      snapshot => { target(snapshot).completionReceipt = { injected: true } as unknown as PurchaseRequest["completionReceipt"]; },
      snapshot => { Object.assign(target(snapshot), { futureServerOwnedBinding: "must be immutable by default" }); },
      snapshot => { snapshot.purchaseRequests.find(row => row.id === fixture.otherRequestId)!.buyerNotes = "other request"; },
      snapshot => { snapshot.purchaseRequests.reverse(); },
      snapshot => { snapshot.purchaseRequests.push({ ...fixture.initialRequest, id: "added-request" }); },
      snapshot => { snapshot.users[0].fullName = "normalized unrelated user"; },
      snapshot => { snapshot.marketplaceListings[0].availableAmount = "1"; },
      snapshot => { snapshot.activityLog.push({ id: "unscoped-activity", userId: fixture.buyerId, category: "trade", title: "No request binding", details: "", createdAt: fixture.at }); },
    ];
    for (const change of changes) {
      await expect(mutate(snapshot => { change(snapshot); return snapshot; })).rejects.toThrow(/cannot change|cannot add, remove/);
      expect(await footprint()).toEqual(initial);
    }
  }, TIMEOUT);

  it("requires scoped, unique append identities and a corresponding target change", async () => {
    const initial = await footprint();
    const cases: Array<(snapshot: AlphaExchangeDb) => void> = [
      snapshot => { snapshot.notifications.push({ ...notification(), relatedRequestId: fixture.otherRequestId }); },
      snapshot => { snapshot.notifications.push({ ...notification(), userId: "outsider" }); },
      snapshot => { snapshot.notifications.push({ ...notification(), relatedTradeId: "other-trade" }); },
      snapshot => { snapshot.notifications.push({ ...notification(), relatedListingId: "other-listing" }); },
      snapshot => { snapshot.notifications.push(notification(), notification()); },
      snapshot => { snapshot.auditLogs.push({ ...audit(), purchaseRequestId: fixture.otherRequestId }); },
      snapshot => { snapshot.auditLogs.push({ ...audit(), actorUserId: "outsider" }); },
      snapshot => { snapshot.auditLogs.push(audit(), audit()); },
    ];
    for (const change of cases) {
      await expect(mutate(snapshot => { note(snapshot); change(snapshot); return snapshot; })).rejects.toThrow(/must belong|unique/);
      expect(await footprint()).toEqual(initial);
    }
    await expect(mutate(snapshot => { snapshot.notifications.push(notification()); return snapshot; })).rejects.toThrow("without a target mutation");
    expect(await footprint()).toEqual(initial);
  }, TIMEOUT);

  it("uses INSERT-only event encoders, preventing an old notification or audit from being overwritten", async () => {
    await mutate(snapshot => { snapshot.notifications.push(notification()); snapshot.auditLogs.push(audit()); return note(snapshot); });
    const initial = await footprint();
    for (const collection of ["notifications", "auditLogs"] as const) {
      await expect(mutate(snapshot => {
        note(snapshot, "should roll back with duplicate event identity");
        if (collection === "notifications") snapshot.notifications.push({ ...notification(), message: "overwrite attempt" });
        else snapshot.auditLogs.push({ ...audit(), details: "overwrite attempt" });
        return snapshot;
      })).rejects.toMatchObject({ code: "23505" });
      expect(await footprint()).toEqual(initial);
    }
  }, TIMEOUT);

  it("retains actual buyer-review cleanup scope, and unchanged focused reads do not increment the version", async () => {
    const events: AlphaExchangeNotification[] = [
      { ...notification("review-target"), title: "Action required: Confirm USDT receipt" },
      { ...notification("review-other-request"), title: "Action required: Confirm USDT receipt", relatedRequestId: fixture.otherRequestId },
      { ...notification("review-other-party"), title: "Action required: Confirm USDT receipt", userId: fixture.sellerId },
      { ...notification("review-archived"), title: "Action required: Confirm USDT receipt", state: "archived" },
    ];
    await store.transaction(async tx => {
      for (const event of events) await tx.query("INSERT INTO alpha_exchange.notifications VALUES ($1,$2,$3,false,$4::timestamptz,0,$5::jsonb)", [event.id, event.userId, event.category, event.createdAt, JSON.stringify(event)]);
    });
    const initial = await footprint();
    await mutate(snapshot => snapshot, fixture.tradeId);
    expect(await footprint()).toEqual(initial);
    await mutate(snapshot => {
      target(snapshot).buyerReview = { reviewerUserId: fixture.buyerId, rating: 5, comment: "Synthetic review", createdAt: fixture.at };
      target(snapshot).updatedAt = fixture.at;
      return snapshot;
    });
    const after = await footprint();
    expect(after.notifications.filter(row => row.payload.isRead).map(row => row.payload.id)).toEqual(["review-target"]);
    expect(after.version).toBe("8");
    expect(after.wallet).toEqual(initial.wallet);
  }, TIMEOUT);

  it("rejects incorrect or ended transaction contexts before any canonical write or abort statement", async () => {
    const initial = await footprint();
    for (const setting of [
      "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
      "SET TRANSACTION READ ONLY",
      "SET LOCAL alpha_wallet.development_schema = 'disabled'",
    ]) {
      const statements: string[] = [];
      await expect(store.transaction(async owner => {
        await owner.exec(setting);
        const tx: WalletSql = { query: (sql, args) => { statements.push(sql); return owner.query(sql, args); }, exec: sql => owner.exec(sql) };
        return mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.requestId }, note);
      })).rejects.toThrow(/writable SERIALIZABLE|read-only/i);
      expect(statements.every(sql => sql.includes("transaction_isolation"))).toBe(true);
      expect(await footprint()).toEqual(initial);
    }
    let ended!: WalletSql;
    await store.transaction(async tx => { ended = tx; });
    await expect(mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx: ended, requestId: fixture.requestId }, note)).rejects.toThrow("no longer active");
    expect(await footprint()).toEqual(initial);
  }, TIMEOUT);

  it("detects autocommit-style identity drift and an identity switch across asynchronous apply", async () => {
    const initial = await footprint();
    for (const driftAfterApply of [false, true]) {
      const statements: string[] = [];
      let drift = !driftAfterApply;
      let calls = 0;
      let applyCalled = false;
      await expect(store.transaction(async owner => {
        const tx: WalletSql = {
          async query<Row extends Record<string, unknown>>(sql: string, parameters?: unknown[]) {
            statements.push(sql);
            const result = await owner.query<Row>(sql, parameters);
            // Every identity probe, including failure cleanup, must observe the
            // same simulated physical switch rather than only the full context read.
            if (sql.includes("txid_current()") && drift && ++calls > 1) {
              return { rows: result.rows.map(row => ({ ...row, transaction_id: "999999999" }) as Row) };
            }
            return result;
          },
          exec: sql => owner.exec(sql),
        };
        return mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.requestId }, async snapshot => {
          applyCalled = true;
          await Promise.resolve();
          drift = true; calls = 1;
          return note(snapshot);
        });
      })).rejects.toThrow("identity changed or ended");
      expect(applyCalled).toBe(driftAfterApply);
      expect(statements.some(sql => /^update|^insert|abort failed/i.test(sql) || sql.includes("abort failed"))).toBe(false);
      expect(await footprint()).toEqual(initial);
    }
  }, TIMEOUT);

  it("rejects disabled/hosted runtime before querying and refuses to recreate an existing fixture schema", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.stubEnv("NODE_ENV", "production");
    await expect(mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx: { query }, requestId: fixture.requestId }, note)).rejects.toThrow("local development or test");
    expect(query).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL", "1");
    await expect(mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx: { query }, requestId: fixture.requestId }, note)).rejects.toThrow("hosted");
    await expect(createMarketplaceTransactionFixture({ mode: "simulation-only", tx: { query, exec: vi.fn() } })).rejects.toThrow("hosted");
    expect(query).not.toHaveBeenCalled();
    vi.stubEnv("VERCEL", undefined);
    const initial = await footprint();
    await expect(store.transaction(tx => createMarketplaceTransactionFixture({ mode: "simulation-only", tx }))).rejects.toThrow("existing alpha_exchange schema");
    expect(await footprint()).toEqual(initial);
  }, TIMEOUT);

  it("keeps the old wrapper's read-only normalization behavior and transaction ownership", async () => {
    const snapshot = await mutate(current => current);
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("as target_id") ? [{ target_id: fixture.requestId, payload: structuredClone(snapshot) }] : [] }));
    const release = vi.fn();
    const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);
    vi.spyOn(repository, "ensureReady").mockResolvedValue(undefined);
    const result = await repository.mutateFocusedTrade(fixture.requestId, current => {
      current.users[0].fullName = "legacy normalization";
      return note(current);
    });
    expect(result?.users[0].fullName).toBe("legacy normalization");
    expect(query).toHaveBeenCalledWith("begin");
    expect(query).toHaveBeenCalledWith("commit");
    expect(release).toHaveBeenCalledWith(false);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("update alpha_exchange.purchase_requests"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("update alpha_exchange.users"))).toBe(false);
  }, TIMEOUT);
});
