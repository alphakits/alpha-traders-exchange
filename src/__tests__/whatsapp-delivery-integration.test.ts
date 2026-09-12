// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeNotification, AlphaExchangeUser, PurchaseRequest } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  pool: null as unknown,
  send: vi.fn(),
  log: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => mocks.pool }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.log }));
vi.mock("@/lib/whatsapp-platform", () => ({
  getWhatsAppCloudReadiness: () => ({
    configured: true,
    outboundConfigured: true,
    webhookConfigured: true,
    sendEnabled: true,
    policyApproved: true,
    approvalReferenceRecorded: true,
    readyToSend: true,
    state: "ready",
    missingRequirements: [],
  }),
  isWhatsAppEventType: (value: string) => new Set([
    "new_request", "request_accepted", "request_declined", "trade_update",
    "trade_room_message", "trade_room_reminder", "trade_completed", "trade_cancelled",
  ]).has(value),
  normalizeWhatsAppE164: (phone: string) => (/^\+[1-9]\d{7,14}$/.test(phone) ? phone : null),
  sendWhatsAppTemplateWithRetry: mocks.send,
}));

import {
  CURRENT_WHATSAPP_CONSENT_VERSION,
  applyWhatsAppWebhookStatuses,
  deliverWhatsAppNotification,
  revokeWhatsAppConsentByPhone,
  runWhatsAppDeliverySweep,
  updateWhatsAppSubscription,
  whatsappNotificationRevision,
} from "@/lib/whatsapp-notifications";

type SubscriptionRow = Record<string, unknown> & {
  user_id: string;
  phone_fingerprint: string;
  locale: "en" | "ar";
  active: boolean;
  consented_at: string;
};

type DeliveryRow = {
  id: string;
  notification_id: string;
  notification_revision: string;
  recipient_user_id: string;
  request_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  lease_token: string | null;
  provider_message_id: string | null;
};

class FakeWhatsAppPool {
  now = "2026-09-12T00:00:00.000Z";
  subscription: SubscriptionRow | null = null;
  consentEvents: unknown[][] = [];
  inboundCommands = new Set<string>();
  newerStopExists = false;
  deliveries = new Map<string, DeliveryRow>();
  notifications = new Map<string, AlphaExchangeNotification>();

  constructor(
    readonly user: AlphaExchangeUser,
    readonly request: PurchaseRequest,
  ) {}

  async connect() {
    return { query: this.query.bind(this), release: vi.fn() };
  }

  private deliveryKey(notificationId: string, revision: string, userId: string) {
    return `${notificationId}:${revision}:${userId}`;
  }

  async query(sqlValue: unknown, params: unknown[] = []) {
    const sql = String(sqlValue).replace(/\s+/g, " ").trim().toLowerCase();
    if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [], rowCount: 0 };
    if (sql.includes("select to_regclass(")) {
      return { rows: [{ subscriptions: "subscriptions", consent_events: "events", deliveries: "deliveries", inbound_commands: "commands" }], rowCount: 1 };
    }
    if (sql.includes("select payload from alpha_exchange.users") && sql.includes("for update")) {
      return { rows: [{ payload: this.user }], rowCount: 1 };
    }
    if (sql.startsWith("select id from alpha_exchange.users")) return { rows: [{ id: this.user.id }], rowCount: 1 };
    if (sql.includes("from alpha_exchange.whatsapp_subscriptions") && sql.includes("limit 1")) {
      return { rows: this.subscription ? [this.subscription] : [], rowCount: this.subscription ? 1 : 0 };
    }
    if (sql.startsWith("select pg_advisory_xact_lock(")) return { rows: [], rowCount: 1 };
    if (sql.includes("from alpha_exchange.whatsapp_inbound_commands") && sql.includes("occurred_at >")) {
      return { rows: this.newerStopExists ? [{ exists: true }] : [], rowCount: this.newerStopExists ? 1 : 0 };
    }
    if (sql.startsWith("insert into alpha_exchange.whatsapp_subscriptions")) {
      this.subscription = {
        user_id: String(params[0]),
        phone_fingerprint: String(params[1]),
        locale: params[2] === "ar" ? "ar" : "en",
        trade_updates_enabled: Boolean(params[3]),
        chat_messages_enabled: Boolean(params[4]),
        active: true,
        consent_version: String(params[5]),
        consent_copy_hash: String(params[6]),
        consented_at: this.now,
        revoked_at: null,
        revocation_reason: null,
        updated_at: this.now,
      };
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("insert into alpha_exchange.whatsapp_consent_events")) {
      this.consentEvents.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("select user_record.payload as user_payload")) {
      const subscription = this.subscription ?? {};
      return { rows: [{ user_payload: this.user, ...subscription }], rowCount: 1 };
    }
    if (sql.includes("select notification.payload as notification_payload") && !sql.includes("join alpha_exchange.whatsapp_subscriptions")) {
      const notification = this.notifications.get(String(params[0]));
      return { rows: notification ? [{ notification_payload: notification, user_payload: this.user }] : [], rowCount: notification ? 1 : 0 };
    }
    if (sql.startsWith("select payload from alpha_exchange.purchase_requests")) {
      return { rows: [{ payload: this.request }], rowCount: 1 };
    }
    if (sql.startsWith("insert into alpha_exchange.whatsapp_deliveries")) {
      const key = this.deliveryKey(String(params[1]), String(params[2]), String(params[3]));
      if (sql.includes("'suppressed'")) {
        this.deliveries.set(key, {
          id: String(params[0]), notification_id: String(params[1]), notification_revision: String(params[2]),
          recipient_user_id: String(params[3]), request_id: String(params[4]), event_type: String(params[5]),
          status: "suppressed", attempt_count: 0, lease_token: null, provider_message_id: null,
        });
        return { rows: [], rowCount: 1 };
      }
      const prior = this.deliveries.get(key);
      if (prior && prior.status !== "retry_scheduled" && prior.status !== "processing") return { rows: [], rowCount: 0 };
      const attemptCount = (prior?.attempt_count ?? 0) + 1;
      const row: DeliveryRow = {
        id: String(params[0]), notification_id: String(params[1]), notification_revision: String(params[2]),
        recipient_user_id: String(params[3]), request_id: String(params[4]), event_type: String(params[5]),
        status: "processing", attempt_count: attemptCount, lease_token: String(params[6]),
        provider_message_id: prior?.provider_message_id ?? null,
      };
      this.deliveries.set(key, row);
      return { rows: [{ id: row.id, attempt_count: attemptCount }], rowCount: 1 };
    }
    if (sql.startsWith("update alpha_exchange.whatsapp_deliveries") && sql.includes("set status = $3")) {
      const row = [...this.deliveries.values()].find((candidate) => candidate.id === params[0] && candidate.lease_token === params[1]);
      if (row) { row.status = String(params[2]); row.lease_token = null; }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("update alpha_exchange.whatsapp_deliveries") && sql.includes("set status = 'accepted'")) {
      const row = [...this.deliveries.values()].find((candidate) => candidate.id === params[0] && candidate.lease_token === params[1]);
      if (row) { row.status = "accepted"; row.provider_message_id = String(params[2]); row.lease_token = null; }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("update alpha_exchange.whatsapp_deliveries") && sql.includes("set status = case")) {
      const row = [...this.deliveries.values()].find((candidate) => candidate.provider_message_id === params[0]);
      if (row) row.status = String(params[1]);
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("update alpha_exchange.whatsapp_deliveries") && sql.includes("max_attempts_exhausted")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("select notification_id, notification_revision, recipient_user_id") && sql.includes("retry_scheduled")) {
      const rows = [...this.deliveries.values()]
        .filter((row) => row.status === "retry_scheduled")
        .map((row) => ({ notification_id: row.notification_id, notification_revision: row.notification_revision, recipient_user_id: row.recipient_user_id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("join alpha_exchange.whatsapp_subscriptions") && sql.includes("as notification_payload")) {
      const rows = [...this.notifications.values()]
        .filter((notification) => {
          const key = this.deliveryKey(notification.id, whatsappNotificationRevision(notification), notification.userId);
          return !this.deliveries.has(key);
        })
        .map((notification) => ({ notification_payload: notification, recipient_user_id: notification.userId }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("insert into alpha_exchange.whatsapp_inbound_commands")) {
      const messageId = String(params[0]);
      if (this.inboundCommands.has(messageId)) return { rows: [], rowCount: 0 };
      this.inboundCommands.add(messageId);
      return { rows: [{ message_id: messageId }], rowCount: 1 };
    }
    if (sql.startsWith("update alpha_exchange.whatsapp_subscriptions") && sql.includes("revocation_reason = 'inbound_stop'")) {
      const occurredAt = new Date(String(params[1])).getTime();
      const consentedAt = new Date(String(this.subscription?.consented_at)).getTime();
      if (!this.subscription?.active || this.subscription.phone_fingerprint !== params[0] || consentedAt > occurredAt) {
        return { rows: [], rowCount: 0 };
      }
      this.subscription = { ...this.subscription, active: false, revoked_at: this.now, revocation_reason: "inbound_stop" };
      return { rows: [this.subscription], rowCount: 1 };
    }
    if (sql.startsWith("update alpha_exchange.whatsapp_inbound_commands")) return { rows: [], rowCount: 1 };
    if (sql.startsWith("update alpha_exchange.whatsapp_subscriptions") && sql.includes("revocation_reason = 'phone_changed'")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("update alpha_exchange.whatsapp_deliveries") && sql.includes("set status = 'suppressed'")) return { rows: [], rowCount: 1 };
    throw new Error(`Unhandled fake SQL: ${sql}`);
  }
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("WhatsApp durable delivery integration", () => {
  it("covers consent, delayed retry, receipt, consent-time gate, STOP replay, and recovery exclusion", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_CONSENT_UI_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET", "0123456789abcdef0123456789abcdef");
    const user = {
      id: "seller-1",
      verifiedPhone: "+972541234567",
      phoneVerifiedAt: "2026-09-11T23:59:00.000Z",
      preferredLocale: "en",
    } as AlphaExchangeUser;
    const request = {
      id: "request-1",
      buyerId: "buyer-1",
      sellerId: user.id,
      status: "payment_sent",
      updatedAt: "2026-09-12T00:01:00.000Z",
    } as PurchaseRequest;
    const pool = new FakeWhatsAppPool(user, request);
    mocks.pool = pool;

    const subscription = await updateWhatsAppSubscription({
      userId: user.id,
      enabled: true,
      verifiedPhone: user.verifiedPhone,
      phoneVerifiedAt: user.phoneVerifiedAt,
      locale: "en",
      tradeUpdatesEnabled: true,
      chatMessagesEnabled: true,
      consentAccepted: true,
      consentVersion: CURRENT_WHATSAPP_CONSENT_VERSION,
    });
    expect(subscription.currentConsent).toBe(true);

    pool.newerStopExists = true;
    await expect(updateWhatsAppSubscription({
      userId: user.id,
      enabled: true,
      verifiedPhone: user.verifiedPhone,
      phoneVerifiedAt: user.phoneVerifiedAt,
      locale: "en",
      tradeUpdatesEnabled: true,
      chatMessagesEnabled: true,
      consentAccepted: true,
      consentVersion: CURRENT_WHATSAPP_CONSENT_VERSION,
    })).rejects.toThrow("newer WhatsApp opt-out");
    pool.newerStopExists = false;

    const notification = {
      id: "notification-1",
      userId: user.id,
      category: "trade",
      title: "Internal status copy",
      message: "Must not reach the provider payload",
      isRead: false,
      state: "unread",
      relatedRequestId: request.id,
      whatsappEvent: "trade_update",
      whatsappEventAt: "2026-09-12T00:01:00.000Z",
      whatsappEventKey: "wae-00000000-0000-4000-8000-000000000011",
      createdAt: "2026-09-12T00:01:00.000Z",
    } as AlphaExchangeNotification;
    pool.notifications.set(notification.id, notification);
    mocks.send.mockResolvedValueOnce({ ok: false, retryable: true, reason: "network_error", error: "network", attempts: 1 });
    expect(await deliverWhatsAppNotification(notification)).toBe("retry_scheduled");
    expect(mocks.send).toHaveBeenLastCalledWith(expect.objectContaining({ maxAttempts: 1 }));

    mocks.send.mockResolvedValueOnce({ ok: true, messageId: "wamid.integration", status: "accepted", attempts: 1 });
    const sweep = await runWhatsAppDeliverySweep();
    expect(sweep.accepted).toBe(1);
    expect([...pool.deliveries.values()][0]).toMatchObject({ status: "accepted", attempt_count: 2 });
    expect(await applyWhatsAppWebhookStatuses([{ messageId: "wamid.integration", status: "delivered" }])).toBe(1);
    expect([...pool.deliveries.values()][0].status).toBe("delivered");

    const preConsent = {
      ...notification,
      id: "notification-before-consent",
      whatsappEventAt: "2026-09-11T23:59:59.000Z",
      whatsappEventKey: "wae-00000000-0000-4000-8000-000000000012",
    };
    pool.notifications.set(preConsent.id, preConsent);
    const sendsBeforeGate = mocks.send.mock.calls.length;
    expect(await deliverWhatsAppNotification(preConsent)).toBe("suppressed");
    expect(mocks.send).toHaveBeenCalledTimes(sendsBeforeGate);

    expect(await revokeWhatsAppConsentByPhone({
      phone: user.verifiedPhone!,
      messageId: "wamid.stop.1",
      occurredAt: "2026-09-12T00:02:00.000Z",
    })).toBe(1);
    expect(await revokeWhatsAppConsentByPhone({
      phone: user.verifiedPhone!,
      messageId: "wamid.stop.1",
      occurredAt: "2026-09-12T00:02:00.000Z",
    })).toBe(0);

    pool.now = "2026-09-12T00:04:00.000Z";
    await updateWhatsAppSubscription({
      userId: user.id,
      enabled: true,
      verifiedPhone: user.verifiedPhone,
      phoneVerifiedAt: user.phoneVerifiedAt,
      locale: "en",
      tradeUpdatesEnabled: true,
      chatMessagesEnabled: true,
      consentAccepted: true,
      consentVersion: CURRENT_WHATSAPP_CONSENT_VERSION,
    });
    expect(await revokeWhatsAppConsentByPhone({
      phone: user.verifiedPhone!,
      messageId: "wamid.stop.old-delivery",
      occurredAt: "2026-09-12T00:03:00.000Z",
    })).toBe(0);
    expect(pool.subscription?.active).toBe(true);

    const recovered = {
      ...notification,
      id: "notification-recovered",
      whatsappEventAt: "2026-09-12T00:05:00.000Z",
      whatsappEventKey: "wae-00000000-0000-4000-8000-000000000013",
    };
    pool.notifications.set(recovered.id, recovered);
    mocks.send.mockResolvedValueOnce({ ok: true, messageId: "wamid.recovered", status: "accepted", attempts: 1 });
    expect((await runWhatsAppDeliverySweep()).recovered).toBe(1);
    expect((await runWhatsAppDeliverySweep()).recoveryCandidates).toBe(0);

    pool.notifications.clear();
    pool.deliveries.clear();
    for (let index = 0; index < 12; index += 1) {
      const dueNotification = {
        ...notification,
        id: `notification-due-${index}`,
        whatsappEventAt: `2026-09-12T00:06:${String(index).padStart(2, "0")}.000Z`,
        whatsappEventKey: `wae-00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      };
      pool.notifications.set(dueNotification.id, dueNotification);
      pool.deliveries.set(
        `${dueNotification.id}:${dueNotification.whatsappEventKey}:${user.id}`,
        {
          id: `delivery-due-${index}`,
          notification_id: dueNotification.id,
          notification_revision: dueNotification.whatsappEventKey,
          recipient_user_id: user.id,
          request_id: request.id,
          event_type: "trade_update",
          status: "retry_scheduled",
          attempt_count: 1,
          lease_token: null,
          provider_message_id: null,
        },
      );
    }
    const recoveryUnderBacklog = {
      ...notification,
      id: "notification-recovery-under-backlog",
      whatsappEventAt: "2026-09-12T00:05:30.000Z",
      whatsappEventKey: "wae-00000000-0000-4000-8000-999999999999",
    };
    pool.notifications.set(recoveryUnderBacklog.id, recoveryUnderBacklog);
    mocks.send.mockResolvedValue({ ok: true, messageId: "wamid.backlog", status: "accepted", attempts: 1 });
    const backlogSweep = await runWhatsAppDeliverySweep();
    expect(backlogSweep.claimed).toBe(12);
    expect(backlogSweep.recovered).toBe(1);
    expect(pool.deliveries.has(
      `${recoveryUnderBacklog.id}:${recoveryUnderBacklog.whatsappEventKey}:${user.id}`,
    )).toBe(true);
  });
});
