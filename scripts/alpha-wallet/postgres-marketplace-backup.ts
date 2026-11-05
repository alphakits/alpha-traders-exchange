/**
 * Actual PostgreSQL combined recovery on THREE empty disposable loopback DBs.
 * The caller provisions the databases; this script never creates/drops one,
 * reads application connection settings, supplies a provider or starts a worker.
 */
import { strict as assert } from "node:assert";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import {
  exportMarketplaceWalletBackup, inspectMarketplaceWalletBackup,
  inspectRestoredMarketplaceWallet, restoreMarketplaceWalletBackup,
} from "../../src/lib/alpha-wallet/marketplace-backup";
import { createDevelopmentMarketplaceWalletCoordinator } from "../../src/lib/alpha-wallet/marketplace-coordinator";
import { assertFreshMarketplaceRecoveryTarget, readMarketplaceRecoveryRows } from "../../src/lib/alpha-wallet/marketplace-recovery-store";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { createVersionedDurableWallet, verifyVersionedHistory } from "../../src/lib/alpha-wallet/versioned-durable";
import { balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { MARKETPLACE_BACKUP_RESTORE_TIME, marketplaceBackupFixture } from "./marketplace-backup-fixtures";
import { TRON } from "./durable-fixtures";

const MODE = "simulation-only" as const;
const USAGE = "Pass --fresh-simulation-databases and explicit --source-connection-string, --target-connection-string, --race-connection-string URLs for three different empty loopback alpha_wallet_dev_ databases.";
let stage = "argument validation";

function argumentsOf(args: string[]) {
  assert.equal(args.length, 7, USAGE);
  let acknowledged = false;
  const urls = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--fresh-simulation-databases") { assert(!acknowledged, USAGE); acknowledged = true; }
    else if (["--source-connection-string", "--target-connection-string", "--race-connection-string"].includes(arg)) {
      assert(!urls.has(arg) && args[index + 1] && !args[index + 1].startsWith("--"), USAGE);
      urls.set(arg, args[++index]);
    } else assert.fail(USAGE);
  }
  assert(acknowledged && urls.size === 3, USAGE);
  const source = urls.get("--source-connection-string")!, target = urls.get("--target-connection-string")!, race = urls.get("--race-connection-string")!;
  assert.equal(new Set([source, target, race].map(url => decodeURIComponent(new URL(url).pathname))).size, 3, USAGE);
  return { source, target, race };
}
async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    await assertFreshMarketplaceRecoveryTarget(tx);
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(role.rows[0]?.permitted, true, "Disposable fixture role requires superuser/BYPASSRLS");
  });
}
const wrapped = (store: WalletStore, wrap: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(wrap(tx))), close: async () => undefined,
});
async function history(store: WalletStore) {
  return store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
    command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
    FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows);
}
function resigned(document: Record<string, unknown>) {
  const body = { ...document };
  delete body.checksum;
  return JSON.stringify({ ...body, checksum: walletDigest(body) });
}

async function run(urls: ReturnType<typeof argumentsOf>) {
  const open: WalletStore[] = [];
  const connect = async (connectionString: string) => {
    const store = await createPostgresWalletStore({ mode: MODE, connectionString }); open.push(store); return store;
  };
  const checks: string[] = [];
  try {
    stage = "guarded connection and all-target freshness";
    const source = await connect(urls.source);
    let target = await connect(urls.target);
    const race = await connect(urls.race);
    await Promise.all([fresh(source), fresh(target), fresh(race)]);
    checks.push("All three isolated native targets are checked before any fixture write");

    stage = "canonical source fixture and authenticated paused export";
    const setup = await marketplaceBackupFixture(source);
    const sourceCommands = await history(source);
    const serialized = await exportMarketplaceWalletBackup({ mode: MODE, store: source, ...setup.ownerInput, clock: setup.clock });
    const backup = inspectMarketplaceWalletBackup(serialized);
    const document = JSON.parse(serialized);
    const sourceRows = await source.transaction(tx => readMarketplaceRecoveryRows(tx));
    assert.deepEqual(document.canonical, sourceRows.canonical);
    assert.deepEqual(document.coordination, sourceRows.coordination);
    assert.deepEqual(document.wallet.commands, sourceCommands);
    assert.equal(document.canonical.sessions, undefined);
    for (const user of document.canonical.users) assert.deepEqual(Object.keys(user).sort(), ["id", "role", "seller_status"]);
    assert(!serialized.includes(setup.fixture.ownerSessionToken));
    assert(!serialized.includes('"passwordHash"') && !serialized.includes('"token_hash"'));
    assert.equal(backup.halted, true);
    checks.push("Owner export preserves the native financial/canonical snapshot while excluding session and password material");

    const restore = (store: WalletStore, backupText = serialized, checksum = backup.checksum) => restoreMarketplaceWalletBackup({
      mode: MODE, store, backup: backupText, expectedChecksum: checksum,
      acknowledgeFreshTarget: true, clock: () => MARKETPLACE_BACKUP_RESTORE_TIME,
    });
    stage = "recomputed corrupt canonical manifest refusal";
    const corrupt = structuredClone(document);
    corrupt.canonical.purchase_requests.find((row: { id: string }) => row.id === setup.fixture.requestId).payload.usdtAmount = "301";
    const corruptText = resigned(corrupt);
    let transactions = 0;
    const observed: WalletStore = { transaction: work => { transactions++; return target.transaction(work); }, close: async () => undefined };
    await assert.rejects(restore(observed, corruptText, JSON.parse(corruptText).checksum));
    assert.equal(transactions, 0);
    await fresh(target);
    checks.push("Recomputing a checksum cannot hide contradictory canonical terms; invalid bytes never open a target transaction");

    stage = "SQL failure at new quarantine command";
    let pauseFailed = false;
    const failPause = wrapped(target, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (sql.startsWith("INSERT INTO alpha_wallet_simulation.commands") && params?.[2] === "pause"
          && String(params?.[1]).includes("marketplace-backup-recovery")) {
          pauseFailed = true; await tx.query("SELECT 1 / 0");
        }
        return tx.query<Row>(sql, params);
      },
    }));
    await assert.rejects(restore(failPause));
    assert(pauseFailed);
    await fresh(target);
    checks.push("A native SQL error at the new pause rolls back every replayed wallet command and schema");

    stage = "SQL failure after canonical request insertion";
    let canonicalFailed = false;
    const failCanonical = wrapped(target, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (/^\s*INSERT INTO alpha_exchange\.purchase_requests\b/i.test(sql)) {
          canonicalFailed = true; await tx.query("SELECT 1 / 0");
        }
        return result;
      },
    }));
    await assert.rejects(restore(failCanonical));
    assert(canonicalFailed);
    await fresh(target);
    checks.push("A native SQL error after actual canonical rows are inserted rolls back wallet and marketplace together");

    stage = "SQL failure after immutable recovery receipt completion";
    let receiptFailed = false;
    const failReceipt = wrapped(target, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (/^\s*UPDATE alpha_wallet_marketplace_simulation\.recovery_receipts\b/i.test(sql)) {
          receiptFailed = true; await tx.query("SELECT 1 / 0");
        }
        return result;
      },
    }));
    await assert.rejects(restore(failReceipt));
    assert(receiptFailed);
    await fresh(target);
    checks.push("A failure after receipt completion and guard installation still rolls back the entire recovery");

    stage = "real recovery commit followed by synthetic acknowledgement loss";
    const lostReply: WalletStore = { close: async () => undefined,
      async transaction<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
        await target.transaction(work);
        throw new CommitOutcomeUnknownError(new Error("Synthetic loss after native COMMIT"));
      },
    };
    await assert.rejects(restore(lostReply), error => error instanceof CommitOutcomeUnknownError);
    const initialContexts = await target.transaction(tx => tx.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM alpha_wallet_marketplace_simulation.transaction_contexts"));
    assert.equal(initialContexts.rows[0].count, "1", "Historical transaction registrations must never be imported");
    await target.close();
    target = await connect(urls.target);
    const recovered = await inspectRestoredMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: backup.checksum });
    assert.equal(recovered.quarantined, true);
    assert.deepEqual(recovered.source, backup.checkpoint);
    assert.equal(recovered.restored.revision, backup.checkpoint.revision + 1);
    checks.push("A real commit with a lost response is resolved by reopening that same target and verifying its immutable receipt and new pause");

    stage = "native original history, canonical closure and allocation verification";
    const targetCommands = await history(target);
    assert.deepEqual(targetCommands.slice(0, -1), sourceCommands);
    assert.deepEqual(await target.transaction(tx => readMarketplaceRecoveryRows(tx)), sourceRows);
    const state = verifyVersionedHistory(targetCommands).state;
    assert.equal(balance(state, TRON, `trade:${setup.fixture.tradeId}`), BigInt("300000000"));
    assert.equal(balance(state, TRON, `listing:${setup.fixture.listingId}`), BigInt("200000000"));
    assert.equal(expectedCustody(state, TRON), BigInt("500000000"));
    assert(state.haltReason);
    assert.equal(state.payouts.size, 0);
    checks.push("Reopen retains original hashes/timestamps and all canonical records; 300 reserved plus 200 available equals 500 synthetic USDT");

    stage = "restored credentials and legacy writer refusal";
    const targetCoordinator = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store: target, clock: () => MARKETPLACE_BACKUP_RESTORE_TIME });
    await assert.rejects(targetCoordinator.inspect(setup.ownerInput));
    await assert.rejects(targetCoordinator.acceptAmountCorrection(setup.acceptanceInput));
    await assert.rejects(createVersionedDurableWallet({ mode: MODE, store: target }).snapshot());
    await assert.rejects(target.transaction(tx => tx.query("UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{buyerNotes}','\"changed\"') WHERE id=$1", [setup.fixture.requestId])));
    await assert.rejects(target.transaction(tx => tx.query("UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{buyerNotes}','\"changed\"') WHERE id=$1", [setup.fixture.otherRequestId])));
    checks.push("Old credentials, standalone wallet paths and older writers to target/sibling requests remain blocked after recovery");

    stage = "nonempty retry, wrong checksum and immutable receipt refusal";
    await assert.rejects(restore(target));
    await assert.rejects(inspectRestoredMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: "f".repeat(64) }));
    await assert.rejects(target.transaction(tx => tx.query("UPDATE alpha_wallet_marketplace_simulation.recovery_receipts SET receipt=receipt")));
    assert.deepEqual(await inspectRestoredMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: backup.checksum }), recovered);
    assert.deepEqual(await history(source), sourceCommands);
    assert.equal((await setup.coordinator.inspect(setup.ownerInput)).wallet.halted, true);
    checks.push("A retry never overwrites a committed target; receipt mutation/checksum mismatch are refused and the source remains paused");

    stage = "competing native restores to one fresh target";
    const competitor = await connect(urls.race);
    let entrants = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const backendIds = new Set<number>();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const failedArrival = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Competing recovery backend did not reach its bounded barrier")), 3000);
    });
    const overlapping = (store: WalletStore) => wrapped(store, tx => {
      let firstProbe = true;
      return { exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        // Hold both at their first identity probe, before target writes. The
        // barrier is outside SQL locks and released when both backends arrive.
        if (firstProbe && sql.includes("txid_current()::text AS transaction_id") && sql.includes("transaction_isolation")) {
          firstProbe = false;
          const backend = await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
          backendIds.add(backend.rows[0].pid);
          entrants++;
          if (entrants <= 2) { if (entrants === 2) release(); await Promise.race([barrier, failedArrival]); }
        }
        return tx.query<Row>(sql, params);
      },
    }; });
    const results = await Promise.allSettled([restore(overlapping(race)), restore(overlapping(competitor))])
      .finally(() => { if (deadline !== undefined) clearTimeout(deadline); });
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal(backendIds.size, 2, "The competing restores must use two actual PostgreSQL backends");
    const raced = await inspectRestoredMarketplaceWallet({ mode: MODE, store: race, expectedChecksum: backup.checksum });
    assert.deepEqual(raced.restored, recovered.restored);
    assert.deepEqual(await history(race), targetCommands);
    checks.push("Two native backends compete for one fresh target; exactly one restore commits and its verified state is never overwritten");

    return { kind: "alpha-wallet-native-combined-marketplace-recovery-v1", mode: MODE, status: "passed", checks,
      source: backup.checkpoint, restored: recovered.restored, canonicalRowCounts: backup.canonicalRowCounts,
      coordinationRowCounts: backup.coordinationRowCounts, sourcePaused: true, targetPaused: true,
      credentialsRestored: false, historicalContextsRestored: false, providerSubmissions: 0,
      conservedPrincipalRaw: "500000000", tradeReservedRaw: "300000000", listingAvailableRaw: "200000000",
      concurrentRestoreResults: { fulfilled: 1, rejected: 1, distinctBackends: backendIds.size },
      responseLoss: "Injected after a real native COMMIT; not a physical network partition",
    };
  } finally {
    await Promise.allSettled(open.map(store => store.close()));
  }
}

async function main() {
  assertSimulationRuntime(MODE);
  const report = await run(argumentsOf(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
void main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: "failed", stage,
    error: error instanceof Error ? error.message : "Unknown development recovery failure" })}\n`);
  process.exitCode = 1;
});
