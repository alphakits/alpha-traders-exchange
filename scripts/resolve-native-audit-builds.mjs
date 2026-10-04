import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const sourcePaths = ['apps/mobile', 'packages', 'package.json', 'package-lock.json', 'scripts/patch-expo-uri-decoder.mjs', 'scripts/patch-dependency-security.mjs', 'patches/security-dependencies.json', ':!apps/mobile/.maestro', ':!apps/mobile/.maestro-helpers', ':!apps/mobile/.maestro-legacy', ':!apps/mobile/.eas'];
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const appVersion = JSON.parse(readFileSync('apps/mobile/app.json', 'utf8')).expo.version;
const selected = [];

for (const [platform, profile] of [['android', 'preview'], ['ios', 'audit-simulator']]) {
  const builds = JSON.parse(readFileSync(`${platform}-audit-builds.json`, 'utf8'));
  const build = builds.find(candidate => {
    if (candidate.status !== 'FINISHED' || candidate.buildProfile !== profile || candidate.appVersion !== appVersion || (platform === 'ios' && !candidate.isForIosSimulator)) return false;
    if (!/^[0-9a-f]{40}$/.test(candidate.gitCommitHash ?? '') || !/^[0-9a-f-]{36}$/.test(candidate.id ?? '')) return false;
    const diff = spawnSync('git', ['diff', '--quiet', candidate.gitCommitHash, sourceCommit, '--', ...sourcePaths]);
    return diff.status === 0;
  });
  if (!build) throw new Error(`No completed ${platform} audit binary matches the current native source and dependencies. Build a new candidate first.`);
  const evidence = { platform, buildId: build.id, appVersion, buildVersion: build.appBuildVersion, binarySource: build.gitCommitHash, verificationSource: sourceCommit, nativeSourceMatches: true };
  selected.push(evidence);
  if (!process.env.GITHUB_OUTPUT) throw new Error('This command must run in its GitHub verification job.');
  appendFileSync(process.env.GITHUB_OUTPUT, `${platform}_build_id=${build.id}\n`);
  console.log(`${platform}: reusing completed build ${build.id}; native sources and locked dependencies match.`);
}
writeFileSync('native-audit-build-selection.json', JSON.stringify(selected, null, 2) + '\n');
