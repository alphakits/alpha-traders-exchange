"use client";

import { useId, useState } from "react";
import { learningInformationReply } from "@/lib/learning-interest";
import { buttonVariants } from "@/components/ui/button";

export function LearningInformationReply({ locale }: { locale: "ar" | "en" }) {
  const [language, setLanguage] = useState(locale);
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "fallback">("idle");
  const id = useId();
  const isAr = locale === "ar";
  const text = learningInformationReply(language);

  async function copy() {
    setStatus("copying");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch { setStatus("fallback"); }
  }

  return <details className="rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-5">
    <summary className="cursor-pointer font-semibold">{isAr ? "رد جاهز لطلب معلومات عن ICT Mentorship" : "Ready reply for ICT Mentorship information"}</summary>
    <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr ? "يشمل المنهج والتسجيل والخطوة التالية. راجع الرد قبل إرساله للشخص الذي طلب المعلومات. النسخ لا يرسل رسالة ولا يغيّر حالة الطلب." : "Includes the curriculum, recording and next step. Review it before sending to someone who requested information. Copying does not send a message or change an enquiry’s status."}</p>
    <div className="my-4 flex flex-wrap gap-2" role="group" aria-label={isAr ? "لغة الرد" : "Reply language"}>
      {(["en", "ar"] as const).map(value => <button key={value} type="button" disabled={status === "copying"} aria-pressed={language === value} onClick={() => { setLanguage(value); setStatus("idle"); }} className={buttonVariants({ variant: language === value ? "default" : "secondary" })}>{value === "en" ? "English" : "العربية"}</button>)}
    </div>
    <label htmlFor={id} className="text-sm text-white/70">{isAr ? "نص الرد" : "Reply text"}</label>
    <textarea id={id} readOnly value={text} dir={language === "ar" ? "rtl" : "ltr"} rows={12} onFocus={event => event.currentTarget.select()} className="mt-2 block w-full min-w-0 rounded-xl border border-white/15 bg-[#111] p-3 text-base leading-7 text-[#D1D5DB]" />
    <button type="button" onClick={copy} disabled={status === "copying"} className={buttonVariants({ variant: "secondary", className: "mt-4" })}>{isAr ? "انسخ الرد" : "Copy reply"}</button>
    <p role="status" aria-live="polite" className="mt-3 text-sm text-[#E5CA77]">{status === "copied" ? (isAr ? "تم نسخ الرد. لم تُرسل رسالة." : "Reply copied. No message has been sent.") : status === "fallback" ? (isAr ? "تعذّر النسخ تلقائيًا. حدد نص الرد أعلاه وانسخه." : "Automatic copying was unavailable. Select and copy the reply above.") : ""}</p>
  </details>;
}
