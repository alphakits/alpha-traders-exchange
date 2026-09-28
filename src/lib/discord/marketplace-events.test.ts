import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MARKETPLACE_EVENT_SIGNATURE_MAX_AGE_MS,
  buildMarketplaceEventSignature,
  isMarketplaceEventTimestampFresh,
  verifyMarketplaceEventSignature,
} from "@/lib/discord/marketplace-events";

describe("marketplace Discord event signatures", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies an HMAC bound to the exact timestamp and body", () => {
    vi.stubEnv("DISCORD_MARKETPLACE_WEBHOOK_SECRET", "unit-test-secret");
    const timestamp = "2026-08-22T10:00:00.000Z";
    const body = '{"type":"listing_created"}';
    const signature = buildMarketplaceEventSignature(body, timestamp);

    expect(verifyMarketplaceEventSignature(body, timestamp, signature)).toBe(true);
    expect(verifyMarketplaceEventSignature(`${body} `, timestamp, signature)).toBe(false);
    expect(verifyMarketplaceEventSignature(body, "2026-08-22T10:00:01.000Z", signature)).toBe(false);
  });

  it("accepts only timestamps inside the bounded freshness window", () => {
    const now = Date.parse("2026-08-22T10:00:00.000Z");
    expect(isMarketplaceEventTimestampFresh("2026-08-22T09:55:00.000Z", now)).toBe(true);
    expect(isMarketplaceEventTimestampFresh("2026-08-22T10:05:00.000Z", now)).toBe(true);
    expect(isMarketplaceEventTimestampFresh(new Date(now - MARKETPLACE_EVENT_SIGNATURE_MAX_AGE_MS - 1).toISOString(), now)).toBe(false);
    expect(isMarketplaceEventTimestampFresh(new Date(now + MARKETPLACE_EVENT_SIGNATURE_MAX_AGE_MS + 1).toISOString(), now)).toBe(false);
    expect(isMarketplaceEventTimestampFresh("not-a-timestamp", now)).toBe(false);
  });
});
