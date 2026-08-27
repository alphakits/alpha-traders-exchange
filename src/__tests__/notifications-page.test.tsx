import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsPage } from "@/components/notifications/notifications-page";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const routerPush = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const eventSourceInstances: MockEventSource[] = [];

class MockEventSource {
  private listeners = new Map<string, Set<(event: Event & { data?: string }) => void>>();

  constructor() {
    eventSourceInstances.push(this);
  }

  addEventListener(type: string, listener: (event: Event & { data?: string }) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event & { data?: string }) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as Event & { data?: string });
    }
  }

  close() {}
}

function notification(input: Partial<AlphaExchangeNotification> & Pick<AlphaExchangeNotification, "id" | "createdAt">): AlphaExchangeNotification {
  return {
    userId: "user-1",
    category: "account",
    title: "Account update",
    message: "Your account has a new update.",
    isRead: false,
    ...input,
  };
}

function notificationsResponse(notifications: AlphaExchangeNotification[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      notifications,
      total: notifications.length,
      unreadCount: notifications.filter((item) => !item.isRead).length,
    }),
  };
}

describe("NotificationsPage mobile hierarchy", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
    routerPush.mockReset();
    eventSourceInstances.length = 0;
    window.sessionStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      writable: true,
      value: MockEventSource,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("puts action-required items first, then groups the remaining history by day", async () => {
    const items = [
      notification({ id: "today", createdAt: "2026-08-27T11:50:00.000Z", title: "Account updated" }),
      notification({ id: "yesterday", createdAt: "2026-08-26T08:00:00.000Z", title: "Profile updated", isRead: true }),
      notification({ id: "earlier", createdAt: "2026-08-20T08:00:00.000Z", title: "Older account update", isRead: true }),
      notification({
        id: "action",
        createdAt: "2026-08-26T07:00:00.000Z",
        category: "listing",
        title: "Listing approval required",
        message: "Review this listing before it can go live.",
        priority: "high",
        actionHref: "/usdt-exchange?listing=review",
        actionLabel: "Review Listing",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(notificationsResponse(items)));

    const { container } = render(<NotificationsPage locale="en" />);

    await screen.findByRole("heading", { name: "Needs your action" });
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Earlier" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review Listing" })).toBeTruthy();

    const content = container.textContent ?? "";
    expect(content.indexOf("Needs your action")).toBeLessThan(content.indexOf("Today"));
    expect(content.indexOf("Listing approval required")).toBeLessThan(content.indexOf("Account updated"));

    const message = screen.getByText("Review this listing before it can go live.");
    expect(message.className).toContain("text-base");
    expect(screen.getByRole("button", { name: "All" }).className).toContain("min-h-11");
  });

  it("announces the selected notification summary as a pressed toggle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(notificationsResponse([])));

    render(<NotificationsPage locale="en" />);
    await screen.findByText("Nothing here right now");

    const actionsSummary = screen.getByRole("button", { name: "Show notifications that need action: 0" });
    const unreadSummary = screen.getByRole("button", { name: "Show unread notifications: 0" });
    expect(actionsSummary.getAttribute("aria-pressed")).toBe("false");
    expect(unreadSummary.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(actionsSummary);
    expect(actionsSummary.getAttribute("aria-pressed")).toBe("true");
    expect(unreadSummary.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(unreadSummary);
    expect(actionsSummary.getAttribute("aria-pressed")).toBe("false");
    expect(unreadSummary.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders a fully Arabic interface and lets Arabic users search localized notification copy", async () => {
    const items = [
      notification({
        id: "unknown-trade",
        createdAt: "2026-08-27T11:00:00.000Z",
        category: "trade",
        title: "Unknown legacy trade title",
        message: "Unknown legacy trade message",
        relatedRequestId: "request-1",
        tradeSnapshot: {
          requestId: "request-1",
          tradeId: "trade-1",
          sellerId: "seller-1",
          buyerId: "user-1",
          counterpartyName: "Seller One",
          usdtAmount: "250",
          fiatAmount: "750",
          currency: "ILS",
          currentStage: "accepted",
          requiredAction: "Upload payment proof and mark Payment Sent",
        },
      }),
      notification({
        id: "today-account-ar",
        createdAt: "2026-08-27T10:00:00.000Z",
        title: "Unknown current account title",
        message: "Unknown current account message",
        isRead: true,
      }),
      notification({
        id: "listing-action",
        createdAt: "2026-08-26T09:00:00.000Z",
        category: "listing",
        title: "Listing approval required",
        message: "Review this listing now",
        priority: "high",
        actionHref: "/usdt-exchange?listing=review",
        actionLabel: "Review Listing",
      }),
      notification({
        id: "earlier-ar",
        createdAt: "2026-08-18T09:00:00.000Z",
        title: "Unknown legacy account title",
        message: "Unknown legacy account message",
        isRead: true,
      }),
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(notificationsResponse(items)));

    const { container } = render(<NotificationsPage locale="ar" />);

    await screen.findByRole("heading", { name: "تحتاج إلى إجراء الآن" });
    expect(container.querySelector("section[dir='rtl']")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "اليوم" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "أقدم" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "مراجعة العرض" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "رفع إيصال الدفع" })).toBeTruthy();

    const renderedCopy = container.textContent ?? "";
    expect(renderedCopy).not.toContain("Unknown legacy");
    expect(renderedCopy).not.toContain("Listing approval required");
    expect(renderedCopy).not.toContain("Review this listing now");
    expect(renderedCopy).not.toContain("Review Listing");

    fireEvent.change(screen.getByRole("textbox", { name: "البحث في الإشعارات" }), { target: { value: "تحديث على الصفقة" } });
    await waitFor(() => expect(screen.getByText("تحديث على الصفقة")).toBeTruthy());
    expect(screen.queryByText("تحديث على الحساب")).toBeNull();
  });

  it("keeps the exact action destination and marks an unread notification as read", async () => {
    const item = notification({
      id: "listing-route",
      createdAt: "2026-08-27T10:00:00.000Z",
      category: "listing",
      title: "Listing renewed",
      message: "Your listing is active again.",
      actionHref: "/usdt-exchange?listing=listing-1#my-listings",
      actionLabel: "Manage Listing",
    });
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/alpha-exchange/notifications?") && !init?.method) {
        return Promise.resolve(notificationsResponse([item]));
      }
      if (url.endsWith("/api/alpha-exchange/notifications/listing-route") && init?.method === "PATCH") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsPage locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage Listing" }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/usdt-exchange?listing=listing-1#my-listings"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/alpha-exchange/notifications/listing-route",
      expect.objectContaining({ method: "PATCH" }),
    ));
  });

  it("reconciles streamed unread items and preserves mark-all-read behavior", async () => {
    const streamedItem = notification({
      id: "streamed-listing",
      createdAt: "2026-08-27T11:58:00.000Z",
      category: "listing",
      title: "Listing approval required",
      message: "A listing is waiting for review.",
      priority: "high",
      actionHref: "/usdt-exchange?listing=review",
      actionLabel: "Review Listing",
    });
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/alpha-exchange/notifications?") && !init?.method) {
        return Promise.resolve(notificationsResponse([]));
      }
      if (url.endsWith("/api/alpha-exchange/notifications") && init?.method === "PATCH") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsPage locale="en" />);
    await screen.findByText("Nothing here right now");
    expect(eventSourceInstances).toHaveLength(1);

    act(() => {
      eventSourceInstances[0].emit("notifications", JSON.stringify({ notifications: [streamedItem], unreadCount: 1 }));
    });

    await screen.findByText("Listing approval required");
    expect(screen.getByRole("button", { name: "Show unread notifications: 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/alpha-exchange/notifications",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "mark_all_read" }) }),
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: "Show unread notifications: 0" })).toBeTruthy());
  });
});
