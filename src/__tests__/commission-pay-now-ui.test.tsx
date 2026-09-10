import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";

const routerPush = vi.fn();
const navigationState = vi.hoisted(() => ({ search: "" }));

vi.mock("next/image", () => ({
  default: () => <span data-testid="next-image" />,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigationState.search),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const seller = {
  id: "seller-commission-ui",
  fullName: "Wasim Seller",
  email: "wasim@example.test",
  role: "approved_seller" as const,
  roles: ["approved_seller" as const, "buyer" as const],
  sellerStatus: "approved_seller" as const,
  whatsappNumber: "",
  preferredNetworks: [],
  preferredPaymentMethods: [],
  profilePhotoUrl: "",
  languages: ["English"],
  bio: "",
  country: "Israel",
  city: "",
  onlineStatus: "online" as const,
  availabilityStatus: "available" as const,
  createdAt: "2026-09-04T00:00:00.000Z",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("seller commission Pay Now", () => {
  beforeEach(() => {
    routerPush.mockReset();
    navigationState.search = "";
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("max-width: 768px"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      writable: true,
      value: class {
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    });

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/alpha-exchange/my-listings")) {
        return jsonResponse({
          listings: [],
          summary: {
            activeListingLimit: 2,
            openListingCount: 0,
            openTradeCount: 0,
            pendingCommissionCount: 1,
            canCreateListing: false,
            blockedReason: "Your listings are hidden and all new marketplace trading is locked until every pending commission is paid.",
          },
          commissionStatus: {
            status: "pending",
            pendingCount: 1,
            amountDue: 7,
            totalAmountDue: 7,
            payableAmountDue: 7,
            commissionId: "commission-trade-93",
            relatedRequestId: "request-trade-93",
            relatedTradeId: "trade-93",
            relatedTradeDisplayNumber: 93,
            dueAt: "2026-09-11T00:00:00.000Z",
            payableRecords: [{
              commissionId: "commission-trade-93",
              amountDue: 7,
              relatedRequestId: "request-trade-93",
              relatedTradeId: "trade-93",
              relatedTradeDisplayNumber: 93,
              dueAt: "2026-09-11T00:00:00.000Z",
            }],
          },
          commissionWalletConfiguration: {
            ERC20: { available: true, error: null },
            POLYGON: { available: true, error: null },
            SOL: { available: true, error: null },
          },
        });
      }
      if (url.includes("/api/alpha-exchange/listings")) return jsonResponse({ listings: [] });
      if (url.includes("/api/alpha-exchange/purchase-requests")) return jsonResponse({ requests: [] });
      if (url.includes("/api/alpha-exchange/discord-sharing")) {
        return jsonResponse({ serverTime: new Date().toISOString(), nextEligibleAt: null, cooldownSecondsRemaining: 0, linked: false, available: false, listings: [] });
      }
      if (url.includes("/api/alpha-exchange/seller-application")) return jsonResponse({ application: null });
      if (url.includes("/api/alpha-exchange/notification-preferences")) {
        return jsonResponse({ preferences: { inApp: true, email: true, sms: false } });
      }
      if (url.includes("/api/alpha-exchange/notifications")) {
        return jsonResponse({ notifications: [], activity: [], unreadCount: 0 });
      }
      return jsonResponse({});
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the exact payment panel in place from both mobile buttons", async () => {
    render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);

    const commissionStatus = await waitFor(() => {
      const element = document.getElementById("commission-status");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("7.00 USDT");
      return element!;
    });

    fireEvent.click(within(commissionStatus).getByRole("button", { name: "Pay Now" }));

    const firstPanel = await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("Commission Payment");
      expect(element?.textContent).toContain("7.00 USDT");
      return element!;
    });
    expect(routerPush).not.toHaveBeenCalled();

    fireEvent.click(within(firstPanel).getByRole("button", { name: "Close commission payment" }));
    await waitFor(() => expect(document.getElementById("commission-payment")).toBeNull());

    const createListing = document.getElementById("create-listing");
    expect(createListing).not.toBeNull();
    fireEvent.click(within(createListing!).getByRole("button", { name: "Pay Now" }));

    await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("7.00 USDT");
    });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("reacts to a commission reminder routed onto an already-mounted exchange page", async () => {
    const view = render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);

    await waitFor(() => {
      expect(document.getElementById("commission-status")).not.toBeNull();
    });
    expect(document.getElementById("commission-payment")).toBeNull();

    navigationState.search = "commission=pay&commissionId=commission-trade-93";
    view.rerender(<UsdtExchangePage locale="en" initialSessionUser={seller} />);

    await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("7.00 USDT");
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/alpha-exchange/my-listings?commissionId=commission-trade-93",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
