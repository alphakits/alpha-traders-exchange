import { text as t, type FirmProgram, type PropFirm } from "./types";
const base = "https://apextraderfunding.com/help-center/";
const eodSource = { title: "EOD evaluation", url: base + "eod-trailing-drawdown-accounts/eod-evaluations/" };
const eodPay = { title: "EOD payout tables", url: base + "eod-trailing-drawdown-accounts/eod-payouts/" };
const intraSource = { title: "Intraday evaluation", url: base + "evaluation-accounts-ea/intraday-trailing-drawdown-evaluations/" };
const intraPay = { title: "Intraday payout tables", url: base + "uncategorized/intraday-trailing-drawdown-payouts/" };
const legacyPay = { title: "Legacy PA payouts", url: base + "legacy-payouts/legacy-pa-payout-parameters/" };
const programs: FirmProgram[] = [false, true].map(intraday => ({
  id: intraday ? "intraday" : "eod", name: intraday ? "Intraday Trailing" : "EOD Drawdown",
  tagline: intraday ? t("Loss floor follows intraday equity highs", "حد الخسارة يتبع أعلى قيمة أثناء الجلسة") : t("Loss floor updates at the end of the day", "حد الخسارة يتحدّث بنهاية اليوم"),
  tiers: [25000, 50000, 100000, 150000].map((size, i) => ({
    size, targets: [[1500, 3000, 6000, 9000][i]], maxLoss: [1000, 2000, 3000, 4000][i], dailyLoss: intraday ? undefined : [500, 1000, 1500, 2000][i], contracts: [4, 6, 8, 12][i],
    minPayout: 500, buffer: [1100, 2100, 3100, 4100][i], dailyProfit: (intraday ? [100, 200, 250, 300] : [100, 250, 300, 350])[i],
    caps: (intraday ? [[1000,1000,1000,1000,1000,1000],[1500,2000,2500,2500,3000,3000],[2000,2500,3000,3000,4000,4000],[2500,3000,3000,4000,4000,5000]] : [[1000,1000,1000,1000,1000,1000],[1500,1500,2000,2500,2500,3000],[2000,2500,2500,3000,4000,4000],[2500,3000,3000,3000,4000,5000]])[i],
  })),
  evaluationDays: t("Can pass in 1 day; 30 calendar days of access", "ممكن النجاح بيوم واحد؛ صلاحية الامتحان 30 يوماً تقويمياً"),
  evaluationConsistency: t("No evaluation consistency requirement", "لا يوجد شرط اتساق بالامتحان"),
  drawdown: intraday ? t("Trailing intraday, including unrealized profits. Giving back an open profit can still hit the raised floor.", "متحرك أثناء الجلسة ويشمل الأرباح المفتوحة. تراجع ربح صفقة مفتوحة ممكن يلمس حد الخسارة الذي ارتفع.") : t("Calculated at the daily close, then enforced throughout the next session. EOD does not mean losses are checked only at closing.", "يُحسب عند الإغلاق اليومي ثم يُطبّق خلال الجلسة التالية. EOD لا يعني أن الخسائر تُفحص عند الإغلاق فقط."),
  pricing: t("One-time evaluation purchase with 30-day access. Exact price depends on size, vendor, billing option and current offer; use the official configured checkout.", "شراء امتحان مرة واحدة بصلاحية 30 يوماً. السعر يتغير حسب الحجم والمنصة وخيار الرسوم والعرض؛ افحص السعر الرسمي بعد اختيار الإعدادات."),
  activation: t("Activate the matching PA within 7 calendar days of passing. Check whether your purchased option includes activation or has a separate fee.", "فعّل PA المطابق خلال 7 أيام تقويمية من النجاح. تأكد إذا خيار الشراء يشمل التفعيل أو عليه رسوم منفصلة."),
  funded: [
    t("PA is a simulated Performance Account. Contract limits scale with performance and are lower than evaluation limits; follow the PA scaling table.", "PA حساب أداء بالمحاكاة. حد العقود يتدرّج حسب الأداء وهو أقل من حد الامتحان؛ اتبع جدول تدرّج PA."),
    t("The drawdown remains account-specific. PA rules include daily loss/scaling controls; the evaluation DLL shown above is not a fixed PA allowance.", "الخسارة المسموحة مرتبطة بنوع الحساب. PA فيها حدود يومية وتدرّج؛ DLL المعروض للامتحان ليس بالضرورة حد PA الثابت."),
  ],
  payoutDetails: [
    t("Every payout needs 5 qualifying trading days. Only days reaching your size-specific daily net profit count; days need not be consecutive.", "كل سحب يحتاج 5 أيام تداول مؤهلة. يُحسب فقط اليوم الذي يحقق حد الربح اليومي الصافي لحجمك؛ مش شرط تكون متتالية."),
    t("Best day must be strictly below 50% of cycle profit. Exactly 50% does not satisfy the wording of the payout policy.", "أفضل يوم لازم يكون أقل من 50% من ربح الدورة. نسبة 50% بالضبط لا تستوفي النص الرسمي لسياسة السحب."),
    t("Keep the full safety net (drawdown + $100) throughout the PA lifetime. Only profits above it can be requested, with a $500 minimum.", "لازم يظل كامل هامش الأمان (حد الخسارة + $100) طوال عمر PA. تسحب الأرباح فوقه فقط، وبحد أدنى $500."),
    t("The cap changes with payout number. The trader keeps 100% of an approved sim payout. A PA ends after its sixth payout.", "السقف يتغير حسب رقم السحب. حصتك 100% من سحب المحاكاة الموافق عليه. تنتهي PA بعد السحب السادس."),
  ],
  cautions: [
    t("After requesting, treat the money as already deducted. Falling below the required threshold can cause denial.", "بعد تقديم الطلب اعتبر المبلغ مخصوماً. النزول تحت الرصيد المطلوب ممكن يسبب رفض السحب."),
    t("Cross-account hedging and prohibited conduct can close accounts. A later live invitation has separate terms.", "التحوّط المتعاكس بين الحسابات والسلوك المحظور ممكن يغلق الحساب. الدعوة لاحقاً إلى Live لها شروط منفصلة."),
  ],
  payout: { mode: "above-buffer", share: 100, days: 5, consistency: 50, strictConsistency: true, maxPayouts: 6 },
  sources: [intraday ? intraSource : eodSource, intraday ? intraPay : eodPay],
}));

export const apex: PropFirm = {
  slug: "apex", name: "Apex Trader Funding", short: "AP", accent: "#F08268", market: t("Futures", "عقود مستقبلية"), website: "https://apextraderfunding.com/",
  description: t("Choose EOD or Intraday. See the exact safety net and all six payout caps.", "اختار EOD أو Intraday، وشوف هامش الأمان وسقف كل واحدة من السحوبات الستة."),
  programs,
  receiving: [
    t("Dashboard → Account Details → choose PA → Payout → Request Payout. Add your method under payout settings, enter the amount and confirm the agreement.", "لوحة الشركة ← Account Details ← اختار PA ← Payout ← Request Payout. أضف طريقة الاستلام بالإعدادات، اكتب المبلغ وأكّد الاتفاقية."),
    t("US users receive ACH deposits. International users use Plane: the first approved payout triggers an invitation to connect a local bank. Method availability depends on country and verification.", "داخل أمريكا الاستلام عبر ACH. خارج أمريكا عبر Plane: بعد أول موافقة تصلك دعوة لربط بنكك المحلي. التوافر حسب البلد والتحقق."),
    t("The payment-method article estimates review within 2 business days and 5–11 business days overall. Check Payout History and your provider; these are estimates, not the qualifying trading-day count.", "صفحة طرق الدفع تقدّر المراجعة خلال يومي عمل ووصول الدفعة خلال 5–11 يوم عمل إجمالاً. تابع Payout History ومزوّد الدفع؛ هذه تقديرات وليست عدد أيام التداول المؤهلة."),
  ],
  important: [
    t("Have a Legacy account? Do not use the new-account calculator. Legacy needs 8 trading days, including 5 days of $50+, and a 30% consistency rule until the sixth payout. Safety-net and cap exceptions differ.", "عندك Legacy؟ لا تستخدم حاسبة الحسابات الجديدة. Legacy يحتاج 8 أيام تداول منها 5 أيام بربح $50+، واتساق 30% حتى السحب السادس. استثناءات هامش الأمان والسقف مختلفة."),
    t("Legacy: first-five caps are $1,500 / $2,000 / $2,500 / $2,750 for 25K / 50K / 100K / 150K. First $25,000 paid per account uses a 100% split, then 90%. Read Legacy rules for its $500 safety-net exception and other sizes.", "Legacy: سقف أول خمسة سحوبات هو $1,500 / $2,000 / $2,500 / $2,750 لأحجام 25K / 50K / 100K / 150K. أول $25,000 مدفوعة لكل حساب حصتها 100% وبعدها 90%. راجع Legacy لاستثناء $500 من هامش الأمان والأحجام الأخرى."),
  ],
  sources: [eodSource,eodPay,intraSource,intraPay,legacyPay,{title:"Payout request steps",url:base+"additional-helpful-items/how-to-request-a-payout/"},{title:"Payment methods & delivery estimates",url:base+"additional-helpful-items/payout-method-information/"},{title:"Current configured prices",url:"https://apextraderfunding.com/"}],
};
