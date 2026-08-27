import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/login-form";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
