import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
  it.each([true, false])("keeps buyer requests and price offers enabled without revealing legacy commission locks (Arabic=%s)", isAr => {
    const listing = { id: "listing-commission", sellerId: "identity-seller", sellerDisplayName: id, status: "active", availableAmount: "100", price: "3.20", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", minimumTrade: "10", maximumTrade: "100", newRequestBlockReason: "commission_due", sellerProfile: profile.profile } as MarketplaceListing;
    const onOpen = vi.fn();
    render(<ListingCard listing={listing} isAr={isAr} marketPricePerUsdt={3.2} isOwnerListing={false} isOwnListing={false} isBuying={false} onOpen={onOpen} onManageListing={vi.fn()} />);
    const buy = screen.getByRole("button", { name: isAr ? /شراء USDT/ : /Buy USDT/ }) as HTMLButtonElement;
    const offer = screen.getByRole("button", { name: isAr ? /تقديم عرض سعر/ : /Make a price offer/ }) as HTMLButtonElement;
    expect(buy.disabled).toBe(false);
    expect(offer.disabled).toBe(false);
    expect(document.body.textContent).not.toMatch(/commission|عمولة/i);
    fireEvent.click(buy);
    fireEvent.click(offer);
    expect(onOpen.mock.calls.map(call => call[1])).toEqual(["listing_price", "buyer_offer"]);
  });
  it.each(["trade_limit", "inventory_reserved"] as const)("keeps the %s buyer restriction enforced", newRequestBlockReason => {
    const listing = { id: "listing-capacity", sellerId: "identity-seller", sellerDisplayName: id, status: "active", availableAmount: "100", price: "3.20", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", minimumTrade: "10", maximumTrade: "100", newRequestBlockReason, sellerProfile: profile.profile } as MarketplaceListing;
    render(<ListingCard listing={listing} isAr={false} marketPricePerUsdt={3.2} isOwnerListing={false} isOwnListing={false} isBuying={false} onOpen={vi.fn()} onManageListing={vi.fn()} />);
    expect((screen.getByRole("button", { name: /Buy USDT/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Make a price offer/ }) as HTMLButtonElement).disabled).toBe(true);
  });
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


describe("phone verification badges across seller surfaces", () => {
  it.each([true, false])("shows the saved verification state on cards and profiles (Arabic=%s)", isAr => {
    const sellerProfile = { ...profile.profile, emailVerified: true, isPhoneVerified: true };
    const listing = { id: "verified-listing", sellerId: "identity-seller", sellerDisplayName: id, status: "active", availableAmount: "100", price: "3.20", currency: "ILS", network: "TRC20", paymentMethod: "Cash", minimumTrade: "10", maximumTrade: "100", sellerProfile } as MarketplaceListing;
    const props = { listing, isAr, marketPricePerUsdt: 3.2, isOwnerListing: false, isOwnListing: false, isBuying: false, onOpen: vi.fn(), onManageListing: vi.fn() };
    const view = render(<ListingCard {...props} />);
    expect(screen.getByText(isAr ? "بريد موثّق" : "Verified Email")).toBeTruthy();
    expect(screen.getByText(isAr ? "هاتف موثّق" : "Verified Phone")).toBeTruthy();
    view.rerender(<ListingCard {...props} listing={{ ...listing, sellerProfile: { ...sellerProfile, isPhoneVerified: false } }} />);
    expect(screen.queryByText(isAr ? "هاتف موثّق" : "Verified Phone")).toBeNull();
    // Owner status alone is not proof of phone verification.
    view.rerender(<ListingCard {...props} isOwnerListing listing={{ ...listing, sellerProfile: { ...sellerProfile, isPhoneVerified: false } }} />);
    expect(screen.queryByText(isAr ? "هاتف موثّق" : "Verified Phone")).toBeNull();
    view.unmount();
    const data = { profile: { ...profile, profile: sellerProfile }, sellerListings: [], similarSellers: [] };
    const profileView = render(<PremiumSellerProfilePage locale={isAr ? "ar" : "en"} data={data} />);
    expect(screen.getByText(isAr ? "هاتف موثّق" : "Verified Phone")).toBeTruthy();
    profileView.rerender(<PremiumSellerProfilePage locale={isAr ? "ar" : "en"} data={{ ...data, profile: { ...data.profile, profile: { ...sellerProfile, isPhoneVerified: false } } }} />);
    expect(screen.queryByText(isAr ? "هاتف موثّق" : "Verified Phone")).toBeNull();
  });
});
