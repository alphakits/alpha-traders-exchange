import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { rollbackFailedTransaction } from "@/lib/postgres-transaction";

export type MarketingDeliveryStatus = "pending" | "queued" | "sending" | "sent" | "delivered" | "failed" | "uncertain" | "held" | "expired" | "cancelled";
export type MarketingConsentStatus = "none" | "requested" | "declined" | "withdrawn" | "legacy_newsletter" | "owner_preview";
export type MarketingEmailPublicStatus = {
  status: "available" | "unverified" | "held" | "declined" | "queued" | "sending" | "sent" | "delivered" | "failed" | "uncertain" | "unsubscribed" | "expired";
  canRequest: boolean;
  holdCodes: string[];
  requestId?: string;
  requestedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  reason?: string;
};
export type FrozenMarketingPayload = {
  from: string; to: string; subject: string; html: string; text: string;
  reply_to?: string; headers?: Record<string, string>; tags?: Array<{ name: string; value: string }>;
};
type Identity = { campaignId: string; userId: string; email: string; offerExpiresAt: string };
type Time = Date | string | null;
type RequestRow = {
  id: string; campaign_id: string; user_id: string | null; email: string; locale: "ar" | "en";
  consent_status: MarketingConsentStatus; consent_version: string | null; accepted_at: Time;
  delivery_status: MarketingDeliveryStatus; hold_codes: string[];
  request_body: FrozenMarketingPayload | null; request_body_hash: string | null;
  idempotency_key: string; unsubscribe_token_hash: string | null;
  provider_email_id: string | null; provider_campaign_id: string | null;
  provider_outcome_unknown: boolean;
  attempts: number; first_attempt_at: Time; retry_until: Time; offer_expires_at: Time;
  lease_token: string | null; lease_until: Time; sent_at: Time; delivered_at: Time;
  last_reason: string | null; created_at: Time; updated_at: Time;
};
type AccountRow = { id: string; email: string; payload: { emailVerified?: boolean; disabled?: boolean } };
export class MarketingEmailLedgerError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MarketingEmailLedgerError"; }
}
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
/** Stable before and after a JSONB round trip; also use these exact bytes for transport. */
export function serializeMarketingEmailPayload(payload: FrozenMarketingPayload): string {
  return JSON.stringify(payload, (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([left],[right]) => left < right ? -1 : left > right ? 1 : 0));
    }
    return value;
  });
}
const iso = (value: Time) => value ? new Date(value).toISOString() : undefined;
const isExpired = (value: Time) => !value || new Date(value).getTime() <= Date.now();
const terminal = new Set<MarketingDeliveryStatus>(["sent", "delivered", "failed", "uncertain", "expired"]);
const schemaReady = new WeakMap<Pool, Promise<void>>();

/** Schema is installed by a reviewed migration, never lazily by a visitor. */
async function poolForLedger() {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new MarketingEmailLedgerError("marketing_storage_unavailable");
  let ready = schemaReady.get(pool);
  if (!ready) {
    ready = pool.query<{ ready: boolean }>(`select
      to_regclass('alpha_exchange.marketing_email_requests') is not null and
      to_regclass('alpha_exchange.marketing_email_events') is not null as ready`)
      .then((result) => { if (!result.rows[0]?.ready) throw new MarketingEmailLedgerError("marketing_schema_unavailable"); })
      .catch((error) => { schemaReady.delete(pool); throw error; });
    schemaReady.set(pool, ready);
  }
  await ready;
  return pool;
}
async function transaction<T>(work: (client: PoolClient) => Promise<T>, readOnly = false) {
  const client = await (await poolForLedger()).connect();
  let destroy = false;
  try {
    await client.query(readOnly ? "begin isolation level repeatable read read only" : "begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    destroy = await rollbackFailedTransaction(client, error);
    throw error;
  } finally { client.release(destroy); }
}
function validateIdentity(input: Identity) {
  if (!/^[a-z0-9][a-z0-9_-]{2,99}$/.test(input.campaignId) || !input.userId ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(input.email)) ||
    !Number.isFinite(new Date(input.offerExpiresAt).getTime())) throw new MarketingEmailLedgerError("invalid_campaign_identity");
}
async function accountStatus(client: Pool | PoolClient, input: Identity, lock = false): Promise<MarketingEmailPublicStatus | null> {
  const account = (await client.query<AccountRow>(`select id,email,payload from alpha_exchange.users where id=$1${lock ? " for key share" : ""}`, [input.userId])).rows[0];
  if (!account || account.payload.disabled || normalizeEmail(account.email) !== normalizeEmail(input.email)) {
    return { status: "held", canRequest: false, holdCodes: ["account_unavailable"], reason: "account_unavailable" };
  }
  if (account.payload.emailVerified !== true) return { status: "unverified", canRequest: false, holdCodes: ["email_unverified"], reason: "email_unverified" };
  return null;
}
async function globallyWithdrawn(client: Pool | PoolClient, email: string) {
  const result = await client.query<{ blocked: boolean }>(`select exists(select 1 from alpha_exchange.marketing_email_requests
    where email=$1 and consent_status='withdrawn') as blocked`, [normalizeEmail(email)]);
  return result.rows[0]?.blocked === true;
}
// Only a recorded action is an opt-out. The account's default email=false is not.
const CURRENT_RESTRICTION_SQL = `
  not exists(select 1 from public.contact_submissions c where lower(btrim(c.email))=r.email
    and (c.subject='Alpha Traders account deletion request' or c.subject ~* '(unsubscrib|opt.?out|إلغاء|الغاء)'
      or c.message ~* '(unsubscrib|opt.?out|remove me|إلغاء الاشتراك|الغاء الاشتراك)'))
  and coalesce((select a.payload->>'details' from alpha_exchange.activity_logs a
    where a.user_id=r.user_id and a.category='account' and a.payload->>'title'='Notification preferences updated'
    order by a.created_at desc limit 1),'') not like '%email=false%'`;
async function currentRestrictionCodes(client: Pool | PoolClient, input: Identity): Promise<string[]> {
  const result = await client.query<{ deletion_or_optout: boolean; explicit_email_off: boolean }>(`select
    exists(select 1 from public.contact_submissions c where lower(btrim(c.email))=$2
      and (c.subject='Alpha Traders account deletion request' or c.subject ~* '(unsubscrib|opt.?out|إلغاء|الغاء)'
        or c.message ~* '(unsubscrib|opt.?out|remove me|إلغاء الاشتراك|الغاء الاشتراك)')) as deletion_or_optout,
    coalesce((select a.payload->>'details' from alpha_exchange.activity_logs a where a.user_id=$1
      and a.category='account' and a.payload->>'title'='Notification preferences updated'
      order by a.created_at desc limit 1),'') like '%email=false%' as explicit_email_off`,
  [input.userId,normalizeEmail(input.email)]);
  const row=result.rows[0];
  return [...(row?.deletion_or_optout ? ["deletion_or_optout_requested"] : []),...(row?.explicit_email_off ? ["explicit_email_optout"] : [])];
}
function publicStatus(row: RequestRow | undefined, expiresAt: string, globallyBlocked = false): MarketingEmailPublicStatus {
  const base = {
    canRequest: false, holdCodes: row?.hold_codes ?? [], ...(row ? {
      requestId: row.id, requestedAt: iso(row.accepted_at), sentAt: iso(row.sent_at), deliveredAt: iso(row.delivered_at),
    } : {}),
  };
  if (globallyBlocked || row?.consent_status === "withdrawn") return { ...base, status: "unsubscribed", reason: "recipient_unsubscribed" };
  if (row?.delivery_status === "sent" || row?.delivery_status === "delivered") return { ...base, status: row.delivery_status };
  if (row?.hold_codes.length) return { ...base, status: "held", reason: row.hold_codes[0] };
  if (isExpired(expiresAt) || (row && isExpired(row.offer_expires_at))) return { ...base, status: "expired", reason: "offer_expired" };
  if (row?.consent_status === "declined") return { ...base, status: "declined", canRequest: !row.accepted_at };
  if (!row || row.delivery_status === "pending") return { ...base, status: "available", canRequest: true };
  if (row.delivery_status === "cancelled") return { ...base, status: "declined", reason: "recipient_cancelled" };
  return { ...base, status: row.delivery_status === "held" ? "held" : row.delivery_status, reason: row.last_reason ?? undefined };
}
async function findOwnRequest(client: Pool | PoolClient, input: Identity, lock = false) {
  const result = await client.query<RequestRow>(`select * from alpha_exchange.marketing_email_requests
    where campaign_id=$1 and (user_id=$2 or email=$3)${lock ? " for update" : ""}`,
  [input.campaignId, input.userId, normalizeEmail(input.email)]);
  if (result.rows.some((row) => row.user_id !== input.userId || row.email !== normalizeEmail(input.email)) || result.rows.length > 1) {
    throw new MarketingEmailLedgerError("campaign_recipient_mismatch");
  }
  return result.rows[0];
}
async function appendEvent(client: PoolClient, input: { requestId: string; type: string; source: string; dedupeKey: string; reason?: string; providerEventId?: string; occurredAt?: string; observedAt?: string; observedOnly?: boolean }) {
  return client.query(`insert into alpha_exchange.marketing_email_events
    (id,request_id,event_type,source,dedupe_key,provider_event_id,occurred_at,reason,observed_at)
    values($1,$2,$3,$4,$5,$6,case when $9 then $7::timestamptz else coalesce($7::timestamptz,now()) end,$8,coalesce($10::timestamptz,now()))
    on conflict do nothing returning id`,
  [randomUUID(), input.requestId, input.type, input.source, input.dedupeKey, input.providerEventId ?? null, input.occurredAt ?? null, input.reason ?? null,input.observedOnly ?? false,input.observedAt ?? null]);
}
async function ensurePending(client: PoolClient, input: Identity, locale: "ar" | "en") {
  await client.query(`insert into alpha_exchange.marketing_email_requests
    (id,campaign_id,user_id,email,locale,idempotency_key,offer_expires_at)
    values($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
  [randomUUID(), input.campaignId, input.userId, normalizeEmail(input.email), locale,
    `alpha-marketing/${input.campaignId}/${digest(normalizeEmail(input.email)).slice(0,48)}`, input.offerExpiresAt]);
  const row = await findOwnRequest(client, input, true);
  if (!row) throw new MarketingEmailLedgerError("campaign_request_unavailable");
  return row;
}

export async function getMarketingEmailStatus(input: Identity): Promise<MarketingEmailPublicStatus> {
  validateIdentity(input);
  const pool = await poolForLedger();
  const denied = await accountStatus(pool, input);
  if (denied) return denied;
  const restrictions=await currentRestrictionCodes(pool,input);
  if (restrictions.length) return {status:"held",canRequest:false,holdCodes:restrictions,reason:restrictions[0]};
  return publicStatus(await findOwnRequest(pool, input), input.offerExpiresAt, await globallyWithdrawn(pool, input.email));
}

export async function requestMarketingEmail(input: Identity & {
  locale: "ar" | "en"; consentVersion: string; consentText: string;
  buildPayload: (context: { requestId: string; unsubscribeToken: string }) => FrozenMarketingPayload;
}): Promise<MarketingEmailPublicStatus> {
  validateIdentity(input);
  if (!input.consentVersion.trim() || input.consentVersion.length > 160 || !input.consentText.trim() || input.consentText.length > 4000) {
    throw new MarketingEmailLedgerError("invalid_consent_evidence");
  }
  return transaction(async (client) => {
    const denied = await accountStatus(client, input, true);
    if (denied) return denied;
    const restrictions=await currentRestrictionCodes(client,input);
    if (restrictions.length) return {status:"held",canRequest:false,holdCodes:restrictions,reason:restrictions[0]};
    if (isExpired(input.offerExpiresAt)) return { status: "expired", canRequest: false, holdCodes: [], reason: "offer_expired" };
    if (await globallyWithdrawn(client, input.email)) return { status: "unsubscribed", canRequest: false, holdCodes: [], reason: "recipient_unsubscribed" };
    const row = await ensurePending(client, input, input.locale);
    if (isExpired(row.offer_expires_at)) return {status:"expired",canRequest:false,holdCodes:[],reason:"offer_expired"};
    // Seeded holds, imported deliveries, and every previously accepted body are immutable here.
    if (row.hold_codes.length || row.accepted_at || terminal.has(row.delivery_status) || row.delivery_status !== "pending") {
      return publicStatus(row, input.offerExpiresAt);
    }
    const unsubscribeToken = randomBytes(32).toString("base64url");
    const body = input.buildPayload({ requestId: row.id, unsubscribeToken });
    if (!body || normalizeEmail(body.to) !== normalizeEmail(input.email) || !(body.from && body.subject && body.html && body.text) ||
      "cc" in body || "bcc" in body || Array.isArray(body.to)) throw new MarketingEmailLedgerError("invalid_frozen_email");
    const encoded = serializeMarketingEmailPayload(body);
    const consentHash = digest(`${input.campaignId}\n${input.consentVersion}\n${input.locale}\n${input.consentText}`);
    const updated = await client.query<RequestRow>(`update alpha_exchange.marketing_email_requests set
      consent_status='requested',consent_source='website_invitation',consent_version=$2,consent_text=$3,consent_hash=$4,
      accepted_at=now(),locale=$5,request_body=$6::jsonb,request_body_hash=$7,unsubscribe_token=$8,
      unsubscribe_token_hash=$9,delivery_status='queued',available_at=now(),updated_at=now()
      where id=$1 and accepted_at is null returning *`,
    [row.id, input.consentVersion, input.consentText, consentHash, input.locale, encoded, digest(encoded), unsubscribeToken, digest(unsubscribeToken)]);
    await appendEvent(client, { requestId: row.id, type: "consent_requested", source: "website", dedupeKey: `consent/${row.id}` });
    return publicStatus(updated.rows[0], input.offerExpiresAt);
  });
}

export async function declineMarketingEmail(input: Identity & { locale?: "ar" | "en" }): Promise<MarketingEmailPublicStatus> {
  validateIdentity(input);
  return transaction(async (client) => {
    const denied = await accountStatus(client, input, true);
    if (denied) return denied;
    const row = await ensurePending(client, input, input.locale ?? "en");
    if (row.consent_status === "withdrawn") return publicStatus(row, input.offerExpiresAt, true);
    const updated = await client.query<RequestRow>(`update alpha_exchange.marketing_email_requests
      set consent_status='declined',delivery_status=case when delivery_status='queued' then 'cancelled' else delivery_status end,
      updated_at=now() where id=$1 returning *`, [row.id]);
    await appendEvent(client, { requestId: row.id, type: "declined", source: "website", dedupeKey: `declined/${row.id}` });
    return publicStatus(updated.rows[0], input.offerExpiresAt);
  });
}

export type ClaimedMarketingEmail = {
  id: string; campaignId: string; userId: string; email: string; locale: "ar" | "en";
  requestBody: FrozenMarketingPayload; payloadHash: string; idempotencyKey: string; leaseToken: string;
  attempts: number; firstAttemptAt: string; retryUntil: string; offerExpiresAt: string;
};
export async function claimMarketingEmail(input: { campaignId?: string; requestId?: string } = {}): Promise<ClaimedMarketingEmail | null> {
  return transaction(async (client) => {
    // Unknown provider outcomes are never retried outside the shorter 23-hour safety window.
    await client.query(`update alpha_exchange.marketing_email_requests set
      delivery_status=case when first_attempt_at is null then 'expired' else 'uncertain' end,
      last_reason=case when first_attempt_at is null then 'offer_expired' else 'retry_window_expired' end,
      lease_token=null,lease_until=null,updated_at=now()
      where ($1::text is null or campaign_id=$1) and ($2::uuid is null or id=$2)
      and delivery_status in ('queued','sending') and (lease_until is null or lease_until<now())
      and (offer_expires_at<=now() or retry_until<=now())`, [input.campaignId ?? null, input.requestId ?? null]);
    const claimed = await client.query<RequestRow>(`with candidate as (
      select r.id from alpha_exchange.marketing_email_requests r join alpha_exchange.users u on u.id=r.user_id
      where ($1::text is null or r.campaign_id=$1) and ($2::uuid is null or r.id=$2)
        and r.consent_status='requested' and cardinality(r.hold_codes)=0
        and (r.delivery_status='queued' or (r.delivery_status='sending' and r.lease_until<now()))
        and r.available_at<=now() and r.offer_expires_at>now() and (r.retry_until is null or r.retry_until>now())
        and r.attempts<32 and r.request_body is not null
        and lower(btrim(u.email))=r.email and u.payload->>'emailVerified'='true'
        and coalesce(u.payload->>'disabled','false')<>'true'
        and ${CURRENT_RESTRICTION_SQL}
        and not exists(select 1 from alpha_exchange.marketing_email_requests w where w.email=r.email and w.consent_status='withdrawn')
      order by r.available_at,r.created_at limit 1 for update of r skip locked)
      update alpha_exchange.marketing_email_requests r set delivery_status='sending',attempts=r.attempts+1,
        first_attempt_at=coalesce(r.first_attempt_at,now()),retry_until=coalesce(r.retry_until,least(now()+interval '23 hours',r.offer_expires_at)),
        lease_token=$3,lease_until=now()+interval '90 seconds',updated_at=now()
      from candidate where r.id=candidate.id returning r.*`,
    [input.campaignId ?? null, input.requestId ?? null, randomUUID()]);
    const row = claimed.rows[0];
    if (!row) return null;
    await appendEvent(client, { requestId: row.id, type: "send_attempt", source: "worker", dedupeKey: `attempt/${row.id}/${row.attempts}` });
    return { id: row.id, campaignId: row.campaign_id, userId: row.user_id!, email: row.email, locale: row.locale,
      requestBody: row.request_body!, payloadHash: row.request_body_hash!, idempotencyKey: row.idempotency_key,
      leaseToken: row.lease_token!, attempts: row.attempts, firstAttemptAt: iso(row.first_attempt_at)!,
      retryUntil: iso(row.retry_until)!, offerExpiresAt: iso(row.offer_expires_at)! };
  });
}
export async function isMarketingEmailClaimEligible(input: { requestId: string; leaseToken: string }) {
  const result = await (await poolForLedger()).query<{ eligible: boolean }>(`select exists(
    select 1 from alpha_exchange.marketing_email_requests r join alpha_exchange.users u on u.id=r.user_id
    where r.id=$1 and r.lease_token=$2 and r.delivery_status='sending' and r.lease_until>now()
      and r.consent_status='requested' and cardinality(r.hold_codes)=0 and r.offer_expires_at>now() and r.retry_until>now()
      and lower(btrim(u.email))=r.email and u.payload->>'emailVerified'='true' and coalesce(u.payload->>'disabled','false')<>'true'
      and ${CURRENT_RESTRICTION_SQL}
      and not exists(select 1 from alpha_exchange.marketing_email_requests w where w.email=r.email and w.consent_status='withdrawn')
    ) as eligible`, [input.requestId, input.leaseToken]);
  return result.rows[0]?.eligible === true;
}
export async function completeMarketingEmailSend(input: { requestId: string; leaseToken: string; providerEmailId: string }) {
  if (!input.providerEmailId.trim()) throw new MarketingEmailLedgerError("provider_receipt_missing");
  return transaction(async (client) => {
    const result = await client.query(`update alpha_exchange.marketing_email_requests set
      delivery_status=case when delivered_at is not null then 'delivered' else 'sent' end,
      provider_email_id=$3,provider_outcome_unknown=false,sent_at=coalesce(sent_at,now()),lease_token=null,lease_until=null,last_reason='provider_accepted',updated_at=now()
      where id=$1 and lease_token=$2 and delivery_status='sending' returning id`, [input.requestId, input.leaseToken, input.providerEmailId]);
    if (result.rowCount !== 1) return false;
    await appendEvent(client, { requestId: input.requestId, type: "sent", source: "worker", dedupeKey: `sent/${input.providerEmailId}` });
    return true;
  });
}
export async function failMarketingEmailSend(input: {
  requestId: string; leaseToken: string; reason: string; retryable?: boolean; retryAfterMs?: number; ambiguous?: boolean; holdCodes?: string[];
}) {
  return transaction(async (client) => {
    const row = (await client.query<RequestRow>(`select * from alpha_exchange.marketing_email_requests
      where id=$1 and lease_token=$2 and delivery_status='sending' for update`, [input.requestId, input.leaseToken])).rows[0];
    if (!row) return false;
    const holdCodes = [...new Set([...(row.hold_codes ?? []), ...(input.holdCodes ?? [])])];
    const retryable = input.retryable && !isExpired(row.retry_until) && !isExpired(row.offer_expires_at) && row.attempts < 32;
    const outcomeUnknown = row.provider_outcome_unknown || input.ambiguous === true;
    const status: MarketingDeliveryStatus = holdCodes.length ? "held" : retryable ? "queued" : outcomeUnknown ? "uncertain" : "failed";
    await client.query(`update alpha_exchange.marketing_email_requests set delivery_status=$3,hold_codes=$4,
      last_reason=$5,available_at=now()+$6::double precision*interval '1 millisecond',provider_outcome_unknown=$7,
      lease_token=null,lease_until=null,updated_at=now()
      where id=$1 and lease_token=$2`,
    [input.requestId, input.leaseToken, status, holdCodes, input.reason.slice(0,500), Math.min(3_600_000,Math.max(1000,input.retryAfterMs ?? 30_000)),outcomeUnknown]);
    await appendEvent(client, { requestId: row.id, type: status === "queued" ? "retry_scheduled" : status, source: "worker", dedupeKey: `attempt-result/${row.id}/${row.attempts}`, reason: input.reason.slice(0,500) });
    return true;
  });
}

export async function getMarketingUnsubscribeStatus(token: string): Promise<{ valid: boolean; unsubscribed: boolean; campaignId?: string }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { valid: false, unsubscribed: false };
  const row = (await (await poolForLedger()).query<{ email: string; campaign_id: string }>(
    `select email,campaign_id from alpha_exchange.marketing_email_requests where unsubscribe_token_hash=$1`, [digest(token)])).rows[0];
  return row ? { valid: true, unsubscribed: await globallyWithdrawn(await poolForLedger(), row.email), campaignId: row.campaign_id } : { valid: false, unsubscribed: false };
}
export async function unsubscribeMarketingEmail(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return transaction(async (client) => {
    const row = (await client.query<RequestRow>(`select * from alpha_exchange.marketing_email_requests
      where unsubscribe_token_hash=$1 for update`, [digest(token)])).rows[0];
    if (!row) return false;
    await client.query(`update alpha_exchange.marketing_email_requests set consent_status='withdrawn',
      delivery_status=case when delivery_status='queued' then 'cancelled' else delivery_status end,
      hold_codes=case when 'recipient_unsubscribed'=any(hold_codes) then hold_codes else array_append(hold_codes,'recipient_unsubscribed') end,
      updated_at=now() where id=$1`, [row.id]);
    await appendEvent(client, { requestId: row.id, type: "unsubscribed", source: "recipient", dedupeKey: `unsubscribe/${row.id}` });
    return true;
  });
}

export type MarketingProviderEventType = "sent" | "delivered" | "bounced" | "suppressed" | "complained" | "opened" | "clicked" | "replied";
export async function recordMarketingProviderEvent(input: { providerEventId: string; providerEmailId: string; type: MarketingProviderEventType; occurredAt?: string; observedAt?: string; source?: "webhook" | "poll"; reason?: string }) {
  if (!["sent","delivered","bounced","suppressed","complained","opened","clicked","replied"].includes(input.type) || !input.providerEventId || !input.providerEmailId ||
    (input.occurredAt && !Number.isFinite(new Date(input.occurredAt).getTime())) ||
    (input.observedAt && !Number.isFinite(new Date(input.observedAt).getTime())) ||
    (!input.occurredAt && input.source!=="poll")) throw new MarketingEmailLedgerError("invalid_provider_event");
  return transaction(async (client) => {
    const row = (await client.query<RequestRow>(`select * from alpha_exchange.marketing_email_requests where provider_email_id=$1 for update`, [input.providerEmailId])).rows[0];
    if (!row) return false;
    const event = await appendEvent(client, { requestId: row.id, type: input.type, source: input.source ?? "webhook", dedupeKey: `provider/${input.providerEventId}`, providerEventId: input.providerEventId, occurredAt: input.occurredAt, observedAt:input.observedAt,observedOnly:input.source==="poll",reason: input.reason?.slice(0,500) });
    if (event.rowCount !== 1) return false;
    const field = { sent:"sent_at",delivered:"delivered_at",bounced:"bounced_at",suppressed:"suppressed_at",complained:"complained_at",opened:"opened_at",clicked:"clicked_at",replied:"replied_at" }[input.type];
    const holding = ["bounced","suppressed","complained"].includes(input.type);
    await client.query(`update alpha_exchange.marketing_email_requests set ${field}=coalesce(${field},$2::timestamptz),
      delivery_status=case when $3 then 'held' when $4='delivered' and delivery_status not in ('held','failed') then 'delivered' else delivery_status end,
      hold_codes=case when $3 and not ($4=any(hold_codes)) then array_append(hold_codes,$4) else hold_codes end,
      last_reconciled_at=now(),updated_at=now() where id=$1`, [row.id, input.occurredAt ?? null, holding, input.type]);
    return true;
  });
}
export async function getPendingMarketingEmailReconciliations(input: { campaignId: string; limit?: number }) {
  const rows = (await (await poolForLedger()).query<{ id: string; provider_email_id: string }>(`select id,provider_email_id from alpha_exchange.marketing_email_requests
    where campaign_id=$1 and provider_email_id is not null and delivery_status in ('sent','delivered')
      and (last_reconciled_at is null or last_reconciled_at<now()-interval '5 minutes')
    order by last_reconciled_at nulls first,created_at limit $2`, [input.campaignId, Math.min(100,Math.max(1,input.limit ?? 25))])).rows;
  return rows.map((row) => ({ id: row.id, providerEmailId: row.provider_email_id }));
}
export async function markMarketingEmailReconciled(input: { requestId: string; providerEmailId: string }) {
  await (await poolForLedger()).query(`update alpha_exchange.marketing_email_requests set last_reconciled_at=now()
    where id=$1 and provider_email_id=$2`, [input.requestId, input.providerEmailId]);
}

export type MarketingEmailAuditRecipient = {
  id: string; userId: string | null; email: string; locale: string; status: MarketingDeliveryStatus;
  consentStatus: MarketingConsentStatus; consentVersion: string | null; requestedAt: string | null;
  sentAt: string | null; deliveredAt: string | null; holdCodes: string[];
  providerEmailId: string | null; providerCampaignId: string | null; firstAttemptAt: string | null;
  lastReason: string | null; updatedAt: string;
  events: Array<{ type: string; occurredAt: string | null; observedAt: string; source: string; reason: string | null }>;
};
export type MarketingEmailAudit = { campaignId: string; checkedAt: string; counts: Record<string, number>; shown: number; truncated: boolean; recipients: MarketingEmailAuditRecipient[] };
/** Caller must enforce canonical owner authorization. Never expose token/body fields. */
export async function getMarketingEmailAudit(campaignId: string): Promise<MarketingEmailAudit> {
  return transaction(async (pool) => {
  const [summary, records] = await Promise.all([
    pool.query<{ delivery_status: string; count: number; consented: number }>(`select delivery_status,count(*)::int as count,
      count(*) filter(where consent_status in ('requested','legacy_newsletter'))::int as consented
      from alpha_exchange.marketing_email_requests where campaign_id=$1 group by delivery_status`, [campaignId]),
    pool.query<RequestRow & { events: Array<{ type: string; occurredAt: string | null; observedAt: string; source: string; reason: string | null }> }>(`select r.*,
      coalesce((select jsonb_agg(x.event order by x.observed_at) from (select e.observed_at,
        jsonb_build_object('type',e.event_type,'occurredAt',e.occurred_at,'observedAt',e.observed_at,'source',e.source,'reason',e.reason) as event
        from alpha_exchange.marketing_email_events e where e.request_id=r.id order by e.observed_at desc limit 50) x),'[]'::jsonb) as events
      from alpha_exchange.marketing_email_requests r where campaign_id=$1 order by r.updated_at desc,r.id limit 1000`, [campaignId]),
  ]);
  const counts: Record<string,number> = { total: 0, consented: 0 };
  for (const row of summary.rows) { counts[row.delivery_status] = row.count; counts.total += row.count; counts.consented += row.consented; }
  return { campaignId, checkedAt: new Date().toISOString(), counts, shown: records.rows.length, truncated: counts.total > records.rows.length,
    recipients: records.rows.map((row) => ({ id: row.id,userId: row.user_id,email: row.email,locale: row.locale,status: row.delivery_status,
      consentStatus: row.consent_status,consentVersion: row.consent_version,requestedAt: iso(row.accepted_at) ?? null,
      sentAt: iso(row.sent_at) ?? null,deliveredAt: iso(row.delivered_at) ?? null,holdCodes: row.hold_codes,
      providerEmailId: row.provider_email_id,providerCampaignId: row.provider_campaign_id,firstAttemptAt: iso(row.first_attempt_at) ?? null,
      lastReason: row.last_reason,updatedAt: iso(row.updated_at)!,events: row.events })) };
  }, true);
}
