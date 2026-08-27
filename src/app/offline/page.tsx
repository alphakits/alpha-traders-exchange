"use client";

import { useEffect, useState } from "react";

export default function OfflinePage() {
  const [isAr, setIsAr] = useState(false);

  useEffect(() => {
    const language = document.documentElement.lang || navigator.language;
    setIsAr(language.toLowerCase().startsWith("ar") || document.referrer.includes("/ar/"));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0B0B] px-6 text-center text-white" dir={isAr ? "rtl" : "ltr"}>
      <div className="max-w-md">
        <p className="text-2xl font-semibold">{isAr ? "أنت غير متصل بالإنترنت. أعد الاتصال للمتابعة." : "You’re offline. Reconnect to continue trading."}</p>
        <p className="mt-3 text-sm text-[#D1D5DB]">{isAr ? "تبقى إجراءات التداول معطلة حتى عودة الاتصال." : "Trading actions stay disabled until the connection returns."}</p>
      </div>
    </main>
  );
}
