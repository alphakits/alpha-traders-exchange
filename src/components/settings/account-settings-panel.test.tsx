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
  const connection = {
    discordUserId: "987654321098765432",
    username: "alpha_user",
    globalName: "Alpha User",
    linkedAt: "2026-08-07T12:00:00.000Z",
    lastSyncedAt: null,
  };

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
          return new Response(JSON.stringify({ connection }), { status: 200 });
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

  it("only clears a connected identity after explicit unlink confirmation", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/auth/profile")) {
        return new Response(JSON.stringify({ profile: { id: "alpha-user" } }), { status: 200 });
      }
      if (url.includes("/api/discord/identity")) {
        if (init?.method === "DELETE") {
          return new Response(JSON.stringify({ unlinked: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ connection }), { status: 200 });
      }
      return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
    });

    render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} />);
    await screen.findByText("Alpha User");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));

    expect(await screen.findByRole("button", { name: "Connect Discord" })).toBeTruthy();
    expect(screen.getByText(/Discord disconnected/i)).toBeTruthy();
  });

  it.each([
    {
      name: "unlinked false",
      response: new Response(JSON.stringify({
        unlinked: false,
        error: "Discord is not connected to this account. Refresh and try again.",
      }), { status: 409 }),
      message: "Discord is not connected to this account. Refresh and try again.",
    },
    {
      name: "malformed success response",
      response: new Response(JSON.stringify({ success: true }), { status: 200 }),
      message: "Could not disconnect Discord.",
    },
  ])("preserves connected state for $name", async ({ response, message }) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/auth/profile")) {
        return new Response(JSON.stringify({ profile: { id: "alpha-user" } }), { status: 200 });
      }
      if (url.includes("/api/discord/identity")) {
        if (init?.method === "DELETE") return response.clone();
        return new Response(JSON.stringify({ connection }), { status: 200 });
      }
      return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
    });

    render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} />);
    await screen.findByText("Alpha User");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText("Alpha User")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Discord" })).toBeNull();
  });

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
