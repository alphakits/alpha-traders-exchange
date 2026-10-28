// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("Dockerfile.vercel", "utf8");
const [build, runtime] = dockerfile.split(/(?=^FROM .+ AS runtime$)/m);
const publicNames = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
];
const defaults = Object.fromEntries(
  [...build.matchAll(/^ARG (\w+)=(\S+)$/gm)].map((match) => [match[1], match[2]]),
);

describe("container public build inputs", () => {
  it("has only the three reviewed browser-safe defaults when build args are not forwarded", () => {
    expect(Object.keys(defaults)).toEqual(publicNames);
    expect(defaults.NEXT_PUBLIC_SUPABASE_URL).toBe("https://pihtougaocftqvcfcdhj.supabase.co");
    expect(defaults.NEXT_PUBLIC_SITE_URL).toBe("https://www.alphatraders.co.il");
    // A publishable key is intentionally public; secret/service-role keys must never be embedded.
    expect(defaults.NEXT_PUBLIC_SUPABASE_ANON_KEY).toMatch(/^sb_publishable_[A-Za-z0-9_-]+$/);
    expect([...dockerfile.matchAll(/^ARG (\w+)/gm)].map((match) => match[1])).toEqual(publicNames);
    expect(dockerfile).not.toMatch(/sb_secret_|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|RESEND_API_KEY/);
  });

  it("keeps explicit build-arg overrides and rejects an explicitly empty required input", () => {
    // Exercise the actual shell guard without starting the build or contacting any provider.
    const run = build.match(/^RUN (test -n [\s\S]+?)\s*&&\s*\\\n\s*node --test scripts\/test-container-server\.mjs/m);
    expect(run).not.toBeNull();
    const guard = run![1].replace(/\\\n/g, " ");
    const status = (overrides: Record<string, string> = {}) => spawnSync("/bin/sh", ["-c", guard], {
      env: { ...defaults, ...overrides, NODE_ENV: "test" },
    }).status;
    expect(status()).toBe(0);
    expect(status({ NEXT_PUBLIC_SITE_URL: "https://example.test" })).toBe(0);
    for (const name of publicNames) expect(status({ [name]: "" })).not.toBe(0);
  });

  it("runs credential-free, network-isolated checks before public configuration is introduced", () => {
    const firstArg = build.indexOf("\nARG ");
    for (const command of [
      "node --test scripts/test-container-web-tests.mjs",
      "node scripts/check-container-web-tests.mjs",
    ]) {
      const isolated = `RUN --network=none env -i PATH=/usr/local/bin:/usr/bin:/bin CI=1 NODE_ENV=test NO_COLOR=1 \\\n    ${command}`;
      expect(build).toContain(isolated);
      expect(build.indexOf(isolated)).toBeLessThan(firstArg);
    }
  });

  it("retains the container server and commission release checks before the production build", () => {
    const commands = [
      'RUN test -n "$NEXT_PUBLIC_SUPABASE_URL"',
      "node --test scripts/test-container-server.mjs",
      "node scripts/check-commission-checkout-release.mjs",
      "node scripts/check-commission-batch-release.mjs",
      "npm run build",
    ];
    let previous = -1;
    for (const command of commands) {
      const index = build.indexOf(command);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
  });

  it("does not replace runtime environment configuration with build defaults", () => {
    expect(runtime).toBeTruthy();
    expect(runtime).not.toMatch(/^ARG /m);
    for (const name of publicNames) expect(runtime).not.toContain(name);
    expect(runtime).toContain("USER node");
    expect(runtime).toContain('CMD ["node", "scripts/container-server.cjs"]');
  });
});
