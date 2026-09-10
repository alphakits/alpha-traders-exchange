// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isNextExportCleanupRace } from "../../scripts/build-production.mjs";

describe("production build configuration", () => {
  it("serializes Next static export workers to prevent late export writes", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

    expect(config).toMatch(/experimental:\s*\{[\s\S]*?cpus:\s*1,/);
    expect(config).toContain(".next/export/500.html");
    expect(config).toContain("ENOTEMPTY");
  });

  it("runs production builds through the bounded export-cleanup guard", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const wrapper = readFileSync(join(process.cwd(), "scripts/build-production.mjs"), "utf8");
    const preload = readFileSync(join(process.cwd(), "scripts/next-build-fs-retry.cjs"), "utf8");

    expect(packageJson.scripts.build).toContain("scripts/build-production.mjs");
    expect(wrapper).toContain("MAX_BUILD_ATTEMPTS = 2");
    expect(wrapper).toContain("next-build-fs-retry.cjs");
    expect(preload).toContain("maxRetries");
    expect(preload).toContain('path.resolve(process.cwd(), ".next", "export")');
  });

  it("retries only the known Next export cleanup race", () => {
    expect(
      isNextExportCleanupRace(
        "ENOTEMPTY: directory not empty, rmdir '/repo/.next/export/_next'",
      ),
    ).toBe(true);
    expect(
      isNextExportCleanupRace(
        "ENOTEMPTY: directory not empty, rmdir 'C:\\repo\\.next\\export'",
      ),
    ).toBe(true);
    expect(isNextExportCleanupRace("Type error: Property 'name' is missing")).toBe(false);
    expect(
      isNextExportCleanupRace("ENOTEMPTY: directory not empty, rmdir '/repo/.next/cache'"),
    ).toBe(false);
  });
});
