import { buildPageMetadata } from "@/lib/seo";
import { FounderPage } from "@/components/sections/founder/founder-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "المؤسس" : "Founder",
    description: locale === "ar"
      ? "تعرف على مؤسس Alpha Traders، قصته، ورسالة الأكاديمية المجانية."
      : "Meet the founder of Alpha Traders, his story, and the mission behind the free Academy.",
    path: "/founder",
  });
}

export default function FounderRoutePage() {
  return <FounderPage />;
}
