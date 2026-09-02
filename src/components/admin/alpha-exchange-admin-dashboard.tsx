"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, BarChart3, CheckCircle2, Coins, FileClock, FileSearch, ListChecks, Megaphone, MessageSquareText, Search, Settings, ShieldCheck, Star, Store, TrendingUp, Trophy, Users, Users2, WalletCards, X, Zap } from "lucide-react";
import { AdminAnnouncementsPanel } from "@/components/admin/admin-announcements-panel";
import { MarketplaceEnforcementOwnerPanel } from "@/components/sections/seller/marketplace-enforcement-owner-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createExchangeDisplayLookup, replaceExchangeEntityIds } from "@/lib/alpha-exchange-display";
import { parseAdminDashboardDestination, type AdminDashboardSection } from "@/lib/action-destinations";
import { formatCommissionId, formatListingId, formatRequestId, formatTradeId } from "@/lib/format-id";
import { RoleBadge } from "@/components/ui/role-badge";
import { SELLER_LEVELS, normalizeSellerLevel, type AlphaExchangeActivityLogEntry, type AlphaExchangeNotification, type AuditLogEntry, type BetaAnnouncement, type BetaAnnouncementType, type BetaFeedbackCategory, type CommissionRecord, type MarketplaceEnforcementRecord, type MarketplaceListing, type OwnerBusinessDashboardMetrics, type OwnerPrivateBetaDashboardData, type PurchaseRequest, type SellerApplication, type SellerAvailabilityStatus, type SellerLevel, type SellerReviewRecord, type SmsDeliveryRecord, type SupportedNetwork } from "@/types/alpha-exchange";
import type { PremiumSellerProfileData } from "@/types/alpha-exchange";
import { formatNotificationRelativeTime } from "@/lib/notification-time";
import { sortNotificationsNewestFirst } from "@/lib/notification-sort";
import { localizeNotificationCopy } from "@/lib/notification-localization";
import {
  marketplacePaymentMethodLabelForLocale,
  trustFlagReasonLabelForLocale,
} from "@/lib/marketplace-display-localization";

const RANK_BADGE_COLOR: Record<SellerLevel, string> = {
  bronze: "border-[#CD7F32]/30 bg-[#CD7F32]/10 text-[#E8A96A]",
  silver: "border-[#C0C0C0]/30 bg-[#C0C0C0]/10 text-[#C9CED9]",
  gold: "border-[#C9A227]/30 bg-[#C9A227]/10 text-[#FDE68A]",
  diamond: "border-[#7CC9FF]/30 bg-[#7CC9FF]/10 text-[#7CC9FF]",
  elite: "border-[#F8E7A0]/30 bg-[#F8E7A0]/10 text-[#F8E7A0]",
};

type AdminSummary = {
  usersCount: number;
  approvedSellersCount: number;
  pendingApplicationsCount: number;
  rejectedApplicationsCount: number;
  suspendedSellersCount: number;
  listingsCount: number;
  pendingRequestsCount: number;
  completedRequestsCount: number;
  totalCommissionAmount: number;
};

type AdminSeller = {
  id: string;
  fullName: string;
  email: string;
  whatsappNumber: string;
  role: "guest" | "student" | "buyer" | "pending_seller_approval" | "approved_seller" | "admin" | "owner";
  roles?: Array<"guest" | "student" | "buyer" | "pending_seller_approval" | "approved_seller" | "admin" | "owner">;
  sellerStatus: "buyer" | "pending_seller_approval" | "approved_seller" | "rejected" | "suspended";
  availabilityStatus?: SellerAvailabilityStatus;
  lifetimeCompletedVolumeUsdt?: number;
  sellerPrestigeRank?: SellerLevel;
  sellerRankOverride?: { rank: SellerLevel; reason: string; setAt: string; setByUserId: string };
  sellerPromotionHistory?: Array<{ id: string; rank: SellerLevel; promotedAt: string; reason?: string }>;
  createdAt: string;
  updatedAt: string;
};

type AdminEnforcementAuditEntry = {
  id: string;
  sellerId: string;
  actorUserId: string;
  action: string;
  createdAt: string;
  reason?: string;
  notes?: string;
};
type AdminPayload = {
  summary: AdminSummary;
  applications: SellerApplication[];
  approvedSellers: AdminSeller[];
  listings: MarketplaceListing[];
  purchaseRequests: PurchaseRequest[];
  commissionRecords: CommissionRecord[];
  auditLogs: AuditLogEntry[];
  notifications: AlphaExchangeNotification[];
  activityLog: AlphaExchangeActivityLogEntry[];
  ownerBusiness: OwnerBusinessDashboardMetrics;
  trustEngine: {
    highestTrustSellers: Array<{ sellerId: string; sellerName: string; trustScore: number; level: string; summary: string }>;
    lowestTrustSellers: Array<{ sellerId: string; sellerName: string; trustScore: number; level: string; summary: string }>;
    fastestGrowingSellers: Array<{ sellerId: string; sellerName: string; trustDelta: number; trustScore: number }>;
    recentlyImprovedSellers: Array<{ sellerId: string; sellerName: string; oldScore: number; newScore: number; reason: string; createdAt: string }>;
    accountsLosingTrust: Array<{ sellerId: string; sellerName: string; trustDelta: number; trustScore: number }>;
    flaggedSellers: Array<{ sellerId: string; sellerName: string; trustScore: number; level: string; reason: string }>;
    marketplaceHealth: {
      averageTrustScore: number;
      sellerCount: number;
      healthySellerCount: number;
      atRiskSellerCount: number;
    };
  };
  privateBeta: OwnerPrivateBetaDashboardData;
  users: Array<{ id: string; fullName: string; email: string; role: string; roles?: string[]; disabled?: boolean; createdAt: string }>;
  sellerReviews: SellerReviewRecord[];
  listingReliability: ListingReliabilityReport[];
  smsDeliveries: AdminSmsDelivery[];
  enforcement: {
    metrics: {
      activeCases: number;
      resolvedCases: number;
      revokedCases: number;
      totalCases: number;
      outstandingFeeAmountUsdt: number;
    };
    activeCases: Array<MarketplaceEnforcementRecord & { sellerName: string; sellerEmail: string }>;
    recentActivity: Array<AdminEnforcementAuditEntry & { sellerName: string; actorName: string }>;
  };
  complianceSettings?: {
    recoveryWallet: {
      network: SupportedNetwork;
      walletAddress: string;
      defaultPaymentRail: "manual_wallet_transfer" | "alpha_wallet_one_click";
      updatedAt: string;
      updatedByUserId: string;
    } | null;
  };
};

type ListingReliabilityReport = {
  sellerId: string;
  sellerName: string;
  reliability: {
    cancellationRate: number;
    editRate: number;
    removalRate: number;
    averageListingLifetimeHours: number;
    reliabilityScore: number;
    warningTier: "none" | "notice" | "warning" | "critical";
    warningLabel: string;
    confidence: number;
  };
  completedTrades: number;
  cancelledTrades: number;
  totalListings: number;
  editCount: number;
  removalCount: number;
  recentHistory: AuditLogEntry[];
};

type AdminSmsDelivery = Omit<SmsDeliveryRecord, "recipientPhone" | "body"> & {
  recipientPhoneMasked: string;
};

type SystemHealthSnapshot = {
  status: "healthy" | "degraded";
  checkedAt: string;
  durationMs: number;
  release: string;
  environment: string;
  checks: Array<{
    key: "application" | "database" | "authentication" | "trade_room" | "notifications" | "email";
    label: string;
    status: "healthy" | "degraded";
    detail: string;
    latencyMs?: number;
  }>;
};

type SectionKey = AdminDashboardSection;

const pageSize = 8;

const sectionItems: Array<{ key: SectionKey; label: string; labelAr: string; icon: typeof BarChart3 }> = [
  { key: "overview", label: "Overview", labelAr: "نظرة عامة", icon: BarChart3 },
  { key: "seller-applications", label: "Seller Applications", labelAr: "طلبات البائعين", icon: FileSearch },
  { key: "approved-sellers", label: "Approved Sellers", labelAr: "البائعون المعتمدون", icon: Users },
  { key: "seller-rank", label: "Seller Rank Management", labelAr: "إدارة رتب البائعين", icon: Trophy },
  { key: "marketplace-listings", label: "Marketplace Listings", labelAr: "عروض السوق", icon: Store },
  { key: "listing-reliability", label: "Listing Reliability", labelAr: "موثوقية العروض", icon: ShieldCheck },
  { key: "purchase-requests", label: "Purchase Requests", labelAr: "طلبات الشراء والصفقات", icon: ListChecks },
  { key: "commissions", label: "Commissions", labelAr: "العمولات", icon: Coins },
  { key: "audit-logs", label: "Audit Logs", labelAr: "سجل النشاط", icon: FileClock },
  { key: "sms-deliveries", label: "SMS Deliveries", labelAr: "رسائل SMS", icon: MessageSquareText },
  { key: "marketplace-enforcement", label: "Marketplace Compliance", labelAr: "امتثال السوق", icon: ShieldCheck },
  { key: "announcements", label: "Marketing · Announcements", labelAr: "التسويق والإعلانات", icon: Megaphone },
  { key: "private-beta", label: "Access Control", labelAr: "التحكم بالوصول", icon: ShieldCheck },
  { key: "analytics", label: "Analytics", labelAr: "التحليلات", icon: TrendingUp },
  { key: "users", label: "User Management", labelAr: "إدارة المستخدمين", icon: Users2 },
  { key: "reviews", label: "Reviews", labelAr: "التقييمات", icon: Star },
  { key: "system-health", label: "Website Health", labelAr: "حالة الموقع", icon: ShieldCheck },
  { key: "emergency", label: "Emergency", labelAr: "الطوارئ", icon: Zap },
  { key: "settings", label: "Settings", labelAr: "الإعدادات", icon: Settings },
];

const sectionGroups: Array<{ title: string; titleAr: string; keys: SectionKey[] }> = [
  { title: "Marketplace", titleAr: "السوق", keys: ["overview", "marketplace-listings", "purchase-requests", "commissions", "listing-reliability"] },
  { title: "Sellers", titleAr: "البائعون", keys: ["seller-applications", "approved-sellers", "seller-rank", "users", "reviews"] },
  { title: "Compliance", titleAr: "الامتثال", keys: ["marketplace-enforcement", "audit-logs"] },
  { title: "Analytics", titleAr: "التحليلات", keys: ["analytics", "private-beta"] },
  { title: "Notifications", titleAr: "الإشعارات", keys: ["sms-deliveries"] },
  { title: "Discord", titleAr: "Discord", keys: ["announcements"] },
  { title: "Wallet", titleAr: "المحفظة", keys: ["settings"] },
  { title: "Platform", titleAr: "المنصة", keys: ["system-health", "emergency"] },
];

function formatDateForLocale(value: string, locale: "ar" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-IL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toNumber(value: string | number | null | undefined) {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function formatCurrency(value: number) {
  return `₪${value.toLocaleString("en-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsdt(value: number) {
  return `${value.toLocaleString("en-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}

function formatPercent(value: number) {
  return `${value.toLocaleString("en-IL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function displayTradeId(request: Pick<PurchaseRequest, "displayNumber" | "tradeId" | "id"> | null | undefined, fallbackId?: string | null) {
  return formatTradeId(request?.displayNumber, request?.tradeId ?? request?.id ?? fallbackId);
}

function displayListingId(listing: Pick<MarketplaceListing, "displayNumber" | "id"> | null | undefined, fallbackId?: string | null) {
  return formatListingId(listing?.displayNumber, listing?.id ?? fallbackId);
}

function displayRequestId(request: Pick<PurchaseRequest, "displayNumber" | "id"> | null | undefined, fallbackId?: string | null) {
  return formatRequestId(request?.displayNumber, request?.id ?? fallbackId);
}

function displayCommissionId(record: Pick<CommissionRecord, "displayNumber" | "id"> | null | undefined, fallbackId?: string | null) {
  return formatCommissionId(record?.displayNumber, record?.id ?? fallbackId);
}

function sellerLevelLabelForLocale(level: SellerLevel | undefined, locale: "ar" | "en") {
  if (locale === "ar") {
    if (level === "elite") return "نخبة";
    if (level === "diamond") return "ماسي";
    if (level === "gold") return "ذهبي";
    if (level === "silver") return "فضي";
    return "برونزي";
  }
  if (level === "elite") return "Elite";
  if (level === "diamond") return "Diamond";
  if (level === "gold") return "Gold";
  if (level === "silver") return "Silver";
  return "Bronze";
}

function feedbackCategoryLabelForLocale(value: BetaFeedbackCategory, locale: "ar" | "en") {
  if (locale === "ar") {
    if (value === "bug") return "خلل";
    if (value === "suggestion") return "اقتراح";
    if (value === "confusing_ux") return "واجهة غير واضحة";
    if (value === "feature_request") return "طلب ميزة";
    if (value === "performance") return "الأداء";
    return "أخرى";
  }
  if (value === "bug") return "Bug";
  if (value === "suggestion") return "Suggestion";
  if (value === "confusing_ux") return "Confusing UX";
  if (value === "feature_request") return "Feature Request";
  if (value === "performance") return "Performance";
  return "Other";
}

function safeAdminError(scope: "load" | "action", locale: "ar" | "en") {
  if (locale === "ar") {
    return scope === "load"
      ? "تعذّر تحميل بيانات لوحة الإدارة الآن. حدّث الصفحة وحاول مجددًا."
      : "تعذّر إكمال هذا الإجراء الآن. حاول مجددًا.";
  }
  if (scope === "load") {
    return "We could not load dashboard data right now. Please refresh and try again.";
  }
  return "We could not complete that action right now. Please try again.";
}

function paginate<T>(items: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: items.slice(start, start + pageSize),
    totalPages,
    safePage,
  };
}

export function AlphaExchangeAdminDashboard({ locale = "en" }: { locale?: "ar" | "en" }) {
  const searchParams = useSearchParams();
  const isArabic = locale === "ar";
  const t = useCallback((english: string, arabic: string) => isArabic ? arabic : english, [isArabic]);
  const statusLabel = useCallback((value: string | null | undefined) => {
    const status = value ?? "";
    const english: Record<string, string> = {
      pending: "Pending", approved: "Approved", rejected: "Rejected", suspended: "Suspended",
      draft: "Draft", active: "Active", paused: "Paused", matched: "Matched", in_trade: "In Trade",
      expired: "Expired", completed: "Completed", cancelled: "Cancelled", closed: "Closed",
      accepted: "Accepted", payment_sent: "Payment Sent", usdt_sent: "USDT Sent", declined: "Declined",
      funds_received: "Funds Received", changes_requested: "Changes Requested", pending_verification: "Pending Verification",
      locked: "Locked", review_open: "Review Open", paid: "Paid", overdue: "Overdue",
      verified: "Verified", failed: "Failed", queued: "Queued", sent: "Sent", delivered: "Delivered",
      available: "Available", away: "Away", online: "Online", vacation: "Vacation", offline: "Offline",
      buyer: "Buyer", pending_seller_approval: "Pending Seller Approval", approved_seller: "Approved Seller",
      new: "New", in_review: "In Review", resolved: "Resolved", disabled: "Disabled", hidden: "Hidden", visible: "Visible",
    };
    const arabic: Record<string, string> = {
      pending: "قيد الانتظار", approved: "مقبول", rejected: "مرفوض", suspended: "موقوف",
      draft: "مسودة بانتظار الموافقة", active: "نشط", paused: "متوقف مؤقتًا", matched: "تمت المطابقة", in_trade: "قيد الصفقة",
      expired: "منتهي", completed: "مكتمل", cancelled: "ملغي", closed: "مغلق",
      accepted: "مقبول", payment_sent: "تم إرسال الدفع", usdt_sent: "تم إرسال USDT", declined: "مرفوض",
      funds_received: "تم استلام الأموال", changes_requested: "مطلوب تعديلات", pending_verification: "بانتظار التحقق",
      locked: "مقفول", review_open: "التقييم متاح", paid: "مدفوع", overdue: "متأخر",
      verified: "مؤكد", failed: "فشل", queued: "في قائمة الانتظار", sent: "تم الإرسال", delivered: "تم التسليم",
      available: "متاح", away: "بعيد مؤقتًا", online: "متصل", vacation: "إجازة", offline: "غير متصل",
      buyer: "مشتري", pending_seller_approval: "بائع بانتظار الموافقة", approved_seller: "بائع معتمد",
      new: "جديد", in_review: "قيد المراجعة", resolved: "محلول", disabled: "معطّل", hidden: "مخفي", visible: "ظاهر",
    };
    return (isArabic ? arabic[status] : english[status]) ?? (isArabic ? "حالة مسجّلة" : status.replaceAll("_", " "));
  }, [isArabic]);
  const actionLabel = useCallback((value: string) => {
    const english: Record<string, string> = {
      seller_approved: "Seller Approved", seller_rejected: "Seller Rejected", seller_suspended: "Seller Suspended", seller_reactivated: "Seller Reactivated",
      seller_hidden: "Seller Hidden", seller_unhidden: "Seller Restored",
      listing_created: "Listing Created", listing_expired: "Listing Expired", listing_renewed: "Listing Renewed", listing_expiration_extended: "Listing Expiration Extended",
      listing_edited: "Listing Edited", listing_paused: "Listing Paused", listing_resumed: "Listing Resumed", listing_cancelled: "Listing Cancelled",
      listing_closed: "Listing Closed", admin_override: "Admin Override", listing_removed: "Listing Removed",
      purchase_request_submitted: "Purchase Request Submitted", purchase_completed: "Purchase Completed", trade_timed_out: "Trade Timed Out",
      seller_vacation_enabled: "Seller Vacation Enabled", seller_vacation_disabled: "Seller Vacation Disabled", commission_recorded: "Commission Recorded",
      commission_overdue: "Commission Overdue", commission_paid: "Commission Paid",
      trade_review_submitted: "Trade Review Submitted", trade_review_responded: "Trade Review Responded", trust_score_updated: "Trust Score Updated",
      seller_prestige_promoted: "Seller Rank Promoted", seller_prestige_overridden: "Seller Rank Overridden",
      fee_issued: "Compliance Fee Issued", marketplace_enforcement_fee_issued: "Compliance Fee Issued", payment_submitted: "Payment Submitted",
      appeal_submitted: "Appeal Submitted", appeal_decided: "Appeal Decided", fee_paid: "Compliance Fee Paid", marketplace_enforcement_fee_paid: "Compliance Fee Paid",
      restriction_removed: "Restriction Removed", marketplace_enforcement_restriction_removed: "Restriction Removed", seller_revoked: "Seller Access Revoked",
      marketplace_enforcement_seller_revoked: "Seller Access Revoked", listing_reopened: "Listing Reopened", listing_matched: "Listing Matched",
      listing_completed: "Listing Completed", trade_closed_manually: "Trade Closed Manually", trade_bank_details_revealed: "Bank Details Revealed",
      trade_evidence_downloaded: "Trade Evidence Downloaded", seller_bank_account_added: "Bank Account Added", seller_bank_account_updated: "Bank Account Updated",
      seller_bank_account_deleted: "Bank Account Deleted", seller_featured: "Seller Featured", beta_invite_created: "Beta Invite Created",
      beta_invite_expired: "Beta Invite Expired", beta_invite_disabled: "Beta Invite Disabled", beta_feedback_status_updated: "Feedback Status Updated",
      beta_announcement_created: "Announcement Published", beta_announcement_updated: "Announcement Updated",
      admin_announcement_started: "Announcement Delivery Started", admin_announcement_completed: "Announcement Delivery Completed",
      trade_evidence_uploaded: "Trade Evidence Uploaded", trade_evidence_replaced: "Trade Evidence Replaced",
      trade_evidence_viewed_by_owner: "Trade Evidence Viewed by Owner", trade_evidence_viewed_by_moderator: "Trade Evidence Viewed by Moderator",
      trade_inactivity_warning_sent: "Trade Inactivity Warning Sent",
    };
    const arabic: Record<string, string> = {
      seller_approved: "تم اعتماد البائع", seller_rejected: "تم رفض البائع", seller_suspended: "تم إيقاف البائع", seller_reactivated: "تمت إعادة تفعيل البائع",
      seller_hidden: "تم إخفاء البائع", seller_unhidden: "تمت استعادة ظهور البائع",
      listing_created: "تم إنشاء العرض", listing_expired: "انتهت صلاحية العرض", listing_renewed: "تم تجديد العرض", listing_expiration_extended: "تم تمديد صلاحية العرض",
      listing_edited: "تم تعديل العرض", listing_paused: "تم إيقاف العرض مؤقتًا", listing_resumed: "تمت إعادة تفعيل العرض", listing_cancelled: "تم إلغاء العرض",
      listing_closed: "تم إغلاق العرض", admin_override: "إجراء يدوي من الإدارة", listing_removed: "تم حذف العرض",
      purchase_request_submitted: "تم إرسال طلب شراء", purchase_completed: "اكتملت الصفقة", trade_timed_out: "انتهت مهلة الصفقة",
      seller_vacation_enabled: "تم تفعيل إجازة البائع", seller_vacation_disabled: "تم إنهاء إجازة البائع", commission_recorded: "تم تسجيل العمولة",
      commission_overdue: "العمولة متأخرة", commission_paid: "تم دفع العمولة",
      trade_review_submitted: "تم إرسال تقييم الصفقة", trade_review_responded: "تم الرد على تقييم الصفقة", trust_score_updated: "تم تحديث درجة الثقة",
      seller_prestige_promoted: "تمت ترقية رتبة البائع", seller_prestige_overridden: "تم تعديل رتبة البائع يدويًا",
      fee_issued: "تم إصدار رسوم امتثال", marketplace_enforcement_fee_issued: "تم إصدار رسوم امتثال", payment_submitted: "تم إرسال الدفعة",
      appeal_submitted: "تم إرسال الاستئناف", appeal_decided: "صدر قرار الاستئناف", fee_paid: "تم دفع رسوم الامتثال", marketplace_enforcement_fee_paid: "تم دفع رسوم الامتثال",
      restriction_removed: "تمت إزالة التقييد", marketplace_enforcement_restriction_removed: "تمت إزالة التقييد", seller_revoked: "تم إلغاء صلاحية البائع",
      marketplace_enforcement_seller_revoked: "تم إلغاء صلاحية البائع", listing_reopened: "تمت إعادة فتح العرض", listing_matched: "تمت مطابقة العرض",
      listing_completed: "اكتمل العرض", trade_closed_manually: "تم إغلاق الصفقة يدويًا", trade_bank_details_revealed: "تم إظهار تفاصيل الحساب البنكي",
      trade_evidence_downloaded: "تم تنزيل إثبات الصفقة", seller_bank_account_added: "تمت إضافة الحساب البنكي", seller_bank_account_updated: "تم تحديث الحساب البنكي",
      seller_bank_account_deleted: "تم حذف الحساب البنكي", seller_featured: "تم تمييز البائع", beta_invite_created: "تم إنشاء دعوة تجريبية",
      beta_invite_expired: "انتهت الدعوة التجريبية", beta_invite_disabled: "تم تعطيل الدعوة التجريبية", beta_feedback_status_updated: "تم تحديث حالة الملاحظة",
      beta_announcement_created: "تم نشر الإعلان", beta_announcement_updated: "تم تحديث الإعلان",
      admin_announcement_started: "بدأ إرسال الإعلان", admin_announcement_completed: "اكتمل إرسال الإعلان",
      trade_evidence_uploaded: "تم رفع إثبات الصفقة", trade_evidence_replaced: "تم استبدال إثبات الصفقة",
      trade_evidence_viewed_by_owner: "اطّلع المالك على إثبات الصفقة", trade_evidence_viewed_by_moderator: "اطّلع المشرف على إثبات الصفقة",
      trade_inactivity_warning_sent: "تم إرسال تحذير عدم نشاط الصفقة",
    };
    return (isArabic ? arabic[value] : english[value]) ?? (isArabic ? "إجراء مسجّل" : value.replaceAll("_", " "));
  }, [isArabic]);
  const roleLabel = useCallback((value: string) => {
    const english: Record<string, string> = {
      owner: "Owner", admin: "Admin", approved_seller: "Approved Seller", pending_seller_approval: "Pending Seller",
      buyer: "Buyer", student: "Student", guest: "Guest",
    };
    const arabic: Record<string, string> = {
      owner: "المالك", admin: "مدير", approved_seller: "بائع معتمد", pending_seller_approval: "بائع قيد الموافقة",
      buyer: "مشتري", student: "طالب", guest: "زائر",
    };
    return (isArabic ? arabic[value] : english[value]) ?? (isArabic ? "مستخدم" : value.replaceAll("_", " "));
  }, [isArabic]);
  const notificationCategoryLabel = useCallback((value: AlphaExchangeNotification["category"]) => {
    const arabic: Record<AlphaExchangeNotification["category"], string> = {
      account: "الحساب", listing: "العروض", trade: "الصفقات", trust: "الثقة", application: "الطلبات",
      dispute: "النزاعات", report: "البلاغات", review: "التقييمات", system: "النظام",
    };
    return isArabic ? arabic[value] : value.charAt(0).toUpperCase() + value.slice(1);
  }, [isArabic]);
  const smsEventLabel = useCallback((value: SmsDeliveryRecord["eventType"]) => {
    const english: Record<SmsDeliveryRecord["eventType"], string> = {
      seller_application_submitted: "Seller Application Submitted", trade_requires_admin_review: "Trade Needs Admin Review",
      purchase_request_created: "Purchase Request Created", trade_accepted: "Trade Accepted", payment_sent: "Payment Sent",
      funds_received: "Funds Received", usdt_sent: "USDT Sent", trade_completed: "Trade Completed",
    };
    const arabic: Record<SmsDeliveryRecord["eventType"], string> = {
      seller_application_submitted: "تم إرسال طلب البائع", trade_requires_admin_review: "الصفقة تحتاج مراجعة الإدارة",
      purchase_request_created: "تم إنشاء طلب شراء", trade_accepted: "تم قبول الصفقة", payment_sent: "تم إرسال الدفعة",
      funds_received: "تم استلام الأموال", usdt_sent: "تم إرسال USDT", trade_completed: "اكتملت الصفقة",
    };
    return isArabic ? arabic[value] : english[value];
  }, [isArabic]);
  const liveActivityTypeLabel = useCallback((value: OwnerBusinessDashboardMetrics["liveActivity"][number]["type"]) => {
    const english: Record<typeof value, string> = {
      new_seller_joined: "New Seller Joined", trade_completed: "Trade Completed", listing_approved: "Listing Approved",
      review_submitted: "Review Submitted", trust_score_updated: "Trust Score Updated", dispute_opened: "Dispute Opened",
    };
    const arabic: Record<typeof value, string> = {
      new_seller_joined: "انضم بائع جديد", trade_completed: "اكتملت صفقة", listing_approved: "تم اعتماد عرض",
      review_submitted: "تم إرسال تقييم", trust_score_updated: "تم تحديث درجة الثقة", dispute_opened: "تم فتح نزاع",
    };
    return isArabic ? arabic[value] : english[value];
  }, [isArabic]);
  const liveActivityMessage = useCallback((entry: OwnerBusinessDashboardMetrics["liveActivity"][number]) => {
    if (!isArabic) return entry.message;
    if (/^.+ joined as an approved seller\.$/.test(entry.message)) {
      return `${entry.message.replace(/ joined as an approved seller\.$/, "")} انضم كبائع معتمد.`;
    }
    const tradeCompleted = entry.message.match(/^Trade (.+) completed\.$/);
    if (tradeCompleted) return `اكتملت الصفقة ${tradeCompleted[1]}.`;
    const listingApproved = entry.message.match(/^Listing (\S+) approved for (.+)\.$/);
    if (listingApproved) return `تم اعتماد العرض ${listingApproved[1]} للبائع ${listingApproved[2]}.`;
    const reviewSubmitted = entry.message.match(/^Review submitted for trade (.+)\.$/);
    if (reviewSubmitted) return `تم إرسال تقييم للصفقة ${reviewSubmitted[1]}.`;
    const trustUpdated = entry.message.match(/^(.+) trust score updated ([\d.]+) -> ([\d.]+)\.$/);
    if (trustUpdated) return `تحدّثت درجة ثقة ${trustUpdated[1]} من ${trustUpdated[2]} إلى ${trustUpdated[3]}.`;
    const disputeOpened = entry.message.match(/^Dispute opened for trade (.+)\.$/);
    if (disputeOpened) return `تم فتح نزاع للصفقة ${disputeOpened[1]}.`;
    return liveActivityTypeLabel(entry.type);
  }, [isArabic, liveActivityTypeLabel]);
  const timelineEventLabel = useCallback((event: PurchaseRequest["timeline"][number]) => {
    if (!isArabic) return event.message;
    const labels: Record<PurchaseRequest["timeline"][number]["type"], string> = {
      request_submitted: "تم إرسال طلب الشراء", request_accepted: "وافق البائع على الطلب", payment_sent: "أكد المشتري إرسال الدفعة",
      seller_confirmed_funds: "أكد البائع استلام الدفعة", usdt_release_started: "بدأ البائع إرسال USDT", usdt_sent: "أكد البائع إرسال USDT",
      trade_completed: "اكتملت الصفقة بنجاح", trade_timed_out: "انتهت مهلة الصفقة", trade_locked: "تم إغلاق الصفقة",
      review_unlocked: "أصبح التقييم متاحًا", dispute_opened: "تم فتح نزاع للصفقة", commission_recorded: "تم تسجيل عمولة الصفقة",
      commission_paid: "تم دفع عمولة الصفقة", buyer_evidence_uploaded: "رفع المشتري إثبات الدفع", seller_evidence_uploaded: "رفع البائع إثبات إرسال USDT",
      request_declined: "رفض البائع الطلب", request_cancelled: "تم إلغاء الطلب", buyer_confirmed_receipt: "أكد المشتري استلام USDT",
      buyer_confirmation_overdue: "تأخر تأكيد المشتري", trade_closed_manually: "تم إغلاق الصفقة يدويًا",
      trade_inactivity_warning_sent: "تم إرسال تحذير بسبب عدم النشاط", bank_details_revealed: "أصبحت تفاصيل الحساب البنكي متاحة داخل غرفة الصفقة",
    };
    return labels[event.type];
  }, [isArabic]);
  const formatDate = useCallback((value: string) => formatDateForLocale(value, locale), [locale]);
  const sellerLevelLabel = useCallback((level?: SellerLevel) => sellerLevelLabelForLocale(level, locale), [locale]);
  const feedbackCategoryLabel = useCallback((value: BetaFeedbackCategory) => feedbackCategoryLabelForLocale(value, locale), [locale]);
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [data, setData] = useState<AdminPayload | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealthSnapshot | null>(null);
  const [systemHealthLoading, setSystemHealthLoading] = useState(false);
  const [systemHealthError, setSystemHealthError] = useState<string | null>(null);

  const [applicationsQuery, setApplicationsQuery] = useState("");
  const [applicationsStatus, setApplicationsStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [applicationsSort, setApplicationsSort] = useState<"newest" | "oldest" | "name">("newest");
  const [applicationsPage, setApplicationsPage] = useState(1);

  const [sellersQuery, setSellersQuery] = useState("");
  const [sellersStatus, setSellersStatus] = useState<"all" | "approved_seller" | "suspended">("all");
  const [sellersSort, setSellersSort] = useState<"newest" | "oldest" | "name">("newest");
  const [sellersPage, setSellersPage] = useState(1);
  const [selectedSeller, setSelectedSeller] = useState<AdminSeller | null>(null);
  const [selectedSellerProfile, setSelectedSellerProfile] = useState<PremiumSellerProfileData | null>(null);
  const [selectedSellerProfileLoading, setSelectedSellerProfileLoading] = useState(false);

  const [listingsQuery, setListingsQuery] = useState("");
  const [listingsStatus, setListingsStatus] = useState<"all" | MarketplaceListing["status"]>("all");
  const [listingsNetwork, setListingsNetwork] = useState<"all" | SupportedNetwork>("all");
  const [listingsSort, setListingsSort] = useState<"newest" | "price-asc" | "price-desc" | "amount-desc">("newest");
  const [listingsPage, setListingsPage] = useState(1);

  const [requestsQuery, setRequestsQuery] = useState("");
  const [requestsStatus, setRequestsStatus] = useState<"all" | PurchaseRequest["status"]>("all");
  const [requestsSort, setRequestsSort] = useState<"newest" | "oldest">("newest");
  const [requestsPage, setRequestsPage] = useState(1);
  const [selectedRequest, setSelectedRequest] = useState<PurchaseRequest | null>(null);

  const [commissionsQuery, setCommissionsQuery] = useState("");
  const [commissionsSort, setCommissionsSort] = useState<"newest" | "oldest" | "highest">("newest");
  const [commissionsPage, setCommissionsPage] = useState(1);

  const [auditQuery, setAuditQuery] = useState("");
  const [auditAction, setAuditAction] = useState<"all" | AuditLogEntry["action"]>("all");
  const [auditSort, setAuditSort] = useState<"newest" | "oldest">("newest");
  const [auditPage, setAuditPage] = useState(1);
  const [notificationQuery, setNotificationQuery] = useState("");
  const [notificationPage, setNotificationPage] = useState(1);
  const [smsDeliveriesPage, setSmsDeliveriesPage] = useState(1);
  const [enforcementPage, setEnforcementPage] = useState(1);
  const [inviteMaxUses, setInviteMaxUses] = useState("10");
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [betaFeedbackStatusFilter, setBetaFeedbackStatusFilter] = useState<"all" | "new" | "in_review" | "resolved">("all");
  const [announcementType, setAnnouncementType] = useState<BetaAnnouncementType>("maintenance");
  const [announcementTitleEn, setAnnouncementTitleEn] = useState("");
  const [announcementMessageEn, setAnnouncementMessageEn] = useState("");
  const [announcementTitleAr, setAnnouncementTitleAr] = useState("");
  const [announcementMessageAr, setAnnouncementMessageAr] = useState("");
  const toastTimeoutRef = useRef<number | null>(null);
  const lastFocusedDeepLinkRef = useRef<string | null>(null);
  const [deepLinkTargetElement, setDeepLinkTargetElement] = useState<HTMLTableRowElement | null>(null);
  const setSellerApplicationRow = useCallback((element: HTMLTableRowElement | null) => setDeepLinkTargetElement(element), []);
  const setMarketplaceListingRow = useCallback((element: HTMLTableRowElement | null) => setDeepLinkTargetElement(element), []);
  const setPurchaseRequestRow = useCallback((element: HTMLTableRowElement | null) => setDeepLinkTargetElement(element), []);
  const setCommissionRow = useCallback((element: HTMLTableRowElement | null) => setDeepLinkTargetElement(element), []);
  const searchParamsKey = searchParams.toString();
  const adminDestination = useMemo(
    () => parseAdminDashboardDestination(new URLSearchParams(searchParamsKey)),
    [searchParamsKey],
  );

  useEffect(() => {
    let cancelled = false;
    if (!selectedSeller) {
      setSelectedSellerProfile(null);
      setSelectedSellerProfileLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setSelectedSellerProfile(null);
    setSelectedSellerProfileLoading(true);

    void (async () => {
      try {
        const response = await fetch(`/api/alpha-exchange/sellers/${selectedSeller.id}/profile`, { cache: "no-store" });
        const payload = await response.json() as { profile?: PremiumSellerProfileData; error?: string };
        if (!response.ok || !payload.profile) {
          if (!cancelled) setSelectedSellerProfile(null);
          return;
        }
        if (!cancelled) setSelectedSellerProfile(payload.profile);
      } catch {
        if (!cancelled) setSelectedSellerProfile(null);
      } finally {
        if (!cancelled) setSelectedSellerProfileLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSeller]);

  const [usersQuery, setUsersQuery] = useState("");
  const [usersPage, setUsersPage] = useState(1);
  const [usersRoleFilter, setUsersRoleFilter] = useState<"all" | string>("all");
  const [reviewsQuery, setReviewsQuery] = useState("");
  const [reviewsPage, setReviewsPage] = useState(1);
  const [broadcastTitleEn, setBroadcastTitleEn] = useState("");
  const [broadcastBodyEn, setBroadcastBodyEn] = useState("");
  const [broadcastTitleAr, setBroadcastTitleAr] = useState("");
  const [broadcastBodyAr, setBroadcastBodyAr] = useState("");
  const [broadcastType, setBroadcastType] = useState<"info" | "warning" | "success">("info");

  const [rankMgmtSearch, setRankMgmtSearch] = useState("");
  const [rankMgmtFilter, setRankMgmtFilter] = useState<"all" | SellerLevel>("all");
  const [rankMgmtSelected, setRankMgmtSelected] = useState<Set<string>>(new Set());
  const [rankMgmtSaving, setRankMgmtSaving] = useState<Set<string>>(new Set());
  const [rankMgmtBulkRank, setRankMgmtBulkRank] = useState<SellerLevel>("bronze");
  const [rankConfirmPending, setRankConfirmPending] = useState<{ sellerId: string; sellerName: string; fromRank: SellerLevel; toRank: SellerLevel } | null>(null);
  const [rankConfirmReason, setRankConfirmReason] = useState("");
  const [complianceWalletNetwork, setComplianceWalletNetwork] = useState<SupportedNetwork>("TRC20");
  const [complianceWalletAddress, setComplianceWalletAddress] = useState("");

  useEffect(() => {
    if (!selectedSeller && !selectedRequest && !rankConfirmPending) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (rankConfirmPending) {
        setRankConfirmPending(null);
        setRankConfirmReason("");
      } else if (selectedRequest) {
        setSelectedRequest(null);
      } else {
        setSelectedSeller(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [rankConfirmPending, selectedRequest, selectedSeller]);

  const sectionItemsByKey = useMemo(() => new Map(sectionItems.map((item) => [item.key, item])), []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, smsResponse] = await Promise.all([
        fetch("/api/alpha-exchange/admin-prep", { cache: "no-store" }),
        fetch("/api/alpha-exchange/admin/sms-deliveries", { cache: "no-store" }),
      ]);
      const payload = (await response.json()) as Omit<AdminPayload, "smsDeliveries"> & { error?: string };
      const smsPayload = (await smsResponse.json()) as { deliveries?: AdminSmsDelivery[]; error?: string };
      if (!response.ok || !smsResponse.ok) throw new Error(safeAdminError("load", locale));
      setData({ ...payload, smsDeliveries: smsPayload.deliveries ?? [] });
    } catch (requestError) {
      setError(isArabic ? safeAdminError("load", locale) : requestError instanceof Error ? requestError.message : safeAdminError("load", locale));
    } finally {
      setLoading(false);
    }
  }, [isArabic, locale]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const fetchSystemHealth = useCallback(async () => {
    setSystemHealthLoading(true);
    setSystemHealthError(null);
    try {
      const response = await fetch("/api/admin/system-health", { cache: "no-store" });
      const payload = await response.json() as SystemHealthSnapshot & { error?: string };
      if (!response.ok || !Array.isArray(payload.checks)) {
        throw new Error("health_check_failed");
      }
      setSystemHealth(payload);
    } catch {
      setSystemHealthError(t("Website health could not be loaded. Try again.", "تعذر تحميل حالة الموقع. حاول مرة أخرى."));
    } finally {
      setSystemHealthLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (activeSection !== "system-health") return;
    void fetchSystemHealth();
    const intervalId = window.setInterval(() => {
      void fetchSystemHealth();
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [activeSection, fetchSystemHealth]);

  useEffect(() => {
    if (!data?.complianceSettings?.recoveryWallet) return;
    setComplianceWalletNetwork(data.complianceSettings.recoveryWallet.network);
    setComplianceWalletAddress(data.complianceSettings.recoveryWallet.walletAddress);
  }, [data?.complianceSettings?.recoveryWallet]);

  useEffect(() => {
    setActiveSection(adminDestination.section);

    if (adminDestination.section === "seller-applications") {
      setApplicationsQuery(adminDestination.sellerApplicationId ?? "");
      setApplicationsStatus("all");
      setApplicationsPage(1);
    }
    if (adminDestination.section === "marketplace-listings") {
      setListingsQuery(adminDestination.listingId ?? "");
      setListingsStatus(adminDestination.listingStatus ?? "all");
      setListingsNetwork("all");
      setListingsPage(1);
    }
    if (adminDestination.section === "purchase-requests") {
      setRequestsQuery(adminDestination.purchaseRequestId ?? "");
      setRequestsStatus("all");
      setRequestsPage(1);
    }
    if (adminDestination.section === "commissions") {
      setCommissionsQuery(adminDestination.commissionId ?? "");
      setCommissionsPage(1);
    }
  }, [adminDestination]);

  function pushToast(message: string) {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast(message);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 1800);
  }

  function requestReason(promptText: string, defaultValue = "") {
    const reason = window.prompt(promptText, defaultValue);
    return reason ? reason.trim() : "";
  }

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const sellersById = useMemo(() => {
    const map = new Map<string, AdminSeller>();
    for (const seller of data?.approvedSellers ?? []) {
      map.set(seller.id, seller);
    }
    return map;
  }, [data?.approvedSellers]);

  const listingById = useMemo(() => {
    const map = new Map<string, MarketplaceListing>();
    for (const listing of data?.listings ?? []) {
      map.set(listing.id, listing);
    }
    return map;
  }, [data?.listings]);
  const requestsById = useMemo(() => {
    const map = new Map<string, PurchaseRequest>();
    for (const request of data?.purchaseRequests ?? []) {
      map.set(request.id, request);
    }
    return map;
  }, [data?.purchaseRequests]);
  const displayLookup = useMemo(
    () =>
      createExchangeDisplayLookup({
        listings: data?.listings,
        requests: data?.purchaseRequests,
        commissions: data?.commissionRecords,
        applications: data?.applications,
      }),
    [data?.applications, data?.commissionRecords, data?.listings, data?.purchaseRequests],
  );
  const localizedAuditDetails = useCallback((entry: AuditLogEntry) => {
    if (!isArabic) return replaceExchangeEntityIds(entry.details ?? "—", displayLookup);
    if (!entry.details) return "—";
    if (/[\u0600-\u06ff]/.test(entry.details)) return replaceExchangeEntityIds(entry.details, displayLookup);
    return actionLabel(entry.action);
  }, [actionLabel, displayLookup, isArabic]);

  const applicationsRows = useMemo(() => {
    const items = (data?.applications ?? []).filter((application) => {
      if (applicationsStatus !== "all" && application.status !== applicationsStatus) return false;
      const query = applicationsQuery.trim().toLowerCase();
      if (!query) return true;
      const haystack = `${application.id} ${application.fullName} ${application.email} ${application.whatsappNumber} ${application.preferredNetworks.join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...items].sort((a, b) => {
      if (applicationsSort === "name") return a.fullName.localeCompare(b.fullName);
      if (applicationsSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return paginate(sorted, applicationsPage);
  }, [applicationsPage, applicationsQuery, applicationsSort, applicationsStatus, data?.applications]);

  const sellersRows = useMemo(() => {
    const items = (data?.approvedSellers ?? []).filter((seller) => {
      if (sellersStatus !== "all" && seller.sellerStatus !== sellersStatus) return false;
      const query = sellersQuery.trim().toLowerCase();
      if (!query) return true;
      const haystack = `${seller.fullName} ${seller.email} ${seller.whatsappNumber}`.toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...items].sort((a, b) => {
      if (sellersSort === "name") return a.fullName.localeCompare(b.fullName);
      if (sellersSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return paginate(sorted, sellersPage);
  }, [data?.approvedSellers, sellersPage, sellersQuery, sellersSort, sellersStatus]);

  const listingsRows = useMemo(() => {
    const items = (data?.listings ?? []).filter((listing) => {
      if (listingsStatus !== "all" && listing.status !== listingsStatus) return false;
      if (listingsNetwork !== "all" && listing.network !== listingsNetwork) return false;
      const query = listingsQuery.trim().toLowerCase();
      if (!query) return true;
      const haystack = `${listing.id} ${listing.sellerDisplayName} ${listing.availableAmount} ${listing.price} ${listing.network}`.toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...items].sort((a, b) => {
      if (listingsSort === "price-asc") return toNumber(a.price) - toNumber(b.price);
      if (listingsSort === "price-desc") return toNumber(b.price) - toNumber(a.price);
      if (listingsSort === "amount-desc") return toNumber(b.availableAmount) - toNumber(a.availableAmount);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return paginate(sorted, listingsPage);
  }, [data?.listings, listingsNetwork, listingsPage, listingsQuery, listingsSort, listingsStatus]);

  const requestsRows = useMemo(() => {
    const items = (data?.purchaseRequests ?? []).filter((request) => {
      if (requestsStatus !== "all" && request.status !== requestsStatus) return false;
      const query = requestsQuery.trim().toLowerCase();
      if (!query) return true;
      const listing = listingById.get(request.listingId);
      const seller = sellersById.get(request.sellerId);
      const haystack = `${request.id} ${request.tradeId ?? request.id} ${displayTradeId(request)} ${request.buyerName} ${request.buyerWhatsapp} ${seller?.fullName ?? request.sellerId} ${listing?.id ?? request.listingId} ${displayListingId(listing, request.listingId)}`.toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...items].sort((a, b) => {
      if (requestsSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return paginate(sorted, requestsPage);
  }, [data?.purchaseRequests, listingById, requestsPage, requestsQuery, requestsSort, requestsStatus, sellersById]);

  const commissionsRows = useMemo(() => {
    const items = (data?.commissionRecords ?? []).filter((record) => {
      const request = requestsById.get(record.purchaseRequestId);
      const seller = sellersById.get(record.sellerId);
      const query = commissionsQuery.trim().toLowerCase();
      if (!query) return true;
      const tradeId = request?.tradeId ?? record.tradeId ?? record.purchaseRequestId;
      const haystack = `${record.id} ${displayCommissionId(record)} ${tradeId} ${request ? displayTradeId(request, record.purchaseRequestId) : displayTradeId(null, tradeId)} ${request?.buyerName ?? record.buyerId} ${seller?.fullName ?? record.sellerId}`.toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...items].sort((a, b) => {
      if (commissionsSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (commissionsSort === "highest") return b.commissionAmount - a.commissionAmount;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return paginate(sorted, commissionsPage);
  }, [commissionsPage, commissionsQuery, commissionsSort, data?.commissionRecords, requestsById, sellersById]);

  const deepLinkTarget = useMemo(() => {
    if (adminDestination.sellerApplicationId) return { kind: "sellerApplication" as const, id: adminDestination.sellerApplicationId };
    if (adminDestination.listingId) return { kind: "listing" as const, id: adminDestination.listingId };
    if (adminDestination.purchaseRequestId) return { kind: "purchaseRequest" as const, id: adminDestination.purchaseRequestId };
    if (adminDestination.commissionId) return { kind: "commission" as const, id: adminDestination.commissionId };
    return null;
  }, [adminDestination]);

  const requestedTargetIsUnavailable = useMemo(() => {
    if (!data || !deepLinkTarget) return false;
    if (deepLinkTarget.kind === "sellerApplication") return !data.applications.some((application) => application.id === deepLinkTarget.id);
    if (deepLinkTarget.kind === "listing") return !data.listings.some((listing) => listing.id === deepLinkTarget.id);
    if (deepLinkTarget.kind === "purchaseRequest") return !data.purchaseRequests.some((request) => request.id === deepLinkTarget.id);
    return !data.commissionRecords.some((record) => record.id === deepLinkTarget.id);
  }, [data, deepLinkTarget]);

  const unavailableDeepLinkMessage = useMemo(() => {
    if (!requestedTargetIsUnavailable || !deepLinkTarget) return null;
    if (isArabic) {
      const label = deepLinkTarget.kind === "sellerApplication"
        ? "طلب البائع"
        : deepLinkTarget.kind === "listing"
          ? "عرض السوق"
          : deepLinkTarget.kind === "purchaseRequest"
            ? "طلب الشراء"
            : "سجل العمولة";
      return `${label} المطلوب لم يعد متاحًا.`;
    }
    const label = deepLinkTarget.kind === "sellerApplication"
      ? "seller application"
      : deepLinkTarget.kind === "listing"
        ? "marketplace listing"
        : deepLinkTarget.kind === "purchaseRequest"
          ? "purchase request"
          : "commission record";
    return `The requested ${label} is no longer available.`;
  }, [deepLinkTarget, isArabic, requestedTargetIsUnavailable]);

  useEffect(() => {
    if (!deepLinkTarget) {
      lastFocusedDeepLinkRef.current = null;
    }
  }, [deepLinkTarget]);

  useLayoutEffect(() => {
    // Data can resolve one render before the loading shell is removed. Wait
    // for the stable row layout so a deep link never consumes its one focus
    // attempt while the target is still absent from the DOM.
    if (loading || !data || !deepLinkTarget || requestedTargetIsUnavailable) return;
    const target = deepLinkTargetElement;
    const targetPrefix = deepLinkTarget.kind === "sellerApplication"
      ? "seller-application-"
      : deepLinkTarget.kind === "listing"
        ? "marketplace-listing-"
        : deepLinkTarget.kind === "purchaseRequest"
          ? "purchase-request-"
          : "commission-";
    if (!target || target.id !== `${targetPrefix}${deepLinkTarget.id}`) return;

    const marker = `${searchParamsKey}:${deepLinkTarget.kind}:${deepLinkTarget.id}`;
    if (lastFocusedDeepLinkRef.current === marker) return;

    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center", behavior: "auto" });
    lastFocusedDeepLinkRef.current = marker;
  }, [
    activeSection,
    applicationsRows.rows,
    commissionsRows.rows,
    data,
    deepLinkTarget,
    deepLinkTargetElement,
    listingsRows.rows,
    loading,
    requestedTargetIsUnavailable,
    requestsRows.rows,
    searchParamsKey,
  ]);

  const auditRows = useMemo(() => {
    const items = (data?.auditLogs ?? []).filter((entry) => {
      if (auditAction !== "all" && entry.action !== auditAction) return false;
      const query = auditQuery.trim().toLowerCase();
      if (!query) return true;
      const actor = sellersById.get(entry.actorUserId)?.fullName ?? entry.actorUserId;
      const tradeId = entry.purchaseRequestId ? (requestsById.get(entry.purchaseRequestId)?.tradeId ?? entry.purchaseRequestId) : "";
      const haystack = `${entry.action} ${entry.details ?? ""} ${replaceExchangeEntityIds(entry.details ?? "", displayLookup)} ${actor} ${entry.listingId ?? ""} ${entry.listingId ? displayListingId(listingById.get(entry.listingId), entry.listingId) : ""} ${tradeId}`.toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...items].sort((a, b) => {
      if (auditSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return paginate(sorted, auditPage);
  }, [auditAction, auditPage, auditQuery, auditSort, data?.auditLogs, displayLookup, listingById, requestsById, sellersById]);

  const notificationRows = useMemo(() => {
    const items = (data?.notifications ?? []).filter((entry) => {
      const query = notificationQuery.trim().toLowerCase();
      if (!query) return true;
      const seller = sellersById.get(entry.userId);
      const haystack = `${entry.title} ${entry.message} ${replaceExchangeEntityIds(entry.title, displayLookup)} ${replaceExchangeEntityIds(entry.message, displayLookup)} ${entry.category} ${seller?.fullName ?? entry.userId} ${entry.relatedTradeId ?? ""} ${entry.relatedListingId ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
    return paginate(sortNotificationsNewestFirst(items), notificationPage);
  }, [data?.notifications, displayLookup, notificationPage, notificationQuery, sellersById]);

  const smsDeliveryRows = useMemo(
    () => paginate(data?.smsDeliveries ?? [], smsDeliveriesPage),
    [data?.smsDeliveries, smsDeliveriesPage],
  );

  const enforcementRows = useMemo(
    () => paginate(data?.enforcement?.recentActivity ?? [], enforcementPage),
    [data?.enforcement?.recentActivity, enforcementPage],
  );

  const expirationHistory = useMemo(
    () => (data?.auditLogs ?? []).filter((entry) => entry.action === "listing_expired" || entry.action === "listing_renewed" || entry.action === "listing_expiration_extended" || entry.action === "admin_override"),
    [data?.auditLogs],
  );

  const timeoutHistory = useMemo(
    () => (data?.purchaseRequests ?? []).filter((request) => Boolean(request.timedOutAt)),
    [data?.purchaseRequests],
  );

  const betaFeedbackRows = useMemo(() => {
    const items = (data?.privateBeta.feedback ?? []).filter((entry) => (betaFeedbackStatusFilter === "all" ? true : entry.status === betaFeedbackStatusFilter));
    return items.slice(0, 20);
  }, [betaFeedbackStatusFilter, data?.privateBeta.feedback]);

  const usersRows = useMemo(() => {
    const items = (data?.users ?? []).filter((user) => {
      if (usersRoleFilter !== "all" && user.role !== usersRoleFilter) return false;
      const query = usersQuery.trim().toLowerCase();
      if (!query) return true;
      return `${user.fullName} ${user.email} ${user.role}`.toLowerCase().includes(query);
    });
    return paginate(items, usersPage);
  }, [data?.users, usersPage, usersQuery, usersRoleFilter]);

  const reviewsRows = useMemo(() => {
    const items = (data?.sellerReviews ?? []).filter((review) => {
      const query = reviewsQuery.trim().toLowerCase();
      if (!query) return true;
      const seller = sellersById.get(review.sellerId);
      return `${seller?.fullName ?? review.sellerId} ${review.buyerId} ${review.comment}`.toLowerCase().includes(query);
    });
    return paginate(items, reviewsPage);
  }, [data?.sellerReviews, reviewsPage, reviewsQuery, sellersById]);

  const trustScoreMap = useMemo(() => {
    const map = new Map<string, number>();
    const engine = data?.trustEngine;
    if (!engine) return map;
    for (const s of [...(engine.highestTrustSellers ?? []), ...(engine.lowestTrustSellers ?? []), ...(engine.flaggedSellers ?? [])]) {
      if (!map.has(s.sellerId)) map.set(s.sellerId, s.trustScore);
    }
    return map;
  }, [data?.trustEngine]);

  const rankMgmtRows = useMemo(() => {
    const query = rankMgmtSearch.trim().toLowerCase();
    const items = (data?.approvedSellers ?? []).filter((seller) => {
      if (rankMgmtFilter !== "all" && (seller.sellerPrestigeRank ?? "bronze") !== rankMgmtFilter) return false;
      if (!query) return true;
      return `${seller.fullName} ${seller.email}`.toLowerCase().includes(query);
    });
    return [...items].sort((a, b) => {
      const rankWeight = (s: AdminSeller) => {
        const r = s.sellerPrestigeRank ?? "bronze";
        return SELLER_LEVELS.indexOf(r) + 1;
      };
      return rankWeight(b) - rankWeight(a);
    });
  }, [data?.approvedSellers, rankMgmtFilter, rankMgmtSearch]);

  async function runAction(request: Promise<Response>, successMessage: string) {
    try {
      const response = await request;
      let payload: { error?: string } | null = null;
      try {
        payload = (await response.json()) as { error?: string };
      } catch {
        payload = null;
      }
      if (!response.ok) throw new Error(isArabic ? safeAdminError("action", locale) : payload?.error || safeAdminError("action", locale));
      pushToast(successMessage);
      await fetchData();
      return true;
    } catch (actionError) {
      pushToast(isArabic ? safeAdminError("action", locale) : actionError instanceof Error ? actionError.message : safeAdminError("action", locale));
      return false;
    }
  }

  async function handleSellerAvailabilityStatus(sellerId: string, availabilityStatus: SellerAvailabilityStatus, successMessage: string, reason?: string) {
    await runAction(
      fetch(`/api/alpha-exchange/admin/sellers/${sellerId}/profile-state`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ availabilityStatus, reason }),
      }),
      successMessage,
    );
  }

  async function handleSellerPrestigeOverride(sellerId: string, rank: SellerLevel, reason: string, clearOverride = false) {
    await runAction(
      fetch(`/api/alpha-exchange/admin/sellers/${sellerId}/prestige`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rank, reason, clearOverride }),
      }),
      clearOverride ? t("Prestige override cleared.", "تمت إزالة تعديل الرتبة.") : t(`Seller prestige set to ${sellerLevelLabel(rank)}.`, `تم تعيين رتبة البائع إلى ${sellerLevelLabel(rank)}.`),
    );
  }

  async function handleSaveComplianceRecoveryWallet() {
    const walletAddress = complianceWalletAddress.trim();
    if (!walletAddress) {
      pushToast(t("Recovery wallet address is required.", "عنوان محفظة الاسترداد مطلوب."));
      return;
    }
    await runAction(
      fetch("/api/alpha-exchange/admin/compliance/recovery-wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          network: complianceWalletNetwork,
          walletAddress,
          defaultPaymentRail: "manual_wallet_transfer",
        }),
      }),
      t("Marketplace Compliance Recovery Wallet saved.", "تم حفظ محفظة استرداد امتثال السوق."),
    );
  }

  function handleRankMgmtChange(sellerId: string, toRank: SellerLevel) {
    const seller = rankMgmtRows.find((s) => s.id === sellerId);
    if (!seller) return;
    const fromRank = seller.sellerPrestigeRank ?? "bronze";
    if (fromRank === toRank) return;
    setRankConfirmReason("");
    setRankConfirmPending({
      sellerId,
      sellerName: seller.fullName ?? seller.email,
      fromRank,
      toRank,
    });
  }

  async function handleRankConfirm() {
    if (!rankConfirmPending) return;
    const { sellerId, toRank } = rankConfirmPending;
    const reason = rankConfirmReason.trim() || t("Admin rank management — manual override", "إدارة الرتب — تعديل يدوي من الإدارة");
    setRankConfirmPending(null);
    setRankConfirmReason("");
    setRankMgmtSaving((prev) => new Set(prev).add(sellerId));
    try {
      await handleSellerPrestigeOverride(sellerId, toRank, reason);
    } finally {
      setRankMgmtSaving((prev) => {
        const next = new Set(prev);
        next.delete(sellerId);
        return next;
      });
    }
  }

  async function handleBulkRankAction(action: "promote" | "demote" | "set" | "reset", targetRank?: SellerLevel) {
    const RANK_ORDER: readonly SellerLevel[] = SELLER_LEVELS;
    const sellers = rankMgmtRows.filter((s) => rankMgmtSelected.has(s.id));
    if (sellers.length === 0) { pushToast(t("No sellers selected.", "لم يتم اختيار أي بائع.")); return; }
    const eligibleSellers = sellers.filter((s) => !(s.roles ?? []).includes("owner") && s.role !== "owner");
    if (eligibleSellers.length === 0) { pushToast(t("Owner accounts cannot be modified.", "لا يمكن تعديل حساب المالك.")); return; }
    const label = action === "promote" ? "promote to next rank" : action === "demote" ? "demote to previous rank" : action === "reset" ? "reset to Bronze" : `set rank to ${targetRank ?? "selected"}`;
    if (!window.confirm(t(`Apply "${label}" to ${eligibleSellers.length} seller(s)?`, `هل تريد تطبيق الإجراء على ${eligibleSellers.length} من البائعين؟`))) return;
    for (const seller of eligibleSellers) {
      const current = seller.sellerPrestigeRank ?? "bronze";
      const currentIdx = RANK_ORDER.indexOf(current);
      let newRank: SellerLevel;
      if (action === "promote") newRank = RANK_ORDER[Math.min(RANK_ORDER.length - 1, currentIdx + 1)];
      else if (action === "demote") newRank = RANK_ORDER[Math.max(0, currentIdx - 1)];
      else if (action === "reset") newRank = "bronze";
      else newRank = targetRank ?? "bronze";
      if (newRank === current && action !== "set" && action !== "reset") continue;
      setRankMgmtSaving((prev) => new Set(prev).add(seller.id));
      try {
        const response = await fetch(`/api/alpha-exchange/admin/sellers/${seller.id}/prestige`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rank: newRank, reason: `Bulk admin action — ${label}` }),
        });
        if (!response.ok) {
          const payload = await response.json() as { error?: string };
          pushToast(isArabic ? safeAdminError("action", locale) : payload.error ?? "Failed for one seller.");
        }
      } finally {
        setRankMgmtSaving((prev) => { const next = new Set(prev); next.delete(seller.id); return next; });
      }
    }
    setRankMgmtSelected(new Set());
    pushToast(t(`Bulk rank action applied to ${eligibleSellers.length} seller(s).`, `تم تطبيق إجراء الرتبة على ${eligibleSellers.length} من البائعين.`));
    await fetchData();
  }

  async function handleAdminListingAction(listingId: string, action: "renew" | "extend" | "close" | "force_close", successMessage: string, expirationHours?: number, reason?: string) {
    await runAction(
      fetch(`/api/alpha-exchange/admin/listings/${listingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, expirationHours, reason }),
      }),
      successMessage,
    );
  }

  async function handleCreateInvite() {
    await runAction(
      fetch("/api/alpha-exchange/admin/private-beta/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxUses: Number(inviteMaxUses),
          expiresAt: inviteExpiresAt || undefined,
        }),
      }),
      t("Access code created.", "تم إنشاء رمز الوصول."),
    );
  }

  async function handleInviteStatus(inviteId: string, action: "expire" | "disable") {
    await runAction(
      fetch(`/api/alpha-exchange/admin/private-beta/invites/${inviteId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      }),
      action === "expire" ? t("Invite expired.", "انتهت صلاحية الدعوة.") : t("Invite disabled.", "تم تعطيل الدعوة."),
    );
  }

  async function handleFeedbackStatus(feedbackId: string, status: "new" | "in_review" | "resolved") {
    await runAction(
      fetch(`/api/alpha-exchange/admin/private-beta/feedback/${feedbackId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }),
      t("Feedback status updated.", "تم تحديث حالة الملاحظة."),
    );
  }

  async function handleCreateAnnouncement() {
    if (![announcementTitleEn, announcementMessageEn, announcementTitleAr, announcementMessageAr].every((value) => value.trim())) {
      pushToast(t("Complete the English and Arabic title and message before publishing.", "أكمل العنوان والنص بالإنجليزية والعربية قبل النشر."));
      return;
    }
    const published = await runAction(
      fetch("/api/alpha-exchange/admin/private-beta/announcements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: announcementType,
          titleEn: announcementTitleEn.trim(),
          messageEn: announcementMessageEn.trim(),
          titleAr: announcementTitleAr.trim(),
          messageAr: announcementMessageAr.trim(),
        }),
      }),
      t("Announcement published.", "تم نشر الإعلان."),
    );
    if (!published) return;
    setAnnouncementTitleEn("");
    setAnnouncementMessageEn("");
    setAnnouncementTitleAr("");
    setAnnouncementMessageAr("");
  }

  async function handleAnnouncementState(announcement: BetaAnnouncement, isActive: boolean) {
    await runAction(
      fetch(`/api/alpha-exchange/admin/private-beta/announcements/${announcement.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive }),
      }),
      isActive ? t("Announcement enabled.", "تم تفعيل الإعلان.") : t("Announcement disabled.", "تم تعطيل الإعلان."),
    );
  }

  async function handleForceComplete(requestId: string) {
    const reason = window.prompt(t("Reason for force-completing this trade:", "سبب إكمال هذه الصفقة يدويًا:"));
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/purchase-requests/${requestId}/force-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? t("Trade force-completed.", "تم إكمال الصفقة يدويًا.") : (isArabic ? safeAdminError("action", locale) : p.error ?? "Error"));
    if (r.ok) { setSelectedRequest(null); await fetchData(); }
  }

  async function handleForceCancel(requestId: string) {
    const reason = window.prompt(t("Reason for cancelling this trade:", "سبب إلغاء هذه الصفقة:"));
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/purchase-requests/${requestId}/force-cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? t("Trade cancelled.", "تم إلغاء الصفقة.") : (isArabic ? safeAdminError("action", locale) : p.error ?? "Error"));
    if (r.ok) { setSelectedRequest(null); await fetchData(); }
  }

  async function handleUnlockReview(requestId: string) {
    const reason = window.prompt(t("Reason for unlocking review:", "سبب فتح التقييم:"));
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/purchase-requests/${requestId}/unlock-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? t("Review window unlocked.", "تم فتح نافذة التقييم.") : (isArabic ? safeAdminError("action", locale) : p.error ?? "Error"));
    if (r.ok) await fetchData();
  }

  async function handleReverifyCommission(commissionId: string) {
    if (!window.confirm(t("Reverify this commission against the blockchain now?", "هل تريد إعادة التحقق من هذه العمولة على blockchain الآن؟"))) return;
    const reason = requestReason(t("Reason for reverifying this commission:", "سبب إعادة التحقق من هذه العمولة:"), t("Manual admin reverification", "إعادة تحقق يدوية من الإدارة"));
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/commissions/${commissionId}/reverify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const p = await r.json() as { error?: string; notes?: string };
    pushToast(r.ok ? t(`Reverification: ${p.notes ?? "complete"}`, "اكتملت إعادة التحقق.") : (isArabic ? safeAdminError("action", locale) : p.error ?? "Error"));
    if (r.ok) await fetchData();
  }

  async function handleChangeUserRole(userId: string, currentRole: string) {
    const newRole = window.prompt(t(`Change role for user (current: ${currentRole})\nOptions: buyer, approved_seller, admin, owner`, `تغيير دور المستخدم (الحالي: ${currentRole})\nالخيارات: buyer, approved_seller, admin, owner`));
    if (!newRole) return;
    if (!window.confirm(t(`Change this user's role from ${currentRole} to ${newRole.trim()}?`, `هل تريد تغيير دور المستخدم من ${currentRole} إلى ${newRole.trim()}؟`))) return;
    const reason = window.prompt(t("Reason for role change:", "سبب تغيير الدور:"));
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/users/${userId}/role`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: newRole, reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? t("Role updated.", "تم تحديث الدور.") : (isArabic ? safeAdminError("action", locale) : p.error ?? "Error"));
    if (r.ok) await fetchData();
  }

  async function handleDisableUser(userId: string, disabled: boolean) {
    if (!window.confirm(t(`${disabled ? "Disable" : "Enable"} this account?`, `هل تريد ${disabled ? "تعطيل" : "تفعيل"} هذا الحساب؟`))) return;
    const reason = window.prompt(t(`Reason for ${disabled ? "disabling" : "enabling"} this account:`, `سبب ${disabled ? "تعطيل" : "تفعيل"} هذا الحساب:`));
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/users/${userId}/disable`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled, reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? t(`Account ${disabled ? "disabled" : "enabled"}.`, `تم ${disabled ? "تعطيل" : "تفعيل"} الحساب.`) : (isArabic ? safeAdminError("action", locale) : p.error ?? "Error"));
    if (r.ok) await fetchData();
  }

  async function handleModerateReview(reviewId: string, hide: boolean) {
    const reason = window.prompt(t(`Reason for ${hide ? "hiding" : "restoring"} this review:`, `سبب ${hide ? "إخفاء" : "إظهار"} هذا التقييم:`));
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/reviews/${reviewId}/moderate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hide, reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? t(`Review ${hide ? "hidden" : "restored"}.`, `تم ${hide ? "إخفاء" : "إظهار"} التقييم.`) : (isArabic ? safeAdminError("action", locale) : p.error ?? "Error"));
    if (r.ok) await fetchData();
  }

  async function handleBroadcast() {
    if (!broadcastTitleEn.trim() || !broadcastBodyEn.trim() || !broadcastTitleAr.trim() || !broadcastBodyAr.trim()) {
      pushToast(t("English and Arabic titles and bodies are required.", "العنوان والنص مطلوبان بالإنجليزية والعربية."));
      return;
    }
    if (!window.confirm(t("Broadcast this notification to all users?", "هل تريد إرسال هذا الإشعار إلى جميع المستخدمين؟"))) return;
    const reason = requestReason(t("Reason for this broadcast:", "سبب هذا الإرسال:"), t("Operational announcement", "إعلان تشغيلي"));
    if (!reason) return;
    const r = await fetch("/api/alpha-exchange/admin/notifications/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titleEn: broadcastTitleEn,
        bodyEn: broadcastBodyEn,
        titleAr: broadcastTitleAr,
        bodyAr: broadcastBodyAr,
        type: broadcastType,
        reason,
      }),
    });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? t("Broadcast sent.", "تم إرسال الإشعار.") : (isArabic ? safeAdminError("action", locale) : p.error ?? "Error"));
    if (r.ok) {
      setBroadcastTitleEn("");
      setBroadcastBodyEn("");
      setBroadcastTitleAr("");
      setBroadcastBodyAr("");
    }
  }

  function exportCommissionsCsv() {
    const rows = commissionsRows.rows;
    const csvRows = [
      ["Trade ID", "Buyer", "Seller", "Trade Value", "1% Commission", "Date"].join(","),
      ...rows.map((record) => {
        const request = requestsById.get(record.purchaseRequestId);
        const seller = sellersById.get(record.sellerId);
        const buyerName = request?.buyerName ?? record.buyerId;
        const sellerName = seller?.fullName ?? record.sellerId;
        const tradeId = displayTradeId(request, record.tradeId ?? record.purchaseRequestId);
        return [tradeId, buyerName, sellerName, record.grossAmount.toFixed(2), record.commissionAmount.toFixed(2), record.paymentStatus, record.createdAt].join(",");
      }),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `alpha-exchange-commissions-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportTradesCsv() {
    const rows = requestsRows.rows;
    const csvRows = [
      ["Trade ID", "Request ID", "Buyer", "Seller", "USDT Amount", "Fiat Amount", "Currency", "Network", "Payment Method", "Bank", "Status", "Submitted", "Completed"].join(","),
      ...rows.map((request) => {
        const seller = sellersById.get(request.sellerId);
        return [
          displayTradeId(request),
          displayRequestId(request),
          request.buyerName,
          seller?.fullName ?? request.sellerId,
          request.usdtAmount,
          request.fiatAmount,
          request.currency,
          request.network,
          `"${request.paymentMethod.replace(/"/g, '""')}"`,
          `"${(request.bankName ?? "").replace(/"/g, '""')}"`,
          request.status,
          request.createdAt,
          request.completedAt ?? "",
        ].join(",");
      }),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `alpha-exchange-trades-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function renderPagination(page: number, totalPages: number, onChange: (next: number) => void) {
    return (
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4 text-sm text-[#9CA3AF]">
        <span>
          {t(`Page ${page} of ${totalPages}`, `الصفحة ${page} من ${totalPages}`)}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
            {t("Previous", "السابق")}
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
            {t("Next", "التالي")}
          </Button>
        </div>
      </div>
    );
  }

  function renderEmptyTableRow(message: string, colSpan = 6) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-4 py-10 text-center">
          <div className="mx-auto max-w-sm rounded-xl border border-white/10 bg-black/20 p-4">
            <AlertTriangle className="mx-auto h-4 w-4 text-[#C9A227]" />
            <p className="mt-2 text-sm font-medium text-white">{message}</p>
            <p className="mt-1 text-xs text-[#9CA3AF]">{t("Adjust your filters or search terms to view matching results.", "غيّر الفلاتر أو كلمات البحث لعرض النتائج المناسبة.")}</p>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <section dir={isArabic ? "rtl" : "ltr"} lang={locale} className="section-container page-shell admin-dashboard-shell !max-w-[118rem] 2xl:!max-w-[128rem]">
      <div className="grid gap-6 xl:grid-cols-[290px_minmax(0,1fr)] xl:items-start">
        <aside className="h-fit rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-5 backdrop-blur-sm xl:sticky xl:top-4">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#C9A227]">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("Alpha Exchange Admin", "إدارة Alpha Exchange")}
          </p>
          <nav className="space-y-3">
            {sectionGroups.map((group) => (
              <div key={group.title} className="space-y-1.5">
                <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C9A227]">
                  {isArabic ? group.titleAr : group.title}
                </p>
                {group.keys.map((key) => {
                  const item = sectionItemsByKey.get(key);
                  if (!item) return null;
                  const Icon = item.icon;
                  const isActive = activeSection === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setActiveSection(item.key)}
                      aria-label={t(`Open ${item.label}`, `فتح ${item.labelAr}`)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition ${isArabic ? "text-right" : "text-left"} ${isActive ? "border border-[#C9A227]/30 bg-[#C9A227]/10 text-white" : "text-[#9CA3AF] hover:bg-white/5 hover:text-white"}`}
                    >
                      <Icon className="h-4 w-4" />
                      {isArabic ? item.labelAr : item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <div className="admin-main-panel min-w-0">
          <div key={activeSection} className="alpha-reveal-rise">
              {loading ? (
                <Card className="border-white/10 bg-[#0B0B0B]/90">
                  <CardContent className="space-y-3 p-8">
                    <div className="h-5 w-44 animate-pulse rounded bg-white/10" />
                    <div className="h-10 w-full animate-pulse rounded-xl bg-white/10" />
                    <div className="h-10 w-full animate-pulse rounded-xl bg-white/10" />
                    <div className="h-10 w-2/3 animate-pulse rounded-xl bg-white/10" />
                  </CardContent>
                </Card>
              ) : error ? (
                <Card className="border-red-500/30 bg-[#0B0B0B]/90">
                  <CardContent className="flex items-center gap-3 p-8">
                    <AlertTriangle className="h-5 w-5 text-red-400" />
                    <span className="text-sm text-red-200">{safeAdminError("load", locale)}</span>
                  </CardContent>
                </Card>
              ) : null}

              {!loading && !error && data ? (
                <>
                  {activeSection === "overview" ? (
                    <div className="space-y-6 xl:space-y-8">
                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle className="text-xl md:text-2xl">{t("Owner Business Dashboard", "لوحة أعمال المالك")}</CardTitle>
                          <CardDescription>{t("Business health at a glance for Alpha Exchange.", "ملخص سريع لحالة أعمال Alpha Exchange.")}</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          {[
                            { label: t("Today • Completed Trades", "اليوم • الصفقات المكتملة"), value: data.ownerBusiness.today.completedTrades, icon: CheckCircle2 },
                            { label: t("Today • Trade Volume", "اليوم • حجم التداول"), value: formatUsdt(data.ownerBusiness.today.tradeVolumeUsdt), icon: WalletCards },
                            { label: t("Today • Estimated Commission", "اليوم • العمولة المقدّرة"), value: formatCurrency(data.ownerBusiness.today.estimatedCommission), icon: Coins },
                            { label: t("Today • Trades Waiting Evidence", "اليوم • صفقات تنتظر الإثبات"), value: data.ownerBusiness.today.tradesWaitingEvidence, icon: AlertTriangle },
                          ].map((stat) => {
                            const Icon = stat.icon;
                            return (
                              <Card key={stat.label} className="admin-kpi-card border-white/10 bg-[linear-gradient(140deg,rgba(16,16,16,0.95),rgba(11,11,11,0.86))]">
                                <CardHeader className="pb-3">
                                  <CardDescription className="text-[11px] uppercase tracking-[0.16em] text-[#9CA3AF]">{stat.label}</CardDescription>
                                  <CardTitle className="text-2xl md:text-3xl">{stat.value}</CardTitle>
                                </CardHeader>
                                <CardContent className="pt-0">
                                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 text-[#C9A227]">
                                    <Icon className="h-5 w-5" />
                                  </span>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </CardContent>
                      </Card>

                      <Card className="border-red-500/20 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-red-100">
                            <ShieldCheck className="h-5 w-5 text-red-300" />
                            {t("Marketplace Compliance", "امتثال السوق")}
                          </CardTitle>
                          <CardDescription>{t("Current compliance restriction load and the latest immutable activity.", "القيود الحالية وآخر نشاط امتثال مسجّل.")}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="grid gap-3 sm:grid-cols-5">
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{t("Active", "نشطة")}</p>
                              <p className="mt-1 text-lg font-semibold text-red-200">{data.enforcement.metrics.activeCases}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{t("Resolved", "محلولة")}</p>
                              <p className="mt-1 text-lg font-semibold text-emerald-200">{data.enforcement.metrics.resolvedCases}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{t("Revoked", "ملغاة")}</p>
                              <p className="mt-1 text-lg font-semibold text-red-300">{data.enforcement.metrics.revokedCases}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{t("Total Cases", "إجمالي الحالات")}</p>
                              <p className="mt-1 text-lg font-semibold text-white">{data.enforcement.metrics.totalCases}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{t("Outstanding", "مستحق")}</p>
                              <p className="mt-1 text-lg font-semibold text-[#FDE68A]">{formatUsdt(data.enforcement.metrics.outstandingFeeAmountUsdt)}</p>
                            </div>
                          </div>
                          <Button type="button" variant="secondary" onClick={() => setActiveSection("marketplace-enforcement")}>
                            {t("Open Compliance Activity", "فتح نشاط الامتثال")}
                          </Button>
                        </CardContent>
                      </Card>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>{t("Today", "اليوم")}</CardTitle>
                            <CardDescription>{t("Operational metrics for the current day.", "مؤشرات التشغيل لليوم الحالي.")}</CardDescription>
                          </CardHeader>
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2 xl:grid-cols-3">
                            <p>{t("Completed Trades:", "الصفقات المكتملة:")} <span className="text-white">{data.ownerBusiness.today.completedTrades}</span></p>
                            <p>{t("Trade Volume:", "حجم التداول:")} <span className="text-white">{formatUsdt(data.ownerBusiness.today.tradeVolumeUsdt)}</span></p>
                            <p>{t("Estimated Commission:", "العمولة المقدّرة:")} <span className="text-white">{formatCurrency(data.ownerBusiness.today.estimatedCommission)}</span></p>
                            <p>{t("New Buyers:", "المشترون الجدد:")} <span className="text-white">{data.ownerBusiness.today.newBuyers}</span></p>
                            <p>{t("New Sellers:", "البائعون الجدد:")} <span className="text-white">{data.ownerBusiness.today.newSellers}</span></p>
                            <p>{t("New Listings:", "العروض الجديدة:")} <span className="text-white">{data.ownerBusiness.today.newListings}</span></p>
                            <p>{t("Listings Approved:", "العروض المقبولة:")} <span className="text-white">{data.ownerBusiness.today.listingsApproved}</span></p>
                            <p>{t("Listings Rejected:", "العروض المرفوضة:")} <span className="text-white">{data.ownerBusiness.today.listingsRejected}</span></p>
                            <p>{t("Pending Listings:", "العروض المعلّقة:")} <span className="text-white">{data.ownerBusiness.today.pendingListings}</span></p>
                            <p>{t("Pending Seller Applications:", "طلبات البائعين المعلّقة:")} <span className="text-white">{data.ownerBusiness.today.pendingSellerApplications}</span></p>
                            <p>{t("Open Disputes:", "النزاعات المفتوحة:")} <span className="text-white">{data.ownerBusiness.today.openDisputes}</span></p>
                            <p>{t("Resolved Disputes:", "النزاعات المحلولة:")} <span className="text-white">{data.ownerBusiness.today.resolvedDisputes}</span></p>
                            <p>{t("Missing Buyer Evidence:", "إثبات المشتري المفقود:")} <span className="text-white">{data.ownerBusiness.today.missingBuyerEvidence}</span></p>
                            <p>{t("Missing Seller Evidence:", "إثبات البائع المفقود:")} <span className="text-white">{data.ownerBusiness.today.missingSellerEvidence}</span></p>
                            <p>{t("Trades Waiting Evidence:", "صفقات تنتظر الإثبات:")} <span className="text-white">{data.ownerBusiness.today.tradesWaitingEvidence}</span></p>
                            <p>{t("Evidence Verified:", "الإثباتات المؤكدة:")} <span className="text-white">{data.ownerBusiness.today.evidenceVerified}</span></p>
                            <p>{t("Evidence Missing:", "الإثباتات المفقودة:")} <span className="text-white">{data.ownerBusiness.today.evidenceMissing}</span></p>
                          </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>{t("This Week", "هذا الأسبوع")}</CardTitle>
                            <CardDescription>{t("Weekly business momentum and trust movement.", "أداء الأعمال والثقة خلال الأسبوع.")}</CardDescription>
                          </CardHeader>
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2 xl:grid-cols-3">
                            <p>{t("Trade Volume:", "حجم التداول:")} <span className="text-white">{formatUsdt(data.ownerBusiness.thisWeek.tradeVolumeUsdt)}</span></p>
                            <p>{t("Revenue:", "الإيرادات:")} <span className="text-white">{formatCurrency(data.ownerBusiness.thisWeek.revenue)}</span></p>
                            <p>{t("Top Seller:", "أفضل بائع:")} <span className="text-white">{data.ownerBusiness.thisWeek.topSeller}</span></p>
                            <p>{t("Fastest Growing Seller:", "الأسرع نموًا:")} <span className="text-white">{data.ownerBusiness.thisWeek.fastestGrowingSeller}</span></p>
                            <p>{t("Highest Trust Score Increase:", "أكبر ارتفاع في الثقة:")} <span className="text-white">{data.ownerBusiness.thisWeek.highestTrustScoreIncrease}</span></p>
                            <p>{t("Avg Response Time:", "متوسط وقت الرد:")} <span className="text-white">{data.ownerBusiness.thisWeek.averageResponseTimeMinutes.toFixed(2)} {t("min", "دقيقة")}</span></p>
                            <p>{t("Avg Completion Time:", "متوسط وقت الإكمال:")} <span className="text-white">{data.ownerBusiness.thisWeek.averageTradeCompletionTimeMinutes.toFixed(2)} {t("min", "دقيقة")}</span></p>
                            <p>{t("Avg Buyer Rating:", "متوسط تقييم المشتري:")} <span className="text-white">{data.ownerBusiness.thisWeek.averageBuyerRating.toFixed(2)}</span></p>
                            <p>{t("Repeat Buyers:", "المشترون المتكررون:")} <span className="text-white">{formatPercent(data.ownerBusiness.thisWeek.repeatBuyersPercent)}</span></p>
                          </CardContent>
                        </Card>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>{t("Seller Leaderboard", "ترتيب البائعين")}</CardTitle>
                            <CardDescription>{t("Top sellers ranked by trust and marketplace performance.", "أفضل البائعين حسب الثقة وأداء السوق.")}</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-2 text-sm">
                            {data.ownerBusiness.sellerLeaderboard.slice(0, 5).map((seller, index) => (
                              <div key={seller.sellerId} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                                <div>
                                  <p className="font-medium text-white">#{index + 1} {seller.sellerName}</p>
                                  <p className="text-xs text-[#9CA3AF]">
                                    {t("Trust", "الثقة")} {seller.trustScore.toFixed(1)} • {t("Volume", "الحجم")} {formatUsdt(seller.tradeVolumeUsdt)} • {t("Trades", "الصفقات")} {seller.completedTrades}
                                  </p>
                                </div>
                                <p className="text-xs text-[#D1D5DB]">
                                  {t("Rating", "التقييم")} {seller.averageRating.toFixed(2)} • {seller.responseTimeMinutes.toFixed(2)} {t("min", "دقيقة")}
                                </p>
                              </div>
                            ))}
                            {!data.ownerBusiness.sellerLeaderboard.length ? <p className="text-[#9CA3AF]">{t("No seller leaderboard data yet.", "لا توجد بيانات لترتيب البائعين بعد.")}</p> : null}
                          </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>{t("Marketplace Health", "حالة السوق")}</CardTitle>
                            <CardDescription>{t("Core performance, risk, and participation indicators.", "أهم مؤشرات الأداء والمخاطر والمشاركة.")}</CardDescription>
                          </CardHeader>
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2 xl:grid-cols-2">
                            <p>{t("Completion Rate:", "نسبة الإكمال:")} <span className="text-white">{formatPercent(data.ownerBusiness.marketplaceHealth.completionRatePercent)}</span></p>
                            <p>{t("Cancellation Rate:", "نسبة الإلغاء:")} <span className="text-white">{formatPercent(data.ownerBusiness.marketplaceHealth.cancellationRatePercent)}</span></p>
                            <p>{t("Dispute Rate:", "نسبة النزاعات:")} <span className="text-white">{formatPercent(data.ownerBusiness.marketplaceHealth.disputeRatePercent)}</span></p>
                            <p>{t("Average Trust Score:", "متوسط درجة الثقة:")} <span className="text-white">{data.ownerBusiness.marketplaceHealth.averageTrustScore.toFixed(2)}</span></p>
                            <p>{t("Active Sellers:", "البائعون النشطون:")} <span className="text-white">{data.ownerBusiness.marketplaceHealth.activeSellers}</span></p>
                            <p>{t("Active Buyers:", "المشترون النشطون:")} <span className="text-white">{data.ownerBusiness.marketplaceHealth.activeBuyers}</span></p>
                            <p>{t("Listings Sold:", "العروض المباعة:")} <span className="text-white">{data.ownerBusiness.marketplaceHealth.listingsSold}</span></p>
                            <p>{t("Listings Waiting Approval:", "عروض تنتظر الموافقة:")} <span className="text-white">{data.ownerBusiness.marketplaceHealth.listingsWaitingApproval}</span></p>
                          </CardContent>
                        </Card>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>{t("Financial Overview", "الملخص المالي")}</CardTitle>
                            <CardDescription>{t("Commission and trade-value performance snapshot.", "ملخص أداء العمولات وقيمة الصفقات.")}</CardDescription>
                          </CardHeader>
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2 xl:grid-cols-2">
                            <p>{t("Commission Today:", "عمولة اليوم:")} <span className="text-white">{formatCurrency(data.ownerBusiness.financialOverview.estimatedCommissionToday)}</span></p>
                            <p>{t("Commission This Week:", "عمولة الأسبوع:")} <span className="text-white">{formatCurrency(data.ownerBusiness.financialOverview.estimatedCommissionThisWeek)}</span></p>
                            <p>{t("Commission This Month:", "عمولة الشهر:")} <span className="text-white">{formatCurrency(data.ownerBusiness.financialOverview.estimatedCommissionThisMonth)}</span></p>
                            <p>{t("Largest Trade:", "أكبر صفقة:")} <span className="text-white">{formatUsdt(data.ownerBusiness.financialOverview.largestTradeUsdt)}</span></p>
                            <p>{t("Largest Trade ID:", "رقم أكبر صفقة:")} <span className="font-mono font-medium text-white">{replaceExchangeEntityIds(data.ownerBusiness.financialOverview.largestTradeId, displayLookup)}</span></p>
                            <p>{t("Largest Seller:", "صاحب أكبر صفقة:")} <span className="text-white">{data.ownerBusiness.financialOverview.largestSeller}</span></p>
                            <p>{t("Average Trade Size:", "متوسط حجم الصفقة:")} <span className="text-white">{formatUsdt(data.ownerBusiness.financialOverview.averageTradeSizeUsdt)}</span></p>
                          </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>{t("Live Activity", "النشاط المباشر")}</CardTitle>
                            <CardDescription>{t("Recent marketplace events for owner oversight.", "أحدث أحداث السوق لمتابعة المالك.")}</CardDescription>
                          </CardHeader>
                          <CardContent className="max-h-[360px] space-y-2 overflow-y-auto text-sm text-[#D1D5DB]">
                            {data.ownerBusiness.liveActivity.slice(0, 10).map((entry) => (
                              <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                                <p className="text-white">{replaceExchangeEntityIds(liveActivityMessage(entry), displayLookup)}</p>
                                <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">
                                  {liveActivityTypeLabel(entry.type)} • {formatDate(entry.createdAt)}
                                </p>
                              </div>
                            ))}
                            {!data.ownerBusiness.liveActivity.length ? <p className="text-[#9CA3AF]">{t("No recent activity.", "لا يوجد نشاط حديث.")}</p> : null}
                          </CardContent>
                        </Card>
                      </div>

                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle>{t("Trust Engine", "نظام الثقة")}</CardTitle>
                          <CardDescription>
                            {t(`Marketplace trust average: ${data.trustEngine.marketplaceHealth.averageTrustScore}/100 across ${data.trustEngine.marketplaceHealth.sellerCount} sellers.`, `متوسط ثقة السوق: ${data.trustEngine.marketplaceHealth.averageTrustScore}/100 لدى ${data.trustEngine.marketplaceHealth.sellerCount} من البائعين.`)}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{t("Highest Trust Sellers", "البائعون الأعلى ثقة")}</p>
                            <div className="mt-3 space-y-2 text-sm text-[#D1D5DB]">
                              {data.trustEngine.highestTrustSellers.slice(0, 5).map((seller) => (
                                <p key={seller.sellerId}>
                                  <span className="text-white">{seller.sellerName}</span> — {seller.trustScore}/100
                                </p>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{t("Accounts Losing Trust", "حسابات تنخفض ثقتها")}</p>
                            <div className="mt-3 space-y-2 text-sm text-[#D1D5DB]">
                              {data.trustEngine.accountsLosingTrust.length ? data.trustEngine.accountsLosingTrust.slice(0, 5).map((seller) => (
                                <p key={seller.sellerId}>
                                  <span className="text-white">{seller.sellerName}</span> — {seller.trustDelta.toFixed(1)}
                                </p>
                              )) : <p className="text-[#9CA3AF]">{t("No trust decline detected.", "لم يتم رصد انخفاض في الثقة.")}</p>}
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{t("Flagged Sellers", "البائعون المبلّغ عنهم")}</p>
                            <div className="mt-3 space-y-2 text-sm text-[#D1D5DB]">
                              {data.trustEngine.flaggedSellers.length ? data.trustEngine.flaggedSellers.slice(0, 5).map((seller) => (
                                <p key={seller.sellerId}>
                                  <span className="text-white">{seller.sellerName}</span> — {trustFlagReasonLabelForLocale(seller.reason, locale)}
                                </p>
                              )) : <p className="text-[#9CA3AF]">{t("No sellers currently flagged.", "لا يوجد بائعون مبلّغ عنهم حاليًا.")}</p>}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ) : null}

                  {activeSection === "seller-applications" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>{t("Seller Applications", "طلبات البائعين")}</CardTitle>
                        <CardDescription>{t("Review, approve, or reject seller applications.", "راجع طلبات البائعين ثم وافق عليها أو ارفضها.")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="ps-9" placeholder={t("Search applicant, email, WhatsApp...", "ابحث بالاسم أو البريد أو WhatsApp...")} value={applicationsQuery} onChange={(event) => setApplicationsQuery(event.target.value)} />
                          </div>
                          <select value={applicationsStatus} onChange={(event) => setApplicationsStatus(event.target.value as typeof applicationsStatus)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">{t("Status: All", "الحالة: الكل")}</option>
                            <option value="pending">{t("Pending", "قيد الانتظار")}</option>
                            <option value="approved">{t("Approved", "مقبول")}</option>
                            <option value="rejected">{t("Rejected", "مرفوض")}</option>
                          </select>
                          <select value={applicationsSort} onChange={(event) => setApplicationsSort(event.target.value as typeof applicationsSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">{t("Sort: Newest", "الترتيب: الأحدث")}</option>
                            <option value="oldest">{t("Sort: Oldest", "الترتيب: الأقدم")}</option>
                            <option value="name">{t("Sort: Name", "الترتيب: الاسم")}</option>
                          </select>
                        </div>

                        {adminDestination.sellerApplicationId && unavailableDeepLinkMessage ? (
                          <p role="status" className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                            {unavailableDeepLinkMessage}
                          </p>
                        ) : null}

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[900px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">{t("Applicant", "مقدّم الطلب")}</th>
                                <th className="px-4 py-3">{t("WhatsApp", "واتساب")}</th>
                                <th className="px-4 py-3">{t("Selling Methods", "طرق البيع")}</th>
                                <th className="px-4 py-3">{t("Submitted Date", "تاريخ التقديم")}</th>
                                <th className="px-4 py-3">{t("Status", "الحالة")}</th>
                                <th className="px-4 py-3">{t("Actions", "الإجراءات")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {applicationsRows.rows.map((application) => (
                                <tr
                                  key={application.id}
                                  id={`seller-application-${application.id}`}
                                  ref={adminDestination.sellerApplicationId === application.id ? setSellerApplicationRow : undefined}
                                  tabIndex={-1}
                                  className={`border-t border-white/10 ${adminDestination.sellerApplicationId === application.id ? "bg-[#C9A227]/10 outline outline-1 outline-[#C9A227]/45" : ""}`}
                                >
                                  <td className="px-4 py-3">
                                    <p className="font-medium text-white">{application.fullName}</p>
                                    <p className="text-xs text-[#9CA3AF]">{application.email}</p>
                                  </td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{application.whatsappNumber}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{application.preferredNetworks.join(", ")}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(application.createdAt)}</td>
                                  <td className="px-4 py-3">
                                    <span className={`rounded-full px-2.5 py-1 text-xs ${application.status === "approved" ? "border border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : application.status === "rejected" ? "border border-red-500/35 bg-red-500/10 text-red-300" : "border border-[#C9A227]/35 bg-[#C9A227]/10 text-[#C9A227]"}`}>
                                      {application.status === "approved" ? t("Approved", "مقبول") : application.status === "rejected" ? t("Rejected", "مرفوض") : t("Pending", "قيد الانتظار")}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        disabled={application.status !== "pending"}
                                        onClick={() => {
                                          if (!window.confirm(t("Approve this seller application?", "هل تريد قبول طلب هذا البائع؟"))) return;
                                          const reason = requestReason(t("Reason for approving this seller application:", "سبب قبول طلب البائع:"), t("Seller approved for launch", "تم اعتماد البائع للعمل"));
                                          if (!reason) return;
                                          void runAction(fetch(`/api/alpha-exchange/admin/seller-applications/${application.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), t("Application approved.", "تم قبول الطلب."));
                                        }}
                                      >
                                        {t("Approve", "قبول")}
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        disabled={application.status !== "pending"}
                                        onClick={() => {
                                          if (!window.confirm(t("Reject this seller application?", "هل تريد رفض طلب هذا البائع؟"))) return;
                                          const reason = requestReason(t("Reason for rejecting this seller application:", "سبب رفض طلب البائع:"), t("Application rejected", "تم رفض الطلب"));
                                          if (!reason) return;
                                          void runAction(fetch(`/api/alpha-exchange/admin/seller-applications/${application.id}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), t("Application rejected.", "تم رفض الطلب."));
                                        }}
                                      >
                                        {t("Reject", "رفض")}
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {applicationsRows.rows.length === 0 ? renderEmptyTableRow(t("No seller applications match your filters.", "لا توجد طلبات بائعين تطابق الفلاتر."), 6) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(applicationsRows.safePage, applicationsRows.totalPages, setApplicationsPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "approved-sellers" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>{t("Approved Sellers", "البائعون المعتمدون")}</CardTitle>
                        <CardDescription>{t("Manage approved seller status and monitor activity.", "إدارة حالة البائعين المعتمدين ومتابعة نشاطهم.")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="ps-9" placeholder={t("Search seller...", "ابحث عن بائع...")} value={sellersQuery} onChange={(event) => setSellersQuery(event.target.value)} />
                          </div>
                          <select value={sellersStatus} onChange={(event) => setSellersStatus(event.target.value as typeof sellersStatus)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">{t("Status: All", "الحالة: الكل")}</option>
                            <option value="approved_seller">{t("Approved", "معتمد")}</option>
                            <option value="suspended">{t("Suspended", "موقوف")}</option>
                          </select>
                          <select value={sellersSort} onChange={(event) => setSellersSort(event.target.value as typeof sellersSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">{t("Sort: Newest", "الترتيب: الأحدث")}</option>
                            <option value="oldest">{t("Sort: Oldest", "الترتيب: الأقدم")}</option>
                            <option value="name">{t("Sort: Name", "الترتيب: الاسم")}</option>
                          </select>
                        </div>

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[980px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">{t("Seller", "البائع")}</th>
                                <th className="px-4 py-3">{t("Member Since", "عضو منذ")}</th>
                                <th className="px-4 py-3">{t("Prestige Rank", "الرتبة")}</th>
                                <th className="px-4 py-3">{t("Lifetime Volume", "إجمالي الحجم")}</th>
                                <th className="px-4 py-3">{t("Active Listings", "العروض النشطة")}</th>
                                <th className="px-4 py-3">{t("Completed Trades", "الصفقات المكتملة")}</th>
                                <th className="px-4 py-3">{t("Current Status", "الحالة الحالية")}</th>
                                <th className="px-4 py-3">{t("Actions", "الإجراءات")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sellersRows.rows.map((seller) => {
                                const activeListings = (data.listings ?? []).filter((listing) => listing.sellerId === seller.id && (listing.status === "active" || listing.status === "matched" || listing.status === "in_trade")).length;
                                const completedTrades = (data.purchaseRequests ?? []).filter((request) => request.sellerId === seller.id && (request.status === "review_open" || Boolean(request.completedAt))).length;
                                const isSuspended = seller.sellerStatus === "suspended";
                                const isOnVacation = seller.availabilityStatus === "vacation";
                                return (
                                  <tr key={seller.id} className="border-t border-white/10">
                                    <td className="px-4 py-3">
                                      <p className="font-medium text-white">{seller.fullName}</p>
                                      <p className="text-xs text-[#9CA3AF]">{seller.email}</p>
                                      <div className="mt-2">
                                        <div className="flex flex-wrap gap-2">
                                          {Array.from(
                                            new Set(
                                              [
                                                (seller.roles ?? []).includes("owner") ? "owner" : null,
                                                (seller.roles ?? []).includes("admin") || seller.role === "admin" ? "administrator" : null,
                                                seller.sellerStatus === "approved_seller" || (seller.roles ?? []).includes("approved_seller") ? "approved_seller" : null,
                                                seller.sellerStatus === "pending_seller_approval" || (seller.roles ?? []).includes("pending_seller_approval") ? "pending_seller" : null,
                                                (seller.roles ?? []).includes("buyer") || seller.role === "buyer" ? "buyer" : null,
                                                (seller.roles ?? []).includes("student") ? "student" : null,
                                                (seller.roles ?? []).includes("guest") ? "guest" : null,
                                              ].filter(Boolean),
                                            ),
                                          ).map((badge) => (
                                            <RoleBadge key={badge} locale={locale} variant={badge as "guest" | "student" | "buyer" | "pending_seller" | "approved_seller" | "administrator" | "owner"} />
                                          ))}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(seller.createdAt)}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">
                                      <span className="font-medium capitalize text-white">{sellerLevelLabel(seller.sellerPrestigeRank)}</span>
                                      {seller.sellerRankOverride ? <p className="text-[11px] text-[#FDE68A]">{t("Override active", "تعديل يدوي نشط")}</p> : null}
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatUsdt(Math.max(0, Number(seller.lifetimeCompletedVolumeUsdt ?? 0)))}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{activeListings}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{completedTrades}</td>
                                    <td className="px-4 py-3">
                                      {isSuspended ? (
                                        <span className="rounded-full border border-red-500/35 bg-red-500/10 px-2.5 py-1 text-xs text-red-300">{t("Suspended", "موقوف")}</span>
                                      ) : (
                                        <div className="flex flex-wrap gap-2">
                                          <RoleBadge variant="approved_seller" locale={locale} />
                                          <span className={`rounded-full px-2.5 py-1 text-xs ${isOnVacation ? "border border-amber-500/35 bg-amber-500/10 text-amber-300" : "border border-emerald-500/35 bg-emerald-500/10 text-emerald-300"}`}>
                                            {isOnVacation ? t("Vacation", "إجازة") : seller.availabilityStatus === "away" ? t("Away", "غير متاح مؤقتًا") : t("Available", "متاح")}
                                          </span>
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        {!isSuspended ? (
                                          <Button type="button" size="sm" variant="secondary" onClick={() => {
                                            if (!window.confirm(t("Suspend this seller?", "هل تريد إيقاف هذا البائع؟"))) return;
                                            const reason = requestReason(t("Reason for suspending this seller:", "سبب إيقاف البائع:"), t("Seller suspended", "تم إيقاف البائع"));
                                            if (!reason) return;
                                            void runAction(fetch(`/api/alpha-exchange/admin/sellers/${seller.id}/suspend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), t("Seller suspended.", "تم إيقاف البائع."));
                                          }}>
                                            {t("Suspend", "إيقاف")}
                                          </Button>
                                        ) : (
                                          <Button type="button" size="sm" onClick={() => {
                                            if (!window.confirm(t("Reactivate this seller?", "هل تريد إعادة تفعيل هذا البائع؟"))) return;
                                            const reason = requestReason(t("Reason for reactivating this seller:", "سبب إعادة تفعيل البائع:"), t("Seller reactivated", "تمت إعادة تفعيل البائع"));
                                            if (!reason) return;
                                            void runAction(fetch(`/api/alpha-exchange/admin/sellers/${seller.id}/reactivate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), t("Seller reactivated.", "تمت إعادة تفعيل البائع."));
                                          }}>
                                            {t("Reactivate", "إعادة التفعيل")}
                                          </Button>
                                        )}
                                        {isOnVacation ? (
                                          <Button type="button" size="sm" variant="secondary" onClick={() => {
                                            if (!window.confirm(t("End vacation mode for this seller?", "هل تريد إنهاء وضع الإجازة لهذا البائع؟"))) return;
                                            const reason = requestReason(t("Reason for ending vacation mode:", "سبب إنهاء وضع الإجازة:"), t("Vacation Mode ended.", "تم إنهاء وضع الإجازة."));
                                            if (!reason) return;
                                            void handleSellerAvailabilityStatus(seller.id, "available", t("Vacation Mode ended.", "تم إنهاء وضع الإجازة."), reason);
                                          }}>
                                            {t("End Vacation", "إنهاء الإجازة")}
                                          </Button>
                                        ) : (
                                          <Button type="button" size="sm" variant="secondary" onClick={() => {
                                            if (!window.confirm(t("Enable vacation mode for this seller?", "هل تريد تفعيل وضع الإجازة لهذا البائع؟"))) return;
                                            const reason = requestReason(t("Reason for enabling vacation mode:", "سبب تفعيل وضع الإجازة:"), t("Vacation Mode enabled.", "تم تفعيل وضع الإجازة."));
                                            if (!reason) return;
                                            void handleSellerAvailabilityStatus(seller.id, "vacation", t("Vacation Mode enabled.", "تم تفعيل وضع الإجازة."), reason);
                                          }}>
                                            {t("Enable Vacation", "تفعيل الإجازة")}
                                          </Button>
                                        )}
                                        <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedSeller(seller)}>
                                          {t("View Profile", "عرض الملف")}
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => {
                                            const nextRank = window.prompt(t("Set rank (bronze, silver, gold, diamond, elite)", "حدّد الرتبة (bronze, silver, gold, diamond, elite)"), seller.sellerPrestigeRank ?? "bronze");
                                            if (!nextRank) return;
                                            const rankInput = normalizeSellerLevel(nextRank);
                                            if (!rankInput) {
                                              pushToast(t("Invalid prestige rank.", "الرتبة غير صحيحة."));
                                              return;
                                            }
                                            const reason = window.prompt(t("Override reason", "سبب التعديل"), t("Manual admin override", "تعديل يدوي من الإدارة"));
                                            if (!reason) return;
                                            void handleSellerPrestigeOverride(seller.id, rankInput, reason, false);
                                          }}
                                        >
                                          {t("Override Rank", "تعديل الرتبة")}
                                        </Button>
                                        {seller.sellerRankOverride ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              const reason = window.prompt(t("Reason for clearing override", "سبب إزالة التعديل"), t("Return to automatic progression", "العودة إلى التقدّم التلقائي"));
                                              if (!reason) return;
                                              void handleSellerPrestigeOverride(seller.id, seller.sellerPrestigeRank ?? "bronze", reason, true);
                                            }}
                                          >
                                            {t("Clear Override", "إزالة التعديل")}
                                          </Button>
                                        ) : null}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                              {sellersRows.rows.length === 0 ? renderEmptyTableRow(t("No approved sellers match your filters.", "لا يوجد بائعون معتمدون يطابقون الفلاتر."), 8) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(sellersRows.safePage, sellersRows.totalPages, setSellersPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "seller-rank" ? (
                    <div className="space-y-4">
                      {/* Rank Distribution Summary */}
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        {SELLER_LEVELS.map((rank) => {
                          const count = (data?.approvedSellers ?? []).filter((s) => (s.sellerPrestigeRank ?? "bronze") === rank).length;
                          const rankColors: Record<SellerLevel, string> = {
                            bronze: "border-[#CD7F32]/30 bg-[#CD7F32]/10 text-[#E8A96A]",
                            silver: "border-[#C0C0C0]/30 bg-[#C0C0C0]/10 text-[#C9CED9]",
                            gold: "border-[#C9A227]/30 bg-[#C9A227]/10 text-[#FDE68A]",
                            diamond: "border-[#7CC9FF]/30 bg-[#7CC9FF]/10 text-[#7CC9FF]",
                            elite: "border-[#F8E7A0]/30 bg-[#F8E7A0]/10 text-[#F8E7A0]",
                          };
                          return (
                            <button
                              key={rank}
                              type="button"
                              onClick={() => setRankMgmtFilter(rankMgmtFilter === rank ? "all" : rank)}
                              className={`rounded-xl border p-3 text-center transition hover:opacity-80 ${rankColors[rank]} ${rankMgmtFilter === rank ? "ring-1 ring-white/30" : ""}`}
                            >
                              <p className="text-xl font-bold">{count}</p>
                              <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] capitalize">{sellerLevelLabel(rank)}</p>
                            </button>
                          );
                        })}
                      </div>

                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Trophy className="h-5 w-5 text-[#C9A227]" />
                            {t("Seller Rank Management", "إدارة رتب البائعين")}
                          </CardTitle>
                          <CardDescription>
                            {t("Manage seller prestige ranks directly. Changes are saved immediately and written to the audit log. Owner accounts are protected and cannot be modified.", "أدر رتب البائعين مباشرة. تُحفظ التغييرات فورًا في سجل النشاط، وحسابات المالك محمية ولا يمكن تعديلها.")}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {/* Filters */}
                          <div className="grid gap-3 md:grid-cols-3">
                            <div className="relative md:col-span-2">
                              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                              <input
                                type="text"
                                className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] ps-9 pe-3 text-sm text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#C9A227]/50"
                                placeholder={t("Search seller by name or email...", "ابحث باسم البائع أو بريده...")}
                                value={rankMgmtSearch}
                                onChange={(e) => setRankMgmtSearch(e.target.value)}
                              />
                            </div>
                            <select
                              value={rankMgmtFilter}
                              onChange={(e) => setRankMgmtFilter(e.target.value as typeof rankMgmtFilter)}
                              className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white"
                            >
                              <option value="all">{t("Filter: All Ranks", "الفلتر: كل الرتب")}</option>
                              {SELLER_LEVELS.map((rank) => <option key={rank} value={rank}>{sellerLevelLabel(rank)}</option>)}
                            </select>
                          </div>

                          {/* Bulk Actions */}
                          {rankMgmtSelected.size > 0 ? (
                            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#C9A227]/25 bg-[#C9A227]/8 p-3">
                              <span className="text-sm font-medium text-[#FDE68A]">{t(`${rankMgmtSelected.size} selected`, `تم اختيار ${rankMgmtSelected.size}`)}</span>
                              <div className="ml-auto flex flex-wrap gap-2">
                                <Button type="button" size="sm" variant="secondary" onClick={() => void handleBulkRankAction("promote")}>
                                  {t("Promote", "ترقية")} ↑
                                </Button>
                                <Button type="button" size="sm" variant="secondary" onClick={() => void handleBulkRankAction("demote")}>
                                  {t("Demote", "خفض الرتبة")} ↓
                                </Button>
                                <Button type="button" size="sm" variant="secondary" onClick={() => void handleBulkRankAction("reset")}>
                                  {t("Reset to Bronze", "إعادة إلى برونزي")}
                                </Button>
                                <div className="flex items-center gap-1.5">
                                  <select
                                    value={rankMgmtBulkRank}
                                    onChange={(e) => setRankMgmtBulkRank(e.target.value as SellerLevel)}
                                    className="h-8 rounded-lg border border-white/15 bg-[#101010] px-2 text-xs text-white"
                                  >
                                    {SELLER_LEVELS.map((rank) => <option key={rank} value={rank}>{sellerLevelLabel(rank)}</option>)}
                                  </select>
                                  <Button type="button" size="sm" onClick={() => void handleBulkRankAction("set", rankMgmtBulkRank)}>
                                    {t("Set Rank", "تعيين الرتبة")}
                                  </Button>
                                </div>
                                <Button type="button" size="sm" variant="secondary" onClick={() => setRankMgmtSelected(new Set())}>
                                  {t("Clear", "إلغاء الاختيار")}
                                </Button>
                              </div>
                            </div>
                          ) : null}

                          {/* Table */}
                          <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full min-w-[900px] text-sm">
                              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                                <tr>
                                  <th className="w-10 px-4 py-3">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-white/30 bg-transparent accent-[#C9A227]"
                                      checked={rankMgmtSelected.size > 0 && rankMgmtRows.filter((s) => !(s.roles ?? []).includes("owner") && s.role !== "owner").every((s) => rankMgmtSelected.has(s.id))}
                                      onChange={(e) => {
                                        const eligibleIds = rankMgmtRows.filter((s) => !(s.roles ?? []).includes("owner") && s.role !== "owner").map((s) => s.id);
                                        setRankMgmtSelected(e.target.checked ? new Set(eligibleIds) : new Set());
                                      }}
                                    />
                                  </th>
                                  <th className="px-4 py-3">{t("Seller", "البائع")}</th>
                                  <th className="px-4 py-3">{t("Current Rank", "الرتبة الحالية")}</th>
                                  <th className="px-4 py-3">{t("Trust Score", "درجة الثقة")}</th>
                                  <th className="px-4 py-3">{t("Volume (USDT)", "الحجم (USDT)")}</th>
                                  <th className="px-4 py-3">{t("Status", "الحالة")}</th>
                                  <th className="px-4 py-3">{t("Set New Rank", "تعيين رتبة جديدة")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rankMgmtRows.map((seller) => {
                                  const isOwner = (seller.roles ?? []).includes("owner") || seller.role === "owner";
                                  const currentRank: SellerLevel = seller.sellerPrestigeRank ?? "bronze";
                                  const isSaving = rankMgmtSaving.has(seller.id);
                                  const trustScore = trustScoreMap.get(seller.id);
                                  return (
                                    <tr key={seller.id} className={`border-t border-white/10 transition ${rankMgmtSelected.has(seller.id) ? "bg-white/[0.025]" : ""}`}>
                                      <td className="px-4 py-3">
                                        <input
                                          type="checkbox"
                                          disabled={isOwner}
                                          className="h-4 w-4 rounded border-white/30 bg-transparent accent-[#C9A227] disabled:opacity-30"
                                          checked={rankMgmtSelected.has(seller.id)}
                                          onChange={(e) => {
                                            setRankMgmtSelected((prev) => {
                                              const next = new Set(prev);
                                              if (e.target.checked) next.add(seller.id);
                                              else next.delete(seller.id);
                                              return next;
                                            });
                                          }}
                                        />
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="flex items-center gap-2.5">
                                          <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-white">
                                            {String(seller.fullName || seller.email || "?")
                                              .trim()
                                              .split(" ")
                                              .map((p) => p[0])
                                              .join("")
                                              .slice(0, 2)
                                              .toUpperCase()}
                                          </div>
                                          <div>
                                            <p className="font-medium text-white">{seller.fullName || "—"}</p>
                                            <p className="text-[11px] text-[#9CA3AF]">{seller.email}</p>
                                            {isOwner ? <span className="mt-0.5 inline-block rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300">{t("Owner — Protected", "المالك — محمي")}</span> : null}
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="space-y-1">
                                          <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] ${RANK_BADGE_COLOR[currentRank]}`}>
                                            {sellerLevelLabel(currentRank)} {t("Seller", "")}
                                          </span>
                                          {seller.sellerRankOverride ? (
                                            <p className="text-[10px] text-[#FDE68A]">⚡ {t("Override active", "تعديل يدوي نشط")}</p>
                                          ) : null}
                                        </div>
                                      </td>
                                      <td className="px-4 py-3 text-[#D1D5DB]">
                                        {trustScore !== undefined ? (
                                          <span className={trustScore >= 70 ? "text-emerald-300" : trustScore >= 40 ? "text-amber-300" : "text-red-300"}>
                                            {trustScore.toFixed(1)}/100
                                          </span>
                                        ) : <span className="text-[#9CA3AF]">—</span>}
                                      </td>
                                      <td className="px-4 py-3 text-[#D1D5DB]">
                                        {Math.max(0, Number(seller.lifetimeCompletedVolumeUsdt ?? 0)).toLocaleString("en-IL")}
                                      </td>
                                      <td className="px-4 py-3">
                                        {seller.sellerStatus === "suspended" ? (
                                          <span className="rounded-full border border-red-500/35 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300">{t("Suspended", "موقوف")}</span>
                                        ) : (
                                          <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">{t("Active", "نشط")}</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        {isOwner ? (
                                          <span className="text-xs text-[#9CA3AF]">{t("Protected", "محمي")}</span>
                                        ) : (
                                          <div className="flex items-center gap-2">
                                            <select
                                              disabled={isSaving}
                                              value={currentRank}
                                              onChange={(e) => handleRankMgmtChange(seller.id, e.target.value as SellerLevel)}
                                              className="h-9 rounded-lg border border-white/15 bg-[#101010] px-2 text-xs text-white disabled:opacity-50"
                                            >
                                              {SELLER_LEVELS.map((rank) => <option key={rank} value={rank}>{sellerLevelLabel(rank)}</option>)}
                                            </select>
                                            {isSaving ? (
                                              <span className="text-[11px] text-[#9CA3AF]">{t("Saving…", "جارٍ الحفظ...")}</span>
                                            ) : null}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {rankMgmtRows.length === 0 ? (
                                  <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-[#9CA3AF]">
                                      {t("No sellers match your filters.", "لا يوجد بائعون يطابقون الفلاتر.")}
                                    </td>
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>

                          {/* Rank change legend */}
                          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">{t("Rank hierarchy (lowest → highest)", "ترتيب الرتب (من الأدنى إلى الأعلى)")}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {SELLER_LEVELS.map((rank, idx) => {
                                const colors: Record<SellerLevel, string> = {
                                  bronze: "border-[#CD7F32]/30 text-[#E8A96A]",
                                  silver: "border-[#C0C0C0]/30 text-[#C9CED9]",
                                  gold: "border-[#C9A227]/30 text-[#FDE68A]",
                                  diamond: "border-[#7CC9FF]/30 text-[#7CC9FF]",
                                  elite: "border-[#F8E7A0]/30 text-[#F8E7A0]",
                                };
                                const volumes: Record<SellerLevel, string> = { bronze: "0 USDT", silver: "15K+", gold: "50K+", diamond: "150K+", elite: "500K+" };
                                return (
                                  <span key={rank} className={`rounded-full border px-2.5 py-1 text-[11px] ${colors[rank]}`}>
                                    {idx + 1}. {sellerLevelLabel(rank)} · {volumes[rank]}
                                  </span>
                                );
                              })}
                            </div>
                            <p className="mt-2 text-[11px] text-[#9CA3AF]">
                              {t("Every rank change shows a confirmation dialog before saving. You can optionally add a reason — it is written to the audit log alongside the admin, seller, previous rank, new rank, and timestamp.", "يظهر تأكيد قبل حفظ كل تغيير رتبة. ويمكن إضافة سبب يُسجّل مع المدير والبائع والرتبتين القديمة والجديدة والوقت.")}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ) : null}

                  {activeSection === "marketplace-listings" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>{t("Marketplace Listings", "عروض السوق")}</CardTitle>
                        <CardDescription>{t("Manage listing availability and listing details.", "راجع العروض ووافق عليها وأدر حالتها وتفاصيلها.")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-5">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="ps-9" placeholder={t("Search seller, amount, price...", "ابحث بالبائع أو الكمية أو السعر...")} value={listingsQuery} onChange={(event) => setListingsQuery(event.target.value)} />
                          </div>
                          <select value={listingsStatus} onChange={(event) => setListingsStatus(event.target.value as typeof listingsStatus)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">{t("Status: All", "الحالة: الكل")}</option>
                            {(["draft", "active", "paused", "matched", "in_trade", "expired", "completed", "cancelled", "closed"] as const).map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                          </select>
                          <select value={listingsNetwork} onChange={(event) => setListingsNetwork(event.target.value as typeof listingsNetwork)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">{t("Network: All", "الشبكة: الكل")}</option>
                            <option value="TRC20">TRC20</option>
                            <option value="ERC20">ERC20</option>
                            <option value="BEP20">BEP20</option>
                            <option value="SOL">SOL</option>
                          </select>
                          <select value={listingsSort} onChange={(event) => setListingsSort(event.target.value as typeof listingsSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">{t("Sort: Newest", "الترتيب: الأحدث")}</option>
                            <option value="price-asc">{t("Price: Low to High", "السعر: من الأقل للأعلى")}</option>
                            <option value="price-desc">{t("Price: High to Low", "السعر: من الأعلى للأقل")}</option>
                            <option value="amount-desc">{t("Amount: High to Low", "الكمية: من الأعلى للأقل")}</option>
                          </select>
                        </div>

                        {adminDestination.listingId && unavailableDeepLinkMessage ? (
                          <p role="status" className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                            {unavailableDeepLinkMessage}
                          </p>
                        ) : null}

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[1240px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">{t("Seller", "البائع")}</th>
                                <th className="px-4 py-3">{t("Amount", "الكمية")}</th>
                                <th className="px-4 py-3">{t("Price", "السعر")}</th>
                                <th className="px-4 py-3">{t("Network", "الشبكة")}</th>
                                <th className="px-4 py-3">{t("Bank", "البنك")}</th>
                                <th className="px-4 py-3">{t("Status", "الحالة")}</th>
                                <th className="px-4 py-3">{t("Expiration", "انتهاء الصلاحية")}</th>
                                <th className="px-4 py-3">{t("Created", "تاريخ الإنشاء")}</th>
                                <th className="px-4 py-3">{t("Actions", "الإجراءات")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {listingsRows.rows.map((listing) => (
                                <tr
                                  key={listing.id}
                                  id={`marketplace-listing-${listing.id}`}
                                  ref={adminDestination.listingId === listing.id ? setMarketplaceListingRow : undefined}
                                  tabIndex={-1}
                                  className={`border-t border-white/10 ${adminDestination.listingId === listing.id ? "bg-[#C9A227]/10 outline outline-1 outline-[#C9A227]/45" : ""}`}
                                >
                                  <td className="px-4 py-3 text-white">{listing.sellerDisplayName}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{listing.availableAmount}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{listing.price}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{listing.network}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{listing.bankName ?? "—"}</td>
                                  <td className="px-4 py-3">
                                    <span className={`rounded-full px-2.5 py-1 text-xs ${listing.status === "active" ? "border border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : listing.status === "draft" ? "border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 text-[#93C5FD]" : listing.status === "matched" || listing.status === "in_trade" ? "border border-amber-500/35 bg-amber-500/10 text-amber-300" : listing.status === "completed" ? "border border-violet-500/35 bg-violet-500/10 text-violet-300" : listing.status === "cancelled" ? "border border-red-500/35 bg-red-500/10 text-red-300" : listing.status === "paused" ? "border border-[#C9A227]/35 bg-[#C9A227]/10 text-[#C9A227]" : "border border-white/20 bg-white/5 text-white/75"}`}>
                                      {statusLabel(listing.status)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-xs text-[#D1D5DB]">
                                    <p>{listing.expiresAt ? formatDate(listing.expiresAt) : "—"}</p>
                                    {listing.lastRenewedAt ? <p className="text-[11px] text-[#9CA3AF]">{t("Renewed", "تم التجديد")} {formatDate(listing.lastRenewedAt)}</p> : null}
                                    {listing.expiredAt ? <p className="text-[11px] text-amber-300">{t("Expired", "انتهى")} {formatDate(listing.expiredAt)}</p> : null}
                                  </td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(listing.createdAt)}</td>
                                  <td className="px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {listing.status === "draft" ? (
                                        <>
                                          <Button type="button" size="sm" onClick={() => runAction(fetch(`/api/alpha-exchange/admin/listings/${listing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve" }) }), t("Listing approved.", "تمت الموافقة على العرض."))}>
                                            {t("Approve", "موافقة")}
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              const reason = window.prompt(t("Reject reason", "سبب الرفض"));
                                              if (!reason) return;
                                              void runAction(
                                                fetch(`/api/alpha-exchange/admin/listings/${listing.id}`, {
                                                  method: "PATCH",
                                                  headers: { "content-type": "application/json" },
                                                  body: JSON.stringify({ action: "reject", reason }),
                                                }),
                                                t("Listing rejected.", "تم رفض العرض."),
                                              );
                                            }}
                                          >
                                            {t("Reject", "رفض")}
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              const reason = window.prompt(t("Change request", "التعديلات المطلوبة"));
                                              if (!reason) return;
                                              void runAction(
                                                fetch(`/api/alpha-exchange/admin/listings/${listing.id}`, {
                                                  method: "PATCH",
                                                  headers: { "content-type": "application/json" },
                                                  body: JSON.stringify({ action: "request_changes", reason }),
                                                }),
                                                t("Changes requested.", "تم طلب التعديلات."),
                                              );
                                            }}
                                          >
                                            {t("Request Changes", "طلب تعديلات")}
                                          </Button>
                                        </>
                                      ) : null}
                                      {(listing.status === "expired" || listing.status === "paused" || listing.status === "closed") ? (
                                        <Button type="button" size="sm" variant="secondary" onClick={() => {
                                          if (!window.confirm(t(`${listing.status === "closed" ? "Reopen" : "Renew"} this listing?`, `هل تريد ${listing.status === "closed" ? "إعادة فتح" : "تجديد"} هذا العرض؟`))) return;
                                          const reason = requestReason(t(`Reason for ${listing.status === "closed" ? "reopening" : "renewing"} this listing:`, `سبب ${listing.status === "closed" ? "إعادة فتح" : "تجديد"} العرض:`), listing.status === "closed" ? t("Listing reopened by admin.", "أعادت الإدارة فتح العرض.") : t("Listing renewed by admin.", "جدّدت الإدارة العرض."));
                                          if (!reason) return;
                                          void handleAdminListingAction(listing.id, "renew", listing.status === "closed" ? t("Listing reopened by admin.", "تمت إعادة فتح العرض.") : t("Listing renewed by admin.", "تم تجديد العرض."), 24, reason);
                                        }}>
                                          {listing.status === "closed" ? t("Reopen", "إعادة الفتح") : t("Renew", "تجديد")}
                                        </Button>
                                      ) : null}
                                      {listing.status !== "completed" && listing.status !== "cancelled" && listing.status !== "closed" ? (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => {
                                            if (!window.confirm(t("Extend this listing expiration?", "هل تريد تمديد صلاحية هذا العرض؟"))) return;
                                            const hours = window.prompt(t("Extend expiration by hours (1, 6, 12, 24)", "مدة التمديد بالساعات (1، 6، 12، 24)"), "24");
                                            if (!hours) return;
                                            const reason = requestReason(t("Reason for extending this listing:", "سبب تمديد العرض:"), t("Listing expiration extended.", "تم تمديد صلاحية العرض."));
                                            if (!reason) return;
                                            void handleAdminListingAction(listing.id, "extend", t("Listing expiration extended.", "تم تمديد صلاحية العرض."), Number(hours), reason);
                                          }}
                                        >
                                          {t("Extend Expiration", "تمديد الصلاحية")}
                                        </Button>
                                      ) : null}
                                      {listing.status !== "closed" && listing.status !== "completed" && listing.status !== "cancelled" ? (
                                        <Button type="button" size="sm" variant="secondary" onClick={() => {
                                          if (!window.confirm(t("Close this listing?", "هل تريد إغلاق هذا العرض؟"))) return;
                                          const reason = requestReason(t("Reason for closing this listing:", "سبب إغلاق العرض:"), t("Listing closed by admin.", "أغلقت الإدارة العرض."));
                                          if (!reason) return;
                                          void handleAdminListingAction(listing.id, "close", t("Listing closed by admin.", "تم إغلاق العرض."), undefined, reason);
                                        }}>
                                          {t("Close", "إغلاق")}
                                        </Button>
                                      ) : null}
                                      {(listing.status === "matched" || listing.status === "in_trade") ? (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => {
                                            const reason = window.prompt(t("Force-close reason", "سبب الإغلاق الإجباري"), t("Admin override", "إجراء من الإدارة"));
                                            if (!reason) return;
                                            void handleAdminListingAction(listing.id, "force_close", t("Listing force closed.", "تم إغلاق العرض إجباريًا."), undefined, reason);
                                          }}
                                        >
                                          {t("Force Close", "إغلاق إجباري")}
                                        </Button>
                                      ) : null}
                                      <Button type="button" size="sm" variant="secondary" onClick={() => runAction(fetch(`/api/alpha-exchange/admin/listings/${listing.id}`, { method: "DELETE" }), t("Listing deleted.", "تم حذف العرض."))}>
                                        {t("Delete", "حذف")}
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {listingsRows.rows.length === 0 ? renderEmptyTableRow(t("No marketplace listings match your filters.", "لا توجد عروض سوق تطابق الفلاتر."), 9) : null}
                            </tbody>
                          </table>
                        </div>

                        <p className="mt-3 text-xs text-[#9CA3AF]">{t("Owner-only Pending Listings page:", "صفحة العروض المعلّقة للمالك فقط:")} /admin/alpha-exchange/pending-listings</p>
                        <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                          <p className="text-sm font-medium text-white">{t("Expiration History", "سجل انتهاء الصلاحية")}</p>
                          <div className="mt-3 space-y-2 text-xs text-[#D1D5DB]">
                            {expirationHistory.slice(0, 10).map((entry) => (
                              <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="text-white">{actionLabel(entry.action)}</p>
                                <p>{localizedAuditDetails(entry)}</p>
                                <p className="text-[#9CA3AF]">{formatDate(entry.createdAt)}</p>
                              </div>
                            ))}
                            {expirationHistory.length === 0 ? <p className="text-[#9CA3AF]">{t("No expiration events recorded yet.", "لا توجد أحداث انتهاء صلاحية مسجّلة بعد.")}</p> : null}
                          </div>
                        </div>

                        {renderPagination(listingsRows.safePage, listingsRows.totalPages, setListingsPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "listing-reliability" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>{t("Listing Reliability", "موثوقية العروض")}</CardTitle>
                        <CardDescription>
                          {t("Deterministic reliability from real completed trades, cancellations, removals, and edit history. Lower scores rank lower in the marketplace.", "تُحسب الموثوقية من الصفقات المكتملة والإلغاءات والحذف وسجل التعديلات. تظهر الدرجات الأقل في ترتيب أدنى بالسوق.")}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {(() => {
                          const reports = data?.listingReliability ?? [];
                          if (!reports.length) {
                            return <p className="text-sm text-[#9CA3AF]">{t("No seller reliability data available yet.", "لا توجد بيانات موثوقية للبائعين بعد.")}</p>;
                          }
                          const flagged = reports.filter((report) => report.reliability.warningTier !== "none");
                          const tierTone: Record<ListingReliabilityReport["reliability"]["warningTier"], string> = {
                            none: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
                            notice: "border-amber-400/30 bg-amber-400/10 text-amber-200",
                            warning: "border-orange-500/30 bg-orange-500/10 text-orange-200",
                            critical: "border-red-500/40 bg-red-500/10 text-red-200",
                          };
                          return (
                            <>
                              <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{t("Sellers tracked", "البائعون المتابَعون")}</p>
                                  <p className="mt-1 text-2xl font-bold text-white">{reports.length}</p>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{t("Needing attention", "تحتاج متابعة")}</p>
                                  <p className="mt-1 text-2xl font-bold text-amber-200">{flagged.length}</p>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                  <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{t("Avg. reliability", "متوسط الموثوقية")}</p>
                                  <p className="mt-1 text-2xl font-bold text-white">
                                    {Math.round(reports.reduce((sum, report) => sum + report.reliability.reliabilityScore, 0) / reports.length)}
                                  </p>
                                </div>
                              </div>
                              <div className="overflow-x-auto rounded-xl border border-white/10">
                                <table className="w-full min-w-[820px] text-sm">
                                  <thead>
                                    <tr className="border-b border-white/10 bg-white/[0.02] text-left text-xs uppercase tracking-[0.1em] text-[#9CA3AF]">
                                      <th className="px-3 py-2">{t("Seller", "البائع")}</th>
                                      <th className="px-3 py-2">{t("Reliability", "الموثوقية")}</th>
                                      <th className="px-3 py-2">{t("Cancellation %", "نسبة الإلغاء")}</th>
                                      <th className="px-3 py-2">{t("Edit %", "نسبة التعديل")}</th>
                                      <th className="px-3 py-2">{t("Removal %", "نسبة الحذف")}</th>
                                      <th className="px-3 py-2">{t("Avg. lifetime (h)", "متوسط العمر (ساعة)")}</th>
                                      <th className="px-3 py-2">{t("Trades", "الصفقات")}</th>
                                      <th className="px-3 py-2">{t("Status", "الحالة")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {reports.map((report) => (
                                      <tr key={report.sellerId} className="border-b border-white/5 align-top">
                                        <td className="px-3 py-2">
                                          <p className="font-medium text-white">{report.sellerName}</p>
                                          <p className="text-[11px] text-[#9CA3AF]">{t(`${report.totalListings} listings`, `${report.totalListings} عروض`)}</p>
                                        </td>
                                        <td className="px-3 py-2 font-semibold text-white">{report.reliability.reliabilityScore}</td>
                                        <td className="px-3 py-2 text-[#D1D5DB]">{report.reliability.cancellationRate}%</td>
                                        <td className="px-3 py-2 text-[#D1D5DB]">{report.reliability.editRate}%</td>
                                        <td className="px-3 py-2 text-[#D1D5DB]">{report.reliability.removalRate}%</td>
                                        <td className="px-3 py-2 text-[#D1D5DB]">{report.reliability.averageListingLifetimeHours || "—"}</td>
                                        <td className="px-3 py-2 text-[#D1D5DB]">{report.completedTrades}✓ / {report.cancelledTrades}✗</td>
                                        <td className="px-3 py-2">
                                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${tierTone[report.reliability.warningTier]}`}>
                                            {isArabic ? ({ none: "جيد", notice: "ملاحظة", warning: "تحذير", critical: "حرج" } as const)[report.reliability.warningTier] : report.reliability.warningTier}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {flagged.length ? (
                                <div className="space-y-3">
                                  <p className="text-sm font-semibold text-white">{t("Sellers needing attention", "بائعون يحتاجون متابعة")}</p>
                                  {flagged.map((report) => (
                                    <div key={`flagged-${report.sellerId}`} className={`rounded-xl border p-3 text-xs ${tierTone[report.reliability.warningTier]}`}>
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="font-semibold text-white">{report.sellerName}</p>
                                        <span className="capitalize">{isArabic ? ({ none: "جيد", notice: "ملاحظة", warning: "تحذير", critical: "حرج" } as const)[report.reliability.warningTier] : report.reliability.warningTier} · {t("score", "الدرجة")} {report.reliability.reliabilityScore}</span>
                                      </div>
                                      <p className="mt-1">{isArabic
                                        ? ({ none: "لا توجد مؤشرات خطر.", notice: "توجد ملاحظة بسيطة تحتاج متابعة.", warning: "تحتاج موثوقية العروض إلى متابعة.", critical: "توجد مؤشرات خطر مهمة وتحتاج إجراءً سريعًا." } as const)[report.reliability.warningTier]
                                        : report.reliability.warningLabel}</p>
                                      {report.recentHistory.length ? (
                                        <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[#D1D5DB]">
                                          {report.recentHistory.slice(0, 5).map((entry) => (
                                            <div key={entry.id} className="flex flex-wrap items-center gap-2">
                                              <span className="text-white">{actionLabel(entry.action)}</span>
                                              {entry.reason ? <span>· {entry.reason}</span> : null}
                                              {entry.details ? <span className="text-[#9CA3AF]">· {localizedAuditDetails(entry)}</span> : null}
                                              <span className="text-[#9CA3AF]">· {formatDate(entry.createdAt)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "purchase-requests" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <CardTitle>{t("Purchase Requests", "طلبات الشراء والصفقات")}</CardTitle>
                            <CardDescription>{t("Monitor request flow and inspect request details.", "تابع الصفقات وافتح تفاصيل كل طلب.")}</CardDescription>
                          </div>
                          <Button type="button" variant="secondary" onClick={exportTradesCsv}>
                            {t("Export Trades", "تصدير الصفقات")}
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="ps-9" placeholder={t("Search buyer, seller, listing...", "ابحث بالمشتري أو البائع أو العرض...")} value={requestsQuery} onChange={(event) => setRequestsQuery(event.target.value)} />
                          </div>
                          <select value={requestsStatus} onChange={(event) => setRequestsStatus(event.target.value as typeof requestsStatus)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">{t("Status: All", "الحالة: الكل")}</option>
                            {(["pending", "accepted", "payment_sent", "usdt_sent", "declined", "completed", "locked", "review_open", "cancelled"] as const).map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                          </select>
                          <select value={requestsSort} onChange={(event) => setRequestsSort(event.target.value as typeof requestsSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">{t("Sort: Newest", "الترتيب: الأحدث")}</option>
                            <option value="oldest">{t("Sort: Oldest", "الترتيب: الأقدم")}</option>
                          </select>
                        </div>

                        {adminDestination.purchaseRequestId && unavailableDeepLinkMessage ? (
                          <p role="status" className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                            {unavailableDeepLinkMessage}
                          </p>
                        ) : null}

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[980px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="w-[11rem] px-4 py-3 text-center">{t("Trade ID", "رقم الصفقة")}</th>
                                <th className="px-4 py-3">{t("Buyer", "المشتري")}</th>
                                <th className="px-4 py-3">{t("Seller", "البائع")}</th>
                                <th className="px-4 py-3">{t("Amount", "الكمية")}</th>
                                <th className="px-4 py-3">{t("Listing", "العرض")}</th>
                                <th className="px-4 py-3">{t("Bank", "البنك")}</th>
                                <th className="px-4 py-3">{t("Current Status", "الحالة الحالية")}</th>
                                <th className="px-4 py-3">{t("Submitted", "تاريخ التقديم")}</th>
                                <th className="px-4 py-3">{t("Actions", "الإجراءات")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {requestsRows.rows.map((request) => {
                                const listing = listingById.get(request.listingId);
                                const seller = sellersById.get(request.sellerId);
                                return (
                                  <tr
                                    key={request.id}
                                    id={`purchase-request-${request.id}`}
                                    ref={adminDestination.purchaseRequestId === request.id ? setPurchaseRequestRow : undefined}
                                    tabIndex={-1}
                                    className={`border-t border-white/10 ${adminDestination.purchaseRequestId === request.id ? "bg-[#C9A227]/10 outline outline-1 outline-[#C9A227]/45" : ""}`}
                                  >
                                    <td className="w-[11rem] px-4 py-3 text-center font-mono font-medium whitespace-nowrap text-[#D1D5DB]">{displayTradeId(request)}</td>
                                    <td className="px-4 py-3 text-white">{request.buyerName}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{seller?.fullName ?? request.sellerId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{request.usdtAmount ?? listing?.availableAmount ?? "—"}</td>
                                    <td className="px-4 py-3 font-mono font-medium whitespace-nowrap text-[#D1D5DB]">{displayListingId(listing, request.listingId)}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{request.bankName ?? listing?.bankName ?? "—"}</td>
                                    <td className="px-4 py-3">
                                      <span className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-xs text-white/80">{statusLabel(request.status)}</span>
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(request.createdAt)}</td>
                                    <td className="px-4 py-3">
                                      <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedRequest(request)}>
                                        {t("View Details", "عرض التفاصيل")}
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                              {requestsRows.rows.length === 0 ? renderEmptyTableRow(t("No purchase requests match your filters.", "لا توجد طلبات شراء تطابق الفلاتر."), 9) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(requestsRows.safePage, requestsRows.totalPages, setRequestsPage)}
                        <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                          <p className="text-sm font-medium text-white">{t("Timeout History", "سجل انتهاء المهلة")}</p>
                          <div className="mt-3 space-y-2 text-xs text-[#D1D5DB]">
                            {timeoutHistory.slice(0, 10).map((request) => (
                              <div key={request.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="font-mono font-medium text-white">{displayTradeId(request)}</p>
                                <p>{request.timeoutReason ?? t("Trade timed out.", "انتهت مهلة الصفقة.")}</p>
                                <p className="text-[#9CA3AF]">{request.timedOutAt ? formatDate(request.timedOutAt) : "—"}</p>
                              </div>
                            ))}
                            {timeoutHistory.length === 0 ? <p className="text-[#9CA3AF]">{t("No timeout events recorded yet.", "لا توجد أحداث انتهاء مهلة مسجّلة بعد.")}</p> : null}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "commissions" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <CardTitle>{t("Commissions", "العمولات")}</CardTitle>
                            <CardDescription>{t("Track all 1% service-fee records.", "تابع جميع سجلات عمولة الخدمة بنسبة 1%.")}</CardDescription>
                          </div>
                          <Button type="button" variant="secondary" onClick={exportCommissionsCsv}>
                            {t("Export CSV", "تصدير CSV")}
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="relative md:col-span-3">
                            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="ps-9" placeholder={t("Search trade, buyer, seller...", "ابحث بالصفقة أو المشتري أو البائع...")} value={commissionsQuery} onChange={(event) => setCommissionsQuery(event.target.value)} />
                          </div>
                          <select value={commissionsSort} onChange={(event) => setCommissionsSort(event.target.value as typeof commissionsSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">{t("Sort: Newest", "الترتيب: الأحدث")}</option>
                            <option value="oldest">{t("Sort: Oldest", "الترتيب: الأقدم")}</option>
                            <option value="highest">{t("Sort: Highest Commission", "الترتيب: أعلى عمولة")}</option>
                          </select>
                        </div>

                        {adminDestination.commissionId && unavailableDeepLinkMessage ? (
                          <p role="status" className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                            {unavailableDeepLinkMessage}
                          </p>
                        ) : null}

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[980px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="w-[11rem] px-4 py-3 text-center">{t("Trade ID", "رقم الصفقة")}</th>
                                <th className="px-4 py-3">{t("Buyer", "المشتري")}</th>
                                <th className="px-4 py-3">{t("Seller", "البائع")}</th>
                                <th className="px-4 py-3">{t("Trade Value", "قيمة الصفقة")}</th>
                                <th className="px-4 py-3">{t("1% Commission", "عمولة 1%")}</th>
                                <th className="px-4 py-3">{t("Payment Status", "حالة الدفع")}</th>
                                <th className="px-4 py-3">{t("Date", "التاريخ")}</th>
                                <th className="px-4 py-3">{t("Actions", "الإجراءات")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {commissionsRows.rows.map((record) => {
                                const request = (data.purchaseRequests ?? []).find((item) => item.id === record.purchaseRequestId);
                                const seller = sellersById.get(record.sellerId);
                                return (
                                  <tr
                                    key={record.id}
                                    id={`commission-${record.id}`}
                                    ref={adminDestination.commissionId === record.id ? setCommissionRow : undefined}
                                    tabIndex={-1}
                                    className={`border-t border-white/10 ${adminDestination.commissionId === record.id ? "bg-[#C9A227]/10 outline outline-1 outline-[#C9A227]/45" : ""}`}
                                  >
                                    <td className="w-[11rem] px-4 py-3 text-center font-mono font-medium whitespace-nowrap text-[#D1D5DB]">{displayTradeId(request, record.tradeId ?? record.purchaseRequestId)}</td>
                                    <td className="px-4 py-3 text-white">{request?.buyerName ?? record.buyerId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{seller?.fullName ?? record.sellerId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatCurrency(record.grossAmount)}</td>
                                    <td className="px-4 py-3 text-[#C9A227]">{formatUsdt(record.commissionAmount)}</td>
                                    <td className="px-4 py-3">
                                      <span className={`rounded-full px-2.5 py-1 text-xs ${record.paymentStatus === "paid" ? "border border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : record.paymentStatus === "overdue" ? "border border-red-500/35 bg-red-500/10 text-red-300" : "border border-amber-500/35 bg-amber-500/10 text-amber-300"}`}>
                                        {statusLabel(record.paymentStatus)}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(record.createdAt)}</td>
                                    <td className="px-4 py-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        {record.paymentStatus !== "paid" ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              if (!window.confirm(t("Mark this commission as paid?", "هل تريد تسجيل هذه العمولة كمدفوعة؟"))) return;
                                              const reason = requestReason(t("Reason for marking this commission paid:", "سبب تسجيل العمولة كمدفوعة:"), t("Commission manually marked paid.", "تم تسجيل العمولة كمدفوعة يدويًا."));
                                              if (!reason) return;
                                              void runAction(fetch(`/api/alpha-exchange/admin/commissions/${record.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentStatus: "paid", paymentVerificationStatus: "verified", reason }) }), t("Commission marked paid.", "تم تسجيل العمولة كمدفوعة."));
                                            }}
                                          >
                                            {t("Mark Paid", "تسجيل كمدفوعة")}
                                          </Button>
                                        ) : (
                                          <span className="text-xs text-[#9CA3AF]">{t("Settled", "تمت التسوية")}</span>
                                        )}
                                        {record.paymentVerificationStatus !== "failed" ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              if (!window.confirm(t("Reject this commission payment verification?", "هل تريد رفض التحقق من دفع هذه العمولة؟"))) return;
                                              const reason = requestReason(t("Reason for rejecting this commission:", "سبب رفض العمولة:"), t("Commission verification rejected.", "تم رفض التحقق من العمولة."));
                                              if (!reason) return;
                                              void runAction(fetch(`/api/alpha-exchange/admin/commissions/${record.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentStatus: "pending", paymentVerificationStatus: "failed", paymentVerificationNotes: reason, reason }) }), t("Commission rejected.", "تم رفض العمولة."));
                                            }}
                                          >
                                            {t("Reject", "رفض")}
                                          </Button>
                                        ) : null}
                                        {record.paymentStatus !== "pending" || record.paymentVerificationStatus === "failed" ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              if (!window.confirm(t("Reset this commission to pending?", "هل تريد إعادة هذه العمولة إلى قيد الانتظار؟"))) return;
                                              const reason = requestReason(t("Reason for resetting this commission to pending:", "سبب إعادة العمولة إلى قيد الانتظار:"), t("Commission reset to pending.", "تمت إعادة العمولة إلى قيد الانتظار."));
                                              if (!reason) return;
                                              void runAction(fetch(`/api/alpha-exchange/admin/commissions/${record.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentStatus: "pending", paymentVerificationStatus: "pending_verification", paymentVerificationNotes: reason, reason }) }), t("Commission reset to pending.", "تمت إعادة العمولة إلى قيد الانتظار."));
                                            }}
                                          >
                                            {t("Reset Pending", "إعادة للانتظار")}
                                          </Button>
                                        ) : null}
                                        <Button type="button" size="sm" variant="secondary" onClick={() => void handleReverifyCommission(record.id)}>
                                          {t("Reverify", "إعادة التحقق")}
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                              {commissionsRows.rows.length === 0 ? renderEmptyTableRow(t("No commission records match your filters.", "لا توجد سجلات عمولة تطابق الفلاتر."), 8) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(commissionsRows.safePage, commissionsRows.totalPages, setCommissionsPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "audit-logs" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>{t("Audit Logs", "سجل النشاط")}</CardTitle>
                        <CardDescription>{t("Newest actions first with full traceability.", "أحدث الإجراءات أولًا مع تفاصيل كاملة للتتبع.")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="ps-9" placeholder={t("Search logs...", "ابحث في السجل...")} value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} />
                          </div>
                          <select value={auditAction} onChange={(event) => setAuditAction(event.target.value as typeof auditAction)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">{t("Action: All", "الإجراء: الكل")}</option>
                            {([
                              "seller_approved", "seller_rejected", "seller_suspended", "seller_reactivated", "listing_created", "listing_expired",
                              "listing_renewed", "listing_expiration_extended", "listing_edited", "listing_closed", "admin_override", "listing_removed",
                              "purchase_request_submitted", "purchase_completed", "trade_timed_out", "seller_vacation_enabled", "seller_vacation_disabled",
                              "commission_overdue", "commission_paid", "trade_review_submitted", "trade_review_responded", "trust_score_updated",
                              "seller_prestige_promoted", "seller_prestige_overridden",
                            ] as AuditLogEntry["action"][]).map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
                          </select>
                          <select value={auditSort} onChange={(event) => setAuditSort(event.target.value as typeof auditSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">{t("Sort: Newest", "الترتيب: الأحدث")}</option>
                            <option value="oldest">{t("Sort: Oldest", "الترتيب: الأقدم")}</option>
                          </select>
                        </div>

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[1180px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">{t("Timestamp", "الوقت")}</th>
                                <th className="px-4 py-3">{t("User", "المستخدم")}</th>
                                <th className="px-4 py-3">{t("Action", "الإجراء")}</th>
                                <th className="px-4 py-3">{t("Resource", "العنصر")}</th>
                                <th className="px-4 py-3">{t("Reason", "السبب")}</th>
                                <th className="px-4 py-3">{t("Details", "التفاصيل")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {auditRows.rows.map((entry) => {
                                const actor = sellersById.get(entry.actorUserId);
                                return (
                                  <tr key={entry.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(entry.createdAt)}</td>
                                    <td className="px-4 py-3 text-white">{actor?.fullName ?? entry.actorUserId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{actionLabel(entry.action)}</td>
                                    <td className="px-4 py-3 font-mono font-medium whitespace-nowrap text-[#D1D5DB]">
                                      {entry.listingId
                                        ? `${t("Listing", "العرض")} ${displayListingId(listingById.get(entry.listingId), entry.listingId)}`
                                        : entry.purchaseRequestId
                                          ? `${t("Trade", "الصفقة")} ${displayTradeId(requestsById.get(entry.purchaseRequestId), entry.purchaseRequestId)}`
                                          : entry.targetUserId ?? t("system", "النظام")}
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.reason ?? "—"}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{localizedAuditDetails(entry)}</td>
                                  </tr>
                                );
                              })}
                              {auditRows.rows.length === 0 ? renderEmptyTableRow(t("No audit logs match your filters.", "لا توجد سجلات نشاط تطابق الفلاتر."), 6) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(auditRows.safePage, auditRows.totalPages, setAuditPage)}
                        <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm font-medium text-white">{t("Notification History", "سجل الإشعارات")}</p>
                            <Input className="max-w-sm" placeholder={t("Search notifications...", "ابحث في الإشعارات...")} value={notificationQuery} onChange={(event) => setNotificationQuery(event.target.value)} />
                          </div>
                          <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full min-w-[980px] text-sm">
                              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                                <tr>
                                  <th className="px-4 py-3">{t("Timestamp", "الوقت")}</th>
                                  <th className="px-4 py-3">{t("Recipient", "المستلم")}</th>
                                  <th className="px-4 py-3">{t("Category", "الفئة")}</th>
                                  <th className="px-4 py-3">{t("Title", "العنوان")}</th>
                                  <th className="px-4 py-3">{t("Message", "الرسالة")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {notificationRows.rows.map((entry) => {
                                  const copy = localizeNotificationCopy(entry, locale);
                                  return (
                                    <tr key={entry.id} className="border-t border-white/10">
                                      <td className="px-4 py-3 text-[#D1D5DB]" title={formatDate(entry.createdAt)}>{formatNotificationRelativeTime(entry.createdAt, locale)}</td>
                                      <td className="px-4 py-3 text-white">{sellersById.get(entry.userId)?.fullName ?? entry.userId}</td>
                                      <td className="px-4 py-3 text-[#D1D5DB]">{notificationCategoryLabel(entry.category)}</td>
                                      <td className="px-4 py-3 text-white">{replaceExchangeEntityIds(copy.title, displayLookup)}</td>
                                      <td className="px-4 py-3 text-[#D1D5DB]">{replaceExchangeEntityIds(copy.message, displayLookup)}</td>
                                    </tr>
                                  );
                                })}
                                {notificationRows.rows.length === 0 ? renderEmptyTableRow(t("No notifications match your search.", "لا توجد إشعارات تطابق البحث."), 5) : null}
                              </tbody>
                            </table>
                          </div>
                          <div className="mt-3">{renderPagination(notificationRows.safePage, notificationRows.totalPages, setNotificationPage)}</div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "sms-deliveries" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>{t("SMS Delivery History", "سجل إرسال رسائل SMS")}</CardTitle>
                        <CardDescription>{t("Recent lifecycle messages. Recipient numbers are always masked.", "أحدث الرسائل التشغيلية. أرقام المستلمين مخفية دائمًا.")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[1320px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">{t("Recipient", "المستلم")}</th>
                                <th className="px-4 py-3">{t("Event", "الحدث")}</th>
                                <th className="px-4 py-3">{t("Status", "الحالة")}</th>
                                <th className="px-4 py-3">{t("Retries", "إعادة المحاولة")}</th>
                                <th className="px-4 py-3">{t("Provider SID", "معرّف المزوّد SID")}</th>
                                <th className="px-4 py-3">{t("Created", "تاريخ الإنشاء")}</th>
                                <th className="px-4 py-3">{t("Updated", "آخر تحديث")}</th>
                                <th className="px-4 py-3">{t("Delivery timestamp", "وقت التسليم")}</th>
                                <th className="px-4 py-3">{t("Error", "الخطأ")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {smsDeliveryRows.rows.map((delivery) => {
                                const statusClass = delivery.status === "delivered"
                                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                                  : delivery.status === "failed"
                                    ? "border-red-400/30 bg-red-400/10 text-red-300"
                                    : delivery.status === "sent"
                                      ? "border-blue-400/30 bg-blue-400/10 text-blue-300"
                                      : "border-amber-400/30 bg-amber-400/10 text-amber-300";
                                const deliveryTimestamp = delivery.deliveredAt ?? delivery.failedAt ?? delivery.sentAt;
                                return (
                                  <tr key={delivery.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 font-mono text-white">{delivery.recipientPhoneMasked}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{smsEventLabel(delivery.eventType)}</td>
                                    <td className="px-4 py-3">
                                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusClass}`}>
                                        {statusLabel(delivery.status)}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{delivery.retryCount}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-[#D1D5DB]">{delivery.twilioMessageSid ?? "—"}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(delivery.createdAt)}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(delivery.updatedAt)}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{deliveryTimestamp ? formatDate(deliveryTimestamp) : "—"}</td>
                                    <td className="max-w-xs px-4 py-3 text-[#D1D5DB]">{delivery.lastError
                                      ? isArabic && !/[\u0600-\u06ff]/.test(delivery.lastError) ? "تعذّر تسليم الرسالة." : delivery.lastError
                                      : "—"}</td>
                                  </tr>
                                );
                              })}
                              {smsDeliveryRows.rows.length === 0 ? renderEmptyTableRow(t("No SMS deliveries recorded yet.", "لا توجد رسائل SMS مسجّلة بعد."), 9) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(smsDeliveryRows.safePage, smsDeliveryRows.totalPages, setSmsDeliveriesPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "marketplace-enforcement" ? (
                    <div className="space-y-4">
                      <Card className="border-red-500/20 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle>{t("Marketplace Compliance", "امتثال السوق")}</CardTitle>
                          <CardDescription>{t("Policy violations, temporary restrictions, recovery fee status, and permanent revocations.", "مخالفات السياسة والقيود المؤقتة ورسوم الاسترداد والإلغاء الدائم.")}</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-3 md:grid-cols-5 text-sm text-[#D1D5DB]">
                          <p>{t("Active Cases:", "الحالات النشطة:")} <span className="text-white">{data.enforcement.metrics.activeCases}</span></p>
                          <p>{t("Resolved Cases:", "الحالات المحلولة:")} <span className="text-white">{data.enforcement.metrics.resolvedCases}</span></p>
                          <p>{t("Revoked Sellers:", "البائعون الملغون:")} <span className="text-white">{data.enforcement.metrics.revokedCases}</span></p>
                          <p>{t("Total Cases:", "إجمالي الحالات:")} <span className="text-white">{data.enforcement.metrics.totalCases}</span></p>
                          <p>{t("Outstanding Fees:", "الرسوم المستحقة:")} <span className="text-white">{formatUsdt(data.enforcement.metrics.outstandingFeeAmountUsdt)}</span></p>
                        </CardContent>
                      </Card>

                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle>{t("Active Restriction Cases", "حالات القيود النشطة")}</CardTitle>
                          <CardDescription>{t("Sellers currently blocked from listing/editing/renewing/publishing.", "بائعون ممنوعون حاليًا من إنشاء العروض أو تعديلها أو تجديدها أو نشرها.")}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full min-w-[980px] text-sm">
                              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                                <tr>
                                  <th className="px-4 py-3">{t("Seller", "البائع")}</th>
                                  <th className="px-4 py-3">{t("Violation", "المخالفة")}</th>
                                  <th className="px-4 py-3">{t("Fee", "الرسم")}</th>
                                  <th className="px-4 py-3">{t("Issued", "تاريخ الإصدار")}</th>
                                  <th className="px-4 py-3">{t("Due", "موعد الاستحقاق")}</th>
                                  <th className="px-4 py-3">{t("Reason", "السبب")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {data.enforcement.activeCases.map((record) => (
                                  <tr key={record.id} className="border-t border-white/10">
                                    <td className="px-4 py-3">
                                      <p className="font-medium text-white">{record.sellerName}</p>
                                      <p className="text-xs text-[#9CA3AF]">{record.sellerEmail}</p>
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">#{record.violationNumber}</td>
                                    <td className="px-4 py-3 text-[#FDE68A]">{record.feeAmount.toFixed(2)} {record.feeCurrency}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(record.issuedAt)}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{record.dueAt ? formatDate(record.dueAt) : "—"}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{record.reason}</td>
                                  </tr>
                                ))}
                                {data.enforcement.activeCases.length === 0 ? renderEmptyTableRow(t("No active compliance cases.", "لا توجد حالات امتثال نشطة."), 6) : null}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle>{t("Recent Compliance Activity", "أحدث نشاط الامتثال")}</CardTitle>
                          <CardDescription>{t("Immutable action log of compliance decisions.", "سجل ثابت لإجراءات وقرارات الامتثال.")}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full min-w-[980px] text-sm">
                              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                                <tr>
                                  <th className="px-4 py-3">{t("Timestamp", "الوقت")}</th>
                                  <th className="px-4 py-3">{t("Seller", "البائع")}</th>
                                  <th className="px-4 py-3">{t("Action", "الإجراء")}</th>
                                  <th className="px-4 py-3">{t("Actor", "المنفّذ")}</th>
                                  <th className="px-4 py-3">{t("Reason", "السبب")}</th>
                                  <th className="px-4 py-3">{t("Notes", "الملاحظات")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {enforcementRows.rows.map((entry) => (
                                  <tr key={entry.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(entry.createdAt)}</td>
                                    <td className="px-4 py-3 text-white">{entry.sellerName}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{actionLabel(entry.action)}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.actorName}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.reason ?? "—"}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.notes ?? "—"}</td>
                                  </tr>
                                ))}
                                {enforcementRows.rows.length === 0 ? renderEmptyTableRow(t("No compliance activity yet.", "لا يوجد نشاط امتثال بعد."), 6) : null}
                              </tbody>
                            </table>
                          </div>
                          {renderPagination(enforcementRows.safePage, enforcementRows.totalPages, setEnforcementPage)}
                        </CardContent>
                      </Card>
                    </div>
                  ) : null}

                  {activeSection === "announcements" ? <AdminAnnouncementsPanel /> : null}

                  {activeSection === "private-beta" ? (
                    <div className="space-y-6">
                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle>{t("Access Control", "التحكم بالوصول")}</CardTitle>
                          <CardDescription>{t("Onboarding controls and registration history.", "إدارة رموز الدخول وسجل التسجيل.")}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid gap-3 md:grid-cols-4">
                            <Input value={inviteMaxUses} onChange={(event) => setInviteMaxUses(event.target.value)} placeholder={t("Max uses", "الحد الأقصى للاستخدام")} />
                            <Input type="datetime-local" value={inviteExpiresAt} onChange={(event) => setInviteExpiresAt(event.target.value)} />
                            <div className="md:col-span-2">
                              <Button type="button" onClick={handleCreateInvite}>{t("Generate Access Code", "إنشاء رمز وصول")}</Button>
                            </div>
                          </div>
                          <div className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-3">
                            <p>{t("Pending Invites:", "الدعوات المعلّقة:")} <span className="text-white">{data.privateBeta.pendingInvites.length}</span></p>
                            <p>{t("Used Invites:", "الدعوات المستخدمة:")} <span className="text-white">{data.privateBeta.inviteUses.length}</span></p>
                            <p>{t("Invite History:", "سجل الدعوات:")} <span className="text-white">{data.privateBeta.inviteCodes.length}</span></p>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full min-w-[900px] text-sm">
                              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                                <tr>
                                  <th className="px-4 py-3">{t("Code", "الرمز")}</th>
                                  <th className="px-4 py-3">{t("Status", "الحالة")}</th>
                                  <th className="px-4 py-3">{t("Usage", "الاستخدام")}</th>
                                  <th className="px-4 py-3">{t("Expires", "انتهاء الصلاحية")}</th>
                                  <th className="px-4 py-3">{t("Created", "تاريخ الإنشاء")}</th>
                                  <th className="px-4 py-3">{t("Actions", "الإجراءات")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {data.privateBeta.inviteCodes.slice(0, 20).map((invite) => (
                                  <tr key={invite.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-white">{invite.code}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{statusLabel(invite.status)}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{invite.usedCount}/{invite.maxUses}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{invite.expiresAt ? formatDate(invite.expiresAt) : t("No expiry", "بلا انتهاء")}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(invite.createdAt)}</td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        <Button type="button" size="sm" variant="secondary" onClick={() => void handleInviteStatus(invite.id, "expire")}>
                                          {t("Expire", "إنهاء الصلاحية")}
                                        </Button>
                                        <Button type="button" size="sm" variant="secondary" onClick={() => void handleInviteStatus(invite.id, "disable")}>
                                          {t("Disable", "تعطيل")}
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                {!data.privateBeta.inviteCodes.length ? renderEmptyTableRow(t("No onboarding codes yet.", "لا توجد رموز وصول بعد."), 6) : null}
                              </tbody>
                            </table>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full min-w-[760px] text-sm">
                              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                                <tr>
                                  <th className="px-4 py-3">{t("Used Code", "الرمز المستخدم")}</th>
                                  <th className="px-4 py-3">{t("Used By", "استخدمه")}</th>
                                  <th className="px-4 py-3">{t("Used At", "وقت الاستخدام")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {data.privateBeta.inviteUses.slice(0, 20).map((use) => (
                                  <tr key={use.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-white">{use.code}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{use.usedByEmail}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(use.usedAt)}</td>
                                  </tr>
                                ))}
                                {!data.privateBeta.inviteUses.length ? renderEmptyTableRow(t("No used invites yet.", "لا توجد دعوات مستخدمة بعد."), 3) : null}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>{t("Owner Feedback Panel", "ملاحظات المستخدمين للمالك")}</CardTitle>
                            <CardDescription>{t("Newest feedback, request trends, and critical bugs.", "أحدث الملاحظات والطلبات والأخطاء المهمة.")}</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2">
                              <p>{t("Critical Bugs:", "الأخطاء المهمة:")} <span className="text-white">{data.privateBeta.feedbackSummary.criticalBugs}</span></p>
                              <p>{t("Suggestions:", "الاقتراحات:")} <span className="text-white">{data.privateBeta.feedbackSummary.suggestions}</span></p>
                              <p>{t("Resolved:", "المحلولة:")} <span className="text-white">{data.privateBeta.feedbackSummary.resolved}</span></p>
                            </div>
                            <select value={betaFeedbackStatusFilter} onChange={(event) => setBetaFeedbackStatusFilter(event.target.value as typeof betaFeedbackStatusFilter)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                              <option value="all">{t("Status: All", "الحالة: الكل")}</option>
                              {(["new", "in_review", "resolved"] as const).map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                            </select>
                            <div className="space-y-2">
                              {betaFeedbackRows.map((entry) => (
                                <div key={entry.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                                  <p className="text-white">{feedbackCategoryLabel(entry.category)} • {statusLabel(entry.status)}</p>
                                  <p className="mt-1 text-[#D1D5DB]">{replaceExchangeEntityIds(entry.message, displayLookup)}</p>
                                  <p className="mt-1 text-[#9CA3AF]">{formatDate(entry.createdAt)}</p>
                                  <div className="mt-2 flex gap-2">
                                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleFeedbackStatus(entry.id, "in_review")}>{t("In Review", "قيد المراجعة")}</Button>
                                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleFeedbackStatus(entry.id, "resolved")}>{t("Resolve", "حلّ")}</Button>
                                  </div>
                                </div>
                              ))}
                              {!betaFeedbackRows.length ? <p className="text-xs text-[#9CA3AF]">{t("No feedback entries.", "لا توجد ملاحظات.")}</p> : null}
                            </div>
                          </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>{t("Beta Announcements", "إعلانات المنصة")}</CardTitle>
                            <CardDescription>{t("Publish updates to users.", "انشر التحديثات للمستخدمين.")}</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <label className="block space-y-1.5 text-sm text-[#D1D5DB]">
                              <span>{t("Announcement type", "نوع الإعلان")}</span>
                              <select value={announcementType} onChange={(event) => setAnnouncementType(event.target.value as BetaAnnouncementType)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                              <option value="maintenance">{t("Maintenance", "صيانة")}</option>
                              <option value="new_feature">{t("New Feature", "ميزة جديدة")}</option>
                              <option value="bug_fix">{t("Bug Fix", "إصلاح خلل")}</option>
                              <option value="known_issue">{t("Known Issue", "مشكلة معروفة")}</option>
                              </select>
                            </label>
                            <div className="grid gap-3 md:grid-cols-2">
                              <fieldset dir="ltr" className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3 text-left">
                                <legend className="px-1 text-sm font-semibold text-white">{t("English content", "المحتوى الإنجليزي")}</legend>
                                <label className="block space-y-1.5 text-xs text-[#D1D5DB]">
                                  <span>{t("English title", "العنوان بالإنجليزية")}</span>
                                  <Input dir="ltr" lang="en" maxLength={160} placeholder={t("Announcement title", "اكتب عنوان الإعلان بالإنجليزية")} value={announcementTitleEn} onChange={(event) => setAnnouncementTitleEn(event.target.value)} />
                                </label>
                                <label className="block space-y-1.5 text-xs text-[#D1D5DB]">
                                  <span>{t("English message", "النص بالإنجليزية")}</span>
                                  <textarea
                                    dir="ltr"
                                    lang="en"
                                    maxLength={2000}
                                    rows={4}
                                    className="flex min-h-24 w-full resize-y rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white outline-none placeholder:text-[#6B7280] focus:border-[#C9A227]/70"
                                    placeholder={t("Announcement message", "اكتب نص الإعلان بالإنجليزية")}
                                    value={announcementMessageEn}
                                    onChange={(event) => setAnnouncementMessageEn(event.target.value)}
                                  />
                                </label>
                              </fieldset>
                              <fieldset dir="rtl" className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3 text-right">
                                <legend className="px-1 text-sm font-semibold text-white">{t("Arabic content", "المحتوى العربي")}</legend>
                                <label className="block space-y-1.5 text-xs text-[#D1D5DB]">
                                  <span>{t("Arabic title", "العنوان بالعربية")}</span>
                                  <Input dir="rtl" lang="ar" maxLength={160} placeholder="عنوان الإعلان" value={announcementTitleAr} onChange={(event) => setAnnouncementTitleAr(event.target.value)} />
                                </label>
                                <label className="block space-y-1.5 text-xs text-[#D1D5DB]">
                                  <span>{t("Arabic message", "النص بالعربية")}</span>
                                  <textarea
                                    dir="rtl"
                                    lang="ar"
                                    maxLength={2000}
                                    rows={4}
                                    className="flex min-h-24 w-full resize-y rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white outline-none placeholder:text-[#6B7280] focus:border-[#C9A227]/70"
                                    placeholder="نص الإعلان"
                                    value={announcementMessageAr}
                                    onChange={(event) => setAnnouncementMessageAr(event.target.value)}
                                  />
                                </label>
                              </fieldset>
                            </div>
                            <p className="text-xs text-[#9CA3AF]">{t("Both languages are required so every user receives the same update.", "اللغتان مطلوبتان ليصل التحديث نفسه إلى جميع المستخدمين.")}</p>
                            <Button
                              type="button"
                              className="w-full sm:w-auto"
                              disabled={![announcementTitleEn, announcementMessageEn, announcementTitleAr, announcementMessageAr].every((value) => value.trim())}
                              onClick={handleCreateAnnouncement}
                            >
                              {t("Publish Announcement", "نشر الإعلان")}
                            </Button>
                            <div className="space-y-2">
                              {data.privateBeta.announcements.slice(0, 10).map((announcement) => (
                                <div key={announcement.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                                  <div dir={isArabic ? "rtl" : "ltr"} lang={locale}>
                                    <p className="font-medium text-white">{isArabic ? announcement.titleAr || announcement.title : announcement.titleEn || announcement.title}</p>
                                    <p className="mt-1 text-[#D1D5DB]">{isArabic ? announcement.messageAr || announcement.message : announcement.messageEn || announcement.message}</p>
                                  </div>
                                  <p className="mt-2 text-[#9CA3AF]">
                                    {announcement.type === "maintenance"
                                      ? t("Maintenance", "صيانة")
                                      : announcement.type === "new_feature"
                                        ? t("New Feature", "ميزة جديدة")
                                        : announcement.type === "bug_fix"
                                          ? t("Bug Fix", "إصلاح خلل")
                                          : t("Known Issue", "مشكلة معروفة")}
                                    {" • "}{formatDate(announcement.createdAt)}{" • "}{announcement.isActive ? t("Active", "نشط") : t("Disabled", "معطّل")}
                                  </p>
                                  <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => void handleAnnouncementState(announcement, !announcement.isActive)}>
                                    {announcement.isActive ? t("Disable", "تعطيل") : t("Enable", "تفعيل")}
                                  </Button>
                                </div>
                              ))}
                              {!data.privateBeta.announcements.length ? <p className="text-xs text-[#9CA3AF]">{t("No announcements yet.", "لا توجد إعلانات بعد.")}</p> : null}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  ) : null}

                  {activeSection === "analytics" ? (
                    <div className="space-y-5 xl:space-y-6">
                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle>{t("Analytics", "التحليلات")}</CardTitle>
                          <CardDescription>{t("Key marketplace metrics at a glance.", "أهم مؤشرات السوق في مكان واحد.")}</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          {[
                            { label: t("Active Trades", "الصفقات النشطة"), value: (data.purchaseRequests ?? []).filter((r) => r.status !== "completed" && r.status !== "cancelled" && r.status !== "declined").length },
                            { label: t("Completed Trades", "الصفقات المكتملة"), value: (data.purchaseRequests ?? []).filter((r) => r.status === "completed").length },
                            { label: t("Open Listings", "العروض المفتوحة"), value: (data.listings ?? []).filter((l) => l.status === "active").length },
                            { label: t("Revenue Today (est.)", "إيراد اليوم (تقديري)"), value: formatCurrency(data.ownerBusiness.today.estimatedCommission) },
                            { label: t("Revenue This Week", "إيراد هذا الأسبوع"), value: formatCurrency(data.ownerBusiness.financialOverview.estimatedCommissionThisWeek) },
                            { label: t("Revenue This Month", "إيراد هذا الشهر"), value: formatCurrency(data.ownerBusiness.financialOverview.estimatedCommissionThisMonth) },
                            { label: t("Volume Today", "حجم اليوم"), value: formatUsdt(data.ownerBusiness.today.tradeVolumeUsdt) },
                            { label: t("Top Seller (Week)", "أفضل بائع (الأسبوع)"), value: data.ownerBusiness.thisWeek.topSeller || "—" },
                          ].map((stat) => (
                            <Card key={stat.label} className="border-white/10 bg-black/20">
                              <CardHeader className="pb-2">
                                <CardDescription className="text-xs uppercase tracking-[0.15em] text-[#9CA3AF]">{stat.label}</CardDescription>
                                <CardTitle className="text-xl">{stat.value}</CardTitle>
                              </CardHeader>
                            </Card>
                          ))}
                        </CardContent>
                      </Card>
                    </div>
                  ) : null}

                  {activeSection === "users" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>{t("User Management", "إدارة المستخدمين")}</CardTitle>
                        <CardDescription>{t("Manage all platform users, roles, and account states.", "أدر مستخدمي المنصة وأدوارهم وحالات حساباتهم.")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="ps-9" placeholder={t("Search name, email, role...", "ابحث بالاسم أو البريد أو الدور...")} value={usersQuery} onChange={(event) => { setUsersQuery(event.target.value); setUsersPage(1); }} />
                          </div>
                          <select value={usersRoleFilter} onChange={(event) => { setUsersRoleFilter(event.target.value); setUsersPage(1); }} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">{t("Role: All", "الدور: الكل")}</option>
                            <option value="buyer">{t("Buyer", "مشتري")}</option>
                            <option value="approved_seller">{t("Approved Seller", "بائع معتمد")}</option>
                            <option value="pending_seller_approval">{t("Pending Seller", "بائع قيد الموافقة")}</option>
                            <option value="admin">{t("Admin", "مدير")}</option>
                            <option value="owner">{t("Owner", "المالك")}</option>
                            <option value="guest">{t("Guest", "زائر")}</option>
                            <option value="student">{t("Student", "طالب")}</option>
                          </select>
                        </div>
                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[860px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">{t("Name", "الاسم")}</th>
                                <th className="px-4 py-3">{t("Email", "البريد الإلكتروني")}</th>
                                <th className="px-4 py-3">{t("Role", "الدور")}</th>
                                <th className="px-4 py-3">{t("Status", "الحالة")}</th>
                                <th className="px-4 py-3">{t("Joined", "تاريخ الانضمام")}</th>
                                <th className="px-4 py-3">{t("Actions", "الإجراءات")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {usersRows.rows.map((user) => (
                                <tr key={user.id} className="border-t border-white/10">
                                  <td className="px-4 py-3 font-medium text-white">{user.fullName}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{user.email}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{roleLabel(user.role)}</td>
                                  <td className="px-4 py-3">
                                    {user.disabled ? (
                                      <span className="rounded-full border border-red-500/35 bg-red-500/10 px-2.5 py-1 text-xs text-red-300">{t("Disabled", "معطّل")}</span>
                                    ) : (
                                      <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">{t("Active", "نشط")}</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(user.createdAt)}</td>
                                  <td className="px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Button type="button" size="sm" variant="secondary" onClick={() => void handleChangeUserRole(user.id, user.role)}>
                                        {t("Change Role", "تغيير الدور")}
                                      </Button>
                                      <Button type="button" size="sm" variant="secondary" onClick={() => void handleDisableUser(user.id, !user.disabled)} className={user.disabled ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20" : "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"}>
                                        {user.disabled ? t("Enable", "تفعيل") : t("Disable", "تعطيل")}
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {usersRows.rows.length === 0 ? renderEmptyTableRow(t("No users match your filters.", "لا يوجد مستخدمون يطابقون الفلاتر."), 6) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(usersRows.safePage, usersRows.totalPages, setUsersPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "reviews" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>{t("Reviews", "التقييمات")}</CardTitle>
                        <CardDescription>{t("Moderate buyer reviews submitted after completed trades.", "راجع تقييمات المشترين بعد الصفقات المكتملة.")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="relative">
                          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                          <Input className="ps-9" placeholder={t("Search seller, buyer, comment...", "ابحث بالبائع أو المشتري أو التعليق...")} value={reviewsQuery} onChange={(event) => { setReviewsQuery(event.target.value); setReviewsPage(1); }} />
                        </div>
                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[860px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">{t("Seller", "البائع")}</th>
                                <th className="px-4 py-3">{t("Buyer", "المشتري")}</th>
                                <th className="px-4 py-3">{t("Rating", "التقييم")}</th>
                                <th className="px-4 py-3">{t("Comment", "التعليق")}</th>
                                <th className="px-4 py-3">{t("Status", "الحالة")}</th>
                                <th className="px-4 py-3">{t("Actions", "الإجراءات")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reviewsRows.rows.map((review) => {
                                const seller = sellersById.get(review.sellerId);
                                return (
                                  <tr key={review.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-white">{seller?.fullName ?? review.sellerId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{review.buyerId}</td>
                                    <td className="px-4 py-3 text-[#C9A227]">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</td>
                                    <td className="px-4 py-3 max-w-[260px] truncate text-[#D1D5DB]">{review.comment}</td>
                                    <td className="px-4 py-3">
                                      {review.hidden ? (
                                        <span className="rounded-full border border-red-500/35 bg-red-500/10 px-2.5 py-1 text-xs text-red-300">{t("Hidden", "مخفي")}</span>
                                      ) : (
                                        <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">{t("Visible", "ظاهر")}</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <Button type="button" size="sm" variant="secondary" onClick={() => void handleModerateReview(review.id, !review.hidden)}>
                                        {review.hidden ? t("Restore", "إظهار") : t("Hide", "إخفاء")}
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                              {reviewsRows.rows.length === 0 ? renderEmptyTableRow(t("No reviews found.", "لا توجد تقييمات."), 6) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(reviewsRows.safePage, reviewsRows.totalPages, setReviewsPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "system-health" ? (
                    <div className="space-y-5" aria-live="polite">
                      <Card className={`bg-[#0B0B0B]/90 ${systemHealth?.status === "degraded" ? "border-amber-500/35" : "border-emerald-500/30"}`}>
                        <CardHeader>
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <CardTitle className="flex items-center gap-2">
                                <ShieldCheck className={`h-5 w-5 ${systemHealth?.status === "degraded" ? "text-amber-300" : "text-emerald-300"}`} aria-hidden="true" />
                                {t("Website Health", "حالة الموقع")}
                              </CardTitle>
                              <CardDescription className="mt-2">
                                {t(
                                  "Live checks for the services required by buyers, sellers, chat, and notifications.",
                                  "فحوصات مباشرة للخدمات التي يحتاجها المشترون والبائعون والمحادثة والإشعارات.",
                                )}
                              </CardDescription>
                            </div>
                            <Button type="button" variant="secondary" onClick={() => void fetchSystemHealth()} disabled={systemHealthLoading}>
                              {systemHealthLoading ? t("Checking...", "جارٍ الفحص...") : t("Check Now", "فحص الآن")}
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {systemHealthError ? (
                            <p role="alert" className="rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-200">{systemHealthError}</p>
                          ) : null}
                          {systemHealth ? (
                            <div className="flex flex-wrap items-center gap-3 text-sm text-[#D1D5DB]">
                              <span className={`rounded-full border px-3 py-1 font-medium ${systemHealth.status === "healthy" ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : "border-amber-500/35 bg-amber-500/10 text-amber-300"}`}>
                                {systemHealth.status === "healthy" ? t("All systems healthy", "جميع الأنظمة تعمل") : t("Attention required", "تحتاج إلى مراجعة")}
                              </span>
                              <span>{t("Last checked", "آخر فحص")}: {formatDate(systemHealth.checkedAt)}</span>
                              <span>{t("Release", "الإصدار")}: <bdi dir="ltr">{systemHealth.release}</bdi></span>
                              <span>{t("Check time", "مدة الفحص")}: {systemHealth.durationMs} ms</span>
                            </div>
                          ) : systemHealthLoading ? (
                            <p className="text-sm text-[#D1D5DB]">{t("Running live service checks...", "جارٍ فحص الخدمات مباشرة...")}</p>
                          ) : null}
                        </CardContent>
                      </Card>

                      {systemHealth ? (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                          {systemHealth.checks.map((check) => {
                            const arabicLabels: Record<SystemHealthSnapshot["checks"][number]["key"], string> = {
                              application: "تطبيق الموقع",
                              database: "قاعدة البيانات",
                              authentication: "تسجيل الدخول والمصادقة",
                              trade_room: "التحديثات المباشرة لغرفة الصفقة",
                              notifications: "الإشعارات داخل الموقع",
                              email: "البريد الإلكتروني للمعاملات",
                            };
                            const healthy = check.status === "healthy";
                            return (
                              <Card key={check.key} className={`bg-black/20 ${healthy ? "border-emerald-500/20" : "border-amber-500/35"}`}>
                                <CardHeader className="pb-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <CardTitle className="text-base">{isArabic ? arabicLabels[check.key] : check.label}</CardTitle>
                                    <span className={`rounded-full border px-2.5 py-1 text-xs ${healthy ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : "border-amber-500/35 bg-amber-500/10 text-amber-300"}`}>
                                      {healthy ? t("Healthy", "يعمل") : t("Review", "مراجعة")}
                                    </span>
                                  </div>
                                </CardHeader>
                                <CardContent className="space-y-2 pt-0 text-sm text-[#D1D5DB]">
                                  <p>{isArabic ? (healthy ? "الخدمة متاحة وتعمل بشكل طبيعي." : "الخدمة تحتاج إلى مراجعة من المالك.") : check.detail}</p>
                                  {typeof check.latencyMs === "number" ? <p className="text-xs text-[#9CA3AF]">{t("Latency", "زمن الاستجابة")}: {check.latencyMs} ms</p> : null}
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      ) : null}

                      <p className="text-xs leading-5 text-[#9CA3AF]">
                        {t(
                          "This screen refreshes every 30 seconds while open. Provider configuration checks confirm readiness without exposing credentials.",
                          "تتجدد هذه الشاشة كل 30 ثانية أثناء فتحها. تتحقق فحوصات الإعداد من الجاهزية من دون إظهار بيانات الدخول السرية.",
                        )}
                      </p>
                    </div>
                  ) : null}

                  {activeSection === "emergency" ? (
                    <div className="space-y-5">
                      <Card className="border-amber-500/30 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <div className="flex items-center gap-2">
                            <Zap className="h-5 w-5 text-amber-400" />
                            <CardTitle className="text-amber-300">{t("Emergency Controls", "إجراءات الطوارئ")}</CardTitle>
                          </div>
                          <CardDescription>{t("Owner-only controls. These actions affect all users and cannot be undone.", "إجراءات للمالك فقط تؤثر في جميع المستخدمين ولا يمكن التراجع عنها.")}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                            <p className="mb-3 text-sm font-medium text-amber-300">{t("Broadcast Notification to All Users", "إرسال إشعار إلى جميع المستخدمين")}</p>
                            <div className="space-y-3">
                              <select value={broadcastType} onChange={(event) => setBroadcastType(event.target.value as typeof broadcastType)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                                <option value="info">{t("Info", "معلومة")}</option>
                                <option value="warning">{t("Warning", "تحذير")}</option>
                                <option value="success">{t("Success", "نجاح")}</option>
                              </select>
                              <p className="text-xs leading-5 text-[#D1D5DB]">
                                {t(
                                  "Complete both editions so every user can read the alert after switching language.",
                                  "أكمل النسختين ليتمكن كل مستخدم من قراءة التنبيه بعد تبديل اللغة.",
                                )}
                              </p>
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-3">
                                  <p className="text-sm font-semibold text-white">{t("English edition", "النسخة الإنجليزية")}</p>
                                  <label htmlFor="broadcast-title-en" className="block text-xs font-medium text-[#D1D5DB]">{t("Title in English", "العنوان بالإنجليزية")}</label>
                                  <Input
                                    id="broadcast-title-en"
                                    lang="en"
                                    dir="ltr"
                                    maxLength={160}
                                    placeholder="Notification title"
                                    value={broadcastTitleEn}
                                    onChange={(event) => setBroadcastTitleEn(event.target.value)}
                                  />
                                  <label htmlFor="broadcast-body-en" className="block text-xs font-medium text-[#D1D5DB]">{t("Body in English", "النص بالإنجليزية")}</label>
                                  <textarea
                                    id="broadcast-body-en"
                                    lang="en"
                                    dir="ltr"
                                    maxLength={2000}
                                    placeholder="Notification body"
                                    value={broadcastBodyEn}
                                    onChange={(event) => setBroadcastBodyEn(event.target.value)}
                                    rows={4}
                                    className="flex w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#C9A227]/40"
                                  />
                                </div>
                                <div className="space-y-3">
                                  <p className="text-sm font-semibold text-white">{t("Arabic edition", "النسخة العربية")}</p>
                                  <label htmlFor="broadcast-title-ar" className="block text-xs font-medium text-[#D1D5DB]">{t("Title in Arabic", "العنوان بالعربية")}</label>
                                  <Input
                                    id="broadcast-title-ar"
                                    lang="ar"
                                    dir="rtl"
                                    maxLength={160}
                                    placeholder="عنوان الإشعار"
                                    value={broadcastTitleAr}
                                    onChange={(event) => setBroadcastTitleAr(event.target.value)}
                                  />
                                  <label htmlFor="broadcast-body-ar" className="block text-xs font-medium text-[#D1D5DB]">{t("Body in Arabic", "النص بالعربية")}</label>
                                  <textarea
                                    id="broadcast-body-ar"
                                    lang="ar"
                                    dir="rtl"
                                    maxLength={2000}
                                    placeholder="نص الإشعار"
                                    value={broadcastBodyAr}
                                    onChange={(event) => setBroadcastBodyAr(event.target.value)}
                                    rows={4}
                                    className="flex w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#C9A227]/40"
                                  />
                                </div>
                              </div>
                              <Button
                                type="button"
                                disabled={!broadcastTitleEn.trim() || !broadcastBodyEn.trim() || !broadcastTitleAr.trim() || !broadcastBodyAr.trim()}
                                onClick={() => void handleBroadcast()}
                                className="border-amber-500/40 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                              >
                                {t("Broadcast to All Users", "إرسال إلى الجميع")}
                              </Button>
                            </div>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                              <p className="mb-2 text-sm font-medium text-red-300">{t("Force Expire Listings", "إنهاء العروض إجباريًا")}</p>
                              <p className="mb-3 text-xs text-[#9CA3AF]">{t("Immediately expire all listings that are past their expiry date.", "أنه جميع العروض التي تجاوزت تاريخ صلاحيتها فورًا.")}</p>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                                onClick={() => {
                                  if (!window.confirm(t("Force-expire all overdue listings? This cannot be undone.", "هل تريد إنهاء جميع العروض المتأخرة إجباريًا؟ لا يمكن التراجع عن ذلك."))) return;
                                  void runAction(fetch("/api/alpha-exchange/admin/listings/force-expire", { method: "POST" }), t("Expired listings force-closed.", "تم إغلاق العروض المنتهية إجباريًا."));
                                }}
                              >
                                {t("Run Now", "تنفيذ الآن")}
                              </Button>
                            </div>
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                              <p className="mb-2 text-sm font-medium text-amber-300">{t("Recalculate All Trust Scores", "إعادة حساب درجات الثقة")}</p>
                              <p className="mb-3 text-xs text-[#9CA3AF]">{t("Trigger a full trust engine recalculation for all sellers.", "ابدأ إعادة حساب كاملة لدرجات ثقة جميع البائعين.")}</p>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                                onClick={() => {
                                  if (!window.confirm(t("Recalculate trust scores now? This may take a moment.", "هل تريد إعادة حساب درجات الثقة الآن؟ قد يستغرق ذلك بعض الوقت."))) return;
                                  const reason = requestReason(t("Reason for recalculating trust scores:", "سبب إعادة حساب درجات الثقة:"), t("Launch trust recalculation", "إعادة حساب الثقة من الإدارة"));
                                  if (!reason) return;
                                  void runAction(fetch("/api/alpha-exchange/admin/trust/recalculate-all", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), t("Trust score recalculation triggered.", "بدأت إعادة حساب درجات الثقة."));
                                }}
                              >
                                {t("Run Now", "تنفيذ الآن")}
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ) : null}

                  {activeSection === "settings" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>{t("Settings", "الإعدادات")}</CardTitle>
                        <CardDescription>{t("Operational controls for Alpha Exchange administration.", "إعدادات تشغيل وإدارة Alpha Exchange.")}</CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-4 md:grid-cols-2">
                        <Card className="border-white/10 bg-black/20">
                          <CardHeader>
                            <CardTitle className="text-base">{t("Security", "الأمان")}</CardTitle>
                            <CardDescription>{t("Admin-only permissions are enforced on every admin endpoint.", "تُفرض صلاحيات الإدارة على جميع نقاط API الإدارية.")}</CardDescription>
                          </CardHeader>
                          <CardContent className="pt-0 text-sm text-[#D1D5DB]">
                            {t("Route:", "المسار:")} <span className="text-white">/api/alpha-exchange/admin/*</span>
                          </CardContent>
                        </Card>
                        <Card className="border-white/10 bg-black/20">
                          <CardHeader>
                            <CardTitle className="text-base">{t("Marketplace Compliance Recovery Wallet", "محفظة استرداد امتثال السوق")}</CardTitle>
                            <CardDescription>{t("Configure once as owner. Every issued Marketplace Recovery Fee auto-populates from this wallet.", "يضبطها المالك مرة واحدة، وتُستخدم تلقائيًا لكل رسم استرداد صادر.")}</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3 pt-0 text-sm text-[#D1D5DB]">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <select
                                value={complianceWalletNetwork}
                                onChange={(event) => setComplianceWalletNetwork(event.target.value as SupportedNetwork)}
                                className="h-10 rounded-lg border border-white/15 bg-[#101010] px-3 text-white"
                              >
                                <option value="TRC20">TRC20</option>
                                <option value="ERC20">ERC20</option>
                                <option value="BEP20">BEP20</option>
                                <option value="SOL">SOL</option>
                              </select>
                              <Input
                                value={complianceWalletAddress}
                                onChange={(event) => setComplianceWalletAddress(event.target.value)}
                                placeholder={t("Platform recovery wallet address", "عنوان محفظة استرداد المنصة")}
                              />
                            </div>
                            <Button type="button" variant="secondary" onClick={() => void handleSaveComplianceRecoveryWallet()}>
                              {t("Save Recovery Wallet", "حفظ محفظة الاسترداد")}
                            </Button>
                            {data.complianceSettings?.recoveryWallet ? (
                              <p className="text-xs text-[#9CA3AF]">
                                {t("Current:", "الحالية:")} <span className="text-white">{data.complianceSettings.recoveryWallet.network}</span> • {data.complianceSettings.recoveryWallet.walletAddress}
                              </p>
                            ) : (
                              <p className="text-xs text-amber-300">{t("No recovery wallet configured yet.", "لم يتم إعداد محفظة استرداد بعد.")}</p>
                            )}
                          </CardContent>
                        </Card>
                      </CardContent>
                    </Card>
                  ) : null}
                </>
              ) : null}
          </div>
        </div>
      </div>

      {selectedSeller ? (
          <div className="alpha-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-seller-dialog-title"
              className="alpha-modal-panel modal-panel max-h-[90vh] w-full max-w-5xl overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 id="admin-seller-dialog-title" className="text-xl font-semibold">{selectedSeller.fullName}</h3>
                <button type="button" aria-label={t("Close seller profile", "إغلاق ملف البائع")} onClick={() => setSelectedSeller(null)} className="rounded-full border border-white/15 p-2 text-[#9CA3AF] transition hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid gap-2 text-sm text-[#D1D5DB]">
                <p>{t("Email:", "البريد الإلكتروني:")} <span className="text-white">{selectedSeller.email}</span></p>
                <p>{t("WhatsApp:", "واتساب:")} <span className="text-white" dir="ltr">{selectedSeller.whatsappNumber}</span></p>
                <p>{t("Member Since:", "عضو منذ:")} <span className="text-white">{formatDate(selectedSeller.createdAt)}</span></p>
                <p>{t("Status:", "الحالة:")} <span className="text-white">{statusLabel(selectedSeller.sellerStatus)}</span></p>
                <p>{t("Availability:", "التوفر:")} <span className="text-white">{statusLabel(selectedSeller.availabilityStatus ?? "available")}</span></p>
                <p>{t("Prestige Rank:", "الرتبة:")} <span className="text-white capitalize">{sellerLevelLabel(selectedSeller.sellerPrestigeRank)}</span></p>
                <p>{t("Lifetime Completed Volume:", "إجمالي حجم الصفقات المكتملة:")} <span className="text-white">{formatUsdt(Math.max(0, Number(selectedSeller.lifetimeCompletedVolumeUsdt ?? 0)))}</span></p>
                {selectedSeller.sellerRankOverride ? (
                  <p>{t("Override:", "التعديل اليدوي:")} <span className="text-white capitalize">{sellerLevelLabel(selectedSeller.sellerRankOverride.rank)}</span> • {selectedSeller.sellerRankOverride.reason}</p>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedSeller.availabilityStatus === "vacation" ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => {
                    if (!window.confirm(t("End vacation mode for this seller?", "هل تريد إنهاء وضع الإجازة لهذا البائع؟"))) return;
                    const reason = requestReason(t("Reason for ending vacation mode:", "سبب إنهاء وضع الإجازة:"), t("Vacation Mode ended.", "تم إنهاء وضع الإجازة."));
                    if (!reason) return;
                    void handleSellerAvailabilityStatus(selectedSeller.id, "available", t("Vacation Mode ended.", "تم إنهاء وضع الإجازة."), reason);
                  }}>
                    {t("End Vacation", "إنهاء الإجازة")}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="secondary" onClick={() => {
                    if (!window.confirm(t("Enable vacation mode for this seller?", "هل تريد تفعيل وضع الإجازة لهذا البائع؟"))) return;
                    const reason = requestReason(t("Reason for enabling vacation mode:", "سبب تفعيل وضع الإجازة:"), t("Vacation Mode enabled.", "تم تفعيل وضع الإجازة."));
                    if (!reason) return;
                    void handleSellerAvailabilityStatus(selectedSeller.id, "vacation", t("Vacation Mode enabled.", "تم تفعيل وضع الإجازة."), reason);
                  }}>
                    {t("Enable Vacation", "تفعيل الإجازة")}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const nextRank = window.prompt(t("Set rank (bronze, silver, gold, diamond, elite)", "حدّد الرتبة (bronze, silver, gold, diamond, elite)"), selectedSeller.sellerPrestigeRank ?? "bronze");
                    if (!nextRank) return;
                    const rankInput = normalizeSellerLevel(nextRank);
                    if (!rankInput) {
                      pushToast(t("Invalid prestige rank.", "الرتبة غير صحيحة."));
                      return;
                    }
                    const reason = window.prompt(t("Override reason", "سبب التعديل"), t("Manual admin override", "تعديل يدوي من الإدارة"));
                    if (!reason) return;
                    void handleSellerPrestigeOverride(selectedSeller.id, rankInput, reason, false);
                  }}
                >
                  {t("Override Rank", "تعديل الرتبة")}
                </Button>
                {selectedSeller.sellerRankOverride ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const reason = window.prompt(t("Reason for clearing override", "سبب إزالة التعديل"), t("Return to automatic progression", "العودة إلى التقدّم التلقائي"));
                      if (!reason) return;
                      void handleSellerPrestigeOverride(selectedSeller.id, selectedSeller.sellerPrestigeRank ?? "bronze", reason, true);
                    }}
                  >
                    {t("Clear Override", "إزالة التعديل")}
                  </Button>
                ) : null}
              </div>

              <div className="mt-6 space-y-4">
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-red-200">{t("Marketplace Compliance", "امتثال السوق")}</p>
                      <p className="mt-1 text-sm text-red-100/90">{t("Issue a manual recovery fee, restrict the seller immediately, restore permissions after verification, or permanently revoke privileges on a second confirmed violation.", "أصدر رسم استرداد يدويًا، أو قيّد البائع فورًا، أو أعد صلاحياته بعد التحقق، أو ألغها نهائيًا عند المخالفة المؤكدة الثانية.")}</p>
                    </div>
                    <Button type="button" variant="secondary" onClick={() => setActiveSection("marketplace-enforcement")}>{t("Open Full Compliance Section", "فتح قسم الامتثال الكامل")}</Button>
                  </div>
                </div>

                {selectedSellerProfileLoading ? (
                  <Card className="border-white/10 bg-[#0B0B0B]/95">
                    <CardContent className="p-4 text-sm text-[#9CA3AF]">{t("Loading marketplace compliance history…", "جارٍ تحميل سجل امتثال السوق...")}</CardContent>
                  </Card>
                ) : selectedSellerProfile?.ownerTools?.marketplaceEnforcement ? (
                  <MarketplaceEnforcementOwnerPanel
                    locale={locale}
                    sellerId={selectedSeller.id}
                    initialStatus={selectedSellerProfile.ownerTools.marketplaceEnforcement}
                  />
                ) : (
                  <Card className="border-white/10 bg-[#0B0B0B]/95">
                    <CardContent className="p-4 text-sm text-[#9CA3AF]">{t("No marketplace compliance history is available for this seller yet.", "لا يوجد سجل امتثال لهذا البائع بعد.")}</CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        ) : null}

      {selectedRequest ? (
          <div className="alpha-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-request-dialog-title"
              className="alpha-modal-panel modal-panel max-h-[90vh] w-full max-w-xl overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 id="admin-request-dialog-title" className="text-xl font-semibold">{t("Purchase Request Details", "تفاصيل طلب الشراء")}</h3>
                <button type="button" aria-label={t("Close request details", "إغلاق تفاصيل الطلب")} onClick={() => setSelectedRequest(null)} className="rounded-full border border-white/15 p-2 text-[#9CA3AF] transition hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid gap-2 text-sm text-[#D1D5DB]">
                <p>{t("Request ID:", "رقم الطلب:")} <span className="font-mono font-medium text-white">{displayRequestId(selectedRequest)}</span></p>
                <p>{t("Trade ID:", "رقم الصفقة:")} <span className="font-mono font-medium text-white">{displayTradeId(selectedRequest)}</span></p>
                <p>{t("Buyer:", "المشتري:")} <span className="text-white">{selectedRequest.buyerName}</span></p>
                <p>{t("WhatsApp:", "واتساب:")} <span className="text-white" dir="ltr">{selectedRequest.buyerWhatsapp}</span></p>
                <p>{t("Listing:", "العرض:")} <span className="font-mono font-medium text-white">{displayListingId(listingById.get(selectedRequest.listingId), selectedRequest.listingId)}</span></p>
                <p>{t("Seller:", "البائع:")} <span className="text-white">{sellersById.get(selectedRequest.sellerId)?.fullName ?? selectedRequest.sellerId}</span></p>
                <p>{t("Status:", "الحالة:")} <span className="text-white">{statusLabel(selectedRequest.status)}</span></p>
                <p>{t("USDT Amount:", "كمية USDT:")} <span className="text-white">{selectedRequest.usdtAmount}</span></p>
                <p>{t("Fiat Amount:", "المبلغ النقدي:")} <span className="text-white">{selectedRequest.fiatAmount} {selectedRequest.currency}</span></p>
                <p>{t("Network:", "الشبكة:")} <span className="text-white">{selectedRequest.network}</span></p>
                <p>{t("Payment Method:", "طريقة الدفع:")} <span className="text-white">{marketplacePaymentMethodLabelForLocale(selectedRequest.paymentMethod, locale)}</span></p>
                <p>{t("Receiving Bank:", "البنك المستلم:")} <span className="text-white">{selectedRequest.bankName ?? "—"}</span></p>
                <p>{t("Submitted:", "تاريخ التقديم:")} <span className="text-white">{formatDate(selectedRequest.createdAt)}</span></p>
                {selectedRequest.completedAt ? <p>{t("Completed:", "اكتملت:")} <span className="text-white">{formatDate(selectedRequest.completedAt)}</span></p> : null}
                {selectedRequest.timedOutAt ? <p>{t("Timed Out:", "انتهت المهلة:")} <span className="text-white">{formatDate(selectedRequest.timedOutAt)}</span></p> : null}
                {selectedRequest.timeoutReason ? <p>{t("Timeout Reason:", "سبب انتهاء المهلة:")} <span className="text-white">{selectedRequest.timeoutReason}</span></p> : null}
                {selectedRequest.reviewUnlockedAt ? <p>{t("Review Unlocked:", "تم فتح التقييم:")} <span className="text-white">{formatDate(selectedRequest.reviewUnlockedAt)}</span></p> : null}
                <p>{t("Notes:", "الملاحظات:")} <span className="text-white">{selectedRequest.buyerNotes || "—"}</span></p>
                <p>
                  {t("Buyer Evidence:", "إثبات المشتري:")}{" "}
                  {selectedRequest.buyerEvidence ? (
                    <a
                      href={`/api/alpha-exchange/purchase-requests/${selectedRequest.id}/evidence/${selectedRequest.buyerEvidence.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#C9A227] underline-offset-2 hover:underline"
                    >
                      {selectedRequest.buyerEvidence.fileName}
                    </a>
                  ) : (
                    <span className="text-white">{t("Missing", "مفقود")}</span>
                  )}
                </p>
                <p>
                  {t("Seller Evidence:", "إثبات البائع:")}{" "}
                  {selectedRequest.sellerEvidence ? (
                    <a
                      href={`/api/alpha-exchange/purchase-requests/${selectedRequest.id}/evidence/${selectedRequest.sellerEvidence.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#C9A227] underline-offset-2 hover:underline"
                    >
                      {selectedRequest.sellerEvidence.fileName}
                    </a>
                  ) : (
                    <span className="text-white">{t("Missing", "مفقود")}</span>
                  )}
                </p>
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-sm font-medium text-white">{t("Timeline", "سجل الصفقة")}</p>
                <div className="mt-2 space-y-2 text-xs text-[#D1D5DB]">
                  {(selectedRequest.timeline ?? []).map((event) => (
                    <div key={event.id} className="flex items-start gap-2">
                      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#C9A227]" />
                      <span>{formatDate(event.createdAt)} — {timelineEventLabel(event)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {selectedRequest.buyerReview ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                  <p className="text-sm font-medium text-white">{t("Buyer Review", "تقييم المشتري")}</p>
                  <p className="mt-2">{selectedRequest.buyerReview.comment}</p>
                </div>
              ) : null}
              {selectedRequest.sellerResponse ? (
                <div className="mt-3 rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                  <p className="text-sm font-medium text-white">{t("Seller Response", "رد البائع")}</p>
                  <p className="mt-2">{selectedRequest.sellerResponse.message}</p>
                </div>
              ) : null}
              {selectedRequest.status !== "completed" && selectedRequest.status !== "cancelled" && selectedRequest.status !== "declined" ? (
                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <p className="mb-3 text-sm font-medium text-amber-300">{t("Admin Actions", "إجراءات الإدارة")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => void handleForceComplete(selectedRequest.id)} className="border-[#C9A227]/40 bg-[#C9A227]/20 text-[#C9A227] hover:bg-[#C9A227]/30">
                      {t("Force Complete", "إكمال إجباري")}
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleForceCancel(selectedRequest.id)} className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20">
                      {t("Force Cancel", "إلغاء إجباري")}
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleUnlockReview(selectedRequest.id)}>
                      {t("Unlock Review", "فتح التقييم")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

      {rankConfirmPending ? (
          <div
            className="alpha-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => { setRankConfirmPending(null); setRankConfirmReason(""); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-rank-dialog-title"
              className="alpha-modal-panel w-full max-w-md rounded-2xl border border-white/15 bg-[#0D0D0D] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.7)]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="mb-5">
                <div className="flex items-center gap-3 mb-1">
                  <Trophy className="h-5 w-5 text-[#C9A227]" />
                  <h3 id="admin-rank-dialog-title" className="text-base font-semibold text-white">{t("Change Seller Rank?", "تغيير رتبة البائع؟")}</h3>
                </div>
                <p className={`text-xs text-[#9CA3AF] ${isArabic ? "pr-8" : "pl-8"}`}>{t("This will immediately update the seller’s public marketplace appearance.", "سيُحدّث ذلك مظهر البائع في السوق فورًا.")}</p>
              </div>

              {/* Seller info */}
              <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="text-xs text-[#9CA3AF] mb-2">{t("You’re about to change:", "أنت على وشك تغيير:")}</p>
                <p className="text-sm font-medium text-white mb-3">{rankConfirmPending.sellerName}</p>
                <div className="flex items-center gap-3">
                  <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] ${RANK_BADGE_COLOR[rankConfirmPending.fromRank]}`}>
                    {sellerLevelLabel(rankConfirmPending.fromRank)}
                  </span>
                  <span className="text-[#9CA3AF] text-xs">→</span>
                  <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] ${RANK_BADGE_COLOR[rankConfirmPending.toRank]}`}>
                    {sellerLevelLabel(rankConfirmPending.toRank)}
                  </span>
                </div>
              </div>

              {/* Optional reason */}
              <div className="mb-6">
                <label className="block text-xs font-medium text-[#9CA3AF] mb-1.5">
                  {t("Reason", "السبب")} <span className="text-[#6B7280]">{t("(optional — saved in audit log)", "(اختياري — يُحفظ في سجل النشاط)")}</span>
                </label>
                <textarea
                  value={rankConfirmReason}
                  onChange={(e) => setRankConfirmReason(e.target.value)}
                  placeholder={t("e.g. Outstanding reputation and consistently high trade completion rate.", "مثال: سمعة ممتازة ونسبة إكمال صفقات مرتفعة باستمرار.")}
                  rows={2}
                  maxLength={300}
                  className="w-full resize-none rounded-lg border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white placeholder:text-[#4B5563] focus:border-[#C9A227]/50 focus:outline-none"
                />
                {rankConfirmReason.length > 0 && (
                  <p className="mt-1 text-right text-[10px] text-[#6B7280]">{rankConfirmReason.length}/300</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1 border-white/15 bg-white/[0.05] text-[#D1D5DB] hover:bg-white/10"
                  onClick={() => { setRankConfirmPending(null); setRankConfirmReason(""); }}
                >
                  {t("Cancel", "إلغاء")}
                </Button>
                <Button
                  type="button"
                  className="flex-1 border-[#C9A227]/40 bg-[#C9A227]/15 text-[#C9A227] hover:bg-[#C9A227]/25"
                  onClick={() => void handleRankConfirm()}
                >
                  {t("Confirm", "تأكيد")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

      {toast ? (
          <div className="alpha-reveal-rise fixed bottom-5 end-5 z-50 rounded-full border border-[#C9A227]/35 bg-[#0B0B0B]/95 px-4 py-2 text-sm text-white shadow-[0_14px_34px_rgba(0,0,0,0.4)]">
            {toast}
          </div>
        ) : null}
    </section>
  );
}
