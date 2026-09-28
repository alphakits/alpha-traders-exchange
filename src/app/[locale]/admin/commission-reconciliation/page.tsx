import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { CommissionReceiptReviewPanel } from "@/components/admin/commission-receipt-review-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Commission receipt reconciliation", robots: { index: false, follow: false } };
export default async function CommissionReconciliationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();
  if (!user || user.disabled) redirect(`/${locale}/login?redirectTo=${encodeURIComponent(`/${locale}/admin/commission-reconciliation`)}`);
  if (!hasRole(user, "owner")) redirect(`/${locale}/usdt-exchange`);
  return <CommissionReceiptReviewPanel locale={locale === "ar" ? "ar" : "en"} />;
}
