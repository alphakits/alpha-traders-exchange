export type MarketplaceEmailEvent =
  | "new_buy_request"
  | "trade_accepted"
  | "trade_rejected"
  | "buyer_payment_sent"
  | "seller_usdt_released"
  | "trade_completed"
  | "trade_cancelled"
  | "listing_approved"
  | "listing_rejected"
  | "new_listing_published";

export type MarketplaceEmailPayload = {
  event: MarketplaceEmailEvent;
  recipientName: string;
  title: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
  referenceLabel?: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildMarketplaceEmail(input: MarketplaceEmailPayload) {
  const recipientName = escapeHtml(input.recipientName || "Trader");
  const title = escapeHtml(input.title);
  const message = escapeHtml(input.message);
  const actionLabel = escapeHtml(input.actionLabel);
  const actionUrl = escapeHtml(input.actionUrl);
  const referenceLabel = input.referenceLabel ? escapeHtml(input.referenceLabel) : "";
  const subject = `${input.title} | Alpha Exchange`;

  return {
    subject,
    text: [
      `Hello ${input.recipientName || "Trader"},`,
      "",
      input.title,
      input.message,
      input.referenceLabel ? `Reference: ${input.referenceLabel}` : "",
      "",
      `${input.actionLabel}: ${input.actionUrl}`,
      "",
      "This transactional email complements the notification in your Alpha Exchange account.",
    ].filter(Boolean).join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#070707;color:#f9fafb;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070707;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#111111;border:1px solid #2b2b2b;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:24px;background:linear-gradient(135deg,#1c1708,#111111);border-bottom:1px solid #3f3513;">
                <div style="font-size:12px;letter-spacing:2px;color:#d6b84c;text-transform:uppercase;">Alpha Exchange</div>
                <h1 style="margin:10px 0 0;font-size:24px;line-height:1.3;color:#ffffff;">${title}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 16px;color:#e5e7eb;line-height:1.6;">Hello ${recipientName},</p>
                <p style="margin:0 0 18px;color:#d1d5db;line-height:1.7;">${message}</p>
                ${referenceLabel ? `<p style="margin:0 0 18px;color:#9ca3af;font-size:13px;">Reference: ${referenceLabel}</p>` : ""}
                <a href="${actionUrl}" style="display:inline-block;box-sizing:border-box;max-width:100%;padding:13px 18px;background:#c9a227;color:#111111;text-decoration:none;border-radius:10px;font-weight:700;">${actionLabel}</a>
                <p style="margin:22px 0 0;color:#6b7280;font-size:12px;line-height:1.6;">This transactional email complements the notification in your Alpha Exchange account.</p>
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

export async function sendMarketplaceEmail(input: MarketplaceEmailPayload & { to: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  if (!apiKey || !from) {
    return { ok: false as const, reason: "resend_not_configured" as const };
  }

  const email = buildMarketplaceEmail(input);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      let providerMessage = responseBody;
      try {
        const parsed = JSON.parse(responseBody) as { message?: unknown };
        providerMessage = typeof parsed.message === "string" ? parsed.message : responseBody;
      } catch {
        // Keep the raw response when Resend does not return JSON.
      }
      return {
        ok: false as const,
        reason: "resend_request_failed" as const,
        providerStatus: response.status,
        providerMessage: providerMessage.slice(0, 500),
      };
    }
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      reason: "resend_network_failed" as const,
      providerMessage: error instanceof Error ? error.message.slice(0, 500) : "Unknown network error",
    };
  }
}
