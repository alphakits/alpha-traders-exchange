// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DISCORD_COMMUNITY_COMMAND_NAMES,
} from "@/lib/discord/community-commands";
import {
  DISCORD_MANAGED_RESOURCE_KEYS,
} from "@/lib/discord/resource-manager";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260809070000_discord_onboarding_ux.sql",
  ),
  "utf8",
);

describe("Discord onboarding UX migration", () => {
  it("widens managed resource and command constraints", () => {
    for (const key of DISCORD_MANAGED_RESOURCE_KEYS) {
      expect(migration).toContain(`'${key}'`);
    }
    for (const command of DISCORD_COMMUNITY_COMMAND_NAMES) {
      expect(migration).toContain(`'${command}'`);
    }
    expect(migration).toContain("discord_interaction_claims_command_name_check");
    expect(migration).toContain("discord_command_rate_limits_command_name_check");
    expect(migration).toContain("discord_interaction_audit_command_name_check");
  });

  it("creates durable onboarding content persistence without destructive DDL", () => {
    expect(migration).toContain("create table if not exists alpha_exchange.discord_onboarding_content");
    expect(migration).toContain("content_hash");
    expect(migration).toContain("body_markdown text not null");
    expect(migration).toContain("insert into alpha_exchange.discord_onboarding_content");
    expect(migration).not.toMatch(/\b(delete|truncate)\b/i);
  });
});
