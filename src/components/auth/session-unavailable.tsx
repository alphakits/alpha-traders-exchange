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
      if (disposed || controller) return;
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
            if (reloadAfterSessionRecovery()) {
              disposed = true;
              setChecking(false);
              return;
            }
          }
        }
      } catch {
        // Read retries use bounded backoff, including offline/timeouts.
      } finally {
        clearTimeout(timeout);
        controller = undefined;
      }
      if (disposed) return;
      retryTimer = setTimeout(check, Math.min(1_000 * 2 ** Math.min(attempts, 5), 30_000));
    };
    const resume = () => {
      if (disposed || controller || document.visibilityState === "hidden" || navigator.onLine === false) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(check, 0);
    };
    retryTimer = setTimeout(check, 1_000);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      controller?.abort();
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
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
