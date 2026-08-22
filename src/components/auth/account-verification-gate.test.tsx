import { render, waitFor } from "@testing-library/react";
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
  emailVerified: true, isPhotoVerified: false, createdAt: "2026-01-01",
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
});
