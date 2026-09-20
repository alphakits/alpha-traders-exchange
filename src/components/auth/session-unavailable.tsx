"use client";

import { useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { reloadAfterSessionRecovery, reloadCurrentPage } from "@/lib/page-recovery";

export function SessionUnavailable({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let disposed = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;

    const check = async () => {
      if (disposed) return;
      if (document.visibilityState === "hidden" || navigator.onLine === false) {
        retryTimer = setTimeout(check, 5_000);
        return;
      }
      attempts += 1;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 30_000);
      try {
        // Only re-read the session. Trade actions must never be retried here.
        const response = await fetch("/api/auth/me", {
          cache: "no-store", credentials: "include", signal: controller.signal,
        });
        if (response.ok) {
          const payload: unknown = await response.json();
          if (payload && typeof payload === "object" && "user" in payload && !disposed) {
            setChecking(false);
            reloadAfterSessionRecovery();
            return;
          }
        }
      } catch {
        // A bounded read retry also handles offline and timed-out requests.
      } finally {
        clearTimeout(timeout);
      }
      if (disposed) return;
      if (attempts < 5) {
        retryTimer = setTimeout(check, Math.min(1_000 * 2 ** attempts, 30_000));
      } else {
        setChecking(false);
      }
    };
    retryTimer = setTimeout(check, 1_000);
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      controller?.abort();
    };
  }, []);

  return (
    <section dir={isAr ? "rtl" : "ltr"} className="flex min-h-[80vh] items-center justify-center px-4 text-white">
      <div className="surface-panel-subtle w-full max-w-lg space-y-5 p-8 text-center">
        <h1 className="text-2xl font-semibold">{isAr ? "تعذّر تحميل حسابك مؤقتًا" : "Your account could not be loaded"}</h1>
        <p role="status" aria-live="polite" className="text-sm leading-relaxed text-white/70">
          {checking
            ? (isAr ? "نحاول إعادة الاتصال. يمكنك أيضًا إعادة تحميل الصفحة نفسها." : "We are checking the connection. You can also reload this page.")
            : (isAr ? "أعد تحميل الصفحة للمحاولة مجددًا." : "Reload this page to try again.")}
        </p>
        <p className="text-sm leading-relaxed text-white/70">{isAr ? "إذا كنت داخل صفقة، لا تُنشئ صفقة بديلة ولا تعِد إرسال المبلغ بسبب هذا الخطأ." : "If you are in a trade, do not create a replacement trade or resend payment because of this error."}</p>
        <button type="button" onClick={reloadCurrentPage} className={buttonVariants()}>
          <RefreshCcw className="h-4 w-4" aria-hidden="true" />
          {isAr ? "إعادة تحميل الصفحة" : "Reload this page"}
        </button>
      </div>
    </section>
  );
}
