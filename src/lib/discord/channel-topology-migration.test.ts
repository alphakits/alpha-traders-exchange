// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DISCORD_MANAGED_RESOURCE_KEYS } from "@/lib/discord/resource-manager";

describe("Discord channel topology migration", () => {
  const source = readFileSync(
    resolve("supabase/migrations/20260809070000_discord_onboarding_ux.sql"),
    "utf8",
  );

  it("extends the production constraint with every stable managed key", () => {
    for (const key of DISCORD_MANAGED_RESOURCE_KEYS) {
      expect(source).toContain(`'${key}'`);
    }
    expect(DISCORD_MANAGED_RESOURCE_KEYS).toHaveLength(24);
    expect(new Set(DISCORD_MANAGED_RESOURCE_KEYS).size).toBe(24);
  });

  it("is rerunnable and validates existing rows before enforcement", () => {
    expect(source).toContain(
      "drop constraint if exists discord_managed_resources_resource_key_check",
    );
    expect(source).toContain(
      "add constraint discord_managed_resources_resource_key_check check",
    );
    expect(source).toContain("not valid");
    expect(source).toContain(
      "validate constraint discord_managed_resources_resource_key_check",
    );
    expect(source).not.toMatch(/\b(delete|truncate)\b/i);
  });
});
