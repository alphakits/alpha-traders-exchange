import { MapPin, Navigation } from "lucide-react";
import { readTradeChatLocation, tradeLocationMapLinks } from "@alpha-traders/contracts";

/** No map images, analytics, geocoding or third-party requests until a person explicitly opens navigation. */
export function TradeLocationCard({ location: value, isAr }: { location: unknown; isAr: boolean }) {
  const location = readTradeChatLocation(value);
  if (!location) return null;
  const links = tradeLocationMapLinks(location);
  return <section data-testid="trade-location-card" className="my-2 space-y-3 rounded-xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-3" dir={isAr ? "rtl" : "ltr"}>
    <div className="flex items-center gap-2"><MapPin className="h-5 w-5 shrink-0 text-[#E8C766]" aria-hidden="true" />
      <p className="font-semibold">{location.source === "current" ? (isAr ? "الموقع وقت الإرسال" : "Location at time of sharing") : (isAr ? "نقطة اللقاء" : "Meeting point")}</p>
    </div>
    <p className="text-xs leading-5 text-gray-300">{isAr ? "موقع ثابت، مش تتبّع مباشر. رتّبوا اللقاء هون داخل الشات." : "A fixed location, not live tracking. Arrange the meeting in this chat."}</p>
    <p className="text-xs text-gray-400"><bdi dir="ltr">{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</bdi>
      {location.accuracyMeters !== undefined ? <span className="ms-2">{isAr ? "الدقة التقريبية" : "Approx. accuracy"}: {location.accuracyMeters} {isAr ? "م" : "m"}</span> : null}
    </p>
    <div className="flex flex-wrap gap-2">
      <a href={links.waze} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#C9A227] px-3 py-2 text-sm font-semibold text-black"><Navigation className="h-4 w-4" aria-hidden="true" />{isAr ? "فتح بـWaze" : "Open in Waze"}</a>
      <a href={links.google} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/20 px-3 py-2 text-sm">Google Maps</a>
    </div>
  </section>;
}
