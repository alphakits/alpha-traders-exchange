import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AlphaExchangeAdminDashboard } from "@/components/admin/alpha-exchange-admin-dashboard";

const navigationState = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigationState.search),
}));

const listing = {
  id: "listing-123",
  sellerDisplayName: "Verified Seller",
  availableAmount: "100",
  price: "3.70",
  network: "TRC20",
  bankName: null,
  status: "draft",
  expiresAt: null,
  lastRenewedAt: null,
  expiredAt: null,
  createdAt: "2026-08-22T00:00:00.000Z",
};

function adminPayload(
  listings = [listing],
  approvedSellers: Array<Record<string, unknown>> = [],
  commissionRecords: Array<Record<string, unknown>> = [],
) {
  return {
    applications: [],
    approvedSellers,
    listings,
    purchaseRequests: [],
    commissionRecords,
    auditLogs: [],
    notifications: [],
    privateBeta: {
      inviteCodes: [],
      inviteUses: [],
      pendingInvites: [],
      feedback: [],
      feedbackSummary: { mostCommonRequests: [], criticalBugs: 0, suggestions: 0, resolved: 0 },
      announcements: [],
    },
  };
}

function systemHealthPayload() {
  return {
    status: "degraded",
    checkedAt: "2026-09-03T20:00:00.000Z",
    durationMs: 24,
    release: "7d3dada9e916",
    environment: "production",
    checks: [{
      key: "marketplace_operations",
      label: "Marketplace operations",
      status: "degraded",
      detail: "One marketplace item requires owner attention.",
      latencyMs: 12,
    }],
    operations: {
      status: "attention",
      generatedAt: "2026-09-03T20:00:00.000Z",
      activeTrades: 2,
      pendingPriceOffers: 3,
      stalePriceOffers: 1,
      stalledTrades: 0,
      overdueUsdtReleases: 0,
      dataIntegrityIssues: 0,
      incidents: [{
        id: "stale-price-offer:request-1",
        kind: "stale_price_offer",
        severity: "warning",
        requestId: "request-1",
        tradeId: "trade-1",
        listingId: "listing-123",
        status: "pending",
        ageMinutes: 42,
      }],
    },
  };
}

describe("AlphaExchangeAdminDashboard admin destinations", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    navigationState.search = "section=marketplace-listings&listing=listing-123";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("sms-deliveries")) return Response.json({ deliveries: [] });
      return Response.json(adminPayload());
    }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    scrollIntoView.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes review-open and locked trades in Completed and links owner details to the read-only room", async () => {
    navigationState.search = "section=purchase-requests";
    const purchaseRequests = ["review_open", "locked", "completed", "pending"].map((status, index) => ({
      id: `request-${index}`, buyerId: "buyer-1", buyerName: `Buyer ${index}`, sellerId: "seller-1", listingId: listing.id,
      status, usdtAmount: "100", fiatAmount: "320", currency: "ILS", paymentMethod: "Bank Transfer", network: "TRC20",
      timeline: [], createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
    }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...adminPayload(), purchaseRequests })));
    render(<AlphaExchangeAdminDashboard isOwner />);
    await screen.findByRole("heading", { name: "Purchase Requests" });
    const statusFilter = screen.getAllByRole("combobox").find((element) => within(element).queryByRole("option", { name: "Status: All" }));
    expect(statusFilter).toBeTruthy();
    fireEvent.change(statusFilter!, { target: { value: "completed" } });
    expect(screen.getAllByRole("button", { name: "View Details" })).toHaveLength(3);
    expect(screen.queryByText("Buyer 3")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "View Details" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Purchase Request Details" });
    expect(within(dialog).getByRole("link", { name: "Open trade room history" }).getAttribute("href")).toBe("/en/trade-room/request-0?view=history");
  });

  it.each(["completed", "review_open", "locked"])("returns from %s history with owner controls and safe completion state", async (status) => {
    navigationState.search = "section=purchase-requests&requestId=history-request&details=1";
    const purchaseRequests = [{
      id: "history-request", buyerId: "buyer-1", buyerName: "Historical Buyer", sellerId: "seller-1", listingId: listing.id,
      status, usdtAmount: "100", fiatAmount: "320", currency: "ILS", paymentMethod: "Bank Transfer", network: "TRC20",
      timeline: [], createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
    }];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...adminPayload(), purchaseRequests })));
    const { rerender } = render(<AlphaExchangeAdminDashboard isOwner />);
    const dialog = await screen.findByRole("dialog", { name: "Purchase Request Details" });
    expect(within(dialog).getByText("Historical Buyer")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Open trade room history" }).getAttribute("href")).toBe("/en/trade-room/history-request?view=history");
    expect((within(dialog).getByRole("button", { name: "Mark as completed" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Force close trade" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(dialog).getByRole("button", { name: "Unlock Review" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close request details" }));
    rerender(<AlphaExchangeAdminDashboard isOwner />);
    expect(screen.queryByRole("dialog", { name: "Purchase Request Details" })).toBeNull();
  });

  it("selects, filters, focuses, and scrolls to an exact listing target once per navigation", async () => {
    const { rerender } = render(<AlphaExchangeAdminDashboard />);

    await screen.findByRole("heading", { name: "Marketplace Listings" });
    const row = await waitFor(() => document.getElementById("marketplace-listing-listing-123"));
    expect(row).toBeTruthy();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(row);
    expect(row?.className).toContain("bg-[#C9A227]/10");

    navigationState.search = "section=marketplace-listings";
    rerender(<AlphaExchangeAdminDashboard />);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

    navigationState.search = "section=marketplace-listings&listing=listing-123";
    rerender(<AlphaExchangeAdminDashboard />);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
  });

  it("keeps the listing section safe when an exact target is missing", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("sms-deliveries")) return Response.json({ deliveries: [] });
      return Response.json(adminPayload([]));
    });
    navigationState.search = "section=marketplace-listings&listing=listing-missing";

    render(<AlphaExchangeAdminDashboard />);

    expect(await screen.findByRole("heading", { name: "Marketplace Listings" })).toBeTruthy();
    expect(await screen.findByText("The requested marketplace listing is no longer available.")).toBeTruthy();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps the core dashboard available when the optional SMS feed fails", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("sms-deliveries")) throw new Error("SMS feed unavailable");
      return Response.json(adminPayload());
    });

    render(<AlphaExchangeAdminDashboard />);

    expect(await screen.findByRole("heading", { name: "Marketplace Listings" })).toBeTruthy();
    expect(screen.queryByText("We could not load dashboard data right now. Please refresh and try again.")).toBeNull();
  });

  it("renders the mobile owner listing destination in Arabic without English fallback copy", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("sms-deliveries")) return Response.json({ deliveries: [] });
      return Response.json(adminPayload([]));
    });
    navigationState.search = "section=marketplace-listings&listing=listing-missing";

    render(<AlphaExchangeAdminDashboard locale="ar" />);

    expect(await screen.findByRole("heading", { name: "عروض السوق" })).toBeTruthy();
    expect(await screen.findByText("عرض السوق المطلوب لم يعد متاحًا.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "فتح طلبات الشراء والصفقات" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Marketplace Listings" })).toBeNull();
  });

  it("requires and submits both language editions for a beta announcement", async () => {
    navigationState.search = "section=private-beta";
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("sms-deliveries")) return Response.json({ deliveries: [] });
      if (String(input).endsWith("/private-beta/announcements") && init?.method === "POST") {
        return Response.json({ announcement: { id: "announcement-1" } }, { status: 201 });
      }
      return Response.json(adminPayload());
    });

    render(<AlphaExchangeAdminDashboard locale="ar" />);

    expect(await screen.findByText("التحكم بالوصول")).toBeTruthy();
    const publishButton = screen.getByRole("button", { name: "نشر الإعلان" }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("العنوان بالإنجليزية"), { target: { value: "Scheduled maintenance" } });
    fireEvent.change(screen.getByLabelText("النص بالإنجليزية"), { target: { value: "The market will be unavailable briefly." } });
    fireEvent.change(screen.getByLabelText("العنوان بالعربية"), { target: { value: "صيانة مجدولة" } });
    fireEvent.change(screen.getByLabelText("النص بالعربية"), { target: { value: "سيتوقف السوق لفترة قصيرة." } });
    expect(publishButton.disabled).toBe(false);
    fireEvent.click(publishButton);

    await waitFor(() => {
      const request = vi.mocked(fetch).mock.calls.find(([input, init]) => String(input).endsWith("/private-beta/announcements") && init?.method === "POST");
      expect(request).toBeTruthy();
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({
        type: "maintenance",
        titleEn: "Scheduled maintenance",
        messageEn: "The market will be unavailable briefly.",
        titleAr: "صيانة مجدولة",
        messageAr: "سيتوقف السوق لفترة قصيرة.",
      });
    });
  });

  it("uses logical search spacing in the Arabic admin dashboard", async () => {
    navigationState.search = "section=marketplace-listings";

    render(<AlphaExchangeAdminDashboard locale="ar" />);

    await screen.findByRole("heading", { name: "عروض السوق" });
    const search = screen.getByPlaceholderText("ابحث بالبائع أو الكمية أو السعر...");
    const icon = search.parentElement?.querySelector("svg");
    expect(search.className).toContain("ps-9");
    expect(icon?.getAttribute("class")).toContain("start-3");
    expect(icon?.getAttribute("class")).not.toContain("left-3");
  });

  it("issues a real manual seller commission from the Commissions section", async () => {
    navigationState.search = "section=commissions";
    vi.stubGlobal("confirm", vi.fn(() => true));
    const seller = {
      id: "seller-manual-1",
      fullName: "Manual Commission Seller",
      email: "manual-seller@example.test",
      whatsappNumber: "+972500000000",
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const issuedCommission = {
      id: "commission-admin-manual-1",
      source: "admin_manual",
      sellerId: seller.id,
      issuedByUserId: "admin-1",
      issueReason: "Documented settlement adjustment",
      rate: 0,
      grossAmount: 0,
      commissionAmount: 12.5,
      paymentStatus: "pending",
      dueAt: "2026-09-20T20:59:59.999Z",
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    let issued = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("sms-deliveries")) return Response.json({ deliveries: [] });
      if (url.endsWith("/api/alpha-exchange/admin/commissions") && init?.method === "POST") {
        issued = true;
        return Response.json({ commission: issuedCommission }, { status: 201 });
      }
      return Response.json(adminPayload([listing], [seller], issued ? [issuedCommission] : []));
    });

    render(<AlphaExchangeAdminDashboard />);

    expect(await screen.findByRole("heading", { name: "Commissions" })).toBeTruthy();
    expect(screen.getByText("Issue Seller Commission")).toBeTruthy();
    expect(screen.getByText(/separate from Recovery Fees/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Seller"), { target: { value: seller.id } });
    fireEvent.change(screen.getByLabelText("Commission amount (USDT)"), { target: { value: "12.50" } });
    fireEvent.change(screen.getByLabelText("Seller-visible reason"), { target: { value: "Documented settlement adjustment" } });
    const issueButton = screen.getByRole("button", { name: "Issue Commission & Notify Seller" }) as HTMLButtonElement;
    expect(issueButton.disabled).toBe(false);
    fireEvent.click(issueButton);

    await waitFor(() => {
      const request = vi.mocked(fetch).mock.calls.find(([input, init]) => String(input).endsWith("/api/alpha-exchange/admin/commissions") && init?.method === "POST");
      expect(request).toBeTruthy();
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({
        sellerId: seller.id,
        commissionAmount: 12.5,
        reason: "Documented settlement adjustment",
      });
    });
    expect(await screen.findByText("Admin-issued")).toBeTruthy();
    expect(screen.getByText("Documented settlement adjustment")).toBeTruthy();
    expect(screen.queryByText("Trade #commission-admin-manual-1")).toBeNull();
  });

  it("renders phone-safe commission cards and marks a payment paid through the in-page dialog", async () => {
    navigationState.search = "section=commissions";
    const seller = {
      id: "seller-rayan-1",
      fullName: "Rayan Mariah",
      email: "rayan@example.test",
      whatsappNumber: "+972500000001",
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const commission = {
      id: "commission-rayan-1",
      source: "admin_manual",
      sellerId: seller.id,
      issuedByUserId: "admin-1",
      issueReason: "Trade commission adjustment",
      rate: 0,
      grossAmount: 0,
      commissionAmount: 4.18,
      paymentExpectedAmount: 4.180001,
      paymentExpectedAmountMode: "unique_v1",
      paymentExpectedAmountAssignedAt: "2026-09-12T17:30:00.000Z",
      paymentStatus: "overdue",
      dueAt: "2026-09-12T20:30:00.000Z",
      createdAt: "2026-09-04T17:30:00.000Z",
      updatedAt: "2026-09-12T17:30:00.000Z",
    };
    const paidCommission = {
      ...commission,
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentVerificationNotes: "Received via Binance internal transfer 410678442518.",
      paidAt: "2026-09-13T12:15:30.000Z",
      updatedAt: "2026-09-13T12:15:30.000Z",
    };
    let settled = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("sms-deliveries")) return Response.json({ deliveries: [] });
      if (url.endsWith(`/api/alpha-exchange/admin/commissions/${commission.id}`) && init?.method === "PATCH") {
        settled = true;
        return Response.json({ commission: paidCommission });
      }
      return Response.json(adminPayload([listing], [seller], [settled ? paidCommission : commission]));
    });

    render(<AlphaExchangeAdminDashboard />);

    expect(await screen.findByRole("heading", { name: "Commissions" })).toBeTruthy();
    const cardList = screen.getByTestId("commission-card-list");
    const card = within(cardList).getByTestId(`commission-card-${commission.id}`);
    expect(within(card).getByText("Rayan Mariah")).toBeTruthy();
    expect(within(card).getByText((_, element) => element?.textContent === "4.180001 USDT" && !Array.from(element.children).some(child => child.textContent === "4.180001 USDT"))).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();

    const markPaid = within(card).getByRole("button", { name: "Mark Paid" });
    expect(markPaid.className).toContain("w-full");
    expect(markPaid.className).toContain("h-12");
    fireEvent.click(markPaid);

    const dialog = await screen.findByRole("dialog", { name: "Confirm commission payment" });
    expect(within(dialog).getByText("Rayan Mariah")).toBeTruthy();
    expect(within(dialog).getByText((_, element) => element?.textContent === "4.180001 USDT" && !Array.from(element.children).some(child => child.textContent === "4.180001 USDT"))).toBeTruthy();
    const reason = within(dialog).getByLabelText("Payment reference or reason") as HTMLTextAreaElement;
    fireEvent.change(reason, { target: { value: "Received via Binance internal transfer 410678442518." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm & Mark Paid" }));

    await waitFor(() => {
      const request = vi.mocked(fetch).mock.calls.find(([input, init]) => (
        String(input).endsWith(`/api/alpha-exchange/admin/commissions/${commission.id}`)
        && init?.method === "PATCH"
      ));
      expect(request).toBeTruthy();
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({
        paymentStatus: "paid",
        paymentVerificationStatus: "verified",
        paymentVerificationNotes: "Received via Binance internal transfer 410678442518.",
        reason: "Received via Binance internal transfer 410678442518.",
      });
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Confirm commission payment" })).toBeNull());
    expect(await screen.findByText("Payment settled")).toBeTruthy();
    expect(screen.getByText("Commission marked paid. Seller confirmation was sent.")).toBeTruthy();
  });

  it("keeps the payment dialog open and shows the API error when settlement fails", async () => {
    navigationState.search = "section=commissions";
    const seller = {
      id: "seller-payment-error",
      fullName: "Payment Error Seller",
      email: "payment-error@example.test",
      whatsappNumber: "+972500000002",
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const commission = {
      id: "commission-payment-error",
      source: "admin_manual",
      sellerId: seller.id,
      issueReason: "Manual payment test",
      rate: 0,
      grossAmount: 0,
      commissionAmount: 5.68,
      paymentExpectedAmount: 5.680001,
      paymentStatus: "pending",
      dueAt: "2026-09-20T00:00:00.000Z",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("sms-deliveries")) return Response.json({ deliveries: [] });
      if (url.endsWith(`/api/alpha-exchange/admin/commissions/${commission.id}`) && init?.method === "PATCH") {
        return Response.json({ error: "Commission record changed. Refresh and try again." }, { status: 409 });
      }
      return Response.json(adminPayload([listing], [seller], [commission]));
    });

    render(<AlphaExchangeAdminDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark Paid" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm commission payment" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm & Mark Paid" }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain("Commission record changed. Refresh and try again.");
    expect(screen.getByRole("dialog", { name: "Confirm commission payment" })).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Confirm & Mark Paid" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("requires and submits both language editions for an emergency broadcast", async () => {
    navigationState.search = "section=emergency";
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("prompt", vi.fn(() => "Operational notice"));
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("sms-deliveries")) return Response.json({ deliveries: [] });
      if (String(input).endsWith("/notifications/broadcast") && init?.method === "POST") {
        return Response.json({ success: true });
      }
      return Response.json(adminPayload());
    });

    render(<AlphaExchangeAdminDashboard locale="ar" />);

    expect(await screen.findByText("إجراءات الطوارئ")).toBeTruthy();
    const broadcastButton = screen.getByRole("button", { name: "إرسال إلى الجميع" }) as HTMLButtonElement;
    expect(broadcastButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("العنوان بالإنجليزية"), { target: { value: "Scheduled maintenance" } });
    fireEvent.change(screen.getByLabelText("النص بالإنجليزية"), { target: { value: "Trading will pause briefly." } });
    fireEvent.change(screen.getByLabelText("العنوان بالعربية"), { target: { value: "صيانة مجدولة" } });
    fireEvent.change(screen.getByLabelText("النص بالعربية"), { target: { value: "سيتوقف التداول لفترة قصيرة." } });
    expect(broadcastButton.disabled).toBe(false);
    fireEvent.click(broadcastButton);

    await waitFor(() => {
      const broadcastRequest = vi.mocked(fetch).mock.calls.find(([input, init]) => String(input).endsWith("/notifications/broadcast") && init?.method === "POST");
      expect(broadcastRequest).toBeTruthy();
      expect(JSON.parse(String(broadcastRequest?.[1]?.body))).toEqual({
        titleEn: "Scheduled maintenance",
        bodyEn: "Trading will pause briefly.",
        titleAr: "صيانة مجدولة",
        bodyAr: "سيتوقف التداول لفترة قصيرة.",
        type: "info",
        reason: "Operational notice",
      });
    });
  });

  it("shows live marketplace incidents and opens the exact trade for review", async () => {
    navigationState.search = "section=system-health";
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("sms-deliveries")) return Response.json({ deliveries: [] });
      if (String(input).includes("/api/admin/system-health")) return Response.json(systemHealthPayload());
      return Response.json(adminPayload());
    });

    render(<AlphaExchangeAdminDashboard />);

    expect(await screen.findByText("Marketplace Operational Guard")).toBeTruthy();
    expect(screen.getByText("Price offer waiting for seller response")).toBeTruthy();
    expect(screen.getByText("Stale offers")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Trade" }));

    expect(await screen.findByRole("heading", { name: "Purchase Requests" })).toBeTruthy();
    expect((screen.getByPlaceholderText("Search buyer, seller, listing...") as HTMLInputElement).value).toBe("request-1");
  });

  it("renders the operational guard completely in Arabic", async () => {
    navigationState.search = "section=system-health";
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("sms-deliveries")) return Response.json({ deliveries: [] });
      if (String(input).includes("/api/admin/system-health")) return Response.json(systemHealthPayload());
      return Response.json(adminPayload());
    });

    render(<AlphaExchangeAdminDashboard locale="ar" />);

    expect(await screen.findByText("مراقبة عمليات السوق")).toBeTruthy();
    expect(screen.getByText("عرض سعر بانتظار رد البائع")).toBeTruthy();
    expect(screen.getByText("عروض بلا رد")).toBeTruthy();
    expect(screen.getByRole("button", { name: "فتح الصفقة" })).toBeTruthy();
    expect(screen.queryByText("Marketplace Operational Guard")).toBeNull();
  });
});
