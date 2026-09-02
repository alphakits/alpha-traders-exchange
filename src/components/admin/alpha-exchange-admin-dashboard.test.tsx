import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function adminPayload(listings = [listing]) {
  return {
    applications: [],
    approvedSellers: [],
    listings,
    purchaseRequests: [],
    commissionRecords: [],
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
});
