/** Native mobile authority races on three explicit empty loopback development databases. */
import { AssertionError, strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import type { PurchaseRequest } from "../../src/types/alpha-exchange";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "../../src/lib/alpha-wallet/durable";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { createMarketplaceCoordinationFixture } from "../../src/lib/alpha-wallet/marketplace-coordination-fixture";
import { initializeMarketplaceCoordination } from "../../src/lib/alpha-wallet/marketplace-coordination-store";
import {
  createDevelopmentMarketplaceWalletCoordinator, createDevelopmentMobileMarketplaceWalletCoordinator,
  type DevelopmentMarketplaceAcceptanceReceipt,
} from "../../src/lib/alpha-wallet/marketplace-coordinator";
import { createMarketplaceMobileAuthFixture } from "../../src/lib/alpha-wallet/marketplace-mobile-fixture";
import {
  exportMarketplaceWalletBackup, exportMobileMarketplaceWalletBackup, inspectMarketplaceWalletBackup,
  inspectRestoredMarketplaceWallet, restoreMarketplaceWalletBackup,
} from "../../src/lib/alpha-wallet/marketplace-backup";
import { assertFreshMarketplaceRecoveryTarget } from "../../src/lib/alpha-wallet/marketplace-recovery-store";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import { v2Command } from "../../src/lib/alpha-wallet/v2-commands";
import { upgradeDurableWalletV2, verifyVersionedHistory } from "../../src/lib/alpha-wallet/versioned-durable";
import { BUYER, FIXTURE_TIME, OPERATOR, TRON, durableFixture } from "./durable-fixtures";

const MODE = "simulation-only" as const;
const NOW = FIXTURE_TIME + 1000;
const USAGE = "Pass --fresh-simulation-databases with --atomic-connection-string, --auth-connection-string and --restore-connection-string for three different already-created empty loopback alpha_wallet_dev_ databases.";
const mobileQuery = /FROM alpha_exchange\.mobile_device_sessions AS session/i;
let stage = "argument validation";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function argumentsOf(args: string[]) {
  assert.equal(args.length, 7, USAGE);
  let fresh = false;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--fresh-simulation-databases") { assert(!fresh, USAGE); fresh = true; }
    else if (["--atomic-connection-string", "--auth-connection-string", "--restore-connection-string"].includes(name)) {
      assert(!values.has(name) && args[index + 1] && !args[index + 1].startsWith("--"), USAGE);
      values.set(name, args[++index]);
    } else assert.fail(USAGE);
  }
  assert(fresh && values.size === 3, USAGE);
  const atomic = values.get("--atomic-connection-string")!, auth = values.get("--auth-connection-string")!, restore = values.get("--restore-connection-string")!;
  assert.equal(new Set([atomic, auth, restore].map(url => decodeURIComponent(new URL(url).pathname))).size, 3, USAGE);
  return { atomic, auth, restore };
}
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Native mobile gate timed out: ${label}`)), 15_000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
const wrapped = (store: WalletStore, wrap: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(wrap(tx))), close: async () => undefined,
});
const mobileCoordinator = (store: WalletStore, clock = () => NOW) => createDevelopmentMobileMarketplaceWalletCoordinator({ mode: MODE, store, clock });
const webCoordinator = (store: WalletStore) => createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store, clock: () => NOW });

async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    await assertFreshMarketplaceRecoveryTarget(tx);
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(role.rows[0]?.permitted, true, "Disposable native fixture role requires superuser/BYPASSRLS");
  });
}
async function setup(store: WalletStore, platform: "ios" | "android", paymentMethod: "Bank Transfer" | "Face-to-Face") {
  await initializeDurableWallet(store);
  const canonical = await store.transaction(tx => createMarketplaceCoordinationFixture({ mode: MODE, tx, paymentMethod }));
  const mobile = await store.transaction(tx => createMarketplaceMobileAuthFixture({ mode: MODE, tx,
    userIds: [canonical.ownerId, canonical.buyerId, canonical.sellerId], atMs: FIXTURE_TIME,
    platform, locale: platform === "android" ? "ar" : "en" }));
  const wallet = createDurableWallet({ mode: MODE, store, clock: () => FIXTURE_TIME });
  await durableFixture(wallet).fundedListing("500", canonical.listingId);
  await wallet.execute(walletCommand("reserveTrade", BUYER, "native-mobile-reserve", {
    id: canonical.tradeId, listingId: canonical.listingId, amount: "200", destination: simulatedDestination(TRON, BUYER.id),
  }));
  const prior = await wallet.snapshot();
  await upgradeDurableWalletV2({ mode: MODE, store, acknowledgeVersionUpgrade: true, clock: () => FIXTURE_TIME,
    command: v2Command("continueFromV1", OPERATOR, "native-mobile-v2", { checkpoint: {
      revision: prior.revision, eventHash: prior.eventHash, stateHash: walletDigest(prior.state), lastCommandAtMs: FIXTURE_TIME,
    } }) });
  await initializeMarketplaceCoordination({ mode: MODE, store, acknowledgeDevelopmentSchema: true });
  return { canonical, mobile };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const ownerInput = (f: Fixture) => ({ ...f.mobile.credentials[f.canonical.ownerId], requestId: f.canonical.requestId });
const enrollment = (f: Fixture) => ({ ...ownerInput(f), walletListingId: f.canonical.listingId,
  walletTradeId: f.canonical.tradeId, assetId: TRON, operationId: "native-mobile-enroll" });
const acceptance = (f: Fixture, operationId = "native-mobile-accept") => ({ ...f.mobile.credentials[f.canonical.buyerId],
  requestId: f.canonical.requestId, proposalId: f.canonical.proposalId, expectedBindingRevision: 0, operationId });
const webAcceptance = (f: Fixture, operationId = "native-web-recovery") => ({ sessionToken: f.canonical.buyerSessionToken,
  requestId: f.canonical.requestId, proposalId: f.canonical.proposalId, expectedBindingRevision: 0, operationId });

/** Read-only synthetic evidence; never an authorization path. */
async function footprint(store: WalletStore, f: Fixture) {
  return store.transaction(async tx => {
    const commands = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const request = (await tx.query<{ payload: PurchaseRequest }>("SELECT payload FROM alpha_exchange.purchase_requests WHERE id=$1", [f.canonical.requestId])).rows[0].payload;
    const records = (await tx.query(`SELECT version::text AS version,
      (SELECT count(*)::text FROM alpha_exchange.notifications) AS notifications,
      (SELECT count(*)::text FROM alpha_exchange.audit_logs) AS audits,
      (SELECT count(*)::text FROM alpha_wallet_marketplace_simulation.acceptances) AS acceptances,
      (SELECT count(*)::text FROM alpha_wallet_marketplace_simulation.publications) AS publications
      FROM alpha_exchange.runtime_meta WHERE singleton=true`)).rows[0];
    return { commands, request, records };
  });
}
async function waitForLock(observer: WalletStore, pid: number, kind: "row" | "advisory") {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const result = await observer.transaction(tx => tx.query<{ waiting: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted
      AND (($2='row' AND locktype IN ('tuple','transactionid')) OR ($2='advisory' AND locktype='advisory'))) AS waiting`, [pid, kind]));
    if (result.rows[0].waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`The native ${kind} lock wait was not observed`);
}

async function resetBuyerSession(store: WalletStore, f: Fixture) {
  const s = f.mobile.sessions[f.canonical.buyerId];
  await store.transaction(async tx => {
    await tx.query("DELETE FROM alpha_exchange.mobile_refresh_token_history WHERE session_id=$1", [s.id]);
    await tx.query(`UPDATE alpha_exchange.mobile_device_sessions SET
      device_id_hash=$2,access_token_hash=$3,refresh_token_hash=$4,token_family_id=$5,refresh_generation=$6,
      platform=$7,app_version=$8,locale=$9,access_expires_at=$10,refresh_expires_at=$11,last_seen_at=$12,
      revoked_at=NULL,revoke_reason=NULL,updated_at=$13 WHERE id=$1`,
    [s.id, s.deviceIdHash, s.accessTokenHash, s.refreshTokenHash, s.tokenFamilyId, s.refreshGeneration,
      s.platform, s.appVersion, s.locale, s.accessExpiresAt, s.refreshExpiresAt, s.lastSeenAt, s.updatedAt]);
  });
}

async function staleAuthority(observer: WalletStore, accepting: WalletStore, changing: WalletStore, f: Fixture,
  kind: "logout" | "rotation" | "replacement" | "account", checks: string[]) {
  stage = `native mobile ${kind} before locked authentication`;
  const before = await footprint(observer, f);
  const held = deferred(), release = deferred();
  let gated = false, attempts = 0;
  const session = f.mobile.sessions[f.canonical.buyerId];
  const authStore: WalletStore = { close: async () => undefined, transaction: work => accepting.transaction(tx => {
    attempts++;
    return work({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      // Issuance/rotation use the real platform's global lock; pause before our
      // acquisition so their transaction can commit after our MVCC snapshot.
      const trigger = kind === "rotation" || kind === "replacement"
        ? /select\s+pg_advisory_xact_lock\(61422917\)/i.test(sql) : mobileQuery.test(sql);
      if (!gated && trigger) { gated = true; held.resolve(); await bounded(release.promise, "stale authority release"); }
      return tx.query<Row>(sql, params);
    } });
  }) };
  const operation = mobileCoordinator(authStore).acceptAmountCorrection(acceptance(f, `native-stale-${kind}`));
  const outcome = operation.then(() => ({ accepted: true, code: undefined }), error => ({ accepted: false,
    code: error && typeof error === "object" && "code" in error ? error.code : undefined }));
  void operation.then(() => { if (!gated) held.reject(new Error("Native mobile auth gate was not reached")); }, error => held.reject(error));
  try {
    await bounded(held.promise, "financial snapshot before mobile authority change");
    await changing.transaction(async tx => {
      if (kind === "rotation" || kind === "replacement") await tx.query("select pg_advisory_xact_lock(61422917)");
      if (kind === "account") {
        await tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true') WHERE id=$1", [f.canonical.buyerId]);
      } else if (kind === "logout") {
        await tx.query(`UPDATE alpha_exchange.mobile_device_sessions SET revoked_at=$2,revoke_reason='user_logout',updated_at=$2 WHERE id=$1`,
          [session.id, new Date(NOW).toISOString()]);
      } else {
        if (kind === "rotation") await tx.query(`INSERT INTO alpha_exchange.mobile_refresh_token_history
          (token_hash,session_id,generation,used_at,expires_at) VALUES($1,$2,$3,$4,$5)`,
        [session.refreshTokenHash, session.id, session.refreshGeneration, new Date(NOW).toISOString(), session.refreshExpiresAt]);
        await tx.query(`UPDATE alpha_exchange.mobile_device_sessions SET access_token_hash=$2,refresh_token_hash=$3,
          token_family_id=$4,refresh_generation=$5,updated_at=$6,last_seen_at=$6 WHERE id=$1`,
        [session.id, hash(`synthetic-native-${kind}-access`), hash(`synthetic-native-${kind}-refresh`),
          kind === "replacement" ? "synthetic-new-family" : session.tokenFamilyId,
          kind === "replacement" ? 0 : session.refreshGeneration + 1, new Date(NOW).toISOString()]);
      }
    });
  } finally { release.resolve(); }
  const result = await bounded(outcome, "stale mobile rejection");
  assert.equal(result.accepted, false);
  assert.equal(result.code, kind === "account" ? "WALLET_ACCOUNT_DISABLED" : "WALLET_SESSION_REQUIRED");
  assert(attempts >= 2, "A changed locked authentication row must retry the complete financial decision");
  assert.deepEqual(await footprint(observer, f), before);
  if (kind === "account") await observer.transaction(tx => tx.query("UPDATE alpha_exchange.users SET payload=$2::jsonb WHERE id=$1",
    [f.canonical.buyerId, JSON.stringify(f.canonical.accounts.find(account => account.id === f.canonical.buyerId))]));
  else await resetBuyerSession(observer, f);
  checks.push(`A ${kind} committed after the old snapshot forces a whole-transaction retry and denies the old mobile authority without financial changes`);
  return attempts;
}

async function orderedLogout(observer: WalletStore, accepting: WalletStore, revoking: WalletStore, web: WalletStore, f: Fixture, checks: string[]) {
  stage = "web acceptance and mobile logout waiting behind the first mobile financial transaction";
  const held = deferred(), release = deferred(), started = deferred(), webStarted = deferred();
  let gated = false, acceptingPid = 0, revokingPid = 0, webPid = 0, webAttempts = 0, revocationCommitted = false;
  const store = wrapped(accepting, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
    const rows = await tx.query<Row>(sql, params);
    if (!gated && mobileQuery.test(sql)) {
      gated = true; acceptingPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      held.resolve(); await bounded(release.promise, "held mobile row locks");
    }
    return rows;
  } }));
  const accepted = mobileCoordinator(store).acceptAmountCorrection(acceptance(f, "native-ordered-accept"));
  void accepted.then(() => { if (!gated) held.reject(new Error("Native mobile row-lock hook absent")); }, error => held.reject(error));
  await bounded(held.promise, "mobile locks acquired");
  const contender: WalletStore = { close: async () => undefined, transaction: work => web.transaction(async tx => {
    webAttempts++;
    webPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,version FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0].pid;
    if (webAttempts === 1) webStarted.resolve();
    return work(tx);
  }) };
  const webAccepted = webCoordinator(contender).acceptAmountCorrection(webAcceptance(f, "native-concurrent-web-accept"));
  void webAccepted.catch(error => webStarted.reject(error));
  const revoked = revoking.transaction(async tx => {
    revokingPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    started.resolve();
    await tx.query(`UPDATE alpha_exchange.mobile_device_sessions SET revoked_at=$2,revoke_reason='user_logout',updated_at=$2 WHERE id=$1`,
      [f.mobile.sessions[f.canonical.buyerId].id, new Date(NOW).toISOString()]);
  }).then(() => { revocationCommitted = true; });
  void revoked.catch(error => started.reject(error));
  let original: DevelopmentMarketplaceAcceptanceReceipt;
  try {
    await Promise.all([bounded(started.promise, "logout attempt started"), bounded(webStarted.promise, "web acceptance started")]);
    assert.equal(new Set([acceptingPid, revokingPid, webPid]).size, 3);
    await Promise.all([waitForLock(observer, revokingPid, "row"), waitForLock(observer, webPid, "advisory")]);
    assert.equal(revocationCommitted, false);
    release.resolve();
    [original] = await Promise.all([accepted, revoked, webAccepted]);
  } finally { release.resolve(); await Promise.allSettled([accepted, revoked, webAccepted]); }
  assert(revocationCommitted && !original.replayed);
  assert(webAttempts >= 2, "The waiting web acceptance must retry its stale canonical snapshot");
  assert.deepEqual(await webAccepted, { ...original, replayed: true });
  const committed = await footprint(observer, f);
  await assert.rejects(mobileCoordinator(observer).acceptAmountCorrection(acceptance(f, "native-revoked-retry")));
  const recovered = await webCoordinator(observer).acceptAmountCorrection(webAcceptance(f));
  assert.deepEqual(recovered, { ...original, replayed: true });
  assert.deepEqual(await footprint(observer, f), committed);
  checks.push("Two native backends expose a real row wait: acceptance commits before queued logout, the revoked mobile token is denied and the current web buyer recovers the original receipt");
  checks.push("Concurrent web and mobile acceptances expose a real advisory wait and whole-transaction web retry, then return one original receipt with one financial acceptance");
  return { distinctBackends: 3, rowWaitObserved: true, advisoryWaitObserved: true,
    webContenderAttempts: webAttempts, revocationCommittedAfterAcceptance: true };
}

async function atomicAndRecovery(source: WalletStore, target: WalletStore, f: Fixture, checks: string[]) {
  stage = "mobile owner enrollment";
  const owner = mobileCoordinator(source);
  const enrolled = await owner.enrollReservedTrade(enrollment(f));
  assert.equal(enrolled.replayed, false);
  const before = await footprint(source, f);
  checks.push("A current stored mobile owner enrolls the original canonical reservation with the same financial contract as the web owner");

  stage = "mobile expiry after actual canonical persistence";
  let now = NOW, injected = false;
  const expired = wrapped(source, tx => ({ exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
    const rows = await tx.query<Row>(sql, params);
    if (/^\s*UPDATE alpha_exchange\.purchase_requests\s/i.test(sql)) { injected = true; now = f.mobile.expiresAtMs; }
    return rows;
  } }));
  await assert.rejects(mobileCoordinator(expired, () => now).acceptAmountCorrection(acceptance(f, "native-mobile-expired")));
  assert(injected);
  assert.deepEqual(await footprint(source, f), before);
  checks.push("Mobile expiry after the canonical UPDATE rolls back wallet, canonical terms, receipts and publication together");

  stage = "mobile real COMMIT followed by synthetic lost response";
  const lost: WalletStore = { close: async () => undefined, async transaction<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
    await source.transaction(work);
    throw new CommitOutcomeUnknownError(new Error("Synthetic response loss after real native COMMIT"));
  } };
  await assert.rejects(mobileCoordinator(lost).acceptAmountCorrection(acceptance(f)), error => error instanceof CommitOutcomeUnknownError);
  const committed = await footprint(source, f);
  assert.equal(committed.commands.length, before.commands.length + 1);
  for (const key of ["acceptances", "publications", "notifications", "audits"]) assert.equal(committed.records[key], "1");
  const mobile = await owner.acceptAmountCorrection(acceptance(f, "native-mobile-original-retry"));
  const web = await webCoordinator(source).acceptAmountCorrection(webAcceptance(f));
  assert(mobile.replayed && web.replayed);
  assert.deepEqual(mobile, web);
  assert.deepEqual(await footprint(source, f), committed);
  checks.push("A lost mobile COMMIT reply is recovered from either current web or mobile authority with one immutable receipt and no duplicate principal movement or events");

  stage = "mobile owner pause and cross-transport original receipt recovery";
  await owner.pause({ ...ownerInput(f), operationId: "native-mobile-pause" });
  const paused = await footprint(source, f);
  assert.deepEqual(await owner.acceptAmountCorrection(acceptance(f, "native-mobile-paused-retry")), mobile);
  assert.deepEqual(await webCoordinator(source).acceptAmountCorrection(webAcceptance(f, "native-web-paused-retry")), mobile);
  assert.deepEqual(await footprint(source, f), paused);
  checks.push("Mobile owner pause remains available and current web/mobile callers recover the original receipt while paused without new financial commands");

  stage = "mobile export and fresh recovery without device credentials";
  const serialized = await exportMobileMarketplaceWalletBackup({ mode: MODE, store: source, ...ownerInput(f), clock: () => NOW });
  const fromWeb = await exportMarketplaceWalletBackup({ mode: MODE, store: source, requestId: f.canonical.requestId,
    sessionToken: f.canonical.ownerSessionToken, clock: () => NOW });
  assert.equal(serialized, fromWeb, "Transport credentials must not change the financial recovery format");
  for (const [id, credentials] of Object.entries(f.mobile.credentials)) {
    const s = f.mobile.sessions[id];
    for (const secret of [credentials.accessToken, credentials.metadata.deviceId, s.deviceIdHash, s.accessTokenHash,
      s.refreshTokenHash, s.tokenFamilyId, s.id]) assert(!serialized.includes(secret));
  }
  const backup = inspectMarketplaceWalletBackup(serialized);
  const restored = await restoreMarketplaceWalletBackup({ mode: MODE, store: target, backup: serialized,
    acknowledgeFreshTarget: true, expectedChecksum: backup.checksum, clock: () => FIXTURE_TIME + 10_000 });
  const outcome = await inspectRestoredMarketplaceWallet({ mode: MODE, store: target, expectedChecksum: backup.checksum });
  assert.deepEqual(outcome.restored, restored.restored);
  assert.equal(outcome.restored.revision, backup.checkpoint.revision + 1);
  await target.transaction(async tx => {
    const missing = await tx.query<{ absent: boolean }>(`SELECT to_regclass('alpha_exchange.mobile_device_sessions') IS NULL
      AND to_regclass('alpha_exchange.mobile_refresh_token_history') IS NULL AS absent`);
    assert.equal(missing.rows[0].absent, true);
  });
  await assert.rejects(mobileCoordinator(target).inspect(ownerInput(f)));
  const wallet = verifyVersionedHistory(paused.commands).state;
  assert.equal(balance(wallet, TRON, `trade:${f.canonical.tradeId}`), BigInt("300000000"));
  assert.equal(balance(wallet, TRON, `listing:${f.canonical.listingId}`), BigInt("200000000"));
  assert.equal(expectedCustody(wallet, TRON), BigInt("500000000"));
  assert(wallet.haltReason && wallet.payouts.size === 0);
  checks.push("Web and mobile owners export identical private financial bytes; a fresh paused restore excludes both mobile auth tables and retains 500 synthetic USDT as 300 reserved plus 200 available");
  return { source: backup.checkpoint, restored: restored.restored, mobileCredentialsRestored: false, sourcePaused: true,
    restoredPaused: true, providerSubmissions: 0, principalRaw: "500000000", tradeReservedRaw: "300000000", listingAvailableRaw: "200000000" };
}

async function main() {
  assertSimulationRuntime(MODE);
  const urls = argumentsOf(process.argv.slice(2));
  const stores: WalletStore[] = [];
  const open = async (url: string) => { const store = await createPostgresWalletStore({ mode: MODE, connectionString: url }); stores.push(store); return store; };
  const checks: string[] = [];
  try {
    stage = "all three native database freshness checks before fixture writes";
    const atomic = await open(urls.atomic), auth = await open(urls.auth), target = await open(urls.restore);
    await Promise.all([fresh(atomic), fresh(auth), fresh(target)]);
    checks.push("All three explicitly named isolated native databases are empty and checked before any fixture write");
    const f = await setup(atomic, "ios", "Bank Transfer");
    const a = await setup(auth, "android", "Face-to-Face");
    const recovery = await atomicAndRecovery(atomic, target, f, checks);
    await mobileCoordinator(auth).enrollReservedTrade(enrollment(a));
    const accepting = await open(urls.auth), changing = await open(urls.auth);
    const retries: Record<string, number> = {};
    for (const kind of ["logout", "rotation", "replacement", "account"] as const) retries[kind] = await staleAuthority(auth, accepting, changing, a, kind, checks);
    const ordering = await orderedLogout(auth, accepting, changing, await open(urls.auth), a, checks);
    console.log(JSON.stringify({ kind: "alpha-wallet-native-mobile-coordination-v1", mode: MODE, status: "passed", checks,
      platforms: ["ios", "android"], locales: ["en", "ar"], staleAuthorityAttempts: retries, ordering, recovery,
      providerSubmissions: 0, limits: [
        "Private development API only; no mobile route, login flow, push delivery, provider or signer is activated.",
        "The native fixtures apply the actual mobile session schema, hash conventions and rotation/global-lock SQL contract; they do not contact the production mobile session service.",
        "Revocation queued after a financial operation holds its auth locks commits afterward; it does not cancel that earlier operation.",
        "Expiry is checked at authorization checkpoints; there is no wall-clock COMMIT acknowledgement deadline guarantee.",
        "Lost response is injected after real COMMIT, not a physical network partition.",
        "The existing bounded amount-correction cohort and credential-free recovery format remain unchanged.",
      ] }, null, 2));
  } finally { await Promise.allSettled(stores.map(store => store.close())); }
}
void main().catch(error => {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : undefined;
  const scalar = (value: unknown) => typeof value === "number" || typeof value === "boolean" || value === null ? value : typeof value;
  console.error(JSON.stringify({ status: "failed", stage, errorType: error instanceof Error ? error.name : "unknown", code,
    assertion: error instanceof AssertionError ? { operator: error.operator, actual: scalar(error.actual), expected: scalar(error.expected) } : undefined,
    note: "Driver details, credentials and private causes are omitted. Only explicit disposable development databases were used." }));
  process.exitCode = 1;
});
