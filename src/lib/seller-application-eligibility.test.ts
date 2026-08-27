import { describe, expect, it } from "vitest";
import { getSellerApplicationEligibility } from "./seller-application-eligibility";

const buyer = { role: "buyer" as const, roles: ["buyer" as const], sellerStatus: "buyer" as const };
const nonBuyer = { role: "student" as const, roles: ["student" as const], sellerStatus: "rejected" as const };

describe("seller application eligibility", () => {
  it("keeps a stale non-buyer bootstrap in loading until canonical state resolves", () => {
    expect(getSellerApplicationEligibility({ isCanonicalUserLoading: true, canonicalUserError: false, canonicalUser: nonBuyer, application: null, applicationSubmitted: false })).toBe("loading");
  });
  it("allows an unverified canonical buyer", () => {
    expect(getSellerApplicationEligibility({ isCanonicalUserLoading: false, canonicalUserError: false, canonicalUser: buyer, application: null, applicationSubmitted: false })).toBe("application_available");
  });
  it("requires setup only for a confirmed canonical non-buyer", () => {
    expect(getSellerApplicationEligibility({ isCanonicalUserLoading: false, canonicalUserError: false, canonicalUser: nonBuyer, application: null, applicationSubmitted: false })).toBe("buyer_setup_required");
  });
  it("fails closed when canonical refresh fails", () => {
    expect(getSellerApplicationEligibility({ isCanonicalUserLoading: false, canonicalUserError: true, canonicalUser: buyer, application: null, applicationSubmitted: false })).toBe("retry");
  });
  it("keeps pending canonical buyers out of duplicate submission", () => {
    expect(getSellerApplicationEligibility({ isCanonicalUserLoading: false, canonicalUserError: false, canonicalUser: buyer, application: { status: "pending" }, applicationSubmitted: false })).toBe("application_pending");
  });
  it("preserves the approved seller state", () => {
    expect(getSellerApplicationEligibility({ isCanonicalUserLoading: false, canonicalUserError: false, canonicalUser: { role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller" }, application: null, applicationSubmitted: false })).toBe("approved_seller");
  });
});
