"use client";

import { useEffect, useRef, useState } from "react";
import { fetchClientJson } from "@/lib/client-request-deadline";

/** A dated observation on demand, never a hardcoded platform-wide promise. */
export function FooterConnectionCheck({ isAr }: { isAr: boolean }) {
  const active = useRef<AbortController | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "ok" | "error">("idle");
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  async function check() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setState("checking");
    try {
      const { response, payload } = await fetchClientJson<{
        status?: string; checks?: { database?: string }; timestamp?: string;
      }>("/api/health", { cache: "no-store", credentials: "omit", signal: controller.signal }, 5_000);
      const age = Date.now() - Date.parse(payload?.timestamp ?? "");
      if (!response.ok || payload?.status !== "ok" || payload?.checks?.database !== "ok" || !Number.isFinite(age) || age < -5_000 || age > 90_000) throw new Error("health_unconfirmed");
      if (active.current === controller) setState("ok");
    } catch {
      if (active.current === controller) setState("error");
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" onClick={check} disabled={state === "checking"} className="min-h-11 rounded-lg px-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait">
      {state === "checking" ? (isAr ? "جارٍ فحص الاتصال…" : "Checking connection…") : (isAr ? "فحص اتصال الموقع" : "Check website connection")}
    </button>
    <span role="status" className={state === "ok" ? "text-emerald-300" : "text-[#B8BFCC]"}>
      {state === "ok" ? (isAr ? "نجح آخر فحص" : "Last check passed") : state === "error" ? (isAr ? "تعذر تأكيد الاتصال. أعد المحاولة." : "Connection unconfirmed. Try again.") : ""}
    </span>
  </div>;
}
