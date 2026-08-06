import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAdminAnnouncementEmail,
  isRetryableAnnouncementDeliveryFailure,
  sendAdminAnnouncementEmail,
  validateAdminAnnouncementContent,
  type AdminAnnouncementEmailContent,
} from "@/lib/admin-announcement-email";
import { selectAdminAnnouncementRecipients } from "@/lib/alpha-exchange-store";
import type { AlphaExchangeUser, UserRole } from "@/types/alpha-exchange";

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
    expect(email.html).toContain("Alpha Exchange");
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendAdminAnnouncementEmail({
      ...content,
      to: "verified@example.com",
      idempotencyKey: "announcement-run-user",
    })).resolves.toEqual({ ok: true });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toEqual(expect.objectContaining({ "Idempotency-Key": "announcement-run-user" }));
    expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({
      from: "Alpha Exchange <news@example.com>",
      to: ["verified@example.com"],
      subject: content.subject,
    }));
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

  it("keeps buyer, approved seller, and administrator segments distinct", () => {
    expect(selectAdminAnnouncementRecipients(users, "buyers").map((recipient) => recipient.userId)).toEqual(["buyer"]);
    expect(selectAdminAnnouncementRecipients(users, "approved_sellers").map((recipient) => recipient.userId)).toEqual(["seller"]);
    expect(selectAdminAnnouncementRecipients(users, "administrators").map((recipient) => recipient.userId)).toEqual(["admin", "owner"]);
  });
});
