"use client";
import { sellerFeeResponsibilityNotice } from "@alpha-traders/contracts";
import { calculateFiatAmount, calculateTradeBuyerFiatFee, calculateTradePaymentTotal } from "@alpha-traders/contracts";


import { brandText, currencyText, moneyText } from "@/components/ui/currency-text";
import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { isCardlessWithdrawalBank, parseCardlessWithdrawalDetails, validateCardlessIlsAmount, calculateCardlessUsdtAmount, type CardlessVerificationKind } from "@alpha-traders/contracts";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, BadgePercent, BellRing, CheckCircle2, ChevronDown, Clock3, Copy, Crown, Edit3, HandCoins, Loader2, LockKeyhole, MessageCircle, Network, ShieldCheck, Sparkles, Star, Store, TrendingUp, Trophy, Upload, Users, Wallet, WalletCards, X, Zap } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AccountWelcome } from "@/components/ui/account-welcome";
import { ExchangeWorkspaceNavigation, type ExchangeWorkspaceAction } from "@/components/sections/usdt-exchange/exchange-workspace-navigation";
import { useDesktopWorkspace } from "@/components/sections/usdt-exchange/use-desktop-workspace";
import { BuyerRankCard } from "@/components/ui/buyer-rank-card";
import { SellerRankCard } from "@/components/ui/seller-rank-card";
import { useSellerRankSummary } from "@/components/sections/usdt-exchange/use-seller-rank-summary";
import { RankBadge, RankEmblem } from "@/components/ui/rank-badge";
import { accountRoleIdentity } from "@/lib/account-role-identity";
import { rankSurfaceTone } from "@/lib/rank-identity";
import { PublicAccountId } from "@/components/ui/public-account-id";
import { publicAccountId } from "@/lib/public-account-identity";
import { RoleBadge } from "@/components/ui/role-badge";
import { useMarketFeed } from "@/components/market/use-market-feed";
import type { DiscordListingSharingStatus } from "@/components/sections/usdt-exchange/discord-share-action";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { hasRole } from "@/lib/roles";
import { getSellerApplicationEligibility } from "@/lib/seller-application-eligibility";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { useAuthenticatedNotificationStream } from "@/components/notifications/use-authenticated-notification-stream";
import type { ClientSessionUser } from "@/lib/client-session-user";
import { parseIsraeliBankSelection, serializeIsraeliBankSelection } from "@/lib/israeli-banks";
import { getDefaultListingPaymentMethods, isCardlessAtmPaymentMethod, isCashTradePaymentMethod, MAX_LISTING_PAYMENT_METHODS, normalizeMarketplacePaymentMethod, requiresIsraeliBankSelection, requiresSellerPayoutBankAccount, resolveListingPaymentMethods } from "@/lib/marketplace-payment-methods";
import { CLIENT_COMMISSION_WALLETS, type CommissionNetworkId, type CommissionWalletConfiguration } from "@/lib/commission-config";
import { appendLoginJourneyServerTimeline, appendLoginJourneyStep, finalizeLoginJourneyRedirectEnd, incrementLoginJourneyApiCall, isLoginJourneyTraceEnabled } from "@/lib/login-journey-trace";
import { formatListingId, formatTradeId } from "@/lib/format-id";
import { replaceExchangeEntityIdsWithHints } from "@/lib/alpha-exchange-display";
import { prefetchTradeRoom } from "@/lib/trade-room-client";
import { canBuyerCancelTrade } from "@/lib/trade-room-actions";
import { getTradeRoomConversationDestination } from "@/lib/trade-room-notification-destination";
import { commissionPaymentDestination, getCommissionPaymentNotificationDestination } from "@/lib/commission-payment-destination";
import { groupOwnTrades } from "@/lib/trades-workspace";
import { getCommissionWorkspaceAction, sortDashboardActivityNewestFirst } from "@/lib/dashboard-workspace";
import {
  getExplicitNonTradeRoomNotificationDestination,
  getSafeInternalNotificationDestination,
} from "@/lib/notification-action-destination";
import { getWalletAddressValidationError, normalizeWalletAddress } from "@/lib/wallet-address";
import { useLiveUserPresence, useLivePresenceMap } from "@/lib/user-presence-client";
import { formatMeasuredResponseTime } from "@alpha-traders/contracts";
import { deriveListingCountdown, deriveSellerPresence } from "@/lib/seller-presence";
import { LISTING_CHANGE_REASONS, listingEditRequiresReason, validateListingChangeReason } from "@/lib/listing-change-reasons";
import { publicAccountName } from "@/lib/public-account-identity";
import { sortNotificationsNewestFirst } from "@/lib/notification-sort";
import { formatNotificationRelativeTime } from "@/lib/notification-time";
import { containsArabicText, localizeActivityCopy, localizeNotificationActionLabel, localizeNotificationCopy } from "@/lib/notification-localization";
import { calculateSellerMarketplaceInsights } from "@/lib/marketplace-insights";
import { cn } from "@/lib/utils";
import { getOfficialOwnerWhatsAppUrl } from "@/lib/official-contact";
import { deriveBuyerRankSummary, type BuyerRankSummary } from "@/lib/buyer-rank";
import { purchaseBlockDestination, readPurchaseResponse } from "@/lib/purchase-response";
import { navigateAfterSuccess } from "@/lib/client-success-navigation";
import { isPayoutBankSupported, syncListingBankSelection } from "@/lib/seller-listing-bank-selection";
import { getPriceOfferBounds, normalizePriceOfferInput, validatePriceOffer } from "@/lib/price-offer";
import { normalizeLocalizedDecimalInput, normalizeTradeAmountInput } from "@/lib/trade-amount";
import { ISRAEL_TIME_ZONE } from "@/lib/israel-calendar";
import type { AlphaExchangeActivityLogEntry, AlphaExchangeNotification, AuditAction, ListingStatus, MarketplaceListing, NotificationCategory, PremiumSellerProfileData, PurchaseRequest, SellerApplication, SellerBadge, SellerLevel, SellerStatus, SupportedNetwork, TradeTimelineEntry } from "@/types/alpha-exchange";
import type { SellerApplicationForm, SellerApplicationMethod } from "@/components/sections/usdt-exchange/seller-application-section";

const PurchaseListingDialog = dynamic(
  () => import("@/components/sections/usdt-exchange/purchase-listing-dialog").then((module) => module.PurchaseListingDialog),
  { ssr: false, loading: PurchaseDialogLoading },
);

const SellerApplicationSection = dynamic(
  () => import("@/components/sections/usdt-exchange/seller-application-section").then((module) => module.SellerApplicationSection),
  { ssr: false, loading: DeferredSectionLoading },
);

const SellerWorkspaceSection = dynamic(
  () => import("@/components/sections/usdt-exchange/seller-workspace-section").then((module) => module.SellerWorkspaceSection),
  { ssr: false, loading: WorkspaceSectionLoading },
);

const BuyerWorkspaceSection = dynamic(
  () => import("@/components/sections/usdt-exchange/buyer-workspace-section").then((module) => module.BuyerWorkspaceSection),
  { ssr: false, loading: WorkspaceSectionLoading },
);

const SellerListingsWorkspacePortal = dynamic(
  () => import("@/components/sections/usdt-exchange/seller-listings-workspace-portal").then((module) => module.SellerListingsWorkspacePortal),
  { ssr: false },
);

function DeferredSectionLoading() {
  return <div className="mt-10 h-64 animate-pulse rounded-3xl border border-white/10 bg-white/[0.03]" aria-label="Loading" />;
}

function WorkspaceSectionLoading() {
  return (
    <div className="mt-6 grid gap-4" aria-label="Loading workspace">
      <div className="h-32 animate-pulse rounded-3xl border border-white/10 bg-white/[0.03]" />
      <div className="h-48 animate-pulse rounded-3xl border border-white/10 bg-white/[0.03]" />
    </div>
  );
}

function PurchaseDialogLoading() {
  return (
    <div className="alpha-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="status" aria-label="Loading purchase form">
      <div className="h-72 w-full max-w-[700px] animate-pulse rounded-3xl border border-white/10 bg-[#0B0B0B]/95" />
    </div>
  );
}

const WHATSAPP_URL = getOfficialOwnerWhatsAppUrl();
const MAX_EVIDENCE_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const MOBILE_VIEWPORT_QUERY = "(max-width: 768px)";
const MOBILE_MARKETPLACE_BATCH_SIZE = 6;
const MAX_ACTIVITY_ITEMS = 60;
const MAX_NOTIFICATION_ITEMS = 60;
const MAX_PRICE_MARKUP_ILS = 0.35;
const DEFAULT_MARKET_PRICE_PER_USDT = 3.05;
const DEFAULT_RESPONSE_TIME = "5 min";
export const BUYER_TRADE_HISTORY_SECTION_ID = "my-trade-requests-section";

function focusWorkspaceSection(sectionId: string) {
  if (typeof document === "undefined") return false;
  const invocationTarget = document.activeElement;
  let trackedTarget = document.getElementById(sectionId);
  let hasScrolledToTarget = false;
  let pendingAnimationFrame: number | null = null;
  let stopped = false;
  let observer: MutationObserver | null = null;
  const timeoutIds: number[] = [];

  const stopRestoringFocus = () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    if (pendingAnimationFrame !== null) window.cancelAnimationFrame(pendingAnimationFrame);
    for (const timeoutId of timeoutIds) window.clearTimeout(timeoutId);
    document.removeEventListener("pointerdown", stopRestoringFocus, true);
    document.removeEventListener("keydown", stopRestoringFocus, true);
    document.removeEventListener("focusin", restoreUnexpectedFocus, true);
  };

  const restoreFocusAfterRender = () => {
    if (stopped) return;
    const target = document.getElementById(sectionId);
    if (!target) return;
    if (!hasScrolledToTarget) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      hasScrolledToTarget = true;
    }
    const activeElement = document.activeElement;
    if (activeElement && target.contains(activeElement)) {
      trackedTarget = target;
      return;
    }
    const focusCanBeRestored = !activeElement
      || activeElement === document.body
      || activeElement === document.documentElement
      || activeElement === invocationTarget
      || activeElement === trackedTarget
      || !activeElement.isConnected;
    if (!focusCanBeRestored) return;
    target.focus({ preventScroll: true });
    trackedTarget = target;
  };

  const scheduleFocusRestore = () => {
    if (stopped || pendingAnimationFrame !== null) return;
    pendingAnimationFrame = window.requestAnimationFrame(() => {
      pendingAnimationFrame = null;
      restoreFocusAfterRender();
    });
  };

  function restoreUnexpectedFocus(event: FocusEvent) {
    const target = document.getElementById(sectionId);
    if (!target || (event.target instanceof Node && target.contains(event.target))) return;
    scheduleFocusRestore();
  }

  observer = new MutationObserver(() => {
    const target = document.getElementById(sectionId);
    const activeElement = document.activeElement;
    if (
      target !== trackedTarget
      || !trackedTarget?.isConnected
      || !activeElement
      || activeElement === document.body
      || activeElement === document.documentElement
    ) {
      scheduleFocusRestore();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("focusin", restoreUnexpectedFocus, true);
  // Register user-intent cancellation after the activation event that invoked
  // this helper has finished propagating. Otherwise the same Enter key can
  // cancel focus restoration before an async workspace render completes.
  timeoutIds.push(window.setTimeout(() => {
    if (stopped) return;
    document.addEventListener("pointerdown", stopRestoringFocus, true);
    document.addEventListener("keydown", stopRestoringFocus, true);
  }, 100));
  restoreFocusAfterRender();
  scheduleFocusRestore();
  for (const delayMs of [100, 250, 500, 1_000, 2_000, 4_000]) {
    timeoutIds.push(window.setTimeout(restoreFocusAfterRender, delayMs));
  }
  timeoutIds.push(window.setTimeout(stopRestoringFocus, 8_000));
  return true;
}

export const ISRAELI_BANKS = [
  { id: "hapoalim", name: "Bank Hapoalim", code: "בנק הפועלים", brandPrimary: "#E31C23", brandSecondary: "#B01016", accent: "#FCA5A5" },
  { id: "leumi", name: "Bank Leumi", code: "בנק לאומי", brandPrimary: "#2458A6", brandSecondary: "#1D4B8F", accent: "#93C5FD" },
  { id: "mizrahi-tefahot", name: "Mizrahi-Tefahot", code: "מזרחי טפחות", brandPrimary: "#F58220", brandSecondary: "#C8600E", accent: "#FDBA74" },
  { id: "discount", name: "Discount", code: "דיסקונט", brandPrimary: "#148A79", brandSecondary: "#0F7668", accent: "#5EEAD4" },
  { id: "fibi", name: "First International", code: "הבינלאומי", brandPrimary: "#7C3AED", brandSecondary: "#6D28D9", accent: "#C4B5FD" },
  { id: "mercantile", name: "Mercantile", code: "מרכנתיל", brandPrimary: "#0B5CAD", brandSecondary: "#073F7A", accent: "#93C5FD" },
  { id: "yahav", name: "Yahav", code: "יהב", brandPrimary: "#2563EB", brandSecondary: "#1E40AF", accent: "#BFDBFE" },
  { id: "jerusalem", name: "Jerusalem", code: "בנק ירושלים", brandPrimary: "#1F2937", brandSecondary: "#111827", accent: "#D1D5DB" },
] as const;

const PAYMENT_METHOD_META: Record<string, { emoji: string; shortLabel: string }> = {
  "Bank Transfer": { emoji: "🏦", shortLabel: "Bank Transfer" },
  "Face-to-Face (Meet in Person)": { emoji: "🤝", shortLabel: "Meet in Person" },
  "Cardless ATM Withdrawal": { emoji: "🏧", shortLabel: "Cardless ATM" },
};

export function spokenLanguageLabel(language: string, isAr: boolean) {
  if (!isAr) return language;
  const normalized = language.trim().toLowerCase();
  if (["english", "en", "الإنجليزية", "الانجليزية"].includes(normalized)) return "الإنجليزية";
  if (["arabic", "ar", "العربية"].includes(normalized)) return "العربية";
  if (["hebrew", "he", "العبرية", "עברית"].includes(normalized)) return "العبرية";
  return containsArabicText(language) ? language : "لغة إضافية";
}

export function sellerAccountStatusLabel(status: SellerStatus | null | undefined, isAr: boolean) {
  const normalized = status ?? "buyer";
  const labels: Record<SellerStatus, { ar: string; en: string }> = {
    buyer: { ar: "مشتري", en: "Buyer" },
    pending_seller_approval: { ar: "طلب البائع قيد المراجعة", en: "Seller application pending" },
    approved_seller: { ar: "بائع معتمد", en: "Approved seller" },
    rejected: { ar: "طلب البائع مرفوض", en: "Seller application rejected" },
    suspended: { ar: "حساب البائع معلّق", en: "Seller account suspended" },
  };
  return labels[normalized][isAr ? "ar" : "en"];
}

type Locale = "ar" | "en";

type WorkspaceMode = "buyer" | "seller";

export type ListingCreateResult = {
  tone: "success" | "error";
  message: string;
};

export type SellerCommissionStatus = {
  status: "clear" | "pending" | "overdue";
  pendingCount: number;
  amountDue: number;
  totalAmountDue?: number;
  payableAmountDue?: number;
  dueAt?: string;
  commissionId?: string;
  selectionError?: string;
  relatedRequestId?: string;
  relatedTradeId?: string;
  relatedTradeDisplayNumber?: number;
  source?: string;
  issueReason?: string;
  payableRecords?: Array<{
    feePolicyVersion?: "buyer_seller_1pct_v1";
    sellerFeeAmount?: number;
    buyerFeeCollectedAmount?: number;
    commissionId: string;
    amountDue: number;
    paymentAmountDue?: number;
    paymentVerificationStatus?: "pending_verification" | "verified" | "failed";
    paymentVerificationNotes?: string;
    paymentSignature?: string;
    paymentSubmittedAt?: string;
    paymentNetwork?: string;
    paymentExpectedAmountMode?: "unique_v1" | "legacy_base";
    dueAt?: string;
    relatedRequestId?: string;
    relatedTradeId?: string;
    relatedTradeDisplayNumber?: number;
    source?: string;
    issueReason?: string;
  }>;
};

export type SessionUser = ClientSessionUser;

export function canCancelBuyerHistoryRequest(request: PurchaseRequest, actorUserId?: string) {
  return Boolean(actorUserId && canBuyerCancelTrade(request, actorUserId));
}

type FeatureCard = {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
};

export type SellerBankAccount = {
  id: string;
  accountHolderName: string;
  bankName: string;
  branchNumber: string;
  accountLast4: string;
  maskedAccountNumber?: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
};

export function toNumber(value: string | number | null | undefined) {
  const normalized = String(value ?? "");
  return Number(normalized.replace(/[^\d.]/g, "")) || 0;
}

function availableAmountScaleClass(value: string | number | null | undefined) {
  const digits = Math.max(1, Math.trunc(Math.abs(toNumber(value))).toString().length);
  if (digits >= 7) return "seller-asset-usdt-value--compact";
  if (digits >= 6) return "seller-asset-usdt-value--tight";
  if (digits >= 4) return "seller-asset-usdt-value--balanced";
  return "seller-asset-usdt-value--hero";
}

function parseMinutes(value: string | number | null | undefined) {
  const normalized = String(value ?? "");
  const number = Number(normalized.replace(/[^\d.]/g, ""));
  if (Number.isNaN(number) || number <= 0) return 0;
  return number;
}

export function safeText(value: unknown, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

export function marketReferenceLabel(reference: string | null | undefined, source: string | null | undefined, isAr: boolean) {
  const rawLabel = safeText(reference, safeText(source, ""));
  const normalized = rawLabel.toLowerCase().replace(/[_-]+/g, " ").trim();

  if (normalized.includes("coinbase") && normalized.includes("spot")) {
    return isAr ? "سوق Coinbase الفوري" : "Coinbase spot market";
  }
  if (normalized.includes("marketplace reference") || normalized.includes("alpha reference")) {
    return isAr ? "مرجع سوق Alpha Traders" : "Alpha Traders market reference";
  }
  if (isAr && rawLabel && !containsArabicText(rawLabel)) return "مصدر تسعير موثوق";
  return rawLabel || (isAr ? "مصدر تسعير موثوق" : "Trusted pricing source");
}

export function localizedTimelineMessage(event: TradeTimelineEntry, isAr: boolean) {
  if (!isAr) return event.message;
  if (containsArabicText(event.message)) return event.message;
  const offeredPrice = event.message.match(/₪(\d+(?:\.\d{1,2})?)/)?.[1];
  if (event.type === "price_offer_submitted") return offeredPrice ? `قدّم المشتري عرض سعر بقيمة ₪${offeredPrice} لكل USDT.` : "قدّم المشتري عرض سعر.";
  if (event.type === "price_offer_accepted") return offeredPrice ? `وافق البائع على عرض السعر بقيمة ₪${offeredPrice} لكل USDT.` : "وافق البائع على عرض السعر.";
  if (event.type === "price_offer_declined") return offeredPrice ? `رفض البائع عرض السعر بقيمة ₪${offeredPrice} لكل USDT.` : "رفض البائع عرض السعر.";
  const labels: Record<TradeTimelineEntry["type"], string> = {
    request_submitted: "أرسل المشتري طلب الصفقة.",
    price_offer_submitted: "قدّم المشتري عرض سعر.",
    request_accepted: "وافق البائع على طلب الصفقة.",
    price_offer_accepted: "وافق البائع على عرض السعر.",
    payment_sent: "أكد المشتري إرسال الدفعة.",
    seller_confirmed_funds: "أكد البائع استلام الدفعة.",
    usdt_release_started: "بدأت مرحلة إرسال USDT.",
    usdt_sent: "أكد البائع إرسال USDT.",
    trade_completed: "اكتملت الصفقة بنجاح.",
    trade_timed_out: "انتهت مهلة الصفقة.",
    trade_locked: "تم قفل الصفقة للمراجعة.",
    review_unlocked: "أصبح تقييم الصفقة متاحاً.",
    dispute_opened: "تم فتح نزاع على الصفقة.",
    dispute_resolved: "تم حل النزاع ويمكن متابعة الصفقة.",
    commission_recorded: "تم تسجيل عمولة الصفقة.",
    commission_paid: "تم تأكيد دفع العمولة.",
    buyer_evidence_uploaded: "رفع المشتري إثبات الدفع.",
    seller_evidence_uploaded: "رفع البائع إثبات إرسال USDT.",
    request_declined: "رفض البائع طلب الصفقة.",
    price_offer_declined: "رفض البائع عرض السعر.",
    request_cancelled: "تم إلغاء طلب الصفقة.",
    buyer_confirmed_receipt: "أكد المشتري استلام USDT.",
    buyer_confirmation_overdue: "تأخر تأكيد المشتري للاستلام.",
    trade_closed_manually: "تم إغلاق الصفقة يدوياً.",
    trade_inactivity_warning_sent: "تم إرسال تنبيه بسبب عدم النشاط.",
    bank_details_revealed: "أصبحت تفاصيل التحويل البنكي متاحة للمشتري.",
  };
  return labels[event.type] ?? "تم تحديث حالة الصفقة.";
}

export function localizedAuditAction(action: AuditAction | string, isAr: boolean) {
  if (!isAr) {
    return action
      .split("_")
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ");
  }

  const labels: Partial<Record<AuditAction, string>> = {
    seller_approved: "الموافقة على البائع",
    seller_rejected: "رفض طلب البائع",
    seller_suspended: "تعليق حساب البائع",
    seller_reactivated: "إعادة تفعيل البائع",
    seller_featured: "تمييز البائع",
    seller_hidden: "إخفاء ملف البائع",
    seller_unhidden: "إظهار ملف البائع",
    listing_created: "إنشاء إعلان",
    listing_expired: "انتهاء الإعلان",
    listing_renewed: "تجديد الإعلان",
    listing_expiration_extended: "تمديد صلاحية الإعلان",
    listing_edited: "تعديل الإعلان",
    listing_paused: "إيقاف الإعلان مؤقتاً",
    listing_resumed: "استئناف الإعلان",
    listing_matched: "مطابقة الإعلان مع طلب",
    listing_reopened: "إعادة فتح الإعلان",
    listing_completed: "اكتمال الإعلان",
    listing_cancelled: "إلغاء الإعلان",
    listing_closed: "إغلاق الإعلان",
    listing_removed: "إزالة الإعلان",
    purchase_request_submitted: "إرسال طلب شراء",
    purchase_completed: "اكتمال عملية الشراء",
    commission_recorded: "تسجيل العمولة",
    commission_paid: "دفع العمولة",
    commission_overdue: "تأخر دفع العمولة",
    seller_vacation_enabled: "تفعيل وضع الإجازة",
    seller_vacation_disabled: "إيقاف وضع الإجازة",
    trade_timed_out: "انتهاء مهلة الصفقة",
    admin_override: "تعديل إداري",
    trade_review_submitted: "إرسال تقييم الصفقة",
    trade_review_responded: "الرد على تقييم الصفقة",
    trust_score_updated: "تحديث درجة الثقة",
    beta_invite_created: "إنشاء دعوة تجريبية",
    beta_invite_expired: "انتهاء الدعوة التجريبية",
    beta_invite_disabled: "تعطيل الدعوة التجريبية",
    beta_feedback_status_updated: "تحديث حالة الملاحظات",
    beta_announcement_created: "إنشاء إعلان تجريبي",
    beta_announcement_updated: "تحديث إعلان تجريبي",
    admin_announcement_started: "بدء الإعلان الإداري",
    admin_announcement_completed: "اكتمال الإعلان الإداري",
    trade_evidence_uploaded: "رفع إثبات الصفقة",
    trade_evidence_replaced: "استبدال إثبات الصفقة",
    trade_evidence_viewed_by_owner: "عرض المالك لإثبات الصفقة",
    trade_evidence_viewed_by_moderator: "عرض المشرف لإثبات الصفقة",
    trade_evidence_downloaded: "تنزيل إثبات الصفقة",
    seller_prestige_promoted: "ترقية مستوى البائع",
    seller_prestige_overridden: "تعديل مستوى البائع إدارياً",
    marketplace_enforcement_fee_issued: "إصدار رسوم امتثال السوق",
    marketplace_enforcement_fee_paid: "دفع رسوم امتثال السوق",
    marketplace_enforcement_restriction_removed: "إزالة قيود السوق",
    marketplace_enforcement_seller_revoked: "سحب صلاحية البائع",
    seller_bank_account_added: "إضافة حساب بنكي للبائع",
    seller_bank_account_updated: "تحديث حساب بنكي للبائع",
    seller_bank_account_deleted: "حذف حساب بنكي للبائع",
    trade_closed_manually: "إغلاق الصفقة يدوياً",
    trade_inactivity_warning_sent: "إرسال تنبيه عدم نشاط",
    trade_bank_details_revealed: "إظهار تفاصيل التحويل البنكي",
  };
  return labels[action as AuditAction] ?? "إجراء إداري";
}

export function formatIsraelMarketTime(value: string | null | undefined, isAr: boolean) {
  if (!value) return "--:--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return parsed.toLocaleTimeString(isAr ? "ar-IL-u-nu-latn" : "en-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ISRAEL_TIME_ZONE,
  });
}

export function marketTrendAriaLabel(pairLabel: string, isAr: boolean) {
  return isAr
    ? `رسم بياني مصغّر لحركة سعر ${pairLabel}`
    : `${pairLabel} price trend chart`;
}

export function CompactTradeTimeline({ events, isAr }: { events: TradeTimelineEntry[]; isAr: boolean }) {
  const compactEvents = [...events]
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .reduce<Array<{ event: TradeTimelineEntry; count: number; message: string }>>((items, event) => {
      const message = localizedTimelineMessage(event, isAr);
      const previous = items[items.length - 1];
      if (previous?.event.type === event.type && previous.message === message) {
        previous.count += 1;
        previous.event = event;
        return items;
      }
      items.push({ event, count: 1, message });
      return items;
    }, []);
  const recentEvents = compactEvents.slice(-3);
  const olderEvents = compactEvents.slice(0, -3);
  const renderEvent = ({ event, count, message }: (typeof compactEvents)[number]) => (
    <div key={event.id} className="flex items-start gap-2 text-sm leading-6">
      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#C9A227]" />
      <span className="min-w-0 text-[#D1D5DB]">
        <span className="me-1 text-xs text-[#9CA3AF]">
          {new Date(event.createdAt).toLocaleTimeString(isAr ? "ar-IL-u-nu-latn" : "en-IL", { hour: "2-digit", minute: "2-digit", timeZone: ISRAEL_TIME_ZONE })}
        </span>
        {currencyText(message)}
        {count > 1 ? <span className="ms-1 text-xs text-[#9CA3AF]">×{count}</span> : null}
      </span>
    </div>
  );

  if (!compactEvents.length) return null;
  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-sm font-semibold text-white">{isAr ? "آخر تحديثات الصفقة" : "Latest trade updates"}</p>
      {olderEvents.length ? (
        <details className="group rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-[#D1D5DB]">
            <span>{currencyText(isAr ? `عرض ${olderEvents.length.toLocaleString("ar-IL-u-nu-latn")} تحديثات سابقة` : `Show ${olderEvents.length} earlier update${olderEvents.length === 1 ? "" : "s"}`)}</span>
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-2 space-y-2 border-t border-white/10 pt-2">{olderEvents.map(renderEvent)}</div>
        </details>
      ) : null}
      <div className="space-y-2">{recentEvents.map(renderEvent)}</div>
    </div>
  );
}

export function LocalizedEvidenceFileInput({
  id,
  isAr,
  selectedFile,
  onSelect,
}: {
  id: string;
  isAr: boolean;
  selectedFile: File | null;
  onSelect: (file: File | null) => void;
}) {
  const fileNameId = `${id}-file-name`;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
      <label
        htmlFor={id}
        className="relative inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium text-white transition hover:border-[#C9A227]/45 hover:bg-[#C9A227]/10 focus-within:ring-2 focus-within:ring-[#C9A227]/40"
      >
        <input
          id={id}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf"
          aria-label={isAr ? "اختيار ملف الإثبات" : "Choose evidence file"}
          aria-describedby={fileNameId}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(event) => onSelect(event.target.files?.[0] ?? null)}
        />
        <Upload className="h-4 w-4 text-[#F4D87A]" aria-hidden="true" />
        <span>{isAr ? "اختيار ملف" : "Choose file"}</span>
      </label>
      <span id={fileNameId} className="min-w-0 break-all text-sm leading-5 text-[#D1D5DB]" aria-live="polite">
        {currencyText(selectedFile?.name ?? (isAr ? "لم يتم اختيار ملف" : "No file selected"))}
      </span>
    </div>
  );
}

export function formatIls(value: number) {
  return `₪${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatUsdt(value: number) {
  return `${Math.trunc(value).toLocaleString("en-US")} USDT`;
}

function formatCommissionUsdt(value: number) {
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDT`;
}

export function formatExactCommissionUsdt(value: number) {
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  })} USDT`;
}

export function formatIsraelDateKey(value: string | number | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: ISRAEL_TIME_ZONE,
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function groupActivityEntriesByDay(entries: AlphaExchangeActivityLogEntry[], locale: Locale) {
  const sorted = [...entries].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const grouped = new Map<string, AlphaExchangeActivityLogEntry[]>();
  for (const entry of sorted) {
    const dayKey = formatIsraelDateKey(entry.createdAt);
    if (!dayKey) continue;
    grouped.set(dayKey, [...(grouped.get(dayKey) ?? []), entry]);
  }
  return Array.from(grouped.entries()).map(([dayKey, items]) => ({
    dayKey,
    label: new Intl.DateTimeFormat(locale === "ar" ? "ar-IL-u-nu-latn" : "en-IL", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: ISRAEL_TIME_ZONE,
    }).format(new Date(items[0]?.createdAt ?? `${dayKey}T12:00:00.000Z`)),
    items,
  }));
}

export function formatIntegerForInput(value: string | number | null | undefined) {
  const raw = String(value ?? "").replace(/[^\d]/g, "");
  if (!raw) return "";
  return Number(raw).toLocaleString("en-IL");
}

export function normalizeDecimalInput(value: string | number | null | undefined) {
  return normalizeLocalizedDecimalInput(value, {
    maximumFractionDigits: 2,
    maximumWholeDigits: 7,
  });
}

export function renderBankLogo(bank: (typeof ISRAELI_BANKS)[number]) {
  if (bank.id === "hapoalim") {
    return (
      <svg viewBox="0 0 56 56" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="52" height="52" rx="14" fill="#F8FAFC" />
        <rect x="12" y="12" width="32" height="32" rx="6" transform="rotate(45 28 28)" fill="#ED1C24" />
      </svg>
    );
  }
  if (bank.id === "mercantile") {
    return (
      <svg viewBox="0 0 56 56" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect x="2" y="2" width="52" height="52" rx="14" fill="#20B96C" />
        <text x="28" y="29" textAnchor="middle" fill="white" fontSize="10" fontWeight="900" fontFamily="Arial, sans-serif">מרכנתיל</text>
        <path d="M12 35 Q28 42 44 35" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  const wordmark = (() => {
    if (bank.id === "leumi") return { top: "LEUMI", bottom: "BANK" };
    if (bank.id === "mizrahi-tefahot") return { top: "MIZRAHI", bottom: "TEFAHOT" };
    if (bank.id === "discount") return { top: "DISCOUNT", bottom: "BANK" };
    if (bank.id === "fibi") return { top: "FIBI", bottom: "FIRST INTL" };
    if (bank.id === "yahav") return { top: "YAHAV", bottom: "BANK" };
    return { top: "JERUSALEM", bottom: "BANK" };
  })();

  return (
    <svg viewBox="0 0 56 56" className="h-8 w-8" aria-hidden="true">
      <defs>
        <linearGradient id={`bank-grad-${bank.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={bank.brandPrimary} />
          <stop offset="100%" stopColor={bank.brandSecondary} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="52" height="52" rx="14" fill={`url(#bank-grad-${bank.id})`} />
      <rect x="7" y="8" width="4" height="40" rx="2" fill={bank.accent} opacity="0.95" />
      <text x="16" y="24" fill="white" fontSize="9" fontWeight="700" fontFamily="Arial, sans-serif" letterSpacing="0.4">
        {currencyText(wordmark.top)}
      </text>
      <text x="16" y="36" fill={bank.accent} fontSize="7" fontWeight="700" fontFamily="Arial, sans-serif" letterSpacing="0.3">
        {currencyText(wordmark.bottom)}
      </text>
    </svg>
  );
}

export function shortListingRef(listing: Pick<MarketplaceListing, "displayNumber" | "id">) {
  return formatListingId(listing.displayNumber, listing.id);
}

export function shortTradeRef(request: Pick<PurchaseRequest, "displayNumber" | "tradeId" | "id">, isAr = false) {
  return `${isAr ? "الصفقة" : "Trade"} ${formatTradeId(request.displayNumber, request.tradeId ?? request.id)}`;
}

function notificationCategoryLabel(category: AlphaExchangeNotification["category"], isAr: boolean) {
  if (!isAr) return category;
  const labels: Record<AlphaExchangeNotification["category"], string> = {
    trade: "صفقة",
    listing: "عرض",
    application: "طلب بائع",
    trust: "الثقة",
    review: "تقييم",
    account: "الحساب",
    dispute: "نزاع",
    report: "بلاغ",
    system: "النظام",
  };
  return labels[category];
}

export function greetingByTime(isAr: boolean, value: string | number | Date = Date.now()) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return isAr ? "مرحباً" : "Welcome";
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: ISRAEL_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(parsed));
  if (hour < 12) return isAr ? "صباح الخير" : "Good morning";
  if (hour < 18) return isAr ? "مساء الخير" : "Good afternoon";
  return isAr ? "مساء النور" : "Good evening";
}


function formatMarketCardPrice(pairKey: "usdtIls" | "btcUsdt" | "ethUsdt", value: number) {
  if (pairKey === "usdtIls") {
    return `₪${value.toLocaleString("en-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMarketCardChange(changePercent: number | null) {
  if (changePercent === null || Number.isNaN(changePercent)) return "--";
  const sign = changePercent > 0 ? "+" : "";
  return `${sign}${changePercent.toFixed(2)}%`;
}

function buildSparklinePath(changePercent: number | null, seed: number) {
  const pointCount = 20;
  const pointRange = pointCount - 1;
  const trend = (changePercent ?? 0) / 36;
  const values: number[] = [];

  for (let index = 0; index < pointCount; index += 1) {
    const progress = index / pointRange;
    const wave = Math.sin((index + seed) * 0.85) * 0.08 + Math.cos((index + seed) * 0.42) * 0.04;
    const raw = 0.5 + trend * (progress - 0.5) + wave;
    values.push(Math.min(0.88, Math.max(0.12, raw)));
  }

  return values
    .map((value, index) => {
      const x = (index / pointRange) * 100;
      const y = (1 - value) * 32;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function safeErrorMessage(context: "application" | "purchase" | "listing" | "request" | "settings" | "password" | "workspace" | "review" | "evidence", isAr = false) {
  const map = isAr ? {
    application: "تعذّر إرسال طلبك الآن. حاول مرة أخرى.",
    purchase: "تعذّر إرسال طلب الشراء الآن. حاول مرة أخرى.",
    listing: "تعذّر تحديث العرض الآن. حاول مرة أخرى.",
    request: "تعذّر تحديث هذا الطلب الآن. حاول مرة أخرى.",
    settings: "تعذّر تحديث إعداداتك الآن. حاول مرة أخرى.",
    password: "تعذّر تحديث كلمة المرور الآن. حاول مرة أخرى.",
    workspace: "تعذّر تحميل بيانات المنصة المباشرة الآن. حدّث الصفحة وحاول مرة أخرى.",
    review: "تعذّر إرسال التقييم الآن. حاول مرة أخرى.",
    evidence: "تعذّر رفع الإثبات الآن. حاول مرة أخرى.",
  } : {
    application: "We could not submit your application right now. Please try again.",
    purchase: "We could not submit your purchase request right now. Please try again.",
    listing: "We could not update your listing at the moment. Please try again.",
    request: "We could not update this request right now. Please try again.",
    settings: "We could not update your settings right now. Please try again.",
    password: "We could not update your password right now. Please try again.",
    workspace: "We could not load live Exchange data right now. Please refresh and try again.",
    review: "We could not submit the review right now. Please try again.",
    evidence: "We could not upload evidence right now. Please try again.",
  } satisfies Record<string, string>;
  return map[context];
}

function purchaseRequestErrorMessage(code: string, isAr: boolean, englishMessage: string) {
  if (code === "CARDLESS_DETAILS_REQUIRED") return isAr ? "اختر بنك السحب وأكمل رمز السحب والهوية أو تاريخ الميلاد ومبلغ السحب المطابق لإجمالي الصفقة بالشيكل." : englishMessage;
  if (!isAr) return englishMessage;
  if (code === "PENDING_BUYER_FEEDBACK") return "أكمل تقييم صفقتك السابقة قبل بدء طلب جديد. افتح صفقاتك لإضافة التقييم.";
  if (code === "SESSION_EXPIRED") return "انتهت جلسة الدخول. سجّل الدخول مجدداً ثم افتح صفقاتك قبل إعادة إرسال الطلب.";
  if (code === "SERVICE_UNAVAILABLE") return "الخدمة غير متاحة مؤقتاً. تحقق من صفقاتك قبل إعادة إرسال الطلب.";
  if (code === "EMAIL_VERIFICATION_REQUIRED") return "يجب تأكيد البريد الإلكتروني قبل بدء صفقة.";
  if (code === "BUYER_ROLE_REQUIRED") return "يلزم تفعيل دور المشتري لبدء صفقة.";
  if (code === "RATE_LIMITED") return "أرسلت طلبات كثيرة خلال وقت قصير. حاول مرة أخرى بعد قليل.";
  if (code === "LISTING_ID_REQUIRED") return "تعذر تحديد العرض. أعد فتح العرض وحاول مرة أخرى.";
  if (code === "BUYER_NAME_REQUIRED") return "أكمل اسمك في الملف الشخصي قبل بدء صفقة.";
  if (code === "RECEIVING_WALLET_REQUIRED") return "عنوان محفظة استلام USDT مطلوب.";
  if (code === "RECEIVING_WALLET_INVALID") return "عنوان محفظة الاستلام غير صالح.";
  if (code === "TRADE_AMOUNT_REQUIRED") return "مبلغ الصفقة مطلوب.";
  if (code === "PRICE_MODE_INVALID") return "نوع السعر المحدد غير صالح.";
  if (code === "PRICE_OFFERS_ILS_ONLY") return "عروض الأسعار متاحة فقط للعروض المسعّرة بالشيكل.";
  if (code === "PRICE_OFFER_INVALID_FORMAT") return "أدخل سعرًا صالحًا بالشيكل، بحد أقصى منزلتين عشريتين.";
  if (code === "PRICE_OFFER_NOT_LOWER") return "يجب أن يكون عرض السعر أقل من سعر البائع الحالي.";
  if (code === "PRICE_OFFER_BELOW_MINIMUM") return "لا يمكن أن يقل عرضك بأكثر من ₪0.35 عن سعر البائع.";
  if (code === "SELLER_COMMISSION_DUE") return "يجب دفع عمولة البائع المستحقة قبل بدء عملية شراء جديدة.";
  if (code === "LISTING_SELLER_LOCKED") return "هذا العرض غير متاح مؤقتاً لطلبات شراء جديدة. اختر بائعاً آخر.";
  if (code === "LISTING_CHANGED") return "تغيّرت تفاصيل العرض أثناء إرسال طلبك. أعد فتح العرض وراجع الشروط الجديدة.";
  if (code === "LISTING_UNAVAILABLE") return "لم يعد هذا العرض متاحاً لطلب شراء جديد.";
  if (code === "LISTING_AMOUNT_CHANGED") return "تغيّرت الكمية المتاحة أو حدود الصفقة. أعد فتح العرض واختر مبلغاً ضمن الحدود الجديدة.";
  if (code === "LISTING_BANK_ACCOUNT_UNAVAILABLE") return "لم يعد حساب التحويل البنكي المرتبط بهذا العرض متاحاً. اختر عرضاً آخر أو اطلب من البائع تحديثه.";
  return safeErrorMessage("purchase", true);
}

export function localizeWalletValidationError(error: string | null, network: SupportedNetwork, isAr = false) {
  if (!error || !isAr) return error;
  if (error.includes("is required")) return `عنوان محفظة الاستلام مطلوب لشبكة ${network}.`;
  if (network === "ERC20" || network === "BEP20") return `تتطلب شبكة ${network} عنوان EVM من 42 خانة يبدأ بـ 0x.`;
  if (network === "TRC20") return "تتطلب شبكة TRC20 عنوان Tron صالحاً من 34 خانة يبدأ بحرف T.";
  return "تتطلب شبكة SOL عنوان Solana صالحاً بترميز base58.";
}

async function readApiErrorMessage(response: Response, fallback: string) {
  const fallbackText = fallback.trim();
  const localizeCandidate = (value: string) => containsArabicText(fallbackText) && !containsArabicText(value) ? fallbackText : value;
  let rawBody = "";
  try {
    rawBody = (await response.text()).trim();
  } catch {
    return fallbackText;
  }

  if (!rawBody) return fallbackText;
  if (/^<!doctype html>/i.test(rawBody) || /^<html[\s>]/i.test(rawBody)) return fallbackText;

  try {
    const payload = JSON.parse(rawBody) as { error?: unknown; message?: unknown; details?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) return localizeCandidate(payload.error);
    if (typeof payload.message === "string" && payload.message.trim()) return localizeCandidate(payload.message);
    if (typeof payload.details === "string" && payload.details.trim()) return localizeCandidate(payload.details);
  } catch {
    return fallbackText;
  }

  if (rawBody.length > 0 && rawBody.length < 2048 && !rawBody.includes("{")) return fallbackText;
  return fallbackText;
}

const TRADE_STATUS_LABELS_EN = {
  pending: "Pending",
  accepted: "Accepted",
  payment_sent: "Payment Sent",
  funds_received: "Funds Received",
  usdt_release_pending: "USDT Release Pending",
  usdt_sent: "USDT Sent",
  completed: "Completed",
  locked: "Locked",
  review_open: "Review Open",
  declined: "Declined",
  cancelled: "Cancelled",
} satisfies Record<PurchaseRequest["status"], string>;

const TRADE_STATUS_LABELS_AR = {
  pending: "قيد الانتظار",
  accepted: "مقبولة",
  payment_sent: "تم إرسال الدفعة",
  funds_received: "تم استلام الأموال",
  usdt_release_pending: "إرسال USDT قيد الانتظار",
  usdt_sent: "تم إرسال USDT",
  completed: "مكتملة",
  locked: "مقفلة",
  review_open: "التقييم متاح",
  declined: "مرفوضة",
  cancelled: "ملغاة",
} satisfies Record<PurchaseRequest["status"], string>;

export function tradeStatusLabel(status: PurchaseRequest["status"], isAr = false) {
  return isAr ? TRADE_STATUS_LABELS_AR[status] : TRADE_STATUS_LABELS_EN[status];
}

export type TradeQueueSectionKey = "action" | "active" | "waiting" | "completed" | "cancelled";
type TradePerspective = "buyer" | "seller";

export function getTradeQueuePresentation(request: PurchaseRequest, perspective: TradePerspective, isAr = false) {
  if (request.status === "declined" || request.status === "cancelled") {
    return { section: "cancelled" as const, badge: isAr ? "ملغاة" : "CANCELLED", badgeTone: "border-white/20 bg-white/5 text-[#9CA3AF]", rank: 4 };
  }
  if (request.status === "completed" || request.status === "review_open") {
    return { section: "completed" as const, badge: isAr ? "مكتملة" : "COMPLETED", badgeTone: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200", rank: 3 };
  }

  if (perspective === "seller") {
    if (request.status === "pending" || request.status === "payment_sent" || request.status === "funds_received" || request.status === "usdt_release_pending") {
      const overdue = request.timeoutReason === "USDT release SLA expired.";
      return {
        section: "action" as const,
        badge: overdue ? (isAr ? "متأخرة" : "OVERDUE") : (isAr ? "مطلوب إجراء منك" : "YOUR ACTION"),
        badgeTone: overdue ? "border-red-400/50 bg-red-500/15 text-red-200" : "border-[#C9A227]/50 bg-[#C9A227]/15 text-[#FDE68A]",
        rank: 0,
      };
    }
    if (request.status === "accepted" || request.status === "usdt_sent") {
      return { section: "waiting" as const, badge: isAr ? "بانتظار المشتري" : "WAITING FOR BUYER", badgeTone: "border-[#6CAEFF]/40 bg-[#6CAEFF]/15 text-[#BFDBFE]", rank: 2 };
    }
    return { section: "active" as const, badge: isAr ? "نشطة" : "ACTIVE", badgeTone: "border-white/20 bg-white/5 text-[#D1D5DB]", rank: 1 };
  }

  if (request.status === "accepted" || request.status === "usdt_sent") {
    return { section: "action" as const, badge: isAr ? "مطلوب إجراء منك" : "YOUR ACTION", badgeTone: "border-[#C9A227]/50 bg-[#C9A227]/15 text-[#FDE68A]", rank: 0 };
  }
  if (request.status === "pending" || request.status === "payment_sent" || request.status === "funds_received" || request.status === "usdt_release_pending") {
    return { section: "waiting" as const, badge: isAr ? "بانتظار البائع" : "WAITING FOR SELLER", badgeTone: "border-[#6CAEFF]/40 bg-[#6CAEFF]/15 text-[#BFDBFE]", rank: 2 };
  }
  return { section: "active" as const, badge: isAr ? "نشطة" : "ACTIVE", badgeTone: "border-white/20 bg-white/5 text-[#D1D5DB]", rank: 1 };
}

function prioritizeTradeRequests(requests: PurchaseRequest[], perspective: TradePerspective, isAr = false) {
  return [...requests].sort((left, right) => {
    const leftMeta = getTradeQueuePresentation(left, perspective, isAr);
    const rightMeta = getTradeQueuePresentation(right, perspective, isAr);
    if (leftMeta.rank !== rightMeta.rank) return leftMeta.rank - rightMeta.rank;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function groupTradeRequests(requests: PurchaseRequest[], perspective: TradePerspective, isAr = false) {
  const grouped: Record<TradeQueueSectionKey, PurchaseRequest[]> = {
    action: [],
    active: [],
    waiting: [],
    completed: [],
    cancelled: [],
  };
  for (const request of prioritizeTradeRequests(requests, perspective, isAr)) {
    grouped[getTradeQueuePresentation(request, perspective, isAr).section].push(request);
  }
  return grouped;
}

export function formatRelativeMinutesLabel(value?: string, isAr = false) {
  if (!value) return isAr ? "غير معروف" : "Unknown";
  const ms = new Date(value).getTime();
  if (!ms) return isAr ? "غير معروف" : "Unknown";
  const deltaMinutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (deltaMinutes < 1) return isAr ? "الآن" : "Just now";
  if (deltaMinutes < 60) return isAr ? `قبل ${deltaMinutes} دقيقة` : `${deltaMinutes} min ago`;
  const hours = Math.round(deltaMinutes / 60);
  if (hours < 24) return isAr ? `قبل ${hours} ساعة` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return isAr ? `قبل ${days} يوم` : `${days}d ago`;
}

export function sellerLevelLabel(level?: SellerLevel, isAr = false) {
  const rank = String(level ?? "bronze");
  if (isAr) {
    if (rank === "elite") return "نخبة Alpha";
    if (rank === "legendary") return "أسطوري";
    if (rank === "diamond") return "ماسي";
    if (rank === "platinum") return "بلاتيني";
    if (rank === "gold") return "ذهبي";
    if (rank === "silver") return "فضي";
    return "برونزي";
  }
  if (rank === "elite") return "Alpha Elite Seller";
  if (rank === "legendary") return "Legendary";
  if (rank === "diamond") return "Diamond";
  if (rank === "platinum") return "Platinum";
  if (rank === "gold") return "Gold";
  if (rank === "silver") return "Silver";
  return "Bronze";
}

function sellerLevelToneKey(level?: SellerLevel) {
  return rankSurfaceTone(level);
}

function sellerMarketplaceRankPriority(listing: MarketplaceListing) {
  if (listing.sellerProfile?.isOwner) return 0;
  const rank = String(listing.sellerReputation?.level ?? "bronze");
  if (rank === "legendary") return 1;
  if (rank === "diamond") return 2;
  if (rank === "platinum") return 3;
  if (rank === "gold") return 4;
  if (rank === "silver") return 5;
  return 6;
}

export function sellerBadgeLabel(badge: SellerBadge, isAr = false) {
  if (isAr) {
    if (badge === "elite_seller") return "بائع من النخبة";
    if (badge === "top_rated") return "الأعلى تقييماً";
    if (badge === "fast_responder") return "سريع الاستجابة";
    if (badge === "trusted_seller") return "بائع موثوق";
    if (badge === "most_active") return "الأكثر نشاطاً";
    if (badge === "platinum_seller") return "بائع بلاتيني";
    return "+1000 صفقة";
  }
  if (badge === "elite_seller") return "Elite Seller";
  if (badge === "top_rated") return "Top Rated";
  if (badge === "fast_responder") return "Fast Responder";
  if (badge === "trusted_seller") return "Trusted Seller";
  if (badge === "most_active") return "Most Active";
  if (badge === "platinum_seller") return "Platinum Seller";
  return "1000+ Trades";
}

const LISTING_STATUS_LABELS_EN = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  matched: "Matched to Trade",
  in_trade: "In Trade",
  expired: "Expired",
  completed: "Completed",
  cancelled: "Cancelled",
  closed: "Closed",
} satisfies Record<ListingStatus, string>;

const LISTING_STATUS_LABELS_AR = {
  draft: "مسودة",
  active: "نشط",
  paused: "متوقف مؤقتاً",
  matched: "مرتبط بصفقة",
  in_trade: "قيد التداول",
  expired: "منتهي الصلاحية",
  completed: "مكتمل",
  cancelled: "ملغى",
  closed: "مغلق",
} satisfies Record<ListingStatus, string>;

export function listingStatusLabel(status: string | null | undefined, isAr = false) {
  const value = safeText(status, isAr ? "غير معروف" : "Unknown");
  const normalized = value.toLowerCase();
  if (normalized in LISTING_STATUS_LABELS_EN) {
    const key = normalized as ListingStatus;
    return isAr ? LISTING_STATUS_LABELS_AR[key] : LISTING_STATUS_LABELS_EN[key];
  }
  return isAr && !containsArabicText(value) ? "غير معروف" : value;
}

export function listingChangeReasonLabel(reason: string, isAr = false) {
  if (!isAr) return reason;
  const labels: Record<string, string> = {
    "Changed available balance": "تغيير الرصيد المتاح",
    "Price updated": "تحديث السعر",
    "Network issue": "مشكلة في الشبكة",
    "Personal reason": "سبب شخصي",
    Other: "سبب آخر",
  };
  return labels[reason] ?? reason;
}

function keepLatestItems<T>(items: T[], limit: number) {
  if (items.length <= limit) return items;
  return items.slice(0, limit);
}

export function roleBadgeVariantFromSession(user: SessionUser) {
  return accountRoleIdentity(user);
}

function listingRequiresFaceToFaceSafetyNotice(method: string | null | undefined) {
  return normalizeMarketplacePaymentMethod(method) === "Face-to-Face (Meet in Person)";
}

export function normalizePaymentMethodList(methods: string[] | undefined, fallback: string | undefined) {
  return resolveListingPaymentMethods(methods, fallback).slice(0, MAX_LISTING_PAYMENT_METHODS);
}

export function requiresBankSelection(methods: string[] | undefined, fallback?: string) {
  return requiresIsraeliBankSelection(methods, fallback);
}

export function toggleSelection(values: string[], nextValue: string, maxSelections: number, allowEmpty = false) {
  const nextSet = new Set(values);
  if (nextSet.has(nextValue)) {
    if (nextSet.size === 1 && !allowEmpty) return values;
    nextSet.delete(nextValue);
    return Array.from(nextSet);
  }
  if (nextSet.size >= maxSelections) return values;
  nextSet.add(nextValue);
  return Array.from(nextSet);
}

export function paymentMethodLabel(method: string, isAr = false) {
  const normalized = normalizeMarketplacePaymentMethod(method) ?? method;
  if (isAr) {
    if (normalized === "Bank Transfer") return "تحويل بنكي";
    if (normalized === "Face-to-Face (Meet in Person)") return "لقاء شخصي";
    if (normalized === "Cardless ATM Withdrawal") return "سحب من الصراف بلا بطاقة";
  }
  return PAYMENT_METHOD_META[normalized]?.shortLabel ?? normalized;
}

export function paymentMethodEmoji(method: string) {
  const normalized = normalizeMarketplacePaymentMethod(method) ?? method;
  return PAYMENT_METHOD_META[normalized]?.emoji ?? "💳";
}

export function paymentMethodTradeInstruction(method: string, actor: "buyer" | "seller", isAr = false) {
  const normalized = normalizeMarketplacePaymentMethod(method);
  if (normalized === "Bank Transfer") {
    if (isAr) return actor === "seller"
      ? "تعليمات التحويل البنكي: تحقّق من وصول الأموال مباشرة إلى حسابك البنكي قبل المتابعة."
      : "تعليمات التحويل البنكي: بعد تحديد «تم إرسال الدفعة»، انتظر تأكيد البائع لوصولها إلى البنك.";
    return actor === "seller"
      ? "Bank Transfer Instructions: verify funds directly in your bank account before continuing."
      : "Bank Transfer Instructions: after marking Payment Sent, wait for seller bank confirmation.";
  }
  if (normalized === "Face-to-Face (Meet in Person)") {
    if (isAr) return actor === "seller"
      ? "اللقاء الشخصي: أكّد فقط بعد استلام النقد فعليًا. ثم أكّد إرسال USDT وحدد الصفقة كمكتملة بزر منفصل. لا يلزم رفع صورة."
      : "اللقاء الشخصي: سلّم النقد ثم أكّد ذلك من غرفة التداول. يؤكد البائع إرسال USDT ثم يُكمل الصفقة بشكل منفصل؛ لا يلزم تأكيد المشتري أو رفع صورة.";
    return actor === "seller"
      ? "Face-to-Face: confirm only after you physically receive the cash. Then confirm USDT sent and mark the trade completed with a separate button. No photo is required."
      : "Face-to-Face: hand over the cash, then confirm it in the Trade Room. The seller separately confirms USDT sent and completes the trade; no buyer receipt confirmation or photo is required.";
  }
  if (normalized === "Cardless ATM Withdrawal") {
    if (isAr) return actor === "seller"
      ? "السحب بلا بطاقة: أكّد فقط بعد سحب النقد فعليًا. ثم أكّد إرسال USDT وحدد الصفقة كمكتملة بزر منفصل. لا يلزم رفع صورة."
      : "السحب بلا بطاقة: أرسل رمز السحب للبائع ثم أكّد ذلك من غرفة التداول. يؤكد البائع إرسال USDT ثم يُكمل الصفقة؛ لا يلزم منك تأكيد الاستلام أو رفع صورة.";
    return actor === "seller"
      ? "Cardless ATM: confirm only after you collect the cash. Then confirm USDT sent and mark the trade completed with a separate button. No photo is required."
      : "Cardless ATM: send the withdrawal code to the seller, then confirm it in the Trade Room. The seller confirms USDT sent and completes the trade; no buyer receipt confirmation or photo is required.";
  }
  return isAr ? "اتبع الخط الزمني للصفقة وأكمل كل خطوة تحقق قبل المتابعة." : "Follow the trade timeline and complete each verification step before moving forward.";
}

// Memoized listing card — only re-renders when listing data or market price changes.
type ListingCardProps = {
  listing: MarketplaceListing;
  isAr: boolean;
  marketPricePerUsdt: number;
  isOwnerListing: boolean;
  isOwnListing: boolean;
  isBuying: boolean;
  onOpen: (listing: MarketplaceListing, priceMode: "listing_price" | "buyer_offer") => void;
  onManageListing: (listing: MarketplaceListing) => void;
};

export const ListingCard = memo(function ListingCard({ listing, isAr, marketPricePerUsdt, isOwnerListing, isOwnListing, isBuying, onOpen, onManageListing }: ListingCardProps) {
  const sellerLevel = listing.sellerReputation?.level;
  const sellerRankKey = sellerLevelToneKey(sellerLevel);
  const formattedAvailableAmount = Math.trunc(toNumber(listing.availableAmount)).toLocaleString("en-US");
  const availableAmountClassName = availableAmountScaleClass(listing.availableAmount);
  const presence = useLiveUserPresence(listing.sellerId, listing.sellerProfile);
  const sellerEmailVerified = listing.sellerProfile?.emailVerified === true;
  const sellerRankBorderColor: Record<string, string> = {
    bronze: "rgba(var(--rank-bronze-rgb),0.62)",
    silver: "rgba(var(--rank-silver-rgb),0.68)",
    gold: "rgba(var(--rank-gold-rgb),0.7)",
    platinum: "rgba(203,219,243,0.72)",
    diamond: "rgba(var(--rank-diamond-rgb),0.74)",
    legendary: "rgba(212,175,55,0.78)",
  };
  return (
    <Card
      id={`listing-${listing.id}`}
      className={cn(
        "group seller-listing-shell compact-listing border-white/10 bg-[#0B0B0B]/90 transition duration-300",
        !isOwnerListing && `seller-rank-surface seller-rank-surface--${sellerRankKey} seller-rank-card seller-rank-card--${sellerRankKey}`,
        isOwnerListing && "owner-legendary-surface",
        isOwnerListing
          ? "hover:border-red-500/50 hover:shadow-[0_22px_60px_rgba(220,38,38,0.35)]"
          : "hover:border-[#C9A227]/28 hover:shadow-[0_18px_44px_rgba(0,0,0,0.32)]",
      )}
      style={{
        borderLeft: isOwnerListing
          ? "2px solid rgba(239,68,68,0.70)"
          : `2px solid ${sellerRankBorderColor[sellerRankKey] ?? "rgba(255,255,255,0.1)"}`,
        boxShadow: isOwnerListing ? "0 0 0 1px rgba(239,68,68,0.22), 0 0 28px rgba(220,38,38,0.18)" : undefined,
      }}
    >
      {isOwnerListing ? (
        <div className="flex flex-wrap items-center gap-2 rounded-t-xl border-b border-red-500/20 bg-gradient-to-r from-red-950/60 via-red-900/30 to-transparent px-4 py-2">
          <Sparkles className="h-3.5 w-3.5 text-red-300" />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">{isAr ? "عرض رسمي من Alpha Exchange" : "Official Alpha Exchange Listing"}</span>
          <span className="ms-auto text-[11px] text-red-400/70">{isAr ? "يُباع مباشرةً من مالك المنصة" : "Sold directly by the platform owner"}</span>
        </div>
      ) : null}
      <CardHeader className="compact-listing__header">
        <div className={`compact-listing__identity-row flex items-start justify-between gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
          <div className={`flex min-w-0 items-start gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <div className={cn("relative seller-avatar-ring", `seller-avatar-ring--${isOwnerListing ? "legendary" : sellerRankKey}`, isOwnerListing && "after:absolute after:-inset-0.5 after:rounded-full after:border after:border-red-500/60 after:shadow-[0_0_14px_rgba(220,38,38,0.55)]")}>
              {listing.sellerProfile?.profilePhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={listing.sellerProfile.profilePhotoUrl}
                  alt={isAr ? `صورة ${safeText(listing.sellerDisplayName, "البائع")}` : `${safeText(listing.sellerDisplayName, "Seller")} profile`}
                  className={cn("h-11 w-11 rounded-full border border-transparent object-cover")}
                />
              ) : (
                <div className={cn("inline-flex h-11 w-11 items-center justify-center rounded-full border border-transparent text-sm font-semibold", isOwnerListing ? "bg-red-950/60 text-red-200" : "bg-white/[0.04] text-[#D1D5DB]")}>
                  {isOwnerListing ? <Crown className="h-6 w-6" aria-hidden="true" /> : <RankEmblem rank={sellerLevel} className="!h-11 !w-11 [&>svg]:!h-6 [&>svg]:!w-6" />}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className={`flex flex-wrap items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                <CardTitle className={cn("text-lg seller-listing-seller-name", isOwnerListing ? "profile-identity-name--owner" : `seller-rank-name seller-rank-name--${sellerRankKey}`)}>{isOwnerListing ? currencyText(safeText(listing.sellerDisplayName, isAr ? "بائع" : "Seller")) : <PublicAccountId value={publicAccountId({ id: listing.sellerId })} audience="seller" rank={sellerLevel} />}</CardTitle>
                {isOwnerListing ? <RoleBadge variant="owner" locale={isAr ? "ar" : "en"} /> : null}
              </div>
              {isOwnerListing ? (
                <p className="mt-0.5 text-[12px] font-semibold text-[#F87171]">{isAr ? "مالك Alpha Exchange" : "Alpha Exchange Owner"}</p>
              ) : null}
              <p className="seller-listing-seller-subtitle mt-1 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">
                <span className={cn("seller-listing-rank-label", `seller-listing-rank-label--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
                  {currencyText(isOwnerListing ? (isAr ? "المالك" : "Owner") : (isAr ? `بائع ${sellerLevelLabel(listing.sellerReputation?.level, true)}` : `${sellerLevelLabel(listing.sellerReputation?.level)} Seller`))}
                </span>
                <span className="seller-listing-status-separator"> • </span>
                <span className={cn("seller-listing-presence inline-flex items-center gap-1.5", `seller-presence--${presence.tone}`)}>
                  <span className={cn("seller-presence-dot", `seller-presence-dot--${presence.tone}`)} aria-hidden="true" />
                  {currencyText(isAr ? presence.labelAr : presence.label)}
                </span>
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#93C5FD]">{isAr ? "العرض" : "Listing"} {currencyText(shortListingRef(listing))}</p>

            </div>
          </div>
          <span className="compact-listing__availability flex shrink-0 flex-col items-end gap-1.5">
            <span className={cn("seller-listing-availability", `seller-listing-availability--${isOwnerListing ? "legendary" : sellerRankKey}`)}>{isAr ? "متاح" : "Available"}</span>
            <ListingCountdownBadge expiresAt={listing.expiresAt} isAr={isAr} />
          </span>
        </div>
              <div className="compact-listing__badges flex flex-wrap items-center gap-1.5">
                <RoleBadge variant="approved_seller" locale={isAr ? "ar" : "en"} className={cn("seller-rank-badge", `seller-rank-badge--${sellerRankKey}`)} />
                <RankBadge rank={sellerLevel} locale={isAr ? "ar" : "en"} audience="seller" />
                {isOwnerListing ? (
                  <>
                    <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">✓ {isAr ? "البريد موثّق" : "Email Verified"}</span>
                    <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">✓ {isAr ? "الهاتف موثّق" : "Phone Verified"}</span>
                    <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">✓ {isAr ? "حساب المنصة الرسمي" : "Official Platform Account"}</span>
                  </>
                ) : sellerEmailVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {isAr ? "بريد موثّق" : "Verified Email"}
                  </span>
                ) : null}
              </div>
      </CardHeader>
      <CardContent className="compact-listing__content">
        <div className={cn(
          "compact-listing__metrics rounded-2xl border shadow-[0_14px_36px_rgba(0,0,0,0.35)] transition duration-300",
          isOwnerListing
            ? "border-emerald-500/35 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(5,5,5,0.88))] group-hover:border-emerald-400/55 group-hover:shadow-[0_18px_42px_rgba(16,185,129,0.25)]"
            : `seller-rank-accent seller-rank-accent--${sellerRankKey}`,
        )}>
          <div className="compact-listing__metrics-grid">
            <div className="seller-asset-usdt-card seller-card-keymetric min-w-0 rounded-xl border p-4">
              <p className="compact-listing__amount-label text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-300">
                  <span className="seller-asset-usdt-amount-icon inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 text-emerald-200">
                    ₮
                  </span>
                <span className="min-w-0">{currencyText(isAr ? "USDT المتاح" : "Available USDT")}</span>
              </p>
              <div className="seller-asset-usdt-amount-row">
                <div className="seller-asset-usdt-amount-content">

                  <p className={cn("seller-asset-usdt-value text-[#D6FFE7]", availableAmountClassName)}>
                    {moneyText(formattedAvailableAmount)}
                  </p>
                  <span className="compact-listing__amount-unit currency-usdt">USDT</span>
                </div>
              </div>

              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/45 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                {isAr ? "جاهز للتداول" : "Ready to trade"}
              </span>
            </div>
            <div className={cn("rounded-xl border p-3 seller-rank-price seller-card-keymetric min-w-0", `seller-rank-price--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#D4AF37]">
                {isAr ? "سعر العرض" : "Listing Price"}
              </p>
              <p className="seller-price-value mt-2 text-4xl font-semibold leading-none text-[#6EE7B7] md:text-5xl">
                {moneyText(toNumber(listing.price).toLocaleString("en-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#E5E7EB]">{currencyText("ILS / USDT")}</p>

            </div>
          </div>
          <div className="seller-live-market-panel compact-listing__market rounded-lg border text-[11px] text-[#CFCFCF]">
            <span className="text-[#9CA3AF]">{isAr ? "السوق الحالي" : "Current Market"}</span>
            <span>{currencyText("USDT / ILS")}</span>
            <span className="seller-live-market-badge">{isAr ? "مباشر" : "Live"}</span>
            <span className="compact-listing__market-price font-semibold">{moneyText(marketPricePerUsdt.toLocaleString("en-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</span>
          </div>
        </div>
        <div className="compact-listing__stats grid grid-cols-4 gap-1.5 text-center text-xs">
          <div className={cn("rounded-xl border border-white/10 bg-black/25 p-3 text-[#D1D5DB] transition duration-300 hover:bg-black/35", `seller-rank-microcard seller-rank-microcard--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
            <Star className="h-4 w-4 mx-auto text-[#F4D87A]" />
            <p className="mt-1 break-words font-semibold leading-snug text-white">{(listing.sellerReputation?.rating ?? 0).toFixed(2)}</p>
            <p className="text-[11px] text-[#9CA3AF]">{isAr ? "التقييم" : "Rating"}</p>
          </div>
          <div className={cn("rounded-xl border border-white/10 bg-black/25 p-3 text-[#D1D5DB] transition duration-300 hover:bg-black/35", `seller-rank-microcard seller-rank-microcard--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
            <HandCoins className="h-4 w-4 mx-auto text-[#D1D5DB]" />
            <p className="mt-1 break-words font-semibold leading-snug text-white">{(listing.sellerReputation?.completedTrades ?? 0).toLocaleString("en-IL")}</p>
            <p className="text-[11px] text-[#9CA3AF]">{isAr ? "الصفقات" : "Trades"}</p>
          </div>
          <div className={cn("rounded-xl border border-white/10 bg-black/25 p-3 text-[#D1D5DB] transition duration-300 hover:bg-black/35", `seller-rank-microcard seller-rank-microcard--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
            <Zap className="h-4 w-4 mx-auto text-[#F4D87A]" />
            <p className="mt-1 break-words font-semibold leading-snug text-white">{currencyText(formatMeasuredResponseTime(listing.sellerReputation?.responseTimeMinutes, isAr))}</p>
            <p className="text-[11px] text-[#9CA3AF]">{isAr ? "الاستجابة" : "Response Time"}</p>
          </div>
          <div className={cn("rounded-xl border border-white/10 bg-black/25 p-3 text-[#D1D5DB] transition duration-300 hover:bg-black/35", `seller-rank-microcard seller-rank-microcard--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
            <ShieldCheck className="h-4 w-4 mx-auto text-[#93C5FD]" />
            <p className="mt-1 break-words font-semibold leading-snug text-white">{(listing.sellerReputation?.trustScore ?? 0).toFixed(1)}</p>
            <p className="text-[11px] text-[#9CA3AF]">{isAr ? "درجة الثقة" : "Trust Score"}</p>
          </div>
        </div>
        <div className="compact-listing__details grid gap-2 text-xs text-[#9CA3AF]">
          <div className="seller-card-info-panel min-w-0 space-y-1.5 rounded-xl border border-white/10 bg-black/25 p-3">
            <p>{isAr ? "آخر نشاط" : "Last active"}: <span className={cn("text-white", presence.tone === "online" && "text-emerald-300")}>{currencyText(isAr ? presence.labelAr : presence.label)}</span></p>
            <p>{isAr ? "الشبكة" : "Network"}: <span className="text-white">{currencyText(safeText(listing.network))}</span></p>
            <div>
              <p>{isAr ? "الدفع" : "Payment"}:</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod).map((method) => (
                  <span key={`${listing.id}-${method}`} className="max-w-full break-words rounded-full border border-white/15 bg-white/[0.03] px-2 py-0.5 text-[11px] text-[#D1D5DB]">
                    {currencyText(paymentMethodLabel(method, isAr))}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="seller-card-info-panel min-w-0 space-y-1.5 rounded-xl border border-white/10 bg-black/25 p-3">
            <p>{isAr ? "حدود الصفقة" : "Trade limits"}: <span className="text-white">{currencyText(`${Math.trunc(toNumber(listing.minimumTrade)).toLocaleString("en-US")} – ${Math.trunc(toNumber(listing.maximumTrade)).toLocaleString("en-US")} USDT`)}</span></p>
            <p>
              {isAr ? "مسار الصفقة" : "Trade flow"}:{" "}
              <span className="seller-escrow-emphasis">
                {isAr ? "منظّم ومسجّل عبر " : "Structured and recorded by "}
                <span className="seller-escrow-brand">{brandText("Alpha Traders")}</span>
              </span>
            </p>
            <p>{isAr ? "المنطقة" : "Region"}: <span className="text-white">{currencyText(safeText(listing.sellerProfile?.country, isAr ? "إسرائيل" : "Israel"))}</span></p>
          </div>
        </div>
        <div className="compact-listing__actions grid grid-cols-2 gap-2">
          <Link
            href={listing.sellerProfile?.username ? `/exchange/seller/${listing.sellerProfile.username}` : `/usdt-exchange?seller=${encodeURIComponent(listing.sellerId)}`}
            className={cn(
              "seller-marketplace-action seller-marketplace-action--profile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]",
              isOwnerListing
                ? "owner-cta-premium"
                : `seller-rank-cta seller-rank-cta--${sellerRankKey}`,
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Users className="h-4 w-4" />
              {isAr ? "ملف البائع" : "Seller Profile"}
            </span>
            <ArrowRight className="h-4 w-4" />
          </Link>
          {(listing.sellerActiveTradeCount ?? 0) > 0 ? <p className="col-span-2 text-sm text-amber-200">{isAr ? `البائع في ${listing.sellerActiveTradeCount} من 3 صفقات نشطة` : `Seller in ${listing.sellerActiveTradeCount} of 3 active trades`}</p> : null}
          {listing.newRequestBlockReason ? <p role="status" className="col-span-2 rounded-xl border border-amber-500/30 p-3 text-sm text-amber-200">{listing.newRequestBlockReason === "commission_due" ? (isAr ? "طلبات جديدة متوقفة حتى يسدد البائع العمولة المستحقة. يمكنه إكمال صفقاته الحالية." : "New requests paused until the seller pays outstanding commission. Existing trades can finish.") : listing.newRequestBlockReason === "trade_limit" ? (isAr ? "البائع في 3 صفقات نشطة. انتظر انتهاء صفقة." : "Seller has 3 active trades. Wait for a trade to finish.") : (isAr ? "الرصيد محجوز للصفقات الحالية." : "Balance reserved for current trades.")}</p> : null}
          {isOwnListing ? (
            <Button
              className={cn(
                "seller-marketplace-action w-full justify-between rounded-2xl px-5 text-sm font-semibold transition duration-300",
                isOwnerListing
                  ? "owner-cta-premium text-black"
                  : `seller-rank-cta seller-rank-cta--${sellerRankKey} text-black`,
              )}
              onClick={() => onManageListing(listing)}
              aria-label={isAr ? `إدارة العرض ${shortListingRef(listing)}` : `Manage listing ${shortListingRef(listing)}`}
            >
              <span className="inline-flex items-center gap-2">
                <Edit3 className="h-4 w-4" />
                {isAr ? "إدارة العرض" : "Manage Listing"}
              </span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              className={cn(
                "seller-marketplace-action w-full justify-between rounded-2xl px-5 text-sm font-semibold text-black transition duration-300",
                isOwnerListing
                  ? "owner-cta-premium"
                  : `seller-rank-cta seller-rank-cta--${sellerRankKey}`,
              )}
              disabled={isBuying || Boolean(listing.newRequestBlockReason)}
              onClick={() => onOpen(listing, "listing_price")}
              aria-label={isAr ? `شراء USDT من ${safeText(listing.sellerDisplayName, "البائع")}` : `Buy USDT from ${safeText(listing.sellerDisplayName, "seller")}`}
            >
              <span className="inline-flex items-center gap-2">
                {isBuying ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                {isBuying ? (isAr ? "جارٍ بدء الصفقة..." : "Starting trade...") : (isAr ? "اشترِ الآن" : "Buy Now")}
              </span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          {!isOwnListing && listing.currency.trim().toUpperCase() === "ILS" ? (
            <Button
              type="button"
              variant="secondary"
              className="seller-marketplace-action seller-marketplace-action--offer w-full justify-between rounded-2xl border-[#C9A227]/45 bg-[#C9A227]/10 px-5 text-sm font-semibold text-[#F4D87A] transition duration-300 hover:border-[#F4D87A]/70 hover:bg-[#C9A227]/15 col-span-2"
              disabled={isBuying || Boolean(listing.newRequestBlockReason)}
              onClick={() => onOpen(listing, "buyer_offer")}
              aria-label={isAr ? `تقديم عرض سعر إلى ${safeText(listing.sellerDisplayName, "البائع")}` : `Make a price offer to ${safeText(listing.sellerDisplayName, "seller")}`}
            >
              <span className="inline-flex items-center gap-2">
                <BadgePercent className="h-4 w-4" />
                {isAr ? "قدّم عرض سعر" : "Make an Offer"}
              </span>
              <span className="text-[11px] font-medium text-[#D1D5DB]">
                {currencyText(isAr ? "خصم حتى ₪0.35" : "Up to ₪0.35 lower")}
              </span>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
});

// Isolated eligibility countdown. Only mounts a timer while the countdown is
// actually visible (<=12h remaining), so hidden listings never tick and a
// single listing's countdown never re-renders the whole marketplace.
const ListingCountdownBadge = memo(function ListingCountdownBadge({ expiresAt, isAr }: { expiresAt?: string; isAr: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const current = deriveListingCountdown(expiresAt, Date.now());
    if (!current.visible) return;
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  const countdown = deriveListingCountdown(expiresAt, now);
  if (!countdown.visible) return null;
  const urgent = countdown.tier === "urgent";
  return (
    <span
      className={cn("seller-listing-countdown", `seller-listing-countdown--${countdown.tier}`)}
      role="timer"
      aria-label={isAr ? `صلاحية العرض: ${countdown.labelAr}` : `Listing eligibility: ${countdown.label}`}
    >
      {urgent ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}
      {currencyText(isAr ? countdown.labelAr : countdown.label)}
    </span>
  );
});

// Renders children into document.body so fixed-position overlays stay centered
// against the real viewport even if a future ancestor establishes a containing block.
function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export function UsdtExchangePage({
  locale,
  initialSessionUser,
  workspaceMode,
}: {
  locale: Locale;
  initialSessionUser?: SessionUser | null;
  workspaceMode?: WorkspaceMode;
}) {
  const isAr = locale === "ar";
  const isDashboardWorkspace = workspaceMode !== undefined;
  const isSellerDashboardWorkspace = workspaceMode === "seller";
  const isDesktopWorkspace = useDesktopWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const commissionPaymentIntent = searchParams?.get("commission") ?? null;
  const commissionPaymentIntentId = searchParams?.get("commissionId")?.trim() ?? "";
  const canonicalSession = useOptionalCanonicalSession();
  const refreshCanonicalSession = canonicalSession?.refresh;
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
  });
  const marketFeed = useMarketFeed({ refreshMs: 45_000 });
  const marketSnapshot = marketFeed.snapshot;

  // Read the same principal as the header in this render. Mirroring it through
  // an effect can briefly retain a previous account after sign-out.
  const sessionUser = canonicalSession ? canonicalSession.user : initialSessionUser ?? null;
  const [buyerProfileSummary, setBuyerProfileSummary] = useState<BuyerRankSummary | null>(null);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  // The server-backed session is authoritative for seller-application eligibility.
  // The initial value is only a bootstrap snapshot and can have stale roles.
  const isSessionResolving = canonicalSession?.isResolving ?? false;
  const sessionResolutionError = canonicalSession?.error ?? false;
  const [isLoadingListings, setIsLoadingListings] = useState(true);
  const [isWorkspaceWidgetsLoading, setIsWorkspaceWidgetsLoading] = useState(true);
  const [isSellerApplicationLoading, setIsSellerApplicationLoading] = useState(true);
  const [notificationsInitialized, setNotificationsInitialized] = useState(false);
  const [deferredSellerPanelsReady, setDeferredSellerPanelsReady] = useState(false);
  const listingsLoadedAtRef = useRef<number>(Date.now());
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
  const [purchaseSubmitted, setPurchaseSubmitted] = useState(false);
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);
  const purchaseRequestInFlightRef = useRef(false);
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [purchasePriceMode, setPurchasePriceMode] = useState<"listing_price" | "buyer_offer">("listing_price");
  const [buyerOfferedPrice, setBuyerOfferedPrice] = useState("");
  const [sellerProfileData, setSellerProfileData] = useState<PremiumSellerProfileData | null>(null);
  const [isSellerProfileLoading, setIsSellerProfileLoading] = useState(false);
  const sellerProfileRequestIdRef = useRef(0);
  const sellerProfileAbortControllerRef = useRef<AbortController | null>(null);
  const [isOwnerProfileActionLoading, setIsOwnerProfileActionLoading] = useState(false);
  const [sellerApplication, setSellerApplication] = useState<SellerApplication | null>(null);
  const [myRequests, setMyRequests] = useState<PurchaseRequest[]>([]);
  const [purchaseRequestsState, setPurchaseRequestsState] = useState<"loading" | "ready" | "error">("loading");
  const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);
  const [discordSharing, setDiscordSharing] = useState<DiscordListingSharingStatus | null>(null);
  const [discordShareActionKey, setDiscordShareActionKey] = useState<string | null>(null);
  const discordSharePollTimersRef = useRef<number[]>([]);
  const [statusMessage, setStatusMessage, statusMessageFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [showVerificationCta, setShowVerificationCta] = useState(false);
  const [isRedirectingToVerification, setIsRedirectingToVerification] = useState(false);
  const [sellerWorkspaceMessage, setSellerWorkspaceMessage, sellerWorkspaceMessageFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [listingActionKey, setListingActionKey] = useState<string | null>(null);
  const listingMutationInFlightRef = useRef(false);
  const sellerWorkspaceRevisionRef = useRef(0);
  const listingCreateRequestInFlightRef = useRef(false);
  const [listingCreateResult, setListingCreateResult] = useState<ListingCreateResult | null>(null);
  const [listingEditForm, setListingEditForm] = useState({
    availableAmount: "",
    price: "",
    currency: "ILS",
    network: "TRC20" as SupportedNetwork,
    paymentMethods: ["Bank Transfer"],
    bankAccountId: "",
    bankName: "",
    minimumTrade: "0",
    maximumTrade: "",
    sellerDescription: "",
    changeReason: "",
    changeExplanation: "",
  });
  const [listingEditOriginal, setListingEditOriginal] = useState<{
    availableAmount: string;
    price: string;
    minimumTrade: string;
    maximumTrade: string;
  } | null>(null);
  const [removalListing, setRemovalListing] = useState<MarketplaceListing | null>(null);
  const [removalReason, setRemovalReason] = useState("");
  const [removalError, setRemovalError, removalErrorFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [removalExplanation, setRemovalExplanation] = useState("");
  const [listingCommissionAgreement, setListingCommissionAgreement] = useState(false);
  const [faceToFaceSafetyAcknowledged, setFaceToFaceSafetyAcknowledged] = useState(false);
  const [sellerWorkspaceSummary, setSellerWorkspaceSummary] = useState<{
    activeListingLimit: number;
    openListingCount: number;
    openTradeCount: number;
    pendingCommissionCount: number;
    canCreateListing: boolean;
    blockedReason: string | null;
    enforcement?: {
      restricted: boolean;
      blockReason: string | null;
    };
  } | null>(null);
  const [sellerCommissionStatus, setSellerCommissionStatus] = useState<SellerCommissionStatus | null>(null);
  const [commissionWalletConfiguration, setCommissionWalletConfiguration] = useState<CommissionWalletConfiguration | null>(null);
  const [qaCommissionModeEnabled, setQaCommissionModeEnabled] = useState(false);
  const [qaCommissionResetEnabled, setQaCommissionResetEnabled] = useState(false);
  const [commissionPayOpen, setCommissionPayOpen] = useState(false);
  const openCommissionIdRef = useRef<string | null>(null);
  useEffect(() => {
    openCommissionIdRef.current = commissionPayOpen ? sellerCommissionStatus?.commissionId ?? null : null;
  }, [commissionPayOpen, sellerCommissionStatus?.commissionId]);
  const [commissionNetwork, setCommissionNetwork] = useState<CommissionNetworkId>("TRC20");
  const [commissionTxSignature, setCommissionTxSignature] = useState("");
  const [commissionPayBusy, setCommissionPayBusy] = useState(false);
  const [commissionPayMessage, setCommissionPayMessage, commissionPayMessageFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [commissionCopied, setCommissionCopied] = useState(false);
  const [commissionQrDataUrl, setCommissionQrDataUrl] = useState<string | null>(null);
  const [commissionPayerType, setCommissionPayerType] = useState<"personal" | "exchange" | null>(null);
  const [commissionAdvancedOpen, setCommissionAdvancedOpen] = useState(false);
  const selectedCommissionWallet = CLIENT_COMMISSION_WALLETS[commissionNetwork];
  const selectedCommissionWalletConfiguration = commissionWalletConfiguration?.[commissionNetwork];
  const selectedCommissionWalletAvailable = Boolean(selectedCommissionWalletConfiguration?.available && selectedCommissionWallet);
  const selectedCommissionWalletError = isAr
    ? `إعدادات محفظة العمولة غير متاحة لشبكة ${commissionNetwork}. تواصل مع دعم Alpha Traders.`
    : (selectedCommissionWalletConfiguration?.error
      ?? `Commission wallet configuration is unavailable for ${commissionNetwork}. Please contact Alpha Traders support.`);
  const commissionTotalAmountDue = sellerCommissionStatus?.totalAmountDue ?? sellerCommissionStatus?.amountDue ?? 0;
  // Do not infer a payable amount from an aggregate outstanding balance. The
  // server returns this only for the exact commissionId that it authorized.
  const commissionPayableAmountDue = sellerCommissionStatus?.payableAmountDue
    ?? (sellerCommissionStatus?.pendingCount === 1 ? sellerCommissionStatus.amountDue : 0);
  const [requestActionKey, setRequestActionKey] = useState<string | null>(null);
  const qaCommissionResetAttemptedRef = useRef(false);
  const [listingCreateForm, setListingCreateForm] = useState({
    availableAmount: "",
    price: "",
    currency: "ILS",
    network: "TRC20" as SupportedNetwork,
    paymentMethods: [...getDefaultListingPaymentMethods(initialSessionUser?.preferredPaymentMethods)] as string[],
    bankAccountId: "",
    bankName: "",
    minimumTrade: "0",
    maximumTrade: "",
    sellerDescription: "",
  });
  const [sellerBankAccounts, setSellerBankAccounts] = useState<SellerBankAccount[]>([]);
  const [sellerBankAccountsLoading, setSellerBankAccountsLoading] = useState(false);
  const [selectedPurchasePaymentMethod, setSelectedPurchasePaymentMethod] = useState<string>("Bank Transfer");

  useEffect(() => {
    if (isSessionResolving) {
      setSellerBankAccounts([]);
      setSellerBankAccountsLoading(false);
      return;
    }
    const canLoadBankAccounts = Boolean(sessionUser && (
      (sessionUser.sellerStatus === "approved_seller" && sessionUser.sellerApprovalVerified === true)
      || sessionUser.role === "admin"
      || sessionUser.role === "owner"
    ));
    if (!canLoadBankAccounts) {
      setSellerBankAccounts([]);
      return;
    }
    let cancelled = false;
    setSellerBankAccountsLoading(true);
    void fetch("/api/alpha-exchange/seller-settings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 401) void refreshCanonicalSession?.({ force: true });
          return [] as SellerBankAccount[];
        }
        const payload = await response.json() as { bankAccounts?: SellerBankAccount[] };
        return Array.isArray(payload.bankAccounts) ? payload.bankAccounts : [];
      })
      .then((accounts) => {
        if (cancelled) return;
        setSellerBankAccounts(accounts);
      })
      .catch(() => {
        if (!cancelled) setSellerBankAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setSellerBankAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSessionResolving, refreshCanonicalSession, sessionUser]);

  useEffect(() => {
    setListingCreateForm((prev) => syncListingBankSelection(prev, sellerBankAccounts));
    setListingEditForm((prev) => syncListingBankSelection(prev, sellerBankAccounts));
  }, [sellerBankAccounts]);

  const tradeReturnPath = selectedListing
    ? `/${locale}/usdt-exchange?listing=${encodeURIComponent(selectedListing.id)}`
    : `/${locale}/usdt-exchange`;

  const updateListingSelectionQuery = useCallback((listingId: string | null) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (listingId) {
      url.searchParams.set("listing", listingId);
    } else {
      url.searchParams.delete("listing");
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const closeListingModal = useCallback(() => {
    sellerProfileAbortControllerRef.current?.abort();
    setSelectedListing(null);
    setSellerProfileData(null);
    setStatusMessage(null);
    setShowVerificationCta(false);
    setIsRedirectingToVerification(false);
    setFaceToFaceSafetyAcknowledged(false);
    setPurchasePriceMode("listing_price");
    setBuyerOfferedPrice("");
    updateListingSelectionQuery(null);
  }, [setStatusMessage, updateListingSelectionQuery]);

  // Escape closes the open Buy or removal dialog (keyboard accessibility).
  useEffect(() => {
    if (!selectedListing && !removalListing) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (removalListing) setRemovalListing(null);
      else if (selectedListing) closeListingModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedListing, removalListing, closeListingModal]);

  const goToVerificationGate = useCallback(() => {
    setIsRedirectingToVerification(true);
    setStatusMessage(isAr ? "جارٍ الانتقال إلى التحقق..." : "Redirecting to verification...");
    router.push(`/verify-account?redirectTo=${encodeURIComponent(tradeReturnPath)}`);
  }, [isAr, router, setStatusMessage, tradeReturnPath]);
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState<"all" | SupportedNetwork>("all");
  const [showMarketplaceFilters, setShowMarketplaceFilters] = useState(false);
  const [showAllCompletedTrades, setShowAllCompletedTrades] = useState(false);
  const [minAmountFilter, setMinAmountFilter] = useState("");
  const [maxAmountFilter, setMaxAmountFilter] = useState("");
  const [minPriceFilter, setMinPriceFilter] = useState("");
  const [maxPriceFilter, setMaxPriceFilter] = useState("");
  const [trustScoreFilter, setTrustScoreFilter] = useState("");
  const [onlineOnlyFilter, setOnlineOnlyFilter] = useState(false);
  const [sortBy, setSortBy] = useState<"trust-desc" | "price-asc" | "amount-desc" | "trades-desc" | "rating-desc" | "response-fast" | "newest">("trust-desc");
  const [buyerTradeQuery, setBuyerTradeQuery] = useState("");
  const [buyerTradeStatus, setBuyerTradeStatus] = useState<"all" | "active" | PurchaseRequest["status"]>("all");
  const [sellerTradeQuery, setSellerTradeQuery] = useState("");
  const [sellerTradeStatus, setSellerTradeStatus] = useState<"all" | "active" | PurchaseRequest["status"]>("all");
  const [buyerExpandedTradeId, setBuyerExpandedTradeId] = useState<string | null>(null);
  const [sellerExpandedTradeId, setSellerExpandedTradeId] = useState<string | null>(null);
  const [sellerExpandedListingId, setSellerExpandedListingId] = useState<string | null>(null);
  const [sellerDashboardListingsTarget, setSellerDashboardListingsTarget] = useState<HTMLDivElement | null>(null);
  const [isSellerApplicationExpanded, setIsSellerApplicationExpanded] = useState(false);
  const [buyerTradeVisibleCount, setBuyerTradeVisibleCount] = useState(2);
  const [sellerPrimaryRequestsExpanded, setSellerPrimaryRequestsExpanded] = useState(false);
  const [sellerListingsExpanded, setSellerListingsExpanded] = useState(false);
  const [notificationCenterExpanded, setNotificationCenterExpanded] = useState(false);
  const [tradeReviewDrafts, setTradeReviewDrafts] = useState<Record<string, string>>({});
  const [sellerResponseDrafts, setSellerResponseDrafts] = useState<Record<string, string>>({});
  const [buyerEvidenceFiles, setBuyerEvidenceFiles] = useState<Record<string, File | null>>({});
  const [sellerEvidenceFiles, setSellerEvidenceFiles] = useState<Record<string, File | null>>({});
  const [sellerSafetyAcknowledgements, setSellerSafetyAcknowledgements] = useState<Record<string, boolean>>({});
  const [evidenceUploading, setEvidenceUploading] = useState<Record<string, boolean>>({});
  const [notifications, setNotifications] = useState<AlphaExchangeNotification[]>([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState<number | null>(null);
  const [activityHistory, setActivityHistory] = useState<AlphaExchangeActivityLogEntry[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationQuery, setNotificationQuery] = useState("");
  const [notificationCategory, setNotificationCategory] = useState<"all" | NotificationCategory>("all");
  const [notificationUnreadOnly, setNotificationUnreadOnly] = useState(false);
  const [mobileVisibleListingsCount, setMobileVisibleListingsCount] = useState(MOBILE_MARKETPLACE_BATCH_SIZE);
  const notificationsRequestIdRef = useRef(0);
  const deepLinkAppliedRef = useRef(false);
  const commissionPayDeepLinkHandledRef = useRef(false);
  const commissionPayIntentHandledRef = useRef<string | null>(null);
  const commissionNotificationSignatureRef = useRef<string | null>(null);
  const sellerWorkspaceResumeRefreshInFlightRef = useRef(false);
  const sellerDeferredPanelsSentinelRef = useRef<HTMLDivElement | null>(null);
  const bootstrapCompletedAtRef = useRef<number | null>(null);
  const renderCompleteRecordedRef = useRef(false);
  const interactivePaintRecordedRef = useRef(false);
  const notificationsLoadRecordedRef = useRef(false);
  const [showDeferredSections] = useState(true);
  const [showDeepDeferredSections] = useState(true);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const [buyerInfo, setBuyerInfo] = useState({ usdtAmount: "", receivingWalletAddress: "", receivingNetwork: "TRC20" as SupportedNetwork, cardlessBankName: "", cardlessWithdrawalCode: "", cardlessVerificationKind: "id_number" as CardlessVerificationKind, cardlessVerificationValue: "", cardlessIlsAmount: "" });
  const [sellerForm, setSellerForm] = useState<SellerApplicationForm>(() => ({
    firstName: initialSessionUser?.fullName?.split(" ")[0] ?? "",
    lastName: initialSessionUser?.fullName?.split(" ").slice(1).join(" ") ?? "",
    email: initialSessionUser?.email ?? "",
    whatsappNumber: initialSessionUser?.whatsappNumber ?? "",
    expectedMonthlyTradingVolume: "",
    additionalNotes: "",
  }));
  const sellerFormTouchedRef = useRef(false);
  const [sellerApplicationMethods, setSellerApplicationMethods] = useState<SellerApplicationMethod[]>(["USDT (ERC20 / Ethereum)"]);
  const sellerStatusForLanding = sessionUser?.sellerStatus ?? "buyer";
  const isApprovedSellerSession = sellerStatusForLanding === "approved_seller"
    && sessionUser?.sellerApprovalVerified === true;
  const hasSellerWorkspaceAccess = isApprovedSellerSession || sellerStatusForLanding === "suspended";
  const desktopSellerNavigation = isDesktopWorkspace && hasSellerWorkspaceAccess;
  const desktopBuyerNavigation = isDesktopWorkspace && !hasSellerWorkspaceAccess && Boolean(sessionUser && accountRoleIdentity(sessionUser) === "buyer");
  const desktopWorkspaceNavigation = desktopSellerNavigation || desktopBuyerNavigation;
  const isAdminSession = Boolean(sessionUser && hasRole(sessionUser, "admin"));

  const tracedFetch = useCallback(async (label: string, input: string, init?: RequestInit) => {
    const startedAt = Date.now();
    incrementLoginJourneyApiCall(input);
    const response = await fetch(input, init);
    const endedAt = Date.now();
    appendLoginJourneyStep(label, startedAt, endedAt, { endpoint: input.split("?")[0] ?? input, status: response.status });
    if (input.startsWith("/api/auth/me")) {
      appendLoginJourneyServerTimeline(response.headers.get("X-Auth-Me-Timeline"));
    }
    if (input.startsWith("/api/auth/profile")) {
      appendLoginJourneyServerTimeline(response.headers.get("X-Auth-Profile-Timeline"));
    }
    if (response.status === 401) {
      void refreshCanonicalSession?.({ force: true });
    }
    return response;
  }, [refreshCanonicalSession]);

  const tracedReadFetch = useCallback(async (label: string, input: string, init?: RequestInit) => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await tracedFetch(label, input, init);
        if (response.ok || response.status < 500 || attempt === 1) return response;
      } catch (error) {
        lastError = error;
        if (init?.signal?.aborted || attempt === 1) throw error;
      }
      // A recycled serverless worker can fail one read without making the
      // workspace unavailable. Retry quickly so existing data stays visible
      // and a temporary 5xx never becomes a false empty dashboard. One retry
      // avoids multiplying traffic while the database is genuinely offline.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    }
    throw lastError instanceof Error ? lastError : new Error("Read request failed.");
  }, [tracedFetch]);

  const { summary: sellerRankSummary, error: sellerRankError } = useSellerRankSummary({
    sellerId: sellerStatusForLanding === "approved_seller" && !isSessionResolving ? sessionUser?.id : undefined,
    requests: myRequests,
    fetchProfile: tracedReadFetch,
  });

  const refreshBuyerProfileSummary = useCallback(async () => {
    if (!sessionUser || hasSellerWorkspaceAccess) {
      setBuyerProfileSummary(null);
      return;
    }

    try {
      const response = await tracedReadFetch("Buyer profile summary loading", "/api/auth/profile", { cache: "no-store" });
      if (!response.ok) {
        setWorkspaceError(safeErrorMessage("workspace", isAr));
        return;
      }
      const payload = (await response.json()) as {
        stats?: {
          kind?: string;
          activeTrades?: number;
          completedTrades?: number;
          reviewsGiven?: number;
          lifetimeCompletedVolumeUsdt?: number;
        };
      };
      if (payload.stats?.kind !== "buyer") return;
      setBuyerProfileSummary(deriveBuyerRankSummary({
        activeTrades: Number(payload.stats.activeTrades ?? 0),
        completedTrades: Number(payload.stats.completedTrades ?? 0),
        reviewsGiven: Number(payload.stats.reviewsGiven ?? 0),
        lifetimeCompletedVolumeUsdt: Number(payload.stats.lifetimeCompletedVolumeUsdt ?? 0),
      }));
    } catch {
      // Preserve current state and disclose that the live summary is not ready.
      setWorkspaceError(safeErrorMessage("workspace", isAr));
    }
  }, [hasSellerWorkspaceAccess, isAr, sessionUser, tracedReadFetch]);

  useEffect(() => () => {
    for (const timer of discordSharePollTimersRef.current) window.clearTimeout(timer);
    discordSharePollTimersRef.current = [];
  }, []);

  const refreshMyPurchaseRequests = useCallback(async () => {
    try {
      const response = await tracedReadFetch(
        "Workspace data loading: purchase requests",
        "/api/alpha-exchange/purchase-requests",
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Purchase requests unavailable");
      const payload = (await response.json()) as { requests?: PurchaseRequest[] };
      setMyRequests(payload.requests ?? []);
      setPurchaseRequestsState("ready");
      return true;
    } catch {
      setPurchaseRequestsState("error");
      if (!desktopWorkspaceNavigation) setWorkspaceError(safeErrorMessage("workspace", isAr));
      return false;
    }
  }, [desktopWorkspaceNavigation, isAr, tracedReadFetch]);

  const refreshSellerWorkspace = useCallback(async (options?: { commissionId?: string }) => {
    const revisionAtStart = sellerWorkspaceRevisionRef.current;
    try {
      const commissionQuery = options?.commissionId?.trim()
        ? `?commissionId=${encodeURIComponent(options.commissionId.trim())}`
        : "";
      const [, myListingsRes, discordSharingRes] = await Promise.all([
        refreshMyPurchaseRequests(),
        tracedReadFetch("Workspace data loading: my listings", `/api/alpha-exchange/my-listings${commissionQuery}`, { cache: "no-store" }),
        tracedReadFetch("Workspace data loading: Discord sharing", "/api/alpha-exchange/discord-sharing", { cache: "no-store" }),
      ]);
      let refreshedCommissionStatus: SellerCommissionStatus | null = null;
      let sellerWorkspaceLoadFailed = false;
      if (myListingsRes.ok) {
        const myListingsJson = (await myListingsRes.json()) as {
          listings: MarketplaceListing[];
          summary?: {
            activeListingLimit: number;
            openListingCount: number;
            openTradeCount: number;
            pendingCommissionCount: number;
            canCreateListing: boolean;
            blockedReason: string | null;
            enforcement?: {
              restricted: boolean;
              blockReason: string | null;
            };
          };
          commissionStatus?: SellerCommissionStatus;
          commissionWalletConfiguration?: CommissionWalletConfiguration;
          qaCommissionModeEnabled?: boolean;
          qaCommissionResetEnabled?: boolean;
        };
        // A read started before a successful mutation cannot restore old data.
        if (revisionAtStart === sellerWorkspaceRevisionRef.current) {
          setMyListings((myListingsJson.listings ?? []).filter((listing) => listing.status !== "closed" && listing.status !== "cancelled"));
        }
        setSellerWorkspaceSummary(myListingsJson.summary ?? null);
        let incomingCommissionStatus = myListingsJson.commissionStatus ?? null;
        const openCommissionId = openCommissionIdRef.current;
        if (incomingCommissionStatus && openCommissionId && Array.isArray(incomingCommissionStatus.payableRecords)
          && !incomingCommissionStatus.payableRecords.some((record) => record.commissionId === openCommissionId)) {
          // Every refresh path (poll, focus, notification or manual action) must
          // retire a settled payment panel before showing another record. A
          // no-TxID deposit can settle without ever entering pending_verification.
          openCommissionIdRef.current = null;
          setCommissionPayOpen(false);
          setCommissionPayMessage(null);
          setCommissionTxSignature("");
          setCommissionPayerType(null);
          setCommissionAdvancedOpen(false);
          const nextRecord = incomingCommissionStatus.payableRecords[0];
          incomingCommissionStatus = {
            ...incomingCommissionStatus,
            commissionId: nextRecord?.commissionId,
            payableAmountDue: nextRecord?.paymentAmountDue ?? nextRecord?.amountDue ?? 0,
            dueAt: nextRecord?.dueAt,
            source: nextRecord?.source,
            issueReason: nextRecord?.issueReason,
            relatedRequestId: nextRecord?.relatedRequestId,
            relatedTradeId: nextRecord?.relatedTradeId,
            relatedTradeDisplayNumber: nextRecord?.relatedTradeDisplayNumber,
            selectionError: undefined,
          };
          setSellerWorkspaceMessage(incomingCommissionStatus.pendingCount
            ? (isAr ? "تم تحديث حالة الدفع. اختر العمولة التالية المستحقة عندما تكون مستعدًا." : "Payment status updated. Select the next outstanding commission when you are ready.")
            : (isAr ? "تم التحقق من الدفع وتسوية جميع العمولات المستحقة." : "Payment verified. All commission dues are settled."));
        }
        setSellerCommissionStatus((current) => {
          const incoming = incomingCommissionStatus;
          const selectedIdToPreserve = openCommissionIdRef.current ?? (!options?.commissionId ? current?.commissionId : undefined);
          const selected = selectedIdToPreserve
            ? incoming?.payableRecords?.find((record) => record.commissionId === selectedIdToPreserve)
            : undefined;
          // A slower general workspace response must not switch a payment
          // panel from the requested trade to the oldest outstanding fee.
          return incoming && selected ? { ...incoming,
            commissionId: selected.commissionId,
            payableAmountDue: selected.paymentAmountDue ?? selected.amountDue,
            dueAt: selected.dueAt,
            relatedRequestId: selected.relatedRequestId,
            relatedTradeId: selected.relatedTradeId,
            relatedTradeDisplayNumber: selected.relatedTradeDisplayNumber,
            selectionError: undefined,
          } : incoming;
        });
        refreshedCommissionStatus = incomingCommissionStatus;
        setCommissionWalletConfiguration(myListingsJson.commissionWalletConfiguration ?? null);
        setQaCommissionModeEnabled(Boolean(myListingsJson.qaCommissionModeEnabled));
        setQaCommissionResetEnabled(Boolean(myListingsJson.qaCommissionResetEnabled));
      } else {
        sellerWorkspaceLoadFailed = true;
        setWorkspaceError(await readApiErrorMessage(myListingsRes, safeErrorMessage("workspace", isAr)));
      }
      if (discordSharingRes.ok) {
        setDiscordSharing(await discordSharingRes.json() as DiscordListingSharingStatus);
      } else {
        setDiscordSharing({
          serverTime: new Date().toISOString(),
          nextEligibleAt: null,
          cooldownSecondsRemaining: 0,
          linked: false,
          available: false,
          listings: [],
        });
      }
      if (!sellerWorkspaceLoadFailed) setWorkspaceError(null);
      return refreshedCommissionStatus;
    } catch {
      setWorkspaceError(safeErrorMessage("workspace", isAr));
      return null;
    }
  }, [isAr, refreshMyPurchaseRequests, setCommissionPayMessage, setSellerWorkspaceMessage, tracedReadFetch]);

  // Purchase requests are financial state, so the workspace must converge even
  // when a user disabled in-app notifications or an SSE connection was lost.
  useEffect(() => {
    if (!sessionUser || isSessionResolving) return;
    let disposed = false;
    let inFlight = false;
    const refreshVisibleRequests = async () => {
      if (disposed || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        await refreshMyPurchaseRequests();
      } finally {
        inFlight = false;
      }
    };
    const resume = () => { void refreshVisibleRequests(); };
    const interval = window.setInterval(() => { void refreshVisibleRequests(); }, 12_000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [isSessionResolving, refreshMyPurchaseRequests, sessionUser]);

  const syncListingState = useCallback((listing: MarketplaceListing | null, options?: { remove?: boolean }) => {
    if (!listing) return;
    sellerWorkspaceRevisionRef.current += 1;
    const shouldRemove = options?.remove === true || listing.status === "closed" || listing.status === "cancelled";
    const isPubliclyVisible = ["active", "matched", "in_trade"].includes(listing.status) && listing.approvalStatus !== "pending" && listing.approvalStatus !== "rejected";
    setMyListings((prev) => {
      const next = shouldRemove ? prev.filter((item) => item.id !== listing.id) : [listing, ...prev.filter((item) => item.id !== listing.id)];
      return next.filter((item) => item.status !== "closed" && item.status !== "cancelled");
    });
    setListings((prev) => {
      const next = shouldRemove || !isPubliclyVisible
        ? prev.filter((item) => item.id !== listing.id)
        : [listing, ...prev.filter((item) => item.id !== listing.id)];
      return next.filter((item) => item.status !== "closed" && item.status !== "cancelled");
    });
  }, []);

  const backgroundRefreshSellerWorkspace = useCallback(() => {
    void refreshSellerWorkspace();
  }, [refreshSellerWorkspace]);

  const hasUnpaidCommissions = (sellerCommissionStatus?.pendingCount ?? 0) > 0;
  const selectedCommissionIdForRefresh = sellerCommissionStatus?.commissionId?.trim() || undefined;

  // A seller can keep this dashboard open while an administrator issues a
  // commission. Reconcile when the page regains focus even when there was no
  // existing debt to activate the payment-verification poller below.
  useEffect(() => {
    // Unpaid commissions have their own interval and resume listeners below.
    // Let that effect preserve the selected record without issuing a second
    // focus/visibility refresh at the same time.
    if (!hasSellerWorkspaceAccess || isSessionResolving || hasUnpaidCommissions) return;
    const refreshAfterResume = () => {
      if (document.visibilityState !== "visible" || commissionPayOpen || sellerWorkspaceResumeRefreshInFlightRef.current) return;
      sellerWorkspaceResumeRefreshInFlightRef.current = true;
      void refreshSellerWorkspace().finally(() => {
        sellerWorkspaceResumeRefreshInFlightRef.current = false;
      });
    };
    window.addEventListener("focus", refreshAfterResume);
    document.addEventListener("visibilitychange", refreshAfterResume);
    return () => {
      window.removeEventListener("focus", refreshAfterResume);
      document.removeEventListener("visibilitychange", refreshAfterResume);
    };
  }, [commissionPayOpen, hasUnpaidCommissions, hasSellerWorkspaceAccess, isSessionResolving, refreshSellerWorkspace]);

  useEffect(() => {
    if (!hasSellerWorkspaceAccess || isSessionResolving || !hasUnpaidCommissions) return;

    let disposed = false;
    let refreshInFlight = false;
    const refreshPendingCommission = async () => {
      if (disposed || refreshInFlight) return;
      refreshInFlight = true;
      try {
        const selectedCommissionId = openCommissionIdRef.current;
        await refreshSellerWorkspace(
          selectedCommissionId
            ? { commissionId: selectedCommissionId }
            : undefined,
        );
      } finally {
        refreshInFlight = false;
      }
    };
    const refreshAfterResume = () => {
      if (document.visibilityState === "visible") void refreshPendingCommission();
    };
    const intervalId = window.setInterval(() => {
      void refreshPendingCommission();
    }, 30_000);
    window.addEventListener("focus", refreshAfterResume);
    document.addEventListener("visibilitychange", refreshAfterResume);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshAfterResume);
      document.removeEventListener("visibilitychange", refreshAfterResume);
    };
  }, [hasUnpaidCommissions, hasSellerWorkspaceAccess, isSessionResolving, refreshSellerWorkspace]);

  const refreshDiscordSharingStatus = useCallback(async () => {
    const response = await tracedReadFetch(
      "Discord sharing status refresh",
      "/api/alpha-exchange/discord-sharing",
      { cache: "no-store" },
    );
    if (!response.ok) return;
    setDiscordSharing(await response.json() as DiscordListingSharingStatus);
  }, [tracedReadFetch]);

  const scheduleDiscordSharingRefreshes = useCallback(() => {
    for (const timer of discordSharePollTimersRef.current) window.clearTimeout(timer);
    discordSharePollTimersRef.current = [2_000, 5_000, 10_000].map((delay) =>
      window.setTimeout(() => {
        void refreshDiscordSharingStatus();
      }, delay));
  }, [refreshDiscordSharingStatus]);

  const openCommissionPaymentPanel = useCallback(() => {
    setCommissionPayOpen(true);
    setCommissionPayMessage(null);
    setCommissionTxSignature("");
    setCommissionPayerType(null);
    setCommissionAdvancedOpen(false);
  }, [setCommissionPayMessage]);

  const revealCommissionPaymentPanel = useCallback(() => {
    if (typeof window === "undefined") return;
    let attempts = 0;
    const reveal = () => {
      const target = document.getElementById("commission-payment");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.focus({ preventScroll: true });
        return;
      }
      attempts += 1;
      if (attempts < 24) window.requestAnimationFrame(reveal);
    };
    window.requestAnimationFrame(reveal);
  }, []);

  const openCommissionPayment = useCallback((commissionId: string) => {
    const normalizedCommissionId = commissionId.trim();
    if (!normalizedCommissionId) {
      setSellerWorkspaceMessage(isAr ? "لم يتم العثور على سجل عمولة محدد قابل للدفع." : "No exact payable commission record was found.");
      return;
    }

    // Pay Now is often pressed while the seller is already on this page. A
    // same-route router push does not remount the workspace, so relying on the
    // URL deep-link effect leaves the payment panel closed and merely jumps
    // the seller back to the top. Select the exact server-provided record and
    // reveal the panel immediately instead. The payment API independently
    // revalidates ownership, amount, network, destination, and signature.
    const payableRecord = sellerCommissionStatus?.payableRecords?.find(
      (record) => record.commissionId.trim() === normalizedCommissionId,
    );
    const isCurrentPayableRecord = sellerCommissionStatus?.commissionId?.trim() === normalizedCommissionId
      && (sellerCommissionStatus.payableAmountDue ?? 0) > 0;
    if (payableRecord || isCurrentPayableRecord) {
      if (payableRecord) {
        if (payableRecord.paymentNetwork === "TRC20" || payableRecord.paymentNetwork === "BEP20") setCommissionNetwork(payableRecord.paymentNetwork);
        setSellerCommissionStatus((current) => current ? {
          ...current,
          commissionId: payableRecord.commissionId,
          payableAmountDue: payableRecord.paymentAmountDue ?? payableRecord.amountDue,
          dueAt: payableRecord.dueAt,
          relatedRequestId: payableRecord.relatedRequestId,
          relatedTradeId: payableRecord.relatedTradeId,
          relatedTradeDisplayNumber: payableRecord.relatedTradeDisplayNumber,
          selectionError: undefined,
        } : current);
      }
      commissionPayDeepLinkHandledRef.current = true;
      setSellerWorkspaceMessage(null);
      openCommissionPaymentPanel();
      revealCommissionPaymentPanel();
      return;
    }

    // Keep a secure deep-link fallback for a stale workspace snapshot. The
    // reactive query handler below fetches and authorizes this exact record.
    router.push(commissionPaymentDestination(normalizedCommissionId));
  }, [isAr, openCommissionPaymentPanel, revealCommissionPaymentPanel, router, sellerCommissionStatus?.commissionId, sellerCommissionStatus?.payableAmountDue, sellerCommissionStatus?.payableRecords, setSellerWorkspaceMessage]);

  const reviewPayableCommissions = useCallback(() => {
    if (typeof document !== "undefined") {
      const target = document.getElementById("commission-status");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
        return;
      }
    }
    router.push("/usdt-exchange?commission=review#commission-status");
  }, [router]);

  const openMarketplaceCompliancePayment = useCallback(() => {
    router.push("/dashboard/seller/compliance-payment");
  }, [router]);

  const clearCommissionPayDeepLink = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("commission");
    url.searchParams.delete("commissionId");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (commissionPaymentIntent !== "pay") {
      commissionPayIntentHandledRef.current = null;
      return;
    }

    // Resolve the canonical actor, then load the exact payment independently
    // of unrelated workspace widgets.
    if (isSessionResolving) return;

    const intentKey = `${sessionUser?.id ?? "anonymous"}:${commissionPaymentIntentId || "missing-record"}`;
    if (commissionPayIntentHandledRef.current === intentKey) return;
    commissionPayIntentHandledRef.current = intentKey;
    commissionPayDeepLinkHandledRef.current = true;

    if (!sessionUser || !hasSellerWorkspaceAccess) {
      clearCommissionPayDeepLink();
      setSellerWorkspaceMessage(isAr ? "يلزم وجود مساحة عمل للبائع لدفع العمولة." : "A seller workspace is required to pay a commission.");
      return;
    }
    const requestedCommissionId = commissionPaymentIntentId || undefined;
    // Historical generic `commission=pay` links do not identify a record. Do
    // not turn them into permission to pay whichever commission happens to be
    // first in the seller workspace; the seller must reopen an exact current
    // payment notification instead.
    if (!requestedCommissionId) {
      clearCommissionPayDeepLink();
      setSellerWorkspaceMessage(isAr ? "رابط الدفع هذا لا يحتوي على سجل العمولة. افتح تذكير عمولة حاليًا." : "This payment link is missing its commission record. Please open a current commission reminder.");
      return;
    }
    const existingRecord = sellerCommissionStatus?.payableRecords?.find((record) => record.commissionId === requestedCommissionId);
    if (existingRecord) { openCommissionPayment(requestedCommissionId); clearCommissionPayDeepLink(); return; }
    void (async () => {
      // The normal workspace response selects the oldest due record. A
      // commission deep link must instead revalidate its exact record on the
      // server and must never silently pay a different one.
      let commissionStatus: SellerCommissionStatus | null = null;
      try {
        const response = await fetch(`/api/alpha-exchange/my-listings?commissionId=${encodeURIComponent(requestedCommissionId)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (response.ok) {
          const payload = await response.json();
          commissionStatus = payload.commissionStatus ?? null;
          if (commissionPayIntentHandledRef.current !== intentKey) return;
          setSellerCommissionStatus(commissionStatus);
          setCommissionWalletConfiguration(payload.commissionWalletConfiguration ?? null);
        }
      } catch { /* Show the retryable loading error below. */ }
      if (commissionPayIntentHandledRef.current !== intentKey) return;
      clearCommissionPayDeepLink();
      if (!commissionStatus) {
        setSellerWorkspaceMessage(isAr ? "تعذر تحميل حالة العمولة. حاول مرة أخرى." : "Unable to load commission status. Please retry.");
        return;
      }
      if (commissionStatus.selectionError) {
        setSellerWorkspaceMessage(isAr ? "تعذّر تحديد العمولة. اختر سجلاً غير مدفوع وحاول مرة أخرى." : commissionStatus.selectionError);
        // Restore the ordinary seller workspace selection after rejecting an
        // untrusted/stale deep link; it must not leave the page aimed at an
        // empty payment record.
        void refreshSellerWorkspace();
        return;
      }
      if (commissionStatus.status === "clear" || !commissionStatus.commissionId) {
        setSellerWorkspaceMessage(isAr ? "لم يتم العثور على سجل عمولة قابل للدفع." : "No payable commission record was found.");
        return;
      }

      openCommissionPaymentPanel();
      revealCommissionPaymentPanel();
    })();
  }, [clearCommissionPayDeepLink, commissionPaymentIntent, commissionPaymentIntentId, isAr, hasSellerWorkspaceAccess, isSessionResolving, openCommissionPaymentPanel, revealCommissionPaymentPanel, refreshSellerWorkspace, sessionUser, sellerCommissionStatus, openCommissionPayment, setSellerWorkspaceMessage]);

  const refreshNotifications = useCallback(async (options?: { category?: "all" | NotificationCategory; query?: string; unreadOnly?: boolean }) => {
    if (!sessionUser) return;
    const requestId = notificationsRequestIdRef.current + 1;
    notificationsRequestIdRef.current = requestId;
    const category = options?.category ?? notificationCategory;
    const query = options?.query ?? notificationQuery;
    const unreadOnly = options?.unreadOnly ?? notificationUnreadOnly;
    setNotificationsLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (query.trim()) params.set("q", query.trim());
      if (unreadOnly) params.set("unreadOnly", "1");
      params.set("includeActivity", "0");
      const notificationsStartedAt = Date.now();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await tracedReadFetch("Notifications loading", `/api/alpha-exchange/notifications?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!response.ok) throw new Error("failed");
      const payload = (await response.json()) as {
        notifications: AlphaExchangeNotification[];
        activity: AlphaExchangeActivityLogEntry[];
        unreadCount?: number;
      };
      if (requestId !== notificationsRequestIdRef.current) return;
      setNotifications(keepLatestItems(sortNotificationsNewestFirst(payload.notifications ?? []), MAX_NOTIFICATION_ITEMS));
      if (typeof payload.unreadCount === "number" && Number.isFinite(payload.unreadCount)) {
        setNotificationUnreadCount(Math.max(0, payload.unreadCount));
      }
      if (Array.isArray(payload.activity)) {
        setActivityHistory(keepLatestItems(payload.activity, MAX_ACTIVITY_ITEMS));
      }
      if (!notificationsLoadRecordedRef.current) {
        notificationsLoadRecordedRef.current = true;
        appendLoginJourneyStep("Notifications loading (first dashboard load)", notificationsStartedAt, Date.now(), { firstLoad: true });
      }
    } catch {
      setWorkspaceError(safeErrorMessage("workspace", isAr));
    } finally {
      setNotificationsLoading(false);
    }
  }, [isAr, notificationCategory, notificationQuery, notificationUnreadOnly, sessionUser, tracedReadFetch]);

  const handleMarkAllNotificationsRead = useCallback(async () => {
    try {
      const response = await fetch("/api/alpha-exchange/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      if (!response.ok) {
        setStatusMessage(await readApiErrorMessage(response, safeErrorMessage("workspace", isAr)));
        return;
      }
      await refreshNotifications();
    } catch {
      setStatusMessage(safeErrorMessage("workspace", isAr));
    }
  }, [isAr, refreshNotifications, setStatusMessage]);

  const handleNotificationReadState = useCallback(async (notificationId: string, isRead: boolean) => {
    try {
      const response = await fetch(`/api/alpha-exchange/notifications/${notificationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead }),
      });
      if (!response.ok) {
        setStatusMessage(await readApiErrorMessage(response, safeErrorMessage("workspace", isAr)));
        return;
      }
      await refreshNotifications();
    } catch {
      setStatusMessage(safeErrorMessage("workspace", isAr));
    }
  }, [isAr, refreshNotifications, setStatusMessage]);

  const handleDeleteNotification = useCallback(async (notificationId: string) => {
    try {
      const response = await fetch(`/api/alpha-exchange/notifications/${notificationId}`, { method: "DELETE" });
      if (!response.ok) {
        setStatusMessage(await readApiErrorMessage(response, safeErrorMessage("workspace", isAr)));
        return;
      }
      await refreshNotifications();
    } catch {
      setStatusMessage(safeErrorMessage("workspace", isAr));
    }
  }, [isAr, refreshNotifications, setStatusMessage]);

  useEffect(() => {
    if (isLoginJourneyTraceEnabled()) {
      finalizeLoginJourneyRedirectEnd(Date.now());
    }

    const controller = new AbortController();
    let cancelled = false;

    async function loadListings(shellReadyAt: number, listingsPromise: Promise<Response>) {
      try {
        const listingsRes = await listingsPromise;
        if (cancelled) return;
        if (!listingsRes.ok) throw new Error("Marketplace listings are temporarily unavailable.");
        const listingsJson = (await listingsRes.json()) as { listings: MarketplaceListing[] };
        if (cancelled) return;
        setListings(listingsJson.listings ?? []);
        listingsLoadedAtRef.current = Date.now();
        appendLoginJourneyStep("Dashboard data loading", shellReadyAt, Date.now());
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!cancelled) setWorkspaceError(safeErrorMessage("workspace", isAr));
      } finally {
        if (!cancelled) setIsLoadingListings(false);
      }
    }

    async function bootstrap() {
      const workspaceInitStartedAt = Date.now();
      try {
        const listingsPromise = tracedReadFetch("Dashboard data loading: listings", "/api/alpha-exchange/listings", { cache: "no-store", signal: controller.signal });
        const shellReadyAt = Date.now();
        appendLoginJourneyStep("Dashboard shell ready", workspaceInitStartedAt, shellReadyAt);
        bootstrapCompletedAtRef.current = shellReadyAt;
        appendLoginJourneyStep("Workspace initialization", workspaceInitStartedAt, shellReadyAt);

        // Listings are not required to make the dashboard shell interactive.
        // Start the fetch in parallel with session bootstrap and resolve it after shell-ready.
        void loadListings(shellReadyAt, listingsPromise);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setIsLoadingListings(false);
        setIsWorkspaceWidgetsLoading(false);
        setIsSellerApplicationLoading(false);
        setWorkspaceError(safeErrorMessage("workspace", isAr));
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isAr, tracedReadFetch]);

  useEffect(() => {
    if (!sessionUser) return;
    if (!sellerFormTouchedRef.current) {
      setSellerForm((prev) => ({
        ...prev,
        firstName: sessionUser.fullName?.split(" ")[0] ?? prev.firstName,
        lastName: sessionUser.fullName?.split(" ").slice(1).join(" ") ?? prev.lastName,
        email: sessionUser.email ?? prev.email,
        whatsappNumber: sessionUser.whatsappNumber || prev.whatsappNumber,
      }));
    }
  }, [sessionUser]);

  useEffect(() => {
    if (isSessionResolving) return;
    if (!sessionUser) {
      setIsSellerApplicationLoading(false);
      setIsWorkspaceWidgetsLoading(false);
      return;
    }
    setIsWorkspaceWidgetsLoading(true);
    setIsSellerApplicationLoading(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [applicationRes] = await Promise.all([
            tracedReadFetch("Workspace data loading: seller application", "/api/alpha-exchange/seller-application", { cache: "no-store" }),
            hasSellerWorkspaceAccess ? refreshSellerWorkspace() : refreshMyPurchaseRequests(),
          ]);
          if (cancelled) return;
          if (applicationRes.ok) {
            const applicationJson = (await applicationRes.json()) as { application: SellerApplication | null };
            if (cancelled) return;
            setSellerApplication(applicationJson.application);
          }
        } catch {
          if (!cancelled) setWorkspaceError(safeErrorMessage("workspace", isAr));
        } finally {
          if (!cancelled) {
            setIsSellerApplicationLoading(false);
            setIsWorkspaceWidgetsLoading(false);
          }
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasSellerWorkspaceAccess, isAr, isSessionResolving, refreshMyPurchaseRequests, refreshSellerWorkspace, sessionUser, tracedReadFetch]);

  useEffect(() => {
    if (!hasSellerWorkspaceAccess || isSessionResolving || deferredSellerPanelsReady) return;
    const sentinel = sellerDeferredPanelsSentinelRef.current;
    if (!sentinel) return;
    if (typeof IntersectionObserver === "undefined") {
      setDeferredSellerPanelsReady(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setDeferredSellerPanelsReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: "220px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [deferredSellerPanelsReady, hasSellerWorkspaceAccess, isSessionResolving]);

  useEffect(() => {
    if (!hasSellerWorkspaceAccess) {
      setDeferredSellerPanelsReady(false);
    }
  }, [hasSellerWorkspaceAccess]);

  useEffect(() => {
    if (!sessionUser || notificationsInitialized) return;
    if (isSessionResolving) return;
    setNotificationsInitialized(true);
  }, [isSessionResolving, notificationsInitialized, sessionUser]);

  useEffect(() => {
    if (!sessionUser || hasSellerWorkspaceAccess) return;
    void refreshBuyerProfileSummary();
  }, [hasSellerWorkspaceAccess, myRequests, refreshBuyerProfileSummary, sessionUser]);

  useEffect(() => {
    if (!sessionUser || !notificationsInitialized) return;
    void refreshNotifications();
  }, [sessionUser, notificationsInitialized, notificationCategory, notificationQuery, notificationUnreadOnly, refreshNotifications]);

  const handleNotificationStream = useCallback((event: Event) => {
    const messageEvent = event as MessageEvent<string>;
    try {
      const payload = JSON.parse(messageEvent.data) as { notifications?: AlphaExchangeNotification[]; unreadCount?: number };
      if (!Array.isArray(payload.notifications)) return;
      setNotifications(keepLatestItems(sortNotificationsNewestFirst(payload.notifications), MAX_NOTIFICATION_ITEMS));
      if (typeof payload.unreadCount === "number" && Number.isFinite(payload.unreadCount)) {
        setNotificationUnreadCount(Math.max(0, payload.unreadCount));
      }

      // Due and verified notifications both change the seller's payable state.
      // Include final settlement even when no next commission link is present.
      const commissionSignature = payload.notifications
        .filter((notification) => notification.reason === "commission_payment_verified"
          || Boolean(getCommissionPaymentNotificationDestination(notification)))
        .map((notification) => `${notification.id}:${notification.updatedAt ?? notification.createdAt}`)
        .sort()
        .join("|");
      const previousCommissionSignature = commissionNotificationSignatureRef.current;
      commissionNotificationSignatureRef.current = commissionSignature;
      if (
        hasSellerWorkspaceAccess
        && commissionSignature
        && commissionSignature !== previousCommissionSignature
      ) {
        void refreshSellerWorkspace(
          commissionPayOpen && selectedCommissionIdForRefresh
            ? { commissionId: selectedCommissionIdForRefresh }
            : undefined,
        );
      }
    } catch {
      // Keep stream updates best-effort and preserve current UI state on malformed payloads.
    }
  }, [commissionPayOpen, hasSellerWorkspaceAccess, refreshSellerWorkspace, selectedCommissionIdForRefresh]);
  useAuthenticatedNotificationStream({ enabled: Boolean(sessionUser && notificationsInitialized), onNotifications: handleNotificationStream });

  useEffect(() => {
    if (isSessionResolving) return;
    if (renderCompleteRecordedRef.current) return;
    renderCompleteRecordedRef.current = true;
    const renderEndedAt = Date.now();
    const renderStartedAt = bootstrapCompletedAtRef.current ?? renderEndedAt;
    appendLoginJourneyStep("React render complete", renderStartedAt, renderEndedAt);

    if (!interactivePaintRecordedRef.current) {
      interactivePaintRecordedRef.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          appendLoginJourneyStep("First interactive paint", renderEndedAt, Date.now());
        });
      });
    }
  }, [isSessionResolving]);

  const scrollToCreateListingSection = useCallback(() => {
    if (typeof document === "undefined") return false;
    const target = document.getElementById("create-listing") ?? document.getElementById("create-listing-form");
    if (desktopSellerNavigation) return focusWorkspaceSection(target?.id ?? "create-listing");
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }, [desktopSellerNavigation]);

  const scrollToMyListingsSection = useCallback(() => {
    return focusWorkspaceSection("my-listings-section");
  }, []);

  const scrollToBuyerTradeHistorySection = useCallback(() => {
    return focusWorkspaceSection(BUYER_TRADE_HISTORY_SECTION_ID);
  }, []);

  useEffect(() => {
    if (!desktopBuyerNavigation || isDashboardWorkspace) return;
    const focusDesktopDestination = () => {
      const sectionId = window.location.hash.slice(1);
      if (sectionId === "buyer-marketplace-listings" || sectionId === "market-overview") focusWorkspaceSection(sectionId);
    };
    focusDesktopDestination();
    window.addEventListener("hashchange", focusDesktopDestination);
    return () => window.removeEventListener("hashchange", focusDesktopDestination);
  }, [desktopBuyerNavigation, isDashboardWorkspace]);

  const fetchSellerProfileData = useCallback(async (sellerId: string) => {
    const requestId = sellerProfileRequestIdRef.current + 1;
    sellerProfileRequestIdRef.current = requestId;
    sellerProfileAbortControllerRef.current?.abort();
    const controller = new AbortController();
    sellerProfileAbortControllerRef.current = controller;
    setIsSellerProfileLoading(true);
    try {
      const response = await fetch(`/api/alpha-exchange/sellers/${sellerId}/profile`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as { profile?: PremiumSellerProfileData; error?: string };
      if (requestId !== sellerProfileRequestIdRef.current || controller.signal.aborted) return;
      if (!response.ok || !payload.profile) {
        setSellerProfileData(null);
        setStatusMessage(isAr ? safeErrorMessage("workspace", true) : (payload.error ?? safeErrorMessage("workspace", false)));
        return;
      }
      setSellerProfileData(payload.profile);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (requestId !== sellerProfileRequestIdRef.current) return;
      setSellerProfileData(null);
      setStatusMessage(safeErrorMessage("workspace", isAr));
    } finally {
      if (requestId === sellerProfileRequestIdRef.current) {
        sellerProfileAbortControllerRef.current = null;
        setIsSellerProfileLoading(false);
      }
    }
  }, [isAr, setStatusMessage]);

  useEffect(() => {
    if (!selectedListing) return;
    const timerId = window.setTimeout(() => {
      void fetchSellerProfileData(selectedListing.sellerId);
    }, 250);
    return () => {
      window.clearTimeout(timerId);
      sellerProfileAbortControllerRef.current?.abort();
    };
  }, [fetchSellerProfileData, selectedListing]);

  // Scroll to create-listing when navigated with hash, retrying briefly while deferred UI mounts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "").trim();
    if (hash !== "create-listing" && hash !== "create-listing-form") return;
    if (scrollToCreateListingSection()) return;
    const startedAt = Date.now();
    let frame = 0;
    const tryScroll = () => {
      if (scrollToCreateListingSection()) return;
      if (Date.now() - startedAt > 10000) return;
      frame = window.requestAnimationFrame(tryScroll);
    };
    frame = window.requestAnimationFrame(tryScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [isApprovedSellerSession, isLoadingListings, scrollToCreateListingSection]);

  // Notification actions target one seller-owned listing. Retry only while the
  // deferred seller workspace finishes mounting, then focus the exact status.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const anchor = window.location.hash.replace("#", "").trim();
    if (!anchor.startsWith("seller-listing-")) return;
    const selected = myListings.find((listing) => `seller-listing-${encodeURIComponent(listing.id)}` === anchor);
    if (selected) {
      setSellerListingsExpanded(true);
      setSellerExpandedListingId(selected.id);
    }
    let frame = 0;
    let attempts = 0;
    const reveal = () => {
      const target = document.getElementById(anchor);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus({ preventScroll: true });
        return;
      }
      attempts += 1;
      if (attempts < 24) frame = window.requestAnimationFrame(reveal);
    };
    reveal();
    return () => window.cancelAnimationFrame(frame);
  }, [isWorkspaceWidgetsLoading, myListings]);

  useEffect(() => {
    if (isLoadingListings || selectedListing || !sessionUser) return;
    if (typeof window === "undefined") return;
    const listingId = new URLSearchParams(window.location.search).get("listing");
    if (!listingId) return;
    const listing = listings.find((item) => item.id === listingId);
    if (!listing) {
      updateListingSelectionQuery(null);
      setStatusMessage(isAr ? "هذا العرض لم يعد متاحًا." : "This listing is no longer available.");
      return;
    }
    setSelectedListing(listing);
    setPurchasePriceMode("listing_price");
    setBuyerOfferedPrice("");
    setSelectedPurchasePaymentMethod(normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod)[0] ?? "Bank Transfer");
    setSellerProfileData(null);
    setPurchaseSubmitted(false);
    setShowVerificationCta(false);
    setIsRedirectingToVerification(false);
    setFaceToFaceSafetyAcknowledged(false);
    setBuyerInfo((prev) => ({
      ...prev,
      usdtAmount: normalizeTradeAmountInput(listing.minimumTrade || listing.availableAmount),
      receivingWalletAddress: "", receivingNetwork: listing.network, cardlessBankName: "", cardlessWithdrawalCode: "", cardlessVerificationKind: "id_number", cardlessVerificationValue: "", cardlessIlsAmount: "",
    }));
  }, [isAr, isLoadingListings, listings, selectedListing, sessionUser, setStatusMessage, updateListingSelectionQuery]);

  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    if (typeof window === "undefined") return;
    deepLinkAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const sort = params.get("sort");
    const approvedOnly = params.get("approved") === "1";

    if (sort && ["trust-desc", "price-asc", "amount-desc", "trades-desc", "rating-desc", "response-fast", "newest"].includes(sort)) {
      setSortBy(sort as "trust-desc" | "price-asc" | "amount-desc" | "trades-desc" | "rating-desc" | "response-fast" | "newest");
    }
    if (approvedOnly) {
      setShowMarketplaceFilters(true);
      setOnlineOnlyFilter(true);
      setTrustScoreFilter((prev) => prev || "40");
    }
    if (mode === "sell") {
      requestAnimationFrame(() => {
        scrollToCreateListingSection();
      });
      return;
    }
    if (mode === "buy") {
      updateListingSelectionQuery(null);
      const target = document.getElementById("marketplace-sellers") ?? document.getElementById("marketplace");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isAr, scrollToCreateListingSection, updateListingSelectionQuery]);

  useEffect(() => {
    if (!qaCommissionModeEnabled || !qaCommissionResetEnabled) return;
    if (!sellerCommissionStatus || sellerCommissionStatus.status === "clear") return;
    if (sellerCommissionStatus.amountDue <= 1) return;
    if (qaCommissionResetAttemptedRef.current) return;
    qaCommissionResetAttemptedRef.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/alpha-exchange/commissions/qa-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) return;
        setCommissionPayMessage(isAr ? "اكتمل تنظيف عمولات الاختبار." : "QA commission cleanup completed.");
        await refreshSellerWorkspace();
      } catch {
        // Keep normal commission flow available if QA cleanup fails.
      }
    })();
  }, [isAr, qaCommissionModeEnabled, qaCommissionResetEnabled, refreshSellerWorkspace, sellerCommissionStatus, setCommissionPayMessage]);

  // Generate QR code when commission modal opens or network changes
  useEffect(() => {
    if (!commissionPayOpen) return;
    const address = selectedCommissionWalletAvailable ? selectedCommissionWallet : "";
    if (!address) { setCommissionQrDataUrl(null); return; }
    let cancelled = false;
    void import("qrcode").then((QRCode) => {
      void QRCode.toDataURL(address, { width: 160, margin: 1, color: { dark: "#000000", light: "#ffffff" } }).then((url: string) => {
        if (!cancelled) setCommissionQrDataUrl(url);
      });
    });
    return () => { cancelled = true; };
  }, [commissionPayOpen, selectedCommissionWallet, selectedCommissionWalletAvailable]);

  const features = useMemo<FeatureCard[]>(() => [
    {
      icon: ShieldCheck,
      title: isAr ? "مجتمع موثوق" : "Trusted Community",
      body: isAr ? "مجتمع جاد يلتزم بالوضوح والاحترافية في كل عملية." : "A serious community built on clear, professional trade coordination.",
    },
    {
      icon: BadgePercent,
      title: isAr ? "رسوم خدمة شفافة 1%" : "Transparent 1% Service Fee",
      body: isAr ? "رسوم ثابتة وواضحة على كل عملية تتم عبر Alpha Exchange." : "A simple, transparent 1% fee for each facilitated marketplace transaction.",
    },
    {
      icon: HandCoins,
      title: isAr ? "تنسيق احترافي" : "Professional Coordination",
      body: isAr ? "Alpha Traders ينسق العملية بين الطرفين خطوة بخطوة." : "Alpha Traders coordinates each side through a clear transaction flow.",
    },
    {
      icon: Clock3,
      title: isAr ? "تواصل سريع" : "Fast Communication",
      body: isAr ? "متابعة مباشرة وسريعة لتقليل وقت الانتظار وتسهيل الإتمام." : "Direct and fast communication to keep transaction flow efficient.",
    },
    {
      icon: Network,
      title: isAr ? "شبكات USDT متعددة" : "Multiple USDT Networks",
      body: isAr ? "دعم شبكات شائعة لتناسب خيارات البائعين والمشترين." : "Support for common USDT networks based on buyer and seller preferences.",
    },
    {
      icon: Sparkles,
      title: isAr ? "تجربة عملاء بريميوم" : "Premium Customer Experience",
      body: isAr ? "واجهة وتجربة احترافية تمنحك ثقة ووضوح في كل مرحلة." : "A premium, confidence-first experience with clear process visibility.",
    },
  ], [isAr]);

  const faqs = useMemo(() => [
    {
      q: isAr ? "كيف يعمل Alpha Exchange؟" : "How does Alpha Exchange work?",
      a: isAr
        ? "Alpha Exchange سوق منظم يربط بين البائعين والمشترين بينما يقوم Alpha Traders بتنسيق العملية والتحقق من تفاصيل التنفيذ."
        : "Alpha Exchange is a structured marketplace where Alpha Traders coordinates and verifies transactions between buyers and sellers.",
    },
    {
      q: isAr ? "كيف يتم احتساب رسوم الخدمة 1%؟" : "How is the 1% service fee calculated?",
      a: isAr
        ? "يتم احتساب نسبة 1% بشكل واضح على العملية المنسقة عبر Alpha Exchange ويتم توضيحها قبل الإتمام."
        : "A transparent 1% service fee is calculated on each facilitated exchange and confirmed before finalization.",
    },
    {
      q: isAr ? "ما الشبكات المدعومة لـ USDT؟" : "Which USDT networks are supported?",
      a: isAr ? "يدعم السوق شبكات شائعة مثل TRC20 وERC20 وBEP20 مع تأكيد الشبكة المناسبة قبل التنفيذ." : "The marketplace supports common networks such as TRC20, ERC20, and BEP20 based on listing terms.",
    },
    {
      q: isAr ? "كيف أنشئ عرض بيع؟" : "How do I create a listing?",
      a: isAr ? "استخدم نموذج التقديم كبائع معتمد، وبعد المراجعة والموافقة يمكنك نشر عروضك." : "Use the approved-seller application form. Once reviewed and approved, you can publish listings.",
    },
    {
      q: isAr ? "كم تستغرق المعاملة عادة؟" : "How long does a transaction usually take?",
      a: isAr ? "المدة تعتمد على استجابة الطرفين والشبكة المختارة، ويتم التنسيق بشكل سريع عبر فريق Alpha Traders." : "Timing depends on both parties and selected network, with Alpha Traders coordinating for fast completion.",
    },
  ], [isAr]);

  const livePresence = useLivePresenceMap(listings.map(listing => listing.sellerId));
  const filteredListings = useMemo(() => {
    const filtered = listings.filter((listing) => {
      const price = toNumber(listing.price);
      const amount = toNumber(listing.availableAmount);
      const minAmount = toNumber(minAmountFilter);
      const maxAmount = toNumber(maxAmountFilter);
      const minPrice = toNumber(minPriceFilter);
      const maxPrice = toNumber(maxPriceFilter);
      const trustScoreThreshold = toNumber(trustScoreFilter);
      const networkPass = networkFilter === "all" || listing.network === networkFilter;
      const currencyPass = currencyFilter === "all" || listing.currency.toLowerCase() === currencyFilter.toLowerCase();
      const methods = listing.paymentMethods?.length ? listing.paymentMethods : [listing.paymentMethod];
      const paymentMethodPass = paymentMethodFilter === "all" || methods.some((method) => method.toLowerCase() === paymentMethodFilter.toLowerCase());
      const minAmountPass = !minAmount || amount >= minAmount;
      const maxAmountPass = !maxAmount || amount <= maxAmount;
      const minPricePass = !minPrice || price >= minPrice;
      const maxPricePass = !maxPrice || price <= maxPrice;
      const trustPass = !trustScoreThreshold || (listing.sellerReputation?.trustScore ?? 0) >= trustScoreThreshold;
      const onlinePass = !onlineOnlyFilter || deriveSellerPresence(livePresence[listing.sellerId] ?? listing.sellerProfile ?? {}).online;
      return networkPass && currencyPass && paymentMethodPass && minAmountPass && maxAmountPass && minPricePass && maxPricePass && trustPass && onlinePass;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortBy === "trust-desc") {
        const rankPriority = sellerMarketplaceRankPriority(a) - sellerMarketplaceRankPriority(b);
        if (rankPriority !== 0) return rankPriority;
        const featuredPriority = Number(Boolean(b.sellerProfile?.isFeaturedSeller)) - Number(Boolean(a.sellerProfile?.isFeaturedSeller));
        if (featuredPriority !== 0) return featuredPriority;
        const trustPriority = (b.sellerReputation?.trustScore ?? 0) - (a.sellerReputation?.trustScore ?? 0);
        if (trustPriority !== 0) return trustPriority;
        const ratingPriority = (b.sellerReputation?.rating ?? 0) - (a.sellerReputation?.rating ?? 0);
        if (ratingPriority !== 0) return ratingPriority;
        const responsePriority = (a.sellerReputation?.responseTimeMinutes ?? parseMinutes(a.responseTime)) - (b.sellerReputation?.responseTimeMinutes ?? parseMinutes(b.responseTime));
        if (responsePriority !== 0) return responsePriority;
        return (b.sellerReputation?.completedTrades ?? 0) - (a.sellerReputation?.completedTrades ?? 0);
      }
      if (sortBy === "price-asc") return toNumber(a.price) - toNumber(b.price);
      if (sortBy === "amount-desc") return toNumber(b.availableAmount) - toNumber(a.availableAmount);
      if (sortBy === "trades-desc") return (b.sellerReputation?.completedTrades ?? 0) - (a.sellerReputation?.completedTrades ?? 0);
      if (sortBy === "rating-desc") return (b.sellerReputation?.rating ?? 0) - (a.sellerReputation?.rating ?? 0);
      return toNumber(a.responseTime) - toNumber(b.responseTime);
    });
    if (sortBy === "newest") {
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return sorted;
  }, [livePresence, listings, networkFilter, currencyFilter, paymentMethodFilter, minAmountFilter, maxAmountFilter, minPriceFilter, maxPriceFilter, trustScoreFilter, onlineOnlyFilter, sortBy]);

  useEffect(() => {
    if (!isMobileViewport) return;
    setMobileVisibleListingsCount(MOBILE_MARKETPLACE_BATCH_SIZE);
  }, [
    isMobileViewport,
    currencyFilter,
    paymentMethodFilter,
    networkFilter,
    minAmountFilter,
    maxAmountFilter,
    minPriceFilter,
    maxPriceFilter,
    trustScoreFilter,
    onlineOnlyFilter,
    sortBy,
  ]);

  const visibleListings = useMemo(() => {
    if (!isMobileViewport) return filteredListings;
    return filteredListings.slice(0, mobileVisibleListingsCount);
  }, [filteredListings, isMobileViewport, mobileVisibleListingsCount]);

  const uniqueCurrencies = useMemo(
    () => Array.from(new Set(listings.map((l) => l.currency))).sort(),
    [listings]
  );
  const uniquePaymentMethods = useMemo(
    () => Array.from(new Set(listings.flatMap((l) => l.paymentMethods?.length ? l.paymentMethods : [l.paymentMethod]))).sort(),
    [listings]
  );
  const requireAuth = useCallback(() => {
    if (isSessionResolving || sessionResolutionError) {
      setStatusMessage(isAr ? "نعيد الاتصال بحسابك. يُرجى المحاولة بعد لحظات." : "Reconnecting to your account. Please try again in a moment.");
      return false;
    }
    if (!sessionUser) {
      router.push(`/login?redirectTo=${encodeURIComponent(tradeReturnPath)}`);
      return false;
    }
    return true;
  }, [isSessionResolving, sessionResolutionError, sessionUser, setStatusMessage, isAr, router, tradeReturnPath]);

  async function handleOwnerSellerProfileState(sellerId: string, state: { feature?: boolean; hidden?: boolean }, successMessage: string) {
    setIsOwnerProfileActionLoading(true);
    try {
      const response = await fetch(`/api/alpha-exchange/admin/sellers/${sellerId}/profile-state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatusMessage(isAr ? safeErrorMessage("request", true) : (payload.error ?? safeErrorMessage("request", false)));
        return;
      }
      setStatusMessage(successMessage);
      await Promise.all([refreshSellerWorkspace(), fetchSellerProfileData(sellerId)]);
    } catch {
      setStatusMessage(safeErrorMessage("request", isAr));
    } finally {
      setIsOwnerProfileActionLoading(false);
    }
  }

  async function handleOwnerSuspendSeller(sellerId: string) {
    setIsOwnerProfileActionLoading(true);
    try {
      const response = await fetch(`/api/alpha-exchange/admin/sellers/${sellerId}/suspend`, { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatusMessage(isAr ? safeErrorMessage("request", true) : (payload.error ?? safeErrorMessage("request", false)));
        return;
      }
      setStatusMessage(isAr ? "تم إيقاف البائع." : "Seller suspended.");
      await Promise.all([refreshSellerWorkspace(), fetchSellerProfileData(sellerId)]);
    } catch {
      setStatusMessage(safeErrorMessage("request", isAr));
    } finally {
      setIsOwnerProfileActionLoading(false);
    }
  }

  const openListingModal = useCallback((listing: MarketplaceListing, priceMode: "listing_price" | "buyer_offer" = "listing_price") => {
    if (!requireAuth()) return;
    const supportedMethods = normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod);
    const offerBounds = getPriceOfferBounds(listing.price);
    setSelectedListing(listing);
    setPurchasePriceMode(priceMode);
    setBuyerOfferedPrice(priceMode === "buyer_offer" && offerBounds && toNumber(offerBounds.listingPrice) > 0.01
      ? (toNumber(offerBounds.listingPrice) - 0.01).toFixed(2)
      : "");
    setSelectedPurchasePaymentMethod(supportedMethods[0] ?? "Bank Transfer");
    setSellerProfileData(null);
    setPurchaseSubmitted(false);
    setStatusMessage(null);
    setShowVerificationCta(false);
    setIsRedirectingToVerification(false);
    setFaceToFaceSafetyAcknowledged(false);
    updateListingSelectionQuery(listing.id);
    setBuyerInfo((prev) => ({
      ...prev,
      usdtAmount: normalizeTradeAmountInput(listing.minimumTrade || listing.availableAmount),
      receivingWalletAddress: "", receivingNetwork: listing.network, cardlessBankName: "", cardlessWithdrawalCode: "", cardlessVerificationKind: "id_number", cardlessVerificationValue: "", cardlessIlsAmount: "",
    }));
  }, [requireAuth, setStatusMessage, updateListingSelectionQuery]);

  const handleManageOwnedListing = useCallback((listing: MarketplaceListing) => {
    if (!requireAuth()) return;
    setSellerListingsExpanded(true);
    setSellerExpandedListingId(listing.id);
    setSellerWorkspaceMessage(null);
    if (scrollToMyListingsSection()) {
      return;
    }
    if (isSellerDashboardWorkspace) {
      window.requestAnimationFrame(() => {
        if (!scrollToMyListingsSection()) {
          setSellerWorkspaceMessage(isAr ? "ما زالت مساحة العروض قيد التحميل. حاول بعد لحظات." : "Your listings workspace is still loading. Please try again in a moment.");
        }
      });
      return;
    }
    router.push(`/dashboard/seller#seller-listing-${encodeURIComponent(listing.id)}`);
    setStatusMessage(isAr ? `أدر عرضك من لوحة البائع (${shortListingRef(listing)}).` : `Manage your listing in Seller Dashboard (${shortListingRef(listing)}).`);
  }, [isAr, isSellerDashboardWorkspace, requireAuth, router, scrollToMyListingsSection, setSellerWorkspaceMessage, setStatusMessage]);

  async function handleSellerApplicationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requireAuth()) return;
    setStatusMessage(null);
    const fallbackMessage = safeErrorMessage("application", isAr);
    try {
      const response = await fetch("/api/alpha-exchange/seller-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            fullName: [sellerForm.firstName, sellerForm.lastName].filter(Boolean).join(" ").trim(),
            email: sellerForm.email,
            whatsappNumber: sellerForm.whatsappNumber,
            expectedMonthlyTradingVolume: sellerForm.expectedMonthlyTradingVolume,
            preferredNetworks: sellerApplicationMethods,
            additionalNotes: sellerForm.additionalNotes.trim(),
          }),
      });
      if (!response.ok) {
        setStatusMessage(await readApiErrorMessage(response, fallbackMessage));
        return;
      }
      const data = (await response.json()) as { application?: SellerApplication };
      if (data.application) {
        setSellerApplication(data.application);
        setApplicationSubmitted(true);
        setStatusMessage(isAr ? "تم إرسال طلب البائع للمراجعة." : "Seller application submitted for review.");
        window.dispatchEvent(new Event("alpha-auth-changed"));
      }
    } catch {
      setStatusMessage(fallbackMessage);
    }
  }

  async function submitPurchaseRequest() {
    if (!selectedListing) return;
    // React state updates after the current event. This synchronous ref closes
    // the double-tap window on phones before a second handler can submit.
    if (purchaseRequestInFlightRef.current || isSubmittingPurchase) return;
    if (listingRequiresFaceToFaceSafetyNotice(selectedListingPaymentMethod) && !faceToFaceSafetyAcknowledged) {
      setStatusMessage(isAr ? "وافق على إرشادات الخصوصية والأمان للقاء المباشر قبل المتابعة." : "Please acknowledge the Face-to-Face privacy and safety guidelines before continuing.");
      return;
    }
    const tradeAmount = String(buyerInfo.usdtAmount ?? "").trim();
    if (!tradeAmount || toNumber(tradeAmount) <= 0) {
      setStatusMessage(isAr ? "أدخل مبلغ USDT صالحًا للمتابعة." : "Enter a valid USDT trade amount to continue.");
      return;
    }
    const requestedAmount = toNumber(tradeAmount);
    const minTrade = Math.max(0, toNumber(selectedListing.minimumTrade));
    const availableTrade = toNumber(selectedListing.availableAmount);
    const configuredMaxTrade = toNumber(selectedListing.maximumTrade) || availableTrade;
    const maxTrade = Math.min(configuredMaxTrade, availableTrade);
    if (requestedAmount < minTrade || requestedAmount > maxTrade) {
      setStatusMessage(isAr
        ? `يجب أن يكون مبلغ الصفقة بين ${Math.trunc(minTrade).toLocaleString("en-US")} و${Math.trunc(maxTrade).toLocaleString("en-US")} USDT.`
        : `Trade amount must be between ${Math.trunc(minTrade).toLocaleString("en-US")} and ${Math.trunc(maxTrade).toLocaleString("en-US")} USDT.`);
      return;
    }
    if (purchasePriceMode === "buyer_offer") {
      const offerValidation = validatePriceOffer(selectedListing.price, buyerOfferedPrice);
      if (!offerValidation.ok) {
        setStatusMessage(purchaseRequestErrorMessage(offerValidation.code, isAr, offerValidation.message));
        return;
      }
    }
    const walletValidationError = getWalletAddressValidationError(buyerInfo.receivingNetwork, buyerInfo.receivingWalletAddress);
    if (walletValidationError) {
      setStatusMessage(localizeWalletValidationError(walletValidationError, buyerInfo.receivingNetwork, isAr));
      return;
    }
    if (isCardlessAtmPaymentMethod(selectedListingPaymentMethod) && (
      !isCardlessWithdrawalBank(buyerInfo.cardlessBankName)
      || !parseCardlessWithdrawalDetails({ withdrawalCode: buyerInfo.cardlessWithdrawalCode, verificationKind: buyerInfo.cardlessVerificationKind, verificationValue: buyerInfo.cardlessVerificationValue }).ok
      || !validateCardlessIlsAmount(buyerInfo.cardlessIlsAmount, calculateTradePaymentTotal(String(requestedAmount), (purchasePriceMode === "buyer_offer" ? toNumber(buyerOfferedPrice) : toNumber(selectedListing.price)).toFixed(2), true) ?? "")
    )) {
      setStatusMessage(isAr ? "اختر بنك السحب وأكمل رمز السحب والهوية أو تاريخ الميلاد ومبلغ السحب المطابق لإجمالي الصفقة بالشيكل." : "Choose the withdrawal bank and complete the withdrawal code, ID or birth date, and ILS amount matching the trade total.");
      return;
    }
    const fallbackMessage = isAr
      ? "تعذر بدء الصفقة بسبب خطأ غير متوقع. حاول مرة أخرى."
      : "We could not start this trade due to an unexpected server error.";
    purchaseRequestInFlightRef.current = true;
    setIsSubmittingPurchase(true);
    try {
      const response = await fetch("/api/alpha-exchange/purchase-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feePolicyVersion: "buyer_seller_1pct_v1",
          listingId: selectedListing.id,
          usdtAmount: tradeAmount,
          buyerReceivingWalletAddress: normalizeWalletAddress(buyerInfo.receivingWalletAddress),
          receivingNetwork: buyerInfo.receivingNetwork,
          ...(isCardlessAtmPaymentMethod(selectedListingPaymentMethod) ? {
            bankName: buyerInfo.cardlessBankName,
            cardlessWithdrawalCode: buyerInfo.cardlessWithdrawalCode,
            cardlessVerificationKind: buyerInfo.cardlessVerificationKind,
            cardlessVerificationValue: buyerInfo.cardlessVerificationValue,
            cardlessIlsAmount: buyerInfo.cardlessIlsAmount,
          } : {}),
          paymentMethod: selectedListingPaymentMethod ?? undefined,
          safetyAcknowledged: faceToFaceSafetyAcknowledged,
          priceMode: purchasePriceMode,
          offeredPrice: purchasePriceMode === "buyer_offer" ? buyerOfferedPrice : undefined,
        }),
      });
      const payload = await readPurchaseResponse(response);
      if (!response.ok) {
        const requestId = response.headers.get("x-request-id");
        if (requestId) {
          console.warn("[alpha-exchange] purchase request rejected", { requestId, listingId: selectedListing.id });
        }
        let errorMessage = response.status === 401
          ? "Your session expired. Sign in again and check your trades before resubmitting."
          : response.status >= 500
            ? "The service is temporarily unavailable. Check your trades before resubmitting."
            : fallbackMessage;
        let errorCode = response.status === 401 ? "SESSION_EXPIRED" : response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "SERVICE_UNAVAILABLE" : "";
        if (typeof payload.error === "string" && payload.error.trim()) errorMessage = payload.error;
        else if (typeof payload.message === "string" && payload.message.trim()) errorMessage = payload.message;
        if (typeof payload.code === "string" && payload.code.trim()) errorCode = payload.code;
        const errorDetails = payload.details && typeof payload.details === "object" && !Array.isArray(payload.details)
          ? payload.details as Record<string, unknown> : {};
        const requiresVerification = response.status === 403
          && sessionUser?.emailVerified !== true
          && (
            errorCode === "EMAIL_VERIFICATION_REQUIRED"
            || /email verification is required/i.test(errorMessage)
          );
        setShowVerificationCta(requiresVerification);
        const blockingId = typeof errorDetails.purchaseRequestId === "string" ? errorDetails.purchaseRequestId : null;
        if (errorCode === "AWAITING_BUYER_CONFIRMATION" && blockingId) {
          setMyRequests((prev) =>
            prev.map((r) => r.id === blockingId ? { ...r, buyerConfirmationArchivedAt: new Date().toISOString() } : r),
          );
        }
        const blockingDestination = purchaseBlockDestination(errorCode, errorDetails);
        if (blockingDestination) {
          closeListingModal();
          navigateAfterSuccess(router, blockingDestination, purchaseRequestErrorMessage(errorCode, isAr, errorMessage));
          return;
        }
        const commissionActionHref = typeof errorDetails.actionHref === "string" && errorDetails.actionHref.startsWith("/")
          ? errorDetails.actionHref
          : null;
        if (errorCode === "SELLER_COMMISSION_DUE" && commissionActionHref) {
          closeListingModal();
          router.push(commissionActionHref);
          return;
        }
        setStatusMessage(purchaseRequestErrorMessage(errorCode, isAr, errorMessage));
        return;
      }
      const data = payload as { purchase?: PurchaseRequest; destination?: string };
      if (data.purchase) {
        setMyRequests((prev) => [data.purchase as PurchaseRequest, ...prev]);
        setPurchaseSubmitted(true);
        setShowVerificationCta(false);
        setIsRedirectingToVerification(false);
        setStatusMessage(null);
        closeListingModal();
        navigateAfterSuccess(router, data.destination, isAr ? "تم إرسال طلب الشراء بنجاح." : "Purchase request submitted successfully.");
      } else {
        setStatusMessage(isAr
          ? "لم يصل تأكيد الطلب. افتح صفقاتك للتحقق قبل إعادة الإرسال."
          : "The request confirmation was not received. Check your trades before resubmitting.");
      }
    } catch (error) {
      console.warn("[alpha-exchange] purchase confirmation unavailable", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      setStatusMessage(isAr
        ? "لم نتمكن من تأكيد حالة الطلب. افتح صفقاتك للتحقق قبل إعادة الإرسال."
        : "We could not confirm the request status. Check your trades before resubmitting.");
    } finally {
      purchaseRequestInFlightRef.current = false;
      setIsSubmittingPurchase(false);
    }
  }

  async function handlePurchaseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPurchaseRequest();
  }

  const selectedOfferBounds = selectedListing ? getPriceOfferBounds(selectedListing.price) : null;
  const selectedAmount = selectedListing ? toNumber(selectedListing.availableAmount) : 0;
  const selectedPrice = selectedOfferBounds
    ? toNumber(selectedOfferBounds.listingPrice)
    : selectedListing
      ? toNumber(selectedListing.price)
      : 0;
  const selectedOfferValidation = selectedListing && purchasePriceMode === "buyer_offer"
    ? validatePriceOffer(selectedListing.price, buyerOfferedPrice)
    : null;
  const selectedTradePrice = purchasePriceMode === "buyer_offer"
    ? (selectedOfferValidation?.ok ? toNumber(selectedOfferValidation.offeredPrice) : 0)
    : selectedPrice;
  const selectedTradeAmount = toNumber(buyerInfo.usdtAmount);
  const estimatedTradeValue = Number(calculateFiatAmount(String(selectedTradeAmount), selectedTradePrice.toFixed(2)) ?? 0);
  const estimatedBuyerFee = Number(calculateTradeBuyerFiatFee(String(selectedTradeAmount), selectedTradePrice.toFixed(2)) ?? 0);
  const estimatedTotal = Number(calculateTradePaymentTotal(String(selectedTradeAmount), selectedTradePrice.toFixed(2), true) ?? 0);

  const isApprovedSeller = isApprovedSellerSession;
  const isSellerWorkspaceUser = hasSellerWorkspaceAccess;
  const hasBuyerRole = Boolean(sessionUser && hasRole(sessionUser, "buyer"));
  const sellerApplicationEligibility = getSellerApplicationEligibility({ isCanonicalUserLoading: isSessionResolving, canonicalUserError: sessionResolutionError, canonicalUser: sessionUser, application: sellerApplication, applicationSubmitted });
  const canAccessListingCreation = isApprovedSeller || isAdminSession;
  const isOwnerViewer = sessionUser?.role === "admin" && isAlphaExchangeOwnerEmail(sessionUser.email);
  const showBuyerSellerApplicationUpFront = Boolean(
    sessionUser
    && hasBuyerRole
    && !isSellerWorkspaceUser
    && !isAdminSession,
  );
  const buyerRequests = useMemo(() => myRequests.filter((request) => request.buyerId === sessionUser?.id), [myRequests, sessionUser?.id]);
  const archivedConfirmationTrade = buyerRequests.find((request) => request.status === "usdt_sent"
    && !isCashTradePaymentMethod(request.paymentMethod)
    && request.buyerConfirmationArchivedAt);
  const pendingBuyerReviewTrade = buyerRequests.find((request) => ["review_open", "locked", "completed"].includes(request.status) && !request.buyerReview);
  useEffect(() => {
    if (!sessionUser) return;
    if (typeof window === "undefined") return;
    if (!/^\/(ar|en)\/dashboard\/seller\/?$/.test(window.location.pathname)) return;
    const canAccessSellerDashboard = isSellerWorkspaceUser || sessionUser.role === "admin" || sessionUser.role === "owner";
    if (!canAccessSellerDashboard) {
      router.replace("/dashboard");
    }
  }, [isSellerWorkspaceUser, router, sessionUser]);

  const marketPricePerUsdt = marketSnapshot?.pairs.usdtIls.price ?? DEFAULT_MARKET_PRICE_PER_USDT;
  const maxAllowedListingPrice = marketPricePerUsdt + MAX_PRICE_MARKUP_ILS;
  const listingCreatePrice = toNumber(listingCreateForm.price);
  const listingCreateAmount = toNumber(listingCreateForm.availableAmount);
  const listingCreateMinTrade = toNumber(listingCreateForm.minimumTrade);
  const listingCreateMaxTrade = toNumber(listingCreateForm.maximumTrade || listingCreateForm.availableAmount);
  const listingCreatePriceInvalid = listingCreatePrice > maxAllowedListingPrice;
  const listingCreatePriceValid = listingCreatePrice > 0 && !listingCreatePriceInvalid;
  const listingCreateTradeRangeInvalid = listingCreateMaxTrade <= 0 || listingCreateMaxTrade > listingCreateAmount || listingCreateMaxTrade < listingCreateMinTrade;
  const listingCreateSelectedMethods = normalizePaymentMethodList(listingCreateForm.paymentMethods, undefined);
  const listingCreateSelectedBanks = parseIsraeliBankSelection(listingCreateForm.bankName);
  const listingCreateRequiresBank = requiresBankSelection(listingCreateSelectedMethods);
  const listingCreateRequiresBankAccount = requiresSellerPayoutBankAccount(listingCreateSelectedMethods);
  const listingCreateSelectedBankAccount = sellerBankAccounts.find((account) => account.id === listingCreateForm.bankAccountId);
  const listingCreateBankAccountMismatch = Boolean(
    listingCreateRequiresBankAccount
    && listingCreateForm.bankAccountId
    && (!listingCreateSelectedBankAccount || !isPayoutBankSupported(listingCreateSelectedBanks, listingCreateSelectedBankAccount.bankName)),
  );
  const listingCreateMissingRequired = !listingCreateAmount
    || !listingCreatePrice
    || !listingCreateSelectedMethods.length
    || (listingCreateRequiresBank && !listingCreateSelectedBanks.length)
    || (listingCreateRequiresBankAccount && !listingCreateForm.bankAccountId)
    || listingCreateBankAccountMismatch
    || !listingCommissionAgreement;
  const listingCreateTotalIls = listingCreateAmount * listingCreatePrice;
  const listingCreationBlocked = !canAccessListingCreation || Boolean(sellerWorkspaceSummary && !sellerWorkspaceSummary.canCreateListing);
  const listingCreationBlockedReason = !canAccessListingCreation
    ? (isAr ? "حساب البائع معلّق. يمكنك دفع العمولة المستحقة، لكن لا يمكنك إنشاء عروض جديدة حتى إعادة تفعيل الحساب." : "Your seller account is suspended. You can pay outstanding commissions, but cannot create new listings until the account is reactivated.")
    : (sellerWorkspaceSummary?.blockedReason
      ?? (isAr ? "إنشاء العروض متوقف حالياً. راجع العروض النشطة أو العمولة أو حالة الامتثال." : "Listing creation is currently blocked."));
  const listingBlockedByMarketplaceEnforcement = Boolean(sellerWorkspaceSummary?.enforcement?.restricted);
  const listingBlockedByCommission = !listingBlockedByMarketplaceEnforcement && (sellerWorkspaceSummary?.pendingCommissionCount ?? 0) > 0;
  const listingBlockedByActiveLimit = Boolean(
    sellerWorkspaceSummary &&
    !sellerWorkspaceSummary.canCreateListing &&
    sellerWorkspaceSummary.openListingCount >= sellerWorkspaceSummary.activeListingLimit &&
    !listingBlockedByCommission &&
    !listingBlockedByMarketplaceEnforcement,
  );
  const isListingCreateSubmitDisabled = listingCreateMissingRequired || listingCreatePriceInvalid || listingCreateTradeRangeInvalid || listingCreationBlocked;
  const listingCreateGuardCardTone = listingCreatePriceInvalid
    ? "border-red-500/60 bg-red-500/10 shadow-[0_0_0_3px_rgba(239,68,68,0.16)]"
    : listingCreatePriceValid
      ? "border-emerald-500/60 bg-emerald-500/10 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]"
      : "border-[#C9A227]/30 bg-[#C9A227]/10";
  const listingCreateGuardTone = listingCreatePriceInvalid
    ? "border-red-500/60 bg-red-500/10 text-red-200"
    : listingCreatePriceValid
      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200"
      : "border-white/10 bg-black/20 text-[#D1D5DB]";
  const listingEditPrice = toNumber(listingEditForm.price);
  const listingEditAmount = toNumber(listingEditForm.availableAmount);
  const listingEditMinTrade = toNumber(listingEditForm.minimumTrade);
  const listingEditMaxTrade = toNumber(listingEditForm.maximumTrade || listingEditForm.availableAmount);
  const listingEditCurrency = listingEditForm.currency.trim().toUpperCase();
  const listingEditPriceInvalid = listingEditCurrency === "ILS" && listingEditPrice > maxAllowedListingPrice;
  const listingEditPriceValid = listingEditPrice > 0 && !listingEditPriceInvalid;
  const listingEditTradeRangeInvalid = listingEditMaxTrade <= 0 || listingEditMaxTrade > listingEditAmount || listingEditMaxTrade < listingEditMinTrade;
  const listingEditSelectedMethods = normalizePaymentMethodList(listingEditForm.paymentMethods, undefined);
  const listingEditSelectedBanks = parseIsraeliBankSelection(listingEditForm.bankName);
  const listingEditRequiresBank = requiresBankSelection(listingEditSelectedMethods);
  const listingEditRequiresBankAccount = requiresSellerPayoutBankAccount(listingEditSelectedMethods);
  const listingEditSelectedBankAccount = sellerBankAccounts.find((account) => account.id === listingEditForm.bankAccountId);
  const listingEditBankAccountMismatch = Boolean(
    listingEditRequiresBankAccount
    && listingEditForm.bankAccountId
    && (!listingEditSelectedBankAccount || !isPayoutBankSupported(listingEditSelectedBanks, listingEditSelectedBankAccount.bankName)),
  );
  const listingEditMissingRequired = !listingEditAmount
    || !listingEditPrice
    || !listingEditSelectedMethods.length
    || (listingEditRequiresBank && !listingEditSelectedBanks.length)
    || (listingEditRequiresBankAccount && !listingEditForm.bankAccountId)
    || listingEditBankAccountMismatch;
  const isListingEditSubmitDisabled = listingEditMissingRequired || listingEditPriceInvalid || listingEditTradeRangeInvalid;
  const listingEditNeedsReason = listingEditOriginal
    ? listingEditRequiresReason(listingEditOriginal, {
        availableAmount: listingEditForm.availableAmount,
        price: listingEditForm.price,
        minimumTrade: listingEditForm.minimumTrade,
        maximumTrade: listingEditForm.maximumTrade || listingEditForm.availableAmount,
      })
    : false;
  const listingEditReasonValid = !listingEditNeedsReason
    || validateListingChangeReason({ reason: listingEditForm.changeReason, explanation: listingEditForm.changeExplanation }).ok;
  const listingEditGuardTone = listingEditPriceInvalid
    ? "border-red-500/60 bg-red-500/10 text-red-200"
    : listingEditPriceValid
      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200"
      : "border-white/10 bg-black/20 text-[#D1D5DB]";
  const buyerTradeAmount = toNumber(buyerInfo.usdtAmount);
  const selectedMinTrade = selectedListing ? Math.max(0, toNumber(selectedListing.minimumTrade)) : 0;
  const selectedMaxTrade = selectedListing
    ? Math.min(
        toNumber(selectedListing.maximumTrade) || toNumber(selectedListing.availableAmount),
        toNumber(selectedListing.availableAmount),
      )
    : 0;
  const buyerTradeAmountInvalid = !!selectedListing && (buyerTradeAmount < selectedMinTrade || buyerTradeAmount > selectedMaxTrade);
  const buyerWalletValidationError = selectedListing
    ? localizeWalletValidationError(getWalletAddressValidationError(buyerInfo.receivingNetwork, buyerInfo.receivingWalletAddress), buyerInfo.receivingNetwork, isAr)
    : null;
  const buyerWalletInvalid = buyerWalletValidationError !== null;
  const selectedListingPaymentMethods = selectedListing ? normalizePaymentMethodList(selectedListing.paymentMethods, selectedListing.paymentMethod) : [];
  const selectedListingPaymentMethod = normalizeMarketplacePaymentMethod(selectedPurchasePaymentMethod) ?? selectedListingPaymentMethods[0] ?? null;
  const selectedListingRequiresSafetyNotice = listingRequiresFaceToFaceSafetyNotice(selectedListingPaymentMethod);
  const todayDateKey = useMemo(() => formatIsraelDateKey(new Date()), []);

  const sellerRequests = useMemo(() => myRequests.filter((request) => request.sellerId === sessionUser?.id), [myRequests, sessionUser?.id]);
  const showSellerWorkspace = !isMobileViewport || showDeepDeferredSections;
  const activeBuyerRequests = useMemo(
    () => groupOwnTrades(buyerRequests, sessionUser?.id ?? "", "buyer").active,
    [buyerRequests, sessionUser?.id],
  );
  const visibleBuyerTradeStatus = !desktopBuyerNavigation && buyerTradeStatus === "active" ? "all" : buyerTradeStatus;
  const filteredBuyerRequests = useMemo(() => {
    const requests = visibleBuyerTradeStatus === "active" ? activeBuyerRequests : buyerRequests;
    return requests.filter((request) => {
      if (visibleBuyerTradeStatus !== "all" && visibleBuyerTradeStatus !== "active" && request.status !== visibleBuyerTradeStatus) return false;
      const query = buyerTradeQuery.trim().toLowerCase();
      if (!query) return true;
      const haystack = `${request.tradeId ?? request.id} ${request.listingId} ${request.buyerName} ${request.sellerId}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [activeBuyerRequests, buyerRequests, buyerTradeQuery, visibleBuyerTradeStatus]);
  const activeSellerRequests = useMemo(
    () => groupOwnTrades(sellerRequests, sessionUser?.id ?? "", "seller").active,
    [sellerRequests, sessionUser?.id],
  );
  // A resized desktop window must not leave the phone view on a desktop-only filter.
  const visibleSellerTradeStatus = !desktopSellerNavigation && sellerTradeStatus === "active" ? "all" : sellerTradeStatus;
  const filteredSellerRequests = useMemo(() => {
    const requests = visibleSellerTradeStatus === "active" ? activeSellerRequests : sellerRequests;
    return requests.filter((request) => {
      if (visibleSellerTradeStatus !== "all" && visibleSellerTradeStatus !== "active" && request.status !== visibleSellerTradeStatus) return false;
      const query = sellerTradeQuery.trim().toLowerCase();
      if (!query) return true;
      const haystack = `${request.tradeId ?? request.id} ${request.buyerName} ${request.listingId}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [activeSellerRequests, sellerRequests, sellerTradeQuery, visibleSellerTradeStatus]);
  const sellerRequestSections = useMemo(() => groupTradeRequests(filteredSellerRequests, "seller", isAr), [filteredSellerRequests, isAr]);
  const sortedSellerRequests = useMemo(
    () => sortDashboardActivityNewestFirst(filteredSellerRequests),
    [filteredSellerRequests],
  );
  const sortedBuyerRequests = useMemo(
    () => sortDashboardActivityNewestFirst(filteredBuyerRequests),
    [filteredBuyerRequests],
  );
  const sortedDashboardListings = useMemo(
    () => sortDashboardActivityNewestFirst(myListings),
    [myListings],
  );
  const recentSellerRequests = useMemo(() => sortDashboardActivityNewestFirst(sellerRequests), [sellerRequests]);
  const recentBuyerRequests = useMemo(() => sortDashboardActivityNewestFirst(buyerRequests), [buyerRequests]);

  useEffect(() => {
    setBuyerExpandedTradeId((current) => {
      if (current && sortedBuyerRequests.some((request) => request.id === current)) return current;
      return sortedBuyerRequests[0]?.id ?? null;
    });
  }, [sortedBuyerRequests]);

  useEffect(() => {
    setSellerExpandedTradeId((current) => {
      if (current && sortedSellerRequests.some((request) => request.id === current)) return current;
      return sortedSellerRequests[0]?.id ?? null;
    });
  }, [sortedSellerRequests]);

  useEffect(() => {
    setSellerExpandedListingId((current) => {
      if (current && sortedDashboardListings.some((listing) => listing.id === current)) return current;
      return sortedDashboardListings[0]?.id ?? null;
    });
  }, [sortedDashboardListings]);
  const handlePrefetchTradeRoom = useCallback((requestId: string) => {
    prefetchTradeRoom(router, requestId, sessionUser?.id);
  }, [router, sessionUser?.id]);
  const handleOpenTradeRoom = useCallback((requestId: string) => {
    prefetchTradeRoom(router, requestId, sessionUser?.id);
    router.push(`/trade-room/${requestId}`);
  }, [router, sessionUser?.id]);
  const pendingSellerRequests = useMemo(() => sellerRequests.filter((request) => request.status === "pending"), [sellerRequests]);
  const myListingsById = useMemo(() => new Map(myListings.map((listing) => [listing.id, listing])), [myListings]);
  const listingsById = useMemo(() => new Map(listings.map((listing) => [listing.id, listing])), [listings]);

  const sellerOverviewStats = useMemo(() => {
    const insightMetrics = calculateSellerMarketplaceInsights({ requests: sellerRequests, listings: myListings });
    const repeatBuyers = sellerRequests.reduce<Record<string, number>>((acc, request) => {
      if (request.status !== "completed") return acc;
      acc[request.buyerId] = (acc[request.buyerId] ?? 0) + 1;
      return acc;
    }, {});
    const repeatBuyersCount = Object.values(repeatBuyers).filter((count) => count > 1).length;
    const estimatedCommissionPaid = insightMetrics.revenueGenerated * 0.01;
    const selfReputation = myListings.find((listing) => Boolean(listing.sellerReputation))?.sellerReputation ?? null;
    return {
      activeListings: myListings.filter((listing) => listing.status === "active").length,
      pendingRequests: pendingSellerRequests.length,
      completedTrades: insightMetrics.completedTrades,
      totalUsdtSold: insightMetrics.totalUsdtSold,
      estimatedEarnings: insightMetrics.estimatedEarnings,
      averageResponseTime: insightMetrics.averageResponseTimeMinutes
        ? (isAr ? `${Math.round(insightMetrics.averageResponseTimeMinutes)} دقائق` : `${Math.round(insightMetrics.averageResponseTimeMinutes)} min`)
        : (isAr ? "لا توجد بيانات كافية" : "Not enough data"),
      tradeRequests: sellerRequests.length,
      successRate: insightMetrics.successRate,
      completionRate: insightMetrics.completionRate,
      estimatedCommissionPaid,
      revenueGenerated: insightMetrics.revenueGenerated,
      repeatBuyers: repeatBuyersCount,
      averageTradeSize: insightMetrics.averageTradeSize,
      reputation: selfReputation,
    };
  }, [isAr, myListings, pendingSellerRequests.length, sellerRequests]);

  const recentCompletedTrades = useMemo(
    () =>
      !deferredSellerPanelsReady
        ? []
        :
      myRequests
        .filter((request) => request.status === "completed" || Boolean(request.completedAt))
        .sort((left, right) => new Date(right.completedAt ?? right.updatedAt).getTime() - new Date(left.completedAt ?? left.updatedAt).getTime())
        .slice(0, 4),
    [deferredSellerPanelsReady, myRequests],
  );
  const visibleRecentCompletedTrades = showAllCompletedTrades ? recentCompletedTrades : recentCompletedTrades.slice(0, 1);
  const todaysCompletedTrades = useMemo(
    () =>
      !deferredSellerPanelsReady
        ? 0
        :
      myRequests.filter((request) => {
        const completedAt = request.completedAt ?? (request.status === "completed" ? request.updatedAt : "");
        return formatIsraelDateKey(completedAt) === todayDateKey;
      }).length,
    [deferredSellerPanelsReady, myRequests, todayDateKey],
  );
  const sortedNotifications = useMemo(() => sortNotificationsNewestFirst(notifications), [notifications]);
  const marketplaceUpdates = useMemo(() => {
    if (!deferredSellerPanelsReady) return [];
    const activityItems = activityHistory.slice(0, 6).map((entry) => {
      const copy = localizeActivityCopy(entry, locale);
      return {
        id: `activity-${entry.id}`,
        title: copy.title,
        details: copy.details,
        createdAt: entry.createdAt,
      };
    });
    if (activityItems.length) return activityItems;
    return sortedNotifications.slice(0, 6).map((notification) => {
      const copy = localizeNotificationCopy(notification, locale);
      return {
        id: `notification-${notification.id}`,
        title: copy.title,
        details: copy.message,
        createdAt: notification.createdAt,
      };
    });
  }, [activityHistory, deferredSellerPanelsReady, locale, sortedNotifications]);
  const groupedActivityHistory = useMemo(
    () => (deferredSellerPanelsReady ? groupActivityEntriesByDay(activityHistory, locale).slice(0, 4) : []),
    [activityHistory, deferredSellerPanelsReady, locale],
  );
  const buyerOverviewStats = useMemo(() => {
    const completed = buyerRequests.filter((request) => request.status === "completed" || request.status === "review_open" || Boolean(request.completedAt));
    const pending = buyerRequests.filter((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status));
    const totalUsdtBought = completed.reduce((sum, request) => sum + toNumber(request.usdtAmount), 0);
    const totalFiatSpent = completed.reduce((sum, request) => sum + toNumber(request.fiatAmount), 0);
    const averagePurchasePrice = totalUsdtBought > 0 ? totalFiatSpent / totalUsdtBought : marketPricePerUsdt;
    const paymentCounts = buyerRequests.reduce<Record<string, number>>((acc, request) => {
      const method = normalizeMarketplacePaymentMethod(request.paymentMethod);
      if (!method) return acc;
      acc[method] = (acc[method] ?? 0) + 1;
      return acc;
    }, {});
    const favoritePaymentMethods = Object.entries(paymentCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 2)
      .map(([method]) => paymentMethodLabel(method, isAr))
      .join(" • ");
    const uniqueTrustedSellers = new Set(
      completed
        .map((request) => listingsById.get(request.listingId)?.sellerDisplayName || request.sellerId)
        .filter(Boolean),
    );
    return {
      total: buyerRequests.length,
      completed: completed.length,
      pending: pending.length,
      averagePurchasePrice,
      favoritePaymentMethods: favoritePaymentMethods || "—",
      recentTrades: sortedBuyerRequests.slice(0, 3),
      recentPurchases: sortedBuyerRequests.slice(0, 3).length,
      uniqueTrustedSellers: uniqueTrustedSellers.size,
      totalUsdtBought,
      activeDays: new Set(buyerRequests.map((request) => formatIsraelDateKey(request.completedAt ?? request.updatedAt ?? request.createdAt)).filter(Boolean)).size,
    };
  }, [buyerRequests, isAr, listingsById, marketPricePerUsdt, sortedBuyerRequests]);

  useEffect(() => {
    setBuyerTradeVisibleCount(isMobileViewport ? 1 : 2);
    setBuyerExpandedTradeId(null);
  }, [buyerTradeQuery, visibleBuyerTradeStatus, isMobileViewport, sessionUser?.id]);

  useEffect(() => {
    setSellerPrimaryRequestsExpanded(false);
  }, [sellerTradeQuery, sellerTradeStatus, sessionUser?.id]);

  useEffect(() => {
    setNotificationCenterExpanded(false);
  }, [notificationQuery, notificationCategory, notificationUnreadOnly, sessionUser?.id]);

  const marketplacePulse = useMemo(() => {
    const sourceListings = filteredListings.length ? filteredListings : listings;
    const uniqueSellers = new Set(sourceListings.map((listing) => listing.sellerId));
    const onlineSellers = new Set(
      sourceListings
        .filter((listing) => deriveSellerPresence(livePresence[listing.sellerId] ?? listing.sellerProfile ?? {}).online)
        .map((listing) => listing.sellerId),
    );
    const totalUsdtAvailable = sourceListings.reduce((sum, listing) => sum + toNumber(listing.availableAmount), 0);
    const responseMinutes = sourceListings
      .map((listing) => listing.sellerReputation?.responseTimeMinutes ?? 0)
      .filter((value) => value > 0);
    const averageResponseMinutes = responseMinutes.length
      ? Math.max(1, Math.round(responseMinutes.reduce((sum, value) => sum + value, 0) / responseMinutes.length))
      : 0;
    const networkCounts = sourceListings.reduce<Record<string, number>>((acc, listing) => {
      const key = safeText(listing.network, "TRC20");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const topNetwork = Object.entries(networkCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "TRC20";
    const paymentMethodCounts = sourceListings.reduce<Record<string, number>>((acc, listing) => {
      const methods = listing.paymentMethods?.length ? listing.paymentMethods : [listing.paymentMethod];
      methods.forEach((method) => {
        const normalized = paymentMethodLabel(String(method ?? "Bank Transfer"), isAr);
        acc[normalized] = (acc[normalized] ?? 0) + 1;
      });
      return acc;
    }, {});
    const topPaymentMethod = Object.entries(paymentMethodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? (isAr ? "تحويل بنكي" : "Bank Transfer");
    const newestSellers = [...sourceListings]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .reduce<string[]>((acc, listing) => {
        const name = safeText(listing.sellerDisplayName, isAr ? "بائع" : "Seller");
        if (!acc.includes(name)) acc.push(name);
        return acc;
      }, [])
      .slice(0, 3);
    return {
      verifiedSellers: uniqueSellers.size,
      onlineVerifiedSellers: onlineSellers.size,
      liveListings: sourceListings.length,
      totalUsdtAvailable,
      averageResponseMinutes,
      topNetwork,
      topPaymentMethod,
      newestSellers,
    };
  }, [filteredListings, isAr, listings, livePresence]);

  const [greetingLabel, setGreetingLabel] = useState(isAr ? "مرحباً" : "Welcome");
  useEffect(() => {
    const updateGreeting = () => setGreetingLabel(greetingByTime(isAr));
    updateGreeting();
    const interval = window.setInterval(updateGreeting, 15 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [isAr]);
  const welcomeRole = sessionUser ? accountRoleIdentity(sessionUser) : "guest";
  const workspaceDisplayId = sessionUser ? publicAccountName(sessionUser) : "";
  // This greeting belongs to the authenticated account. Public trade identity stays AT ID.
  const workspacePrimaryName = sessionUser?.fullName?.trim() || (isAr ? "المتداول" : "Trader");
  const workspacePositiveMessage = welcomeRole === "owner"
    ? (isAr ? "نظرة شاملة على Alpha Traders جاهزة لك." : "Your Alpha Traders overview is ready.")
    : isSellerWorkspaceUser
    ? sellerStatusForLanding === "suspended"
      ? (isAr ? "حساب البائع معلّق، لكن يمكنك دفع العمولات المستحقة ومتابعة التحقق منها هنا." : "Your seller account is suspended, but you can pay outstanding commissions and track verification here.")
      : (isAr ? "كل شيء تحت سيطرتك. عروضك وصفقاتك وتنبيهاتك جاهزة." : "Your listings, trades, and alerts are ready.")
    : (isAr ? "مساحة عملك جاهزة. راقب نشاطك أولاً، ثم انتقل إلى السوق." : "Your workspace is ready. Track activity first, then jump into the marketplace.");

  const openTradeCount = isSellerWorkspaceUser
    ? (desktopSellerNavigation ? activeSellerRequests.length : sellerRequests.filter((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status)).length)
    : (desktopBuyerNavigation ? activeBuyerRequests.length : buyerRequests.filter((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status)).length);
  const totalBuyerRequests = buyerRequests.length;
  const unreadNotificationsTotal = notificationUnreadCount ?? notifications.filter((item) => !item.isRead).length;
  const latestOpenBuyerTrade = desktopBuyerNavigation
    ? activeBuyerRequests[0]
    : recentBuyerRequests.find((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status));
  const latestOpenSellerTrade = desktopSellerNavigation
    ? activeSellerRequests[0]
    : recentSellerRequests.find((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status));
  // Existing trades remain available through the workspace's Continue Trade
  // action. Background refreshes must never replace an intentional marketplace
  // visit or interrupt a notification click with a generic Trade Room redirect.
  const commissionWorkspaceAction = getCommissionWorkspaceAction(sellerCommissionStatus);
  const standardCommissionDueActive = isSellerWorkspaceUser && commissionWorkspaceAction.kind !== "none";
  const marketplaceComplianceActive = Boolean(sellerWorkspaceSummary?.enforcement?.restricted);
  type AttentionItem = {
    title: string;
    body: string;
    action: string;
    onClick: () => void;
  };
  const isAttentionItem = (item: AttentionItem | null): item is AttentionItem => item !== null;
  const urgentSellerListing = isSellerWorkspaceUser
    ? myListings.find((listing) => {
        const countdown = deriveListingCountdown(listing.expiresAt, Date.now());
        return countdown.visible && countdown.tier === "urgent";
      })
    : null;
  const needsAttentionItems: AttentionItem[] = isSellerWorkspaceUser
    ? [
        pendingBuyerReviewTrade
          ? {
              title: isAr ? "تقييم الشراء مطلوب" : "Purchase review required",
              body: isAr ? "قيّم آخر عملية شراء قبل تقديم طلب أو عرض سعر جديد." : "Review your last purchase before submitting another request or price offer.",
              action: isAr ? "إضافة التقييم" : "Leave review",
              onClick: () => router.push(`/trade-room/${pendingBuyerReviewTrade.id}`),
            }
          : null,
        marketplaceComplianceActive
          ? {
              title: isAr ? "امتثال السوق" : "Marketplace Compliance",
              body: isAr
                ? "افتح حالة دفع الامتثال لاستعادة صلاحية إنشاء العروض."
                : (sellerWorkspaceSummary?.enforcement?.blockReason ?? "Open your compliance payment case to restore listing access."),
              action: isAr ? "فتح الدفع" : "Open payment",
              onClick: openMarketplaceCompliancePayment,
            }
          : null,
        commissionWorkspaceAction.kind !== "none"
          ? {
              title: sellerCommissionStatus?.status === "overdue"
                ? (isAr ? "العمولة متأخرة" : "Commission overdue")
                : (isAr ? "عمولة مستحقة" : "Commission due"),
              body: sellerCommissionStatus?.status === "overdue"
                ? (isAr ? "أكمل الدفع لاستعادة جميع صلاحيات البائع." : "Complete the payment to restore full seller access.")
                : (isAr ? "سدّد العمولة المستحقة لقبول طلبات جديدة. عروضك تبقى ظاهرة ويمكنك إكمال صفقاتك الحالية." : "Pay outstanding commission to accept new requests. Your listings stay visible and existing trades can finish."),
              action: commissionWorkspaceAction.kind === "pay-one"
                ? (isAr ? "ادفع الآن" : "Pay now")
                : (isAr ? "مراجعة غير المدفوع" : "Review unpaid"),
              onClick: commissionWorkspaceAction.kind === "pay-one"
                ? () => openCommissionPayment(commissionWorkspaceAction.commissionId)
                : reviewPayableCommissions,
            }
          : null,
        latestOpenSellerTrade
          ? {
              title: isAr ? "صفقة بانتظارك" : "Trade waiting",
              body: isAr
                ? `الصفقة ${formatTradeId(latestOpenSellerTrade.displayNumber, latestOpenSellerTrade.tradeId ?? latestOpenSellerTrade.id)} تحتاج إلى انتباهك.`
                : `Trade ${formatTradeId(latestOpenSellerTrade.displayNumber, latestOpenSellerTrade.tradeId ?? latestOpenSellerTrade.id)} needs your attention.`,
              action: isAr ? "فتح الصفقة" : "Open trade",
              onClick: () => handleOpenTradeRoom(latestOpenSellerTrade.id),
            }
          : null,
        sellerOverviewStats.pendingRequests > 0
          ? {
              title: isAr ? "طلبات معلّقة" : "Pending requests",
              body: isAr
                ? `${sellerOverviewStats.pendingRequests.toLocaleString("en-IL")} من طلبات المشترين بانتظار المراجعة.`
                : `${sellerOverviewStats.pendingRequests.toLocaleString("en-IL")} buyer requests are waiting for review.`,
              action: isAr ? "مراجعة العروض" : "Review listings",
              onClick: () => {
                if (!scrollToMyListingsSection()) {
                  void scrollToCreateListingSection();
                }
              },
            }
          : null,
        unreadNotificationsTotal > 0
          ? {
              title: isAr ? "إشعارات غير مقروءة" : "Unread notifications",
              body: isAr
                ? `${unreadNotificationsTotal.toLocaleString("en-IL")} من التحديثات الجديدة جاهزة.`
                : `${unreadNotificationsTotal.toLocaleString("en-IL")} new updates are ready.`,
              action: isAr ? "فتح الإشعارات" : "Open notifications",
              onClick: () => router.push("/notifications"),
            }
          : null,
        urgentSellerListing
          ? {
              title: isAr ? "العرض سينتهي قريبًا" : "Listing expiring soon",
              body: isAr ? "جدّد العرض قبل أن يختفي من السوق." : "Renew the listing before it drops out of view.",
              action: isAr ? "مراجعة العرض" : "Review listing",
              onClick: () => {
                document.getElementById(`listing-${urgentSellerListing.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              },
            }
          : null,
      ].filter(isAttentionItem)
    : [
        pendingBuyerReviewTrade
          ? {
              title: isAr ? "أكمل صفقتك السابقة" : "Complete your previous trade",
              body: isAr ? "اترك تقييمك قبل بدء طلب جديد." : "Leave feedback before starting another request.",
              action: isAr ? "إضافة تقييم" : "Leave feedback",
              onClick: () => router.push(`/trade-room/${pendingBuyerReviewTrade.id}`),
            }
          : null,
        latestOpenBuyerTrade
          ? {
              title: isAr ? "صفقة نشطة" : "Active trade",
              body: isAr
                ? `الصفقة ${formatTradeId(latestOpenBuyerTrade.displayNumber, latestOpenBuyerTrade.tradeId ?? latestOpenBuyerTrade.id)} قيد التنفيذ.`
                : `Trade ${formatTradeId(latestOpenBuyerTrade.displayNumber, latestOpenBuyerTrade.tradeId ?? latestOpenBuyerTrade.id)} is in progress.`,
              action: isAr ? "فتح الصفقة" : "Open trade",
              onClick: () => handleOpenTradeRoom(latestOpenBuyerTrade.id),
            }
          : null,
        unreadNotificationsTotal > 0
          ? {
              title: isAr ? "إشعارات غير مقروءة" : "Unread notifications",
              body: isAr
                ? `${unreadNotificationsTotal.toLocaleString("en-IL")} من التحديثات الجديدة جاهزة.`
                : `${unreadNotificationsTotal.toLocaleString("en-IL")} new updates are ready.`,
              action: isAr ? "فتح الإشعارات" : "Open notifications",
              onClick: () => router.push("/notifications"),
            }
          : null,
      ].filter(isAttentionItem);
  const shouldCondenseSellerApplication = Boolean(
    sessionUser
    && !isSellerWorkspaceUser
    && hasBuyerRole
    && sellerApplication?.status !== "pending"
    && !applicationSubmitted,
  );

  const openSellerRequests = (activeOnly: boolean) => {
    setSellerTradeQuery("");
    setSellerTradeStatus(activeOnly ? "active" : "all");
    focusWorkspaceSection("purchase-requests-section");
  };
  const integrateSellerWorkspace = desktopSellerNavigation && welcomeRole !== "owner";
  const integrateWorkspace = integrateSellerWorkspace || desktopBuyerNavigation;
  const openBuyerRequests = (activeOnly: boolean) => {
    setBuyerTradeQuery("");
    setBuyerTradeStatus(activeOnly ? "active" : "all");
    scrollToBuyerTradeHistorySection();
  };
  const openBuyerMarketplace = () => {
    if (!isDashboardWorkspace) {
      focusWorkspaceSection("buyer-marketplace-listings");
      return;
    }
    router.push("/usdt-exchange#buyer-marketplace-listings");
  };

  const workspaceCards: ExchangeWorkspaceAction[] = isSellerWorkspaceUser
    ? [
      {
        key: "create-listing",
        title: isAr ? "إنشاء عرض" : "Create Listing",
        subtitle: canAccessListingCreation
          ? (isAr ? "ابدأ عرض بيع" : "Start a seller listing")
          : (isAr ? "راجع متطلبات إنشاء العرض" : "Review listing requirements"),
        stat: isAr ? "ابدأ الإنشاء" : "Create now",
        onClick: () => {
          void scrollToCreateListingSection();
        },
        icon: Store,
        tone: "gold",
      },
      {
        key: "listings",
        title: isAr ? "عروضي" : "My Listings",
        subtitle: isAr ? "فتح مساحة إدارة العروض" : "Open listing workspace",
        stat: `${myListings.length.toLocaleString("en-IL")}`,
        onClick: () => {
          if (!scrollToMyListingsSection()) {
            void scrollToCreateListingSection();
          }
        },
        icon: Store,
        tone: "gold",
      },
      {
        key: "trades",
        title: isAr ? "طلبات الشراء" : "Purchase Requests",
        subtitle: !desktopSellerNavigation || purchaseRequestsState === "ready"
          ? (isAr ? `${openTradeCount.toLocaleString("en-IL")} من الصفقات النشطة` : `${openTradeCount.toLocaleString("en-IL")} active trade${openTradeCount === 1 ? "" : "s"}`)
          : purchaseRequestsState === "error"
            ? (isAr ? "افتح الطلبات لإعادة المحاولة" : "Open requests to retry")
            : (isAr ? "جارٍ تحميل الصفقات..." : "Loading current trades…"),
        stat: !desktopSellerNavigation || purchaseRequestsState === "ready" ? sellerRequests.length.toLocaleString("en-IL") : "—",
        onClick: () => {
          if (desktopSellerNavigation) return openSellerRequests(false);
          if (focusWorkspaceSection("purchase-requests-section")) return;
          router.push("/dashboard/seller#purchase-requests-section");
        },
        icon: HandCoins,
        tone: "blue",
      },
      {
        key: "notifications",
        title: isAr ? "الإشعارات" : "Notifications",
        subtitle: isAr ? "مركز الإشعارات" : "Notification Center",
        stat: `${unreadNotificationsTotal.toLocaleString("en-IL")}`,
        onClick: () => {
          const target = document.getElementById("notification-center-section");
          if (target) {
            if (desktopSellerNavigation) focusWorkspaceSection(target.id);
            else target.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
          router.push("/notifications");
        },
        icon: BellRing,
        tone: "green",
      },
      {
        key: "market",
        title: isAr ? "سوق اليوم" : "Today's Market",
        subtitle: isAr ? "تفاصيل السوق" : "Market Details",
        stat: formatIls(marketPricePerUsdt),
          onClick: () => {
            const target = document.getElementById("market-overview");
            if (!isDashboardWorkspace && target) {
              if (desktopSellerNavigation) focusWorkspaceSection(target.id);
              else target.scrollIntoView({ behavior: "smooth", block: "start" });
              return;
            }
            router.push("/usdt-exchange#market-overview");
        },
        icon: TrendingUp,
        tone: "amber",
      },
      {
        key: "public-profile",
        title: isAr ? "ملفي وإنجازاتي" : "My Profile & Achievements",
        subtitle: isAr ? "مستوى البائع ورتبة المشتري" : "Seller level and buyer rank",
        stat: isAr ? "عرض الملف" : "View profile",
        onClick: () => router.push("/profile"),
        icon: Trophy,
        tone: "blue",
      },
      {
        key: "account-settings",
        title: isAr ? "إعدادات الحساب" : "Account Settings",
        subtitle: isAr ? "الملف الشخصي والأمان" : "Profile and security",
        stat: isAr ? "إدارة الحساب" : "Manage account",
        onClick: () => router.push("/settings"),
        icon: ShieldCheck,
        tone: "green",
      },
    ]
    : [
      {
        key: "browse-marketplace",
        title: isAr ? "تصفّح السوق" : "Browse Marketplace",
        subtitle: isAr ? "العروض المباشرة" : "Live Offers",
        stat: `${marketplacePulse.liveListings.toLocaleString("en-IL")}`,
          onClick: () => {
            if (desktopBuyerNavigation) return openBuyerMarketplace();
            const target = document.getElementById("marketplace");
            if (!isDashboardWorkspace && target) {
              target.scrollIntoView({ behavior: "smooth", block: "start" });
              return;
          }
          router.push("/usdt-exchange#marketplace");
        },
        icon: Store,
        tone: "gold",
      },
      {
        key: "orders",
        title: isAr ? "طلبات صفقاتي" : "My Trade Requests",
        subtitle: isAr ? "قائمة الطلبات" : "Request Queue",
        stat: `${totalBuyerRequests.toLocaleString("en-IL")}`,
        onClick: () => {
          if (desktopBuyerNavigation) return openBuyerRequests(false);
          if (scrollToBuyerTradeHistorySection()) return;
          router.push(`/usdt-exchange?section=trade-history#${BUYER_TRADE_HISTORY_SECTION_ID}`);
        },
        icon: HandCoins,
        tone: "blue",
      },
      {
        key: "active-trades",
        title: isAr ? "الصفقات النشطة" : "Active Trades",
        subtitle: !desktopBuyerNavigation
          ? (isAr ? "متابعة الصفقة" : "Continue Trade")
          : purchaseRequestsState === "ready"
            ? (isAr ? "عرض صفقاتك الحالية" : "View your current trades")
            : purchaseRequestsState === "error"
              ? (isAr ? "افتح الصفقات لإعادة المحاولة" : "Open trades to retry")
              : (isAr ? "جارٍ تحميل الصفقات..." : "Loading current trades…"),
        stat: !desktopBuyerNavigation || purchaseRequestsState === "ready" ? openTradeCount.toLocaleString("en-IL") : "—",
        onClick: () => {
          if (desktopBuyerNavigation) return openBuyerRequests(true);
          if (latestOpenBuyerTrade) {
            handleOpenTradeRoom(latestOpenBuyerTrade.id);
            return;
          }
          router.push("/trade-room");
        },
        icon: Wallet,
        tone: "blue",
      },
      {
        key: "notifications",
        title: isAr ? "الإشعارات" : "Notifications",
        subtitle: isAr ? "مركز الإشعارات" : "Notification Center",
        stat: `${unreadNotificationsTotal.toLocaleString("en-IL")}`,
        onClick: () => {
          if (desktopBuyerNavigation) {
            focusWorkspaceSection("notification-center-section");
            return;
          }
          const target = document.getElementById("notification-center-section");
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
          router.push("/notifications");
        },
        icon: BellRing,
        tone: "green",
      },
      {
        key: "market",
        title: isAr ? "نظرة عامة على السوق" : "Market Overview",
        subtitle: isAr ? "سوق اليوم" : "Today’s Market",
        stat: formatIls(marketPricePerUsdt),
          onClick: () => {
            if (desktopBuyerNavigation && !isDashboardWorkspace) {
              focusWorkspaceSection("market-overview");
              return;
            }
            const target = document.getElementById("market-overview");
            if (!isDashboardWorkspace && target) {
              target.scrollIntoView({ behavior: "smooth", block: "start" });
              return;
            }
            router.push("/usdt-exchange#market-overview");
        },
        icon: TrendingUp,
        tone: "amber",
      },
      {
        key: "buyer-profile",
        title: isAr ? "ملفي وإنجازاتي" : "My Profile & Achievements",
        subtitle: isAr ? "عرض رتبتك وسجل تقدمك" : "View your rank and progress history",
        stat: isAr ? "فتح الملف" : "Open profile",
        onClick: () => router.push("/profile"),
        icon: Trophy,
        tone: "blue",
      },
    ];
  if (desktopBuyerNavigation) {
    workspaceCards.push({
      key: "account-settings",
      title: isAr ? "إعدادات الحساب" : "Account Settings",
      subtitle: isAr ? "الملف الشخصي والأمان" : "Profile and security",
      stat: isAr ? "إدارة الحساب" : "Manage account",
      onClick: () => router.push("/settings"),
      icon: ShieldCheck,
      tone: "green",
    });
  }
  if (standardCommissionDueActive) {
    workspaceCards.push({
      key: "commission",
      title: isAr ? "🚨 عمولة مستحقة" : "🚨 Commission Due",
      subtitle: commissionWorkspaceAction.kind === "pay-one"
        ? (isAr ? "ادفع مبلغ العمولة المحدد" : "Pay the exact commission")
        : (isAr
          ? `راجع ${sellerCommissionStatus?.pendingCount ?? 0} من العمولات غير المدفوعة`
          : `Review ${sellerCommissionStatus?.pendingCount ?? 0} unpaid commissions`),
      stat: commissionWorkspaceAction.kind === "pay-one"
        ? formatExactCommissionUsdt(sellerCommissionStatus?.payableAmountDue ?? 0)
        : `${sellerCommissionStatus?.pendingCount ?? 0}`,
      onClick: commissionWorkspaceAction.kind === "pay-one"
        ? () => openCommissionPayment(commissionWorkspaceAction.commissionId)
        : reviewPayableCommissions,
      icon: ShieldCheck,
      tone: "amber",
    });
  }
  if (marketplaceComplianceActive) {
    workspaceCards.push({
      key: "marketplace-compliance",
      title: isAr ? "امتثال السوق" : "Marketplace Compliance",
      subtitle: isAr ? "دفعة استعادة الصلاحيات" : "Recovery Payment",
      stat: isAr ? "استعادة الصلاحيات" : "Restore access",
      onClick: openMarketplaceCompliancePayment,
      icon: ShieldCheck,
      tone: "amber",
    });
  }

  const compactBuyerWorkspace = isDashboardWorkspace && !isSellerWorkspaceUser && !desktopBuyerNavigation;
  const visibleWorkspaceCards = desktopBuyerNavigation
    ? workspaceCards.filter((card) => card.key !== "orders").map((card) => card.key === "browse-marketplace"
      ? { ...card, title: isAr ? "العروض المباشرة" : "Live Listings", subtitle: isAr ? "تصفح البائعين" : "Browse Sellers" }
      : card)
    : compactBuyerWorkspace
    ? workspaceCards.filter((card) => card.key === "browse-marketplace" || card.key === "active-trades").map((card) => card.key === "browse-marketplace"
      ? { ...card, title: isAr ? "العروض المباشرة" : "Live Listings", subtitle: isAr ? "تصفح البائعين" : "Browse Sellers" }
      : card)
    : workspaceCards;

  const heroPrimaryActions = welcomeRole === "owner"
    ? [
      { key: "hero-owner-dashboard", label: isAr ? "لوحة المالك" : "Owner Dashboard", onClick: () => router.push("/admin/alpha-exchange") },
      { key: "hero-owner-trades", label: isAr ? "الصفقات النشطة" : "Active Trades", onClick: () => router.push("/trade-room") },
    ]
    : isSellerWorkspaceUser
    ? [
      {
        key: "hero-create-listing",
        label: isAr ? "إنشاء عرض" : "Create Listing",
        onClick: () => {
          void scrollToCreateListingSection();
        },
      },
      {
        key: "hero-active-trades",
        label: isAr ? "الصفقات النشطة" : "Active Trades",
        onClick: () => {
          if (desktopSellerNavigation) return openSellerRequests(true);
          if (latestOpenSellerTrade) {
            handleOpenTradeRoom(latestOpenSellerTrade.id);
            return;
          }
          router.push("/trade-room");
        },
      },
    ]
    : [
      {
        key: "hero-browse-marketplace",
        label: desktopBuyerNavigation ? (isAr ? "تصفح البائعين" : "Browse Sellers") : (isAr ? "تصفّح السوق" : "Browse Marketplace"),
        onClick: () => {
          if (desktopBuyerNavigation) return openBuyerMarketplace();
          const target = document.getElementById("marketplace");
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
          router.push("/usdt-exchange#marketplace");
        },
      },
      {
        key: "hero-my-trades",
        label: isAr ? "طلبات صفقاتي" : "My Trade Requests",
        onClick: () => {
          if (desktopBuyerNavigation) return openBuyerRequests(false);
          if (scrollToBuyerTradeHistorySection()) return;
          router.push(`/usdt-exchange?section=trade-history#${BUYER_TRADE_HISTORY_SECTION_ID}`);
        },
      },
    ];

  const extractTradeRoomHrefFromRelatedHref = useCallback((relatedHref?: string) => {
    const href = relatedHref?.trim();
    if (!href) return null;
    const normalized = href.startsWith("/") ? href : `/${href}`;
    const roomMatch = normalized.match(/\/trade-room\/([^/?#]+)/i);
    if (roomMatch?.[1]) return `/trade-room/${decodeURIComponent(roomMatch[1])}`;
    const requestMatch = normalized.match(/[?&]requestId=([^&]+)/i);
    if (requestMatch?.[1]) return `/trade-room/${decodeURIComponent(requestMatch[1])}`;
    return null;
  }, []);

  const resolveTradeRoomDestinationFromSnapshot = useCallback((notification: AlphaExchangeNotification) => {
    const snapshot = notification.tradeSnapshot;
    if (!snapshot?.requestId || !snapshot.currentStage || !sessionUser) return null;
    const isSellerActor = snapshot.sellerId === sessionUser.id;
    const isBuyerActor = snapshot.buyerId === sessionUser.id;
    const cashTrade = isCashTradePaymentMethod(snapshot.paymentMethod);
    let action: "accept-trade" | "confirm-cash-payment" | "upload-payment-receipt" | "confirm-money-received" | "release-usdt" | "confirm-usdt-sent" | "complete-cash-trade" | "upload-seller-evidence" | "confirm-usdt-received" | "review-trade" | "open-trade" = "open-trade";
    if (snapshot.currentStage === "pending" && isSellerActor) action = "accept-trade";
    else if (snapshot.currentStage === "accepted" && isBuyerActor) action = cashTrade ? "confirm-cash-payment" : "upload-payment-receipt";
    else if (snapshot.currentStage === "payment_sent" && isSellerActor) action = "confirm-money-received";
    else if (snapshot.currentStage === "funds_received" && isSellerActor) action = cashTrade ? "confirm-usdt-sent" : "release-usdt";
    else if (snapshot.currentStage === "usdt_release_pending" && isSellerActor) action = cashTrade ? "confirm-usdt-sent" : "upload-seller-evidence";
    else if (snapshot.currentStage === "usdt_sent" && cashTrade && isSellerActor) action = "complete-cash-trade";
    else if (snapshot.currentStage === "usdt_sent" && !cashTrade && isBuyerActor) action = "confirm-usdt-received";
    else if ((snapshot.currentStage === "review_open" || snapshot.currentStage === "completed" || snapshot.currentStage === "locked") && isBuyerActor) action = "review-trade";
    if (action === "open-trade") return null;
    const hash = action === "upload-payment-receipt" || action === "upload-seller-evidence"
      ? "evidence"
      : action === "review-trade"
        ? "status-banner"
        : "action-required";
    return `/trade-room/${snapshot.requestId}?action=${encodeURIComponent(action)}#${hash}`;
  }, [sessionUser]);

  const buildTradeRoomDestinationFromRequest = useCallback((request: PurchaseRequest) => {
    if (!sessionUser) return `/trade-room/${request.id}`;
    const isSellerActor = request.sellerId === sessionUser.id;
    const isBuyerActor = request.buyerId === sessionUser.id;
    const cashTrade = isCashTradePaymentMethod(request.paymentMethod);
    let action: "accept-trade" | "confirm-cash-payment" | "upload-payment-receipt" | "confirm-money-received" | "release-usdt" | "confirm-usdt-sent" | "complete-cash-trade" | "upload-seller-evidence" | "confirm-usdt-received" | "review-trade" | "open-trade" = "open-trade";
    if (request.status === "pending" && isSellerActor) action = "accept-trade";
    else if (request.status === "accepted" && isBuyerActor) action = cashTrade ? "confirm-cash-payment" : "upload-payment-receipt";
    else if (request.status === "payment_sent" && isSellerActor) action = "confirm-money-received";
    else if (request.status === "funds_received" && isSellerActor) action = cashTrade ? "confirm-usdt-sent" : "release-usdt";
    else if (request.status === "usdt_release_pending" && isSellerActor) action = cashTrade ? "confirm-usdt-sent" : "upload-seller-evidence";
    else if (request.status === "usdt_sent" && cashTrade && isSellerActor) action = "complete-cash-trade";
    else if (request.status === "usdt_sent" && !cashTrade && isBuyerActor) action = "confirm-usdt-received";
    else if ((request.status === "review_open" || request.status === "completed" || request.status === "locked") && isBuyerActor) action = "review-trade";
    const hash = action === "upload-payment-receipt" || action === "upload-seller-evidence"
      ? "evidence"
      : action === "review-trade" || action === "open-trade"
        ? "status-banner"
        : "action-required";
    return `/trade-room/${request.id}?action=${encodeURIComponent(action)}#${hash}`;
  }, [sessionUser]);

  const resolveTradeRoomDestinationFromRequests = useCallback((notification: AlphaExchangeNotification) => {
    const text = `${notification.title} ${notification.message}`.toLowerCase();
    if (!text.includes("trade")) return null;
    const direct = myRequests.find((request) =>
      request.id === notification.relatedRequestId
      || request.tradeId === notification.relatedTradeId,
    );
    if (direct) return buildTradeRoomDestinationFromRequest(direct);

    const tradeRefMatch = text.match(/tr-\d{3,}/i)?.[0]?.toLowerCase();
    if (tradeRefMatch) {
      const byDisplay = myRequests.find((request) => (
        String(request.displayNumber ?? "").toLowerCase() === tradeRefMatch
        || String(request.tradeId ?? "").toLowerCase() === tradeRefMatch
      ));
      if (byDisplay) return buildTradeRoomDestinationFromRequest(byDisplay);
    }

    const relevant = myRequests
      .filter((request) => request.status !== "declined" && request.status !== "cancelled")
      .sort((left, right) => new Date(right.updatedAt ?? right.createdAt).getTime() - new Date(left.updatedAt ?? left.createdAt).getTime());
    if (!relevant.length) return null;
    return buildTradeRoomDestinationFromRequest(relevant[0]);
  }, [buildTradeRoomDestinationFromRequest, myRequests]);

  const isTradeIntentNotification = useCallback((notification: AlphaExchangeNotification) => {
    if (getCommissionPaymentNotificationDestination(notification)) return false;
    const combinedText = `${notification.title} ${notification.message}`;
    const actionLabel = String(notification.actionLabel ?? "").toLowerCase();
    const centerCategory = String(notification.centerCategory ?? "").toLowerCase();
    const looksTradeRelated = /trade|payment sent|usdt|purchase request|\brequest\b|buyer marked|seller marked|confirm money|confirm usdt/i.test(combinedText);
    return notification.category === "trade"
      || centerCategory === "trades"
      || Boolean(notification.relatedRequestId)
      || Boolean(notification.relatedTradeId)
      || Boolean(notification.tradeSnapshot?.requestId)
      || actionLabel.includes("trade")
      || actionLabel.includes("payment")
      || actionLabel.includes("usdt")
      || looksTradeRelated;
  }, []);

  const inferTradeActionFromNotification = useCallback((notification: AlphaExchangeNotification) => {
    const text = `${notification.title} ${notification.message}`.toLowerCase();
    if (/new trade request/.test(text)) return "accept-trade";
    if (/withdrawal code|handed over cash|handed the cash/.test(text)) return "confirm-money-received";
    if (/trade request accepted/.test(text)) return "upload-payment-receipt";
    if (/buyer marked payment sent|payment sent/.test(text)) return "confirm-money-received";
    if (/buyer wallet is now revealed|send-and-complete/.test(text)) return "confirm-usdt-sent";
    if (/cash trade ready to complete/.test(text)) return "complete-cash-trade";
    if (/will complete the cash trade|no receipt confirmation is required/.test(text)) return "open-trade";
    if (/seller confirmed funds received|usdt release pending/.test(text)) return "upload-seller-evidence";
    if (/seller marked usdt sent|usdt sent/.test(text)) return "confirm-usdt-received";
    if (/review available|trade completed/.test(text)) return "review-trade";
    return null;
  }, []);

  const tradeActionHash = useCallback((action: string) => {
    if (action === "upload-payment-receipt" || action === "upload-seller-evidence") return "evidence";
    if (action === "review-trade" || action === "open-trade") return "status-banner";
    return "action-required";
  }, []);

  const resolveNotificationHref = useCallback((notification: AlphaExchangeNotification) => {
    const commissionDestination = getCommissionPaymentNotificationDestination(notification);
    if (commissionDestination) return commissionDestination;
    const conversationDestination = getTradeRoomConversationDestination(notification);
    if (conversationDestination) return conversationDestination;
    // An explicit internal destination for an owner/admin is not a Trade Room
    // authorization grant. Keep it ahead of category-based trade inference so
    // a nonparticipant cannot be sent to a participant workflow.
    const explicitInternalDestination = getExplicitNonTradeRoomNotificationDestination(notification);
    if (explicitInternalDestination) return explicitInternalDestination;
    if (isTradeIntentNotification(notification)) {
      const relatedRequestId = notification.relatedRequestId?.trim()
        || notification.tradeSnapshot?.requestId
        || extractTradeRoomHrefFromRelatedHref(notification.relatedHref ?? notification.actionHref)?.replace(/^\/trade-room\//, "")
        || null;
      const inferredAction = inferTradeActionFromNotification(notification);
      if (relatedRequestId && inferredAction) {
        return `/trade-room/${relatedRequestId}?action=${encodeURIComponent(inferredAction)}#${tradeActionHash(inferredAction)}`;
      }
      const directTradeDestination = resolveTradeRoomDestinationFromSnapshot(notification)
        ?? resolveTradeRoomDestinationFromRequests(notification);
      if (directTradeDestination) return directTradeDestination;
      const params = new URLSearchParams();
      params.set("notificationId", notification.id);
      params.set("includePending", "1");
      return `/trade-room?${params.toString()}`;
    }

    const inferredTradeDestination = resolveTradeRoomDestinationFromRequests(notification);
    if (inferredTradeDestination) return inferredTradeDestination;

    const explicit = getSafeInternalNotificationDestination(notification);
    if (explicit) return explicit;
    if (notification.relatedListingId) return `/usdt-exchange#listing-${notification.relatedListingId}`;
    const text = `${notification.title} ${notification.message}`.toLowerCase();
    if (text.includes("compliance") || text.includes("flagged seller") || text.includes("recovery fee")) {
      return isOwnerViewer
        ? "/admin/alpha-exchange?section=marketplace-enforcement"
        : "/dashboard/seller/compliance-payment";
    }
    return null;
  }, [extractTradeRoomHrefFromRelatedHref, inferTradeActionFromNotification, isOwnerViewer, isTradeIntentNotification, resolveTradeRoomDestinationFromRequests, resolveTradeRoomDestinationFromSnapshot, tradeActionHash]);

  const handleNotificationActionClick = useCallback((notification: AlphaExchangeNotification) => {
    const destination = resolveNotificationHref(notification);
    if (!destination) return;
    const isTradeIntent = isTradeIntentNotification(notification);
    if (isTradeIntent) {
      const routerDestination = destination.replace(/^\/(en|ar)(?=\/)/i, "") || destination;
      router.push(routerDestination);
    } else {
      router.push(destination);
    }
    if (!notification.isRead) {
      void handleNotificationReadState(notification.id, true);
    }
  }, [handleNotificationReadState, isTradeIntentNotification, resolveNotificationHref, router]);

  const resolveNotificationLabel = useCallback((notification: AlphaExchangeNotification) => {
    if (getCommissionPaymentNotificationDestination(notification)) return "Pay Commission";
    if (isTradeIntentNotification(notification)) return "Continue Trade";
    if (notification.actionLabel?.trim()) return notification.actionLabel.trim();
    if (notification.relatedTradeId || notification.relatedRequestId) return "Open Trade Room";
    if (notification.relatedListingId) return "Open Listing";
    const text = `${notification.title} ${notification.message}`.toLowerCase();
    if (text.includes("compliance") || text.includes("flagged seller") || text.includes("recovery fee")) {
      return "Open Compliance";
    }
    return "Open";
  }, [isTradeIntentNotification]);

  const isListingActionBusy = useCallback(
    () => Boolean(listingActionKey),
    [listingActionKey],
  );

  async function handleSellerListingStatus(listing: MarketplaceListing, nextStatus: "active" | "paused") {
    const actionLabel = nextStatus === "paused" ? "pause" : "resume";
    if (listingMutationInFlightRef.current) return;
    listingMutationInFlightRef.current = true;
    setSellerWorkspaceMessage(null);
    setListingActionKey(`${listing.id}:${actionLabel}`);
    try {
      const response = await fetch(`/api/alpha-exchange/listings/${listing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          void refreshCanonicalSession?.({ force: true });
          setSellerWorkspaceMessage(isAr ? "انتهت جلستك. سجّل الدخول مرة أخرى." : "Your session has expired. Please sign in again.");
          return;
        }
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing", isAr)));
        return;
      }

      const payload = await response.json() as { listing?: MarketplaceListing };
      syncListingState(payload.listing ?? null);
      setSellerWorkspaceMessage(nextStatus === "paused"
        ? (isAr ? "⏸ تم إيقاف العرض مؤقتًا. لن يظهر للمشترين حتى تستأنفه." : "⏸ Listing paused. It is no longer visible to buyers until you resume it.")
        : (isAr ? "▶ تم استئناف العرض وهو ظاهر الآن في السوق." : "▶ Listing resumed. Your listing is now live in the marketplace."));
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing", isAr));
    } finally {
      listingMutationInFlightRef.current = false;
      setListingActionKey(null);
    }
  }

  async function handleDiscordListingShare(listing: MarketplaceListing) {
    if (discordShareActionKey) return;
    setDiscordShareActionKey(listing.id);
    try {
      const response = await fetch(
        `/api/alpha-exchange/listings/${encodeURIComponent(listing.id)}/discord-share`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestKey: crypto.randomUUID() }),
        },
      );
      const payload = await response.json() as {
        accepted?: boolean;
        sharing?: DiscordListingSharingStatus;
        error?: string;
      };
      if (payload.sharing) setDiscordSharing(payload.sharing);
      if (!response.ok) {
        setSellerWorkspaceMessage(isAr ? "مشاركة العرض عبر Discord غير متاحة مؤقتًا." : (payload.error || "Discord listing sharing is temporarily unavailable."));
        return;
      }
      setSellerWorkspaceMessage(
        payload.accepted
          ? (isAr ? "تم قبول مشاركة Discord ويجري النشر في الخلفية." : "Discord share accepted. Publishing is processing in the background.")
          : (isAr ? "لهذا العرض حالة مشاركة حالية على Discord." : "This listing already has a current Discord share state."),
      );
      scheduleDiscordSharingRefreshes();
    } catch {
      setSellerWorkspaceMessage(isAr ? "مشاركة العرض عبر Discord غير متاحة مؤقتًا." : "Discord listing sharing is temporarily unavailable.");
    } finally {
      setDiscordShareActionKey(null);
    }
  }

  async function handleSellerListingDelete(listing: MarketplaceListing) {
    if (listingMutationInFlightRef.current) return;
    setRemovalError(null);
    setSellerWorkspaceMessage(null);
    setRemovalListing(listing);
    setRemovalReason("");
    setRemovalExplanation("");
  }

  async function confirmSellerListingRemoval() {
    if (!removalListing || listingMutationInFlightRef.current) return;
    const reportRemovalError = (message: string) => {
      setRemovalError(message);
      setSellerWorkspaceMessage(message);
    };
    const reasonResult = validateListingChangeReason({ reason: removalReason, explanation: removalExplanation });
    if (!reasonResult.ok) {
      reportRemovalError(reasonResult.error);
      return;
    }
    const listing = removalListing;
    listingMutationInFlightRef.current = true;
    setRemovalError(null);
    setListingActionKey(`${listing.id}:delete`);
    try {
      const response = await fetch(`/api/alpha-exchange/listings/${listing.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeReason: reasonResult.reason, changeExplanation: reasonResult.explanation }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          void refreshCanonicalSession?.({ force: true });
          reportRemovalError(isAr ? "انتهت جلستك. سجّل الدخول مرة أخرى." : "Your session has expired. Please sign in again.");
          return;
        }
        reportRemovalError(await readApiErrorMessage(response, safeErrorMessage("listing", isAr)));
        return;
      }
      syncListingState(listing, { remove: true });
      setSellerWorkspaceMessage(isAr ? "🗑 تم حذف العرض بنجاح." : "🗑 Listing removed successfully.");
      setRemovalListing(null);
      backgroundRefreshSellerWorkspace();
    } catch {
      reportRemovalError(safeErrorMessage("listing", isAr));
    } finally {
      listingMutationInFlightRef.current = false;
      setListingActionKey(null);
    }
  }

  async function handleSellerListingDuplicate(listing: MarketplaceListing) {
    setListingActionKey(`${listing.id}:duplicate`);
    try {
      const response = await fetch("/api/alpha-exchange/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos: listing.photos ?? [],
          availableAmount: listing.availableAmount,
          price: listing.price,
          currency: listing.currency ?? "ILS",
          network: listing.network,
          paymentMethods: listing.paymentMethods ?? [listing.paymentMethod ?? ""],
          bankName: listing.bankName ?? "",
          minimumTrade: listing.minimumTrade ?? "0",
          maximumTrade: listing.maximumTrade ?? listing.availableAmount,
          sellerDescription: listing.sellerDescription ?? "",
          acceptedCommissionPolicy: true,
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          void refreshCanonicalSession?.({ force: true });
          setSellerWorkspaceMessage(isAr ? "انتهت جلستك. سجّل الدخول مرة أخرى." : "Your session has expired. Please sign in again.");
          return;
        }
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing", isAr)));
        return;
      }
      const payload = await response.json() as { listing?: MarketplaceListing; destination?: string };
      syncListingState(payload.listing ?? null);
      setSellerWorkspaceMessage(isAr ? "📋 تم نسخ العرض بنجاح. راجعه وانشره عندما يصبح جاهزًا." : "📋 Listing duplicated successfully. Review and publish it when ready.");
      setEditingListingId(null);
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing", isAr));
    } finally {
      setListingActionKey(null);
    }
  }

  async function handleSellerListingRenew(listing: MarketplaceListing) {
    setListingActionKey(`${listing.id}:renew`);
    try {
      const response = await fetch(`/api/alpha-exchange/listings/${listing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "renew" }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          void refreshCanonicalSession?.({ force: true });
          setSellerWorkspaceMessage(isAr ? "انتهت جلستك. سجّل الدخول مرة أخرى." : "Your session has expired. Please sign in again.");
          return;
        }
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing", isAr)));
        return;
      }
      const payload = await response.json() as { listing?: MarketplaceListing; destination?: string };
      syncListingState(payload.listing ?? listing);
      setSellerWorkspaceMessage(isAr ? "🔄 تم تجديد العرض وأصبح مباشرًا بموعد انتهاء جديد." : "🔄 Listing renewed. Your listing is now live with a refreshed expiry.");
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing", isAr));
    } finally {
      setListingActionKey(null);
    }
  }

  async function handleSellerListingCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (listingCreateRequestInFlightRef.current) return;
    if (listingCreationBlocked) {
      setListingCreateResult({ tone: "error", message: listingCreationBlockedReason });
      return;
    }
    listingCreateRequestInFlightRef.current = true;
    setListingCreateResult(null);
    setSellerWorkspaceMessage(null);
    setListingActionKey("create:new");
    try {
      const response = await fetch("/api/alpha-exchange/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          availableAmount: listingCreateForm.availableAmount,
          price: listingCreateForm.price,
          currency: "ILS",
          network: listingCreateForm.network,
          paymentMethods: listingCreateSelectedMethods,
          bankAccountId: listingCreateRequiresBankAccount ? listingCreateForm.bankAccountId || undefined : undefined,
          bankName: listingCreateRequiresBank ? serializeIsraeliBankSelection(listingCreateSelectedBanks) : undefined,
          minimumTrade: listingCreateForm.minimumTrade,
          maximumTrade: listingCreateForm.maximumTrade || listingCreateForm.availableAmount,
          sellerDescription: listingCreateForm.sellerDescription,
          responseTime: DEFAULT_RESPONSE_TIME,
          acceptedCommissionPolicy: listingCommissionAgreement,
        }),
      });
      if (!response.ok) {
        let failureMessage: string;
        if (response.status === 401) {
          void refreshCanonicalSession?.({ force: true });
          failureMessage = "Your session has expired. Please sign in again.";
        } else {
          failureMessage = await readApiErrorMessage(response, safeErrorMessage("listing", isAr));
        }
        setListingCreateResult({ tone: "error", message: failureMessage });
        return;
      }
      const payload = await response.json() as { listing?: MarketplaceListing; destination?: string };
      syncListingState(payload.listing ?? null);
      setListingCreateForm((prev) => ({
        ...prev,
        availableAmount: "",
        price: "",
        currency: "ILS",
        paymentMethods: getDefaultListingPaymentMethods(sessionUser?.preferredPaymentMethods),
        bankAccountId: "",
        bankName: "",
        minimumTrade: "0",
        maximumTrade: "",
        sellerDescription: "",
      }));
      setListingCommissionAgreement(false);
      setListingCreateResult({
        tone: "success",
        message: "Listing submitted. It is awaiting Alpha Traders admin approval and is not visible to buyers yet.",
      });
      backgroundRefreshSellerWorkspace();
    } catch {
      setListingCreateResult({ tone: "error", message: safeErrorMessage("listing", isAr) });
    } finally {
      listingCreateRequestInFlightRef.current = false;
      setListingActionKey(null);
    }
  }

  async function handleSellerListingEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingListingId || listingMutationInFlightRef.current) return;
    const requiresReason = listingEditOriginal
      ? listingEditRequiresReason(listingEditOriginal, {
          availableAmount: listingEditForm.availableAmount,
          price: listingEditForm.price,
          minimumTrade: listingEditForm.minimumTrade,
          maximumTrade: listingEditForm.maximumTrade || listingEditForm.availableAmount,
        })
      : false;
    if (requiresReason) {
      const reasonResult = validateListingChangeReason({ reason: listingEditForm.changeReason, explanation: listingEditForm.changeExplanation });
      if (!reasonResult.ok) {
        setSellerWorkspaceMessage(reasonResult.error);
        return;
      }
    }
    listingMutationInFlightRef.current = true;
    setSellerWorkspaceMessage(null);
    setListingActionKey(`${editingListingId}:save`);
    try {
      const response = await fetch(`/api/alpha-exchange/listings/${editingListingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          availableAmount: listingEditForm.availableAmount,
          price: listingEditForm.price,
          currency: listingEditForm.currency,
          network: listingEditForm.network,
          paymentMethods: listingEditSelectedMethods,
          bankAccountId: listingEditRequiresBankAccount ? listingEditForm.bankAccountId || undefined : undefined,
          bankName: listingEditRequiresBank ? serializeIsraeliBankSelection(listingEditSelectedBanks) : undefined,
          minimumTrade: listingEditForm.minimumTrade,
          maximumTrade: listingEditForm.maximumTrade || listingEditForm.availableAmount,
          sellerDescription: listingEditForm.sellerDescription,
          changeReason: requiresReason ? listingEditForm.changeReason : undefined,
          changeExplanation: requiresReason ? listingEditForm.changeExplanation : undefined,
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          void refreshCanonicalSession?.({ force: true });
          setSellerWorkspaceMessage(isAr ? "انتهت جلستك. سجّل الدخول مرة أخرى." : "Your session has expired. Please sign in again.");
          return;
        }
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing", isAr)));
        return;
      }
      const payload = await response.json() as { listing?: MarketplaceListing; destination?: string };
      syncListingState(payload.listing ?? null);
      setEditingListingId(null);
      setListingEditOriginal(null);
      setSellerWorkspaceMessage(isAr ? "✅ تم تحديث العرض بنجاح وأصبحت التغييرات ظاهرة للمشترين." : "✅ Listing updated successfully. Changes are now visible to buyers.");
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing", isAr));
    } finally {
      listingMutationInFlightRef.current = false;
      setListingActionKey(null);
    }
  }

  async function fileToDataUrl(file: File) {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Failed to read evidence file."));
      };
      reader.onerror = () => reject(new Error("Failed to read evidence file."));
      reader.readAsDataURL(file);
    });
  }

  async function uploadTradeEvidenceFile(requestId: string, side: "buyer" | "seller", file: File) {
    if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) {
      const message = "Unsupported evidence format. Use PNG, JPG, JPEG, WEBP, or PDF.";
      if (side === "buyer") setStatusMessage(message);
      else setSellerWorkspaceMessage(message);
      return false;
    }
    if (file.size > MAX_EVIDENCE_SIZE_BYTES) {
      const message = isAr ? "ملف الإثبات كبير جدًا. الحد الأقصى 8 ميجابايت." : "Evidence file is too large. Maximum size is 8MB.";
      if (side === "buyer") setStatusMessage(message);
      else setSellerWorkspaceMessage(message);
      return false;
    }

    const evidenceKey = `${requestId}:${side}`;
    setEvidenceUploading((prev) => ({ ...prev, [evidenceKey]: true }));
    try {
      const fileData = await fileToDataUrl(file);
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${requestId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          side,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          fileData,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        const message = isAr ? safeErrorMessage("evidence", true) : (payload.error ?? safeErrorMessage("evidence", false));
        if (side === "buyer") setStatusMessage(message);
        else setSellerWorkspaceMessage(message);
        return false;
      }
      if (side === "buyer") {
        setBuyerEvidenceFiles((prev) => ({ ...prev, [requestId]: null }));
        setStatusMessage(isAr ? "تم رفع إثبات المشتري." : "Buyer evidence uploaded.");
      } else {
        setSellerEvidenceFiles((prev) => ({ ...prev, [requestId]: null }));
        setSellerWorkspaceMessage(isAr ? "تم رفع إثبات البائع." : "Seller evidence uploaded.");
      }
      await refreshSellerWorkspace();
      return true;
    } catch {
      if (side === "buyer") setStatusMessage(safeErrorMessage("evidence", isAr));
      else setSellerWorkspaceMessage(safeErrorMessage("evidence", isAr));
      return false;
    } finally {
      setEvidenceUploading((prev) => ({ ...prev, [evidenceKey]: false }));
    }
  }

  async function handleSellerRequestAction(
    requestId: string,
    nextStatus: "accepted" | "declined" | "funds_received" | "usdt_release_pending" | "usdt_sent",
    options?: { safetyAcknowledged?: boolean },
  ) {
    const actionKey = `${requestId}:${nextStatus}`;
    if (requestActionKey) return;
    const targetRequest = myRequests.find((request) => request.id === requestId);
    if (targetRequest?.feePolicyVersion === "buyer_seller_1pct_v1" && ["accepted", "funds_received"].includes(nextStatus)
      && !window.confirm(`${sellerFeeResponsibilityNotice(isAr ? "ar" : "en")}\n${targetRequest.currency} ${targetRequest.fiatAmount}`)) return;
    const isPriceOffer = targetRequest?.priceMode === "buyer_offer";
    setRequestActionKey(actionKey);
    const safetyAcknowledged = options?.safetyAcknowledged === true;
    try {
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, safetyAcknowledged }),
      });
      const payload = (await response.json()) as { error?: string; request?: PurchaseRequest; destination?: string };
      if (!response.ok) {
        setSellerWorkspaceMessage(isAr ? safeErrorMessage("request", true) : (payload.error ?? safeErrorMessage("request", false)));
        return;
      }
      if (nextStatus === "accepted") setSellerWorkspaceMessage(isPriceOffer
        ? (isAr ? "تم قبول عرض السعر وإنشاء الصفقة بالسعر المتفق عليه." : "Price offer accepted. The trade was created at the agreed price.")
        : (isAr ? "تم قبول الطلب وإنشاء الصفقة." : "Request accepted and trade created."));
      else if (nextStatus === "funds_received") setSellerWorkspaceMessage(isAr ? "تم تأكيد استلام الأموال." : "Funds received confirmed.");
      else if (nextStatus === "usdt_release_pending") setSellerWorkspaceMessage(isAr ? "بدأ إرسال USDT." : "USDT release started.");
      else if (nextStatus === "usdt_sent") setSellerWorkspaceMessage(isAr ? "تم تحديد USDT كمُرسل." : "USDT sent marked.");
      else setSellerWorkspaceMessage(isPriceOffer ? (isAr ? "تم رفض عرض السعر." : "Price offer declined.") : (isAr ? "تم رفض الطلب." : "Request declined."));
      if (payload.request) {
        setMyRequests((current) => current.map((request) => request.id === payload.request?.id ? payload.request : request));
      }
      if (nextStatus === "accepted" && navigateAfterSuccess(router, payload.destination, isAr ? "تم قبول الطلب بنجاح." : "Request accepted successfully.")) {
        void refreshSellerWorkspace();
        return;
      }
      await refreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(isAr ? "تعذر الاتصال بالخادم الآن. حاول مرة أخرى." : "Unable to reach the server right now. Please try again.");
    } finally {
      setRequestActionKey(null);
    }
  }

  async function handleCommissionPayNow() {
    if (!sellerCommissionStatus?.commissionId) {
      setCommissionPayMessage(isAr ? "لم يتم العثور على سجل عمولة قابل للدفع." : "No payable commission record was found.");
      return;
    }
    const submittedCommissionId = sellerCommissionStatus.commissionId;
    if (!(commissionPayableAmountDue > 0)) {
      setCommissionPayMessage(isAr ? "مبلغ العمولة المحدد غير متاح. أعد فتح طلب الدفع." : "The exact commission amount is unavailable. Please reopen the payment request.");
      return;
    }
    if (!(commissionNetwork === "BEP20" ? /^0x[a-fA-F0-9]{64}$/ : /^(?:0x)?[a-fA-F0-9]{64}$/).test(commissionTxSignature.trim())) {
      setCommissionPayMessage(isAr ? "ألصق معرّف المعاملة الكامل للشبكة المختارة." : "Paste the full transaction ID for the selected network.");
      return;
    }
    if (!selectedCommissionWalletAvailable) {
      setCommissionPayMessage(selectedCommissionWalletError);
      return;
    }
    setCommissionPayBusy(true);
    setCommissionPayMessage(null);
    try {
      const response = await fetch("/api/alpha-exchange/commissions/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commissionId: submittedCommissionId,
          network: commissionNetwork,
          paymentSignature: commissionTxSignature.trim(),
        }),
      });
      const payload = (await response.json()) as { error?: string; verification?: { verified: boolean; pending?: boolean; notes: string } };
      if (!response.ok) {
        setCommissionPayMessage(isAr ? "تعذر التحقق من دفع العمولة." : (payload.error ?? "Unable to verify commission payment."));
        return;
      }
      setCommissionTxSignature("");
      if (payload.verification?.verified) {
        const refreshedStatus = await refreshSellerWorkspace();
        const remainingCommissionCount = refreshedStatus?.pendingCount
          ?? Math.max(0, (sellerCommissionStatus.pendingCount ?? 1) - 1);
        const successMessage = remainingCommissionCount === 0
          ? (isAr ? "✅ تم التحقق من الدفع وتسوية جميع العمولات. أزيلت القيود المتعلقة بالعمولة؛ وتظل أي قيود أخرى على الحساب سارية." : "✅ Payment verified. All commission dues are settled and commission-related restrictions are cleared; any other account restrictions still apply.")
          : (isAr ? `✅ تم التحقق من هذه الدفعة. ما زالت هناك ${remainingCommissionCount} عمولة مستحقة.` : `✅ This payment was verified. ${remainingCommissionCount} other commission payment${remainingCommissionCount === 1 ? " remains" : "s remain"} due.`);
        // A verified record is no longer payable. Close and reset the old panel
        // so it cannot silently retarget its green result at a different due.
        setCommissionPayMessage(null);
        setCommissionPayOpen(false);
        setCommissionPayerType(null);
        setCommissionAdvancedOpen(false);
        setSellerWorkspaceMessage(successMessage);
        return;
      }

      setCommissionPayMessage(payload.verification?.pending
        ? (isAr ? "⏳ تم إرسال الدفعة. ستتحقق Alpha Traders منها تلقائيًا بعد التأكيد النهائي على الشبكة المختارة." : "⏳ Payment submitted. Alpha Traders will verify it automatically after blockchain final confirmation.")
        : (isAr ? "فشل التحقق من الدفع." : (payload.verification?.notes ?? "Verification failed.")));
      // Keep the panel bound to the exact record whose TxID was submitted.
      // A generic refresh would select the oldest unpaid commission and could
      // display this result beside a different trade and amount.
      const refreshedStatus = await refreshSellerWorkspace({ commissionId: submittedCommissionId });
      if (refreshedStatus?.selectionError) {
        await refreshSellerWorkspace();
        setCommissionPayMessage(null);
        setCommissionPayOpen(false);
        setSellerWorkspaceMessage(isAr
          ? "تغيّرت حالة دفعة العمولة أثناء التحقق. تم تحديث مساحة العمل إلى أحدث حالة."
          : "The commission payment changed while it was being verified. The workspace has been refreshed to the latest state.");
      }
    } catch {
      setCommissionPayMessage(isAr ? "تعذر التحقق من دفع العمولة." : "Unable to verify commission payment.");
    } finally {
      setCommissionPayBusy(false);
    }
  }

  async function handleBuyerTradeStatus(request: PurchaseRequest, nextStatus: "payment_sent" | "completed" | "cancelled") {
    const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setStatusMessage(isAr ? safeErrorMessage("request", true) : (payload.error ?? safeErrorMessage("request", false)));
      return;
    }
    const paymentMethod = normalizeMarketplacePaymentMethod(request.paymentMethod) ?? request.paymentMethod;
    setStatusMessage(
      nextStatus === "payment_sent"
        ? (paymentMethod === "Cardless ATM Withdrawal"
          ? (isAr ? "تم تحديد السحب كجاهز." : "Withdrawal marked as ready.")
          : (isAr ? "تم تأكيد إرسال الدفعة." : "Payment sent confirmed."))
        : nextStatus === "completed"
          ? (isAr ? "اكتملت الصفقة وأصبح التقييم متاحًا." : "Trade completed. Review window is open.")
          : (isAr ? "تم إلغاء الطلب." : "Request cancelled."),
    );
    await refreshSellerWorkspace();
  }

  async function handleSubmitBuyerReview(request: PurchaseRequest) {
    const comment = String(tradeReviewDrafts[request.id] ?? "").trim();
    if (!comment) {
      setStatusMessage(safeErrorMessage("review", isAr));
      return;
    }
    const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "buyer_review", rating: 5, comment }),
    });
    await response.json();
    if (!response.ok) {
      setStatusMessage(safeErrorMessage("review", isAr));
      return;
    }
    setTradeReviewDrafts((prev) => ({ ...prev, [request.id]: "" }));
    setStatusMessage(isAr ? "تم إرسال التقييم." : "Review submitted.");
    await refreshSellerWorkspace();
  }

  async function handleSubmitSellerResponse(request: PurchaseRequest) {
    const message = String(sellerResponseDrafts[request.id] ?? "").trim();
    if (!message) {
      setSellerWorkspaceMessage(safeErrorMessage("review", isAr));
      return;
    }
    const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "seller_response", message }),
    });
    await response.json();
    if (!response.ok) {
      setSellerWorkspaceMessage(safeErrorMessage("review", isAr));
      return;
    }
    setSellerResponseDrafts((prev) => ({ ...prev, [request.id]: "" }));
    setSellerWorkspaceMessage(isAr ? "تم إرسال الرد على التقييم." : "Review response submitted.");
    await refreshSellerWorkspace();
  }

  const unreadNotificationsCount = notifications.filter((item) => !item.isRead).length;

  function renderNotificationCenterCard(sectionId: string, className?: string) {
    if (!sessionUser) return null;
    const defaultVisibleCount = isMobileViewport ? 1 : 2;
    const visibleCount = notificationCenterExpanded ? sortedNotifications.length : defaultVisibleCount;
    const hasHiddenNotifications = sortedNotifications.length > defaultVisibleCount;
    return (
      <Card id={sectionId} tabIndex={desktopWorkspaceNavigation ? -1 : undefined} className={cn("border-white/10 bg-[#0B0B0B]/90", desktopWorkspaceNavigation && "scroll-mt-24", className)}>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <BellRing className="h-4 w-4 text-[#C9A227]" />
          {isAr ? "مركز الإشعارات" : "Notification Center"}
          <span className="rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2 py-0.5 text-[11px] text-[#C9A227]">{currencyText(isAr ? `${unreadNotificationsCount} غير مقروء` : `${unreadNotificationsCount} unread`)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder={isAr ? "ابحث في الإشعارات..." : "Search notifications..."} value={notificationQuery} onChange={(event) => setNotificationQuery(event.target.value)} />
          <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={notificationCategory} onChange={(event) => setNotificationCategory(event.target.value as typeof notificationCategory)}>
            <option value="all">{isAr ? "التصنيف: الكل" : "Category: All"}</option>
            <option value="trade">{isAr ? "صفقة" : "Trade"}</option>
            <option value="listing">{isAr ? "عرض" : "Listing"}</option>
            <option value="application">{isAr ? "طلب بائع" : "Application"}</option>
            <option value="trust">{isAr ? "الثقة" : "Trust"}</option>
            <option value="review">{isAr ? "تقييم" : "Review"}</option>
            <option value="account">{isAr ? "الحساب" : "Account"}</option>
            <option value="dispute">{isAr ? "نزاع" : "Dispute"}</option>
            <option value="report">{isAr ? "بلاغ" : "Report"}</option>
            <option value="system">{isAr ? "النظام" : "System"}</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setNotificationUnreadOnly((prev) => !prev)}>
            {notificationUnreadOnly ? (isAr ? "عرض غير المقروء فقط" : "Showing unread only") : (isAr ? "إظهار غير المقروء فقط" : "Show unread only")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void handleMarkAllNotificationsRead()}>
            {isAr ? "تحديد الكل كمقروء" : "Mark All Read"}
          </Button>
        </div>
        <div className="space-y-3">
          {!notificationsInitialized ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9CA3AF]">
              {isAr ? "جارٍ تحميل مركز الإشعارات…" : "Loading notification center…"}
            </div>
          ) : null}
          {notificationsLoading ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9CA3AF]">{isAr ? "جارٍ تحميل الإشعارات..." : "Loading notifications..."}</div>
          ) : null}
          {notificationsInitialized && !notificationsLoading && notifications.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center text-xs text-[#9CA3AF]">
              <BellRing className="mx-auto mb-2 h-4 w-4 text-[#9CA3AF]" />
              {isAr ? "لا توجد إشعارات بعد. ستظهر هنا تحديثات الصفقات والعروض والتقييمات ونشاط الحساب." : "No notifications yet. You’ll be notified here about trades, listings, reviews, and account activity."}
            </div>
          ) : null}
          {sortedNotifications.slice(0, visibleCount).map((notification) => (
            <div key={notification.id} className={`rounded-xl border p-4 text-xs ${notification.isRead ? "border-white/10 bg-black/20 text-[#9CA3AF]" : "border-[#C9A227]/35 bg-[#C9A227]/10 text-[#F3F4F6]"}`}>
              {(() => {
                const copy = localizeNotificationCopy(notification, locale);
                const actionLabel = localizeNotificationActionLabel(resolveNotificationLabel(notification), locale, notification);
                const actionHref = resolveNotificationHref(notification);
                const hasAction = Boolean(actionHref);
                return (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div>
                        <p className="text-sm font-semibold text-white">{currencyText(replaceExchangeEntityIdsWithHints(copy.title, notification))}</p>
                        <p className="mt-1 text-[11px] text-[#93C5FD]">
                          {currencyText(notification.relatedListingDisplayNumber ? `${isAr ? "العرض" : "Listing"} ${formatListingId(notification.relatedListingDisplayNumber, notification.relatedListingId)}` : null)}
                          {currencyText(notification.relatedTradeDisplayNumber ? `${notification.relatedListingDisplayNumber ? " • " : ""}${isAr ? "الصفقة" : "Trade"} ${formatTradeId(notification.relatedTradeDisplayNumber, notification.relatedTradeId)}` : null)}
                          {currencyText(notification.relatedRequestDisplayNumber && !notification.relatedTradeDisplayNumber ? `${notification.relatedListingDisplayNumber ? " • " : ""}${isAr ? "الصفقة" : "Trade"} ${formatTradeId(notification.relatedRequestDisplayNumber, notification.relatedRequestId)}` : null)}
                        </p>
                      </div>
                      <p className="max-w-3xl text-sm leading-6 text-white/90">{currencyText(replaceExchangeEntityIdsWithHints(copy.message, notification))}</p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#9CA3AF]">
                        <span>{currencyText(formatNotificationRelativeTime(notification.createdAt, locale))}</span>
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 capitalize text-[#D1D5DB]">{currencyText(notificationCategoryLabel(notification.category, isAr))}</span>
                      </div>
                      {hasAction ? (
                        <button
                          type="button"
                          onClick={() => void handleNotificationActionClick(notification)}
                          className="inline-flex items-center rounded-full border border-[#6CAEFF]/40 bg-[#6CAEFF]/10 px-3 py-1.5 text-[11px] font-medium text-[#93C5FD] transition hover:border-[#6CAEFF]/70"
                        >
                          {currencyText(actionLabel)}
                        </button>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button type="button" size="sm" variant="secondary" className="h-9 px-3" onClick={() => void handleNotificationReadState(notification.id, !notification.isRead)}>
                        {notification.isRead ? (isAr ? "غير مقروء" : "Unread") : (isAr ? "مقروء" : "Read")}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" className="h-9 px-3" onClick={() => void handleDeleteNotification(notification.id)}>
                        {isAr ? "حذف" : "Delete"}
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
          {hasHiddenNotifications ? (
            <div className="flex justify-start">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setNotificationCenterExpanded((prev) => !prev)}
              >
                {currencyText(notificationCenterExpanded ? (isAr ? "عرض أقل" : "Show less") : (isAr ? `عرض المزيد (${sortedNotifications.length - defaultVisibleCount})` : `View more (${sortedNotifications.length - defaultVisibleCount})`))}
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
      </Card>
    );
  }

  const marketInsightsCard = sessionUser && isSellerWorkspaceUser ? (
    <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
      <CardHeader>
        <CardTitle>{isAr ? "إحصاءات السوق" : "Marketplace Insights"}</CardTitle>
        <CardDescription>{isAr ? "مؤشرات يومية تساعدك على التداول بسرعة أكبر وبناء ثقة المشترين." : "Daily signals to help you trade faster and build seller trust."}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
              <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "الصفقات المكتملة اليوم" : "Today’s Completed Trades"}</p>
              <p className="mt-1 text-lg font-semibold text-white">{todaysCompletedTrades.toLocaleString("en-IL")}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
              <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "العروض النشطة" : "Active Listings"}</p>
              <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.activeListings.toLocaleString("en-IL")}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
              <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "نسبة نجاح الصفقات" : "Trade Success Rate"}</p>
              <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.successRate.toFixed(1)}%</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
              <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "الطلبات المعلقة" : "Pending Requests"}</p>
              <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.pendingRequests.toLocaleString("en-IL")}</p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "تحديثات السوق" : "Marketplace Updates"}</p>
            {!marketplaceUpdates.length ? <p className="text-xs text-[#9CA3AF]">{isAr ? "لا توجد تحديثات بعد. سيظهر نشاطك هنا عند بدء التداول." : "No updates yet. Your activity appears here as soon as you trade."}</p> : null}
            {marketplaceUpdates.map((update) => (
              <div key={update.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                <p className="font-medium text-white">{currencyText(update.title)}</p>
                <p className="mt-1">{currencyText(update.details)}</p>
                <p className="mt-1 text-[#9CA3AF]">{currencyText(formatNotificationRelativeTime(update.createdAt, locale))}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {sellerStatusForLanding === "approved_seller" ? <SellerRankCard summary={sellerRankSummary} error={sellerRankError} locale={isAr ? "ar" : "en"} /> : null}
        </div>
      </CardContent>
    </Card>
  ) : null;
  const buyerOverviewCard = sessionUser && !isSellerWorkspaceUser ? (
    <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
      <CardHeader className="pb-4">
        <CardTitle>{isAr ? "لوحة المشتري" : "Buyer Dashboard"}</CardTitle>
        <CardDescription>{isAr ? "ملخص سريع لرحلة الشراء الخاصة بك داخل Alpha Exchange." : "A compact view of your trading activity, trusted sellers, and recent purchase momentum."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { label: isAr ? "إجمالي المشتريات" : "Total Purchases", value: buyerOverviewStats.total.toLocaleString("en-IL") },
            { label: isAr ? "المشتريات المعلقة" : "Pending Purchases", value: buyerOverviewStats.pending.toLocaleString("en-IL") },
            { label: isAr ? "المشتريات المكتملة" : "Completed Purchases", value: buyerOverviewStats.completed.toLocaleString("en-IL") },
            { label: isAr ? "المشتريات الأخيرة" : "Recent Purchases", value: buyerOverviewStats.recentPurchases.toLocaleString("en-IL") },
            { label: isAr ? "طرق الدفع المفضلة" : "Favorite Payment Methods", value: buyerOverviewStats.favoritePaymentMethods },
            { label: isAr ? "البائعون الموثوقون" : "Trusted Sellers", value: buyerOverviewStats.uniqueTrustedSellers.toLocaleString("en-IL") },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{currencyText(item.label)}</p>
              <p className="mt-2 text-lg font-semibold text-white">{currencyText(item.value)}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "أحدث المشتريات" : "Recent Purchases"}</p>
            {!buyerOverviewStats.recentTrades.length ? <p className="mt-3 text-sm text-[#9CA3AF]">{isAr ? "ابدأ أول صفقة لرؤية نشاطك هنا." : "Start your first trade to populate this feed."}</p> : null}
            <div className="mt-3 space-y-2">
              {buyerOverviewStats.recentTrades.map((request) => (
                <div key={`buyer-overview-${request.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-[#D1D5DB]">
                  <div>
                    <p className="font-medium text-white">{currencyText(shortTradeRef(request, isAr))}</p>
                    <p className="mt-0.5">{currencyText(`${Math.trunc(toNumber(request.usdtAmount)).toLocaleString("en-US")} USDT`)} • {currencyText(paymentMethodLabel(request.paymentMethod, isAr))}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#C9A227]">{currencyText(tradeStatusLabel(request.status, isAr))}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[#C9A227]/20 bg-[#C9A227]/10 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#D4AF37]">{isAr ? "ملخص التداول" : "Trading Summary"}</p>
            <p className="mt-3 text-3xl font-semibold text-white">{currencyText(`${Math.trunc(buyerOverviewStats.totalUsdtBought).toLocaleString("en-US")} USDT`)}</p>
            <p className="mt-1 text-sm text-[#E5E7EB]">{currencyText(isAr ? "إجمالي USDT الذي اشتريته عبر المنصة." : "Total USDT purchased through Alpha Exchange.")}</p>
            <div className="mt-4 space-y-2 text-xs text-[#E5E7EB]">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <span>{isAr ? "أيام نشطة" : "Active Trading Days"}</span>
                <span className="font-semibold text-white">{buyerOverviewStats.activeDays}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <span>{isAr ? "المشتريات المكتملة" : "Completed Orders"}</span>
                <span className="font-semibold text-white">{buyerOverviewStats.completed}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <span>{isAr ? "متوسط سعر الشراء" : "Average Purchase Price"}</span>
                <span className="font-semibold text-white">{currencyText(formatIls(buyerOverviewStats.averagePurchasePrice))}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  ) : null;
  const sellerApplicationPanel = showDeferredSections && !isSellerWorkspaceUser && !isAdminSession ? (
    <SellerApplicationSection
      isAr={isAr}
      prominent={showBuyerSellerApplicationUpFront}
      compact={isDashboardWorkspace}
      isLoading={isSellerApplicationLoading}
      isApprovedSellerSession={isApprovedSellerSession}
      shouldCondense={shouldCondenseSellerApplication}
      isExpanded={isSellerApplicationExpanded}
      eligibility={sellerApplicationEligibility}
      application={sellerApplication}
      statusMessage={statusMessage}
      statusMessageFeedbackKey={statusMessageFeedbackKey}
      form={sellerForm}
      sessionEmail={sessionUser?.email ?? ""}
      methods={sellerApplicationMethods}
      onExpandedChange={setIsSellerApplicationExpanded}
      onSetUpBuyer={() => router.push("/onboarding")}
      onFormChange={(field, value) => {
        sellerFormTouchedRef.current = true;
        setSellerForm((prev) => ({ ...prev, [field]: value }));
      }}
      onMethodToggle={(method) => {
        setSellerApplicationMethods((prev) => prev.includes(method)
          ? prev.filter((item) => item !== method)
          : [...prev, method]);
      }}
      onSubmit={handleSellerApplicationSubmit}
    />
  ) : null;

  const workspaceNavigation = (
    <ExchangeWorkspaceNavigation cards={visibleWorkspaceCards} isAr={isAr} integrated={integrateWorkspace} compact={compactBuyerWorkspace} />
  );
  const welcomeActions = !isDashboardWorkspace || integrateWorkspace ? (
    <div className="account-welcome__actions">
      {heroPrimaryActions.map((action, index) => (
        <Button
          key={action.key}
          type="button"
          variant={index === 0 ? "default" : "secondary"}
          className="min-h-11"
          onClick={action.onClick}
        >
          {currencyText(action.label)}
        </Button>
      ))}
    </div>
  ) : (
    <div className="account-welcome__actions">
      {welcomeRole === "owner" ? (
        <Link href="/admin/alpha-exchange" className="gold-gradient inline-flex min-h-11 items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-black">{isAr ? "لوحة المالك" : "Owner Dashboard"}</Link>
      ) : (
        <Link href="/usdt-exchange#marketplace" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#B8860B] via-[#D4AF37] to-[#E7C65B] px-6 py-3 text-sm font-semibold text-black shadow-[0_4px_20px_rgba(201,162,39,0.15)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D4AF37] sm:w-auto">
          <Store className="h-4 w-4" aria-hidden="true" />
          {isAr ? "تصفح البائعين" : "Browse Sellers"}
          <ArrowRight className={cn("h-4 w-4", isAr && "rotate-180")} aria-hidden="true" />
        </Link>
      )}
    </div>
  );

  if (!sessionUser) return null;

  return (
    <section className="section-container page-shell exchange-marketplace-shell overflow-x-clip">
      {statusMessage && !selectedListing ? (
        <ActionFeedback revealKey={statusMessageFeedbackKey} className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-[#FDE68A]">
          {currencyText(statusMessage)}
        </ActionFeedback>
      ) : null}
      {sessionUser ? (
        <>
          <AccountWelcome
            role={welcomeRole}
            locale={isAr ? "ar" : "en"}
            name={workspacePrimaryName}
            description={workspacePositiveMessage}
            greeting={greetingLabel}
            suspended={sellerStatusForLanding === "suspended"}
            actions={welcomeActions}
            workspace={integrateWorkspace ? workspaceNavigation : undefined}
          >
              {welcomeRole === "buyer" ? (
                <BuyerRankCard summary={buyerProfileSummary} locale={isAr ? "ar" : "en"} />
              ) : null}
              {welcomeRole === "approved_seller" ? (
                <SellerRankCard summary={sellerRankSummary} error={sellerRankError} locale={isAr ? "ar" : "en"} />
              ) : null}
              {isDashboardWorkspace ? (
                <div className="mt-4">
                  {isSellerWorkspaceUser ? (
                    <div className="mb-3">{welcomeRole !== "owner" ? <RankBadge rank={sellerRankSummary?.sellerLevel ?? sellerOverviewStats.reputation?.level} locale={isAr ? "ar" : "en"} audience="seller" /> : null}</div>
                  ) : null}

                </div>
              ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "اسم التداول" : "Trading Name"}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{currencyText(publicAccountName(sessionUser))}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{welcomeRole === "approved_seller" ? (isAr ? "مستوى البائع" : "Seller Level") : welcomeRole === "buyer" ? (isAr ? "رتبة المشتري" : "Buyer Rank") : (isAr ? "دور الحساب" : "Account Role")}</p>
                  <div className="mt-2">{welcomeRole === "approved_seller" ? <RankBadge rank={sellerRankSummary?.sellerLevel ?? sellerOverviewStats.reputation?.level} locale={isAr ? "ar" : "en"} audience="seller" /> : welcomeRole === "buyer" ? <RankBadge rank={buyerProfileSummary?.key} locale={isAr ? "ar" : "en"} audience="buyer" /> : <RoleBadge variant={welcomeRole} locale={isAr ? "ar" : "en"} />}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{welcomeRole === "owner" ? (isAr ? "هوية المالك العامة" : "Public owner identity") : (isAr ? "معرّف AT" : "AT ID")}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Link href="/profile" className="text-sm font-semibold text-[#93C5FD] underline-offset-2 hover:underline">{currencyText(workspaceDisplayId)}</Link>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.clipboard) {
                          void navigator.clipboard.writeText(workspaceDisplayId);
                        }
                        if (isSellerWorkspaceUser) setSellerWorkspaceMessage(isAr ? `تم نسخ ${workspaceDisplayId}` : `Copied ${workspaceDisplayId}`);
                        else setStatusMessage(isAr ? `تم نسخ ${workspaceDisplayId}` : `Copied ${workspaceDisplayId}`);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "سوق اليوم" : "Today’s Market"}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{currencyText("USDT / ILS")} {currencyText(formatIls(marketPricePerUsdt))}</p>
                </div>
              </div>
              )}
          </AccountWelcome>

          {showBuyerSellerApplicationUpFront && (!isDashboardWorkspace || sellerApplicationEligibility !== "application_pending") ? sellerApplicationPanel : null}
          {isDashboardWorkspace && isApprovedSeller ? (
            <Card className="mt-5 border-[#C9A227]/35 bg-[#C9A227]/5">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-[#D4AF37]" aria-hidden="true" />
                  <CardTitle className="text-lg">{isAr ? "بائع معتمد" : "Approved Seller"}</CardTitle>
                </div>
                <Button type="button" variant="secondary" disabled={isWorkspaceWidgetsLoading || !showSellerWorkspace} onClick={workspaceCards.find((card) => card.key === "listings")?.onClick}>
                  {isAr ? "عرض وإدارة العروض" : "View and Manage Listings"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {!integrateWorkspace ? workspaceNavigation : null}

          {needsAttentionItems.length ? (
            <Card className="mt-4 border-amber-500/30 bg-[#0B0B0B]/92">
              <CardHeader className="pb-3">
                <CardTitle className="inline-flex items-center gap-2 text-lg text-white">
                  <AlertTriangle className="h-4 w-4 text-amber-300" />
                  {isAr ? "بحاجة إلى انتباه" : "Needs Attention"}
                </CardTitle>
                <CardDescription>{isAr ? "أهم الإجراءات الحالية تظهر هنا أولًا." : "The most urgent actions appear here first."}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {needsAttentionItems.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={item.onClick}
                    className="rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4 text-start transition hover:-translate-y-0.5 hover:border-amber-400/35 hover:bg-amber-500/12"
                  >
                    <p className="text-xs uppercase tracking-[0.14em] text-amber-200/80">{currencyText(item.title)}</p>
                    <p className="mt-2 text-sm font-semibold text-white">{currencyText(item.body)}</p>
                    <p className="mt-3 text-xs font-medium text-amber-200">{currencyText(item.action)}</p>
                  </button>
                ))}
              </CardContent>
            </Card>
          ) : null}

        </>
      ) : null}

      {workspaceError ? (
        <Card className="mt-6 border-amber-500/30 bg-[#0B0B0B]/95">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-[#FDE68A]">
            <AlertTriangle className="h-4 w-4" />
            <span>{currencyText(workspaceError)}</span>
          </CardContent>
        </Card>
      ) : null}
      <div id="marketplace" className={isDashboardWorkspace ? "hidden" : "mt-12"}>
        <div id="marketplace-sellers" className="scroll-mt-28" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold md:text-3xl">{isAr ? "السوق المباشر" : "Live Marketplace"}</h2>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            {isAr ? "مباشر" : "LIVE"}
          </div>
        </div>

        {/* Professional live market panel */}
        <div id="market-overview" tabIndex={desktopWorkspaceNavigation ? -1 : undefined} className={cn("mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0A0A0A]/90 shadow-[0_16px_48px_rgba(0,0,0,0.35)]", desktopWorkspaceNavigation && "scroll-mt-24")}>
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 sm:px-5">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#D4AF37]">{isAr ? "السوق المباشر" : "Live Market"}</p>
              <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "تسعير فوري لثلاثة أزواج مرجعية" : "Real-time pricing across three reference pairs"}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
              <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {marketSnapshot?.status === "live" ? (isAr ? "مباشر" : "LIVE") : (isAr ? "آخر تحديث" : "Last update")}
            </span>
          </div>
          {(() => {
            const marketCards = [
              marketSnapshot?.pairs.usdtIls ?? { key: "usdtIls" as const, label: "USDT / ILS", price: marketPricePerUsdt, changePercent: null, source: "alpha-reference" },
              marketSnapshot?.pairs.btcUsdt ?? { key: "btcUsdt" as const, label: "BTC / USDT", price: 0, changePercent: null, source: "coinbase-spot" },
              marketSnapshot?.pairs.ethUsdt ?? { key: "ethUsdt" as const, label: "ETH / USDT", price: 0, changePercent: null, source: "coinbase-spot" },
            ];

            return (
              <div className="px-4 py-4 sm:px-5">
                <div className="flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
                  {marketCards.map((pair, index) => {
                    const positive = pair.changePercent !== null && pair.changePercent >= 0;
                    const spark = buildSparklinePath(pair.changePercent, index * 4 + 3);
                    return (
                      <article
                        key={pair.key}
                        className="min-w-[230px] snap-start rounded-2xl border border-[#C9A227]/20 bg-[linear-gradient(155deg,rgba(201,162,39,0.14),rgba(8,8,8,0.9)_42%,rgba(8,8,8,0.98))] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.35)] md:min-w-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-[#F4D87A]">{currencyText(pair.label)}</p>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${positive ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : "border-rose-500/35 bg-rose-500/10 text-rose-300"}`}>
                            {currencyText(formatMarketCardChange(pair.changePercent))}
                          </span>
                        </div>
                        <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{currencyText(formatMarketCardPrice(pair.key, pair.price))}</p>
                        <div className="mt-3 h-10 rounded-xl border border-white/10 bg-black/30 px-2 py-1">
                          <svg viewBox="0 0 100 32" className="h-full w-full" preserveAspectRatio="none" role="img" aria-label={marketTrendAriaLabel(pair.label, isAr)}>
                            <path d={spark} fill="none" stroke={positive ? "#34D399" : "#F87171"} strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-[#AEB5C0]">{currencyText(marketReferenceLabel(pair.reference, pair.source, isAr))}</p>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-[#9CA3AF] sm:px-5">
            <span>
              {isAr ? "آخر تحديث" : "Last update"}: {currencyText(formatIsraelMarketTime(marketSnapshot?.updatedAt, isAr))}
            </span>
            <span>{isAr ? "الحالة" : "Status"}: <span className={marketSnapshot?.status === "live" ? "text-emerald-300" : "text-amber-200"}>{marketSnapshot?.status === "live" ? (isAr ? "مباشر" : "LIVE") : (isAr ? "متدهور" : "Degraded")}</span></span>
          </div>
        </div>

        {isApprovedSeller && showSellerWorkspace ? (
          <SellerListingsWorkspacePortal
            {...{
              discordShareActionKey,
              discordSharing,
              editingListingId,
              handleDiscordListingShare,
              handleSellerListingDelete,
              handleSellerListingDuplicate,
              handleSellerListingEditSubmit,
              handleSellerListingRenew,
              handleSellerListingStatus,
              isAr,
              isListingActionBusy,
              isListingEditSubmitDisabled,
              isMobileViewport,
              isWorkspaceWidgetsLoading,
              listingActionKey,
              listingEditAmount,
              listingEditBankAccountMismatch,
              listingEditForm,
              listingEditGuardTone,
              listingEditNeedsReason,
              listingEditPriceInvalid,
              listingEditPriceValid,
              listingEditReasonValid,
              listingEditRequiresBank,
              listingEditRequiresBankAccount,
              listingEditSelectedBanks,
              listingEditSelectedMethods,
              listingEditTradeRangeInvalid,
              locale,
              marketPricePerUsdt,
              maxAllowedListingPrice,
              myListings,
              scrollToCreateListingSection,
              sellerBankAccounts,
              sellerBankAccountsLoading,
              sellerDashboardListingsTarget,
              sellerExpandedListingId,
              sellerListingsExpanded,
              sellerRequests,
              sellerWorkspaceMessage,
              sellerWorkspaceMessageFeedbackKey,
              setEditingListingId,
              setListingEditForm,
              setListingEditOriginal,
              setSellerExpandedListingId,
              setSellerListingsExpanded,
              shortListingRef,
              sortedDashboardListings,
              ISRAELI_BANKS,
              formatIls,
              listingChangeReasonLabel,
              listingStatusLabel,
              normalizeDecimalInput,
              normalizePaymentMethodList,
              paymentMethodEmoji,
              paymentMethodLabel,
              renderBankLogo,
              requiresBankSelection,
              toNumber,
              toggleSelection,
            }}
          />
        ) : null}

        {/* Recent completed trades — visible to all to signal activity */}
        {recentCompletedTrades.length ? (
          <Card className="mt-4 border-white/10 bg-[#0B0B0B]/90">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                {isAr ? "الصفقات المكتملة مؤخرًا" : "Recently Completed Trades"}
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {visibleRecentCompletedTrades.map((trade) => (
                  <div key={`recent-completed-${trade.id}`} className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <div>
                      <p className="font-medium text-white">{currencyText(shortTradeRef(trade, isAr))}</p>
                      <p className="mt-0.5">{currencyText(`${Math.trunc(toNumber(trade.usdtAmount)).toLocaleString("en-US")} USDT`)} • {currencyText(`${toNumber(trade.fiatAmount).toLocaleString("en-IL")} ${trade.currency}`)}</p>
                      <p className="mt-0.5 text-[#9CA3AF]">{new Date(trade.completedAt ?? trade.updatedAt).toLocaleString(isAr ? "ar-IL" : "en-IL", { timeZone: ISRAEL_TIME_ZONE })}</p>
                    </div>
                  </div>
                ))}
              </div>
              {recentCompletedTrades.length > 1 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  aria-expanded={showAllCompletedTrades}
                  onClick={() => setShowAllCompletedTrades((value) => !value)}
                >
                  {currencyText(showAllCompletedTrades
                    ? (isAr ? "عرض أقل" : "Show less")
                    : (isAr ? `عرض ${recentCompletedTrades.length - 1} صفقات إضافية` : `Show ${recentCompletedTrades.length - 1} more`))}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <div className="mt-5 flex items-center justify-end">
          <Button type="button" variant="secondary" onClick={() => setShowMarketplaceFilters((value) => !value)}>
            {showMarketplaceFilters ? (isAr ? "إخفاء الفلاتر" : "Hide Advanced Filters") : (isAr ? "فلاتر متقدمة" : "Advanced Filters")}
          </Button>
        </div>
        {showMarketplaceFilters ? (
          <Card className="mt-3 border-white/10 bg-[#0B0B0B]/90">
            <CardContent className="p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]">
                  <option value="all">{isAr ? "العملة: الكل" : "Currency: All"}</option>
                  {uniqueCurrencies.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
                <select value={paymentMethodFilter} onChange={(event) => setPaymentMethodFilter(event.target.value)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]">
                  <option value="all">{isAr ? "الدفع: الكل" : "Payment: All"}</option>
                  {uniquePaymentMethods.map((method) => (
                    <option key={method} value={method}>{paymentMethodLabel(method, isAr)}</option>
                  ))}
                </select>
                <select value={networkFilter} onChange={(event) => setNetworkFilter(event.target.value as "all" | SupportedNetwork)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]">
                  <option value="all">{isAr ? "الشبكة: الكل" : "Network: All"}</option>
                  <option value="TRC20">TRC20</option>
                  <option value="ERC20">ERC20</option>
                  <option value="BEP20">BEP20</option>
                  <option value="SOL">SOL</option>
                </select>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "trust-desc" | "price-asc" | "amount-desc" | "trades-desc" | "rating-desc" | "response-fast" | "newest")} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]">
                  <option value="trust-desc">{isAr ? "ترتيب: أفضل البائعين" : "Sort: Best Sellers"}</option>
                  <option value="price-asc">{isAr ? "الترتيب: أقل سعر" : "Sort: Lowest Price"}</option>
                  <option value="amount-desc">{isAr ? "الترتيب: أعلى كمية USDT" : "Sort: Highest Available USDT"}</option>
                  <option value="trades-desc">{isAr ? "الترتيب: أكثر صفقات مكتملة" : "Sort: Most Completed Trades"}</option>
                  <option value="rating-desc">{isAr ? "الترتيب: أعلى تقييم" : "Sort: Highest Rating"}</option>
                  <option value="response-fast">{isAr ? "الترتيب: أسرع استجابة" : "Sort: Fastest Response Time"}</option>
                  <option value="newest">{isAr ? "الترتيب: الأحدث" : "Sort: Newest Listing"}</option>
                </select>
                <Input className="currency-money" placeholder={isAr ? "أقل كمية USDT" : "Min USDT amount"} value={minAmountFilter} onChange={(event) => setMinAmountFilter(event.target.value)} />
                <Input className="currency-money" placeholder={isAr ? "أعلى كمية USDT" : "Max USDT amount"} value={maxAmountFilter} onChange={(event) => setMaxAmountFilter(event.target.value)} />
                <Input className="currency-money" placeholder={isAr ? "أقل سعر (₪)" : "Min price (₪)"} value={minPriceFilter} onChange={(event) => setMinPriceFilter(event.target.value)} />
                <Input className="currency-money" placeholder={isAr ? "أعلى سعر (₪)" : "Max price (₪)"} value={maxPriceFilter} onChange={(event) => setMaxPriceFilter(event.target.value)} />
                <Input placeholder={isAr ? "أقل درجة ثقة" : "Min trust score"} value={trustScoreFilter} onChange={(event) => setTrustScoreFilter(event.target.value)} />
                <Button type="button" variant={onlineOnlyFilter ? "default" : "secondary"} onClick={() => setOnlineOnlyFilter((prev) => !prev)}>
                  {onlineOnlyFilter ? (isAr ? "البائعون المتصلون فقط" : "Online Sellers Only") : (isAr ? "إظهار البائعين المتصلين فقط" : "Show Online Sellers Only")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div id="buyer-marketplace-listings" tabIndex={desktopBuyerNavigation ? -1 : undefined} className={cn("mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-2 min-[1440px]:grid-cols-3", desktopBuyerNavigation && "scroll-mt-24")}>
          {isLoadingListings
            ? Array.from({ length: 4 }).map((_, index) => (
                <Card key={`skeleton-${index}`} className="border-white/10 bg-[#0B0B0B]/90">
                  <CardContent className="space-y-3 p-6">
                    <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
                    <div className="h-10 w-full animate-pulse rounded-xl bg-white/10" />
                    <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
                    <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
                    <div className="h-10 w-28 animate-pulse rounded-full bg-white/10" />
                  </CardContent>
                </Card>
              ))
            : visibleListings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  isAr={isAr}
                  marketPricePerUsdt={marketPricePerUsdt}
                  isOwnerListing={listing.sellerProfile?.isOwner === true}
                  isOwnListing={Boolean((isApprovedSeller || isAdminSession) && sessionUser?.id === listing.sellerId)}
                  isBuying={false}
                  onOpen={openListingModal}
                  onManageListing={handleManageOwnedListing}
                />
              ))}
        </div>

        {!isLoadingListings && filteredListings.length === 0 ? (
          <Card className="mt-4 border-white/10 bg-[#0B0B0B]/90">
            <CardContent className="p-6 text-center">
              <p className="text-base font-medium text-white">
                {currencyText(isAr ? "لا توجد عروض USDT نشطة متاحة الآن." : "No active USDT listings are available right now.")}
              </p>
              <p className="mt-2 text-sm text-[#9CA3AF]">
                {isAr ? "يمكن للبائعين المعتمدين إنشاء عرض من لوحة البائع." : "Approved sellers can create a listing from their Seller Dashboard."}
              </p>
              {canAccessListingCreation ? (
                <Button type="button" className="mt-4" onClick={() => router.push("/dashboard/seller")}>
                  {isAr ? "إنشاء عرض" : "Create Listing"}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {!isLoadingListings && isMobileViewport && filteredListings.length > visibleListings.length ? (
          <div className="mt-4 flex justify-center">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMobileVisibleListingsCount((prev) => prev + MOBILE_MARKETPLACE_BATCH_SIZE)}
            >
              {isAr ? "عرض المزيد" : "Load More Listings"}
            </Button>
          </div>
        ) : null}
      </div>

      {showDeferredSections && !sessionUser && !isDashboardWorkspace ? (
      <div className="mt-12">
        <h2 className="text-2xl font-semibold md:text-3xl">{isAr ? "لماذا Alpha Exchange" : "Why Alpha Exchange"}</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="h-full border-white/10 bg-[#0B0B0B]/90 transition hover:-translate-y-0.5">
                <CardHeader>
                  <div className={`inline-flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 text-[#C9A227]">
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <CardTitle className="text-xl">{currencyText(feature.title)}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-7">{currencyText(feature.body)}</CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
      ) : null}

      {!isDashboardWorkspace && !showBuyerSellerApplicationUpFront ? sellerApplicationPanel : null}
      {isSellerWorkspaceUser && showSellerWorkspace ? (
<SellerWorkspaceSection
          {...{
            activityHistory,
            commissionAdvancedOpen,
            commissionCopied,
            commissionNetwork,
            commissionPayBusy,
            commissionPayMessage,
            commissionPayMessageFeedbackKey,
            commissionPayOpen,
            commissionPayableAmountDue,
            commissionPayerType,
            commissionQrDataUrl,
            commissionTotalAmountDue,
            commissionTxSignature,
            commissionWalletConfiguration,
            commissionWorkspaceAction,
            deferredSellerPanelsReady,
            evidenceUploading,
            groupedActivityHistory,
            handleCommissionPayNow,
            handleOpenTradeRoom,
            handlePrefetchTradeRoom,
            handleSellerListingCreateSubmit,
            handleSellerRequestAction,
            handleSubmitSellerResponse,
            isAr,
            isListingCreateSubmitDisabled,
            isMobileViewport,
            isWorkspaceWidgetsLoading,
            desktopNavigation: desktopSellerNavigation,
            purchaseRequestsState: desktopSellerNavigation ? purchaseRequestsState : "ready",
            onRetryPurchaseRequests: () => {
              setPurchaseRequestsState("loading");
              void refreshMyPurchaseRequests();
            },
            listingActionKey,
            listingBlockedByActiveLimit,
            listingBlockedByCommission,
            listingBlockedByMarketplaceEnforcement,
            listingCommissionAgreement,
            listingCreateAmount,
            listingCreateBankAccountMismatch,
            listingCreateForm,
            listingCreateGuardCardTone,
            listingCreateGuardTone,
            listingCreatePrice,
            listingCreatePriceInvalid,
            listingCreatePriceValid,
            listingCreateRequiresBank,
            listingCreateRequiresBankAccount,
            listingCreateResult,
            listingCreateSelectedBankAccount,
            listingCreateSelectedBanks,
            listingCreateSelectedMethods,
            listingCreateTotalIls,
            listingCreateTradeRangeInvalid,
            listingCreationBlocked,
            listingCreationBlockedReason,
            locale,
            marketInsightsCard,
            marketPricePerUsdt,
            marketSnapshot,
            maxAllowedListingPrice,
            myListingsById,
            openCommissionPayment,
            openMarketplaceCompliancePayment,
            renderNotificationCenterCard,
            requestActionKey,
            reviewPayableCommissions,
            scrollToMyListingsSection,
            selectedCommissionWallet,
            selectedCommissionWalletAvailable,
            selectedCommissionWalletError,
            sellerApplication,
            sellerBankAccounts,
            sellerBankAccountsLoading,
            sellerCommissionStatus,
            sellerDeferredPanelsSentinelRef,
            sellerEvidenceFiles,
            sellerExpandedTradeId,
            sellerOverviewStats,
            sellerRankSummary,
            sellerRankError,
            sellerPrimaryRequestsExpanded,
            sellerRequestSections,
            sellerRequests,
            sellerResponseDrafts,
            sellerSafetyAcknowledgements,
            sellerTradeQuery,
            sellerTradeStatus: visibleSellerTradeStatus,
            sellerWorkspaceMessage,
            sellerWorkspaceMessageFeedbackKey,
            sellerWorkspaceSummary,
            sessionUser,
            setCommissionAdvancedOpen,
            setCommissionCopied,
            setCommissionNetwork,
            setCommissionPayMessage,
            setCommissionPayOpen,
            setCommissionPayerType,
            setCommissionTxSignature,
            setListingCommissionAgreement,
            setListingCreateForm,
            setListingCreateResult,
            setSellerDashboardListingsTarget,
            setSellerEvidenceFiles,
            setSellerExpandedTradeId,
            setSellerPrimaryRequestsExpanded,
            setSellerResponseDrafts,
            setSellerSafetyAcknowledgements,
            setSellerTradeQuery,
            setSellerTradeStatus,
            setSellerWorkspaceMessage,
            sortedSellerRequests,
            uploadTradeEvidenceFile,
            ISRAELI_BANKS,
            CompactTradeTimeline,
            LocalizedEvidenceFileInput,
            formatIls,
            formatUsdt: formatCommissionUsdt,
            normalizeDecimalInput,
            renderBankLogo,
            shortListingRef,
            shortTradeRef,
            getTradeQueuePresentation,
            formatRelativeMinutesLabel,
            sellerLevelLabel,
            sellerBadgeLabel,
            requiresBankSelection,
            toggleSelection,
            paymentMethodLabel,
            paymentMethodEmoji,
            paymentMethodTradeInstruction,
            safeText,
            sellerAccountStatusLabel,
            spokenLanguageLabel,
            toNumber,
            tradeStatusLabel,
          }}
        />
      ) : isSellerWorkspaceUser ? (
        <div className="mt-8 md:hidden">
          <Card className="border-white/10 bg-[#0B0B0B]/90">
            <CardContent className="p-4">
              <div className="h-5 w-40 animate-pulse rounded bg-white/10" />
              <div className="mt-3 h-16 animate-pulse rounded-2xl bg-white/10" />
            </CardContent>
          </Card>
        </div>
      ) : (
<BuyerWorkspaceSection
          {...{
            activityHistory,
            archivedConfirmationTrade,
            buyerEvidenceFiles,
            buyerExpandedTradeId,
            buyerOverviewCard,
            buyerRequests,
            buyerTradeQuery,
            buyerTradeStatus: visibleBuyerTradeStatus,
            buyerTradeVisibleCount,
            desktopNavigation: desktopBuyerNavigation,
            purchaseRequestsState: desktopBuyerNavigation ? purchaseRequestsState : "ready",
            onRetryPurchaseRequests: () => {
              setPurchaseRequestsState("loading");
              void refreshMyPurchaseRequests();
            },
            onBrowseSellers: openBuyerMarketplace,
            evidenceUploading,
            filteredBuyerRequests,
            groupedActivityHistory,
            handleBuyerTradeStatus,
            handleOpenTradeRoom,
            handlePrefetchTradeRoom,
            handleSubmitBuyerReview,
            isAr,
            isMobileViewport,
            listingsById,
            locale,
            pendingBuyerReviewTrade,
            renderNotificationCenterCard,
            sessionUser,
            setBuyerEvidenceFiles,
            setBuyerExpandedTradeId,
            setBuyerTradeQuery,
            setBuyerTradeStatus,
            setBuyerTradeVisibleCount,
            setTradeReviewDrafts,
            sortedBuyerRequests,
            tradeReviewDrafts,
            uploadTradeEvidenceFile,
            BUYER_TRADE_HISTORY_SECTION_ID,
            CompactTradeTimeline,
            LocalizedEvidenceFileInput,
            canCancelBuyerHistoryRequest,
            getTradeQueuePresentation,
            paymentMethodEmoji,
            paymentMethodLabel,
            paymentMethodTradeInstruction,
            shortListingRef,
            shortTradeRef,
            toNumber,
            tradeStatusLabel,
          }}
        />
      )}

      {showDeepDeferredSections && !sessionUser && !isDashboardWorkspace ? (
      <div className="mt-12 grid gap-4 md:grid-cols-4">
        {[
          { value: `${todaysCompletedTrades.toLocaleString("en-IL")}`, labelAr: "صفقات مكتملة اليوم", label: "Completed Trades Today", icon: HandCoins },
          { value: `${marketplacePulse.verifiedSellers.toLocaleString("en-IL")}+`, labelAr: "بائعون موثقون", label: "Verified Sellers", icon: ShieldCheck },
          { value: `${Math.trunc(marketplacePulse.totalUsdtAvailable).toLocaleString("en-US")} USDT`, labelAr: "USDT متاح", label: "USDT Available", icon: WalletCards },
          { value: formatMeasuredResponseTime(marketplacePulse.averageResponseMinutes, isAr), labelAr: "متوسط الاستجابة", label: "Average Response", icon: Clock3 },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="border-white/10 bg-[#0B0B0B]/85 transition hover:-translate-y-0.5">
              <CardContent className="p-5 text-center">
                <div className="mx-auto mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 text-[#C9A227]">
                  <Icon className="h-4 w-4" />
                </div>
                <p className="text-xl font-semibold text-white">{currencyText(item.value)}</p>
                <p className="mt-1 text-sm text-[#9CA3AF]">{currencyText(isAr ? item.labelAr : item.label)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
      ) : null}

      {showDeepDeferredSections && !sessionUser && !isDashboardWorkspace ? (
      <div className="mt-12">
        <h2 className="text-2xl font-semibold md:text-3xl">{isAr ? "الأسئلة الشائعة" : "FAQ"}</h2>
        <div className="mt-5 space-y-3">
          {faqs.map((item) => (
            <details key={item.q} className="group rounded-2xl border border-white/10 bg-[#0B0B0B]/85 p-5 transition-colors hover:border-white/20">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-base font-medium text-white">
                {currencyText(item.q)}
                <CheckCircle2 className="h-4 w-4 text-[#C9A227] transition group-open:rotate-12" />
              </summary>
              <p className="mt-3 text-sm leading-7 text-[#9CA3AF]">{currencyText(item.a)}</p>
            </details>
          ))}
        </div>
      </div>
      ) : null}

      {showDeepDeferredSections && !sessionUser && !isDashboardWorkspace ? (
      <Card className="mt-12 overflow-hidden border-[#C9A227]/25 bg-[#0A0A0A]/95">
        <CardContent className="relative p-6 md:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_20%,rgba(201,162,39,0.16),transparent_42%),radial-gradient(circle_at_86%_78%,rgba(201,162,39,0.12),transparent_40%)]" />
          <div className={`relative z-10 ${isAr ? "md:text-right" : ""}`}>
            <h3 className="text-2xl font-semibold md:text-3xl">{currencyText(isAr ? "جاهز لتبادل USDT؟" : "Ready to Exchange USDT?")}</h3>
            <p className="mt-2 max-w-3xl text-[#D1D5DB]">
              {brandText(isAr
                ? "انضم إلى مجتمع Alpha Traders واستمتع بسوق احترافي يربط بين البائعين والمشترين عبر Alpha Exchange."
                : "Join the Alpha Traders community and experience a professional marketplace connecting buyers and sellers through Alpha Exchange.")}
            </p>
            <div className={`mt-5 flex flex-wrap gap-3 ${isAr ? "md:justify-end" : ""}`}>
              <a href="#marketplace">
                <Button>{isAr ? "ابدأ التداول" : "Start Trading"}</Button>
              </a>
              {WHATSAPP_URL ? <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                <Button variant="secondary" className="gap-2">
                  <MessageCircle className="h-4 w-4" />
                  {isAr ? "تواصل عبر واتساب" : "Contact on WhatsApp"}
                </Button>
              </a> : null}
            </div>
          </div>
        </CardContent>
      </Card>
      ) : null}

      <Portal>
      {removalListing ? (
          <div className="alpha-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={isAr ? "إزالة العرض" : "Remove listing"}
              className="alpha-modal-panel w-full max-w-md rounded-3xl border border-white/10 bg-[#0B0B0B]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{isAr ? "إزالة العرض" : "Remove listing"}</h3>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{currencyText(isAr ? "يتم تسجيل سبب الإزالة للشفافية." : `Removing ${shortListingRef(removalListing)} is recorded for marketplace accountability.`)}</p>
                </div>
                <button type="button" aria-label={isAr ? "إغلاق نافذة إزالة العرض" : "Close removal dialog"} onClick={() => setRemovalListing(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-[#D1D5DB] transition hover:border-[#C9A227] hover:text-[#C9A227]">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {removalError ? <ActionFeedback revealKey={removalErrorFeedbackKey} as="p" role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">{currencyText(removalError)}</ActionFeedback> : null}
                <div>
                  <label htmlFor="removal-reason" className="text-xs font-semibold uppercase tracking-[0.12em] text-[#FDE68A]">{isAr ? "السبب" : "Reason"} <span className="text-red-300">*</span></label>
                  <select
                    id="removal-reason"
                    className={cn(
                      "mt-1 flex h-11 w-full rounded-xl border bg-[#101010] px-3 py-2 text-sm text-white",
                      removalReason ? "border-emerald-500/60" : "border-red-500/70",
                    )}
                    value={removalReason}
                    onChange={(event) => setRemovalReason(event.target.value)}
                  >
                    <option value="">{isAr ? "اختر سبباً…" : "Select a reason…"}</option>
                    {LISTING_CHANGE_REASONS.map((reason) => (
                      <option key={reason} value={reason}>{listingChangeReasonLabel(reason, isAr)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="removal-explanation" className="text-xs font-semibold uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "الشرح" : "Explanation"} <span className="text-red-300">*</span></label>
                  <Textarea
                    id="removal-explanation"
                    aria-label={isAr ? "شرح سبب إزالة العرض" : "Removal explanation"}
                    placeholder={isAr ? "اشرح باختصار سبب إزالة هذا العرض" : "Briefly explain why you're removing this listing"}
                    value={removalExplanation}
                    onChange={(event) => setRemovalExplanation(event.target.value)}
                    className={cn("mt-1", removalExplanation.trim().length >= 5 ? "border-emerald-500/60" : "border-red-500/70")}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!validateListingChangeReason({ reason: removalReason, explanation: removalExplanation }).ok || listingActionKey === `${removalListing.id}:delete`}
                    data-feedback-submit
                    onClick={() => void confirmSellerListingRemoval()}
                  >
                    {listingActionKey === `${removalListing.id}:delete` ? (isAr ? "جارٍ الإزالة..." : "Removing...") : (isAr ? "إزالة العرض" : "Remove Listing")}
                  </Button>
                  <Button type="button" variant="secondary" className="w-full" onClick={() => setRemovalListing(null)}>{isAr ? "إلغاء" : "Cancel"}</Button>
                </div>
              </div>
            </div>
          </div>
      ) : null}
      </Portal>

      <Portal>
      {selectedListing ? (
        <PurchaseListingDialog
          locale={locale}
          listing={selectedListing}
          sellerProfileData={sellerProfileData}
          isSellerProfileLoading={isSellerProfileLoading}
          selectedAmount={selectedAmount}
          selectedPrice={selectedPrice}
          estimatedTradeValue={estimatedTradeValue}
          estimatedBuyerFee={estimatedBuyerFee}
          estimatedTotal={estimatedTotal}
          isOwnerViewer={isOwnerViewer}
          isOwnerProfileActionLoading={isOwnerProfileActionLoading}
          purchaseSubmitted={purchaseSubmitted}
          buyerInfo={buyerInfo}
          onBuyerDetailsChange={(details) => setBuyerInfo((prev) => ({ ...prev, ...details }))}
          selectedPaymentMethods={selectedListingPaymentMethods}
          selectedPaymentMethod={selectedListingPaymentMethod}
          buyerTradeAmount={buyerTradeAmount}
          selectedMinTrade={selectedMinTrade}
          selectedMaxTrade={selectedMaxTrade}
          buyerTradeAmountInvalid={buyerTradeAmountInvalid}
          buyerWalletValidationError={buyerWalletValidationError}
          buyerWalletInvalid={buyerWalletInvalid}
          priceMode={purchasePriceMode}
          offeredPrice={buyerOfferedPrice}
          minimumOfferedPrice={selectedOfferBounds?.minimumPrice ?? ""}
          offerPriceInvalid={Boolean(selectedOfferValidation && !selectedOfferValidation.ok)}
          offeredTradePrice={selectedTradePrice}
          requiresSafetyNotice={selectedListingRequiresSafetyNotice}
          safetyAcknowledged={faceToFaceSafetyAcknowledged}
          showVerificationCta={showVerificationCta}
          isRedirectingToVerification={isRedirectingToVerification}
          statusMessage={statusMessage}
          statusMessageFeedbackKey={statusMessageFeedbackKey}
          isSubmittingPurchase={isSubmittingPurchase}
          onClose={closeListingModal}
          onSubmit={handlePurchaseSubmit}
          onQuickBuy={() => void submitPurchaseRequest()}
          onPaymentMethodChange={(method) => {
            setSelectedPurchasePaymentMethod(method);
            setFaceToFaceSafetyAcknowledged(false);
            if (isCardlessAtmPaymentMethod(method)) {
              const price = purchasePriceMode === "buyer_offer" ? buyerOfferedPrice : selectedListing.price;
              setBuyerInfo((prev) => ({ ...prev, usdtAmount: calculateCardlessUsdtAmount(prev.cardlessIlsAmount, price, true) ?? "" }));
            }
          }}
          onBuyerAmountChange={(value) => setBuyerInfo((prev) => ({ ...prev, usdtAmount: normalizeTradeAmountInput(value) }))}
          onBuyerWalletChange={(value) => setBuyerInfo((prev) => ({ ...prev, receivingWalletAddress: value }))}
          onOfferedPriceChange={(value) => {
            const price = normalizePriceOfferInput(value);
            setBuyerOfferedPrice(price);
            const amount = calculateCardlessUsdtAmount(buyerInfo.cardlessIlsAmount, price, true);
            if (isCardlessAtmPaymentMethod(selectedListingPaymentMethod) && amount) setBuyerInfo((prev) => ({ ...prev, usdtAmount: amount }));
          }}
          onSafetyAcknowledgedChange={setFaceToFaceSafetyAcknowledged}
          onGoToVerification={goToVerificationGate}
          onOwnerSellerProfileState={(sellerId, state, successMessage) => {
            void handleOwnerSellerProfileState(sellerId, state, successMessage);
          }}
          onOwnerSuspendSeller={(sellerId) => {
            void handleOwnerSuspendSeller(sellerId);
          }}
          formatIls={formatIls}
          localizedAuditAction={localizedAuditAction}
          paymentMethodEmoji={paymentMethodEmoji}
          paymentMethodLabel={paymentMethodLabel}
          sellerLevelToneKey={sellerLevelToneKey}
          tradeStatusLabel={tradeStatusLabel}
        />
      ) : null}
      </Portal>
    </section>
  );
}
