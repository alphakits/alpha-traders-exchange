import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  updateUserPreferredLocale: vi.fn(),
  checkSharedRateLimit: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/alpha-exchange-store", () => ({ updateUserPreferredLocale: mocks.updateUserPreferredLocale }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));

import { PATCH } from "@/app/api/auth/preferred-locale/route";

function request(preferredLocale: unknown) {
  return new NextRequest("http://localhost/api/auth/preferred-locale", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferredLocale }),
  });
}

describe("PATCH /api/auth/preferred-locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ user: { id: "user-1" }, unauthorized: null });
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, reason: null });
    mocks.updateUserPreferredLocale.mockImplementation(async ({ preferredLocale }) => ({ preferredLocale }));
  });

  it("requires an authenticated user", async () => {
    mocks.requireApiUser.mockResolvedValue({
      user: null,
      unauthorized: NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 }),
    });
    const response = await PATCH(request("ar"));
    expect(response.status).toBe(401);
    expect(mocks.updateUserPreferredLocale).not.toHaveBeenCalled();
  });

  it.each(["ar", "en"] as const)("persists the explicit %s interface locale", async (preferredLocale) => {
    const response = await PATCH(request(preferredLocale));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preferredLocale });
    expect(mocks.updateUserPreferredLocale).toHaveBeenCalledWith({ userId: "user-1", preferredLocale });
  });

  it("rejects unsupported or inferred locale values", async () => {
    const response = await PATCH(request("he"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "INVALID_PREFERRED_LOCALE" });
    expect(mocks.updateUserPreferredLocale).not.toHaveBeenCalled();
  });
});
