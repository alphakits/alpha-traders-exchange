"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { consumeActionResult } from "@/lib/client-success-navigation";
import { ActionFeedback } from "./action-feedback";

/** Preserve confirmed action feedback when its next step opens another page. */
export function RouteActionFeedback({ locale }: { locale: "en" | "ar" }) {
  const pathname = usePathname();
  const [result, setResult] = useState<{ path: string; message: string } | null>(null);

  useEffect(() => {
    const message = consumeActionResult(pathname);
    if (message) setResult({ path: pathname, message });
    else setResult((previous) => previous?.path === pathname ? previous : null);
  }, [pathname]);

  if (!result || result.path !== pathname) return null;
  return (
    <div className="section-container pt-4">
      <ActionFeedback revealKey={result} className="flex items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4 text-sm text-emerald-100">
        <span>{result.message}</span>
        <button type="button" onClick={() => setResult(null)} aria-label={locale === "ar" ? "إغلاق النتيجة" : "Dismiss result"} className="shrink-0 rounded px-2 text-lg leading-5">×</button>
      </ActionFeedback>
    </div>
  );
}
