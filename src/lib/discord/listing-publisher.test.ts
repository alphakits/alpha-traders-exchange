// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildDiscordListingMessage,
  DISCORD_LISTING_SOLD_COLOR,
  hashDiscordListingSnapshot,
  isSafeDiscordImageUrl,
  isSafeDiscordLinkUrl,
  type DiscordListingSnapshot,
} from "@/lib/discord/listing-publisher";

const snapshot: DiscordListingSnapshot = {
  snapshotVersion: 2,
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
  rating: 4.96,
  completedTrades: 184,
  imageUrl: "https://cdn.example.com/seller-avatar.png",
  brandImageUrl: "https://www.alphatraders.co.il/images/brand/alpha-traders-logo.png",
  listingUrl: "https://www.alphatraders.co.il/en/usdt-exchange",
  sellerProfileUrl: "https://www.alphatraders.co.il/en/exchange/seller/trusted-seller",
  websiteUrl: "https://www.alphatraders.co.il",
};

describe("Discord listing message", () => {
  it("renders the exact premium active hierarchy and authoritative fields", () => {
    const payload = buildDiscordListingMessage(snapshot);
    const embed = payload.embeds?.[0];
    const fields = Object.fromEntries((embed?.fields ?? []).map((field) => [field.name, field.value]));
    const serialized = JSON.stringify(payload);

    expect(embed).toMatchObject({
      color: 0xc9a227,
      author: {
        name: "Alpha Traders Marketplace",
        icon_url: snapshot.brandImageUrl,
        url: snapshot.websiteUrl,
      },
      thumbnail: { url: snapshot.imageUrl },
      title: "🔥 NEW USDT LISTING",
      url: snapshot.listingUrl,
    });
    expect(fields).toEqual({
      "Available USDT": "**1,250 USDT**",
      "Price per USDT": "**₪3.42**",
      "Network": "TRC20",
      "Payment methods": "Bank Transfer • Cardless ATM Withdrawal",
      "Availability": "Online",
      "Measured response": "~4 min",
      "Seller rating": "⭐ 4.96 / 5",
      "Completed trades": "184",
    });
    expect(serialized).toContain("Approved Seller");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("creates three HTTPS public link buttons without internal identifiers", () => {
    const payload = buildDiscordListingMessage(snapshot);
    const firstRow = payload.components?.[0] as { components?: Array<{ label?: string; url?: string }> } | undefined;
    const buttons = firstRow?.components ?? [];

    expect(buttons).toMatchObject([
      { label: "View Marketplace", url: snapshot.listingUrl },
      { label: "Seller Profile", url: snapshot.sellerProfileUrl },
      { label: "Website", url: snapshot.websiteUrl },
    ]);
    for (const button of buttons) {
      expect("url" in button && isSafeDiscordLinkUrl(button.url)).toBe(true);
      expect("url" in button ? button.url : "").not.toMatch(/[?&#]|listing-id|seller-id|[0-9a-f]{8}-[0-9a-f-]{27,}/i);
    }
  });

  it("omits absent metrics, presence, payment, and private profiles", () => {
    const payload = buildDiscordListingMessage({
      ...snapshot,
      reliabilityTier: null,
      sellerLevel: null,
      presenceLabel: null,
      responseTimeMinutes: null,
      rating: null,
      completedTrades: null,
      paymentMethods: [],
      sellerProfileUrl: null,
    });
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toMatch(/Measured response|Seller rating|Completed trades|Availability|Payment methods|Seller Profile/);
    const firstRow = payload.components?.[0] as { components?: unknown[] } | undefined;
    expect(firstRow?.components).toHaveLength(2);
  });

  it("retains truthful historical values for SOLD in grey and removes all actions", () => {
    const payload = buildDiscordListingMessage(snapshot, true);
    const serialized = JSON.stringify(payload);

    expect(payload.embeds?.[0]).toMatchObject({
      title: "✅ SOLD",
      color: DISCORD_LISTING_SOLD_COLOR,
      url: undefined,
    });
    expect(payload.embeds?.[0]?.description).toContain("Historical details");
    expect(payload.embeds?.[0]?.fields?.[0]).toMatchObject({
      name: "Last available amount",
      value: "1,250 USDT",
    });
    expect(serialized).toContain("₪3.42");
    expect(serialized).toContain("TRC20");
    expect(serialized).toContain("Bank Transfer");
    expect(payload.components).toEqual([]);
    expect(serialized).not.toMatch(/View Marketplace|Seller Profile|Buy Now/);
  });

  it("keeps legacy snapshot JSON renderable and hashes every embed-derived field", () => {
    const legacySnapshot = {
      sellerDisplayName: snapshot.sellerDisplayName,
      sellerLevel: snapshot.sellerLevel,
      reliabilityTier: snapshot.reliabilityTier,
      approvedSeller: snapshot.approvedSeller,
      availableAmount: snapshot.availableAmount,
      price: snapshot.price,
      currency: snapshot.currency,
      network: snapshot.network,
      paymentMethods: snapshot.paymentMethods,
      presenceLabel: snapshot.presenceLabel,
      responseTimeMinutes: snapshot.responseTimeMinutes,
      imageUrl: snapshot.imageUrl,
      listingUrl: snapshot.listingUrl,
    } satisfies DiscordListingSnapshot;

    expect(() => buildDiscordListingMessage(legacySnapshot)).not.toThrow();
    expect(hashDiscordListingSnapshot(snapshot)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDiscordListingSnapshot(snapshot)).toBe(hashDiscordListingSnapshot({ ...snapshot }));
    for (const changed of [
      { price: "3.44" },
      { availableAmount: "1200" },
      { paymentMethods: ["Bank Transfer"] },
      { presenceLabel: "Recently active" },
      { reliabilityTier: "Exceptional reliability" },
      { rating: 4.88 },
      { completedTrades: 185 },
      { imageUrl: "https://cdn.example.com/new-avatar.png" },
      { sellerProfileUrl: "https://www.alphatraders.co.il/en/exchange/seller/trusted-seller-new" },
    ]) {
      expect(hashDiscordListingSnapshot({ ...snapshot, ...changed })).not.toBe(
        hashDiscordListingSnapshot(snapshot),
      );
    }
  });

  it("rejects unsafe images and public action URLs", () => {
    expect(isSafeDiscordImageUrl(snapshot.imageUrl)).toBe(true);
    expect(isSafeDiscordImageUrl("http://example.com/photo.png")).toBe(false);
    expect(isSafeDiscordImageUrl("******example.com/photo.png")).toBe(false);
    expect(isSafeDiscordImageUrl("https://localhost/photo.png")).toBe(false);
    expect(isSafeDiscordImageUrl("https://10.0.0.8/photo.png")).toBe(false);
    expect(isSafeDiscordImageUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeDiscordImageUrl("https://seller.internal/photo.png")).toBe(false);
    expect(isSafeDiscordImageUrl("https://[fd00::1]/photo.png")).toBe(false);
    expect(isSafeDiscordImageUrl("https://[::ffff:127.0.0.1]/photo.png")).toBe(false);
    expect(isSafeDiscordImageUrl("https://cdn.example.com/photo.png?token=secret")).toBe(false);
    expect(isSafeDiscordLinkUrl("https://www.alphatraders.co.il/en/usdt-exchange")).toBe(true);
    expect(isSafeDiscordLinkUrl("http://www.alphatraders.co.il/en/usdt-exchange")).toBe(false);
    expect(isSafeDiscordLinkUrl("https://localhost/en/usdt-exchange")).toBe(false);
    expect(isSafeDiscordLinkUrl("https://www.alphatraders.co.il/listings/123e4567-e89b-42d3-a456-426614174000")).toBe(false);
  });

  it("never serializes unrelated private properties or mentions", () => {
    const privateInput = {
      ...snapshot,
      email: "seller@example.com",
      walletAddress: "0x1234567890abcdef",
      buyerId: "buyer-private",
      auditReason: "private-review",
      internalListingId: "listing-private",
    } as DiscordListingSnapshot & Record<string, unknown>;
    const serialized = JSON.stringify(buildDiscordListingMessage(privateInput));

    expect(serialized).not.toMatch(/seller@example|0x123456|buyer-private|private-review|listing-private/i);
    expect(JSON.parse(serialized).allowed_mentions).toEqual({ parse: [] });
  });

  it("escapes every seller-controlled text field before rendering embeds", () => {
    const malicious = "[Trusted](https://phishing.example) @everyone";
    const serialized = JSON.stringify(buildDiscordListingMessage({
      ...snapshot,
      sellerDisplayName: malicious,
      sellerLevel: malicious,
      reliabilityTier: malicious,
      network: malicious,
      paymentMethods: [malicious],
      presenceLabel: malicious,
    }));

    expect(serialized).not.toContain("[Trusted](");
    expect(serialized).not.toContain("https://phishing.example");
    expect(serialized).not.toContain("@everyone");
    expect(serialized).toContain("@​everyone");
  });
});
