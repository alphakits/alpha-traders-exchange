import { describe, expect, it } from "vitest";
import {
  mobileQueryRetryDelay,
  shouldRetryMobileQuery,
} from "../../apps/mobile/src/query/mobile-query-retry";

describe("mobile query retry policy", () => {
  it("retries one transient read quickly", () => {
    expect(shouldRetryMobileQuery(0, { status: 0 })).toBe(true);
    expect(shouldRetryMobileQuery(0, { status: 502 })).toBe(true);
    expect(shouldRetryMobileQuery(0, { status: 503 })).toBe(true);
    expect(mobileQueryRetryDelay()).toBe(250);
  });

  it("does not retry permanent, rate-limited, or repeated failures", () => {
    expect(shouldRetryMobileQuery(0, { status: 400 })).toBe(false);
    expect(shouldRetryMobileQuery(0, { status: 401 })).toBe(false);
    expect(shouldRetryMobileQuery(0, { status: 409 })).toBe(false);
    expect(shouldRetryMobileQuery(0, { status: 429 })).toBe(false);
    expect(shouldRetryMobileQuery(1, { status: 503 })).toBe(false);
    expect(shouldRetryMobileQuery(0, new Error("unknown"))).toBe(false);
  });
});
