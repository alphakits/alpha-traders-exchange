import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";
import type { ClientSessionUser } from "@/lib/client-session-user";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const buyer: ClientSessionUser = {
  id: "home-buyer", fullName: "Home Buyer", email: "home@example.test", role: "buyer", roles: ["buyer"], sellerStatus: "buyer",
  whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: ["English"], bio: "", country: "", city: "",
  onlineStatus: "online", createdAt: "2026-01-01T00:00:00.000Z",
};
let pending = false;
let user = buyer;
let requests: unknown[] = [];
let requestsUnavailable = false;
const trade = { id: "home-active-trade", buyerId: buyer.id, sellerId: "home-seller", listingId: "listing-1", status: "accepted", paymentMethod: "Face-to-Face", usdtAmount: 200, pricePerUsdt: 3.1, totalIls: 620, createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T10:00:00.000Z", timeline: [] };

beforeEach(() => {
  pending = false;
  user = buyer;
  requests = [trade];
  requestsUnavailable = false;
  push.mockReset();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("EventSource", class { addEventListener() {} removeEventListener() {} close() {} });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    let data: unknown = {};
    if (url.includes("/auth/me")) data = { user };
    else if (url.includes("/auth/profile")) data = user.sellerStatus === "approved_seller"
      ? { profile: { id: user.id }, stats: { kind: "seller", sellerLevel: "silver", nextLevel: "gold", lifetimeCompletedVolumeUsdt: 38_000, amountToNextLevelUsdt: 12_000, progressToNextLevelPercent: 65.71 } }
      : { stats: { kind: "buyer", lifetimeCompletedVolumeUsdt: 52_500 } };
    else if (url.includes("/seller-application")) data = { application: pending ? { id: "application-home", status: "pending", createdAt: trade.createdAt } : null };
    else if (url.includes("/purchase-requests")) {
      if (requestsUnavailable) return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 });
      data = { requests };
    }
    else if (url.includes("/my-listings")) data = { listings: [], summary: { canCreateListing: true }, commissionStatus: { status: "clear", pendingCount: 0 } };
    else if (url.includes("/listings")) data = { listings: [] };
    else if (url.includes("/notifications")) data = { notifications: [], activity: [], unreadCount: 0 };
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("compact Exchange home", () => {
  it.each(["en", "ar"] as const)("keeps rank progress, moves browsing up, and opens the active trade in one click (%s)", async (locale) => {
    const isAr = locale === "ar";
    const { container } = render(<UsdtExchangePage locale={locale} initialSessionUser={user} workspaceMode="buyer" />);
    await screen.findByText(isAr ? "مشتري ذهبي" : "Gold Buyer");
    expect(screen.getByText(isAr ? "التقدم نحو الرتبة التالية" : "Progress to next rank")).toBeTruthy();
    const browse = screen.getByRole("link", { name: isAr ? "تصفح البائعين" : "Browse Sellers" });
    expect(browse.getAttribute("href")).toBe("/usdt-exchange#marketplace");
    expect(screen.queryByText("AT ID")).toBeNull();
    await screen.findByText(isAr ? "انضم كبائع معتمد" : "Become an Approved Seller");
    expect(screen.queryByText(isAr ? "ابحث عن بائع معتمد" : "Find an Approved Seller")).toBeNull();
    const workspace = within(container.querySelector("#workspace-summary")! as HTMLElement);
    expect(workspace.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /العروض المباشرة/ : /Live Listings/ }));
    expect(push).toHaveBeenLastCalledWith("/usdt-exchange#marketplace");
    await waitFor(() => expect(workspace.getByRole("button", { name: isAr ? /الصفقات النشطة/ : /Active Trades/ }).textContent).toContain("1"));
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /الصفقات النشطة/ : /Active Trades/ }));
    expect(push).toHaveBeenLastCalledWith("/trade-room/home-active-trade");
    await screen.findByText(isAr ? "سجل صفقاتي" : "My Trade History");
    expect(screen.queryByText(isAr ? "جلسة المستخدم" : "Session")).toBeNull();
    expect(screen.queryByText(isAr ? "تفضيلات الإشعارات" : "Notification Preferences")).toBeNull();
  });

  it("hides the application promotion after a buyer has submitted a request", async () => {
    pending = true;
    render(<UsdtExchangePage locale="en" initialSessionUser={user} workspaceMode="buyer" />);
    await screen.findByText("My Trade History");
    await waitFor(() => expect(screen.queryByText("Become an Approved Seller")).toBeNull());
  });

  it("replaces the buyer promotion with approved seller listing management", async () => {
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    render(<UsdtExchangePage locale="en" initialSessionUser={user} workspaceMode="seller" />);
    expect(screen.getByRole("heading", { name: "Approved Seller" })).toBeTruthy();
    expect(screen.queryByText("Become an Approved Seller")).toBeNull();
    await screen.findAllByRole("heading", { name: "Silver Seller" });
    const welcome = document.querySelector('[data-account-role="approved_seller"]')!;
    expect(welcome.textContent).toContain("38,000 USDT");
    expect(welcome.textContent).toContain("12,000 USDT");
    expect(within(welcome as HTMLElement).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("66");
    await waitFor(() => expect(document.getElementById("my-listings-section")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "View and Manage Listings" }));
    expect(document.activeElement?.id).toBe("my-listings-section");
  });

  it("does not offer approved seller management to a suspended account", () => {
    user = { ...buyer, sellerStatus: "suspended" };
    render(<UsdtExchangePage locale="en" initialSessionUser={user} workspaceMode="seller" />);
    expect(screen.queryByRole("button", { name: "View and Manage Listings" })).toBeNull();
  });

  it("keeps the existing marketplace welcome and workspace layout", async () => {
    const { container } = render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    expect(screen.getByText("AT ID")).toBeTruthy();
    expect(within(container.querySelector("#workspace-summary")! as HTMLElement).getAllByRole("button")).toHaveLength(6);
    await screen.findByText("Find an Approved Seller");
  });

  it.each(["en", "ar"] as const)("opens only the seller's active requests and keeps one integrated workspace (%s)", async (locale) => {
    const isAr = locale === "ar";
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    requests = [
      { ...trade, id: "seller-current", sellerId: user.id },
      { ...trade, id: "seller-pending", sellerId: user.id, status: "pending" },
      ...["completed", "review_open", "locked", "cancelled", "declined"].map(status => ({ ...trade, id: `seller-${status}`, sellerId: user.id, status })),
      { ...trade, id: "seller-completed-timestamp", sellerId: user.id, completedAt: trade.updatedAt },
      { ...trade, id: "own-buyer-trade", sellerId: "another-seller" },
    ];
    const { container } = render(<UsdtExchangePage locale={locale} initialSessionUser={user} />);
    await waitFor(() => expect(document.getElementById("my-listings-section")).toBeTruthy());
    const welcome = container.querySelector('[data-account-role="approved_seller"]') as HTMLElement;
    expect(container.querySelectorAll("#workspace-summary")).toHaveLength(1);
    expect(welcome.querySelector("#workspace-summary")).toBeTruthy();
    const workspace = within(welcome.querySelector("#workspace-summary") as HTMLElement);
    expect(workspace.getAllByRole("button")).toHaveLength(6);
    expect(within(welcome).getAllByRole("button", { name: isAr ? "إنشاء عرض" : "Create Listing" })).toHaveLength(1);
    const filter = await screen.findByRole("combobox", { name: isAr ? "تصفية طلبات الشراء" : "Filter purchase requests" });
    fireEvent.change(filter, { target: { value: "review_open" } });
    fireEvent.change(screen.getByPlaceholderText(isAr ? "ابحث بمعرّف الصفقة أو المشتري أو العرض..." : "Search by trade ID, buyer, listing..."), { target: { value: "old search" } });
    fireEvent.click(within(welcome).getByRole("button", { name: isAr ? "الصفقات النشطة" : "Active Trades" }));
    await waitFor(() => expect(document.activeElement?.id).toBe("purchase-requests-section"));
    expect((filter as HTMLSelectElement).value).toBe("active");
    const section = document.getElementById("purchase-requests-section")!;
    await waitFor(() => expect(section.querySelectorAll('[aria-controls^="seller-trade-details-"]')).toHaveLength(2));
    expect(section.querySelector('[aria-controls="seller-trade-details-seller-current"]')).toBeTruthy();
    expect(section.querySelector('[aria-controls="seller-trade-details-seller-pending"]')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^طلبات الشراء:/ : /^Purchase Requests:/ }));
    expect((filter as HTMLSelectElement).value).toBe("all");
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^عروضي:/ : /^My Listings:/ }));
    expect(document.activeElement?.id).toBe("my-listings-section");
    fireEvent.click(within(welcome).getByRole("button", { name: isAr ? "إنشاء عرض" : "Create Listing" }));
    expect(document.activeElement?.id).toBe("create-listing");
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^الإشعارات:/ : /^Notifications:/ }));
    expect(document.activeElement?.id).toBe("notification-center-section");
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^سوق اليوم:/ : /^Today's Market:/ }));
    expect(document.activeElement?.id).toBe("market-overview");
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^ملفي وإنجازاتي:/ : /^My Profile & Achievements:/ }));
    expect(push).toHaveBeenLastCalledWith("/profile");
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^إعدادات الحساب:/ : /^Account Settings:/ }));
    expect(push).toHaveBeenLastCalledWith("/settings");
  });

  it.each(["en", "ar"] as const)("explains an empty active queue even when completed requests exist (%s)", async (locale) => {
    const isAr = locale === "ar";
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    requests = [{ ...trade, id: "finished-sale", sellerId: user.id, status: "completed" }];
    render(<UsdtExchangePage locale={locale} initialSessionUser={user} workspaceMode="seller" />);
    fireEvent.click(screen.getByRole("button", { name: isAr ? "الصفقات النشطة" : "Active Trades" }));
    expect(await screen.findByText(isAr ? "لا توجد صفقات نشطة حالياً." : "There are no active trades currently.")).toBeTruthy();
    expect(document.activeElement?.id).toBe("purchase-requests-section");
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: isAr ? "عرض عروضي" : "View My Listings" }));
    expect(document.activeElement?.id).toBe("my-listings-section");
    fireEvent.click(screen.getByRole("button", { name: isAr ? "عرض جميع الطلبات" : "View All Requests" }));
    await waitFor(() => expect(document.querySelector('[aria-controls="seller-trade-details-finished-sale"]')).toBeTruthy());
  });

  it("shows a retry instead of an empty-trades claim when the request fails", async () => {
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    requests = [];
    requestsUnavailable = true;
    render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    fireEvent.click(screen.getByRole("button", { name: "Active Trades" }));
    await screen.findByText("We couldn't load your latest trades. Please try again.");
    expect(screen.queryByText("There are no active trades currently.")).toBeNull();
    requestsUnavailable = false;
    fireEvent.click(within(document.getElementById("purchase-requests-section")!).getByRole("button", { name: "Retry" }));
    await screen.findByText("There are no active trades currently.");
  });

  it("honors an immediate Create Listing click while the seller workspace mounts", async () => {
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    const { container } = render(<UsdtExchangePage locale="en" initialSessionUser={user} workspaceMode="seller" />);
    const welcome = within(container.querySelector('[data-account-role="approved_seller"]') as HTMLElement);
    fireEvent.click(welcome.getByRole("button", { name: "Create Listing" }));
    await waitFor(() => expect(document.activeElement?.id).toBe("create-listing"));
    const workspace = within(container.querySelector("#workspace-summary") as HTMLElement);
    fireEvent.click(workspace.getByRole("button", { name: /^Today's Market:/ }));
    expect(push).toHaveBeenLastCalledWith("/usdt-exchange#market-overview");
  });

});
