"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AppLocale } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/navigation";
import { MentorshipLink } from "@/components/academy/mentorship-link";
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

const increaseAt = mentorshipBoundaries[1];

function secondsUntilIncrease() {
  return Math.max(0, Math.ceil((increaseAt - Date.now()) / 1_000));
}

function subscribeToCountdown(change: () => void) {
  let timer: number | undefined;
  function sync() {
    window.clearTimeout(timer);
    change();
    const remaining = increaseAt - Date.now();
    if (remaining > 0 && !document.hidden) {
      timer = window.setTimeout(sync, remaining % 1_000 || 1_000);
    }
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

function Countdown({ isAr }: { isAr: boolean }) {
  // Server and hydration use placeholders, then the visitor gets the real time.
  const seconds = useSyncExternalStore<number | null>(subscribeToCountdown, secondsUntilIncrease, () => null);
  const remaining = seconds ?? 0;
  const units = [
    { label: isAr ? "أيام" : "Days", value: Math.floor(remaining / 86_400) },
    { label: isAr ? "ساعات" : "Hrs", value: Math.floor(remaining / 3_600) % 24 },
    { label: isAr ? "دقائق" : "Min", value: Math.floor(remaining / 60) % 60 },
    { label: isAr ? "ثواني" : "Sec", value: remaining % 60 },
  ];

  return (
    <span className={styles.clock} dir="ltr" role="timer" aria-live="off"
      aria-label={isAr ? "الوقت المتبقي لزيادة السعر" : "Time until the price increase"}>
      {units.map(({ label, value }) => (
        <span key={label} className={styles.unit}>
          <b>{seconds === null ? "––" : String(value).padStart(2, "0")}</b>
          <small>{label}</small>
        </span>
      ))}
    </span>
  );
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
  const title = isAr ? "ICT Mentorship مع مارك" : "ICT mentorship with Mark";
  const detail = november
    ? (isAr ? "السعر بزيد 10% يوم 1 ديسمبر" : "Price increases 10% on December 1")
    : (isAr ? "السعر الجديد بزيادة 10% صار ساري · التسجيل حتى 31 ديسمبر" : "The new +10% price is in effect · Enrol by Dec 31");
  const action = november
    ? (isAr ? "انضم بالسعر الحالي" : "Join at today’s price")
    : (isAr ? "تفاصيل المنتورشيب" : "View mentorship");

  return (
    <aside className={styles.band} data-mentorship-announcement={phase}
      aria-label={isAr ? "إعلان المنتورشيب" : "Mentorship announcement"}>
      <div className={styles.inner}>
        <div className={styles.copy}>
          <div className={styles.titleRow}>
            <strong>{title}</strong>
            <bdi className={styles.badge} dir="ltr">+10%</bdi>
          </div>
          <span className={styles.detail}>{detail}</span>
        </div>
        {november && <Countdown isAr={isAr} />}
        <MentorshipLink locale={locale} href={onOffer ? "/mentorship-offer#offer-details" : "/mentorship-offer"}
          replace={onOffer} className={styles.action}>
          {action}
        </MentorshipLink>
      </div>
    </aside>
  );
}
