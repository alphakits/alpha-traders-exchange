import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactForm } from "@/components/sections/contact/contact-form";

describe("ContactForm localization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps stable and legacy server issues to Arabic instead of rendering raw English", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "validation_error",
        issues: {
          email: ["EMAIL_INVALID"],
          subject: ["String must contain at least 2 character(s)"],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ContactForm locale="ar" />);
    fireEvent.change(screen.getByLabelText(/الاسم الكامل/), { target: { value: "مستخدم تجريبي" } });
    fireEvent.change(screen.getByLabelText(/البريد الإلكتروني/), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText(/الموضوع/), { target: { value: "مساعدة" } });
    fireEvent.change(screen.getByLabelText(/الرسالة/), { target: { value: "هذه رسالة تجريبية صالحة" } });
    fireEvent.submit(screen.getByRole("form", { name: "أرسل لنا رسالة" }));

    await waitFor(() => expect(screen.getByText("يرجى إدخال بريد إلكتروني صحيح.")).toBeTruthy());
    expect(screen.getByText("يجب أن يكون الموضوع حرفين على الأقل.")).toBeTruthy();
    expect(screen.queryByText(/String must contain/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/contact", expect.objectContaining({
      headers: { "Content-Type": "application/json", "X-Locale": "ar" },
    }));
  });

  it.each([
    { locale: "en" as const, form: "Send us a message", error: "Something went wrong. Please try again.", success: "Message received!" },
    { locale: "ar" as const, form: "أرسل لنا رسالة", error: "حدث خطأ ما. يرجى المحاولة مجدداً.", success: "تم استلام رسالتك!" },
  ])("preserves an unsaved deletion request and shows an error in $locale", async ({ locale, form, error, success }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "service_unavailable" }),
    }));
    const initialValues = {
      name: "Review Test User",
      email: "review+deletion@example.test",
      subject: "Alpha Traders account deletion request",
      message: "I request deletion of my test account and its associated data.",
    };

    render(<ContactForm locale={locale} initialValues={initialValues} />);
    fireEvent.submit(screen.getByRole("form", { name: form }));

    await waitFor(() => expect(screen.getByText(error)).toBeTruthy());
    expect(screen.queryByText(success)).toBeNull();
    for (const value of Object.values(initialValues)) {
      expect(screen.getByDisplayValue(value)).toBeTruthy();
    }
    expect(screen.getByRole("form", { name: form }).querySelector("button")?.disabled).toBe(false);
  });
});
