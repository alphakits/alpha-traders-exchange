import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FooterNewsletterSignup } from "@/components/layout/footer-newsletter-signup";

describe("FooterNewsletterSignup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits an English newsletter request and clears the email", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    render(<FooterNewsletterSignup locale="en" />);
    const input = screen.getByLabelText("Newsletter email address") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "reader@example.com" } });
    fireEvent.submit(screen.getByRole("form", { name: "Subscribe" }));

    await waitFor(() => expect(screen.getByText("Subscription request received.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/contact", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Locale": "en" },
    }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      name: "Newsletter subscriber",
      email: "reader@example.com",
      subject: "Newsletter subscription request",
      locale: "en",
      website: "",
    });
    expect(input.value).toBe("");
  });

  it("shows localized Arabic feedback when rate limited", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    vi.stubGlobal("fetch", fetchMock);

    render(<FooterNewsletterSignup locale="ar" />);
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني للنشرة البريدية"), {
      target: { value: "reader@example.com" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "اشترك" }));

    await waitFor(() => expect(screen.getByText("طلبات كثيرة جدًا. يرجى المحاولة لاحقًا.")).toBeTruthy());
  });
});
