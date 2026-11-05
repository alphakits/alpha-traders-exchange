/**
 * Native PostgreSQL verification of the private development marketplace/wallet
 * coordinator. Every database is explicit, empty, disposable and loopback-only.
 * No environment database URL, production route, provider or live funds are used.
 */
import { AssertionError, strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { Client } from "pg";
import type { AuthSession, PurchaseRequest } from "../../src/types/alpha-exchange";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "../../src/lib/alpha-wallet/durable";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertLedgerInvariants, balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { createMarketplaceCoordinationFixture } from "../../src/lib/alpha-wallet/marketplace-coordination-fixture";
import { initializeMarketplaceCoordination } from "../../src/lib/alpha-wallet/marketplace-coordination-store";
import { createDevelopmentMarketplaceWalletCoordinator, type DevelopmentMarketplaceAcceptanceReceipt } from "../../src/lib/alpha-wallet/marketplace-coordinator";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import { v2Command } from "../../src/lib/alpha-wallet/v2-commands";
import { isV2State } from "../../src/lib/alpha-wallet/v2-engine";
import { exportVersionedWalletBackup } from "../../src/lib/alpha-wallet/versioned-backup";
import { createVersionedDurableWallet, upgradeDurableWalletV2, verifyVersionedHistory } from "../../src/lib/alpha-wallet/versioned-durable";
import { BUYER, FIXTURE_TIME, OPERATOR, TRON, durableFixture } from "./durable-fixtures";

type Fixture = Awaited<ReturnType<typeof createMarketplaceCoordinationFixture>>;
const NOW = FIXTURE_TIME + 1000;
const USAGE = "Pass --fresh-simulation-databases --atomic-connection-string <explicit loopback alpha_wallet_dev_ URL> --race-connection-string <different explicit loopback alpha_wallet_dev_ URL> --auth-connection-string <different explicit loopback alpha_wallet_dev_ URL>. All three databases must exist and be empty. No ambient URL is read and no database is created or dropped.";
let stage = "argument validation";

function argumentsOf(args: string[]) {
  assert.equal(args.length, 7, USAGE);
  let fresh = false;
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--fresh-simulation-databases") { assert(!fresh, USAGE); fresh = true; }
    else if (["--atomic-connection-string", "--race-connection-string", "--auth-connection-string"].includes(arg)) {
      assert(!values[arg] && args[index + 1] && !args[index + 1].startsWith("--"), USAGE);
      values[arg] = args[++index];
    } else assert.fail(USAGE);
  }
  const atomic = values["--atomic-connection-string"], race = values["--race-connection-string"], auth = values["--auth-connection-string"];
  assert(fresh && atomic && race && auth, USAGE);
  assert.equal(new Set([atomic, race, auth].map(url => decodeURIComponent(new URL(url).pathname))).size, 3,
    "Use three different disposable database names");
  return { atomic, race, auth };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Native fixture gate timed out: ${label}`)), 15_000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
function wrapped(store: WalletStore, make: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => store.transaction(tx => work(make(tx))), close: async () => undefined };
}
const coordinator = (store: WalletStore, clock = () => NOW) => createDevelopmentMarketplaceWalletCoordinator({ mode: "simulation-only", store, clock });
const enrollment = (fixture: Fixture, operationId = "native-coordinator-enroll") => ({
  sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId, walletListingId: fixture.listingId,
  walletTradeId: fixture.tradeId, assetId: TRON, operationId,
});
const acceptance = (fixture: Fixture, operationId = "native-coordinator-accept") => ({
  sessionToken: fixture.buyerSessionToken, requestId: fixture.requestId, proposalId: fixture.proposalId,
  expectedBindingRevision: 0, operationId,
});
const inspection = (fixture: Fixture) => ({ sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId });

async function freshDatabase(store: WalletStore) {
  await store.transaction(async tx => {
    const schemas = await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'");
    const relations = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(schemas.rows.length, 0, "Use an empty isolated database; existing schemas are never removed");
    assert.equal(relations.rows[0]?.count, "0");
    assert.equal(role.rows[0]?.permitted, true, "Fixture role requires access to the private simulation schemas");
  });
}
async function setup(store: WalletStore, paymentMethod: "Bank Transfer" | "Face-to-Face" = "Bank Transfer") {
  await initializeDurableWallet(store);
  const fixture = await store.transaction(tx => createMarketplaceCoordinationFixture({ mode: "simulation-only", tx, paymentMethod }));
  const wallet = createDurableWallet({ mode: "simulation-only", store, clock: () => FIXTURE_TIME });
  await durableFixture(wallet).fundedListing("500", fixture.listingId);
  await wallet.execute(walletCommand("reserveTrade", BUYER, "native-coordinator-reserve", {
    id: fixture.tradeId, listingId: fixture.listingId, amount: "200", destination: simulatedDestination(TRON, BUYER.id),
  }));
  const prior = await wallet.snapshot();
  await upgradeDurableWalletV2({ mode: "simulation-only", store, acknowledgeVersionUpgrade: true, clock: () => FIXTURE_TIME,
    command: v2Command("continueFromV1", OPERATOR, "native-coordinator-v2", { checkpoint: {
      revision: prior.revision, eventHash: prior.eventHash, stateHash: walletDigest(prior.state), lastCommandAtMs: FIXTURE_TIME,
    } }) });
  await initializeMarketplaceCoordination({ mode: "simulation-only", store, acknowledgeDevelopmentSchema: true });
  return fixture;
}

/** Test-only read of persisted business rows; never an alternate authority API. */
async function footprint(store: WalletStore, fixture: Fixture) {
  return store.transaction(async tx => {
    const history = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const wallet = verifyVersionedHistory(history);
    assert(isV2State(wallet.state));
    const request = (await tx.query<{ payload: PurchaseRequest }>("SELECT payload FROM alpha_exchange.purchase_requests WHERE id=$1", [fixture.requestId])).rows[0].payload;
    const market = (await tx.query<{ version: string; notifications: string; audits: string; acceptances: string; publications: string }>(`
      SELECT version::text AS version,
        (SELECT count(*)::text FROM alpha_exchange.notifications) AS notifications,
        (SELECT count(*)::text FROM alpha_exchange.audit_logs) AS audits,
        (SELECT count(*)::text FROM alpha_wallet_marketplace_simulation.acceptances) AS acceptances,
        (SELECT count(*)::text FROM alpha_wallet_marketplace_simulation.publications) AS publications
      FROM alpha_exchange.runtime_meta WHERE singleton=true`)).rows[0];
    return { wallet, request, market };
  });
}

async function waitForBlocked(store: WalletStore, pid: number, kind: "advisory" | "row") {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await store.transaction(async tx => (await tx.query<{ waiting: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted
        AND (($2='advisory' AND locktype='advisory') OR ($2='row' AND locktype IN ('tuple','transactionid')))) AS waiting`,
      [pid, kind])).rows[0].waiting);
    if (waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Expected native ${kind} lock wait was not observed`);
}

async function verifyAtomic(store: WalletStore, fixture: Fixture, checks: string[]) {
  const app = coordinator(store);
  stage = "atomic canonical enrollment";
  const enrolled = await app.enrollReservedTrade(enrollment(fixture));
  assert.equal(enrolled.replayed, false);
  assert.equal(enrolled.terms.usdtAmount, "200");
  assert.equal(enrolled.bindingRevision, 0);
  const before = await footprint(store, fixture);
  checks.push("Owner-authenticated enrollment atomically binds the accepted canonical request to its existing 200-USDT wallet reservation");

  stage = "semantic rollback after wallet command and projections";
  let afterWallet = false;
  const brokenWallet = wrapped(store, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
    const result = await tx.query<Row>(sql, values);
    if (/UPDATE alpha_wallet_simulation\.head SET revision=/i.test(sql)) {
      afterWallet = true; throw new Error("Synthetic rejection after actual wallet persistence");
    }
    return result;
  } }));
  await assert.rejects(coordinator(brokenWallet).acceptAmountCorrection(acceptance(fixture, "native-fault-wallet")));
  assert.equal(afterWallet, true);
  assert.deepEqual(await footprint(store, fixture), before);
  checks.push("A semantic failure after the wallet command and projections rolls back wallet, canonical terms, receipts and publication intent together");

  stage = "SQL rollback after canonical marketplace update";
  let afterMarketplace = false;
  const brokenMarketplace = wrapped(store, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
    const result = await tx.query<Row>(sql, values);
    if (/^\s*UPDATE alpha_exchange\.purchase_requests\s/i.test(sql)) {
      afterMarketplace = true; await tx.query("SELECT 1 / 0");
    }
    return result;
  } }));
  await assert.rejects(coordinator(brokenMarketplace).acceptAmountCorrection(acceptance(fixture, "native-fault-marketplace")));
  assert.equal(afterMarketplace, true);
  assert.deepEqual(await footprint(store, fixture), before);
  checks.push("A real SQL error after the canonical marketplace UPDATE rolls back both domains and every acceptance side effect");

  stage = "fresh authentication after persisted canonical update";
  let now = NOW, expiryInjected = false;
  const expiring = wrapped(store, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
    const result = await tx.query<Row>(sql, values);
    if (/^\s*UPDATE alpha_exchange\.purchase_requests\s/i.test(sql)) { expiryInjected = true; now = fixture.sessionsExpireAtMs; }
    return result;
  } }));
  await assert.rejects(coordinator(expiring, () => now).acceptAmountCorrection(acceptance(fixture, "native-expired-before-commit")));
  assert.equal(expiryInjected, true);
  assert.deepEqual(await footprint(store, fixture), before);
  checks.push("Expiry detected after actual marketplace persistence still aborts the single transaction before commit");

  stage = "enrolled canonical writer fences";
  const forbidden = [
    ["UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{buyerNotes}','\"legacy overwrite\"') WHERE id=$1", fixture.requestId],
    ["UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{status}','\"accepted\"'),status='accepted' WHERE id=$1", fixture.otherRequestId],
    ["UPDATE alpha_exchange.listings SET payload=jsonb_set(payload,'{availableAmount}','\"1\"') WHERE id=$1", fixture.listingId],
    ["INSERT INTO alpha_exchange.evidence(id,purchase_request_id,payload) VALUES('native-forbidden-evidence',$1,'{}')", fixture.requestId],
  ];
  for (const [sql, value] of forbidden) await assert.rejects(store.transaction(tx => tx.query(sql, [value])));
  await assert.rejects(store.transaction(tx => tx.exec("TRUNCATE alpha_exchange.purchase_requests")));
  assert.deepEqual(await footprint(store, fixture), before);
  checks.push("Legacy edits to the enrolled request, another request on its listing, inventory, evidence and TRUNCATE are rejected by native database guards");

  stage = "standalone wallet and incomplete backup fences";
  const standalone = createVersionedDurableWallet({ mode: "simulation-only", store, clock: () => NOW });
  await assert.rejects(standalone.execute(v2Command("cancelTrade", BUYER, "native-standalone-cancel", fixture.tradeId)));
  await assert.rejects(standalone.snapshot());
  await assert.rejects(standalone.recoverPayouts());
  await assert.rejects(exportVersionedWalletBackup({ mode: "simulation-only", store, clock: () => NOW }));
  assert.deepEqual(await footprint(store, fixture), before);
  checks.push("Standalone wallet commands, reads, workers and wallet-only backup fail closed once the canonical development cohort is active");

  stage = "lost response after real coordinated acceptance commit";
  let loseReply = true;
  const lossy: WalletStore = { close: async () => undefined, transaction: async work => {
    const result = await store.transaction(work);
    if (loseReply) { loseReply = false; throw new CommitOutcomeUnknownError(new Error("Synthetic lost coordinator commit reply")); }
    return result;
  } };
  await assert.rejects(coordinator(lossy).acceptAmountCorrection(acceptance(fixture, "native-lost-acceptance")), CommitOutcomeUnknownError);
  const committed = await footprint(store, fixture);
  assert.equal(committed.wallet.revision, before.wallet.revision + 1);
  assert.equal(BigInt(committed.market.version), BigInt(before.market.version) + BigInt(1));
  assert.equal(committed.request.usdtAmount, "300");
  assert.equal(committed.request.fiatAmount, "969.60");
  assert.equal(committed.request.termsProposal?.status, "accepted");
  assert.equal(committed.request.amountAdjustmentCount, 1);
  assert.equal(committed.market.acceptances, "1");
  assert.equal(committed.market.publications, "1");
  assert.equal(committed.market.notifications, "1");
  assert.equal(committed.market.audits, "1");
  assert.equal(committed.request.messages?.length, 1);
  assert.equal(balance(committed.wallet.state, TRON, `trade:${fixture.tradeId}`).toString(), "300000000");
  assert.equal(balance(committed.wallet.state, TRON, `listing:${fixture.listingId}`).toString(), "200000000");
  assert.equal(expectedCustody(committed.wallet.state, TRON).toString(), "500000000");
  assertLedgerInvariants(committed.wallet.state);
  checks.push("A real shared commit resizes 200 to 300 USDT, preserves 500 USDT total and stores exactly one receipt, publication intent, seller notification, audit and system message despite an injected lost response");

  stage = "owner pause and historical acceptance recovery";
  const paused = await app.pause({ ...inspection(fixture), operationId: "native-coordinator-pause" });
  assert.equal(paused.halted, true);
  const afterPause = await footprint(store, fixture);
  const recovered = await app.acceptAmountCorrection(acceptance(fixture, "native-recover-different-transport"));
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.walletRevision, committed.wallet.revision);
  assert.equal(recovered.walletEventHash, committed.wallet.eventHash);
  assert.equal(recovered.principalDeltaRaw, "100000000");
  assert.equal(recovered.transferAmountRaw, "100000000");
  assert.equal(recovered.terms.usdtAmount, "300");
  assert.deepEqual(await footprint(store, fixture), afterPause);
  await assert.rejects(app.acceptAmountCorrection({ ...acceptance(fixture), expectedBindingRevision: 1 }));
  await assert.rejects(app.acceptAmountCorrection({ ...acceptance(fixture), sessionToken: fixture.ownerSessionToken }));
  const receiptJson = JSON.stringify(recovered);
  for (const secret of [fixture.buyerSessionToken, createHash("sha256").update(fixture.buyerSessionToken).digest("hex"),
    fixture.initialRequest.sellerBankAccountSnapshot!.accountNumber, fixture.initialRequest.buyerReceivingWalletAddress!]) {
    assert(!receiptJson.includes(JSON.stringify(secret)));
  }
  const inspected = await app.inspect(inspection(fixture));
  assert.equal(inspected.wallet.halted, true);
  assert.equal(inspected.enrollment?.bindingRevision, 1);
  assert.equal(inspected.enrollment?.listingAvailableRaw, "200000000");
  assert.equal(inspected.enrollment?.tradeReservedRaw, "300000000");
  checks.push("A freshly authenticated buyer recovers the original acceptance under a different transport ID even after pause; changed business input and a different actor are rejected and public receipts omit credentials and private payment details");
  return { recovered, inspected };
}

async function preEnrollmentAuxiliary(observer: WalletStore, enrolling: WalletStore, fixture: Fixture, connectionString: string, checks: string[]) {
  stage = "pre-enrollment READ COMMITTED auxiliary writer";
  // This exact loopback URL has already passed createPostgresWalletStore and
  // fresh-database validation. Deliberately model a legacy SQL writer that does
  // not use the new WalletStore or the marketplace global advisory lock.
  const legacy = new Client({ connectionString });
  await legacy.connect();
  const before = await footprint(observer, fixture);
  let pending = false, attempts = 0, pid = 0;
  const entering = deferred<void>();
  let enrollmentOutcome: Promise<{ accepted: boolean; code: unknown }> | undefined;
  try {
    await legacy.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    pending = true;
    const evidence = { id: "native-preenrollment-evidence", purchaseRequestId: fixture.requestId, side: "buyer",
      uploadedByUserId: fixture.buyerId, mimeType: "image/png", fileName: "synthetic.png", sizeBytes: 1, uploadedAt: fixture.at };
    await legacy.query("INSERT INTO alpha_exchange.evidence(id,purchase_request_id,payload) VALUES($1,$2,$3::jsonb)",
      [evidence.id, fixture.requestId, JSON.stringify(evidence)]);
    const gated: WalletStore = { close: async () => undefined, transaction: work => enrolling.transaction(async tx => {
      attempts++;
      pid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      return work({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        if (/INSERT INTO alpha_wallet_marketplace_simulation\.enrollments/i.test(sql)) entering.resolve();
        return tx.query<Row>(sql, values);
      } });
    }) };
    const operation = coordinator(gated).enrollReservedTrade(enrollment(fixture, "native-preenrollment-race"));
    enrollmentOutcome = operation.then(() => ({ accepted: true, code: undefined }), error => ({ accepted: false,
      code: error && typeof error === "object" && "code" in error ? error.code : undefined }));
    void operation.then(() => entering.reject(new Error("Enrollment should wait behind the older auxiliary write")), error => entering.reject(error));
    await bounded(entering.promise, "enrollment reaches old auxiliary writer");
    await waitForBlocked(observer, pid, "row");
    await legacy.query("COMMIT");
    pending = false;
    const outcome = await bounded(enrollmentOutcome, "fresh enrollment rejection after committed evidence");
    assert.equal(outcome.accepted, false);
    assert.equal(outcome.code, "LOCKED");
    assert(attempts >= 2, "The legacy auxiliary writer must invalidate enrollment's earlier canonical snapshot");
    assert.deepEqual(await footprint(observer, fixture), before);
    await observer.transaction(async tx => {
      assert.equal((await tx.query("SELECT 1 FROM alpha_wallet_marketplace_simulation.enrollments")).rows.length, 0);
      assert.equal((await tx.query("SELECT 1 FROM alpha_exchange.evidence WHERE id='native-preenrollment-evidence'")).rows.length, 1);
      await tx.query("DELETE FROM alpha_exchange.evidence WHERE id='native-preenrollment-evidence'");
    });
    checks.push("An ordinary READ COMMITTED evidence writer that ignores the global advisory lock physically fences its listing; waiting enrollment retries with that committed evidence and rejects the now-ineligible trade without a ledger or cohort write");
    return attempts;
  } finally {
    if (pending) await legacy.query("ROLLBACK");
    await legacy.end();
    if (enrollmentOutcome) await bounded(enrollmentOutcome, "auxiliary race cleanup");
  }
}

async function verifyStaleAndConcurrent(observer: WalletStore, oldWriter: WalletStore, other: WalletStore, fixture: Fixture,
  connectionString: string, checks: string[]) {
  const preEnrollmentAttempts = await preEnrollmentAuxiliary(observer, oldWriter, fixture, connectionString, checks);
  stage = "stale legacy snapshot before enrollment";
  const started = deferred<void>(), release = deferred<void>();
  let attempts = 0, oldSnapshotVersion = "";
  const stale = oldWriter.transaction(async tx => {
    attempts++;
    const row = (await tx.query<{ version: string }>("SELECT version::text AS version FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0];
    if (attempts === 1) { oldSnapshotVersion = row.version; started.resolve(); await bounded(release.promise, "stale writer release"); }
    await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{buyerNotes}','\"stale legacy write\"') WHERE id=$1", [fixture.requestId]);
  });
  // Observe rejection immediately so a real retry failure never becomes an unhandled rejection.
  const staleOutcome = stale.then(() => ({ accepted: true }), () => ({ accepted: false }));
  void stale.catch(error => started.reject(error));
  try {
    await bounded(started.promise, "legacy snapshot established");
    await coordinator(observer).enrollReservedTrade(enrollment(fixture, "native-race-enroll"));
  } finally { release.resolve(); }
  assert.equal((await staleOutcome).accepted, false);
  assert(attempts >= 2, "Enrollment's physical row fence must force a stale writer to retry its whole transaction");
  const enrolled = await footprint(observer, fixture);
  assert.equal(enrolled.request.buyerNotes, fixture.initialRequest.buyerNotes);
  assert(BigInt(enrolled.market.version) > BigInt(oldSnapshotVersion));
  checks.push("A legacy SERIALIZABLE writer whose snapshot predates enrollment is forced to retry by physical row fencing and then rejected by the enrolled guard");

  stage = "concurrent acceptance from different PostgreSQL backends";
  const held = deferred<void>(), commit = deferred<void>(), contenderStarted = deferred<void>();
  let firstPid = 0, contenderPid = 0, contenderAttempts = 0, gated = false;
  const firstStore = wrapped(oldWriter, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
    const result = await tx.query<Row>(sql, values);
    if (!gated && /FROM alpha_exchange\.sessions AS session/i.test(sql)) {
      gated = true; firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      held.resolve(); await bounded(commit.promise, "competing acceptance release");
    }
    return result;
  } }));
  const contenderStore: WalletStore = { close: async () => undefined, transaction: work => other.transaction(async tx => {
    contenderAttempts++;
    // Establish a real old MVCC snapshot before waiting on the request lock.
    contenderPid = (await tx.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid,version FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0].pid;
    if (contenderAttempts === 1) contenderStarted.resolve();
    return work(tx);
  }) };
  const first = coordinator(firstStore).acceptAmountCorrection(acceptance(fixture, "native-race-accept-a"));
  void first.then(() => { if (!gated) held.reject(new Error("Acceptance authentication hook was not reached")); }, error => held.reject(error));
  await bounded(held.promise, "first acceptance owns auth locks");
  const second = coordinator(contenderStore).acceptAmountCorrection(acceptance(fixture, "native-race-accept-b"));
  void second.catch(error => contenderStarted.reject(error));
  let pair: DevelopmentMarketplaceAcceptanceReceipt[];
  try {
    await bounded(contenderStarted.promise, "competing acceptance started");
    assert.notEqual(firstPid, contenderPid);
    await waitForBlocked(observer, contenderPid, "advisory");
    commit.resolve();
    pair = await Promise.all([first, second]);
  } finally { commit.resolve(); await Promise.allSettled([first, second]); }
  assert.equal(pair[0].replayed, false);
  assert.equal(pair[1].replayed, true);
  assert.deepEqual({ ...pair[0], replayed: true }, pair[1]);
  assert(contenderAttempts >= 2, "Waiting stale acceptance must retry the entire canonical/auth/wallet decision");
  const accepted = await footprint(observer, fixture);
  assert.equal(accepted.wallet.revision, enrolled.wallet.revision + 1);
  assert.equal(accepted.market.acceptances, "1");
  assert.equal(accepted.market.publications, "1");
  assert.equal(accepted.market.notifications, "1");
  assert.equal(accepted.request.usdtAmount, "300");
  checks.push("Two independent PostgreSQL backends accepting the same stored proposal serialize visibly, retry the entire stale decision and return one original receipt with one principal transfer");
  return { preEnrollmentAttempts, staleLegacyAttempts: attempts, acceptanceAttempts: contenderAttempts,
    distinctBackends: true, advisoryWaitObserved: true, preEnrollmentRowWaitObserved: true };
}

async function insertSession(store: WalletStore, fixture: Fixture, token: string, createdAt = fixture.at) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session: AuthSession = { token: tokenHash, userId: fixture.buyerId, createdAt,
    expiresAt: new Date(fixture.sessionsExpireAtMs).toISOString(), deviceLabel: "Synthetic fixture session" };
  await store.transaction(tx => tx.query(`INSERT INTO alpha_exchange.sessions
    (token_hash,user_id,expires_at,created_at,sort_index,payload) VALUES($1,$2,$3::timestamptz,$4::timestamptz,3,$5::jsonb)`,
  [tokenHash, fixture.buyerId, session.expiresAt, session.createdAt, JSON.stringify(session)]));
}

/** A revocation committed after the financial snapshot must still win at auth. */
async function staleAuthority(observer: WalletStore, accepting: WalletStore, revoking: WalletStore, fixture: Fixture,
  kind: "session" | "account", checks: string[]) {
  stage = `stale authentication snapshot after ${kind} revocation wins`;
  const before = await footprint(observer, fixture);
  const held = deferred<void>(), release = deferred<void>();
  let gated = false, attempts = 0;
  const gatedStore: WalletStore = { close: async () => undefined, transaction: work => accepting.transaction(tx => {
    attempts++;
    return work({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      if (!gated && /FROM alpha_exchange\.sessions AS session/i.test(sql)) {
        gated = true; held.resolve(); await bounded(release.promise, "pre-auth snapshot release");
      }
      return tx.query<Row>(sql, values);
    } });
  }) };
  const attempt = coordinator(gatedStore).acceptAmountCorrection(acceptance(fixture, `native-stale-${kind}-auth`));
  const outcome = attempt.then(() => ({ accepted: true, code: undefined }), error => ({ accepted: false,
    code: error && typeof error === "object" && "code" in error ? error.code : undefined }));
  void attempt.then(() => { if (!gated) held.reject(new Error("Pre-auth snapshot hook was not reached")); }, error => held.reject(error));
  try {
    await bounded(held.promise, "stale snapshot established before authoritative auth read");
    await revoking.transaction(async tx => {
      if (kind === "session") {
        await tx.query("DELETE FROM alpha_exchange.sessions WHERE token_hash=$1", [createHash("sha256").update(fixture.buyerSessionToken).digest("hex")]);
      } else {
        await tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true') WHERE id=$1", [fixture.buyerId]);
      }
    });
  } finally { release.resolve(); }
  const rejection = await bounded(outcome, "stale authentication rejection");
  assert.equal(rejection.accepted, false);
  assert.equal(rejection.code, kind === "session" ? "WALLET_SESSION_REQUIRED" : "WALLET_ACCOUNT_DISABLED");
  assert(attempts >= 2, "A stale locked authentication row must force the entire transaction to retry");
  assert.deepEqual(await footprint(observer, fixture), before);
  if (kind === "session") await insertSession(observer, fixture, fixture.buyerSessionToken);
  else await observer.transaction(tx => tx.query("UPDATE alpha_exchange.users SET payload=$2::jsonb WHERE id=$1",
    [fixture.buyerId, JSON.stringify(fixture.accounts.find(account => account.id === fixture.buyerId))]));
  checks.push(kind === "session"
    ? "A web-session revocation committed after the coordinator snapshot but before its locked auth read forces a full retry and rejects acceptance without financial or canonical changes"
    : "An account disable committed after the coordinator snapshot but before its locked auth read forces a full retry and rejects acceptance without financial or canonical changes");
  return attempts;
}

async function verifyRevocation(observer: WalletStore, accepting: WalletStore, revoking: WalletStore, fixture: Fixture, checks: string[]) {
  stage = "native web session revocation ordered against acceptance";
  await coordinator(observer).enrollReservedTrade(enrollment(fixture, "native-auth-enroll"));
  const staleSessionAttempts = await staleAuthority(observer, accepting, revoking, fixture, "session", checks);
  const staleAccountAttempts = await staleAuthority(observer, accepting, revoking, fixture, "account", checks);
  stage = "native web session revocation ordered after acceptance";
  const held = deferred<void>(), release = deferred<void>(), revocationStarted = deferred<void>();
  let gated = false, acceptingPid = 0, revokingPid = 0, revocationCommitted = false;
  const gatedStore = wrapped(accepting, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
    const result = await tx.query<Row>(sql, values);
    if (!gated && /FROM alpha_exchange\.sessions AS session/i.test(sql)) {
      gated = true; acceptingPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      held.resolve(); await bounded(release.promise, "auth lock release");
    }
    return result;
  } }));
  const accepted = coordinator(gatedStore).acceptAmountCorrection(acceptance(fixture, "native-auth-accept"));
  void accepted.then(() => { if (!gated) held.reject(new Error("Acceptance auth-lock hook was not reached")); }, error => held.reject(error));
  await bounded(held.promise, "acceptance owns web session locks");
  const tokenHash = createHash("sha256").update(fixture.buyerSessionToken).digest("hex");
  const revoked = revoking.transaction(async tx => {
    revokingPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    revocationStarted.resolve();
    await tx.query("DELETE FROM alpha_exchange.sessions WHERE token_hash=$1", [tokenHash]);
  }).then(() => { revocationCommitted = true; });
  void revoked.catch(error => revocationStarted.reject(error));
  let original: DevelopmentMarketplaceAcceptanceReceipt;
  try {
    await bounded(revocationStarted.promise, "revocation started");
    assert.notEqual(acceptingPid, revokingPid);
    await waitForBlocked(observer, revokingPid, "row");
    assert.equal(revocationCommitted, false);
    release.resolve();
    [original] = await Promise.all([accepted, revoked]);
  } finally { release.resolve(); await Promise.allSettled([accepted, revoked]); }
  assert.equal(revocationCommitted, true);
  assert.equal(original.replayed, false);
  const committed = await footprint(observer, fixture);
  assert.equal(committed.request.usdtAmount, "300");
  await assert.rejects(coordinator(observer).acceptAmountCorrection(acceptance(fixture, "native-revoked-recovery")));
  assert.deepEqual(await footprint(observer, fixture), committed);
  checks.push("Real FOR SHARE session/account locks order acceptance before a concurrently queued web-session revocation; the now-revoked credential cannot retrieve the committed receipt");

  stage = "original receipt recovery with a new valid stored web session";
  const newToken = "d4".repeat(32);
  await insertSession(observer, fixture, newToken, new Date(NOW).toISOString());
  const recovered = await coordinator(observer).acceptAmountCorrection({ ...acceptance(fixture, "native-new-session-recovery"), sessionToken: newToken });
  assert.deepEqual(recovered, { ...original, replayed: true });
  assert.deepEqual(await footprint(observer, fixture), committed);
  checks.push("The same buyer with a new valid stored session can recover the original immutable receipt without another wallet or canonical mutation");
  return { staleSessionAttempts, staleAccountAttempts, distinctBackends: true, rowLockWaitObserved: true,
    revocationCommittedAfterAcceptance: true, revokedSessionRecoveryRejected: true };
}

async function verify(urls: ReturnType<typeof argumentsOf>) {
  const stores: WalletStore[] = [];
  const open = async (url: string) => { const store = await createPostgresWalletStore({ mode: "simulation-only", connectionString: url }); stores.push(store); return store; };
  const checks: string[] = [];
  try {
    stage = "three explicit empty development databases";
    const atomic = await open(urls.atomic), races = await open(urls.race), auth = await open(urls.auth);
    await Promise.all([freshDatabase(atomic), freshDatabase(races), freshDatabase(auth)]);
    const atomicFixture = await setup(atomic);
    const raceFixture = await setup(races, "Face-to-Face");
    const authFixture = await setup(auth);
    const result = await verifyAtomic(atomic, atomicFixture, checks);
    const concurrency = await verifyStaleAndConcurrent(races, await open(urls.race), await open(urls.race), raceFixture, urls.race, checks);
    const authentication = await verifyRevocation(auth, await open(urls.auth), await open(urls.auth), authFixture, checks);
    stage = "reopened coordinated state verification";
    const reopened = await coordinator(await open(urls.atomic)).inspect(inspection(atomicFixture));
    assert.deepEqual(reopened, result.inspected);
    checks.push("A fresh connection replays and checks the coordinated state after pause, with the accepted 300-USDT reservation and 200-USDT remaining inventory intact");
    console.log(JSON.stringify({ mode: "simulation-only", scope: "Actual canonical marketplace and v2 wallet amount-correction coordinator", checks,
      concurrency, authentication, walletRevision: reopened.wallet.revision,
      money: { custodyUSDT: "500", listingInventoryUSDT: "200", reservedPrincipalUSDT: "300", buyerFeeUSDT: "3", sellerFeeUSDT: "3", fiatTotalILS: "969.60", providerSubmissions: 0 },
      limits: ["Explicit owner enrollment of one clean active reserved trade globally; Bank Transfer and Face-to-Face only.",
        "Only web sessions are coordinated; no live route, mobile bridge, payout, new proposal, cancellation, release or settlement is enabled.",
        "Publication intent is durable but no external notification/realtime delivery runs.",
        "Lost reply is injected after a real commit; no real network partition or provider is used.",
        "Wallet-only export is rejected after enrollment; the separate combined recovery drill verifies paused fresh-target restoration."] }, null, 2));
  } finally {
    const closed = await Promise.allSettled(stores.map(store => store.close()));
    for (const result of closed) if (result.status === "rejected") throw result.reason;
  }
}

async function main() {
  assertSimulationRuntime("simulation-only");
  if (process.argv.slice(2).join(" ") === "--help") { console.log(USAGE); return; }
  await verify(argumentsOf(process.argv.slice(2)));
}
void main().catch(error => {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : undefined;
  const scalar = (value: unknown) => typeof value === "number" || typeof value === "boolean" || value === null ? value : typeof value;
  console.error(JSON.stringify({ mode: "simulation-only", failedStage: stage,
    errorType: error instanceof Error ? error.name : "unknown", code,
    assertion: error instanceof AssertionError ? { operator: error.operator, actual: scalar(error.actual), expected: scalar(error.expected) } : undefined,
    note: "No production URL or provider was used. Driver messages, parameters and private causes are omitted." }));
  process.exitCode = 1;
});
