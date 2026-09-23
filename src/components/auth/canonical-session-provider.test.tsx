import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useEffect } from "react";
import {
  CanonicalSessionProvider,
  CANONICAL_SESSION_READ_TIMEOUT_MS,
  getCanonicalSessionRecoveryDelayMs,
  getSessionExpiryLoginDestination,
  useCanonicalSession,
} from "@/components/auth/canonical-session-provider";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function Probe() {
  const { user, isResolving } = useCanonicalSession();
  return <output>{isResolving ? "resolving" : user?.id ?? "anonymous"}</output>;
}

function ErrorProbe() {
  const { error, user } = useCanonicalSession();
  return <output>{`${user?.id ?? "anonymous"}:${error ? "error" : "ok"}`}</output>;
}

describe("CanonicalSessionProvider", () => {
  it("times out a stalled session read and recovers without treating the outage as logout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = {
      id: "timeout-seller", fullName: "Test Seller", email: "test@example.test", role: "approved_seller" as const,
      roles: ["approved_seller" as const], sellerStatus: "approved_seller" as const, whatsappNumber: "", preferredNetworks: [],
      profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline" as const, createdAt: "2026-01-01",
    };
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }))
      .mockResolvedValue({ ok: true, json: async () => ({ user }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CanonicalSessionProvider initialSessionUser={user}><ErrorProbe /></CanonicalSessionProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(CANONICAL_SESSION_READ_TIMEOUT_MS); });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.getByText("timeout-seller:error")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByText("timeout-seller:ok")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh read after StrictMode cleanup instead of reusing an aborted promise", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }))
      .mockResolvedValue({ ok: true, json: async () => ({ user: null }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<StrictMode><CanonicalSessionProvider initialSessionUser={null}><Probe /></CanonicalSessionProvider></StrictMode>);
    await waitFor(() => expect(screen.getByText("anonymous")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses capped exponential backoff for transient canonical-session recovery", () => {
    expect(getCanonicalSessionRecoveryDelayMs(1)).toBe(1_000);
    expect(getCanonicalSessionRecoveryDelayMs(2)).toBe(2_000);
    expect(getCanonicalSessionRecoveryDelayMs(3)).toBe(4_000);
    expect(getCanonicalSessionRecoveryDelayMs(4)).toBe(8_000);
    expect(getCanonicalSessionRecoveryDelayMs(5)).toBe(16_000);
    expect(getCanonicalSessionRecoveryDelayMs(6)).toBe(30_000);
    expect(getCanonicalSessionRecoveryDelayMs(50)).toBe(30_000);
  });

  it("automatically restores a previously authenticated session after a transient outage", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const recoveredUser = {
      id: "recovered-seller", fullName: "Recovered Seller", email: "recovered@example.test", role: "approved_seller" as const,
      roles: ["approved_seller" as const], sellerStatus: "approved_seller" as const, whatsappNumber: "", preferredNetworks: [],
      profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline" as const, createdAt: "2026-01-01",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "unavailable" }) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "still unavailable" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: recoveredUser }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CanonicalSessionProvider initialSessionUser={recoveredUser}>
        <ErrorProbe />
      </CanonicalSessionProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("recovered-seller:error")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("recovered-seller:error")).toBeTruthy();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("recovered-seller:ok")).toBeTruthy();
  });

  it("does not retry a canonically confirmed anonymous session", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: null }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CanonicalSessionProvider initialSessionUser={null}>
        <Probe />
      </CanonicalSessionProvider>,
    );

    await waitFor(() => expect(screen.getByText("anonymous")).toBeTruthy());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers an initial unavailable session without requiring the app to be killed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Network lost"))
      .mockResolvedValue({ ok: true, json: async () => ({ user: { id: "restored-user" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CanonicalSessionProvider initialSessionUser={null}><ErrorProbe /></CanonicalSessionProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("anonymous:error")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByText("restored-user:ok")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces phone resume events without reloading consumers of an unchanged account", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const accountChanged = vi.fn();
    const fetchMock = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ user: { id: "resumed-user" } }) }));
    vi.stubGlobal("fetch", fetchMock);
    function WorkspaceProbe() {
      const { user } = useCanonicalSession();
      useEffect(() => { if (user) accountChanged(user.id); }, [user]);
      return <ErrorProbe />;
    }
    render(<CanonicalSessionProvider initialSessionUser={null}><WorkspaceProbe /></CanonicalSessionProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("resumed-user:ok")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(accountChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByText("resumed-user:ok")).toBeTruthy();
  });

  it("does not present an unresolved session as anonymous between recovery attempts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const retry = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockReturnValueOnce(retry.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<CanonicalSessionProvider initialSessionUser={null}><ErrorProbe /></CanonicalSessionProvider>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("anonymous:error")).toBeTruthy();
    await act(async () => { retry.resolve(Response.json({ user: null })); });
    expect(screen.getByText("anonymous:ok")).toBeTruthy();
  });

  it("invalidates an in-flight canonical response after an auth-state change", async () => {
    const initial = deferred<Response>();
    const afterAuthChange = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(afterAuthChange.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CanonicalSessionProvider initialSessionUser={null}>
        <Probe />
      </CanonicalSessionProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event("alpha-auth-changed")));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);

    await act(async () => {
      initial.resolve({ ok: true, json: async () => ({ user: { id: "stale-user" } }) } as Response);
      await Promise.resolve();
    });
    expect(screen.getByText("resolving")).toBeTruthy();

    await act(async () => {
      afterAuthChange.resolve({ ok: true, json: async () => ({ user: null }) } as Response);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("anonymous")).toBeTruthy());
  });

  it("aborts a pending read on sign-out and ignores its late authenticated response", async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<CanonicalSessionProvider initialSessionUser={null}><Probe /></CanonicalSessionProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event("alpha-auth-signed-out")));
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.getByText("anonymous")).toBeTruthy();
    await act(async () => {
      response.resolve({ ok: true, json: async () => ({ user: { id: "signed-out-user" } }) } as Response);
    });
    expect(screen.getByText("anonymous")).toBeTruthy();
  });

  it("coalesces normal concurrent refreshes into one canonical request", async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal("fetch", fetchMock);

    function RefreshProbe() {
      const { refresh } = useCanonicalSession();
      return <button type="button" onClick={() => { void refresh(); void refresh(); }}>Refresh</button>;
    }

    render(
      <CanonicalSessionProvider initialSessionUser={null}>
        <RefreshProbe />
      </CanonicalSessionProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => screen.getByRole("button", { name: "Refresh" }).click());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      response.resolve({ ok: true, json: async () => ({ user: null }) } as Response);
      await Promise.resolve();
    });
  });

  it("keeps a server-authenticated workspace interactive while verifying the session in the background", async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal("fetch", fetchMock);

    const initialUser = {
      id: "ready-seller", fullName: "Ready Seller", email: "ready@example.test", role: "approved_seller" as const,
      roles: ["approved_seller" as const], sellerStatus: "approved_seller" as const, whatsappNumber: "", preferredNetworks: [],
      profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline" as const, createdAt: "2026-01-01",
    };

    render(
      <CanonicalSessionProvider initialSessionUser={initialUser}>
        <Probe />
      </CanonicalSessionProvider>,
    );

    expect(screen.getByText("ready-seller")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("ready-seller")).toBeTruthy();

    await act(async () => {
      response.resolve({ ok: true, json: async () => ({ user: initialUser }) } as Response);
      await Promise.resolve();
    });
    expect(screen.getByText("ready-seller")).toBeTruthy();
  });

  it("clears a stale bootstrap user and safely routes to sign-in when the canonical session is anonymous", async () => {
    document.cookie = "ALPHA_LOCALE_CHOICE=ar; Path=/";
    const replaceSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        pathname: "/en/usdt-exchange",
        search: "?tab=sell",
        hash: "#create-listing",
        replace: replaceSpy,
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: null }) }));

    try {
      render(
        <CanonicalSessionProvider initialSessionUser={{
          id: "stale-seller", fullName: "Stale Seller", email: "seller@example.test", role: "approved_seller", sellerStatus: "approved_seller",
          whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline", createdAt: "2026-01-01",
        }}>
          <Probe />
        </CanonicalSessionProvider>,
      );

      await waitFor(() => expect(screen.getByText("anonymous")).toBeTruthy());
      expect(replaceSpy).toHaveBeenCalledWith("/en/login?sessionExpired=1&redirectTo=%2Fen%2Fusdt-exchange%3Ftab%3Dsell%23create-listing");
      expect(document.cookie).not.toContain("ALPHA_LOCALE_CHOICE=ar");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("retains the last confirmed account during an outage without redirecting to Login", async () => {
    document.cookie = "ALPHA_LOCALE_CHOICE=ar; Path=/";
    const replaceSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace: replaceSpy },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "unavailable" }) }));

    try {
      render(
        <CanonicalSessionProvider initialSessionUser={{
          id: "bootstrap-seller", fullName: "Seller", email: "seller@example.test", role: "approved_seller", sellerStatus: "approved_seller",
          whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline", createdAt: "2026-01-01",
        }}>
          <ErrorProbe />
        </CanonicalSessionProvider>,
      );

      await waitFor(() => expect(screen.getByText("bootstrap-seller:error")).toBeTruthy());
      expect(replaceSpy).not.toHaveBeenCalled();
      expect(document.cookie).toContain("ALPHA_LOCALE_CHOICE=ar");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("builds a same-origin expiry redirect from the current location only", () => {
    expect(getSessionExpiryLoginDestination({
      pathname: "/ar/trade-room/trade-1",
      search: "?action=upload-payment-receipt",
      hash: "#evidence",
    })).toBe("/en/login?sessionExpired=1&redirectTo=%2Far%2Ftrade-room%2Ftrade-1%3Faction%3Dupload-payment-receipt%23evidence");
    expect(getSessionExpiryLoginDestination({ pathname: "/en/login", search: "", hash: "" })).toBeNull();
  });

  it("persists the active route locale for an authenticated session", async () => {
    const user = {
      id: "locale-user", fullName: "Locale User", email: "locale@example.test", role: "buyer" as const, sellerStatus: "buyer" as const,
      whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: ["English"], preferredLocale: "en" as const,
      bio: "", onlineStatus: "offline" as const, createdAt: "2026-01-01",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/preferred-locale") {
        return { ok: true, json: async () => ({ preferredLocale: "ar" }) } as Response;
      }
      return { ok: true, json: async () => ({ user: { ...user, preferredLocale: "ar" } }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CanonicalSessionProvider initialSessionUser={user} locale="ar">
        <Probe />
      </CanonicalSessionProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/preferred-locale",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ preferredLocale: "ar" }),
      }),
    ));
  });
});
