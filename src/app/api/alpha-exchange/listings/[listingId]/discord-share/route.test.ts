// @vitest-environment node

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  requireSeller: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSellerWorkspaceActor: mocks.requireSeller,
}));
vi.mock("@/lib/discord/listing-share-repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/discord/listing-share-repository")>();
  return {
    ...original,
    claimDiscordListingShare: mocks.claim,
  };
});
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
}));
vi.mock("@/lib/structured-logging", () => ({
  logEvent: vi.fn(),
}));

import { DiscordListingShareError } from "@/lib/discord/listing-share-repository";
import { POST } from "@/app/api/alpha-exchange/listings/[listingId]/discord-share/route";

const context = {
  params: Promise.resolve({ listingId: "listing-1" }),
};

function request(origin = "http://localhost") {
  return new NextRequest("http://localhost/api/alpha-exchange/listings/listing-1/discord-share", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin,
      "sec-fetch-site": origin === "http://localhost" ? "same-origin" : "cross-site",
    },
    body: JSON.stringify({ requestKey: "request-key-123456789" }),
  });
}

describe("Discord listing share route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSeller.mockResolvedValue({
      user: { id: "seller-1" },
      unauthorized: null,
    });
    mocks.claim.mockResolvedValue({
      accepted: true,
      mappingId: "mapping-1",
      sharing: {
        serverTime: "2026-08-08T00:00:00.000Z",
        nextEligibleAt: "2026-08-08T12:00:00.000Z",
        cooldownSecondsRemaining: 43_200,
        linked: true,
        available: true,
        listings: [],
      },
    });
  });

  it("requires an authenticated approved seller workspace actor", async () => {
    mocks.requireSeller.mockResolvedValue({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request(), context);
    expect(response.status).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("rejects cross-site requests before claiming cooldown", async () => {
    const response = await POST(request("https://attacker.example"), context);
    expect(response.status).toBe(403);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("returns accepted processing state without calling Discord", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      sharing: { cooldownSecondsRemaining: 43_200 },
    });
    expect(mocks.claim).toHaveBeenCalledWith({
      sellerId: "seller-1",
      listingId: "listing-1",
      requestKey: "request-key-123456789",
    });
  });

  it("surfaces ownership and cooldown denials with current server state", async () => {
    mocks.claim.mockRejectedValue(new DiscordListingShareError(
      "LISTING_NOT_OWNED",
      "You can share only your own listings.",
      403,
      {
        serverTime: "2026-08-08T00:00:00.000Z",
        nextEligibleAt: null,
        cooldownSecondsRemaining: 0,
        linked: true,
        available: true,
        listings: [],
      },
    ));

    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "LISTING_NOT_OWNED",
      sharing: { serverTime: "2026-08-08T00:00:00.000Z" },
    });
  });
});
