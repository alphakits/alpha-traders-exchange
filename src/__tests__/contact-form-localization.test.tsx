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
});
