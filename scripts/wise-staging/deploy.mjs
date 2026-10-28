import { readFile, writeFile, mkdir, lstat, readdir, open, rename, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { work, repo } from './environment.mjs';
export { work, repo } from './environment.mjs';

// This command exposes read-only cloud operations only. The exported write
// functions require a reviewed package hash and a fresh database preflight.
export const projectId = 'prj_2ZrlYsszRDNyll1lkZ69BYs9tHpL';
export const teamId = 'team_RI4GCZrJfs5fCWqQKl06DYGS';
let controls;
async function loadControls() {
  // The CLI exposes no link/deploy entrypoint. Load adapters only after our
  // command/operation has passed its own scope and exact-source guards.
  need(process.argv[2] !== 'link', 'LEGACY_LINK_ENTRYPOINT_FORBIDDEN');
  controls ??= import('./adapters.mjs');
  const imported = await controls;
  need(imported.projectId === projectId && imported.teamId === teamId, 'STAGING_ADAPTER_TARGET_CHANGED');
  return imported;
}
const vc = async (...args) => (await loadControls()).vc(...args);
const guardProject = async () => (await loadControls()).guardProject();
export const targetRef = 'ntnehgenzsooxwznrzzx';
export const siteOrigin = 'https://alpha-usdt-buy-requests-staging-ntneh.vercel.app';
export const WISE_KEY = 'ALPHA_EXCHANGE_WISE_DATA_SECRET';
export const PUBLIC_KEYS = Object.freeze(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SITE_URL']);
export const RUNTIME = Object.freeze({
  ALPHA_WISE_PAYMENTS_ENABLED: '1', ALPHA_EXCHANGE_DATA_BACKEND: 'postgres',
  ALPHA_USDT_REQUESTS_ENABLED: '1', ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: '0',
  ALPHA_EXCHANGE_TWILIO_SEND_ENABLED: 'false', ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED: 'false',
  ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED: 'false', ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED: 'false',
  ALPHA_WISE_DRAFT_ENABLED: '', ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: '',
  ALPHA_E2E_TEST_SUPPORT: '', ALPHA_E2E_LOOPBACK_ONLY: '', ALPHA_USDT_OFFLINE_PREVIEW: '',
  RESEND_API_KEY: '', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', META_WHATSAPP_ACCESS_TOKEN: '',
  DISCORD_BOT_TOKEN: '', DISCORD_MARKETPLACE_API_KEY: '', DISCORD_MARKETPLACE_WEBHOOK_URL: '',
  DISCORD_MARKETPLACE_WEBHOOK_SECRET: '', EXPO_ACCESS_TOKEN: '',
  PORT: '8080', HOSTNAME: '0.0.0.0', AUTH_COOKIE_SECURE: 'true',
});
const FIXED_CONFIG = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: `https://${targetRef}.supabase.co`, NEXT_PUBLIC_SITE_URL: siteOrigin,
  NPM_CONFIG_ENGINE_STRICT: 'true', AUTH_COOKIE_SECURE: 'true', ALPHA_USDT_REQUESTS_ENABLED: '1',
  ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: '0', ALPHA_EXCHANGE_TWILIO_SEND_ENABLED: 'false',
  ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED: 'false', ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED: 'false',
  ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED: 'false',
});
const SECRET_KEYS = ['SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET', 'RESEND_API_KEY'];
const BASE_KEYS = [...Object.keys(FIXED_CONFIG), ...SECRET_KEYS, 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_DB_CA', 'ALPHA_EMAIL_STAGING_ALLOWLIST', 'EMAIL_FROM'];
const OPTIONAL_KEYS = [WISE_KEY, 'ALPHA_EXCHANGE_WISE_DATA_PREVIOUS_SECRET'];
const REQUIRED_FILES = ['Dockerfile.vercel', 'Dockerfile.vercel.dockerignore', 'Dockerfile.vercel.containerignore', '.dockerignore',
  'vercel.json', 'package.json', 'package-lock.json', 'next.config.ts', 'src/lib/wise-storage-crypto.ts',
  'src/lib/wise-payments-capability.ts', 'scripts/check-container-web-tests.mjs', 'scripts/test-container-web-tests.mjs',
  'scripts/container-next-config.cjs', 'scripts/container-origin.cjs', 'scripts/container-server.cjs',
  'apps/mobile/.eas/workflows/iphone-installed-preview.yml'];
const ROOT_FILES = new Set(['.gitignore', '.vercelignore', '.dockerignore', '.npmrc', 'Dockerfile.vercel',
  'Dockerfile.vercel.dockerignore', 'Dockerfile.vercel.containerignore', 'Dockerfile.discord-worker', 'railway.json',
  'vercel.json', 'package.json', 'package-lock.json', 'next.config.ts', 'next-env.d.ts', 'tsconfig.json',
  'eslint.config.mjs', 'postcss.config.mjs', 'vitest.config.ts']);
const IGNORE_OVERLAY = Buffer.from('# Generated staging-only upload exclusions; no app source is changed.\n.git\n.vercel\n**/.env*\n**/node_modules\n**/.next*\n**/work\n**/private\n**/test-results\n**/playwright-report\n**/coverage\n**/.auth\n**/*.log\n**/*.pem\n**/*.key\n**/*.p12\n**/*.pfx\n**/*.tsbuildinfo\npublic/files/**/*.mp4\n!.dockerignore\n!Dockerfile.vercel.dockerignore\n!Dockerfile.vercel.containerignore\n');
const PYTHON = process.env.CODEX_PRIMARY_RUNTIME_PYTHON || process.env.PYTHON || 'python';
export const need = (condition, code) => { if (!condition) throw new Error(code); };
export const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
export const blobId = bytes => digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const reportPath = sha => path.join(work, `wise-staging-${sha}.json`);
export const sourceFor = sha => path.join(work, `wise-staging-${sha}-source`);
const git = args => execFileSync('git', args, { cwd: repo, windowsHide: true, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const safeReason = error => /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'DETAILS_SUPPRESSED';

export function validateProject(project) {
  need(project.id === projectId && project.accountId === teamId && project.name === 'alpha-usdt-buy-requests-staging', 'STAGING_PROJECT_MISMATCH');
  need(project.ssoProtection?.deploymentType === 'all' && !project.link && !Object.keys(project.protectionBypass ?? {}).length, 'STAGING_PROTECTION_CHANGED');
  need(project.nodeVersion === '24.x' && !project.rootDirectory, 'STAGING_RUNTIME_OR_ROOT_CHANGED');
  return Object.fromEntries(['id', 'accountId', 'name', 'nodeVersion', 'framework', 'buildCommand', 'installCommand', 'rootDirectory', 'outputDirectory', 'ssoProtection', 'link', 'protectionBypass'].map(key => [key, project[key] ?? null]));
}

export function validateEnvironmentRows(rows) {
  need(Array.isArray(rows) && rows.length >= BASE_KEYS.length && new Set(rows.map(row => row.key)).size === rows.length, 'ENVIRONMENT_KEY_AMBIGUOUS');
  need(BASE_KEYS.every(key => rows.some(row => row.key === key)), 'REQUIRED_PREVIEW_KEY_MISSING');
  for (const row of rows) {
    need([...BASE_KEYS, ...OPTIONAL_KEYS].includes(row.key), 'UNREVIEWED_PROJECT_ENVIRONMENT_KEY');
    need(JSON.stringify(row.target) === '["preview"]' && !row.gitBranch && !row.customEnvironmentIds?.length, 'PREVIEW_ONLY_ENVIRONMENT_REQUIRED');
    need(/^[A-Za-z0-9_-]+$/.test(row.id ?? ''), 'ENVIRONMENT_ID_INVALID');
    const sensitive = SECRET_KEYS.includes(row.key) || OPTIONAL_KEYS.includes(row.key);
    need(row.type === (sensitive ? 'sensitive' : 'encrypted'), 'ENVIRONMENT_TYPE_MISMATCH');
  }
  return rows.map(({ key, id, type, target, updatedAt }) => ({ key, id, type, target, updatedAt })).sort((a, b) => a.key.localeCompare(b.key));
}

export const environmentFingerprint = rows => digest(JSON.stringify(rows.map(({ key, type, target, updatedAt }) => ({ key, type, target, updatedAt })).sort((a, b) => a.key.localeCompare(b.key))));

export function validateAlias(alias) {
  need(alias.alias === new URL(siteOrigin).hostname && alias.projectId === projectId && !alias.redirect && !alias.deletedAt
    && /^dpl_[A-Za-z0-9]+$/.test(alias.deploymentId ?? '') && alias.deployment?.id === alias.deploymentId
    && /^alpha-usdt-buy-requests-staging-[a-z0-9]+-alpha-kits\.vercel\.app$/.test(alias.deployment?.url ?? ''), 'STABLE_STAGING_ALIAS_SCOPE_CHANGED');
  return { alias: alias.alias, projectId: alias.projectId, deploymentId: alias.deploymentId, deploymentUrl: alias.deployment.url };
}

export function validatePublicValues(values) {
  need(Object.keys(values).length === 3 && PUBLIC_KEYS.every(key => typeof values[key] === 'string'), 'PUBLIC_BUILD_KEYS_MISMATCH');
  need(values.NEXT_PUBLIC_SUPABASE_URL === FIXED_CONFIG.NEXT_PUBLIC_SUPABASE_URL && values.NEXT_PUBLIC_SITE_URL === siteOrigin, 'PUBLIC_BUILD_TARGET_MISMATCH');
  const key = values.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  need(key.length > 20 && key.length <= 4096 && !/[\r\n\s"'`$\\]/.test(key), 'PUBLIC_KEY_ENCODING_INVALID');
  if (key.startsWith('sb_publishable_')) {
    need(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key), 'PUBLIC_KEY_ENCODING_INVALID');
  } else {
    need(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key), 'PUBLIC_KEY_ENCODING_INVALID');
    let claims, header;
    try { header = JSON.parse(Buffer.from(key.split('.')[0], 'base64url')); claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); }
    catch { throw new Error('PUBLIC_KEY_ENCODING_INVALID'); }
    need(header.alg === 'HS256' && header.typ === 'JWT' && claims.iss === 'supabase' && claims.role === 'anon' && claims.ref === targetRef, 'PUBLIC_KEY_SCOPE_MISMATCH');
  }
  return { ...values };
}

async function readApi(route, cli = vc) {
  const result = await cli(['api', `${route}${route.includes('?') ? '&' : '?'}teamId=${teamId}`, '--method', 'GET'], { cwd: repo });
  return JSON.parse(result.stdout);
}

/** Fetches only metadata for secrets; only nonsensitive config endpoints are read. */
export async function inspectConfiguration({ api = readApi, projectGuard = guardProject } = {}) {
  const settings = validateProject(await projectGuard());
  const alias = validateAlias(await api(`/v4/aliases/${new URL(siteOrigin).hostname}`));
  const rows = validateEnvironmentRows((await api(`/v10/projects/${projectId}/env`)).envs);
  const config = {};
  for (const row of rows.filter(row => row.type === 'encrypted')) {
    const value = await api(`/v1/projects/${projectId}/env/${row.id}`);
    need(value.key === row.key && (value.id === undefined || value.id === row.id) && typeof value.value === 'string', 'CONFIG_RESPONSE_MISMATCH');
    config[row.key] = value.value;
  }
  for (const [key, value] of Object.entries(FIXED_CONFIG)) need(config[key] === value, `CONFIG_MISMATCH_${key}`);
  need(config.SUPABASE_DB_CA.includes('-----BEGIN CERTIFICATE-----') && config.SUPABASE_DB_CA.includes('-----END CERTIFICATE-----'), 'DATABASE_CA_MISSING');
  need(config.EMAIL_FROM.length > 0 && config.EMAIL_FROM.length < 300 && !/[\r\n]/.test(config.EMAIL_FROM), 'EMAIL_CONFIG_INVALID');
  need(config.ALPHA_EMAIL_STAGING_ALLOWLIST.length > 0 && config.ALPHA_EMAIL_STAGING_ALLOWLIST.length < 2000, 'STAGING_EMAIL_ALLOWLIST_MISSING');
  const publicValues = validatePublicValues(Object.fromEntries(PUBLIC_KEYS.map(key => [key, config[key]])));
  // A fresh preparation binds current metadata/config, not an old deployment's timestamps.
  const baseRows = rows.filter(row => !OPTIONAL_KEYS.includes(row.key));
  return { settings, settingsHash: digest(JSON.stringify(settings)), alias, aliasHash: digest(JSON.stringify(alias)), rows, publicValues,
    baseEnvironmentHash: digest(JSON.stringify({ rows: baseRows, config })), environmentFingerprint: environmentFingerprint(rows),
    wiseDedicatedKeyConfigured: rows.some(row => row.key === WISE_KEY) };
}

export function buildArguments(rows) {
  const blank = [...new Set([...rows.map(row => row.key), ...OPTIONAL_KEYS, ...Object.keys(RUNTIME), 'VERCEL_BUILDER_DEBUG'])]
    .filter(key => !PUBLIC_KEYS.includes(key)).sort();
  return { blank, args: [...Object.entries(RUNTIME).flatMap(([key, value]) => ['--env', `${key}=${value}`]), ...blank.flatMap(key => ['--build-env', `${key}=`])] };
}

export function validatePath(name) {
  need(typeof name === 'string' && name.length > 0 && !path.isAbsolute(name) && !/[\\:\0\r\n]/.test(name)
    && !name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)), 'UNSAFE_SOURCE_PATH');
  return name;
}

export function includedPath(name) {
  validatePath(name);
  const parts = name.toLowerCase().split('/');
  if (parts.some(part => /^\.env/i.test(part) || /^\.next/.test(part) || ['.git', '.vercel', 'node_modules', 'work', 'private', 'tmp', 'coverage', 'test-results', 'playwright-report', '.auth', '__pycache__'].includes(part))) return false;
  if (/\.(?:pem|key|p12|pfx|log|tsbuildinfo|mp4)$/i.test(name) || /(?:cookies|recovery-codes|storage-state|auth-state)\.(?:txt|json)$/i.test(name)) return false;
  return ROOT_FILES.has(name) || /^playwright[^/]*\.config\.ts$/.test(name)
    || /^(?:src|messages|packages|scripts|patches|public|e2e|docs)\//.test(name)
    || /^apps\/mobile\//.test(name) || /^supabase\/migrations\//.test(name)
    || ['data/alpha-exchange-db.json', 'discord-worker/package.json', 'discord-worker/package-lock.json'].includes(name);
}

export function parseTree(output) {
  const tree = new Map();
  for (const line of output.split('\0').filter(Boolean)) {
    const split = line.indexOf('\t'), [mode, type, oid] = line.slice(0, split).split(' '), name = line.slice(split + 1);
    validatePath(name);
    need(type === 'blob' && ['100644', '100755'].includes(mode) && /^[a-f0-9]{40}$/.test(oid), 'UNSAFE_GIT_TREE');
    need(!tree.has(name) && ![...tree.keys()].some(existing => existing.toLowerCase() === name.toLowerCase()), 'CASE_COLLIDING_GIT_PATH');
    tree.set(name, { mode, type, oid });
  }
  return tree;
}

function inspectGit(sha) {
  need(/^[a-f0-9]{40}$/.test(sha ?? ''), 'EXPLICIT_FINAL_COMMIT_REQUIRED');
  need(git(['rev-parse', 'HEAD']).toString().trim() === sha, 'EXACT_HEAD_REQUIRED');
  need(git(['status', '--porcelain=v1', '--untracked-files=all']).length === 0, 'CLEAN_COMMITTED_SOURCE_REQUIRED');
  const tree = parseTree(git(['ls-tree', '-r', '-z', sha]).toString());
  const selected = new Map([...tree].filter(([name]) => includedPath(name)));
  need(REQUIRED_FILES.every(name => selected.has(name)), 'REQUIRED_BUILD_SOURCE_MISSING');
  return { tree, selected };
}

export function overlayDocker(original, values) {
  validatePublicValues(values);
  let text = original.toString('utf8');
  need(Buffer.from(text).equals(original), 'DOCKER_UTF8_REQUIRED');
  for (const required of ['FROM docker.io/library/node:24.22.1-', 'RUN npm ci --include=dev', 'node --test scripts/test-container-web-tests.mjs',
    'node scripts/check-container-web-tests.mjs', 'node scripts/check-commission-checkout-release.mjs', 'node scripts/check-commission-batch-release.mjs', 'npm run build', 'USER node']) need(text.includes(required), 'CURRENT_CONTAINER_GATES_REQUIRED');
  need((text.match(/RUN --network=none env -i/g) ?? []).length === 2, 'ISOLATED_CONTAINER_TEST_GATES_REQUIRED');
  for (const key of PUBLIC_KEYS) {
    // Both the earlier bare ARG and the reviewed production public defaults are
    // supported. Replace the complete declaration; staging must never retain the
    // production browser URL/key, and malformed/multiline ARGs still fail closed.
    const declaration = new RegExp(`^ARG ${key}(?:=[A-Za-z0-9_:/?.=&%+-]+)?(?=\\r?$)`, 'gm');
    need((text.match(new RegExp(`^[\\t ]*ARG[\\t ]+${key}(?:[=\\t ]|\\r?$)`, 'gm')) ?? []).length === 1
      && (text.match(declaration) ?? []).length === 1, 'EXACT_PUBLIC_ARG_DECLARATION_REQUIRED');
    text = text.replace(declaration, `ARG ${key}=${values[key]}`);
  }
  return Buffer.from(text);
}

function readBlobs(tree) {
  const items = [...tree], input = items.map(([, item]) => item.oid).join('\n') + '\n';
  const data = execFileSync('git', ['cat-file', '--batch'], { cwd: repo, input, windowsHide: true, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  const files = new Map(); let offset = 0;
  for (const [name, item] of items) {
    const end = data.indexOf(10, offset); need(end > offset, 'GIT_BLOB_FRAME_INVALID');
    const [oid, type, lengthText] = data.subarray(offset, end).toString().split(' '), size = Number(lengthText);
    need(oid === item.oid && type === 'blob' && Number.isSafeInteger(size) && size >= 0 && size <= 20 * 1024 * 1024, 'GIT_BLOB_SCOPE_INVALID');
    const bytes = data.subarray(end + 1, end + 1 + size); offset = end + 2 + size;
    need(data[offset - 1] === 10 && bytes.length === size && blobId(bytes) === oid, 'GIT_BLOB_HASH_MISMATCH');
    need(!bytes.subarray(0, 80).toString().startsWith('version https://git-lfs.github.com/spec/v1'), 'UNRESOLVED_LFS_SOURCE');
    if (name === '.npmrc') need(!/(?:_auth|token|password)\s*=/i.test(bytes.toString()), 'PRIVATE_NPM_CONFIGURATION');
    files.set(name, bytes);
  }
  need(offset === data.length, 'UNEXPECTED_GIT_BLOB_BYTES');
  return files;
}

async function createPackage(sha, selected, publicValues) {
  const source = sourceFor(sha); await mkdir(source, { recursive: false });
  const files = readBlobs(selected), overlays = {};
  files.set('Dockerfile.vercel', overlayDocker(files.get('Dockerfile.vercel'), publicValues));
  files.set('.gitignore', IGNORE_OVERLAY); files.set('.vercelignore', IGNORE_OVERLAY);
  for (const name of ['Dockerfile.vercel', '.gitignore', '.vercelignore']) overlays[name] = digest(files.get(name));
  need(files.get('Dockerfile.vercel.dockerignore').equals(files.get('Dockerfile.vercel.containerignore')), 'CONTAINER_CONTEXT_RULES_DIFFER');
  const config = JSON.parse(files.get('vercel.json'));
  need(config.framework === 'container' && config.buildCommand === null && config.installCommand === null && !config.alias && !config.name && !config.scope, 'CONTAINER_TARGET_CONFIGURATION_REQUIRED');
  const manifest = [];
  for (const [name, bytes] of files) {
    const destination = path.join(source, ...name.split('/')); await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
    manifest.push({ path: name, gitBlob: selected.get(name).oid, size: bytes.length, sha: digest(bytes, 'sha1'), sha256: digest(bytes), overlay: Object.hasOwn(overlays, name) });
  }
  manifest.sort((a, b) => a.path.localeCompare(b.path));
  await mkdir(path.join(source, '.vercel'));
  await writeFile(path.join(source, '.vercel/project.json'), JSON.stringify({ projectId, orgId: teamId, projectName: 'alpha-usdt-buy-requests-staging' }), { flag: 'wx' });
  const archive = path.join(work, `wise-staging-${sha}-package.zip`);
  execFileSync(PYTHON, ['-c', 'import sys,json,pathlib,zipfile; root=pathlib.Path(sys.argv[1]).resolve(); names=json.load(sys.stdin); z=zipfile.ZipFile(sys.argv[2],"x",zipfile.ZIP_DEFLATED); [(z.write(root/n,n)) for n in names if (root/n).resolve().is_relative_to(root)]; z.close()', source, archive], { input: JSON.stringify(manifest.map(row => row.path)), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  return { source, manifest, overlays, archive: { file: path.basename(archive), sha256: digest(await readFile(archive)) } };
}

export function validateUpload(rows, manifest) {
  need(Array.isArray(rows) && rows.length > 0, 'EMPTY_UPLOAD_MANIFEST');
  const byPath = new Map(manifest.map(row => [row.path, row])), seen = new Set(), safe = [];
  for (const row of rows) {
    if (!row.sha) { need(row.size === 0, 'UNEXPECTED_UPLOAD_ENTRY'); continue; }
    need(typeof row.path === 'string', 'UNSAFE_UPLOAD_PATH');
    const name = row.path.replaceAll('\\', '/');
    validatePath(name); need(!seen.has(name), 'DUPLICATE_UPLOAD_PATH'); seen.add(name);
    const expected = byPath.get(name);
    need(expected && includedPath(name) && row.sha === expected.sha && row.size === expected.size, 'UPLOAD_NOT_REVIEWED_SOURCE');
    safe.push({ path: name, sha: row.sha, size: row.size });
  }
  // The CLI can omit its own ignore files, but cannot silently omit build inputs.
  need(manifest.every(row => ['.gitignore', '.vercelignore'].includes(row.path) || seen.has(row.path)), 'SOURCE_FILE_OMITTED_FROM_UPLOAD');
  need(REQUIRED_FILES.every(name => seen.has(name)), 'REQUIRED_UPLOAD_FILE_MISSING');
  return safe.sort((a, b) => a.path.localeCompare(b.path));
}

async function verifyPackage(report, selected) {
  const source = sourceFor(report.sourceCommit);
  need(report.source === source && report.target === 'preview' && report.projectId === projectId && report.teamId === teamId, 'PACKAGE_TARGET_CHANGED');
  need(report.manifestFile === `wise-staging-${report.sourceCommit}-source-manifest.json`, 'PACKAGE_MANIFEST_PATH_CHANGED');
  const manifest = await json(path.join(work, report.manifestFile));
  need(digest(JSON.stringify(manifest)) === report.manifestHash, 'PACKAGE_MANIFEST_CHANGED');
  const seen = [];
  async function walk(dir, prefix = '') {
    for (const name of await readdir(dir)) {
      const relative = prefix + name, file = path.join(dir, name), info = await lstat(file);
      need(!info.isSymbolicLink(), 'SOURCE_SYMLINK_FORBIDDEN');
      if (info.isDirectory()) await walk(file, `${relative}/`);
      else { need(info.isFile(), 'NONREGULAR_SOURCE_FILE'); seen.push(relative); }
    }
  }
  await walk(source);
  need(seen.length === manifest.length + 1 && seen.every(name => name === '.vercel/project.json' || manifest.some(row => row.path === name)), 'UNEXPECTED_PACKAGED_FILE');
  for (const row of manifest) {
    need(selected.has(row.path) && selected.get(row.path).oid === row.gitBlob, 'PACKAGE_COMMIT_CHANGED');
    const bytes = await readFile(path.join(source, row.path));
    need(bytes.length === row.size && digest(bytes) === row.sha256 && digest(bytes, 'sha1') === row.sha, 'PACKAGED_BYTES_CHANGED');
    if (row.overlay) need(['.gitignore', '.vercelignore', 'Dockerfile.vercel'].includes(row.path) && report.overlays[row.path] === row.sha256, 'UNREVIEWED_PACKAGE_OVERLAY');
    else need(blobId(bytes) === row.gitBlob, 'PACKAGED_GIT_BLOB_MISMATCH');
  }
  const linked = await json(path.join(source, '.vercel/project.json'));
  need(linked.projectId === projectId && linked.orgId === teamId, 'PACKAGE_LINK_CHANGED');
  need(report.archive.file === `wise-staging-${report.sourceCommit}-package.zip` && digest(await readFile(path.join(work, report.archive.file))) === report.archive.sha256, 'PACKAGE_ARCHIVE_CHANGED');
  return manifest;
}

async function dryUpload(source, rows, manifest, cli = vc) {
  const result = JSON.parse((await cli(['deploy', '--environment', 'preview', '--project', projectId, '--yes', '--dry', '--json', ...buildArguments(rows).args], { cwd: source })).stdout);
  return validateUpload(result.files, manifest);
}

async function persist(file, report) {
  const temporary = `${file}.${randomUUID()}.tmp`, stream = await open(temporary, 'wx');
  try { await stream.writeFile(JSON.stringify(report, null, 2)); await stream.sync(); } finally { await stream.close(); }
  await rename(temporary, file);
}

export async function prepare(sha) {
  need(process.versions.node === '24.22.1', 'PINNED_LOCAL_NODE_REQUIRED');
  const { selected } = inspectGit(sha), config = await inspectConfiguration();
  await mkdir(work, { recursive: true });
  const file = reportPath(sha), report = { status: 'PREPARING', checkedAt: new Date().toISOString(), sourceCommit: sha,
    projectId, teamId, targetRef, target: 'preview', runtimeOverrides: RUNTIME,
    productionWrites: 0, aliasWrites: 0, projectEnvironmentWrites: 0, deploymentsCreated: 0, releaseReady: false };
  await writeFile(file, JSON.stringify(report), { flag: 'wx' });
  try {
    const packaged = await createPackage(sha, selected, config.publicValues);
    const manifestFile = `wise-staging-${sha}-source-manifest.json`;
    await writeFile(path.join(work, manifestFile), JSON.stringify(packaged.manifest, null, 2), { flag: 'wx' });
    Object.assign(report, { source: packaged.source, archive: packaged.archive, manifestFile, manifestHash: digest(JSON.stringify(packaged.manifest)),
      overlays: packaged.overlays, sourceBlobCount: packaged.manifest.length, sourceBlobMismatches: 0,
      settingsHash: config.settingsHash, alias: config.alias, aliasHash: config.aliasHash, baseEnvironmentHash: config.baseEnvironmentHash, environmentFingerprint: config.environmentFingerprint,
      environment: config.rows, blankBuildProjectKeys: buildArguments(config.rows).blank, publicArgumentKeys: PUBLIC_KEYS,
      wiseDedicatedKeyConfigured: config.wiseDedicatedKeyConfigured });
    await verifyPackage(report, selected);
    const upload = await dryUpload(report.source, config.rows, packaged.manifest), after = await inspectConfiguration();
    need(after.settingsHash === config.settingsHash && after.baseEnvironmentHash === config.baseEnvironmentHash && after.aliasHash === config.aliasHash, 'CONFIGURATION_CHANGED_DURING_PREPARE');
    report.upload = { files: upload.length, manifestHash: digest(JSON.stringify(upload)) };
    await writeFile(path.join(work, `wise-staging-${sha}-upload-manifest.json`), JSON.stringify(upload, null, 2), { flag: 'wx' });
    report.status = 'PREPARED_NOT_DEPLOYED'; await persist(file, report); return report;
  } catch (error) { report.status = 'PREPARATION_FAILED_CLOSED'; report.failure = safeReason(error); await persist(file, report); throw error; }
}

export function validateOutboundPreflight(proof, sha, now = Date.now()) {
  need(proof?.status === 'PASS_WISE_STAGING_BASELINE' && proof.targetRef === targetRef && proof.sourceCommit === sha, 'FRESH_DATABASE_PREFLIGHT_REQUIRED');
  const age = now - Date.parse(proof.checkedAt);
  need(Number.isFinite(age) && age >= 0 && age <= 600_000 && proof.mobilePushSubscriptions === 0 && proof.mobilePushPendingReceiptJobs === 0 && proof.mobilePushDeliveries === 0, 'OUTBOUND_PUSH_NOT_VERIFIED_EMPTY');
  need(proof.databaseTargetVerified === true, 'DATABASE_TARGET_NOT_VERIFIED');
}

/** No value reaches argv, files, console, or a returned object. No upsert/rotation. */
export async function createReviewedWiseSecret({ sha, manifestHash, outboundProof, cli = vc, configuration = inspectConfiguration, readReport = () => json(reportPath(sha)) }) {
  validateOutboundPreflight(outboundProof, sha);
  const report = await readReport();
  need(report.status === 'PREPARED_NOT_DEPLOYED' && report.sourceCommit === sha && report.manifestHash === manifestHash, 'EXACT_REVIEWED_PACKAGE_REQUIRED');
  const config = await configuration();
  need(config.settingsHash === report.settingsHash && config.baseEnvironmentHash === report.baseEnvironmentHash && config.aliasHash === report.aliasHash, 'PREPARED_CONFIGURATION_CHANGED');
  if (config.wiseDedicatedKeyConfigured) return { created: false, configuration: config };
  // Caller records CREATE_IN_FLIGHT before invoking this function and must
  // reconcile an unknown outcome without generating or replacing another key.
  let value = randomBytes(32).toString('base64url');
  try {
    await cli(['api', `/v10/projects/${projectId}/env?teamId=${teamId}`, '--method', 'POST', '--input', '-', '--silent'],
      { cwd: work, input: JSON.stringify({ key: WISE_KEY, value, type: 'sensitive', target: ['preview'], comment: 'Dedicated Wise staging data encryption; runtime only.' }) });
  } catch { throw new Error('WISE_SECRET_CREATE_OUTCOME_UNKNOWN_RECONCILE_NO_RETRY'); }
  finally { value = ''; }
  const after = await configuration();
  need(after.wiseDedicatedKeyConfigured && after.settingsHash === report.settingsHash && after.baseEnvironmentHash === report.baseEnvironmentHash
    && after.aliasHash === report.aliasHash, 'WISE_SECRET_METADATA_NOT_CONFIRMED');
  return { created: true, configuration: after };
}

/** Explicit root-reviewed invocation only; intentionally not exposed by CLI. */
export async function deployReviewedPreview({ sha, manifestHash, outboundProof }) {
  need(process.versions.node === '24.22.1', 'PINNED_LOCAL_NODE_REQUIRED');
  need(/^[a-f0-9]{40}$/.test(sha ?? '') && /^[a-f0-9]{64}$/.test(manifestHash ?? ''), 'EXPLICIT_REVIEWED_SOURCE_REQUIRED');
  const lockPath = `${reportPath(sha)}.deploy.lock`, lock = await open(lockPath, 'wx');
  let report;
  try {
    validateOutboundPreflight(outboundProof, sha);
    report = await json(reportPath(sha));
    need(report.status === 'PREPARED_NOT_DEPLOYED' && report.sourceCommit === sha && !report.deploymentId && report.manifestHash === manifestHash, 'EXACT_PREPARED_PACKAGE_REQUIRED');
    const { selected } = inspectGit(sha), manifest = await verifyPackage(report, selected);
    let config = await inspectConfiguration();
    need(config.settingsHash === report.settingsHash && config.baseEnvironmentHash === report.baseEnvironmentHash && config.aliasHash === report.aliasHash, 'PREPARED_CONFIGURATION_CHANGED');
    const upload = await dryUpload(report.source, config.rows, manifest);
    need(digest(JSON.stringify(upload)) === report.upload.manifestHash, 'UPLOAD_MANIFEST_CHANGED');
    if (!config.wiseDedicatedKeyConfigured) {
      const initialReport = { ...report }; report.status = 'WISE_SECRET_CREATE_IN_FLIGHT'; await persist(reportPath(sha), report);
      const result = await createReviewedWiseSecret({ sha, manifestHash, outboundProof, readReport: async () => initialReport });
      config = result.configuration; report.projectEnvironmentWrites = Number(result.created);
    }
    validateOutboundPreflight(outboundProof, sha);
    report.runtimeConfigHash = digest(JSON.stringify({ NODE_ENV: 'production', ...RUNTIME }));
    report.status = 'DEPLOYMENT_CREATE_IN_FLIGHT'; await persist(reportPath(sha), report);
    const result = JSON.parse((await vc(['deploy', '--environment', 'preview', '--project', projectId, '--yes', '--no-wait', '--json', '--force',
      ...buildArguments(config.rows).args, '--meta', `reviewedSourceCommit=${sha}`, '--meta', `reviewedSourceManifest=${manifestHash}`,
      '--meta', `reviewedRuntimeConfig=${report.runtimeConfigHash}`, '--meta', 'stagingFeature=wise-usd', '--meta', 'stagingOutbound=disabled',
      '--meta', 'stagingEmailTransport=disabled'], { cwd: report.source })).stdout);
    need(/^dpl_[A-Za-z0-9]+$/.test(result.deployment?.id ?? ''), 'UNKNOWN_DEPLOYMENT_CREATE_OUTCOME');
    report.deploymentId = result.deployment.id; report.deploymentsCreated = 1;
    const deployment = await readApi(`/v13/deployments/${report.deploymentId}`);
    need(deployment.projectId === projectId && deployment.target === null && deployment.meta?.reviewedSourceCommit === sha
      && deployment.meta?.reviewedSourceManifest === manifestHash && /^alpha-usdt-buy-requests-staging-[a-z0-9]+-alpha-kits\.vercel\.app$/.test(deployment.url ?? ''), 'CREATED_DEPLOYMENT_SCOPE_MISMATCH');
    const after = await inspectConfiguration();
    need(after.settingsHash === report.settingsHash && after.baseEnvironmentHash === report.baseEnvironmentHash && after.aliasHash === report.aliasHash && after.wiseDedicatedKeyConfigured, 'CONFIGURATION_CHANGED_AFTER_DEPLOYMENT');
    Object.assign(report, { status: 'CREATED_AWAITING_RUNTIME_VERIFICATION', environmentFingerprint: after.environmentFingerprint,
      environment: after.rows, wiseDedicatedKeyConfigured: true, deployment: { id: deployment.id, url: deployment.url, readyState: deployment.readyState, target: 'preview' } });
    await persist(reportPath(sha), report); return report;
  } catch (error) {
    if (report) { report.failure = safeReason(error); if (report.status.endsWith('_IN_FLIGHT')) report.status = 'UNKNOWN_CLOUD_OUTCOME_RECONCILE_NO_RETRY'; await persist(reportPath(sha), report); }
    throw error;
  } finally { await lock.close(); await unlink(lockPath); }
}

export function validateRuntimeEvidence({ report, deployment, config, outboundProof, docker }) {
  const sha = report.sourceCommit;
  validateOutboundPreflight(outboundProof, sha);
  const runtimeConfig = { NODE_ENV: 'production', ...RUNTIME }, runtimeConfigHash = digest(JSON.stringify(runtimeConfig));
  need(report.status === 'CREATED_AWAITING_RUNTIME_VERIFICATION' && report.projectId === projectId && report.teamId === teamId
    && report.targetRef === targetRef && report.target === 'preview' && report.productionWrites === 0 && report.aliasWrites === 0
    && report.deploymentsCreated === 1 && report.releaseReady === false && JSON.stringify(report.runtimeOverrides) === JSON.stringify(RUNTIME)
    && report.runtimeConfigHash === runtimeConfigHash, 'RECORDED_RUNTIME_ARGUMENTS_CHANGED');
  need(deployment.id === report.deploymentId && deployment.projectId === projectId && deployment.target === null
    && deployment.readyState === 'READY' && deployment.nodeVersion === '24.x' && deployment.projectSettings?.framework === 'container'
    && deployment.meta?.reviewedSourceCommit === sha && deployment.meta?.reviewedSourceManifest === report.manifestHash
    && deployment.meta?.reviewedRuntimeConfig === runtimeConfigHash && deployment.meta?.stagingEmailTransport === 'disabled'
    && deployment.meta?.stagingOutbound === 'disabled' && deployment.meta?.stagingFeature === 'wise-usd'
    && /^alpha-usdt-buy-requests-staging-[a-z0-9]+-alpha-kits\.vercel\.app$/.test(deployment.url ?? ''), 'READY_REVIEWED_CONTAINER_REQUIRED');
  need(config.settingsHash === report.settingsHash && config.baseEnvironmentHash === report.baseEnvironmentHash && config.aliasHash === report.aliasHash
    && config.wiseDedicatedKeyConfigured && config.environmentFingerprint === report.environmentFingerprint, 'RUNTIME_CONFIGURATION_CHANGED');
  need(Array.isArray(deployment.env) && deployment.env.every(key => typeof key === 'string' && /^[A-Z0-9_]+$/.test(key))
    && [...Object.keys(RUNTIME), ...PUBLIC_KEYS, WISE_KEY, 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY'].every(key => deployment.env.includes(key)), 'DEPLOYED_RUNTIME_KEY_MISSING');
  const buildKeys = buildArguments(config.rows).blank;
  need(Array.isArray(deployment.build?.env) && [...buildKeys, ...PUBLIC_KEYS].every(key => deployment.build.env.includes(key)), 'DEPLOYED_BUILD_KEY_MISSING');
  const source = docker.toString('utf8');
  need((source.match(/^FROM docker\.io\/library\/node:24\.22\.1-bookworm-slim@sha256:[a-f0-9]{64} AS (?:build|runtime)$/gm) ?? []).length === 2
    && source.includes('if (process.versions.node !== \'24.22.1\') process.exit(1)')
    && /AS runtime\nWORKDIR \/app\nENV NODE_ENV=production \\\n/.test(source)
    && !/^\s*(?:ARG|ENV)\s+(?:ALPHA_WISE_PAYMENTS_ENABLED|ALPHA_EXCHANGE_WISE_DATA_SECRET)[=\s]/m.test(source), 'PINNED_RUNTIME_SOURCE_REQUIRED');
  return { status: 'PASS_WISE_STAGING_RUNTIME_GUARD', checkedAt: new Date().toISOString(), projectId, teamId, targetRef,
    sourceCommit: sha, deploymentId: deployment.id, url: `https://${deployment.url}`, nodeVersion: '24.22.1',
    environmentFingerprint: config.environmentFingerprint, runtimeConfig, providerCredentialsAbsent: true, wiseDedicatedKeyConfigured: true,
    databaseTargetVerified: true, productionWrites: 0, aliasWrites: 0, stableAlias: config.alias, runtimeConfigHash,
    evidence: { deploymentReady: true, deploymentEnvironmentNamesVerified: true, projectConfigValuesVerified: true,
      runtimeValues: 'Recorded creation arguments, SHA256-bound in immutable deployment metadata; API exposes names only.',
      nodeVersion: 'Exact Git-verified Docker image digest and build version assertion; READY deployment of that source.',
      secret: 'Sensitive preview-only project metadata and deployed environment key; value was never retrieved.',
      database: { checkedAt: outboundProof.checkedAt, targetRef, mobilePushSubscriptions: 0, mobilePushDeliveries: 0, mobilePushPendingReceiptJobs: 0 } },
    releaseReady: false };
}

/** Read-only hosted inspection; writes only the returned sanitized local proof. */
export async function verifyReviewedRuntime({ sha, manifestHash, outboundProof }) {
  need(process.versions.node === '24.22.1' && /^[a-f0-9]{40}$/.test(sha ?? '') && /^[a-f0-9]{64}$/.test(manifestHash ?? ''), 'EXPLICIT_REVIEWED_SOURCE_REQUIRED');
  const report = await json(reportPath(sha));
  need(report.sourceCommit === sha && report.manifestHash === manifestHash && /^dpl_[A-Za-z0-9]+$/.test(report.deploymentId ?? ''), 'KNOWN_REVIEWED_DEPLOYMENT_REQUIRED');
  const { selected } = inspectGit(sha); await verifyPackage(report, selected);
  const config = await inspectConfiguration(), deployment = await readApi(`/v13/deployments/${report.deploymentId}`);
  const docker = await readFile(path.join(report.source, 'Dockerfile.vercel'));
  const proof = validateRuntimeEvidence({ report, deployment, config, outboundProof, docker });
  const file = path.join(work, `wise-staging-${sha}-runtime-proof.json`), bytes = JSON.stringify(proof, null, 2);
  await writeFile(file, bytes, { flag: 'wx' });
  return { proof, file, sha256: digest(bytes) };
}

export async function main(args) {
  if (args.length === 1 && args[0] === 'inspect-config') {
    const config = await inspectConfiguration();
    console.log(JSON.stringify({ status: 'PASS_STAGING_CONFIGURATION_READ_ONLY', projectId, teamId, targetRef, protected: true,
      environment: config.rows, environmentFingerprint: config.environmentFingerprint, wiseDedicatedKeyConfigured: config.wiseDedicatedKeyConfigured,
      alias: config.alias, runtimeOverrides: RUNTIME, blankBuildProjectKeys: buildArguments(config.rows).blank, cloudWrites: 0 })); return;
  }
  need(args.length === 2 && args[0] === 'prepare', 'CLI_PREPARE_OR_INSPECT_ONLY');
  const report = await prepare(args[1]);
  console.log(JSON.stringify({ status: report.status, sourceCommit: report.sourceCommit, report: reportPath(report.sourceCommit),
    manifestHash: report.manifestHash, files: report.upload.files, cloudWrites: 0, releaseReady: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2)).catch(error => { console.log(JSON.stringify({ status: 'FAILED_CLOSED', reason: safeReason(error) })); process.exitCode = 1; });
}
