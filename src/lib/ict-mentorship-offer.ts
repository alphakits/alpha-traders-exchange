/** One programme, two starting points. The published deadlines are in Israel time. */
export const ICT_MENTORSHIP_OFFER = {
  experiencedFee: "₪6,700",
  beginnerFee: "₪7,500",
  novemberFees: { experiencedFee: "₪6,030", beginnerFee: "₪6,750" },
  enquiriesCloseDateLabel: "31-12-2026",
  enquiriesCloseAt: "2027-01-01T00:00:00+02:00",
} as const;

export const mentorshipBoundaries = [
  Date.parse("2026-11-01T00:00:00+02:00"),
  Date.parse("2026-12-01T00:00:00+02:00"),
  Date.parse(ICT_MENTORSHIP_OFFER.enquiriesCloseAt),
] as const;

export function mentorshipPhase(now: number = Date.now()) {
  if (now < mentorshipBoundaries[0]) return "standard";
  if (now < mentorshipBoundaries[1]) return "november";
  if (now < mentorshipBoundaries[2]) return "december";
  return "closed";
}

export type MentorshipPhase = ReturnType<typeof mentorshipPhase>;

export function isIctMentorshipIntakeOpen(now: number = Date.now()) {
  return now < mentorshipBoundaries[2];
}

export function mentorshipFees(phase: MentorshipPhase) {
  if (phase === "standard") return ICT_MENTORSHIP_OFFER;
  if (phase === "november") return ICT_MENTORSHIP_OFFER.novemberFees;
  // The invitation specifies a minimum December increase, not final fees.
  return null;
}

export function ictMentorshipOfferSummary(locale: "en" | "ar", phase: MentorshipPhase = mentorshipPhase()) {
  const isAr = locale === "ar";
  if (phase === "december") return isAr
    ? "ديسمبر آخر شهر لقبول طلاب جدد. ترتفع الرسوم بنسبة 10% على الأقل. استفسر من مارك عن الرسوم حسب خبرتك قبل الانضمام."
    : "December is the final intake. Tuition rises by at least 10%. Ask Mark to confirm the fee for your starting point before you enrol.";
  const fees = mentorshipFees(phase);
  if (!fees) return isAr ? "انتهى التسجيل لعام 2026." : "The 2026 intake has closed.";
  const summary = isAr
    ? `ICT Mentorship برنامج واحد مع مارك. الرسوم ${fees.experiencedFee} للي عنده تقريبًا سنة أو سنتين بالمجال وبيواجه صعوبة بالتطبيق والتقدّم، و${fees.beginnerFee} للي بيبدأ من الصفر.`
    : `ICT Mentorship is one programme with Mark. Tuition is ${fees.experiencedFee} for people with around one to two years in the markets who are struggling to apply what they have learned, or ${fees.beginnerFee} for someone starting from zero.`;
  if (phase === "standard") return summary;
  return summary + (isAr
    ? " تشمل الأسعار خصم 10% عند التسجيل حتى 30 نوفمبر. ديسمبر آخر شهر لقبول طلاب جدد، وترتفع فيه الرسوم بنسبة 10% على الأقل."
    : " These fees include 10% off when you enrol by November 30. December is the final intake, and tuition rises by at least 10%.");
}
