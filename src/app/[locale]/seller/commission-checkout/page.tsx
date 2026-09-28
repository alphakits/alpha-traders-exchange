import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { CommissionCheckoutPanel } from "@/components/sections/usdt-exchange/commission-checkout-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Automatic commission checkout | Alpha Traders", robots: { index: false, follow: false } };
export default async function CommissionCheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();
  if (!user || user.disabled) redirect(`/${locale}/login?redirectTo=${encodeURIComponent(`/${locale}/seller/commission-checkout`)}`);
  if (!(user.sellerStatus === "approved_seller" || user.sellerStatus === "suspended" || hasRole(user, "pending_seller_approval") || hasRole(user, "owner") || hasRole(user, "admin"))) redirect(`/${locale}/usdt-exchange`);
  return <CommissionCheckoutPanel isAr={locale === "ar"} />;
}
