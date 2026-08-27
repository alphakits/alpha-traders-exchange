import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterForm } from "@/components/auth/register-form";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

function completeRequiredFields() {
  fireEvent.change(screen.getByLabelText(/الاسم الكامل|Full Name/), { target: { value: "Test User" } });
  fireEvent.change(screen.getByLabelText(/البريد الإلكتروني|Email/), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByLabelText(/^كلمة المرور$|^Password$/), { target: { value: "password123" } });
  fireEvent.change(screen.getByLabelText(/تأكيد كلمة المرور|Confirm Password/), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("RegisterForm localization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a stable Arabic error instead of exposing an unexpected English API error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Database provider exploded while creating profile" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RegisterForm locale="ar" />);
    completeRequiredFields();
    fireEvent.submit(screen.getByRole("button", { name: "إنشاء الحساب" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("تعذر إنشاء الحساب. يُرجى المحاولة مرة أخرى.")).toBeTruthy());
    expect(screen.queryByText(/Database provider exploded/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/register", expect.objectContaining({
      headers: expect.objectContaining({ "X-Locale": "ar" }),
    }));
  });

  it("uses stable error codes for clear Arabic validation copy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: "PASSWORD_MISMATCH", error: "Passwords do not match." }),
    }));

    render(<RegisterForm locale="ar" />);
    completeRequiredFields();
    fireEvent.submit(screen.getByRole("button", { name: "إنشاء الحساب" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("كلمتا المرور غير متطابقتين.")).toBeTruthy());
    expect(screen.queryByText("Passwords do not match.")).toBeNull();
  });

  it("uses non-enumerating success copy in Arabic", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: "Unexpected server success copy" }),
    }));

    render(<RegisterForm locale="ar" />);
    completeRequiredFields();
    fireEvent.submit(screen.getByRole("button", { name: "إنشاء الحساب" }).closest("form")!);

    await waitFor(() => expect(screen.getByText(/إذا كان البريد صالحًا للتسجيل/)).toBeTruthy());
    expect(screen.queryByText("Unexpected server success copy")).toBeNull();
  });
});
