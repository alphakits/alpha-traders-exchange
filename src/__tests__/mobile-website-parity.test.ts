// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("native website parity", () => {
  it("mounts the website-inspired crypto network inside every native scene", () => {
    const background = source("apps/mobile/src/components/native-blockchain-background.tsx");
    const root = source("apps/mobile/app/_layout.tsx");
    const publicLayout = source("apps/mobile/app/(public)/_layout.tsx");
    const tabs = source("apps/mobile/app/(tabs)/_layout.tsx");

    for (const coin of ["btc", "eth", "sol", "usdt", "bnb", "xrp", "ada"]) {
      expect(background).toContain(`coin: "${coin}"`);
    }
    expect(background).toContain("PulsePacket");
    expect(background).toContain("useReducedMotion()");
    expect(background).toContain("export function NativeScreenFrame");
    expect(background).toContain("useIsFocused()");
    expect(root).toContain("<NativeScreenFrame");
    expect(publicLayout).toContain("<NativeScreenFrame>");
    expect(tabs).toContain("<NativeScreenFrame>");
    expect(root).toContain("contentStyle: { backgroundColor: colors.background }");
    expect(publicLayout).toContain("contentStyle: { backgroundColor: colors.background }");
    expect(tabs).toContain("sceneStyle: { backgroundColor: colors.background }");
  });

  it("keeps the native listing card aligned to the website information hierarchy", () => {
    const listingCard = source("apps/mobile/src/components/listing-card.tsx");

    for (const section of [
      "Official Alpha Exchange Listing",
      "Approved seller",
      "AVAILABLE USDT",
      "LISTING PRICE",
      "CURRENT MARKET",
      "Trade limits",
      "Trade flow",
    ]) {
      expect(listingCard).toContain(section);
    }
    expect(listingCard).toContain('t("sellerProfile")');
    expect(listingCard).toContain("formatFinancialNumber(listing.availableAmount");
    expect(listingCard).toContain("formatCurrencyAmountAsUsd(listing.price");
    expect(listingCard).toContain("formatFinancialNumber(listing.minimumTrade");
    expect(listingCard).not.toContain("ILS / USDT");
  });

  it("renders the full website account identity, reputation, seller, and buyer details", () => {
    const panel = source("apps/mobile/src/screens/account-profile-panel.tsx");
    const contract = source("packages/contracts/src/mobile-v1.ts");

    for (const section of [
      "Update cover",
      "Update photo",
      "Public trading identity",
      "Reputation board",
      "TIER ACHIEVEMENTS",
      "YOUR BUYER ACTIVITY",
      "BUYER ACHIEVEMENTS",
      "Verified identity",
    ]) {
      expect(panel).toContain(section);
    }
    for (const field of [
      "coverBannerUrl",
      "username",
      "roleBadge",
      "accountStatuses",
      "buyerActivity",
      "promotionHistory",
      "commissionPaidUsdt",
    ]) {
      expect(contract).toContain(field);
    }
  });
});
