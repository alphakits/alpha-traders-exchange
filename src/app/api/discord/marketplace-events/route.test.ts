import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMarketplaceEventToDiscord: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/discord/marketplace-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discord/marketplace-events")>();
  return { ...actual, sendMarketplaceEventToDiscord: mocks.sendMarketplaceEventToDiscord };
});
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { buildMarketplaceEventSignature } from "@/lib/discord/marketplace-events";
import { POST } from "@/app/api/discord/marketplace-events/route";

const body = JSON.stringify({
  type: "listing_created",
  title: "Listing created",
  message: "A listing was created.",
});

function request(headers: Record<string, string> = {}) {
  return new Request("https://alphatraders.co.il/api/discord/marketplace-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alpha-discord-key": "unit-test-api-key",
      ...headers,
    },
    body,
  });
}

describe("marketplace Discord event relay route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DISCORD_MARKETPLACE_API_KEY", "unit-test-api-key");
    vi.stubEnv("DISCORD_MARKETPLACE_WEBHOOK_SECRET", "unit-test-secret");
    mocks.sendMarketplaceEventToDiscord.mockResolvedValue({ ok: true, skipped: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires an HMAC and a fresh timestamp in deployed production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");

    expect((await POST(request())).status).toBe(401);
    expect((await POST(request({ "x-alpha-signature": "partial" }))).status).toBe(401);
    expect(mocks.sendMarketplaceEventToDiscord).not.toHaveBeenCalled();
  });

  it("accepts a current correctly signed production event", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const timestamp = new Date().toISOString();
    const signature = buildMarketplaceEventSignature(body, timestamp);

    const response = await POST(request({
      "x-alpha-signature-timestamp": timestamp,
      "x-alpha-signature": signature,
    }));
    expect(response.status).toBe(200);
    expect(mocks.sendMarketplaceEventToDiscord).toHaveBeenCalledOnce();
  });

  it("rejects a stale signed production event", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const timestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const signature = buildMarketplaceEventSignature(body, timestamp);

    expect((await POST(request({
      "x-alpha-signature-timestamp": timestamp,
      "x-alpha-signature": signature,
    }))).status).toBe(401);
    expect(mocks.sendMarketplaceEventToDiscord).not.toHaveBeenCalled();
  });

  it("keeps unsigned compatibility for the local test runtime only", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");

    expect((await POST(request())).status).toBe(200);
    expect(mocks.sendMarketplaceEventToDiscord).toHaveBeenCalledOnce();
  });
});
