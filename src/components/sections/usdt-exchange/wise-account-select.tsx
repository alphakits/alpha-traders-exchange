"use client";

import { useCallback, useEffect, useState } from "react";

/** Only the server can advertise availability. Account numbers are never in this DTO. */
export type WiseAccountSummary = {
  id: string;
  provider: "wise";
  currency: "USD";
  accountHolderName: string;
  accountLast4: string;
  routingLast4: string;
  accountType: "checking" | "savings";
  ownershipReviewStatus: "pending_review" | "manually_reviewed" | "rejected";
};

export function useWiseAccounts(actorId?: string) {
  const [state, setState] = useState<{ actorId?: string; enabled: boolean; mode: "draft" | "hosted" | "disabled"; loading: boolean; accounts: WiseAccountSummary[]; error: string | null }>({ enabled: false, mode: "disabled", loading: false, accounts: [], error: null });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!actorId) return;
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [actorId, reload]);
  useEffect(() => {
    if (!actorId) return;
    const controller = new AbortController();
    setState({ actorId, enabled: false, mode: "disabled", loading: true, accounts: [], error: null });
    void fetch("/api/alpha-exchange/wise-accounts", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (response.status === 404) return { enabled: false, mode: "disabled", accounts: [] };
        if (!response.ok) throw new Error("Unable to load Wise accounts. Refresh before continuing.");
        return response.json() as Promise<{ enabled?: boolean; mode?: string; accounts?: WiseAccountSummary[] }>;
      })
      .then(payload => {
        if (controller.signal.aborted) return;
        const enabled = payload.enabled === true
          && (payload.mode === undefined || payload.mode === "draft" || payload.mode === "hosted");
        setState({ actorId, enabled, mode: enabled ? (payload.mode === "hosted" ? "hosted" : "draft") : "disabled", loading: false, accounts: enabled && Array.isArray(payload.accounts) ? payload.accounts : [], error: null });
      }).catch(error => {
        if (!controller.signal.aborted) setState({ actorId, enabled: false, mode: "disabled", loading: false, accounts: [], error: error instanceof Error ? error.message : "Unable to load Wise accounts." });
      });
    return () => controller.abort();
  }, [actorId, revision]);
  // A session switch must never display the previous account owner's data, even for one render.
  const current = actorId && state.actorId === actorId ? state : { enabled: false, mode: "disabled" as const, loading: Boolean(actorId), accounts: [], error: null };
  return { ...current, reviewedAccounts: current.accounts.filter(account => account.ownershipReviewStatus === "manually_reviewed"), reload };
}

export function WiseAccountSelect({ locale, accounts, loading = false, value, onChange, purpose, id = "wise-account", disabled = false }: {
  locale: "en" | "ar";
  accounts: readonly WiseAccountSummary[];
  loading?: boolean;
  value: string;
  onChange: (value: string) => void;
  purpose: "sending" | "receiving";
  id?: string;
  disabled?: boolean;
}) {
  const isAr = locale === "ar";
  const hasReviewed = accounts.some(account => account.ownershipReviewStatus === "manually_reviewed");
  return <div className="space-y-2 rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-3">
    <label htmlFor={id} className="block text-sm font-medium text-white">{purpose === "sending"
      ? (isAr ? "حساب Wise الشخصي الذي سترسل منه USD" : "Your personal Wise account for sending USD")
      : (isAr ? "حساب Wise الشخصي لاستلام USD" : "Your personal Wise account for receiving USD")}</label>
    <select id={id} required value={value} disabled={disabled || loading || !hasReviewed} onChange={event => onChange(event.target.value)} aria-describedby={`${id}-help`} className="min-h-11 w-full min-w-0 rounded-lg border border-white/20 bg-[#111] px-3 text-white">
      <option value="">{loading ? (isAr ? "جارٍ تحميل الحسابات…" : "Loading accounts…") : (isAr ? "اختر حسابك الذي تمت مراجعة ملكيته" : "Choose your ownership-reviewed account")}</option>
      {accounts.map(account => <option key={account.id} value={account.id} disabled={account.ownershipReviewStatus !== "manually_reviewed"}>
        {`${account.accountHolderName} · USD · ****${account.accountLast4} · ${account.ownershipReviewStatus === "manually_reviewed" ? (isAr ? "تمت مراجعة الملكية" : "Ownership reviewed") : account.ownershipReviewStatus === "rejected" ? (isAr ? "رُفضت المراجعة" : "Review rejected") : (isAr ? "بانتظار المراجعة" : "Review pending")}`}
      </option>)}
    </select>
    <p id={`${id}-help`} className="text-xs text-[#D1D5DB]">{isAr ? "استخدم حسابك الشخصي فقط. مراجعة الملكية تتم بواسطة المنصة ولا تعني موافقة Wise على الصفقة." : "Use your own personal account. Platform ownership review does not mean Wise has approved the trade."}</p>
    {!hasReviewed && !loading ? <p className="text-sm text-amber-200">{isAr ? "أضف حسابك وقدّمه لمراجعة الملكية قبل المتابعة. " : "Add your account and complete ownership review before continuing. "}<a href={`/${locale}/settings?tab=profile#wise-accounts`} className="underline underline-offset-2">{isAr ? "إدارة حسابات Wise" : "Manage Wise accounts"}</a></p> : null}
  </div>;
}
