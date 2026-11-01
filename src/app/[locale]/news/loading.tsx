import { getLocale } from "next-intl/server";

export default async function NewsLoading() {
  const isAr = (await getLocale()) === "ar";
  return <div className="section-container py-8" aria-busy="true"><div className="mx-auto max-w-5xl space-y-4"><p role="status" className="text-sm text-[#C7CDD6]">{isAr ? "جارٍ فتح الأخبار…" : "Opening news…"}</p><div aria-hidden="true" className="h-24 rounded-2xl bg-white/5 motion-safe:animate-pulse" /><div aria-hidden="true" className="h-52 rounded-2xl bg-white/5 motion-safe:animate-pulse" /></div></div>;
}
