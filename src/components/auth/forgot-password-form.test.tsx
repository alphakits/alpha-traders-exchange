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
