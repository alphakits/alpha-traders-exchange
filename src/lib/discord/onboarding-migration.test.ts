// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Discord onboarding migration", () => {
  it("widens resources and all command constraints before seeding content", () => {
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260809070000_discord_onboarding_ux.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("discord_managed_resources_resource_key_check");
    expect(sql).toContain("discord_interaction_claims_command_name_check");
    expect(sql).toContain("discord_command_rate_limits_command_name_check");
    expect(sql).toContain("discord_interaction_audit_command_name_check");
    expect(sql).toContain("create table if not exists alpha_exchange.discord_onboarding_content");
    for (const command of ["buy", "seller", "rank", "rules", "support", "exchange"]) {
      expect(sql).toContain(`'${command}'`);
    }
  });
});
