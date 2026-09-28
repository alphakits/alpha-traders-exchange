import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ALPHA_EXCHANGE_OWNER_EMAIL } from "@/lib/alpha-exchange-identity";

// Mock @/lib/auth before importing api-auth so the module uses our stub
vi.mock("@/lib/auth", () => ({
  getCurrentSessionUserForAuthorization: vi.fn(),
  getCurrentSessionToken: vi.fn().mockResolvedValue(null),
  clearUserSession: vi.fn().mockResolvedValue(undefined),
  AUTH_COOKIE_NAME: "alpha_exchange_session",
  AUTH_VERIFIED_COOKIE_NAME: "alpha_exchange_verified",
  AUTH_PHONE_VERIFIED_COOKIE_NAME: "alpha_exchange_phone_verified",
}));

import { requireApiUser, requireApiAdmin, requireApiSeller, requireApiSellerWorkspaceActor, requireEmailVerificationForTrading, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { clearUserSession, getCurrentSessionToken, getCurrentSessionUserForAuthorization } from "@/lib/auth";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";

const mockGetCurrentSessionUser = vi.mocked(getCurrentSessionUserForAuthorization);
const mockGetCurrentSessionToken = vi.mocked(getCurrentSessionToken);
const mockClearUserSession = vi.mocked(clearUserSession);
const originalBypassEnv = process.env.PHOTO_VERIFICATION_BYPASS_EMAILS;

function makeUser(overrides: Partial<{ role: string; email: string; emailVerified: boolean; disabled: boolean }> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    role: "buyer",
    emailVerified: true,
    ...overrides,
  };
}

beforeEach(() => {
  mockGetCurrentSessionUser.mockReset();
  mockGetCurrentSessionToken.mockReset().mockResolvedValue(null);
  mockClearUserSession.mockReset().mockResolvedValue(undefined);
  process.env.PHOTO_VERIFICATION_BYPASS_EMAILS = originalBypassEnv;
});

describe("requireEmailVerificationForTrading", () => {
  it("allows a verified-email Buyer even without a verified phone", () => {
    expect(requireEmailVerificationForTrading({
      id: "buyer-1",
      role: "buyer",
      emailVerified: true,
    })).toBeNull();
  });

  it("denies an explicitly unverified email without any flag bypass", async () => {
    process.env.PHOTO_VERIFICATION_BYPASS_EMAILS = "user@example.com";
    const denied = requireEmailVerificationForTrading({
      id: "buyer-1",
      role: "buyer",
      emailVerified: false,
    });
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  });

  it("fails closed when a legacy session user has no email-verification marker", async () => {
    const denied = requireEmailVerificationForTrading({
      id: "buyer-legacy",
      role: "buyer",
    });
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.env.PHOTO_VERIFICATION_BYPASS_EMAILS = originalBypassEnv;
});

describe("requireApiUser", () => {
  it("denies actions with a retryable 503 and preserves the session during a database timeout", async () => {
    mockGetCurrentSessionUser.mockRejectedValue(new Error("Query read timeout"));
    mockGetCurrentSessionToken.mockResolvedValue("existing-session-token");
    const { user, unauthorized } = await requireApiUser();
    expect(user).toBeNull();
    expect(unauthorized?.status).toBe(503);
    expect(await unauthorized?.json()).toMatchObject({ code: "SESSION_TEMPORARILY_UNAVAILABLE" });
    expect(unauthorized?.headers.get("Retry-After")).toBe("3");
    expect(unauthorized?.headers.get("Set-Cookie")).toBeNull();
    expect(mockClearUserSession).not.toHaveBeenCalled();
  });

  it("returns 401 when no session user", async () => {
    mockGetCurrentSessionUser.mockResolvedValue(null);
    const { user, unauthorized } = await requireApiUser();
    expect(user).toBeNull();
    expect(unauthorized?.status).toBe(401);
  });

  it("returns the user when session is valid", async () => {
    const u = makeUser();
    mockGetCurrentSessionUser.mockResolvedValue(u as never);
    const { user, unauthorized } = await requireApiUser();
    expect(user).toEqual(u);
    expect(unauthorized).toBeNull();
  });

  it("rejects a disabled account and revokes its existing session", async () => {
    mockGetCurrentSessionUser.mockResolvedValue(makeUser({ disabled: true }) as never);
    mockGetCurrentSessionToken.mockResolvedValue("disabled-session-token");

    const { user, unauthorized } = await requireApiUser();

    expect(user).toBeNull();
    expect(unauthorized?.status).toBe(403);
    await expect(unauthorized?.json()).resolves.toMatchObject({ code: "ACCOUNT_DISABLED" });
    expect(mockClearUserSession).toHaveBeenCalledWith("disabled-session-token");
  });
});

describe("requireApiAdmin", () => {
  it("returns 403 when user has role buyer", async () => {
    mockGetCurrentSessionUser.mockResolvedValue(makeUser({ role: "buyer" }) as never);
    const { user, unauthorized } = await requireApiAdmin();
    expect(user).toBeNull();
    expect(unauthorized?.status).toBe(403);
  });

  it("returns user when role is admin regardless of owner email", async () => {
    mockGetCurrentSessionUser.mockResolvedValue(
      makeUser({ role: "admin", email: "notowner@example.com" }) as never
    );
    const { user, unauthorized } = await requireApiAdmin();
    expect(user).toEqual(makeUser({ role: "admin", email: "notowner@example.com" }));
    expect(unauthorized).toBeNull();
  });

  it("returns user when role is admin AND email matches owner", async () => {
    const u = makeUser({ role: "admin", email: ALPHA_EXCHANGE_OWNER_EMAIL });
    mockGetCurrentSessionUser.mockResolvedValue(u as never);
    const { user, unauthorized } = await requireApiAdmin();
    expect(user).toEqual(u);
    expect(unauthorized).toBeNull();
  });

  it.each([{ roles: ["owner"] }, { roles: ["owner", "admin"] }])("returns an owner with roles $roles", async ({ roles }) => {
    const u = {
      ...makeUser({ role: "owner", email: ALPHA_EXCHANGE_OWNER_EMAIL }),
      roles,
    };
    mockGetCurrentSessionUser.mockResolvedValue(u as never);
    const { user, unauthorized } = await requireApiAdmin();
    expect(user).toEqual(u);
    expect(unauthorized).toBeNull();
  });
});

describe("requireApiSellerWorkspaceActor", () => {
  it("rejects a stale seller session whose email is not verified", async () => {
    mockGetCurrentSessionUser.mockResolvedValue({
      ...makeUser({ role: "approved_seller", emailVerified: false }),
      roles: ["approved_seller"],
      sellerStatus: "approved_seller",
    } as never);

    const { user, unauthorized } = await requireApiSellerWorkspaceActor();

    expect(user).toBeNull();
    expect(unauthorized?.status).toBe(403);
    await expect(unauthorized?.json()).resolves.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  });

  it("allows an email-verified seller without requiring a phone", async () => {
    const seller = {
      ...makeUser({ role: "approved_seller", emailVerified: true }),
      roles: ["approved_seller"],
      sellerStatus: "approved_seller",
    };
    mockGetCurrentSessionUser.mockResolvedValue(seller as never);

    const { user, unauthorized } = await requireApiSellerWorkspaceActor();

    expect(user).toEqual(seller);
    expect(unauthorized).toBeNull();
  });
});

describe("requireApiSeller", () => {
  it("allows an owner-approved seller without an additional identity record", async () => {
    mockGetCurrentSessionUser.mockResolvedValue({
      ...makeUser({ role: "approved_seller" }),
      roles: ["approved_seller"],
      sellerStatus: "approved_seller",
    } as never);

    const { user, unauthorized } = await requireApiSeller();

    expect(user?.sellerStatus).toBe("approved_seller");
    expect(unauthorized).toBeNull();
  });

  it("allows an Approved Seller with the complete recorded attestation", async () => {
    const seller = {
      ...makeUser({ role: "approved_seller" }),
      roles: ["approved_seller"],
      sellerStatus: "approved_seller",
      sellerApprovalVerification: createTestSellerApprovalVerification(),
    };
    mockGetCurrentSessionUser.mockResolvedValue(seller as never);

    const { user, unauthorized } = await requireApiSeller();

    expect(user).toEqual(seller);
    expect(unauthorized).toBeNull();
  });
  it.each(["buyer", "pending_seller_approval", "rejected", "suspended"])("denies a %s seller despite stale roles and historical proof", async (sellerStatus) => {
    mockGetCurrentSessionUser.mockResolvedValue({
      ...makeUser({ role: "approved_seller" }),
      roles: ["approved_seller"],
      sellerStatus,
      sellerApprovalVerification: createTestSellerApprovalVerification(),
    } as never);
    const { user, unauthorized } = await requireApiSeller();
    expect(user).toBeNull();
    expect(unauthorized?.status).toBe(403);
  });

});

describe("requirePhoneVerificationForTrading", () => {
  it("allows configured bypass email even without verified phone", () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    process.env.PHOTO_VERIFICATION_BYPASS_EMAILS = "jozemark@gmail.com";
    const denied = requirePhoneVerificationForTrading({
      id: "user-1",
      role: "buyer",
      email: "jozemark@gmail.com",
      verifiedPhone: "",
      phoneVerifiedAt: "",
    });
    expect(denied).toBeNull();
  });

  it("still denies non-whitelisted accounts without verified phone", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    process.env.PHOTO_VERIFICATION_BYPASS_EMAILS = "jozemark@gmail.com";
    const denied = requirePhoneVerificationForTrading({
      id: "user-2",
      role: "buyer",
      email: "other@example.com",
      verifiedPhone: "",
      phoneVerifiedAt: "",
    });
    expect(denied).not.toBeNull();
    expect(denied?.status).toBe(403);
  });
});
