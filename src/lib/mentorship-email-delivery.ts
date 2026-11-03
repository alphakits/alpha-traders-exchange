import "server-only";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import {
  claimMarketingEmail,
  completeMarketingEmailSend,
  failMarketingEmailSend,
  getPendingMarketingEmailReconciliations,
  isMarketingEmailClaimEligible,
  markMarketingEmailReconciled,
  recordMarketingProviderEvent,
  serializeMarketingEmailPayload,
  type ClaimedMarketingEmail,
  type MarketingProviderEventType,
} from "@/lib/marketing-email-ledger";
import { MENTORSHIP_EMAIL_CAMPAIGN_ID, isMentorshipEmailRequestEnabled } from "@/lib/mentorship-email-config";

type ApiResult = { status: number; data: Record<string, unknown> | null };
type Preflight = { allowed: true } | { allowed: false; reason: string; held: boolean; configurationError?: boolean };
type Dependencies = { fetcher?: typeof fetch; intervalMs?: number; limit?: number };

/** Read/write only the fixed Resend API. Never log responses, recipients or keys. */
function providerClient(key: string, options: Dependencies) {
  const fetcher = options.fetcher ?? fetch;
  let previousRequestAt = 0;
  return async (path: string, init?: RequestInit): Promise<ApiResult> => {
    const wait = (options.intervalMs ?? 650) - (Date.now() - previousRequestAt);
    if (wait > 0) await pause(wait);
    previousRequestAt = Date.now();
    const response = await fetcher(`https://api.resend.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
      redirect: "error",
    });
    const data: unknown = await response.json().catch(() => null);
    return { status: response.status, data: data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null };
  };
}

async function recipientPreflight(api: ReturnType<typeof providerClient>, email: string): Promise<Preflight> {
  const suppression = await api(`/suppressions/${encodeURIComponent(email)}`);
  if (suppression.status === 200) return { allowed: false, reason: "provider_suppression", held: true };
  if (suppression.status !== 404) return { allowed: false, reason: "suppression_check_unavailable", held: false, configurationError: [401, 403].includes(suppression.status) };

  const contact = await api(`/contacts/${encodeURIComponent(email)}`);
  if (contact.status === 404) return { allowed: true };
  if (contact.status !== 200 || typeof contact.data?.unsubscribed !== "boolean") {
    return { allowed: false, reason: "subscription_check_unavailable", held: false, configurationError: [401, 403].includes(contact.status) };
  }
  if (contact.data.unsubscribed) return { allowed: false, reason: "provider_unsubscribed", held: true };
  return { allowed: true };
}

async function dispatchClaim(claim: ClaimedMarketingEmail, api: ReturnType<typeof providerClient>) {
  const identity = { requestId: claim.id, leaseToken: claim.leaseToken };
  const serialized = serializeMarketingEmailPayload(claim.requestBody);
  if (createHash("sha256").update(serialized).digest("hex") !== claim.payloadHash
    || claim.requestBody.to !== claim.email || "cc" in claim.requestBody || "bcc" in claim.requestBody) {
    await failMarketingEmailSend({ ...identity, reason: "frozen_payload_invalid", holdCodes: ["payload_integrity"] });
    return { state: "held" as const };
  }

  let preflight: Preflight;
  try { preflight = await recipientPreflight(api, claim.email); }
  catch {
    await failMarketingEmailSend({ ...identity, reason: "provider_preflight_unavailable", retryable: true, retryAfterMs: 5 * 60_000 });
    return { state: "retrying" as const };
  }
  if (!preflight.allowed) {
    await failMarketingEmailSend({
      ...identity, reason: preflight.reason, retryable: !preflight.held, retryAfterMs: 5 * 60_000,
      ...(preflight.held ? { holdCodes: [preflight.reason] } : {}),
    });
    return { state: preflight.held ? "held" as const : "retrying" as const, configurationError: preflight.configurationError };
  }
  // Recheck after network preflight, immediately before any send. The account
  // email, verification, withdrawal, holds, and offer can change while queued.
  if (!(await isMarketingEmailClaimEligible(identity))) {
    await failMarketingEmailSend({ ...identity, reason: "recipient_no_longer_eligible", holdCodes: ["recipient_no_longer_eligible"] });
    return { state: "held" as const };
  }

  let result: ApiResult;
  try {
    result = await api("/emails", { method: "POST", headers: { "Idempotency-Key": claim.idempotencyKey }, body: serialized });
  } catch {
    // A timeout is not evidence of failure. Reuse the exact body and key only
    // within the ledger's 23-hour window; never start a new delivery attempt.
    await failMarketingEmailSend({ ...identity, reason: "provider_result_unknown", retryable: true, retryAfterMs: 5 * 60_000, ambiguous: true });
    return { state: "retrying" as const };
  }
  if (result.status >= 200 && result.status < 300 && typeof result.data?.id === "string" && result.data.id) {
    // Keep provider acceptance separate from confirmed delivery.
    await completeMarketingEmailSend({ ...identity, providerEmailId: result.data.id });
    return { state: "sent" as const };
  }
  const ambiguous = result.status >= 500 || result.status === 408 || (result.status >= 200 && result.status < 300);
  const retryable = ambiguous || result.status === 429;
  await failMarketingEmailSend({
    ...identity, reason: `provider_http_${result.status}`, retryable, ambiguous, retryAfterMs: 5 * 60_000,
    ...(!retryable ? { holdCodes: ["provider_rejected"] } : {}),
  });
  return { state: retryable ? "retrying" as const : "held" as const, configurationError: [401, 403].includes(result.status) };
}

/** A bounded production-only sweep; no registration list can enter this queue. */
export async function deliverMentorshipEmailQueue(options: Dependencies = {}) {
  const summary = { attempted: 0, sent: 0, held: 0, retrying: 0, reconciled: 0, configurationError: false, disabled: false };
  if (process.env.VERCEL_ENV !== "production" || !isMentorshipEmailRequestEnabled()) return { ...summary, disabled: true };
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ...summary, configurationError: true };
  const deadline = Date.now() + 50_000;
  const api = providerClient(key, options);
  const limit = Math.min(6, Math.max(1, options.limit ?? 4));
  for (let index = 0; index < limit && Date.now() < deadline; index++) {
    const claim = await claimMarketingEmail({ campaignId: MENTORSHIP_EMAIL_CAMPAIGN_ID });
    if (!claim) break;
    summary.attempted++;
    const result = await dispatchClaim(claim, api);
    summary[result.state]++;
    if (result.configurationError) { summary.configurationError = true; break; }
  }
  // Polling observes the provider's state; it does not invent an event time or
  // require tracking pixels. No HTML or message content is retained here.
  if (!summary.configurationError && Date.now() < deadline) {
    const pending = await getPendingMarketingEmailReconciliations({ campaignId: MENTORSHIP_EMAIL_CAMPAIGN_ID, limit: 8 });
    const events = new Set<MarketingProviderEventType>(["delivered", "bounced", "suppressed", "complained", "opened", "clicked", "replied"]);
    for (const record of pending) {
      if (Date.now() >= deadline) break;
      let result: ApiResult;
      try { result = await api(`/emails/${encodeURIComponent(record.providerEmailId)}`); }
      catch { break; }
      if (result.status !== 200 || result.data?.id !== record.providerEmailId) {
        if ([401, 403].includes(result.status)) summary.configurationError = true;
        break;
      }
      const type = result.data.last_event;
      if (typeof type === "string" && events.has(type as MarketingProviderEventType)) {
        await recordMarketingProviderEvent({
          providerEventId: `poll/${record.providerEmailId}/${type}`,
          providerEmailId: record.providerEmailId,
          type: type as MarketingProviderEventType,
          source: "poll",
          reason: "Provider state observed; exact event time unavailable.",
        });
      }
      await markMarketingEmailReconciled({ requestId: record.id, providerEmailId: record.providerEmailId });
      summary.reconciled++;
    }
  }
  return summary;
}
