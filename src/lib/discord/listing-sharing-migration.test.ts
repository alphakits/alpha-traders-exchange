// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Discord listing sharing migration", () => {
  const source = readFileSync(
    resolve("supabase/migrations/20260808030000_discord_listing_sharing.sql"),
    "utf8",
  );

  it("enforces one current seller/listing mapping and a durable 12-hour claim", () => {
    expect(source).toContain("idx_discord_listing_one_current_per_seller");
    expect(source).toContain("idx_discord_listing_one_current_per_listing");
    expect(source).toContain("next_eligible_at = last_claimed_at + interval '12 hours'");
    expect(source).toContain("request_key text not null unique");
  });

  it("uses fenced versioned outbox claims with bounded failure metadata", () => {
    expect(source).toContain("event_version bigint not null");
    expect(source).toContain("lock_token uuid");
    expect(source).toContain("status in ('pending', 'processing', 'completed', 'dead')");
    expect(source).toContain("snapshot_hash");
    expect(source).toContain("last_error_code");
  });

  it("wires listing, seller, trust, and identity lifecycle triggers", () => {
    expect(source).toContain("enqueue_discord_listing_row_change");
    expect(source).toContain("enqueue_discord_listing_seller_change");
    expect(source).toContain("enqueue_discord_listing_trust_change");
    expect(source).toContain("enqueue_discord_listing_identity_revocation");
    expect(source).toContain("after insert or delete or update of status, expires_at, payload");
    expect(source).toContain("after insert or delete or update of payload");
  });
});
