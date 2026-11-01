import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { HERE, REF, need, hash, safeError } from './client.mjs';
import { fixtureDirectory } from '../environment.mjs';
import { readOnly, mobilePushGuard } from './database.mjs';

need(process.versions.node === '24.22.1' && process.argv.length === 2, 'READONLY_FIXTURE_AUDIT_COMMAND_REQUIRED');
const report = { status: 'STARTING', targetRef: REF, checkedAt: new Date().toISOString(), applicationRequests: 0, logins: 0, databaseWrites: 0, providerCalls: 0, fixtures: [] };
let pool;
try {
  const privateDir = fixtureDirectory();
  const { dbPool } = await import('../adapters.mjs');
  pool = await dbPool();
  await readOnly(pool, async db => {
    report.databaseTargetVerified = true;
    report.mobile = await mobilePushGuard(db);
    for (const base of ['staging-test-accounts', 'staging-audit-accounts-20261025', 'staging-final-accounts-20261025', 'staging-test-admin']) {
      const mb = await readFile(path.join(privateDir, base + '.json')), pb = await readFile(path.join(privateDir, base + '-progress.json'));
      const m = JSON.parse(mb), p = JSON.parse(pb);
      need(m.targetRef === REF && p.targetRef === REF && m.runId === p.runId && p.complete === true, 'EXACT_COMPLETE_FIXTURE_REQUIRED');
      const entry = { fixture: base, manifestSha256: hash(mb), progressSha256: hash(pb), actors: [] };
      for (const a of m.accounts) {
        const recorded = p.accounts?.[a.alias];
        need(['buyer', 'seller', 'admin'].includes(a.alias) && a.email?.endsWith('@example.com') && typeof a.fullName === 'string'
          && /^user-[A-Za-z0-9-]+$/.test(recorded?.appId ?? '') && /^[a-f0-9-]{36}$/.test(recorded?.authId ?? ''), 'SYNTHETIC_IDENTITY_REQUIRED');
        const r = (await db.query(`select u.email=$2 and u.payload->>'fullName'=$3 as identity_matches,
          u.payload->>'passwordHash'='' and u.payload->>'emailVerified'='true' and coalesce(u.payload->>'disabled','false')='false' as verified,
          u.payload->'notificationPreferences'->>'email'='false' and u.payload->'notificationPreferences'->>'sms'='false' as no_send,
          coalesce(u.payload->'notificationPreferences'->>'browserPush','false')='false' as browser_push_disabled,
          u.role,coalesce(u.payload->'roles','[]'::jsonb) ? 'admin' as admin_role,
          u.payload->>'phoneVerifiedAt' is not null and u.payload->'ageEligibility'->>'confirmedAt' is not null and u.payload->>'onboardingCompletedAt' is not null as trading_eligible,
          coalesce(u.payload->'wiseUsdAccounts','[]'::jsonb)='[]'::jsonb as wise_empty,
          exists(select 1 from auth.users a where a.id=$4::uuid and a.email=$2 and a.email_confirmed_at is not null) as auth_matches,
          (select count(*)::int from alpha_exchange.usdt_demands d where d.requester_id=u.id) as owned_demands,
          (select count(*)::int from alpha_exchange.purchase_requests p where p.buyer_id=u.id or p.seller_id=u.id) as owned_purchases,
          (select count(*)::int from alpha_exchange.listings l where l.seller_id=u.id) as owned_listings,
          (select count(*)::int from alpha_exchange.commissions c where c.seller_id=u.id) as seller_commissions
          from alpha_exchange.users u where u.id=$1`, [recorded.appId, a.email, a.fullName, recorded.authId])).rows[0];
        need(r, 'FIXTURE_ROW_MISSING');
        entry.actors.push({ alias: a.alias, ...r, freshBusiness: r.wise_empty && r.owned_demands === 0 && r.owned_purchases === 0 && r.owned_listings === 0 && r.seller_commissions === 0 });
      }
      entry.freshBuyerSellerPair = entry.actors.length === 2 && entry.actors.every(a => a.freshBusiness && a.identity_matches && a.verified && a.no_send && a.trading_eligible && a.auth_matches)
        && entry.actors.some(a => a.alias === 'seller' && a.role === 'approved_seller');
      report.fixtures.push(entry);
    }
  });
  report.status = 'PASS_READONLY_FIXTURE_AVAILABILITY_AUDIT';
  report.freshPairCount = report.fixtures.filter(f => f.freshBuyerSellerPair).length;
} catch (e) { report.status = 'READONLY_AUDIT_STOPPED'; report.error = safeError(e); process.exitCode = 1; }
finally { if (pool) await pool.end(); }
report.finishedAt = new Date().toISOString();
await mkdir(HERE, { recursive: true });
const output = path.join(HERE, `fixture-availability-${Date.now()}.json`);
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report));
