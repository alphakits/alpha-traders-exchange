"use client";

import { useState, type FormEvent } from "react";
import { Calculator, CheckCircle2, CircleAlert, Info } from "lucide-react";
import { currencyText } from "@/components/ui/currency-text";
import { calculatePayout, type PayoutInputs } from "@/lib/prop-firms/calculator";
import { usd, type AccountTier, type FirmProgram, type PropFirm } from "@/lib/prop-firms/types";
import s from "./prop-firms.module.css";

type Values = Record<"profit" | "cycleProfit" | "bestDay" | "days" | "payoutNumber" | "requested" | "fee" | "dashboardAvailable", string>;

export function PayoutCalculator({ firm, program, tier, locale }: { firm: PropFirm; program: FirmProgram; tier: AccountTier; locale: "en" | "ar" }) {
  const ar = locale === "ar";
  const t = (en: string, arabic: string) => ar ? arabic : en;
  const dashboard = program.payout.mode === "dashboard";
  const topstep = program.payout.mode === "topstep";
  const [values, setValues] = useState<Values>({ profit: "", cycleProfit: "", bestDay: "", days: "", payoutNumber: "1", requested: "", fee: "0", dashboardAvailable: "" });
  const [dll, setDll] = useState(false);
  const [share, setShare] = useState(program.payout.share);
  const [result, setResult] = useState<ReturnType<typeof calculatePayout> | null>(null);
  const [error, setError] = useState("");
  const showCycle = !dashboard && (program.payout.consistency !== undefined || (program.payout.positiveCycleRequired && Number(values.payoutNumber) > 1));
  function field(key: keyof Values, label: string, hint?: string, full?: boolean) {
    return <label className={`${s.field} ${full ? s.fullWidth : ""}`} htmlFor={`payout-${key}`}>
      {currencyText(label)}
      <input id={`payout-${key}`} type="number" inputMode={key === "days" || key === "payoutNumber" ? "numeric" : "decimal"} min={key === "payoutNumber" ? 1 : 0} max={key === "days" || key === "payoutNumber" ? 10000 : 1e9} step={key === "days" || key === "payoutNumber" ? 1 : ".01"} dir="ltr" required value={values[key]} onChange={e => { setValues(v => ({ ...v, [key]: e.target.value })); setResult(null); setError(""); }} />
      {hint && <small>{currencyText(hint)}</small>}
    </label>;
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const required: (keyof Values)[] = dashboard ? ["dashboardAvailable", "requested", "fee"] : ["profit", "days", "payoutNumber", "requested", "fee", ...(showCycle ? ["cycleProfit" as const] : []), ...(program.payout.consistency ? ["bestDay" as const] : [])];
    if (required.some(key => !values[key].trim())) { setError(t("Complete the required fields.", "عبّي الحقول المطلوبة.")); return; }
    const numeric = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)]));
    const input: PayoutInputs = { ...numeric, profit: dashboard ? Number(values.dashboardAvailable) : Number(values.profit), days: Number(values.days), cycleProfit: Number(values.cycleProfit), bestDay: Number(values.bestDay), elapsedDays: 0, payoutNumber: Number(values.payoutNumber), requested: Number(values.requested), fee: Number(values.fee), dashboardAvailable: Number(values.dashboardAvailable), dllPromotion: dll };
    const computed = calculatePayout({ ...program, payout: { ...program.payout, share } }, tier, input);
    setResult(computed);
    setError(computed.valid ? "" : t("Check the amounts and whole day counts. Fees cannot exceed your share; a positive-profit cycle needs a positive best day.", "راجع المبالغ وعدد الأيام الصحيح. الرسوم لا تتجاوز حصتك، ودورة الربح الموجبة تحتاج يوماً رابحاً."));
  }
  const checkLabel = (id: string) => {
    if (id === "days") return tier.dailyProfit ? t(`${program.payout.days} qualifying days, each ≥${usd(tier.dailyProfit)}`, `${program.payout.days} أيام مؤهّلة، كل يوم ≥${usd(tier.dailyProfit)}`) : t(`${program.payout.days} trading days completed`, `إكمال ${program.payout.days} أيام تداول`);
    if (id === "consistency") return t(`Best day ${program.payout.strictConsistency ? "<" : "≤"}${program.payout.consistency}% of cycle net profit`, `أفضل يوم ${program.payout.strictConsistency ? "<" : "≤"}${program.payout.consistency}% من صافي ربح الدورة`);
    if (id === "cycle") return t("Positive net profit since the last payout", "صافي ربح موجب منذ آخر سحب");
    if (id === "count") return t(`Within the ${program.payout.maxPayouts}-payout limit`, `ضمن حد ${program.payout.maxPayouts} سحوبات`);
    if (id === "profit") return t("Enough available profit for a minimum request", "ربح متاح يكفي لأقل طلب سحب");
    return t("Requested amount is within the numerical limits", "المبلغ المطلوب ضمن الحدود العددية");
  };
  return <aside className={s.calculator} id="payout-calculator" aria-label={t("Payout calculator", "حاسبة السحب")}>
    <h2><Calculator />{dashboard ? t("What would I receive?", "قديش بصلك صافي؟") : t("Check your payout", "احسب سحبك")}</h2>
    <p className={s.calcIntro}>{dashboard ? t("Use the gross amount available BEFORE the company split, as confirmed in your official dashboard. This estimates your net payment; it does not determine eligibility.", "أدخل المبلغ المتاح قبل حصة الشركة، بعد تأكيده من لوحة حسابك الرسمية. هذا تقدير للصافي؛ لا يقرر أهلية السحب.") : t("A numerical check for the selected funded program. Enter your current figures, not your evaluation profit or advertised account size.", "فحص عددي للبرنامج المموّل المختار. أدخل أرقامك الحالية، وليس أرباح الامتحان أو حجم الحساب المعلن.")}</p>
    <form onSubmit={submit}>
      <div className={s.formGrid}>
        {dashboard ? field("dashboardAvailable", t("Gross available in dashboard ($)", "المتاح قبل حصة الشركة ($)"), t("If the dashboard shows net, do not apply the split a second time.", "إذا المعروض صافي، لا تخصم حصة الشركة مرة ثانية."), true) : field("profit", t(topstep ? "Current XFA balance ($)" : "Current balance minus account size ($)", topstep ? "رصيد XFA الحالي ($)" : "الرصيد الحالي ناقص حجم الحساب ($)"), t(topstep ? "XFA starts at $0." : "Example: $53,000 − $50,000 = $3,000. Include previous withdrawals in the current balance.", topstep ? "XFA يبدأ من $0." : "مثال: $53,000 − $50,000 = $3,000. استخدم الرصيد الحالي بعد السحوبات السابقة."), true)}
        {!dashboard && field("payoutNumber", t("Payout number", "رقم السحب"))}
        {!dashboard && field("days", tier.dailyProfit ? t(`Days with ≥${usd(tier.dailyProfit)} net`, `أيام بربح ≥${usd(tier.dailyProfit)}`) : t("Trading days in this cycle", "أيام التداول بهذه الدورة"))}
        {showCycle && field("cycleProfit", t("Net profit this cycle ($)", "صافي ربح هذه الدورة ($)"), t("Profit since the cycle began, before this request.", "الربح منذ بداية الدورة وقبل هذا الطلب."))}
        {!dashboard && program.payout.consistency !== undefined && field("bestDay", t("Best day this cycle ($)", "أفضل يوم بهذه الدورة ($)"))}
        {topstep && <label className={`${s.field} ${s.fullWidth}`} htmlFor="payout-dll">{t("DLL payout-cap offer", "عرض سقف السحب مع DLL")}
          <select id="payout-dll" value={dll ? "qualified" : "ordinary"} onChange={e => { setDll(e.target.value === "qualified"); setResult(null); }}>
            <option value="ordinary">{t("Ordinary cap / not confirmed", "السقف العادي / غير مؤكد")}</option><option value="qualified">{t("My purchase confirms the doubled cap", "طلب شرائي يؤكد السقف المضاعف")}</option>
          </select><small>{t("Only a qualifying new Combine bought with the promotional DLL. Personal DLL or adding it at XFA does not qualify.", "فقط Combine جديد مؤهّل مع DLL ضمن العرض. الحد الشخصي أو إضافته عند XFA لا يكفي.")}</small>
        </label>}
        {dashboard && <label className={`${s.field} ${s.fullWidth}`} htmlFor="payout-share">{t("Your actual trader share", "حصتك الفعلية حسب دورة السحب")}<select id="payout-share" value={share} onChange={e => { setShare(Number(e.target.value)); setResult(null); }}>{[60, 80, 85, 90, 95, 100].map(value => <option key={value} value={value}>{value}%</option>)}</select><small>{t("Use the ratio from your purchased program and chosen reward cycle.", "اختَر النسبة المكتوبة لبرنامجك ودورة مكافأتك.")}</small></label>}
        {field("requested", t("Gross amount to request ($)", "المبلغ المطلوب قبل التقسيم ($)"))}
        {field("fee", t("Transfer fees ($)", "رسوم التحويل ($)"), t("Enter the actual fee; 0 is not a fee guarantee.", "أدخل الرسوم الفعلية؛ الصفر لا يعني التحويل مجاني."))}
      </div>
      <button type="submit" className={`${s.button} ${s.primary}`}><Calculator size={16} />{t("Calculate", "احسب النتيجة")}</button>
      {error && <p role="alert" className={s.error}>{error}</p>}
    </form>
    <div aria-live="polite" aria-atomic="true">
      {result?.valid && <div className={s.result}>
        <p className={s.resultTitle} data-pass={result.withinNumbers && !dashboard}>{dashboard ? <Info size={17} /> : result.withinNumbers ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}{dashboard ? t("Estimate based on your inputs", "تقدير حسب الأرقام المدخلة") : result.withinNumbers ? t("The numerical conditions are met", "الشروط العددية المدخلة مستوفاة") : t("Some numerical conditions are not met", "في شروط عددية لسه مش مستوفاة")}</p>
        <div className={s.resultLine}><span>{t("Maximum gross in this estimate", "أعلى طلب بهذا الحساب")}</span><strong className={s.money}>{usd(result.max)}</strong></div>
        {result.withinNumbers ? <>
          <div className={`${s.resultLine} ${s.net}`}><span>{t("Estimated net to you", "الصافي التقديري إلك")}</span><strong className={s.money}>{usd(result.net)}</strong></div>
          <p className={s.calcFoot}>{currencyText(`${usd(Number(values.requested))} × ${share}% − ${usd(Number(values.fee))} = ${usd(result.net)}`)}</p>
          {!dashboard && <div className={s.resultLine}><span>{topstep ? t("XFA balance remaining", "رصيد XFA المتبقي") : t("Profit left above starting size", "الربح المتبقي فوق حجم الحساب")}</span><strong className={s.money}>{usd(result.remaining)}</strong></div>}
        </> : dashboard && <p className={s.error}>{t(`Check that the request is at least ${usd(tier.minPayout)} and within the displayed gross amount and program cap.`, `تأكد أن الطلب ${usd(tier.minPayout)} على الأقل وضمن المتاح المعروض وسقف البرنامج.`)}</p>}
        {!dashboard && result.checks.map(check => <p key={check.id} className={s.check} data-pass={check.passed}>{check.passed ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}{currencyText(checkLabel(check.id))}</p>)}
        <p className={s.calcFoot}>{dashboard ? t("Check the reward date, minimum for your payment method and all account rules in the dashboard. This is not a payout approval.", "تأكد بلوحة الشركة من موعد المكافأة والحد الأدنى لطريقة الاستلام وباقي شروط الحساب. النتيجة ليست موافقة على السحب.") : t("This checks the entered numbers only. Account reviews, trading conduct, KYC and current contract terms can still affect approval.", "الفحص للأرقام المدخلة فقط. مراجعة الحساب وقواعد التداول والتحقق وشروط العقد الحالية تؤثر على الموافقة.")}</p>
      </div>}
    </div>
    {!result && <p className={s.calcFoot}>{topstep ? t("Withdrawing changes your loss cushion. After the first payout, the XFA loss floor is $0.", "السحب يغيّر هامش خسارتك. بعد أول سحب يصبح حد الخسارة في XFA هو $0.") : firm.slug === "apex" ? t("New EOD / Intraday accounts only. The safety net must remain after your payout. Legacy accounts use different rules.", "لحسابات EOD وIntraday الجديدة فقط. هامش الأمان لازم يبقى بعد السحب. حسابات Legacy لها قواعد مختلفة.") : t("Use the payout section for the full conditions before entering an available amount.", "راجع قسم السحب للشروط الكاملة قبل إدخال المبلغ المتاح.")}</p>}
  </aside>;
}
