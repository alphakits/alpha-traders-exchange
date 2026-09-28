"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BellRing } from "lucide-react";
import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Preferences = { inApp: boolean; email: boolean };

export function AccountNotificationPreferences({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [message, setMessage, feedbackKey] = useActionFeedbackState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setMessage(null);
      try {
        const response = await fetch("/api/alpha-exchange/notification-preferences", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("load");
        const payload = await response.json() as { preferences?: Preferences };
        if (!payload.preferences || typeof payload.preferences.inApp !== "boolean" || typeof payload.preferences.email !== "boolean") throw new Error("load");
        if (!controller.signal.aborted) setPreferences({ inApp: payload.preferences.inApp, email: payload.preferences.email });
      } catch {
        if (!controller.signal.aborted) setMessage(isAr ? "تعذر تحميل تفضيلات الإشعارات. حاول مرة أخرى." : "Could not load notification preferences. Please try again.");
      }
    }
    void load();
    return () => controller.abort();
  }, [isAr, loadAttempt, setMessage]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preferences || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/alpha-exchange/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Only update the two controls moved from Home; preserve all other channels.
        body: JSON.stringify(preferences),
      });
      if (!response.ok) throw new Error("save");
      setMessage(isAr ? "تم تحديث تفضيلات الإشعارات." : "Notification preferences updated.");
    } catch {
      setMessage(isAr ? "تعذر حفظ تفضيلات الإشعارات. حاول مرة أخرى." : "Could not save notification preferences. Please try again.");
    } finally {
      setSaving(false);
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
        <form onSubmit={save} className="space-y-3">
          {preferences ? (
            <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
              {(["inApp", "email"] as const).map((channel) => (
                <label key={channel} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-[#D1D5DB]">
                  <span>{channel === "inApp" ? (isAr ? "داخل التطبيق" : "In-app") : (isAr ? "البريد الإلكتروني" : "Email")}</span>
                  <input type="checkbox" className="h-4 w-4 accent-[#C9A227]" checked={preferences[channel]} onChange={(event) => setPreferences({ ...preferences, [channel]: event.target.checked })} />
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
