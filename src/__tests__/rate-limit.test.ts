import { afterEach, describe, it, expect, vi } from "vitest";
import { checkRateLimit, checkSharedRateLimit, createRateLimitResponse, resolveClientIp } from "@/lib/rate-limit";

function makeHeaders(ip = "1.2.3.4") {
  return new Headers({ "x-forwarded-for": ip });
}

describe("checkRateLimit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("allows the first request", () => {
    const result = checkRateLimit({
      headers: makeHeaders("10.0.0.1"),
      key: "test-first",
      maxRequests: 3,
      windowMs: 60_000,
    });
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("allows requests up to maxRequests", () => {
    const headers = makeHeaders("10.0.0.2");
    const opts = { headers, key: "test-upto", maxRequests: 3, windowMs: 60_000 };
    checkRateLimit(opts); // 1
    checkRateLimit(opts); // 2
    const third = checkRateLimit(opts); // 3
    expect(third.allowed).toBe(true);
  });

  it("denies request after maxRequests exceeded", () => {
    const headers = makeHeaders("10.0.0.3");
    const opts = { headers, key: "test-deny", maxRequests: 2, windowMs: 60_000 };
    checkRateLimit(opts); // 1
    checkRateLimit(opts); // 2
    const blocked = checkRateLimit(opts); // 3 — over limit
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("resets window after windowMs elapses", async () => {
    const headers = makeHeaders("10.0.0.4");
    const opts = { headers, key: "test-reset", maxRequests: 1, windowMs: 50 };
    checkRateLimit(opts); // 1 — uses up the window
    const blocked = checkRateLimit(opts); // over limit
    expect(blocked.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 60)); // wait for window to expire

    const after = checkRateLimit(opts); // new window
    expect(after.allowed).toBe(true);
  });

  it("creates a 429 response with retry-after metadata", () => {
    const response = createRateLimitResponse(12);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
  });

  it("resolves the real client ip using vercel forwarding headers", () => {
    const headers = new Headers({
      "x-forwarded-for": "10.0.0.1, 54.33.22.11",
      "x-vercel-forwarded-for": "88.10.20.30",
    });
    expect(resolveClientIp(headers)).toBe("88.10.20.30");
  });

  it("supports explicit rate-limit identifiers", () => {
    const headers = makeHeaders("203.0.113.1");
    const opts = {
      headers,
      key: "test-identifier",
      identifier: "203.0.113.1:alpha@example.com",
      maxRequests: 1,
      windowMs: 60_000,
    };
    const first = checkRateLimit(opts);
    const second = checkRateLimit(opts);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });

  it("retains local enforcement only when no shared runtime database is configured", async () => {
    const headers = makeHeaders("203.0.113.2");
    const opts = { headers, key: "test-shared-fallback", maxRequests: 1, windowMs: 60_000 };
    expect((await checkSharedRateLimit(opts)).allowed).toBe(true);
    expect((await checkSharedRateLimit(opts)).allowed).toBe(false);
  });

  it("fails closed instead of using the in-memory limiter when production persistence is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("SUPABASE_DB_URL", "");
    vi.stubEnv("DATABASE_URL", "");
    const result = await checkSharedRateLimit({
      headers: makeHeaders("203.0.113.77"),
      key: "production-no-pool",
      maxRequests: 5,
      windowMs: 60_000,
    });
    expect(result).toMatchObject({ allowed: false, reason: "limiter_unavailable" });
  });
});
