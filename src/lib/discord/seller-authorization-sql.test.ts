import { describe, expect, it } from "vitest";

import {
  discordDesiredSellerStatusSql,
  sellerApprovalVerificationSql,
} from "@/lib/discord/seller-authorization-sql";

describe("Discord seller authorization SQL", () => {
  it("contains the complete attestation and timestamp requirements", () => {
    const sql = sellerApprovalVerificationSql("users.payload");
    expect(sql).toContain("manual_authorized_reviewer_v1");
    expect(sql).toContain("identityDocumentReviewed");
    expect(sql).toContain("liveIdentityVideoReviewed");
    expect(sql).toContain("contactOwnershipConfirmed");
    expect(sql).toContain("marketplaceRulesAccepted");
    expect(sql).toContain("verifiedByUserId");
    expect(sql).toContain("[0-9]{4}");
  });

  it("makes approval conditional on both status and attestation", () => {
    const sql = discordDesiredSellerStatusSql("users.seller_status", "users.payload");
    expect(sql).toContain("users.seller_status = 'approved_seller'");
    expect(sql).toContain("sellerApprovalVerification");
    expect(sql).toContain("else 'none'");
  });

  it("rejects dynamic SQL expressions", () => {
    expect(() => sellerApprovalVerificationSql("users.payload); drop table users; --"))
      .toThrow("Unsafe seller verification SQL payload expression.");
  });
});
