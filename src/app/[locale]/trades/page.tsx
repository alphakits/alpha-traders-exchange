import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { TradesWorkspace } from "@/components/sections/trades-workspace";

export const metadata = { title: "My trades | Alpha Traders", robots: { index: false, follow: false } };

export default async function TradesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale === "ar" ? "ar" : "en";
  const user = await getCurrentSessionUser();
  if (!user) redirect(`/${locale}/login?redirectTo=/${locale}/trades`);
  return <TradesWorkspace key={user.id} userId={user.id} sellerAccess={user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended"} locale={locale} />;
}
