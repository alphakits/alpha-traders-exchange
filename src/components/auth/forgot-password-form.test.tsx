import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("ForgotPasswordForm localization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["en", "ar"] as const)("keeps the %s reset request usable after a structured upstream error", async (locale) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "Internal rejection", code: "UPSTREAM" } }),
    }));
    render(<ForgotPasswordForm locale={locale} />);
    fireEvent.change(screen.getByLabelText(locale === "ar" ? "البريد الإلكتروني" : "Email"), {
      target: { value: "audit@example.test" },
    });
    fireEvent.submit(screen.getByRole("button", { name: locale === "ar" ? "إرسال رابط إعادة التعيين" : "Send Reset Link" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", locale === "ar"
      ? "فشل إرسال رابط إعادة التعيين." : "Failed to send reset link.");
    expect(screen.queryByText("Internal rejection")).toBeNull();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends the Arabic page locale with the reset request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "English browser response" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ForgotPasswordForm locale="ar" />);
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), {
      target: { value: "buyer@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إرسال رابط إعادة التعيين" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/reset/request",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      }),
    ));
    expect(await screen.findByText(/إذا كان هناك حساب مرتبط بهذا البريد الإلكتروني/)).toBeTruthy();
  });
});
