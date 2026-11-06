import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountVerificationGate } from "./account-verification-gate";
import { CanonicalSessionProvider } from "./canonical-session-provider";
import type { ClientSessionUser } from "@/lib/client-session-user";
import VerifyAccountPage from "@/app/[locale]/verify-account/page";

vi.mock("@/components/auth/logout-button", () => ({ LogoutButton: () => <span>Sign out</span> }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/auth", () => ({
  getCurrentSessionUser: vi.fn(async () => ({
    ...verified,
    verifiedPhone: verified.whatsappNumber,
    phoneVerifiedAt: "2026-10-01T00:00:00.000Z",
    ageEligibility: { method: "self_attestation_v1", confirmedAt: "2026-10-01T00:00:00.000Z" },
  })),
}));
vi.mock("@/lib/phone-verification-delivery", () => ({ getPhoneVerificationChannels: () => ({ sms: true, whatsapp: false }) }));

const originalLocation = window.location;
const replace = vi.fn();
const assign = vi.fn();
const verified: ClientSessionUser = {
  id: "verified-buyer", fullName: "Verified Buyer", email: "buyer@example.test", role: "buyer", roles: ["buyer"], sellerStatus: "buyer",
  whatsappNumber: "+972501234567", preferredNetworks: [], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline",
  createdAt: "2026-01-01", emailVerified: true, isPhotoVerified: true, adultConfirmed: true,
};
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(finish => { resolve = finish; });
  return { promise, resolve };
}
function gate() {
  return <CanonicalSessionProvider initialSessionUser={verified}>
    <AccountVerificationGate locale="en" redirectTo="/en/trades" initialUserId={verified.id}
      initialName={verified.fullName} initialEmail={verified.email} initialPhone={verified.whatsappNumber}
      phoneVerificationEnabled phoneVerificationRequired adultConfirmationRequired />
  </CanonicalSessionProvider>;
}
beforeEach(() => {
  vi.useFakeTimers();
  replace.mockReset(); assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, pathname: "/en/verify-account", replace, assign } });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("verified account onward navigation", () => {
  it("keeps the page's phone requirement active when fresh account state revokes an initially verified phone", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "");
    const pending = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const page = await VerifyAccountPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({ redirectTo: "/en/trades" }),
    });
    render(<CanonicalSessionProvider initialSessionUser={verified}>{page}</CanonicalSessionProvider>);
    expect(replace).not.toHaveBeenCalled();
    await act(async () => pending.resolve(Response.json({ user: { ...verified, isPhotoVerified: false } })));
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send verification code" })).toBeTruthy();
  });

  it("awaits the canonical response before leaving a verified SSR snapshot, coalescing the provider read", async () => {
    const pending = deferred();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(gate());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
    expect(replace).not.toHaveBeenCalled();
    await act(async () => pending.resolve(Response.json({ user: verified })));
    expect(replace).toHaveBeenCalledExactlyOnceWith("/en/trades");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { emailVerified: false },
    { isPhotoVerified: false },
    { adultConfirmed: false },
  ])("rechecks current verification after the response instead of navigating with stale flags %j", async revoked => {
    const pending = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    render(gate());
    expect(replace).not.toHaveBeenCalled();
    await act(async () => pending.resolve(Response.json({ user: { ...verified, ...revoked } })));
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("Verify your account")).toBeTruthy();
  });

  it("stays on the page through a failed canonical read and proceeds after recovery", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }))
      .mockImplementation(async () => Response.json({ user: verified }));
    vi.stubGlobal("fetch", fetchMock);
    render(gate());
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Failed to load account state.");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(replace).toHaveBeenCalledExactlyOnceWith("/en/trades");
  });

  it("ignores a verified response arriving after the verification screen unmounts", async () => {
    const pending = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const view = render(gate());
    view.unmount();
    await act(async () => pending.resolve(Response.json({ user: verified })));
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not carry the previous account's redirect authorization into a changed account", async () => {
    const pending = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    render(gate());
    await act(async () => pending.resolve(Response.json({ user: { ...verified, id: "another-buyer", isPhotoVerified: false } })));
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send verification code" })).toBeTruthy();
  });
});
