import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSettingsPanel } from "./account-settings-panel";
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
function mockAccount(send?: () => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/auth/profile") return Response.json({ profile: { id: "test-member" } });
    if (url === "/api/alpha-exchange/notification-preferences") return Response.json({ preferences: { inApp: true }, phone: { verified: false } });
    if (url === "/api/alpha-exchange/phone/send-code") return send ? send() : Response.json({ ok: true, message: `Code sent via ${JSON.parse(String(init?.body)).channel}.` });
    return Response.json({ preferences: {}, connection: null });
  });
}
function panel(locale: "en" | "ar" = "en") {
  render(<AccountSettingsPanel locale={locale} phoneVerificationEnabled phoneVerificationChannels={{ sms: true, whatsapp: true }} initialTab="notifications" />);
}
describe("phone channel choice and send controls", () => {
  it("sends the selected WhatsApp channel and blocks resend for sixty seconds", async () => {
    const fetchMock = mockAccount(); panel();
    fireEvent.change(screen.getByRole("textbox", { name: "Phone number" }), { target: { value: "+972501234567" } });
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp" }));
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByText("Code sent via whatsapp.");
    const send = fetchMock.mock.calls.find(([url]) => String(url).endsWith("phone/send-code"))!;
    expect(JSON.parse(String(send[1]?.body))).toEqual({ phone: "+972501234567", channel: "whatsapp", locale: "en" });
    expect((screen.getByRole("button", { name: "Resend in 60s" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Verification code" }), { target: { value: "123456" } });
    expect((screen.getByRole("button", { name: "Verify" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "Phone number" }), { target: { value: "+972509999999" } });
    expect((screen.getByRole("button", { name: "Verify" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "Verification code" }) as HTMLInputElement).value).toBe("");
  });
  it("prevents double taps and recovers after a network failure", async () => {
    let rejectSend!: (reason: Error) => void;
    const fetchMock = mockAccount(() => new Promise((_resolve, reject) => { rejectSend = reject; })); panel();
    fireEvent.change(screen.getByRole("textbox", { name: "Phone number" }), { target: { value: "+972501234567" } });
    const send = screen.getByRole("button", { name: "Send code" });
    fireEvent.click(send); fireEvent.click(send);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("phone/send-code"))).toHaveLength(1);
    rejectSend(new Error("network failure"));
    await screen.findByText("Could not connect. Please try again.");
    await waitFor(() => expect((screen.getByRole("button", { name: "Send code" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("button", { name: "Verify" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("renders Arabic channel instructions and hides unavailable delivery behind a disabled choice", () => {
    mockAccount(); render(<AccountSettingsPanel locale="ar" phoneVerificationEnabled phoneVerificationChannels={{ sms: true, whatsapp: false }} initialTab="notifications" />);
    expect(screen.getByText("كيف تريد استلام الرمز؟")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /WhatsApp/ }) as HTMLInputElement).disabled).toBe(true);
  });
});
