// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiOwner: mocks.auth }));
vi.mock("@/lib/marketing-email-ledger", () => ({ getMarketingEmailAudit: mocks.read }));
vi.mock("@/lib/mentorship-email-config", () => ({ MENTORSHIP_EMAIL_CAMPAIGN_ID: "mentorship-test-campaign" }));

import { GET } from "./route";

const recipient = {
  id: "recipient-one", userId: "user-one", email: "recipient@example.test", locale: "en",
  status: "sent", consentStatus: "requested", consentVersion: "one-time-v1",
  requestedAt: "2026-11-03T15:00:00Z", firstAttemptAt: "2026-11-03T15:00:01Z",
  sentAt: "2026-11-03T15:00:02Z", deliveredAt: null, holdCodes: [],
  providerEmailId: "provider-message-one", providerCampaignId: null,
  lastReason: null, updatedAt: "2026-11-03T15:00:02Z",
  events: [{ type: "sent", occurredAt: "2026-11-03T15:00:02Z", observedAt: "2026-11-03T15:00:03Z", source: "provider", reason: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner", role: "owner" }, unauthorized: null });
  mocks.read.mockResolvedValue({
    campaignId: "mentorship-test-campaign", checkedAt: "2026-11-03T15:01:00Z",
    counts: { total: 1, consented: 1, sent: 1, delivered: 0 }, shown: 1, truncated: false,
    recipients: [recipient],
  });
});

describe("owner mentorship email audit", () => {
  for (const status of [401, 403, 503]) {
    it(`does not read recipients when the owner guard returns ${status}`, async () => {
      mocks.auth.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Access unavailable" }, { status }) });
      const response = await GET();
      expect(response.status).toBe(status);
      expect(mocks.read).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain(recipient.email);
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("vary")).toBe("Cookie");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    });
  }

  it("reads only the configured campaign and preserves sent versus delivered evidence", async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("mentorship-test-campaign");
    expect(body.recipients).toEqual([recipient]);
    expect(body.counts).toEqual({ total: 1, consented: 1, sent: 1, delivered: 0 });
    expect(body.recipients[0].deliveredAt).toBeNull();
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });

  it("excludes private message content, consent tokens and future internal fields", async () => {
    mocks.read.mockResolvedValue({
      campaignId: "mentorship-test-campaign", checkedAt: "2026-11-03T15:01:00Z",
      counts: { total: 1 }, shown: 1, truncated: false, internalSecret: "PRIVATE_CAMPAIGN_DATA",
      recipients: [{ ...recipient, consentToken: "PRIVATE_CONSENT_TOKEN", html: "PRIVATE_EMAIL_BODY", events: [
        { ...recipient.events[0], rawPayload: "PRIVATE_PROVIDER_PAYLOAD" },
      ] }],
    });
    const response = await GET();
    const text = await response.text();
    expect(text).not.toContain("PRIVATE_");
    expect(text).toContain(recipient.email);
  });

  it("returns a private unavailable response without database error details", async () => {
    mocks.read.mockRejectedValue(new Error("PRIVATE_DATABASE_FAILURE recipient@example.test"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Email audit is temporarily unavailable. Please refresh." });
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
});
