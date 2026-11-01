// @vitest-environment node

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("obsolete maintenance and debug routes", () => {
  it.each([
    "src/app/api/admin/setup-test-accounts/route.ts",
    "src/app/api/admin/clean-test-accounts/route.ts",
    "src/app/api/debug/me/route.ts",
    "src/app/api/debug/cookie-test/route.ts",
  ])("does not ship %s", (relativePath) => {
    expect(existsSync(join(process.cwd(), relativePath))).toBe(false);
  });
});
