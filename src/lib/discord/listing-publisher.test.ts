// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildDiscordListingMessage,
  hashDiscordListingSnapshot,
  isSafeDiscordImageUrl,
  type DiscordListingSnapshot,
} from "@/lib/discord/listing-publisher";

const snapshot: DiscordListingSnapshot = {
  sellerDisplayName: "Trusted Seller",
  sellerLevel: "gold",
  reliabilityTier: "Highly reliable",
  approvedSeller: true,
  availableAmount: "1250",
  price: "3.42",
  currency: "ILS",
  network: "TRC20",
  paymentMethods: ["Bank Transfer", "Cardless ATM Withdrawal"],
  presenceLabel: "Online",
  responseTimeMinutes: 4,
  imageUrl: "https://www.alphatraders.co.il/images/brand/alpha-traders-logo.png",
  listingUrl: "https://www.alphatraders.co.il/en/usdt-exchange",
};

describe("Discord listing message", () => {
  it("renders authoritative premium marketplace fields without private data", () => {
    const payload = buildDiscordListingMessage(snapshot);
    const serialized = JSON.stringify(payload);

    expect(payload.embeds?.[0]).toMatchObject({
      color: 0xc9a227,
      author: { name: "Trusted Seller" },
      title: "1,250 USDT available",
      url: snapshot.listingUrl,
    });
    expect(serialized).toContain("Approved Seller");
    expect(serialized).toContain("Measured response");
    expect(serialized).toContain("View Listing");
    expect(serialized).not.toMatch(/wallet|email|buyer|audit|listing-/i);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("retains truthful historical values for SOLD and removes the Buy action", () => {
    const payload = buildDiscordListingMessage(snapshot, true);
    const serialized = JSON.stringify(payload);

    expect(payload.embeds?.[0]?.title).toContain("SOLD");
    expect(payload.embeds?.[0]?.fields?.[0]).toMatchObject({
      name: "Last available amount",
      value: "1,250 USDT",
    });
    expect(payload.components).toEqual([]);
    expect(serialized).not.toContain("View Listing");
  });

  it("uses stable hashes and rejects unsafe image URLs", () => {
    expect(hashDiscordListingSnapshot(snapshot)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDiscordListingSnapshot(snapshot)).toBe(hashDiscordListingSnapshot({ ...snapshot }));
    expect(isSafeDiscordImageUrl(snapshot.imageUrl)).toBe(true);
    expect(isSafeDiscordImageUrl("http://example.com/photo.png")).toBe(false);
    expect(isSafeDiscordImageUrl("https://user:secret@example.com/photo.png")).toBe(false);
    expect(isSafeDiscordImageUrl("https://localhost/photo.png")).toBe(false);
  });
});
