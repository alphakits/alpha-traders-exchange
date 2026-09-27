"use client";

import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { learningCampaignLink, learningCampaignUrl } from "@/lib/learning-campaign";

export function LearningShareActions({ locale, destination = "mentorship" }: {
  locale: string;
  destination?: "academy" | "mentorship";
}) {
  const language = locale === "ar" ? "ar" : "en";
  const isAr = language === "ar";
  const [canShare, setCanShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"copied" | "fallback" | null>(null);
  // Fixed public links: never share the current URL, account identifiers or form values.
  const url = learningCampaignUrl(learningCampaignLink(destination === "academy" ? "friend_academy" : "friend_mentorship")!, language);
  const title = destination === "academy" ? "Alpha Traders · Free Trading Education" : "ICT Mentorship with Mark · Alpha Traders";
  const description = destination === "academy"
    ? (isAr ? "تعرّف على دورة Alpha Traders المجانية. استكشف المنهج وابدأ بالأساسيات." : "Explore the free Alpha Traders course. See the curriculum and start with the foundations.")
    : (isAr ? "تعلّمت تداول ولسه عندك أسئلة بالتطبيق؟ تعرّف على ICT Mentorship مع مارك: اسمع شرحه الأصلي وشوف المنهج والرسوم. الأكاديمية المجانية متاحة كمان." : "Studied trading but still have questions about applying it? Explore ICT Mentorship with Mark: hear his original explanation and see the curriculum and tuition. The free Academy is available too.");

  useEffect(() => { setCanShare(typeof navigator.share === "function"); }, []);

  async function copyLink() {
    setFeedback(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setFeedback("copied");
    } catch { setFeedback("fallback"); }
  }

  async function share() {
    if (busy) return;
    setFeedback(null);
    setBusy(true);
    try {
      await navigator.share({ title, text: description, url });
      // The platform resolving this promise is not evidence of a sent message.
    } catch (error) {
      if (!(error && typeof error === "object" && "name" in error && error.name === "AbortError")) setFeedback("fallback");
    } finally { setBusy(false); }
  }

  return <section aria-label={isAr ? "شارك التعلّم مع صديق" : "Share learning with a friend"} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
    <h2 className="text-lg font-semibold">{isAr ? "عندك صديق حاب يتعلّم؟" : "Know someone who wants to learn?"}</h2>
    <p className="mt-2 text-sm leading-7 text-[#D1D5DB]">{isAr ? "شارك معه نقطة بداية مفيدة. يقدر يسمع الشرح، يستكشف المنهج ويختار خطوته بنفسه." : "Share a useful starting point. Let them explore the teaching and choose their own next step."}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <a href={`https://wa.me/?text=${encodeURIComponent(`${description}\n\n${url}`)}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", className: "whitespace-normal text-center" })}>{isAr ? "شارك على واتساب" : "Share on WhatsApp"}</a>
      <button type="button" onClick={copyLink} className={buttonVariants({ variant: "secondary" })}>{isAr ? "انسخ الرابط" : "Copy link"}</button>
      {canShare ? <button type="button" onClick={share} disabled={busy} className={buttonVariants({ variant: "ghost" })}>{isAr ? "خيارات المشاركة" : "More share options"}</button> : null}
    </div>
    <p role="status" aria-live="polite" className="mt-3 text-sm text-[#D1D5DB]">{feedback === "copied" ? (isAr ? "تم نسخ الرابط." : "Link copied.") : feedback === "fallback" ? (isAr ? "يمكنك تحديد الرابط أدناه ونسخه، أو استخدام واتساب." : "Select and copy the link below, or use WhatsApp.") : ""}</p>
    {feedback === "fallback" ? <input aria-label={isAr ? "رابط المشاركة" : "Share link"} readOnly value={url} dir="ltr" onFocus={event => event.currentTarget.select()} className="mt-2 w-full min-w-0 rounded-lg border border-white/20 bg-black p-3 text-base" /> : null}
    <p className="mt-2 text-xs leading-6 text-white/50">{isAr ? "أنت تختار المستلم. رابط المشاركة لا يحتوي على بيانات حسابك أو استفسارك." : "You choose the recipient. The shared link contains no account or enquiry details."}</p>
  </section>;
}
