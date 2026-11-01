import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertContainerTestInputs, assertIsolatedTestEnvironment, webTestStages } from "./check-container-web-tests.mjs";

const clean = () => ({
  platform: "linux", version: "24.22.1",
  interfaces: { lo: [{ internal: true, address: "127.0.0.1" }, { internal: true, address: "::1" }] },
  env: { PATH: "/usr/local/bin:/usr/bin:/bin", CI: "1", NODE_ENV: "test", NO_COLOR: "1" },
});

test("accepts the exact sanitized loopback-only Linux test environment", () => {
  assert.equal(assertIsolatedTestEnvironment(clean()).externalNetworkInterfaces, 0);
});
test("refuses host networking before application tests can load", () => {
  const input = clean();
  input.interfaces.eth0 = [{ internal: false, address: "192.0.2.10" }];
  assert.throws(() => assertIsolatedTestEnvironment(input), /External network interfaces/);
});
test("refuses missing or indeterminate network interfaces", () => {
  for (const interfaces of [{}, { lo: undefined }, { lo: [{ internal: undefined }] }]) {
    assert.throws(() => assertIsolatedTestEnvironment({ ...clean(), interfaces }));
  }
});
test("refuses inherited credentials and cloud environment variables", () => {
  for (const key of ["RESEND_API_KEY", "SUPABASE_DB_URL", "VERCEL_OIDC_TOKEN", "HTTP_PROXY", "HOME"]) {
    const input = clean(); input.env[key] = "synthetic-test-value";
    assert.throws(() => assertIsolatedTestEnvironment(input), /exact sanitized environment/);
  }
});
test("refuses missing or incorrect fixed settings", () => {
  for (const key of Object.keys(clean().env)) {
    const changed = clean(); changed.env[key] = "wrong";
    assert.throws(() => assertIsolatedTestEnvironment(changed));
    const missing = clean(); delete missing.env[key];
    assert.throws(() => assertIsolatedTestEnvironment(missing));
  }
});
test("refuses unsupported platform or unpatched runtime", () => {
  assert.throws(() => assertIsolatedTestEnvironment({ ...clean(), platform: "win32" }));
  assert.throws(() => assertIsolatedTestEnvironment({ ...clean(), version: "24.21.0" }));
});
test("runs the unrestricted configured suite and both named rehearsals without weakening assertions", () => {
  assert.deepEqual(webTestStages.map(({ args }) => args), [
    ["run", "--maxWorkers=2"],
    ["run", "src/__tests__/app-review-rehearsal.test.ts"],
    ["run", "src/__tests__/marketplace-concurrency-scale.test.ts"],
  ]);
  assert.ok(webTestStages.every(({ timeout }) => timeout > 0));
});

test("refuses a container missing a required release-test input before starting tests", () => {
  assert.doesNotThrow(() => assertContainerTestInputs(() => true));
  for (const required of [".github/workflows/reliability-shield.yml",
    "supabase/optional-migrations/20260912023000_alpha_exchange_whatsapp_notifications.sql"]) {
    assert.throws(() => assertContainerTestInputs((input) => input !== required),
      (error) => error.message === `Required unit-test build input is absent: ${required}`);
  }
});

test("both container contexts include only the required GitHub workflow and retain secret exclusions", () => {
  const docker = readFileSync(new URL("../Dockerfile.vercel.dockerignore", import.meta.url), "utf8");
  const container = readFileSync(new URL("../Dockerfile.vercel.containerignore", import.meta.url), "utf8");
  assert.equal(container, docker);
  const rules = docker.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  assert.equal(rules[0], "**");
  // Re-including a parent directory would also admit unrelated files below it.
  assert.deepEqual(rules.filter((line) => line.startsWith("!.github")), [
    "!.github/workflows/reliability-shield.yml",
  ]);
  assert.deepEqual(rules.filter((line) => line.startsWith("!supabase/optional-migrations")), [
    "!supabase/optional-migrations/20260912023000_alpha_exchange_whatsapp_notifications.sql",
  ]);
  const lastInclusion = rules.findLastIndex((line) => line.startsWith("!"));
  for (const exclusion of ["**/.env", "**/.env.*", "**/.git", "**/.git/**", "**/.vercel", "**/.vercel/**",
    "**/private", "**/private/**", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx"]) {
    assert.ok(rules.indexOf(exclusion) > lastInclusion, `Secret exclusion must follow all inclusions: ${exclusion}`);
  }
});
