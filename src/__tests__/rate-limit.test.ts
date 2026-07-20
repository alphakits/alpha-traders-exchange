import { describe, it, expect } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

function makeHeaders(ip = "1.2.3.4") {
  return new Headers({ "x-forwarded-for": ip });
}

describe("checkRateLimit", () => {
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
});
