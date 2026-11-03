// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(), getStatus: vi.fn(), request: vi.fn(), decline: vi.fn(),
  rate: vi.fn(), open: vi.fn(), enabled: vi.fn(), log: vi.fn(),
}));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.rate }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.log }));
vi.mock("@/lib/mentorship-email-config", () => ({
  MENTORSHIP_EMAIL_CONSENT_VERSION: "invitation-test-v1",
  isMentorshipEmailCampaignOpen: mocks.open,
  isMentorshipEmailRequestEnabled: mocks.enabled,
  mentorshipEmailConsentText: (locale: string) => locale === "ar" ? "أطلب رسالة ترويجية واحدة عن المنتورشيب." : "I request one promotional mentorship invitation email.",
}));
vi.mock("@/lib/mentorship-email-campaign", () => ({ getMentorshipEmailStatus: mocks.getStatus, requestMentorshipEmail: mocks.request, declineMentorshipEmail: mocks.decline }));
import { GET, POST } from "./route";

const user = { id: "user-verified", email: "verified+alias@example.test", emailVerified: true, disabled: false };
const choice = { action: "request", locale: "en", consent: true, consentVersion: "invitation-test-v1" };
const url = "https://www.alphatraders.co.il/api/marketing/mentorship-invitation";
function write(body: unknown = choice, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.alphatraders.co.il", "Sec-Fetch-Site": "same-origin", "x-alpha-expected-user-id": user.id, ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireApiUser.mockResolvedValue({ user, unauthorized: null });
  mocks.rate.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.open.mockReturnValue(true);
  mocks.enabled.mockReturnValue(true);
  mocks.getStatus.mockResolvedValue({ status: "available", canRequest: true, holdCodes: [] });
  mocks.request.mockResolvedValue({ status: "queued", canRequest: false, holdCodes: [] });
  mocks.decline.mockResolvedValue({ status: "declined", canRequest: false, holdCodes: [] });
});

describe("one-time invitation permission boundary", () => {
  it("reads only the signed-in account and omits private ledger/provider data", async () => {
    mocks.getStatus.mockResolvedValue({ status: "held", canRequest: false, holdCodes: ["private_provider_reason"], requestId: "private-id", unsubscribeToken: "private-token", providerEmailId: "provider-id", payload: { html: "private-html" } });
    const response = await GET(new NextRequest(`${url}?locale=ar`, { headers: { "x-alpha-expected-user-id": user.id } }));
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(await response.json()).toEqual({ status: "held", canRequest: false, maskedEmail: "v•••@example.test", consentVersion: "invitation-test-v1", consentText: "أطلب رسالة ترويجية واحدة عن المنتورشيب." });
    expect(mocks.getStatus).toHaveBeenCalledExactlyOnceWith(user);
  });

  it("refuses requests without an authenticated account", async () => {
    mocks.requireApiUser.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await POST(write())).status).toBe(401);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { Origin: "https://other.example" },
    { Origin: "" },
    { "Sec-Fetch-Site": "cross-site" },
  ])("rejects an untrusted mutation origin before authentication or storage: %j", async headers => {
    expect((await POST(write(choice, headers))).status).toBe(403);
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["", "user-other"])("cannot transfer an opened form to a different account (%s)", async expected => {
    expect((await POST(write(choice, { "x-alpha-expected-user-id": expected }))).status).toBe(409);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.decline).not.toHaveBeenCalled();
  });

  it.each([
    { ...choice, consent: false },
    { action: "request", locale: "en", consentVersion: "invitation-test-v1" },
    { ...choice, consentVersion: "obsolete" },
    { ...choice, email: "someone-else@example.test" },
    { ...choice, userId: "user-other" },
    { ...choice, html: "unapproved" },
    { ...choice, bypassHolds: true },
  ])("requires exact explicit consent and rejects recipient/template/hold overrides: %j", async body => {
    expect((await POST(write(body))).status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does not queue an unverified account", async () => {
    mocks.requireApiUser.mockResolvedValue({ user: { ...user, emailVerified: false }, unauthorized: null });
    const response = await POST(write());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: "unverified", canRequest: false });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["expired", "disabled"])("does not queue when the invitation is %s", async reason => {
    if (reason === "expired") mocks.open.mockReturnValue(false);
    else mocks.enabled.mockReturnValue(false);
    const response = await POST(write());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: reason === "expired" ? "expired" : "held", canRequest: false });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("records only the authenticated, verified user's explicit request and reports queued rather than delivered", async () => {
    const response = await POST(write());
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "queued", canRequest: false });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(user, "en", "invitation-test-v1");
    expect(mocks.decline).not.toHaveBeenCalled();
  });

  it("preserves a held provider result without turning it into a successful send", async () => {
    mocks.request.mockResolvedValue({ status: "unsubscribed", canRequest: false, holdCodes: ["provider_unsubscribed"] });
    const response = await POST(write());
    expect(await response.json()).toMatchObject({ status: "unsubscribed", canRequest: false });
  });

  it("lets a user decline without consenting, verifying email, or changing an account preference", async () => {
    mocks.requireApiUser.mockResolvedValue({ user: { ...user, emailVerified: false }, unauthorized: null });
    const response = await POST(write({ action: "decline", locale: "en" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "declined", canRequest: false });
    expect(mocks.decline).toHaveBeenCalledExactlyOnceWith({ ...user, emailVerified: false });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("honors the shared request rate limit without creating another request", async () => {
    mocks.rate.mockResolvedValue({ allowed: false, retryAfterSeconds: 75 });
    const response = await POST(write());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("75");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does not claim a request was saved after a storage failure or disclose provider errors", async () => {
    mocks.request.mockRejectedValue(new Error("secret-provider-details"));
    const response = await POST(write());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "choice_unconfirmed" });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("secret-provider-details");
  });
});
