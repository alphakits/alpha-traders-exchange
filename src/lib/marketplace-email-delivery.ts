import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { redactPrivateContactDetails } from "@/lib/privacy-redaction";
import { getSiteUrl } from "@/lib/site-url";
import { BRAND_NAME, BRAND_NAME_HTML, getBrandedEmailFrom } from "@/lib/brand";

export type MarketplaceEmailEvent =
  | "new_buy_request"
  | "trade_accepted"
  | "trade_rejected"
  | "buyer_payment_sent"
  | "seller_funds_received"
  | "seller_usdt_release_started"
  | "seller_usdt_released"
  | "trade_completed"
  | "trade_cancelled"
  | "trade_room_message"
  | "trade_room_poke"
  | "listing_approved"
  | "listing_rejected"
  | "listing_submitted"
  | "listing_expired"
  | "listing_renewed"
  | "new_listing_published"
  | "owner_listing_review_required"
  | "owner_seller_application_review_required"
  | "seller_prestige_promoted"
  | "marketplace_enforcement_fee_issued"
  | "marketplace_enforcement_fee_paid"
  | "marketplace_enforcement_seller_revoked";

export type MarketplaceEmailLocale = "ar" | "en";

export type MarketplaceEmailLocalizedText = Record<MarketplaceEmailLocale, string>;

export type MarketplaceEmailPayload = {
  event: MarketplaceEmailEvent;
  recipientName: string;
  title: MarketplaceEmailLocalizedText;
  message: MarketplaceEmailLocalizedText;
  actionLabel: MarketplaceEmailLocalizedText;
  /**
   * A language-neutral, internal path. The renderer prefixes it with the
   * recipient's interface locale so an Arabic email never points to English.
   */
  actionPath: string;
  /** Optional for renderer previews; required by sendMarketplaceEmail. */
  recipientLocale?: MarketplaceEmailLocale;
  referenceLabel?: string;
};

export type MarketplaceEmailAttempt = {
  event: MarketplaceEmailEvent;
  to: string;
  referenceLabel?: string;
  createdAt: string;
};

const marketplaceEmailAttempts: MarketplaceEmailAttempt[] = [];
const MARKETPLACE_EMAIL_ATTEMPTS_FILE = join(process.cwd(), "tmp", "marketplace-email-attempts.jsonl");

function isNonProductionRuntime() {
  return process.env.NODE_ENV !== "production";
}

function appendMarketplaceEmailAttemptToDisk(attempt: MarketplaceEmailAttempt) {
  if (!isNonProductionRuntime()) return;
  try {
    mkdirSync(dirname(MARKETPLACE_EMAIL_ATTEMPTS_FILE), { recursive: true });
    appendFileSync(MARKETPLACE_EMAIL_ATTEMPTS_FILE, `${JSON.stringify(attempt)}\n`, "utf8");
  } catch {
    // Test harness persistence must never break notification delivery flow.
  }
}

function readMarketplaceEmailAttemptsFromDisk() {
  if (!isNonProductionRuntime()) {
    return [...marketplaceEmailAttempts];
  }
  try {
    const content = readFileSync(MARKETPLACE_EMAIL_ATTEMPTS_FILE, "utf8");
    if (!content.trim()) return [] as MarketplaceEmailAttempt[];
    const attempts: MarketplaceEmailAttempt[] = [];
    for (const line of content.split(/\r?\n/)) {
      const nextLine = line.trim();
      if (!nextLine) continue;
      const parsed = JSON.parse(nextLine) as MarketplaceEmailAttempt;
      if (!parsed || typeof parsed !== "object") continue;
      if (typeof parsed.event !== "string" || typeof parsed.to !== "string" || typeof parsed.createdAt !== "string") continue;
      if (parsed.referenceLabel != null && typeof parsed.referenceLabel !== "string") continue;
      attempts.push(parsed);
    }
    return attempts;
  } catch {
    return [] as MarketplaceEmailAttempt[];
  }
}

function clearMarketplaceEmailAttemptsFromDisk() {
  if (!isNonProductionRuntime()) return;
  try {
    mkdirSync(dirname(MARKETPLACE_EMAIL_ATTEMPTS_FILE), { recursive: true });
    writeFileSync(MARKETPLACE_EMAIL_ATTEMPTS_FILE, "", "utf8");
  } catch {
    // Best effort clear for test-only observability.
  }
}

export function recordMarketplaceEmailAttempt(input: {
  event: MarketplaceEmailEvent;
  to: string;
  referenceLabel?: string;
}) {
  const attempt: MarketplaceEmailAttempt = {
    event: input.event,
    to: input.to,
    referenceLabel: input.referenceLabel,
    createdAt: new Date().toISOString(),
  };
  marketplaceEmailAttempts.push(attempt);
  appendMarketplaceEmailAttemptToDisk(attempt);
}

export function listMarketplaceEmailAttempts() {
  return readMarketplaceEmailAttemptsFromDisk();
}

export function clearMarketplaceEmailAttempts() {
  marketplaceEmailAttempts.length = 0;
  clearMarketplaceEmailAttemptsFromDisk();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function localizedActionUrl(locale: MarketplaceEmailLocale, actionPath: string) {
  const normalizedPath = actionPath.startsWith("/") ? actionPath : `/${actionPath}`;
  return new URL(`/${locale}${normalizedPath}`, getSiteUrl()).toString();
}

export function buildMarketplaceEmail(input: MarketplaceEmailPayload) {
  const logoUrl = escapeHtml(new URL("/images/brand/alpha-traders-logo.png", getSiteUrl()).toString());
  const safeRecipientName = redactPrivateContactDetails(input.recipientName.trim());
  const recipientName = {
    ar: escapeHtml(safeRecipientName || "المتداول"),
    en: escapeHtml(safeRecipientName || "Trader"),
  };
  const safeTitle = {
    ar: redactPrivateContactDetails(input.title.ar),
    en: redactPrivateContactDetails(input.title.en),
  };
  const title = { ar: escapeHtml(safeTitle.ar), en: escapeHtml(safeTitle.en) };
  const safeMessage = {
    ar: redactPrivateContactDetails(input.message.ar),
    en: redactPrivateContactDetails(input.message.en),
  };
  const message = { ar: escapeHtml(safeMessage.ar), en: escapeHtml(safeMessage.en) };
  const actionLabel = {
    ar: escapeHtml(input.actionLabel.ar),
    en: escapeHtml(input.actionLabel.en),
  };
  const safeActionPath = redactPrivateContactDetails(input.actionPath);
  const safeActionUrl = {
    ar: redactPrivateContactDetails(localizedActionUrl("ar", safeActionPath)),
    en: redactPrivateContactDetails(localizedActionUrl("en", safeActionPath)),
  };
  const actionUrl = {
    ar: escapeHtml(safeActionUrl.ar),
    en: escapeHtml(safeActionUrl.en),
  };
  const safeReferenceLabel = input.referenceLabel ? redactPrivateContactDetails(input.referenceLabel) : "";
  const referenceLabel = safeReferenceLabel ? escapeHtml(safeReferenceLabel) : "";
  const includedLocales: MarketplaceEmailLocale[] = input.recipientLocale
    ? [input.recipientLocale]
    : ["ar", "en"];
  const subject = `${includedLocales.map((locale) => safeTitle[locale]).join(" | ")} | ${BRAND_NAME}`;

  const textSections: Record<MarketplaceEmailLocale, string[]> = {
    ar: [
      `مرحبًا ${safeRecipientName || "المتداول"}،`,
      "",
      safeTitle.ar,
      safeMessage.ar,
      safeReferenceLabel ? `المرجع: ${safeReferenceLabel}` : "",
      "",
      `${input.actionLabel.ar}: ${safeActionUrl.ar}`,
      "",
      "هذه رسالة مرتبطة بحسابك وتكمّل الإشعار الموجود في حسابك على Alpha Exchange.",
    ],
    en: [
      `Hello ${safeRecipientName || "Trader"},`,
      "",
      safeTitle.en,
      safeMessage.en,
      safeReferenceLabel ? `Reference: ${safeReferenceLabel}` : "",
      "",
      `${input.actionLabel.en}: ${safeActionUrl.en}`,
      "",
      "This transactional email complements the notification in your Alpha Exchange account.",
    ],
  };

  const htmlSections: Record<MarketplaceEmailLocale, string> = {
    ar: `<div lang="ar" dir="rtl" style="text-align:right;">
                  <p style="margin:0 0 16px;color:#e5e7eb;line-height:1.8;">مرحبًا <span dir="auto">${recipientName.ar}</span>،</p>
                  <p style="margin:0 0 8px;color:#ffffff;font-size:18px;font-weight:700;line-height:1.6;">${title.ar}</p>
                  <p style="margin:0 0 18px;color:#d1d5db;line-height:1.8;">${message.ar}</p>
                  ${referenceLabel ? `<p style="margin:0 0 18px;color:#9ca3af;font-size:13px;">المرجع: <span dir="ltr">${referenceLabel}</span></p>` : ""}
                  <a href="${actionUrl.ar}" style="display:inline-block;box-sizing:border-box;max-width:100%;padding:13px 18px;background:#c9a227;color:#111111;text-decoration:none;border-radius:10px;font-weight:700;">${actionLabel.ar}</a>
                  <p style="margin:22px 0 0;color:#6b7280;font-size:12px;line-height:1.8;">هذه رسالة مرتبطة بحسابك وتكمّل الإشعار الموجود في حسابك على Alpha Exchange.</p>
                </div>`,
    en: `<div lang="en" dir="ltr" style="text-align:left;">
                  <p style="margin:0 0 16px;color:#e5e7eb;line-height:1.6;">Hello ${recipientName.en},</p>
                  <p style="margin:0 0 8px;color:#ffffff;font-size:18px;font-weight:700;line-height:1.5;">${title.en}</p>
                  <p style="margin:0 0 18px;color:#d1d5db;line-height:1.7;">${message.en}</p>
                  ${referenceLabel ? `<p style="margin:0 0 18px;color:#9ca3af;font-size:13px;">Reference: ${referenceLabel}</p>` : ""}
                  <a href="${actionUrl.en}" style="display:inline-block;box-sizing:border-box;max-width:100%;padding:13px 18px;background:#c9a227;color:#111111;text-decoration:none;border-radius:10px;font-weight:700;">${actionLabel.en}</a>
                  <p style="margin:22px 0 0;color:#6b7280;font-size:12px;line-height:1.6;">This transactional email complements the notification in your Alpha Exchange account.</p>
                </div>`,
  };

  const bilingualDivider = `<div role="separator" style="height:1px;background:#2b2b2b;margin:26px 0;"></div>`;
  const renderedHtmlSections = includedLocales.map((locale) => htmlSections[locale]).join(bilingualDivider);
  const primaryLocale = includedLocales[0];
  const secondaryLocale = includedLocales[1];

  return {
    subject,
    text: includedLocales
      .map((locale) => textSections[locale].filter(Boolean).join("\n"))
      .join("\n\n---\n\n"),
    html: `<!doctype html>
<html lang="${primaryLocale}" dir="${primaryLocale === "ar" ? "rtl" : "ltr"}">
  <body style="margin:0;background:#070707;color:#f9fafb;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070707;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#111111;border:1px solid #2b2b2b;border-radius:18px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:24px;background:linear-gradient(135deg,#1c1708,#111111);border-bottom:1px solid #3f3513;">
                <img src="${logoUrl}" width="88" height="88" alt="${BRAND_NAME_HTML}" style="display:block;width:88px;height:88px;margin:0 auto;border-radius:18px;object-fit:cover;" />
                <div style="margin-top:12px;font-size:12px;letter-spacing:2px;color:#d6b84c;text-transform:uppercase;">${BRAND_NAME_HTML}</div>
                <h1 lang="${primaryLocale}" dir="${primaryLocale === "ar" ? "rtl" : "ltr"}" style="margin:10px 0 0;font-size:24px;line-height:1.4;color:#ffffff;">${title[primaryLocale]}</h1>
                ${secondaryLocale ? `<p lang="${secondaryLocale}" dir="${secondaryLocale === "ar" ? "rtl" : "ltr"}" style="margin:7px 0 0;color:#d1d5db;font-size:14px;line-height:1.5;">${title[secondaryLocale]}</p>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                ${renderedHtmlSections}
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

export async function sendMarketplaceEmail(
  input: MarketplaceEmailPayload & {
    to: string;
    recipientLocale: MarketplaceEmailLocale;
    idempotencyKey?: string;
    maxAttempts?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
  },
) {
  recordMarketplaceEmailAttempt({
    event: input.event,
    to: input.to,
    referenceLabel: input.referenceLabel,
  });
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = getBrandedEmailFrom(process.env.EMAIL_FROM ?? "");
  if (!apiKey || !from) {
    return { ok: false as const, reason: "resend_not_configured" as const };
  }

  const email = buildMarketplaceEmail(input);
  const maxAttempts = Math.max(1, Math.min(3, Math.floor(input.maxAttempts ?? 3)));
  const retryDelayMs = Math.max(0, Math.min(1_000, Math.floor(input.retryDelayMs ?? 100)));
  const timeoutMs = Math.max(250, Math.min(15_000, Math.floor(input.timeoutMs ?? 5_000)));
  let latestFailure:
    | { ok: false; reason: "resend_request_failed"; providerStatus: number; providerMessage: string }
    | { ok: false; reason: "resend_network_failed" | "resend_timeout"; providerMessage: string }
    = { ok: false, reason: "resend_network_failed", providerMessage: "Email request did not run." };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let retryable = true;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
        signal: controller.signal,
      });

      if (response.ok) return { ok: true as const };

      const responseBody = await response.text();
      let providerMessage = responseBody;
      try {
        const parsed = JSON.parse(responseBody) as { message?: unknown };
        providerMessage = typeof parsed.message === "string" ? parsed.message : responseBody;
      } catch {
        // Keep the raw response when Resend does not return JSON.
      }
      latestFailure = {
        ok: false,
        reason: "resend_request_failed",
        providerStatus: response.status,
        providerMessage: providerMessage.slice(0, 500),
      };
      retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
    } catch (error) {
      const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      latestFailure = {
        ok: false,
        reason: timedOut ? "resend_timeout" : "resend_network_failed",
        providerMessage: timedOut
          ? "Resend request timed out."
          : error instanceof Error
            ? error.message.slice(0, 500)
            : "Unknown network error",
      };
    } finally {
      clearTimeout(timeout);
    }

    if (!retryable || attempt === maxAttempts) return latestFailure;
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** (attempt - 1)));
    }
  }

  return latestFailure;
}
