import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanonicalSessionProvider } from "./canonical-session-provider";
import { ProtectedPageBoundary } from "./protected-page-boundary";
import type { ClientSessionUser } from "@/lib/client-session-user";

const navigation = vi.hoisted(() => ({ pathname: "/en/usdt-exchange" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
const user: ClientSessionUser = {
  id: "guard-buyer", fullName: "Test Buyer", email: "buyer@example.test", role: "buyer", sellerStatus: "buyer",
  whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline", createdAt: "2026-01-01",
};
const replace = vi.fn();
const originalLocation = window.location;
const privateMount = vi.fn();
function PrivatePage() { privateMount(); return <p>Private trade history</p>; }
function renderPage(initialSessionUser: ClientSessionUser | null = null) {
  return render(<CanonicalSessionProvider initialSessionUser={initialSessionUser}>
    <ProtectedPageBoundary locale="en"><PrivatePage /></ProtectedPageBoundary>
  </CanonicalSessionProvider>);
}
beforeEach(() => {
  navigation.pathname = "/en/usdt-exchange";
  replace.mockReset();
  privateMount.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, pathname: navigation.pathname, replace } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("protected page access", () => {
  it("never mounts protected content while unresolved or signed out and replaces the page with home", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    renderPage();
    expect(privateMount).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await act(async () => finish(new Response(JSON.stringify({ user: null }))));
    expect(privateMount).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/en");
  });

  it("removes protected content as soon as logout is confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ user }))));
    renderPage(user);
    expect(screen.getByText("Private trade history")).toBeTruthy();
    await act(async () => window.dispatchEvent(new Event("alpha-auth-signed-out")));
    expect(screen.queryByText("Private trade history")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/en");
  });

  it("does not mount private content or redirect on a session outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    renderPage();
    await screen.findByText("Your account could not be verified. Please try again.");
    expect(privateMount).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps a confirmed user's page available through a transient outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    renderPage(user);
    await act(async () => {});
    expect(screen.getByText("Private trade history")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(["/en", "/en/login", "/ar/register", "/en/news", "/en/privacy-policy"])("keeps public route %s accessible", async pathname => {
    navigation.pathname = pathname;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: null }))));
    renderPage();
    await act(async () => {});
    expect(screen.getByText("Private trade history")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("hides a recently checked page restored from back/forward cache until the session is verified", async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user })))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage(user);
    await act(async () => {});
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Private trade history")).toBeNull();
    await act(async () => finish(new Response(JSON.stringify({ user: null }))));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en"));
    expect(screen.queryByText("Private trade history")).toBeNull();
  });

  it("clears the account when another tab signs out", async () => {
    const channel: { onmessage: ((event: { data: string }) => void) | null; postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } = {
      onmessage: null, postMessage: vi.fn(), close: vi.fn(),
    };
    vi.stubGlobal("BroadcastChannel", class {
      constructor() { return channel; }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ user }))));
    renderPage(user);
    await act(async () => {});
    act(() => channel.onmessage?.({ data: "signed-out" }));
    expect(screen.queryByText("Private trade history")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/en");
    expect(channel.postMessage).not.toHaveBeenCalled();
  });

  it("keeps an active workspace mounted during ordinary account refreshes", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user })))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })));
    renderPage(user);
    await act(async () => {});
    act(() => window.dispatchEvent(new Event("alpha-auth-changed")));
    expect(screen.getByText("Private trade history")).toBeTruthy();
    await act(async () => finish(new Response(JSON.stringify({ user }))));
    expect(screen.getByText("Private trade history")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
