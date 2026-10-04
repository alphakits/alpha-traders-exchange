"use client";
import { clearClientLocaleChoice } from "@/i18n/locale-preference";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchClientJson } from "@/lib/client-request-deadline";

type Session = { id: string; deviceLabel: string; createdAt: string; expiresAt: string; isCurrent: boolean };
type Payload = { ownerId?: string; sessions?: Session[]; revokedId?: string; currentSessionRevoked?: boolean };

export function AccountSessionsPanel({ userId, isAr }: { userId: string; isAr: boolean }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const mutationInFlight = useRef(false);
  const load = useCallback(async () => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setSessions(null);
    setMessage("");
    try {
      const { response, payload } = await fetchClientJson<Payload>("/api/alpha-exchange/account-sessions", { cache: "no-store", signal: request.signal });
      if (!response.ok || payload.ownerId !== userId || !Array.isArray(payload.sessions) || !payload.sessions.every(session => /^[a-f0-9]{32}$/.test(session.id) && typeof session.deviceLabel === "string" && Number.isFinite(Date.parse(session.createdAt)) && Number.isFinite(Date.parse(session.expiresAt)) && typeof session.isCurrent === "boolean")) throw new Error("Session read unconfirmed");
      if (request.signal.aborted) return;
      setSessions(payload.sessions);
      setBusy(false);
    } catch {
      if (!request.signal.aborted) setMessage(isAr ? "تعذر تحميل الجلسات. أعد التحميل." : "Could not load sessions. Reload to continue.");
    }
  }, [userId, isAr]);
  useEffect(() => { void load(); return () => requestRef.current?.abort(); }, [load]);

  async function revoke(session: Session) {
    if (mutationInFlight.current || busy) return;
    mutationInFlight.current = true;
    setBusy(true);
    setMessage("");
    const request = new AbortController();
    requestRef.current = request;
    try {
      const { response, payload } = await fetchClientJson<Payload>("/api/alpha-exchange/account-sessions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id }), signal: request.signal });
      if (!response.ok || payload.ownerId !== userId || payload.revokedId !== session.id || typeof payload.currentSessionRevoked !== "boolean") throw new Error("Revocation unconfirmed");
      if (request.signal.aborted) return;
      setSessions(current => current?.filter(item => item.id !== session.id) ?? []);
      if (payload.currentSessionRevoked) {
        clearClientLocaleChoice();
        window.dispatchEvent(new CustomEvent("alpha-auth-signed-out", { detail: { navigationStarted: true } }));
        window.location.replace("/en/login");
      } else setMessage(isAr ? "تم إنهاء الجلسة." : "Session signed out.");
    } catch {
      if (!request.signal.aborted) { setSessions(null); setMessage(isAr ? "لم نتأكد من إنهاء الجلسة. أعد التحميل للتحقق." : "Sign-out could not be confirmed. Reload to check before retrying."); }
    } finally {
      mutationInFlight.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return <section className="rounded-xl border border-white/15 bg-black/25 p-4" aria-label={isAr ? "جلسات حسابك" : "Your account sessions"}>
    <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-[#D4AF37]" />{isAr ? "الأجهزة والجلسات" : "Devices and sessions"}</h3>
    <p className="mt-2 text-sm text-[#9CA3AF]">{isAr ? "حسابك يستخدم جلسة واحدة. تسجيل الدخول من جديد يستبدل الجلسة السابقة. تنبيهات الدخول وتغيير الهاتف تظهر في إشعارات حسابك." : "Your account uses one active session. Signing in again replaces the previous session. Sign-in and phone-change alerts appear in your account notifications."}</p>
    <div className="mt-3 space-y-3">{sessions?.map(session => <article key={session.id} className="flex flex-col gap-3 rounded-xl border border-white/10 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 text-sm font-medium"><Monitor className="h-4 w-4 shrink-0" /><bdi dir="ltr">{session.deviceLabel === "Unknown device" && isAr ? "جهاز غير معروف" : session.deviceLabel}</bdi>{session.isCurrent ? <span className="text-xs text-emerald-300">{isAr ? "الجلسة الحالية" : "Current session"}</span> : null}</p><p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "بدأت" : "Started"}: <time dateTime={session.createdAt}>{new Date(session.createdAt).toLocaleString(isAr ? "ar" : "en-US")}</time></p><p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "تنتهي" : "Expires"}: <time dateTime={session.expiresAt}>{new Date(session.expiresAt).toLocaleString(isAr ? "ar" : "en-US")}</time></p></div>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void revoke(session)}>{session.isCurrent ? (isAr ? "تسجيل الخروج من هذه الجلسة" : "Sign out this session") : (isAr ? "إنهاء الجلسة" : "Sign out session")}</Button>
    </article>)}</div>
    {sessions?.length === 0 ? <p className="mt-3 text-sm">{isAr ? "لا توجد جلسات نشطة. أعد تسجيل الدخول إذا انتهت جلستك." : "No active sessions found. Sign in again if your session expired."}</p> : null}
    <p role="status" aria-live="polite" className="mt-3 text-sm text-[#D1D5DB]">{message || (sessions === null ? (isAr ? "جارٍ تحميل الجلسات…" : "Loading sessions…") : "")}</p>
    {sessions === null && message ? <Button type="button" variant="secondary" className="mt-2" onClick={() => void load()}>{isAr ? "إعادة التحميل" : "Reload"}</Button> : null}
  </section>;
}
