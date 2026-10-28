import { need, hash, REF, ACCOUNTS, id } from './client.mjs';

const entityTables = ['users', 'listings', 'purchase_requests', 'commissions', 'trades', 'evidence', 'disputes', 'usdt_demands', 'notifications', 'audit_logs', 'activity_logs'];
const outboundTables = ['marketplace_email_outbox', 'marketplace_email_gate', 'sms_deliveries', 'whatsapp_deliveries', 'discord_listing_outbox', 'mobile_push_subscriptions', 'mobile_push_deliveries'];

export async function readOnly(pool, callback) {
  const db = await pool.connect(); let destroy = false;
  try {
    need(db.connection?.stream?.encrypted === true && db.connection.stream.authorized === true, 'VERIFIED_DATABASE_TLS_REQUIRED');
    await db.query('begin isolation level repeatable read read only');
    await db.query("set local statement_timeout='5s'");
    const who = (await db.query("select current_user as role,current_database() as db,current_setting('transaction_read_only') as ro")).rows[0];
    need(who?.role === 'postgres' && who.db === 'postgres' && who.ro === 'on', 'READONLY_DATABASE_IDENTITY_REQUIRED');
    return await callback(db);
  } finally { try { await db.query('rollback'); } catch { destroy = true; } db.release(destroy); }
}

async function present(db, table) {
  need([...entityTables, ...outboundTables, 'sessions'].includes(table), 'DATABASE_TABLE_FORBIDDEN');
  return (await db.query('select to_regclass($1) is not null as present', ['alpha_exchange.' + table])).rows[0].present;
}

export async function mobilePushGuard(db) {
  const subscriptions = await present(db, 'mobile_push_subscriptions'), deliveries = await present(db, 'mobile_push_deliveries');
  const subCount = subscriptions ? (await db.query('select count(*)::int as n from alpha_exchange.mobile_push_subscriptions')).rows[0].n : 0;
  const job = deliveries ? (await db.query("select count(*)::int as total,count(*) filter (where status in ('processing','sent') or ticket_id is not null)::int as pending from alpha_exchange.mobile_push_deliveries")).rows[0] : { total: 0, pending: 0 };
  need(subCount === 0 && job.total === 0 && job.pending === 0, 'MOBILE_PUSH_NOT_EMPTY_STOP_WITHOUT_DELETION');
  return { mobilePushSubscriptions: subCount, mobilePushPendingReceiptJobs: job.pending, mobilePushDeliveries: job.total };
}

// Optional deployment-helper preflight. No auth/application calls, and no cloud/database writes.
export async function mobileBaseline(sourceCommit) {
  need(/^[a-f0-9]{40}$/.test(sourceCommit ?? ''), 'EXACT_SOURCE_COMMIT_REQUIRED');
  need(process.argv[2] !== 'link', 'LEGACY_LINK_ENTRYPOINT_FORBIDDEN');
  const { dbPool } = await import('../adapters.mjs');
  const pool = await dbPool();
  try { const mobile = await readOnly(pool, mobilePushGuard); return { status: 'PASS_WISE_STAGING_BASELINE', targetRef: REF, sourceCommit,
    checkedAt: new Date().toISOString(), ...mobile, databaseTargetVerified: true, databaseWrites: 0, applicationRequests: 0, providerCalls: 0 }; }
  finally { await pool.end(); }
}

export async function snapshot(pool, actors) {
  return readOnly(pool, async db => {
    const s = { entities: {}, outbound: {}, actors: {}, mobile: await mobilePushGuard(db), checkedAt: new Date().toISOString() };
    // Only row identities/digests leave PostgreSQL; never payloads, ciphertext, credentials, or account numbers.
    for (const table of entityTables) {
      need(await present(db, table), 'REQUIRED_STAGING_TABLE_MISSING');
      s.entities[table] = (await db.query(`select id,md5((to_jsonb(t)-'sort_index')::text) as digest from alpha_exchange.${table} t order by id`)).rows;
    }
    for (const table of outboundTables) s.outbound[table] = await present(db, table)
      ? (await db.query(`select count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as digest from alpha_exchange.${table} t`)).rows[0]
      : { count: 0, digest: hash('absent') };
    s.auth = (await db.query("select id::text,md5(jsonb_build_array(id,email,email_confirmed_at)::text) as digest from auth.users order by id")).rows;
    s.sessions = (await db.query("select user_id as owner,md5(token_hash) as id,md5((to_jsonb(t)-'sort_index')::text) as digest from alpha_exchange.sessions t order by token_hash")).rows;
    for (const [role, a] of Object.entries(actors)) {
      const row = (await db.query(`select u.id,
        u.email=$2 and u.payload->>'fullName'=$3 as identity_matches,
        u.payload->>'passwordHash'='' and u.payload->>'emailVerified'='true' and coalesce(u.payload->>'disabled','false')='false' as verified,
        u.payload->'notificationPreferences'->>'email'='false' and u.payload->'notificationPreferences'->>'sms'='false' as no_send,
        u.role,coalesce(u.payload->'roles','[]'::jsonb) ? 'admin' as admin_role,
        u.payload->>'phoneVerifiedAt' is not null and u.payload->'ageEligibility'->>'confirmedAt' is not null and u.payload->>'onboardingCompletedAt' is not null as trading_eligible,
        coalesce(u.payload->'wiseUsdAccounts','[]'::jsonb)='[]'::jsonb as wise_empty,
        exists(select 1 from auth.users a where a.id=$4::uuid and a.email=$2 and a.email_confirmed_at is not null) as auth_matches,
        (select count(*)::int from alpha_exchange.usdt_demands d where d.requester_id=u.id) as owned_demands,
        (select count(*)::int from alpha_exchange.purchase_requests p where p.buyer_id=u.id or p.seller_id=u.id) as owned_purchases,
        (select count(*)::int from alpha_exchange.listings l where l.seller_id=u.id) as owned_listings
        from alpha_exchange.users u where u.id=$1`, [a.appId, a.email, a.fullName, a.authId])).rows[0];
      need(row?.id === a.appId, 'EXACT_STAGING_ACTOR_MISSING'); s.actors[role] = row;
    }
    return s;
  });
}

export function validateBaseline(s, actors) {
  need(s.mobile.mobilePushSubscriptions === 0 && s.mobile.mobilePushPendingReceiptJobs === 0 && s.mobile.mobilePushDeliveries === 0, 'MOBILE_PUSH_PREFLIGHT_REQUIRED');
  for (const [role, a] of Object.entries(actors)) {
    const row = s.actors[role];
    need(row?.id === a.appId && row.identity_matches && row.verified && row.no_send && row.auth_matches, 'VERIFIED_NO_SEND_ACTOR_REQUIRED');
    need(role === 'admin' ? row.role === 'admin' || row.role === 'owner' || row.admin_role : row.trading_eligible, 'ROLE_ELIGIBILITY_REQUIRED');
    if (role === 'buyer' || role === 'seller') need(row.wise_empty && row.owned_demands === 0 && row.owned_purchases === 0 && row.owned_listings === 0, 'FRESH_SYNTHETIC_FIXTURES_REQUIRED_NO_RESET');
    if (role === 'seller') need(row.role === 'approved_seller', 'APPROVED_SYNTHETIC_SELLER_REQUIRED');
  }
  return { status: 'PASS_WISE_STAGING_BASELINE', targetRef: REF, checkedAt: s.checkedAt, ...s.mobile, databaseWrites: 0, applicationRequests: 0, providerCalls: 0 };
}

export function validatePreservation(before, after, actors, state) {
  need(hash(before.auth) === hash(after.auth), 'AUTH_IDENTITIES_CHANGED');
  for (const [table, rows] of Object.entries(before.entities)) {
    const allowed = table === 'users' ? [actors.buyer.appId, actors.seller.appId] : [];
    const retained = new Map(after.entities[table].map(r => [r.id, r.digest]));
    need(rows.filter(r => !allowed.includes(r.id)).every(r => retained.get(r.id) === r.digest), 'EXISTING_' + table.toUpperCase() + '_CHANGED');
  }
  for (const table of outboundTables) {
    // Creating empty optional push tables is harmless; nonempty state is always forbidden.
    if (table.startsWith('mobile_push')) need(after.outbound[table].count === 0, 'MOBILE_PUSH_CREATED');
    else need(hash(before.outbound[table]) === hash(after.outbound[table]), 'OUTBOUND_' + table.toUpperCase() + '_CHANGED');
  }
  const actorIds = Object.values(actors).map(a => a.appId);
  need(hash(before.sessions.filter(s => !actorIds.includes(s.owner))) === hash(after.sessions.filter(s => !actorIds.includes(s.owner))), 'UNRELATED_SESSIONS_CHANGED');
  const additions = table => after.entities[table].filter(r => !before.entities[table].some(old => old.id === r.id));
  for (const [table, expected] of [['users', []], ['listings', [state.listingId]], ['usdt_demands', [state.demandId]], ['purchase_requests', [state.purchaseId]]])
    need(JSON.stringify(additions(table).map(r => r.id).sort()) === JSON.stringify(expected.filter(Boolean).sort()), 'UNEXPECTED_NEW_' + table.toUpperCase());
  need(additions('evidence').length === (state.completed ? 2 : 0) && additions('commissions').length === (state.completed ? 1 : 0)
    && additions('disputes').length === 0 && additions('trades').length <= 1, 'UNEXPECTED_FINANCIAL_ROW_COUNTS');
  return { oldRowsPreserved: true, authIdentitiesPreserved: true, unrelatedSessionsPreserved: true, outboundUnchanged: true,
    newRows: Object.fromEntries(entityTables.map(t => [t, additions(t).length])) };
}

export async function verifyNewRowRedaction(pool, before, after, actors) {
  return readOnly(pool, async db => {
    let checkedRows = 0;
    for (const table of entityTables) {
      const ids = table === 'users' ? [actors.buyer.appId, actors.seller.appId]
        : after.entities[table].filter(r => !before.entities[table].some(old => old.id === r.id)).map(r => r.id);
      need(ids.length < 500, 'NEW_ROW_BUDGET_EXCEEDED');
      if (!ids.length) continue;
      const row = (await db.query(`select count(*)::int as n,bool_and(not exists (
        select 1 from unnest($2::text[]) needle where strpos(payload::text,needle)>0)) as no_plaintext
        from alpha_exchange.${table} where id=any($1::text[])`, [ids, [...Object.values(ACCOUNTS), '021000021']])).rows[0];
      need(row?.n === ids.length && row.no_plaintext === true, 'NEW_' + table.toUpperCase() + '_PLAINTEXT_BANK_DATA');
      checkedRows += row.n;
    }
    return { checkedRows, plaintextBankDataAbsent: true, exportedPayloads: 0 };
  });
}

// The raw JSONB inspection returns booleans and counts only, never encrypted envelopes or plaintext data.
export async function verifyStorage(pool, actors, state, { completed = false } = {}) {
  need(id('wise-usd', state.accounts.buyer) && id('wise-usd', state.accounts.seller), 'OWNED_ACCOUNTS_REQUIRED');
  return readOnly(pool, async db => {
    await mobilePushGuard(db);
    const secrets = [...Object.values(ACCOUNTS), '021000021'];
    const users = (await db.query(`select count(*)::int as n,
      bool_and(jsonb_typeof(payload->'wiseUsdAccounts')='string' and payload->>'wiseUsdAccounts' ~ '^wise-data:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$') as encrypted,
      bool_and(not exists(select 1 from unnest($2::text[]) needle where strpos(payload::text,needle)>0)) as no_plaintext
      from alpha_exchange.users where id=any($1::text[])`, [[actors.buyer.appId, actors.seller.appId], secrets])).rows[0];
    need(users.n === 2 && users.encrypted === true && users.no_plaintext === true, 'WISE_USER_STORAGE_NOT_ENCRYPTED');
    const proof = { userRows: 2, userEnvelopes: true, noPlaintext: true };
    if (!state.purchaseId) return proof;
    need(id('request', state.purchaseId) || id('purchase', state.purchaseId), 'OWNED_PURCHASE_REQUIRED');
    const p = (await db.query(`select id,buyer_id=$2 and seller_id=$3 and listing_id=$4 as participants,
      payload->>'currency'='USD' and payload->>'bankTransferProvider'='wise' as wise_usd,
      jsonb_typeof(payload->'buyerWiseAccountSnapshot')='string' and payload->>'buyerWiseAccountSnapshot' ~ '^wise-data:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$' as buyer_encrypted,
      jsonb_typeof(payload->'sellerWiseAccountSnapshot')='string' and payload->>'sellerWiseAccountSnapshot' ~ '^wise-data:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$' as seller_encrypted,
      not exists(select 1 from unnest($5::text[]) needle where strpos(payload::text,needle)>0) as no_plaintext,status
      from alpha_exchange.purchase_requests where id=$1`, [state.purchaseId, actors.buyer.appId, actors.seller.appId, state.listingId, secrets])).rows[0];
    need(p?.participants && p.wise_usd && p.buyer_encrypted && p.seller_encrypted && p.no_plaintext, 'WISE_TRADE_STORAGE_NOT_ENCRYPTED');
    if (completed) {
      need(p.status === 'review_open', 'SYNTHETIC_TRADE_NOT_COMPLETED');
      const financial = (await db.query(`select count(*)::int as n,
        bool_and((payload->>'sellerFeeAmount')::numeric=10 and (payload->>'buyerFeeCollectedAmount')::numeric=10
          and (payload->>'commissionAmount')::numeric=20 and (payload->>'grossAmount')::numeric=1010 and payload->>'grossCurrency'='USD') as exact_fees
        from alpha_exchange.commissions where purchase_request_id=$1`, [state.purchaseId])).rows[0];
      need(financial.n === 1 && financial.exact_fees, 'SYNTHETIC_COMMISSION_IDEMPOTENCY_FAILED');
      need((await db.query("select count(*)::int as n from alpha_exchange.evidence where purchase_request_id=$1", [state.purchaseId])).rows[0].n === 2, 'SYNTHETIC_RECEIPT_COUNT_FAILED');
      need((await db.query("select payload->>'availableAmount' as amount from alpha_exchange.listings where id=$1", [state.listingId])).rows[0]?.amount === '9000', 'INVENTORY_IDEMPOTENCY_FAILED');
      need((await db.query("select state,purchase_request_id from alpha_exchange.usdt_demands where id=$1", [state.demandId])).rows[0]?.state === 'matched', 'DEMAND_NOT_MATCHED');
    }
    return { ...proof, tradeSnapshotsEncrypted: true, exactParticipants: true, completed, syntheticCommissionCount: completed ? 1 : undefined,
      accounting: completed ? { sellerFeeUsdt: 10, buyerFeeCollectedUsdt: 10, combinedCommissionUsdt: 20, grossUsd: 1010 } : undefined };
  });
}
