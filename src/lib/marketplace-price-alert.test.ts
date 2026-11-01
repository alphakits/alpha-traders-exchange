import { describe, expect, it } from "vitest";
import { DEFAULT_PRICE_ALERT, priceAlertMatchesListing, priceAlertSchema, readMarketplacePriceAlert } from "@/lib/marketplace-price-alert";
import type { MarketplaceListing } from "@/types/alpha-exchange";

const preference = { ...DEFAULT_PRICE_ALERT, enabled: true, maxPrice: "3.50", minUsdt: "200" };
const listing = { status: "active", approvalStatus: "approved", price: "3.40", currency: "ILS", availableAmount: "500", minimumTrade: "100", maximumTrade: "500", paymentMethods: ["Bank Transfer"], paymentMethod: "Bank Transfer", expiresAt: "2027-01-01T00:00:00Z" } as MarketplaceListing;
const now = Date.parse("2026-10-04T00:00:00Z");

describe("opt-in public marketplace price matching", () => {
  it("matches price, remaining inventory and the seller's trade limits", () => expect(priceAlertMatchesListing(preference, listing, now)).toBe(true));
  it.each(["draft", "paused", "expired", "completed", "closed", "cancelled"] as const)("does not alert on a %s listing", status => expect(priceAlertMatchesListing(preference, { ...listing, status }, now)).toBe(false));
  it.each(["pending", "rejected", "changes_requested"] as const)("does not alert on %s approval", approvalStatus => expect(priceAlertMatchesListing(preference, { ...listing, approvalStatus }, now)).toBe(false));
  it.each([{ price: "3.51" }, { price: "NaN" }, { availableAmount: "0" }, { availableAmount: "199" }, { maximumTrade: "199" }, { minimumTrade: "501" }, { minimumTrade: "NaN" }, { maximumTrade: "NaN" }, { currency: "USD" }, { expiresAt: "2026-10-03T23:59:59Z" }, { expiresAt: "invalid" }])("rejects unusable listing fields %j", patch => expect(priceAlertMatchesListing(preference, { ...listing, ...patch }, now)).toBe(false));
  it("normalizes legacy payment labels to the canonical method", () => expect(priceAlertMatchesListing({ ...preference, paymentMethod: "Cardless ATM Withdrawal" }, { ...listing, paymentMethods: ["Cardless ATM"], paymentMethod: "Cardless ATM" }, now)).toBe(true));
  it("does not match another payment method", () => expect(priceAlertMatchesListing({ ...preference, paymentMethod: "Face-to-Face (Meet in Person)" }, listing, now)).toBe(false));
  it("is disabled by default, including malformed historical preferences", () => { expect(priceAlertMatchesListing(DEFAULT_PRICE_ALERT, listing, now)).toBe(false); expect(readMarketplacePriceAlert({ enabled: true })).toEqual(DEFAULT_PRICE_ALERT); });
  it.each([{ ...preference, userId: "another-account" }, { ...preference, maxPrice: "0" }, { ...preference, maxPrice: "-3" }, { ...preference, maxPrice: "Infinity" }, { ...preference, maxPrice: "3.12345" }, { ...preference, minUsdt: "-1" }, { ...preference, paymentMethod: "arbitrary" }])("rejects invalid or cross-account preference fields %j", value => expect(priceAlertSchema.safeParse(value).success).toBe(false));
});
