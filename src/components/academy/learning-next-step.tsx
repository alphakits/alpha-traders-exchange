import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";

export function LearningNextStep({ locale, completed = false }: { locale: string; completed?: boolean }) {
  const isAr = locale === "ar";
  return <section className="rounded-3xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-6">
    <p className="text-xs font-semibold uppercase tracking-wider text-[#C9A227]">
      {completed ? (isAr ? "أكملت دروس هذا المسار" : "This track is complete") : (isAr ? "خطوتك التالية، باختيارك" : "Your next step, your choice")}
    </p>
    <h2 className="mt-3 text-xl font-semibold">{isAr ? "خطوتك التالية: ICT Mentorship مع مارك" : "Your next step: ICT Mentorship with Mark"}</h2>
    <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr
      ? "الدورة المجانية تبقى مجانية. إذا أردت التعمّق، استكشف ICT Mentorship: دراسة وتطبيق وأسئلة ومراجعة مع مارك. المنتورشيب برنامج منفصل برسوم؛ تعرف على نطاقه ومواعيده وسعره قبل اتخاذ أي قرار."
      : "The free course stays free. When you want to go deeper, explore ICT Mentorship: study, practice, questions and review with Mark. Mentorship is a separate programme with a fee; review its scope, schedule and price before deciding."}</p>
    <div className="mt-5 flex flex-wrap gap-3">
      <Link href="/learn-with-mark#interest" className={buttonVariants({ variant: "secondary", className: "w-full sm:w-auto whitespace-normal text-center" })}>
        {isAr ? "استفسر عن ICT Mentorship" : "Ask About ICT Mentorship"}
      </Link>
      <Link href="/learn-with-mark#mark-explains" className={buttonVariants({ variant: "ghost", className: "w-full sm:w-auto whitespace-normal text-center" })}>
        {isAr ? "اسمع شرح مارك · 7:44" : "Hear Mark’s Approach · 7:44"}
      </Link>
      {completed ? <Link href="/academy" className={buttonVariants({ variant: "ghost", className: "w-full sm:w-auto" })}>
        {isAr ? "تابع التعلّم المجاني" : "Keep Learning for Free"}
      </Link> : null}
    </div>
  </section>;
}
