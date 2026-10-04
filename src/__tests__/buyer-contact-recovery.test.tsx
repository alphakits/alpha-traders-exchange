import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuyerContactPrompt } from "@/components/auth/buyer-contact-prompt";

const mocks = vi.hoisted(() => ({
  user: { id: "buyer-a", role: "buyer", roles: ["buyer"], whatsappNumber: "" } as { id: string; role: string; roles: string[]; whatsappNumber: string } | null,
  refresh: vi.fn(), fetch: vi.fn(), pathname: "/en/usdt-exchange",
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useOptionalCanonicalSession: () => ({ user: mocks.user, refresh: mocks.refresh }) }));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => mocks.pathname }));
const originalLocation = window.location;
const assign = vi.fn();
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(finish => { resolve = finish; });
  return { promise, resolve };
}
function response(number = "+972501234567") {
  return { ok: true, status: 200, json: async () => ({ profile: { whatsappNumber: number } }) };
}
function fill(locale: "en" | "ar" = "en", value = "0501234567") {
  const phone = screen.getByLabelText(locale === "ar" ? "رقم الهاتف أو واتساب (مطلوب)" : "Phone or WhatsApp number (required)");
  fireEvent.change(phone, { target: { value } });
  return phone.closest("form")!;
}
function signOut(locale: "en" | "ar" = "en") {
  return screen.getByRole("button", { name: locale === "ar" ? "تسجيل الخروج" : "Sign out" });
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.user = { id: "buyer-a", role: "buyer", roles: ["buyer"], whatsappNumber: "" };
  mocks.pathname = "/en/usdt-exchange";
  mocks.fetch.mockReset();
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  assign.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, assign } });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("required buyer contact request recovery", () => {
  it.each(["en", "ar"] as const)("preserves the public English login destination after signing out in %s", async locale => {
    render(<BuyerContactPrompt locale={locale} />);
    const events = vi.spyOn(window, "dispatchEvent");
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });
    await act(async () => { fireEvent.click(signOut(locale)); });
    expect(assign).toHaveBeenCalledExactlyOnceWith("/en/login");
    expect(events.mock.calls.filter(([event]) => event.type === "alpha-auth-signed-out")).toHaveLength(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  const cases = (["en", "ar"] as const).flatMap(locale => (["save-headers", "save-body", "logout-headers"] as const).map(phase => ({ locale, phase })));
  it.each(cases)("recovers $phase in $locale without replaying a request or accepting its late success", async ({ locale, phase }) => {
    render(<BuyerContactPrompt locale={locale} />);
    const events = vi.spyOn(window, "dispatchEvent");
    const pending = deferred();
    const reply = { ...response(), json: () => phase === "save-body" ? pending.promise : Promise.resolve({ profile: { whatsappNumber: "+972501234567" } }) };
    mocks.fetch.mockImplementation(() => phase === "save-body" ? Promise.resolve(reply) : pending.promise);
    await act(async () => { if (phase === "logout-headers") fireEvent.click(signOut(locale)); else fireEvent.submit(fill(locale)); });
    expect((signOut(locale) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("alert").textContent).toContain(phase === "logout-headers"
      ? (locale === "ar" ? "تعذر تسجيل الخروج" : "Unable to sign out")
      : locale === "ar" ? "تعذر الاتصال" : "Connection failed");
    expect((signOut(locale) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("dialog") as HTMLDialogElement).open).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { pending.resolve(phase === "save-body" ? { profile: { whatsappNumber: "+972501234567" } } : reply); });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(events.mock.calls.filter(([event]) => ["alpha-profile-updated", "alpha-auth-signed-out"].includes(event.type))).toHaveLength(0);
  });

  it.each(["save", "logout"] as const)("aborts %s when the prompt unmounts without side effects from a late reply", async action => {
    const view = render(<BuyerContactPrompt locale="en" />);
    // Settle the autofocus work before checking request deadline cleanup.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const events = vi.spyOn(window, "dispatchEvent");
    const pending = deferred(); mocks.fetch.mockReturnValue(pending.promise);
    await act(async () => { if (action === "save") fireEvent.submit(fill()); else fireEvent.click(signOut()); });
    const signal = mocks.fetch.mock.calls[0][1].signal;
    view.unmount();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(response()); });
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
    expect(events.mock.calls.filter(([event]) => ["alpha-profile-updated", "alpha-auth-signed-out"].includes(event.type))).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the next account's prompt and rejects a previous account's pending save", async () => {
    const view = render(<BuyerContactPrompt locale="en" />);
    const pending = deferred(); mocks.fetch.mockReturnValue(pending.promise);
    await act(async () => { fireEvent.submit(fill()); });
    const signal = mocks.fetch.mock.calls[0][1].signal;
    mocks.user = { id: "buyer-b", role: "buyer", roles: ["buyer"], whatsappNumber: "" };
    view.rerender(<BuyerContactPrompt locale="en" />);
    expect(signal.aborted).toBe(true);
    expect((signOut() as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Phone or WhatsApp number (required)") as HTMLInputElement).value).toBe("");
    await act(async () => { pending.resolve(response()); });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect((screen.getByRole("dialog") as HTMLDialogElement).open).toBe(true);
  });

  it("does not publish a completed refresh from an account that already changed", async () => {
    const view = render(<BuyerContactPrompt locale="en" />);
    const events = vi.spyOn(window, "dispatchEvent");
    const pending = deferred(); mocks.refresh.mockReturnValue(pending.promise); mocks.fetch.mockResolvedValue(response());
    await act(async () => { fireEvent.submit(fill()); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    mocks.user = { id: "buyer-b", role: "buyer", roles: ["buyer"], whatsappNumber: "" };
    view.rerender(<BuyerContactPrompt locale="en" />);
    await act(async () => { pending.resolve(undefined); });
    expect(events.mock.calls.filter(([event]) => event.type === "alpha-profile-updated")).toHaveLength(0);
    expect((screen.getByRole("dialog") as HTMLDialogElement).open).toBe(true);
  });

  it("locks the submitted phone and submits only one mutation for repeated form submission", () => {
    render(<BuyerContactPrompt locale="en" />);
    const form = fill(); mocks.fetch.mockReturnValue(new Promise(() => {}));
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Phone or WhatsApp number (required)") as HTMLInputElement).disabled).toBe(true);
  });

  it("requires confirmation of the requested phone instead of accepting a different valid number", async () => {
    render(<BuyerContactPrompt locale="en" />);
    mocks.fetch.mockResolvedValue(response("+972509876543"));
    await act(async () => { fireEvent.submit(fill()); });
    expect(screen.getByRole("alert").textContent).toContain("couldn’t save");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect((screen.getByRole("dialog") as HTMLDialogElement).open).toBe(true);
  });

  it("allows a corrected save after timeout while ignoring the original delayed response", async () => {
    render(<BuyerContactPrompt locale="en" />);
    const pending = deferred(); mocks.fetch.mockReturnValueOnce(pending.promise);
    await act(async () => { fireEvent.submit(fill()); await vi.advanceTimersByTimeAsync(15_000); });
    mocks.fetch.mockResolvedValueOnce(response("+972509876543"));
    await act(async () => { fireEvent.submit(fill("en", "0509876543")); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2); expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect((screen.queryByRole("dialog", { hidden: true }) as HTMLDialogElement).open).toBe(false);
    await act(async () => { pending.resolve(response()); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
