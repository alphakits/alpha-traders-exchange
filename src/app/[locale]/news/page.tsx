import { NewsPage } from "@/components/news/news-page";
import { readNewsFeed } from "@/lib/economic-news/repository";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { getSignedOutPageDestination } from "@/lib/protected-page";
import { redirect } from "next/navigation";
import { newsEventId } from "@/lib/economic-news/model";

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
  const eventId = newsEventId(search.event);
  const language = locale === "ar" ? "ar" : "en";
  // Resolve the actual session before reading or serializing any feed data.
  // A fabricated/expired cookie must not bypass the middleware guest check.
  const user = await getCurrentSessionUser();
  if (!user) {
    const destination = `/${language}/news${eventId ? `?event=${encodeURIComponent(eventId)}` : ""}`;
    redirect(getSignedOutPageDestination(destination));
  }
  const feed = await readNewsFeed(now, eventId);
  return <NewsPage key={eventId ?? "news"} locale={language} initialFeed={feed} initialNow={now} eventId={eventId} />;
}
