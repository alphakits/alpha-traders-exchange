import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
let requestsLoading: Promise<void> | null = null;
let viewportWidth = 1440;
const mediaListeners = new Set<() => void>();
const trade = { id: "home-active-trade", buyerId: buyer.id, sellerId: "home-seller", listingId: "listing-1", status: "accepted", paymentMethod: "Face-to-Face", usdtAmount: 200, pricePerUsdt: 3.1, totalIls: 620, createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T10:00:00.000Z", timeline: [] };

beforeEach(() => {
  pending = false;
  user = buyer;
  requests = [trade];
  requestsUnavailable = false;
  requestsLoading = null;
  viewportWidth = 1440;
  mediaListeners.clear();
  push.mockReset();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn((query: string) => ({
    get matches() {
      const min = query.match(/min-width:\s*(\d+)px/);
      const max = query.match(/max-width:\s*(\d+)px/);
      return min ? viewportWidth >= Number(min[1]) : max ? viewportWidth <= Number(max[1]) : false;
    },
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  })) });
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
      if (requestsLoading) await requestsLoading;
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
    viewportWidth = 390;
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

  it("keeps the marketplace welcome and workspace without the redundant discovery card", async () => {
    viewportWidth = 390;
    const { container } = render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    expect(screen.getByText("AT ID")).toBeTruthy();
    expect(within(container.querySelector("#workspace-summary")! as HTMLElement).getAllByRole("button")).toHaveLength(6);
    await screen.findByText("Become an Approved Seller");
    expect(screen.queryByText("Find an Approved Seller")).toBeNull();
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

  it.each([
    ["en", 390, undefined], ["ar", 390, undefined],
    ["en", 932, undefined], ["ar", 932, undefined],
    ["en", 390, "seller"], ["ar", 390, "seller"],
  ] as const)("preserves the existing phone layout and navigation (%s, %dpx, %s)", async (locale, width, mode) => {
    viewportWidth = width;
    const isAr = locale === "ar";
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    requests = [{ ...trade, id: "phone-existing-trade", sellerId: user.id }];
    const { container } = render(<UsdtExchangePage locale={locale} initialSessionUser={user} workspaceMode={mode} />);
    await waitFor(() => expect(document.getElementById("purchase-requests-section")).toBeTruthy());
    const welcome = container.querySelector('[data-account-role="approved_seller"]') as HTMLElement;
    expect(welcome.querySelector(".account-welcome__workspace-layout")).toBeNull();
    expect(welcome.querySelector("#workspace-summary")).toBeNull();
    expect(welcome.querySelector(".account-welcome__content > .account-welcome__identity")).toBeTruthy();
    expect(container.querySelectorAll("#workspace-summary")).toHaveLength(1);
    const workspace = within(container.querySelector("#workspace-summary") as HTMLElement);
    expect(workspace.getAllByRole("button")).toHaveLength(7);
    expect(workspace.getByRole("button", { name: isAr ? /^إنشاء عرض:/ : /^Create Listing:/ })).toBeTruthy();
    const filter = within(document.getElementById("purchase-requests-section")!).getByRole("combobox") as HTMLSelectElement;
    expect(filter.querySelector('option[value="active"]')).toBeNull();
    fireEvent.change(filter, { target: { value: "accepted" } });
    const search = screen.getByPlaceholderText(isAr ? "ابحث بمعرّف الصفقة أو المشتري أو العرض..." : "Search by trade ID, buyer, listing...") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "existing search" } });
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^طلبات الشراء:/ : /^Purchase Requests:/ }));
    expect(filter.value).toBe("accepted");
    expect(search.value).toBe("existing search");
    if (mode) {
      expect(within(welcome).getByRole("link", { name: isAr ? "تصفح البائعين" : "Browse Sellers" }).getAttribute("href")).toBe("/usdt-exchange#marketplace");
      expect(within(welcome).queryByRole("button", { name: isAr ? "الصفقات النشطة" : "Active Trades" })).toBeNull();
    } else {
      fireEvent.click(within(welcome).getByRole("button", { name: isAr ? "الصفقات النشطة" : "Active Trades" }));
      expect(push).toHaveBeenLastCalledWith("/trade-room/phone-existing-trade");
    }
  });

  it("keeps the existing phone empty state and trade destination", async () => {
    viewportWidth = 390;
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    requests = [];
    const { container } = render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    await screen.findByText("No purchase requests yet.");
    expect(screen.queryByText("There are no active trades currently.")).toBeNull();
    const welcome = within(container.querySelector('[data-account-role="approved_seller"]') as HTMLElement);
    fireEvent.click(welcome.getByRole("button", { name: "Active Trades" }));
    expect(push).toHaveBeenLastCalledWith("/trade-room");
  });

  it("moves one workspace at the desktop breakpoint and restores phone filters on resize", async () => {
    viewportWidth = 1023;
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    requests = [{ ...trade, sellerId: user.id }, { ...trade, id: "finished-sale", sellerId: user.id, status: "completed" }];
    const { container } = render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    await waitFor(() => expect(document.getElementById("purchase-requests-section")).toBeTruthy());
    const welcome = container.querySelector('[data-account-role="approved_seller"]') as HTMLElement;
    expect(welcome.querySelector("#workspace-summary")).toBeNull();
    act(() => { viewportWidth = 1024; mediaListeners.forEach(listener => listener()); });
    expect(welcome.querySelector("#workspace-summary")).toBeTruthy();
    expect(container.querySelectorAll("#workspace-summary")).toHaveLength(1);
    fireEvent.click(within(welcome).getByRole("button", { name: "Active Trades" }));
    expect((screen.getByRole("combobox", { name: "Filter purchase requests" }) as HTMLSelectElement).value).toBe("active");
    act(() => { viewportWidth = 390; mediaListeners.forEach(listener => listener()); });
    expect(welcome.querySelector("#workspace-summary")).toBeNull();
    expect(container.querySelectorAll("#workspace-summary")).toHaveLength(1);
    expect((within(document.getElementById("purchase-requests-section")!).getByRole("combobox") as HTMLSelectElement).value).toBe("all");
    expect(document.querySelector('[aria-controls="seller-trade-details-finished-sale"]')).toBeTruthy();
  });

});

describe("desktop buyer workspace", () => {
  it.each([["en", undefined], ["ar", undefined], ["en", "buyer"], ["ar", "buyer"]] as const)("integrates one workspace and navigates every buyer control (%s, %s)", async (locale, mode) => {
    const isAr = locale === "ar";
    requests = [
      { ...trade, id: "buyer-current" },
      { ...trade, id: "buyer-pending", status: "pending" },
      ...["completed", "review_open", "locked", "cancelled", "declined"].map(status => ({ ...trade, id: `buyer-${status}`, status })),
      { ...trade, id: "buyer-completed-timestamp", completedAt: trade.updatedAt },
      { ...trade, id: "different-buyer", buyerId: "another-buyer" },
    ];
    const { container } = render(<UsdtExchangePage locale={locale} initialSessionUser={user} workspaceMode={mode} />);
    await screen.findByRole("heading", { name: isAr ? "مشتري ذهبي" : "Gold Buyer" });
    const filter = await screen.findByRole("combobox", { name: isAr ? "تصفية صفقات المشتري" : "Filter buyer trades" }) as HTMLSelectElement;
    await screen.findByText(isAr ? "انضم كبائع معتمد" : "Become an Approved Seller");
    expect(screen.queryByText(isAr ? "ابحث عن بائع معتمد" : "Find an Approved Seller")).toBeNull();
    const welcome = within(container.querySelector('[data-account-role="buyer"]') as HTMLElement);
    const workspaceElement = container.querySelector('[data-account-role="buyer"] #workspace-summary') as HTMLElement;
    expect(workspaceElement).toBeTruthy();
    expect(container.querySelectorAll("#workspace-summary")).toHaveLength(1);
    const workspace = within(workspaceElement);
    expect(workspace.getAllByRole("button")).toHaveLength(6);
    const activeTrades = workspace.getByRole("button", { name: isAr ? /^الصفقات النشطة:/ : /^Active Trades:/ });
    await waitFor(() => expect(activeTrades.textContent).toContain("2"));
    fireEvent.change(filter, { target: { value: "cancelled" } });
    const search = screen.getByPlaceholderText(isAr ? "ابحث بمعرّف الصفقة أو العرض..." : "Search by trade ID or listing...") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "stale filter" } });
    fireEvent.click(activeTrades);
    expect(filter.value).toBe("active");
    expect(search.value).toBe("");
    await waitFor(() => expect(document.activeElement?.id).toBe("my-trade-requests-section"));
    const history = document.getElementById("my-trade-requests-section")!;
    expect(history.querySelectorAll('[aria-controls^="buyer-trade-details-"]')).toHaveLength(2);
    expect(history.querySelector('[aria-controls="buyer-trade-details-buyer-current"]')).toBeTruthy();
    expect(history.querySelector('[aria-controls="buyer-trade-details-buyer-pending"]')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(history.querySelector('[aria-controls="buyer-trade-details-buyer-current"]')!);
    fireEvent.click(within(document.getElementById("buyer-trade-details-buyer-current")!).getByRole("button", { name: isAr ? "متابعة الصفقة النقدية" : "Continue Cash Trade" }));
    expect(push).toHaveBeenLastCalledWith("/trade-room/buyer-current");
    fireEvent.click(welcome.getByRole("button", { name: isAr ? "طلبات صفقاتي" : "My Trade Requests" }));
    expect(filter.value).toBe("all");
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^الإشعارات:/ : /^Notifications:/ }));
    expect(document.activeElement?.id).toBe("notification-center-section");
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^نظرة عامة على السوق:/ : /^Market Overview:/ }));
    if (mode) expect(push).toHaveBeenLastCalledWith("/usdt-exchange#market-overview");
    else expect(document.activeElement?.id).toBe("market-overview");
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^ملفي وإنجازاتي:/ : /^My Profile & Achievements:/ }));
    expect(push).toHaveBeenLastCalledWith("/profile");
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^إعدادات الحساب:/ : /^Account Settings:/ }));
    expect(push).toHaveBeenLastCalledWith("/settings");
    for (const button of [welcome.getByRole("button", { name: isAr ? "تصفح البائعين" : "Browse Sellers" }), workspace.getByRole("button", { name: isAr ? /^العروض المباشرة:/ : /^Live Listings:/ })]) {
      fireEvent.click(button);
      if (mode) expect(push).toHaveBeenLastCalledWith("/usdt-exchange#buyer-marketplace-listings");
      else expect(document.activeElement?.id).toBe("buyer-marketplace-listings");
    }
  });

  it.each(["en", "ar"] as const)("explains an empty active queue and links back to listings and history (%s)", async (locale) => {
    const isAr = locale === "ar";
    requests = [{ ...trade, id: "completed-purchase", status: "completed" }];
    const { container } = render(<UsdtExchangePage locale={locale} initialSessionUser={user} />);
    const workspace = within(container.querySelector("#workspace-summary") as HTMLElement);
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^الصفقات النشطة:/ : /^Active Trades:/ }));
    await screen.findByText(isAr ? "لا توجد صفقات نشطة حالياً." : "There are no active trades currently.");
    expect(document.activeElement?.id).toBe("my-trade-requests-section");
    const history = within(document.getElementById("my-trade-requests-section")!);
    fireEvent.click(history.getByRole("button", { name: isAr ? "تصفح البائعين" : "Browse Sellers" }));
    expect(document.activeElement?.id).toBe("buyer-marketplace-listings");
    fireEvent.click(history.getByRole("button", { name: isAr ? "عرض جميع الصفقات" : "View All Trades" }));
    expect(document.querySelector('[aria-controls="buyer-trade-details-completed-purchase"]')).toBeTruthy();
    fireEvent.change(history.getByRole("combobox"), { target: { value: "completed" } });
    expect(document.querySelector('[aria-controls="buyer-trade-details-completed-purchase"]')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows loading and retry states instead of incorrectly claiming there are no active trades", async () => {
    let finishLoading!: () => void;
    requestsLoading = new Promise(resolve => { finishLoading = resolve; });
    requests = [];
    requestsUnavailable = true;
    const { container } = render(<UsdtExchangePage locale="en" initialSessionUser={user} workspaceMode="buyer" />);
    const workspace = within(container.querySelector("#workspace-summary") as HTMLElement);
    fireEvent.click(workspace.getByRole("button", { name: /^Active Trades:/ }));
    await screen.findByRole("status", { name: "Loading trades" });
    expect(screen.queryByText("There are no active trades currently.")).toBeNull();
    await act(async () => finishLoading());
    await screen.findByText("We couldn't load your latest trades. Please try again.");
    expect(screen.queryByText("There are no active trades currently.")).toBeNull();
    requestsUnavailable = false;
    fireEvent.click(within(document.getElementById("my-trade-requests-section")!).getByRole("button", { name: "Retry" }));
    await screen.findByText("There are no active trades currently.");
    fireEvent.click(within(document.getElementById("my-trade-requests-section")!).getByRole("button", { name: "Browse Sellers" }));
    expect(push).toHaveBeenLastCalledWith("/usdt-exchange#buyer-marketplace-listings");
  });

  it.each([["en", 390], ["ar", 390], ["en", 932], ["ar", 932]] as const)("preserves the buyer phone marketplace and its navigation (%s, %dpx)", async (locale, width) => {
    viewportWidth = width;
    const isAr = locale === "ar";
    const { container } = render(<UsdtExchangePage locale={locale} initialSessionUser={user} />);
    await screen.findByText(isAr ? "انضم كبائع معتمد" : "Become an Approved Seller");
    expect(screen.queryByText(isAr ? "ابحث عن بائع معتمد" : "Find an Approved Seller")).toBeNull();
    const welcome = container.querySelector('[data-account-role="buyer"]') as HTMLElement;
    expect(welcome.querySelector("#workspace-summary")).toBeNull();
    const workspace = within(container.querySelector("#workspace-summary") as HTMLElement);
    expect(workspace.getAllByRole("button")).toHaveLength(6);
    expect(within(welcome).getByRole("button", { name: isAr ? "تصفّح السوق" : "Browse Marketplace" })).toBeTruthy();
    expect(workspace.queryByRole("button", { name: isAr ? /^إعدادات الحساب:/ : /^Account Settings:/ })).toBeNull();
    await waitFor(() => expect(workspace.getByRole("button", { name: isAr ? /^الصفقات النشطة:/ : /^Active Trades:/ }).textContent).toContain("1"));
    fireEvent.click(workspace.getByRole("button", { name: isAr ? /^الصفقات النشطة:/ : /^Active Trades:/ }));
    expect(push).toHaveBeenLastCalledWith("/trade-room/home-active-trade");
    const history = await screen.findByText(isAr ? "سجل صفقاتي" : "My Trade History");
    expect(history).toBeTruthy();
    expect(document.querySelector('#my-trade-requests-section option[value="active"]')).toBeNull();
  });

  it("restores the phone view and full history when shrinking a desktop buyer window", async () => {
    viewportWidth = 1024;
    requests = [{ ...trade, status: "completed" }];
    const { container } = render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    fireEvent.click(within(container.querySelector("#workspace-summary") as HTMLElement).getByRole("button", { name: /^Active Trades:/ }));
    await screen.findByText("There are no active trades currently.");
    act(() => { viewportWidth = 1023; mediaListeners.forEach(listener => listener()); });
    expect(container.querySelector('[data-account-role="buyer"] #workspace-summary')).toBeNull();
    expect(container.querySelectorAll("#workspace-summary")).toHaveLength(1);
    expect((within(document.getElementById("my-trade-requests-section")!).getByRole("combobox") as HTMLSelectElement).value).toBe("all");
    expect(document.querySelector('[aria-controls="buyer-trade-details-home-active-trade"]')).toBeTruthy();
    await screen.findByText("Become an Approved Seller");
    expect(screen.queryByText("Find an Approved Seller")).toBeNull();
  });

  it("focuses the actual listings after a desktop dashboard deep link", async () => {
    window.history.replaceState({}, "", "/en/usdt-exchange#buyer-marketplace-listings");
    try {
      render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
      await waitFor(() => expect(document.activeElement?.id).toBe("buyer-marketplace-listings"));
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  it("does not apply the buyer redesign to the owner account", async () => {
    user = { ...buyer, role: "owner", roles: ["owner", "buyer"] };
    const { container } = render(<UsdtExchangePage locale="en" initialSessionUser={user} workspaceMode="buyer" />);
    const welcome = container.querySelector('[data-account-role="owner"]') as HTMLElement;
    expect(welcome.querySelector("#workspace-summary")).toBeNull();
    expect(within(welcome).getByRole("link", { name: "Owner Dashboard" }).getAttribute("href")).toBe("/admin/alpha-exchange");
    await screen.findByText("My Trade History");
  });
});
