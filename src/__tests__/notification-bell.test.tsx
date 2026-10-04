import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/notifications/notification-bell";

const navigation = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn() }));
const notificationStream = vi.hoisted(() => ({ onNotifications: null as ((event: Event) => void) | null }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => navigation,
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useOptionalCanonicalSession: () => null }));
vi.mock("@/components/notifications/use-authenticated-notification-stream", () => ({
  useAuthenticatedNotificationStream: ({ onNotifications }: { onNotifications: (event: Event) => void }) => {
    notificationStream.onNotifications = onNotifications;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.sessionStorage.clear();
  notificationStream.onNotifications = null;
});

describe("Notification bell conversation navigation", () => {
  it.each([
    ["buyer-1", "en", "View listing", "Mark as read"],
    ["seller-1", "en", "View listing", "Mark as read"],
    ["buyer-1", "ar", "عرض الإعلان", "تحديد كمقروء"],
    ["seller-1", "ar", "عرض الإعلان", "تحديد كمقروء"],
  ] as const)("gives %s safe new-listing actions in %s", async (userId, locale, viewLabel, readLabel) => {
    const notice = {
      id: "new-listing", userId, category: "listing",
      title: "🟢 New USDT Listing Available", message: "A seller published 700 USDT.",
      relatedListingId: "listing-public", actionHref: "/dashboard/seller", actionLabel: "Manage Listing",
      isRead: false, state: "unread", createdAt: new Date().toISOString(),
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ notifications: [notice], unreadCount: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationBell locale={locale} />);
    fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "الإشعارات" : "Notifications" }));
    const view = await screen.findByRole("button", { name: viewLabel });
    expect(screen.getByRole("button", { name: readLabel })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Manage Listing|إدارة العرض/i })).toBeNull();
    fireEvent.click(view);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/usdt-exchange#listing-listing-public"));
    expect(fetchMock).toHaveBeenCalledWith("/api/alpha-exchange/notifications/new-listing", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ isRead: true }),
    }));
  });

  it("marks a listing alert read without opening a page", async () => {
    const notice = {
      id: "listing-read", userId: "buyer-1", category: "listing",
      title: "🟢 New USDT Listing Available", message: "A seller published 700 USDT.",
      relatedListingId: "listing-public", isRead: false, createdAt: new Date().toISOString(),
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ notifications: [notice], unreadCount: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationBell locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/alpha-exchange/notifications/listing-read", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ isRead: true }),
    })));
    expect(navigation.push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "View listing" })).toBeNull());
  });


  it.each(["one", "all"] as const)("keeps %s read actions ahead of an already-running refresh", async (action) => {
    const notice = {
      id: "listing-read-race", userId: "buyer-1", category: "listing",
      title: "New USDT Listing Available", message: "A seller published 700 USDT.",
      relatedListingId: "listing-public", isRead: false, createdAt: new Date().toISOString(),
    };
    const payload = { notifications: [notice], unreadCount: 1 };
    let finishRefresh!: (response: Response) => void;
    let reads = 0;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return Promise.resolve(new Response("{}", { status: 200 }));
      reads += 1;
      if (reads === 1) return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
      return new Promise<Response>((resolve) => { finishRefresh = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationBell locale="en" />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    await screen.findByRole("button", { name: "View listing" });
    fireEvent.click(bell);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    try {
      fireEvent.click(bell);
      expect(reads).toBe(2);
      fireEvent.click(screen.getByRole("button", { name: action === "all" ? "Mark all as read" : "Mark as read" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "View listing" })).toBeNull());
      await act(async () => {
        finishRefresh(new Response(JSON.stringify(payload), { status: 200 }));
      });
      expect(screen.queryByRole("button", { name: "View listing" })).toBeNull();
      expect(screen.queryByText("1 unread")).toBeNull();
      expect(navigation.push).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });


  it.each(["one", "all", "dismiss"] as const)("keeps %s read actions hidden when a stale live update arrives", async (action) => {
    const notice = {
      id: "live-read-race", userId: "buyer-1", category: action === "dismiss" ? "application" : "listing",
      title: "A new alert", message: "A guest fixture notification.",
      relatedListingId: "listing-public",
      actionHref: action === "dismiss" ? "/dashboard/admin?sellerApplication=application-fixture" : undefined,
      isRead: false, createdAt: new Date().toISOString(),
    };
    const payload = { notifications: [notice], unreadCount: 1 };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "PATCH" ? {} : payload), { status: 200 })));
    render(<NotificationBell locale="en" />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    const actionLabel = action === "all" ? "Mark all as read" : action === "dismiss" ? "Later" : "Mark as read";
    if (action === "all") await screen.findByRole("button", { name: "Mark as read" });
    fireEvent.click(await screen.findByRole("button", { name: actionLabel }));
    await act(async () => {
      notificationStream.onNotifications?.(new MessageEvent("notifications", { data: JSON.stringify(payload) }));
    });
    expect(screen.queryByText("1 unread")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
    fireEvent.click(bell);
    await act(async () => {
      notificationStream.onNotifications?.(new MessageEvent("notifications", { data: JSON.stringify(payload) }));
    });
    fireEvent.click(bell);
    expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
    expect(screen.queryByText("1 unread")).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("keeps the entire unread count cleared after reading a limited notification page", async () => {
    const notifications = Array.from({ length: 3 }, (_, index) => ({
      id: "limited-unread-" + index, userId: "buyer-1", category: "listing",
      title: "A listing alert", message: "A guest fixture notification.",
      isRead: false, createdAt: new Date().toISOString(),
    }));
    const payload = { notifications, unreadCount: 37 };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "PATCH" ? {} : payload), { status: 200 })));
    render(<NotificationBell locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await screen.findByText("37 unread");
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    await act(async () => {
      notificationStream.onNotifications?.(new MessageEvent("notifications", { data: JSON.stringify(payload) }));
    });
    expect(screen.queryByText(/^\d+ unread$/)).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Mark as read" })).toHaveLength(0);
  });

  it("restores an unread notification when the read write fails", async () => {
    const notice = {
      id: "read-write-failed", userId: "buyer-1", category: "listing",
      title: "A listing alert", message: "A guest fixture notification.",
      relatedListingId: "listing-public", isRead: false, createdAt: new Date().toISOString(),
    };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(JSON.stringify({ notifications: [notice], unreadCount: 1 }), { status: init?.method === "PATCH" ? 503 : 200 })));
    render(<NotificationBell locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark as read" }));
    await screen.findByRole("button", { name: "Mark as read" });
    expect(screen.getByRole("button", { name: "Mark as read" })).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("accepts an explicit unread change after the server confirmed the read", async () => {
    const notice = {
      id: "read-then-unread", userId: "buyer-1", category: "listing",
      title: "A listing alert", message: "A guest fixture notification.",
      relatedListingId: "listing-public", isRead: false, createdAt: new Date().toISOString(),
    };
    const payload = { notifications: [notice], unreadCount: 1 };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "PATCH" ? {} : payload), { status: 200 })));
    render(<NotificationBell locale="en" />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    fireEvent.click(await screen.findByRole("button", { name: "Mark as read" }));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(bell);
    await act(async () => {
      notificationStream.onNotifications?.(new MessageEvent("notifications", { data: JSON.stringify({ notifications: [], unreadCount: 0 }) }));
      notificationStream.onNotifications?.(new MessageEvent("notifications", { data: JSON.stringify(payload) }));
    });
    fireEvent.click(bell);
    expect(screen.getByRole("button", { name: "Mark as read" })).toBeTruthy();
  });

  it("opens a legacy lifecycle notice without a trade snapshot and preserves its request ID", async () => {
    const notification = {
      id: "legacy-1", userId: "buyer-1", category: "trade", reason: "trade_completed",
      title: "Trade completed", message: "Your review is available.",
      relatedHref: "/en/trade-room/Purchase-AbC", actionLabel: "Open Trade Room",
      isRead: false, state: "unread", createdAt: new Date().toISOString(),
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ notifications: [notification], unreadCount: 1 }), { status: 200 })));
    render(<NotificationBell locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Trade Room" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/trade-room/Purchase-AbC?action=review-trade#status-banner"));
  });

  it("opens and closes immediately while a notification request is stuck, without duplicate reads", () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<NotificationBell locale="en" />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    expect(screen.getByTestId("notification-panel").className).toContain("visible scale-100");
    fireEvent.click(bell);
    expect(screen.getByTestId("notification-panel").className).toContain("invisible scale-95");
    fireEvent.click(bell);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["trade_room_poke", "trade_room_message"])("opens the chat from a %s action", async (reason) => {
    const notification = {
      id: "notification-1", userId: "seller-1", category: "trade", reason,
      title: "Trade Room reminder", message: "Your Buyer is waiting for you in an active trade.",
      relatedRequestId: "purchase-1", relatedHref: "/trade-room/purchase-1",
      actionHref: "/trade-room/purchase-1#chat", actionLabel: "Open Trade Room",
      isRead: false, state: "unread", createdAt: new Date().toISOString(),
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      notifications: [notification], unreadCount: 1,
    }), { status: 200 })));
    render(<NotificationBell locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    const action = await screen.findByRole("button", { name: "Open Trade Room" });
    fireEvent.click(action);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/trade-room/purchase-1?action=open-trade#chat"));
  });
});
