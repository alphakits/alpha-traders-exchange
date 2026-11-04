/**
 * Disposable native PostgreSQL fixtures only. The caller creates two empty
 * databases first; this harness never CREATEs/DROPs a database or imports SQL.
 * NODE_ENV=test node --import tsx scripts/alpha-wallet/postgres-backup.ts \
 *   --fresh-simulation-databases \
 *   --source-connection-string postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_backup_source \
 *   --target-connection-string postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_backup_target
 */
import { strict as assert } from "node:assert";
import { exportWalletBackup, inspectWalletBackup, restoreWalletBackup, WalletBackupError } from "../../src/lib/alpha-wallet/backup";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { createDurableWallet, initializeDurableWallet, walletCommand, WalletIntegrityError } from "../../src/lib/alpha-wallet/durable";
import { createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import type { FileFakeProvider } from "../../src/lib/alpha-wallet/fake-provider";
import { assertLedgerInvariants, balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { createSimulationPayoutWorker } from "../../src/lib/alpha-wallet/payout-worker";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import { parseUnits } from "../../src/lib/alpha-wallet/amounts";
import { DISPATCHER, SELLER, TRON, durableFixture } from "./durable-fixtures";

let stage = "argument validation";
const USAGE = "Pass --fresh-simulation-databases --source-connection-string <explicit loopback alpha_wallet_dev_ URL> --target-connection-string <different explicit loopback alpha_wallet_dev_ URL>. Both databases must already exist and be empty. No environment database URL is read; no database is created or dropped.";

function argumentsOf(args: string[]) {
  assert.equal(args.length, 5, USAGE);
  let fresh = false, source: string | undefined, target: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--fresh-simulation-databases") { assert(!fresh, USAGE); fresh = true; }
    else if (arg === "--source-connection-string") { assert(!source && args[index + 1] && !args[index + 1].startsWith("--"), USAGE); source = args[++index]; }
    else if (arg === "--target-connection-string") { assert(!target && args[index + 1] && !args[index + 1].startsWith("--"), USAGE); target = args[++index]; }
    else assert.fail(USAGE);
  }
  assert(fresh && source && target, USAGE);
  // Store factories additionally validate loopback hosts, credentials, database
  // names and URL options before opening any connection. Different database
  // names also prevent aliases/users accidentally selecting the same database.
  assert.notEqual(decodeURIComponent(new URL(source).pathname), decodeURIComponent(new URL(target).pathname), "Source and target fixture database names must differ");
  return { source, target };
}

async function freshness(store: WalletStore) {
  return store.transaction(async tx => {
    const schemas = await tx.query(`SELECT nspname FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%' ORDER BY nspname`);
    const relations = await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')`);
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(schemas.rows.length, 0, "Use a fresh isolated fixture database; existing schemas are never removed");
    assert.equal(relations.rows[0]?.count, "0", "Use a fresh fixture database without public relations");
    assert.equal(role.rows[0]?.permitted, true, "Native fixture role requires superuser/BYPASSRLS for the forced-RLS simulation schema");
  });
}

async function footprint(store: WalletStore) {
  return store.transaction(async tx => {
    const namespace = (await tx.query("SELECT to_regnamespace('alpha_wallet_simulation')::text AS name")).rows;
    const relations = (await tx.query(`SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','alpha_wallet_simulation') ORDER BY n.nspname,c.relname,c.relkind`)).rows;
    return { namespace, relations };
  });
}
function wrapped(backing: WalletStore, make: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => backing.transaction(tx => work(make(tx))), close: async () => undefined };
}
async function history(store: WalletStore, maximum: number) {
  return store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
    command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
    FROM alpha_wallet_simulation.commands WHERE revision <= $1 ORDER BY revision`, [maximum])).rows);
}

async function verifyNativeRecovery(sourceConnection: string, targetConnection: string) {
  let source: WalletStore | undefined, target: WalletStore | undefined;
  let report: Record<string, unknown> | undefined;
  const checks: string[] = [];
  try {
    stage = "explicit connection validation";
    source = await createPostgresWalletStore({ mode: "simulation-only", connectionString: sourceConnection });
    target = await createPostgresWalletStore({ mode: "simulation-only", connectionString: targetConnection });
    stage = "source and target freshness checks";
    // Check both BEFORE writing to either database.
    await Promise.all([freshness(source), freshness(target)]);
    const untouched = await footprint(target);

    stage = "synthetic source initialization";
    await initializeDurableWallet(source);
    const sourceWallet = createDurableWallet({ mode: "simulation-only", store: source, clock: Date.now });
    const fixture = durableFixture(sourceWallet);
    await fixture.deposit("500");
    await fixture.ready();
    const payout = (await fixture.command("requestWithdrawal", SELLER, {
      id: "native-backup-withdrawal", assetId: TRON, amount: "200", destination: simulatedDestination(TRON, SELLER.id), stepUpReference: "sim-stepup-native-backup",
    })).result;
    const claim = walletCommand("beginDispatch", DISPATCHER, "native-original-claim", payout.id);
    const claimed = await sourceWallet.execute(claim);
    assert.equal(claimed.result.shouldDispatch, true);
    await fixture.command("recordSubmission", DISPATCHER, { payoutId: payout.id, outcome: "unknown" });
    const original = await sourceWallet.snapshot();
    assert.equal(original.state.payouts.get(payout.id)?.state, "submission_unknown");

    stage = "verified native export";
    const backup = await exportWalletBackup({ mode: "simulation-only", store: source, clock: Date.now });
    const inspected = inspectWalletBackup(backup);
    assert.equal(inspected.checkpoint.revision, original.revision);
    assert.equal(inspected.checkpoint.eventHash, original.eventHash);
    assert.equal(inspected.checkpoint.stateHash, walletDigest(original.state));
    checks.push("A real PostgreSQL source exports its verified immutable history and original checkpoint");

    stage = "corrupt backup refusal before target transaction";
    const corrupt = JSON.parse(backup) as Record<string, unknown>;
    corrupt.checkpoint = { ...(corrupt.checkpoint as Record<string, unknown>), stateHash: "f".repeat(64) };
    const { checksum: _checksum, ...body } = corrupt;
    const tampered = JSON.stringify({ ...body, checksum: walletDigest(body) });
    let targetTransactions = 0;
    const observedTarget: WalletStore = {
      transaction: work => { targetTransactions++; return target!.transaction(work); },
      close: async () => undefined,
    };
    await assert.rejects(restoreWalletBackup({ mode: "simulation-only", store: observedTarget, backup: tampered,
      acknowledgeFreshTarget: true, clock: Date.now }), /checkpoint disagrees/);
    assert.equal(targetTransactions, 0, "Invalid backup must fail before a target transaction opens");
    assert.deepEqual(await footprint(target), untouched);
    checks.push("A recomputed checksum cannot conceal inconsistent history; rejection leaves the native target untouched");

    stage = "native transaction rollback at quarantine write";
    let originalInserts = 0, pauseAttempted = false;
    const faulted = wrapped(target, tx => ({
      exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (sql.startsWith("INSERT INTO alpha_wallet_simulation.commands")) {
          if (params?.[2] === "pause") { pauseAttempted = true; await tx.query("SELECT 1 / 0"); }
          else originalInserts++;
        }
        return tx.query<Row>(sql, params);
      },
    }));
    await assert.rejects(restoreWalletBackup({ mode: "simulation-only", store: faulted, backup,
      acknowledgeFreshTarget: true, expectedChecksum: inspected.checksum, clock: Date.now }), /division by zero/);
    assert.equal(originalInserts, inspected.commandCount);
    assert.equal(pauseAttempted, true);
    assert.deepEqual(await footprint(target), untouched, "Failed pause must roll back all restored schema, commands and projections");
    checks.push("A real SQL failure at the final pause rolls back the entire native restore, including schema creation");

    stage = "successful quarantined native restore";
    const restored = await restoreWalletBackup({ mode: "simulation-only", store: target, backup,
      acknowledgeFreshTarget: true, expectedChecksum: inspected.checksum, clock: Date.now });
    assert.equal(restored.quarantined, true);
    assert.equal(restored.restored.revision, original.revision + 1);
    assert.deepEqual(await history(target, original.revision), await history(source, original.revision));
    checks.push("Native restore retains every original command row/hash/timestamp and appends exactly one quarantine command");

    stage = "reopened native target verification";
    await target.close();
    target = await createPostgresWalletStore({ mode: "simulation-only", connectionString: targetConnection });
    await initializeDurableWallet(target);
    const wallet = createDurableWallet({ mode: "simulation-only", store: target, clock: Date.now });
    const recovered = await wallet.snapshot();
    assert.equal(recovered.eventHash, restored.restored.eventHash);
    assert.equal(walletDigest(recovered.state), restored.restored.stateHash);
    assert.equal(recovered.state.haltReason, "Operator emergency pause");
    assert.equal(recovered.state.idempotency.size, original.state.idempotency.size + 1);
    assert.deepEqual({ ...recovered.state, haltReason: original.state.haltReason,
      idempotency: new Map([...recovered.state.idempotency].slice(0, original.state.idempotency.size)) }, original.state);
    assert.equal(expectedCustody(recovered.state, TRON), parseUnits("500", 6));
    assert.equal(balance(recovered.state, TRON, `available:${SELLER.id}`), parseUnits("300", 6));
    assert.equal(balance(recovered.state, TRON, `payout:${payout.id}`), parseUnits("200", 6));
    assertLedgerInvariants(recovered.state);
    checks.push("A new native store connection preserves quarantine and conserves 500 USDT as 300 available plus 200 held");

    stage = "lookup-only recovery with no redispatch";
    const replay = await wallet.execute(claim);
    assert.equal(replay.replayed, true);
    assert.equal(replay.eventHash, claimed.eventHash);
    assert.equal(replay.result.shouldDispatch, false);
    assert.equal(replay.result.payout.dispatchCount, 1);
    assert.equal(replay.result.payout.providerReference, payout.providerReference);
    assert.equal((await wallet.recoverPayouts()).find(item => item.payout.id === payout.id)?.action, "lookup_original_reference");
    let lookups = 0, submissions = 0;
    // Explicit no-network provider stub. This verifies the recovery dispatch
    // boundary; separate fake-provider/process tests exercise provider files.
    const provider: FileFakeProvider = {
      kind: "alpha-wallet-file-fake-provider",
      lookup: async value => {
        lookups++;
        assert.equal(value.providerReference, payout.providerReference);
        assert.equal(value.assetId, payout.assetId);
        assert.equal(value.destination, payout.destination);
        assert.equal(value.amountRaw, payout.amountRaw);
        return { status: "not_found" };
      },
      submit: async () => { submissions++; throw new Error("No submission is allowed during native restore verification"); },
      finalize: async () => { throw new Error("No provider finalization is performed by this harness"); },
    };
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet, provider });
    assert.equal((await worker.step(payout.id)).status, "provider_lookup_required");
    assert.equal(lookups, 1);
    assert.equal(submissions, 0);
    await assert.rejects(wallet.execute(walletCommand("beginDispatch", DISPATCHER, "native-forbidden-new-claim", payout.id)), /Wallet paused/);
    assert.equal((await wallet.snapshot()).revision, restored.restored.revision);
    checks.push("Original dispatch replay returns false; recovery only looks up its original reference and submits nothing");

    report = { mode: "simulation-only", storage: "native PostgreSQL logical backup and quarantined restore", checks,
      sourceCheckpoint: inspected.checkpoint, restoredCheckpoint: restored.restored, quarantined: true,
      money: { expectedCustodyUSDT: "500", availablePrincipalUSDT: "300", heldPayoutUSDT: "200", providerSubmissionsDuringRecovery: submissions } };
  } finally {
    const closed = await Promise.allSettled([source?.close(), target?.close()]);
    for (const outcome of closed) if (outcome.status === "rejected") throw outcome.reason;
  }
  assert(report, "Native backup verification did not produce a complete report");
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  assertSimulationRuntime("simulation-only");
  if (process.argv.slice(2).join(" ") === "--help") { console.log(USAGE); return; }
  const args = argumentsOf(process.argv.slice(2));
  await verifyNativeRecovery(args.source, args.target);
}

void main().catch(error => {
  // Assertion messages may include compared history. Never print them, URLs,
  // credentials, full command data, provider references, or token identifiers.
  const detail = error instanceof WalletBackupError || error instanceof WalletIntegrityError ? `: ${error.message}` : "";
  console.error(`Alpha Wallet native backup fixture failed during ${stage}${detail}`);
  process.exitCode = 1;
});
