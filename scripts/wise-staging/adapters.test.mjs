import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repo, work, absolutePath, fixtureDirectory, targetRef } from './environment.mjs';
import { databaseConnection, validateDatabaseCa, cliConfiguration, dbPool } from './adapters.mjs';

test('paths follow this checkout and generated evidence stays outside tracked source', () => {
  assert.equal(repo, path.resolve(fileURLToPath(new URL('../../', import.meta.url))));
  assert.equal(work, path.join(repo, 'tmp', 'wise-staging'));
  assert.equal(absolutePath(repo, 'BAD_PATH'), repo);
  for (const bad of [undefined, '', '.', '../other', repo + '/..', repo + '\0']) assert.throws(() => absolutePath(bad, 'BAD_PATH'), /BAD_PATH/);
});

test('fixtures require an explicit directory outside the source checkout', () => {
  assert.throws(() => fixtureDirectory({}), /EXPLICIT_PRIVATE_FIXTURE_DIRECTORY_REQUIRED/);
  for (const inside of [repo, path.join(repo, 'src'), path.join(repo, 'tmp')]) {
    assert.throws(() => fixtureDirectory({ ALPHA_WISE_STAGING_FIXTURE_DIR: inside }), /PRIVATE_FIXTURES_MUST_BE_OUTSIDE_SOURCE/);
  }
  const outside = path.join(path.dirname(repo), 'synthetic-fixtures');
  assert.equal(fixtureDirectory({ ALPHA_WISE_STAGING_FIXTURE_DIR: outside }), outside);
});

test('database adapter accepts only the pinned staging pool and removes URL SSL overrides', () => {
  const input = `postgresql://postgres.${targetRef}:synthetic-only@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`;
  assert.equal(databaseConnection(input), input);
  assert.equal(databaseConnection(input + '?sslmode=disable&sslrootcert=untrusted&uselibpqcompat=true'), input);
  for (const changed of [undefined, 'not-a-url', input.replace(targetRef, 'production'), input.replace(':6543', ':5432'),
    input.replace('pooler.supabase.com', 'pooler.supabase.com.example.org'), input.replace('/postgres', '/another'),
    input + '?options=--search_path=public', input + '#ignored', input.replace('synthetic-only', '')]) {
    assert.throws(() => databaseConnection(changed), /EXACT_ISOLATED_DATABASE_REQUIRED|EXPLICIT_STAGING_DATABASE_URL_REQUIRED/);
  }
});

test('missing database configuration and an unpinned CA fail before connecting', async () => {
  assert.throws(() => validateDatabaseCa('not a certificate'), /PINNED_VALID_DATABASE_CA_REQUIRED/);
  const saved = process.env.ALPHA_WISE_STAGING_DATABASE_URL;
  delete process.env.ALPHA_WISE_STAGING_DATABASE_URL;
  try { await assert.rejects(dbPool(), /EXPLICIT_STAGING_DATABASE_URL_REQUIRED/); }
  finally { if (saved !== undefined) process.env.ALPHA_WISE_STAGING_DATABASE_URL = saved; }
});

test('CLI uses only an explicit profile and pinned local package, with no implicit token', async () => {
  await assert.rejects(cliConfiguration({}), /EXPLICIT_VERCEL_CLI_PATH_REQUIRED/);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wise-staging-cli-test-'));
  try {
    await mkdir(path.join(directory, 'dist'));
    const entry = path.join(directory, 'dist', 'index.js'), auth = path.join(directory, 'profile');
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'vercel', version: '65.2.0' }));
    const env = { ALPHA_WISE_STAGING_VERCEL_CLI: entry, ALPHA_WISE_STAGING_VERCEL_CONFIG: auth };
    assert.deepEqual(await cliConfiguration(env), { entry, auth });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'vercel', version: '0.0.0' }));
    await assert.rejects(cliConfiguration(env), /PINNED_VERCEL_CLI_REQUIRED/);
    await assert.rejects(cliConfiguration({ ...env, ALPHA_WISE_STAGING_VERCEL_CONFIG: undefined }), /EXPLICIT_VERCEL_PROFILE_REQUIRED/);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('wise-staging-cli-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('packaged helpers have no legacy workspace imports or absolute user directories', async () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  for (const folder of [root, path.join(root, 'audit')]) {
    for (const file of await readdir(folder)) {
      if (!file.endsWith('.mjs') || file.endsWith('.test.mjs')) continue;
      const source = await readFile(path.join(folder, file), 'utf8');
      assert(!/[A-Z]:[\\/]Users[\\/]|2026-10-(?:24|25|27)[\\/]|staging-mail-readonly-reconcile|staging-vercel-control/.test(source), file);
    }
  }
});
