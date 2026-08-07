// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Discord identity migration", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/20260807000000_discord_identity_sync.sql"),
    "utf8",
  );

  it("enforces durable unique mappings without OAuth token columns", () => {
    expect(sql).toContain("platform_user_id text primary key");
    expect(sql).toContain("discord_user_id text not null unique");
    expect(sql).not.toMatch(/access_token|refresh_token/i);
  });

  it("covers every seller transition through one transactional database trigger", () => {
    expect(sql).toContain("after update of seller_status");
    expect(sql).toContain("when 'approved_seller' then 'approved'");
    expect(sql).toContain("when 'pending_seller_approval' then 'pending'");
    expect(sql).toContain("when 'suspended' then 'suspended'");
    expect(sql).toContain("else 'none'");
    expect(sql).toContain("on conflict (dedupe_key) do nothing");
  });

  it("queues revocation before explicit unlink or cascading account deletion", () => {
    expect(sql).toContain("before delete on alpha_exchange.discord_identities");
    expect(sql).toContain("'identity_deleted'");
    expect(sql).toContain("'none'");
  });
});
