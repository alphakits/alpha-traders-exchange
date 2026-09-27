import { ICT_MENTORSHIP_OFFER, ictMentorshipOfferSummary, isIctMentorshipIntakeOpen } from "@/lib/ict-mentorship-offer";

export const LEARNING_INTEREST_TOPIC = "learning-with-mark" as const;
export const LEARNING_INTEREST_SUBJECT = {
  ar: "اهتمام بالتعلّم مع مارك",
  en: "Interest in learning with Mark",
} as const;

export const LEARNING_EXPERIENCE = {
  starting: { en: "Starting from zero", ar: "ببدأ من الصفر" },
  foundations: { en: "Learning the foundations", ar: "بتعلّم الأساسيات" },
  studied: { en: "Studied before; need help applying it", ar: "تعلّمت سابقًا وبحتاج مساعدة بالتطبيق" },
  practising: { en: "Already practising; want to improve", ar: "بطبّق وبدي أطوّر مستواي" },
} as const;

export type LearningDetails = {
  experience: keyof typeof LEARNING_EXPERIENCE;
  availability: string;
};

export function formatLearningMessage(message: string, details: LearningDetails, locale: "ar" | "en") {
  const labels = locale === "ar"
    ? ["الخبرة الحالية", "وقت الدراسة المتاح", "الهدف والأسئلة"]
    : ["Current experience", "Available study time", "Learning goal and questions"];
  return `${labels[0]}: ${LEARNING_EXPERIENCE[details.experience][locale]}\n${labels[1]}: ${details.availability}\n\n${labels[2]}:\n${message}`;
}

export function learningInformationReply(locale: "ar" | "en") {
  const url = `https://www.alphatraders.co.il/${locale}/learn-with-mark#mark-explains`;
  if (!isIctMentorshipIntakeOpen()) return locale === "ar"
    ? `انتهت نافذة استقبال طلبات ICT Mentorship لعام 2026. الأكاديمية المجانية ما زالت متاحة:\nhttps://www.alphatraders.co.il/ar/learn-trading-free`
    : `The 2026 ICT Mentorship enquiry window has closed. The free Academy remains available:\nhttps://www.alphatraders.co.il/en/learn-trading-free`;
  const offer = ictMentorshipOfferSummary(locale);
  const deadline = ICT_MENTORSHIP_OFFER.enquiriesCloseDateLabel;
  return locale === "ar"
    ? `أهلًا، شكرًا لاهتمامك بـ ICT Mentorship مع مارك.\n\nهذه نافذتي الأخيرة لاستقبال طلبات المنتورشيب، حتى ${deadline} بتوقيت إسرائيل. إذا عندك خبرة لكنك لسه عالق بالتطبيق، الهدف نراجع طريقة تفكيرك وقراراتك وأسئلتك، ونشتغل على فهم الأخطاء والانضباط.\n\n${offer}\n\nهون بتلاقي المنهج وشرحي الأصلي الكامل (7:44) عن الدراسة والتطبيق والأسئلة والمراجعة:\n${url}\n\nاحكيلي عن خبرتك، شو حاب تفهم أو تطوّر، والوقت اللي بتقدر تخصصه للدراسة والتطبيق. قبل أي التزام، منوضح صيغة اللقاءات، المواعيد والمدة، الرسوم المناسبة لبدايتك، نطاق المتابعة وشروط الإلغاء. الأكاديمية المجانية متاحة إلك كبداية. الاستفسار مش حجز مقعد، والتعليم ما بيضمن أرباحًا.\n\nمارك | Alpha Traders`
    : `Hi, thank you for your interest in ICT Mentorship with Mark.\n\nThis is my final mentorship enquiry window, through ${deadline} (Israel time). If you have experience but still feel stuck applying it, the focus is on reviewing your reasoning, decisions and questions, understanding mistakes and building discipline.\n\n${offer}\n\nHere is the curriculum and my full original explanation (7:44, in Arabic with an English summary):\n${url}\n\nTell me about your experience, what you want to understand or improve, and the time you can dedicate to study and practice. Before any commitment, we will clarify the session format, schedule and duration, the fee for your starting point, follow-up scope and cancellation terms. The free Academy remains available. An enquiry does not reserve a place, and education does not guarantee trading profits.\n\nMark | Alpha Traders`;
}
