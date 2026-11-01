"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BellRing } from "lucide-react";
import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";

type Preferences = { inApp: boolean; email: boolean };

export function AccountNotificationPreferences({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const { user, isResolving } = useCanonicalSession();
  const userId = user?.id;
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [message, setMessage, feedbackKey] = useActionFeedbackState<string | null>(null);
  const dirty = useRef<Partial<Preferences>>({});
  const saveScope = useRef<AbortController | null>(null);

  useEffect(() => {
    dirty.current = {};
    setPreferences(null); setSaving(false);
    const controller = new AbortController();
    saveScope.current = controller;
    const onSignedOut = () => { controller.abort(); setPreferences(null); setSaving(false); };
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<{ source?: string }>).detail?.source !== "account-settings") setLoadAttempt(value => value + 1);
    };
    window.addEventListener("alpha-auth-signed-out", onSignedOut);
    window.addEventListener("alpha-notification-preferences-changed", onChanged);
    return () => {
      controller.abort();
      window.removeEventListener("alpha-auth-signed-out", onSignedOut);
      window.removeEventListener("alpha-notification-preferences-changed", onChanged);
    };
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (!userId || isResolving || saveScope.current?.signal.aborted) return;
      setMessage(null);
      try {
        const response = await fetch("/api/alpha-exchange/notification-preferences", { cache: "no-store", signal: controller.signal, headers: { "x-alpha-expected-user-id": userId } });
        if (!response.ok) throw new Error("load");
        const payload = await response.json() as { preferences?: Preferences };
        if (!payload.preferences || typeof payload.preferences.inApp !== "boolean" || typeof payload.preferences.email !== "boolean") throw new Error("load");
        if (!controller.signal.aborted && !saveScope.current?.signal.aborted) setPreferences({ inApp: payload.preferences.inApp, email: payload.preferences.email, ...dirty.current });
      } catch {
        if (!controller.signal.aborted) setMessage(isAr ? "تعذر تحميل تفضيلات الإشعارات. حاول مرة أخرى." : "Could not load notification preferences. Please try again.");
      }
    }
    void load();
    return () => controller.abort();
  }, [isAr, loadAttempt, setMessage, userId, isResolving]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scope = saveScope.current;
    if (!preferences || saving || !userId || !scope || scope.signal.aborted) return;
    const changes = { ...dirty.current };
    if (!Object.keys(changes).length) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/alpha-exchange/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-alpha-expected-user-id": userId },
        signal: scope.signal,
        // Saving one choice must not overwrite a channel enabled elsewhere.
        body: JSON.stringify(changes),
      });
      if (!response.ok) throw new Error("save");
      if (scope.signal.aborted) return;
      dirty.current = {};
      window.dispatchEvent(new CustomEvent("alpha-notification-preferences-changed", { detail: { source: "account-settings" } }));
      setMessage(isAr ? "تم تحديث تفضيلات الإشعارات." : "Notification preferences updated.");
    } catch {
      if (!scope.signal.aborted) setMessage(isAr ? "تعذر حفظ تفضيلات الإشعارات. حاول مرة أخرى." : "Could not save notification preferences. Please try again.");
    } finally {
      if (!scope.signal.aborted) setSaving(false);
    }
  }

  return (
    <Card id="notification-preferences" className="scroll-mt-24 border-white/10 bg-[#0B0B0B]/95">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BellRing className="h-4 w-4 text-[#C9A227]" aria-hidden="true" />
          {isAr ? "تفضيلات الإشعارات" : "Notification Preferences"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Button type="button" size="sm" variant="secondary" className="mb-4" onClick={() => {
          window.dispatchEvent(new Event("alpha-notification-settings"));
          window.setTimeout(() => document.getElementById("notification-setup")?.scrollIntoView({ block: "center" }), 500);
        }}>{isAr ? "إعداد إشعارات هذا الجهاز" : "Set up device alerts"}</Button>
        <form onSubmit={save} className="space-y-3">
          {preferences ? (
            <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
              {(["inApp", "email"] as const).map((channel) => (
                <label key={channel} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-[#D1D5DB]">
                  <span>{channel === "inApp" ? (isAr ? "داخل التطبيق" : "In-app") : (isAr ? "البريد الإلكتروني" : "Email")}</span>
                  <input type="checkbox" className="h-4 w-4 accent-[#C9A227]" checked={preferences[channel]} onChange={(event) => {
                    dirty.current[channel] = event.target.checked;
                    setPreferences({ ...preferences, [channel]: event.target.checked });
                  }} />
                </label>
              ))}
            </fieldset>
          ) : !message ? <p role="status" className="text-sm text-[#9CA3AF]">{isAr ? "جارٍ تحميل التفضيلات…" : "Loading preferences…"}</p> : null}
          {message ? <ActionFeedback revealKey={feedbackKey} autoReveal={Boolean(preferences)} role="status" className="text-sm text-[#FDE68A]">{message}</ActionFeedback> : null}
          {preferences ? (
            <Button type="submit" size="sm" variant="secondary" disabled={saving}>{saving ? (isAr ? "جارٍ الحفظ…" : "Saving…") : (isAr ? "حفظ التفضيلات" : "Save Preferences")}</Button>
          ) : message ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setLoadAttempt((value) => value + 1)}>{isAr ? "إعادة المحاولة" : "Retry"}</Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
