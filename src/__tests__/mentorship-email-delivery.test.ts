import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ledger = vi.hoisted(() => ({
  claimMarketingEmail: vi.fn(), completeMarketingEmailSend: vi.fn(), failMarketingEmailSend: vi.fn(),
  getPendingMarketingEmailReconciliations: vi.fn(), isMarketingEmailClaimEligible: vi.fn(),
  markMarketingEmailReconciled: vi.fn(), recordMarketingProviderEvent: vi.fn(),
  getMarketingUnsubscribeStatus: vi.fn(), unsubscribeMarketingEmail: vi.fn(),
}));
vi.mock("@/lib/marketing-email-ledger", async (original) => {
  const actual = await original<typeof import("@/lib/marketing-email-ledger")>();
  return { ...actual, ...ledger };
});
import { serializeMarketingEmailPayload } from "@/lib/marketing-email-ledger";
import { deliverMentorshipEmailQueue } from "@/lib/mentorship-email-delivery";
import { buildMentorshipEmailPayload } from "@/lib/mentorship-email-campaign";
import { isMentorshipEmailCampaignOpen } from "@/lib/mentorship-email-config";
import { GET as unsubscribeGet, POST as unsubscribePost } from "@/app/api/marketing/unsubscribe/route";

const token = "a".repeat(43);
const payload = buildMentorshipEmailPayload({ email: "recipient@example.test", requestId: "request-1", unsubscribeToken: token });
const claim = {
  id: "request-1", campaignId: "mentorship-november-2026", userId: "account-1", email: "recipient@example.test", locale: "en" as const,
  requestBody: payload, payloadHash: createHash("sha256").update(serializeMarketingEmailPayload(payload)).digest("hex"),
  idempotencyKey: "stable-campaign-request", leaseToken: "lease-1", attempts: 1,
  firstAttemptAt: "2026-11-03T12:00:00Z", retryUntil: "2026-11-04T11:00:00Z", offerExpiresAt: "2026-11-30T22:00:00Z",
};
const response = (status: number, data: object = {}) => new Response(JSON.stringify(data), { status });
const options = (fetcher: ReturnType<typeof vi.fn>) => ({ fetcher: fetcher as unknown as typeof fetch, intervalMs: 0 });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("RESEND_API_KEY", "test-only-placeholder");
  vi.stubEnv("NEXT_PUBLIC_MENTORSHIP_EMAIL_REQUEST_ENABLED", "1");
  ledger.claimMarketingEmail.mockResolvedValue(null);
  ledger.isMarketingEmailClaimEligible.mockResolvedValue(true);
  ledger.completeMarketingEmailSend.mockResolvedValue(true);
  ledger.failMarketingEmailSend.mockResolvedValue(true);
  ledger.getPendingMarketingEmailReconciliations.mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("requested mentorship delivery", () => {
  it("does not dispatch anything in preview, even with a provider key", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const fetcher = vi.fn();
    expect((await deliverMentorshipEmailQueue(options(fetcher))).disabled).toBe(true);
    expect(ledger.claimMarketingEmail).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never obtains recipients from registration or sends without a queued request", async () => {
    const fetcher = vi.fn();
    const result = await deliverMentorshipEmailQueue(options(fetcher));
    expect(result.attempted).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(ledger.claimMarketingEmail).toHaveBeenCalledWith({ campaignId: "mentorship-november-2026" });
  });
  it("holds a provider-suppressed address before any send", async () => {
    ledger.claimMarketingEmail.mockResolvedValueOnce(claim);
    const fetcher = vi.fn().mockResolvedValue(response(200, { object: "suppression" }));
    expect((await deliverMentorshipEmailQueue(options(fetcher))).held).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(ledger.failMarketingEmailSend).toHaveBeenCalledWith(expect.objectContaining({ holdCodes: ["provider_suppression"] }));
    expect(ledger.completeMarketingEmailSend).not.toHaveBeenCalled();
  });
  it("respects provider unsubscribes even when the account requested an invitation", async () => {
    ledger.claimMarketingEmail.mockResolvedValueOnce(claim);
    const fetcher = vi.fn().mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(200, { unsubscribed: true }));
    expect((await deliverMentorshipEmailQueue(options(fetcher))).held).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ledger.failMarketingEmailSend).toHaveBeenCalledWith(expect.objectContaining({ holdCodes: ["provider_unsubscribed"] }));
  });
  it("fails closed when provider permission checks are unavailable", async () => {
    ledger.claimMarketingEmail.mockResolvedValueOnce(claim);
    const fetcher = vi.fn().mockResolvedValue(response(403));
    const result = await deliverMentorshipEmailQueue(options(fetcher));
    expect(result.configurationError).toBe(true);
    expect(result.sent).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rechecks eligibility after network checks and respects a withdrawal during preflight", async () => {
    ledger.claimMarketingEmail.mockResolvedValueOnce(claim);
    ledger.isMarketingEmailClaimEligible.mockResolvedValue(false);
    const fetcher = vi.fn().mockResolvedValue(response(404));
    await deliverMentorshipEmailQueue(options(fetcher));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ledger.completeMarketingEmailSend).not.toHaveBeenCalled();
  });
  it("keeps exact content and key on ambiguous provider outcomes", async () => {
    ledger.claimMarketingEmail.mockResolvedValueOnce(claim);
    const fetcher = vi.fn().mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(404)).mockRejectedValueOnce(new Error("timeout"));
    const result = await deliverMentorshipEmailQueue(options(fetcher));
    expect(result.retrying).toBe(1);
    const [, request] = fetcher.mock.calls[2];
    expect(request.body).toBe(serializeMarketingEmailPayload(payload));
    expect(request.headers["Idempotency-Key"]).toBe(claim.idempotencyKey);
    expect(ledger.failMarketingEmailSend).toHaveBeenCalledWith(expect.objectContaining({ ambiguous: true, retryable: true }));
    expect(ledger.completeMarketingEmailSend).not.toHaveBeenCalled();
  });
  it("records accepted and delivered independently without inventing a delivery timestamp", async () => {
    ledger.claimMarketingEmail.mockResolvedValueOnce(claim);
    ledger.getPendingMarketingEmailReconciliations.mockResolvedValue([{ id: "request-1", providerEmailId: "provider-1" }]);
    const fetcher = vi.fn().mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, { id: "provider-1" }))
      .mockResolvedValueOnce(response(200, { id: "provider-1", last_event: "delivered" }));
    const result = await deliverMentorshipEmailQueue(options(fetcher));
    expect(result.sent).toBe(1);
    expect(result.reconciled).toBe(1);
    expect(ledger.completeMarketingEmailSend).toHaveBeenCalledWith({ requestId: "request-1", leaseToken: "lease-1", providerEmailId: "provider-1" });
    expect(ledger.recordMarketingProviderEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "delivered", source: "poll" }));
    expect(ledger.recordMarketingProviderEvent.mock.calls[0][0]).not.toHaveProperty("occurredAt");
  });
  it("blocks changed frozen content before contacting the provider", async () => {
    ledger.claimMarketingEmail.mockResolvedValueOnce({ ...claim, requestBody: { ...payload, to: "other@example.test" } });
    const fetcher = vi.fn();
    expect((await deliverMentorshipEmailQueue(options(fetcher))).held).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("continues delivery reconciliation after a missing provider receipt", async () => {
    ledger.getPendingMarketingEmailReconciliations.mockResolvedValue([
      { id: "missing-request", providerEmailId: "missing-receipt" },
      { id: "later-request", providerEmailId: "later-receipt" },
    ]);
    const fetcher = vi.fn().mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, { id: "later-receipt", last_event: "delivered" }));
    const result = await deliverMentorshipEmailQueue(options(fetcher));
    expect(result.reconciliationUnavailable).toBe(1);
    expect(result.reconciled).toBe(1);
    expect(ledger.markMarketingEmailReconciled).toHaveBeenCalledWith({ requestId: "missing-request", providerEmailId: "missing-receipt" });
    expect(ledger.recordMarketingProviderEvent).toHaveBeenCalledTimes(1);
    expect(ledger.recordMarketingProviderEvent).toHaveBeenCalledWith(expect.objectContaining({ providerEmailId: "later-receipt", type: "delivered" }));
  });
});

describe("campaign content and boundaries", () => {
  it("expires at midnight Israel time, not at the server timezone boundary", () => {
    expect(isMentorshipEmailCampaignOpen(new Date("2026-11-30T21:59:59.999Z"))).toBe(true);
    expect(isMentorshipEmailCampaignOpen(new Date("2026-11-30T22:00:00.000Z"))).toBe(false);
  });
  it("keeps approved content, truthful request reason, address, and real unsubscribe headers", () => {
    expect(payload.html).toContain("خلّينا نراجع شارتك سوا.");
    expect(payload.html).toContain("requested the Alpha Traders mentorship invitation");
    expect(payload.html).toContain("Al Hamra");
    expect(payload.html).not.toContain("RESEND_UNSUBSCRIBE_URL");
    expect(payload.html).not.toContain("subscribed to the Alpha Traders newsletter");
    expect(payload.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(payload.html).toContain("https://www.alphatraders.co.il/ar/mentorship-offer");
  });
});

describe("unsubscribe", () => {
  const url = `https://www.alphatraders.co.il/api/marketing/unsubscribe?token=${token}`;
  it("GET from an email scanner never changes permission", async () => {
    ledger.getMarketingUnsubscribeStatus.mockResolvedValue({ valid: true, unsubscribed: false });
    const result = await unsubscribeGet(new NextRequest(url));
    expect(result.status).toBe(200);
    expect(await result.text()).toContain('method="post"');
    expect(ledger.unsubscribeMarketingEmail).not.toHaveBeenCalled();
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("supports an explicit one-click POST with the private token", async () => {
    ledger.unsubscribeMarketingEmail.mockResolvedValue(true);
    const result = await unsubscribePost(new NextRequest(url, { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(result.status).toBe(200);
    expect(ledger.unsubscribeMarketingEmail).toHaveBeenCalledWith(token);
  });
  it("does not claim success if the database change failed", async () => {
    ledger.unsubscribeMarketingEmail.mockRejectedValue(new Error("unavailable"));
    const result = await unsubscribePost(new NextRequest(url, { method: "POST", body: "confirm=1" }));
    expect(result.status).toBe(503);
    expect(await result.text()).toContain("could not confirm");
  });
  it("rejects malformed or unknown tokens", async () => {
    expect((await unsubscribeGet(new NextRequest(`${url}invalid`))).status).toBe(404);
    expect(ledger.getMarketingUnsubscribeStatus).not.toHaveBeenCalled();
    ledger.unsubscribeMarketingEmail.mockResolvedValue(false);
    expect((await unsubscribePost(new NextRequest(url, { method: "POST", body: "confirm=1" }))).status).toBe(404);
  });
});
