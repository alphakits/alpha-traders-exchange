import { describe, it, expect, afterEach, vi } from "vitest";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";
import { NextRequest } from "next/server";

function makeRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shouldUseSecureAuthCookie", () => {
  it("returns false when x-forwarded-proto is http", () => {
    const req = makeRequest("http://example.com/", { "x-forwarded-proto": "http" });
    expect(shouldUseSecureAuthCookie(req)).toBe(false);
  });

  it("returns true when x-forwarded-proto is https", () => {
    const req = makeRequest("http://example.com/", { "x-forwarded-proto": "https" });
    expect(shouldUseSecureAuthCookie(req)).toBe(true);
  });

  it("returns false for a plain localhost URL (no https)", () => {
    const req = makeRequest("http://localhost:3000/");
    expect(shouldUseSecureAuthCookie(req)).toBe(false);
  });

  it("returns true for a localhost URL when AUTH_COOKIE_SECURE=true", () => {
    vi.stubEnv("AUTH_COOKIE_SECURE", "true");
    // localhost with https proto header satisfies the env override + requestIsHttps
    const req = makeRequest("http://localhost:3000/", { "x-forwarded-proto": "https" });
    expect(shouldUseSecureAuthCookie(req)).toBe(true);
  });

  it("returns false when AUTH_COOKIE_SECURE=false even over https", () => {
    vi.stubEnv("AUTH_COOKIE_SECURE", "false");
    const req = makeRequest("https://example.com/", { "x-forwarded-proto": "https" });
    expect(shouldUseSecureAuthCookie(req)).toBe(false);
  });
});
