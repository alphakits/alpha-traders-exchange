"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale } from "next-intl";
import { AlertTriangle, Bold, CheckCircle2, Italic, Link2, List, Loader2, Mail, Play, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AdminAnnouncementAudience, AdminAnnouncementStatus } from "@/types/alpha-exchange";
import { BRAND_NAME } from "@/lib/brand";
import { composeAdminAnnouncementEmailContent } from "@/lib/admin-announcement-email";

const DEFAULT_SUBJECT_AR = "🚀 أصبح Alpha Exchange متاحًا رسميًا – تجربة تداول أسرع وأكثر ذكاءً";
const DEFAULT_TITLE_AR = "أصبح Alpha Exchange v1.0.1 متاحًا رسميًا";
const DEFAULT_CONTENT_AR = `مرحبًا،

يسعدنا أن نعلن عن الإطلاق الرسمي لمنصة Alpha Exchange v1.0.1.

أضفنا تحسينات كبيرة في جميع أنحاء المنصة، ومنها:

• غرفة صفقات أسرع
• إشعارات فورية
• تحديثات عبر البريد الإلكتروني خلال مراحل الصفقة
• تجربة أفضل على الهاتف والكمبيوتر
• أداء أفضل للسوق
• خطوات تداول أسهل وأكثر سلاسة

شكرًا لكونك جزءًا من Alpha Exchange.`;

const DEFAULT_SUBJECT_EN = "🚀 Alpha Exchange is Officially Live – A Faster, Smarter Trading Experience";
const DEFAULT_TITLE_EN = "Alpha Exchange v1.0.1 Is Officially Live";
const DEFAULT_CONTENT_EN = `Hello,

We're excited to announce the official launch of Alpha Exchange v1.0.1.

We've introduced major improvements across the platform, including:

• Faster Trade Room
• Real-time notifications
• Lifecycle email updates
• Improved mobile and desktop experience
• Better marketplace performance
• Smoother trading workflow

Thank you for being part of Alpha Exchange.`;

const AUDIENCE_LABELS: Record<AdminAnnouncementAudience, { ar: string; en: string }> = {
  all_verified_users: { ar: "جميع المستخدمين الموثّقين", en: "All verified users" },
  buyers: { ar: "المشترون فقط", en: "Buyers only" },
  approved_sellers: { ar: "البائعون المعتمدون فقط", en: "Approved sellers only" },
  administrators: { ar: "المشرفون فقط", en: "Administrators only" },
};

const STATUS_LABELS: Record<AdminAnnouncementStatus, { ar: string; en: string }> = {
  queued: { ar: "في قائمة الانتظار", en: "Queued" },
  sending: { ar: "جارٍ الإرسال", en: "Sending" },
  completed: { ar: "مكتمل", en: "Completed" },
  partial_failure: { ar: "فشل جزئي", en: "Partial failure" },
  failed: { ar: "فشل", en: "Failed" },
};

type RunSummary = {
  id: string;
  audience: AdminAnnouncementAudience;
  subject: string;
  title: string;
  status: AdminAnnouncementStatus;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  nextRetryAt?: string;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type ApiErrorPayload = { error?: string };

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-IL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function parseResponse<T>(response: Response, isArabic: boolean): Promise<T> {
  const payload = await response.json() as T & ApiErrorPayload;
  if (!response.ok) throw new Error(isArabic ? "تعذّر إكمال طلب الإعلان." : payload.error || "Announcement request failed.");
  return payload;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function AdminAnnouncementsPanel() {
  const locale = useLocale();
  const isArabic = locale === "ar";
  const t = useCallback((en: string, ar: string) => (isArabic ? ar : en), [isArabic]);
  const [audience, setAudience] = useState<AdminAnnouncementAudience>("all_verified_users");
  const [subjectAr, setSubjectAr] = useState(DEFAULT_SUBJECT_AR);
  const [titleAr, setTitleAr] = useState(DEFAULT_TITLE_AR);
  const [contentAr, setContentAr] = useState(DEFAULT_CONTENT_AR);
  const [ctaTextAr, setCtaTextAr] = useState("ابدأ التداول");
  const [subjectEn, setSubjectEn] = useState(DEFAULT_SUBJECT_EN);
  const [titleEn, setTitleEn] = useState(DEFAULT_TITLE_EN);
  const [contentEn, setContentEn] = useState(DEFAULT_CONTENT_EN);
  const [ctaTextEn, setCtaTextEn] = useState("Start Trading");
  const [ctaUrl, setCtaUrl] = useState("https://www.alphatraders.co.il");
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loadingCount, setLoadingCount] = useState(true);
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [progress, setProgress] = useState<{ sent: number; failed: number; retries: number; total: number } | null>(null);
  const contentArRef = useRef<HTMLTextAreaElement>(null);
  const contentEnRef = useRef<HTMLTextAreaElement>(null);
  const requestKeyRef = useRef<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoadingCount(true);
    try {
      const response = await fetch(`/api/alpha-exchange/admin/announcements?audience=${audience}`, {
        cache: "no-store",
      });
      const payload = await parseResponse<{ recipientCount: number; runs: RunSummary[] }>(response, isArabic);
      setRecipientCount(payload.recipientCount);
      setRuns(payload.runs);
    } catch (error) {
      setMessage({ type: "error", text: isArabic ? "تعذّر تحميل مستلمي الإعلان." : error instanceof Error ? error.message : "Could not load announcement recipients." });
    } finally {
      setLoadingCount(false);
    }
  }, [audience, isArabic]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const insertFormatting = useCallback((language: "ar" | "en", before: string, after = before, placeholder = "text") => {
    const textarea = language === "ar" ? contentArRef.current : contentEnRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentContent = language === "ar" ? contentAr : contentEn;
    const selected = currentContent.slice(start, end) || placeholder;
    const next = `${currentContent.slice(0, start)}${before}${selected}${after}${currentContent.slice(end)}`;
    if (language === "ar") setContentAr(next);
    else setContentEn(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }, [contentAr, contentEn]);

  const emailPayload = composeAdminAnnouncementEmailContent({
    ar: { subject: subjectAr, title: titleAr, content: contentAr, ctaText: ctaTextAr },
    en: { subject: subjectEn, title: titleEn, content: contentEn, ctaText: ctaTextEn },
    ctaUrl,
  });

  const deliverRun = useCallback(async (runId: string) => {
    let finished = false;
    while (!finished) {
      const response = await fetch(`/api/alpha-exchange/admin/announcements/${encodeURIComponent(runId)}/deliver`, {
        method: "POST",
      });
      const payload = await parseResponse<{
        run: {
          id: string;
          status: AdminAnnouncementStatus;
          recipientCount: number;
          successCount: number;
          failureCount: number;
          retryCount: number;
          nextRetryAt?: string;
          finishedAt?: string;
        };
      }>(response, isArabic);
      setProgress({
        sent: payload.run.successCount,
        failed: payload.run.failureCount,
        retries: payload.run.retryCount,
        total: payload.run.recipientCount,
      });
      finished = Boolean(payload.run.finishedAt);
      if (!finished && payload.run.nextRetryAt) {
        await wait(Math.max(0, new Date(payload.run.nextRetryAt).getTime() - Date.now()));
      }
      if (finished) {
        const failures = payload.run.failureCount;
        setMessage({
          type: failures === 0 ? "success" : "error",
          text: failures === 0
            ? t(`Announcement delivered to ${payload.run.successCount} recipients.`, `تم إرسال الإعلان إلى ${payload.run.successCount} مستلمًا.`)
            : t(
                `Delivery finished with ${payload.run.successCount} successes and ${failures} failures.`,
                `اكتمل الإرسال: ${payload.run.successCount} ناجح و${failures} فاشل.`,
              ),
        });
      }
    }
  }, [isArabic, t]);

  async function confirmAndSend() {
    if (!recipientCount) return;
    setConfirmOpen(false);
    setSending(true);
    setMessage(null);
    setProgress({ sent: 0, failed: 0, retries: 0, total: recipientCount });
    try {
      const requestKey = requestKeyRef.current ?? crypto.randomUUID();
      requestKeyRef.current = requestKey;
      const response = await fetch("/api/alpha-exchange/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey, audience, expectedRecipientCount: recipientCount, ...emailPayload }),
      });
      const payload = await parseResponse<{ run: RunSummary }>(response, isArabic);
      await deliverRun(payload.run.id);
      requestKeyRef.current = null;
      await loadOverview();
    } catch (error) {
      setMessage({ type: "error", text: isArabic ? "فشل إرسال الإعلان." : error instanceof Error ? error.message : "Announcement delivery failed." });
      await loadOverview();
    } finally {
      setSending(false);
    }
  }

  async function resumeRun(runId: string) {
    setSending(true);
    setMessage(null);
    try {
      await deliverRun(runId);
      await loadOverview();
    } catch (error) {
      setMessage({ type: "error", text: isArabic ? "تعذّر استئناف إرسال الإعلان." : error instanceof Error ? error.message : "Could not resume announcement delivery." });
    } finally {
      setSending(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/alpha-exchange/admin/announcements/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: testEmail, ...emailPayload }),
      });
      await parseResponse<{ sent: true }>(response, isArabic);
      setMessage({ type: "success", text: t(`Test announcement sent to ${testEmail.trim()}.`, `تم إرسال إعلان تجريبي إلى ${testEmail.trim()}.`) });
    } catch (error) {
      setMessage({ type: "error", text: isArabic ? "فشل إرسال الإعلان التجريبي." : error instanceof Error ? error.message : "Test announcement failed." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="border-[#C9A227]/25 bg-[#0B0B0B]/90">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#C9A227]">{t("Marketing", "التسويق")}</p>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-[#C9A227]" />
                {t("Announcements", "الإعلانات")}
              </CardTitle>
              <CardDescription className="mt-2">
                {t(
                  "Compose one Arabic and one English version. Every recipient receives an Arabic-first bilingual email.",
                  "اكتب نسخة عربية ونسخة إنجليزية. يتلقى كل مستلم بريدًا ثنائي اللغة يبدأ بالعربية.",
                )}
              </CardDescription>
            </div>
            <div className="rounded-xl border border-[#C9A227]/25 bg-[#C9A227]/10 px-4 py-3 text-right">
              <div className="text-2xl font-bold text-white">{loadingCount ? "—" : recipientCount ?? 0}</div>
              <div className="text-xs text-[#D6B84C]">{t("verified recipients", "مستلمون موثّقون")}</div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-4">
            <label className="block space-y-2 text-sm text-[#D1D5DB]">
              <span>{t("Recipients", "المستلمون")}</span>
              <select
                value={audience}
                onChange={(event) => setAudience(event.target.value as AdminAnnouncementAudience)}
                disabled={sending}
                className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-[#C9A227]/60"
              >
                {Object.entries(AUDIENCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{isArabic ? label.ar : label.en}</option>
                ))}
              </select>
            </label>
            <div className="space-y-4 rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/5 p-4" dir="rtl" lang="ar">
              <div>
                <p className="font-semibold text-white">{t("Arabic version", "النسخة العربية")}</p>
                <p className="mt-1 text-xs text-[#9CA3AF]">{t("Displayed first for every recipient.", "تظهر أولًا لجميع المستلمين.")}</p>
              </div>
              <label className="block space-y-2 text-sm text-[#D1D5DB]">
                <span>{t("Arabic email subject", "موضوع البريد")}</span>
                <Input dir="rtl" value={subjectAr} onChange={(event) => setSubjectAr(event.target.value)} maxLength={180} disabled={sending} />
              </label>
              <label className="block space-y-2 text-sm text-[#D1D5DB]">
                <span>{t("Arabic title", "العنوان")}</span>
                <Input dir="rtl" value={titleAr} onChange={(event) => setTitleAr(event.target.value)} maxLength={160} disabled={sending} />
              </label>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="announcement-content-ar" className="text-sm text-[#D1D5DB]">{t("Arabic content", "المحتوى")}</label>
                  <div className="flex items-center gap-1" aria-label={t("Arabic content formatting", "تنسيق المحتوى العربي")}>
                    <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("ar", "**", "**", "نص")} aria-label="خط عريض"><Bold className="h-4 w-4" /></Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("ar", "_", "_", "نص")} aria-label="خط مائل"><Italic className="h-4 w-4" /></Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("ar", "• ", "", "عنصر قائمة")} aria-label="قائمة"><List className="h-4 w-4" /></Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("ar", "[", "](https://)", "نص الرابط")} aria-label="رابط"><Link2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <textarea id="announcement-content-ar" ref={contentArRef} dir="rtl" value={contentAr} onChange={(event) => setContentAr(event.target.value)} maxLength={8_000} rows={12} disabled={sending} className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-sm leading-7 text-white outline-none focus:border-[#C9A227]/60" />
              </div>
              <label className="block space-y-2 text-sm text-[#D1D5DB]">
                <span>{t("Arabic button text", "نص الزر")}</span>
                <Input dir="rtl" value={ctaTextAr} onChange={(event) => setCtaTextAr(event.target.value)} maxLength={80} disabled={sending} />
              </label>
            </div>

            <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4" dir="ltr" lang="en">
              <div>
                <p className="font-semibold text-white">{t("English version", "النسخة الإنجليزية")}</p>
                <p className="mt-1 text-xs text-[#9CA3AF]">{t("Displayed after the Arabic version.", "تظهر بعد النسخة العربية.")}</p>
              </div>
              <label className="block space-y-2 text-sm text-[#D1D5DB]">
                <span>{t("Email subject", "موضوع البريد بالإنجليزية")}</span>
                <Input dir="ltr" value={subjectEn} onChange={(event) => setSubjectEn(event.target.value)} maxLength={180} disabled={sending} />
              </label>
              <label className="block space-y-2 text-sm text-[#D1D5DB]">
                <span>{t("Title", "العنوان بالإنجليزية")}</span>
                <Input dir="ltr" value={titleEn} onChange={(event) => setTitleEn(event.target.value)} maxLength={160} disabled={sending} />
              </label>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="announcement-content-en" className="text-sm text-[#D1D5DB]">{t("Content", "المحتوى بالإنجليزية")}</label>
                  <div className="flex items-center gap-1" aria-label={t("English content formatting", "تنسيق المحتوى الإنجليزي")}>
                    <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("en", "**")} aria-label={t("Bold", "خط عريض للمحتوى الإنجليزي")}><Bold className="h-4 w-4" /></Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("en", "_")} aria-label={t("Italic", "خط مائل للمحتوى الإنجليزي")}><Italic className="h-4 w-4" /></Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("en", "• ", "", "List item")} aria-label={t("Bullet list", "قائمة للمحتوى الإنجليزي")}><List className="h-4 w-4" /></Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("en", "[", "](https://)", "link text")} aria-label={t("Link", "رابط للمحتوى الإنجليزي")}><Link2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <textarea id="announcement-content-en" ref={contentEnRef} dir="ltr" value={contentEn} onChange={(event) => setContentEn(event.target.value)} maxLength={8_000} rows={12} disabled={sending} className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-sm leading-7 text-white outline-none focus:border-[#C9A227]/60" />
              </div>
              <label className="block space-y-2 text-sm text-[#D1D5DB]">
                <span>{t("Button text", "نص الزر بالإنجليزية")}</span>
                <Input dir="ltr" value={ctaTextEn} onChange={(event) => setCtaTextEn(event.target.value)} maxLength={80} disabled={sending} />
              </label>
            </div>

            <label className="block space-y-2 text-sm text-[#D1D5DB]">
              <span>{t("Button destination (Arabic and English links are generated automatically)", "وجهة الزر (يتم إنشاء رابط عربي وإنجليزي تلقائيًا)")}</span>
              <Input type="url" dir="ltr" value={ctaUrl} onChange={(event) => setCtaUrl(event.target.value)} disabled={sending} />
            </label>
            <p className="text-xs text-[#6B7280]">{t("Both versions support bold, italic, bullet lists, and HTTPS links.", "تدعم النسختان الخط العريض والمائل والقوائم وروابط HTTPS.")}</p>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="mb-3 text-sm font-medium text-white">{t("Send a test first", "أرسل نسخة تجريبية أولًا")}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(event) => setTestEmail(event.target.value)}
                  placeholder="verified-test-account@example.com"
                  aria-label={t("Verified test account email", "بريد حساب تجريبي موثّق")}
                  disabled={testing || sending}
                />
                <Button type="button" variant="secondary" disabled={testing || sending || !testEmail.trim()} onClick={() => void sendTest()}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t("Send Test", "إرسال نسخة تجريبية")}
                </Button>
              </div>
              <p className="mt-2 text-xs text-[#6B7280]">{t("Test delivery is restricted to an active, verified registered user.", "يُسمح بالإرسال التجريبي فقط إلى مستخدم مسجّل وموثّق ونشط.")}</p>
            </div>
            <Button
              type="button"
              disabled={sending || loadingCount || !recipientCount}
              onClick={() => setConfirmOpen(true)}
              className="w-full sm:w-auto"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending
                ? t("Delivering…", "جارٍ الإرسال…")
                : t(`Review and send to ${recipientCount ?? 0}`, `مراجعة وإرسال إلى ${recipientCount ?? 0}`)}
            </Button>
            {progress ? (
              <div className="space-y-2" aria-live="polite">
                <div className="flex justify-between text-xs text-[#9CA3AF]">
                  <span>{t(
                    `${progress.sent} sent · ${progress.failed} failed · ${progress.retries} retries`,
                    `${progress.sent} مُرسل · ${progress.failed} فاشل · ${progress.retries} إعادة محاولة`,
                  )}</span>
                  <span>{Math.min(progress.total, progress.sent + progress.failed)} / {progress.total}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-[#C9A227] transition-all"
                    style={{ width: `${progress.total ? ((progress.sent + progress.failed) / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ) : null}
            {message ? (
              <div
                className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${message.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}
                role={message.type === "error" ? "alert" : "status"}
              >
                {message.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                {message.text}
              </div>
            ) : null}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-[#D1D5DB]">{t("Bilingual email preview", "معاينة البريد ثنائي اللغة")}</p>
            <div className="overflow-hidden rounded-2xl border border-[#4A3D16] bg-[#101010] shadow-2xl">
              <div className="border-b border-[#4A3D16] bg-[#171308] px-5 py-6 text-center">
                <Image src="/images/brand/alpha-traders-logo.webp" alt={BRAND_NAME} width={88} height={88} className="mx-auto rounded-2xl object-cover" />
                <div className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#D6B84C]">{BRAND_NAME}</div>
                <h2 lang="ar" dir="rtl" className="mt-3 text-2xl font-bold leading-tight text-white">{titleAr || "عنوان الإعلان"}</h2>
                <p lang="en" dir="ltr" className="mt-2 text-sm text-[#D1D5DB]">{titleEn || "Announcement title"}</p>
              </div>
              <div lang="ar" dir="rtl" className="px-5 py-6 text-right">
                <div className="whitespace-pre-wrap text-sm leading-7 text-[#D1D5DB]">{contentAr || "سيظهر محتوى الإعلان هنا."}</div>
                <span className="mt-6 inline-block rounded-lg bg-[#C9A227] px-5 py-3 text-sm font-bold text-black">
                  {ctaTextAr || "فتح"}
                </span>
              </div>
              <div lang="en" dir="ltr" className="border-t border-white/10 px-5 py-6 text-left">
                <div className="whitespace-pre-wrap text-sm leading-7 text-[#D1D5DB]">{contentEn || "Your announcement content will appear here."}</div>
                <span className="mt-6 inline-block rounded-lg bg-[#C9A227] px-5 py-3 text-sm font-bold text-black">
                  {ctaTextEn || "Open"}
                </span>
              </div>
              <div className="border-t border-white/10 bg-black/30 px-5 py-4 text-center text-xs text-[#6B7280]">
                الموقع / Website: alphatraders.co.il · الدعم / Support: support@alphatraders.co.il
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[#0B0B0B]/90">
        <CardHeader>
          <CardTitle>{t("Recent announcement deliveries", "عمليات إرسال الإعلانات الأخيرة")}</CardTitle>
          <CardDescription>{t("Durable delivery logs include timing and aggregate outcomes without exposing recipient addresses.", "تتضمن سجلات الإرسال التوقيت والنتائج الإجمالية من دون إظهار عناوين المستلمين.")}</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-black/20 p-5 text-sm text-[#9CA3AF]">{t("No announcement deliveries yet.", "لا توجد عمليات إرسال حتى الآن.")}</p>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <div key={run.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{run.subject}</p>
                    <p className="mt-1 text-xs text-[#9CA3AF]">
                      {isArabic ? AUDIENCE_LABELS[run.audience].ar : AUDIENCE_LABELS[run.audience].en}
                      {t(` · Started ${formatDate(run.startedAt, locale)}`, ` · بدأ ${formatDate(run.startedAt, locale)}`)}
                      {run.finishedAt ? t(` · Finished ${formatDate(run.finishedAt, locale)}`, ` · انتهى ${formatDate(run.finishedAt, locale)}`) : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[#D1D5DB]">{isArabic ? STATUS_LABELS[run.status].ar : STATUS_LABELS[run.status].en}</span>
                    <span className="text-emerald-300">{t(`${run.successCount} sent`, `${run.successCount} مُرسل`)}</span>
                    <span className={run.failureCount ? "text-red-300" : "text-[#6B7280]"}>{t(`${run.failureCount} failed`, `${run.failureCount} فاشل`)}</span>
                    <span className="text-[#D6B84C]">{t(`${run.retryCount ?? 0} retries`, `${run.retryCount ?? 0} إعادة محاولة`)}</span>
                    {(run.status === "queued" || run.status === "sending") ? (
                      <Button type="button" size="sm" variant="secondary" disabled={sending} onClick={() => void resumeRun(run.id)}>
                        <Play className="h-3.5 w-3.5" />
                        {t("Resume", "استئناف")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="announcement-confirm-title">
          <div className="w-full max-w-lg rounded-2xl border border-[#C9A227]/30 bg-[#101010] p-6 shadow-2xl">
            <h2 id="announcement-confirm-title" className="text-xl font-bold text-white">{t("Confirm announcement delivery", "تأكيد إرسال الإعلان")}</h2>
            <p className="mt-3 text-sm leading-6 text-[#D1D5DB]">
              {t("This will email", "سيتم إرسال البريد إلى")} <strong className="text-white">{recipientCount}</strong> {t("recipients in", "مستلمًا ضمن")} <strong className="text-white">{isArabic ? AUDIENCE_LABELS[audience].ar : AUDIENCE_LABELS[audience].en}</strong>.
              {" "}{t("The audience is rechecked before delivery begins.", "تتم إعادة التحقق من الجمهور قبل بدء الإرسال.")}
            </p>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-[#9CA3AF]">
              <div lang="ar" dir="rtl" className="font-medium text-white">{subjectAr}</div>
              <div lang="en" dir="ltr" className="mt-1 font-medium text-white">{subjectEn}</div>
              <div lang="ar" dir="rtl" className="mt-2">{titleAr}</div>
              <div lang="en" dir="ltr" className="mt-1">{titleEn}</div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>{t("Cancel", "إلغاء")}</Button>
              <Button type="button" onClick={() => void confirmAndSend()}>
                <Send className="h-4 w-4" />
                {t("Send announcement", "إرسال الإعلان")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
