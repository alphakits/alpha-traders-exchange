import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountVerificationGate } from "./account-verification-gate";
import { getPhoneVerificationRecovery, type PhoneVerificationRecovery } from "@/lib/phone-verification-recovery";

const mocks = vi.hoisted(() => ({
  user: { id: "buyer-a", fullName: "Buyer A", email: "buyer-a@example.test", whatsappNumber: "+972501234567", emailVerified: false, isPhotoVerified: false },
  refresh: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({
  useCanonicalSession: () => ({ user: mocks.user, isResolving: false, error: null, refresh: mocks.refresh }),
}));
vi.mock("@/components/auth/logout-button", () => ({ LogoutButton: () => <span>Sign out</span> }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const now = Date.parse("2026-11-07T00:00:30.000Z");
const pendingPhone = "+972509876543";
function recovery(requestedAt = now - 30_000, attempts = 0) {
  return getPhoneVerificationRecovery({
    id: "buyer-a", email: "buyer-a@example.test",
    phoneOtpPhone: pendingPhone, phoneOtpChannel: "sms",
    phoneOtpHash: "a".repeat(64), phoneOtpSalt: "b".repeat(32), phoneOtpAttempts: attempts,
    phoneOtpRequestedAt: new Date(requestedAt).toISOString(),
    phoneOtpExpiresAt: new Date(requestedAt + 600_000).toISOString(),
  }, now);
}
function gate(initialRecovery: PhoneVerificationRecovery | null = recovery(), locale: "en" | "ar" = "en", initialUserId = "buyer-a") {
  return <AccountVerificationGate locale={locale} initialUserId={initialUserId}
    initialName="Buyer A" initialEmail="buyer-a@example.test" initialPhone="+972501234567"
    initialPhoneVerificationRecovery={initialRecovery} phoneVerificationEnabled phoneVerificationRequired />;
}
function codeInput(locale: "en" | "ar" = "en") {
  return screen.getByRole("textbox", { name: locale === "ar" ? "رمز التحقق" : "Verification code" }) as HTMLInputElement;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.user = { id: "buyer-a", fullName: "Buyer A", email: "buyer-a@example.test", whatsappNumber: "+972501234567", emailVerified: false, isPhotoVerified: false };
  mocks.refresh.mockReset().mockResolvedValue("authenticated");
  mocks.fetch.mockReset().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("resuming a phone verification challenge", () => {
  it.each([
    { locale: "en" as const, code: "482901" },
    { locale: "ar" as const, code: "٤٨٢٩٠١" },
    { locale: "ar" as const, code: "۴۸۲۹۰۱" },
  ])("allows the existing code after a reload without another SMS: $locale $code", async ({ locale, code }) => {
    const firstVisit = render(gate(null, locale));
    expect(codeInput(locale).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "إرسال رمز التحقق" : "Send verification code" }));
    await act(async () => {});
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe("/api/alpha-exchange/phone/send-code");
    firstVisit.unmount();
    mocks.fetch.mockReset().mockResolvedValue(Response.json({ ok: true }));

    render(gate(recovery(), locale));
    expect(codeInput(locale).disabled).toBe(false);
    expect((screen.getByRole("textbox", { name: locale === "ar" ? "رقم الهاتف" : "Phone" }) as HTMLInputElement).value).toBe(pendingPhone);
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.change(codeInput(locale), { target: { value: code } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "تأكيد رقم الهاتف" : "Verify phone" }));
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe("/api/alpha-exchange/phone/verify-code");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ phone: pendingPhone, code: "482901" });
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({ force: true });
  });

  it("restores only the remaining resend cooldown and catches up after suspension", async () => {
    render(gate(recovery(now - 42_500)));
    expect((screen.getByRole("button", { name: "Resend in 18s" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(18_000); });
    expect((screen.getByRole("button", { name: "Send verification code" }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([-15 * 60_000, 15 * 60_000])("uses server-relative durations when the device clock is skewed by %dms", async skew => {
    vi.setSystemTime(now + skew);
    render(gate());
    expect(codeInput().disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Resend in 30s" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(codeInput().disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Send verification code" }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("expires a restored code at its original deadline without sending or submitting anything", async () => {
    render(gate(recovery(now - 599_000)));
    expect(codeInput().disabled).toBe(false);
    fireEvent.change(codeInput(), { target: { value: "482901" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(codeInput().disabled).toBe(true);
    expect(codeInput().value).toBe("");
    expect((screen.getByRole("button", { name: "Verify phone" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not resume a cached challenge whose expiry passed before rendering", () => {
    const stale = recovery()!;
    stale.pendingChallenge!.expiresAt = new Date(now - 1).toISOString();
    render(gate(stale));
    expect(codeInput().disabled).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not resume a locked challenge but retains its resend cooldown", () => {
    render(gate(recovery(now - 40_000, 5)));
    expect(codeInput().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Resend in 20s" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not restore challenge metadata after the canonical account is verified", () => {
    mocks.user.isPhotoVerified = true;
    render(gate());
    expect(screen.getByText("Your phone number is verified.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Verification code" })).toBeNull();
    expect(screen.queryByDisplayValue(pendingPhone)).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not use a previous account's challenge even if the email address is the same", () => {
    const view = render(gate());
    expect(codeInput().disabled).toBe(false);
    fireEvent.change(codeInput(), { target: { value: "482901" } });
    mocks.user = { ...mocks.user, id: "buyer-b", whatsappNumber: "+972511234567" };
    view.rerender(gate());
    expect(codeInput().disabled).toBe(true);
    expect(codeInput().value).toBe("");
    expect((screen.getByRole("textbox", { name: "Phone" }) as HTMLInputElement).value).toBe("+972511234567");
    expect((screen.getByRole("button", { name: "Send verification code" }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("requires the initial account ID and recovery owner to match the current account", () => {
    render(gate(recovery(), "en", "another-account"));
    expect(codeInput().disabled).toBe(true);
    expect(screen.queryByDisplayValue(pendingPhone)).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("discards a resumed code after the phone changes without resetting account cooldown", () => {
    render(gate());
    fireEvent.change(codeInput(), { target: { value: "482901" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Phone" }), { target: { value: "+972521111111" } });
    expect(codeInput().value).toBe("");
    expect(codeInput().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Resend in 30s" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
