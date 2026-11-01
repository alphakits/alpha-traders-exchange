import { describe, expect, it } from "vitest";
import { isRequestableMarketplaceListing } from "@/lib/requestable-listing";
import { demandTestDb } from "@/test-utils/usdt-demand-fixtures";
import type { MarketplaceListing } from "@/types/alpha-exchange";

const now = Date.parse("2026-10-24T07:00:00Z");
const listing = (changes: Partial<MarketplaceListing> = {}) => ({
  ...demandTestDb().marketplaceListings[0], availableAmount: "900", minimumTrade: "100", maximumTrade: "1000",
  expiresAt: "2026-10-24T08:00:00Z", ...changes,
});

describe("requestable listing counts", () => {
  it.each(["active", "matched", "in_trade"] as const)("counts available inventory in a %s listing", status => {
    expect(isRequestableMarketplaceListing(listing({ status }), undefined, now)).toBe(true);
  });
  it.each(["draft", "paused", "expired", "completed", "cancelled", "closed"] as const)("excludes %s even when inventory remains", status => {
    expect(isRequestableMarketplaceListing(listing({ status }), undefined, now)).toBe(false);
  });
  it("uses the unreserved balance and executable trade limits", () => {
    expect(isRequestableMarketplaceListing(listing(), "100", now)).toBe(true);
    expect(isRequestableMarketplaceListing(listing(), "99.999999", now)).toBe(false);
    expect(isRequestableMarketplaceListing(listing(), "0", now)).toBe(false);
    expect(isRequestableMarketplaceListing(listing({ maximumTrade: "50" }), "900", now)).toBe(false);
  });
  it("excludes expired, unapproved and capacity-blocked listings", () => {
    expect(isRequestableMarketplaceListing(listing({ expiresAt: new Date(now).toISOString() }), undefined, now)).toBe(false);
    expect(isRequestableMarketplaceListing(listing({ approvalStatus: "pending" }), undefined, now)).toBe(false);
    expect(isRequestableMarketplaceListing(listing({ newRequestBlockReason: "inventory_reserved" }), undefined, now)).toBe(false);
    expect(isRequestableMarketplaceListing(listing({ newRequestBlockReason: "commission_due" }), undefined, now)).toBe(false);
    expect(isRequestableMarketplaceListing(listing({ sellerActiveTradeCount: 3 }), undefined, now)).toBe(false);
  });
  it("counts an executable ATM remainder below the nominal listing minimum", () => {
    const atm = listing({ price: "3.20", paymentMethod: "Cardless ATM Withdrawal", paymentMethods: ["Cardless ATM Withdrawal"] });
    expect(isRequestableMarketplaceListing(atm, "31", now)).toBe(true);
    expect(isRequestableMarketplaceListing(atm, "30", now)).toBe(false);
    expect(isRequestableMarketplaceListing(listing(), "31", now)).toBe(false);
  });
});
