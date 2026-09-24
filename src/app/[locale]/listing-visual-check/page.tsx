import { Suspense } from "react";
import ListingVisualFixture from "./fixture";
export default async function Page({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ frame?: string; width?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  if (query.frame === "1") return <Suspense><ListingVisualFixture locale={locale === "ar" ? "ar" : "en"} /></Suspense>;
  const width = ["320", "390", "430", "1440"].includes(query.width ?? "") ? Number(query.width) : 390;
  return <div>
    <nav>{["en", "ar"].map(lang => [320, 390, 430, 1440].map(size =>
      <a key={lang + size} style={{ margin: 12 }} href={`/${lang}/listing-visual-check?width=${size}`}>{lang} {size}px</a>))}</nav>
    <iframe title="Listing viewport" style={{ width, height: 850, maxWidth: "none", border: "1px solid #555" }} src={`/${locale}/listing-visual-check?frame=1`} />
  </div>;
}
