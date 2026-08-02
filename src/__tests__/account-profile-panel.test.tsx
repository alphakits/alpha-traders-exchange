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

describe("AccountProfilePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
