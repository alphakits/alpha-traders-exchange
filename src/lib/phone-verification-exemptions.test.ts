import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAccountPhoneVerificationExempt } from "@/lib/phone-verification-exemptions";
import { hasVerifiedPhone, isVerified } from "@/lib/verification-bypass";
import { toClientSessionUser } from "@/lib/client-session-user";
import { requireMarketplaceVerificationForTrading } from "@/lib/api-auth";
import { marketplacePhoneVerificationDestination } from "@/lib/phone-verification";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

const accounts = [
  { id: "user-030c4619-e1a6-4147-9d91-a8bbd2e2db4a", email: "alphatradersai@gmail.com", role: "buyer" },
  { id: "user-6f3a0120-5d36-423f-8dee-9a875e8e064e", email: "claudiahttps11@gmail.com", role: "approved_seller" },
  { id: "user-cfa3bd2c-25e7-4a9e-9ae5-55ac4900846f", email: "jozenmark834@yahoo.com", role: "owner" },
];
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "other@example.test");
});
afterEach(() => vi.unstubAllEnvs());

describe("owner-authorized existing account exceptions", () => {
  it.each(accounts)("permits $email without inventing verified phone data", account => {
    const user = { ...account, roles: [account.role], sellerStatus: "buyer", emailVerified: true };
    expect(isAccountPhoneVerificationExempt(user)).toBe(true);
    expect(isVerified(user)).toBe(true);
    expect(hasVerifiedPhone(user)).toBe(false);
    expect(requireMarketplaceVerificationForTrading(user)).toBeNull();
    for (const path of ["/en/usdt-exchange", "/en/dashboard/seller", "/ar/trade-room/fixture"]) {
      expect(marketplacePhoneVerificationDestination(user, path, "en")).toBeNull();
    }
    const client = toClientSessionUser(user as AlphaExchangeUser);
    expect(client).toMatchObject({ isPhotoVerified: true, phoneVerificationExempt: true });
    expect(user).not.toHaveProperty("verifiedPhone");
    expect(client).not.toHaveProperty("verifiedPhone");
    expect(client).not.toHaveProperty("phoneVerifiedAt");
  });
  it.each(accounts)("requires both immutable ID and canonical email for $email", account => {
    expect(isAccountPhoneVerificationExempt({ ...account, email: ` ${account.email.toUpperCase()} ` })).toBe(true);
    expect(isAccountPhoneVerificationExempt({ ...account, id: "recreated-user" })).toBe(false);
    expect(isAccountPhoneVerificationExempt({ ...account, email: "other@example.test" })).toBe(false);
    expect(isAccountPhoneVerificationExempt({ ...account, disabled: true })).toBe(false);
  });
  it.each(accounts)("still requires email verification for $email", async account => {
    const response = requireMarketplaceVerificationForTrading({ ...account, emailVerified: false });
    expect(await response?.json()).toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  });
  it.each(["buyer", "approved_seller", "admin", "owner"])("does not grant an exception from role %s or a forged field", role => {
    const user = { id: "ordinary", email: "other@example.test", role, emailVerified: true, phoneVerificationExempt: true };
    expect(isVerified(user)).toBe(false);
    expect(requireMarketplaceVerificationForTrading(user)?.status).toBe(403);
  });
});


describe("public phone verification evidence", () => {
  it("requires both a valid number and verification timestamp", () => {
    const verified = { verifiedPhone: "+972501234567", phoneVerifiedAt: "2026-10-04T11:15:02.788Z" };
    expect(hasVerifiedPhone(verified)).toBe(true);
    expect(hasVerifiedPhone({ ...verified, disabled: true })).toBe(false);
    expect(hasVerifiedPhone({ ...verified, verifiedPhone: "0501234567" })).toBe(false);
    expect(hasVerifiedPhone({ ...verified, verifiedPhone: undefined })).toBe(false);
    expect(hasVerifiedPhone({ ...verified, phoneVerifiedAt: undefined })).toBe(false);
    expect(hasVerifiedPhone({ ...verified, phoneVerifiedAt: "invalid" })).toBe(false);
  });
});
