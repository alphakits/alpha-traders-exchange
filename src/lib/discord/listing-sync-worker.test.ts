// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildAuthoritativeDiscordListingSnapshot } from "@/lib/discord/listing-sync-worker";

describe("Discord listing authoritative snapshot", () => {
  it("uses measured trust data, real presence, and a safe seller image", () => {
    const snapshot = buildAuthoritativeDiscordListingSnapshot({
      listing: {
        sellerDisplayName: "Seller Alpha",
        availableAmount: "500",
        price: "3.50",
        currency: "ILS",
        network: "TRC20",
        paymentMethods: ["Bank Transfer"],
      },
      seller: {
        fullName: "Private Legal Name",
        profilePhotoUrl: "https://cdn.example.com/avatar.png",
        onlineStatus: "online",
        lastActiveAt: "2026-08-08T00:00:00.000Z",
      },
      trust: {
        snapshot: {
          level: "diamond",
          reliabilityScore: 92,
          responseTimeMinutes: 3,
        },
      },
      sellerStatus: "approved_seller",
      siteUrl: "https://www.alphatraders.co.il",
      now: new Date("2026-08-08T00:05:00.000Z").getTime(),
    });

    expect(snapshot).toMatchObject({
      sellerDisplayName: "Seller Alpha",
      sellerLevel: "diamond",
      reliabilityTier: "Exceptional reliability",
      approvedSeller: true,
      presenceLabel: "Online",
      responseTimeMinutes: 3,
      imageUrl: "https://cdn.example.com/avatar.png",
      listingUrl: "https://www.alphatraders.co.il/en/usdt-exchange",
    });
    expect(JSON.stringify(snapshot)).not.toContain("Private Legal Name");
  });

  it("falls back to the stable branded HTTPS image and never fabricates response time", () => {
    const snapshot = buildAuthoritativeDiscordListingSnapshot({
      listing: {
        sellerDisplayName: "Seller Beta",
        availableAmount: "100",
        price: "3.40",
        currency: "ILS",
        network: "SOL",
        paymentMethod: "Face-to-Face (Meet in Person)",
      },
      seller: {
        profilePhotoUrl: "data:image/png;base64,unsafe",
        onlineStatus: "offline",
      },
      trust: null,
      sellerStatus: "approved_seller",
      siteUrl: "https://www.alphatraders.co.il",
    });

    expect(snapshot.imageUrl).toBe(
      "https://www.alphatraders.co.il/images/brand/alpha-traders-logo.png",
    );
    expect(snapshot.responseTimeMinutes).toBeNull();
    expect(snapshot.paymentMethods).toEqual(["Face-to-Face (Meet in Person)"]);
  });

  it("never falls back to a private legal name for the public seller identity", () => {
    const snapshot = buildAuthoritativeDiscordListingSnapshot({
      listing: {
        availableAmount: "100",
        price: "3.40",
        currency: "ILS",
        network: "TRC20",
        paymentMethods: ["Bank Transfer"],
      },
      seller: {
        fullName: "Private Legal Name",
      },
      trust: null,
      sellerStatus: "approved_seller",
      siteUrl: "https://www.alphatraders.co.il",
    });

    expect(snapshot.sellerDisplayName).toBe("Alpha Traders Seller");
    expect(JSON.stringify(snapshot)).not.toContain("Private Legal Name");
  });
});
