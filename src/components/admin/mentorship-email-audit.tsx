"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { MarketingEmailAudit, MarketingEmailAuditRecipient } from "@/lib/marketing-email-ledger";

const AUDIT_PATH = "/api/alpha-exchange/admin/marketing-email-audit";
const STATUS_LABELS: Record<string, [string, string]> = {
  pending: ["Awaiting permission", "بانتظار الموافقة"],
  queued: ["Queued", "بانتظار الإرسال"],
  sending: ["Sending", "جارٍ الإرسال"],
  sent: ["Sent · delivery unconfirmed", "أُرسل · الوصول غير مؤكّد"],
  delivered: ["Delivered", "وصل"],
  failed: ["Failed", "فشل الإرسال"],
  uncertain: ["Outcome needs review", "النتيجة بحاجة لمراجعة"],
  held: ["On hold", "موقوف"],
  cancelled: ["Cancelled before sending", "أُلغي قبل الإرسال"],
  expired: ["Offer expired", "انتهى العرض"],
};
const CONSENT_LABELS: Record<string, [string, string]> = {
  none: ["No permission recorded", "لا توجد موافقة مسجّلة"],
  requested: ["One-time email requested", "طُلبت الرسالة لمرة واحدة"],
  declined: ["Declined", "رُفض الطلب"],
  withdrawn: ["Permission withdrawn", "سُحبت الموافقة"],
  legacy_newsletter: ["Existing newsletter subscription", "اشتراك سابق بالنشرة"],
  owner_preview: ["Owner preview only", "معاينة للمالك فقط"],
};
const EVENT_LABELS: Record<string, [string, string]> = {
  consent_requested: ["One-time email requested", "طُلبت الرسالة لمرة واحدة"],
  send_attempt: ["Send attempted", "جرت محاولة الإرسال"],
  sent: ["Accepted by email provider", "استلمها مزوّد البريد للإرسال"],
  delivered: ["Delivery confirmed", "تأكّد الوصول"],
  owner_preview_delivered: ["Owner preview delivered", "وصلت معاينة المالك"],
  retry_scheduled: ["Retry scheduled", "حُدّدت إعادة محاولة"],
  declined: ["Invitation declined", "رُفضت الدعوة"],
  unsubscribed: ["Unsubscribed", "أُلغي الاشتراك"],
  bounced: ["Message bounced", "ارتدّت الرسالة"],
  suppressed: ["Delivery suppressed", "أُوقف الإرسال"],
  complained: ["Spam complaint recorded", "سُجّل بلاغ بريد مزعج"],
  failed: ["Send failed", "فشل الإرسال"],
  uncertain: ["Send outcome uncertain", "نتيجة الإرسال غير مؤكّدة"],
};

function isAudit(value: unknown): value is MarketingEmailAudit {
  if (!value || typeof value !== "object") return false;
  const audit = value as Partial<MarketingEmailAudit>;
  return typeof audit.campaignId === "string" && typeof audit.checkedAt === "string"
    && typeof audit.shown === "number" && typeof audit.truncated === "boolean"
    && !!audit.counts && typeof audit.counts === "object" && Number.isInteger(audit.counts.total)
    && Object.values(audit.counts).every(count => Number.isInteger(count) && count >= 0)
    && Array.isArray(audit.recipients)
    && audit.recipients.every(row => typeof row.id === "string" && typeof row.email === "string"
      && typeof row.status === "string" && typeof row.consentStatus === "string"
      && Array.isArray(row.holdCodes) && Array.isArray(row.events));
}

function auditTime(value: string | null, isArabic: boolean) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(isArabic ? "ar-IL" : "en-GB", {
    timeZone: "UTC", dateStyle: "medium", timeStyle: "short",
  }).format(date);
}

function RecipientActivity({ row, isArabic }: { row: MarketingEmailAuditRecipient; isArabic: boolean }) {
  const t = (en: string, ar: string) => isArabic ? ar : en;
  const dates: Array<[string, string | null]> = [
    [t("Requested", "طُلبت"), row.requestedAt],
    [t("First attempt", "أول محاولة"), row.firstAttemptAt],
    [t("Sent", "أُرسلت"), row.sentAt],
    [t("Delivered", "وصلت"), row.deliveredAt],
    [t("Updated", "آخر تحديث"), row.updatedAt],
  ];
  return <details>
    <summary className="cursor-pointer rounded py-2 text-[#F4D978] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A227]">
      {t("View recorded activity", "عرض النشاط المسجّل")}
    </summary>
    <dl className="mt-2 space-y-2 text-xs">
      {dates.map(([label, value]) => <div key={label}>
        <dt className="text-[#9CA3AF]">{label}</dt>
        <dd className="mt-1 whitespace-nowrap">{auditTime(value, isArabic)}</dd>
      </div>)}
      {row.consentVersion ? <div><dt className="text-[#9CA3AF]">{t("Permission text version", "نسخة نص الموافقة")}</dt><dd className="break-all" dir="ltr">{row.consentVersion}</dd></div> : null}
    </dl>
    {row.events.length ? <ol className="mt-3 space-y-3 border-s border-white/15 ps-3">
      {row.events.map((event, index) => <li key={`${event.type}:${event.occurredAt}:${index}`} className="text-xs">
        <p className="break-words">{EVENT_LABELS[event.type]?.[isArabic ? 1 : 0] ?? event.type}</p>
        {event.occurredAt ? <p className="mt-1 text-[#9CA3AF]">{t("Occurred", "وقت الحدث")}: {auditTime(event.occurredAt, isArabic)}</p> : null}
        <p className="mt-1 text-[#9CA3AF]">{t("Observed", "وقت التأكّد")}: {auditTime(event.observedAt, isArabic)}</p>
        <p className="mt-1 break-words">{t("Source", "المصدر")}: {event.source}</p>
        {event.reason ? <p className="mt-1 break-words">{event.reason}</p> : null}
      </li>)}
    </ol> : <p className="mt-3 text-xs text-[#9CA3AF]">{t("No event history recorded.", "لا يوجد سجل أحداث.")}</p>}
  </details>;
}

/** The API authorizes every read. Recipient data is never persisted to browser storage. */
export function MentorshipEmailAudit() {
  const isArabic = useLocale() === "ar";
  const t = (en: string, ar: string) => isArabic ? ar : en;
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const [audit, setAudit] = useState<MarketingEmailAudit | null>(null);
  const [readState, setReadState] = useState<"idle" | "loading" | "ready" | "error" | "forbidden">("idle");
  const [search, setSearch] = useState("");
  const controller = useRef<AbortController | null>(null);

  const cancelRead = useCallback(() => {
    const current = controller.current;
    controller.current = null;
    current?.abort();
  }, []);

  const load = useCallback(async () => {
    cancelRead();
    const current = new AbortController();
    controller.current = current;
    setAudit(null);
    setReadState("loading");
    const timeout = window.setTimeout(() => {
      if (controller.current === current) {
        controller.current = null;
        setReadState("error");
      }
      current.abort();
    }, 15_000);
    try {
      const response = await fetch(AUDIT_PATH, {
        method: "GET", credentials: "same-origin", cache: "no-store", signal: current.signal,
      });
      if (controller.current !== current) return;
      if (response.status === 401 || response.status === 403) {
        setReadState("forbidden");
        return;
      }
      if (!response.ok) throw new Error("Audit unavailable");
      const payload: unknown = await response.json();
      if (current.signal.aborted || controller.current !== current) return;
      if (!isAudit(payload)) throw new Error("Invalid audit");
      setAudit(payload);
      setReadState("ready");
    } catch {
      if (controller.current === current) setReadState("error");
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === current) controller.current = null;
    }
  }, [cancelRead]);

  useEffect(() => {
    if (!open) return;
    void load();
    return cancelRead;
  }, [open, load, cancelRead]);

  useEffect(() => {
    const clearPrivateData = () => {
      cancelRead(); setAudit(null); setSearch(""); setOpen(false); setReadState("forbidden");
    };
    window.addEventListener("alpha-auth-signed-out", clearPrivateData);
    return () => { window.removeEventListener("alpha-auth-signed-out", clearPrivateData); cancelRead(); };
  }, [cancelRead]);

  const label = (labels: Record<string, [string, string]>, value: string) => labels[value]?.[isArabic ? 1 : 0] ?? value;
  const query = search.trim().toLowerCase();
  const rows = audit?.recipients.filter(row => !query || row.email.toLowerCase().includes(query)) ?? [];

  return <Card className="border-[#C9A227]/25 bg-[#0B0B0B]/90" dir={isArabic ? "rtl" : "ltr"}>
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("Mentorship email audit", "سجل بريد برنامج الإرشاد")}</CardTitle>
          <CardDescription className="mt-2">{t("Owner-only permission and delivery records for this campaign.", "سجل الموافقات ووصول رسائل هالحملة، للمالك فقط.")}</CardDescription>
        </div>
        <Button variant="secondary" size="sm" aria-expanded={open} aria-controls={contentId} onClick={() => {
          if (open) { cancelRead(); setAudit(null); setSearch(""); setReadState("idle"); }
          setOpen(!open);
        }}>{open ? t("Hide audit", "إخفاء السجل") : t("Open email audit", "فتح سجل البريد")}</Button>
      </div>
    </CardHeader>
    {open ? <CardContent id={contentId} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm leading-6 text-[#9CA3AF]">{t(
          "Sent means the email provider accepted the message. Delivered requires separate delivery evidence. Times are shown in UTC; — means no timestamp was recorded.",
          "أُرسل يعني إن مزوّد البريد استلم الرسالة للإرسال. وصولها بدّه تأكيد منفصل. الأوقات بتوقيت UTC، و— يعني ما في وقت مسجّل.",
        )}</p>
        <Button variant="secondary" size="sm" disabled={readState === "loading"} onClick={() => void load()}>
          {readState === "loading" ? t("Refreshing…", "جارٍ التحديث…") : t("Refresh audit", "تحديث السجل")}
        </Button>
      </div>
      {readState === "loading" ? <p role="status" className="text-sm text-[#9CA3AF]">{t("Loading email audit…", "جارٍ تحميل سجل البريد…")}</p> : null}
      {readState === "forbidden" ? <p role="alert" className="text-sm text-amber-200">{t("Sign in with the owner account to view this audit.", "سجّل دخول بحساب المالك لعرض هالسجل.")}</p> : null}
      {readState === "error" ? <p role="alert" className="text-sm text-amber-200">{t("The audit is temporarily unavailable. Refresh to try again.", "السجل مش متاح حاليًا. حدّث للمحاولة من جديد.")}</p> : null}
      {audit ? <>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#D1D5DB]">
          <p>{t("Campaign recipients", "مستلمو الحملة")}: <strong className="text-white">{audit.counts.total ?? "—"}</strong></p>
          <p>{t("Checked", "آخر قراءة")}: {auditTime(audit.checkedAt, isArabic)} UTC</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Object.entries(STATUS_LABELS).filter(([status]) => (audit.counts[status] ?? 0) > 0 || ["pending", "sent", "delivered", "held"].includes(status)).map(([status]) => <div key={status} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs text-[#9CA3AF]">{label(STATUS_LABELS, status)}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-white">{audit.counts[status] ?? 0}</dd>
          </div>)}
        </dl>
        {audit.truncated ? <p role="status" className="text-sm text-amber-200">{t(`Showing the latest ${audit.shown} of ${audit.counts.total} recipients. Counts cover the full campaign.`, `ظاهر آخر ${audit.shown} من ${audit.counts.total} مستلم. العدادات بتشمل الحملة كاملة.`)}</p> : null}
        <label className="block max-w-md space-y-2 text-sm text-[#D1D5DB]">
          <span>{t("Find an email address", "البحث عن بريد إلكتروني")}</span>
          <Input dir="ltr" type="search" value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" />
        </label>
        <div className="max-h-[36rem] overflow-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[1080px] text-start text-sm text-[#D1D5DB]">
            <caption className="sr-only">{t("Private campaign permission and delivery records", "سجل خاص بموافقات الحملة ووصول الرسائل")}</caption>
            <thead className="sticky top-0 z-10 bg-[#171717] text-xs text-[#9CA3AF]"><tr>
              {[t("Email", "البريد"), t("Delivery status", "حالة الإرسال"), t("Permission", "الموافقة"), t("Reason / hold", "السبب / الإيقاف"), t("Provider reference", "مرجع مزوّد البريد"), t("Activity · UTC", "النشاط · UTC")].map(heading => <th key={heading} scope="col" className="px-4 py-3 text-start font-medium">{heading}</th>)}
            </tr></thead>
            <tbody>{rows.map(row => <tr key={row.id} className="border-t border-white/10 align-top">
              <th scope="row" className="max-w-64 break-all px-4 py-4 text-start font-normal text-white" dir="ltr">{row.email}</th>
              <td className="px-4 py-4">
                <span className={row.status === "delivered" ? "text-emerald-300" : row.status === "held" || row.status === "failed" || row.status === "uncertain" ? "text-amber-200" : "text-[#D1D5DB]"}>{label(STATUS_LABELS, row.status)}</span>
                {row.status === "delivered" && !row.deliveredAt ? <p className="mt-2 text-xs leading-5 text-[#9CA3AF]">{t("Delivery confirmed; exact time unavailable.", "الوصول مؤكّد؛ الوقت الدقيق غير متاح.")}</p> : null}
              </td>
              <td className="px-4 py-4">{label(CONSENT_LABELS, row.consentStatus)}</td>
              <td className="max-w-64 px-4 py-4">
                {row.lastReason ? <p className="break-words">{row.lastReason}</p> : null}
                {row.holdCodes.length ? <ul className="mt-1 space-y-1 text-xs text-amber-200">{row.holdCodes.map(code => <li key={code} className="break-words">{code}</li>)}</ul> : null}
                {!row.lastReason && !row.holdCodes.length ? "—" : null}
              </td>
              <td className="max-w-56 px-4 py-4 text-xs">
                <p className="text-[#9CA3AF]">{t("Message", "الرسالة")}</p><p className="mt-1 break-all" dir="ltr">{row.providerEmailId ?? "—"}</p>
                {row.providerCampaignId ? <><p className="mt-3 text-[#9CA3AF]">{t("Campaign", "الحملة")}</p><p className="mt-1 break-all" dir="ltr">{row.providerCampaignId}</p></> : null}
              </td>
              <td className="min-w-56 px-4 py-2"><RecipientActivity row={row} isArabic={isArabic} /></td>
            </tr>)}</tbody>
          </table>
          {!rows.length ? <p className="p-4 text-sm text-[#9CA3AF]">{query ? t("No matching address in these records.", "ما في بريد مطابق بهالسجل.") : t("No recipients recorded for this campaign yet.", "لسّه ما في مستلمين مسجّلين لهالحملة.")}</p> : null}
        </div>
      </> : null}
    </CardContent> : null}
  </Card>;
}
