/**
 * Authenticated initial marketplace acceptance on explicit disposable PostgreSQL.
 * Every account, credential, request and funded asset is a public synthetic fixture.
 * Nothing invokes a live route, provider, signer, notification sender or restore.
 */
import { AssertionError, strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { Client } from "pg";
import type { AlphaExchangeUser, PurchaseRequest } from "../../src/types/alpha-exchange";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletSql, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import {
  createDevelopmentInitialMarketplaceWalletCoordinator, createDevelopmentMobileInitialMarketplaceWalletCoordinator,
} from "../../src/lib/alpha-wallet/initial-marketplace-coordinator";
import { balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { exportMarketplaceWalletBackup } from "../../src/lib/alpha-wallet/marketplace-backup";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { exportVersionedWalletBackup } from "../../src/lib/alpha-wallet/versioned-backup";
import { exportV3WalletBackup } from "../../src/lib/alpha-wallet/v3-backup";
import { v3Command } from "../../src/lib/alpha-wallet/v3-commands";
import { createV3DurableWallet, verifyV3History } from "../../src/lib/alpha-wallet/v3-durable";
import { assertV3Invariants, isV3State } from "../../src/lib/alpha-wallet/v3-engine";
import { FIXTURE_TIME, OPERATOR, TRON } from "./durable-fixtures";
import { buildInitialMarketplaceFixture } from "./initial-marketplace-fixtures";

const MODE = "simulation-only" as const;
const NOW = FIXTURE_TIME + 1000;
const USAGE = "Pass --fresh-simulation-databases with --atomic-connection-string, --race-connection-string and --auth-connection-string for three different already-created empty loopback alpha_wallet_dev_ databases. No environment database URL is read; no database is created or dropped.";
const SCHEMA = "alpha_wallet_initial_marketplace_simulation";
const TABLES = ["runtime_meta", "users", "listings", "purchase_requests", "trades", "commissions",
  "marketplace_enforcement_records", "evidence", "disputes", "notifications", "audit_logs"] as const;
const webQuery = /FROM alpha_exchange\.sessions AS session/i;
const mobileQuery = /FROM alpha_exchange\.mobile_device_sessions AS session/i;
let stage = "argument validation";
type Fixture = Awaited<ReturnType<typeof buildInitialMarketplaceFixture>>["canonical"];
type Receipt = Awaited<ReturnType<ReturnType<typeof createDevelopmentInitialMarketplaceWalletCoordinator>["acceptRequest"]>>;
type Row = Record<string, unknown>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function failureCode(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

function argumentsOf(args: string[]) {
  assert.equal(args.length, 7, USAGE);
  let fresh = false;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--fresh-simulation-databases") { assert(!fresh, USAGE); fresh = true; }
    else if (["--atomic-connection-string", "--race-connection-string", "--auth-connection-string"].includes(name)) {
      assert(!values.has(name) && args[index + 1] && !args[index + 1].startsWith("--"), USAGE);
      values.set(name, args[++index]);
    } else assert.fail(USAGE);
  }
  assert(fresh && values.size === 3, USAGE);
  assert.equal(new Set([...values.values()].map(url => decodeURIComponent(new URL(url).pathname))).size, 3, USAGE);
  return { atomic: values.get("--atomic-connection-string")!, race: values.get("--race-connection-string")!,
    auth: values.get("--auth-connection-string")! };
}
function deferred() {
  let resolve!: () => void, reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Native initial marketplace gate timed out: ${label}`)), 15_000);
  })]); } finally { if (timer !== undefined) clearTimeout(timer); }
}
const wrapped = (store: WalletStore, wrap: (tx: WalletSql) => WalletSql): WalletStore => ({
  transaction: work => store.transaction(tx => work(wrap(tx))), close: async () => undefined,
});
const web = (store: WalletStore, clock = () => NOW) => createDevelopmentInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock });
const mobile = (store: WalletStore, clock = () => NOW) => createDevelopmentMobileInitialMarketplaceWalletCoordinator({ mode: MODE, store, clock });
const ownerInput = (f: Fixture) => ({ sessionToken: f.ownerSessionToken, requestId: f.requestId });
const activation = (f: Fixture, operationId = "native-initial-activate") => ({ ...ownerInput(f), operationId,
  walletListingId: f.walletListingId, walletTradeId: f.walletTradeId, assetId: f.assetId });
const acceptance = (f: Fixture, operationId = "native-initial-web-accept") => ({ sessionToken: f.sellerSessionToken,
  requestId: f.requestId, operationId,
  ...(f.initialRequest.paymentMethod === "Bank Transfer" ? {} : { safetyAcknowledged: true as const }) });
const mobileAcceptance = (f: Fixture, operationId = "native-initial-mobile-accept") => ({ ...f.mobile.credentials[f.sellerId],
  requestId: f.requestId, operationId,
  ...(f.initialRequest.paymentMethod === "Bank Transfer" ? {} : { safetyAcknowledged: true as const }) });

async function fresh(store: WalletStore) {
  await store.transaction(async tx => {
    const schemas = await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'");
    const relations = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
    const role = await tx.query<{ permitted: boolean }>("SELECT rolsuper OR rolbypassrls AS permitted FROM pg_roles WHERE rolname=current_user");
    assert.equal(schemas.rows.length, 0, "Existing schemas are never removed");
    assert.equal(relations.rows[0]?.count, "0");
    assert.equal(role.rows[0]?.permitted, true, "Disposable native fixture role requires BYPASSRLS");
  });
}

/** Read-only fixture evidence, never authority or an alternative wallet writer. */
async function footprint(store: WalletStore) {
  return store.transaction(async tx => {
    const commands = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const snapshot = verifyV3History(commands);
    assert(isV3State(snapshot.state));
    assertV3Invariants(snapshot.state);
    const marketplace: Record<string, Row[]> = {};
    for (const table of TABLES) {
      marketplace[table] = (await tx.query(`SELECT to_jsonb(t) AS row FROM alpha_exchange.${table} t
        ORDER BY ${table === "runtime_meta" ? "singleton" : "id"}`)).rows.map(row => row.row as Row);
    }
    const activations = (await tx.query(`SELECT * FROM ${SCHEMA}.activations ORDER BY request_id`)).rows;
    const acceptances = (await tx.query(`SELECT * FROM ${SCHEMA}.acceptances ORDER BY request_id`)).rows;
    const publications = (await tx.query(`SELECT * FROM ${SCHEMA}.publications ORDER BY id`)).rows;
    const bindings = (await tx.query("SELECT * FROM alpha_wallet_simulation.initial_trade_bindings ORDER BY platform_request_id")).rows;
    const receipts = (await tx.query("SELECT * FROM alpha_wallet_simulation.initial_acceptance_receipts ORDER BY acceptance_key")).rows;
    return { commands, snapshot: { ...snapshot, state: snapshot.state }, marketplace, activations, acceptances, publications, bindings, receipts };
  });
}
type Footprint = Awaited<ReturnType<typeof footprint>>;
function assertFinancialUnchanged(after: Footprint, before: Footprint) {
  // Authentication races intentionally change the stored account/session. Their
  // financial/canonical trade decision must still be wholly rolled back.
  const withoutUsers = (value: Footprint) => ({ ...value, marketplace: Object.fromEntries(
    Object.entries(value.marketplace).filter(([name]) => name !== "users" && name !== "runtime_meta")), });
  assert.deepEqual(withoutUsers(after), withoutUsers(before));
}
function assertAccepted(current: Footprint, before: Footprint, f: Fixture) {
  const row = current.marketplace.purchase_requests.find(item => item.id === f.requestId)!;
  const request = row.payload as PurchaseRequest;
  const listing = current.marketplace.listings.find(item => item.id === f.listingId)!;
  assert.equal(row.status, "accepted"); assert.equal(row.trade_id, f.tradeId);
  assert.equal(request.tradeCreatedAt, new Date(NOW).toISOString());
  assert.equal(request.usdtAmount, "200"); assert.equal(request.pricePerUsdt, "3.10");
  assert.equal(request.fiatAmount, "626.20"); assert.equal(request.listingPriceAtRequest, "3.10");
  assert.equal(request.sellerId, f.sellerId); assert.equal(request.buyerId, f.buyerId);
  assert.equal(request.timeline.length, f.initialRequest.timeline.length + 1);
  assert.equal(request.timeline.at(-1)?.actorUserId, f.sellerId);
  assert.equal(request.timeline.at(-1)?.type, "request_accepted");
  assert.equal(listing.status, "matched"); assert.equal(listing.active_trade_request_id, f.requestId);
  assert.equal((listing.payload as Fixture["initialListing"]).price, "3.20");
  assert.equal((listing.payload as Fixture["initialListing"]).availableAmount, "500");
  const trade = current.marketplace.trades.find(item => item.id === f.tradeId)!;
  assert(trade); assert.equal(trade.purchase_request_id, f.requestId); assert.equal(trade.status, "accepted");
  assert.equal(trade.seller_id, f.sellerId); assert.equal(trade.buyer_id, f.buyerId);
  const originalProjection = before.marketplace.trades.find(item => item.id === f.tradeId);
  if (originalProjection) assert.equal(trade.sort_index, originalProjection.sort_index);
  assert.equal(current.marketplace.notifications.length, before.marketplace.notifications.length + 1);
  assert.equal(current.marketplace.audit_logs.length, before.marketplace.audit_logs.length + 1);
  assert.equal(current.activations.length, 1); assert.equal(current.acceptances.length, 1);
  assert.equal(current.publications.length, 1); assert.equal(current.bindings.length, 1); assert.equal(current.receipts.length, 1);
  assert.equal(current.commands.length, before.commands.length + 1);
  assert.deepEqual(current.commands.slice(0, before.commands.length), before.commands);
  assert.equal(current.commands.at(-1)?.command_type, "acceptInitialSellerRequest");
  const command = current.commands.at(-1)?.command_json as { actor: { kind: string; id: string } };
  assert.deepEqual(command.actor, { kind: "seller", id: f.sellerId });
  assert.equal(current.snapshot.state.trades.get(f.walletTradeId)?.buyerId, f.buyerId);
  assert.equal(current.snapshot.state.trades.get(f.walletTradeId)?.sellerId, f.sellerId);
  assert.equal(current.snapshot.state.initialBindings.size, 1); assert.equal(current.snapshot.state.initialAcceptanceReceipts.size, 1);
  assert.equal(balance(current.snapshot.state, TRON, `listing:${f.walletListingId}`), BigInt(300_000_000));
  assert.equal(balance(current.snapshot.state, TRON, `trade:${f.walletTradeId}`), BigInt(200_000_000));
  assert.equal(expectedCustody(current.snapshot.state, TRON), BigInt(500_000_000));
  assert.equal(current.snapshot.state.listings.get(f.walletListingId)?.price, "3.20");
  assert.equal(current.snapshot.state.payouts.size, 0);
  for (const name of ["users", "commissions", "marketplace_enforcement_records", "evidence", "disputes"]) {
    assert.deepEqual(current.marketplace[name], before.marketplace[name]);
  }
  assert.deepEqual(current.marketplace.purchase_requests.filter(item => item.id !== f.requestId),
    before.marketplace.purchase_requests.filter(item => item.id !== f.requestId));
  assert.deepEqual(current.marketplace.listings.filter(item => item.id !== f.listingId),
    before.marketplace.listings.filter(item => item.id !== f.listingId));
}
async function waitForLock(observer: WalletStore, pid: number, kind: "row" | "advisory") {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const result = await observer.transaction(tx => tx.query<{ waiting: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted
      AND (($2='row' AND locktype IN ('tuple','transactionid')) OR ($2='advisory' AND locktype='advisory'))) AS waiting`, [pid, kind]));
    if (result.rows[0]?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`The native ${kind} lock wait was not observed`);
}

async function verifyAtomic(store: WalletStore, f: Fixture, checks: string[]) {
  stage = "owner activation and seller impersonation boundaries";
  const beforeActivation = await footprint(store);
  await assert.rejects(web(store).acceptRequest(acceptance(f, "native-initial-unactivated")));
  await assert.rejects(web(store).activateRequest({ ...activation(f), sessionToken: f.sellerSessionToken }));
  await assert.rejects(web(store).activateRequest({ ...activation(f), sessionToken: f.buyerSessionToken }));
  assert.deepEqual(await footprint(store), beforeActivation);
  const activated = await web(store).activateRequest(activation(f));
  assert.equal(activated.replayed, false);
  const afterActivation = await footprint(store);
  assert.equal(afterActivation.activations.length, 1); assert.equal(afterActivation.acceptances.length, 0);
  assert.deepEqual(afterActivation.commands, beforeActivation.commands);
  assert.equal(afterActivation.snapshot.state.initialBindings.size, 0);
  assert.equal(afterActivation.snapshot.state.trades.size, 0);
  const activatedAgain = await web(store).activateRequest(activation(f, "native-initial-activation-retry"));
  assert.deepEqual(activatedAgain, { ...activated, replayed: true });
  await assert.rejects(web(store).acceptRequest({ ...acceptance(f), sessionToken: f.buyerSessionToken }));
  await assert.rejects(web(store).acceptRequest({ ...acceptance(f), sessionToken: f.ownerSessionToken }));
  await assert.rejects(web(store).acceptRequest({ ...acceptance(f), sessionToken: f.otherSellerSessionToken }));
  await assert.rejects(web(store).acceptRequest({ ...acceptance(f), requestId: f.tradeId }));
  await assert.rejects(mobile(store).acceptRequest({ ...mobileAcceptance(f), metadata: {
    ...f.mobile.credentials[f.sellerId].metadata, deviceId: "wrong-native-fixture-device" } }));
  assert.deepEqual(await footprint(store), afterActivation);
  checks.push("Only the stored owner activates the exact pending request mapping; buyer, owner, other seller, trade-ID alias and wrong mobile device cannot authorize seller acceptance");

  for (const [label, trigger] of [
    ["after full principal and binding", /INSERT INTO alpha_wallet_simulation\.initial_acceptance_receipts/i],
    ["after physical canonical persistence", /INSERT INTO alpha_wallet_initial_marketplace_simulation\.acceptances/i],
    ["after immutable coordinated receipt", /INSERT INTO alpha_wallet_initial_marketplace_simulation\.publications/i],
  ] as const) {
    stage = `SQL rollback ${label}`;
    let reached = false;
    const broken = wrapped(store, tx => ({ exec: sql => tx.exec(sql), async query<R extends Row>(sql: string, params?: unknown[]) {
      if (trigger.test(sql)) {
        reached = true;
        await tx.query("SELECT 1 / 0 /* native initial marketplace atomic failure */");
      }
      return tx.query<R>(sql, params);
    } }));
    await assert.rejects(web(broken).acceptRequest(acceptance(f, `native-initial-failure-${checks.length}`)));
    assert(reached, "The intended late SQL failure point must have been reached");
    assert.deepEqual(await footprint(store), afterActivation);
    checks.push(`A real native SQL rejection ${label} rolls back the wallet, canonical request/trade/listing/events and receipt/publication as one transaction`);
  }

  stage = "mobile expiry after canonical UPDATE";
  let now = NOW, expiryReached = false;
  const expired = wrapped(store, tx => ({ exec: sql => tx.exec(sql), async query<R extends Row>(sql: string, params?: unknown[]) {
    const result = await tx.query<R>(sql, params);
    if (/initial acceptance: request persistence/i.test(sql)) { expiryReached = true; now = f.mobile.expiresAtMs; }
    return result;
  } }));
  await assert.rejects(mobile(expired, () => now).acceptRequest(mobileAcceptance(f, "native-initial-expired-mobile")),
    error => failureCode(error) === "WALLET_SESSION_REQUIRED");
  assert(expiryReached); assert.deepEqual(await footprint(store), afterActivation);
  checks.push("Mobile session expiry after the actual canonical UPDATE rejects the late authority checkpoint and rolls the complete reservation back");

  stage = "real acceptance COMMIT with injected lost reply";
  const lost: WalletStore = { close: async () => undefined, async transaction<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
    await store.transaction(work);
    throw new CommitOutcomeUnknownError(new Error("Synthetic reply loss after actual native initial acceptance COMMIT"));
  } };
  await assert.rejects(mobile(lost).acceptRequest(mobileAcceptance(f, "native-initial-lost-reply")), CommitOutcomeUnknownError);
  const committed = await footprint(store);
  assertAccepted(committed, afterActivation, f);
  const fromWeb = await web(store).acceptRequest(acceptance(f, "native-initial-web-recover"));
  const fromMobile = await mobile(store).acceptRequest(mobileAcceptance(f, "native-initial-mobile-recover"));
  assert(fromWeb.replayed && fromMobile.replayed); assert.deepEqual(fromWeb, fromMobile);
  assert.equal(fromWeb.principalRaw, "200000000"); assert.equal(fromWeb.platformTradeId, f.tradeId);
  assert.equal(fromWeb.walletTradeId, f.walletTradeId); assert.equal(fromWeb.terms.pricePerUsdt, "3.10");
  assert.equal(fromWeb.terms.fiatAmount, "626.20");
  assert.deepEqual(await footprint(store), committed);
  const publicJson = JSON.stringify(fromWeb);
  for (const secret of [f.ownerSessionToken, f.sellerSessionToken, hash(f.sellerSessionToken),
    f.mobile.credentials[f.sellerId].accessToken, f.mobile.credentials[f.sellerId].metadata.deviceId,
    f.initialRequest.sellerBankAccountSnapshot?.accountNumber, f.initialRequest.buyerReceivingWalletAddress].filter((value): value is string => Boolean(value))) {
    assert(!publicJson.includes(secret));
  }
  checks.push("One real seller COMMIT retains the original 3.10 ILS quote and full 200-USDT principal; either current transport recovers one private-safe original receipt after injected reply loss");

  stage = "unsupported legacy and standalone writers after initial activation";
  for (const [sql, params] of [
    ["UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{buyerNotes}','\"unsupported\"') WHERE id=$1", [f.requestId]],
    ["UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{buyerNotes}','\"unsupported sibling\"') WHERE id=$1", [f.otherRequestId]],
    ["UPDATE alpha_exchange.listings SET payload=jsonb_set(payload,'{price}','\"3.30\"') WHERE id=$1", [f.listingId]],
    ["UPDATE alpha_exchange.trades SET status='payment_sent' WHERE id=$1", [f.tradeId]],
    [`UPDATE ${SCHEMA}.acceptances SET input_digest=repeat('0',64) WHERE request_id=$1`, [f.requestId]],
    [`DELETE FROM ${SCHEMA}.publications`, []],
    [`TRUNCATE ${SCHEMA}.activations CASCADE`, []],
  ] as [string, unknown[]][]) await assert.rejects(store.transaction(tx => tx.query(sql, params)));
  await assert.rejects(createV3DurableWallet({ mode: MODE, store, clock: () => NOW }).execute(
    v3Command("pause", OPERATOR, "native-initial-standalone-pause", null)));
  await assert.rejects(web(store).acceptRequest({ ...acceptance(f, "native-initial-altered-consent"),
    safetyAcknowledged: f.initialRequest.paymentMethod === "Bank Transfer" ? true : undefined }));
  assert.deepEqual(await footprint(store), committed);
  checks.push("Legacy target and sibling writers, altered retry consent, immutable receipt/publication changes and standalone wallet commands remain fenced after activation");

  stage = "owner pause and unavailable recovery formats";
  await web(store).pause({ ...ownerInput(f), operationId: "native-initial-source-pause" });
  const paused = await footprint(store);
  assert(paused.snapshot.state.haltReason);
  assert.deepEqual(await web(store).acceptRequest(acceptance(f, "native-initial-paused-web-retry")), fromWeb);
  assert.deepEqual(await mobile(store).acceptRequest(mobileAcceptance(f, "native-initial-paused-mobile-retry")), fromWeb);
  await assert.rejects(exportV3WalletBackup({ mode: MODE, store, clock: () => NOW }));
  await assert.rejects(exportVersionedWalletBackup({ mode: MODE, store, clock: () => NOW }));
  await assert.rejects(exportMarketplaceWalletBackup({ mode: MODE, store, ...ownerInput(f), clock: () => NOW }));
  assert.deepEqual(await footprint(store), paused);
  checks.push("The owner pauses the cohort, current sellers recover the original receipt without another command, and all old/isolated backup formats refuse the new canonical cohort");
  return { receipt: fromWeb, inspected: await web(store).inspect(ownerInput(f)), sourcePaused: true };
}

async function auxiliaryBeforeActivation(observer: WalletStore, activating: WalletStore, f: Fixture, connectionString: string) {
  stage = "preactivation READ COMMITTED evidence writer";
  // The exact URL has already passed loopback and empty-database validation.
  // This deliberately models an older writer without the coordinator's global lock.
  const legacy = new Client({ connectionString });
  await legacy.connect();
  const before = await footprint(observer);
  let pending = false, attempts = 0, pid = 0;
  const entered = deferred();
  let operation: Promise<unknown> | undefined;
  try {
    await legacy.query("BEGIN ISOLATION LEVEL READ COMMITTED"); pending = true;
    await legacy.query("SET LOCAL alpha_wallet.development_schema='simulation-only'");
    const evidence = { id: "native-initial-prior-evidence", purchaseRequestId: f.requestId, side: "buyer",
      uploadedByUserId: f.buyerId, mimeType: "image/png", fileName: "synthetic.png", sizeBytes: 1, uploadedAt: f.at };
    await legacy.query(`INSERT INTO alpha_exchange.evidence
      (id,purchase_request_id,side,uploaded_by_user_id,mime_type,file_name,size_bytes,uploaded_at,sort_index,payload,content)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,99,$9::jsonb,NULL)`,
    [evidence.id, evidence.purchaseRequestId, evidence.side, evidence.uploadedByUserId, evidence.mimeType,
      evidence.fileName, evidence.sizeBytes, evidence.uploadedAt, JSON.stringify(evidence)]);
    const gate: WalletStore = { close: async () => undefined, transaction: work => activating.transaction(async tx => {
      attempts++;
      pid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,version FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0].pid;
      entered.resolve();
      return work(tx);
    }) };
    operation = web(gate).activateRequest(activation(f, "native-initial-prior-evidence-activation"));
    const outcome = operation.then(() => ({ accepted: true, code: undefined }), error => ({ accepted: false, code: failureCode(error) }));
    void operation.catch(entered.reject);
    await bounded(entered.promise, "activation entering stale auxiliary conflict");
    await waitForLock(observer, pid, "row");
    await legacy.query("COMMIT"); pending = false;
    assert.deepEqual(await bounded(outcome, "fresh activation denial after evidence"), { accepted: false, code: "LOCKED" });
    assert(attempts >= 2, "The auxiliary physical listing fence must invalidate activation's first snapshot");
    const after = await footprint(observer);
    assert.deepEqual(after.commands, before.commands); assert.equal(after.activations.length, 0);
    assert.equal(after.marketplace.evidence.length, 1);
    for (const name of ["purchase_requests", "trades", "listings", "notifications", "audit_logs"]) {
      assert.deepEqual(after.marketplace[name], before.marketplace[name]);
    }
    await observer.transaction(tx => tx.query("DELETE FROM alpha_exchange.evidence WHERE id=$1", [evidence.id]));
    return { attempts, rowWaitObserved: true, legacyIsolation: "read committed", committedEvidenceRechecked: true };
  } finally {
    if (pending) await legacy.query("ROLLBACK");
    await legacy.end();
    if (operation) await bounded(Promise.allSettled([operation]), "auxiliary writer cleanup");
  }
}

async function staleWriterAndAcceptanceRace(observer: WalletStore, firstStore: WalletStore, secondStore: WalletStore,
  f: Fixture, connectionString: string, checks: string[]) {
  const auxiliary = await auxiliaryBeforeActivation(observer, firstStore, f, connectionString);
  checks.push("A preactivation READ COMMITTED evidence writer visibly blocks activation, physically invalidates its stale snapshot and forces a fresh ineligibility rejection");
  stage = "stale ordinary writer versus explicit activation";
  const started = deferred(), release = deferred();
  let attempts = 0, oldVersion = "";
  const stale = firstStore.transaction(async tx => {
    attempts++;
    const row = (await tx.query<{ version: string }>("SELECT version::text AS version FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0];
    if (attempts === 1) { oldVersion = row.version; started.resolve(); await bounded(release.promise, "stale ordinary writer release"); }
    await tx.query("UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{buyerNotes}','\"stale ordinary writer\"') WHERE id=$1", [f.requestId]);
  });
  const rejected = stale.then(() => false, () => true);
  void stale.catch(started.reject);
  try {
    await bounded(started.promise, "preactivation ordinary snapshot");
    await web(observer).activateRequest(activation(f, "native-initial-race-activation"));
  } finally { release.resolve(); }
  assert.equal(await bounded(rejected, "legacy writer denied after activation"), true);
  assert(attempts >= 2);
  const before = await footprint(observer);
  assert.equal((before.marketplace.purchase_requests.find(row => row.id === f.requestId)!.payload as PurchaseRequest).buyerNotes, f.initialRequest.buyerNotes);
  assert(BigInt(String(before.marketplace.runtime_meta[0].version)) > BigInt(oldVersion));
  checks.push("Owner activation physically versions the listing, siblings and runtime so an older SERIALIZABLE writer retries and then encounters the activated writer guard");

  stage = "stored web seller and mobile seller race";
  const held = deferred(), commit = deferred(), contenderStarted = deferred();
  let firstPid = 0, secondPid = 0, secondAttempts = 0, gated = false;
  const first = web(wrapped(firstStore, tx => ({ exec: sql => tx.exec(sql), async query<R extends Row>(sql: string, params?: unknown[]) {
    const result = await tx.query<R>(sql, params);
    if (!gated && webQuery.test(sql)) {
      gated = true; firstPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      held.resolve(); await bounded(commit.promise, "first seller's acceptance release");
    }
    return result;
  } }))).acceptRequest(acceptance(f, "native-initial-race-web"));
  void first.then(() => { if (!gated) held.reject(new Error("The seller authority gate was not reached")); }, held.reject);
  await bounded(held.promise, "first seller holds shared authority locks");
  const contender: WalletStore = { close: async () => undefined, transaction: work => secondStore.transaction(async tx => {
    secondAttempts++;
    secondPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid,version FROM alpha_exchange.runtime_meta WHERE singleton=true")).rows[0].pid;
    if (secondAttempts === 1) contenderStarted.resolve();
    return work(tx);
  }) };
  const second = mobile(contender).acceptRequest(mobileAcceptance(f, "native-initial-race-mobile"));
  void second.catch(contenderStarted.reject);
  let result: Receipt[];
  try {
    await bounded(contenderStarted.promise, "mobile contender establishes snapshot");
    assert.notEqual(firstPid, secondPid);
    await waitForLock(observer, secondPid, "advisory");
    commit.resolve();
    result = await bounded(Promise.all([first, second]), "both seller transports finish");
  } finally { commit.resolve(); await Promise.allSettled([first, second]); }
  assert.equal(result[0].replayed, false); assert.equal(result[1].replayed, true);
  assert.deepEqual({ ...result[0], replayed: true }, result[1]);
  assert(secondAttempts >= 2);
  const accepted = await footprint(observer);
  assertAccepted(accepted, before, f);
  await web(observer).pause({ ...ownerInput(f), operationId: "native-initial-race-pause" });
  checks.push("Two different PostgreSQL backends and transports visibly serialize, retry the entire stale decision and return one original seller receipt with one 200-USDT reservation");
  return { auxiliary, staleWriterAttempts: attempts, acceptanceAttempts: secondAttempts,
    distinctBackends: true, advisoryWaitObserved: true, committedReservations: 1, sourcePaused: true };
}

async function staleSellerAuthority(observer: WalletStore, accepting: WalletStore, changing: WalletStore,
  f: Fixture, kind: "seller-status" | "mobile-logout") {
  stage = `stale ${kind} before locked seller authority`;
  const before = await footprint(observer), held = deferred(), release = deferred();
  let gated = false, attempts = 0;
  const gatedStore: WalletStore = { close: async () => undefined, transaction: work => accepting.transaction(tx => {
    attempts++;
    return work({ exec: sql => tx.exec(sql), async query<R extends Row>(sql: string, params?: unknown[]) {
      // Dependency writers version runtime_meta before touching the account.
      // Pause a stale account attempt before obtaining that fence, so the
      // ordinary writer can commit. Session logout has its own row-lock order.
      const trigger = kind === "seller-status" ? /SELECT pg_advisory_xact_lock\(61422917\)/i : mobileQuery;
      if (!gated && trigger.test(sql)) {
        gated = true; held.resolve(); await bounded(release.promise, "seller authority mutation release");
      }
      return tx.query<R>(sql, params);
    } });
  }) };
  const operation = kind === "seller-status" ? web(gatedStore).acceptRequest(acceptance(f, "native-initial-stale-status"))
    : mobile(gatedStore).acceptRequest(mobileAcceptance(f, "native-initial-stale-logout"));
  const outcome = operation.then(() => ({ accepted: true, code: undefined }), error => ({ accepted: false, code: failureCode(error) }));
  void operation.then(() => { if (!gated) held.reject(new Error("The stale seller gate was not reached")); }, held.reject);
  try {
    await bounded(held.promise, "first snapshot before stored seller change");
    await changing.transaction(async tx => {
      if (kind === "seller-status") {
        const account = f.accounts.find(user => user.id === f.sellerId)!;
        const suspended: AlphaExchangeUser = { ...structuredClone(account), sellerStatus: "suspended" };
        // Keep the stale approved_seller label on purpose; it cannot override status.
        await tx.query("UPDATE alpha_exchange.users SET seller_status='suspended',payload=$2::jsonb WHERE id=$1",
          [f.sellerId, JSON.stringify(suspended)]);
      } else {
        await tx.query("UPDATE alpha_exchange.mobile_device_sessions SET revoked_at=$2::timestamptz,revoke_reason='logout',updated_at=$2::timestamptz WHERE id=$1",
          [f.mobile.sessions[f.sellerId].id, new Date(NOW).toISOString()]);
      }
    });
    release.resolve();
    assert.deepEqual(await bounded(outcome, "fresh seller denial after stored change"),
      { accepted: false, code: kind === "seller-status" ? "ACTOR" : "WALLET_SESSION_REQUIRED" });
    assert(attempts >= 2, "Changed locked authority must retry the complete SERIALIZABLE decision");
    assertFinancialUnchanged(await footprint(observer), before);
  } finally { release.resolve(); await Promise.allSettled([operation]); }
  // Restore only deliberate disposable fixture authority, without changing any
  // wallet or marketplace trade history. This is never an application repair.
  await observer.transaction(async tx => {
    if (kind === "seller-status") {
      const account = f.accounts.find(user => user.id === f.sellerId)!;
      await tx.query("UPDATE alpha_exchange.users SET seller_status=$2,payload=$3::jsonb WHERE id=$1",
        [account.id, account.sellerStatus, JSON.stringify(account)]);
    } else {
      const session = f.mobile.sessions[f.sellerId];
      await tx.query("UPDATE alpha_exchange.mobile_device_sessions SET revoked_at=NULL,revoke_reason=NULL,updated_at=$2::timestamptz WHERE id=$1",
        [session.id, session.updatedAt]);
    }
  });
  return attempts;
}

async function orderedSellerLogout(observer: WalletStore, accepting: WalletStore, revoking: WalletStore,
  f: Fixture, checks: string[]) {
  stage = "seller logout ordered after existing shared authority lock";
  const before = await footprint(observer), held = deferred(), release = deferred(), logoutStarted = deferred();
  let gated = false, financialPid = 0, logoutPid = 0;
  const financial = mobile(wrapped(accepting, tx => ({ exec: sql => tx.exec(sql), async query<R extends Row>(sql: string, params?: unknown[]) {
    const result = await tx.query<R>(sql, params);
    if (!gated && mobileQuery.test(sql)) {
      gated = true; financialPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      held.resolve(); await bounded(release.promise, "authorized seller release");
    }
    return result;
  } }))).acceptRequest(mobileAcceptance(f, "native-initial-ordered-mobile"));
  void financial.then(() => { if (!gated) held.reject(new Error("The ordered seller gate was not reached")); }, held.reject);
  await bounded(held.promise, "seller authentication row share lock");
  let logoutCommitted = false;
  const logout = revoking.transaction(async tx => {
    logoutPid = (await tx.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    logoutStarted.resolve();
    await tx.query("UPDATE alpha_exchange.mobile_device_sessions SET revoked_at=$2::timestamptz,revoke_reason='logout',updated_at=$2::timestamptz WHERE id=$1",
      [f.mobile.sessions[f.sellerId].id, new Date(NOW).toISOString()]);
  }).then(() => { logoutCommitted = true; });
  void logout.catch(logoutStarted.reject);
  let receipt: Receipt;
  try {
    await bounded(logoutStarted.promise, "competing mobile logout");
    assert.notEqual(financialPid, logoutPid);
    await waitForLock(observer, logoutPid, "row");
    assert.equal(logoutCommitted, false);
    release.resolve();
    receipt = await bounded(financial, "authorized seller acceptance before logout");
    await bounded(logout, "queued logout commits after acceptance");
  } finally { release.resolve(); await Promise.allSettled([financial, logout]); }
  const after = await footprint(observer);
  assertAccepted(after, before, f);
  assert.equal(receipt.replayed, false); assert.equal(logoutCommitted, true);
  await assert.rejects(mobile(observer).acceptRequest(mobileAcceptance(f, "native-initial-revoked-retry")),
    error => failureCode(error) === "WALLET_SESSION_REQUIRED");
  const fromWeb = await web(observer).acceptRequest(acceptance(f, "native-initial-current-web-retry"));
  assert.deepEqual(fromWeb, { ...receipt, replayed: true });
  assert.deepEqual(await footprint(observer), after);
  await web(observer).pause({ ...ownerInput(f), operationId: "native-initial-auth-pause" });
  checks.push("A logout queued behind the seller's held session lock commits after the authorized acceptance; the revoked mobile retry is denied while the current web seller recovers the original receipt");
  return { distinctBackends: true, rowWaitObserved: true, logoutCommittedAfterAcceptance: true,
    revokedMobileRetryDenied: true, currentWebReceiptRecovered: true, committedReservations: 1, sourcePaused: true };
}

async function main() {
  assertSimulationRuntime(MODE);
  if (process.argv.slice(2).join(" ") === "--help") { console.log(USAGE); return; }
  const urls = argumentsOf(process.argv.slice(2));
  const stores: WalletStore[] = [], checks: string[] = [];
  const open = async (connectionString: string) => {
    const store = await createPostgresWalletStore({ mode: MODE, connectionString }); stores.push(store); return store;
  };
  try {
    stage = "all native database freshness checks before fixture writes";
    const atomic = await open(urls.atomic), races = await open(urls.race), auth = await open(urls.auth);
    await Promise.all([fresh(atomic), fresh(races), fresh(auth)]);
    const a = await buildInitialMarketplaceFixture(atomic, { paymentMethod: "Bank Transfer", platform: "ios", tradeProjection: "absent" });
    const r = await buildInitialMarketplaceFixture(races, { paymentMethod: "Face-to-Face", platform: "android", tradeProjection: "pending" });
    const h = await buildInitialMarketplaceFixture(auth, { paymentMethod: "Bank Transfer", platform: "android", tradeProjection: "pending" });
    for (const [store, fixture] of [[atomic, a], [races, r], [auth, h]] as const) {
      const current = await footprint(store);
      assert.equal(current.snapshot.revision, fixture.before.revision);
      assert.equal(current.snapshot.eventHash, fixture.before.eventHash);
      assert.equal(walletDigest(current.snapshot.state), walletDigest(fixture.before.state));
      assert.equal(current.snapshot.state.payouts.size, 0);
    }
    checks.push("Three explicit empty native databases receive synthetic canonical/web/mobile rows and intact v1/v2/v3 history; initialization and activation create no payout or provider work");
    const atomicResult = await verifyAtomic(atomic, a.canonical, checks);
    const concurrency = await staleWriterAndAcceptanceRace(races, await open(urls.race), await open(urls.race), r.canonical, urls.race, checks);
    await web(auth).activateRequest(activation(h.canonical, "native-initial-auth-activate"));
    const accepting = await open(urls.auth), changing = await open(urls.auth);
    const authorityAttempts = {
      sellerStatus: await staleSellerAuthority(auth, accepting, changing, h.canonical, "seller-status"),
      mobileLogout: await staleSellerAuthority(auth, accepting, changing, h.canonical, "mobile-logout"),
    };
    checks.push("A seller suspension retaining its stale role label and a mobile logout committed after the first snapshot each force complete retry and denial before any principal or canonical acceptance commits");
    const logoutOrdering = await orderedSellerLogout(auth, accepting, changing, h.canonical, checks);
    stage = "fresh connection reopens paused coordinated initial state";
    const reopened = await web(await open(urls.atomic)).inspect(ownerInput(a.canonical));
    assert.deepEqual(reopened, atomicResult.inspected);
    for (const store of [atomic, races, auth]) assert((await footprint(store)).snapshot.state.haltReason);
    checks.push("A new native connection verifies the exact paused coordinated state and all three completed fixture sources remain paused");
    console.log(JSON.stringify({ kind: "alpha-wallet-native-initial-marketplace-v1", mode: MODE, status: "passed", checks,
      concurrency, authorityAttempts, logoutOrdering, originalReceipt: {
        walletRevision: atomicResult.receipt.walletRevision, walletEventHash: atomicResult.receipt.walletEventHash,
        acceptanceKey: atomicResult.receipt.acceptanceKey, termsDigest: atomicResult.receipt.termsDigest,
      }, money: { custodyUSDT: "500", reservedPrincipalUSDT: "200", listingAvailableUSDT: "300",
        retainedRequestPriceILS: "3.10", currentListingPriceILS: "3.20", buyerInclusiveTotalILS: "626.20" },
      platforms: ["ios", "android"], locales: ["en", "ar"], providerSubmissions: 0, externalMessages: 0,
      productionWrites: 0, allSourcesPaused: true, combinedRecoveryImplemented: false, limits: [
        "Private development APIs and disposable synthetic account/session rows only; no product route, real login or mobile screen is exercised.",
        "One explicitly activated pending request mapping; ordinary pending siblings stay frozen and the broader marketplace three-trade policy is unchanged.",
        "Publication intent and canonical notification rows are durable; no external delivery runs.",
        "Lost acknowledgement is injected after an actual PostgreSQL COMMIT, not a physical network partition.",
        "Revocation waits behind already-held authority locks; expiry is checked at authorization checkpoints, not at COMMIT acknowledgement arrival.",
        "Combined initial-cohort recovery is unfinished. Existing isolated and amount-correction backup formats fail closed.",
      ] }, null, 2));
  } finally {
    const results = await Promise.allSettled(stores.map(store => store.close()));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}
void main().catch(error => {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : undefined;
  const scalar = (value: unknown) => typeof value === "number" || typeof value === "boolean" || value === null ? value : typeof value;
  console.error(JSON.stringify({ mode: MODE, status: "failed", stage, errorType: error instanceof Error ? error.name : "unknown", code,
    assertion: error instanceof AssertionError ? { operator: error.operator, actual: scalar(error.actual), expected: scalar(error.expected) } : undefined,
    note: "Only explicit disposable development databases were used. Driver details, credentials and private causes are omitted." }));
  process.exitCode = 1;
});
