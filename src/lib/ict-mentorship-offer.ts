/** Mark's current offer, confirmed 27 September 2026. One programme, two starting points. */
export const ICT_MENTORSHIP_OFFER = {
  experiencedFee: "₪6,700",
  beginnerFee: "₪7,500",
  enquiriesCloseAt: "2027-01-01T00:00:00+02:00", // End of 2026 in Israel.
} as const;

export function isIctMentorshipIntakeOpen(now: number = Date.now()) {
  return now < Date.parse(ICT_MENTORSHIP_OFFER.enquiriesCloseAt);
}

export function ictMentorshipOfferSummary(locale: "en" | "ar") {
  return locale === "ar"
    ? `ICT Mentorship برنامج واحد مع مارك. الرسوم ${ICT_MENTORSHIP_OFFER.experiencedFee} للي عنده تقريبًا سنة أو سنتين بالمجال وبيواجه صعوبة بالتطبيق والتقدّم، و${ICT_MENTORSHIP_OFFER.beginnerFee} للي بيبدأ من الصفر.`
    : `ICT Mentorship is one programme with Mark. Tuition is ${ICT_MENTORSHIP_OFFER.experiencedFee} for people with around one to two years in the markets who are struggling to apply what they have learned and progress, or ${ICT_MENTORSHIP_OFFER.beginnerFee} for someone starting from zero.`;
}
