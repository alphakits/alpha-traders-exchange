import { readFile, writeFile, open, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repo, work, fixtureDirectory } from '../environment.mjs';

export const ROOT = '/api/alpha-exchange';
export const PROJECT = 'prj_2ZrlYsszRDNyll1lkZ69BYs9tHpL';
export const TEAM = 'team_RI4GCZrJfs5fCWqQKl06DYGS';
export const REF = 'ntnehgenzsooxwznrzzx';
export const SOURCE = path.dirname(fileURLToPath(import.meta.url));
export const HERE = path.join(work, 'audit');
export const need = (ok, code) => { if (!ok) throw new Error(code); };
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const json = async file => JSON.parse(await readFile(file, 'utf8'));
export const safeError = error => /^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message ?? '') ? error.message : 'AUDIT_FAILED_DETAILS_SUPPRESSED';
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const id = (kind, value) => new RegExp(`^${kind}-[A-Za-z0-9-]{1,100}$`).test(value ?? '');
const cookieNames = ['alpha_exchange_session', 'alpha_exchange_verified', 'alpha_exchange_phone_verified'];

// Dummy account values are never sent to a payment provider and never journaled.
export const ACCOUNTS = Object.freeze({ buyer: '00001001001', buyerChanged: '00001001009', seller: '00002002002' });
export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wl8cAAAAASUVORK5CYII=';
export const accountBody = (actor, number) => ({ provider: 'wise', currency: 'USD', countryCode: 'US', accountHolderType: 'personal',
  accountType: 'checking', accountHolderName: actor.fullName, bankName: 'Synthetic Test Bank',
  bankAddress: '1 Example Street, Test City, US', routingNumber: '021000021', accountNumber: number });

export function validateContract(c, execute = false) {
  need(c?.schema === 1 && c.projectId === PROJECT && c.teamId === TEAM && c.targetRef === REF && c.target === 'preview', 'EXACT_STAGING_CONTRACT_REQUIRED');
  need(/^[a-f0-9]{40}$/.test(c.sourceCommit ?? '') && /^dpl_[A-Za-z0-9]+$/.test(c.deploymentId ?? ''), 'CANDIDATE_IDENTITIES_REQUIRED');
  need(/^https:\/\/alpha-usdt-buy-requests-staging-[a-z0-9]+-alpha-kits\.vercel\.app$/.test(c.url ?? ''), 'DIRECT_STAGING_ORIGIN_REQUIRED');
  need(UUID.test(c.runId ?? '') && c.syntheticOnly === true && c.realFundsMoved === false && c.featureOffPhase === 'DEFERRED_SECOND_DEPLOYMENT', 'SYNTHETIC_SCOPE_REQUIRED');
  need(typeof c.repoPath === 'string' && path.isAbsolute(c.repoPath) && !c.repoPath.split(/[\\/]/).includes('..')
    && path.resolve(c.repoPath) === repo, 'LOCAL_CANDIDATE_REQUIRED');
  need(c.runtimeProof && path.basename(c.runtimeProof.file) === c.runtimeProof.file && SHA.test(c.runtimeProof.sha256 ?? ''), 'PINNED_RUNTIME_PROOF_REQUIRED');
  need(['client', 'database', 'run', 'adapters', 'environment'].every(k => SHA.test(c.helpers?.[k] ?? '')), 'REVIEWED_HELPER_HASHES_REQUIRED');
  need(c.fixtureHashes && ['staging-final-accounts-20261025', 'staging-test-admin', 'staging-test-accounts'].every(k =>
    SHA.test(c.fixtureHashes[k]?.manifest ?? '') && SHA.test(c.fixtureHashes[k]?.progress ?? '')), 'PINNED_FIXTURES_REQUIRED');
  need(!execute || c.executionAuthorized === true, 'EXECUTION_NOT_AUTHORIZED');
  return c;
}

export function validateRuntimeProof(p, c) {
  need(p?.status === 'PASS_WISE_STAGING_RUNTIME_GUARD' && p.projectId === PROJECT && p.targetRef === REF
    && p.deploymentId === c.deploymentId && p.sourceCommit === c.sourceCommit && p.url === c.url && p.nodeVersion === '24.22.1'
    && SHA.test(p.environmentFingerprint ?? '') && p.providerCredentialsAbsent === true && p.wiseDedicatedKeyConfigured === true
    && p.databaseTargetVerified === true && p.productionWrites === 0, 'RUNTIME_PROOF_MISMATCH');
  const values = { NODE_ENV: 'production', ALPHA_WISE_PAYMENTS_ENABLED: '1', ALPHA_EXCHANGE_DATA_BACKEND: 'postgres',
    ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: '', ALPHA_E2E_TEST_SUPPORT: '', ALPHA_E2E_LOOPBACK_ONLY: '',
    ALPHA_USDT_OFFLINE_PREVIEW: '', ALPHA_WISE_DRAFT_ENABLED: '', ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: '0',
    ALPHA_EXCHANGE_TWILIO_SEND_ENABLED: 'false', ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED: 'false',
    ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED: 'false', ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED: 'false' };
  need(Object.entries(values).every(([k, v]) => p.runtimeConfig?.[k] === v), 'HOSTED_MODE_AND_TRANSPORT_SUPPRESSION_REQUIRED');
  return p;
}

export function validateOidc(records, now = Date.now()) {
  const token = records?.env?.VERCEL_OIDC_TOKEN;
  need(typeof token === 'string' && token.length < 16384 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token), 'OIDC_INVALID');
  let claims; try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { throw new Error('OIDC_INVALID'); }
  need(Number.isSafeInteger(claims.exp) && claims.exp * 1000 > now + 120000 && claims.project_id === PROJECT && claims.owner_id === TEAM, 'OIDC_SCOPE_OR_EXPIRY_INVALID');
  return token;
}

export async function loadActors(c) {
  const privateDir = fixtureDirectory();
  const actors = {};
  for (const base of ['staging-final-accounts-20261025', 'staging-test-admin', 'staging-test-accounts']) {
    const mBytes = await readFile(path.join(privateDir, base + '.json')), pBytes = await readFile(path.join(privateDir, base + '-progress.json'));
    need(hash(mBytes) === c.fixtureHashes[base].manifest && hash(pBytes) === c.fixtureHashes[base].progress, 'FIXTURE_BYTES_CHANGED');
    const m = JSON.parse(mBytes), p = JSON.parse(pBytes);
    need(m.targetRef === REF && p.targetRef === REF && m.runId === p.runId && p.complete === true, 'FIXTURE_NOT_READY');
    for (const a of m.accounts) {
      if (base === 'staging-test-accounts' && a.alias !== 'buyer') continue;
      const role = base === 'staging-test-accounts' ? 'outsider' : a.alias, recorded = p.accounts?.[a.alias];
      need(['buyer', 'seller', 'admin', 'outsider'].includes(role) && !actors[role] && a.email?.endsWith('@example.com')
        && typeof a.fullName === 'string' && a.fullName.length > 2 && a.password?.length >= 12 && id('user', recorded?.appId)
        && /^[a-f0-9-]{36}$/.test(recorded?.authId ?? ''), 'SYNTHETIC_FIXTURE_REQUIRED');
      actors[role] = { ...a, ...recorded };
    }
  }
  need(Object.keys(actors).length === 4 && new Set(Object.values(actors).map(a => a.appId)).size === 4, 'FOUR_DISTINCT_ACTORS_REQUIRED');
  return actors;
}

// All executable requests must match a freshly generated exact operation. No arbitrary routes or payloads.
export function operation(label, s, a) {
  const request = (actor, method, route, body, statuses = [200]) => ({ label, actor, method, route, body, statuses });
  const account = role => { need(id('wise-usd', s.accounts[role]), 'OWNED_ACCOUNT_REQUIRED'); return s.accounts[role]; };
  const purchase = () => { need(id('request', s.purchaseId) || id('purchase', s.purchaseId), 'OWNED_PURCHASE_REQUIRED'); return `${ROOT}/purchase-requests/${s.purchaseId}`; };
  const demand = () => { need(id('demand', s.demandId), 'OWNED_DEMAND_REQUIRED'); return `${ROOT}/usdt-requests/${s.demandId}`; };
  if (label.startsWith('login-')) { const role = label.slice(6); need(a[role], 'ACTOR_FORBIDDEN'); return request(role, 'POST', '/api/auth/login', { email: a[role].email, password: a[role].password, rememberMe: false }); }
  if (label === 'runtime-health') return request('admin', 'GET', '/api/admin/system-health');
  if (label === 'review-queue') return request('admin', 'GET', ROOT + '/admin/wise-accounts');
  if (label === 'public-listings') return request(null, 'GET', ROOT + '/listings');
  if (label === 'workspace') return request('buyer', 'GET', ROOT + '/usdt-requests?scope=mine');
  if (label === 'demand-read') return request('buyer', 'GET', demand());
  if (label === 'private-trade') { purchase(); return request('buyer', 'GET', `${ROOT}/trade-room/${s.purchaseId}`); }
  for (const role of ['buyer', 'seller']) {
    if (label === `accounts-${role}`) return request(role, 'GET', ROOT + '/wise-accounts');
    if (label === `create-${role}`) return request(role, 'POST', ROOT + '/wise-accounts', accountBody(a[role], ACCOUNTS[role]), [201]);
    if (label === `review-${role}` || label === `stale-review-${role}`) {
      const version = label.startsWith('stale-') ? s.staleVersion : s.reviewVersions[role]; need(SHA.test(version ?? ''), 'REVIEW_VERSION_REQUIRED');
      return request('admin', 'PATCH', ROOT + '/admin/wise-accounts', { userId: a[role].appId, accountId: account(role), decision: 'approve',
        expectedReviewVersion: version, evidenceReference: `synthetic-hosted-test-only:${s.runId}:${role}`, verifiedAccountHolderName: a[role].fullName, identityMatched: true }, label.startsWith('stale-') ? [400] : [200]);
    }
    if (label === `active-edit-${role}`) return request(role, 'PATCH', ROOT + '/wise-accounts', { ...accountBody(a[role], ACCOUNTS.buyerChanged), accountId: account(role) }, [400]);
    if (label === `evidence-${role}`) return request(role, 'POST', purchase() + '/evidence', { side: role, fileName: `${role}-synthetic-no-funds.png`, mimeType: 'image/png', sizeBytes: Buffer.from(PNG, 'base64').length, fileData: `data:image/png;base64,${PNG}` });
  }
  if (label === 'pre-review-edit' || label === 'post-completion-edit') return request('buyer', 'PATCH', ROOT + '/wise-accounts', { ...accountBody(a.buyer, label === 'pre-review-edit' ? ACCOUNTS.buyerChanged : ACCOUNTS.buyer), accountId: account('buyer') });
  if (label === 'create-listing') return request('seller', 'POST', ROOT + '/listings', { availableAmount: '10000', price: '1.00', currency: 'USD', network: 'TRC20', paymentMethods: ['Bank Transfer'], bankTransferProvider: 'wise', wiseAccountId: account('seller'), minimumTrade: '100', maximumTrade: '10000', responseTime: '5 min', expirationHours: 24, acceptedCommissionPolicy: true }, [200, 201]);
  if (label === 'approve-listing') { need(id('listing', s.listingId), 'OWNED_LISTING_REQUIRED'); return request('admin', 'PATCH', `${ROOT}/admin/listings/${s.listingId}`, { action: 'approve' }); }
  if (label === 'publish' || label === 'publish-replay') { need(UUID.test(s.publishOperation ?? ''), 'PUBLICATION_OPERATION_REQUIRED'); return request('buyer', 'POST', ROOT + '/usdt-requests', { terms: { amount: '1000', price: '1.00', currency: 'USD', network: 'TRC20', paymentMethod: 'Bank Transfer', bankTransferProvider: 'wise', city: '' }, operationId: s.publishOperation }, [200, 201]); }
  if (label === 'offer' || label === 'offer-replay') { need(id('listing', s.listingId) && Number.isSafeInteger(s.revision) && s.revision > 0 && UUID.test(s.offerOperation ?? ''), 'OFFER_BINDING_REQUIRED'); return request('seller', 'POST', demand() + '/offers', { listingId: s.listingId, revision: s.revision, price: '1.00', operationId: s.offerOperation }, [200, 201]); }
  if (label === 'match' || label === 'match-replay') { need(id('listing', s.listingId) && id('demand', s.demandId) && id('offer', s.offerId) && Number.isSafeInteger(s.revision) && s.revision > 0, 'MATCH_BINDING_REQUIRED'); return request('buyer', 'POST', ROOT + '/purchase-requests', { listingId: s.listingId, usdtAmount: '1000', receivingNetwork: 'TRC20', paymentMethod: 'Bank Transfer', bankTransferProvider: 'wise', currency: 'USD', buyerWiseAccountId: account('buyer'), buyerReceivingWalletAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', feePolicyVersion: 'buyer_seller_1pct_v1', usdtDemandId: s.demandId, usdtDemandOfferId: s.offerId, usdtDemandRevision: s.revision, safetyAcknowledged: true }, [200, 201]); }
  if (label === 'completed-buyer-details') {
    purchase(); need(s.completed === true, 'COMPLETED_TRADE_REQUIRED');
    return request('buyer', 'POST', `${ROOT}/trade-room/${s.purchaseId}/bank-details`, undefined, [403]);
  }
  if (['anonymous-details', 'outsider-details', 'admin-details', 'buyer-details'].includes(label)) {
    purchase(); const actor = label.split('-')[0];
    if (actor === 'buyer') need(s.completed !== true, 'ACTIVE_DISCLOSURE_STAGE_REQUIRED');
    return request(actor === 'anonymous' ? null : actor, 'POST', `${ROOT}/trade-room/${s.purchaseId}/bank-details`, undefined, actor === 'buyer' ? [200] : actor === 'anonymous' ? [401] : [400, 403, 404]);
  }
  if (['premature-release', 'accept', 'funds-received', 'release-pending', 'complete', 'complete-replay'].includes(label)) {
    const body = label.startsWith('complete') ? { action: 'complete_trade' } : { status: ({ 'premature-release': 'usdt_release_pending', accept: 'accepted', 'funds-received': 'funds_received', 'release-pending': 'usdt_release_pending' })[label], ...(label === 'accept' ? { safetyAcknowledged: true } : {}) };
    return request('seller', 'PATCH', purchase(), body, label === 'premature-release' ? [400, 409] : [200]);
  }
  throw new Error('OPERATION_FORBIDDEN');
}

const limits = { 'review-queue': 2, 'buyer-details': 2, 'accounts-buyer': 2, 'accounts-seller': 1, 'demand-read': 2, 'public-listings': 2, 'private-trade': 2 };
export function validateRequest(q, s, actors, counts = {}, total = 0, nonGet = 0) {
  need(total < 65 && q && typeof q.label === 'string', 'REQUEST_BUDGET_EXCEEDED');
  need((counts[q.label] ?? 0) < (limits[q.label] ?? 1), 'OPERATION_BUDGET_EXCEEDED');
  const expected = operation(q.label, s, actors);
  need(JSON.stringify(q) === JSON.stringify(expected), 'REQUEST_CONTRACT_MISMATCH');
  need(q.method === 'GET' || nonGet < 40, 'MUTATING_REQUEST_BUDGET_EXCEEDED');
  need(q.route.startsWith('/api/') && !/[\\#\x00-\x20]/.test(q.route) && !/%(?:2e|2f|5c)/i.test(q.route) && !q.route.split('?')[0].split('/').includes('..'), 'ROUTE_FORBIDDEN');
  return expected;
}

export function assertRedacted(value, actors) {
  const text = JSON.stringify(value);
  need(Object.values(ACCOUNTS).every(v => !text.includes(v)) && !text.includes('021000021') && !text.includes('wise-data:v1:'), 'PRIVATE_BANK_DATA_EXPOSED');
  need(Object.values(actors).every(a => [a.email, a.password, a.phone].filter(Boolean).every(v => !text.includes(v))), 'PRIVATE_IDENTITY_EXPOSED');
}

export async function preflight(contractFile, execute = false) {
  need(process.versions.node === '24.22.1', 'EXACT_NODE_REQUIRED');
  need(process.argv[2] !== 'link', 'LEGACY_LINK_ENTRYPOINT_FORBIDDEN');
  const c = validateContract(await json(contractFile), execute);
  for (const name of ['client', 'database', 'run', 'adapters', 'environment']) {
    const location = ['adapters', 'environment'].includes(name) ? path.dirname(SOURCE) : SOURCE;
    need(hash(await readFile(path.join(location, name + '.mjs'))) === c.helpers[name], 'REVIEWED_HELPER_CHANGED');
  }
  need(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: c.repoPath, windowsHide: true }).toString().trim() === c.sourceCommit, 'CANDIDATE_HEAD_MISMATCH');
  need(!execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: c.repoPath, windowsHide: true }).toString().trim(), 'CANDIDATE_DIRTY');
  const proofBytes = await readFile(path.join(HERE, c.runtimeProof.file)); need(hash(proofBytes) === c.runtimeProof.sha256, 'RUNTIME_PROOF_CHANGED');
  const proof = validateRuntimeProof(JSON.parse(proofBytes), c);
  const { api, guardProject, dbPool } = await import('../adapters.mjs');
  const project = await guardProject(); need(project.id === PROJECT && project.accountId === TEAM && project.nodeVersion === '24.x' && Object.keys(project.protectionBypass ?? {}).length === 0, 'PROJECT_GUARD_FAILED');
  const remote = await api('/v13/deployments/' + c.deploymentId);
  need(remote.id === c.deploymentId && remote.projectId === PROJECT && remote.target === null && remote.readyState === 'READY' && 'https://' + remote.url === c.url && remote.meta?.reviewedSourceCommit === c.sourceCommit && remote.meta?.stagingEmailTransport === 'disabled', 'DEPLOYMENT_GUARD_FAILED');
  const env = (await api(`/v10/projects/${PROJECT}/env`)).envs;
  need(Array.isArray(env) && env.every(e => JSON.stringify(e.target) === '["preview"]' && !e.gitBranch && !e.customEnvironmentIds?.length), 'PREVIEW_ENVIRONMENT_REQUIRED');
  const metadata = env.map(({ key, type, target, updatedAt }) => ({ key, type, target, updatedAt })).sort((a, b) => a.key.localeCompare(b.key));
  need(hash(metadata) === proof.environmentFingerprint, 'ENVIRONMENT_CHANGED');
  const actors = await loadActors(c);
  const pool = await dbPool();
  const { snapshot, validateBaseline } = await import('./database.mjs');
  try { const before = await snapshot(pool, actors); validateBaseline(before, actors); return { c, actors, pool, before, api }; }
  catch (e) { await pool.end(); throw e; }
}

export async function transport(prepared) {
  const { c, actors, api } = prepared;
  await mkdir(HERE, { recursive: true });
  const file = path.join(HERE, `journal-${c.runId}.json`), handle = await open(file, 'wx');
  await handle.close(); // Existing journal prevents resuming/repeating uncertain writes.
  const state = { runId: c.runId, accounts: {}, reviewVersions: {}, counts: {}, nonGet: 0, http: [], checks: [], deferred: ['Feature-off deployment verification', 'Real-provider/payment acceptance', 'Physical Safari verification', 'Post-completion private snapshot semantic comparison: completed bank-detail disclosure is forbidden'] };
  const report = { schema: 1, runId: c.runId, projectId: PROJECT, targetRef: REF, deploymentId: c.deploymentId, sourceCommit: c.sourceCommit, status: 'PREFLIGHT_PASS', http: state.http, checks: state.checks, deferred: state.deferred, providerCalls: 0, directDatabaseWrites: 0, productionWrites: 0, realFundsMoved: false };
  const save = () => writeFile(file, JSON.stringify(report, null, 2));
  const jars = Object.fromEntries(Object.keys(actors).map(k => [k, new Map()])); let token;
  const check = (label, ok) => { state.checks.push({ label, passed: Boolean(ok) }); need(ok, label); };
  async function call(label) {
    const q = operation(label, state, actors); validateRequest(q, state, actors, state.counts, state.http.length, state.nonGet);
    const url = new URL(q.route, c.url); need(url.origin === c.url, 'ORIGIN_MISMATCH');
    if (!token || JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).exp * 1000 < Date.now() + 75000) token = validateOidc(await api(`/v3/env/pull/${PROJECT}/development?source=vercel-cli%3Aenv%3Apull`));
    const headers = { 'x-vercel-trusted-oidc-idp-token': token, 'cache-control': 'no-store' };
    const jar = jars[q.actor]; if (jar?.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (q.method !== 'GET') Object.assign(headers, { 'content-type': 'application/json', origin: c.url, referer: c.url + '/en/usdt-exchange/requests', 'sec-fetch-site': 'same-origin' });
    const entry = { label, actor: q.actor ?? 'anonymous', method: q.method, route: q.route, startedAt: new Date().toISOString(), outcome: 'IN_FLIGHT' };
    state.counts[label] = (state.counts[label] ?? 0) + 1; if (q.method !== 'GET') state.nonGet++; state.http.push(entry); await save();
    let response, data;
    try {
      response = await fetch(url, { method: q.method, headers, body: q.body === undefined ? undefined : JSON.stringify(q.body), redirect: 'manual', signal: AbortSignal.timeout(30000) });
      const reader = response.body?.getReader(); need(reader, 'HTTP_BODY_MISSING'); const chunks = []; let length = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; need(length <= 2_000_000, 'HTTP_BODY_LIMIT'); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      data = JSON.parse(Buffer.concat(chunks));
      entry.status = response.status; entry.bytes = length; entry.outcome = 'RESPONSE'; entry.finishedAt = new Date().toISOString(); await save();
    } catch { entry.outcome = 'UNKNOWN_NO_RETRY'; report.status = 'STOPPED_RECONCILE_REQUIRED'; await save(); throw new Error('TRANSPORT_UNCERTAIN_RECONCILE_NO_RETRY'); }
    for (const raw of response.headers.getSetCookie()) {
      const first = raw.split(';')[0], at = first.indexOf('='), key = first.slice(0, at);
      if (!cookieNames.includes(key)) continue;
      need(jar && /;\s*Secure(?:;|$)/i.test(raw) && /;\s*HttpOnly(?:;|$)/i.test(raw) && /;\s*SameSite=lax(?:;|$)/i.test(raw) && /;\s*Path=\/(?:;|$)/i.test(raw) && !/;\s*Domain=/i.test(raw), 'INSECURE_SESSION_COOKIE');
      if (/;\s*Max-Age=0(?:;|$)/i.test(raw)) jar.delete(key); else jar.set(key, first.slice(at + 1));
    }
    check('HTTP_' + label.replaceAll('-', '_').toUpperCase(), q.statuses.includes(response.status));
    if (label.startsWith('login-')) check('NORMAL_LOGIN_IDENTITY', data.user?.id === actors[q.actor].appId && jar.has('alpha_exchange_session'));
    else if (!['review-queue', 'buyer-details', 'runtime-health'].includes(label)) assertRedacted(data, actors);
    if (['review-queue', 'buyer-details', 'completed-buyer-details'].includes(label) || label.startsWith('accounts-')) check('PRIVATE_NO_STORE', /no-store/.test(response.headers.get('cache-control') ?? ''));
    return data;
  }
  await save(); return { state, report, call, check, save, file };
}
