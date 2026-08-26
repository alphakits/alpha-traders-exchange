import { getSiteUrl } from "@/lib/site-url";

export type AdminAnnouncementEmailContent = {
  subject: string;
  title: string;
  content: string;
  ctaText: string;
  ctaUrl: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function isValidAnnouncementCtaUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function validateAdminAnnouncementContent(input: AdminAnnouncementEmailContent) {
  const normalized = {
    subject: input.subject.trim(),
    title: input.title.trim(),
    content: input.content.trim(),
    ctaText: input.ctaText.trim(),
    ctaUrl: input.ctaUrl.trim(),
  };
  if (normalized.subject.length < 5 || normalized.subject.length > 180) {
    throw new Error("Subject must be between 5 and 180 characters.");
  }
  if (normalized.title.length < 3 || normalized.title.length > 160) {
    throw new Error("Title must be between 3 and 160 characters.");
  }
  if (normalized.content.length < 10 || normalized.content.length > 8_000) {
    throw new Error("Content must be between 10 and 8,000 characters.");
  }
  if (normalized.ctaText.length < 2 || normalized.ctaText.length > 80) {
    throw new Error("CTA button text must be between 2 and 80 characters.");
  }
  if (normalized.ctaUrl.length > 2_048 || !isValidAnnouncementCtaUrl(normalized.ctaUrl)) {
    throw new Error("CTA button URL must be a valid HTTPS URL.");
  }
  return normalized;
}

export function isRetryableAnnouncementDeliveryFailure(input: {
  reason: string;
  providerStatus?: number;
}) {
  return input.reason === "resend_not_configured"
    || input.reason === "resend_network_failed"
    || input.reason === "resend_timeout"
    || input.providerStatus === 429
    || (typeof input.providerStatus === "number" && input.providerStatus >= 500);
}

export function parseRetryAfterMs(value: string | null, now = Date.now()) {
  if (!value?.trim()) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : 0;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const RESEND_MAX_ATTEMPTS = 2;
const RESEND_RETRY_BASE_MS = 750;
const RESEND_REQUEST_TIMEOUT_MS = 5_000;
const RESEND_MAX_INLINE_RETRY_DELAY_MS = 2_000;

function renderInlineFormatting(value: string) {
  const links: string[] = [];
  const withLinkTokens = value.replace(/\[([^\]\n]{1,120})\]\((https:\/\/[^)\s]+)\)/g, (_match, label: string, url: string) => {
    if (!isValidAnnouncementCtaUrl(url)) return label;
    const index = links.push(
      `<a href="${escapeHtml(url)}" style="color:#d6b84c;text-decoration:underline;">${escapeHtml(label)}</a>`,
    ) - 1;
    return `ANNOUNCEMENTLINK${index}TOKEN`;
  });

  return escapeHtml(withLinkTokens)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong style=\"color:#ffffff;\">$1</strong>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/ANNOUNCEMENTLINK(\d+)TOKEN/g, (_match, index: string) => links[Number(index)] ?? "");
}

export function renderAnnouncementRichText(content: string) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p style="margin:0 0 18px;color:#d1d5db;font-size:16px;line-height:1.75;">${paragraph.map(renderInlineFormatting).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(`<ul style="margin:0 0 20px;padding-left:22px;color:#d1d5db;font-size:16px;line-height:1.75;">${bullets.map((item) => `<li style="margin:0 0 6px;">${renderInlineFormatting(item)}</li>`).join("")}</ul>`);
    bullets = [];
  };

  for (const line of lines) {
    const bullet = line.match(/^\s*(?:[-*]|•)\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      bullets.push(bullet[1]);
      continue;
    }
    flushBullets();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushBullets();
  return blocks.join("");
}

function toPlainText(content: string) {
  return content
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

export function buildAdminAnnouncementEmail(input: AdminAnnouncementEmailContent) {
  const siteUrl = getSiteUrl();
  const logoUrl = escapeHtml(new URL("/images/brand/alpha-traders-logo.png", siteUrl).toString());
  const title = escapeHtml(input.title);
  const ctaText = escapeHtml(input.ctaText);
  const ctaUrl = escapeHtml(input.ctaUrl);
  const body = renderAnnouncementRichText(input.content);

  return {
    subject: input.subject,
    text: [
      input.title,
      "",
      toPlainText(input.content),
      "",
      `${input.ctaText}: ${input.ctaUrl}`,
      "",
      `Alpha Exchange: ${siteUrl}`,
      "Support: support@alphatraders.co.il",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#050505;color:#f9fafb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#101010;border:1px solid #332b12;border-radius:20px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:28px 24px;background:#171308;border-bottom:1px solid #453914;">
                <img src="${logoUrl}" width="96" height="96" alt="Alpha Traders Academy &amp; Exchange" style="display:block;width:96px;height:96px;margin:0 auto;border-radius:20px;object-fit:cover;" />
                <div style="margin-top:12px;font-size:12px;letter-spacing:2.4px;color:#d6b84c;text-transform:uppercase;">Alpha Exchange</div>
                <h1 style="margin:12px auto 0;max-width:520px;color:#ffffff;font-size:28px;line-height:1.3;">${title}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 26px;">
                ${body}
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 8px;">
                  <tr>
                    <td style="border-radius:10px;background:#c9a227;">
                      <a href="${ctaUrl}" style="display:inline-block;padding:14px 22px;color:#090909;text-decoration:none;font-size:16px;font-weight:800;">${ctaText}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 26px;border-top:1px solid #2b2b2b;background:#0a0a0a;color:#8f8f8f;font-size:12px;line-height:1.7;">
                <a href="${escapeHtml(siteUrl)}" style="color:#d6b84c;text-decoration:none;">Alpha Exchange</a>
                &nbsp;•&nbsp;
                <a href="mailto:support@alphatraders.co.il" style="color:#d6b84c;text-decoration:none;">support@alphatraders.co.il</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

export async function sendAdminAnnouncementBatch(input: AdminAnnouncementEmailContent & {
  recipients: Array<{ userId: string; email: string }>;
  idempotencyKey: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  if (!apiKey || !from) {
    return { ok: false as const, reason: "resend_not_configured" as const };
  }
  if (input.recipients.length === 0 || input.recipients.length > 100) {
    throw new Error("Announcement batches must contain between 1 and 100 recipients.");
  }

  const email = buildAdminAnnouncementEmail(input);
  let lastRetryAfterMs = 0;
  for (let attempt = 1; attempt <= RESEND_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RESEND_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify(input.recipients.map((recipient) => ({
          from,
          to: [recipient.email],
          subject: email.subject,
          html: email.html,
          text: email.text,
          tags: [
            { name: "campaign", value: input.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 256) },
          ],
        }))),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        let responseBody: { data?: Array<{ id?: unknown }> };
        try {
          responseBody = await response.json() as { data?: Array<{ id?: unknown }> };
        } catch {
          return {
            ok: false as const,
            reason: "resend_invalid_batch_response" as const,
            attempts: attempt,
            retryCount: attempt - 1,
            retryAfterMs: lastRetryAfterMs,
            lastAttemptAt: new Date().toISOString(),
          };
        }
        if (
          !Array.isArray(responseBody.data)
          || responseBody.data.length !== input.recipients.length
          || responseBody.data.some((delivery) => typeof delivery.id !== "string" || !delivery.id)
        ) {
          return {
            ok: false as const,
            reason: "resend_invalid_batch_response" as const,
            attempts: attempt,
            retryCount: attempt - 1,
            retryAfterMs: lastRetryAfterMs,
            lastAttemptAt: new Date().toISOString(),
          };
        }
        return {
          ok: true as const,
          deliveries: input.recipients.map((recipient, index) => ({
            userId: recipient.userId,
            providerEmailId: typeof responseBody.data?.[index]?.id === "string"
              ? responseBody.data[index].id
              : undefined,
          })),
          attempts: attempt,
          retryCount: attempt - 1,
          ...(lastRetryAfterMs > 0 ? { retryAfterMs: lastRetryAfterMs } : {}),
          lastAttemptAt: new Date().toISOString(),
        };
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === RESEND_MAX_ATTEMPTS) {
        return {
          ok: false as const,
          reason: "resend_request_failed" as const,
          providerStatus: response.status,
          attempts: attempt,
          retryCount: attempt - 1,
          retryAfterMs,
          lastAttemptAt: new Date().toISOString(),
        };
      }

      lastRetryAfterMs = retryAfterMs;
      const exponentialBackoffMs = RESEND_RETRY_BASE_MS * (2 ** (attempt - 1));
      if (Math.max(exponentialBackoffMs, lastRetryAfterMs) > RESEND_MAX_INLINE_RETRY_DELAY_MS) {
        return {
          ok: false as const,
          reason: "resend_request_failed" as const,
          providerStatus: response.status,
          attempts: attempt,
          retryCount: attempt - 1,
          retryAfterMs,
          lastAttemptAt: new Date().toISOString(),
        };
      }

    } catch (error) {
      clearTimeout(timeout);
      const timedOut = error instanceof Error && error.name === "AbortError";
      if (attempt === RESEND_MAX_ATTEMPTS) {
        return {
          ok: false as const,
          reason: timedOut ? "resend_timeout" as const : "resend_network_failed" as const,
          attempts: attempt,
          retryCount: attempt - 1,
          retryAfterMs: lastRetryAfterMs,
          lastAttemptAt: new Date().toISOString(),
        };
      }
    }

    const exponentialBackoffMs = RESEND_RETRY_BASE_MS * (2 ** (attempt - 1));
    await delay(Math.max(exponentialBackoffMs, lastRetryAfterMs));
  }

  return {
    ok: false as const,
    reason: "resend_network_failed" as const,
    attempts: RESEND_MAX_ATTEMPTS,
    retryCount: RESEND_MAX_ATTEMPTS - 1,
    retryAfterMs: lastRetryAfterMs,
    lastAttemptAt: new Date().toISOString(),
  };
}

export async function sendAdminAnnouncementEmail(input: AdminAnnouncementEmailContent & {
  to: string;
  idempotencyKey: string;
}) {
  const result = await sendAdminAnnouncementBatch({
    ...input,
    recipients: [{ userId: "test-recipient", email: input.to }],
  });
  if (!result.ok) return result;
  return {
    ok: true as const,
    attempts: result.attempts,
    retryCount: result.retryCount,
    retryAfterMs: result.retryAfterMs,
    lastAttemptAt: result.lastAttemptAt,
    providerEmailId: result.deliveries[0]?.providerEmailId,
  };
}
