"use client";

import { useMemo } from "react";
import type { AppLocale } from "@/i18n/routing";
import type { HeaderNavItem } from "@/components/layout/header-nav";
import { Link } from "@/i18n/navigation";
import type { ClientSessionUser } from "@/lib/client-session-user";
import { hasRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { LogoutButton } from "@/components/auth/logout-button";
import { CreateListingQuickLink } from "@/components/layout/create-listing-quick-link";
import { MobileNavigationMenu } from "@/components/layout/mobile-navigation-menu";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";

type SessionUserSummary = Pick<ClientSessionUser, "id" | "fullName" | "role" | "roles" | "sellerStatus">;

type HeaderAuthLabels = {
  signIn: string;
  profile: string;
  signOut: string;
  notifications: string;
  createListing: string;
  adminDashboard: string;
  openMenu: string;
};

function canAccessSellerWorkspace(user: SessionUserSummary | null) {
  return Boolean(user && (hasRole(user, "approved_seller") || hasRole(user, "admin") || hasRole(user, "owner")));
}

function canAccessAdminDashboard(user: SessionUserSummary | null) {
  return Boolean(user && hasRole(user, "admin"));
}

export function HeaderAuthArea({
  locale,
  navItems,
  labels,
  initialSessionUser,
}: {
  locale: AppLocale;
  navItems: HeaderNavItem[];
  labels: HeaderAuthLabels;
  initialSessionUser: SessionUserSummary | null;
}) {
  const { user: canonicalUser, isResolving } = useCanonicalSession();
  const sessionUser = (isResolving ? initialSessionUser : canonicalUser) as SessionUserSummary | null;
  const dashboardHref = sessionUser ? "/profile" : "/login";
  const dashboardLabel = sessionUser ? labels.profile : labels.signIn;

  const sellerWorkspaceAccess = useMemo(() => canAccessSellerWorkspace(sessionUser), [sessionUser]);
  const adminDashboardAccess = useMemo(() => canAccessAdminDashboard(sessionUser), [sessionUser]);

  return (
    <div className="flex min-w-0 items-center gap-1 sm:gap-2 [&_summary]:h-11 [&_summary]:w-11">
      <div className="shrink-0 [&>button]:h-11">
        <LocaleSwitcher />
      </div>
      {sessionUser ? (
        <div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-3 py-1 text-xs text-[#D1D5DB] sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
          <span className="max-w-[140px] truncate">{sessionUser.fullName}</span>
        </div>
      ) : null}
      {!sessionUser ? (
        <Link href={dashboardHref} locale={locale} className={cn(buttonVariants({ size: "sm" }), "hidden min-[430px]:inline-flex sm:hidden")}>
          {dashboardLabel}
        </Link>
      ) : null}
      {sellerWorkspaceAccess ? (
        <CreateListingQuickLink
          className="hidden items-center gap-1.5 rounded-full border border-[#C9A227]/50 bg-gradient-to-r from-[#C9A227]/20 to-[#D4AF37]/10 px-3 py-1.5 text-xs font-semibold text-[#F4D87A] shadow-[0_4px_16px_rgba(201,162,39,0.25)] transition hover:border-[#C9A227]/70 hover:shadow-[0_6px_20px_rgba(201,162,39,0.35)] md:inline-flex"
          label={labels.createListing}
        />
      ) : null}
      {sessionUser ? <NotificationBell locale={locale} /> : null}
      {sessionUser ? (
        <LogoutButton
          locale={locale}
          size="sm"
          variant="secondary"
          className="hidden text-[#D1D5DB] hover:bg-white/10 hover:text-white sm:inline-flex"
          idleLabel={labels.signOut}
        />
      ) : null}
      <MobileNavigationMenu label={labels.openMenu}>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              locale={locale}
              className={
                item.cta
                  ? "group relative flex min-h-11 items-center overflow-hidden rounded-full border border-[#6CAEFF]/45 bg-gradient-to-r from-[#1B60ED]/85 via-[#2A7BFF]/80 to-[#3A9DFF]/75 px-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(36,121,255,0.32)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(36,121,255,0.42)]"
                  : "flex min-h-11 items-center rounded-xl px-3 text-sm text-[#D1D5DB] transition hover:bg-white/5 hover:text-white"
              }
            >
              {item.label}
              {item.cta ? (
                <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 transition duration-700 group-hover:left-[120%] group-hover:opacity-100" />
              ) : null}
            </Link>
          ))}
          <div className="border-t border-white/10 pt-2">
            {sessionUser ? (
              <div className="rounded-lg px-3 py-2 text-xs text-[#9CA3AF]">
                {sessionUser.fullName}
              </div>
            ) : null}
            <Link href={dashboardHref} locale={locale} className="flex min-h-11 items-center rounded-xl px-3 text-sm text-[#D1D5DB] transition hover:bg-white/5 hover:text-white">
              {dashboardLabel}
            </Link>
            {sellerWorkspaceAccess ? (
              <CreateListingQuickLink
                className="block rounded-xl px-3 py-2 text-sm font-medium text-[#F4D87A] transition hover:bg-[#C9A227]/10"
                label={labels.createListing}
              />
            ) : null}
            {sessionUser ? (
              <Link href="/notifications" locale={locale} className="flex min-h-11 items-center rounded-xl px-3 text-sm text-[#D1D5DB] transition hover:bg-white/5 hover:text-white">
                {labels.notifications}
              </Link>
            ) : null}
            {adminDashboardAccess ? (
              <Link
                href="/admin/alpha-exchange"
                locale={locale}
                className="block rounded-xl border border-[#C9A227]/40 bg-[#C9A227]/10 px-3 py-2 text-sm font-medium text-[#F4D87A] transition hover:border-[#C9A227]/60 hover:bg-[#C9A227]/15"
              >
                🛠 {labels.adminDashboard}
              </Link>
            ) : null}
            {sessionUser ? (
              <LogoutButton
                locale={locale}
                variant="ghost"
                className="mt-1 w-full justify-start rounded-xl px-3 text-start text-sm text-[#D1D5DB] hover:bg-white/5 hover:text-white"
                idleLabel={labels.signOut}
              />
            ) : null}
          </div>
        </nav>
      </MobileNavigationMenu>
      <Link href={dashboardHref} locale={locale} className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex")}>
        {dashboardLabel}
      </Link>
    </div>
  );
}
