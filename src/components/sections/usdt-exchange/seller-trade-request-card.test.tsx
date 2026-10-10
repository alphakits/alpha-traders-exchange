import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRequest, TradeEvidenceFile } from "@/types/alpha-exchange";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/sections/trade-room/trade-terms-panel", () => ({ TradeTermsPanel: () => <div>Proposed trade terms</div> }));

import { SellerTradeRequestCard } from "./seller-trade-request-card";
import {
  getTradeQueuePresentation, shortTradeRef, shortListingRef, safeText, toNumber,
  paymentMethodLabel, paymentMethodEmoji, paymentMethodTradeInstruction,
} from "./usdt-exchange-page";

type Workspace = ComponentProps<typeof SellerTradeRequestCard>["workspace"];
const evidence: TradeEvidenceFile = {
  id: "proof-1", purchaseRequestId: "trade-1", side: "buyer", uploadedByUserId: "buyer-1",
  uploadedAt: "2026-01-01T12:10:00Z", fileName: "buyer-payment-evidence.png", mimeType: "image/png",
  sizeBytes: 1200, storagePath: "private/proof-1", status: "uploaded",
};
function trade(overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    id: "trade-1", displayNumber: 999001, buyerId: "buyer-1", buyerName: "AT-000001", sellerId: "seller-1",
    listingId: "listing-1", usdtAmount: "100", fiatAmount: "350", pricePerUsdt: "3.50",
    currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", status: "review_open",
    createdAt: "2026-01-01T12:08:07Z", updatedAt: "2026-01-01T12:16:03Z", completedAt: "2026-01-01T12:15:34Z",
    timeline: [], ...overrides,
  };
}
function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    isAr: false, locale: "en", sellerExpandedTradeId: "trade-1", setSellerExpandedTradeId: vi.fn(),
    getTradeQueuePresentation, shortTradeRef, shortListingRef, safeText, toNumber,
    paymentMethodLabel, paymentMethodEmoji, paymentMethodTradeInstruction, myListingsById: new Map(),
    handleOpenTradeRoom: vi.fn(), handlePrefetchTradeRoom: vi.fn(), handleSellerRequestAction: vi.fn(), requestActionKey: null,
    sellerWorkspaceSummary: null, reviewPayableCommissions: vi.fn(), sellerSafetyAcknowledgements: {}, setSellerSafetyAcknowledgements: vi.fn(),
    sellerEvidenceFiles: {}, setSellerEvidenceFiles: vi.fn(), evidenceUploading: {}, uploadTradeEvidenceFile: vi.fn(),
    LocalizedEvidenceFileInput: ({ id, onSelect }) => <input id={id} aria-label="Seller evidence file" type="file" onChange={(event) => onSelect(event.target.files?.[0] ?? null)} />,
    CompactTradeTimeline: () => <div>Trade history records</div>, handleSubmitSellerResponse: vi.fn(),
    sellerResponseDrafts: {}, setSellerResponseDrafts: vi.fn(), ...overrides,
  };
}
afterEach(cleanup);

describe("compact seller trade requests", () => {
  it.each(["completed", "review_open", "cancelled", "declined"] as const)("keeps %s trades read-only with records available on demand", (status) => {
    const request = trade({ status, buyerEvidence: evidence, buyerReview: { reviewerUserId: "buyer-1", rating: 5, comment: "Test review", createdAt: "2026-01-01T12:16:00Z" } });
    const { container } = render(<SellerTradeRequestCard request={request} workspace={workspace()} />);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm Funds|Start USDT|Mark USDT|Upload Evidence/ })).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText("Trade Instructions")).toBeNull();
    expect(screen.getAllByText("AT-000001", { exact: false })).toHaveLength(1);
    expect(Array.from(container.querySelectorAll("details")).every((section) => !section.open)).toBe(true);
    fireEvent.click(screen.getByText("Payment evidence", { selector: "summary" }));
    expect(screen.getByRole("link", { name: evidence.fileName }).getAttribute("href")).toBe("/api/alpha-exchange/purchase-requests/trade-1/evidence/proof-1");
  });

  it("opens the trade room directly while details are collapsed", () => {
    const props = workspace({ sellerExpandedTradeId: null });
    render(<SellerTradeRequestCard request={trade()} workspace={props} />);
    fireEvent.focus(screen.getByRole("button", { name: "View trade room" }));
    fireEvent.click(screen.getByRole("button", { name: "View trade room" }));
    expect(props.handlePrefetchTradeRoom).toHaveBeenCalledWith("trade-1");
    expect(props.handleOpenTradeRoom).toHaveBeenCalledWith("trade-1");
    expect(screen.queryByText("Trade details")).toBeNull();
  });

  it("expands and collapses the supporting records without navigating", () => {
    const props = workspace();
    function Harness() {
      const [expanded, setExpanded] = useState<string | null>(null);
      return <SellerTradeRequestCard request={trade()} workspace={{ ...props, sellerExpandedTradeId: expanded, setSellerExpandedTradeId: setExpanded }} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("button", { name: "Hide" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("Trade details")).toBeNull();
    expect(props.handleOpenTradeRoom).not.toHaveBeenCalled();
  });

  it.each([
    ["payment_sent", "Confirm Funds Received", "funds_received"],
    ["funds_received", "Start USDT Release", "usdt_release_pending"],
    ["usdt_release_pending", "Mark USDT Sent", "usdt_sent"],
  ] as const)("shows only the current bank-transfer action for %s", (status, label, nextStatus) => {
    const props = workspace();
    render(<SellerTradeRequestCard request={trade({ status, completedAt: undefined, sellerEvidence: { ...evidence, side: "seller" } })} workspace={props} />);
    expect(screen.getAllByRole("button", { name: /Confirm Funds|Start USDT|Mark USDT/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(props.handleSellerRequestAction).toHaveBeenCalledWith("trade-1", nextStatus);
  });

  it("keeps the seller-evidence requirement and upload available for an active bank trade", () => {
    const file = new File(["evidence"], "seller.png", { type: "image/png" });
    const props = workspace({ sellerEvidenceFiles: { "trade-1": file } });
    render(<SellerTradeRequestCard request={trade({ status: "usdt_release_pending", completedAt: undefined })} workspace={props} />);
    expect((screen.getByRole("button", { name: "Mark USDT Sent" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Upload Evidence" }));
    expect(props.uploadTradeEvidenceFile).toHaveBeenCalledWith("trade-1", "seller", file);
  });

  it.each(["Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("routes %s to its trade room without bank-transfer controls", (paymentMethod) => {
    render(<SellerTradeRequestCard request={trade({ status: "funds_received", completedAt: undefined, paymentMethod })} workspace={workspace()} />);
    expect(screen.getByRole("button", { name: "Continue Cash Trade" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start USDT|Mark USDT|Upload Evidence/ })).toBeNull();
  });

  it("preserves face-to-face acknowledgement and commission restrictions before accepting", () => {
    const request = trade({ status: "pending", completedAt: undefined, paymentMethod: "Face-to-Face (Meet in Person)" });
    const props = workspace();
    const { rerender } = render(<SellerTradeRequestCard request={request} workspace={props} />);
    expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(true);
    const acknowledged = { ...props, sellerSafetyAcknowledgements: { "trade-1": true } };
    rerender(<SellerTradeRequestCard request={request} workspace={acknowledged} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(props.handleSellerRequestAction).toHaveBeenCalledWith("trade-1", "accepted", { safetyAcknowledged: true });
    rerender(<SellerTradeRequestCard request={request} workspace={{ ...acknowledged, sellerWorkspaceSummary: { pendingCommissionCount: 1, activeListingLimit: 3, openListingCount: 1, openTradeCount: 0, canCreateListing: false, blockedReason: "commission" } }} />);
    expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "View commission" }));
    expect(props.reviewPayableCommissions).toHaveBeenCalled();
  });

  it("retains the review reply after opening its section", () => {
    const props = workspace({ sellerResponseDrafts: { "trade-1": "Thank you" } });
    const request = trade({ buyerReview: { reviewerUserId: "buyer-1", rating: 5, comment: "Fast trade", createdAt: "2026-01-01T12:16:00Z" } });
    render(<SellerTradeRequestCard request={request} workspace={props} />);
    fireEvent.click(screen.getByText("Review & response", { selector: "summary" }));
    expect((screen.getByRole("textbox", { name: "Respond to buyer review" }) as HTMLTextAreaElement).value).toBe("Thank you");
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(props.handleSubmitSellerResponse).toHaveBeenCalledWith(request);
  });

  it("localizes the compact controls and records in Arabic", () => {
    render(<SellerTradeRequestCard request={trade()} workspace={workspace({ isAr: true, locale: "ar" })} />);
    expect(screen.getByRole("button", { name: "عرض غرفة التداول" })).toBeTruthy();
    expect(screen.getByText("بيانات الصفقة", { selector: "summary" })).toBeTruthy();
    expect(screen.getByText("مكتملة")).toBeTruthy();
  });
});
