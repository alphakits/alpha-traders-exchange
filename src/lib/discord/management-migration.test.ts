import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260808170000_discord_management_dashboard.sql",
  ),
  "utf8",
);

describe("Discord management migration", () => {
  it("enforces one bounded action, leases, fencing, idempotency, and retention", () => {
    expect(migration).toContain("action = 'reconcile_managed_integration'");
    expect(migration).toContain("idempotency_key uuid not null unique");
    expect(migration).toContain("lease_fence bigint");
    expect(migration).toContain("idx_discord_operator_one_active_action");
    expect(migration).toContain("attempts between 0 and 3");
    expect(migration).toContain("cleanup_discord_management_state");
    expect(migration).not.toMatch(/cooldown_reset|seller_role_override|delete_message/);
  });
});
