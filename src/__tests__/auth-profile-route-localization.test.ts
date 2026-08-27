import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  updateAccountProfileData: vi.fn(),
  getAccountProfileData: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  updateAccountProfileData: mocks.updateAccountProfileData,
  getAccountProfileData: mocks.getAccountProfileData,
}));

import { PATCH } from "@/app/api/auth/profile/route";

function request(locale: "ar" | "en", body: unknown) {
  return new NextRequest("http://localhost/api/auth/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Locale": locale },
    body: JSON.stringify(body),
  });
}

describe("auth profile route localization", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "user-1", role: "buyer", roles: ["buyer"], sellerStatus: "buyer" },
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.updateAccountProfileData.mockResolvedValue({});
    mocks.getAccountProfileData.mockResolvedValue({ profile: {}, stats: {} });
  });

  it("never exposes provider errors in Arabic or English", async () => {
    mocks.updateAccountProfileData.mockRejectedValue(new Error("private database connection details"));

    for (const locale of ["ar", "en"] as const) {
      const response = await PATCH(request(locale, { fullName: "Alpha User" }));
      const payload = await response.json() as { code?: string; error?: string };
      expect(response.status).toBe(400);
      expect(payload.code).toBe("PROFILE_UPDATE_FAILED");
      expect(JSON.stringify(payload)).not.toContain("private database connection details");
      expect(payload.error).toMatch(locale === "ar" ? /تعذر/ : /Failed/);
    }
  });

  it("localizes validation and rate-limit responses", async () => {
    const invalidResponse = await PATCH(request("ar", { fullName: "" }));
    expect(await invalidResponse.json()).toEqual({ code: "FULL_NAME_REQUIRED", error: "الاسم الكامل مطلوب." });

    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const limitedResponse = await PATCH(request("en", { fullName: "Alpha User" }));
    expect(limitedResponse.status).toBe(429);
    expect(await limitedResponse.json()).toEqual({
      code: "PROFILE_RATE_LIMITED",
      error: "Too many profile update requests. Please wait and try again.",
    });
  });
});
