import { describe, it, expect, vi, beforeEach } from "vitest";
import { ALPHA_EXCHANGE_OWNER_EMAIL } from "@/lib/alpha-exchange-identity";

// Mock @/lib/auth before importing api-auth so the module uses our stub
vi.mock("@/lib/auth", () => ({
  getCurrentSessionUser: vi.fn(),
  getCurrentSessionToken: vi.fn().mockResolvedValue(null),
  clearUserSession: vi.fn().mockResolvedValue(undefined),
  AUTH_COOKIE_NAME: "alpha_exchange_session",
  AUTH_VERIFIED_COOKIE_NAME: "alpha_exchange_verified",
}));

import { requireApiUser, requireApiAdmin } from "@/lib/api-auth";
import { getCurrentSessionUser } from "@/lib/auth";

const mockGetCurrentSessionUser = vi.mocked(getCurrentSessionUser);

function makeUser(overrides: Partial<{ role: string; email: string }> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    role: "buyer",
    ...overrides,
  };
}

beforeEach(() => {
  mockGetCurrentSessionUser.mockReset();
});

describe("requireApiUser", () => {
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
});
