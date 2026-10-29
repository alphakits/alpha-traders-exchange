import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { projectId, teamId, targetRef, siteOrigin, WISE_KEY, RUNTIME, PUBLIC_KEYS, validateProject, validateEnvironmentRows,
  validatePublicValues, buildArguments, includedPath, parseTree, overlayDocker, validateUpload, validateOutboundPreflight,
  createReviewedWiseSecret, main, digest, validateAlias, environmentFingerprint, validateRuntimeEvidence, inspectConfiguration } from './deploy.mjs';

const sha = 'a'.repeat(40), manifestHash = 'b'.repeat(64), now = Date.now();
const baseline = () => ({ status: 'PASS_WISE_STAGING_BASELINE', targetRef, sourceCommit: sha, checkedAt: new Date(now).toISOString(),
  mobilePushSubscriptions: 0, mobilePushPendingReceiptJobs: 0, mobilePushDeliveries: 0, databaseTargetVerified: true });
const project = () => ({ id: projectId, accountId: teamId, name: 'alpha-usdt-buy-requests-staging', nodeVersion: '24.x', ssoProtection: { deploymentType: 'all' }, protectionBypass: {}, link: null });
const values = () => ({ NEXT_PUBLIC_SUPABASE_URL: `https://${targetRef}.supabase.co`, NEXT_PUBLIC_SITE_URL: siteOrigin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_synthetic_test_value_only' });
const rows = () => {
  const secret = ['SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET', 'RESEND_API_KEY'];
  const config = [...PUBLIC_KEYS, 'NPM_CONFIG_ENGINE_STRICT', 'AUTH_COOKIE_SECURE', 'ALPHA_USDT_REQUESTS_ENABLED', 'ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED',
    'ALPHA_EXCHANGE_TWILIO_SEND_ENABLED', 'ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED', 'ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED', 'ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED',
    'SUPABASE_DB_CA', 'ALPHA_EMAIL_STAGING_ALLOWLIST', 'EMAIL_FROM'];
  return [...secret, ...config].map((key, i) => ({ key, id: `env_${i}`, type: secret.includes(key) ? 'sensitive' : 'encrypted', target: ['preview'], updatedAt: 1 }));
};

test('accepts only the protected unlinked staging project', () => {
  assert.equal(validateProject(project()).id, projectId);
  for (const change of [{ id: 'production' }, { accountId: 'other' }, { nodeVersion: '22.x' }, { rootDirectory: 'other' },
    { link: { repo: 'unexpected' } }, { ssoProtection: { deploymentType: 'preview' } }, { protectionBypass: { unexpected: {} } }]) {
    assert.throws(() => validateProject({ ...project(), ...change }));
  }
});

test('freezes an existing staging alias and rejects redirect or foreign targets', () => {
  const input = { alias: new URL(siteOrigin).hostname, projectId, deploymentId: 'dpl_existing', deployment: { id: 'dpl_existing', url: 'alpha-usdt-buy-requests-staging-existing-alpha-kits.vercel.app' } };
  assert.equal(validateAlias(input).deploymentId, 'dpl_existing');
  for (const change of [{ alias: 'www.alphatraders.co.il' }, { projectId: 'production' }, { redirect: 'https://example.com' }, { deploymentId: 'dpl_different' }, { deletedAt: 1 }]) assert.throws(() => validateAlias({ ...input, ...change }));
});

test('runtime environment fingerprint is shared metadata only, excludes private values and IDs', () => {
  const input = rows(), second = input.map(row => ({ ...row, id: 'other-id', value: 'never-in-proof' }));
  assert.equal(environmentFingerprint(input), environmentFingerprint(second));
  second[0].updatedAt++; assert.notEqual(environmentFingerprint(input), environmentFingerprint(second));
});

test('configuration guard fetches only non-sensitive values and validates exact real keys', async () => {
  const environment = rows(), fetched = [];
  const valueMap = { ...values(), NPM_CONFIG_ENGINE_STRICT: 'true', AUTH_COOKIE_SECURE: 'true', ALPHA_USDT_REQUESTS_ENABLED: '1',
    ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: '0', ALPHA_EXCHANGE_TWILIO_SEND_ENABLED: 'false', ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED: 'false',
    ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED: 'false', ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED: 'false',
    SUPABASE_DB_CA: '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----', ALPHA_EMAIL_STAGING_ALLOWLIST: 'test@example.com', EMAIL_FROM: 'test@example.com' };
  const api = async route => {
    if (route.startsWith('/v4/aliases/')) return { alias: new URL(siteOrigin).hostname, projectId, deploymentId: 'dpl_existing', deployment: { id: 'dpl_existing', url: 'alpha-usdt-buy-requests-staging-existing-alpha-kits.vercel.app' } };
    if (route === `/v10/projects/${projectId}/env`) return { envs: environment };
    const row = environment.find(r => route.endsWith('/' + r.id));
    assert.equal(row?.type, 'encrypted'); fetched.push(row.key);
    return { key: row.key, id: row.id, value: valueMap[row.key] };
  };
  const result = await inspectConfiguration({ api, projectGuard: async () => project() });
  assert.equal(fetched.length, 14); assert.equal(result.wiseDedicatedKeyConfigured, false);
  assert.equal(result.environmentFingerprint, environmentFingerprint(environment));
  valueMap.ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED = '1';
  await assert.rejects(inspectConfiguration({ api, projectGuard: async () => project() }), /CONFIG_MISMATCH_ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED/);
});
test('requires exact known keys, preview-only scope and secret types', () => {
  assert.equal(validateEnvironmentRows(rows()).length, 19);
  for (const change of [{ target: ['production'] }, { target: ['preview', 'production'] }, { gitBranch: 'main' }, { customEnvironmentIds: ['other'] }, { type: 'plain' }]) {
    const input = rows(); input[0] = { ...input[0], ...change }; assert.throws(() => validateEnvironmentRows(input));
  }
  assert.throws(() => validateEnvironmentRows(rows().slice(1)));
  assert.throws(() => validateEnvironmentRows([...rows(), { key: 'DATABASE_URL', id: 'foreign', type: 'sensitive', target: ['preview'] }]));
  assert.throws(() => validateEnvironmentRows([...rows(), rows()[0]]));
  assert.equal(validateEnvironmentRows([...rows(), { key: WISE_KEY, id: 'wise', type: 'sensitive', target: ['preview'] }]).length, 20);
});
test('public build inputs reject private keys, wrong targets and Docker injection', () => {
  assert.deepEqual(validatePublicValues(values()), values());
  for (const value of ['sb_secret_must_not_be_public', 'sb_publishable_x\nRUN echo bad', 'sb_publishable_x$bad']) {
    assert.throws(() => validatePublicValues({ ...values(), NEXT_PUBLIC_SUPABASE_ANON_KEY: value }));
  }
  assert.throws(() => validatePublicValues({ ...values(), NEXT_PUBLIC_SUPABASE_URL: 'https://production.supabase.co' }));
  assert.throws(() => validatePublicValues({ ...values(), NEXT_PUBLIC_SITE_URL: 'https://www.alphatraders.co.il' }));
  assert.throws(() => validatePublicValues({ ...values(), SUPABASE_SERVICE_ROLE_KEY: 'forbidden' }));
});
test('blanks every private project build variable while preserving public build inputs and runtime database inheritance', () => {
  const built = buildArguments(rows());
  for (const key of [...rows().map(row => row.key).filter(key => !PUBLIC_KEYS.includes(key)), WISE_KEY, 'VERCEL_BUILDER_DEBUG']) assert.ok(built.blank.includes(key));
  for (const key of PUBLIC_KEYS) assert.equal(built.blank.includes(key), false);
  assert.equal(Object.hasOwn(RUNTIME, 'SUPABASE_DB_URL'), false);
  assert.equal(Object.hasOwn(RUNTIME, 'SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(Object.hasOwn(RUNTIME, WISE_KEY), false);
  assert.equal(RUNTIME.RESEND_API_KEY, '');
  assert.equal(RUNTIME.ALPHA_WISE_PAYMENTS_ENABLED, '1');
});
test('excludes generated, private, environment and dependency files while retaining isolated test inputs', () => {
  for (const file of ['.env', '.env.example', 'src/.env.production', 'private/account.json', 'node_modules/pkg/index.js', 'work/proof.json',
    'test-results/trace.zip', 'e2e/.auth/admin.json', 'e2e/storage-state.json', 'docs/cookies.txt', 'src/client.pem', 'public/files/video.mp4', '.git/config',
    '.github/workflows/other.yml', '.github/CODEOWNERS', '.github/.env', '.github/workflows/.env.production',
    '.github/workflows/client.pem', '.github/private/account.json']) assert.equal(includedPath(file), false, file);
  for (const file of ['src/lib/wise-storage-crypto.ts', 'src/__tests__/wise-storage-postgres.test.ts', 'apps/mobile/.eas/workflows/iphone-installed-preview.yml',
    'Dockerfile.vercel.containerignore', '.github/workflows/reliability-shield.yml', 'public/images/hero.webp', 'supabase/migrations/valid.sql']) assert.equal(includedPath(file), true, file);
  for (const file of ['../escape', 'C:/escape', '/absolute', 'src\\file', 'src/../file']) assert.throws(() => includedPath(file));
});
test('rejects symbolic links, submodules and case-colliding Git paths', () => {
  assert.equal(parseTree(`100644 blob ${sha}\tsrc/file.ts\0`).size, 1);
  assert.throws(() => parseTree(`120000 blob ${sha}\tsrc/file.ts\0`));
  assert.throws(() => parseTree(`160000 commit ${sha}\tsrc/submodule\0`));
  assert.throws(() => parseTree(`100644 blob ${sha}\tsrc/File.ts\0` + `100644 blob ${sha}\tsrc/file.ts\0`));
});
test('public ARG overlay preserves all other current Docker bytes and test gates', async () => {
  const original = await readFile(new URL('../../Dockerfile.vercel', import.meta.url));
  const output = overlayDocker(original, values());
  assert.equal(output.toString(), original.toString().replace(/^ARG (NEXT_PUBLIC_[A-Z_]+)(?:=[^\r\n]*)?(?=\r?$)/gm, (_, key) => `ARG ${key}=${values()[key]}`));
  assert.throws(() => overlayDocker(Buffer.from(original.toString().replace('node scripts/check-container-web-tests.mjs', 'echo skipped')), values()));
  assert.throws(() => overlayDocker(Buffer.concat([original, Buffer.from('\nARG NEXT_PUBLIC_SITE_URL\n')]), values()));
});
test('public ARG overlay supports earlier bare declarations and preserves CRLF', async () => {
  const current = (await readFile(new URL('../../Dockerfile.vercel', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const bare = current.replace(/^(ARG NEXT_PUBLIC_[A-Z_]+)=[^\n]+$/gm, '$1').replace(/\n/g, '\r\n');
  const output = overlayDocker(Buffer.from(bare), values()).toString();
  for (const [key, value] of Object.entries(values())) assert(output.includes(`ARG ${key}=${value}\r\n`));
  assert.equal(output.replace(/^ARG NEXT_PUBLIC_[^\r\n]+/gm, ''), bare.replace(/^ARG NEXT_PUBLIC_[^\r\n]+/gm, ''));
});
test('public ARG overlay rejects ambiguous, quoted and continuation declarations', async () => {
  const source = await readFile(new URL('../../Dockerfile.vercel', import.meta.url), 'utf8');
  for (const declaration of ['ARG NEXT_PUBLIC_SITE_URL="https://example.com"', 'ARG NEXT_PUBLIC_SITE_URL=https://example.com \\\n+RUN echo injected', 'ARG NEXT_PUBLIC_SITE_URL', 'ARG NEXT_PUBLIC_SITE_URL=https://example.com # trailing']) {
    const changed = declaration === 'ARG NEXT_PUBLIC_SITE_URL'
      ? source + '\n  ARG NEXT_PUBLIC_SITE_URL=https://duplicate.invalid\n'
      : source.replace(/^ARG NEXT_PUBLIC_SITE_URL[^\r\n]*/m, declaration);
    assert.throws(() => overlayDocker(Buffer.from(changed), values()), /EXACT_PUBLIC_ARG_DECLARATION_REQUIRED/);
  }
});
test('upload scope rejects private, unexpected and changed files', () => {
  const entry = { path: 'src/file.ts', sha: digest(Buffer.from('x'), 'sha1'), size: 1 };
  assert.throws(() => validateUpload([{ ...entry, path: '.env' }], [entry]));
  assert.throws(() => validateUpload([{ ...entry, sha: sha }], [entry]));
  assert.throws(() => validateUpload([entry, entry], [entry]));
  assert.throws(() => validateUpload([{ ...entry, path: '../escape' }], [entry]));
});
test('requires fresh exact-source zero-push database evidence', () => {
  validateOutboundPreflight(baseline(), sha, now);
  for (const change of [{ targetRef: 'production' }, { sourceCommit: 'c'.repeat(40) }, { mobilePushSubscriptions: 1 },
    { mobilePushPendingReceiptJobs: 1 }, { mobilePushDeliveries: 1 }, { databaseTargetVerified: false }, { checkedAt: new Date(now - 600_001).toISOString() }]) {
    assert.throws(() => validateOutboundPreflight({ ...baseline(), ...change }, sha, now));
  }
});
test('secret creation sends generated material only via stdin and only after reviewed guards', async () => {
  const config = { settingsHash: 'settings', baseEnvironmentHash: 'base', wiseDedicatedKeyConfigured: false };
  const report = { status: 'PREPARED_NOT_DEPLOYED', sourceCommit: sha, manifestHash, settingsHash: 'settings', baseEnvironmentHash: 'base' };
  let writes = 0;
  const result = await createReviewedWiseSecret({ sha, manifestHash, outboundProof: baseline(), readReport: async () => report,
    configuration: async () => ({ ...config, wiseDedicatedKeyConfigured: writes > 0 }), cli: async (args, options) => {
      writes++;
      const body = JSON.parse(options.input);
      assert.equal(args.includes('--input'), true); assert.equal(args.includes('--silent'), true); assert.equal(args.includes(body.value), false);
      assert.equal(body.value.length, 43); assert.equal(/^[A-Za-z0-9_-]+$/.test(body.value), true);
      assert.equal(body.key, WISE_KEY); assert.equal(body.type, 'sensitive'); assert.deepEqual(body.target, ['preview']);
      assert.equal(args.some(arg => arg.includes('upsert')), false);
      return { stdout: '', stderr: '' };
    } });
  assert.equal(result.created, true); assert.equal(writes, 1);
  assert.equal(JSON.stringify(result).includes('value'), false);
});
test('invalid preflight performs no secret write; existing secret is never rotated', async () => {
  let calls = 0;
  await assert.rejects(createReviewedWiseSecret({ sha, manifestHash, outboundProof: { ...baseline(), mobilePushSubscriptions: 1 }, cli: async () => { calls++; } }));
  assert.equal(calls, 0);
  const config = { settingsHash: 's', baseEnvironmentHash: 'b', wiseDedicatedKeyConfigured: true };
  const result = await createReviewedWiseSecret({ sha, manifestHash, outboundProof: baseline(), configuration: async () => config,
    readReport: async () => ({ status: 'PREPARED_NOT_DEPLOYED', sourceCommit: sha, manifestHash, settingsHash: 's', baseEnvironmentHash: 'b' }), cli: async () => { calls++; } });
  assert.equal(result.created, false); assert.equal(calls, 0);
});

test('unknown secret-write outcome is redacted and never retried automatically', async () => {
  let calls = 0;
  await assert.rejects(createReviewedWiseSecret({ sha, manifestHash, outboundProof: baseline(),
    configuration: async () => ({ settingsHash: 's', baseEnvironmentHash: 'b', wiseDedicatedKeyConfigured: false }),
    readReport: async () => ({ status: 'PREPARED_NOT_DEPLOYED', sourceCommit: sha, manifestHash, settingsHash: 's', baseEnvironmentHash: 'b' }),
    cli: async (_args, options) => { calls++; throw new Error('Provider error echoed value ' + JSON.parse(options.input).value); } }),
  error => error.message === 'WISE_SECRET_CREATE_OUTCOME_UNKNOWN_RECONCILE_NO_RETRY');
  assert.equal(calls, 1);
});

for (const [ending, newline] of [['LF', '\n'], ['CRLF', '\r\n']]) test(`runtime proof requires READY exact source, immutable argument binding, metadata and fresh database facts (${ending})`, async () => {
  const runtimeConfigHash = digest(JSON.stringify({ NODE_ENV: 'production', ...RUNTIME })), environment = [...rows(), { key: WISE_KEY, id: 'wise', type: 'sensitive', target: ['preview'], updatedAt: 1 }];
  const report = { status: 'CREATED_AWAITING_RUNTIME_VERIFICATION', projectId, teamId, targetRef, target: 'preview', productionWrites: 0, aliasWrites: 0,
    deploymentsCreated: 1, releaseReady: false, runtimeOverrides: RUNTIME, runtimeConfigHash, sourceCommit: sha, manifestHash, deploymentId: 'dpl_synthetic',
    settingsHash: 'settings', baseEnvironmentHash: 'base', aliasHash: 'alias', environmentFingerprint: environmentFingerprint(environment) };
  const config = { ...report, wiseDedicatedKeyConfigured: true, rows: environment };
  const deployment = { id: report.deploymentId, projectId, target: null, readyState: 'READY', nodeVersion: '24.x', projectSettings: { framework: 'container' },
    url: 'alpha-usdt-buy-requests-staging-test-alpha-kits.vercel.app', env: [...Object.keys(RUNTIME), ...PUBLIC_KEYS, WISE_KEY, 'SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    build: { env: [...buildArguments(environment).blank, ...PUBLIC_KEYS] }, meta: { reviewedSourceCommit: sha, reviewedSourceManifest: manifestHash,
      reviewedRuntimeConfig: runtimeConfigHash, stagingEmailTransport: 'disabled', stagingOutbound: 'disabled', stagingFeature: 'wise-usd' } };
  const dockerSource = await readFile(new URL('../../Dockerfile.vercel', import.meta.url), 'utf8');
  const docker = Buffer.from(dockerSource.replace(/\r\n/g, '\n').replace(/\n/g, newline));
  const input = { report, deployment, config, outboundProof: baseline(), docker };
  const proof = validateRuntimeEvidence(input);
  assert.equal(proof.status, 'PASS_WISE_STAGING_RUNTIME_GUARD'); assert.equal(proof.runtimeConfig.NODE_ENV, 'production');
  assert.match(proof.evidence.runtimeValues, /API exposes names only/);
  for (const change of [{ readyState: 'BUILDING' }, { target: 'production' }, { nodeVersion: '22.x' }, { env: [] },
    { meta: { ...deployment.meta, reviewedRuntimeConfig: 'wrong' } }]) assert.throws(() => validateRuntimeEvidence({ ...input, deployment: { ...deployment, ...change } }));
  assert.throws(() => validateRuntimeEvidence({ ...input, config: { ...config, aliasHash: 'changed' } }));
  assert.throws(() => validateRuntimeEvidence({ ...input, config: { ...config, wiseDedicatedKeyConfigured: false } }));
  assert.throws(() => validateRuntimeEvidence({ ...input, outboundProof: { ...baseline(), mobilePushSubscriptions: 1 } }));
  assert.throws(() => validateRuntimeEvidence({ ...input, docker: Buffer.from(docker.toString().replaceAll('24.22.1', '24.20.0')) }));
});
test('CLI cannot deploy, create a secret, link, or promote', async () => {
  for (const command of ['deploy', 'link', 'promote', 'secret']) await assert.rejects(main([command, sha]), /CLI_PREPARE_OR_INSPECT_ONLY/);
});
