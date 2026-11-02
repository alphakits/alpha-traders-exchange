import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MARKETPLACE_EVENT_SIGNATURE_MAX_AGE_MS,
  buildMarketplaceEventSignature,
  isMarketplaceEventTimestampFresh,
  sendMarketplaceEventToDiscord,
  verifyMarketplaceEventSignature,
} from "@/lib/discord/marketplace-events";

describe("marketplace Discord event signatures", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("formats only visible money and count text at the outgoing webhook", async () => {
    vi.stubEnv("DISCORD_MARKETPLACE_WEBHOOK_URL", "https://example.invalid/synthetic");
    const post = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", post);
    await sendMarketplaceEventToDiscord({ type: "trade_completed", title: "1234 trades completed",
      message: "AT-123456 sold 14999.999999 USDT", amountUsdt: 14999.999999, tradeId: "TR-123456" });
    const [embed] = JSON.parse(String(post.mock.calls[0]?.[1]?.body)).embeds;
    expect(embed).toMatchObject({ title: "1,234 trades completed", description: "AT-123456 sold 14,999.999999 USDT" });
    expect(embed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Trade", value: "TR-123456" }),
      expect.objectContaining({ name: "Amount", value: "14,999.999999 USDT" }),
    ]));
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
