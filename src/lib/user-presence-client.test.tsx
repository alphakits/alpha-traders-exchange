import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveUserPresence } from "./user-presence-client";
import { UserPresence } from "@/components/ui/user-presence";

function Status({ userId }: { userId: string }) {
  const presence = useLiveUserPresence(userId);
  return <p>{userId}:{presence.label}</p>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("shared live presence subscriptions", () => {
  it.each(["seller", "buyer"])("updates %s from Offline to animated Online and back after departure without a reload", async userId => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: {
      [userId]: { onlineStatus: "offline", lastActiveAt: null, lastSeenAt: null },
    } }) }));
    const { container } = render(<><Status userId={userId} /><UserPresence userId={userId} compact /><UserPresence userId={userId} compact isAr /></>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText(`${userId}:Offline`)).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("غير متصل")).toBeTruthy();
    expect(container.querySelectorAll(".seller-presence-dot--online")).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ users: {
      [userId]: { onlineStatus: "online", lastSeenAt: new Date().toISOString(), lastActiveAt: new Date().toISOString() },
    } }) } as Response);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText(`${userId}:Online`)).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.getByText("متصل الآن")).toBeTruthy();
    expect(container.querySelectorAll(".seller-presence-dot--online")).toHaveLength(2);
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ users: {
      [userId]: { onlineStatus: "offline", lastSeenAt: new Date().toISOString(), lastActiveAt: new Date().toISOString() },
    } }) } as Response);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("غير متصل")).toBeTruthy();
    expect(container.querySelectorAll(".seller-presence-dot--online")).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("batches cards, updates without reloading, and expires a disconnected user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ serverTime: "2026-09-24T12:00:00Z", users: {
      seller: { onlineStatus: "online", lastSeenAt: "2026-09-24T12:00:00Z", lastActiveAt: "2026-09-24T12:00:00Z" },
      buyer: { onlineStatus: "offline", lastActiveAt: null },
    } }) }));
    const { container } = render(<><Status userId="seller" /><Status userId="buyer" /><UserPresence userId="seller" compact /></>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("seller:Online")).toBeTruthy();
    expect(container.querySelectorAll(".seller-presence-dot--online")).toHaveLength(1);
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await act(async () => { await vi.advanceTimersByTimeAsync(100_000); });
    expect(screen.queryByText("seller:Online")).toBeNull();
    expect(screen.getByText(/seller:Offline/)).toBeTruthy();
    expect(container.querySelectorAll(".seller-presence-dot--online")).toHaveLength(0);
  });
  it("discards an in-flight privileged response when the account changes", async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(r => { resolve = r; })));
    render(<Status userId="hidden-seller" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => {
      window.dispatchEvent(new Event("alpha-auth-signed-out"));
      resolve({ ok: true, json: async () => ({ users: { "hidden-seller": { onlineStatus: "online", lastSeenAt: new Date().toISOString(), lastActiveAt: new Date().toISOString() } } }) });
    });
    expect(screen.queryByText("hidden-seller:Online")).toBeNull();
  });
});
