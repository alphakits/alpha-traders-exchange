import { notFound } from "next/navigation";
import { FirmGuide } from "@/components/prop-firms/firm-guide";
import { getPropFirm, propFirms } from "@/lib/prop-firms";
import { buildPageMetadata } from "@/lib/seo";
import { requirePropFirmSession, type PropFirmSearchParams } from "@/lib/prop-firms/access";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; firm: string }>; searchParams: Promise<PropFirmSearchParams> };
export async function generateMetadata({ params }: Props) {
  const { locale: value, firm: slug } = await params;
  const firm = getPropFirm(slug);
  if (!firm) return {};
  const locale = value === "ar" ? "ar" : "en";
  return buildPageMetadata({ locale, path: `/prop-firms/${firm.slug}`, title: `${firm.name} · ${locale === "ar" ? "الامتحان والسحب" : "Evaluation & Payouts"}`, description: firm.description[locale] });
}
export default async function Page({ params, searchParams }: Props) {
  const [{ locale, firm: slug }, search] = await Promise.all([params, searchParams]);
  await requirePropFirmSession(locale === "ar" ? "ar" : "en", slug, search);
  const firm = getPropFirm(slug);
  if (!firm) notFound();
  return <FirmGuide key={firm.slug} firm={firm} navigation={propFirms.map(({slug, name}) => ({slug, name}))} locale={locale === "ar" ? "ar" : "en"} initialProgram={typeof search.program === "string" ? search.program : undefined} initialSize={typeof search.size === "string" ? Number(search.size) : undefined} />;
}
