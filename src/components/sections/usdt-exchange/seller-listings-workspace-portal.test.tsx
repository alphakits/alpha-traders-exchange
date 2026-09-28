import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SellerListingsWorkspacePortal, type SellerListingsWorkspacePortalProps } from "./seller-listings-workspace-portal";
import type { MarketplaceListing } from "@/types/alpha-exchange";

vi.mock("./discord-share-action", () => ({ DiscordShareAction: () => null }));
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const listing = {
  id: "listing-legacy", sellerId: "seller-1", sellerDisplayName: "Seller",
  status: "active", approvalStatus: "approved", availableAmount: "2011.285267",
  maximumTrade: "7,000", minimumTrade: "600", price: "3.30", currency: "ILS", network: "TRC20",
  paymentMethods: ["Face-to-Face (Meet in Person)"], paymentMethod: "Face-to-Face (Meet in Person)",
  createdAt: "2026-09-21T12:00:00Z", updatedAt: "2026-09-21T12:00:00Z",
} as MarketplaceListing;

function createProps(isMobileViewport: boolean): SellerListingsWorkspacePortalProps {
  const target = document.createElement("div");
  document.body.append(target);
  return {
    isAr: false, locale: "en", isMobileViewport, isWorkspaceWidgetsLoading: false,
    editingListingId: null, listingActionKey: null, sellerDashboardListingsTarget: target,
    myListings: [listing], sortedDashboardListings: [listing], sellerRequests: [], sellerBankAccounts: [],
    sellerListingsExpanded: true, sellerExpandedListingId: listing.id, sellerWorkspaceMessage: null,
    isListingActionBusy: () => false, discordSharing: null, discordShareActionKey: null,
    shortListingRef: () => "L-94", formatIls: (value: number) => `₪${value}`, toNumber: (value: unknown) => Number(String(value).replaceAll(",", "")),
    listingStatusLabel: String, paymentMethodLabel: String,
    normalizePaymentMethodList: (methods?: string[]) => methods ?? [],
    setSellerListingsExpanded: vi.fn(), setSellerExpandedListingId: vi.fn(),
    setEditingListingId: vi.fn(), setListingEditForm: vi.fn(), setListingEditOriginal: vi.fn(),
    handleSellerListingStatus: vi.fn(), handleSellerListingDelete: vi.fn(), handleSellerListingRenew: vi.fn(),
    handleSellerListingDuplicate: vi.fn(), handleDiscordListingShare: vi.fn(),
  } as unknown as SellerListingsWorkspacePortalProps;
}

describe("seller listing controls", () => {
  it.each([true, false])("opens management and prepares valid partial-sale edit limits (mobile=%s)", (mobile) => {
    const props = createProps(mobile);
    render(<SellerListingsWorkspacePortal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage Listings" }));
    expect(props.setSellerListingsExpanded).toHaveBeenCalledWith(true);
    expect(props.setSellerExpandedListingId).toHaveBeenCalledWith(listing.id);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(props.setListingEditForm).toHaveBeenCalledWith(expect.objectContaining({
      availableAmount: "2011.285267", maximumTrade: "2011.285267",
    }));
    expect(props.setListingEditOriginal).toHaveBeenCalledWith(expect.objectContaining({ maximumTrade: "2011.285267" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(props.handleSellerListingStatus).toHaveBeenCalledWith(listing, "paused");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.handleSellerListingDelete).toHaveBeenCalledWith(listing);
  });

  it.each([true, false])("reveals pause responses and repeated errors in the listing workspace (mobile=%s)", (mobile) => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{ top: 200, height: 40 }] as unknown as DOMRectList);
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    const props = createProps(mobile);
    const view = render(<SellerListingsWorkspacePortal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(props.handleSellerListingStatus).toHaveBeenCalledWith(listing, "paused");
    view.rerender(<SellerListingsWorkspacePortal {...props} sellerWorkspaceMessage="Listing paused." sellerWorkspaceMessageFeedbackKey={1} />);
    act(() => vi.advanceTimersByTime(20));
    expect(document.activeElement).toBe(screen.getByRole("status"));
    expect(scroll).toHaveBeenCalledOnce();
    view.rerender(<SellerListingsWorkspacePortal {...props} sellerWorkspaceMessage="Unable to update listing." sellerWorkspaceMessageFeedbackKey={2} />);
    act(() => vi.advanceTimersByTime(20));
    view.rerender(<SellerListingsWorkspacePortal {...props} sellerWorkspaceMessage="Unable to update listing." sellerWorkspaceMessageFeedbackKey={3} />);
    act(() => vi.advanceTimersByTime(20));
    expect(scroll).toHaveBeenCalledTimes(3);
    expect(document.activeElement?.textContent).toContain("Unable to update listing.");
  });

  it("shows mutation failures inside the Arabic listing workspace without claiming success", () => {
    const props = createProps(true);
    render(<SellerListingsWorkspacePortal {...props} isAr locale="ar" sellerWorkspaceMessage="تعذّر تحديث العرض الآن. حاول مرة أخرى." />);
    expect(screen.getByRole("status").textContent).toContain("تعذّر تحديث العرض");
    expect(screen.queryByText("تم تحديث مساحة عمل البائع بنجاح.")).toBeNull();
  });
});
