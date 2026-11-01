// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicClientIp, normalizeClientIp, resolveClientIp } from "./client-ip";
import { checkRateLimit } from "./rate-limit";

afterEach(() => vi.unstubAllEnvs());

describe("trusted client IP", () => {
  it.each([
    ["8.8.8.8", "8.8.8.8"], [" ::ffff:8.8.8.8 ", "8.8.8.8"],
    ["::ffff:808:808", "8.8.8.8"], ["2001:4860:0000:0000::8888", "2001:4860::8888"],
  ])("normalizes %s consistently", (raw, expected) => expect(normalizeClientIp(raw)).toBe(expected));

  it.each(["", "unknown", "008.8.8.8", "256.1.1.1", "8.8.8.8:443", "8.8.8.8, 1.1.1.1", "localhost", "::ffff:999.1.1.1", "fe80::1%eth0", "https://8.8.8.8", "::1/path", "1:2:3"])("rejects malformed IP %s", (raw) => expect(normalizeClientIp(raw)).toBeNull());

  it("ignores caller-controlled forwarding headers on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(resolveClientIp(new Headers({
      "x-vercel-forwarded-for": "8.8.8.8", "cf-connecting-ip": "1.1.1.1",
      "x-real-ip": "1.0.0.1", "x-forwarded-for": "9.9.9.9",
    }))).toBe("8.8.8.8");
    expect(resolveClientIp(new Headers({ "cf-connecting-ip": "1.1.1.1" }))).toBe("unknown");
  });

  it("does not select a more convenient IP when trusted input is malformed", () => {
    vi.stubEnv("VERCEL", "1");
    expect(resolveClientIp(new Headers({ "x-vercel-forwarded-for": "8.8.8.8, 1.1.1.1", "x-real-ip": "1.0.0.1" }))).toBe("unknown");
  });

  it("uses Vercel's overwritten forwarded-for when its equivalent header is absent", () => {
    vi.stubEnv("VERCEL", "1");
    expect(resolveClientIp(new Headers({ "x-forwarded-for": "8.8.8.8", "cf-connecting-ip": "1.1.1.1" }))).toBe("8.8.8.8");
  });

  it("does not trust arbitrary forwarded headers on an unconfigured production host", () => {
    vi.stubEnv("VERCEL", ""); vi.stubEnv("VERCEL_ENV", ""); vi.stubEnv("NODE_ENV", "production");
    expect(resolveClientIp(new Headers({ "x-forwarded-for": "8.8.8.8" }))).toBe("unknown");
  });

  it.each([["1", ""], ["", "1"]])("rejects incomplete local E2E markers (%s, %s)", (support, loopback) => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL", ""); vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", support); vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", loopback);
    expect(resolveClientIp(new Headers({ "x-forwarded-for": "8.8.8.8" }))).toBe("unknown");
  });

  it("keeps isolated loopback E2E network identities separate while enforcing their limits", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL", ""); vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1"); vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");
    const input = { key: "loopback-e2e-ip-regression", maxRequests: 1, windowMs: 60_000 };
    const first = new Headers({ "x-forwarded-for": "198.51.100.87" });
    const second = new Headers({ "x-forwarded-for": "198.51.100.88" });
    expect(resolveClientIp(first)).toBe("198.51.100.87");
    expect(checkRateLimit({ ...input, headers: first }).allowed).toBe(true);
    expect(checkRateLimit({ ...input, headers: second }).allowed).toBe(true);
    expect(checkRateLimit({ ...input, headers: first }).allowed).toBe(false);
  });

  it.each([["1", ""], ["", "preview"]])("never trusts test identities on deployed Vercel (%s, %s)", (vercel, environment) => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL", vercel); vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1"); vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");
    expect(resolveClientIp(new Headers({ "cf-connecting-ip": "1.1.1.1" }))).toBe("unknown");
    expect(resolveClientIp(new Headers({ "x-vercel-forwarded-for": "8.8.8.8", "cf-connecting-ip": "1.1.1.1" }))).toBe("8.8.8.8");
  });

  it("cannot reset a rate limit by changing spoofed Cloudflare headers", () => {
    vi.stubEnv("VERCEL", "1");
    const input = { key: "ip-spoof-regression", maxRequests: 1, windowMs: 60_000 };
    expect(checkRateLimit({ ...input, headers: new Headers({ "x-forwarded-for": "8.8.8.8", "cf-connecting-ip": "1.1.1.1" }) }).allowed).toBe(true);
    expect(checkRateLimit({ ...input, headers: new Headers({ "x-forwarded-for": "8.8.8.8", "cf-connecting-ip": "1.0.0.1" }) }).allowed).toBe(false);
  });

  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "203.0.113.1", "198.51.100.1", "192.0.2.1", "::1", "::", "fc00::1", "fe80::1", "2001:db8::1", "::ffff:127.0.0.1"])("does not submit special-purpose address %s to a provider", (ip) => expect(isPublicClientIp(ip)).toBe(false));
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])("supports public address %s", (ip) => expect(isPublicClientIp(ip)).toBe(true));
});
