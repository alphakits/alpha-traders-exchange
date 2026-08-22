import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanonicalSessionProvider } from "@/components/auth/canonical-session-provider";
import { AccountProfilePanel } from "@/components/profile/account-profile-panel";
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

type TestRole = "buyer" | "admin" | "owner";
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
      activeTrades: 1,
      completedTrades: 2,
      reviewsGiven: 3,
    },
    roleBadge: role === "owner" ? "owner" : role === "admin" ? "administrator" : "buyer",
    roleLabel: role === "owner" ? "Owner" : role === "admin" ? "Administrator" : "Buyer",
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePayload("owner"),
    }));

    render(<AccountProfilePanel locale="en" />);

    await waitFor(() => expect(screen.getByText("Administration")).toBeTruthy());
    const link = screen.getByRole("link", { name: /owner dashboard/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/admin/alpha-exchange");
  });

  it("shows the admin dashboard entry for admin accounts only", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePayload("admin"),
    }));

    render(<AccountProfilePanel locale="en" />);

    await waitFor(() => expect(screen.getByRole("link", { name: /admin dashboard/i })).toBeTruthy());
  });

  it("hides the administration section from buyers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePayload("buyer"),
    }));

    render(<AccountProfilePanel locale="en" />);

    await waitFor(() => expect(screen.getByText("Public trading identity")).toBeTruthy());
    expect(screen.queryByText("Administration")).toBeNull();
    expect(screen.queryByRole("link", { name: /dashboard/i })).toBeNull();
  });

  it("shows an error message when profile loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network timeout")));

    render(<AccountProfilePanel locale="en" />);

    await waitFor(() => expect(screen.getByText("Failed to load identity.")).toBeTruthy());
    expect(screen.queryByText("Preparing trading identity...")).toBeNull();
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
    vi.stubGlobal("fetch", vi.fn()
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

      await waitFor(() => expect(screen.getByText("Test User")).toBeTruthy());
      window.dispatchEvent(new Event("alpha-auth-changed"));

      await waitFor(() => expect(screen.getByText("Your session has expired. Please sign in again.")).toBeTruthy());
      expect(screen.queryByText("Test User")).toBeNull();
      expect(replaceSpy).toHaveBeenCalledWith("/en/login?sessionExpired=1&redirectTo=%2Fen%2Fprofile");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("refreshes live profile stats when a notifications stream event arrives", async () => {
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn()
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

    await waitFor(() => expect(screen.getByText("Bronze")).toBeTruthy());
    expect(eventSourceInstances).toHaveLength(1);

    eventSourceInstances[0].emit("notifications", JSON.stringify({ notifications: [], unreadCount: 1 }));

    await waitFor(() => expect(screen.getByText("Silver")).toBeTruthy());
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("renders the buyer landing when sellerStatus is buyer even if roles include approved_seller", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
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

    await waitFor(() => expect(screen.getByText("Trusted Buyer")).toBeTruthy());
    expect(screen.getByText("Buyer level")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("renders a buyer rank card on the exchange landing using live profile stats", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
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

    await waitFor(() => expect(screen.getByText("Trusted Buyer")).toBeTruthy());
    expect(screen.getByText("Buyer level")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });
});
