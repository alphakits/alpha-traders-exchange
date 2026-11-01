"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { currencyText } from "@/components/ui/currency-text";
import { fetchClientJson } from "@/lib/client-request-deadline";
import { MARKETPLACE_PAYMENT_METHODS } from "@/lib/marketplace-payment-methods";
import { DEFAULT_PRICE_ALERT, priceAlertSchema, type MarketplacePriceAlert } from "@/lib/marketplace-price-alert";
import { MarketplaceToolPanel } from "./marketplace-tool-panel";

type Payload = { ownerId?: string; preference?: unknown };

export function MarketplacePriceAlertPanel({ userId, isAr }: { userId: string; isAr: boolean }) {
  const [preference, setPreference] = useState<MarketplacePriceAlert>({ ...DEFAULT_PRICE_ALERT });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setReady(false);
    setMessage("");
    try {
      const { response, payload } = await fetchClientJson<Payload>("/api/alpha-exchange/price-alerts", { cache: "no-store", signal: request.signal });
      const parsed = priceAlertSchema.safeParse(payload.preference);
      if (!response.ok || payload.ownerId !== userId || !parsed.success) throw new Error("Unconfirmed account preferences");
      if (request.signal.aborted) return;
      setPreference(parsed.data);
      setReady(true);
      setBusy(false);
    } catch {
      if (!request.signal.aborted) setMessage(isAr ? "تعذر تحميل إعدادات التنبيه. أعد التحميل." : "Could not load your alert preferences. Reload to continue.");
    }
  }, [userId, isAr]);

  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);

  async function save() {
    if (inFlight.current || !ready) return;
    const parsed = priceAlertSchema.safeParse(preference);
    if (!parsed.success) { setMessage(isAr ? "اختر سعرًا أعلى من صفر وكمية صالحة." : "Choose a positive maximum price and a valid amount."); return; }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    const request = new AbortController();
    controller.current = request;
    try {
      const { response, payload } = await fetchClientJson<Payload>("/api/alpha-exchange/price-alerts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), signal: request.signal });
      const confirmed = priceAlertSchema.safeParse(payload.preference);
      if (!response.ok || payload.ownerId !== userId || !confirmed.success) throw new Error("Save not confirmed");
      if (request.signal.aborted) return;
      setPreference(confirmed.data);
      setMessage(isAr ? "تم حفظ إعدادات التنبيه." : "Alert preferences saved.");
    } catch {
      if (!request.signal.aborted) { setReady(false); setMessage(isAr ? "لم نتأكد من الحفظ. أعد التحميل للتحقق قبل المحاولة مجددًا." : "Saving could not be confirmed. Reload to check before trying again."); }
    } finally {
      inFlight.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  }

  const methodLabel = (method: string) => !isAr ? method : method === "Bank Transfer" ? "تحويل بنكي" : method === "Cardless ATM Withdrawal" ? "سحب بلا بطاقة" : "لقاء شخصي";
  return <MarketplaceToolPanel title={isAr ? "تنبيه سعر USDT" : "USDT price alert"} isAr={isAr} icon={<Bell aria-hidden="true" className="h-4 w-4 shrink-0 text-[#D4AF37]" />} className="border-[#C9A227]/25">
    <p className="mt-2 text-sm text-[#9CA3AF]">{isAr ? "تنبيهات للعروض المناسبة وانخفاض الأسعار. لا يتم الشراء تلقائيًا." : "Get alerts for matching listings and price drops. No purchase is made automatically."}</p>
    <fieldset disabled={!ready || busy} className="mt-4 grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-sm">{currencyText(isAr ? "أعلى سعر (₪ / USDT)" : "Maximum price (₪ / USDT)")}<Input className="currency-money" dir="ltr" inputMode="decimal" value={preference.maxPrice} onChange={e => setPreference(p => ({ ...p, maxPrice: e.target.value }))} /></label>
      <label className="space-y-1 text-sm">{currencyText(isAr ? "أقل كمية USDT (اختياري)" : "Minimum USDT (optional)")}<Input className="currency-money" dir="ltr" inputMode="decimal" value={preference.minUsdt} onChange={e => setPreference(p => ({ ...p, minUsdt: e.target.value }))} /></label>
      <label className="space-y-1 text-sm">{isAr ? "طريقة الدفع" : "Payment method"}<select className="h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3" value={preference.paymentMethod} onChange={e => setPreference(p => ({ ...p, paymentMethod: e.target.value as MarketplacePriceAlert["paymentMethod"] }))}><option value="all">{isAr ? "أي طريقة" : "Any method"}</option>{MARKETPLACE_PAYMENT_METHODS.map(method => <option key={method} value={method}>{methodLabel(method)}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={preference.enabled} onChange={e => setPreference(p => ({ ...p, enabled: e.target.checked }))} />{isAr ? "تفعيل تنبيه السعر لحسابي" : "Enable price alerts for my account"}</label>
    </fieldset>
    <div className="mt-3 flex flex-wrap items-center gap-3"><Button type="button" disabled={!ready || busy} onClick={() => void save()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{isAr ? "حفظ التنبيه" : "Save alert"}</Button>{!ready && message ? <Button type="button" variant="secondary" onClick={() => void load()}>{isAr ? "إعادة التحميل" : "Reload"}</Button> : null}<p role="status" aria-live="polite" className="text-sm text-[#D1D5DB]">{message || (!ready ? (isAr ? "جارٍ تحميل إعداداتك…" : "Loading your preferences…") : "")}</p></div>
    <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? "الإشعارات تتبع إعدادات قنوات الإشعار الحالية. تحقق دائمًا من السعر والكمية المتاحة داخل العرض." : "Delivery follows your existing notification-channel preferences. Always check the listing's current price and available amount."}</p>
  </MarketplaceToolPanel>;
}
