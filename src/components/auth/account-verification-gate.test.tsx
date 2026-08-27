import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountVerificationGate } from "@/components/auth/account-verification-gate";
import { CanonicalSessionProvider } from "@/components/auth/canonical-session-provider";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const unverifiedUser = {
  id: "buyer-1", fullName: "Buyer User", email: "buyer@example.test", role: "buyer" as const, sellerStatus: "buyer" as const,
  whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline" as const,
  emailVerified: false, isPhotoVerified: false, createdAt: "2026-01-01",
};

describe("AccountVerificationGate canonical session ownership", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the provider's single canonical read on a normal load", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: unverifiedUser }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CanonicalSessionProvider initialSessionUser={unverifiedUser}>
        <AccountVerificationGate locale="en" initialEmail="buyer@example.test" initialName="Buyer User" phoneVerificationEnabled />
      </CanonicalSessionProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", { cache: "no-store", credentials: "include" });
  });

  it("sends the Arabic locale when resending account verification", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/me") {
        return {
          ok: true,
          json: async () => ({ user: unverifiedUser }),
        };
      }
      return {
        ok: true,
        json: async () => ({ message: "English provider response" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CanonicalSessionProvider initialSessionUser={unverifiedUser}>
        <AccountVerificationGate locale="ar" initialEmail="buyer@example.test" initialName="Buyer User" phoneVerificationEnabled />
      </CanonicalSessionProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "إعادة إرسال بريد التحقق" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/verify-email/resend",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      }),
    ));
    expect(await screen.findByText("تم إرسال رسالة تحقق جديدة.")).toBeTruthy();
  });
});
