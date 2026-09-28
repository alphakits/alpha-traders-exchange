import { NewsPage } from "@/components/news/news-page";
import { readNewsFeed } from "@/lib/economic-news/repository";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({ locale: locale === "ar" ? "ar" : "en", path: "/news",
    title: locale === "ar" ? "أخبار الدولار" : "USD News",
    description: locale === "ar" ? "الأحداث الاقتصادية ذات التأثير المرتفع للدولار الأمريكي ونتائجها." : "High-impact USD economic events and released results.",
  });
}

export default async function NewsRoute({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ event?: string }>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  const now = Date.now();
  const eventId = typeof search.event === "string" && /^te-\d{1,24}$/.test(search.event) ? search.event : undefined;
  const feed = await readNewsFeed(now, eventId);
  return <NewsPage key={eventId ?? "news"} locale={locale === "ar" ? "ar" : "en"} initialFeed={feed} initialNow={now} eventId={eventId} />;
}
