// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("verified seller Discord authorization migration", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/20260919130000_verified_seller_authorization.sql"),
    "utf8",
  );

  it("requires every recorded seller-verification control before approval", () => {
    expect(sql).toContain("manual_authorized_reviewer_v1");
    expect(sql).toContain("identityDocumentReviewed");
    expect(sql).toContain("liveIdentityVideoReviewed");
    expect(sql).toContain("contactOwnershipConfirmed");
    expect(sql).toContain("marketplaceRulesAccepted");
    expect(sql).toContain("verifiedByUserId");
  });

  it("makes legacy status-only calls fail closed and watches attestation changes", () => {
    expect(sql).toMatch(
      /discord_desired_seller_status\(value text\)[\s\S]*when 'pending_seller_approval' then 'pending'[\s\S]*else 'none'/,
    );
    expect(sql).toContain("after update of seller_status, payload");
    expect(sql).toContain("seller_verification_changed");
  });

  it("queues a one-time reconciliation for every existing Discord identity", () => {
    expect(sql).toContain("verification_policy_migration");
    expect(sql).toContain("verified-seller-authorization-v1:");
    expect(sql).toContain("on conflict (dedupe_key) do nothing");
  });
});
