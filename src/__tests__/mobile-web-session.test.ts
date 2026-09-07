// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import {
  ALPHA_TRADERS_WEB_ORIGIN,
  trustedWebsiteResumeUrl,
  trustedWebsiteReturnPath,
  websiteNavigationDecision,
} from "../../apps/mobile/src/web/website-navigation";
import { resolveMobileWebSessionDestination } from "@/lib/mobile-web-session";

const mocks = vi.hoisted(() => ({
  createUserSession: vi.fn(),
  requireMobileApiUser: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "alpha_exchange_session",
  AUTH_PHONE_VERIFIED_COOKIE_NAME: "alpha_exchange_phone_verified",
  AUTH_VERIFIED_COOKIE_NAME: "alpha_exchange_verified",
  createUserSession: mocks.createUserSession,
}));

vi.mock("@/lib/auth-cookie", () => ({
  shouldUseSecureAuthCookie: () => true,
}));

vi.mock("@/lib/mobile-api-auth", () => ({
  requireMobileApiUser: mocks.requireMobileApiUser,
}));

vi.mock("@/lib/phone-verification", () => ({
  isMarketplacePhoneVerificationDisabled: () => false,
}));

vi.mock("@/lib/verification-bypass", () => ({
  isVerified: () => true,
}));

vi.mock("@/lib/structured-logging", () => ({
  logEvent: mocks.logEvent,
}));

import { GET as createWebSession } from "@/app/api/mobile/v1/auth/web-session/route";

const user = {
  id: "user-1",
  fullName: "Alpha User",
  email: "alpha@example.test",
  role: "buyer",
  roles: ["buyer"],
  emailVerified: true,
  verifiedPhone: "+972500000000",
  phoneVerifiedAt: "2026-09-07T00:00:00.000Z",
} as AlphaExchangeUser;

function nativeRequest(returnTo = "/en/profile") {
  return new NextRequest(
    `https://www.alphatraders.co.il/api/mobile/v1/auth/web-session?locale=en&returnTo=${encodeURIComponent(returnTo)}`,
    {
      headers: {
        authorization: `Bearer atr_at_v1.${"a".repeat(44)}`,
        "accept-language": "en",
        "x-app-version": "1.0.0",
        "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
        "x-platform": "ios",
      },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createUserSession.mockResolvedValue({
    token: "web-session-token",
    expiresAt: "2026-09-21T00:00:00.000Z",
  });
  mocks.requireMobileApiUser.mockResolvedValue({
    user,
    accessToken: `atr_at_v1.${"a".repeat(44)}`,
    unauthorized: null,
  });
});

describe("website-backed mobile shell", () => {
  it("keeps first-party and Discord authentication inside while opening other sites externally", () => {
    expect(websiteNavigationDecision(`${ALPHA_TRADERS_WEB_ORIGIN}/en/profile`)).toBe("allow");
    expect(websiteNavigationDecision("https://discord.com/oauth2/authorize?client_id=1")).toBe("allow");
    expect(websiteNavigationDecision("https://example.com/article")).toBe("external");
    expect(websiteNavigationDecision("mailto:support@alphatraders.co.il")).toBe("external");
    expect(websiteNavigationDecision("javascript:alert(1)")).toBe("block");
    expect(websiteNavigationDecision("http://www.alphatraders.co.il/en")).toBe("block");
  });

  it("resumes only a localized first-party website URL", () => {
    expect(trustedWebsiteResumeUrl("/en/profile?tab=trades#history", "ar")).toBe(
      `${ALPHA_TRADERS_WEB_ORIGIN}/en/profile?tab=trades#history`,
    );
    expect(trustedWebsiteReturnPath(`${ALPHA_TRADERS_WEB_ORIGIN}/ar/usdt-exchange`)).toBe(
      "/ar/usdt-exchange",
    );
    expect(trustedWebsiteResumeUrl("https://example.com/phishing", "en")).toBe(
      `${ALPHA_TRADERS_WEB_ORIGIN}/en`,
    );
  });

  it("rejects cross-origin and cross-locale handoff redirects", () => {
    expect(resolveMobileWebSessionDestination("en", "/en/profile")).toBe("/en/profile");
    expect(resolveMobileWebSessionDestination("en", "/ar/profile")).toBe("/en");
    expect(resolveMobileWebSessionDestination("en", "https://example.com/phishing")).toBe("/en");
  });

  it("converts a valid native session into the website cookie session and redirects", async () => {
    const response = await createWebSession(nativeRequest());
    const cookies = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://www.alphatraders.co.il/en/profile");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(cookies).toContain("alpha_exchange_session=web-session-token");
    expect(cookies).toContain("alpha_exchange_verified=1");
    expect(cookies).toContain("alpha_exchange_phone_verified=1");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("Secure");
    expect(mocks.createUserSession).toHaveBeenCalledWith(user.id, 14);
  });

  it("falls back to the website login when the legacy native session is unavailable", async () => {
    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: null,
      accessToken: null,
      unauthorized: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    });

    const response = await createWebSession(nativeRequest());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://www.alphatraders.co.il/en/login");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
