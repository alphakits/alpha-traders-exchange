import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";

export function LearningNextStep({ locale, completed = false }: { locale: string; completed?: boolean }) {
  const isAr = locale === "ar";
  return <section className="rounded-3xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-6">
    <p className="text-xs font-semibold uppercase tracking-wider text-[#C9A227]">
      {completed ? (isAr ? "أكملت دروس هذا المسار" : "This track is complete") : (isAr ? "خطوتك التالية، باختيارك" : "Your next step, your choice")}
    </p>
    <h2 className="mt-3 text-xl font-semibold">{isAr ? "ابدأ مجانًا. تعلّم مع مارك عندما تكون جاهزًا." : "Start free. Learn with Mark when you’re ready."}</h2>
    <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr
      ? "الدورة المجانية تبقى مجانية. بعد إكمالها، يمكنك الاستفسار عن تعليم مباشر مدفوع مع مارك يناسب أهدافك. تعرف على المحتوى والمواعيد والسعر قبل اتخاذ أي قرار؛ إرسال الاستفسار مجاني ولا يحجز مقعدًا."
      : "The free course stays free. After completing it, you can enquire about optional paid teaching with Mark for your learning goals. See the content, schedule and price before deciding. An enquiry is free and does not reserve a place."}</p>
    <div className="mt-5 flex flex-wrap gap-3">
      <Link href="/learn-with-mark#interest" className={buttonVariants({ variant: "secondary", className: "w-full sm:w-auto whitespace-normal text-center" })}>
        {isAr ? "استكشف التعليم المدفوع مع مارك" : "Explore Paid Learning with Mark"}
      </Link>
      {completed ? <Link href="/academy" className={buttonVariants({ variant: "ghost", className: "w-full sm:w-auto" })}>
        {isAr ? "تابع التعلّم المجاني" : "Keep Learning for Free"}
      </Link> : null}
    </div>
  </section>;
}
