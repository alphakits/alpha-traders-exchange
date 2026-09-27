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
  return locale === "ar"
    ? `أهلًا، شكرًا لاهتمامك بـ ICT Mentorship مع مارك.\n\nهون بتلاقي المنهج وشرحي الأصلي الكامل (7:44) عن الدراسة والتطبيق والأسئلة والمراجعة:\n${url}\n\nإذا ما حكيتلي بعد، احكيلي عن خبرتك، شو حاب تفهم أو تطوّر، والوقت اللي بتقدر تخصصه للدراسة والتطبيق.\n\nقبل أي التزام، منوضح المحتوى، صيغة اللقاءات، المواعيد والمدة، الرسوم، نطاق المتابعة وشروط الإلغاء. الأكاديمية المجانية متاحة إلك كبداية. الاستفسار مش حجز مقعد، والتعليم ما بيضمن أرباحًا.\n\nمارك | Alpha Traders`
    : `Hi, thank you for your interest in ICT Mentorship with Mark.\n\nHere is the curriculum and my full original explanation (7:44, in Arabic with an English summary) about study, practice, questions and review:\n${url}\n\nIf you have not already shared them, tell me about your experience, what you want to understand or improve, and the time you can dedicate to study and practice.\n\nBefore any commitment, we will clarify the content, session format, schedule and duration, fees, follow-up scope and cancellation terms. The free Academy is available as a starting point. An enquiry does not reserve a place, and education does not guarantee trading profits.\n\nMark | Alpha Traders`;
}
