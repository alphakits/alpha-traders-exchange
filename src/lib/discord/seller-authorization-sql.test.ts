import { describe, expect, it } from "vitest";
import { discordDesiredSellerStatusSql, ownerApprovedSellerSql } from "@/lib/discord/seller-authorization-sql";

describe("Discord seller authorization SQL", () => {
  it("requires the canonical owner approval status", () => {
    expect(ownerApprovedSellerSql("users.seller_status")).toBe("(users.seller_status = 'approved_seller')");
  });

  it("preserves pending and suspended status mappings and denies other statuses", () => {
    const sql = discordDesiredSellerStatusSql("users.seller_status");
    expect(sql).toContain("users.seller_status = 'approved_seller'");
    expect(sql).toContain("users.seller_status = 'pending_seller_approval' then 'pending'");
    expect(sql).toContain("users.seller_status = 'suspended' then 'suspended'");
    expect(sql).toContain("else 'none'");
    expect(sql).not.toContain("sellerApprovalVerification");
  });

  it("rejects dynamic SQL expressions", () => {
    expect(() => ownerApprovedSellerSql("users.seller_status); drop table users; --"))
      .toThrow("Unsafe seller-status SQL expression.");
  });
});
