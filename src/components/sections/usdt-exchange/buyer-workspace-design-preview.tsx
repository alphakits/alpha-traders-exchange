"use client";

import { BellRing, ShieldCheck, Store, TrendingUp, Trophy, Wallet } from "lucide-react";
import { AccountWelcome } from "@/components/ui/account-welcome";
import { BuyerRankCard } from "@/components/ui/buyer-rank-card";
import { Button } from "@/components/ui/button";
import { deriveBuyerRankSummary } from "@/lib/buyer-rank";
import { ExchangeWorkspaceNavigation, type ExchangeWorkspaceAction } from "./exchange-workspace-navigation";
import { useDesktopWorkspace } from "./use-desktop-workspace";

/** Shared UI with sample data only; the existing preview route blocks production. */
export function BuyerWorkspaceDesignPreview({ locale }: { locale: "en" | "ar" }) {
  const isAr = locale === "ar";
  const isDesktopWorkspace = useDesktopWorkspace();
  const previewAction = () => document.getElementById("sample-buyer-trades")?.scrollIntoView({ behavior: "smooth" });
  const cards: ExchangeWorkspaceAction[] = [
    { key: "browse-marketplace", title: isAr ? "العروض المباشرة" : "Live Listings", subtitle: isAr ? "تصفح البائعين" : "Browse Sellers", stat: "2", icon: Store, tone: "gold", onClick: previewAction },
    { key: "active-trades", title: isAr ? "الصفقات النشطة" : "Active Trades", subtitle: isAr ? "عرض صفقاتك الحالية" : "View your current trades", stat: "0", icon: Wallet, tone: "blue", onClick: previewAction },
    { key: "notifications", title: isAr ? "الإشعارات" : "Notifications", subtitle: isAr ? "مركز الإشعارات" : "Notification Center", stat: "0", icon: BellRing, tone: "green", onClick: previewAction },
    { key: "market", title: isAr ? "نظرة عامة على السوق" : "Market Overview", subtitle: isAr ? "سوق اليوم" : "Today’s Market", stat: "₪3.20", icon: TrendingUp, tone: "amber", onClick: previewAction },
    { key: "buyer-profile", title: isAr ? "ملفي وإنجازاتي" : "My Profile & Achievements", subtitle: isAr ? "عرض رتبتك وسجل تقدمك" : "View your rank and progress history", stat: isAr ? "فتح الملف" : "Open profile", icon: Trophy, tone: "blue", onClick: previewAction },
    { key: "account-settings", title: isAr ? "إعدادات الحساب" : "Account Settings", subtitle: isAr ? "الملف الشخصي والأمان" : "Profile and security", stat: isAr ? "إدارة الحساب" : "Manage account", icon: ShieldCheck, tone: "green", onClick: previewAction },
  ];
  const workspace = <ExchangeWorkspaceNavigation cards={isDesktopWorkspace ? cards : cards.slice(0, 2)} isAr={isAr} integrated={isDesktopWorkspace} compact={!isDesktopWorkspace} />;
  return (
    <main className="section-container py-6" dir={isAr ? "rtl" : "ltr"}>
      <p className="mb-4 text-xs text-[#9CA3AF]">{isAr ? "معاينة التصميم · حساب وأرقام توضيحية" : "Design preview · sample account and figures"}</p>
      <AccountWelcome role="buyer" locale={locale} name="Amir Hassan" description={isAr ? "مساحة عملك جاهزة. راقب نشاطك أولاً، ثم انتقل إلى السوق." : "Your workspace is ready. Track activity first, then jump into the marketplace."} greeting={isAr ? "صباح الخير" : "Good morning"}
        actions={<div className="account-welcome__actions"><Button onClick={previewAction}>{isAr ? "تصفح البائعين" : "Browse Sellers"}</Button>{isDesktopWorkspace ? <Button variant="secondary" onClick={previewAction}>{isAr ? "طلبات صفقاتي" : "My Trade Requests"}</Button> : null}</div>}
        workspace={isDesktopWorkspace ? workspace : undefined}
      >
        <BuyerRankCard locale={locale} summary={deriveBuyerRankSummary({ lifetimeCompletedVolumeUsdt: 52_500, completedTrades: 12, reviewsGiven: 12, activeTrades: 0 })} />
      </AccountWelcome>
      {!isDesktopWorkspace ? workspace : null}
      <div id="sample-buyer-trades" className="mt-6 scroll-mt-24 rounded-2xl border border-white/10 bg-black/30 p-6 text-center">
        <p className="font-semibold">{isAr ? "لا توجد صفقات نشطة حالياً." : "There are no active trades currently."}</p>
        <p className="mt-2 text-sm text-[#9CA3AF]">{isAr ? "هذه معاينة ببيانات توضيحية. في الحساب الحقيقي، يفتح كل زر الإجراء الخاص به." : "This preview uses sample data. In your account, each button opens its own action."}</p>
      </div>
    </main>
  );
}
