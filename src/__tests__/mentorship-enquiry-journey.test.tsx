import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactForm } from "@/components/sections/contact/contact-form";
import { LearningInformationReply } from "@/components/academy/learning-information-reply";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-27T11:00:00Z")); });

const initialValues = { name: "Test Learner", email: "learner@example.test", message: "I want to understand market structure." };

describe("guided mentorship enquiry", () => {
  it("requires the learning context before sending, and never applies it to the general form", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<ContactForm locale="en" topic="learning-with-mark" initialValues={initialValues} />);
    fireEvent.submit(screen.getByRole("form"));
    expect(screen.getByText("Choose your current experience.")).toBeTruthy();
    expect(screen.getByText("Describe your available study time in 2–160 characters.")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    unmount();
    render(<ContactForm locale="en" />);
    expect(screen.queryByLabelText(/Your current experience/)).toBeNull();
    expect(screen.queryByLabelText(/Available study time/)).toBeNull();
  });

  it("saves once while pending and supplies clear next steps after a real acknowledgement", async () => {
    let resolve!: (value: unknown) => void;
    const fetch = vi.fn<(url: string, options: { body: string }) => Promise<unknown>>(() => new Promise(r => { resolve = r; }));
    vi.stubGlobal("fetch", fetch);
    render(<ContactForm locale="en" topic="learning-with-mark" initialValues={initialValues} />);
    fireEvent.change(screen.getByLabelText(/Your current experience/), { target: { value: "studied" } });
    fireEvent.change(screen.getByLabelText(/Available study time/), { target: { value: "  Evenings, 3 hours a week  " } });
    const form = screen.getByRole("form");
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.queryByText("Your interest has been recorded")).toBeNull();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ learningDetails: { experience: "studied", availability: "Evenings, 3 hours a week" }, message: initialValues.message });
    await act(async () => { resolve({ ok: true, status: 200 }); });
    expect(screen.getByRole("link", { name: "Explore the Free Academy" }).getAttribute("href")).toBe("/en/learn-trading-free");
    expect(screen.getByRole("link", { name: "Hear Mark’s explanation · 7:44" }).getAttribute("href")).toBe("/en/learn-with-mark#mark-explains");
    fireEvent.click(screen.getByRole("button", { name: "Send another message" }));
    expect((screen.getByLabelText(/Your current experience/) as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText(/Available study time/) as HTMLInputElement).value).toBe("");
  });

  it("preserves the complete Arabic enquiry when saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<ContactForm locale="ar" topic="learning-with-mark" initialValues={initialValues} />);
    fireEvent.change(screen.getByLabelText(/خبرتك الحالية/), { target: { value: "practising" } });
    fireEvent.change(screen.getByLabelText(/الوقت المتاح للدراسة/), { target: { value: "مساءً بتوقيت إسرائيل" } });
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(screen.getByText("حدث خطأ ما. يرجى المحاولة مجدداً.")).toBeTruthy());
    expect(screen.getByDisplayValue(initialValues.message)).toBeTruthy();
    expect(screen.getByDisplayValue("مساءً بتوقيت إسرائيل")).toBeTruthy();
    expect((screen.getByLabelText(/خبرتك الحالية/) as HTMLSelectElement).value).toBe("practising");
    expect(screen.queryByText("تم تسجيل اهتمامك")).toBeNull();
  });

  it("handles an intake that closes while the form is open without reporting a saved enquiry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "mentorship_intake_closed" }) }));
    render(<ContactForm locale="en" topic="learning-with-mark" initialValues={initialValues} />);
    fireEvent.change(screen.getByLabelText(/Your current experience/), { target: { value: "studied" } });
    fireEvent.change(screen.getByLabelText(/Available study time/), { target: { value: "Evenings" } });
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(screen.getByText("The 2026 ICT Mentorship enquiry window has closed. The free Academy remains available.")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Send mentorship enquiry" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByDisplayValue(initialValues.message)).toBeTruthy();
    expect(screen.queryByText("Your interest has been recorded")).toBeNull();
    expect(screen.getByRole("link", { name: "Explore the Free Academy" }).getAttribute("href")).toBe("/en/learn-trading-free");
  });
});

describe("owner information reply", () => {
  it("copies the chosen language with public links and does not send a message", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { container } = render(<LearningInformationReply locale="en" />);
    container.querySelector("details")!.open = true;
    fireEvent.click(screen.getByRole("button", { name: "العربية" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy reply" }));
    await waitFor(() => expect(screen.getByText("Reply copied. No message has been sent.")).toBeTruthy());
    expect(copy.mock.calls[0][0]).toContain("https://www.alphatraders.co.il/ar/learn-with-mark#mark-explains");
    expect(copy.mock.calls[0][0]).toContain("7:44");
    expect(copy.mock.calls[0][0]).toContain("₪6,700");
    expect(copy.mock.calls[0][0]).toContain("₪7,500");
    expect(copy.mock.calls[0][0]).toContain("برنامج واحد");
    expect(copy.mock.calls[0][0]).not.toMatch(/6,?500|learner@example/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a selectable reply when clipboard access fails", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
    const { container } = render(<LearningInformationReply locale="ar" />);
    container.querySelector("details")!.open = true;
    fireEvent.click(screen.getByRole("button", { name: "انسخ الرد" }));
    await waitFor(() => expect(screen.getByText("تعذّر النسخ تلقائيًا. حدد نص الرد أعلاه وانسخه.")).toBeTruthy());
    expect((screen.getByLabelText("نص الرد") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByText("تم نسخ الرد. لم تُرسل رسالة.")).toBeNull();
  });
});
