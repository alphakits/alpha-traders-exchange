import "server-only";
import {
  declineMarketingEmail,
  getMarketingEmailStatus,
  requestMarketingEmail,
  type FrozenMarketingPayload,
} from "@/lib/marketing-email-ledger";
import {
  MENTORSHIP_EMAIL_CAMPAIGN_ID,
  MENTORSHIP_EMAIL_CONSENT_VERSION,
  MENTORSHIP_EMAIL_OFFER_EXPIRES_AT,
  MENTORSHIP_EMAIL_ORIGIN,
  isMentorshipEmailCampaignOpen,
  isMentorshipEmailRequestEnabled,
  mentorshipEmailConsentText,
} from "@/lib/mentorship-email-config";
import { approvedMentorshipEmailHtml, approvedMentorshipEmailText } from "@/lib/mentorship-email-approved-content";

type CampaignUser = { id: string; email: string; emailVerified?: boolean; disabled?: boolean };
export const MENTORSHIP_EMAIL_FROM = "Alpha Traders Academy & Exchange <notifications@alphatraders.co.il>";
export const MENTORSHIP_EMAIL_SUBJECT = "פרסומת | خصم 10% على منتورشيب مارك | 10% off ICT Mentorship";

function identity(user: CampaignUser) {
  return {
    campaignId: MENTORSHIP_EMAIL_CAMPAIGN_ID,
    userId: user.id,
    email: user.email.trim().toLowerCase(),
    offerExpiresAt: MENTORSHIP_EMAIL_OFFER_EXPIRES_AT,
  };
}

export function buildMentorshipEmailPayload(input: { email: string; requestId: string; unsubscribeToken: string }): FrozenMarketingPayload {
  const url = new URL("/api/marketing/unsubscribe", MENTORSHIP_EMAIL_ORIGIN);
  url.searchParams.set("token", input.unsubscribeToken);
  return {
    from: MENTORSHIP_EMAIL_FROM,
    to: input.email.trim().toLowerCase(),
    subject: MENTORSHIP_EMAIL_SUBJECT,
    html: approvedMentorshipEmailHtml.replace("__MENTORSHIP_UNSUBSCRIBE_URL__", url.toString()),
    text: approvedMentorshipEmailText.replace("__MENTORSHIP_UNSUBSCRIBE_URL__", url.toString()),
    reply_to: "support@alphatraders.co.il",
    headers: {
      "List-Unsubscribe": `<${url.toString()}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [
      { name: "campaign", value: MENTORSHIP_EMAIL_CAMPAIGN_ID },
      { name: "request_id", value: input.requestId },
    ],
  };
}

export async function getMentorshipEmailStatus(user: CampaignUser) {
  return getMarketingEmailStatus(identity(user));
}

export async function requestMentorshipEmail(user: CampaignUser, locale: "en" | "ar", consentVersion: string) {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") throw new Error("Campaign unavailable outside production");
  if (!isMentorshipEmailRequestEnabled() || !isMentorshipEmailCampaignOpen()) throw new Error("Campaign unavailable");
  if (user.disabled || user.emailVerified !== true) throw new Error("Verified account required");
  if (consentVersion !== MENTORSHIP_EMAIL_CONSENT_VERSION) throw new Error("Consent version changed");
  return requestMarketingEmail({
    ...identity(user),
    locale,
    consentVersion,
    consentText: mentorshipEmailConsentText(locale),
    buildPayload: ({ requestId, unsubscribeToken }) => buildMentorshipEmailPayload({ email: user.email, requestId, unsubscribeToken }),
  });
}

export async function declineMentorshipEmail(user: CampaignUser) {
  return declineMarketingEmail(identity(user));
}
