// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260808140000_discord_community_interactions.sql",
  ),
  "utf8",
);

describe("Discord community interactions migration", () => {
  it("uses bounded fenced notification delivery without private payload storage", () => {
    expect(migration).toContain("discord_notification_deliveries");
    expect(migration).toContain("attempts between 0 and 5");
    expect(migration).toContain("lease_token uuid");
    expect(migration).toContain("source_key text not null unique");
    expect(migration).not.toMatch(/interaction_token|email|embed|raw_payload/i);
  });

  it("stores minimal replay and command rate-limit state with cleanup", () => {
    expect(migration).toContain("discord_interaction_claims");
    expect(migration).toContain("discord_command_rate_limits");
    expect(migration).toContain("expires_at");
    expect(migration).toContain("cleanup_discord_community_state()");
    expect(migration).toContain("discord_command_registry");
    expect(migration).not.toContain(
      "delete from alpha_exchange.discord_notification_deliveries",
    );
  });
});
