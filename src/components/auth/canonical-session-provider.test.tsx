import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanonicalSessionProvider, useCanonicalSession } from "@/components/auth/canonical-session-provider";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function Probe() {
  const { user, isResolving } = useCanonicalSession();
  return <output>{isResolving ? "resolving" : user?.id ?? "anonymous"}</output>;
}

describe("CanonicalSessionProvider", () => {
  it("invalidates an in-flight canonical response after an auth-state change", async () => {
    const initial = deferred<Response>();
    const afterAuthChange = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(afterAuthChange.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CanonicalSessionProvider initialSessionUser={{
        id: "bootstrap-user", fullName: "Bootstrap", email: "bootstrap@example.test", role: "buyer", sellerStatus: "buyer",
        whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline", createdAt: "2026-01-01",
      }}>
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
});
