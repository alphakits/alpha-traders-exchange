"use client";

import { ArrowRight, GraduationCap } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AppLocale } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/navigation";
import { MentorshipLink } from "@/components/academy/mentorship-link";
import { MentorshipEmailRequest } from "@/components/marketing/mentorship-email-request";
import { mentorshipBoundaries, mentorshipPhase, type MentorshipPhase } from "@/lib/ict-mentorship-offer";
import styles from "./mentorship-announcement.module.css";

function subscribeToCampaign(change: () => void) {
  let timer: number | undefined;
  function sync() {
    window.clearTimeout(timer);
    change();
    const now = Date.now();
    const next = mentorshipBoundaries.find(boundary => boundary > now);
    // Browsers use a signed 32-bit timeout. A month can exceed that limit.
    if (next !== undefined) timer = window.setTimeout(sync, Math.min(next - now, 2_147_483_647));
  }
  sync();
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pageshow", sync);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("pageshow", sync);
  };
}

export function MentorshipAnnouncement({ locale, initialPhase }: { locale: AppLocale; initialPhase: MentorshipPhase }) {
  const phase = useSyncExternalStore(subscribeToCampaign, mentorshipPhase, () => initialPhase);
  const path = usePathname();
  const onOffer = path === "/mentorship-offer";
  const showsCampaignDetails = onOffer || path === "/learn-with-mark";
  const router = useRouter();
  const refreshed = useRef<MentorshipPhase | null>(null);
  useEffect(() => {
    if (phase === initialPhase) refreshed.current = null;
    else if (showsCampaignDetails && refreshed.current !== phase) {
      // Keep an open offer or course page in sync with the header at midnight.
      refreshed.current = phase;
      router.refresh();
    }
  }, [initialPhase, showsCampaignDetails, phase, router]);

  if (phase !== "november" && phase !== "december") return null;
  const isAr = locale === "ar";
  const november = phase === "november";
  const title = november
    ? (isAr ? "تعلّم التداول مع مارك" : "ICT mentorship with Mark")
    : (isAr ? "آخر دفعة منتورشيب مع مارك" : "Mark’s final ICT mentorship intake");
  const offer = november
    ? (isAr ? "خصم 10% حتى 30 نوفمبر" : "10% off through Nov 30")
    : (isAr ? "زيادة 10% على الأقل" : "Tuition up at least 10%");
  const detail = november
    ? (isAr ? "زيادة 10% على الأقل في ديسمبر" : "December prices rise at least 10%")
    : (isAr ? "التسجيل حتى 31 ديسمبر" : "Enrol by Dec 31");
  const phoneDetail = november ? (isAr ? "بديسمبر زيادة 10% أو أكثر" : "Dec prices up 10%+") : detail;
  return (
    <aside className={styles.band} data-mentorship-announcement={phase} aria-label={isAr ? "إعلان المنتورشيب" : "Mentorship announcement"}>
      <MentorshipLink locale={locale} href={onOffer ? "/mentorship-offer#offer-details" : "/mentorship-offer"} replace={onOffer} className={styles.link}>
        <span className={styles.emblem} aria-hidden="true"><GraduationCap size={18} strokeWidth={1.6} /></span>
        <span className={styles.copy}>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.terms}><span className={styles.offer}>{offer}</span><span className={styles.detail}><span className={styles.fullDetail}>{detail}</span><span className={styles.phoneDetail}>{phoneDetail}</span></span></span>
        </span>
        <span className={styles.action}><span>{isAr ? "تفاصيل العرض" : "View offer"}</span><ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" /></span>
      </MentorshipLink>
      {november && !onOffer ? <MentorshipEmailRequest locale={locale} compact /> : null}
    </aside>
  );
}
