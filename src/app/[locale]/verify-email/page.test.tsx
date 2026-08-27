import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  locale: "ar",
  search: "",
}));

vi.mock("next-intl", () => ({
  useLocale: () => mocks.locale,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import VerifyEmailPage from "@/app/[locale]/verify-email/page";

describe("VerifyEmailPage localization", () => {
  beforeEach(() => {
    mocks.locale = "ar";
    mocks.search = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the Arabic page locale when resending verification", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "English provider response" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VerifyEmailPage />);
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), {
      target: { value: "buyer@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إعادة إرسال بريد التحقق" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/verify-email/resend",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      }),
    ));
    expect(await screen.findByText(/إذا كان الحساب موجودًا وغير موثق/)).toBeTruthy();
  });

  it("sends the Arabic page locale when verifying an email link", async () => {
    mocks.search = "token=verification-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "English provider response" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VerifyEmailPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/verify-email",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      }),
    ));
    expect(await screen.findByText("تم التحقق من البريد الإلكتروني بنجاح.")).toBeTruthy();
  });

  it("does not repeatedly submit an invalid verification link", async () => {
    mocks.search = "token=invalid-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid verification link." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VerifyEmailPage />);

    expect(await screen.findByText("فشل التحقق من البريد.")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
