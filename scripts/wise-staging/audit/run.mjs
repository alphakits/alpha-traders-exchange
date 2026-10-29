import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight, transport, need, hash, safeError, HERE, ACCOUNTS } from './client.mjs';
import { readOnly, mobilePushGuard, snapshot, validateBaseline, validatePreservation, verifyStorage, verifyNewRowRedaction } from './database.mjs';

function reviewedQueue(data, state, actors) {
  need(Array.isArray(data?.accounts) && data.accounts.length === 2, 'EXACT_SYNTHETIC_REVIEW_QUEUE_REQUIRED');
  for (const role of ['buyer', 'seller']) {
    const entry = data.accounts.find(a => a.id === state.accounts[role] && a.userId === actors[role].appId);
    need(entry && entry.accountHolderName === actors[role].fullName && /^[a-f0-9]{64}$/.test(entry.reviewVersion ?? ''), 'OWNED_REVIEW_ENTRY_REQUIRED');
    need(entry.accountNumber === (role === 'buyer' && state.edited ? ACCOUNTS.buyerChanged : ACCOUNTS[role]), 'SYNTHETIC_REVIEW_DETAILS_MISMATCH');
    state.reviewVersions[role] = entry.reviewVersion;
  }
}
function frozenDetails(data) {
  const d = data?.bankDetails;
  need(d?.bankTransferProvider === 'wise' && d.currency === 'USD' && d.accountNumber === ACCOUNTS.seller
    && d.routingNumber === '021000021' && d.buyerSender?.accountNumber === ACCOUNTS.buyerChanged, 'FROZEN_BANK_DETAILS_MISMATCH');
  return hash(d); // Used only in process memory; no banking data or hashes are written to the journal.
}

export async function run(args) {
  need(args.length === 2 && ['--preflight', '--execute'].includes(args[0]), 'EXACT_AUDIT_COMMAND_REQUIRED');
  const execute = args[0] === '--execute';
  // A failed or placeholder contract stops here before importing any cloud or database adapter.
  const p = await preflight(path.resolve(args[1]), execute);
  if (!execute) {
    try {
      const result = validateBaseline(p.before, p.actors);
      const file = path.join(HERE, `baseline-${p.c.runId}.json`);
      await writeFile(file, JSON.stringify(result, null, 2), { flag: 'wx' });
      return { status: result.status, file, applicationRequests: 0, logins: 0, databaseWrites: 0 };
    } finally { await p.pool.end(); }
  }
  let t;
  try {
    t = await transport(p);
    const { state: s, call, check, report } = t;
    s.publishOperation = randomUUID(); s.offerOperation = randomUUID();
    // Preflight already proved zero subscriptions/jobs before these normal auth writes.
    for (const role of ['buyer', 'seller', 'admin', 'outsider']) await call('login-' + role);
    const health = await call('runtime-health'), checks = health.checks ?? [];
    check('CORE_RUNTIME_HEALTHY_MAIL_DISABLED', checks.some(c => c.key === 'database' && c.status === 'healthy')
      && checks.some(c => c.key === 'authentication' && c.status === 'healthy')
      && checks.some(c => c.key === 'email' && c.status === 'degraded' && c.detail === 'The transactional email provider is not fully configured.'));
    for (const role of ['buyer', 'seller']) {
      const accounts = await call('accounts-' + role);
      check('HOSTED_WISE_EMPTY_' + role.toUpperCase(), accounts.enabled === true && accounts.mode === 'hosted' && accounts.accounts?.length === 0);
    }
    const workspace = await call('workspace'); check('BUYER_WORKSPACE_EMPTY', workspace.actorId === p.actors.buyer.appId && workspace.requests?.length === 0);
    await readOnly(p.pool, mobilePushGuard); // Recheck immediately before the first business write.
    for (const role of ['buyer', 'seller']) {
      const result = await call('create-' + role);
      check('ACCOUNT_PENDING_' + role.toUpperCase(), result.account?.ownershipReviewStatus === 'pending_review');
      s.accounts[role] = result.account?.id;
    }
    await verifyStorage(p.pool, p.actors, s);
    reviewedQueue(await call('review-queue'), s, p.actors); s.staleVersion = s.reviewVersions.buyer;
    check('EDIT_RESETS_REVIEW', (await call('pre-review-edit')).account?.ownershipReviewStatus === 'pending_review'); s.edited = true;
    const stale = await call('stale-review-buyer');
    check('STALE_VERSION_REJECTED', typeof stale.error === 'string' && stale.error.includes('details changed'));
    reviewedQueue(await call('review-queue'), s, p.actors);
    check('REVIEW_VERSION_CHANGED', s.reviewVersions.buyer !== s.staleVersion);
    for (const role of ['buyer', 'seller']) check('MANUAL_REVIEW_' + role.toUpperCase(), (await call('review-' + role)).account?.ownershipReviewStatus === 'manually_reviewed');
    s.listingId = (await call('create-listing')).listing?.id; await call('approve-listing');
    await call('public-listings');
    s.demandId = (await call('publish')).id;
    check('PUBLICATION_REPLAY_IDEMPOTENT', (await call('publish-replay')).id === s.demandId);
    const details = await call('demand-read'), demand = details.requests?.find(d => d.id === s.demandId);
    check('USD_WISE_DEMAND', demand?.currency === 'USD' && demand.bankTransferProvider === 'wise' && demand.amount === '1000');
    s.revision = demand.revision;
    s.offerId = (await call('offer')).id;
    check('OFFER_REPLAY_IDEMPOTENT', (await call('offer-replay')).id === s.offerId);
    const matched = await call('match'); s.purchaseId = matched.purchase?.id;
    check('USD_WISE_MATCH', matched.purchase?.currency === 'USD' && matched.purchase.bankTransferProvider === 'wise' && matched.purchase.usdtDemandId === s.demandId);
    check('MATCH_REPLAY_IDEMPOTENT', (await call('match-replay')).purchase?.id === s.purchaseId);
    await call('private-trade'); await call('anonymous-details'); await call('outsider-details'); await call('admin-details');
    await call('premature-release');
    check('ACCEPTED', (await call('accept')).request?.status === 'accepted');
    const frozen = frozenDetails(await call('buyer-details'));
    for (const role of ['buyer', 'seller']) {
      const rejected = await call('active-edit-' + role);
      check('ACTIVE_ACCOUNT_EDIT_BLOCKED_' + role.toUpperCase(), typeof rejected.error === 'string' && rejected.error.includes('cannot be changed'));
    }
    check('ACCEPTED_SNAPSHOTS_UNCHANGED', frozenDetails(await call('buyer-details')) === frozen);
    await verifyStorage(p.pool, p.actors, s);
    await readOnly(p.pool, mobilePushGuard); // Fail closed before progression if push state appeared.
    check('BUYER_RECEIPT_ADVANCES', (await call('evidence-buyer')).request?.status === 'payment_sent');
    check('FUNDS_RECEIVED', (await call('funds-received')).request?.status === 'funds_received');
    check('RELEASE_PENDING', (await call('release-pending')).request?.status === 'usdt_release_pending');
    check('SELLER_RECEIPT_ADVANCES', (await call('evidence-seller')).request?.status === 'usdt_sent');
    check('SYNTHETIC_COMPLETION', (await call('complete')).request?.status === 'review_open');
    check('COMPLETION_REPLAY_IDEMPOTENT', (await call('complete-replay')).request?.status === 'review_open'); s.completed = true;
    check('UNLINKED_BUYER_EDIT_REQUIRES_REVIEW', (await call('post-completion-edit')).account?.ownershipReviewStatus === 'pending_review');
    const completedDetails = await call('completed-buyer-details');
    check('COMPLETED_BANK_DETAILS_HIDDEN', typeof completedDetails.error === 'string' && !Object.hasOwn(completedDetails, 'bankDetails'));
    const account = (await call('accounts-buyer')).accounts?.find(a => a.id === s.accounts.buyer);
    check('OWN_ACCOUNT_CHANGED', account?.ownershipReviewStatus === 'pending_review' && account.accountLast4 === ACCOUNTS.buyer.slice(-4));
    await call('private-trade'); await call('public-listings');
    const end = await call('demand-read'); check('DEMAND_MATCHED', end.requests?.find(d => d.id === s.demandId)?.state === 'matched');
    report.storage = await verifyStorage(p.pool, p.actors, s, { completed: true });
    const after = await snapshot(p.pool, p.actors);
    report.preservation = validatePreservation(p.before, after, p.actors, s);
    report.rawStorageRedaction = await verifyNewRowRedaction(p.pool, p.before, after, p.actors);
    report.status = 'PASS_BOUNDED_HOSTED_SYNTHETIC_WISE'; report.finishedAt = new Date().toISOString();
    report.created = { accountCount: 2, listingId: s.listingId, demandId: s.demandId, purchaseId: s.purchaseId, receiptCount: 2, commissionCount: 1 };
    report.providerAcceptanceProven = false; report.featureOffProven = false;
    report.postCompletionSnapshotSemanticsProven = false;
    await t.save(); return { status: report.status, file: t.file, checks: report.checks.length, applicationRequests: report.http.length };
  } catch (error) {
    if (t) {
      t.report.status = 'STOPPED_RECONCILE_REQUIRED'; t.report.failure = safeError(error);
      t.report.knownResources = { accounts: t.state.accounts, listingId: t.state.listingId, demandId: t.state.demandId, purchaseId: t.state.purchaseId };
      // No retry, cleanup, fixture reset, or compensating business writes after an uncertain result.
      try { const after = await snapshot(p.pool, p.actors); t.report.preservation = validatePreservation(p.before, after, p.actors, t.state); }
      catch (e) { t.report.reconciliation = safeError(e); }
      await t.save();
    }
    throw error;
  } finally { await p.pool.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await run(process.argv.slice(2)))); }
  catch (error) { console.log(JSON.stringify({ status: 'NOT_COMPLETED', error: safeError(error) })); process.exitCode = 1; }
}
