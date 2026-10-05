import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuestOnboarding } from "@/components/auth/guest-onboarding";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  useOptionalCanonicalSession: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({
  useOptionalCanonicalSession: mocks.useOptionalCanonicalSession,
}));

describe("GuestOnboarding canonical session refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.refresh.mockResolvedValue(undefined);
    mocks.useOptionalCanonicalSession.mockReturnValue({ refresh: mocks.refresh });
  });

  it("does not offer buyer activation or guest mode to an existing buyer", () => {
    mocks.useOptionalCanonicalSession.mockReturnValue({ refresh: mocks.refresh, user: { role: "buyer", roles: ["buyer"], sellerStatus: "buyer" } });
    render(<GuestOnboarding locale="en" phoneVerificationEnabled />);
    expect(screen.getByRole("heading", { name: "Buyer access" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Become a Buyer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue as Buyer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue as Guest" })).toBeNull();
  });

  it("lets an existing student continue learning without activating the same role", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.useOptionalCanonicalSession.mockReturnValue({ refresh: mocks.refresh, user: { role: "student", roles: ["student"], sellerStatus: "buyer" } });
    render(<GuestOnboarding locale="en" phoneVerificationEnabled />);
    expect(screen.getByRole("heading", { name: "Become a Buyer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Become a Student" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue as Guest" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue learning" }));
    expect(mocks.replace).toHaveBeenCalledWith("/academy");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves both active roles for a buyer who is also a student", () => {
    mocks.useOptionalCanonicalSession.mockReturnValue({ refresh: mocks.refresh, user: { role: "buyer", roles: ["buyer", "student"], sellerStatus: "buyer" } });
    render(<GuestOnboarding locale="en" phoneVerificationEnabled />);
    expect(screen.getByRole("button", { name: "Open buyer workspace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue learning" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue as Buyer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Become a Student" })).toBeNull();
  });

  it("uses the current guest role over stale buyer props", () => {
    mocks.useOptionalCanonicalSession.mockReturnValue({ refresh: mocks.refresh, user: { role: "guest", roles: ["guest"], sellerStatus: "buyer" } });
    render(<GuestOnboarding locale="ar" isBuyer isStudent phoneVerificationEnabled />);
    expect(screen.getByRole("heading", { name: "كن مشتريًا" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "تفعيل دور الطالب" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "صلاحية المشتري" })).toBeNull();
  });

  it.each(["pending_seller_approval", "suspended"])("does not offer a fresh seller application to a %s account", sellerStatus => {
    mocks.useOptionalCanonicalSession.mockReturnValue({ refresh: mocks.refresh, user: { role: "buyer", roles: ["buyer"], sellerStatus } });
    render(<GuestOnboarding locale="en" phoneVerificationEnabled />);
    const seller = within(screen.getByRole("heading", { name: "Seller account" }).closest("article")!);
    expect(seller.queryAllByRole("textbox")).toHaveLength(0);
    if (sellerStatus === "suspended") {
      expect(seller.getByText(/New listings are paused/)).toBeTruthy();
      fireEvent.click(seller.getByRole("button", { name: "Open seller dashboard" }));
      expect(mocks.replace).toHaveBeenCalledWith("/dashboard/seller");
    } else expect(seller.getByText("Your application is under review.")).toBeTruthy();
  });

  it("shows administration access when roles change while setup is open", () => {
    mocks.useOptionalCanonicalSession.mockReturnValue({ refresh: mocks.refresh, user: { role: "buyer", roles: ["buyer"], sellerStatus: "buyer" } });
    const page = render(<GuestOnboarding locale="en" isBuyer phoneVerificationEnabled />);
    mocks.useOptionalCanonicalSession.mockReturnValue({ refresh: mocks.refresh, user: { role: "owner", roles: ["owner"], sellerStatus: "buyer" } });
    page.rerender(<GuestOnboarding locale="en" isBuyer phoneVerificationEnabled />);
    expect(screen.queryByRole("heading", { name: "Buyer access" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Become a Student" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open dashboard" }));
    expect(mocks.replace).toHaveBeenCalledWith("/admin/alpha-exchange");
  });

  it.each([true, false])("explains phone verification according to the enabled setting %s", phoneVerificationEnabled => {
    render(<GuestOnboarding locale="en" phoneVerificationEnabled={phoneVerificationEnabled} />);
    const buyer = within(screen.getByRole("heading", { name: "Become a Buyer" }).closest("article")!);
    if (phoneVerificationEnabled) {
      expect(buyer.queryByText(/Phone verification is off/)).toBeNull();
      expect(buyer.getByText(/Verify your phone before using Alpha Exchange/)).toBeTruthy();
    } else expect(buyer.getByText(/Phone verification is off/)).toBeTruthy();
  });

  it("refreshes the canonical session before navigating after buyer activation", async () => {
    const sequence: string[] = [];
    mocks.refresh.mockImplementation(async () => { sequence.push("refresh"); });
    mocks.replace.mockImplementation(() => { sequence.push("navigate"); });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));

    render(<GuestOnboarding locale="en" phoneVerificationEnabled />);
    const buyerCard = screen.getByRole("heading", { name: "Become a Buyer" }).closest("article");
    expect(buyerCard).not.toBeNull();
    const buyer = within(buyerCard!);
    fireEvent.change(buyer.getByLabelText("First Name"), { target: { value: "Buyer" } });
    fireEvent.change(buyer.getByLabelText("Last Name"), { target: { value: "User" } });
    fireEvent.click(buyer.getByRole("button", { name: "Continue as Buyer" }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith({ force: true }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/usdt-exchange"));
    expect(sequence).toEqual(["refresh", "navigate"]);
  });

  it("requires and submits WhatsApp for an existing buyer seller application", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ destination: "/usdt-exchange#seller-application" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<GuestOnboarding locale="ar" isBuyer phoneVerificationEnabled={false} />);
    const sellerCard = screen.getByRole("heading", { name: "التقدّم للحصول على صفة بائع" }).closest("article");
    expect(sellerCard).not.toBeNull();
    const sellerApplication = within(sellerCard!);
    const submitButton = sellerApplication.getByRole("button", { name: "تقديم طلب البائع" });

    expect(submitButton.hasAttribute("disabled")).toBe(true);
    fireEvent.change(sellerApplication.getByLabelText("رقم واتساب المطلوب"), { target: { value: "0501234567" } });
    fireEvent.click(sellerApplication.getByRole("button", { name: "سحب من الصراف دون بطاقة" }));
    expect(submitButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/alpha-exchange/seller-application",
      expect.objectContaining({ method: "POST" }),
    ));
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      whatsappNumber: "0501234567",
      preferredNetworks: ["Cardless Withdrawal"],
    });
  });
});
