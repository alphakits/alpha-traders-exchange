import { text as t, type FirmProgram, type PropFirm } from "./types";
const base = "https://help.topstep.com/en/articles/";
const sources = [
  { title: "Trading Combine rules", url: base + "8284197-trading-combine-parameters" },
  { title: "Pricing & resets", url: base + "14289835-topstep-pricing-and-payment-questions" },
  { title: "Payout policy & methods", url: base + "8284233-topstep-payout-policy" },
  { title: "Daily Loss Limit (DLL)", url: base + "10490293-daily-loss-limit-in-the-trading-combine-and-express-funded-account" },
  { title: "Maximum Loss Limit", url: base + "8284204-what-is-the-maximum-loss-limit" },
  { title: "Evaluation consistency", url: base + "8284208-consistency-at-topstep" },
];
const programs: FirmProgram[] = [false, true].map(consistency => ({
  id: consistency ? "xfa-consistency" : "xfa-standard",
  name: consistency ? "XFA Consistency" : "XFA Standard",
  tagline: consistency ? t("3 trading days + 40% consistency", "3 أيام تداول + اتساق 40%") : t("5 winning days, $150+ each", "5 أيام رابحة، $150 أو أكثر لكل يوم"),
  tiers: [50000, 100000, 150000].map((size, i) => ({
    size, targets: [[3000, 6000, 9000][i]], maxLoss: [2000, 3000, 4500][i], dailyLoss: [1000, 2000, 3000][i], contracts: [5, 10, 15][i],
    price: [49, 99, 199][i], noActivationPrice: [95, 149, 229][i], minPayout: 125, buffer: 0, dailyProfit: consistency ? undefined : 150,
    caps: [consistency ? [3000, 4000, 6000][i] : [2000, 3000, 5000][i]],
  })),
  evaluationDays: t("As few as 2 trading days", "ممكن خلال يومي تداول"),
  evaluationConsistency: t("Best day ≤55% of total net profit; a larger day raises the profit needed to pass.", "أفضل يوم ≤55% من صافي الربح الكلي؛ اليوم الأكبر يرفع الربح المطلوب للنجاح."),
  drawdown: t("EOD trailing MLL, enforced intraday. Touching the loss floor fails the account.", "حد خسارة متحرك حسب نهاية اليوم، يُراقب أثناء الجلسة. لمس حد الخسارة يفشل الحساب."),
  pricing: t("Monthly until passing or cancellation. Reset costs match the selected monthly path. Taxes and optional Level 2 data are extra; Level 1 is included.", "اشتراك شهري حتى النجاح أو الإلغاء. إعادة المحاولة بسعر المسار الشهري المختار. الضرائب وبيانات Level 2 الاختيارية إضافية؛ Level 1 مشمولة."),
  activation: t("Standard billing: $149 per XFA. No Activation Fee billing: $0. Billing path and XFA payout path are separate choices.", "الدفع Standard: تفعيل $149 لكل XFA. مسار No Activation Fee: تفعيل $0. مسار الدفع مختلف عن مسار السحب في XFA."),
  funded: [
    t("Pass → subscription ends → activate XFA from the dashboard. Evaluation profits do not transfer. XFA is simulated and starts at $0; 50K/100K/150K describes buying power.", "تنجح ← ينتهي الاشتراك ← تفعّل XFA من لوحة الشركة. أرباح الامتحان لا تنتقل. XFA حساب محاكاة يبدأ من $0؛ و50K/100K/150K قوة شرائية."),
    t("Follow the XFA scaling plan. Evaluation contract limits are not your automatic funded allowance. A later Live account follows separate funding and payout rules.", "التزم بتدرّج العقود في XFA. عدد عقود الامتحان ليس تلقائياً العدد المسموح بعد النجاح. الانتقال لاحقاً إلى Live له شروط تمويل وسحب منفصلة."),
  ],
  payoutDetails: [
    consistency ? t("Each cycle: at least 3 days with a trade; best day's net profit must be ≤40% of total net profit. Day count and consistency reset after a payout.", "كل دورة: 3 أيام فيها تداول على الأقل؛ صافي أفضل يوم لا يتجاوز 40% من صافي الربح. عدّ الأيام والاتساق يبدأ من جديد بعد السحب.") : t("Each cycle: 5 non-consecutive winning days of at least $150 net each. After your first payout, you also need positive net profit of at least $0.01 since your last payout.", "كل دورة: 5 أيام رابحة، مش شرط متتالية، بصافي $150 على الأقل لليوم. بعد أول سحب، لازم أيضاً يكون صافي الربح منذ آخر سحب $0.01 أو أكثر."),
    t("Request at most 50% of the XFA balance, within the size-specific cap. You receive 90% before transfer fees. Minimum request: $125.", "تطلب حتى 50% من رصيد XFA، ضمن سقف حجم حسابك. حصتك 90% قبل رسوم التحويل. أقل طلب $125."),
    t("DLL promotion: doubled caps apply only when DLL was purchased with a qualifying NEW Combine from June 2, 2026, 3:30 PM CT, while the offer is active. Adding DLL at XFA activation or a personal limit does not qualify.", "عرض DLL: السقف المضاعف فقط عند شراء Combine جديد مؤهل مع DLL، من 2 يونيو 2026 الساعة 3:30 مساءً CT وخلال سريان العرض. إضافته عند تفعيل XFA أو كحد شخصي لا تؤهّل للمضاعفة."),
    t("After the first payout, MLL becomes $0 permanently. The remaining XFA balance is your loss cushion. The payout-request trading day does not count toward the next cycle.", "بعد أول سحب يصبح حد MLL هو $0 نهائياً. الرصيد المتبقي في XFA هو هامش الخسارة المتاح. يوم طلب السحب لا يُحسب ضمن الدورة التالية."),
  ],
  cautions: [
    t("A purchase-set DLL cannot be changed later. Reaching DLL pauses the session; reaching MLL closes the account. Removing DLL never removes MLL.", "DLL المضاف عند الشراء لا يتغير لاحقاً. بلوغ DLL يوقف الجلسة؛ بلوغ MLL يغلق الحساب. عدم وجود DLL لا يلغي MLL."),
    t("Trading sessions use Chicago time (CT), including daylight saving: 5 PM to 3:10 PM next day. A winning day locks at 4 PM CT.", "الجلسة حسب توقيت شيكاغو CT مع التوقيت الصيفي: من 5 مساءً إلى 3:10 مساء اليوم التالي. يُثبّت اليوم الرابح عند 4 مساءً CT."),
    t("The calculator uses the current 90/10 split. Accounts covered by the pre-January 12, 2026 first-$10,000 exception must use their dashboard's actual split.", "الحاسبة تعتمد التقسيم الحالي 90/10. الحسابات المشمولة باستثناء أول $10,000 لما قبل 12 يناير 2026 ترجع للنسبة الفعلية بلوحة الشركة."),
  ],
  payout: { mode: "topstep", share: 90, days: consistency ? 3 : 5, consistency: consistency ? 40 : undefined, positiveCycleRequired: !consistency },
  sources,
}));

export const topstep: PropFirm = {
  slug: "topstep", name: "Topstep", short: "TS", accent: "#E8B85B", market: t("Futures", "عقود مستقبلية"), website: "https://www.topstep.com/",
  description: t("Trading Combine → Express Funded → Live. Understand both payout paths and the DLL option.", "Trading Combine ثم Express Funded ثم Live. افهم مسارات السحب وخيار DLL."), programs,
  receiving: [
    t("Open Topstep Dashboard → Payouts. Submit in CME market hours and complete the agreement and identity/payment details in your own name.", "افتح لوحة Topstep ثم Payouts. قدّم خلال ساعات سوق CME وأكمل الاتفاقية والتحقق وبيانات الاستلام باسمك."),
    t("International Wire/SWIFT: $30, estimated 5–10 business days. Internal approval can take 1–3 business days separately. Receiving-bank fees may also apply.", "الحوالة الدولية Wire/SWIFT: رسوم $30 ومدة تقديرية 5–10 أيام عمل. الموافقة الداخلية قد تستغرق 1–3 أيام عمل إضافية. ممكن رسوم من البنك المستلم."),
    t("Wise is currently limited to China, Canada and the UK (1–3 business days). Aeropay and ACH are for US banks; ACH costs $30. Method availability depends on location.", "Wise متاحة حالياً للصين وكندا وبريطانيا فقط (1–3 أيام عمل). Aeropay وACH لبنوك أمريكا؛ ACH برسوم $30. الطريقة تعتمد على البلد."),
  ],
  important: [t("These calculations cover XFA, not Live. Live uses a different withdrawal policy; taking its full available balance can close it.", "الحسابات هنا لمرحلة XFA. مرحلة Live لها سياسة سحب مختلفة؛ سحب كامل رصيدها المتاح قد يغلقها.")],
  sources: [...sources, { title: "Live account parameters", url: base + "10657969-live-funded-account-parameters" }],
};
