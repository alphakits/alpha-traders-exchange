import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsEvent } from "./model";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), fetch: vi.fn(), persist: vi.fn(), query: vi.fn(), user: vi.fn(), notification: vi.fn(), email: vi.fn() }));
vi.mock("./provider", () => ({ newsProviderConfigured: mocks.configured, fetchEconomicNews: mocks.fetch }));
vi.mock("./repository", () => ({ newsPool: async () => ({ query: mocks.query }), persistNewsSnapshot: mocks.persist }));
vi.mock("@/lib/alpha-exchange-store", () => ({ findUserById: mocks.user, createEconomicNewsNotification: mocks.notification }));
vi.mock("@/lib/marketplace-email-delivery", () => ({ sendMarketplaceEmail: mocks.email }));
import { deliverNewsRelease, runEconomicNewsSync } from "./worker";

const event: NewsEvent = { id: "te-123", providerId: "123", title: "CPI", titleAr: "التضخم", actual: "3.1%", forecast: "3%", previous: "2.9%", revised: null,
  scheduledAt: "2026-09-23T12:30:00Z", syncedAt: "2026-09-23T12:31:00Z", providerUpdatedAt: "2026-09-23T12:30:02Z", reference: null,
  currency: "USD", impact: "high", source: "BLS", sourceUrl: "https://www.bls.gov/", timing: "exact", kind: "release" };
const delivery = { id: "te-123:user:email", user_id: "user", channel: "email" as const, payload: event, lease_token: "lease" };

describe("economic news delivery isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.query.mockResolvedValue({ rows: [{ in_app: true, email: true }] });
    mocks.user.mockResolvedValue({ id: "user", fullName: "Trader", email: "trader@example.test", emailVerified: true, preferredLocale: "ar", notificationPreferences: { inApp: true, email: true } });
    mocks.email.mockResolvedValue({ ok: true });
  });
  it("does no database, provider, or delivery work before a licensed feed is configured", async () => {
    mocks.configured.mockReturnValue(false);
    expect(await runEconomicNewsSync()).toMatchObject({ status: "not_configured", sent: 0 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.notification).not.toHaveBeenCalled();
  });
  it("does not dispatch any result alerts when the provider fails", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("outage"));
    await expect(runEconomicNewsSync()).rejects.toThrow("outage");
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it("uses a stable idempotency key and the released event snapshot when retrying an email", async () => {
    await deliverNewsRelease(delivery);
    await deliverNewsRelease(delivery);
    const sent = mocks.email.mock.calls.map(([payload]) => payload);
    expect(sent[0]).toEqual(sent[1]);
    expect(sent[0]).toMatchObject({ event: "economic_news_released", idempotencyKey: "economic-news:te-123:user:email", recipientLocale: "ar", actionPath: "/news?event=te-123" });
    expect(sent[0].message.en).toContain("3.1%");
  });
  it("honors both the separate news opt-in and the existing channel preference", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ in_app: false, email: false }] });
    expect(await deliverNewsRelease(delivery)).toBe("skipped");
    mocks.user.mockResolvedValueOnce({ emailVerified: true, notificationPreferences: { email: false } });
    expect(await deliverNewsRelease(delivery)).toBe("skipped");
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it("does not notify disabled users and routes in-app alerts to news without a trade identifier", async () => {
    mocks.user.mockResolvedValueOnce({ disabled: true, emailVerified: true });
    expect(await deliverNewsRelease(delivery)).toBe("skipped");
    await deliverNewsRelease({ ...delivery, channel: "inApp" });
    expect(mocks.notification).toHaveBeenCalledWith(expect.objectContaining({ userId: "user", eventId: "te-123" }));
    expect(mocks.notification.mock.calls[0][0].relatedRequestId).toBeUndefined();
  });
  it("does not mark provider-rejected emails successful", async () => {
    mocks.email.mockResolvedValueOnce({ ok: false });
    await expect(deliverNewsRelease(delivery)).rejects.toThrow("News email delivery failed");
  });
});
