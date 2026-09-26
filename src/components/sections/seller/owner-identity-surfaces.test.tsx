import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";
import type { MarketplaceListing, PremiumSellerProfileData } from "@/types/alpha-exchange";
import { publicAccountId } from "@/lib/public-account-identity";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; locale?: string }) => { void locale; return <a href={href} {...props} />; },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/user-presence-client", () => ({ useLiveUserPresence: () => ({ onlineStatus: "offline" }), useLivePresenceMap: () => ({}) }));

import { ListingCard } from "../usdt-exchange/usdt-exchange-page";
import { PremiumSellerProfilePage } from "./premium-seller-profile-page";

const id = publicAccountId({ id: "identity-seller" });
const label = `${id} (Private Seller)`;
const profile: PremiumSellerProfileData = {
  sellerId: "identity-seller", sellerLevel: "gold", publicVolumeRange: "",
  profile: { sellerId: "identity-seller", sellerName: label, profilePhotoUrl: "", memberSince: "2025-04-01", languages: [], preferredNetworks: ["TRC20"], bio: "", onlineStatus: "offline", availabilityStatus: "available", isOwner: false, isEmailVerified: true },
  trustScore: 96, completedTrades: 28, averageRating: 0, responseTimeMinutes: 4, completionRate: 98,
  repeatBuyersPercent: 30, totalReviews: 0, yearsOnPlatform: 1.5, badges: [], promotionHistory: [], achievements: [], prestigeVolumePublicLabel: "", hallOfFameEligible: false, latestReviews: [], recentActivity: [],
};
afterEach(cleanup);
describe("actual owner identity surfaces", () => {
  it.each([true, false])("listing card respects private-identity capability %s", canViewPrivateIdentity => {
    const listing = { id: "listing-identity", sellerId: "identity-seller", sellerDisplayName: label, status: "active", availableAmount: "100", price: "3.20", currency: "ILS", network: "TRC20", paymentMethod: "Cash", paymentMethods: ["Cash"], minimumTrade: "10", maximumTrade: "100", sellerReputation: { level: "gold" }, sellerProfile: profile.profile } as MarketplaceListing;
    render(<ListingCard listing={listing} isAr={false} marketPricePerUsdt={3.2} isOwnerListing={false} isOwnListing={false} isBuying={false} canViewPrivateIdentity={canViewPrivateIdentity} onOpen={vi.fn()} onManageListing={vi.fn()} />);
    expect(screen.getByText(id)).toBeTruthy();
    expect(Boolean(screen.queryByText("(Private Seller)"))).toBe(canViewPrivateIdentity);
  });
  it.each([true, false])("seller profile heading respects private-identity capability %s", canViewPrivateIdentity => {
    render(<PremiumSellerProfilePage locale="en" canViewPrivateIdentity={canViewPrivateIdentity} data={{ profile, sellerListings: [], similarSellers: [] }} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(id);
    expect(screen.getByRole("heading", { level: 1 }).textContent?.includes("Private Seller")).toBe(canViewPrivateIdentity);
  });
});
