import { notFound, redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { getSignedOutPageDestination } from "@/lib/protected-page";
import { assertDemandActor, demandEnabled } from "@/lib/usdt-demand-policy";
import { UsdtRequestsWorkspace } from "@/components/sections/usdt-exchange/usdt-requests-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request USDT | Alpha Traders", robots: { index: false, follow: false } };
export default async function RequestsPage({ params }: { params: Promise<{ locale: "en" | "ar"; demandId?: string[] }> }) {
  if (!demandEnabled()) notFound();
  const { locale, demandId } = await params;
  if (demandId && demandId.length !== 1) notFound();
  const user = await getCurrentSessionUser();
  if (!user) redirect(getSignedOutPageDestination(`/${locale}/usdt-exchange/requests${demandId ? `/${encodeURIComponent(demandId[0])}` : ""}`));
  try { assertDemandActor(user); } catch { redirect(`/${locale}/usdt-exchange`); }
  return <UsdtRequestsWorkspace key={user.id} actorId={user.id} locale={locale} demandId={demandId?.[0]} />;
}
