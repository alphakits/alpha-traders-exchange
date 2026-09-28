// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("committed Exchange seed privacy", () => {
  it("contains schema-only empty collections and no runtime backup", () => {
    const repositoryRoot = process.cwd();
    const seedPath = join(repositoryRoot, "data", "alpha-exchange-db.json");
    const backupPath = join(repositoryRoot, "data", "alpha-exchange-db.json.bak");
    const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Record<string, unknown>;

    expect(Object.keys(seed).length).toBeGreaterThan(0);
    for (const [collection, value] of Object.entries(seed)) {
      expect(Array.isArray(value), `${collection} must remain a collection`).toBe(true);
      expect(value, `${collection} must not contain committed user or runtime data`).toEqual([]);
    }
    expect(existsSync(backupPath)).toBe(false);
  });
});
