import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findUserById: vi.fn() }));
vi.mock("@/lib/alpha-exchange-store", () => ({ findUserById: mocks.findUserById }));
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
const user = { id: "buyer-test", role: "buyer", roles: ["buyer"], emailVerified: true };
const metadata = { appVersion: "999.0.0", buildNumber: "999", platform: "ios" as const, deviceId: "device-test", locale: "en" as const };
const service = { validateAccessToken: vi.fn(), revokeDevice: vi.fn() };
beforeEach(() => {
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "");
  vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "");
  mocks.findUserById.mockReset().mockResolvedValue(user);
  service.validateAccessToken.mockReset().mockResolvedValue({ status: "valid", session: { userId: user.id } });
  service.revokeDevice.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
function request(path: string) { return new NextRequest(`https://example.test/api/mobile/v1/${path}`, { headers: { Authorization: "Bearer test-access-token" } }); }

describe("mobile routes cannot bypass the SMS requirement", () => {
  it.each(["marketplace/listings", "trades", "seller/listings", "admin/overview"])("blocks %s while preserving the authenticated device session", async path => {
    const result = await requireMobileApiUser(request(path), "request-test", metadata, service as never);
    expect(result.unauthorized?.status).toBe(403);
    expect(await result.unauthorized?.json()).toMatchObject({ error: { code: "PHONE_VERIFICATION_REQUIRED" } });
    expect(service.revokeDevice).not.toHaveBeenCalled();
  });
  it.each(["settings/phone/send-code", "settings/phone/verify-code", "auth/me", "auth/logout"])("keeps %s accessible for verification and recovery", async path => {
    const result = await requireMobileApiUser(request(path), "request-test", metadata, service as never);
    expect(result.user).toMatchObject({ id: user.id });
    expect(result.unauthorized).toBeNull();
  });
  it("allows a canonically verified buyer", async () => {
    mocks.findUserById.mockResolvedValue({ ...user, verifiedPhone: "+972521234567", phoneVerifiedAt: "2026-10-01T12:00:00.000Z" });
    const result = await requireMobileApiUser(request("trades"), "request-test", metadata, service as never);
    expect(result.unauthorized).toBeNull();
  });
  it.each([
    ["user-030c4619-e1a6-4147-9d91-a8bbd2e2db4a", "alphatradersai@gmail.com"],
    ["user-6f3a0120-5d36-423f-8dee-9a875e8e064e", "claudiahttps11@gmail.com"],
    ["user-cfa3bd2c-25e7-4a9e-9ae5-55ac4900846f", "jozenmark834@yahoo.com"],
  ])("allows the exact authorized native account %s", async (id, email) => {
    mocks.findUserById.mockResolvedValue({ ...user, id, email });
    service.validateAccessToken.mockResolvedValue({ status: "valid", session: { userId: id } });
    for (const path of ["marketplace/listings", "trades", "seller/listings", "admin/overview"]) {
      const result = await requireMobileApiUser(request(path), "request-test", metadata, service as never);
      expect(result.unauthorized).toBeNull();
      expect(result.user?.id).toBe(id);
    }
    expect(service.revokeDevice).not.toHaveBeenCalled();
  });
  it.each(["alphatradersai@gmail.com", "claudiahttps11@gmail.com", "jozenmark834@yahoo.com"])("blocks the same email with an unauthorized ID %s", async email => {
    mocks.findUserById.mockResolvedValue({ ...user, email });
    const result = await requireMobileApiUser(request("trades"), "request-test", metadata, service as never);
    expect(result.unauthorized?.status).toBe(403);
  });
  it.each(["admin", "owner", "approved_seller"])("does not let a %s role bypass phone verification", async role => {
    mocks.findUserById.mockResolvedValue({ ...user, role, roles: [role] });
    const result = await requireMobileApiUser(request("trades"), "request-test", metadata, service as never);
    expect(result.unauthorized?.status).toBe(403);
  });
});
