import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  consumeEmailVerificationToken: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  consumeEmailVerificationToken: mocks.consumeEmailVerificationToken,
}));

vi.mock("@/lib/supabase-auth-provider", () => ({
  createSupabaseAuthClient: vi.fn(() => ({
    auth: { verifyOtp: mocks.verifyOtp },
  })),
}));

import { POST } from "@/app/api/auth/verify-email/route";

describe("local legacy email verification route", () => {
  beforeEach(() => {
    mocks.checkSharedRateLimit.mockReset();
    mocks.consumeEmailVerificationToken.mockReset();
    mocks.verifyOtp.mockReset();
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.consumeEmailVerificationToken.mockResolvedValue({ status: "verified" });
    mocks.verifyOtp.mockResolvedValue({ error: null });
  });

  it("consumes a bounded local raw token without sending it to Supabase", async () => {
    const response = await POST(new NextRequest("http://localhost/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "a".repeat(64) }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.consumeEmailVerificationToken).toHaveBeenCalledWith("a".repeat(64));
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("keeps local tokens single-use at the route boundary", async () => {
    mocks.consumeEmailVerificationToken
      .mockResolvedValueOnce({ status: "verified" })
      .mockResolvedValueOnce({ status: "invalid" });
    const request = () => new NextRequest("http://localhost/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "b".repeat(64) }),
    });

    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(400);
  });

  it("returns an expiry error for expired local tokens", async () => {
    mocks.consumeEmailVerificationToken.mockResolvedValue({ status: "expired" });
    const response = await POST(new NextRequest("http://localhost/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "c".repeat(64) }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "This verification link has expired. Please request a new verification email." });
  });

  it("routes Supabase token hashes exclusively to Supabase", async () => {
    const response = await POST(new NextRequest("http://localhost/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenHash: "supabase-token-hash", type: "signup" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.consumeEmailVerificationToken).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "supabase-token-hash", type: "signup" });
  });
});
