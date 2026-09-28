import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recovery = vi.hoisted(() => ({ reloadAfterSessionRecovery: vi.fn(), reloadCurrentPage: vi.fn() }));
vi.mock("@/lib/page-recovery", () => recovery);
import { SessionUnavailable } from "./session-unavailable";

describe("session outage recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    recovery.reloadAfterSessionRecovery.mockReset().mockReturnValue(true);
    recovery.reloadCurrentPage.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rechecks only the session and reloads after a transient failure recovers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: "test-user" } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionUnavailable locale="en" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(recovery.reloadAfterSessionRecovery).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(recovery.reloadAfterSessionRecovery).toHaveBeenCalledTimes(1);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe("/api/auth/me");
      expect(options).toMatchObject({ cache: "no-store", credentials: "include" });
      expect(options).not.toHaveProperty("body");
      expect(options.method).toBeUndefined();
    }
  });

  it("keeps recovering with capped backoff during a long outage and retains manual reload", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionUnavailable locale="en" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(5);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(14);
    expect(recovery.reloadAfterSessionRecovery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload this page" }));
    expect(recovery.reloadCurrentPage).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: "recovered-user" } }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(recovery.reloadAfterSessionRecovery).toHaveBeenCalledTimes(1);
  });

  it("recovers immediately when a phone returns online, without duplicate requests", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: null }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionUnavailable locale="en" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recovery.reloadAfterSessionRecovery).toHaveBeenCalledTimes(1);
  });

  it("does not reload on a malformed success response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<SessionUnavailable locale="ar" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(recovery.reloadAfterSessionRecovery).not.toHaveBeenCalled();
  });

  it("does not get stuck when automatic reload is temporarily throttled", async () => {
    recovery.reloadAfterSessionRecovery.mockReturnValueOnce(false);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: null }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionUnavailable locale="en" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recovery.reloadAfterSessionRecovery).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts its read when leaving the recovery screen", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<SessionUnavailable locale="en" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
