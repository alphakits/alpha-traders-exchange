"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin, LocateFixed, LoaderCircle } from "lucide-react";
import { parseTradeChatLocation, type TradeChatLocation } from "@alpha-traders/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TradeLocationCard } from "./trade-location-card";
import { TradeLocationMap } from "./trade-location-map";

export function TradeLocationComposer({ isAr, disabled, onSend }: {
  isAr: boolean; disabled: boolean; onSend: (location: TradeChatLocation) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [candidate, setCandidate] = useState<TradeChatLocation>();
  const [mapOpen, setMapOpen] = useState(false);
  const [mapRevision, setMapRevision] = useState(0);
  const [locating, setLocating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const action = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const toggle = useRef<HTMLButtonElement>(null);
  const sectionId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; action.current += 1; }; }, []);
  const reset = () => {
    action.current += 1; setOpen(false); setCandidate(undefined); setMapOpen(false);
    setLocating(false); setError(undefined); setLatitude(""); setLongitude("");
    setReloadRequired(false); toggle.current?.focus();
  };
  const select = (point: TradeChatLocation, resetMap = true) => {
    if (disabled || sending || inFlight.current) return;
    action.current += 1; setLocating(false); setError(undefined);
    setCandidate(parseTradeChatLocation(point));
    if (resetMap) setMapRevision(value => value + 1);
  };
  const locate = () => {
    if (disabled || locating || sending) return;
    setError(undefined); setReloadRequired(false);
    const policy = (document as Document & { permissionsPolicy?: { allowsFeature: (name: string) => boolean }; featurePolicy?: { allowsFeature: (name: string) => boolean } });
    if ((policy.permissionsPolicy ?? policy.featurePolicy)?.allowsFeature("geolocation") === false) {
      setReloadRequired(true);
      setError(isAr ? "هذه الصفحة المفتوحة لا تسمح بتحديد الموقع. أعد تحميل الغرفة لتفعيل الإذن أو اختر نقطة لقاء بدون GPS." : "This open document blocks location access. Reload the room to enable permission, or choose a meeting point without GPS.");
      return;
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      setError(isAr ? "تحديد الموقع غير متاح في هذا المتصفح. اختر نقطة لقاء على الخريطة." : "Location access is unavailable in this browser. Choose a meeting point on the map."); return;
    }
    const token = ++action.current; setLocating(true); setCandidate(undefined);
    // A single explicit request, never watchPosition and never an effect on page load.
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current || token !== action.current) return;
      setLocating(false);
      try { setCandidate(parseTradeChatLocation({ version: 1, latitude: position.coords.latitude, longitude: position.coords.longitude, source: "current", accuracyMeters: position.coords.accuracy })); setMapRevision(value => value + 1); }
      catch { setError(isAr ? "تعذر الحصول على موقع صالح. اختر نقطة اللقاء يدويًا." : "A valid location could not be obtained. Choose the meeting point manually."); }
    }, failure => {
      if (!mounted.current || token !== action.current) return;
      setLocating(false);
      setError(failure.code === 1
        ? (isAr ? "إذن الموقع مرفوض. اسمح به من إعدادات المتصفح أو اختر نقطة لقاء على الخريطة." : "Location permission was denied. Allow it in browser settings or choose a point on the map.")
        : failure.code === 3
          ? (isAr ? "تحديد الموقع أخذ وقتًا طويلًا. حاول مرة أخرى أو اختر نقطة اللقاء على الخريطة." : "Location access timed out. Retry or choose a meeting point on the map.")
          : (isAr ? "موقع الجهاز غير متاح الآن. اختر نقطة اللقاء على الخريطة." : "Your device location is unavailable. Choose the meeting point on the map."));
    }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
  };
  const confirm = async () => {
    if (!candidate || disabled || inFlight.current || locating) return;
    inFlight.current = true; setSending(true); setError(undefined);
    try {
      const confirmed = await onSend(candidate);
      if (!mounted.current) return;
      if (confirmed) { reset(); setSent(true); }
      else setError(isAr ? "لم نتأكد من الإرسال. الموقع محفوظ هنا للمحاولة مجددًا، بدون إنشاء رسالة مكررة." : "Delivery was not confirmed. Your location stays here for a safe retry without a duplicate message.");
    } catch {
      if (mounted.current) setError(isAr ? "تعذر إرسال الموقع. حاول مرة أخرى." : "The location could not be sent. Please retry.");
    } finally { inFlight.current = false; if (mounted.current) setSending(false); }
  };
  return <div data-testid="trade-location-composer" className="space-y-2" dir={isAr ? "rtl" : "ltr"}>
    <Button ref={toggle} type="button" variant="secondary" size="sm" disabled={disabled || sending} aria-expanded={open} aria-controls={sectionId}
      onClick={() => { setSent(false); if (open) reset(); else setOpen(true); }}><MapPin className="h-4 w-4" aria-hidden="true" />{isAr ? "إرسال موقع اللقاء" : "Share meeting location"}</Button>
    {sent ? <p role="status" className="text-sm leading-6 text-emerald-300">{isAr ? "تم إرسال الموقع داخل الشات. الطرف الثاني بقدر يفتح Waze أو Google Maps للوصول." : "Location sent in the chat. The other person can open Waze or Google Maps for directions."}</p> : null}
    {open ? <section id={sectionId} aria-label={isAr ? "مشاركة موقع للقاء وجهًا لوجه" : "Share a Face-to-Face meeting location"} className="space-y-3 rounded-xl border border-[#C9A227]/30 bg-black/30 p-3">
      <p className="text-xs font-semibold leading-6 text-[#E8C766]">{isAr ? "١. اختَر الموقع · ٢. راجع المعاينة · ٣. أكّد الإرسال" : "1. Choose location · 2. Check preview · 3. Confirm send"}</p>
      <p className="text-sm leading-6">{isAr ? "اختَر مكانًا عامًا مناسبًا للقاء. الموقع يُرسل داخل هذه الصفقة فقط بعد تأكيدك، ويمكن لإدارة المنصة الاطلاع عليه. مش تتبّع مباشر." : "Choose a suitable public meeting place. Location is sent only in this trade after you confirm; authorized platform staff can also access it. This is not live tracking."}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={disabled || locating || sending} onClick={locate}>{locating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LocateFixed className="h-4 w-4" aria-hidden="true" />}{isAr ? "تحديد موقعي الحالي" : "Use my current location"}</Button>
        <Button type="button" variant="secondary" size="sm" disabled={disabled || sending} onClick={() => { action.current += 1; setLocating(false); setMapOpen(value => !value); }}>{isAr ? "اختيار نقطة على الخريطة" : "Choose on map"}</Button>
      </div>
      <p className="text-xs leading-5 text-gray-400">{isAr ? "فتح الخريطة يحمّل الخرائط من OpenStreetMap. فتح الملاحة يشارك الوجهة مع تطبيق الخرائط المختار." : "Opening the picker loads maps from OpenStreetMap. Opening navigation shares the destination with the selected map provider."}</p>
      {mapOpen ? <TradeLocationMap key={mapRevision} initial={candidate} isAr={isAr} onSelect={point => select(point, false)} disabled={disabled || sending || locating} /> : null}
      <details className="rounded-lg border border-white/10 p-2"><summary className="min-h-11 cursor-pointer text-xs">{isAr ? "بديل: إدخال إحداثيات نقطة لقاء" : "Alternative: enter meeting coordinates"}</summary>
        <div className="mt-2 space-y-2"><label className="block text-xs">{isAr ? "خط العرض" : "Latitude"}<Input dir="ltr" inputMode="decimal" value={latitude} disabled={sending || disabled} onChange={event => { setLatitude(event.target.value); setCandidate(undefined); setError(undefined); }} placeholder="32.123456" /></label>
          <label className="block text-xs">{isAr ? "خط الطول" : "Longitude"}<Input dir="ltr" inputMode="decimal" value={longitude} disabled={sending || disabled} onChange={event => { setLongitude(event.target.value); setCandidate(undefined); setError(undefined); }} placeholder="35.123456" /></label>
          <Button type="button" size="sm" variant="secondary" disabled={sending || disabled} onClick={() => {
            try { if (!latitude.trim() || !longitude.trim() || !/^-?\d+(?:\.\d+)?$/.test(latitude.trim()) || !/^-?\d+(?:\.\d+)?$/.test(longitude.trim())) throw new Error();
              select(parseTradeChatLocation({ version: 1, latitude: Number(latitude), longitude: Number(longitude), source: "meeting_point" }));
            } catch { setError(isAr ? "أدخل إحداثيات صحيحة، وليس رقم هاتف أو رابطًا." : "Enter valid coordinates, not a phone number or link."); }
          }}>{isAr ? "معاينة نقطة اللقاء" : "Preview meeting point"}</Button>
        </div>
      </details>
      {locating ? <p role="status" className="text-xs">{isAr ? "جاري تحديد الموقع… لم يتم إرسال أي شيء." : "Finding your location… Nothing has been sent."}</p> : null}
      {candidate ? <><p className="text-xs font-semibold text-amber-200">{isAr ? "معاينة فقط — لم يتم الإرسال" : "Preview only — not sent"}</p><TradeLocationCard location={candidate} isAr={isAr} />
        {candidate.accuracyMeters !== undefined && candidate.accuracyMeters > 100 ? <p role="status" className="text-xs text-amber-200">{isAr ? "دقة الموقع منخفضة. تأكد من نقطة اللقاء أو عدّلها على الخريطة قبل الإرسال." : "Location accuracy is low. Check or adjust the meeting point on the map before sending."}</p> : null}</> : null}
      {error ? <p role="alert" className="text-sm leading-6 text-red-200">{error}</p> : null}
      {reloadRequired ? <Button type="button" variant="secondary" size="sm" onClick={() => window.location.reload()}>{isAr ? "إعادة تحميل الغرفة (يُمسح النص غير المرسل)" : "Reload room (unsent text will be cleared)"}</Button> : null}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={!candidate || disabled || locating || sending} onClick={() => void confirm()}>{sending ? (isAr ? "جاري الإرسال…" : "Sending…") : (isAr ? "تأكيد وإرسال الموقع" : "Confirm and send location")}</Button>
        <Button type="button" variant="secondary" disabled={sending} onClick={reset}>{isAr ? "إلغاء" : "Cancel"}</Button></div>
    </section> : null}
  </div>;
}
