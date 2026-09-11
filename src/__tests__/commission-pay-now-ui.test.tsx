import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
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

const suspendedSeller = {
  ...seller,
  role: "buyer" as const,
  roles: ["buyer" as const],
  sellerStatus: "suspended" as const,
};

let commissionRecordVerification: {
  paymentVerificationStatus?: "pending_verification" | "verified" | "failed";
  paymentVerificationNotes?: string;
  paymentSignature?: string;
  paymentSubmittedAt?: string;
  paymentExpectedAmountMode?: "unique_v1" | "legacy_base";
} = {};

type MockPayableCommission = {
  commissionId: string;
  amountDue: number;
  paymentAmountDue: number;
  relatedRequestId?: string;
  relatedTradeId?: string;
  relatedTradeDisplayNumber?: number;
  dueAt: string;
  source?: string;
  issueReason?: string;
  paymentVerificationStatus?: "pending_verification" | "verified" | "failed";
  paymentVerificationNotes?: string;
  paymentSignature?: string;
  paymentSubmittedAt?: string;
  paymentExpectedAmountMode?: "unique_v1" | "legacy_base";
};

let commissionRecordsOverride: MockPayableCommission[] | null = null;
let workspaceCanCreateListingOverride: boolean | null = null;
let commissionPaymentResponse: {
  verification: { verified: boolean; pending?: boolean; notes: string };
} = { verification: { verified: false, pending: true, notes: "Waiting for TRON final confirmation." } };
let commissionPaymentSideEffect: ((commissionId: string) => void) | null = null;
let notificationStreamListener: EventListener | null = null;

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
    commissionRecordVerification = {};
    commissionRecordsOverride = null;
    workspaceCanCreateListingOverride = null;
    commissionPaymentResponse = { verification: { verified: false, pending: true, notes: "Waiting for TRON final confirmation." } };
    commissionPaymentSideEffect = null;
    notificationStreamListener = null;
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
        addEventListener(type: string, listener: EventListener) {
          if (type === "notifications") notificationStreamListener = listener;
        }
        removeEventListener(type: string, listener: EventListener) {
          if (type === "notifications" && notificationStreamListener === listener) notificationStreamListener = null;
        }
        close() {}
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/alpha-exchange/commissions/pay")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { commissionId?: string };
        commissionPaymentSideEffect?.(body.commissionId ?? "");
        return jsonResponse(commissionPaymentResponse);
      }
      if (url.includes("/api/alpha-exchange/my-listings")) {
        const defaultRecords: MockPayableCommission[] = [{
          commissionId: "commission-trade-93",
          amountDue: 7,
          paymentAmountDue: 7.000001,
          relatedRequestId: "request-trade-93",
          relatedTradeId: "trade-93",
          relatedTradeDisplayNumber: 93,
          dueAt: "2026-09-11T00:00:00.000Z",
          ...commissionRecordVerification,
        }];
        const payableRecords = commissionRecordsOverride ?? defaultRecords;
        const requestedCommissionId = new URL(url, window.location.origin).searchParams.get("commissionId");
        const primaryRecord = requestedCommissionId
          ? payableRecords.find((record) => record.commissionId === requestedCommissionId)
          : payableRecords[0];
        const totalAmountDue = payableRecords.reduce((sum, record) => sum + record.amountDue, 0);
        const canCreateListing = workspaceCanCreateListingOverride ?? payableRecords.length === 0;
        return jsonResponse({
          listings: [],
          summary: {
            activeListingLimit: 2,
            openListingCount: 0,
            openTradeCount: 0,
            pendingCommissionCount: payableRecords.length,
            canCreateListing,
            blockedReason: !canCreateListing
              ? "Your listings are hidden and all new marketplace trading is locked until every pending commission is paid."
              : null,
          },
          commissionStatus: {
            status: payableRecords.length > 0 ? "pending" : "clear",
            pendingCount: payableRecords.length,
            amountDue: totalAmountDue,
            totalAmountDue,
            payableAmountDue: primaryRecord?.paymentAmountDue ?? 0,
            commissionId: primaryRecord?.commissionId,
            relatedRequestId: primaryRecord?.relatedRequestId,
            relatedTradeId: primaryRecord?.relatedTradeId,
            relatedTradeDisplayNumber: primaryRecord?.relatedTradeDisplayNumber,
            dueAt: primaryRecord?.dueAt,
            source: primaryRecord?.source,
            issueReason: primaryRecord?.issueReason,
            selectionError: requestedCommissionId && !primaryRecord
              ? "The requested commission is not available for payment."
              : undefined,
            payableRecords,
          },
          commissionWalletConfiguration: {
            TRC20: { available: true, error: null },
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
    cleanup();
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
      expect(element?.textContent).toContain("7.000001 USDT");
      return element!;
    });
    expect(routerPush).not.toHaveBeenCalled();

    fireEvent.click(within(firstPanel).getByRole("button", { name: "Copy exact commission amount" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("7.000001"));

    fireEvent.click(within(firstPanel).getByRole("button", { name: /Crypto Exchange or Broker/i }));
    await waitFor(() => {
      expect(firstPanel.textContent).toContain("TRC20");
      expect(firstPanel.textContent).toContain("TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8");
      expect(within(firstPanel).getByPlaceholderText("64-character TRON TxID")).not.toBeNull();
    });

    fireEvent.click(within(firstPanel).getByRole("button", { name: "Close commission payment" }));
    await waitFor(() => expect(document.getElementById("commission-payment")).toBeNull());

    const createListing = document.getElementById("create-listing");
    expect(createListing).not.toBeNull();
    fireEvent.click(within(createListing!).getByRole("button", { name: "Pay Now" }));

    await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("7.000001 USDT");
    });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("refreshes an already-open seller workspace when an admin issues a commission", async () => {
    commissionRecordsOverride = [];
    render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);

    const commissionStatus = await waitFor(() => {
      const element = document.getElementById("commission-status");
      expect(element?.textContent).toContain("No commission due");
      expect(notificationStreamListener).not.toBeNull();
      return element!;
    });

    commissionRecordsOverride = [{
      commissionId: "commission-admin-1",
      amountDue: 12.5,
      paymentAmountDue: 12.500001,
      dueAt: "2026-09-15T00:00:00.000Z",
      source: "admin_manual",
      issueReason: "Documented seller adjustment",
    }];
    act(() => {
      notificationStreamListener?.(new MessageEvent("notifications", {
        data: JSON.stringify({
          unreadCount: 1,
          notifications: [{
            id: "notification-admin-commission-1",
            userId: seller.id,
            category: "trade",
            title: "Commission payment required",
            message: "An administrator issued a commission.",
            isRead: false,
            reason: "commission_payment_due",
            actionHref: "/usdt-exchange?commission=pay&commissionId=commission-admin-1#commission-payment",
            createdAt: "2026-09-12T00:00:00.000Z",
          }],
        }),
      }));
    });

    await waitFor(() => {
      expect(commissionStatus.textContent).toContain("Commission Due");
      expect(commissionStatus.textContent).toContain("12.50 USDT");
      expect(within(commissionStatus).getByRole("button", { name: "Pay Now" })).not.toBeNull();
    });
  });

  it("shows a trade-less manual commission as admin-issued and keeps it payable", async () => {
    commissionRecordsOverride = [{
      commissionId: "commission-admin-2",
      amountDue: 9,
      paymentAmountDue: 9.000001,
      dueAt: "2026-09-15T00:00:00.000Z",
      source: "admin_manual",
      issueReason: "Seller support adjustment approved by administration",
    }];
    render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);

    const commissionStatus = await waitFor(() => {
      const element = document.getElementById("commission-status");
      expect(element?.textContent).toContain("Admin-issued commission");
      expect(element?.textContent).toContain("Seller support adjustment approved by administration");
      expect(element?.textContent).not.toContain("Trade reference");
      return element!;
    });
    fireEvent.click(within(commissionStatus).getByRole("button", { name: "Pay Now" }));

    const paymentPanel = await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element?.textContent).toContain("Admin-issued commission");
      expect(element?.textContent).toContain("9.000001 USDT");
      return element!;
    });
    fireEvent.click(within(paymentPanel).getByRole("button", { name: /Crypto Exchange or Broker/i }));
    expect(paymentPanel.textContent).toContain("TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8");
  });

  it("keeps a suspended seller in the payment workspace while listing creation stays blocked", async () => {
    navigationState.search = "commission=pay&commissionId=commission-trade-93";
    // Exercise the client-side status guard even if a stale workspace summary
    // incorrectly claims listing creation is available.
    workspaceCanCreateListingOverride = true;

    render(<UsdtExchangePage locale="en" initialSessionUser={suspendedSeller} workspaceMode="seller" />);

    const paymentPanel = await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("7.000001 USDT");
      return element!;
    });
    fireEvent.click(within(paymentPanel).getByRole("button", { name: /Crypto Exchange or Broker/i }));
    expect(paymentPanel.textContent).toContain("TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8");
    expect(document.body.textContent).toContain("Seller account suspended");
    expect(fetch).toHaveBeenCalledWith(
      "/api/alpha-exchange/my-listings?commissionId=commission-trade-93",
      expect.objectContaining({ cache: "no-store" }),
    );

    const createListing = document.getElementById("create-listing");
    expect(createListing).not.toBeNull();
    expect(createListing?.textContent).toContain("Your seller account is suspended");
    expect((within(createListing!).getByRole("button", { name: "Submit Listing" }) as HTMLButtonElement).disabled).toBe(true);
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
      expect(element?.textContent).toContain("7.000001 USDT");
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/alpha-exchange/my-listings?commissionId=commission-trade-93",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("restores a pending verification banner and still accepts a replacement TxID", async () => {
    commissionRecordVerification = {
      paymentVerificationStatus: "pending_verification",
      paymentVerificationNotes: "Waiting for TRON final confirmation.",
      paymentSignature: "a".repeat(64),
      paymentSubmittedAt: "2026-09-10T12:30:00.000Z",
      paymentExpectedAmountMode: "unique_v1",
    };

    render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);
    const commissionStatus = await waitFor(() => {
      const element = document.getElementById("commission-status");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("7.00 USDT");
      return element!;
    });
    fireEvent.click(within(commissionStatus).getByRole("button", { name: "Pay Now" }));

    const panel = await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element).not.toBeNull();
      expect(within(element!).getByTestId("commission-payment-pending").textContent).toContain("Payment verification pending");
      return element!;
    });
    expect(panel.textContent).toContain("Waiting for TRON final confirmation.");
    expect(panel.textContent).toContain("aaaaaaaa…aaaaaaaa");
    expect(panel.textContent).toContain("paste a replacement TRON TxID below");

    fireEvent.click(within(panel).getByRole("button", { name: /Crypto Exchange or Broker/i }));
    const input = within(panel).getByPlaceholderText("64-character TRON TxID") as HTMLInputElement;
    const replacementTxId = "b".repeat(64);
    fireEvent.change(input, { target: { value: replacementTxId } });
    expect(input.value).toBe(replacementTxId);
    expect((within(panel).getByRole("button", { name: "Verify Payment" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps a grandfathered pending payment bound to its original TxID", async () => {
    commissionRecordVerification = {
      paymentVerificationStatus: "pending_verification",
      paymentVerificationNotes: "Waiting for TRON final confirmation.",
      paymentSignature: "a".repeat(64),
      paymentSubmittedAt: "2026-09-10T12:30:00.000Z",
      paymentExpectedAmountMode: "legacy_base",
    };

    render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);
    const commissionStatus = await waitFor(() => {
      const element = document.getElementById("commission-status");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("7.00 USDT");
      return element!;
    });
    fireEvent.click(within(commissionStatus).getByRole("button", { name: "Pay Now" }));

    const panel = await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element).not.toBeNull();
      return element!;
    });
    const pending = within(panel).getByTestId("commission-payment-pending");
    expect(pending.textContent).toContain("original TxID is bound");
    expect(pending.textContent).toContain("Automatic verification will continue");
    expect(pending.textContent).toContain("do not pay again");
    expect(pending.textContent).toContain("contact Alpha Traders support");
    expect(panel.textContent).not.toContain("paste a replacement TRON TxID below");
    expect(panel.textContent).not.toContain("Pay this commission");
    expect(within(panel).queryByRole("button", { name: "Copy exact commission amount" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Crypto Exchange or Broker/i })).toBeNull();
    expect(within(panel).queryByPlaceholderText("64-character TRON TxID")).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Verify Payment" })).toBeNull();
  });

  it("restores a failed verification reason and prompts for the corrected TxID", async () => {
    commissionRecordVerification = {
      paymentVerificationStatus: "failed",
      paymentVerificationNotes: "The transfer amount did not exactly match the requested commission.",
      paymentSignature: "c".repeat(64),
      paymentSubmittedAt: "2026-09-10T12:35:00.000Z",
    };

    render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);
    const commissionStatus = await waitFor(() => {
      const element = document.getElementById("commission-status");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("7.00 USDT");
      return element!;
    });
    fireEvent.click(within(commissionStatus).getByRole("button", { name: "Pay Now" }));

    const panel = await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element).not.toBeNull();
      expect(within(element!).getByTestId("commission-payment-failed").textContent).toContain("Payment verification failed");
      return element!;
    });
    expect(panel.textContent).toContain("The transfer amount did not exactly match the requested commission.");
    expect(panel.textContent).toContain("cccccccc…cccccccc");
    expect(panel.textContent).toContain("paste the correct TRON TxID below");

    fireEvent.click(within(panel).getByRole("button", { name: /Crypto Exchange or Broker/i }));
    const input = within(panel).getByPlaceholderText("64-character TRON TxID") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "d".repeat(64) } });
    expect(input.value).toBe("d".repeat(64));
    expect((within(panel).getByRole("button", { name: "Verify Payment" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps a pending submission bound to the selected commission when several dues exist", async () => {
    commissionRecordsOverride = [
      {
        commissionId: "commission-trade-93",
        amountDue: 7,
        paymentAmountDue: 7.000001,
        relatedRequestId: "request-trade-93",
        relatedTradeId: "trade-93",
        relatedTradeDisplayNumber: 93,
        dueAt: "2026-09-11T00:00:00.000Z",
      },
      {
        commissionId: "commission-trade-94",
        amountDue: 8,
        paymentAmountDue: 8.000001,
        relatedRequestId: "request-trade-94",
        relatedTradeId: "trade-94",
        relatedTradeDisplayNumber: 94,
        dueAt: "2026-09-12T00:00:00.000Z",
      },
    ];
    commissionPaymentSideEffect = (commissionId) => {
      commissionRecordsOverride = (commissionRecordsOverride ?? []).map((record) => record.commissionId === commissionId
        ? {
            ...record,
            paymentVerificationStatus: "pending_verification",
            paymentVerificationNotes: "Waiting for TRON final confirmation.",
            paymentSignature: "e".repeat(64),
            paymentSubmittedAt: "2026-09-10T13:00:00.000Z",
          }
        : record);
    };

    render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);
    const commissionStatus = await waitFor(() => {
      const element = document.getElementById("commission-status");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("Choose one unpaid commission to pay.");
      return element!;
    });
    fireEvent.click(within(commissionStatus).getByRole("button", { name: /Trade #94/i }));
    const panel = await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element?.textContent).toContain("8.000001 USDT");
      return element!;
    });
    fireEvent.click(within(panel).getByRole("button", { name: /Crypto Exchange or Broker/i }));
    fireEvent.change(within(panel).getByPlaceholderText("64-character TRON TxID"), {
      target: { value: "e".repeat(64) },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Verify Payment" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/alpha-exchange/my-listings?commissionId=commission-trade-94",
        expect.objectContaining({ cache: "no-store" }),
      );
      const refreshedPanel = document.getElementById("commission-payment");
      expect(refreshedPanel?.textContent).toContain("8.000001 USDT");
      expect(refreshedPanel?.textContent).not.toContain("7.000001 USDT");
      expect(within(refreshedPanel!).getByTestId("commission-payment-pending")).not.toBeNull();
      expect(within(refreshedPanel!).getByRole("button", { name: "Verify Payment" })).not.toBeNull();
    });
  });

  it("closes the obsolete payment panel after verification instead of retargeting its result", async () => {
    commissionRecordsOverride = [{
      commissionId: "commission-trade-93",
      amountDue: 7,
      paymentAmountDue: 7.000001,
      relatedRequestId: "request-trade-93",
      relatedTradeId: "trade-93",
      relatedTradeDisplayNumber: 93,
      dueAt: "2026-09-11T00:00:00.000Z",
    }];
    commissionPaymentResponse = {
      verification: { verified: true, notes: "Verified on TRON." },
    };
    let settleOnSubmit = false;
    commissionPaymentSideEffect = () => {
      if (settleOnSubmit) commissionRecordsOverride = [];
    };

    render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);
    const commissionStatus = await waitFor(() => {
      const element = document.getElementById("commission-status");
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain("7.00 USDT");
      return element!;
    });
    fireEvent.click(within(commissionStatus).getByRole("button", { name: "Pay Now" }));
    const panel = await waitFor(() => {
      const element = document.getElementById("commission-payment");
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.click(within(panel).getByRole("button", { name: /Crypto Exchange or Broker/i }));
    fireEvent.change(within(panel).getByPlaceholderText("64-character TRON TxID"), {
      target: { value: "f".repeat(64) },
    });
    settleOnSubmit = true;
    fireEvent.click(within(panel).getByRole("button", { name: "Verify Payment" }));

    await waitFor(() => {
      expect(document.getElementById("commission-payment")).toBeNull();
      expect(document.body.textContent).toContain("Payment verified. All commission dues are settled");
      expect(document.body.textContent).not.toContain("0.000000 USDT");
    });
  });

  it("closes a pending payment panel when background verification settles that commission", async () => {
    commissionRecordVerification = {
      paymentVerificationStatus: "pending_verification",
      paymentVerificationNotes: "Waiting for TRON final confirmation.",
      paymentSignature: "a".repeat(64),
      paymentSubmittedAt: "2026-09-10T12:30:00.000Z",
    };

    render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);
    const commissionStatus = await waitFor(() => {
      const element = document.getElementById("commission-status");
      expect(element?.textContent).toContain("7.00 USDT");
      return element!;
    });
    fireEvent.click(within(commissionStatus).getByRole("button", { name: "Pay Now" }));
    await waitFor(() => {
      expect(within(document.getElementById("commission-payment")!).getByTestId("commission-payment-pending")).not.toBeNull();
    });

    commissionRecordsOverride = [];
    fireEvent(window, new Event("focus"));

    await waitFor(() => {
      expect(document.getElementById("commission-payment")).toBeNull();
      expect(document.body.textContent).toContain("Payment verified. All commission dues are settled.");
      expect(document.body.textContent).not.toContain("0.000000 USDT");
    });
  });

  it("refreshes a pending commission after the seller returns to the page", async () => {
    commissionRecordVerification = {
      paymentVerificationStatus: "pending_verification",
      paymentVerificationNotes: "Waiting for TRON final confirmation.",
      paymentSignature: "a".repeat(64),
      paymentSubmittedAt: "2026-09-10T12:30:00.000Z",
    };
    const intervalSpy = vi.spyOn(window, "setInterval");

    render(<UsdtExchangePage locale="en" initialSessionUser={seller} />);
    await waitFor(() => {
      expect(document.getElementById("commission-status")).not.toBeNull();
      expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    });
    const callsBeforeFocus = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("/api/alpha-exchange/my-listings")).length;
    commissionRecordVerification = {
      paymentVerificationStatus: "failed",
      paymentVerificationNotes: "The submitted TxID was not found on TRON.",
      paymentSignature: "a".repeat(64),
      paymentSubmittedAt: "2026-09-10T12:30:00.000Z",
    };
    fireEvent(window, new Event("focus"));

    await waitFor(() => {
      const callsAfterFocus = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("/api/alpha-exchange/my-listings")).length;
      expect(callsAfterFocus).toBeGreaterThan(callsBeforeFocus);
    });
    const commissionStatus = document.getElementById("commission-status")!;
    fireEvent.click(within(commissionStatus).getByRole("button", { name: "Pay Now" }));
    await waitFor(() => {
      expect(within(document.getElementById("commission-payment")!).getByTestId("commission-payment-failed").textContent)
        .toContain("The submitted TxID was not found on TRON.");
    });
    intervalSpy.mockRestore();
  });
});
