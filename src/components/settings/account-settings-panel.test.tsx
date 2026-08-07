import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountSettingsPanel } from "@/components/settings/account-settings-panel";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("Account settings Discord connection", () => {
  it.each([320, 390, 1280])(
    "shows disconnected Connected Accounts without requiring a hidden tab at %ipx",
    async (width) => {
      Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        if (String(input).includes("/api/auth/profile")) {
          return new Response(JSON.stringify({ profile: { id: "alpha-user" } }), { status: 200 });
        }
        if (String(input).includes("/api/discord/identity")) {
          return new Response(JSON.stringify({ connection: null }), { status: 200 });
        }
        return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
      });

      render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} />);

      expect(screen.getByRole("heading", { name: "Connected Accounts" })).toBeTruthy();
      expect(await screen.findByRole("button", { name: "Connect Discord" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Security" }).getAttribute("class"))
        .toContain("bg-[#C9A227]");
    },
  );

  it.each([320, 390, 1280])(
    "shows concise connected state and explicit unlink warning at %ipx",
    async (width) => {
      Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/api/auth/profile")) {
          return new Response(JSON.stringify({ profile: { id: "alpha-user" } }), { status: 200 });
        }
        if (url.includes("/api/discord/identity")) {
          return new Response(JSON.stringify({
            connection: {
              discordUserId: "987654321098765432",
              username: "alpha_user",
              globalName: "Alpha User",
              linkedAt: "2026-08-07T12:00:00.000Z",
              lastSyncedAt: null,
            },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
      });

      render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} />);
      await screen.findByText("Alpha User");
      expect(screen.getByText("@alpha_user")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
      expect(screen.getByText(/removes managed seller roles/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Confirm disconnect" })).toBeTruthy();
    },
  );

  it("shows safe callback failure UX without exposing provider details", async () => {
    window.history.replaceState({}, "", "/en/settings?discord=failed");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/api/auth/profile")) {
        return new Response(JSON.stringify({ profile: { id: "alpha-user" } }), { status: 200 });
      }
      if (String(input).includes("/api/discord/identity")) {
        return new Response(JSON.stringify({ connection: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
    });

    render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} />);
    await waitFor(() => {
      expect(screen.getByText("Discord could not be connected. Please try again.")).toBeTruthy();
    });
  });
});
