import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/notifications/notification-bell";

const navigation = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => navigation,
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useOptionalCanonicalSession: () => null }));
vi.mock("@/components/notifications/use-authenticated-notification-stream", () => ({ useAuthenticatedNotificationStream: () => {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("Notification bell conversation navigation", () => {
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
