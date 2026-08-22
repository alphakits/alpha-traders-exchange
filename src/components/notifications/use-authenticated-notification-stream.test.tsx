import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanonicalSessionProvider } from "@/components/auth/canonical-session-provider";
import { useAuthenticatedNotificationStream } from "@/components/notifications/use-authenticated-notification-stream";
import type { ClientSessionUser } from "@/lib/client-session-user";

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly close = vi.fn();
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
}

const seller: ClientSessionUser = {
  id: "seller-1",
  fullName: "Seller",
  email: "seller@example.test",
  role: "approved_seller",
  roles: ["approved_seller"],
  sellerStatus: "approved_seller",
  whatsappNumber: "",
  preferredNetworks: [],
  profilePhotoUrl: "",
  languages: [],
  bio: "",
  onlineStatus: "offline",
  createdAt: "2026-01-01",
};

function StreamProbe() {
  useAuthenticatedNotificationStream({ onNotifications: () => undefined });
  return null;
}

describe("useAuthenticatedNotificationStream", () => {
  afterEach(() => {
    MockEventSource.instances = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("waits for canonical auth before opening the notification stream", async () => {
    let resolveSession: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveSession = resolve; })));
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<CanonicalSessionProvider initialSessionUser={seller}><StreamProbe /></CanonicalSessionProvider>);
    expect(MockEventSource.instances).toHaveLength(0);

    await act(async () => {
      resolveSession?.({ ok: true, json: async () => ({ user: seller }) } as Response);
      await Promise.resolve();
    });

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(MockEventSource.instances[0]?.url).toBe("/api/alpha-exchange/notifications/stream");
  });

  it("closes an errored stream and stops instead of retrying after canonical auth is lost", async () => {
    const replaceSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, pathname: "/en/usdt-exchange", search: "", hash: "", replace: replaceSpy },
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: seller }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: null }) }));
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    try {
      render(<CanonicalSessionProvider initialSessionUser={seller}><StreamProbe /></CanonicalSessionProvider>);
      await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

      await act(async () => {
        MockEventSource.instances[0]?.emit("error");
        MockEventSource.instances[0]?.emit("error");
        await Promise.resolve();
      });

      await waitFor(() => expect(MockEventSource.instances[0]?.close).toHaveBeenCalled());
      await waitFor(() => expect(replaceSpy).toHaveBeenCalledTimes(1));
      expect(MockEventSource.instances).toHaveLength(1);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(replaceSpy).toHaveBeenCalledWith("/en/login?sessionExpired=1&redirectTo=%2Fen%2Fusdt-exchange");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("does not refresh canonical auth when an outgoing document emits a late stream error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: seller }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<CanonicalSessionProvider initialSessionUser={seller}><StreamProbe /></CanonicalSessionProvider>);
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      // Mirror the browser race: an EventSource error can arrive after the
      // page-exit event but before component cleanup has run.
      MockEventSource.instances[0]?.emit("error");
      await Promise.resolve();
    });

    expect(MockEventSource.instances[0]?.close).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("closes the stream while hidden and opens one fresh stream when the tab is visible again", async () => {
    let visibility = "visible";
    const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: seller }) }));
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    try {
      render(<CanonicalSessionProvider initialSessionUser={seller}><StreamProbe /></CanonicalSessionProvider>);
      await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

      await act(async () => {
        visibility = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(MockEventSource.instances[0]?.close).toHaveBeenCalledTimes(1));

      await act(async () => {
        visibility = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    } finally {
      if (originalVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", originalVisibilityDescriptor);
      } else {
        delete (document as { visibilityState?: string }).visibilityState;
      }
    }
  });
});
