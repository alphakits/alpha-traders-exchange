import analyses from "@/data/market-analysis.json";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({ locale: locale === "ar" ? "ar" : "en", title: locale === "ar" ? "الأخبار" : "News", description: locale === "ar" ? "ملاحظات وتحليلات Alpha Traders." : "Market notes and analysis from Alpha Traders.", path: "/news" });
}
export default async function NewsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";
  return <section className="section-container py-6 sm:py-8"><p className="text-xs tracking-widest text-[#D4AF37]">ALPHA JOURNAL</p><h1 className="mt-2 text-3xl font-semibold">{isAr ? "الأخبار والتحليلات" : "News & analysis"}</h1><p className="mt-2 text-sm text-slate-400">{isAr ? "أرشيف ملاحظات السوق المنشورة من Alpha Traders." : "Published market notes from the Alpha Traders archive."}</p>
    <div className="mt-6 grid gap-4 md:grid-cols-2">{[...analyses].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map((article) => <article key={article.id} className="rounded-2xl border border-white/10 bg-[#0d1118] p-6"><time className="text-xs text-slate-500" dateTime={article.publishedAt}>{new Date(`${article.publishedAt}T12:00:00Z`).toLocaleDateString(isAr ? "ar-IL" : "en-GB", { day: "numeric", month: "long", year: "numeric" })}</time><h2 className="mt-4 text-xl font-semibold">{isAr ? article.titleAr : article.title}</h2><p className="mt-3 text-sm leading-7 text-slate-400">{isAr ? article.summaryAr : article.summary}</p></article>)}</div>
  </section>;
}
