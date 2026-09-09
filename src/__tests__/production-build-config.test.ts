// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production build configuration", () => {
  it("serializes Next static export workers to prevent late export writes", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

    expect(config).toMatch(/experimental:\s*\{[\s\S]*?cpus:\s*1,/);
    expect(config).toContain(".next/export/500.html");
    expect(config).toContain("ENOTEMPTY");
  });
});
