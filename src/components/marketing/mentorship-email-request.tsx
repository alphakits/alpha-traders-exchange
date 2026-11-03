"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { fetchClientJson } from "@/lib/client-request-deadline";
import { isMentorshipEmailRequestEnabled } from "@/lib/mentorship-email-config";
import type { AppLocale } from "@/i18n/routing";
import styles from "./mentorship-email-request.module.css";

const ENDPOINT = "/api/marketing/mentorship-invitation";
const STATUS_NAMES = ["available", "unverified", "held", "declined", "queued", "sending", "sent", "delivered", "failed", "uncertain", "unsubscribed", "expired"] as const;
type InvitationStatusName = typeof STATUS_NAMES[number];
type InvitationStatus = {
  status: InvitationStatusName;
  canRequest: boolean;
  maskedEmail: string;
  consentVersion: string;
  consentText: string;
};

function readStatus(value: unknown): InvitationStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (!STATUS_NAMES.includes(data.status as InvitationStatusName)
    || typeof data.canRequest !== "boolean"
    || typeof data.maskedEmail !== "string"
    || typeof data.consentVersion !== "string"
    || typeof data.consentText !== "string") return null;
  return data as InvitationStatus;
}

const STATUS_COPY: Record<Exclude<InvitationStatusName, "available">, { en: string; ar: string }> = {
  unverified: { en: "Verify your account email before requesting the invitation.", ar: "أكّد بريد حسابك الإلكتروني قبل طلب الدعوة." },
  held: { en: "We cannot send the invitation to this address. You can still read the offer on the website.", ar: "ما منقدر نبعت الدعوة لهالبريد. بتقدر تشوف العرض على الموقع." },
  declined: { en: "No invitation email requested.", ar: "ما طلبت الدعوة بالبريد الإلكتروني." },
  queued: { en: "Your request is saved. We will send one invitation once the delivery checks pass.", ar: "حفظنا طلبك. منبعت لك دعوة واحدة بعد التأكد من إمكانية الإرسال." },
  sending: { en: "Your invitation is being sent. You do not need to request it again.", ar: "عم نبعت الدعوة. ما في داعي تطلبها مرة تانية." },
  sent: { en: "Your invitation has been submitted for delivery.", ar: "تم تسليم الدعوة لخدمة البريد لإرسالها." },
  delivered: { en: "Your mail provider accepted the invitation. Check your inbox or spam folder.", ar: "استلم مزوّد بريدك الدعوة. شوف صندوق الوارد أو البريد غير المرغوب فيه." },
  failed: { en: "The invitation could not be sent. You can still read the offer on the website.", ar: "تعذّر إرسال الدعوة. بتقدر تشوف العرض على الموقع." },
  uncertain: { en: "We are checking the result of your request. Please check its status before requesting again.", ar: "عم نتأكد من نتيجة طلبك. تحقّق من حالته قبل ما تطلبه مرة تانية." },
  unsubscribed: { en: "This address is unsubscribed. We will not send this invitation.", ar: "تم إلغاء الاشتراك لهالبريد. ما رح نبعت له هالدعوة." },
  expired: { en: "This invitation is no longer available by email.", ar: "انتهت فترة طلب هالدعوة بالبريد الإلكتروني." },
};

export function MentorshipEmailRequest({ locale, compact = false }: { locale: AppLocale; compact?: boolean }) {
  const session = useOptionalCanonicalSession();
  if (!isMentorshipEmailRequestEnabled() || !session?.user || session.isResolving || session.error) return null;
  return <AccountInvitationRequest key={`${session.user.id}:${session.user.email}:${session.user.emailVerified === true}`} locale={locale} compact={compact} userId={session.user.id} />;
}

function AccountInvitationRequest({ locale, compact, userId }: { locale: AppLocale; compact: boolean; userId: string }) {
  const isAr = locale === "ar";
  const titleId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(!compact);
  const [status, setStatus] = useState<InvitationStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsStatusCheck, setNeedsStatusCheck] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const scope = useRef<AbortController | null>(null);
  const mutationInFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      setChecked(false);
      try {
        const result = await fetchClientJson<unknown>(`${ENDPOINT}?locale=${locale}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal, headers: { "x-alpha-expected-user-id": userId } });
        const data = readStatus(result.payload);
        if (!result.response.ok || !data) throw new Error("status_unavailable");
        if (!controller.signal.aborted) { setStatus(data); setNeedsStatusCheck(false); }
      } catch {
        if (!controller.signal.aborted) setError(isAr ? "تعذّر التحقق من حالة الطلب. حاول مرة أخرى." : "We could not check your request. Please try again.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [isAr, locale, open, readAttempt, userId]);

  async function submit(action: "request" | "decline") {
    const controller = scope.current;
    if (!controller || controller.signal.aborted || mutationInFlight.current || loading || needsStatusCheck || !status?.canRequest) return;
    if (action === "request" && (!checked || !status.consentVersion || !status.consentText)) return;
    mutationInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchClientJson<unknown>(ENDPOINT, {
          method: "POST", credentials: "same-origin", signal: controller.signal,
          headers: { "Content-Type": "application/json", "x-alpha-expected-user-id": userId },
          body: JSON.stringify(action === "request"
            ? { action, locale, consentVersion: status.consentVersion, consent: true }
            : { action, locale }),
      }, 20_000);
      const data = readStatus(result.payload);
      if (!data || (!result.response.ok && result.response.status !== 409)) throw new Error("request_unconfirmed");
      if (!controller.signal.aborted) { setStatus(data); setChecked(false); }
    } catch {
      if (!controller.signal.aborted) {
        setChecked(false);
        setNeedsStatusCheck(true);
        setError(isAr ? "ما قدرنا نتأكد من نتيجة الطلب. تحقّق من حالته قبل المحاولة من جديد." : "We could not confirm the result. Check the request status before trying again.");
      }
    } finally {
      mutationInFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void submit("request"); }
  const statusMessage = status && status.status !== "available" ? STATUS_COPY[status.status][locale] : null;
  const canChoose = status?.canRequest === true && !loading && !needsStatusCheck && !error;

  return (
    <div className={compact ? styles.compact : styles.card} dir={isAr ? "rtl" : "ltr"}>
      {compact ? <button type="button" className={styles.trigger} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
        <Mail size={15} aria-hidden="true" />{isAr ? "ابعتوا لي الدعوة بالبريد" : "Email me this invitation"}
      </button> : null}
      {open ? <section id={panelId} className={styles.panel} aria-labelledby={titleId} aria-busy={loading || busy}>
        <h2 id={titleId} className={styles.title}>{isAr ? "دعوة المنتورشيب على بريدك" : "The mentorship invitation in your inbox"}</h2>
        <p className={styles.description}>{isAr ? "اطلب رسالة واحدة عن عرض ICT Mentorship المدفوع. الخيار إلك، وإعدادات حسابك الثانية بتضل متل ما هي." : "Request one email about the paid ICT mentorship offer. This is optional and leaves your other account settings as they are."}</p>
        {status?.maskedEmail ? <p className={styles.recipient}>{isAr ? "إلى بريد حسابك: " : "To your account email: "}<bdi dir="ltr">{status.maskedEmail}</bdi></p> : null}
        {loading ? <p className={styles.message} role="status">{isAr ? "عم نتحقق من حالة الطلب…" : "Checking request status…"}</p> : null}
        {!loading && statusMessage ? <p className={styles.message} role="status">{statusMessage}</p> : null}
        {!loading && status?.status === "unverified" ? <a className={styles.link} href={`/${locale}/verify-email`}>{isAr ? "تأكيد البريد الإلكتروني" : "Verify email"}</a> : null}
        {canChoose ? <form onSubmit={onSubmit} className={styles.form}>
          <label className={styles.consent}>
            <input type="checkbox" required checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />
            <span>{status.consentText}</span>
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={!checked || busy}>{busy ? (isAr ? "عم نحفظ اختيارك…" : "Saving your choice…") : (isAr ? "ابعتوا لي الدعوة" : "Send me the invitation")}</button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void submit("decline")}>{isAr ? "بدون إيميل، شكرًا" : "No email, thanks"}</button>
          </div>
        </form> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {(!loading && (error || needsStatusCheck || status?.status === "uncertain" || status?.status === "queued" || status?.status === "sending" || status?.status === "sent")) ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => setReadAttempt(value => value + 1)}>{isAr ? "تحقّق من حالة الطلب" : "Check request status"}</button> : null}
      </section> : null}
    </div>
  );
}
