import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AlphaExchangeAdminDashboard } from "@/components/admin/alpha-exchange-admin-dashboard";

const navigationState = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigationState.search),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: (input: React.HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => {
      const { children, ...props } = input;
      delete props.initial;
      delete props.animate;
      delete props.exit;
      delete props.transition;
      return <div {...props}>{children}</div>;
    },
  },
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
    privateBeta: { feedback: [] },
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
});
