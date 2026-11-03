import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { getMarketingEmailAudit } from "@/lib/marketing-email-ledger";
import { MENTORSHIP_EMAIL_CAMPAIGN_ID } from "@/lib/mentorship-email-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET() {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) {
    const response = unauthorized ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }

  try {
    const audit = await getMarketingEmailAudit(MENTORSHIP_EMAIL_CAMPAIGN_ID);
    // Explicit projection keeps future ledger fields, including message content
    // or consent tokens, outside this read-only owner response.
    return NextResponse.json({
      campaignId: audit.campaignId,
      checkedAt: audit.checkedAt,
      counts: audit.counts,
      shown: audit.shown,
      truncated: audit.truncated,
      recipients: audit.recipients.map(row => ({
        id: row.id,
        userId: row.userId,
        email: row.email,
        locale: row.locale,
        status: row.status,
        consentStatus: row.consentStatus,
        consentVersion: row.consentVersion,
        requestedAt: row.requestedAt,
        sentAt: row.sentAt,
        deliveredAt: row.deliveredAt,
        holdCodes: row.holdCodes,
        providerEmailId: row.providerEmailId,
        providerCampaignId: row.providerCampaignId,
        firstAttemptAt: row.firstAttemptAt,
        lastReason: row.lastReason,
        updatedAt: row.updatedAt,
        events: row.events.map(event => ({
          type: event.type,
          occurredAt: event.occurredAt,
          observedAt: event.observedAt,
          source: event.source,
          reason: event.reason,
        })),
      })),
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Email audit is temporarily unavailable. Please refresh." }, { status: 503, headers });
  }
}
