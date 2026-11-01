"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Check, Mail, Smartphone, X } from "lucide-react";
import { NATIVE_WEB_BRIDGE_VERSION } from "@alpha-traders/contracts";
import type { AppLocale } from "@/i18n/routing";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { checkBrowserPush, enableBrowserPush, type DevicePushState } from "@/lib/browser-push-client";
import { postToNativeApp } from "@/lib/native-app-bridge";

type Status = {
  userId?: string;
  preferences: { inApp: boolean; email: boolean; browserPush: boolean };
  emailVerified: boolean;
  browserPush: { available: boolean; publicKey: string | null };
};

export function BrowserPushPrompt({ locale }: { locale: AppLocale }) {
  const { user, isResolving } = useCanonicalSession();
  const userId = user?.id;
  const isAr = locale === "ar";
  const [status, setStatus] = useState<Status | null>(null);
  const [device, setDevice] = useState<DevicePushState>("unavailable");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const nativeStatus = useRef<DevicePushState>("unavailable");
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const refreshRef = useRef<(manual?: boolean) => Promise<void>>(async () => undefined);
  const scopeRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setVisible(false); setStatus(null); setDevice("unavailable"); setBusy(false); setNotice(null);
    nativeStatus.current = "unavailable";
    refreshRef.current = async () => undefined;
    if (!userId || isResolving) return;
    const controller = new AbortController();
    scopeRef.current = controller;
    let loading = false;
    let queuedRefresh = false;
    let queuedManual = false;
    let lastCheck = 0;
    let claimed = false;
    const refresh = async (manual = false) => {
      if (controller.signal.aborted || document.visibilityState === "hidden") return;
      if (loading) { queuedRefresh = true; queuedManual ||= manual; return; }
      if (!manual && Date.now() - lastCheck < 60_000) return;
      loading = true;
      lastCheck = Date.now();
      try {
        const response = await fetch("/api/alpha-exchange/notification-engagement", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const value = await response.json() as Status;
        if (!value.preferences || !value.browserPush || (value.userId && value.userId !== userId)) return;
        const native = Boolean(window.ReactNativeWebView);
        let push: DevicePushState = native ? nativeStatus.current : "unavailable";
        if (!native && value.browserPush.available) {
          try { push = await checkBrowserPush(locale, value.preferences.browserPush, { signal: controller.signal, userId, publicKey: value.browserPush.publicKey ?? undefined }); }
          catch { push = "off"; }
        }
        if (controller.signal.aborted) return;
        setStatus(value); setDevice(push);
        if (native) postToNativeApp({ type: "alpha.web.notification-reminders", version: NATIVE_WEB_BRIDGE_VERSION, userId, locale });
        const needsPush = ["off", "blocked", "install"].includes(push);
        const missing = !value.preferences.inApp || !value.preferences.email || !value.emailVerified || needsPush;
        if (manual) { setVisible(true); return; }
        if (!missing) { setVisible(false); return; }
        if (claimed) return;
        const claim = await fetch("/api/alpha-exchange/notification-engagement", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ action: "claim", needsPush, expectedUserId: userId }),
        });
        if (claim.ok && (await claim.json()).show && !controller.signal.aborted && !document.hidden) {
          claimed = true; setVisible(true);
        }
      } catch { /* A failed check must never change consent or interrupt a trade. */ }
      finally {
        loading = false;
        if (queuedRefresh && !controller.signal.aborted) {
          const manualRefresh = queuedManual;
          queuedRefresh = false; queuedManual = false; lastCheck = 0;
          void refresh(manualRefresh);
        }
      }
    };
    refreshRef.current = refresh;
    const onFocus = () => { void refresh(); };
    const onChanged = () => { lastCheck = 0; void refresh(); };
    const onManage = () => { void refresh(true); };
    const onNative = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; state: DevicePushState }>).detail;
      if (!detail || detail.userId !== userId || !["on", "off", "blocked", "unavailable"].includes(detail.state)) return;
      nativeStatus.current = detail.state; onChanged();
    };
    const onSignedOut = () => {
      controller.abort(); setVisible(false); setStatus(null); setDevice("unavailable");
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("alpha-notification-preferences-changed", onChanged);
    window.addEventListener("alpha-notification-settings", onManage);
    window.addEventListener("alpha-notification-push-state", onNative);
    window.addEventListener("alpha-auth-signed-out", onSignedOut);
    window.dispatchEvent(new CustomEvent("alpha-notification-push-status-request", { detail: { userId } }));
    const first = setTimeout(onFocus, 4000);
    const interval = setInterval(() => { claimed = false; void refresh(); }, 5 * 60_000);
    return () => {
      controller.abort(); clearTimeout(first); clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("alpha-notification-preferences-changed", onChanged);
      window.removeEventListener("alpha-notification-settings", onManage);
      window.removeEventListener("alpha-notification-push-state", onNative);
      window.removeEventListener("alpha-auth-signed-out", onSignedOut);
    };
  }, [userId, isResolving, locale]);

  const enableChannel = useCallback(async (channel: "inApp" | "email") => {
    if (busy || !userId) return;
    const scope = scopeRef.current;
    if (!scope || scope.signal.aborted) return;
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/alpha-exchange/notification-preferences", {
        method: "PATCH", headers: { "Content-Type": "application/json", "x-alpha-expected-user-id": userId }, signal: scope.signal, body: JSON.stringify({ [channel]: true }),
      });
      if (!response.ok) throw new Error("save");
      if (scope.signal.aborted || currentUser.current !== userId) return;
      setStatus(value => value && ({ ...value, preferences: { ...value.preferences, [channel]: true } }));
      window.dispatchEvent(new Event("alpha-notification-preferences-changed"));
    } catch { if (!scope.signal.aborted && currentUser.current === userId) setNotice(isAr ? "تعذر التفعيل. حاول مرة أخرى." : "Could not enable alerts. Please try again."); }
    finally { if (!scope.signal.aborted && currentUser.current === userId) setBusy(false); }
  }, [busy, isAr, userId]);

  async function enablePush() {
    if (busy || !userId) return;
    const scope = scopeRef.current;
    if (!scope || scope.signal.aborted) return;
    if (window.ReactNativeWebView) {
      postToNativeApp({ type: "alpha.web.push-settings", version: NATIVE_WEB_BRIDGE_VERSION, userId, locale });
      setNotice(isAr ? "فعّل الإشعارات من إعدادات التطبيق ثم عُد إلى Alpha." : "Enable notifications in app settings, then return to Alpha.");
      return;
    }
    if (device === "install") {
      setNotice(isAr ? "على iPhone: افتح الموقع في Safari، اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية. افتح Alpha من الأيقونة وفعّل الإشعارات." : "On iPhone: open Alpha in Safari, tap Share → Add to Home Screen, then open Alpha from its icon and enable alerts.");
      return;
    }
    if (device === "blocked") {
      setNotice(isAr ? "اضغط أيقونة إعدادات الموقع بجانب العنوان، ثم الإشعارات ← سماح. عُد إلى Alpha واضغط إعادة الفحص." : "Open site settings beside the address bar, set Notifications to Allow, then return to Alpha and tap Check again.");
      return;
    }
    if (!status?.browserPush.publicKey) return;
    setBusy(true); setNotice(null);
    try {
      const next = await enableBrowserPush(locale, status.browserPush.publicKey, { signal: scope.signal, userId });
      if (scope.signal.aborted || currentUser.current !== userId) return;
      setDevice(next);
      if (next === "on") {
        setStatus(value => value && ({ ...value, preferences: { ...value.preferences, browserPush: true, inApp: true } }));
        window.dispatchEvent(new Event("alpha-notification-preferences-changed"));
      }
    } catch { if (!scope.signal.aborted && currentUser.current === userId) setNotice(isAr ? "لم يكتمل تفعيل إشعارات هذا الجهاز. حاول مرة أخرى." : "Device alerts were not connected. Please try again."); }
    finally { if (!scope.signal.aborted && currentUser.current === userId) setBusy(false); }
  }

  async function snooze() {
    const scope = scopeRef.current;
    if (busy || !userId || !scope || scope.signal.aborted) return;
    setBusy(true);
    try {
      const response = await fetch("/api/alpha-exchange/notification-engagement", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: scope.signal, body: JSON.stringify({ action: "snooze", expectedUserId: userId }),
      });
      if (!response.ok) throw new Error("snooze");
      if (!scope.signal.aborted && currentUser.current === userId) setVisible(false);
    } catch { if (!scope.signal.aborted && currentUser.current === userId) setNotice(isAr ? "تعذر حفظ التذكير. حاول مرة أخرى." : "Could not save your reminder choice. Please retry."); }
    finally { if (!scope.signal.aborted && currentUser.current === userId) setBusy(false); }
  }

  if (!userId || isResolving || !visible || !status) return null;
  const allOn = status.preferences.inApp && status.preferences.email && status.emailVerified && device === "on";
  const actionClass = "min-h-11 rounded-lg border border-[#C9A227]/40 px-3 py-2 text-xs font-semibold text-[#F5D878] hover:bg-[#C9A227]/10 disabled:opacity-50";
  return (
    <section id="notification-setup" aria-label={isAr ? "تفعيل الإشعارات" : "Notification setup"} dir={isAr ? "rtl" : "ltr"} className="mx-auto my-4 max-w-5xl rounded-2xl border border-[#C9A227]/35 bg-[#11100D] p-4 text-white shadow-lg sm:p-5">
      <div className="flex items-start gap-3">
        <BellRing className="mt-1 h-6 w-6 shrink-0 text-[#C9A227]" aria-hidden="true" />
        <div className="flex-1"><h2 className="font-semibold">{allOn ? (isAr ? "إشعاراتك مفعّلة" : "Your alerts are switched on") : (isAr ? "لا تفوّت عروض USDT الجديدة" : "Stay close to new USDT deals")}</h2>
          <p className="mt-1 text-sm text-[#C6C4BC]">{isAr ? "فعّل التنبيهات للعروض وطلبات الشراء والرسائل وتحديثات صفقاتك." : "Get alerts for listings, Buy Requests, messages and trade updates."}</p></div>
        <button type="button" aria-label={isAr ? "لاحقاً" : "Remind me later"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-white/5" onClick={() => setVisible(false)}><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3"><span className="text-sm">{isAr ? "داخل الموقع" : "Website alerts"}</span>{status.preferences.inApp ? <Check aria-label={isAr ? "مفعّل" : "On"} className="h-5 w-5 text-emerald-400" /> : <button className={actionClass} disabled={busy} onClick={() => void enableChannel("inApp")}>{isAr ? "تفعيل" : "Enable"}</button>}</div>
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3"><span className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4 text-[#C9A227]" />{isAr ? "البريد" : "Email"}</span>{!status.emailVerified ? <a className={actionClass} href={`/${locale}/verify-email`}>{isAr ? "تحقق" : "Verify"}</a> : status.preferences.email ? <Check aria-label={isAr ? "مفعّل" : "On"} className="h-5 w-5 text-emerald-400" /> : <button className={actionClass} disabled={busy} onClick={() => void enableChannel("email")}>{isAr ? "تفعيل" : "Enable"}</button>}</div>
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3"><span className="flex items-center gap-2 text-sm"><Smartphone className="h-4 w-4 text-[#C9A227]" />{isAr ? "هذا الجهاز" : "This device"}</span>{device === "on" ? <Check aria-label={isAr ? "مفعّل" : "On"} className="h-5 w-5 text-emerald-400" /> : ["unsupported", "unavailable"].includes(device) ? <span className="text-xs text-[#9CA3AF]">{isAr ? "غير متاح" : "Unavailable"}</span> : <button className={actionClass} disabled={busy} onClick={() => void enablePush()}>{device === "blocked" ? (isAr ? "الإعدادات" : "Settings") : device === "install" ? (isAr ? "كيفية التفعيل" : "How to enable") : (isAr ? "تفعيل" : "Enable")}</button>}</div>
      </div>
      {notice ? <p role="status" className="mt-3 text-sm text-[#F5D878]">{notice}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#A9A69B]">
        <span>{isAr ? "تذكير بحد أقصى مرتين يومياً أثناء استخدامك للمنصة." : "At most two reminders a day while you use Alpha."}</span>
        <button type="button" className="min-h-11 underline underline-offset-4" disabled={busy} onClick={() => void snooze()}>{isAr ? "ذكّرني بعد أسبوع" : "Remind me in 7 days"}</button>
        <button type="button" className="min-h-11 underline underline-offset-4" disabled={busy} onClick={() => void refreshRef.current(true)}>{isAr ? "إعادة الفحص" : "Check again"}</button>
      </div>
    </section>
  );
}
