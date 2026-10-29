import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const expectedEnvironment = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  CI: "1",
  NODE_ENV: "test",
  NO_COLOR: "1",
};

export function assertIsolatedTestEnvironment({
  platform = process.platform,
  version = process.versions.node,
  interfaces = networkInterfaces(),
  env = process.env,
} = {}) {
  assert.equal(platform, "linux", "Container checks require the isolated Linux build stage.");
  assert.equal(version, "24.22.1", "Container checks require the pinned Node runtime.");
  assert.deepEqual(Object.keys(env).sort(), Object.keys(expectedEnvironment).sort(),
    "Container checks require the exact sanitized environment.");
  for (const [key, value] of Object.entries(expectedEnvironment)) {
    assert.equal(env[key], value, `Invalid isolated test setting: ${key}`);
  }
  const addresses = Object.values(interfaces).flatMap((entries) => entries ?? []);
  assert.ok(addresses.length > 0, "Network isolation must expose an internal loopback interface.");
  assert.ok(addresses.every((entry) => entry.internal === true),
    "External network interfaces are present; tests will not start.");
  return { node: version, externalNetworkInterfaces: 0, environmentKeys: Object.keys(expectedEnvironment) };
}

export const webTestStages = [
  { name: "all-configured-unit-and-integration-tests", args: ["run", "--maxWorkers=2"], timeout: 1_200_000 },
  { name: "exchange-app-review-rehearsal", args: ["run", "src/__tests__/app-review-rehearsal.test.ts"], timeout: 180_000 },
  { name: "fifteen-seller-exchange-scale-rehearsal", args: ["run", "src/__tests__/marketplace-concurrency-scale.test.ts"], timeout: 180_000 },
];

export function assertContainerTestInputs(exists = existsSync) {
  for (const input of [
    "apps/mobile/src", "apps/mobile/app", "apps/mobile/app.json", "apps/mobile/.eas/workflows/iphone-installed-preview.yml",
    ".dockerignore", "Dockerfile.vercel.dockerignore", "Dockerfile.vercel.containerignore", "railway.json", "vercel.json",
    ".github/workflows/reliability-shield.yml",
    "supabase/optional-migrations/20260912023000_alpha_exchange_whatsapp_notifications.sql",
  ]) assert.ok(exists(input), `Required unit-test build input is absent: ${input}`);
}

export function runContainerWebTests() {
  const isolation = assertIsolatedTestEnvironment();
  assertContainerTestInputs();
  console.log(JSON.stringify({ status: "PASS_CONTAINER_TEST_ISOLATION", ...isolation }));
  const results = [];
  for (const stage of webTestStages) {
    assertIsolatedTestEnvironment();
    const started = Date.now();
    const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", ...stage.args], {
      cwd: process.cwd(), env: { ...expectedEnvironment }, stdio: "inherit",
      timeout: stage.timeout, killSignal: "SIGKILL",
    });
    assert.equal(result.error, undefined, `Container test process could not complete: ${stage.name}`);
    assert.equal(result.status, 0, `Container release tests failed: ${stage.name}`);
    results.push({ name: stage.name, exitCode: result.status, elapsedMs: Date.now() - started });
    console.log(JSON.stringify({ status: "PASS_CONTAINER_WEB_TEST_STAGE", ...results.at(-1) }));
  }
  console.log(JSON.stringify({ status: "PASS_ALL_CONTAINER_WEB_RELEASE_TESTS", node: process.versions.node, results }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runContainerWebTests();
}
