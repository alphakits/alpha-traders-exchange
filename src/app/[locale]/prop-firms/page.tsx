import { FirmDirectory } from "@/components/prop-firms/firm-directory";
import { buildPageMetadata } from "@/lib/seo";
import { requirePropFirmSession, type PropFirmSearchParams } from "@/lib/prop-firms/access";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: value } = await params;
  const locale = value === "ar" ? "ar" : "en";
  return buildPageMetadata({ locale, path: "/prop-firms", title: locale === "ar" ? "دليل الشركات المموّلة" : "Prop Firm Guides", description: locale === "ar" ? "شروط Topstep وMy Funded Futures وApex وFTMO وFundingPips: الحسابات، الامتحانات، السحب والحاسبة، من المصادر الرسمية." : "Understand Topstep, My Funded Futures, Apex, FTMO and FundingPips: account sizes, evaluation rules, payouts and calculators with official sources." });
}

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams?: Promise<PropFirmSearchParams> }) {
  const [{ locale: value }, search] = await Promise.all([params, searchParams]);
  const locale = value === "ar" ? "ar" : "en";
  await requirePropFirmSession(locale, undefined, search);
  return <FirmDirectory locale={locale} />;
}
