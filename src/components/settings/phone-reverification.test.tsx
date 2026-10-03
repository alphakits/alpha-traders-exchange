import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSettingsPanel } from "@/components/settings/account-settings-panel";

vi.mock("@/i18n/navigation", () => ({ Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

function mockAccount(confirmOk: boolean) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/auth/profile") return Response.json({ profile: { id: "phone-owner" } });
    if (url === "/api/alpha-exchange/notification-preferences") return Response.json({ preferences: { inApp: true }, phone: { verified: true, masked: "+972******567" } });
    if (url === "/api/alpha-exchange/phone/send-code") return Response.json({ ok: true, message: "Verification code sent via SMS." });
    if (url === "/api/alpha-exchange/phone/verify-code") return Response.json(confirmOk ? { ok: true } : { error: "Invalid verification code." }, { status: confirmOk ? 200 : 400 });
    return Response.json({ preferences: {}, connection: null });
  });
}

describe("phone reverification", () => {
  it("allows a verified member to request a fresh SMS without changing existing verification or notification consent", async () => {
    const fetchMock = mockAccount(false);
    render(<AccountSettingsPanel locale="en" phoneVerificationEnabled initialTab="notifications" />);
    fireEvent.click(await screen.findByRole("button", { name: "Reverify phone" }));
    const phone = screen.getByRole("textbox", { name: "Phone number" });
    expect((phone as HTMLInputElement).value).toBe("");
    fireEvent.change(phone, { target: { value: "+972541234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByText("Verification code sent via SMS.");
    fireEvent.change(screen.getByRole("textbox", { name: "Verification code" }), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await screen.findByText("Invalid verification code.");
    expect(screen.getByText("Phone verified for phone and WhatsApp services.")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/alpha-exchange/notification-preferences").every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it("closes and clears the code form only after the server confirms the verification", async () => {
    mockAccount(true);
    render(<AccountSettingsPanel locale="en" phoneVerificationEnabled initialTab="notifications" />);
    fireEvent.click(await screen.findByRole("button", { name: "Reverify phone" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Phone number" }), { target: { value: "+972541234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByText("Verification code sent via SMS.");
    fireEvent.change(screen.getByRole("textbox", { name: "Verification code" }), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Verification code" })).toBeNull());
    expect(screen.getByRole("button", { name: "Reverify phone" })).toBeTruthy();
    expect(screen.getByText("Phone verified. You can now enable available phone notification channels.")).toBeTruthy();
  });
});
