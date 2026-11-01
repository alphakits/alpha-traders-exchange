const STAGING_SUBJECT_PREFIX = "[STAGING] ";
const ADDRESS = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i;

type PreviewEmailFailure = {
  ok: false;
  reason: "email_preview_not_configured" | "email_preview_recipient_blocked" | "email_preview_payload_blocked";
  retryable: boolean;
};

/** Shared with configuration-only release checks; never returns environment values in diagnostics. */
export function parseStagingEmailAllowlist(raw: string | undefined): string[] | null {
  const addresses = (raw ?? "").split(",").map(value => value.trim().toLowerCase());
  return addresses.length && addresses.every(address => ADDRESS.test(address)) ? addresses : null;
}

export function previewEmailSubject(subject: string) {
  return process.env.VERCEL_ENV === "preview" && !subject.startsWith(STAGING_SUBJECT_PREFIX)
    ? STAGING_SUBJECT_PREFIX + subject : subject;
}

/** Preview sends require exact mailbox consent. Never redirect account emails. */
export function previewEmailRecipientFailure(recipients: readonly string[]): PreviewEmailFailure | null {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const addresses = parseStagingEmailAllowlist(process.env.ALPHA_EMAIL_STAGING_ALLOWLIST);
  if (!addresses) {
    return { ok: false, reason: "email_preview_not_configured", retryable: true };
  }
  if (!recipients.length || recipients.some(recipient => !ADDRESS.test(recipient) || !addresses.includes(recipient.toLowerCase()))) {
    return { ok: false, reason: "email_preview_recipient_blocked", retryable: false };
  }
  return null;
}

/** Check the frozen provider payload too, including jobs enqueued by older builds. */
export function previewPreparedEmailFailure(email: { recipientEmail: string; body: string }): PreviewEmailFailure | null {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const recipientFailure = previewEmailRecipientFailure([email.recipientEmail]);
  if (recipientFailure) return recipientFailure;
  try {
    const body: unknown = JSON.parse(email.body);
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      const payload = body as Record<string, unknown>;
      if (Array.isArray(payload.to) && payload.to.length === 1
        && typeof payload.to[0] === "string" && payload.to[0].toLowerCase() === email.recipientEmail.toLowerCase()
        && !Object.hasOwn(payload, "cc") && !Object.hasOwn(payload, "bcc")
        && typeof payload.subject === "string" && payload.subject.startsWith(STAGING_SUBJECT_PREFIX)) return null;
    }
  } catch { /* Malformed stored payloads must never reach the provider. */ }
  return { ok: false, reason: "email_preview_payload_blocked", retryable: false };
}
