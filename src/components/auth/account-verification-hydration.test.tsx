import { act, fireEvent, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSessionUser } from "@/lib/client-session-user";
import type { PhoneVerificationRecovery } from "@/lib/phone-verification-recovery";
import { AccountVerificationGate } from "./account-verification-gate";
import { CanonicalSessionProvider } from "./canonical-session-provider";

vi.mock("@/components/auth/logout-button", () => ({ LogoutButton: () => <span>Sign out</span> }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const user: ClientSessionUser = {
  id: "pending-buyer", fullName: "Pending Buyer", email: "buyer@example.test", role: "buyer", roles: ["buyer"], sellerStatus: "buyer",
  whatsappNumber: "+972501234567", preferredNetworks: [], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline",
  createdAt: "2026-01-01", emailVerified: true, isPhotoVerified: false, adultConfirmed: true,
};
const recovery: PhoneVerificationRecovery = {
  accountId: user.id,
  observedAt: "2026-11-07T00:00:30.000Z",
  pendingChallenge: { phone: "+972509876543", expiresAt: "2026-11-07T00:10:00.000Z" },
  resendAvailableAt: "2026-11-07T00:01:00.000Z",
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("verification form hydration readiness", () => {
  it.each(["en", "ar"] as const)("accepts a restored code only once handlers are ready and retains it through the canonical read: %s", async locale => {
    let finishRead!: (response: Response) => void;
    const pendingRead = new Promise<Response>(resolve => { finishRead = resolve; });
    const fetchMock = vi.fn().mockReturnValue(pendingRead);
    vi.stubGlobal("fetch", fetchMock);
    const element = <CanonicalSessionProvider initialSessionUser={user}>
      <AccountVerificationGate locale={locale} initialUserId={user.id}
        initialName={user.fullName} initialEmail={user.email} initialPhone={user.whatsappNumber}
        initialPhoneVerificationRecovery={recovery} phoneVerificationEnabled phoneVerificationRequired adultConfirmationRequired />
    </CanonicalSessionProvider>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.appendChild(container);
    let root: Root | undefined;
    try {
      const page = within(container);
      const code = () => page.getByRole("textbox", { name: locale === "ar" ? "رمز التحقق" : "Verification code" }) as HTMLInputElement;
      const phone = () => page.getByRole("textbox", { name: locale === "ar" ? "رقم الهاتف" : "Phone" }) as HTMLInputElement;
      // Enabled server HTML can accept an edit before React owns the controlled
      // input, then silently erase it when hydration or a session read renders.
      expect(code().disabled).toBe(true);
      expect(phone().disabled).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();

      await act(async () => { root = hydrateRoot(container, element); });
      expect(code().disabled).toBe(false);
      expect(phone().disabled).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
      fireEvent.change(code(), { target: { value: locale === "ar" ? "٠١٢٣٤٥" : "012345" } });
      expect(code().value).toBe("012345");

      await act(async () => { finishRead(Response.json({ user: { ...user, fullName: "Updated Buyer" } })); });
      expect(code().value).toBe("012345");
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(code().value).toBe("012345");
      expect((page.getByRole("button", { name: locale === "ar" ? "تأكيد رقم الهاتف" : "Verify phone" }) as HTMLButtonElement).disabled).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (root) await act(async () => { root!.unmount(); });
      container.remove();
    }
  });
});
