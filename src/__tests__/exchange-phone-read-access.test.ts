// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(), listings: vi.fn(), profile: vi.fn(), pulse: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentSessionUser: mocks.currentUser,
  getCurrentSessionUserForAuthorization: mocks.currentUser,
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getMarketplaceListings: mocks.listings,
  getPremiumSellerProfile: mocks.profile,
  getMarketplacePulse: mocks.pulse,
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));
import { GET as listings } from "@/app/api/alpha-exchange/listings/route";
import { GET as profile } from "@/app/api/alpha-exchange/sellers/[sellerId]/profile/route";
import { GET as pulse } from "@/app/api/alpha-exchange/marketplace-pulse/route";
import { requireApiAdmin, requireApiOwner } from "@/lib/api-auth";

const base = { id: "test-account", email: "ordinary@example.test", role: "buyer", roles: ["buyer"], emailVerified: true };
async function reads() {
  return Promise.all([listings(), profile(new Request("https://example.test"), { params: Promise.resolve({ sellerId: "seller-test" }) }), pulse()]);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "");
  vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "");
  mocks.currentUser.mockResolvedValue(base);
  mocks.listings.mockResolvedValue([]);
  mocks.profile.mockResolvedValue({ sellerId: "seller-test" });
  mocks.pulse.mockResolvedValue({ activeTrades: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe("exchange reads enforce canonical phone verification", () => {
  it.each(["buyer", "approved_seller", "pending_seller_approval", "admin", "owner"])("rejects an unverified %s before reading exchange data", async role => {
    mocks.currentUser.mockResolvedValue({ ...base, role, roles: [role] });
    for (const response of await reads()) {
      expect(response?.status).toBe(403);
      expect(await response?.json()).toMatchObject({ code: "PHONE_VERIFICATION_REQUIRED" });
    }
    expect(mocks.listings).not.toHaveBeenCalled();
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.pulse).not.toHaveBeenCalled();
  });
  it.each(["alphatradersai@gmail.com", "claudiahttps11@gmail.com", "jozenmark834@yahoo.com"])("allows only the explicitly exempt canonical email %s", async email => {
    mocks.currentUser.mockResolvedValue({ ...base, email });
    for (const response of await reads()) expect(response?.status).toBe(200);
  });
  it("allows a genuinely verified number", async () => {
    mocks.currentUser.mockResolvedValue({ ...base, verifiedPhone: "+972521234567", phoneVerifiedAt: "2026-10-02T20:00:00Z" });
    for (const response of await reads()) expect(response?.status).toBe(200);
  });
  it.each(["admin", "owner"])("also protects the %s authorization helper", async role => {
    mocks.currentUser.mockResolvedValue({ ...base, role, roles: [role] });
    const result = role === "owner" ? await requireApiOwner() : await requireApiAdmin();
    expect(result.user).toBeNull();
    expect(await result.unauthorized?.json()).toMatchObject({ code: "PHONE_VERIFICATION_REQUIRED" });
  });
  it("keeps the owner's canonical admin access without pretending their phone is verified", async () => {
    const owner = { ...base, email: "jozenmark834@yahoo.com", role: "owner", roles: ["owner"] };
    mocks.currentUser.mockResolvedValue(owner);
    expect((await requireApiOwner()).user).toEqual(owner);
    expect((await requireApiAdmin()).user).toEqual(owner);
  });
  it("keeps delivery testing possible while enforcement is off", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "false");
    for (const response of await reads()) expect(response?.status).toBe(200);
  });
});
