/** Public campaign metadata. Never place recipient data or provider secrets here. */
export const MENTORSHIP_EMAIL_CAMPAIGN_ID = "mentorship-november-2026";
export const MENTORSHIP_EMAIL_CONSENT_VERSION = "mentorship-november-2026-v1";
// Midnight on 1 December in Israel (UTC+02:00), exclusive.
export const MENTORSHIP_EMAIL_OFFER_EXPIRES_AT = "2026-11-30T22:00:00.000Z";
export const MENTORSHIP_EMAIL_ORIGIN = "https://www.alphatraders.co.il";

export function isMentorshipEmailCampaignOpen(now: Date | number = Date.now()) {
  const time = now instanceof Date ? now.getTime() : now;
  return time >= Date.parse("2026-10-31T22:00:00.000Z")
    && time < Date.parse(MENTORSHIP_EMAIL_OFFER_EXPIRES_AT);
}

export function isMentorshipEmailRequestEnabled() {
  return process.env.NEXT_PUBLIC_MENTORSHIP_EMAIL_REQUEST_ENABLED !== "0";
}

export function mentorshipEmailConsentText(locale: "en" | "ar") {
  return locale === "ar"
    ? "بدي توصلني رسالة واحدة على إيميل حسابي المؤكّد فيها دعوة منتورشيب Alpha Traders المدفوع وعرض نوفمبر 2026. هالطلب ما بشتركني برسائل تسويقية مستمرة."
    : "Email me the Alpha Traders paid mentorship invitation and November 2026 offer once, at my verified account email. This request does not subscribe me to ongoing marketing.";
}
