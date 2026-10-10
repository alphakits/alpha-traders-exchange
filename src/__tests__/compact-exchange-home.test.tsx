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
let requestsMalformed = false;
let requestsLoading: Promise<void> | null = null;
let viewportWidth = 1440;
const mediaListeners = new Set<() => void>();
const trade = { id: "home-active-trade", buyerId: buyer.id, sellerId: "home-seller", listingId: "listing-1", status: "accepted", paymentMethod: "Face-to-Face", usdtAmount: 200, pricePerUsdt: 3.1, totalIls: 620, createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T10:00:00.000Z", timeline: [] };

beforeEach(() => {
  // Opening a trade updates the real URL even with the router mocked. Each
  // case starts on the marketplace, without another case's listing deep link.
  window.history.replaceState({}, "", "/en/usdt-exchange");
  pending = false;
  user = buyer;
  requests = [trade];
  requestsUnavailable = false;
  requestsMalformed = false;
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
      data = requestsMalformed ? {} : { requests };
    }
    else if (url.includes("/my-listings")) data = { listings: [], summary: { canCreateListing: true }, commissionStatus: { status: "clear", pendingCount: 0 } };
    else if (url.includes("/listings")) data = { listings: [] };
    else if (url.includes("/notifications")) data = { notifications: [], activity: [], unreadCount: 0 };
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(async () => {
  vi.useRealTimers();
  // Let the focus-restoration listener attach, then cancel its pending timers
  // before this test's document is disposed.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  fireEvent.pointerDown(document.body);
  cleanup();
  vi.unstubAllGlobals();
});

describe("compact Exchange home", () => {
  it.each([["buy", "fetch"], ["offer", "body"]] as const)("releases a stalled %s request %s without repeating it or navigating on a late response", async (mode, phase) => {
    requests = [];
    user = { ...buyer, emailVerified: true };
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    let finish!: (value: unknown) => void;
    const stalled = new Promise((resolve) => { finish = resolve; });
    const listing = { id: "recovery-listing", sellerId: "recovery-seller", sellerDisplayName: "AT-Recovery", photos: [],
      originalAmount: "1000", availableAmount: "1000", price: "3.20", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", paymentMethods: ["Bank Transfer"],
      minimumTrade: "100", maximumTrade: "1000", sellerDescription: "", responseTime: "5 minutes", status: "active", approvalStatus: "approved",
      createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T10:00:00.000Z" };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/alpha-exchange/listings") return Promise.resolve(Response.json({ listings: [listing] }));
      if (String(input) === "/api/alpha-exchange/purchase-requests" && init?.method === "POST") {
        return phase === "fetch" ? stalled : Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: () => stalled });
      }
      return fallback(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    const open = await screen.findByRole("button", { name: mode === "offer" ? /Make a price offer to/ : /Buy USDT from/ });
    fireEvent.click(open);
    await waitFor(() => expect(document.getElementById("buyer-usdt-amount")).toBeTruthy());
    fireEvent.change(document.getElementById("buyer-usdt-amount")!, { target: { value: "200" } });
    const wallet = screen.getByPlaceholderText(/wallet address/i);
    fireEvent.change(wallet, { target: { value: "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8" } });
    if (mode === "offer") {
      // A late listing-query restoration must not change this into a normal buy.
      expect(screen.getByRole("button", { name: "Submit Price Offer" })).toBeTruthy();
      fireEvent.change(screen.getByLabelText(/Your Price per USDT/), { target: { value: "3.10" } });
    }
    vi.useFakeTimers();
    fireEvent.submit(document.getElementById("buy-usdt-form")!);
    const mutations = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST" && String(init.body).includes("recovery-listing"));
    expect(mutations()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByText("We could not confirm the request status. Check your trades before resubmitting.")).toBeTruthy();
    expect((screen.getByRole("button", { name: mode === "offer" ? "Submit Price Offer" : "Start Trade" }) as HTMLButtonElement).disabled).toBe(false);
    expect(mutations()).toHaveLength(1);
    const payload = { purchase: { ...trade, id: "late-created-trade" }, destination: "/trade-room/late-created-trade" };
    await act(async () => { finish(phase === "fetch" ? Response.json(payload) : JSON.stringify(payload)); });
    expect(push).not.toHaveBeenCalled();
    expect((document.getElementById("buyer-usdt-amount") as HTMLInputElement).value).toBe("200");
  });

  it.each(["en", "ar"] as const)("restores a direct listing link and preserves a new offer after closing it (%s)", async (locale) => {
    requests = [];
    user = { ...buyer, emailVerified: true };
    const listing = { id: "direct-link-listing", sellerId: "direct-link-seller", sellerDisplayName: "AT-Direct", photos: [],
      originalAmount: "1000", availableAmount: "1000", price: "3.20", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", paymentMethods: ["Bank Transfer"],
      minimumTrade: "100", maximumTrade: "1000", sellerDescription: "", responseTime: "5 minutes", status: "active", approvalStatus: "approved",
      createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T10:00:00.000Z" };
    const fallback = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/alpha-exchange/listings"
        ? Promise.resolve(Response.json({ listings: [listing] })) : fallback(input, init)));
    window.history.replaceState({}, "", `/${locale}/usdt-exchange?listing=direct-link-listing`);
    render(<UsdtExchangePage locale={locale} initialSessionUser={user} />);
    await waitFor(() => expect(document.getElementById("buyer-usdt-amount")).toBeTruthy());
    expect(document.getElementById("buyer-offered-price")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.getElementById("buyer-usdt-amount")).toBeNull();
    expect(new URLSearchParams(window.location.search).has("listing")).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: locale === "ar" ? /تقديم عرض سعر إلى/ : /Make a price offer to/ }));
    await waitFor(() => expect(document.getElementById("buyer-offered-price")).toBeTruthy());
    expect((document.getElementById("buyer-offered-price") as HTMLInputElement).value).toBe("3.19");
    expect(new URLSearchParams(window.location.search).get("listing")).toBe("direct-link-listing");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it.each([
    { width: 390, locale: "en" as const },
    { width: 1440, locale: "ar" as const },
  ])("reveals seller insights when the asynchronously mounted section becomes visible ($width px, $locale)", async ({ width, locale }) => {
    viewportWidth = width;
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    const observations = new Map<Element, { notify: IntersectionObserverCallback; observer: IntersectionObserver }>();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        observations.set(target, { notify: this.callback, observer: this as unknown as IntersectionObserver });
      }
      disconnect = vi.fn();
    });

    render(<UsdtExchangePage locale={locale} initialSessionUser={user} />);
    // The first render also compiles the lazy workspace module on cold test
    // workers. Wait for that boundary before exercising the visibility observer.
    const placeholder = await screen.findByRole("heading", { name: locale === "ar" ? "جاري تحميل الرؤى المتقدمة" : "Advanced insights load on demand" }, { timeout: 10_000 });
    // The observer must attach after the lazy workspace module has mounted.
    // Market cards have their own observers. Exercise the one attached to the
    // seller insights card, independently of component mount order.
    const observedInsights = () => [...observations.entries()].find(([element]) => element.contains(placeholder));
    await waitFor(() => expect(observedInsights()).toBeDefined());
    const [target, { notify, observer }] = observedInsights()!;
    // Observe the visible card, so a quick scroll cannot skip a one-pixel sentinel.
    expect(target.contains(placeholder)).toBe(true);
    const entry = (isIntersecting: boolean): IntersectionObserverEntry => ({
      target, isIntersecting, time: 0, rootBounds: null,
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
    });
    await act(async () => notify([entry(false)], observer));
    expect(screen.queryByRole("heading", { name: locale === "ar" ? "ملف البائع" : "Seller Profile" })).toBeNull();
    await act(async () => notify([entry(true)], observer));
    expect(await screen.findByRole("heading", { name: locale === "ar" ? "ملف البائع" : "Seller Profile" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: locale === "ar" ? "الخط الزمني للنشاط" : "Activity Timeline" })).toBeTruthy();
    expect(document.contains(placeholder)).toBe(false);
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("renders seller insights when the browser has no visibility observer", async () => {
    viewportWidth = 390;
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    expect(await screen.findByRole("heading", { name: "Seller Profile" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Advanced insights load on demand" })).toBeNull();
  });

  it.each([390, 1440])("never renders an anonymous buyer workspace at %spx", async width => {
    viewportWidth = width;
    const { container } = render(<UsdtExchangePage locale="en" initialSessionUser={null} />);
    await act(async () => {});
    expect(container.textContent).toBe("");
    expect(screen.queryByText("Returning to your buyer workspace")).toBeNull();
    expect(screen.queryByText("#AT-000000")).toBeNull();
    expect(screen.queryByText("Start a Trade")).toBeNull();
  });

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

  it("does not offer approved seller management to a suspended account", async () => {
    user = { ...buyer, sellerStatus: "suspended" };
    await act(async () => {
      render(<UsdtExchangePage locale="en" initialSessionUser={user} workspaceMode="seller" />);
    });
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

  it("explains an empty phone workspace without navigating away", async () => {
    viewportWidth = 390;
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    requests = [];
    const { container } = render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    await screen.findByText("No purchase requests yet.");
    expect(screen.queryByText("There are no active trades currently.")).toBeNull();
    const welcome = within(container.querySelector('[data-account-role="approved_seller"]') as HTMLElement);
    fireEvent.click(welcome.getByRole("button", { name: "Active Trades" }));
    await screen.findByText("You have no active trades right now.");
    expect(push).not.toHaveBeenCalled();
  });

  it.each(["en", "ar"] as const)("ignores completed, locked and other users' trades on phones (%s)", async locale => {
    viewportWidth = 390;
    const isAr = locale === "ar";
    user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    requests = [
      ...["completed", "review_open", "locked", "cancelled", "declined"].map(status => ({ ...trade, id: status, sellerId: user.id, status })),
      { ...trade, id: "completed-timestamp", sellerId: user.id, completedAt: trade.updatedAt },
      { ...trade, id: "different-seller" },
    ];
    render(<UsdtExchangePage locale={locale} initialSessionUser={user} />);
    fireEvent.click(screen.getByRole("button", { name: isAr ? "الصفقات النشطة" : "Active Trades" }));
    await screen.findByText(isAr ? "ليس لديك أي صفقات نشطة الآن." : "You have no active trades right now.");
    expect(push).not.toHaveBeenCalled();
  });

  it.each(["buyer", "seller"] as const)("shares an in-flight read and opens the trade after an early phone click (%s)", async side => {
    viewportWidth = 390;
    let finishLoading!: () => void;
    requestsLoading = new Promise(resolve => { finishLoading = resolve; });
    if (side === "seller") user = { ...buyer, role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller", sellerApprovalVerified: true };
    requests = [{ ...trade, sellerId: side === "seller" ? user.id : trade.sellerId }];
    render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    const button = screen.getByRole("button", { name: side === "seller" ? "Active Trades" : /^Active Trades:/ });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.focus(window);
    await screen.findByText("Loading your active trades…");
    expect(screen.queryByText("You have no active trades right now.")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    const purchaseReads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/purchase-requests"));
    expect(purchaseReads()).toHaveLength(1);
    await act(async () => finishLoading());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trade-room/home-active-trade"));
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed phone read separate from an empty account and retries on tap", async () => {
    viewportWidth = 390;
    requestsUnavailable = true;
    render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    const button = screen.getByRole("button", { name: /^Active Trades:/ });
    fireEvent.click(button);
    await screen.findByText("We couldn't load your trades. Tap Active Trades to try again.");
    expect(screen.queryByText("You have no active trades right now.")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    requestsUnavailable = false;
    fireEvent.click(button);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trade-room/home-active-trade"));
  });

  it.each(["fetch", "body"])("releases a stalled Active Trades %s so a phone user can open the current trade", async (phase) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    viewportWidth = 390;
    const original = vi.mocked(fetch).getMockImplementation()!;
    let stalled = true;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (stalled && String(input).includes("/purchase-requests")) {
        return phase === "fetch" ? new Promise<Response>(() => {})
          : Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: () => new Promise(() => {}) } as Response);
      }
      return original(input, init);
    });
    render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    const button = screen.getByRole("button", { name: /^Active Trades:/ });
    fireEvent.click(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText("We couldn't load your trades. Tap Active Trades to try again.")).toBeTruthy();
    expect(screen.queryByText("You have no active trades right now.")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    stalled = false;
    fireEvent.click(button);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trade-room/home-active-trade"));
  });

  it("does not navigate after leaving the workspace during a pending read", async () => {
    viewportWidth = 390;
    let finishLoading!: () => void;
    requestsLoading = new Promise(resolve => { finishLoading = resolve; });
    const { unmount } = render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    fireEvent.click(screen.getByRole("button", { name: /^Active Trades:/ }));
    await screen.findByText("Loading your active trades…");
    unmount();
    await act(async () => finishLoading());
    expect(push).not.toHaveBeenCalled();
  });

  it("does not interpret a malformed response as an empty account", async () => {
    viewportWidth = 390;
    requestsMalformed = true;
    render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    fireEvent.click(screen.getByRole("button", { name: /^Active Trades:/ }));
    await screen.findByText("We couldn't load your trades. Tap Active Trades to try again.");
    expect(screen.queryByText("You have no active trades right now.")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not reload profile totals when an unchanged trade poll completes", async () => {
    viewportWidth = 390;
    render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    await screen.findByRole("heading", { name: "Gold Buyer" });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Active Trades:/ }).textContent).toContain("1"));
    await act(async () => {});
    const callsTo = (path: string) => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes(path)).length;
    const profilesBefore = callsTo("/auth/profile");
    const readsBefore = callsTo("/purchase-requests");
    await act(async () => { fireEvent.focus(window); });
    await waitFor(() => expect(callsTo("/purchase-requests")).toBeGreaterThan(readsBefore));
    await act(async () => {});
    expect(callsTo("/auth/profile")).toBe(profilesBefore);
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
    await waitFor(() => expect(push).toHaveBeenLastCalledWith("/trade-room/home-active-trade"));
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
    expect(screen.queryByRole("heading", { name: "Buyer Dashboard" })).toBeNull();
  });
  it.each(["owner", "admin"] as const)("does not invent a buyer workspace for a %s without the buyer role", async (role) => {
    user = { ...buyer, role, roles: [role] };
    render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    expect(screen.queryByText("My Trade History")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Buyer Dashboard" })).toBeNull();
    expect(screen.getByRole("button", { name: role === "owner" ? "Owner Dashboard" : "Admin Dashboard" })).toBeTruthy();
  });

  it.each(["en", "ar"] as const)("opens the owner's active list directly from the marketplace (%s)", async (locale) => {
    user = { ...buyer, role: "owner", roles: ["owner", "buyer"] };
    render(<UsdtExchangePage locale={locale} initialSessionUser={user} />);
    fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "الصفقات النشطة" : "Active Trades", exact: true }));
    expect(push).toHaveBeenCalledWith("/admin/alpha-exchange?section=purchase-requests&status=active");
  });
});
