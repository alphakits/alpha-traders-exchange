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

const minute = 60_000;

function minutesUntilIncrease() {
  return Math.max(0, Math.ceil((increaseAt - Date.now()) / minute));
}

function subscribeToCountdown(change: () => void) {
  let timer: number | undefined;
  function sync() {
    window.clearTimeout(timer);
    change();
    const remaining = increaseAt - Date.now();
    if (remaining > 0 && !document.hidden) {
      timer = window.setTimeout(sync, remaining % minute || minute);
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
  const remaining = useSyncExternalStore<number | null>(subscribeToCountdown, minutesUntilIncrease, () => null);
  const days = remaining === null ? "–" : Math.floor(remaining / 1_440);
  const hours = remaining === null ? "–" : Math.floor(remaining / 60) % 24;
  const minutes = remaining === null ? "–" : remaining % 60;

  return (
    <span className={styles.clock} dir={isAr ? "rtl" : "ltr"} role="timer" aria-live="off"
      aria-label={isAr ? "الوقت المتبقي لزيادة السعر" : "Time until the price increase"}>
      {isAr ? `${days}ي ${hours}س ${minutes}د` : `${days}d ${hours}h ${minutes}m`}
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
  const price = isAr
    ? <>السعر <bdi dir="ltr">+10%</bdi>{november && " في 1 ديسمبر"}</>
    : november ? "Price +10% Dec 1" : "Price +10%";
  const action = november ? (isAr ? "انضم" : "Join") : (isAr ? "التفاصيل" : "Details");

  return (
    <aside className={styles.band} data-mentorship-announcement={phase}
      aria-label={isAr ? "إعلان المنتورشيب" : "Mentorship announcement"}>
      <div className={styles.inner}>
        <div className={styles.copy}>
          <strong className={styles.title}>{title}</strong>
          <div className={styles.detail}>
            <span className={styles.price}>{price}</span>
            <span aria-hidden="true">·</span>
            {november ? <Countdown isAr={isAr} /> : <span>{isAr ? "التسجيل حتى 31 ديسمبر" : "Enrol by Dec 31"}</span>}
          </div>
        </div>
        <MentorshipLink locale={locale} href={onOffer ? "/mentorship-offer#offer-details" : "/mentorship-offer"}
          replace={onOffer} className={styles.action}>
          {action} <span aria-hidden="true">{isAr ? "←" : "→"}</span>
        </MentorshipLink>
      </div>
    </aside>
  );
}
