import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanonicalSessionProvider, getSessionExpiryLoginDestination, useCanonicalSession } from "@/components/auth/canonical-session-provider";

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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("clears a stale bootstrap user and safely routes to sign-in when the canonical session is anonymous", async () => {
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
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("fails closed on an unavailable canonical response without falsely calling it a confirmed logout", async () => {
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

      await waitFor(() => expect(screen.getByText("anonymous:error")).toBeTruthy());
      expect(replaceSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("builds a same-origin expiry redirect from the current location only", () => {
    expect(getSessionExpiryLoginDestination({
      pathname: "/ar/trade-room/trade-1",
      search: "?action=upload-payment-receipt",
      hash: "#evidence",
    })).toBe("/ar/login?sessionExpired=1&redirectTo=%2Far%2Ftrade-room%2Ftrade-1%3Faction%3Dupload-payment-receipt%23evidence");
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
