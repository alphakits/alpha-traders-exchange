import { publicAccountId } from "@/lib/public-account-identity";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanonicalSessionProvider } from "@/components/auth/canonical-session-provider";
import { AccountProfilePanel } from "@/components/profile/account-profile-panel";
import { PAGE_SECTION_NAVIGATION_EVENT } from "@/lib/page-section-navigation";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";

vi.mock("next/image", () => ({
  default: () => <span data-testid="next-image" />,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// The moved account controls make an independent preferences request. Keep the
// profile fixtures scoped to their own endpoints instead of consuming them here.
function stubProfileFetch(fetchMock: (...args: Parameters<typeof fetch>) => unknown) {
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => String(args[0]) === "/api/alpha-exchange/notification-preferences"
    ? Promise.resolve(new Response(JSON.stringify({ preferences: { inApp: true, email: false } }), { status: 200 }))
    : String(args[0]) === "/api/news/preferences"
      ? Promise.resolve(new Response(JSON.stringify({ available: false, preferences: { inApp: false, email: false }, channels: { inApp: true, email: false } }), { status: 200 }))
    : String(args[0]).startsWith("/api/alpha-exchange/presence")
      ? Promise.resolve(new Response(JSON.stringify({ users: {} }), { status: 200 }))
    : fetchMock(...args));
}

type TestRole = "guest" | "student" | "buyer" | "admin" | "owner";
const eventSourceInstances: MockEventSource[] = [];

class MockEventSource {
  private listeners = new Map<string, Set<(event: Event & { data?: string }) => void>>();

  constructor(public readonly url: string) {
    eventSourceInstances.push(this);
  }

  addEventListener(type: string, listener: (event: Event & { data?: string }) => void) {
    const bucket = this.listeners.get(type) ?? new Set();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: (event: Event & { data?: string }) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data = "{}") {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as Event & { data?: string });
    }
  }

  close() {}
}

function makePayload(role: TestRole) {
  return {
    profile: {
      id: "user-1",
      profilePhotoUrl: "",
      fullName: "Test User",
      username: "test-user",
      email: "test@example.com",
      role,
      roles: [role],
      memberSince: "2026-01-01T00:00:00.000Z",
      lastLogin: "2026-08-01T12:00:00.000Z",
      onlineStatus: "online" as const,
      bio: "",
      country: "",
      language: "English",
      whatsappNumber: "",
      showTradeStats: true,
      showLastActive: true,
      allowDirectMessages: true,
      allowProfileSearch: true,
      showPhonePublic: false,
      showEmailPublic: false,
    },
    stats: {
      kind: "buyer" as const,
      buyerLevel: "bronze" as const,
      nextLevel: "silver" as const,
      progressToNextLevelPercent: 13.33,
      amountToNextLevelUsdt: 13_000,
      requiredVolumeUsdt: 15_000,
      lifetimeCompletedVolumeUsdt: 2_000,
      activeTrades: 1,
      completedTrades: 2,
      reviewsGiven: 3,
    },
    roleBadge: role === "owner" ? "owner" : role === "admin" ? "administrator" : role,
    roleLabel: role === "owner" ? "Owner" : role === "admin" ? "Administrator" : role === "guest" ? "Guest" : role === "student" ? "Student" : "Buyer",
    accountStatuses: ["Active"],
  };
}

function makeSellerPayload(level: string, completedTrades: number) {
  return {
    profile: {
      id: "seller-1",
      profilePhotoUrl: "",
      fullName: "Seller User",
      username: "seller-user",
      email: "seller@example.com",
      role: "approved_seller",
      roles: ["approved_seller"],
      memberSince: "2026-01-01T00:00:00.000Z",
      lastLogin: "2026-08-01T12:00:00.000Z",
      onlineStatus: "online" as const,
      bio: "",
      country: "",
      language: "English",
      whatsappNumber: "",
      showTradeStats: true,
      showLastActive: true,
      allowDirectMessages: true,
      allowProfileSearch: true,
      showPhonePublic: false,
      showEmailPublic: false,
    },
    stats: {
      kind: "seller" as const,
      sellerLevel: level,
      nextLevel: "gold",
      progressToNextLevelPercent: 50,
      amountToNextLevelUsdt: 1000,
      lifetimeCompletedVolumeUsdt: completedTrades * 250,
      commissionPaid: 25,
      averageTradeSize: 250,
      promotionHistory: [],
      trustScore: 90,
      completedTrades,
      activeListings: 1,
      pendingListings: 0,
      averageRating: 4.8,
    },
    roleBadge: "approved_seller" as const,
    roleLabel: "Approved Seller" as const,
    accountStatuses: ["Active"],
  };
}

describe("AccountProfilePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    eventSourceInstances.length = 0;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
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
      value: class {
        constructor() {}
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the owner dashboard entry for owner accounts", async () => {
    stubProfileFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePayload("owner"),
    }));

    render(<AccountProfilePanel locale="en" />);

    await waitFor(() => expect(screen.getByText("Administration")).toBeTruthy());
    const link = screen.getByRole("link", { name: /owner dashboard/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/admin/alpha-exchange");
    expect(screen.queryByText("Manage your account path:")).toBeNull();
  });

  it("shows the admin dashboard entry for admin accounts only", async () => {
    stubProfileFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePayload("admin"),
    }));

    render(<AccountProfilePanel locale="en" />);

    await waitFor(() => expect(screen.getByRole("link", { name: /admin dashboard/i })).toBeTruthy());
    expect(screen.queryByText("Manage your account path:")).toBeNull();
  });

  it("keeps onboarding choices available for a guest account", async () => {
    stubProfileFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePayload("guest"),
    }));

    render(<AccountProfilePanel locale="en" />);

    await waitFor(() => expect(screen.getByText("Manage your account path:")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Become a Buyer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue as Guest" })).toBeTruthy();
  });

  it.each(["guest", "student"] as const)("does not give a %s profile a buyer rank or seller application", async (role) => {
    stubProfileFetch(vi.fn().mockResolvedValue({ ok: true, json: async () => makePayload(role) }));
    render(<AccountProfilePanel locale="en" />);
    await waitFor(() => expect(screen.getByText("My profile")).toBeTruthy());
    expect(screen.queryByText("Buyer rank")).toBeNull();
    expect(screen.queryByText("Reputation board")).toBeNull();
    expect(screen.queryByRole("link", { name: "Apply as approved seller" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open buyer dashboard" })).toBeNull();
    if (role === "student") expect(screen.queryByRole("button", { name: "Join Alpha Academy" })).toBeNull();
  });

  it("hides the administration section from buyers", async () => {
    stubProfileFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePayload("buyer"),
    }));

    render(<AccountProfilePanel locale="en" />);

    await waitFor(() => expect(screen.getByText("My profile")).toBeTruthy());
    expect(screen.getByText("Test User")).toBeTruthy();
    expect(screen.getByText("Your name stays private.")).toBeTruthy();
    expect(screen.queryByText("Administration")).toBeNull();
    expect(screen.queryByRole("link", { name: /admin dashboard/i })).toBeNull();
    expect(screen.getByRole("link", { name: /open buyer dashboard/i })).toBeTruthy();
    expect(screen.queryByText("Manage your account path:")).toBeNull();
    expect(screen.queryByRole("link", { name: "Become a Buyer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue as Guest" })).toBeNull();
  });

  it("does not show guest or buyer activation controls to an Arabic buyer", async () => {
    stubProfileFetch(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePayload("buyer"),
    }));

    render(<AccountProfilePanel locale="ar" />);

    await waitFor(() => expect(screen.getByText("ملفي الشخصي")).toBeTruthy());
    expect(screen.getByText("Test User")).toBeTruthy();
    expect(screen.getByText("اسمك يبقى خاصًا بك.")).toBeTruthy();
    expect(screen.queryByText("إدارة مسار حسابك:")).toBeNull();
    expect(screen.queryByRole("link", { name: "اختيار دور المشتري" })).toBeNull();
    expect(screen.queryByRole("button", { name: "المتابعة كضيف" })).toBeNull();
  });

  it("shows an error message when profile loading fails", async () => {
    stubProfileFetch(vi.fn().mockRejectedValue(new Error("network timeout")));

    render(<AccountProfilePanel locale="en" />);

    await waitFor(() => expect(screen.getByText("Failed to load identity.")).toBeTruthy());
    expect(screen.queryByText("Preparing trading identity...")).toBeNull();
  });

  it("keeps a draft across sections and live refresh, then saves through the existing profile API", async () => {
    const profile = makePayload("buyer");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      json: async () => init?.method === "PATCH"
        ? { ...profile, profile: { ...profile.profile, ...JSON.parse(String(init.body)) } }
        : profile,
    }));
    stubProfileFetch(fetchMock);
    render(<AccountProfilePanel locale="en" />);
    await screen.findByRole("tab", { name: "Overview" });
    expect(document.getElementById("profile-panel-edit")?.hidden).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Edit profile" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Country" }), { target: { value: "Romania" } });
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    await act(async () => { window.dispatchEvent(new Event("alpha-profile-updated")); });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/profile").length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole("tab", { name: "Edit profile" }));
    expect((screen.getByRole("textbox", { name: "Country" }) as HTMLInputElement).value).toBe("Romania");
    fireEvent.submit(document.getElementById("profile-edit-form")!);
    await screen.findByText("Trading identity saved.");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/profile", expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"country":"Romania"') }));
  });

  it("keeps notification controls out of the initial profile and supports keyboard tabs", async () => {
    stubProfileFetch(vi.fn().mockResolvedValue({ ok: true, json: async () => makePayload("buyer") }));
    render(<AccountProfilePanel locale="en" />);
    const overview = await screen.findByRole("tab", { name: "Overview" });
    expect(screen.queryByText("Notification Preferences")).toBeNull();
    fireEvent.keyDown(overview, { key: "End" });
    await screen.findByText("Notification Preferences");
    expect(screen.getByRole("tab", { name: "Alerts" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Alerts" }));
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(document.getElementById("profile-panel-alerts")?.hidden).toBe(true);
  });

  it.each([["contact-details", "Edit profile"], ["notification-preferences", "Alerts"]])("opens %s on the first shared navigation request", async (section, tab) => {
    stubProfileFetch(vi.fn().mockResolvedValue({ ok: true, json: async () => makePayload("buyer") }));
    render(<AccountProfilePanel locale="en" />);
    await screen.findByRole("tab", { name: "Overview" });
    act(() => window.dispatchEvent(new CustomEvent(PAGE_SECTION_NAVIGATION_EVENT, { detail: section })));
    await waitFor(() => expect(screen.getByRole("tab", { name: tab }).getAttribute("aria-selected")).toBe("true"));
    expect(document.getElementById(section)?.closest("[hidden]")).toBeNull();
  });

  it("keeps the editor and save confirmation mounted while the canonical account refreshes", async () => {
    let profile = makePayload("buyer");
    const user = { ...profile.profile, sellerStatus: "buyer" as const, preferredNetworks: [], languages: ["English"], city: "", createdAt: profile.profile.memberSince };
    let saved = false;
    let releaseSession: () => void = () => {};
    const sessionGate = new Promise<void>(resolve => { releaseSession = resolve; });
    stubProfileFetch(vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/me") {
        if (saved) await sessionGate;
        return Response.json({ user: { ...user, bio: profile.profile.bio } });
      }
      if (init?.method === "PATCH") {
        profile = { ...profile, profile: { ...profile.profile, ...JSON.parse(String(init.body)) } };
        saved = true;
      }
      return Response.json(profile);
    }));
    render(<CanonicalSessionProvider initialSessionUser={user}><AccountProfilePanel locale="en" /></CanonicalSessionProvider>);
    await screen.findByRole("tab", { name: "Edit profile" });
    fireEvent.click(screen.getByRole("tab", { name: "Edit profile" }));
    const bio = screen.getByRole("textbox", { name: "Professional bio" });
    fireEvent.change(bio, { target: { value: "My saved profile" } });
    fireEvent.submit(document.getElementById("profile-edit-form")!);
    await screen.findByText("Trading identity saved.");
    expect(screen.queryByText("Preparing trading identity...")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Professional bio" })).toBe(bio);
    await act(async () => { releaseSession(); await sessionGate; });
    await waitFor(() => expect(screen.getByText("Trading identity saved.")).toBeTruthy());
    expect(screen.getByRole("textbox", { name: "Professional bio" })).toBe(bio);
  });

  it("opens contact and notification deep links in the matching section", async () => {
    stubProfileFetch(vi.fn().mockResolvedValue({ ok: true, json: async () => makePayload("buyer") }));
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, hash: "#contact-details" } });
    try {
      render(<AccountProfilePanel locale="en" />);
      await waitFor(() => expect(screen.getByRole("tab", { name: "Edit profile" }).getAttribute("aria-selected")).toBe("true"));
      window.location.hash = "#notification-preferences";
      fireEvent(window, new Event("hashchange"));
      await waitFor(() => expect(screen.getByRole("tab", { name: "Alerts" }).getAttribute("aria-selected")).toBe("true"));
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("puts seller tools near the top and keeps the unreleased journal non-navigable", async () => {
    stubProfileFetch(vi.fn().mockResolvedValue({ ok: true, json: async () => makeSellerPayload("gold", 8) }));
    render(<AccountProfilePanel locale="en" />);
    const nav = await screen.findByRole("navigation", { name: "Quick actions" });
    expect(nav.querySelector('a[href="/usdt-exchange#my-listings-section"]')).toBeTruthy();
    expect(nav.querySelector('a[href="/trades"]')).toBeTruthy();
    expect(nav.querySelector('a[href="/journal"]')).toBeNull();
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(nav.compareDocumentPosition(document.getElementById("profile-edit-form")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["en", "buyer"], ["en", "seller"], ["en", "student"],
    ["ar", "buyer"], ["ar", "seller"], ["ar", "student"],
  ] as const)("opens the released journal from the %s %s profile", async (locale, role) => {
    const payload = role === "seller" ? makeSellerPayload("gold", 8) : makePayload(role);
    stubProfileFetch(vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    render(<AccountProfilePanel locale={locale} journalEnabled />);
    const journal = await screen.findByRole("link", { name: locale === "ar" ? "سجل التداول" : "Trading journal" });
    expect(journal.getAttribute("href")).toBe("/journal");
    expect(journal.closest("nav")).toBeTruthy();
    expect(screen.queryByText(locale === "ar" ? "قريبًا" : "Coming soon")).toBeNull();
  });

  it("never exposes an unexpected English photo API error in Arabic", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePayload("buyer"),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Storage provider bucket is unavailable" }),
      });
    stubProfileFetch(fetchMock);

    render(<AccountProfilePanel locale="ar" />);
    await waitFor(() => expect(screen.getByText(publicAccountId({ id: "user-1", role: "buyer" }))).toBeTruthy());

    const input = screen.getByLabelText("اختيار صورة شخصية");
    fireEvent.change(input, {
      target: { files: [new File(["photo"], "profile.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(screen.getByText("تعذر رفع الصورة الشخصية. يرجى المحاولة مرة أخرى.")).toBeTruthy());
    expect(screen.queryByText(/Storage provider bucket/i)).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/profile/photo", expect.objectContaining({
      headers: { "X-Locale": "ar" },
    }));
  });

  it("shows localized stable photo validation errors", async () => {
    stubProfileFetch(vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makePayload("buyer") })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          code: "UNSUPPORTED_IMAGE_FORMAT",
          error: "Unsupported image format. Use JPEG, PNG, WebP, or GIF.",
        }),
      }));

    render(<AccountProfilePanel locale="ar" />);
    await waitFor(() => expect(screen.getByText(publicAccountId({ id: "user-1", role: "buyer" }))).toBeTruthy());
    fireEvent.change(screen.getByLabelText("اختيار صورة غلاف"), {
      target: { files: [new File(["photo"], "cover.svg", { type: "image/svg+xml" })] },
    });

    await waitFor(() => expect(screen.getByText("صيغة الصورة غير مدعومة. استخدم JPEG أو PNG أو WebP أو GIF.")).toBeTruthy());
    expect(screen.queryByText(/^Unsupported image format/)).toBeNull();
  });

  it("clears cached private profile data when the canonical session becomes anonymous", async () => {
    const replaceSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        pathname: "/en/profile",
        search: "",
        hash: "",
        replace: replaceSpy,
      },
    });
    stubProfileFetch(vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: {
            id: "user-1",
            fullName: "Test User",
            email: "test@example.com",
            role: "buyer",
            roles: ["buyer"],
            sellerStatus: "buyer",
            whatsappNumber: "",
            preferredNetworks: [],
            profilePhotoUrl: "",
            languages: [],
            bio: "",
            onlineStatus: "offline",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => makePayload("buyer") })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: null }) }));

    try {
      render(
        <CanonicalSessionProvider initialSessionUser={null}>
          <AccountProfilePanel locale="en" />
        </CanonicalSessionProvider>,
      );

      await waitFor(() => expect(screen.getByText(publicAccountId({ id: "user-1", role: "buyer" }))).toBeTruthy());
      await act(async () => { window.dispatchEvent(new Event("alpha-auth-changed")); });

      await waitFor(() => expect(screen.getByText("Your session has expired. Please sign in again.")).toBeTruthy());
      expect(screen.queryByText(publicAccountId({ id: "user-1", role: "buyer" }))).toBeNull();
      expect(replaceSpy).toHaveBeenCalledWith("/en/login?redirectTo=%2Fen%2Fprofile");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("refreshes live profile stats when a notifications stream event arrives", async () => {
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    stubProfileFetch(vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { role: "approved_seller", roles: ["approved_seller"] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSellerPayload("bronze", 1),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSellerPayload("silver", 2),
      }));

    render(<AccountProfilePanel locale="en" />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Bronze Seller" })).toBeTruthy());
    await waitFor(() => expect(eventSourceInstances).toHaveLength(1));
    expect(screen.queryByText("Manage your account path:")).toBeNull();

    eventSourceInstances[0].emit("notifications", JSON.stringify({ notifications: [], unreadCount: 1 }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Silver Seller" })).toBeTruthy());
    expect(screen.getByText("2")).toBeTruthy();
  });

  it.each(["guest", "student"] as const)("keeps a signed-in %s exchange visit free of buyer and seller tools", async (role) => {
    const user = { id: "user-1", fullName: "Test User", email: "guest@example.test", role, roles: [role], sellerStatus: "buyer" as const, whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: ["English"], bio: "", country: "", city: "", onlineStatus: "online" as const, createdAt: "2026-01-01T00:00:00.000Z" };
    stubProfileFetch(vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("/api/auth/me") ? { user }
        : url.includes("/api/auth/profile") ? makePayload(role)
          : { listings: [], requests: [], notifications: [], activity: [], applications: [] };
      return new Response(JSON.stringify(payload), { status: 200 });
    }));
    render(<UsdtExchangePage locale="en" initialSessionUser={user} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Welcome back, Test User" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Buyer Dashboard" })).toBeNull();
    expect(screen.queryByRole("progressbar", { name: "Buyer rank progress" })).toBeNull();
    expect(screen.queryByRole("button", { name: /My Trade Requests|Active Trades|Create Listing|Apply as.*seller/i })).toBeNull();
    expect(screen.queryByText("My Profile & Achievements")).toBeNull();
    expect(screen.getByText("My Profile")).toBeTruthy();
  });

  it("renders the buyer landing when sellerStatus is buyer even if roles include approved_seller", async () => {
    stubProfileFetch(vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/auth/profile")) {
        return {
          ok: true,
          headers: new Headers(),
          json: async () => ({
            profile: {
              id: "buyer-1",
              profilePhotoUrl: "",
              coverBannerUrl: "",
              fullName: "Buyer User",
              username: "buyer-user",
              email: "buyer@example.com",
              role: "buyer",
              roles: ["buyer"],
              memberSince: "2026-01-01T00:00:00.000Z",
              lastLogin: "2026-08-01T12:00:00.000Z",
              onlineStatus: "online" as const,
              bio: "",
              country: "",
              language: "English",
              whatsappNumber: "",
              showTradeStats: true,
              showLastActive: true,
              allowDirectMessages: true,
              allowProfileSearch: true,
              showPhonePublic: false,
              showEmailPublic: false,
            },
            stats: {
              kind: "buyer" as const,
              buyerLevel: "gold" as const,
              nextLevel: "diamond" as const,
              progressToNextLevelPercent: 2.5,
              amountToNextLevelUsdt: 97_500,
              requiredVolumeUsdt: 150_000,
              lifetimeCompletedVolumeUsdt: 52_500,
              activeTrades: 2,
              completedTrades: 8,
              reviewsGiven: 4,
            },
            roleBadge: "buyer" as const,
            roleLabel: "Buyer" as const,
            accountStatuses: ["Active"],
          }),
        };
      }

      if (url.includes("/api/alpha-exchange/listings")) {
        return {
          ok: true,
          json: async () => ({ listings: [] }),
        };
      }

      if (url.includes("/api/alpha-exchange/notifications")) {
        return {
          ok: true,
          json: async () => ({ notifications: [], activity: [] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ user: { id: "buyer-1", fullName: "Buyer User", email: "buyer@example.com", role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "buyer", whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: ["English"], bio: "", country: "", city: "", onlineStatus: "online" as const, createdAt: "2026-01-01T00:00:00.000Z" } }),
      };
    }));

    render(<UsdtExchangePage locale="en" initialSessionUser={{ id: "buyer-1", fullName: "Buyer User", email: "buyer@example.com", role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "buyer", whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: ["English"], bio: "", country: "", city: "", onlineStatus: "online" as const, createdAt: "2026-01-01T00:00:00.000Z" }} />);

    await waitFor(() => expect(screen.getAllByText("Gold Buyer").length).toBeGreaterThan(0));
    expect(screen.getByRole("heading", { name: "Welcome back, Buyer User" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Buyer rank progress" })).toBeTruthy();
    expect(screen.getAllByText(/52,500/).length).toBeGreaterThan(0);
  });

  it("renders a buyer rank card on the exchange landing using live profile stats", async () => {
    stubProfileFetch(vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/auth/profile")) {
        return {
          ok: true,
          headers: new Headers(),
          json: async () => ({
            profile: {
              id: "buyer-1",
              profilePhotoUrl: "",
              coverBannerUrl: "",
              fullName: "Buyer User",
              username: "buyer-user",
              email: "buyer@example.com",
              role: "buyer",
              roles: ["buyer"],
              memberSince: "2026-01-01T00:00:00.000Z",
              lastLogin: "2026-08-01T12:00:00.000Z",
              onlineStatus: "online" as const,
              bio: "",
              country: "",
              language: "English",
              whatsappNumber: "",
              showTradeStats: true,
              showLastActive: true,
              allowDirectMessages: true,
              allowProfileSearch: true,
              showPhonePublic: false,
              showEmailPublic: false,
            },
            stats: {
              kind: "buyer" as const,
              buyerLevel: "gold" as const,
              nextLevel: "diamond" as const,
              progressToNextLevelPercent: 2.5,
              amountToNextLevelUsdt: 97_500,
              requiredVolumeUsdt: 150_000,
              lifetimeCompletedVolumeUsdt: 52_500,
              activeTrades: 2,
              completedTrades: 8,
              reviewsGiven: 4,
            },
            roleBadge: "buyer" as const,
            roleLabel: "Buyer" as const,
            accountStatuses: ["Active"],
          }),
        };
      }

      if (url.includes("/api/alpha-exchange/listings")) {
        return {
          ok: true,
          json: async () => ({ listings: [] }),
        };
      }

      if (url.includes("/api/alpha-exchange/notifications")) {
        return {
          ok: true,
          json: async () => ({ notifications: [], activity: [] }),
        };
      }

      return {
        ok: true,
        json: async () => ({ user: { id: "buyer-1", fullName: "Buyer User", email: "buyer@example.com", role: "buyer", roles: ["buyer"], sellerStatus: "buyer", whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: ["English"], bio: "", country: "", city: "", onlineStatus: "online" as const, createdAt: "2026-01-01T00:00:00.000Z" } }),
      };
    }));

    render(<UsdtExchangePage locale="en" initialSessionUser={{ id: "buyer-1", fullName: "Buyer User", email: "buyer@example.com", role: "buyer", roles: ["buyer"], sellerStatus: "buyer", whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: ["English"], bio: "", country: "", city: "", onlineStatus: "online" as const, createdAt: "2026-01-01T00:00:00.000Z" }} />);

    await waitFor(() => expect(screen.getAllByText("Gold Buyer").length).toBeGreaterThan(0));
    expect(screen.getByRole("progressbar", { name: "Buyer rank progress" })).toBeTruthy();
    expect(screen.getAllByText(/52,500/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText("Become an Approved Seller")).toBeTruthy());
    expect(screen.getAllByText("Become an Approved Seller")).toHaveLength(1);
    expect(screen.getByText("Become an Approved Seller").compareDocumentPosition(screen.getByText("Your workspace")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
