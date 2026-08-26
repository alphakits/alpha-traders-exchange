import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAdminAnnouncementEmail,
  isRetryableAnnouncementDeliveryFailure,
  parseRetryAfterMs,
  sendAdminAnnouncementBatch,
  sendAdminAnnouncementEmail,
  validateAdminAnnouncementContent,
  type AdminAnnouncementEmailContent,
} from "@/lib/admin-announcement-email";
import {
  getAdminAnnouncementProviderBatchKey,
  selectAdminAnnouncementRecipients,
  selectPendingAdminAnnouncementBatch,
} from "@/lib/alpha-exchange-store";
import type { AdminAnnouncementRecipient, AlphaExchangeUser, UserRole } from "@/types/alpha-exchange";

const content: AdminAnnouncementEmailContent = {
  subject: "Alpha Exchange is live",
  title: "A faster trading experience",
  content: "Hello,\n\n**Trade faster** with:\n• Live updates\n• Better mobile UX",
  ctaText: "Start Trading",
  ctaUrl: "https://alphatraders.co.il",
};

function user(input: {
  id: string;
  email: string;
  role: UserRole;
  roles?: UserRole[];
  sellerStatus?: AlphaExchangeUser["sellerStatus"];
  emailVerified?: boolean;
  disabled?: boolean;
}): AlphaExchangeUser {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    id: input.id,
    fullName: `User ${input.id}`,
    email: input.email,
    passwordHash: "",
    whatsappNumber: "",
    preferredNetworks: [],
    profilePhotoUrl: "",
    languages: [],
    bio: "",
    onlineStatus: "offline",
    availabilityStatus: "available",
    role: input.role,
    roles: input.roles,
    sellerStatus: input.sellerStatus ?? "buyer",
    emailVerified: input.emailVerified ?? true,
    disabled: input.disabled,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("admin announcement email", () => {
  it("renders a responsive branded email with safe rich text", () => {
    const email = buildAdminAnnouncementEmail({
      ...content,
      content: `${content.content}\n\n<script>alert("unsafe")</script>\n[Help](https://alphatraders.co.il/support)`,
    });

    expect(email.subject).toBe(content.subject);
    expect(email.html).toContain("/images/brand/alpha-traders-logo.png");
    expect(email.html).toContain("Alpha Traders Academy &amp; Exchange");
    expect(email.text).toContain("Alpha Traders Academy & Exchange: https://www.alphatraders.co.il");
    expect(email.html).toContain("max-width:620px");
    expect(email.html).toContain("<strong");
    expect(email.html).toContain("<li");
    expect(email.html).toContain('href="https://alphatraders.co.il/support"');
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("<script>");
    expect(email.text).toContain("Start Trading: https://alphatraders.co.il");
  });

  it("requires an HTTPS CTA URL", () => {
    expect(() => validateAdminAnnouncementContent({ ...content, ctaUrl: "http://example.com" }))
      .toThrow("CTA button URL must be a valid HTTPS URL.");
  });

  it("pauses for transient provider failures but not permanent rejections", () => {
    expect(isRetryableAnnouncementDeliveryFailure({ reason: "resend_network_failed" })).toBe(true);
    expect(isRetryableAnnouncementDeliveryFailure({ reason: "resend_request_failed", providerStatus: 429 })).toBe(true);
    expect(isRetryableAnnouncementDeliveryFailure({ reason: "resend_request_failed", providerStatus: 503 })).toBe(true);
    expect(isRetryableAnnouncementDeliveryFailure({ reason: "resend_request_failed", providerStatus: 403 })).toBe(false);
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    const now = Date.parse("2026-08-06T17:00:00.000Z");
    expect(parseRetryAfterMs("2", now)).toBe(2_000);
    expect(parseRetryAfterMs("Thu, 06 Aug 2026 17:00:03 GMT", now)).toBe(3_000);
    expect(parseRetryAfterMs("invalid", now)).toBe(0);
  });

  it("does not call Resend without explicit environment configuration", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAdminAnnouncementEmail({
      ...content,
      to: "verified@example.com",
      idempotencyKey: "announcement-run-user",
    })).resolves.toEqual({ ok: false, reason: "resend_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends through Resend with the configured sender and idempotency key", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <news@example.com>");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [{ id: "email-1" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAdminAnnouncementEmail({
      ...content,
      to: "verified@example.com",
      idempotencyKey: "announcement-run-user",
    })).resolves.toEqual(expect.objectContaining({ ok: true, attempts: 1, retryCount: 0 }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toEqual(expect.objectContaining({ "Idempotency-Key": "announcement-run-user" }));
    expect(JSON.parse(String(request.body))).toEqual([
      expect.objectContaining({
        from: "Alpha Traders Academy & Exchange <news@example.com>",
        to: ["verified@example.com"],
        subject: content.subject,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails/batch",
      expect.anything(),
    );
  });

  it("retries 429 responses with the same idempotency key", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <news@example.com>");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [{ id: "email-1" }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const delivery = sendAdminAnnouncementEmail({
      ...content,
      to: "verified@example.com",
      idempotencyKey: "announcement-run-user",
    });
    await vi.runAllTimersAsync();

    await expect(delivery).resolves.toEqual(expect.objectContaining({
      ok: true,
      attempts: 2,
      retryCount: 1,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const idempotencyKeys = fetchMock.mock.calls.map(([, request]) => (
      (request as RequestInit).headers as Record<string, string>
    )["Idempotency-Key"]);
    expect(idempotencyKeys).toEqual(["announcement-run-user", "announcement-run-user"]);
  });

  it("defers long Retry-After windows without blocking the request", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <news@example.com>");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "30" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAdminAnnouncementEmail({
      ...content,
      to: "verified@example.com",
      idempotencyKey: "announcement-run-user",
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      providerStatus: 429,
      attempts: 1,
      retryAfterMs: 30_000,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps Batch API response IDs to recipients without exposing a shared address", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <news@example.com>");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [{ id: "email-a" }, { id: "email-b" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAdminAnnouncementBatch({
      ...content,
      recipients: [
        { userId: "user-a", email: "a@example.com" },
        { userId: "user-b", email: "b@example.com" },
      ],
      idempotencyKey: "campaign-batch-1",
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      deliveries: [
        { userId: "user-a", providerEmailId: "email-a" },
        { userId: "user-b", providerEmailId: "email-b" },
      ],
    }));

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Array<{ to: string[] }>;
    expect(body).toHaveLength(2);
    expect(body.map((email) => email.to)).toEqual([["a@example.com"], ["b@example.com"]]);
  });

  it("does not retry an ambiguous successful response with invalid JSON", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <news@example.com>");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError("invalid JSON")),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAdminAnnouncementBatch({
      ...content,
      recipients: [{ userId: "user-a", email: "a@example.com" }],
      idempotencyKey: "campaign-batch-ambiguous",
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      reason: "resend_invalid_batch_response",
      attempts: 1,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("admin announcement audiences", () => {
  const users = [
    user({ id: "buyer", email: "buyer@example.com", role: "buyer" }),
    user({ id: "seller", email: "seller@example.com", role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller" }),
    user({ id: "admin", email: "admin@example.com", role: "admin", roles: ["admin"] }),
    user({ id: "owner", email: "owner@example.com", role: "owner", roles: ["owner", "admin"] }),
    user({ id: "unverified", email: "unverified@example.com", role: "buyer", emailVerified: false }),
    user({ id: "disabled", email: "disabled@example.com", role: "buyer", disabled: true }),
    user({ id: "duplicate", email: "BUYER@example.com", role: "buyer" }),
  ];

  it("includes only active verified users and deduplicates addresses", () => {
    expect(selectAdminAnnouncementRecipients(users, "all_verified_users").map((recipient) => recipient.email))
      .toEqual(["admin@example.com", "buyer@example.com", "owner@example.com", "seller@example.com"]);
  });

  describe("admin announcement campaign resume", () => {
    function recipient(
      userId: string,
      status: AdminAnnouncementRecipient["status"],
      batchIndex: number,
    ): AdminAnnouncementRecipient {
      return {
        userId,
        email: `${userId}@example.com`,
        name: userId,
        status,
        batchIndex,
      };
    }

    it("skips delivered recipients and resumes only the earliest pending durable batch", () => {
      const pending = selectPendingAdminAnnouncementBatch([
        recipient("already-sent", "sent", 0),
        recipient("retry-a", "pending", 0),
        recipient("retry-b", "pending", 0),
        recipient("later", "pending", 1),
      ]);

      expect(pending.map((item) => item.userId)).toEqual(["retry-a", "retry-b"]);
    });

    it("uses an immutable request key for every retry of a durable batch", () => {
      expect(getAdminAnnouncementProviderBatchKey("campaign-1", 0)).toBe("campaign-1-batch-0");
      expect(getAdminAnnouncementProviderBatchKey("campaign-1", 0)).toBe("campaign-1-batch-0");
      expect(getAdminAnnouncementProviderBatchKey("campaign-1", 1)).toBe("campaign-1-batch-1");
    });
  });

  it("keeps buyer, approved seller, and administrator segments distinct", () => {
    expect(selectAdminAnnouncementRecipients(users, "buyers").map((recipient) => recipient.userId)).toEqual(["buyer"]);
    expect(selectAdminAnnouncementRecipients(users, "approved_sellers").map((recipient) => recipient.userId)).toEqual(["seller"]);
    expect(selectAdminAnnouncementRecipients(users, "administrators").map((recipient) => recipient.userId)).toEqual(["admin", "owner"]);
  });
});
