// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { AlphaExchangeNotification, PurchaseRequest, PurchaseRequestStatus } from "@/types/alpha-exchange";

const { getRuntimePostgresPool } = vi.hoisted(() => ({
  getRuntimePostgresPool: vi.fn(() => {
    throw new Error("Database must not be touched while WhatsApp sending is disabled.");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool }));
vi.mock("@/lib/whatsapp-platform", () => ({
  getWhatsAppCloudReadiness: () => ({
    configured: false,
    outboundConfigured: false,
    webhookConfigured: false,
    sendEnabled: false,
    policyApproved: false,
    approvalReferenceRecorded: false,
    readyToSend: false,
    state: "disabled",
    missingRequirements: [],
  }),
  isWhatsAppEventType: (event: string) => new Set([
    "new_request",
    "request_accepted",
    "request_declined",
    "trade_update",
    "trade_room_message",
    "trade_room_reminder",
    "trade_completed",
    "trade_cancelled",
  ]).has(event),
  normalizeWhatsAppE164: (phone: string) => (/^\+[1-9]\d{7,14}$/.test(phone) ? phone : null),
  sendWhatsAppTemplateWithRetry: vi.fn(),
}));

import {
  CURRENT_WHATSAPP_CONSENT_VERSION,
  WHATSAPP_CONSENT_COPY,
  classifyWhatsAppNotification,
  getWhatsAppConsentCopy,
  getWhatsAppConsentCopyHash,
  isWhatsAppEventApplicableToRequest,
  isWhatsAppNotificationDismissed,
  scheduleWhatsAppNotificationDelivery,
  whatsappNotificationRevision,
} from "@/lib/whatsapp-notifications";

function notification(overrides: Partial<AlphaExchangeNotification> = {}): AlphaExchangeNotification {
  return {
    id: "notification-1",
    userId: "buyer-1",
    category: "trade",
    title: "New Trade Room message",
    message: "Private chat content that must never be sent",
    isRead: false,
    relatedRequestId: "request-1",
    whatsappEvent: "trade_room_message",
    whatsappEventAt: "2026-09-12T00:00:00.000Z",
    whatsappEventKey: "wae-00000000-0000-4000-8000-000000000001",
    createdAt: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

function request(status: PurchaseRequestStatus, overrides: Partial<PurchaseRequest> = {}) {
  return {
    id: "request-1",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status,
    ...overrides,
  } as PurchaseRequest;
}

describe("WhatsApp notification delivery policy", () => {
  it("uses versioned exact consent text without transactional data", () => {
    expect(CURRENT_WHATSAPP_CONSENT_VERSION).toBe("2026-09-12.v1");
    expect(getWhatsAppConsentCopy("en")).toBe(WHATSAPP_CONSENT_COPY);
    expect(getWhatsAppConsentCopyHash("en")).toMatch(/^[a-f\d]{64}$/);
    expect(getWhatsAppConsentCopyHash("ar")).not.toBe(getWhatsAppConsentCopyHash("en"));
    expect(WHATSAPP_CONSENT_COPY.toLowerCase()).not.toContain("usdt");
    expect(WHATSAPP_CONSENT_COPY).not.toMatch(/\+\d{8,}|\b\d+(?:\.\d+)?\b/);
  });

  it("classifies only the participant request and active Trade Room allowlist", () => {
    expect(classifyWhatsAppNotification(notification({ whatsappEvent: "new_request" }))).toBe("new_request");
    expect(classifyWhatsAppNotification(notification({ whatsappEvent: "request_accepted" }))).toBe("request_accepted");
    expect(classifyWhatsAppNotification(notification({ whatsappEvent: "request_declined" }))).toBe("request_declined");
    expect(classifyWhatsAppNotification(notification({ whatsappEvent: "trade_update" }))).toBe("trade_update");
    expect(classifyWhatsAppNotification(notification({ whatsappEvent: "trade_completed", title: "Trade completed by admin" }))).toBe("trade_completed");
    expect(classifyWhatsAppNotification(notification({ whatsappEvent: "trade_cancelled" }))).toBe("trade_cancelled");
    expect(classifyWhatsAppNotification(notification({ whatsappEvent: "trade_room_message" }))).toBe("trade_room_message");
    expect(classifyWhatsAppNotification(notification({ whatsappEvent: "trade_room_reminder" }))).toBe("trade_room_reminder");
  });

  it("excludes commission, review, admin, listing, and unrelated notifications", () => {
    expect(classifyWhatsAppNotification(notification({
      title: "Trade completed",
      reason: "commission_payment_due",
      whatsappEvent: undefined,
    }))).toBeNull();
    expect(classifyWhatsAppNotification(notification({ title: "Review available", whatsappEvent: undefined }))).toBeNull();
    expect(classifyWhatsAppNotification(notification({ title: "New trade request", whatsappEvent: undefined }))).toBeNull();
    expect(classifyWhatsAppNotification(notification({ title: "Listing unavailable", whatsappEvent: undefined }))).toBeNull();
    expect(classifyWhatsAppNotification(notification({ category: "system" }))).toBeNull();
    expect(classifyWhatsAppNotification(notification({ relatedRequestId: undefined, relatedTradeId: undefined }))).toBeNull();
  });

  it("deduplicates the same notification revision and changes on a later revision", () => {
    const first = notification({ updatedAt: "2026-09-12T00:00:01.000Z" });
    expect(whatsappNotificationRevision({ ...first })).toBe(whatsappNotificationRevision(first));
    expect(whatsappNotificationRevision({ ...first, updatedAt: "2026-09-12T00:00:02.000Z", isRead: true }))
      .toBe(whatsappNotificationRevision(first));
    expect(whatsappNotificationRevision({
      ...first,
      whatsappEventAt: "2026-09-12T00:00:02.000Z",
      whatsappEventKey: "wae-00000000-0000-4000-8000-000000000002",
    }))
      .not.toBe(whatsappNotificationRevision(first));
  });

  it("suppresses dismissed presentation rows but not intentionally channel-only rows", () => {
    expect(isWhatsAppNotificationDismissed(notification({ isRead: true, state: "read" }))).toBe(true);
    expect(isWhatsAppNotificationDismissed(notification({
      isRead: true,
      state: "archived",
      whatsappChannelOnly: true,
    }))).toBe(false);
  });

  it("rejects stale events when the canonical request has moved on", () => {
    expect(isWhatsAppEventApplicableToRequest("new_request", request("pending"))).toBe(true);
    expect(isWhatsAppEventApplicableToRequest("new_request", request("accepted"))).toBe(false);
    expect(isWhatsAppEventApplicableToRequest("trade_room_message", request("payment_sent"))).toBe(true);
    expect(isWhatsAppEventApplicableToRequest("trade_room_message", request("review_open", { completedAt: "2026-09-12T00:00:00.000Z" }))).toBe(false);
    expect(isWhatsAppEventApplicableToRequest("request_declined", request("declined"))).toBe(true);
    expect(isWhatsAppEventApplicableToRequest("trade_cancelled", request("cancelled"))).toBe(true);
    expect(isWhatsAppEventApplicableToRequest("trade_completed", request("review_open", { completedAt: "2026-09-12T00:00:00.000Z" }))).toBe(true);
  });

  it("keeps durable WhatsApp rows independent from snapshot-table rewrites", () => {
    const migration = readFileSync(
      "supabase/migrations/20260912023000_alpha_exchange_whatsapp_notifications.sql",
      "utf8",
    );
    expect(migration).toContain("whatsapp_inbound_commands");
    expect(migration).not.toMatch(/references\s+alpha_exchange\.(?:users|notifications|purchase_requests)/i);
  });

  it("does no database or network work while the policy-gated sender is disabled", () => {
    expect(scheduleWhatsAppNotificationDelivery(notification())).toBe(false);
    expect(getRuntimePostgresPool).not.toHaveBeenCalled();
  });
});
