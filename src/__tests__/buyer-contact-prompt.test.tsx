import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuyerContactPrompt } from "@/components/auth/buyer-contact-prompt";
import { needsBuyerContact } from "@/lib/buyer-contact";

const mocks = vi.hoisted(() => ({
  user: { id: "buyer-one", role: "buyer", roles: ["buyer"], whatsappNumber: "" } as { id: string; role: string; roles: string[]; whatsappNumber: string } | null,
  refresh: vi.fn(),
  fetch: vi.fn(),
  pathname: "/en/usdt-exchange",
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useOptionalCanonicalSession: () => ({ user: mocks.user, refresh: mocks.refresh }) }));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => mocks.pathname }));

beforeEach(() => {
  mocks.user = { id: "buyer-one", role: "buyer", roles: ["buyer"], whatsappNumber: "" };
  mocks.pathname = "/en/usdt-exchange";
  mocks.fetch.mockReset();
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", mocks.fetch);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("required private buyer contact", () => {
  it("opens on every missing-contact login, including a later session, and cannot be dismissed with Escape", () => {
    const view = render(<BuyerContactPrompt locale="en" />);
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }))).toBe(false);
    expect(screen.getByLabelText("Phone or WhatsApp number (required)").getAttribute("required")).toBe("");
    view.unmount();
    render(<BuyerContactPrompt locale="en" />);
    expect((screen.getByRole("dialog") as HTMLDialogElement).open).toBe(true);
  });

  it.each([null, { id: "owner", role: "owner", roles: ["owner"], whatsappNumber: "" }, { id: "buyer", role: "buyer", roles: ["buyer"], whatsappNumber: "+972501234567" }])("does not interrupt visitors, owners, or completed profiles: %j", user => {
    mocks.user = user;
    const { container } = render(<BuyerContactPrompt locale="en" />);
    expect(container.querySelector("dialog")?.open).toBe(false);
  });

  it("keeps the prompt open for invalid input and failed saves", async () => {
    render(<BuyerContactPrompt locale="en" />);
    const phone = screen.getByLabelText("Phone or WhatsApp number (required)");
    fireEvent.change(phone, { target: { value: "bad" } });
    fireEvent.submit(phone.closest("form")!);
    expect(screen.getByRole("alert").textContent).toContain("Enter a valid number");
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "failed" }), { status: 400 }));
    fireEvent.change(phone, { target: { value: "0501234567" } });
    fireEvent.submit(phone.closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("couldn’t save"));
    expect((screen.getByRole("dialog") as HTMLDialogElement).open).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("saves only the normalized contact to the authenticated profile, then refreshes the session", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ profile: { whatsappNumber: "+972501234567" } }), { status: 200 }));
    const { container } = render(<BuyerContactPrompt locale="en" />);
    const phone = screen.getByLabelText("Phone or WhatsApp number (required)");
    fireEvent.change(phone, { target: { value: "٠٥٠١٢٣٤٥٦٧" } });
    fireEvent.submit(phone.closest("form")!);
    await waitFor(() => expect(container.querySelector("dialog")?.open).toBe(false));
    expect(mocks.fetch).toHaveBeenCalledWith("/api/auth/profile", expect.objectContaining({ method: "PATCH", credentials: "include", body: JSON.stringify({ whatsappNumber: "+972501234567" }) }));
    expect(mocks.refresh).toHaveBeenCalledWith({ force: true, background: true });
  });

  it("supports Arabic and keeps essential support accessible", () => {
    const view = render(<BuyerContactPrompt locale="ar" />);
    expect(screen.getByRole("dialog").getAttribute("dir")).toBe("rtl");
    expect(screen.getByRole("heading").textContent).toContain("أضف رقمًا");
    mocks.pathname = "/ar/account-deletion";
    view.rerender(<BuyerContactPrompt locale="ar" />);
    expect(view.container.querySelector("dialog")?.open).toBe(false);
  });

  it("also prompts sellers who can buy and rejects an invalid stored number", () => {
    expect(needsBuyerContact({ role: "approved_seller", whatsappNumber: "invalid" })).toBe(true);
    expect(needsBuyerContact({ role: "guest", onboardingSelection: "buyer" })).toBe(true);
  });
});
