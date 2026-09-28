import { FirmDirectory } from "@/components/prop-firms/firm-directory";
import { buildPageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: value } = await params;
  const locale = value === "ar" ? "ar" : "en";
  return buildPageMetadata({ locale, path: "/prop-firms", title: locale === "ar" ? "دليل الشركات المموّلة" : "Prop Firm Guides", description: locale === "ar" ? "شروط Topstep وMy Funded Futures وApex وFTMO وFundingPips: الحسابات، الامتحانات، السحب والحاسبة، من المصادر الرسمية." : "Understand Topstep, My Funded Futures, Apex, FTMO and FundingPips: account sizes, evaluation rules, payouts and calculators with official sources." });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <FirmDirectory locale={locale === "ar" ? "ar" : "en"} />;
}
