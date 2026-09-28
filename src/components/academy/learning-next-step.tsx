import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";

export function LearningNextStep({ locale, completed = false }: { locale: string; completed?: boolean }) {
  const isAr = locale === "ar";
  return <section className="rounded-3xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-6">
    <p className="text-xs font-semibold uppercase tracking-wider text-[#C9A227]">
      {completed ? (isAr ? "أكملت دروس هذا المسار" : "This track is complete") : (isAr ? "خطوتك التالية، باختيارك" : "Your next step, your choice")}
    </p>
    <h2 className="mt-3 text-xl font-semibold">{isAr ? "تعرّف على ICT Mentorship مع مارك" : "Explore ICT Mentorship with Mark"}</h2>
    <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr
      ? "تعلّمت تداول ولسه عندك أسئلة بالتطبيق؟ تعرّف على طريقة مارك بالدراسة والتطبيق ومراجعة القرارات. ICT Mentorship برنامج واحد برسوم حسب نقطة البداية. اسمع شرحه وشوف المنهج والرسوم وحالة استقبال الاستفسارات قبل قرارك. الأكاديمية المجانية بتضل مجانية."
      : "Studied trading but still have questions about applying it? Explore Mark’s approach to study, practice and reviewing decisions. ICT Mentorship is one programme, with tuition based on your starting point. Hear his explanation and review the curriculum, fees and enquiry availability before deciding. The free Academy stays free."}</p>
    <div className="mt-5 flex flex-wrap gap-3">
      <Link href="/learn-with-mark" className={buttonVariants({ variant: "secondary", className: "w-full sm:w-auto whitespace-normal text-center" })}>
        {isAr ? "تعرّف على الكورس والمرافقة" : "Explore the Course & Support"}
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
