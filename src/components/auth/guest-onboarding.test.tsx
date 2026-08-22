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
});
