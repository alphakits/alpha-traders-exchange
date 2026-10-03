import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  user: { id: "seller-test", role: "approved_seller", fullName: "Test Seller", email: "seller@example.test", emailVerified: false, isPhotoVerified: false, whatsappNumber: "+972521234567" },
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({
  useCanonicalSession: () => ({
    user: mocks.user,
    isResolving: false, error: null, refresh: mocks.refresh,
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
import { AccountVerificationGate } from "./account-verification-gate";
const props = { locale: "en" as const, initialEmail: "seller@example.test", initialName: "Test Seller", initialPhone: "+972521234567", phoneVerificationEnabled: true, phoneVerificationRequired: true };
beforeEach(() => { mocks.refresh.mockReset().mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("required buyer and seller phone screen", () => {
  it.each(["sms", "whatsapp"])("sends through the chosen %s channel and verifies without promoting a seller to buyer", async channel => {
    const message = `Verification code sent via ${channel === "sms" ? "SMS" : "WhatsApp"}.`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, channel, message })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountVerificationGate {...props} />);
    expect(screen.getByText("Verify your email and phone by SMS or WhatsApp before using your buyer or seller account.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get help" }).getAttribute("href")).toBe("/support");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open profile" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: channel === "sms" ? "SMS" : "WhatsApp" }));
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
    await screen.findByText(message);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/alpha-exchange/phone/send-code");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ phone: "+972521234567", channel });
    expect((screen.getByRole("button", { name: "Resend in 60s" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "482901" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify phone" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith({ force: true }));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/alpha-exchange/phone/verify-code");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ phone: "+972521234567", code: "482901" });
  });
  it("invalidates the code form when the recipient number is edited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, message: "Code sent." }))));
    render(<AccountVerificationGate {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
    await screen.findByText("Code sent.");
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "482901" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+972541234567" } });
    expect((screen.getByLabelText("Verification code") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Verify phone" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("does not report verification success when the server rejects the code", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, message: "Code sent." })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Invalid verification code." }), { status: 400 })));
    render(<AccountVerificationGate {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
    await screen.findByText("Code sent.");
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify phone" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Invalid verification code.");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("keeps the code input unavailable until a message is successfully sent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "SMS delivery unavailable." }), { status: 503 })));
    render(<AccountVerificationGate {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "SMS delivery unavailable.");
    expect((screen.getByLabelText("Verification code") as HTMLInputElement).disabled).toBe(true);
  });
});
