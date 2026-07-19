import { buildPageMetadata } from "@/lib/seo";
import { FounderPage } from "@/components/sections/founder/founder-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: "Founder | Alpha Traders",
    description: "تعرف على مؤسس Alpha Traders، قصته، ورسالة الأكاديمية المجانية.",
    path: "/founder",
  });
}

export default function FounderRoutePage() {
  return <FounderPage />;
}
