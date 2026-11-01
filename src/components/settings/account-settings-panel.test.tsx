import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountSettingsPanel } from "@/components/settings/account-settings-panel";

const sessionState = vi.hoisted(() => ({
  user: null as { role: string; roles: string[]; sellerStatus: string } | null,
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({
  useOptionalCanonicalSession: () => sessionState.user ? { user: sessionState.user } : null,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

afterEach(() => {
  sessionState.user = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("Role appropriate account settings", () => {
  it.each(["guest", "student"])("hides trading and seller preferences from a signed-in %s", async (role) => {
    sessionState.user = { role, roles: [role], sellerStatus: "buyer" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ preferences: {} }), { status: 200 }));
    await act(async () => { render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} initialTab="notifications" initialSellerBankAccess={true} />); });
    expect(screen.queryByText("Trade updates")).toBeNull();
    expect(screen.queryByText("New purchase requests")).toBeNull();
    expect(screen.queryByText("Listing updates")).toBeNull();
    expect(screen.queryByText("Seller application updates")).toBeNull();
    expect(screen.queryByText("Bank Accounts")).toBeNull();
    expect(screen.getByText("Admin announcements")).toBeTruthy();
  });
  it("removes seller bank controls as soon as seller access is revoked", async () => {
    sessionState.user = { role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ profile: {}, preferences: {}, accounts: [] }), { status: 200 }));
    const { rerender } = render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} initialTab="profile" initialSellerBankAccess={true} />);
    await act(async () => {});
    expect(screen.getByText("Bank Accounts")).toBeTruthy();
    sessionState.user = { role: "buyer", roles: ["buyer"], sellerStatus: "rejected" };
    rerender(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} initialTab="profile" initialSellerBankAccess={true} />);
    expect(screen.queryByText("Bank Accounts")).toBeNull();
  });
});

describe("Account settings Discord connection", () => {
  const connection = {
    discordUserId: "987654321098765432",
    username: "alpha_user",
    globalName: "Alpha User",
    linkedAt: "2026-08-07T12:00:00.000Z",
    lastSyncedAt: null,
  };

  it.each(["unavailable", "malformed", "invalid_connection", "invalid_json", "transport"])("does not claim disconnected when the identity read is %s", async (failure) => {
    let recovered = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/api/discord/identity")) {
        if (recovered) return Response.json({ connection });
        if (failure === "transport") throw new TypeError("Network unavailable");
        if (failure === "invalid_connection") return Response.json({ connection: { username: null } });
        if (failure === "invalid_json") return new Response("{", { status: 200 });
        return Response.json({}, { status: failure === "unavailable" ? 503 : 200 });
      }
      return Response.json({ profile: { id: "alpha-user" }, preferences: {} });
    });
    render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} />);
    expect(await screen.findByRole("button", { name: "Retry connection status" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Discord" })).toBeNull();
    recovered = true;
    fireEvent.click(screen.getByRole("button", { name: "Retry connection status" }));
    expect(await screen.findByText("@alpha_user")).toBeTruthy();
  });

  it.each(["response", "body", "confirmation_response", "confirmation_body"])("bounds a stalled unlink %s without retrying or accepting a late success", async (stage) => {
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    let deleteSignal: AbortSignal | null | undefined;
    let confirming = false;
    let recovered = false;
    const stalled = new Promise<unknown>(resolve => { release = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/api/discord/identity")) {
        if (init?.method === "DELETE") {
          deleteSignal = init.signal;
          if (stage.startsWith("confirmation")) {
            confirming = true;
            return Response.json({ unlinked: true });
          }
          return stage === "response" ? await stalled as Response
            : { ok: true, json: () => stalled } as Response;
        }
        if (recovered) return Response.json({ connection: null });
        if (confirming) return stage === "confirmation_response" ? await stalled as Response
          : { ok: true, json: () => stalled } as Response;
        return Response.json({ connection });
      }
      return Response.json({ profile: { id: "alpha-user" }, preferences: {} });
    });
    await act(async () => { render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} />); });
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    expect(screen.getByText(/Disconnect could not be confirmed in time/)).toBeTruthy();
    expect(deleteSignal?.aborted).toBe(true);
    expect(screen.getByText("@alpha_user")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Connect Discord" })).toBeNull();
    const latePayload = stage.startsWith("confirmation") ? { connection: null } : { unlinked: true };
    await act(async () => { release(stage.endsWith("response") ? Response.json(latePayload) : latePayload); });
    expect(screen.getByText("@alpha_user")).toBeTruthy();
    recovered = true;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry connection status" })); });
    expect(screen.getByRole("button", { name: "Connect Discord" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

  it.each([
    ["en", "response"], ["en", "body"], ["ar", "response"], ["ar", "body"],
  ] as const)("recovers a stalled %s identity %s and ignores the old response", async (locale, stage) => {
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    let readSignal: AbortSignal | null | undefined;
    let recovered = false;
    const stalled = new Promise<unknown>(resolve => { release = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/api/discord/identity")) {
        if (recovered) return Response.json({ connection: null });
        readSignal = init?.signal;
        return stage === "response" ? await stalled as Response
          : { ok: true, json: () => stalled } as Response;
      }
      return Response.json({ profile: { id: "alpha-user" }, preferences: {} });
    });
    await act(async () => { render(<AccountSettingsPanel locale={locale} phoneVerificationEnabled={false} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    const retry = locale === "ar" ? "إعادة التحقق من حالة الاتصال" : "Retry connection status";
    const connect = locale === "ar" ? "ربط Discord" : "Connect Discord";
    expect(screen.getByRole("button", { name: retry })).toBeTruthy();
    expect(readSignal?.aborted).toBe(true);
    expect(screen.queryByRole("button", { name: connect })).toBeNull();
    recovered = true;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: retry })); });
    expect(screen.getByRole("button", { name: connect })).toBeTruthy();
    await act(async () => { release(stage === "response" ? Response.json({ connection }) : { connection }); });
    expect(screen.queryByText("@alpha_user")).toBeNull();
    expect(screen.getByRole("button", { name: connect })).toBeTruthy();
  });

  it.each(["response", "body"])("bounds OAuth start %s and never navigates after a late response", async (stage) => {
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    let startSignal: AbortSignal | null | undefined;
    const stalled = new Promise<unknown>(resolve => { release = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/api/discord/oauth/start")) {
        startSignal = init?.signal;
        return stage === "response" ? await stalled as Response
          : { ok: true, json: () => stalled } as Response;
      }
      if (String(input).includes("/api/discord/identity")) return Response.json({ connection: null });
      return Response.json({ profile: { id: "alpha-user" }, preferences: {} });
    });
    await act(async () => { render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} />); });
    fireEvent.click(screen.getByRole("button", { name: "Connect Discord" }));
    expect(screen.getByRole("button", { name: "Connecting..." }).hasAttribute("disabled")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    expect(screen.getByText("Starting Discord connection took too long. Please try again.")).toBeTruthy();
    expect(startSignal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Connect Discord" }).hasAttribute("disabled")).toBe(false);
    const latePayload = { authorizationUrl: "#late-discord-redirect" };
    await act(async () => { release(stage === "response" ? Response.json(latePayload) : latePayload); });
    expect(window.location.hash).toBe("");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("cancels an unlink on unmount without a late read-back or duplicate mutation", async () => {
    let release!: (value: Response) => void;
    let deleteSignal: AbortSignal | null | undefined;
    const stalled = new Promise<Response>(resolve => { release = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/api/discord/identity")) {
        if (init?.method === "DELETE") {
          deleteSignal = init.signal;
          return await stalled;
        }
        return Response.json({ connection });
      }
      return Response.json({ profile: { id: "alpha-user" }, preferences: {} });
    });
    const { unmount } = render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} />);
    await screen.findByText("@alpha_user");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const confirm = screen.getByRole("button", { name: "Confirm disconnect" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    unmount();
    expect(deleteSignal?.aborted).toBe(true);
    await act(async () => { release(Response.json({ unlinked: true })); });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/discord/identity"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

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
      expect(screen.getByText(/removes your managed community roles/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Confirm disconnect" })).toBeTruthy();
    },
  );

  it("only clears a connected identity after explicit unlink confirmation", async () => {
    let deleted = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/auth/profile")) {
        return new Response(JSON.stringify({ profile: { id: "alpha-user" } }), { status: 200 });
      }
      if (url.includes("/api/discord/identity")) {
        if (init?.method === "DELETE") {
          deleted = true;
          return new Response(JSON.stringify({ unlinked: true }), { status: 200 });
        }
        return new Response(JSON.stringify({
          connection: deleted ? null : connection,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
    });

    render(<AccountSettingsPanel locale="en" phoneVerificationEnabled={false} />);
    await screen.findByText("Alpha User");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));

    expect(await screen.findByRole("button", { name: "Connect Discord" })).toBeTruthy();
    expect(screen.getByText(/Discord disconnected/i)).toBeTruthy();
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([, init]) =>
      init?.method === "DELETE")).toHaveLength(1);
  });

  it("preserves connected state until the server confirms the mapping is absent", async () => {
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

    expect(await screen.findByText(
      "Disconnect was requested but could not be confirmed. Refresh to verify.",
    )).toBeTruthy();
    expect(screen.getByText("Alpha User")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Discord" })).toBeNull();
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

describe("Account settings notification channels", () => {
  it.each([
    {
      locale: "en" as const,
      visibleChannels: ["In-app notifications", "Email notifications"],
      hiddenSmsLabel: "SMS notifications",
      hiddenPushLabel: "Browser push",
      hiddenPhoneAction: "Send code",
      emailOnlyNotice: "Email verification is the only verification method currently enabled. Phone verification and SMS are off.",
    },
    {
      locale: "ar" as const,
      visibleChannels: ["إشعارات داخل المنصة", "إشعارات البريد الإلكتروني"],
      hiddenSmsLabel: "إشعارات الرسائل النصية",
      hiddenPushLabel: "إشعارات المتصفح",
      hiddenPhoneAction: "إرسال الرمز",
      emailOnlyNotice: "التحقق من البريد الإلكتروني هو طريقة التحقق الوحيدة المفعّلة حاليًا. التحقق عبر الهاتف ورسائل SMS متوقفان.",
    },
  ])("shows email-only verification and only active delivery channels in $locale", async ({
    locale,
    visibleChannels,
    hiddenSmsLabel,
    hiddenPushLabel,
    hiddenPhoneAction,
    emailOnlyNotice,
  }) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/auth/profile")) {
        return new Response(JSON.stringify({ profile: { id: "alpha-user" } }), { status: 200 });
      }
      if (url.includes("/api/discord/identity")) {
        return new Response(JSON.stringify({ connection: null }), { status: 200 });
      }
      if (url.includes("/api/alpha-exchange/notification-preferences")) {
        return new Response(JSON.stringify({
          preferences: {
            inApp: true,
            email: true,
            sms: false,
            // Legacy data remains accepted by the API but must not produce a fake control.
            browserPush: true,
            browserPushTradeUpdates: true,
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <AccountSettingsPanel
        locale={locale}
        phoneVerificationEnabled={false}
        initialTab="notifications"
      />,
    );

    for (const label of visibleChannels) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
    expect(screen.getByText(emailOnlyNotice)).toBeTruthy();
    expect(screen.queryByText(hiddenSmsLabel)).toBeNull();
    expect(screen.queryByRole("button", { name: hiddenPhoneAction })).toBeNull();
    expect(screen.queryByText(hiddenPushLabel)).toBeNull();
    expect(screen.queryByText(locale === "ar" ? "تفعيل إشعارات المتصفح" : "Enable browser push")).toBeNull();
  });
});
