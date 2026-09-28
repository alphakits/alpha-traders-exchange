// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260808100000_discord_market_intelligence.sql",
  ),
  "utf8",
);

describe("Discord market intelligence migration", () => {
  it("enforces fixed singleton keys, channels, fencing, bounded retries, and ownership", () => {
    expect(migration).toContain("content_key text primary key");
    expect(migration).toContain("'live_market_pulse'");
    expect(migration).toContain("'market_activity_digest'");
    expect(migration).toContain("'weekly_top_sellers'");
    expect(migration).toContain("lease_fence bigint not null");
    expect(migration).toContain("attempts between 0 and 8");
    expect(migration).toContain("unique (channel_id, message_id)");
    expect(migration).toContain("channel_resource_key = 'market_activity'");
  });

  it("coalesces authoritative lifecycle changes without an append-only event feed", () => {
    expect(migration).toContain("schedule_discord_market_content()");
    expect(migration).toContain("least(refresh_after, now() + interval '30 seconds')");
    expect(migration).toContain(
      "refresh_after > now() + interval '30 seconds'",
    );
    expect(migration).toContain("for each statement execute function");
  });
});
