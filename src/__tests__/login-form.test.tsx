import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/login-form";
import { CanonicalSessionProvider } from "@/components/auth/canonical-session-provider";
import { LOCALE_CHOICE_COOKIE } from "@/i18n/locale-preference";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [undefined, "/en/usdt-exchange"],
    ["/ar/trade-room/trade-1?tab=messages#latest", "/en/trade-room/trade-1?tab=messages#latest"],
  ])("starts a new login in English while preserving its destination %s", async (redirectTo, expected) => {
    const originalLocation = window.location;
    const replace = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace } });
    document.cookie = `${LOCALE_CHOICE_COOKIE}=ar; Path=/`;
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: { role: "buyer", roles: ["buyer"] } }) });
    vi.stubGlobal("fetch", fetch);
    try {
      render(<LoginForm locale="ar" redirectTo={redirectTo} />);
      fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "buyer@example.test" } });
      fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "test-password" } });
      fireEvent.click(screen.getByRole("button", { name: "تسجيل الدخول" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith(expected));
      expect(document.cookie).not.toContain(`${LOCALE_CHOICE_COOKIE}=ar`);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it.each(["/ar/trade-room/trade-1", "//outside.test", "/ar/login", "/login"])("restores a valid cookie session from Login with safe destination %s", async (redirectTo) => {
    const originalLocation = window.location;
    const replaceSpy = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace: replaceSpy } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: { id: "buyer-1", role: "buyer", roles: ["buyer"] } }) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<CanonicalSessionProvider initialSessionUser={null}><LoginForm locale="ar" redirectTo={redirectTo} /></CanonicalSessionProvider>);
      await act(async () => { await Promise.resolve(); });
      expect(replaceSpy).toHaveBeenCalledWith(redirectTo.includes("trade-room") ? redirectTo : "/ar/usdt-exchange");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("keeps Login available when the session is anonymous or unavailable", async () => {
    const originalLocation = window.location;
    const replaceSpy = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace: replaceSpy } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    try {
      render(<CanonicalSessionProvider initialSessionUser={null}><LoginForm locale="en" /></CanonicalSessionProvider>);
      await act(async () => { await Promise.resolve(); });
      expect(replaceSpy).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Login" })).toBeTruthy();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("redirects immediately after a successful login without waiting for the profile check", async () => {
    const replaceSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace: replaceSpy },
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: {
            role: "buyer",
            roles: ["buyer"],
            sellerStatus: "buyer",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ user: null }),
      });

    vi.stubGlobal("fetch", fetchMock);

    render(<LoginForm locale="en" redirectTo="/en/dashboard/seller" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/en/dashboard/seller"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("sends owner accounts to the normal homepage after login", async () => {
    const replaceSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace: replaceSpy },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        user: {
          role: "owner",
          roles: ["owner"],
          sellerStatus: "approved_seller",
        },
      }),
    }));

    render(<LoginForm locale="en" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith("/en"));

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("shows a dedicated forgot-password link under the password field", () => {
    render(<LoginForm locale="en" />);
    const forgotLink = screen.getByRole("link", { name: "Forgot your password?" });
    expect(forgotLink.getAttribute("href")).toBe("/forgot-password");
  });

  it("shows password-reset success confirmation when arriving from reset flow", () => {
    render(<LoginForm locale="en" passwordResetSuccess />);
    expect(screen.getByText("Your password has been updated successfully. Please sign in.")).toBeTruthy();
  });

  it("explains a confirmed session expiry before sign-in", () => {
    render(<LoginForm locale="en" sessionExpired />);
    expect(screen.getByText("Your session expired. Please sign in again.")).toBeTruthy();
  });

  it("keeps Arabic for verification-email resend actions", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers(),
        json: async () => ({ requiresEmailVerification: true, error: "English provider error" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: "English provider response" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginForm locale="ar" />);
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "buyer@example.test" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "abc12345" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    fireEvent.click(await screen.findByRole("button", { name: "إعادة إرسال بريد التحقق" }));

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/verify-email/resend",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      }),
    ));
    expect(await screen.findByText(/إذا كان الحساب موجودًا وغير موثق/)).toBeTruthy();
  });
});
