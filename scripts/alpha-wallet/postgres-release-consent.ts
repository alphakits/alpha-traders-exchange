/** Native, nonauthoritative seller-consent proofs in seven explicit disposable databases.
 * All records, credentials, funds and observations are synthetic. No database is
 * created or dropped, no ambient application URL is read, and no source/provider,
 * signer, network delivery, payout or live authority is invoked.
 */
import { strict as assert } from "node:assert";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { balance } from "../../src/lib/alpha-wallet/ledger";
import { createDevelopmentPaymentMarketplaceWalletCoordinator } from "../../src/lib/alpha-wallet/payment-marketplace-coordinator";
import { createDevelopmentReleaseConsentCoordinator, createDevelopmentMobileReleaseConsentCoordinator } from "../../src/lib/alpha-wallet/release-consent-coordinator";
import {
  exportReleaseConsentMarketplaceWalletBackup, inspectReleaseConsentMarketplaceWalletBackup,
  restoreReleaseConsentMarketplaceWalletBackup, inspectRestoredReleaseConsentMarketplaceWallet,
} from "../../src/lib/alpha-wallet/release-consent-backup";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { verifyV5History } from "../../src/lib/alpha-wallet/v5-durable";
import { isV5State } from "../../src/lib/alpha-wallet/v5-engine";
import { PAYMENT_MARKETPLACE_SYNTHETIC_REASON } from "./payment-marketplace-fixtures";
import { buildReleaseConsentFixture } from "./release-consent-fixtures";

const MODE = "simulation-only" as const;
const databaseKeys = ["atomic", "source-race", "dispute-race", "pause-race", "auth", "target", "restore-race"] as const;
type DatabaseKey = typeof databaseKeys[number];
type Row = Record<string, unknown>;
type Fixture = Awaited<ReturnType<typeof buildReleaseConsentFixture>>;
const SCHEMA = "alpha_wallet_release_consent_simulation";
let stage = "explicit empty fixture arguments";
const USAGE = "Pass --fresh-simulation-databases and seven explicit different already-created empty loopback alpha_wallet_dev_ URLs via --atomic-connection-string, --source-race-connection-string, --dispute-race-connection-string, --pause-race-connection-string, --auth-connection-string, --target-connection-string and --restore-race-connection-string. No ambient database URL is read; no database is created or dropped.";
function argumentsOf(args: string[]) {
  assert.equal(args.length, databaseKeys.length * 2 + 1, USAGE);
  const urls = new Map<DatabaseKey, string>(); let fresh = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === "--fresh-simulation-databases") { assert(!fresh, USAGE); fresh = true; continue; }
    const key = databaseKeys.find(key => flag === `--${key}-connection-string`);
    assert(key && !urls.has(key) && args[index + 1] && !args[index + 1]!.startsWith("--"), USAGE);
    urls.set(key, args[++index]!);
  }
  assert(fresh && urls.size === databaseKeys.length, USAGE);
  assert.equal(new Set([...urls.values()].map(value => decodeURIComponent(new URL(value).pathname))).size, databaseKeys.length, USAGE);
  return Object.fromEntries(urls) as Record<DatabaseKey, string>;
}
const inside = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
const wrapped = (store: WalletStore, transform: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(transform(tx))), close: async () => undefined,
});
function loseOneReplyAfterCommit(store: WalletStore): WalletStore {
  let lose = true;
  return { async transaction(work) {
    const result = await store.transaction(work);
    if (lose) { lose = false; throw new CommitOutcomeUnknownError(new Error("Synthetic acknowledgement loss after actual native release-consent COMMIT")); }
    return result;
  }, close: async () => undefined };
}
async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    assert.equal((await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'")).rows.length, 0);
    assert.equal((await tx.query("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")).rows.length, 0);
    assert.equal((await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user")).rows[0]?.permitted, true);
    assert(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/GMT0"].includes((await tx.query<{ timezone: string }>("SELECT current_setting('TimeZone') AS timezone")).rows[0]!.timezone));
  });
}
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined); return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Native release-consent timeout: ${label}`)), 15_000);
  })]); } finally { if (timer) clearTimeout(timer); }
}
async function waitForLock(observer: WalletStore, pid: number) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const rows = await observer.transaction(tx => tx.query<{ waiting: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') AS waiting", [pid]));
    if (rows.rows[0]?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Expected a distinct native PostgreSQL backend to visibly wait on the held transaction");
}
async function contend<First, Second>(first: WalletStore, second: WalletStore, observer: WalletStore,
  firstAction: (store: WalletStore) => Promise<First>, secondAction: (store: WalletStore) => Promise<Second>) {
  const held = deferred(), release = deferred(), started = deferred();
  let firstPid = 0, secondPid = 0, attempts = 0;
  const firstHeld: WalletStore = { close: async () => undefined, transaction: work => first.transaction(async tx => {
    firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const result = await work(tx); held.resolve(); await bounded(release.promise, "held transaction release"); return result;
  }) };
  const secondObserved: WalletStore = { close: async () => undefined, transaction: work => second.transaction(async tx => {
    attempts++;
    secondPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,(SELECT count(*) FROM pg_namespace) AS snapshot_marker")).rows[0]!.pid;
    started.resolve(); return work(tx);
  }) };
  const winner = firstAction(firstHeld); void winner.catch(held.reject);
  await bounded(held.promise, "first physical decision");
  const follower = secondAction(secondObserved); void follower.catch(started.reject);
  try {
    await bounded(started.promise, "second backend snapshot");
    assert.notEqual(firstPid, secondPid); await waitForLock(observer, secondPid); release.resolve();
    const outcomes = await bounded(Promise.allSettled([winner, follower]), "native competing outcomes");
    assert.equal(outcomes[0].status, "fulfilled");
    if (outcomes[0].status !== "fulfilled") assert.fail("The held first transaction did not commit");
    return { first: outcomes[0].value, second: outcomes[1], evidence: {
      firstBackendPid: firstPid, secondBackendPid: secondPid, distinctBackends: true, lockWaitObserved: true, serializationAttempts: attempts,
    } };
  } finally { release.resolve(); await Promise.allSettled([winner, follower]); }
}
async function legacyFootprint(store: WalletStore) {
  return store.transaction(async tx => {
    const commands = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const canonical: Record<string, Row[]> = {};
    for (const table of ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions", "marketplace_enforcement_records", "evidence", "disputes", "notifications", "audit_logs"]) {
      canonical[table] = (await tx.query<{ row: Row }>(`SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.row);
    }
    const predecessor: Record<string, Row[]> = {};
    for (const [schema, tables] of [["alpha_wallet_initial_marketplace_simulation", ["activations", "acceptances", "publications"]],
      ["alpha_wallet_cancellation_marketplace_simulation", ["transitions", "cancellations", "publications"]],
      ["alpha_wallet_payment_marketplace_simulation", ["transitions", "claims", "dispute_freezes", "publications"]]] as const) {
      for (const table of tables) predecessor[`${schema}.${table}`] = (await tx.query(`SELECT * FROM ${schema}.${table} ORDER BY ${table === "publications" ? "id" : "request_id"}`)).rows;
    }
    return { commands, snapshot: verifyV5History(commands), canonical, predecessor };
  });
}

const web = (store: WalletStore, fixture: Fixture) => createDevelopmentReleaseConsentCoordinator({
  mode: MODE, store, sourceStoreId: fixture.sourceStoreId, manifest: fixture.manifest, clock: fixture.clock,
});
const mobile = (store: WalletStore, fixture: Fixture) => createDevelopmentMobileReleaseConsentCoordinator({
  mode: MODE, store, sourceStoreId: fixture.sourceStoreId, manifest: fixture.manifest, clock: fixture.clock,
});
const oldWeb = (store: WalletStore, fixture: Fixture) => createDevelopmentPaymentMarketplaceWalletCoordinator({
  mode: MODE, store, clock: fixture.clock,
});
const enrollment = (fixture: Fixture, operationId = "native_release_enrollment") => ({
  ...fixture.ownerInput, operationId, prepared: fixture.prepared, acknowledgeNonAuthoritativeConsent: true as const,
});
const consent = (fixture: Fixture, reviewedBasisSha256: string, operationId: string) => ({
  ...fixture.sellerInput, operationId, reviewedBasisSha256,
});
function withoutAuthority(value: Awaited<ReturnType<typeof legacyFootprint>>) {
  return { ...value, canonical: Object.fromEntries(Object.entries(value.canonical).filter(([name]) => !["users", "runtime_meta"].includes(name))) };
}
function assertFullReservation(before: Awaited<ReturnType<typeof legacyFootprint>>, after: Awaited<ReturnType<typeof legacyFootprint>>, fixture: Fixture) {
  assert(isV5State(after.snapshot.state));
  for (const name of ["accounts", "journal", "payouts", "commissions", "evidenceOwners", "deposits", "listings"] as const) {
    assert.deepEqual(after.snapshot.state[name], before.snapshot.state[name], `Original V5 ${name} must remain unchanged`);
  }
  const trade = after.snapshot.state.trades.get(fixture.canonical.walletTradeId)!;
  assert.equal(balance(after.snapshot.state, fixture.canonical.assetId, `trade:${trade.id}`), trade.amountRaw);
  assert.equal(trade.evidence, undefined); assert.equal(trade.authorization, undefined); assert.equal(trade.payoutId, undefined);
  assert.equal(trade.status, "payment_reported");
}
async function noOverlay(store: WalletStore) {
  assert.equal((await store.transaction(tx => tx.query<{ present: boolean }>(
    "SELECT to_regnamespace($1) IS NOT NULL AS present", [SCHEMA]))).rows[0]!.present, false);
}
async function stopped(fixture: Fixture, prefix: string) {
  fixture.advanceTime();
  const old = await fixture.payment.coordinator.inspect(fixture.ownerInput);
  if (!old.wallet.halted) await fixture.payment.coordinator.pause({ ...fixture.ownerInput, operationId: `${prefix}_old_pause` });
  fixture.advanceTime();
  if ((await fixture.inspectArchive()).state.status === "recording") {
    await fixture.coordinator.pause({ ...fixture.ownerInput, operationId: `${prefix}_overlay_pause`, reasonCode: "maintenance" });
  }
}

async function run(urls: Record<DatabaseKey, string>) {
  const open: WalletStore[] = [], checks: string[] = [];
  const raceEvidence: Record<string, unknown> = {};
  const connect = async (connectionString: string) => {
    const store = await createPostgresWalletStore({ mode: MODE, connectionString }); open.push(store); return store;
  };
  try {
    const stores = {} as Record<DatabaseKey, WalletStore>;
    for (const key of databaseKeys) stores[key] = await connect(urls[key]);
    for (const key of databaseKeys) await fresh(stores[key]);
    checks.push("Seven explicit distinct empty loopback development databases are admitted without ambient application URLs");

    stage = "actual retained V5 claim and explicit owner enrollment";
    const atomic = await buildReleaseConsentFixture(stores.atomic, { enroll: false });
    const original = await legacyFootprint(stores.atomic);
    await assert.rejects(atomic.coordinator.enroll({ ...enrollment(atomic), sessionToken: atomic.canonical.sellerSessionToken }));
    await assert.rejects(atomic.coordinator.enroll({ ...enrollment(atomic), acknowledgeNonAuthoritativeConsent: false as true }));
    await noOverlay(stores.atomic); assert.deepEqual(await legacyFootprint(stores.atomic), original);
    let enrollmentFault = false;
    const brokenEnrollment = wrapped(stores.atomic, tx => ({ ...tx,
      async query<T extends Row>(sql: string, values?: unknown[]) {
        const result = await tx.query<T>(sql, values);
        if (/INSERT INTO\s+alpha_wallet_release_consent_simulation\.records\b/i.test(sql)) {
          enrollmentFault = true; await tx.query("SELECT 1 / 0 /* actual native overlay enrollment rollback */");
        }
        return result;
      },
    }));
    await assert.rejects(web(brokenEnrollment, atomic).enroll(enrollment(atomic, "native_failed_enrollment")));
    assert(enrollmentFault); await noOverlay(stores.atomic); assert.deepEqual(await legacyFootprint(stores.atomic), original);
    const admitted = await atomic.coordinator.enroll(enrollment(atomic));
    assert.equal(admitted.receipt.disposition, "enrolled"); assert.equal(admitted.executionAuthority, false); assert.equal(admitted.releaseAuthority, false);
    assert.deepEqual(await legacyFootprint(stores.atomic), original);
    checks.push("Owner-only acknowledged enrollment and actual late SQL failure preserve every original V5 command and canonical row; successful enrollment adds only the new overlay");

    stage = "current seller review and native append rollback";
    const review = await atomic.coordinator.inspect(atomic.sellerInput);
    assert.equal(review.canConsent, true); assert.equal(review.currentPreconditionsMatch, false);
    assert(review.reviewedBasisSha256); const originalArchive = await atomic.inspectArchive();
    const firstConsent = consent(atomic, review.reviewedBasisSha256, "native_first_seller_consent");
    await assert.rejects(atomic.coordinator.consent({ ...firstConsent, sessionToken: atomic.canonical.ownerSessionToken }));
    await assert.rejects(atomic.coordinator.consent({ ...firstConsent, sessionToken: atomic.canonical.buyerSessionToken }));
    await assert.rejects(atomic.coordinator.consent({ ...firstConsent, reviewedBasisSha256: "f".repeat(64) }));
    assert.deepEqual(await atomic.inspectArchive(), originalArchive);
    for (const point of ["record", "head", "seal"] as const) {
      let reached = false, wroteRecord = false;
      const failed = wrapped(stores.atomic, tx => ({
        async query<T extends Row>(sql: string, values?: unknown[]) {
          const result = await tx.query<T>(sql, values);
          if (/INSERT INTO\s+alpha_wallet_release_consent_simulation\.records\b/i.test(sql)) wroteRecord = true;
          if ((point === "record" && /INSERT INTO\s+alpha_wallet_release_consent_simulation\.records\b/i.test(sql))
            || (point === "head" && /UPDATE\s+alpha_wallet_release_consent_simulation\.head\b/i.test(sql) && /archive_json/i.test(sql))) {
            reached = true; await tx.query("SELECT 1 / 0 /* actual native release consent append rollback */");
          }
          return result;
        },
        async exec(sql) {
          await tx.exec(sql);
          if (point === "seal" && wroteRecord && sql.trim() === "SET CONSTRAINTS ALL IMMEDIATE") {
            reached = true; await tx.query("SELECT 1 / 0 /* actual native release consent seal rollback */");
          }
        },
      }));
      await assert.rejects(web(failed, atomic).consent({ ...firstConsent, operationId: `native_rollback_${point}` }));
      assert(reached, `The native ${point} failure must actually execute`);
      assert.deepEqual(await atomic.inspectArchive(), originalArchive); assert.deepEqual(await legacyFootprint(stores.atomic), original);
    }
    checks.push("Current retained seller participation and the exact reviewed basis are required; actual record, head and final-seal failures roll back the complete consent");

    stage = "actual committed consent acknowledgement loss and same-target recovery";
    await assert.rejects(web(loseOneReplyAfterCommit(stores.atomic), atomic).consent(firstConsent), error => error instanceof CommitOutcomeUnknownError);
    const committed = await atomic.inspectArchive(), originalReceipt = committed.records.at(-1)!.receipt;
    assert.equal(originalReceipt.disposition, "consented"); assert.equal(committed.state.consents.length, 1);
    const reopened = await connect(urls.atomic);
    const recovered = await web(reopened, atomic).reconcile({ ...atomic.sellerInput, operationId: firstConsent.operationId,
      expectedPhysicalStoreId: review.physicalStoreId });
    assert.equal(recovered.status, "recorded"); assert.deepEqual(recovered.receipt, originalReceipt);
    const retried = await mobile(reopened, atomic).consent({ ...atomic.mobileSellerInput,
      operationId: firstConsent.operationId, reviewedBasisSha256: firstConsent.reviewedBasisSha256 });
    assert.equal(retried.replayed, true); assert.deepEqual(retried.receipt, originalReceipt);
    const unresolved = await web(reopened, atomic).reconcile({ ...atomic.sellerInput, operationId: "never_recorded_native_consent",
      expectedPhysicalStoreId: review.physicalStoreId });
    assert.equal(unresolved.status, "unresolved"); assert.equal(unresolved.receipt, null); assert.equal(unresolved.releaseAuthority, false);
    await assert.rejects(web(reopened, atomic).reconcile({ ...atomic.sellerInput, operationId: firstConsent.operationId, expectedPhysicalStoreId: "f".repeat(64) }));
    assert.deepEqual(await atomic.inspectArchive(), committed); assert.deepEqual(await legacyFootprint(stores.atomic), original);
    checks.push("After actual COMMIT reply loss a separate pool and current mobile credentials recover the exact original consent without refreshing expiry; missing and wrong physical-target recovery grants no retry authority");

    stage = "duplicate and regressed source observations cannot extend or roll back seller consent";
    const oldExpiry = committed.state.consents[0]!.expiresAtMs;
    const corroborated = await atomic.coordinator.observe({ ...atomic.ownerInput, operationId: "native_corroborated_source", prepared: await atomic.prepare() });
    assert.equal(corroborated.receipt.disposition, "corroborated");
    assert.equal((await atomic.coordinator.inspect(atomic.sellerInput)).currentPreconditionsMatch, true);
    assert.equal((await atomic.inspectArchive()).state.consents[0]!.expiresAtMs, oldExpiry);
    atomic.advanceTime(5);
    const advancedPrepared = await atomic.prepare({ revision: 2, observedAtMs: atomic.clock() - 1 });
    await atomic.coordinator.observe({ ...atomic.ownerInput, operationId: "native_source_revision_two", prepared: advancedPrepared });
    const advanced = await atomic.inspectArchive(); assert.equal(advanced.state.source.payments[0]!.latestSourceRevision, 2);
    assert.equal((await atomic.coordinator.inspect(atomic.sellerInput)).currentPreconditionsMatch, false);
    const stale = await atomic.coordinator.observe({ ...atomic.ownerInput, operationId: "native_stale_source_revision_one", prepared: await atomic.prepare() });
    assert.equal(stale.receipt.disposition, "stale-corroboration");
    const afterStale = await atomic.inspectArchive(); assert.equal(afterStale.state.source.payments[0]!.latestSourceRevision, 2);
    assert.equal(afterStale.state.latestPreparationSha256, advanced.state.latestPreparationSha256);
    assert.equal(afterStale.state.consents[0]!.expiresAtMs, oldExpiry);
    await assert.rejects(atomic.coordinator.consent({ ...firstConsent, operationId: "native_stale_reviewed_basis" }));
    const freshReview = await atomic.coordinator.inspect(atomic.sellerInput); assert(freshReview.reviewedBasisSha256);
    const secondConsent = await atomic.coordinator.consent(consent(atomic, freshReview.reviewedBasisSha256, "native_second_seller_consent"));
    await atomic.coordinator.revoke({ ...atomic.sellerInput, operationId: "native_seller_revocation", consentOperationId: secondConsent.receipt.operationId });
    assert.equal((await atomic.coordinator.inspect(atomic.sellerInput)).currentPreconditionsMatch, false);
    assert.deepEqual(await legacyFootprint(stores.atomic), original);
    checks.push("Exact source corroboration never extends consent expiry, source revision two invalidates the old review, stale revision one cannot regress the retained source, and seller revocation preserves historical receipts");

    stage = "native source revocation wins before seller consent";
    const sourceRace = await buildReleaseConsentFixture(stores["source-race"], { paymentMethod: "Face-to-Face", assetId: "bsc-sim-binance-peg-usdt" });
    const sourceBefore = await legacyFootprint(stores["source-race"]), sourceReview = await sourceRace.coordinator.inspect(sourceRace.sellerInput);
    assert(sourceReview.reviewedBasisSha256); sourceRace.advanceTime(5);
    const revokedPrepared = await sourceRace.prepare({ revision: 2, status: "revoked", observedAtMs: sourceRace.clock() - 1 });
    const sourceResult = await contend(stores["source-race"], await connect(urls["source-race"]), await connect(urls["source-race"]),
      store => web(store, sourceRace).observe({ ...sourceRace.ownerInput, operationId: "native_source_revocation", prepared: revokedPrepared }),
      store => web(store, sourceRace).consent(consent(sourceRace, sourceReview.reviewedBasisSha256!, "native_consent_after_revocation")));
    assert.equal(sourceResult.first.receipt.disposition, "source-revocation-quarantined");
    assert.equal(sourceResult.second.status, "rejected"); assert(sourceResult.evidence.serializationAttempts >= 2);
    assert.equal((await sourceRace.inspectArchive()).state.consents.length, 0);
    assert.equal((await sourceRace.coordinator.inspect(sourceRace.sellerInput)).canConsent, false);
    assert.deepEqual(await legacyFootprint(stores["source-race"]), sourceBefore);
    raceEvidence.sourceRevocation = sourceResult.evidence;
    checks.push("Distinct visibly waiting native backends serialize source revocation before seller consent; the whole stale decision retries, the source is quarantined, no consent or financial movement is recorded");

    stage = "unchanged V5 buyer dispute wins before seller consent";
    const disputeRace = await buildReleaseConsentFixture(stores["dispute-race"]);
    const disputeBefore = await legacyFootprint(stores["dispute-race"]);
    const disputeReview = await disputeRace.coordinator.inspect(disputeRace.sellerInput); assert(disputeReview.reviewedBasisSha256);
    assert.equal(disputeRace.sourceStoreId, atomic.sourceStoreId);
    assert.notEqual(disputeReview.physicalStoreId, review.physicalStoreId);
    await disputeRace.coordinator.consent(consent(disputeRace, disputeReview.reviewedBasisSha256, firstConsent.operationId));
    await assert.rejects(disputeRace.coordinator.reconcile({ ...disputeRace.sellerInput, operationId: firstConsent.operationId,
      expectedPhysicalStoreId: review.physicalStoreId }));
    const disputeArchive = await disputeRace.inspectArchive();
    checks.push("Separately provisioned stores with the same logical source label and recorded operation still have distinct installation identities; original-target reconciliation refuses the other database");
    const disputeResult = await contend(stores["dispute-race"], await connect(urls["dispute-race"]), await connect(urls["dispute-race"]),
      store => oldWeb(store, disputeRace).openDispute({ ...disputeRace.buyerInput, operationId: "native_original_buyer_dispute", reason: PAYMENT_MARKETPLACE_SYNTHETIC_REASON }),
      store => web(store, disputeRace).consent(consent(disputeRace, disputeReview.reviewedBasisSha256!, "native_consent_after_dispute")));
    assert.equal(disputeResult.second.status, "rejected"); assert(disputeResult.evidence.serializationAttempts >= 2);
    const disputed = await legacyFootprint(stores["dispute-race"]); assertFullReservation(disputeBefore, disputed, disputeRace);
    assert.deepEqual(disputed.commands.slice(0, -1), disputeBefore.commands); assert.equal(disputed.commands.at(-1)!.command_type, "freezeInitialDispute");
    assert.equal(disputed.snapshot.state.trades.get(disputeRace.canonical.walletTradeId)!.disputed, true);
    assert.deepEqual(await disputeRace.inspectArchive(), disputeArchive);
    assert.equal((await disputeRace.coordinator.inspect(disputeRace.sellerInput)).canConsent, false);
    raceEvidence.originalBuyerDispute = disputeResult.evidence;
    checks.push("The unchanged V5 buyer dispute visibly wins a real backend race, appends its original frozen command and holds all principal; the new seller consent retries and refuses without changing its overlay");

    stage = "unchanged V5 owner pause wins before seller consent";
    const pauseRace = await buildReleaseConsentFixture(stores["pause-race"], { paymentMethod: "Face-to-Face", assetId: "bsc-sim-binance-peg-usdt" });
    const pauseBefore = await legacyFootprint(stores["pause-race"]), pauseArchive = await pauseRace.inspectArchive();
    const pauseReview = await pauseRace.coordinator.inspect(pauseRace.sellerInput); assert(pauseReview.reviewedBasisSha256);
    const pauseResult = await contend(stores["pause-race"], await connect(urls["pause-race"]), await connect(urls["pause-race"]),
      store => oldWeb(store, pauseRace).pause({ ...pauseRace.ownerInput, operationId: "native_original_owner_pause" }),
      store => web(store, pauseRace).consent(consent(pauseRace, pauseReview.reviewedBasisSha256!, "native_consent_after_pause")));
    assert.equal(pauseResult.second.status, "rejected"); assert(pauseResult.evidence.serializationAttempts >= 2);
    const paused = await legacyFootprint(stores["pause-race"]); assertFullReservation(pauseBefore, paused, pauseRace);
    assert.deepEqual(paused.commands.slice(0, -1), pauseBefore.commands); assert.equal(paused.commands.at(-1)!.command_type, "pause");
    assert(paused.snapshot.state.haltReason); assert.deepEqual(await pauseRace.inspectArchive(), pauseArchive);
    assert.equal((await pauseRace.coordinator.inspect(pauseRace.sellerInput)).canConsent, false);
    raceEvidence.originalOwnerPause = pauseResult.evidence;
    checks.push("The original V5 owner pause remains usable after enrollment and wins an observed native lock race; no consent, payout or release can follow the inherited stop");

    stage = "current stored seller revocation and historical receipt refusal";
    const auth = await buildReleaseConsentFixture(stores.auth, { assetId: "bsc-sim-binance-peg-usdt" });
    const authReview = await auth.coordinator.inspect(auth.sellerInput); assert(authReview.reviewedBasisSha256);
    const historicalConsent = consent(auth, authReview.reviewedBasisSha256, "native_auth_original_consent");
    await auth.coordinator.consent(historicalConsent);
    const authBefore = await legacyFootprint(stores.auth), authArchive = await auth.inspectArchive();
    const authResult = await contend(stores.auth, await connect(urls.auth), await connect(urls.auth),
      store => store.transaction(tx => tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true'::jsonb) WHERE id=$1", [auth.canonical.sellerId])),
      store => web(store, auth).consent({ ...historicalConsent, operationId: "native_after_seller_disabled" }));
    assert.equal(authResult.second.status, "rejected"); assert(authResult.evidence.serializationAttempts >= 2);
    await assert.rejects(auth.coordinator.consent(historicalConsent));
    await assert.rejects(auth.mobile.consent({ ...auth.mobileSellerInput, operationId: historicalConsent.operationId, reviewedBasisSha256: historicalConsent.reviewedBasisSha256 }));
    await assert.rejects(auth.coordinator.receipt({ ...auth.sellerInput, operationId: historicalConsent.operationId, expectedPhysicalStoreId: authReview.physicalStoreId }));
    assert.deepEqual(await auth.inspectArchive(), authArchive);
    assert.deepEqual(withoutAuthority(await legacyFootprint(stores.auth)), withoutAuthority(authBefore));
    raceEvidence.currentSellerRevocation = authResult.evidence;
    checks.push("Current stored seller revocation wins on a distinct observed waiting backend; neither a new consent nor web/mobile historical receipt recovery can revive disabled authority");

    stage = "original buyer dispute after consent and complete stopped source";
    atomic.advanceTime();
    await atomic.payment.coordinator.openDispute({ ...atomic.buyerInput, operationId: "native_post_consent_original_dispute", reason: PAYMENT_MARKETPLACE_SYNTHETIC_REASON });
    assertFullReservation(original, await legacyFootprint(stores.atomic), atomic);
    for (const [fixture, prefix] of [[atomic, "atomic"], [sourceRace, "source"], [disputeRace, "dispute"], [pauseRace, "pause"], [auth, "auth"]] as const) {
      await stopped(fixture, `native_final_${prefix}`);
    }
    const serialized = await exportReleaseConsentMarketplaceWalletBackup({ mode: MODE, store: stores.atomic,
      sourceStoreId: atomic.sourceStoreId, manifest: atomic.manifest, ...atomic.ownerInput, clock: atomic.clock });
    const inspection = inspectReleaseConsentMarketplaceWalletBackup(serialized);
    assert.equal(inspection.releaseAuthority, false); assert.equal(inspection.executionAuthority, false);
    checks.push("Existing buyer dispute and owner pause remain available after seller consent; all five source ledgers are stopped and complete combined export retains the original payment bytes and dispute");

    stage = "combined recovery rollback and acknowledgement uncertainty";
    let target = stores.target;
    const targetStoreId = "native_release_restore", restoreAt = atomic.clock() + 100;
    const restore = (store: WalletStore, operationId = "native_combined_restore", storeId = targetStoreId) => restoreReleaseConsentMarketplaceWalletBackup({
      mode: MODE, store, backup: serialized, expectedChecksum: inspection.checksum, acknowledgeFreshTarget: true,
      operationId, targetStoreId: storeId, clock: () => restoreAt,
    });
    for (const point of ["wallet", "quarantine", "canonical", "evidence", "initial", "cancellation", "claim", "dispute", "overlay", "overlay-quarantine", "seal"] as const) {
      let reached = false, wroteRecord = false;
      const failed = wrapped(target, tx => ({
        async query<T extends Row>(sql: string, values?: unknown[]) {
          const result = await tx.query<T>(sql, values);
          if (/INSERT INTO\s+alpha_wallet_release_consent_simulation\.records\b/i.test(sql)) wroteRecord = true;
          const matches = point === "wallet" && /INSERT INTO\s+alpha_wallet_simulation\.commands\b/i.test(sql)
            || point === "quarantine" && /INSERT INTO\s+alpha_wallet_simulation\.commands\b/i.test(sql)
              && Boolean(values?.some(value => typeof value === "string" && value.includes("payment-marketplace-backup-recovery")))
            || point === "canonical" && /INSERT INTO\s+alpha_exchange\.purchase_requests\b/i.test(sql)
            || point === "evidence" && /INSERT INTO\s+alpha_exchange\.evidence\b/i.test(sql)
            || point === "initial" && /INSERT INTO\s+alpha_wallet_initial_marketplace_simulation\.acceptances\b/i.test(sql)
            || point === "cancellation" && /INSERT INTO\s+alpha_wallet_cancellation_marketplace_simulation\.transitions\b/i.test(sql)
            || point === "claim" && /INSERT INTO\s+alpha_wallet_payment_marketplace_simulation\.claims\b/i.test(sql)
            || point === "dispute" && /INSERT INTO\s+alpha_wallet_payment_marketplace_simulation\.dispute_freezes\b/i.test(sql)
            || point === "overlay" && /INSERT INTO\s+alpha_wallet_release_consent_simulation\.records\b/i.test(sql)
            || point === "overlay-quarantine" && /INSERT INTO\s+alpha_wallet_release_consent_simulation\.records\b/i.test(sql)
              && Boolean(values?.some(value => typeof value === "string" && value.includes("quarantine-restore")));
          if (matches) { reached = true; await tx.query("SELECT 1 / 0 /* native whole combined restore rollback */"); }
          return result;
        },
        async exec(sql) {
          await tx.exec(sql);
          if (point === "seal" && wroteRecord && sql.trim() === "SET CONSTRAINTS ALL IMMEDIATE") {
            reached = true; await tx.query("SELECT 1 / 0 /* native combined recovery final seal rollback */");
          }
        },
      }));
      await assert.rejects(restore(failed)); assert(reached, `The combined ${point} failure must execute`); await fresh(target);
      checks.push(`Actual native ${point} recovery failure rolls back every canonical, predecessor, financial and consent row and all new schemas`);
    }
    await assert.rejects(target.transaction(async tx => {
      await tx.exec("CREATE TABLE public.release_recovery_companion(id integer PRIMARY KEY); INSERT INTO public.release_recovery_companion VALUES(1)");
      try { await restoreReleaseConsentMarketplaceWalletBackup({ mode: MODE, store: inside(tx), backup: serialized,
        expectedChecksum: inspection.checksum, acknowledgeFreshTarget: false as true, operationId: "native_invalid_preflight",
        targetStoreId, clock: () => restoreAt }); } catch { /* The caller cannot rescue this physical transaction. */ }
    }));
    await fresh(target);
    await assert.rejects(restore(loseOneReplyAfterCommit(target)), error => error instanceof CommitOutcomeUnknownError);
    await target.close(); target = await connect(urls.target);
    const restored = await inspectRestoredReleaseConsentMarketplaceWallet({ mode: MODE, store: target,
      expectedChecksum: inspection.checksum, targetStoreId });
    assert.equal(restored.quarantined, true); assert.equal(restored.executionAuthority, false); assert.equal(restored.releaseAuthority, false);
    assert.notEqual(restored.physicalStoreId, inspection.sourcePhysicalStoreId);
    const sourceHistory = await atomic.history(), targetHistory = (await legacyFootprint(target)).commands;
    assert.deepEqual(targetHistory.slice(0, -1), sourceHistory);
    assert.equal(targetHistory.at(-1)!.command_type, "pause");
    assertFullReservation(await legacyFootprint(stores.atomic), await legacyFootprint(target), atomic);
    assert((await legacyFootprint(target)).snapshot.state.haltReason);
    const targetWeb = web(target, atomic), targetMobile = mobile(target, atomic);
    await assert.rejects(targetWeb.inspect(atomic.ownerInput)); await assert.rejects(targetMobile.inspect(atomic.mobileOwnerInput));
    await assert.rejects(restore(target));
    assert.deepEqual(await inspectRestoredReleaseConsentMarketplaceWallet({ mode: MODE, store: target,
      expectedChecksum: inspection.checksum, targetStoreId, expectedPhysicalStoreId: restored.physicalStoreId }), restored);
    checks.push("Lost acknowledgement occurs after actual complete COMMIT; closing and reopening the target verifies one immutable import, one wallet quarantine, credential-free stopped identities and no overwrite or reactivated consent authority");

    stage = "two physical backends contend for one fresh combined recovery target";
    const restoreResult = await contend(stores["restore-race"], await connect(urls["restore-race"]), await connect(urls["restore-race"]),
      store => restore(store, "native_restore_race_first", "native_release_restore_race"),
      store => restore(store, "native_restore_race_second", "native_release_restore_race"));
    assert.equal(restoreResult.second.status, "rejected");
    const racedRecovery = await inspectRestoredReleaseConsentMarketplaceWallet({ mode: MODE, store: stores["restore-race"],
      expectedChecksum: inspection.checksum, targetStoreId: "native_release_restore_race" });
    assert.equal(racedRecovery.quarantined, true);
    raceEvidence.freshCombinedRestore = restoreResult.evidence;
    checks.push("Two distinct native restore backends visibly contend for one fresh destination; exactly one complete quarantined import wins and the other refuses without partial overwrite");

    stage = "source and target invariants after all recovery probes";
    assert.deepEqual(await atomic.history(), sourceHistory);
    return { kind: "alpha-wallet-native-release-consent-v1", mode: MODE, status: "passed", checks, races: raceEvidence,
      sourceWallet: inspection.sourceWallet, sourceOverlay: inspection.sourceOverlay,
      sourceArchiveSha256: (await atomic.inspectArchive()).archiveSha256,
      restoredPhysicalStoreId: restored.physicalStoreId, racedPhysicalStoreId: racedRecovery.physicalStoreId,
      backupChecksum: inspection.checksum, backupSha256: walletDigest(JSON.parse(serialized)),
      preservedV5CommandCount: sourceHistory.length, allSourcesPaused: true, allTargetsPaused: true,
      credentialsRestored: false, executionAuthority: false, releaseAuthority: false,
      providerSubmissions: 0, externalMessages: 0, productionWrites: 0,
      limits: ["Synthetic source consistency and disposable PostgreSQL fixtures only; no real bank verification or external financial authority.",
        "Reply loss is injected after actual PostgreSQL COMMIT; no physical network partition is simulated.",
        "Seller consent remains revocable preparation and never changes V5 financial history or authorizes release, signing or delivery.",
        "SQL quarantine is an application consistency boundary, not protection from a hostile superuser replacing database code."] };
  } finally {
    const results = await Promise.allSettled(open.map(store => store.close()));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--help") { process.stdout.write(`${USAGE}\n`); return; }
  assertSimulationRuntime(MODE);
  const report = await run(argumentsOf(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
main().catch(error => {
  process.stderr.write(`${JSON.stringify({ kind: "alpha-wallet-native-release-consent-v1", status: "failed", stage,
    error: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, null, 2)}\n`);
  process.exitCode = 1;
});


