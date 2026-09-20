import { afterEach, describe, expect, it, vi } from "vitest";
import { reloadAfterSessionRecovery, reloadCurrentPage } from "./page-recovery";

afterEach(() => vi.unstubAllGlobals());

it("reloads the current document without replacing its trade URL", () => {
  const reload = vi.fn();
  const location = { href: "https://example.test/ar/trade-room/test?tab=chat#message", reload };
  vi.stubGlobal("window", { location });
  reloadCurrentPage();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(location.href).toBe("https://example.test/ar/trade-room/test?tab=chat#message");
});

describe("automatic reload protection", () => {
  it("allows one automatic reload and suppresses a reload loop", () => {
    const values = new Map<string, string>();
    const reload = vi.fn();
    vi.stubGlobal("window", {
      location: { reload },
      sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) },
    });
    reloadAfterSessionRecovery();
    reloadAfterSessionRecovery();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves manual reload available when browser storage is blocked", () => {
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload }, sessionStorage: { getItem: () => { throw new Error("blocked"); } } });
    reloadAfterSessionRecovery();
    expect(reload).not.toHaveBeenCalled();
    reloadCurrentPage();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
