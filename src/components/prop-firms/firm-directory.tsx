import type { CSSProperties } from "react";
import { ArrowUpRight, BookOpen, CalendarCheck, CheckCheck, Landmark, ShieldCheck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { propFirms, REVIEWED_ON } from "@/lib/prop-firms";
import s from "./prop-firms.module.css";

export function FirmDirectory({ locale }: { locale: "ar" | "en" }) {
  const ar = locale === "ar";
  return <div className={s.guide} dir={ar ? "rtl" : "ltr"}>
    <header className={s.hero}>
      <p className={s.eyebrow}><BookOpen size={16} />{ar ? "دليل ألفا • الشركات المموّلة" : "THE ALPHA GUIDE • PROP FIRMS"}</p>
      <div className={s.leadRow}><div>
        <h1>{ar ? <>افهم الشروط.<br /><span style={{ color: "#e6c876" }}>قبل أول صفقة.</span></> : <>Know the rules.<br /><span style={{ color: "#e6c876" }}>Before the first trade.</span></>}</h1>
        <p>{ar ? "من اختيار الحساب إلى أول سحب. اختَر شركتك، حدّد برنامجك، وخذ الأرقام والخطوات التي تحتاجها بمكان واحد." : "From choosing an account to your first payout. Pick a firm and a program for the numbers and steps that matter."}</p>
      </div><div className={s.heroIcon}><Landmark size={43} strokeWidth={1.2} /></div></div>
      <div className={s.meta}>
        <span><CheckCheck size={15} />{ar ? "5 شركات • شرح بالعربية والإنجليزية" : "5 firms • Arabic & English"}</span>
        <span><ShieldCheck size={15} />{ar ? "مصادر رسمية لكل برنامج" : "Official sources for every program"}</span>
        <span><CalendarCheck size={15} />{ar ? "مراجعة المعلومات:" : "Rules reviewed:"} <time dateTime={REVIEWED_ON}>28 Sep 2026</time></span>
      </div>
    </header>
    <h2 className={s.sectionTitle}>{ar ? "أي شركة بدك تفهمها؟" : "Which firm are you exploring?"}</h2>
    <p className={s.subtle}>{ar ? "الرسوم، الامتحان، حدود الخسارة، وشروط استلام أرباحك." : "Fees, evaluation targets, loss limits and the path to receiving your profits."}</p>
    <div className={s.cards}>
      {propFirms.map((firm, i) => <Link key={firm.slug} href={`/prop-firms/${firm.slug}`} className={s.firmCard} style={{ "--accent": firm.accent, animationDelay: `${i * 45}ms` } as CSSProperties}>
        <div className={s.cardTop}><span className={s.monogram}>{firm.short}</span><span className={s.tag}>{firm.market[locale]}</span></div>
        <h3 dir="ltr">{firm.name}</h3><p>{firm.description[locale]}</p>
        <div className={s.cardFoot}><span>{ar ? "افتح دليل الشركة" : "Explore the guide"}</span><ArrowUpRight size={19} aria-hidden="true" /></div>
      </Link>)}
      <div className={s.miniSteps}>
        <h3>{ar ? "كل الجواب، بثلاث خطوات." : "Three steps to clarity."}</h3>
        {[ar ? "اختَر الشركة والبرنامج." : "Choose a firm and program.", ar ? "حدّد حجم حسابك وافهم الشروط." : "Select your size. Understand the rules.", ar ? "احسب سحبك وافتح المصدر للتأكيد." : "Estimate your payout. Check the source."].map((v, i) => <p key={i}><span className={s.stepNumber}>{i + 1}</span>{v}</p>)}
      </div>
    </div>
    <p className={s.notice}>{ar ? "حجم الحساب المعلن هو قوة شرائية، وليس مبلغاً تقدر تسحبه. القواعد تعتمد على البرنامج وتاريخ الشراء؛ شروط حسابك الفعلية في لوحة الشركة هي المرجع عند اختلافها." : "The advertised account size is buying power, not cash you can withdraw. Rules depend on the program and purchase date; your own account’s terms take priority when they differ."}</p>
  </div>;
}

export function PropGuidePromo({ locale }: { locale: "ar" | "en" }) {
  const ar = locale === "ar";
  return <section className="section-container"><div className={s.promo}>
    <div><p className={s.eyebrow}><Landmark size={16} />{ar ? "دليل الشركات المموّلة" : "PROP FIRM GUIDES"}</p>
      <h2>{ar ? "من الامتحان لأول سحب. اعرف المطلوب." : "From evaluation to payout. Know what it takes."}</h2>
      <p>Topstep · My Funded Futures · Apex · FTMO · FundingPips</p>
    </div><Link href="/prop-firms" className={`${s.button} ${s.primary}`}>{ar ? "استكشف الشركات" : "Explore the firms"}<ArrowUpRight size={17} /></Link>
  </div></section>;
}
