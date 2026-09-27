import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactForm } from "@/components/sections/contact/contact-form";
import { LEARNING_CAMPAIGN_STORAGE_KEY } from "@/lib/learning-campaign-client";

describe("ContactForm localization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.removeItem(LEARNING_CAMPAIGN_STORAGE_KEY);
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

  it("sends learning interest explicitly and preserves its category for another enquiry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    window.sessionStorage.setItem(LEARNING_CAMPAIGN_STORAGE_KEY, JSON.stringify({ id: "wa_m01", at: Date.now() }));
    render(<ContactForm locale="en" topic="learning-with-mark" initialValues={{ name: "Test Learner", email: "learner@example.test", message: "I want to learn the fundamentals." }} />);
    const subject = screen.getByLabelText(/Subject/) as HTMLInputElement;
    expect(subject.readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText(/Your current experience/), { target: { value: "starting" } });
    fireEvent.change(screen.getByLabelText(/Available study time/), { target: { value: "3 hours a week" } });
    fireEvent.submit(screen.getByRole("form", { name: "Ask about ICT Mentorship" }));
    await waitFor(() => expect(screen.getByText("Your interest has been recorded")).toBeTruthy());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ topic: "learning-with-mark", subject: "Interest in learning with Mark", campaignLinkId: "wa_m01" });
    fireEvent.click(screen.getByRole("button", { name: "Send another message" }));
    expect((screen.getByLabelText(/Subject/) as HTMLInputElement).value).toBe("ICT Mentorship with Mark");
  });
});
