"use client";

import { useEffect, useState } from "react";
import { Ban, Flag, LoaderCircle, Undo2 } from "lucide-react";

type UserSafetyActionsProps = {
  targetUserId: string;
  locale: "ar" | "en";
  viewerSignedIn: boolean;
  viewerOwnsTarget?: boolean;
  context?: "profile" | "trade";
};

type BlockResponse = {
  blocked?: boolean;
  error?: string;
};

export function UserSafetyActions({
  targetUserId,
  locale,
  viewerSignedIn,
  viewerOwnsTarget = false,
  context = "profile",
}: UserSafetyActionsProps) {
  const isAr = locale === "ar";
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(viewerSignedIn && !viewerOwnsTarget);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const endpoint = `/api/alpha-exchange/user-blocks/${encodeURIComponent(targetUserId)}`;

  useEffect(() => {
    if (!viewerSignedIn || viewerOwnsTarget) return;
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as BlockResponse;
        if (!response.ok) throw new Error(payload.error || "Unable to read block status.");
        setBlocked(payload.blocked === true);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setMessage(error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
          ? error.message
          : (isAr ? "تعذر تحميل إعداد الحظر." : "Block status could not be loaded."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, isAr, viewerOwnsTarget, viewerSignedIn]);

  if (viewerOwnsTarget) return null;

  async function toggleBlock() {
    const nextBlocked = !blocked;
    if (nextBlocked) {
      const warning = context === "trade"
        ? (isAr
            ? "سيؤدي الحظر إلى منع الصفقات المستقبلية وإخفاء عروض هذا المستخدم. لن يغلق الصفقة الحالية أو يحذف سجلها؛ استخدم النزاع أو البلاغ عند الحاجة. هل تريد المتابعة؟"
            : "Blocking prevents future trades and hides this user's listings. It will not close this trade or delete its record; use dispute or report tools when needed. Continue?")
        : (isAr
            ? "سيؤدي الحظر إلى إخفاء عروض هذا المستخدم ومنع الصفقات الجديدة معه. يمكنك إلغاء الحظر لاحقًا. هل تريد المتابعة؟"
            : "Blocking hides this user's listings and prevents new trades with them. You can unblock later. Continue?");
      if (!window.confirm(warning)) return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: nextBlocked ? "PUT" : "DELETE" });
      const payload = await response.json().catch(() => ({})) as BlockResponse;
      if (!response.ok) throw new Error(payload.error || "Unable to update block status.");
      const committed = payload.blocked === true;
      setBlocked(committed);
      setMessage(committed
        ? (isAr ? "تم حظر المستخدم. لن تظهر عروضه ولن تبدأ صفقة جديدة بينكما." : "User blocked. Their listings are hidden and no new trade can start between you.")
        : (isAr ? "تم إلغاء الحظر." : "User unblocked."));
    } catch (error) {
      setMessage(error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
        ? error.message
        : (isAr ? "تعذر تحديث الحظر. حاول مرة أخرى." : "Block status could not be updated. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      <div className={`flex flex-wrap gap-2 ${isAr ? "justify-end" : ""}`}>
        <a
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100 transition hover:border-amber-200/60"
          href={`/${locale}/report-abuse?user=${encodeURIComponent(targetUserId)}`}
        >
          <Flag className="h-4 w-4" aria-hidden="true" />
          {isAr ? "الإبلاغ عن المستخدم" : "Report user"}
        </a>
        {viewerSignedIn ? (
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-200 transition hover:border-red-300/60 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading || saving}
            onClick={() => void toggleBlock()}
            type="button"
          >
            {loading || saving
              ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              : blocked
                ? <Undo2 className="h-4 w-4" aria-hidden="true" />
                : <Ban className="h-4 w-4" aria-hidden="true" />}
            {loading
              ? (isAr ? "جارٍ التحميل..." : "Loading...")
              : saving
                ? (isAr ? "جارٍ الحفظ..." : "Saving...")
                : blocked
                  ? (isAr ? "إلغاء حظر المستخدم" : "Unblock user")
                  : (isAr ? "حظر المستخدم" : "Block user")}
          </button>
        ) : null}
      </div>
      {!viewerSignedIn ? (
        <p className={`mt-2 text-xs text-[#9CA3AF] ${isAr ? "text-right" : ""}`}>
          {isAr ? "سجّل الدخول لحظر هذا المستخدم من الصفقات المستقبلية." : "Sign in to block this user from future trades."}
        </p>
      ) : null}
      {message ? <p aria-live="polite" className={`mt-2 text-xs text-[#D1D5DB] ${isAr ? "text-right" : ""}`}>{message}</p> : null}
    </div>
  );
}
