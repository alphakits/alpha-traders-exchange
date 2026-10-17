import { redirect } from "next/navigation";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { AlphaExchangeAdminDashboard } from "@/components/admin/alpha-exchange-admin-dashboard";
import { OwnerLiveAnalyticsPanel } from "@/components/admin/owner-live-analytics-panel";

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
  const isOwner = hasRole(user, "owner");
  if (!isOwner && !hasRole(user, "admin")) {
    redirect(`/${locale}/usdt-exchange`);
  }

  // The exchange snapshot includes owner-only personal and financial records.
  // Do not mount its polling dashboard for an admin who cannot read that API.
  if (!isOwner) {
    const isAr = locale === "ar";
    return <section className="section-container page-shell" dir={isAr ? "rtl" : "ltr"}>
      <h1 className="text-2xl font-semibold text-white">{isAr ? "لوحة عمليات الإدارة" : "Admin Operations Dashboard"}</h1>
      <p className="mt-4 max-w-2xl text-[#D1D5DB]">{isAr
        ? "سجلات الصفقات والبيانات الشخصية والأدوات المالية متاحة لمالك المنصة فقط. يمكنك متابعة إدارة حسابك من ملفك الشخصي."
        : "Exchange records, personal details and financial controls are available to the platform owner only. You can continue managing your account from your profile."}</p>
      <Link href={`/${locale}/profile`} className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-[#C9A227]/40 px-4 text-[#F4D87A] underline underline-offset-4">
        {isAr ? "فتح ملفي الشخصي" : "Open my profile"}
      </Link>
    </section>;
  }

  return <>
    <OwnerLiveAnalyticsPanel locale={locale === "ar" ? "ar" : "en"} />
    <AlphaExchangeAdminDashboard locale={locale === "ar" ? "ar" : "en"} isOwner />
  </>;
}
