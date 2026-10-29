import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { repo } from '../environment.mjs';
import { PROJECT, TEAM, REF, ACCOUNTS, operation, validateRequest, validateContract, validateRuntimeProof, validateOidc, assertRedacted, safeError, transport } from './client.mjs';
import { readOnly, mobilePushGuard, validateBaseline, validatePreservation, verifyStorage } from './database.mjs';

const H = 'a'.repeat(64), U = '12345678-1234-4123-8123-123456789abc';
const actors = Object.fromEntries(['buyer', 'seller', 'admin', 'outsider'].map(role => [role, { appId: 'user-' + role, authId: U, fullName: 'Synthetic ' + role, email: role + '@example.com', password: 'synthetic-not-a-credential', phone: '+00000000000' }]));
const state = () => ({ runId: U, accounts: { buyer: 'wise-usd-buyer', seller: 'wise-usd-seller' }, reviewVersions: { buyer: H, seller: H }, staleVersion: 'b'.repeat(64), listingId: 'listing-owned', demandId: 'demand-owned', purchaseId: 'request-owned', offerId: 'offer-owned', revision: 1, publishOperation: U, offerOperation: U });
const contract = () => ({ schema: 1, projectId: PROJECT, teamId: TEAM, targetRef: REF, target: 'preview', sourceCommit: 'c'.repeat(40), deploymentId: 'dpl_reviewed', url: 'https://alpha-usdt-buy-requests-staging-reviewed-alpha-kits.vercel.app', runId: U, syntheticOnly: true, realFundsMoved: false, featureOffPhase: 'DEFERRED_SECOND_DEPLOYMENT', repoPath: repo, runtimeProof: { file: 'runtime.json', sha256: H }, helpers: { client: H, database: H, run: H, adapters: H, environment: H }, fixtureHashes: Object.fromEntries(['staging-final-accounts-20261025', 'staging-test-admin', 'staging-test-accounts'].map(k => [k, { manifest: H, progress: H }])), executionAuthorized: false });
const proof = () => ({ status: 'PASS_WISE_STAGING_RUNTIME_GUARD', projectId: PROJECT, targetRef: REF, deploymentId: 'dpl_reviewed', sourceCommit: 'c'.repeat(40), url: contract().url, nodeVersion: '24.22.1', environmentFingerprint: H, providerCredentialsAbsent: true, wiseDedicatedKeyConfigured: true, databaseTargetVerified: true, productionWrites: 0, runtimeConfig: { NODE_ENV: 'production', ALPHA_WISE_PAYMENTS_ENABLED: '1', ALPHA_EXCHANGE_DATA_BACKEND: 'postgres', ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: '', ALPHA_E2E_TEST_SUPPORT: '', ALPHA_E2E_LOOPBACK_ONLY: '', ALPHA_USDT_OFFLINE_PREVIEW: '', ALPHA_WISE_DRAFT_ENABLED: '', ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: '0', ALPHA_EXCHANGE_TWILIO_SEND_ENABLED: 'false', ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED: 'false', ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED: 'false', ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED: 'false' } });
const rejects = (fn, message) => assert.throws(fn, { message });

test('reviewed staging preflight contract passes; execution remains disabled', () => {
  assert.equal(validateContract(contract()).targetRef, REF);
  rejects(() => validateContract(contract(), true), 'EXECUTION_NOT_AUTHORIZED');
});
for (const [field, value, code] of [
  ['target', 'production', 'EXACT_STAGING_CONTRACT_REQUIRED'], ['projectId', 'prj_other', 'EXACT_STAGING_CONTRACT_REQUIRED'], ['targetRef', 'production-ref', 'EXACT_STAGING_CONTRACT_REQUIRED'],
  ['url', 'https://www.alphatraders.co.il', 'DIRECT_STAGING_ORIGIN_REQUIRED'], ['url', 'https://alpha-usdt-buy-requests-staging-ntneh.vercel.app', 'DIRECT_STAGING_ORIGIN_REQUIRED'],
  ['url', 'https://alpha-usdt-buy-requests-staging-reviewed-alpha-kits.vercel.app.evil.invalid', 'DIRECT_STAGING_ORIGIN_REQUIRED'], ['sourceCommit', null, 'CANDIDATE_IDENTITIES_REQUIRED'],
  ['realFundsMoved', true, 'SYNTHETIC_SCOPE_REQUIRED'], ['repoPath', path.join(repo, 'private'), 'LOCAL_CANDIDATE_REQUIRED'],
]) test('reject contract ' + field + ':' + String(value), () => rejects(() => validateContract({ ...contract(), [field]: value }), code));
test('unpinned helpers, fixtures and traversal proof cannot run', () => {
  rejects(() => validateContract({ ...contract(), helpers: {} }), 'REVIEWED_HELPER_HASHES_REQUIRED');
  rejects(() => validateContract({ ...contract(), helpers: { client: H, database: H, run: H } }), 'REVIEWED_HELPER_HASHES_REQUIRED');
  rejects(() => validateContract({ ...contract(), fixtureHashes: {} }), 'PINNED_FIXTURES_REQUIRED');
  rejects(() => validateContract({ ...contract(), runtimeProof: { file: '../runtime.json', sha256: H } }), 'PINNED_RUNTIME_PROOF_REQUIRED');
});
test('runtime proof requires actual isolated hosted capability and suppressed transports', () => {
  validateRuntimeProof(proof(), contract());
  for (const key of ['ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED', 'ALPHA_EXCHANGE_TWILIO_SEND_ENABLED', 'ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED', 'ALPHA_E2E_TEST_SUPPORT', 'ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY']) {
    const p = proof(); p.runtimeConfig[key] = '1'; rejects(() => validateRuntimeProof(p, contract()), 'HOSTED_MODE_AND_TRANSPORT_SUPPRESSION_REQUIRED');
  }
  for (const key of ['providerCredentialsAbsent', 'wiseDedicatedKeyConfigured', 'databaseTargetVerified']) rejects(() => validateRuntimeProof({ ...proof(), [key]: false }, contract()), 'RUNTIME_PROOF_MISMATCH');
});
const token = claims => 'e30.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.c2ln';
test('OIDC token is scoped and expires safely; no permissive missing claims', () => {
  const claims = { exp: Math.floor(Date.now() / 1000) + 600, project_id: PROJECT, owner_id: TEAM };
  assert.equal(validateOidc({ env: { VERCEL_OIDC_TOKEN: token(claims) } }), token(claims));
  for (const v of [{ ...claims, project_id: 'other' }, { ...claims, owner_id: undefined }, { ...claims, exp: 1 }]) rejects(() => validateOidc({ env: { VERCEL_OIDC_TOKEN: token(v) } }), 'OIDC_SCOPE_OR_EXPIRY_INVALID');
});
const labels = ['login-buyer', 'login-seller', 'login-admin', 'login-outsider', 'runtime-health', 'review-queue', 'public-listings', 'workspace', 'demand-read', 'private-trade', 'accounts-buyer', 'accounts-seller', 'create-buyer', 'create-seller', 'review-buyer', 'review-seller', 'stale-review-buyer', 'active-edit-buyer', 'active-edit-seller', 'evidence-buyer', 'evidence-seller', 'pre-review-edit', 'post-completion-edit', 'create-listing', 'approve-listing', 'publish', 'publish-replay', 'offer', 'offer-replay', 'match', 'match-replay', 'anonymous-details', 'outsider-details', 'admin-details', 'buyer-details', 'premature-release', 'accept', 'funds-received', 'release-pending', 'complete', 'complete-replay'];
test('every planned request validates exact route, role and body', () => { for (const l of labels) validateRequest(operation(l, state(), actors), state(), actors); });

test('completed private details require denial, while active disclosure stays a separate phase', () => {
  const completed = { ...state(), completed: true };
  const q = operation('completed-buyer-details', completed, actors);
  validateRequest(q, completed, actors);
  assert.equal(q.actor, 'buyer'); assert.deepEqual(q.statuses, [403]);
  rejects(() => operation('completed-buyer-details', state(), actors), 'COMPLETED_TRADE_REQUIRED');
  rejects(() => operation('buyer-details', completed, actors), 'ACTIVE_DISCLOSURE_STAGE_REQUIRED');
  rejects(() => validateRequest({ ...q, statuses: [200, 403] }, completed, actors), 'REQUEST_CONTRACT_MISMATCH');
});

test('completed disclosure denial is checked for no-store and private-data redaction', async () => {
  const original = globalThis.fetch; let t;
  try {
    t = await transport({ c: { ...contract(), runId: randomUUID() }, actors,
      api: async () => ({ env: { VERCEL_OIDC_TOKEN: token({ exp: Math.floor(Date.now() / 1000) + 600, project_id: PROJECT, owner_id: TEAM }) } }) });
    Object.assign(t.state, { purchaseId: 'request-owned', completed: true });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Private details are unavailable for a completed trade.' }),
      { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
    await t.call('completed-buyer-details');
    assert(t.report.checks.some(c => c.label === 'PRIVATE_NO_STORE' && c.passed));
    assert(t.report.deferred.some(reason => reason.startsWith('Post-completion private snapshot')));
    assert.equal(t.report.http.length, 1);
  } finally { globalThis.fetch = original; if (t) await unlink(t.file); }
});
for (const [name, data, cache, code] of [
  ['cached denial', { error: 'Unavailable' }, 'public, max-age=60', 'PRIVATE_NO_STORE'],
  ['bank data in denial', { error: 'Unavailable', accountNumber: ACCOUNTS.buyer }, 'private, no-store', 'PRIVATE_BANK_DATA_EXPOSED'],
]) test('completed disclosure rejects ' + name, async () => {
  const original = globalThis.fetch; let t;
  try {
    t = await transport({ c: { ...contract(), runId: randomUUID() }, actors,
      api: async () => ({ env: { VERCEL_OIDC_TOKEN: token({ exp: Math.floor(Date.now() / 1000) + 600, project_id: PROJECT, owner_id: TEAM }) } }) });
    Object.assign(t.state, { purchaseId: 'request-owned', completed: true });
    globalThis.fetch = async () => new Response(JSON.stringify(data),
      { status: 403, headers: { 'content-type': 'application/json', 'cache-control': cache } });
    await assert.rejects(() => t.call('completed-buyer-details'), { message: code });
  } finally { globalThis.fetch = original; if (t) await unlink(t.file); }
});
test('request mutations, redirects, actor impersonation and real transfer endpoints fail', () => {
  for (const changed of [q => q.route = '/api/admin/reset', q => q.route = 'https://api.wise.com/v1/transfers', q => q.actor = 'outsider', q => q.body.currency = 'ILS', q => q.body.wiseAccountId = 'wise-usd-foreign', q => q.headers = { origin: 'https://evil.invalid' }]) {
    const q = operation('create-listing', state(), actors); changed(q); rejects(() => validateRequest(q, state(), actors), 'REQUEST_CONTRACT_MISMATCH');
  }
  rejects(() => operation('delete-account', state(), actors), 'OPERATION_FORBIDDEN');
  rejects(() => operation('login-unknown', state(), actors), 'ACTOR_FORBIDDEN');
});
test('one account/listing/publication and finite request budgets enforced before sends', () => {
  const q = operation('create-buyer', state(), actors);
  rejects(() => validateRequest(q, state(), actors, { 'create-buyer': 1 }), 'OPERATION_BUDGET_EXCEEDED');
  rejects(() => validateRequest(q, state(), actors, {}, 65), 'REQUEST_BUDGET_EXCEEDED');
  rejects(() => validateRequest(q, state(), actors, {}, 10, 40), 'MUTATING_REQUEST_BUDGET_EXCEEDED');
  rejects(() => operation('match', { ...state(), offerId: '../other' }, actors), 'MATCH_BINDING_REQUIRED');
  rejects(() => operation('publish', { ...state(), publishOperation: undefined }, actors), 'PUBLICATION_OPERATION_REQUIRED');
});

test('uncertain transport journals intent without bodies and refuses a second create attempt', async () => {
  const original = globalThis.fetch; let sends = 0, t;
  globalThis.fetch = async () => { sends++; throw new Error('synthetic network uncertainty'); };
  try {
    t = await transport({ c: { ...contract(), runId: randomUUID() }, actors,
      api: async () => ({ env: { VERCEL_OIDC_TOKEN: token({ exp: Math.floor(Date.now() / 1000) + 600, project_id: PROJECT, owner_id: TEAM }) } }) });
    await assert.rejects(() => t.call('create-buyer'), { message: 'TRANSPORT_UNCERTAIN_RECONCILE_NO_RETRY' });
    await assert.rejects(() => t.call('create-buyer'), { message: 'OPERATION_BUDGET_EXCEEDED' });
    const bytes = await readFile(t.file, 'utf8'), journal = JSON.parse(bytes);
    assert.equal(sends, 1); assert.equal(journal.http[0].outcome, 'UNKNOWN_NO_RETRY');
    assert.equal(journal.status, 'STOPPED_RECONCILE_REQUIRED');
    for (const privateValue of [...Object.values(ACCOUNTS), actors.buyer.email, actors.buyer.password]) assert(!bytes.includes(privateValue));
  } finally { globalThis.fetch = original; if (t) await unlink(t.file); }
});
test('public/private DTO redaction detects full bank data, encrypted envelopes, fixture secrets', () => {
  assertRedacted({ accountLast4: '1001' }, actors);
  for (const value of [...Object.values(ACCOUNTS), '021000021', 'wise-data:v1:opaque', actors.buyer.password, actors.buyer.email]) assert.throws(() => assertRedacted({ value }, actors));
  assert.equal(safeError(new Error('account 00001001001')), 'AUDIT_FAILED_DETAILS_SUPPRESSED');
});
const baseline = () => ({ mobile: { mobilePushSubscriptions: 0, mobilePushPendingReceiptJobs: 0, mobilePushDeliveries: 0 }, checkedAt: new Date().toISOString(), actors: Object.fromEntries(Object.entries(actors).map(([role, a]) => [role, { id: a.appId, identity_matches: true, verified: true, no_send: true, auth_matches: true, trading_eligible: true, wise_empty: true, owned_demands: 0, owned_purchases: 0, owned_listings: 0, role: role === 'seller' ? 'approved_seller' : role }])) });
test('baseline stops for mobile push, existing business, identity or notification mismatch', () => {
  validateBaseline(baseline(), actors);
  for (const field of ['mobilePushSubscriptions', 'mobilePushPendingReceiptJobs', 'mobilePushDeliveries']) { const s = baseline(); s.mobile[field] = 1; rejects(() => validateBaseline(s, actors), 'MOBILE_PUSH_PREFLIGHT_REQUIRED'); }
  for (const field of ['owned_demands', 'owned_purchases', 'owned_listings']) { const s = baseline(); s.actors.buyer[field] = 1; rejects(() => validateBaseline(s, actors), 'FRESH_SYNTHETIC_FIXTURES_REQUIRED_NO_RESET'); }
  const s = baseline(); s.actors.seller.no_send = false; rejects(() => validateBaseline(s, actors), 'VERIFIED_NO_SEND_ACTOR_REQUIRED');
});
function mockPool(overrides = {}) {
  const statements = [];
  const db = { connection: { stream: { encrypted: true, authorized: true } }, release() {}, async query(sql) {
    statements.push(sql);
    if (sql.includes('current_user')) return { rows: [{ role: 'postgres', db: 'postgres', ro: 'on' }] };
    if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
    if (sql.includes('mobile_push_subscriptions')) return { rows: [{ n: overrides.subscriptions ?? 0 }] };
    if (sql.includes('mobile_push_deliveries')) return { rows: [{ total: overrides.total ?? 0, pending: overrides.pending ?? 0 }] };
    if (sql.includes('wiseUsdAccounts')) return { rows: [{ n: 2, encrypted: overrides.encrypted ?? true, no_plaintext: overrides.noPlaintext ?? true }] };
    return { rows: [] };
  } };
  return { db, statements, connect: async () => db };
}
test('database guard enforces verified TLS and read-only transaction then rollback', async () => {
  const pool = mockPool(); await readOnly(pool, mobilePushGuard);
  assert(pool.statements.includes('begin isolation level repeatable read read only')); assert.equal(pool.statements.at(-1), 'rollback');
  assert(pool.statements.every(q => /^(select|begin isolation level repeatable read read only|set local statement_timeout|rollback)/i.test(q)));
  const bad = mockPool(); bad.db.connection.stream.authorized = false;
  await assert.rejects(() => readOnly(bad, mobilePushGuard), { message: 'VERIFIED_DATABASE_TLS_REQUIRED' });
});
test('any mobile subscription or delivery blocks; guard never deletes', async () => {
  for (const v of [{ subscriptions: 1 }, { pending: 1 }, { total: 1 }]) await assert.rejects(() => readOnly(mockPool(v), mobilePushGuard), { message: 'MOBILE_PUSH_NOT_EMPTY_STOP_WITHOUT_DELETION' });
});
test('known-row storage verification rejects plaintext and missing encryption without exporting payloads', async () => {
  const s = state(); delete s.purchaseId;
  assert.deepEqual(await verifyStorage(mockPool(), actors, s), { userRows: 2, userEnvelopes: true, noPlaintext: true });
  for (const bad of [{ encrypted: false }, { noPlaintext: false }]) await assert.rejects(() => verifyStorage(mockPool(bad), actors, s), { message: 'WISE_USER_STORAGE_NOT_ENCRYPTED' });
});
test('imports and missing candidate do not perform cloud/network actions', async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('NETWORK_MUST_NOT_RUN'); };
  try { const { run } = await import('./run.mjs'); await assert.rejects(() => run([]), { message: 'EXACT_AUDIT_COMMAND_REQUIRED' }); assert.equal(calls, 0); }
  finally { globalThis.fetch = original; }
});
test('runner is not a provider client and has no cleanup or reset execution path', async () => {
  const source = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
  assert(!/fetch\s*\(/.test(source)); assert(!/\/api\/testing|\/cron\/|\/v1\/transfers/.test(source));
});

test('preservation rejects changes to old financial rows, outbound state and unexpected new entities', () => {
  const entityTables = ['users', 'listings', 'purchase_requests', 'commissions', 'trades', 'evidence', 'disputes', 'usdt_demands', 'notifications', 'audit_logs', 'activity_logs'];
  const outboundTables = ['marketplace_email_outbox', 'marketplace_email_gate', 'sms_deliveries', 'whatsapp_deliveries', 'discord_listing_outbox', 'mobile_push_subscriptions', 'mobile_push_deliveries'];
  const before = { auth: [{ id: 'protected-auth', digest: H }], entities: Object.fromEntries(entityTables.map(t => [t, [{ id: 'old-' + t, digest: H }]])),
    outbound: Object.fromEntries(outboundTables.map(t => [t, { count: 0, digest: H }])), sessions: [{ owner: 'unrelated-user', id: 'protected-session', digest: H }] };
  const after = structuredClone(before), s = state(); s.completed = true;
  for (const [table, values] of [['users', []], ['listings', [s.listingId]], ['usdt_demands', [s.demandId]], ['purchase_requests', [s.purchaseId]], ['evidence', ['evidence-one', 'evidence-two']], ['commissions', ['commission-one']]])
    after.entities[table].push(...values.map(id => ({ id, digest: H })));
  assert.equal(validatePreservation(before, after, actors, s).oldRowsPreserved, true);
  const changed = structuredClone(after); changed.entities.purchase_requests[0].digest = 'changed';
  rejects(() => validatePreservation(before, changed, actors, s), 'EXISTING_PURCHASE_REQUESTS_CHANGED');
  const outbound = structuredClone(after); outbound.outbound.sms_deliveries.count = 1;
  rejects(() => validatePreservation(before, outbound, actors, s), 'OUTBOUND_SMS_DELIVERIES_CHANGED');
  const extra = structuredClone(after); extra.entities.users.push({ id: 'user-created-without-review', digest: H });
  rejects(() => validatePreservation(before, extra, actors, s), 'UNEXPECTED_NEW_USERS');
});
