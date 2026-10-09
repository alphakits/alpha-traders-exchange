"use client";

import { BookOpen, Crown, GraduationCap, LayoutDashboard, List, Settings, UserRound, WalletCards } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type ProfileSection = "overview" | "edit" | "alerts";

export function ProfileSectionTabs({ locale, value, onChange }: {
  locale: "en" | "ar";
  value: ProfileSection;
  onChange: (section: ProfileSection) => void;
}) {
  const isAr = locale === "ar";
  const sections = [
    { key: "overview", label: isAr ? "نظرة عامة" : "Overview" },
    { key: "edit", label: isAr ? "تعديل الملف" : "Edit profile" },
    { key: "alerts", label: isAr ? "التنبيهات" : "Alerts" },
  ] as const;

  return <div role="tablist" aria-label={isAr ? "أقسام الملف الشخصي" : "Profile sections"} className="profile-section-tabs">
    {sections.map((section, index) => <button
      key={section.key}
      id={`profile-tab-${section.key}`}
      type="button"
      role="tab"
      aria-selected={value === section.key}
      aria-controls={`profile-panel-${section.key}`}
      tabIndex={value === section.key ? 0 : -1}
      onClick={() => onChange(section.key)}
      onKeyDown={(event) => {
        let next: number;
        if (event.key === "Home") next = 0;
        else if (event.key === "End") next = sections.length - 1;
        else if (event.key === "ArrowRight") next = (index + (isAr ? -1 : 1) + sections.length) % sections.length;
        else if (event.key === "ArrowLeft") next = (index + (isAr ? 1 : -1) + sections.length) % sections.length;
        else return;
        event.preventDefault();
        onChange(sections[next].key);
        document.getElementById(`profile-tab-${sections[next].key}`)?.focus();
      }}
    >{section.label}</button>)}
  </div>;
}

export function ProfileQuickActions({ locale, admin, owner, seller, trading, username, journalEnabled = false }: {
  locale: "en" | "ar";
  admin: boolean;
  owner: boolean;
  seller: boolean;
  trading: boolean;
  username: string;
  /** Set only when the authenticated journal route is released and enabled. */
  journalEnabled?: boolean;
}) {
  const isAr = locale === "ar";
  const actions = [
    admin
      ? { href: "/admin/alpha-exchange", label: owner ? (isAr ? "لوحة المالك" : "Owner Dashboard") : (isAr ? "لوحة الإدارة" : "Admin Dashboard"), icon: Crown }
      : seller
        ? { href: "/usdt-exchange#my-listings-section", label: isAr ? "مساحة البائع" : "Seller workspace", icon: List }
        : trading
          ? { href: "/dashboard", label: isAr ? "مساحة المشتري" : "Buyer workspace", accessibleLabel: isAr ? "مساحة المشتري — فتح لوحة المشتري" : "Buyer workspace — open buyer dashboard", icon: LayoutDashboard }
          : { href: "/academy", label: isAr ? "الأكاديمية" : "Academy", icon: GraduationCap },
    ...(trading ? [{ href: "/trades", label: isAr ? "صفقاتي" : "My trades", icon: WalletCards }] : []),
    { href: "/settings", label: isAr ? "إعدادات الحساب" : "Account settings", icon: Settings },
    { href: `/u/${encodeURIComponent(username)}`, label: isAr ? "الملف العام" : "Public profile", accessibleLabel: isAr ? "عرض الملف العام" : "Open public profile", icon: UserRound },
  ];

  return <nav aria-label={isAr ? "إجراءات سريعة" : "Quick actions"} className="profile-quick-actions">
    {actions.map(({ href, label, accessibleLabel, icon: Icon }, index) => <Link
      key={href}
      href={href}
      aria-label={accessibleLabel}
      className={cn("profile-quick-action", index === 0 && "profile-quick-action--primary", owner && index === 0 && "profile-quick-action--owner")}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </Link>)}
    {journalEnabled ? <Link href="/journal" className="profile-quick-action profile-quick-action--journal"><BookOpen aria-hidden="true" /><span>{isAr ? "سجل التداول" : "Trading journal"}</span></Link> : <div className="profile-quick-action profile-quick-action--journal" aria-label={isAr ? "سجل التداول — قريبًا" : "Trading journal — coming soon"}>
      <BookOpen aria-hidden="true" />
      <span>{isAr ? "سجل التداول" : "Trading journal"}<small>{isAr ? "قريبًا" : "Coming soon"}</small></span>
    </div>}
  </nav>;
}
