import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { AlphaExchangeAdminDashboard } from "@/components/admin/alpha-exchange-admin-dashboard";
import { OwnerLiveAnalyticsPanel } from "@/components/admin/owner-live-analytics-panel";
import { Link } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

const ADMIN_DESTINATION_QUERY_KEYS = [
  "section",
  "sellerApplication",
  "listing",
  "status",
  "requestId",
  "request",
  "commissionId",
  "commission",
  "tab",
] as const;

function buildAdminDestination(locale: string, searchParams: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const key of ADMIN_DESTINATION_QUERY_KEYS) {
    const value = searchParams[key];
    if (typeof value === "string" && value.trim()) {
      query.set(key, value.trim());
    }
  }
  const search = query.toString();
  return `/${locale}/admin/alpha-exchange${search ? `?${search}` : ""}`;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "لوحة إدارة Alpha Exchange" : "Alpha Exchange Admin Dashboard",
    description: locale === "ar" ? "لوحة إدارة داخلية خاصة بـ Alpha Exchange." : "Private internal dashboard for Alpha Exchange administration.",
    path: "/admin/alpha-exchange",
  });
}

export default async function AlphaExchangeAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect(`/${locale}/login?redirectTo=${encodeURIComponent(buildAdminDestination(locale, query))}`);
  }
  if (!hasRole(user, "admin")) {
    redirect(`/${locale}/usdt-exchange`);
  }

  return <>
    {hasRole(user, "owner") ? <div className="section-container pt-6"><Link href="/admin/learning-interest" className="inline-flex min-h-11 items-center rounded-full border border-[#C9A227]/40 px-5 py-2 text-sm text-[#C9A227]">{locale === "ar" ? "طلبات التعلّم مع مارك" : "Learning with Mark Enquiries"}</Link></div> : null}
    {hasRole(user, "owner") ? <OwnerLiveAnalyticsPanel locale={locale === "ar" ? "ar" : "en"} /> : null}
    <AlphaExchangeAdminDashboard locale={locale === "ar" ? "ar" : "en"} isOwner={hasRole(user, "owner")} />
  </>;
}
