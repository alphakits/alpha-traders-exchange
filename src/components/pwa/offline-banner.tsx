"use client";

import { useEffect, useState } from "react";
import type { AppLocale } from "@/i18n/routing";

export function OfflineBanner({ locale }: { locale: AppLocale }) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[70] bg-black/90 px-4 py-2 text-center text-xs text-[#E5E7EB]">
      {locale === "ar" ? "أنت غير متصل بالإنترنت. أعد الاتصال للمتابعة." : "You’re offline. Reconnect to continue trading."}
    </div>
  );
}
