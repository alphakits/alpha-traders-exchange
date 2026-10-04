import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountVerificationGate } from "@/components/auth/account-verification-gate";

const mocks = vi.hoisted(() => ({
  user: { id: "buyer-a", fullName: "Buyer A", email: "buyer-a@example.test", whatsappNumber: "+972501234567", emailVerified: false, isPhotoVerified: false } as {
    id: string; fullName: string; email: string; whatsappNumber: string; emailVerified: boolean; isPhotoVerified: boolean;
  } | null,
  refresh: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({
  useCanonicalSession: () => ({ user: mocks.user, isResolving: false, error: null, refresh: mocks.refresh }),
}));
vi.mock("@/components/auth/logout-button", () => ({ LogoutButton: () => <button type="button">Sign out</button> }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

type Action = "send" | "verify" | "email";
type Locale = "en" | "ar";
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(finish => { resolve = finish; });
  return { promise, resolve };
}
function response(payload: unknown = { ok: true, message: "Confirmed delivery" }) {
  return { ok: true, status: 200, json: async () => payload };
}
function gate(locale: Locale = "en") {
  return <AccountVerificationGate locale={locale} initialName="Buyer A" initialEmail="buyer-a@example.test" initialPhone="+972501234567" phoneVerificationEnabled phoneVerificationRequired />;
}
function actionButton(action: Action, locale: Locale = "en") {
  return screen.getByRole("button", { name: action === "send" ? (locale === "ar" ? "إرسال رمز التحقق" : "Send verification code")
    : action === "verify" ? (locale === "ar" ? "تأكيد رقم الهاتف" : "Verify phone")
    : locale === "ar" ? "إعادة إرسال بريد التحقق" : "Resend verification email" });
}
async function prepare(action: Action, locale: Locale = "en") {
  const view = render(gate(locale));
  if (action === "verify") {
    mocks.fetch.mockResolvedValueOnce(response());
    await act(async () => { fireEvent.click(actionButton("send", locale)); });
    fireEvent.change(screen.getByRole("textbox", { name: locale === "ar" ? "رمز التحقق" : "Verification code" }), { target: { value: "123456" } });
    mocks.fetch.mockReset();
  }
  return view;
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.user = { id: "buyer-a", fullName: "Buyer A", email: "buyer-a@example.test", whatsappNumber: "+972501234567", emailVerified: false, isPhotoVerified: false };
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("account verification request recovery", () => {
  const cases = (["send", "verify", "email"] as const).flatMap(action => (["headers", "body"] as const).flatMap(phase => (["en", "ar"] as const).map(locale => ({ action, phase, locale }))));
  it.each(cases)("recovers $action after stalled $phase in $locale without replay or late success", async ({ action, phase, locale }) => {
    await prepare(action, locale);
    const pending = deferred();
    const reply = { ...response(), json: () => phase === "body" ? pending.promise : Promise.resolve({ ok: true, message: "Late delivery" }) };
    mocks.fetch.mockImplementation(() => phase === "headers" ? pending.promise : Promise.resolve(reply));
    const button = actionButton(action, locale);
    await act(async () => { fireEvent.click(button); });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("alert").textContent).toContain(locale === "ar" ? "تعذر الاتصال بالخادم" : "Unable to reach the server");
    expect((actionButton(action, locale) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(phase === "headers" ? reply : { ok: true, message: "Late delivery" }); });
    expect(screen.queryByText("Late delivery")).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(["send", "verify", "email"] as const)("aborts %s and clears its deadline when the screen unmounts", async action => {
    const view = await prepare(action);
    const pending = deferred();
    mocks.fetch.mockReturnValue(pending.promise);
    await act(async () => { fireEvent.click(actionButton(action)); });
    const signal = mocks.fetch.mock.calls[0][1].signal;
    view.unmount();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(response()); });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["send", "verify", "email"] as const)("sends only one %s action for repeated clicks in one batch", async action => {
    await prepare(action);
    mocks.fetch.mockReturnValue(new Promise(() => {}));
    const button = actionButton(action);
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("discards the previous account's phone and pending delivery when accounts change", async () => {
    const view = await prepare("send");
    const pending = deferred();
    mocks.fetch.mockReturnValue(pending.promise);
    await act(async () => { fireEvent.click(actionButton("send")); });
    const signal = mocks.fetch.mock.calls[0][1].signal;
    mocks.user = { id: "buyer-b", fullName: "Buyer B", email: "buyer-b@example.test", whatsappNumber: "+972509876543", emailVerified: false, isPhotoVerified: false };
    view.rerender(gate());
    expect((screen.getByRole("textbox", { name: "Phone" }) as HTMLInputElement).value).toBe("+972509876543");
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(response({ ok: true, message: "Old account delivery" })); });
    expect(screen.queryByText("Old account delivery")).toBeNull();
    expect((screen.getByRole("textbox", { name: "Verification code" }) as HTMLInputElement).disabled).toBe(true);
    expect((actionButton("send") as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["send", "verify"] as const)("does not confirm %s from a malformed HTTP 200 response", async action => {
    await prepare(action);
    mocks.fetch.mockResolvedValue(response({}));
    await act(async () => { fireEvent.click(actionButton(action)); });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
    if (action === "send") expect((screen.getByRole("textbox", { name: "Verification code" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("preserves a current account's server phone hint when the initial canonical profile is incomplete", () => {
    mocks.user!.whatsappNumber = "";
    render(gate());
    expect((screen.getByRole("textbox", { name: "Phone" }) as HTMLInputElement).value).toBe("+972501234567");
  });

  it("allows a deliberate retry after a verification timeout and ignores the old success", async () => {
    await prepare("verify");
    const pending = deferred();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    await act(async () => { fireEvent.click(actionButton("verify")); await vi.advanceTimersByTimeAsync(30_000); });
    mocks.fetch.mockResolvedValueOnce(response());
    await act(async () => { fireEvent.click(actionButton("verify")); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Phone verification completed.")).toBeTruthy();
    await act(async () => { pending.resolve(response()); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
