import type { AppLocale } from "@/i18n/routing";

export const PUBLIC_TRUST_LAST_UPDATED = "2026-08-27";

export type PublicTrustFaq = {
  id: string;
  question: string;
  answer: string;
};

const PUBLIC_TRUST_FAQS: Record<AppLocale, PublicTrustFaq[]> = {
  en: [
    {
      id: "what-is-alpha-traders",
      question: "What is Alpha Traders?",
      answer:
        "Alpha Traders Academy & Exchange combines free trading education with Alpha Exchange, a peer-to-peer marketplace workflow where approved sellers publish USDT listings and buyers open structured trade requests.",
    },
    {
      id: "is-alpha-traders-safe",
      question: "Is Alpha Traders safe?",
      answer:
        "Alpha Traders uses manual seller approval, public seller signals, fixed trade IDs, staged trade steps, evidence uploads, activity records, time controls, and dispute support to reduce risk. No marketplace can eliminate all fraud, payment, counterparty, or blockchain risk, so Alpha Traders does not describe any trade as 100% safe or guaranteed.",
    },
    {
      id: "does-alpha-traders-hold-funds",
      question: "Does Alpha Traders hold the buyer’s money or the seller’s USDT?",
      answer:
        "No. The marketplace coordinates and records the trade workflow, but the buyer’s payment and the seller’s USDT are transferred directly between the two parties using the agreed payment method and wallet network. Alpha Traders does not take custody of the principal funds for a marketplace trade.",
    },
    {
      id: "approved-seller-meaning",
      question: "What does Approved Seller mean?",
      answer:
        "Only sellers approved by Alpha Traders can publish listings. Applications are manually reviewed and additional information may be requested. Approval is a platform access decision made at the time of review; it is not a guarantee of identity, future conduct, profit, or a risk-free transaction.",
    },
    {
      id: "how-to-trade-safely",
      question: "How should users trade safely?",
      answer:
        "Use only alphatraders.co.il, keep communication and evidence inside the official Trade Room, compare the seller’s current public signals, verify incoming funds in your own bank or wallet, confirm the exact USDT network and address, and never continue when the amount, recipient, evidence, or trade status does not match.",
    },
    {
      id: "discord-social-safety",
      question: "Can a trade be completed through Discord, WhatsApp, or social media?",
      answer:
        "No. Community and social channels may provide education, notices, or official links, but they are not the transaction system. Never send funds, passwords, recovery codes, identity documents, wallet secrets, or payment evidence through Discord or an unsolicited private message.",
    },
    {
      id: "suspicious-activity",
      question: "What should a user do if something looks suspicious?",
      answer:
        "Stop before sending or releasing value, keep the trade record open, preserve evidence, use the dispute or report flow, and contact Alpha Traders through the official website. Do not move the conversation off-platform or accept replacement payment instructions from a private message.",
    },
    {
      id: "legal-identity-claims",
      question: "Which ownership, registration, or licensing claims should users rely on?",
      answer:
        "Rely only on legal or business facts that the official Alpha Traders website links to verifiable public evidence. A brand name, logo, domain, social profile, identity document, or private message is not by itself proof of business registration or a financial-services licence. Contact official support when a required legal fact is not publicly documented.",
    },
    {
      id: "education-risk",
      question: "Does Alpha Traders guarantee trading results or investment returns?",
      answer:
        "No. Academy material is educational and does not guarantee profit or remove market risk. Users remain responsible for their own financial, legal, tax, wallet, and trading decisions.",
    },
  ],
  ar: [
    {
      id: "what-is-alpha-traders",
      question: "ما هي Alpha Traders؟",
      answer:
        "تجمع Alpha Traders Academy & Exchange بين تعليم التداول المجاني وAlpha Exchange، وهو مسار سوق نظير إلى نظير ينشر فيه البائعون المعتمدون عروض USDT ويفتح المشترون طلبات تداول منظمة.",
    },
    {
      id: "is-alpha-traders-safe",
      question: "هل Alpha Traders آمنة؟",
      answer:
        "تستخدم Alpha Traders مراجعة يدوية للبائعين، وإشارات عامة عن البائع، ومعرّفات ثابتة للصفقات، ومراحل تداول واضحة، ورفع الأدلة، وسجلات النشاط، وضوابط الوقت، ودعم النزاعات لتقليل المخاطر. لا يمكن لأي سوق أن يلغي جميع مخاطر الاحتيال أو الدفع أو الطرف المقابل أو البلوكشين، لذلك لا تصف Alpha Traders أي صفقة بأنها آمنة 100% أو مضمونة.",
    },
    {
      id: "does-alpha-traders-hold-funds",
      question: "هل تحتفظ Alpha Traders بأموال المشتري أو USDT الخاص بالبائع؟",
      answer:
        "لا. ينسق السوق مراحل الصفقة ويسجلها، لكن دفعة المشتري وUSDT الخاص بالبائع ينتقلان مباشرة بين الطرفين باستخدام وسيلة الدفع وشبكة المحفظة المتفق عليهما. لا تحتفظ Alpha Traders بأصل أموال صفقة السوق.",
    },
    {
      id: "approved-seller-meaning",
      question: "ماذا يعني بائع معتمد؟",
      answer:
        "يمكن فقط للبائعين الذين وافقت عليهم Alpha Traders نشر العروض. تُراجع الطلبات يدويًا وقد تُطلب معلومات إضافية. الاعتماد قرار لمنح صلاحية استخدام المنصة وقت المراجعة، وليس ضمانًا للهوية أو السلوك المستقبلي أو الربح أو صفقة بلا مخاطر.",
    },
    {
      id: "how-to-trade-safely",
      question: "كيف يتداول المستخدمون بأمان؟",
      answer:
        "استخدم alphatraders.co.il فقط، واحتفظ بالتواصل والأدلة داخل غرفة التداول الرسمية، وقارن إشارات البائع الحالية، وتحقق من وصول الأموال في حسابك البنكي أو محفظتك، وأكد شبكة USDT والعنوان بدقة، ولا تتابع إذا لم يتطابق المبلغ أو المستلم أو الدليل أو حالة الصفقة.",
    },
    {
      id: "discord-social-safety",
      question: "هل يمكن إتمام صفقة عبر Discord أو WhatsApp أو وسائل التواصل؟",
      answer:
        "لا. قد توفر قنوات المجتمع والتواصل تعليمًا أو إشعارات أو روابط رسمية، لكنها ليست نظام الصفقات. لا ترسل أموالًا أو كلمات مرور أو رموز استرداد أو وثائق هوية أو أسرار محفظة أو أدلة دفع عبر Discord أو رسالة خاصة غير مطلوبة.",
    },
    {
      id: "suspicious-activity",
      question: "ماذا يفعل المستخدم إذا لاحظ شيئًا مريبًا؟",
      answer:
        "توقف قبل إرسال أو تحرير أي قيمة، وأبقِ سجل الصفقة مفتوحًا، واحتفظ بالأدلة، واستخدم مسار النزاع أو البلاغ، وتواصل مع Alpha Traders من خلال الموقع الرسمي. لا تنقل المحادثة خارج المنصة ولا تقبل تعليمات دفع بديلة من رسالة خاصة.",
    },
    {
      id: "legal-identity-claims",
      question: "ما ادعاءات الملكية أو التسجيل أو الترخيص التي يمكن الاعتماد عليها؟",
      answer:
        "اعتمد فقط على الحقائق القانونية أو التجارية التي يربطها موقع Alpha Traders الرسمي بأدلة عامة قابلة للتحقق. الاسم التجاري أو الشعار أو النطاق أو الحساب الاجتماعي أو وثيقة هوية أو رسالة خاصة لا يثبت بمفرده تسجيل النشاط أو وجود ترخيص للخدمات المالية. تواصل مع الدعم الرسمي إذا لم تكن المعلومة القانونية المطلوبة موثقة علنًا.",
    },
    {
      id: "education-risk",
      question: "هل تضمن Alpha Traders نتائج التداول أو عوائد الاستثمار؟",
      answer:
        "لا. مواد الأكاديمية تعليمية ولا تضمن الربح أو تلغي مخاطر السوق. يبقى المستخدم مسؤولًا عن قراراته المالية والقانونية والضريبية وقرارات المحفظة والتداول.",
    },
  ],
};

export function getPublicTrustFaqs(locale: AppLocale) {
  return PUBLIC_TRUST_FAQS[locale];
}
