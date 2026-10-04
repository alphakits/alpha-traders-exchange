import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "@/components/auth/logout-button";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), clearLocale: vi.fn(), signedOut: vi.fn() }));
vi.mock("@/i18n/locale-preference", () => ({ clearClientLocaleChoice: mocks.clearLocale }));
const originalLocation = window.location;
const replace = vi.fn();
type Locale = "en" | "ar";
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(finish => { resolve = finish; });
  return { promise, resolve };
}
function button(locale: Locale = "en") {
  return screen.getByRole("button", { name: locale === "ar" ? "تسجيل الخروج" : "Sign out" });
}
function logout(locale: Locale = "en") {
  return <LogoutButton locale={locale} onSignedOut={mocks.signedOut}>{locale === "ar" ? "تسجيل الخروج" : "Sign out"}</LogoutButton>;
}
function successfulResponse() {
  return { ok: true, status: 204, json: vi.fn(() => { throw new Error("A successful logout needs no response body"); }) };
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.fetch.mockReset(); mocks.clearLocale.mockReset(); mocks.signedOut.mockReset(); replace.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace } });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("logout request recovery", () => {
  const cases = (["headers", "error-body"] as const).flatMap(phase => (["en", "ar"] as const).map(locale => ({ phase, locale })));
  it.each(cases)("recovers stalled $phase in $locale even when the transport ignores abort", async ({ phase, locale }) => {
    render(logout(locale));
    const events = vi.spyOn(window, "dispatchEvent");
    const pending = deferred();
    mocks.fetch.mockImplementation(() => phase === "headers" ? pending.promise : Promise.resolve({ ok: false, status: 500, json: () => pending.promise }));
    await act(async () => { fireEvent.click(button(locale)); });
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(screen.getByRole("alert").textContent).toContain(locale === "ar" ? "استغرق تسجيل الخروج" : "Signing out took longer");
    expect(button(locale).hasAttribute("disabled")).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { pending.resolve(phase === "headers" ? successfulResponse() : { error: "Late logout failure" }); });
    expect(mocks.clearLocale).not.toHaveBeenCalled(); expect(mocks.signedOut).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    expect(events.mock.calls.filter(([event]) => ["alpha-auth-changed", "alpha-auth-signed-out"].includes(event.type))).toHaveLength(0);
    expect(screen.queryByText("Late logout failure")).toBeNull();
  });

  it.each(["headers", "error-body"] as const)("cancels stalled %s on unmount and ignores its delayed response", async phase => {
    const view = render(logout());
    const pending = deferred(); const events = vi.spyOn(window, "dispatchEvent");
    mocks.fetch.mockImplementation(() => phase === "headers" ? pending.promise : Promise.resolve({ ok: false, json: () => pending.promise }));
    await act(async () => { fireEvent.click(button()); });
    const signal = mocks.fetch.mock.calls[0][1].signal;
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(phase === "headers" ? successfulResponse() : { error: "Late failure" }); });
    expect(mocks.clearLocale).not.toHaveBeenCalled(); expect(mocks.signedOut).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    expect(events.mock.calls.filter(([event]) => ["alpha-auth-changed", "alpha-auth-signed-out"].includes(event.type))).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces repeated clicks in the same batch into one logout", () => {
    render(logout()); mocks.fetch.mockReturnValue(new Promise(() => {}));
    const current = button(); act(() => { fireEvent.click(current); fireEvent.click(current); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["en", "ar"] as const)("preserves confirmed public English logout behavior in %s without reading an empty body", async locale => {
    render(logout(locale)); const events = vi.spyOn(window, "dispatchEvent");
    const response = successfulResponse(); mocks.fetch.mockResolvedValue(response);
    await act(async () => { fireEvent.click(button(locale)); });
    expect(response.json).not.toHaveBeenCalled(); expect(mocks.clearLocale).toHaveBeenCalledTimes(1);
    expect(mocks.signedOut).toHaveBeenCalledTimes(1); expect(replace).toHaveBeenCalledExactlyOnceWith("/en");
    expect(events.mock.calls.filter(([event]) => event.type === "alpha-auth-signed-out")).toHaveLength(1);
    expect(events.mock.calls.filter(([event]) => event.type === "alpha-auth-changed")).toHaveLength(1);
  });

  const failures = (["message", "malformed"] as const).flatMap(kind => (["en", "ar"] as const).map(locale => ({ kind, locale })));
  it.each(failures)("retains the current session after a $kind error in $locale", async ({ kind, locale }) => {
    render(logout(locale));
    const fallback = locale === "ar" ? "تعذر تسجيل الخروج" : "Failed to sign out";
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => { if (kind === "malformed") throw new SyntaxError("invalid JSON"); return { error: locale === "ar" ? "رفض الخادم تسجيل الخروج" : "Server rejected logout" }; } });
    await act(async () => { fireEvent.click(button(locale)); });
    expect(screen.getByRole("alert").textContent).toContain(kind === "malformed" ? fallback : locale === "ar" ? "رفض الخادم" : "Server rejected logout");
    expect(button(locale).hasAttribute("disabled")).toBe(false);
    expect(mocks.clearLocale).not.toHaveBeenCalled(); expect(mocks.signedOut).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  });

  it("allows a deliberate retry after timeout while ignoring the first delayed success", async () => {
    render(logout()); const pending = deferred(); mocks.fetch.mockReturnValueOnce(pending.promise);
    await act(async () => { fireEvent.click(button()); await vi.advanceTimersByTimeAsync(8_000); });
    mocks.fetch.mockResolvedValueOnce(successfulResponse());
    await act(async () => { fireEvent.click(button()); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2); expect(mocks.signedOut).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(successfulResponse()); });
    expect(mocks.signedOut).toHaveBeenCalledTimes(1); expect(replace).toHaveBeenCalledTimes(1);
  });

  it("does not let an earlier error's dismissal timer erase a later recovery message", async () => {
    render(logout()); mocks.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Initial failure" }) });
    await act(async () => { fireEvent.click(button()); });
    mocks.fetch.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => { fireEvent.click(button()); await vi.advanceTimersByTimeAsync(8_000); });
    expect(screen.getByRole("alert").textContent).toContain("Signing out took longer");
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(screen.getByRole("alert").textContent).toContain("Signing out took longer");
  });

  it.each(["en", "ar"] as const)("releases a network failure in %s with localized feedback and no automatic retry", async locale => {
    render(logout(locale)); mocks.fetch.mockRejectedValue(new TypeError("Network offline"));
    await act(async () => { fireEvent.click(button(locale)); });
    expect(screen.getByRole("alert").textContent).toContain(locale === "ar" ? "تعذر تسجيل الخروج" : "Failed to sign out");
    expect(button(locale).hasAttribute("disabled")).toBe(false); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled(); expect(mocks.clearLocale).not.toHaveBeenCalled();
  });
});
