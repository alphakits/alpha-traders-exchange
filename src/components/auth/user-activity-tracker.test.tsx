import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startUserActivityTracking } from "./user-activity-tracker";

let stop: (() => void) | undefined;
const sent = () => vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init?.body as string));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("web and embedded-app activity lifecycle", () => {
  it("throttles actual input and does not count background polling as user activity", async () => {
    stop = startUserActivityTracking();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent().map(value => value.activity)).toEqual([true, false]);
    for (let n = 0; n < 30; n++) window.dispatchEvent(new Event("pointerdown"));
    expect(sent()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent().at(-1)).toMatchObject({ active: true, activity: true });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sent().at(-1)).toMatchObject({ active: false, activity: false });
    window.dispatchEvent(new Event("keydown"));
    expect(sent().at(-1)).toMatchObject({ active: true, activity: true });
  });
  it("goes offline when hidden/backgrounded, resumes on return, and stops after logout", async () => {
    stop = startUserActivityTracking();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sent().at(-1).active).toBe(false);
    const hiddenCount = sent().length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toHaveLength(hiddenCount);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sent().at(-1).active).toBe(true);
    window.dispatchEvent(new CustomEvent("alpha-native-app-state", { detail: { active: false } }));
    expect(sent().at(-1).active).toBe(false);
    window.dispatchEvent(new CustomEvent("alpha-native-app-state", { detail: { active: true } }));
    expect(sent().at(-1).active).toBe(true);
    window.dispatchEvent(new Event("alpha-auth-signed-out"));
    window.dispatchEvent(new Event("pointerdown"));
    expect(sent().at(-1).active).toBe(false);
    const sequences = sent().map(value => value.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
  });
});
