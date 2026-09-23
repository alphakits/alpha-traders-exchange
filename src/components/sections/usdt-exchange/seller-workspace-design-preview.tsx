"use client";

import { BellRing, HandCoins, ShieldCheck, Store, TrendingUp, Trophy } from "lucide-react";
import { AccountWelcome } from "@/components/ui/account-welcome";
import { Button } from "@/components/ui/button";
import { SellerRankCard } from "@/components/ui/seller-rank-card";
import { ExchangeWorkspaceNavigation, type ExchangeWorkspaceAction } from "./exchange-workspace-navigation";

/** Sample data only; reachable through the existing non-production preview. */
export function SellerWorkspaceDesignPreview({ locale }: { locale: "en" | "ar" }) {
  const isAr = locale === "ar";
  const previewAction = () => document.getElementById("sample-requests")?.scrollIntoView({ behavior: "smooth" });
  const cards: ExchangeWorkspaceAction[] = [
    { key: "listings", title: isAr ? "عروضي" : "My Listings", subtitle: isAr ? "فتح مساحة إدارة العروض" : "Open listing workspace", stat: "2", icon: Store, tone: "gold", onClick: previewAction },
    { key: "trades", title: isAr ? "طلبات الشراء" : "Purchase Requests", subtitle: isAr ? "0 من الصفقات النشطة" : "0 active trades", stat: "0", icon: HandCoins, tone: "blue", onClick: previewAction },
    { key: "notifications", title: isAr ? "الإشعارات" : "Notifications", subtitle: isAr ? "مركز الإشعارات" : "Notification Center", stat: "0", icon: BellRing, tone: "green", onClick: previewAction },
    { key: "market", title: isAr ? "سوق اليوم" : "Today's Market", subtitle: isAr ? "تفاصيل السوق" : "Market Details", stat: "₪3.20", icon: TrendingUp, tone: "amber", onClick: previewAction },
    { key: "public-profile", title: isAr ? "ملفي وإنجازاتي" : "My Profile & Achievements", subtitle: isAr ? "مستوى البائع ورتبة المشتري" : "Seller level and buyer rank", stat: isAr ? "عرض الملف" : "View profile", icon: Trophy, tone: "blue", onClick: previewAction },
    { key: "account-settings", title: isAr ? "إعدادات الحساب" : "Account Settings", subtitle: isAr ? "الملف الشخصي والأمان" : "Profile and security", stat: isAr ? "إدارة الحساب" : "Manage account", icon: ShieldCheck, tone: "green", onClick: previewAction },
  ];
  return (
    <main className="section-container py-6" dir={isAr ? "rtl" : "ltr"}>
      <p className="mb-4 text-xs text-[#9CA3AF]">{isAr ? "معاينة التصميم · حساب وأرقام توضيحية" : "Design preview · sample account and figures"}</p>
      <AccountWelcome
        role="approved_seller"
        locale={locale}
        name="Maya Chen"
        description={isAr ? "عروضك وصفقاتك وتنبيهاتك جاهزة." : "Your listings, trades, and alerts are ready."}
        greeting={isAr ? "صباح الخير" : "Good morning"}
        actions={<div className="account-welcome__actions"><Button onClick={previewAction}>{isAr ? "إنشاء عرض" : "Create Listing"}</Button><Button variant="secondary" onClick={previewAction}>{isAr ? "الصفقات النشطة" : "Active Trades"}</Button></div>}
        workspace={<ExchangeWorkspaceNavigation cards={cards} isAr={isAr} integrated />}
      >
        <SellerRankCard locale={locale} summary={{ sellerLevel: "silver", nextLevel: "gold", lifetimeCompletedVolumeUsdt: 38_000, amountToNextLevelUsdt: 12_000, progressToNextLevelPercent: 65.71 }} />
      </AccountWelcome>
      <div id="sample-requests" className="mt-6 scroll-mt-24 rounded-2xl border border-white/10 bg-black/30 p-6 text-center">
        <p className="font-semibold">{isAr ? "لا توجد صفقات نشطة حالياً." : "There are no active trades currently."}</p>
        <p className="mt-2 text-sm text-[#9CA3AF]">{isAr ? "هذه معاينة ببيانات توضيحية. في الحساب الحقيقي، يفتح كل زر الإجراء الخاص به." : "This preview uses sample data. In your account, each button opens its own action."}</p>
      </div>
    </main>
  );
}
