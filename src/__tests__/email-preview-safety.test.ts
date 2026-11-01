// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewEmailRecipientFailure, previewEmailSubject, previewPreparedEmailFailure } from "@/lib/email-preview-safety";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), sweep: vi.fn() }));
vi.mock("@/lib/marketplace-email-outbox", () => ({ enqueueMarketplaceEmail: mocks.enqueue, runMarketplaceEmailSweep: mocks.sweep }));
import { deliverMarketplaceEmailQueue, sendMarketplaceEmail } from "@/lib/marketplace-email-delivery";
import { sendAuthEmailViaResend } from "@/lib/auth-email-delivery";
import { composeAdminAnnouncementEmailContent, sendAdminAnnouncementBatch } from "@/lib/admin-announcement-email";

const recipient = "jozenmark834@yahoo.com";
const other = "unapproved@example.test";
const marketplace = (to: string) => sendMarketplaceEmail({ event: "usdt_demand_published", recipientName: "Staging tester",
  to, recipientLocale: "en", title: { en: "Request", ar: "طلب" }, message: { en: "Test", ar: "اختبار" },
  actionLabel: { en: "View", ar: "عرض" }, actionPath: "/usdt-exchange/requests/test", retryDelayMs: 0 });
const auth = (to: string) => sendAuthEmailViaResend({ to, subject: "Verify", html: "Test", text: "Test" });
const announcementContent = composeAdminAnnouncementEmailContent({
  en: { subject: "Test announcement", title: "Test title", content: "A staging announcement test.", ctaText: "View" },
  ar: { subject: "إعلان تجريبي", title: "عنوان تجريبي", content: "رسالة تجريبية لبيئة الاختبار.", ctaText: "عرض" },
  ctaUrl: "https://preview.example.test",
});
const announcement = (to: string) => sendAdminAnnouncementBatch({ ...announcementContent,
  recipients: [{ userId: "test", email: to }], idempotencyKey: "test-batch" });
const transports = [["marketplace", marketplace], ["auth", auth], ["announcement", announcement]] as const;
const accepted = () => new Response(JSON.stringify({ id: "receipt-1", data: [{ id: "receipt-1" }] }), { status: 200 });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enqueue.mockResolvedValue(null);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("ALPHA_EMAIL_STAGING_ALLOWLIST", recipient);
  vi.stubEnv("RESEND_API_KEY", "captured-transport-only");
  vi.stubEnv("EMAIL_FROM", "Alpha <sender@example.test>");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => accepted()));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("preview email recipient consent", () => {
  it.each(["", "*", "@yahoo.com", `${recipient},`, `${recipient},*`, `Tester <${recipient}>`])("fails closed for invalid allowlist %s", raw => {
    vi.stubEnv("ALPHA_EMAIL_STAGING_ALLOWLIST", raw);
    expect(previewEmailRecipientFailure([recipient])).toMatchObject({ reason: "email_preview_not_configured" });
  });
  it("compares exact mailboxes case-insensitively without accepting aliases, headers or display names", () => {
    vi.stubEnv("ALPHA_EMAIL_STAGING_ALLOWLIST", ` ${recipient.toUpperCase()} `);
    expect(previewEmailRecipientFailure([recipient])).toBeNull();
    for (const address of [other, `Tester <${recipient}>`, `${recipient},${other}`, `jozenmark834+tag@yahoo.com`, `${recipient}\r\nBcc: ${other}`]) {
      expect(previewEmailRecipientFailure([address])).toMatchObject({ reason: "email_preview_recipient_blocked" });
    }
    expect(previewEmailSubject("[STAGING] Request")).toBe("[STAGING] Request");
  });
  it.each(transports)("blocks %s network access without the allowlist", async (_name, send) => {
    vi.stubEnv("ALPHA_EMAIL_STAGING_ALLOWLIST", "");
    expect(await send(recipient)).toMatchObject({ ok: false, reason: "email_preview_not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(transports)("blocks %s network access to any unapproved address", async (_name, send) => {
    expect(await send(other)).toMatchObject({ ok: false, reason: "email_preview_recipient_blocked" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(transports)("sends %s only to the allowlisted mailbox with a staging subject", async (_name, send) => {
    expect(await send(recipient)).toMatchObject({ ok: true });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    for (const message of Array.isArray(body) ? body : [body]) {
      expect(message.to).toEqual([recipient]);
      expect(message.subject).toMatch(/^\[STAGING\] /);
    }
  });
  it.each(transports)("preserves production %s delivery and subjects", async (_name, send) => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await send(other)).toMatchObject({ ok: true });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    for (const message of Array.isArray(body) ? body : [body]) {
      expect(message.to).toEqual([other]);
      expect(message.subject).not.toMatch(/^\[STAGING\] /);
    }
  });
  it.each([["marketplace", marketplace], ["announcement", announcement]] as const)("rechecks %s consent before an inline retry", async (_name, send) => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      vi.stubEnv("ALPHA_EMAIL_STAGING_ALLOWLIST", other);
      return new Response("{}", { status: 503 });
    });
    expect(await send(recipient)).toMatchObject({ ok: false, reason: "email_preview_recipient_blocked" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects an entire mixed announcement batch without sending the allowed subset", async () => {
    expect(await sendAdminAnnouncementBatch({ ...announcementContent, idempotencyKey: "mixed", recipients: [
        { userId: "allowed", email: recipient }, { userId: "blocked", email: other },
      ] })).toMatchObject({ ok: false, reason: "email_preview_recipient_blocked" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { to: [other], subject: "[STAGING] Test" },
    { to: [recipient, other], subject: "[STAGING] Test" },
    { to: [recipient], cc: [other], subject: "[STAGING] Test" },
    { to: [recipient], bcc: [other], subject: "[STAGING] Test" },
    { to: [recipient], subject: "Old unprefixed job" },
  ])("checks every frozen recipient and subject before recovery: %j", async body => {
    const prepared = { recipientEmail: recipient, body: JSON.stringify(body), event: "trade_accepted", idempotencyKey: "frozen" };
    expect(previewPreparedEmailFailure(prepared)).toMatchObject({ reason: "email_preview_payload_blocked" });
    mocks.sweep.mockImplementationOnce(send => send(prepared));
    expect(await deliverMarketplaceEmailQueue()).toMatchObject({ ok: false, reason: "email_preview_payload_blocked" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
