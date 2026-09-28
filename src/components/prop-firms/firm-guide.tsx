"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { BadgeDollarSign, BookOpen, CalendarCheck, Check, ChevronDown, Copy, ExternalLink, Flag, Info, Landmark, ListChecks, Shield, Target, Wallet } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { currencyText } from "@/components/ui/currency-text";
import { REVIEWED_ON, usd, type Localized, type PropFirm } from "@/lib/prop-firms/types";
import { PayoutCalculator } from "./payout-calculator";
import s from "./prop-firms.module.css";

function Panel({ title, icon, children, open, id }: { title: string; icon: ReactNode; children: ReactNode; open?: boolean; id?: string }) {
  return <details className={s.panel} open={open} id={id}><summary>{icon}<span>{title}</span><ChevronDown className={s.chevron} /></summary><div className={s.panelBody}>{children}</div></details>;
}

export function FirmGuide({ firm, navigation, locale, initialProgram, initialSize }: { firm: PropFirm; navigation: { slug: string; name: string }[]; locale: "ar" | "en"; initialProgram?: string; initialSize?: number }) {
  const ar = locale === "ar";
  const choose = (en: string, arabic: string) => ar ? arabic : en;
  const initial = firm.programs.find(p => p.id === initialProgram) ?? firm.programs[0];
  const [programId, setProgramId] = useState(initial.id);
  const [size, setSize] = useState(initial.tiers.find(t => t.size === initialSize)?.size ?? initial.tiers.find(t => t.size === 50000)?.size ?? initial.tiers[0].size);
  const [billing, setBilling] = useState("standard");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const program = firm.programs.find(p => p.id === programId)!;
  const tier = program.tiers.find(t => t.size === size) ?? program.tiers[0];
  const direct = tier.targets.length === 0;
  const topstep = firm.slug === "topstep";
  const currentPrice = topstep && billing === "no-activation" ? tier.noActivationPrice : tier.price;
  const sources = [...new Map([...program.sources, ...firm.sources].map(source => [source.url, source])).values()];
  function select(programValue: string, sizeValue: number) {
    const next = firm.programs.find(p => p.id === programValue)!;
    const nextSize = next.tiers.find(t => t.size === sizeValue)?.size ?? next.tiers[0].size;
    setProgramId(programValue); setSize(nextSize); setCopied(false);
    const url = new URL(window.location.href);
    url.searchParams.set("program", programValue); url.searchParams.set("size", String(nextSize));
    window.history.replaceState(null, "", url.toString());
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  const list = (items: Localized[]) => <ul className={s.bullets}>{items.map((item, i) => <li key={i}>{currencyText(item[locale])}</li>)}</ul>;
  const fact = (label: string, value: ReactNode) => <div className={s.fact}><dt>{label}</dt><dd>{value}</dd></div>;
  return <div className={s.guide} dir={ar ? "rtl" : "ltr"} style={{ "--accent": firm.accent } as CSSProperties}>
    <nav className={s.firmNav} aria-label={choose("Prop firm guides", "أدلة الشركات المموّلة")}>
      <Link href="/prop-firms"><Landmark size={14} />{choose("All firms", "كل الشركات")}</Link>
      {navigation.map(f => <Link key={f.slug} href={`/prop-firms/${f.slug}`} aria-current={f.slug === firm.slug ? "page" : undefined}>{f.name === "My Funded Futures" ? "MFFU" : f.name === "Apex Trader Funding" ? "Apex" : f.name}</Link>)}
    </nav>
    <header className={s.hero}>
      <p className={s.eyebrow}>{choose("THE ALPHA GUIDE", "دليل ألفا")}<span>•</span>{firm.market[locale]}</p>
      <div className={s.firmTitle}><span className={s.monogram}>{firm.short}</span><h1 dir="ltr">{firm.name}</h1></div>
      <p>{firm.description[locale]}</p>
      <div className={s.meta}><span><CalendarCheck size={14} />{choose("Reviewed", "آخر مراجعة")} <time dateTime={REVIEWED_ON}>28 Sep 2026</time></span><span><BookOpen size={14} />{choose("Linked to official rules", "مرتبط بالمصادر الرسمية")}</span></div>
      <div className={s.actions}>
        <a href="#payout-calculator" className={`${s.button} ${s.primary}`}><Wallet size={15} />{choose("Estimate my payout", "احسب سحبك")}</a>
        <a href={firm.website} target="_blank" rel="noopener noreferrer" className={s.button}>{choose("Official website", "موقع الشركة")}<ExternalLink size={14} /></a>
        <button className={s.button} onClick={copyLink}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? choose("Link copied", "تم نسخ الرابط") : choose("Share this guide", "شارك الدليل")}</button>
      </div>
      {copyError && <p role="status" className={s.error}>{choose("Copy the address from your browser to share this guide.", "انسخ الرابط من شريط المتصفح لمشاركة الدليل.")}</p>}
    </header>
    <section className={s.selector} aria-label={choose("Account selection", "اختيار الحساب")}>
      <div className={s.selectorGrid}>
        <label className={s.field} htmlFor="firm-program">{choose(topstep ? "01 · Funded payout path (XFA)" : "01 · Your program", topstep ? "01 · مسار السحب بالمموّل (XFA)" : "01 · برنامجك")}
          <select id="firm-program" value={program.id} onChange={event => select(event.target.value, tier.size)} dir="ltr">{firm.programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <div className={s.field}><span id="size-label">{choose("02 · Account size (USD)", "02 · حجم الحساب بالدولار")}</span><div className={s.sizes} role="group" aria-labelledby="size-label">{program.tiers.map(t => <button key={t.size} className={s.sizeButton} aria-pressed={t.size === tier.size} onClick={() => select(program.id, t.size)}>{t.size / 1000}K</button>)}</div></div>
      </div>
      <p className={s.selectedNote}><Info size={14} aria-hidden="true" />{currencyText(program.tagline[locale])}</p>
    </section>
    <div className={s.stats} aria-live="polite" aria-atomic="true">
      <div className={s.stat}><span className={s.statLabel}><Target size={14} />{direct ? choose("Account entry", "طريقة بدء الحساب") : choose("Evaluation target · phase 1", "هدف الامتحان · المرحلة الأولى")}</span><div className={s.statValue}>{tier.targets.length ? <span className={s.money}>{usd(tier.targets[0])}</span> : choose("Direct", "مباشر")}</div><small>{tier.targets[1] ? currencyText(choose(`Phase 2: ${usd(tier.targets[1])}`, `المرحلة الثانية: ${usd(tier.targets[1])}`)) : direct ? choose("No evaluation stage", "بدون مرحلة امتحان") : choose("See evaluation conditions below", "راجع شروط الامتحان تحت")}</small></div>
      <div className={s.stat}><span className={s.statLabel}><Shield size={14} />{choose("Maximum loss allowance", "هامش الخسارة القصوى")}</span><div className={s.statValue}><span className={s.money}>{usd(tier.maxLoss)}</span></div><small>{choose("The drawdown method matters", "طريقة احتساب الحد مهمة")}</small></div>
      <div className={s.stat}><span className={s.statLabel}><Wallet size={14} />{choose("Minimum request / profit", "أقل طلب / ربح مطلوب")}</span><div className={s.statValue}><span className={s.money}>{usd(tier.minPayout)}</span></div><small>{choose("Before method / cycle exceptions", "قبل استثناءات الطريقة والدورة")}</small></div>
      <div className={s.stat}><span className={s.statLabel}><BadgeDollarSign size={14} />{choose("Base trader share", "حصة المتداول الأساسية")}</span><div className={s.statValue}>{program.payout.share}%</div><small>{choose("Other cycles may use a different split", "قد تختلف مع دورة السحب")}</small></div>
    </div>
    <div className={s.content}>
      <div className={s.sections}>
        <Panel icon={<BadgeDollarSign />} title={choose("What does it cost?", "قديش تكلفة الحساب؟")} open>
          {topstep && <label className={s.field} htmlFor="topstep-billing">{choose("Combine billing path", "مسار دفع Combine")}<select id="topstep-billing" value={billing} onChange={event => setBilling(event.target.value)}><option value="standard">Standard · {choose("activation fee", "رسوم تفعيل")}</option><option value="no-activation">No Activation Fee · {choose("no activation charge", "بدون رسوم تفعيل")}</option></select></label>}
          {currentPrice !== undefined ? <div className={s.price}><span className={s.money}>{usd(currentPrice)}</span><small>{choose(topstep ? "/ month · base price" : "base price · one time", topstep ? "/ شهر · السعر الأساسي" : "سعر أساسي · مرة واحدة")}</small></div> : <p className={s.notice}>{choose("The current price is quoted in the official account selector. Check your size, platform and add-ons before payment.", "السعر الحالي يظهر باختيار الحساب على موقع الشركة. تأكد من الحجم والمنصة والإضافات قبل الدفع.")}</p>}
          {topstep && <p>{currencyText(choose(`Activation after passing: ${billing === "standard" ? "$149" : "$0"} per XFA.`, `التفعيل بعد النجاح: ${billing === "standard" ? "$149" : "$0"} لكل XFA.`))}</p>}
          {list([program.pricing, program.activation])}
          <a className={s.button} style={{ marginTop: 16 }} href={firm.website} target="_blank" rel="noopener noreferrer">{choose("Check the current quote", "افحص السعر الحالي")}<ExternalLink size={13} /></a>
        </Panel>
        <Panel icon={<Target />} title={direct ? choose("01 · Direct account rules", "01 · شروط الحساب المباشر") : choose("01 · How to pass", "01 · شو لازم للنجاح؟")} open id="evaluation-rules">
          <dl className={s.facts}>
            {tier.targets.map((target, i) => <div key={i} className={s.fact}><dt>{choose(`Phase ${i + 1} profit target`, `هدف ربح المرحلة ${i + 1}`)}</dt><dd><span className={s.money}>{usd(target)}</span></dd></div>)}
            {fact(choose("Maximum loss", "حد الخسارة الكلي"), <span className={s.money}>{usd(tier.maxLoss)}</span>)}
            {fact(choose(topstep ? "Optional DLL" : "Daily loss (initial allowance)", topstep ? "DLL اختياري" : "الخسارة اليومية (الهامش الابتدائي)"), tier.dailyLoss ? <span className={s.money}>{usd(tier.dailyLoss)}</span> : choose("No evaluation DLL", "بدون DLL بالامتحان"))}
            {tier.contracts && fact(choose("Evaluation contracts · minis", "عقود الامتحان · ميني"), tier.contracts)}
            {fact(direct ? choose("Evaluation stage", "مرحلة الامتحان") : choose("Minimum trading days", "أقل عدد أيام تداول"), program.evaluationDays[locale])}
          </dl>
          {list([program.evaluationConsistency, program.drawdown])}
        </Panel>
        <Panel icon={<Flag />} title={direct ? choose("02 · Starting your funded account", "02 · بداية الحساب المموّل") : choose("02 · After you pass", "02 · بعد النجاح، شو بصير؟")}>{list(program.funded)}</Panel>
        <Panel icon={<Wallet />} title={choose("03 · When and how much can I withdraw?", "03 · متى وقديش بقدر أسحب؟")} open id="payout-rules">
          {topstep && <p className={s.notice}>{currencyText(choose(`For the minimum ${usd(tier.minPayout)} request, the 50% rule needs at least ${usd(tier.minPayout * 2)} in XFA. You must ALSO complete the qualifying days and all conditions below. The full 50K/100K/150K is not a withdrawal balance.`, `لطلب أقل سحب ${usd(tier.minPayout)}، قاعدة 50% تحتاج رصيد XFA لا يقل عن ${usd(tier.minPayout * 2)}. لازم أيضاً تكمل الأيام المؤهّلة وكل الشروط تحت. حجم 50K/100K/150K ليس رصيد سحب.`))}</p>}
          {firm.slug === "apex" && <p className={s.notice}>{currencyText(choose(`First minimum request: ${usd(tier.buffer + tier.minPayout)} profit, meaning a balance of ${usd(tier.size + tier.buffer + tier.minPayout)}. This is the amount threshold; qualifying days and consistency are required too.`, `أول طلب بالحد الأدنى يحتاج ربح ${usd(tier.buffer + tier.minPayout)}، يعني رصيد ${usd(tier.size + tier.buffer + tier.minPayout)}. هذا حد المبلغ فقط؛ الأيام المؤهّلة والاتساق مطلوبان أيضاً.`))}</p>}
          {firm.slug === "my-funded-futures" && program.id.startsWith("builder") && <p className={s.notice}>{currencyText(choose(`First minimum request: ${usd(tier.buffer + tier.minPayout)} funded profit (${usd(tier.buffer)} buffer + ${usd(tier.minPayout)} request). Timing and program rules below also apply.`, `أول طلب بالحد الأدنى يحتاج ${usd(tier.buffer + tier.minPayout)} ربح بالمموّل (${usd(tier.buffer)} هامش + ${usd(tier.minPayout)} طلب سحب). لازم أيضاً تستوفي الوقت وشروط البرنامج تحت.`))}</p>}
          {firm.slug === "my-funded-futures" && program.id.startsWith("rapid") && <p className={s.notice}>{currencyText(choose(`First reach ${usd(tier.buffer)} in realized funded profit to unlock payouts; a request must be at least ${usd(tier.minPayout)}. Confirm the withdrawable amount in the dashboard after the buffer unlock.`, `أولاً توصل ${usd(tier.buffer)} ربح محقق بالمموّل لفتح السحب؛ أقل طلب ${usd(tier.minPayout)}. بعد فتح الهامش تأكد من المبلغ القابل للسحب بلوحة الشركة.`))}</p>}
          {tier.buffer > 0 && <p className={s.notice}>{currencyText(choose(`This account's reference buffer: ${usd(tier.buffer)}. Read the first-payout and later-cycle conditions below.`, `هامش الربح المرجعي لهذا الحساب: ${usd(tier.buffer)}. راجع الفرق بين أول سحب والدورات التالية تحت.`))}</p>}
          {list(program.payoutDetails)}
          {tier.dailyProfit && <p className={s.notice}>{currencyText(choose(`Qualifying day for this size: at least ${usd(tier.dailyProfit)} net profit.`, `اليوم المؤهّل لهذا الحجم: صافي ربح ${usd(tier.dailyProfit)} على الأقل.`))}</p>}
          {tier.caps && <table className={s.capTable}><caption className="sr-only">{choose("Payout caps", "سقوف السحب")}</caption><thead><tr><th>{choose("Payout request", "طلب السحب")}</th><th>{choose("Maximum gross request", "أعلى طلب قبل تقسيم الأرباح")}</th></tr></thead><tbody>{tier.caps.map((cap, i) => <tr key={i}><td>{tier.caps!.length === 1 ? choose("Each eligible request", "كل طلب مستوفٍ للشروط") : `#${i + 1}`}</td><td><span className={s.money}>{usd(cap)}</span></td></tr>)}</tbody></table>}
          {topstep && <p className={s.subtle} style={{ fontSize: 11, marginTop: 10 }}>{choose("Table shows ordinary caps. The qualifying DLL promotion can double these caps; the 50% balance limit still applies.", "الجدول يعرض السقوف العادية. عرض DLL المؤهّل قد يضاعفها، مع بقاء حد 50% من الرصيد.")}</p>}
        </Panel>
        <Panel icon={<Landmark />} title={choose("04 · Where the money arrives", "04 · كيف ووين بتستلم المصاري؟")}>{list(firm.receiving)}</Panel>
        <Panel icon={<ListChecks />} title={choose("Rules you should not miss", "قواعد مهم ما تفوتك")}>{list([...program.cautions, ...firm.important])}</Panel>
        <Panel icon={<BookOpen />} title={choose("Official sources & review date", "المصادر الرسمية وتاريخ المراجعة")}>
          <p className={s.subtle}>{choose("Reviewed on 28 September 2026. Prices, availability and account versions can change. This guide does not automatically update when a firm changes its terms.", "تمت المراجعة في 28 سبتمبر 2026. الأسعار والتوافر ونسخ الحسابات ممكن تتغير. الدليل لا يتحدث تلقائياً عند تغيير الشركة لشروطها.")}</p>
          <ul className={s.sourceList}>{sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer"><span dir="ltr">{source.title}</span><ExternalLink size={14} /></a></li>)}</ul>
        </Panel>
      </div>
      <PayoutCalculator key={`${program.id}-${tier.size}`} firm={firm} program={program} tier={tier} locale={locale} />
    </div>
    <section className={s.glossary}>
      <h2 className={s.sectionTitle}>{choose("Three terms, made clear.", "3 مصطلحات، ببساطة.")}</h2>
      <dl className={s.glossaryGrid}>
        <div><dt>DLL · {choose("Daily Loss Limit", "حد الخسارة اليومية")}</dt><dd>{choose("A limit for one trading day. Depending on the firm, reaching it can pause the session or breach the account. No DLL does not mean no loss limit.", "حد الخسارة خلال يوم تداول واحد. حسب الشركة، بلوغه يوقف الجلسة أو يخالف الحساب. بدون DLL لا يعني بدون حد خسارة.")}</dd></div>
        <div><dt>Drawdown · {choose("Loss threshold", "حد التراجع")}</dt><dd>{choose("The floor your account must stay above. A static floor stays fixed; a trailing floor moves with specified balance or equity highs. EOD refers to end-of-day updates.", "الحد الذي لازم يظل حسابك فوقه. الثابت لا يتحرك؛ والمتحرك يرتفع مع أعلى رصيد أو إيكويتي حسب القاعدة. EOD يعني تحديث نهاية اليوم.")}</dd></div>
        <div><dt>Consistency · {choose("Profit consistency", "اتساق الأرباح")}</dt><dd>{choose("Limits how much one day contributes to profit. The denominator and reset date differ by program, so the same percentage can mean different things.", "تحدد قديش مسموح يوم واحد يشكّل من الأرباح. أساس الحساب وموعد إعادة العدّ مختلفان حسب البرنامج؛ نفس النسبة مش دائماً نفس القاعدة.")}</dd></div>
      </dl>
    </section>
  </div>;
}
