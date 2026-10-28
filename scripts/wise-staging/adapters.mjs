import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { projectId, teamId, targetRef, repo, need, absolutePath } from './environment.mjs';

export { projectId, teamId };

// Authentication stays with the operator's Vercel CLI profile. This adapter never
// reads or prints a token, copies a profile, or falls back to an unrelated account.
export async function cliConfiguration(env = process.env) {
  const entry = absolutePath(env.ALPHA_WISE_STAGING_VERCEL_CLI, 'EXPLICIT_VERCEL_CLI_PATH_REQUIRED');
  const auth = absolutePath(env.ALPHA_WISE_STAGING_VERCEL_CONFIG, 'EXPLICIT_VERCEL_PROFILE_REQUIRED');
  need(path.basename(entry) === 'index.js' && path.basename(path.dirname(entry)) === 'dist', 'PINNED_VERCEL_CLI_REQUIRED');
  const pkg = JSON.parse(await readFile(path.join(path.dirname(entry), '..', 'package.json'), 'utf8'));
  need(pkg.name === 'vercel' && pkg.version === '65.2.0', 'PINNED_VERCEL_CLI_REQUIRED');
  return { entry, auth };
}

export async function vc(args, { input = '', cwd = repo } = {}) {
  const { entry, auth } = await cliConfiguration();
  const env = { ...process.env, VERCEL_TELEMETRY_DISABLED: '1', NO_UPDATE_NOTIFIER: '1', CI: '1' };
  for (const key of Object.keys(env)) {
    if (['VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID'].includes(key)
      || key.startsWith('ALPHA_WISE_STAGING_')) delete env[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, '--scope', 'alpha-kits', '--global-config', auth, ...args],
      { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = []; let length = 0, overflow = false;
    const collect = target => bytes => {
      length += bytes.length;
      if (length > 64 * 1024 * 1024) { overflow = true; child.kill(); return; }
      target.push(bytes);
    };
    child.stdout.on('data', collect(out)); child.stderr.on('data', collect(err));
    child.on('error', () => reject(new Error('VERCEL_CLI_START_FAILED')));
    child.on('close', code => {
      if (overflow || code !== 0) { reject(new Error(overflow ? 'VERCEL_CLI_OUTPUT_LIMIT' : 'VERCEL_CLI_OPERATION_FAILED')); return; }
      resolve({ stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export const api = async route => JSON.parse((await vc(['api', `${route}${route.includes('?') ? '&' : '?'}teamId=${teamId}`, '--method', 'GET'])).stdout);
export async function guardProject() {
  const p = await api(`/v9/projects/${projectId}`);
  need(p.id === projectId && p.accountId === teamId && p.name === 'alpha-usdt-buy-requests-staging'
    && p.ssoProtection?.deploymentType === 'all' && !p.link, 'STAGING_IDENTITY_PROTECTION_MISMATCH');
  return p;
}

// No production fallback. SSL URL flags are removed so pg cannot silently
// replace the separately pinned CA and rejectUnauthorized settings.
export function databaseConnection(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('EXPLICIT_STAGING_DATABASE_URL_REQUIRED'); }
  const sslKeys = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslpassword', 'uselibpqcompat'];
  need(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === 'aws-0-eu-west-1.pooler.supabase.com'
    && url.port === '6543' && decodeURIComponent(url.username) === `postgres.${targetRef}` && url.password
    && url.pathname === '/postgres' && !url.hash && [...url.searchParams.keys()].every(k => sslKeys.includes(k)),
  'EXACT_ISOLATED_DATABASE_REQUIRED');
  for (const key of sslKeys) url.searchParams.delete(key);
  return url.toString();
}

export function validateDatabaseCa(ca, now = Date.now()) {
  let cert;
  try { cert = new X509Certificate(ca); } catch { throw new Error('PINNED_VALID_DATABASE_CA_REQUIRED'); }
  need(createHash('sha256').update(ca).digest('hex') === '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'
    && cert.ca && Date.parse(cert.validFrom) <= now && Date.parse(cert.validTo) > now, 'PINNED_VALID_DATABASE_CA_REQUIRED');
  return ca;
}

export async function dbPool() {
  const connectionString = databaseConnection(process.env.ALPHA_WISE_STAGING_DATABASE_URL);
  const caFile = absolutePath(process.env.ALPHA_WISE_STAGING_DATABASE_CA_FILE, 'EXPLICIT_DATABASE_CA_FILE_REQUIRED');
  const ca = validateDatabaseCa(await readFile(caFile, 'utf8'));
  const { Pool } = createRequire(path.join(repo, 'package.json'))('pg');
  const pool = new Pool({ connectionString, ssl: { ca, rejectUnauthorized: true }, max: 1,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 7000,
    application_name: 'alpha-wise-staging-readonly' });
  pool.on('error', () => {});
  return pool;
}
