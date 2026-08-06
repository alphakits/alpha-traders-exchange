import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountProfilePanel } from "@/components/profile/account-profile-panel";

vi.mock("next/image", () => ({
  default: () => <span data-testid="next-image" />,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
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
});
