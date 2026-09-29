"use client";

import { useEffect, useState } from "react";
import { Gift, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { learningCampaignLink, learningCampaignUrl } from "@/lib/learning-campaign";
import styles from "./learning-share-actions.module.css";

export function LearningShareActions({ locale, destination = "mentorship", referralReward = false }: {
  locale: string;
  destination?: "academy" | "mentorship";
  referralReward?: boolean;
}) {
  const language = locale === "ar" ? "ar" : "en";
  const isAr = language === "ar";
  const showReward = destination === "mentorship" && referralReward;
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

  return <section aria-label={isAr ? "شارك التعلّم مع صديق" : "Share learning with a friend"} className={showReward ? styles.reward : "rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-6"}>
    {showReward ? <>
      <div className={styles.eyebrow}><Gift size={18} aria-hidden="true" />{isAr ? "توصية منك، مكافأة إلك" : "Your recommendation. Your reward."}</div>
      <div className={styles.offer}>
        <div>
          <h2 className={styles.heading}>{isAr ? "عندك صديق حاب يتعلّم؟" : "Know someone who wants to learn?"}</h2>
          <p className={styles.description}>{isAr ? "صاحبك، قريبك أو أي حدا مهتم بالتداول… شاركه الكورس، وخليه يتعرّف على التعليم مع مارك." : "A friend, a relative or someone interested in trading — share the course and introduce them to learning with Mark."}</p>
        </div>
        <div className={styles.amountPanel}>
          <span className={styles.rewardLabel}>{isAr ? "مكافأتك" : "Your reward"}</span>
          <span className={`${styles.amount} currency-money`} dir="ltr"><span className={styles.currency}>₪</span>1,200</span>
          <span className={styles.perPerson}>{isAr ? "عن كل شخص بيسجّل عن طريقك" : "For every person who enrols through you"}</span>
        </div>
      </div>
      <ol className={styles.steps} aria-label={isAr ? "كيف بتحصل على المكافأة" : "How to receive your reward"}>
        {[
          { title: isAr ? "شارك الكورس" : "Share the course", text: isAr ? "ابعث الرابط للي حاب يتعلّم." : "Send the link to someone who wants to learn." },
          { title: isAr ? "خليه يذكر اسمك" : "Ask them to mention you", text: isAr ? "وقت التسجيل، يحكي لمارك إنه من طرفك." : "When enrolling, they tell Mark you referred them." },
          { title: isAr ? "استلم مكافأتك" : "Receive your reward", text: isAr ? "بعد تأكيد تسجيله بالكورس مع مارك." : "Once their course enrolment with Mark is confirmed." },
        ].map((step, index) => <li key={index}><span className={styles.stepNumber} aria-hidden="true">{index + 1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}
      </ol>
      <p className={styles.repeat}><Sparkles size={17} aria-hidden="true" /><span>{isAr ? "مش بس أول مرة — المكافأة بتتكرر مع كل شخص جديد بيسجّل عن طريقك." : "Every enrolment counts. Receive the reward again for each new person who enrols through you."}</span></p>
    </> : <>
      <h2 className="text-lg font-semibold">{isAr ? "عندك صديق حاب يتعلّم؟" : "Know someone who wants to learn?"}</h2>
      <p className="mt-2 text-sm leading-7 text-[#D1D5DB]">{isAr ? "شارك معه نقطة بداية مفيدة. يقدر يسمع الشرح، يستكشف المنهج ويختار خطوته بنفسه." : "Share a useful starting point. Let them explore the teaching and choose their own next step."}</p>
    </>}
    <div className={showReward ? styles.actions : "mt-4 flex flex-wrap gap-3"}>
      <a href={`https://wa.me/?text=${encodeURIComponent(`${description}\n\n${url}`)}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: showReward ? "default" : "secondary", className: "whitespace-normal text-center" })}>{isAr ? "شارك على واتساب" : "Share on WhatsApp"}</a>
      <button type="button" onClick={copyLink} className={buttonVariants({ variant: "secondary" })}>{isAr ? "انسخ الرابط" : "Copy link"}</button>
      {canShare ? <button type="button" onClick={share} disabled={busy} className={buttonVariants({ variant: "ghost" })}>{isAr ? "خيارات المشاركة" : "More share options"}</button> : null}
    </div>
    <p role="status" aria-live="polite" className="mt-3 text-sm text-[#D1D5DB]">{feedback === "copied" ? (isAr ? "تم نسخ الرابط." : "Link copied.") : feedback === "fallback" ? (isAr ? "يمكنك تحديد الرابط أدناه ونسخه، أو استخدام واتساب." : "Select and copy the link below, or use WhatsApp.") : ""}</p>
    {feedback === "fallback" ? <input aria-label={isAr ? "رابط المشاركة" : "Share link"} readOnly value={url} dir="ltr" onFocus={event => event.currentTarget.select()} className="mt-2 w-full min-w-0 rounded-lg border border-white/20 bg-black p-3 text-base" /> : null}
    <p className="mt-2 text-xs leading-6 text-white/50">{isAr ? "أنت تختار المستلم. رابط المشاركة لا يحتوي على بيانات حسابك أو استفسارك." : "You choose the recipient. The shared link contains no account or enquiry details."}</p>
  </section>;
}
