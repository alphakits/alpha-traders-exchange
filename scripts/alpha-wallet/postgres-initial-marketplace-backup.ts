/**
 * Native initial-cohort recovery on FOUR empty disposable loopback databases.
 * Two sources are necessary: an owner-activated pending request cannot become
 * accepted after it is paused. The caller provisions every database. This script
 * never creates/drops one or reads application URLs, credentials or providers.
 */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import {
  exportInitialMarketplaceWalletBackup, exportMobileInitialMarketplaceWalletBackup,
  inspectInitialMarketplaceWalletBackup, inspectRestoredInitialMarketplaceWallet, restoreInitialMarketplaceWalletBackup,
} from "../../src/lib/alpha-wallet/initial-marketplace-backup";
import {
  createDevelopmentInitialMarketplaceWalletCoordinator, createDevelopmentMobileInitialMarketplaceWalletCoordinator,
} from "../../src/lib/alpha-wallet/initial-marketplace-coordinator";
import {
  assertFreshInitialMarketplaceRecoveryTarget, assertInitialMarketplaceRecoveryIdentityQuarantine,
  readInitialMarketplaceRecoveryRows,
} from "../../src/lib/alpha-wallet/initial-marketplace-recovery-store";
import { balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { exportMarketplaceWalletBackup, inspectMarketplaceWalletBackup, restoreMarketplaceWalletBackup } from "../../src/lib/alpha-wallet/marketplace-backup";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { exportV3WalletBackup } from "../../src/lib/alpha-wallet/v3-backup";
import { createV3DurableWallet, verifyV3History } from "../../src/lib/alpha-wallet/v3-durable";
import { assertV3Invariants, isV3State } from "../../src/lib/alpha-wallet/v3-engine";
import { FIXTURE_TIME, TRON } from "./durable-fixtures";
import { buildInitialMarketplaceFixture } from "./initial-marketplace-fixtures";

const MODE = "simulation-only" as const;
const NOW = FIXTURE_TIME + 1000;
const EXPORT_AT = FIXTURE_TIME + 2000;
const RESTORE_AT = FIXTURE_TIME + 10_000;
const SCHEMA = "alpha_wallet_initial_marketplace_simulation";
const USAGE = "Pass --fresh-simulation-databases and explicit --source-connection-string, --activated-source-connection-string, --target-connection-string and --race-connection-string URLs for four different empty loopback alpha_wallet_dev_ databases.";
type Fixture = Awaited<ReturnType<typeof buildInitialMarketplaceFixture>>["canonical"];
let stage = "argument validation";

function argumentsOf(args: string[]) {
  assert.equal(args.length, 9, USAGE);
  let acknowledged = false;
  const urls = new Map<string, string>();
  const flags = ["--source-connection-string", "--activated-source-connection-string", "--target-connection-string", "--race-connection-string"];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--fresh-simulation-databases") { assert(!acknowledged, USAGE); acknowledged = true; }
    else if (flags.includes(argument)) {
      assert(!urls.has(argument) && args[index + 1] && !args[index + 1].startsWith("--"), USAGE);
      urls.set(argument, args[++index]);
    } else assert.fail(USAGE);
  }
  assert(acknowledged && urls.size === 4, USAGE);
  // Distinct names are deliberately stricter than merely distinct credentials
  // or ports. The underlying store separately enforces exact loopback URLs.
  assert.equal(new Set([...urls.values()].map(url => decodeURIComponent(new URL(url).pathname))).size, 4, USAGE);
  return { source: urls.get(flags[0])!, activatedSource: urls.get(flags[1])!, target: urls.get(flags[2])!, race: urls.get(flags[3])! };
}

const inside = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
const wrapped = (store: WalletStore, wrap: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(wrap(tx))), close: async () => undefined,
});
const web = (store: WalletStore, at = NOW) => createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock: () => at });
const mobile = (store: WalletStore, at = NOW) => createDevelopmentMobileInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock: () => at });
const ownerInput = (fixture: Fixture) => ({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId });
const sellerInput = (fixture: Fixture) => ({ sessionToken: fixture.sellerSessionToken, requestId: fixture.requestId,
  operationId: "native-initial-recovery-seller-accept" });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    await assertFreshInitialMarketplaceRecoveryTarget(tx);
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(role.rows[0]?.permitted, true, "Disposable fixture role requires superuser/BYPASSRLS");
  });
}
async function history(store: WalletStore) {
  return store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
    command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
    FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows);
}
async function initialFinancialRows(store: WalletStore) {
  return store.transaction(async tx => ({
    bindings: (await tx.query("SELECT to_jsonb(t) AS row FROM alpha_wallet_simulation.initial_trade_bindings t ORDER BY platform_request_id")).rows,
    receipts: (await tx.query("SELECT to_jsonb(t) AS row FROM alpha_wallet_simulation.initial_acceptance_receipts t ORDER BY acceptance_key")).rows,
  }));
}
function resigned(document: Record<string, unknown>) {
  const body = { ...document };
  delete body.checksum;
  return JSON.stringify({ ...body, checksum: walletDigest(body) });
}

/** Both transports must select exactly the same financial recovery unit. */
async function capture(store: WalletStore, fixture: Fixture) {
  const commands = await history(store);
  const financial = await initialFinancialRows(store);
  const serialized = await exportInitialMarketplaceWalletBackup({ mode: MODE, store, ...ownerInput(fixture), clock: () => EXPORT_AT });
  const mobileSerialized = await exportMobileInitialMarketplaceWalletBackup({ mode: MODE, store,
    ...fixture.mobile.credentials[fixture.ownerId], requestId: fixture.requestId, clock: () => EXPORT_AT });
  assert.equal(mobileSerialized, serialized, "Changing valid owner transport must not change the financial backup bytes");
  const inspection = inspectInitialMarketplaceWalletBackup(serialized);
  const rows = await store.transaction(tx => readInitialMarketplaceRecoveryRows(tx));
  const document = JSON.parse(serialized);
  assert.deepEqual(document.canonical, rows.canonical);
  assert.deepEqual(document.coordination, rows.coordination);
  assert.deepEqual(document.wallet.commands, commands);
  assert.equal(document.canonical.sessions, undefined);
  assert.equal(document.canonical.mobile_device_sessions, undefined);
  assert.equal(document.canonical.mobile_refresh_token_history, undefined);
  for (const user of document.canonical.users) {
    assert.deepEqual(Object.keys(user).sort(), ["created_at", "id", "role", "seller_status", "sort_index", "updated_at"]);
  }
  for (const token of Object.values(fixture.webCredentials).map(credential => credential.sessionToken)) {
    assert(!serialized.includes(token) && !serialized.includes(hash(token)), "Raw or hashed web credentials cannot enter the recovery unit");
  }
  for (const credential of Object.values(fixture.mobile.credentials)) {
    assert(!serialized.includes(credential.accessToken) && !serialized.includes(credential.metadata.deviceId));
  }
  for (const session of Object.values(fixture.mobile.sessions)) {
    for (const marker of [session.id, session.deviceIdHash, session.accessTokenHash, session.refreshTokenHash, session.tokenFamilyId]) {
      assert(!serialized.includes(marker), "Mobile session identity and authentication hashes must be excluded");
    }
  }
  assert(!serialized.includes('"passwordHash"') && !serialized.includes('"token_hash"'));
  assert.equal(inspection.halted, true);
  assert.equal(inspection.credentialsIncluded, false);
  assert.deepEqual(await history(store), commands, "Export must not append financial commands");
  return { store, fixture, serialized, inspection, rows, commands, financial };
}

async function run(urls: ReturnType<typeof argumentsOf>) {
  const open: WalletStore[] = [];
  const connect = async (connectionString: string) => {
    const store = await createPostgresWalletStore({ mode: MODE, connectionString });
    open.push(store); return store;
  };
  const checks: string[] = [];
  try {
    stage = "guarded connections and all-target freshness";
    const source = await connect(urls.source), activatedSource = await connect(urls.activatedSource);
    let target = await connect(urls.target);
    const race = await connect(urls.race);
    await Promise.all([fresh(source), fresh(activatedSource), fresh(target), fresh(race)]);
    checks.push("All four native loopback databases are checked empty before any fixture write");

    stage = "distinct activated-only and accepted sources with paused-source enforcement";
    const acceptedFixture = (await buildInitialMarketplaceFixture(source, { platform: "android", tradeProjection: "absent" })).canonical;
    const activatedFixture = (await buildInitialMarketplaceFixture(activatedSource, { platform: "ios", tradeProjection: "pending" })).canonical;
    for (const [store, fixture, accept] of [[source, acceptedFixture, true], [activatedSource, activatedFixture, false]] as const) {
      const coordinator = web(store);
      await coordinator.activateRequest({ ...ownerInput(fixture), operationId: "native-initial-recovery-activation",
        assetId: fixture.assetId, walletListingId: fixture.walletListingId, walletTradeId: fixture.walletTradeId });
      if (accept) {
        await mobile(store).acceptRequest({ ...fixture.mobile.credentials[fixture.sellerId], requestId: fixture.requestId,
          operationId: "native-initial-recovery-mobile-accept" });
      }
      await assert.rejects(exportInitialMarketplaceWalletBackup({ mode: MODE, store, ...ownerInput(fixture), clock: () => EXPORT_AT }));
      await coordinator.pause({ ...ownerInput(fixture), operationId: "native-initial-recovery-source-pause" });
    }
    checks.push("Neither pending activation nor accepted reservation exports before an authenticated durable source pause");

    stage = "exact web/mobile export and excluded authority";
    const accepted = await capture(source, acceptedFixture), activated = await capture(activatedSource, activatedFixture);
    assert.equal(accepted.rows.coordination.acceptances.length, 1);
    assert.equal(accepted.rows.coordination.publications.length, 1);
    assert.equal(activated.rows.coordination.activations.length, 1);
    assert.equal(activated.rows.coordination.acceptances.length, 0);
    assert.equal(activated.rows.coordination.publications.length, 0);
    checks.push("Web and mobile owners export identical original v1/v2/v3 history, canonical basis and receipts without usable credentials");

    const restore = (store: WalletStore, text = accepted.serialized, checksum = accepted.inspection.checksum) => restoreInitialMarketplaceWalletBackup({
      mode: MODE, store, backup: text, expectedChecksum: checksum, acknowledgeFreshTarget: true, clock: () => RESTORE_AT,
    });
    stage = "old recovery formats remain isolated";
    await assert.rejects(exportMarketplaceWalletBackup({ mode: MODE, store: source, ...ownerInput(acceptedFixture), clock: () => EXPORT_AT }));
    await assert.rejects(exportV3WalletBackup({ mode: MODE, store: source, clock: () => EXPORT_AT }));
    assert.throws(() => inspectMarketplaceWalletBackup(accepted.serialized));
    let oldTransactions = 0;
    const oldObserved: WalletStore = { transaction: work => { oldTransactions++; return target.transaction(work); }, close: async () => undefined };
    await assert.rejects(restoreMarketplaceWalletBackup({ mode: MODE, store: oldObserved, backup: accepted.serialized,
      expectedChecksum: accepted.inspection.checksum, acknowledgeFreshTarget: true, clock: () => RESTORE_AT }));
    const retainedV2 = readFileSync(resolve(process.cwd(), "src/lib/alpha-wallet/fixtures/v2/corrections-and-settlement.backup.json"), "utf8");
    await assert.rejects(restore(oldObserved, retainedV2, JSON.parse(retainedV2).checksum));
    assert.equal(oldTransactions, 0);
    await fresh(target);
    checks.push("Initial, isolated-v3 and historical correction/isolated-v2 formats cannot substitute for one another or open a restore transaction");

    stage = "resigned canonical corruption refusal";
    const corrupt = JSON.parse(accepted.serialized);
    corrupt.canonical.purchase_requests.find((row: { id: string }) => row.id === acceptedFixture.requestId).payload.usdtAmount = "201";
    const corruptText = resigned(corrupt);
    let invalidTransactions = 0;
    const observed: WalletStore = { transaction: work => { invalidTransactions++; return target.transaction(work); }, close: async () => undefined };
    await assert.rejects(restore(observed, corruptText, JSON.parse(corruptText).checksum));
    assert.equal(invalidTransactions, 0);
    await fresh(target);
    checks.push("A recomputed checksum cannot hide canonical/principal disagreement; invalid bytes never access the target");

    stage = "native fault rollback at the new quarantine command";
    let pauseFailed = false;
    await assert.rejects(restore(wrapped(target, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (sql.startsWith("INSERT INTO alpha_wallet_simulation.commands") && params?.[2] === "pause"
          && String(params?.[1]).includes("initial-marketplace-backup-recovery")) {
          pauseFailed = true; await tx.query("SELECT 1 / 0");
        }
        return tx.query<Row>(sql, params);
      },
    }))));
    assert(pauseFailed); await fresh(target);
    checks.push("A native SQL error at quarantine rolls back every replayed command and newly created wallet schema");

    stage = "native fault rollback after canonical persistence";
    let canonicalFailed = false;
    await assert.rejects(restore(wrapped(target, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (/^\s*INSERT INTO alpha_exchange\.purchase_requests\b/i.test(sql)) {
          canonicalFailed = true; await tx.query("SELECT 1 / 0");
        }
        return result;
      },
    }))));
    assert(canonicalFailed); await fresh(target);
    checks.push("A native SQL error after canonical insertion rolls back financial replay and marketplace restoration together");

    stage = "native late fault rollback after immutable receipt completion";
    let receiptFailed = false;
    await assert.rejects(restore(wrapped(target, tx => ({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (/^\s*UPDATE alpha_wallet_initial_marketplace_simulation\.recovery_receipts\b/i.test(sql)) {
          receiptFailed = true; await tx.query("SELECT 1 / 0");
        }
        return result;
      },
    }))));
    assert(receiptFailed); await fresh(target);
    checks.push("A late native error after completed recovery receipt and guard installation leaves the target empty");

    stage = "native canonical fence after explicitly flushed deferred constraints";
    let constraintsFlushed = false;
    await assert.rejects(target.transaction(async tx => {
      await restore(inside(tx));
      await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
      constraintsFlushed = true;
      await tx.query("SET CONSTRAINTS ALL DEFERRED");
      await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=payload WHERE id=$1", [acceptedFixture.otherRequestId]);
    }), { code: "P0001", message: /Recovered initial marketplace remains quarantined/ });
    assert(constraintsFlushed); await fresh(target);
    checks.push("Immediate canonical statement fences reject a late sibling write even after all earlier deferred checks were explicitly flushed");

    stage = "native deferred COMMIT refusal of late authentication tables";
    let authenticationCreated = false;
    await assert.rejects(target.transaction(async tx => {
      await restore(inside(tx));
      // This exercises ordinary deferred completion, not hostile DDL after a
      // caller deliberately flushed every deferred event. Privileged schema
      // bypass is outside this disposable development role's security boundary.
      await tx.exec(`CREATE TABLE alpha_exchange.mobile_device_sessions (id text PRIMARY KEY);
        CREATE TABLE alpha_exchange.mobile_refresh_token_history (token_hash text PRIMARY KEY);`);
      authenticationCreated = true;
    }), { code: "P0001", message: /Initial combined recovery must not restore sessions, credentials or enabled accounts/ });
    assert(authenticationCreated); await fresh(target);
    checks.push("Native deferred COMMIT rejects authentication relations created after application validation and rolls back the complete recovery");

    stage = "swallowed runtime refusal still poisons the original native transaction";
    let runtimeFlipped = false, refusalCaught = false;
    const previousRuntime = process.env.VERCEL;
    try {
      await assert.rejects(target.transaction(async tx => {
        const injected: WalletSql = { exec: sql => tx.exec(sql),
          async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
            const result = await tx.query<Row>(sql, params);
            if (/^\s*UPDATE alpha_wallet_initial_marketplace_simulation\.recovery_receipts\b/i.test(sql)) {
              runtimeFlipped = true; process.env.VERCEL = "synthetic-runtime-flip";
            }
            return result;
          },
        };
        try { await restore(inside(injected)); }
        catch { refusalCaught = true; }
        finally {
          if (previousRuntime === undefined) delete process.env.VERCEL; else process.env.VERCEL = previousRuntime;
        }
        // Deliberately swallow the refusal: the real transaction owner must
        // still refuse COMMIT after its participant reports the runtime change.
        return "a caller tried to continue after a refused recovery";
      }));
    } finally {
      if (previousRuntime === undefined) delete process.env.VERCEL; else process.env.VERCEL = previousRuntime;
    }
    assert(runtimeFlipped && refusalCaught); await fresh(target);
    checks.push("Restoring the environment after catching a late runtime refusal cannot commit earlier native recovery writes");

    stage = "actual native commit followed by injected lost acknowledgement";
    const lostReply: WalletStore = { close: async () => undefined,
      async transaction<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
        await target.transaction(work);
        throw new CommitOutcomeUnknownError(new Error("Synthetic loss after actual native COMMIT"));
      },
    };
    await assert.rejects(restore(lostReply), error => error instanceof CommitOutcomeUnknownError);
    const contexts = await target.transaction(tx => tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${SCHEMA}.transaction_contexts`));
    assert.equal(contexts.rows[0].count, "1", "Historical transaction registrations must never be imported");
    await target.close();
    target = await connect(urls.target);
    const recovered = await inspectRestoredInitialMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: accepted.inspection.checksum });
    assert.equal(recovered.quarantined, true);
    assert.deepEqual(recovered.source, accepted.inspection.checkpoint);
    assert.equal(recovered.restored.revision, accepted.inspection.checkpoint.revision + 1);
    checks.push("Unknown COMMIT is resolved by reopening the same target and verifying its immutable receipt and new pause");

    stage = "exact native accepted history and custody conservation";
    const targetCommands = await history(target);
    assert.deepEqual(targetCommands.slice(0, -1), accepted.commands);
    assert.deepEqual(await target.transaction(tx => readInitialMarketplaceRecoveryRows(tx)), accepted.rows);
    assert.deepEqual(await initialFinancialRows(target), accepted.financial);
    const state = verifyV3History(targetCommands).state;
    assert(isV3State(state)); assertV3Invariants(state);
    assert.equal(balance(state, TRON, `trade:${acceptedFixture.walletTradeId}`), BigInt("200000000"));
    assert.equal(balance(state, TRON, `listing:${acceptedFixture.walletListingId}`), BigInt("300000000"));
    assert.equal(expectedCustody(state, TRON), BigInt("500000000"));
    assert(state.haltReason); assert.equal(state.payouts.size, 0);
    assert.equal(state.initialBindings.size, 1); assert.equal(state.initialAcceptanceReceipts.size, 1);
    checks.push("Accepted recovery preserves original hashes, canonical events and financial receipts: 200 reserved plus 300 available equals 500 synthetic USDT");

    stage = "restored authority quarantine and exact writer guards";
    await target.transaction(tx => assertInitialMarketplaceRecoveryIdentityQuarantine(tx));
    await assert.rejects(web(target, RESTORE_AT).inspect(ownerInput(acceptedFixture)));
    await assert.rejects(web(target, RESTORE_AT).acceptRequest(sellerInput(acceptedFixture)));
    await assert.rejects(mobile(target, RESTORE_AT).inspect({ ...acceptedFixture.mobile.credentials[acceptedFixture.ownerId], requestId: acceptedFixture.requestId }));
    await assert.rejects(createV3DurableWallet({ mode: MODE, store: target }).snapshot());
    for (const requestId of [acceptedFixture.requestId, acceptedFixture.otherRequestId]) {
      await assert.rejects(target.transaction(tx => tx.query(
        "UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{buyerNotes}',$2::jsonb) WHERE id=$1",
        [requestId, JSON.stringify("changed")])), { code: "P0001", message: /Recovered initial marketplace remains quarantined/ });
    }
    await assert.rejects(restore(target));
    await assert.rejects(inspectRestoredInitialMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: "f".repeat(64) }));
    await assert.rejects(target.transaction(tx => tx.query(`UPDATE ${SCHEMA}.recovery_receipts SET receipt=receipt`)));
    assert.deepEqual(await inspectRestoredInitialMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: accepted.inspection.checksum }), recovered);
    checks.push("Web/mobile credentials, standalone wallet reads, legacy writers, overwriting retries and recovery-receipt changes remain refused");

    stage = "competing native restores preserve a pending activated request without inventing acceptance";
    const competitor = await connect(urls.race);
    let entrants = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolveBarrier => { release = resolveBarrier; });
    const backendIds = new Set<number>();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const failedArrival = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Competing recovery backend did not reach its bounded barrier")), 3000);
    });
    const overlapping = (store: WalletStore) => wrapped(store, tx => {
      let firstProbe = true;
      return { exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          if (firstProbe && sql.includes("txid_current()::text AS transaction_id") && sql.includes("transaction_isolation")) {
            firstProbe = false;
            backendIds.add((await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
            entrants++;
            if (entrants <= 2) { if (entrants === 2) release(); await Promise.race([barrier, failedArrival]); }
          }
          return tx.query<Row>(sql, params);
        },
      };
    });
    const restoreActivated = (store: WalletStore) => restore(store, activated.serialized, activated.inspection.checksum);
    const results = await Promise.allSettled([restoreActivated(overlapping(race)), restoreActivated(overlapping(competitor))])
      .finally(() => { if (deadline !== undefined) clearTimeout(deadline); });
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal(backendIds.size, 2, "Competing restores must use two actual PostgreSQL backends");
    const raced = await inspectRestoredInitialMarketplaceWallet({ mode: MODE, store: race, expectedChecksum: activated.inspection.checksum });
    const racedCommands = await history(race);
    assert.deepEqual(racedCommands.slice(0, -1), activated.commands);
    assert.deepEqual(await race.transaction(tx => readInitialMarketplaceRecoveryRows(tx)), activated.rows);
    assert.deepEqual(await initialFinancialRows(race), activated.financial);
    await race.transaction(tx => assertInitialMarketplaceRecoveryIdentityQuarantine(tx));
    const pendingState = verifyV3History(racedCommands).state;
    assert(isV3State(pendingState)); assertV3Invariants(pendingState);
    assert(pendingState.haltReason);
    assert.equal(pendingState.initialBindings.size, 0); assert.equal(pendingState.initialAcceptanceReceipts.size, 0);
    assert.equal(balance(pendingState, TRON, `listing:${activatedFixture.walletListingId}`), BigInt("500000000"));
    assert.equal(balance(pendingState, TRON, `trade:${activatedFixture.walletTradeId}`), BigInt(0));
    assert.equal(expectedCustody(pendingState, TRON), BigInt("500000000"));
    checks.push("Two native backends compete for one activated-only target; one wins, preserving pending consent and all 500 synthetic USDT without a trade receipt");

    stage = "both sources remain exact and durably paused";
    assert.deepEqual(await history(source), accepted.commands);
    assert.deepEqual(await history(activatedSource), activated.commands);
    assert.equal((await web(source, EXPORT_AT).inspect(ownerInput(acceptedFixture))).wallet.halted, true);
    assert.equal((await web(activatedSource, EXPORT_AT).inspect(ownerInput(activatedFixture))).wallet.halted, true);
    checks.push("Both source histories remain unchanged and paused; neither successful restore creates an active financial copy");

    return { kind: "alpha-wallet-native-initial-marketplace-recovery-v1", mode: MODE, status: "passed", checks,
      acceptedSource: accepted.inspection.checkpoint, acceptedRestored: recovered.restored,
      activatedSource: activated.inspection.checkpoint, activatedRestored: raced.restored,
      canonicalRowCounts: accepted.inspection.canonicalRowCounts, coordinationRowCounts: accepted.inspection.coordinationRowCounts,
      allSourcesPaused: true, allTargetsPaused: true, credentialsRestored: false, historicalContextsRestored: false,
      providerSubmissions: 0, conservedPrincipalRaw: "500000000", acceptedTradeReservedRaw: "200000000",
      acceptedListingAvailableRaw: "300000000", activatedListingAvailableRaw: "500000000",
      concurrentRestoreResults: { fulfilled: 1, rejected: 1, distinctBackends: backendIds.size },
      responseLoss: "Injected after an actual native COMMIT; not a physical network partition",
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
    error: error instanceof Error ? error.message : "Unknown initial development recovery failure" })}\n`);
  process.exitCode = 1;
});
