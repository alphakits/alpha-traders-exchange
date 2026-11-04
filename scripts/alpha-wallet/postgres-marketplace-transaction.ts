/**
 * Actual focused-marketplace SQL and v1 wallet commands on ONE disposable
 * PostgreSQL transaction. This proves ownership/rollback mechanics only: the
 * fixture pairs harmless trade-note updates with explicit synthetic commands.
 * It does not implement accepted-amount resizing, enrollment, or a live route.
 *
 * NODE_ENV=test node --conditions=react-server --import tsx \
 *   scripts/alpha-wallet/postgres-marketplace-transaction.ts \
 *   --fresh-simulation-database --connection-string <explicit loopback alpha_wallet_dev_ URL>
 */
import { strict as assert } from "node:assert";
import { mutateDevelopmentFocusedTradeInTransaction } from "../../src/lib/alpha-exchange-repository";
import { createMarketplaceTransactionFixture } from "../../src/lib/alpha-wallet/marketplace-transaction-fixture";
import { createDurableWallet, initializeDurableWallet, walletCommand, type DurableExecution } from "../../src/lib/alpha-wallet/durable";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import type { WalletCommand } from "../../src/lib/alpha-wallet/commands";
import { assertLedgerInvariants, balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { parseUnits } from "../../src/lib/alpha-wallet/amounts";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import { BUYER, FIXTURE_TIME, SELLER, TRON, durableFixture } from "./durable-fixtures";

type MarketplaceFixture = Awaited<ReturnType<typeof createMarketplaceTransactionFixture>>;
let stage = "argument validation";
const USAGE = "Pass --fresh-simulation-database --connection-string <explicit loopback alpha_wallet_dev_ URL>. The database must exist and be empty. No environment database URL is read; no database is created or dropped.";

function argumentsOf(args: string[]) {
  assert.equal(args.length, 3, USAGE);
  const index = args.indexOf("--connection-string");
  assert(args.includes("--fresh-simulation-database") && index >= 0 && args[index + 1] && !args[index + 1].startsWith("--"), USAGE);
  return args[index + 1];
}

/** The outer WalletStore exclusively owns BEGIN, retry, COMMIT and release. */
function boundWallet(tx: WalletSql) {
  const store: WalletStore = { transaction: work => work(tx), close: async () => undefined };
  return createDurableWallet({ mode: "simulation-only", store, clock: () => FIXTURE_TIME });
}

async function freshDatabase(store: WalletStore) {
  await store.transaction(async tx => {
    const schemas = await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'");
    const publicRelations = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    const roles = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(schemas.rows.length, 0, "Existing schemas are never removed; use an empty isolated fixture database");
    assert.equal(publicRelations.rows[0]?.count, "0");
    assert.equal(roles.rows[0]?.permitted, true, "Fixture requires BYPASSRLS for the private simulation schema");
  });
}

function changedAt(fixture: MarketplaceFixture, seconds: number) {
  return new Date(Date.parse(fixture.at) + seconds * 1000).toISOString();
}

async function footprint(store: WalletStore, fixture: MarketplaceFixture) {
  return store.transaction(async tx => {
    const wallet = await boundWallet(tx).snapshot();
    const market = (await tx.query<{ payload: MarketplaceFixture["initialRequest"]; version: string; notifications: string; audits: string }>(`
      SELECT payload,
        (SELECT version::text FROM alpha_exchange.runtime_meta WHERE singleton=true) AS version,
        (SELECT count(*)::text FROM alpha_exchange.notifications) AS notifications,
        (SELECT count(*)::text FROM alpha_exchange.audit_logs) AS audits
      FROM alpha_exchange.purchase_requests WHERE id=$1`, [fixture.requestId])).rows[0];
    assert(market, "Original fixture request must remain present");
    return { wallet, market };
  });
}

async function committedPair(store: WalletStore, fixture: MarketplaceFixture, command: WalletCommand, note: string, seconds: number) {
  return store.transaction(async tx => {
    const before = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    let execution: DurableExecution<unknown> | undefined;
    await mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.requestId }, async snapshot => {
      execution = await boundWallet(tx).execute(command);
      // Replaying a wallet command is not permission to overwrite newer
      // marketplace metadata. Real proposal recovery needs its own receipt.
      if (!execution.replayed) {
        const request = snapshot.purchaseRequests.find(item => item.id === fixture.requestId)!;
        request.buyerNotes = note;
        request.updatedAt = changedAt(fixture, seconds);
      }
      assert.equal((await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid, before);
      return snapshot;
    });
    assert(execution);
    return execution;
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function waitForAdvisoryWait(store: WalletStore, pid: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const waiting = await store.transaction(async tx => (await tx.query<{ waiting: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS waiting", [pid],
    )).rows[0].waiting);
    if (waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Contender did not visibly wait for the held financial advisory lock");
}

async function staleSnapshotRace(observer: WalletStore, writerStore: WalletStore, contenderStore: WalletStore, fixture: MarketplaceFixture) {
  const held = deferred<void>(), release = deferred<void>(), started = deferred<void>();
  let writerPid = 0, contenderPid = 0, attempts = 0;
  const observedNotes: Array<string | undefined> = [];
  const writer = writerStore.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(61422917)");
    writerPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{buyerNotes}',to_jsonb($2::text)) WHERE id=$1", [fixture.requestId, "ordinary writer committed"]);
    await tx.query("UPDATE alpha_exchange.runtime_meta SET version=version+1, updated_at=now() WHERE singleton=true");
    held.resolve();
    await release.promise;
  });
  void writer.catch(error => held.reject(error));
  await held.promise;
  const command = walletCommand("createDepositIntent", SELLER, "native-marketplace-fresh-snapshot", { id: "native-marketplace-fresh-snapshot", assetId: TRON, purpose: "commission" });
  const contender = contenderStore.transaction(async tx => {
    attempts++;
    // Deliberately establish the old SERIALIZABLE snapshot while the other
    // writer is uncommitted. The runtime_meta fence must force a whole retry.
    const row = (await tx.query<{ pid: number; version: string }>("SELECT pg_backend_pid() AS pid, version::text FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0];
    contenderPid = row.pid;
    if (attempts === 1) started.resolve();
    return mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.requestId }, async snapshot => {
      const request = snapshot.purchaseRequests.find(item => item.id === fixture.requestId)!;
      observedNotes.push(request.buyerNotes);
      assert.equal(request.buyerNotes, "ordinary writer committed");
      await boundWallet(tx).execute(command);
      request.buyerNotes = "whole decision used fresh state";
      request.updatedAt = changedAt(fixture, 4);
      return snapshot;
    });
  });
  // Observe rejection immediately, including while the controller waits for
  // its snapshot barrier, and release the first transaction on every exit.
  void contender.catch(error => started.reject(error));
  try {
    await started.promise;
    assert.notEqual(writerPid, contenderPid);
    await waitForAdvisoryWait(observer, contenderPid);
    release.resolve();
    await Promise.all([writer, contender]);
  } finally {
    release.resolve();
    await Promise.allSettled([writer, contender]);
  }
  assert(attempts >= 2, "A genuine SERIALIZABLE retry must rerun the entire callback");
  assert.deepEqual(observedNotes, ["ordinary writer committed"]);
  return { attempts, distinctBackends: true, advisoryWaitObserved: true, authoritativeReadAfterRetry: true };
}

async function verify(connectionString: string) {
  let store: WalletStore | undefined, writer: WalletStore | undefined, contender: WalletStore | undefined;
  const checks: string[] = [];
  let report: Record<string, unknown> | undefined;
  try {
    stage = "explicit fresh fixture validation";
    store = await createPostgresWalletStore({ mode: "simulation-only", connectionString });
    await freshDatabase(store);
    await initializeDurableWallet(store);
    const fixture = await store.transaction(tx => createMarketplaceTransactionFixture({ mode: "simulation-only", tx }));
    const wallet = createDurableWallet({ mode: "simulation-only", store, clock: () => FIXTURE_TIME });
    const setup = durableFixture(wallet);
    await setup.fundedListing("500", fixture.listingId);
    const reserve = (id: string, amount: string) => walletCommand("reserveTrade", BUYER, id, {
      id, listingId: fixture.listingId, amount, destination: simulatedDestination(TRON, BUYER.id),
    });

    stage = "one transaction commits actual marketplace SQL and wallet reservation";
    const original = await footprint(store, fixture);
    const committed = await committedPair(store, fixture, reserve("native-shared-reservation", "200"), "native shared commit", 1);
    assert.equal(committed.replayed, false);
    const afterCommit = await footprint(store, fixture);
    assert.equal(afterCommit.market.payload.buyerNotes, "native shared commit");
    assert.equal(BigInt(afterCommit.market.version), BigInt(original.market.version) + BigInt(1));
    assert.equal(afterCommit.wallet.revision, original.wallet.revision + 1);
    assert.equal(balance(afterCommit.wallet.state, TRON, "trade:native-shared-reservation"), parseUnits("200", 6));
    checks.push("One explicit SERIALIZABLE backend commits the actual focused trade-note update and a 200-USDT synthetic wallet reservation together");

    stage = "caught callback failure cannot commit prior wallet writes";
    let rejectionCaught = false;
    await assert.rejects(store.transaction(async tx => {
      try {
        await mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx, requestId: fixture.requestId }, async snapshot => {
          await boundWallet(tx).execute(reserve("native-rejected-before-market", "100"));
          snapshot.purchaseRequests.find(item => item.id === fixture.requestId)!.buyerNotes = "must roll back";
          throw new Error("synthetic business rejection after wallet write");
        });
      } catch (error) {
        assert.match(error instanceof Error ? error.message : "", /synthetic business rejection/);
        rejectionCaught = true;
      }
      // Even a caller mistakenly swallowing this error must not commit the
      // already-written wallet command without the marketplace write.
    }));
    assert.equal(rejectionCaught, true);
    assert.deepEqual(await footprint(store, fixture), afterCommit);
    checks.push("A swallowed post-wallet callback rejection still aborts the outer transaction; neither domain changes");

    stage = "real SQL failure after marketplace row write";
    let injected = false;
    await assert.rejects(store.transaction(async tx => {
      const faulted: WalletSql = {
        exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          if (/^\s*update alpha_exchange\.runtime_meta\s/i.test(sql)) {
            injected = true;
            await tx.query("SELECT 1 / 0");
          }
          return tx.query<Row>(sql, values);
        },
      };
      await mutateDevelopmentFocusedTradeInTransaction({ mode: "simulation-only", tx: faulted, requestId: fixture.requestId }, async snapshot => {
        await boundWallet(faulted).execute(reserve("native-rejected-after-market", "100"));
        const request = snapshot.purchaseRequests.find(item => item.id === fixture.requestId)!;
        request.buyerNotes = "must also roll back";
        request.updatedAt = changedAt(fixture, 2);
        return snapshot;
      });
    }));
    assert.equal(injected, true);
    assert.deepEqual(await footprint(store, fixture), afterCommit);
    checks.push("A real SQL failure after the marketplace row update rolls back both that row and the wallet command/projections");

    stage = "stale snapshot waiting behind an ordinary marketplace writer";
    writer = await createPostgresWalletStore({ mode: "simulation-only", connectionString });
    contender = await createPostgresWalletStore({ mode: "simulation-only", connectionString });
    const concurrency = await staleSnapshotRace(store, writer, contender, fixture);
    checks.push("A contender visibly waiting behind the platform financial lock fails its stale snapshot fence and reruns the whole decision with fresh state");

    stage = "lost commit acknowledgement and original identity reconciliation";
    let loseAcknowledgement = true;
    const lossy: WalletStore = { close: async () => undefined, transaction: async work => {
      const result = await store!.transaction(work);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new CommitOutcomeUnknownError(new Error("synthetic lost shared-commit acknowledgement"));
      }
      return result;
    } };
    const command = walletCommand("createDepositIntent", SELLER, "native-shared-unknown-commit", { id: "native-shared-unknown-commit", assetId: TRON, purpose: "commission" });
    const beforeUnknown = await footprint(store, fixture);
    await assert.rejects(committedPair(lossy, fixture, command, "native committed before lost reply", 5), CommitOutcomeUnknownError);
    const afterUnknown = await footprint(store, fixture);
    assert.equal(afterUnknown.wallet.revision, beforeUnknown.wallet.revision + 1);
    assert.equal(BigInt(afterUnknown.market.version), BigInt(beforeUnknown.market.version) + BigInt(1));
    assert.equal(afterUnknown.market.payload.buyerNotes, "native committed before lost reply");
    assert.equal((await committedPair(store, fixture, command, "must not overwrite a replay", 6)).replayed, true);
    assert.deepEqual(await footprint(store, fixture), afterUnknown);
    checks.push("A synthetically lost reply after a real shared commit is reconciled by the original wallet identity without a second command or marketplace overwrite");

    stage = "reopen and conserved principal verification";
    await store.close();
    store = await createPostgresWalletStore({ mode: "simulation-only", connectionString });
    const reopened = await footprint(store, fixture);
    assert.deepEqual(reopened, afterUnknown);
    assert.equal(expectedCustody(reopened.wallet.state, TRON), parseUnits("500", 6));
    assert.equal(balance(reopened.wallet.state, TRON, `listing:${fixture.listingId}`), parseUnits("300", 6));
    assert.equal(balance(reopened.wallet.state, TRON, "trade:native-shared-reservation"), parseUnits("200", 6));
    assert.equal(reopened.wallet.state.trades.size, 1);
    assertLedgerInvariants(reopened.wallet.state);
    checks.push("A new connection reconstructs both domains identically, with 500 USDT conserved as 300 listing inventory plus one 200-USDT reservation");
    report = { mode: "simulation-only", scope: "Actual focused marketplace persistence and wallet shared-transaction mechanics; no enrollment or resize", checks, concurrency,
      walletRevision: reopened.wallet.revision, marketplaceVersion: reopened.market.version,
      money: { custodyUSDT: "500", listingInventoryUSDT: "300", reservedPrincipalUSDT: "200", reservations: 1, providerSubmissions: 0 },
      limits: ["Marketplace metadata change and wallet command are deliberately paired by the fixture, not a production business coordinator.",
        "No accepted-amount resize, durable acceptance receipt, enrolled-writer cutover or platform lifecycle extraction is implemented by this harness.",
        "Lost COMMIT acknowledgement is injected after a real commit; no real network partition or custody provider is used."] };
  } finally {
    const results = await Promise.allSettled([store?.close(), writer?.close(), contender?.close()]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
  assert(report);
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  assertSimulationRuntime("simulation-only");
  if (process.argv.slice(2).join(" ") === "--help") { console.log(USAGE); return; }
  await verify(argumentsOf(process.argv.slice(2)));
}

void main().catch(() => {
  // Do not print argv, credentials, row contents or connection details.
  console.error(`Alpha Wallet shared-transaction fixture failed during ${stage}`);
  process.exitCode = 1;
});
