"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { Link } from "@/i18n/navigation";
import type { NewsLocale, NewsPreferences as Preferences } from "@/lib/economic-news/model";

type Payload = { available: boolean; preferences: Preferences; channels: Preferences };

export function NewsPreferences({ locale }: { locale: NewsLocale }) {
  const isAr = locale === "ar";
  const [payload, setPayload] = useState<Payload | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage, feedbackKey] = useActionFeedbackState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/news/preferences", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("preferences");
        const next = await response.json() as Payload;
        if (!controller.signal.aborted) { setPayload(next); setMessage(null); }
      } catch {
        if (!controller.signal.aborted) setMessage(isAr ? "تعذر تحميل تفضيلات الأخبار." : "Could not load news preferences.");
      }
    }
    void load();
    return () => controller.abort();
  }, [isAr, attempt, setMessage]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!payload?.available || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/news/preferences", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.preferences),
      });
      if (!response.ok) throw new Error("save");
      setMessage(isAr ? "تم حفظ تفضيلات الأخبار." : "News preferences saved.");
    } catch { setMessage(isAr ? "تعذر الحفظ. حاول مرة أخرى." : "Could not save. Please try again."); }
    finally { setSaving(false); }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5" aria-label={isAr ? "إشعارات الأخبار" : "News alerts"}>
      <div className="flex items-center gap-2"><BellRing className="h-4 w-4 text-[#D4AF37]" aria-hidden="true" /><h2 className="font-semibold text-white">{isAr ? "إشعارات أخبار الدولار" : "USD news alerts"}</h2></div>
      <p className="mt-2 text-sm leading-relaxed text-[#9CA3AF]">{isAr ? "اختر كيف تصلك النتائج بعد صدورها. هذه التفضيلات مستقلة عن إشعارات الصفقات." : "Choose how to receive results after release. These preferences are separate from trade alerts."}</p>
      {payload?.available ? (
        <form onSubmit={save} className="mt-4 space-y-3">
          {(["inApp", "email"] as const).map((channel) => (
            <label key={channel} className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl bg-black/20 px-3 text-sm">
              <span>{channel === "inApp" ? (isAr ? "داخل التطبيق عبر جرس الإشعارات" : "In-app notification bell") : (isAr ? "البريد الإلكتروني" : "Email")}</span>
              <input type="checkbox" checked={payload.preferences[channel]} disabled={saving}
                className="h-5 w-5 accent-[#D4AF37]" onChange={(e) => setPayload({ ...payload, preferences: { ...payload.preferences, [channel]: e.target.checked } })} />
            </label>
          ))}
          {((payload.preferences.email && !payload.channels.email) || (payload.preferences.inApp && !payload.channels.inApp)) ? (
            <p className="text-sm text-amber-200">{isAr ? "فعّل القناة المطلوبة أيضًا في " : "Also enable that channel in "}<Link href="/profile" locale={locale} className="underline">{isAr ? "تفضيلات إشعارات الحساب" : "Account notification preferences"}</Link>.</p>
          ) : null}
          <div className="flex justify-end"><Button type="submit" size="sm" loading={saving}>{isAr ? "حفظ تفضيلات الأخبار" : "Save news preferences"}</Button></div>
        </form>
      ) : payload ? <p className="mt-3 text-sm text-[#C7CDD6]">{isAr ? "ستتوفر إشعارات الأخبار عند بدء تحديث النتائج." : "News alerts will be available when result updates begin."}</p>
        : !message ? <p className="mt-3 text-sm text-[#9CA3AF]">{isAr ? "جارٍ التحميل…" : "Loading…"}</p> : null}
      {message ? <ActionFeedback revealKey={feedbackKey} autoReveal={Boolean(payload)} className="mt-3">{message}</ActionFeedback> : null}
      {!payload && message ? <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAttempt((a) => a + 1)}>{isAr ? "إعادة المحاولة" : "Retry"}</Button> : null}
    </section>
  );
}
