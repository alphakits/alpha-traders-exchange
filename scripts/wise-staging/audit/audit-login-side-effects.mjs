import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { HERE, REF, need, safeError } from './client.mjs';
import { fixtureDirectory } from '../environment.mjs';
import { readOnly } from './database.mjs';
need(process.versions.node === '24.22.1' && process.argv.length === 2, 'READONLY_LOGIN_AUDIT_COMMAND_REQUIRED');
const report = { status: 'STARTING', targetRef: REF, checkedAt: new Date().toISOString(), applicationRequests: 0, logins: 0, databaseWrites: 0, providerCalls: 0, actors: [] };
let pool;
try {
  const privateDir = fixtureDirectory();
  const { dbPool } = await import('../adapters.mjs'); pool = await dbPool();
  await readOnly(pool, async db => {
    for (const [base, alias, role] of [['staging-test-admin', 'admin', 'admin'], ['staging-test-accounts', 'buyer', 'outsider']]) {
      const m = JSON.parse(await readFile(path.join(privateDir, base + '.json'))), p = JSON.parse(await readFile(path.join(privateDir, base + '-progress.json')));
      need(m.targetRef === REF && p.targetRef === REF && m.runId === p.runId && p.complete === true, 'COMPLETE_FIXTURE_REQUIRED');
      const a = m.accounts.find(a => a.alias === alias), appId = p.accounts[alias]?.appId;
      need(a && /^\+[1-9]\d{7,14}$/.test(a.phone) && /^user-/.test(appId), 'EXACT_SYNTHETIC_ACTOR_REQUIRED');
      const r = (await db.query(`select role,payload->'roles' as roles,payload->>'sellerStatus' as seller_status,
        payload->>'fullName'=$2 and payload->>'fullName'=btrim(payload->>'fullName') as name_stable,
        payload->>'whatsappNumber'=$3 as contact_stable,
        payload->>'preferredLocale' in ('en','ar') as locale_stable,
        payload->>'emailVerified'='true' and payload->>'emailVerifiedAt' is not null as verification_stable,
        payload->>'passwordHash'='' as password_stable
        from alpha_exchange.users where id=$1`, [appId, a.fullName, a.phone])).rows[0];
      need(r && Array.isArray(r.roles), 'CANONICAL_PROFILE_REQUIRED');
      const known = ['owner', 'admin', 'approved_seller', 'pending_seller_approval', 'buyer', 'student', 'guest'];
      // These two fixtures are non-sellers with example.com email; owner/seller special paths cannot apply.
      const safeNonSeller = ['buyer', 'admin'].includes(r.role) && ['buyer', null].includes(r.seller_status) && !r.roles.some(v => ['owner', 'approved_seller', 'pending_seller_approval'].includes(v));
      const normalized = [...new Set([...r.roles, r.role].filter(v => known.includes(v)))];
      const rolesStable = safeNonSeller && JSON.stringify(normalized) === JSON.stringify(r.roles) && known.find(v => normalized.includes(v)) === r.role;
      const facts = { fixture: base, actor: role, nameStable: r.name_stable, contactStable: r.contact_stable, localeStable: r.locale_stable,
        verificationStable: r.verification_stable, passwordStable: r.password_stable, rolesStable };
      facts.canonicalAuthProfileNoOpExpected = Object.entries(facts).filter(([k]) => k.endsWith('Stable')).every(([, v]) => v === true);
      report.actors.push(facts);
    }
    report.authUserCustomTriggers = (await db.query("select count(*)::int as n from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal")).rows[0].n;
    report.authUserRules = (await db.query("select count(*)::int as n from pg_rewrite where ev_class='auth.users'::regclass")).rows[0].n;
    report.currentUserCount = (await db.query('select count(*)::int as n from alpha_exchange.users')).rows[0].n;
    report.currentAuthUserCount = (await db.query('select count(*)::int as n from auth.users')).rows[0].n;
  });
  report.status = 'PASS_READONLY_LOGIN_SIDE_EFFECT_REVIEW';
  report.policy = 'Keep admin and outsider account rows immutable; normal login replaces only their own sessions and appends a sign-in notification. Supabase auth identities remain protected apart from provider-managed sign-in metadata excluded from identity digest.';
} catch (e) { report.status = 'READONLY_AUDIT_STOPPED'; report.error = safeError(e); process.exitCode = 1; }
finally { if (pool) await pool.end(); }
report.finishedAt = new Date().toISOString();
await mkdir(HERE, { recursive: true });
await writeFile(path.join(HERE, `login-side-effects-${Date.now()}.json`), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report));
