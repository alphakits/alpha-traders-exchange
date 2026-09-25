import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentSessionUser } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const [{ locale }, user] = await Promise.all([params, getCurrentSessionUser()]);
  const isOwner = user && !user.disabled && hasRole(user, "owner");
  return <>
    {isOwner ? <nav aria-label={locale === "ar" ? "أدوات المالك" : "Owner tools"} className="mx-auto flex max-w-7xl flex-wrap gap-3 px-4 py-3 text-sm">
      <Link className="rounded-lg border border-white/15 px-4 py-2" href={`/${locale}/admin/alpha-exchange`}>{locale === "ar" ? "لوحة الإدارة" : "Owner dashboard"}</Link>
      <Link className="rounded-lg border border-emerald-500/40 px-4 py-2 text-emerald-300" href={`/${locale}/admin/commission-reconciliation`}>{locale === "ar" ? "مطابقة إيصالات العمولات" : "Commission receipt reconciliation"}</Link>
    </nav> : null}
    {children}
  </>;
}
