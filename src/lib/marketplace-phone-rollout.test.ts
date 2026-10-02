import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketplacePhoneVerificationDestination, isMarketplacePhoneVerificationRequired } from "@/lib/phone-verification";
import { requireMarketplaceVerificationForTrading } from "@/lib/api-auth";

const base = { id: "buyer-test", role: "buyer", roles: ["buyer"], emailVerified: true };
const verified = { verifiedPhone: "+972521234567", phoneVerifiedAt: "2026-10-01T12:00:00.000Z" };

beforeEach(() => {
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "");
  vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("reviewed SMS requirement rollout", () => {
  it("allows delivery testing before enforcing the requirement", () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "false");
    expect(isMarketplacePhoneVerificationRequired()).toBe(false);
    expect(requireMarketplaceVerificationForTrading(base)).toBeNull();
    expect(marketplacePhoneVerificationDestination(base, "/en/usdt-exchange", "en")).toBeNull();
  });
  it.each(["", "1", "yes", "false"])("does not activate enforcement for %j", flag => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", flag);
    expect(isMarketplacePhoneVerificationRequired()).toBe(false);
  });
  it.each(["buyer", "approved_seller", "pending_seller_approval"])("requires a real phone verification for %s", async role => {
    const blocked = requireMarketplaceVerificationForTrading({ ...base, role, roles: [role] });
    expect(blocked?.status).toBe(403);
    expect(await blocked?.json()).toMatchObject({ code: "PHONE_VERIFICATION_REQUIRED" });
    expect(requireMarketplaceVerificationForTrading({ ...base, role, roles: [role], ...verified })).toBeNull();
  });
  it.each([{}, { verifiedPhone: "0521234567", phoneVerifiedAt: verified.phoneVerifiedAt }, { verifiedPhone: verified.verifiedPhone, phoneVerifiedAt: "bad-date" }, { verifiedPhone: verified.verifiedPhone }])("rejects incomplete or malformed stored verification %j", data => {
    expect(requireMarketplaceVerificationForTrading({ ...base, ...data })?.status).toBe(403);
  });
  it("still requires email when the phone is verified", async () => {
    const blocked = requireMarketplaceVerificationForTrading({ ...base, ...verified, emailVerified: false });
    expect(await blocked?.json()).toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  });
  it.each(["owner", "admin"])("does not exempt an unlisted %s account", role => {
    expect(requireMarketplaceVerificationForTrading({ ...base, role, roles: [role] })?.status).toBe(403);
    expect(marketplacePhoneVerificationDestination({ ...base, role, roles: [role] }, "/en/dashboard/seller", "en")).toContain("/en/verify-account");
  });
  it.each(["Alphatradersai@gmail.com", " Claudiahttps11@gmail.com ", "Jozenmark834@yahoo.com"])("exempts only the canonical approved account %s without fabricating verification", email => {
    const account = { ...base, email };
    expect(requireMarketplaceVerificationForTrading(account)).toBeNull();
    expect(marketplacePhoneVerificationDestination(account, "/en/dashboard/seller", "en")).toBeNull();
    expect(account).not.toHaveProperty("verifiedPhone");
  });
  it.each(["alphatradersai@gmail.com.example", "other+jozenmark834@yahoo.com", "claudiahttps11+alias@gmail.com", ""])("does not exempt a lookalike account %j", email => {
    expect(requireMarketplaceVerificationForTrading({ ...base, email })?.status).toBe(403);
  });
  it("redirects existing participants and keeps their intended destination", () => {
    expect(marketplacePhoneVerificationDestination(base, "/ar/trade-room/request-test?view=chat", "ar"))
      .toBe("/ar/verify-account?redirectTo=%2Far%2Ftrade-room%2Frequest-test%3Fview%3Dchat");
    expect(marketplacePhoneVerificationDestination(base, "/en", "en")).toContain("/en/verify-account");
  });
  it.each(["verify-account", "verify-email", "reset-password", "support", "account-deletion", "privacy-policy"])("keeps %s reachable without a redirect loop", page => {
    expect(marketplacePhoneVerificationDestination(base, `/en/${page}`, "en")).toBeNull();
  });
  it("keeps a student outside exchange pages unaffected", () => {
    const student = { ...base, role: "student", roles: ["student"], sellerStatus: "buyer" };
    expect(marketplacePhoneVerificationDestination(student, "/en/academy", "en")).toBeNull();
    expect(marketplacePhoneVerificationDestination(student, "/en/usdt-exchange", "en")).toContain("/en/verify-account");
  });
});
