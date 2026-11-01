import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanonicalSessionProvider } from "./canonical-session-provider";
import { ProtectedPageBoundary } from "./protected-page-boundary";
import { LogoutButton } from "./logout-button";
import type { ClientSessionUser } from "@/lib/client-session-user";

vi.mock("next/navigation", () => ({ usePathname: () => "/ar/usdt-exchange" }));
const user: ClientSessionUser = {
  id: "sign-out-seller", fullName: "Test Seller", email: "seller@example.test", role: "approved_seller",
  roles: ["approved_seller"], sellerStatus: "approved_seller", whatsappNumber: "", preferredNetworks: [],
  profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline", createdAt: "2026-01-01",
};
const originalLocation = window.location;
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("sign-out navigation ownership", () => {
  it("waits for logout confirmation when background auth sees the revoked session first", async () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, pathname: "/ar/usdt-exchange", search: "", hash: "", replace } });
    let finishLogout!: (response: Response) => void;
    let revoked = false;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/auth/logout") {
        revoked = true;
        return new Promise<Response>(resolve => { finishLogout = resolve; });
      }
      return Promise.resolve(Response.json({ user: revoked ? null : user }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CanonicalSessionProvider initialSessionUser={user}>
      <ProtectedPageBoundary locale="ar">
        <p>Private seller workspace</p><LogoutButton locale="ar">تسجيل الخروج</LogoutButton>
      </ProtectedPageBoundary>
    </CanonicalSessionProvider>);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" })); });
    await act(async () => { window.dispatchEvent(new Event("alpha-auth-changed")); });
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("Private seller workspace")).toBeTruthy();
    await act(async () => { finishLogout(new Response(null, { status: 204 })); });
    expect(replace).toHaveBeenCalledExactlyOnceWith("/en");
    expect(screen.queryByText("Private seller workspace")).toBeNull();
    // A late stream or profile event must not replace the confirmed destination.
    await act(async () => { window.dispatchEvent(new Event("alpha-auth-changed")); });
    expect(replace).toHaveBeenCalledExactlyOnceWith("/en");
  });

  it.each(["failure", "timeout", "unmount"] as const)("resumes canonical verification after sign-out %s", async outcome => {
    vi.useFakeTimers();
    const replace = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, pathname: "/ar/usdt-exchange", search: "", hash: "", replace } });
    let finishLogout!: (response: Response) => void;
    let revoked = false;
    let logoutSignal!: AbortSignal;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/auth/logout") {
        logoutSignal = init?.signal as AbortSignal;
        return new Promise<Response>(resolve => { finishLogout = resolve; });
      }
      return Promise.resolve(Response.json({ user: revoked ? null : user }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = (showButton = true) => <CanonicalSessionProvider initialSessionUser={user}>
      <ProtectedPageBoundary locale="ar"><p>Private seller workspace</p>
        {showButton ? <LogoutButton locale="ar">تسجيل الخروج</LogoutButton> : null}
      </ProtectedPageBoundary>
    </CanonicalSessionProvider>;
    const rendered = render(view());
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" })); });
    await act(async () => { window.dispatchEvent(new Event("alpha-auth-changed")); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/me")).toHaveLength(1);
    if (outcome === "failure") await act(async () => { finishLogout(Response.json({ error: "Try again" }, { status: 503 })); });
    else if (outcome === "timeout") await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    else await act(async () => { rendered.rerender(view(false)); });
    if (outcome !== "failure") expect(logoutSignal.aborted).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/me")).toHaveLength(2);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("Private seller workspace")).toBeTruthy();
    // Verification must resume, including a later real loss of authorization.
    revoked = true;
    await act(async () => { window.dispatchEvent(new Event("alpha-auth-changed")); });
    expect(screen.queryByText("Private seller workspace")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/ar/login?redirectTo=%2Far%2Fusdt-exchange");
  });

  it("ignores a stale anonymous read already in flight and rechecks a restored document", async () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, pathname: "/ar/usdt-exchange", search: "", hash: "", replace } });
    let finishRead!: (response: Response) => void;
    let finishLogout!: (response: Response) => void;
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/auth/logout") return new Promise<Response>(resolve => { finishLogout = resolve; });
      reads += 1;
      return reads === 1 ? new Promise<Response>(resolve => { finishRead = resolve; }) : Promise.resolve(Response.json({ user: null }));
    }));
    render(<CanonicalSessionProvider initialSessionUser={user}><ProtectedPageBoundary locale="ar">
      <p>Private seller workspace</p><LogoutButton locale="ar">تسجيل الخروج</LogoutButton>
    </ProtectedPageBoundary></CanonicalSessionProvider>);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" })); });
    await act(async () => { finishRead(Response.json({ user: null })); });
    expect(replace).not.toHaveBeenCalled();
    await act(async () => { finishLogout(new Response(null, { status: 204 })); });
    expect(replace).toHaveBeenCalledExactlyOnceWith("/en");
    await act(async () => { window.dispatchEvent(new Event("alpha-auth-changed")); });
    expect(reads).toBe(1);
    await act(async () => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
    expect(reads).toBe(2);
    expect(screen.queryByText("Private seller workspace")).toBeNull();
    expect(replace).toHaveBeenLastCalledWith("/ar/login?redirectTo=%2Far%2Fusdt-exchange");
  });
});
