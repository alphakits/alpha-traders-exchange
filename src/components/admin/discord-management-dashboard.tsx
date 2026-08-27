"use client";

import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Command,
  Database,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DiscordManagementDiagnostics } from "@/lib/discord/management";

const HEALTHY_POLL_MS = 30_000;
const MIN_ERROR_POLL_MS = 15_000;
const MAX_ERROR_POLL_MS = 120_000;

type LoadState = "loading" | "ready" | "error";
type ActionState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "submitting" }
  | { status: "accepted"; message: string }
  | { status: "error"; message: string };

function statusClasses(status: DiscordManagementDiagnostics["status"]) {
  if (status === "healthy") return "border-emerald-400/35 bg-emerald-500/10 text-emerald-200";
  if (status === "degraded") return "border-amber-400/35 bg-amber-500/10 text-amber-100";
  if (status === "blocked") return "border-red-400/35 bg-red-500/10 text-red-100";
  return "border-slate-400/35 bg-slate-500/10 text-slate-200";
}

function formatTimestamp(value: string | null, locale: "ar" | "en") {
  if (!value) return locale === "ar" ? "غير متاح" : "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return locale === "ar" ? "غير متاح" : "Not available";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-IL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(milliseconds: number | null, locale: "ar" | "en") {
  if (milliseconds === null) return locale === "ar" ? "غير متاح" : "Not available";
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (locale === "ar") return days > 0 ? `${days} يوم ${hours} ساعة` : `${hours} ساعة ${minutes} دقيقة`;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">
        {label}
      </dt>
      <dd className="mt-1 break-words text-lg font-semibold text-white">{value}</dd>
    </div>
  );
}

function StatusIcon({ status }: { status: DiscordManagementDiagnostics["status"] }) {
  if (status === "healthy") return <CheckCircle2 aria-hidden className="h-5 w-5" />;
  if (status === "degraded") return <AlertTriangle aria-hidden className="h-5 w-5" />;
  if (status === "blocked") return <XCircle aria-hidden className="h-5 w-5" />;
  return <Server aria-hidden className="h-5 w-5" />;
}

export function DiscordManagementDashboard({ locale = "en" }: { locale?: "ar" | "en" }) {
  const isArabic = locale === "ar";
  const t = useCallback((english: string, arabic: string) => isArabic ? arabic : english, [isArabic]);
  const statusLabel = useCallback((value: string | number | null | undefined) => {
    if (value === null || value === undefined) return t("Unknown", "غير معروف");
    const key = String(value);
    const english: Record<string, string> = {
      healthy: "Healthy", degraded: "Degraded", blocked: "Blocked", unknown: "Unknown", ready: "Ready",
      queued: "Queued", publishing: "Publishing", active: "Active", update_pending: "Update Pending",
      delete_pending: "Delete Pending", sold: "Sold", deleted: "Deleted", failed: "Failed",
      pending: "Pending", processing: "Processing", completed: "Completed", dead: "Dead", suppressed: "Suppressed",
      accepted: "Accepted", coalesced: "Coalesced", replayed: "Replayed", text: "Text Channel", category: "Category",
    };
    const arabic: Record<string, string> = {
      healthy: "سليم", degraded: "يحتاج متابعة", blocked: "محظور", unknown: "غير معروف", ready: "جاهز",
      queued: "في قائمة الانتظار", publishing: "جارٍ النشر", active: "نشط", update_pending: "التحديث معلّق",
      delete_pending: "الحذف معلّق", sold: "مباع", deleted: "محذوف", failed: "فشل",
      pending: "قيد الانتظار", processing: "قيد المعالجة", completed: "مكتمل", dead: "متوقف", suppressed: "تم منعه",
      accepted: "مقبول", coalesced: "تم دمجه", replayed: "مكرّر", text: "قناة نصية", category: "فئة",
    };
    return (isArabic ? arabic[key] : english[key]) ?? (isArabic ? "حالة غير معروفة" : key.replaceAll("_", " "));
  }, [isArabic, t]);
  const [diagnostics, setDiagnostics] =
    useState<DiscordManagementDiagnostics | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const failureCount = useRef(0);
  const diagnosticsRef = useRef<DiscordManagementDiagnostics | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const reconcileTrigger = useRef<HTMLButtonElement>(null);
  const confirmationDialog = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const schedule = useCallback((delay: number, callback: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    if (document.visibilityState !== "visible") return;
    timer.current = setTimeout(callback, delay);
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/admin/discord/diagnostics", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as
        | DiscordManagementDiagnostics
        | { error?: string; code?: string };
      if (!("status" in payload)) {
        throw new Error(isArabic ? "بيانات التشخيص غير متاحة." : payload.error ?? "Diagnostics are unavailable.");
      }
      if (!mounted.current) return;
      diagnosticsRef.current = payload;
      setDiagnostics(payload);
      setLoadState("ready");
      setLoadError(null);
      failureCount.current = 0;
      schedule(HEALTHY_POLL_MS, () => void load());
    } catch {
      if (!mounted.current) return;
      failureCount.current += 1;
      setLoadState(diagnosticsRef.current ? "ready" : "error");
      setLoadError(t("Diagnostics could not be refreshed. The last confirmed state is preserved.", "تعذّر تحديث بيانات التشخيص. تم الاحتفاظ بآخر حالة مؤكدة."));
      const delay = Math.min(
        MAX_ERROR_POLL_MS,
        MIN_ERROR_POLL_MS * (2 ** (failureCount.current - 1)),
      );
      schedule(delay, () => void load());
    } finally {
      inFlight.current = false;
    }
  }, [isArabic, schedule, t]);

  useEffect(() => {
    mounted.current = true;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void load();
      else if (timer.current) clearTimeout(timer.current);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void load();
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  useEffect(() => {
    if (action.status === "confirming") confirmButton.current?.focus();
  }, [action.status]);

  const closeConfirmation = () => {
    setAction({ status: "idle" });
    queueMicrotask(() => reconcileTrigger.current?.focus());
  };

  const handleConfirmationKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = confirmationDialog.current?.querySelectorAll<HTMLButtonElement>(
      "button:not([disabled])",
    );
    if (!controls || controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const requestReconciliation = async () => {
    setAction({ status: "submitting" });
    queueMicrotask(() => reconcileTrigger.current?.focus());
    try {
      const response = await fetch("/api/admin/discord/reconcile", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          confirmation: "reconcile_managed_integration",
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const payload = await response.json() as {
        disposition?: "accepted" | "coalesced" | "replayed";
        status?: "pending" | "processing" | "completed" | "dead";
        resultCode?: string | null;
        error?: string;
      };
      if (!response.ok || !payload.disposition || !payload.status) {
        throw new Error(isArabic ? "لم يتم قبول الطلب." : payload.error ?? "The request was not accepted.");
      }
      setAction({
        status: "accepted",
        message: payload.disposition === "replayed"
          ? t(`The original request is ${statusLabel(payload.status)}${payload.resultCode ? ` (${payload.resultCode})` : ""}.`, `حالة الطلب الأصلي: ${statusLabel(payload.status)}${payload.resultCode ? ` (${payload.resultCode})` : ""}.`)
          : payload.disposition === "coalesced"
          ? t(`An active reconciliation already exists (${statusLabel(payload.status)}).`, `توجد مطابقة نشطة بالفعل (${statusLabel(payload.status)}).`)
          : t("Reconciliation was accepted and is pending Railway processing.", "تم قبول طلب المطابقة وهو بانتظار المعالجة على Railway."),
      });
      schedule(1_000, () => void load());
    } catch (error) {
      setAction({
        status: "error",
        message: isArabic
          ? "تعذّر حفظ طلب المطابقة. حاول مجددًا."
          : error instanceof Error
            ? error.message
            : "The request could not be persisted.",
      });
    }
  };

  if (loadState === "loading") {
    return (
      <main dir={isArabic ? "rtl" : "ltr"} lang={locale} className="section-container min-h-[70vh] py-10" aria-busy="true">
        <div className="animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="h-8 w-64 max-w-full rounded bg-white/10" />
          <div className="mt-4 h-4 w-full rounded bg-white/5" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-36 rounded-2xl bg-white/5" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (!diagnostics) {
    return (
      <main dir={isArabic ? "rtl" : "ltr"} lang={locale} className="section-container min-h-[70vh] py-10">
        <Card className="border-red-400/30 bg-red-500/5">
          <CardHeader>
            <CardTitle>{t("Discord Management is unavailable", "إدارة Discord غير متاحة")}</CardTitle>
            <CardDescription>
              {loadError ?? t("No verified diagnostic state was returned.", "لم تصل حالة تشخيص مؤكدة.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="min-h-11" onClick={() => void load()}>
              {t("Try again", "حاول مجددًا")}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const db = diagnostics.database;
  const latestOperator = db.operatorRequests.latest;

  return (
    <main dir={isArabic ? "rtl" : "ltr"} lang={locale} className="section-container min-h-screen overflow-x-clip py-8 sm:py-10">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl border border-[#C9A227]/30 bg-gradient-to-br from-[#C9A227]/10 via-black/65 to-black p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">
                {t("Private operator surface", "لوحة تشغيل خاصة")}
              </p>
              <h1 className="mt-2 break-words text-3xl font-semibold text-white sm:text-4xl">
                {t("Discord Management", "إدارة Discord")}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#B8BDC8]">
                {t("Aggregate health only. Discord mutations remain Railway-owned and no Discord IDs, account data, raw payloads, or secrets are shown.", "تُعرض حالة عامة فقط. تبقى تغييرات Discord داخل Railway ولا تظهر معرّفات Discord أو بيانات الحسابات أو البيانات الخام أو الأسرار.")}
              </p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#D8C98B]">
                {t("Monitoring and reconciliation only. Seller approvals, role decisions, listings, payments, and trades stay in the authoritative website workflows.", "هذه اللوحة للمراقبة والمطابقة فقط. تبقى موافقات البائعين والأدوار والعروض والمدفوعات والصفقات داخل مسارات الموقع الرسمية.")}
              </p>
            </div>
            <div
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-full border px-4 py-2 text-sm font-semibold ${statusClasses(diagnostics.status)}`}
              role="status"
              aria-label={isArabic ? `حالة التكامل: ${statusLabel(diagnostics.status)}` : `Integration status: ${diagnostics.status}`}
            >
              <StatusIcon status={diagnostics.status} />
              <span className="capitalize">{statusLabel(diagnostics.status)}</span>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-[#8E96A3]">
            <Clock3 aria-hidden className="h-4 w-4" />
            {t("Verified", "آخر تحقق")} {formatTimestamp(diagnostics.generatedAt, locale)}
          </p>
          {loadError ? (
            <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100" role="status">
              {loadError}
            </p>
          ) : null}
        </div>

        <section aria-labelledby="worker-health-heading" className="grid gap-4 lg:grid-cols-2">
          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle id="worker-health-heading" className="flex items-center gap-2">
                <Bot aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                {t("Railway worker", "عامل Railway")}
              </CardTitle>
              <CardDescription>{t("Signed readiness response and gateway state.", "استجابة الجاهزية الموقّعة وحالة بوابة الاتصال.")}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-2">
                <Stat label={t("Ready", "الجاهزية")} value={diagnostics.worker.ready ? t("Yes", "نعم") : t("No", "لا")} />
                <Stat label={t("Gateway", "بوابة الاتصال")} value={statusLabel(diagnostics.worker.readyState)} />
                <Stat label={t("Latency", "زمن الاستجابة")} value={
                  diagnostics.worker.apiLatencyMs === null
                    ? t("Not available", "غير متاح")
                    : `${Math.round(diagnostics.worker.apiLatencyMs)} ms`
                } />
                <Stat label={t("Connection uptime", "مدة الاتصال")} value={
                  formatDuration(diagnostics.worker.connectionUptimeMs, locale)
                } />
                <Stat label={t("Environment", "البيئة")} value={
                  diagnostics.worker.deployment.environment ?? t("Not injected", "غير محددة")
                } />
                <Stat label={t("Source revision", "إصدار المصدر")} value={
                  diagnostics.worker.deployment.revision?.slice(0, 12) ?? t("Not injected", "غير محدد")
                } />
              </dl>
              {diagnostics.worker.error ? (
                <p className="mt-3 break-words rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                  {diagnostics.worker.error.code}: {isArabic ? "تعذّر تشغيل تكامل Discord بصورة سليمة." : diagnostics.worker.error.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                {t("Managed resources", "الموارد المُدارة")}
              </CardTitle>
              <CardDescription>{t("Integration-owned categories, channels, and permissions.", "الفئات والقنوات والصلاحيات التي يديرها التكامل.")}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-3">
                <Stat label={t("Ready", "الجاهز")} value={diagnostics.resources.ready ?? t("Unknown", "غير معروف")} />
                <Stat label={t("Total", "الإجمالي")} value={diagnostics.resources.total ?? t("Unknown", "غير معروف")} />
                <Stat label={t("Missing", "المفقود")} value={diagnostics.resources.missing ?? t("Unknown", "غير معروف")} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {diagnostics.topology.map((resource) => (
                  <span key={resource.key} className="max-w-full break-words rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[#D1D5DB]">
                    {resource.name} · {statusLabel(resource.type)}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section aria-label={t("Discord aggregate health", "الحالة العامة لتكامل Discord")} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                {t("Identities and seller roles", "الحسابات وأدوار البائعين")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-2">
                <Stat label={t("Connected identities", "الحسابات المتصلة")} value={db.identities.connected} />
                <Stat label={t("Approved synced", "المعتمدون المتزامنون")} value={db.approvedSellerRoleSync.synced} />
                <Stat label={t("Role pending", "أدوار معلّقة")} value={db.approvedSellerRoleSync.pending} />
                <Stat label={t("Role failed", "أدوار فشل تزامنها")} value={db.approvedSellerRoleSync.failed} />
              </dl>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                {t("Listings and jobs", "العروض والمهام")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-2">
                <Stat label={t("Active posts", "المنشورات النشطة")} value={db.listings.activePosts} />
                <Stat label={t("Cooldown claims", "طلبات فترة الانتظار")} value={db.listings.cooldownClaims} />
                <Stat label={t("Jobs pending", "مهام معلّقة")} value={db.listings.jobs.pending} />
                <Stat label={t("Jobs processing", "مهام قيد المعالجة")} value={db.listings.jobs.processing} />
                <Stat label={t("Jobs dead", "مهام متوقفة")} value={db.listings.jobs.dead} />
                <Stat label={t("Stale leases", "مهام عالقة")} value={db.listings.jobs.staleLeases} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(db.listings.lifecycle).map(([state, value]) => (
                  <span key={state} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[#D1D5DB]">
                    {statusLabel(state)}: {value}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                {t("Market singletons", "محتوى السوق الثابت")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {db.marketContent.map((content) => (
                <div key={content.key} className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="break-words text-sm font-semibold text-white">
                    {content.key === "live_market_pulse"
                      ? t("Live market pulse", "نبض السوق المباشر")
                      : isArabic ? "محتوى سوق ثابت" : content.key.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-xs capitalize text-[#B8BDC8]">
                    {statusLabel(content.state)} · {t("Last success", "آخر نجاح")} {formatTimestamp(content.lastSuccessAt, locale)}
                  </p>
                  {content.errorCode ? (
                    <p className="mt-1 break-words text-xs text-amber-200">{content.errorCode}</p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                {t("Welcome and approval delivery", "إرسال الترحيب والموافقات")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-2">
                <Stat label={t("Pending", "قيد الانتظار")} value={db.notifications.pending} />
                <Stat label={t("Processing", "قيد المعالجة")} value={db.notifications.processing} />
                <Stat label={t("Completed", "مكتمل")} value={db.notifications.completed} />
                <Stat label={t("Suppressed", "تم منعه")} value={db.notifications.suppressed} />
                <Stat label={t("Dead", "متوقف")} value={db.notifications.dead} />
              </dl>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Command aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                {t("Commands and interactions", "الأوامر والتفاعلات")}
              </CardTitle>
              <CardDescription>
                {t("Guild Members intent is mandatory. Registered commands never mutate listings.", "صلاحية Guild Members إلزامية. الأوامر المسجّلة لا تعدّل العروض أبدًا.")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-2">
                <Stat label={t("Registered", "المسجّلة")} value={`${diagnostics.commands.registered ?? "?"}/${diagnostics.commands.expected}`} />
                <Stat label={t("Accepted 24h", "المقبولة خلال 24 ساعة")} value={db.interactions.accepted24h} />
                <Stat label={t("Rate limited 24h", "المحدودة خلال 24 ساعة")} value={db.interactions.rateLimited24h} />
                <Stat label={t("Replayed 24h", "المكررة خلال 24 ساعة")} value={db.interactions.replayed24h} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {diagnostics.commands.names.map((name) => (
                  <code key={name} className="rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 px-3 py-1.5 text-xs text-[#F4D87A]">
                    /{name}
                  </code>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                {t("Recent safe errors", "أحدث الأخطاء الآمنة")}
              </CardTitle>
              <CardDescription>{t("Codes and timestamps only; no raw provider payloads.", "تظهر الرموز والأوقات فقط، من دون بيانات خام من المزوّد.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {db.recentErrors.length === 0 ? (
                <p className="text-sm text-emerald-200">{t("No current safe error codes.", "لا توجد رموز أخطاء حالية.")}</p>
              ) : db.recentErrors.map((error, index) => (
                <div key={`${error.source}-${error.occurredAt}-${index}`} className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="break-words text-sm font-medium text-white">
                    {error.source}: {error.code}
                  </p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{formatTimestamp(error.occurredAt, locale)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <Card className="min-w-0 border-[#C9A227]/30 bg-gradient-to-br from-[#C9A227]/8 to-black">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw aria-hidden className="h-5 w-5 text-[#D4AF37]" />
              {t("Safe operator control", "تحكم تشغيلي آمن")}
            </CardTitle>
            <CardDescription>
              {t("Requests are audited, coalesced, and processed by Railway. There are no cooldown resets, role overrides, SOLD recreation, raw deletes, or arbitrary targets.", "تُراجع الطلبات وتُدمج وتُعالج على Railway. لا توجد إعادة ضبط لفترات الانتظار أو تعديل للأدوار أو إعادة إنشاء SOLD أو حذف خام أو أهداف عشوائية.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label={t("Pending", "قيد الانتظار")} value={db.operatorRequests.pending} />
              <Stat label={t("Processing", "قيد المعالجة")} value={db.operatorRequests.processing} />
              <Stat label={t("Dead", "متوقف")} value={db.operatorRequests.dead} />
              <Stat label={t("Stale leases", "مهام عالقة")} value={db.operatorRequests.staleLeases} />
            </div>
            {latestOperator ? (
              <p className="mt-4 break-words text-sm text-[#B8BDC8]">
                {t("Latest request:", "أحدث طلب:")} <strong className="text-white">{statusLabel(latestOperator.status)}</strong>
                {latestOperator.resultCode ? ` · ${latestOperator.resultCode}` : ""}
                {" · "}{formatTimestamp(latestOperator.updatedAt, locale)}
              </p>
            ) : null}
            <div className="mt-5">
              {action.status === "confirming" ? (
                <div
                  ref={confirmationDialog}
                  className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="reconcile-confirm-title"
                  aria-describedby="reconcile-confirm-description"
                  onKeyDown={handleConfirmationKeyDown}
                >
                  <h2 id="reconcile-confirm-title" className="font-semibold text-white">
                    {t("Confirm managed reconciliation", "تأكيد المطابقة المُدارة")}
                  </h2>
                  <p id="reconcile-confirm-description" className="mt-2 text-sm leading-6 text-amber-50">
                    {t("Railway will verify integration-owned resources, commands, active listing content, and market singletons. Existing active work is reused.", "سيتحقق Railway من موارد التكامل والأوامر ومحتوى العروض النشطة ومحتوى السوق الثابت. وسيُعاد استخدام أي عمل نشط حاليًا.")}
                  </p>
                  <div className="mt-4 flex flex-col gap-2 min-[390px]:flex-row">
                    <Button
                      ref={confirmButton}
                      className="min-h-11"
                      onClick={() => void requestReconciliation()}
                    >
                      {t("Confirm and enqueue", "تأكيد وإضافة إلى قائمة الانتظار")}
                    </Button>
                    <Button
                      className="min-h-11"
                      variant="secondary"
                      onClick={closeConfirmation}
                    >
                      {t("Cancel", "إلغاء")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  ref={reconcileTrigger}
                  className="min-h-11 w-full sm:w-auto"
                  disabled={action.status === "submitting"}
                  onClick={() => setAction({ status: "confirming" })}
                >
                  {action.status === "submitting"
                    ? t("Enqueuing…", "جارٍ الإضافة...")
                    : t("Reconcile managed resources, commands, and content", "مطابقة الموارد والأوامر والمحتوى المُدار")}
                </Button>
              )}
              {action.status === "accepted" || action.status === "error" ? (
                <p
                  className={`mt-3 rounded-xl border p-3 text-sm ${
                    action.status === "accepted"
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                      : "border-red-400/30 bg-red-500/10 text-red-100"
                  }`}
                  role="status"
                >
                  {action.message}
                </p>
              ) : null}
              <p className="mt-4 text-xs leading-5 text-[#8E96A3]">
                {t("Dead jobs are diagnostic-only. Investigate the safe error code and authoritative website state before support intervention; generic retry is intentionally unavailable.", "المهام المتوقفة للتشخيص فقط. افحص رمز الخطأ الآمن وحالة الموقع الرسمية قبل التدخل؛ إعادة المحاولة العامة غير متاحة عمدًا.")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
