"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, BadgePercent, BellRing, Building2, CheckCircle2, Check, ChevronDown, ChevronRight, Clock3, Copy, Edit3, HandCoins, Loader2, LockKeyhole, MessageCircle, Network, PauseCircle, PlayCircle, ShieldCheck, Sparkles, Star, Store, Trash2, TrendingUp, Trophy, Upload, Users, Wallet, WalletCards, X, Zap } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel, requiredFieldClasses } from "@/components/ui/field";
import { RoleBadge } from "@/components/ui/role-badge";
import { LogoutButton } from "@/components/auth/logout-button";
import { AlphaMarketCenterView } from "@/components/market/alpha-market-center";
import { useMarketFeed } from "@/components/market/use-market-feed";
import {
  DiscordShareAction,
  type DiscordListingSharingStatus,
} from "@/components/sections/usdt-exchange/discord-share-action";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { hasRole } from "@/lib/roles";
import { getSellerApplicationEligibility } from "@/lib/seller-application-eligibility";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { useAuthenticatedNotificationStream } from "@/components/notifications/use-authenticated-notification-stream";
import { sellerListingWorkspaceAnchor } from "@/lib/action-destinations";
import type { ClientSessionUser } from "@/lib/client-session-user";
import { getIsraeliBankDisplayName, MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS, parseIsraeliBankSelection, serializeIsraeliBankSelection } from "@/lib/israeli-banks";
import { MARKETPLACE_PAYMENT_METHODS, MAX_LISTING_PAYMENT_METHODS, isCardlessAtmPaymentMethod, isBankTransferPaymentMethod, normalizeMarketplacePaymentMethod, requiresIsraeliBankSelection, resolveListingPaymentMethods } from "@/lib/marketplace-payment-methods";
import { CLIENT_COMMISSION_WALLETS, COMMISSION_NETWORKS, type CommissionNetworkId, type CommissionWalletConfiguration } from "@/lib/commission-config";
import { appendLoginJourneyServerTimeline, appendLoginJourneyStep, finalizeLoginJourneyRedirectEnd, incrementLoginJourneyApiCall, isLoginJourneyTraceEnabled } from "@/lib/login-journey-trace";
import { formatBuyerId, formatListingId, formatSellerId, formatTradeId } from "@/lib/format-id";
import { replaceExchangeEntityIdsWithHints } from "@/lib/alpha-exchange-display";
import { prefetchTradeRoom } from "@/lib/trade-room-client";
import { getTradeRoomConversationDestination } from "@/lib/trade-room-notification-destination";
import { commissionPaymentDestination, getCommissionPaymentNotificationDestination } from "@/lib/commission-payment-destination";
import { getCommissionWorkspaceAction, sortDashboardActivityNewestFirst } from "@/lib/dashboard-workspace";
import { getExplicitNonTradeRoomNotificationDestination } from "@/lib/notification-action-destination";
import { normalizeTransactionHash } from "@/lib/tx-hash-utils";
import { getWalletAddressValidationError, normalizeWalletAddress } from "@/lib/wallet-address";
import { deriveListingCountdown, deriveSellerPresence } from "@/lib/seller-presence";
import { LISTING_CHANGE_REASONS, listingEditRequiresReason, validateListingChangeReason } from "@/lib/listing-change-reasons";
import { normalizePublicProfileUsername } from "@/lib/public-profile-username";
import { sortNotificationsNewestFirst } from "@/lib/notification-sort";
import { formatNotificationRelativeTime } from "@/lib/notification-time";
import { containsArabicText, localizeActivityCopy, localizeNotificationActionLabel, localizeNotificationCopy } from "@/lib/notification-localization";
import { calculateSellerMarketplaceInsights } from "@/lib/marketplace-insights";
import { cn } from "@/lib/utils";
import { SELLER_PRESTIGE_TIERS } from "@/lib/seller-prestige";
import { getOfficialOwnerWhatsAppUrl } from "@/lib/official-contact";
import { deriveBuyerRankSummary, type BuyerRankSummary } from "@/lib/buyer-rank";
import { navigateAfterSuccess, navigateOrRevealResult } from "@/lib/client-success-navigation";
import { ensurePayoutBankIsSupported, isPayoutBankSupported } from "@/lib/seller-listing-bank-selection";
import type { AlphaExchangeActivityLogEntry, AlphaExchangeNotification, AuditAction, ListingStatus, MarketplaceListing, NotificationCategory, PremiumSellerProfileData, PurchaseRequest, SellerApplication, SellerBadge, SellerLevel, SellerStatus, SupportedNetwork, TradeTimelineEntry } from "@/types/alpha-exchange";

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
const BUYER_TRADE_HISTORY_SECTION_ID = "my-trade-requests-section";

const ISRAELI_BANKS = [
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

const SELLER_APPLICATION_METHOD_OPTIONS = [
  { id: "USDT (ERC20 / Ethereum)", group: "Crypto", recommended: true },
  { id: "USDT (Polygon)", group: "Crypto", recommended: false },
  { id: "USDT (Solana SPL / Phantom)", group: "Crypto", recommended: false },
  { id: "Face-to-Face", group: "Fiat", recommended: false },
  { id: "Cardless Withdrawal", group: "Fiat", recommended: false },
  { id: "Bank Transfer", group: "Fiat", recommended: false },
] as const;

type SellerApplicationMethod = (typeof SELLER_APPLICATION_METHOD_OPTIONS)[number]["id"];

function sellerApplicationMethodLabel(method: SellerApplicationMethod, isAr: boolean) {
  if (!isAr) return method;
  if (method === "Face-to-Face") return "لقاء شخصي";
  if (method === "Cardless Withdrawal") return "سحب بلا بطاقة";
  if (method === "Bank Transfer") return "تحويل بنكي";
  return method;
}

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

type ListingCreateResult = {
  tone: "success" | "error";
  message: string;
};

type SellerCommissionStatus = {
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
  payableRecords?: Array<{
    commissionId: string;
    amountDue: number;
    dueAt?: string;
    relatedRequestId?: string;
    relatedTradeId?: string;
    relatedTradeDisplayNumber?: number;
  }>;
};

export type SessionUser = ClientSessionUser;

type FeatureCard = {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
};

type TimelineStep = {
  title: string;
  body: string;
};

type SellerBankAccount = {
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

function toNumber(value: string | number | null | undefined) {
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

function safeText(value: unknown, fallback = "—") {
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
  const labels: Record<TradeTimelineEntry["type"], string> = {
    request_submitted: "أرسل المشتري طلب الصفقة.",
    request_accepted: "وافق البائع على طلب الصفقة.",
    payment_sent: "أكد المشتري إرسال الدفعة.",
    seller_confirmed_funds: "أكد البائع استلام الدفعة.",
    usdt_release_started: "بدأت مرحلة إرسال USDT.",
    usdt_sent: "أكد البائع إرسال USDT.",
    trade_completed: "اكتملت الصفقة بنجاح.",
    trade_timed_out: "انتهت مهلة الصفقة.",
    trade_locked: "تم قفل الصفقة للمراجعة.",
    review_unlocked: "أصبح تقييم الصفقة متاحاً.",
    dispute_opened: "تم فتح نزاع على الصفقة.",
    commission_recorded: "تم تسجيل عمولة الصفقة.",
    commission_paid: "تم تأكيد دفع العمولة.",
    buyer_evidence_uploaded: "رفع المشتري إثبات الدفع.",
    seller_evidence_uploaded: "رفع البائع إثبات إرسال USDT.",
    request_declined: "رفض البائع طلب الصفقة.",
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
    timeZone: "Asia/Jerusalem",
  });
}

export function marketTrendAriaLabel(pairLabel: string, isAr: boolean) {
  return isAr
    ? `رسم بياني مصغّر لحركة سعر ${pairLabel}`
    : `${pairLabel} price trend chart`;
}

function CompactTradeTimeline({ events, isAr }: { events: TradeTimelineEntry[]; isAr: boolean }) {
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
          {new Date(event.createdAt).toLocaleTimeString(isAr ? "ar-IL-u-nu-latn" : "en-IL", { hour: "2-digit", minute: "2-digit" })}
        </span>
        {message}
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
            <span>{isAr ? `عرض ${olderEvents.length.toLocaleString("ar-IL-u-nu-latn")} تحديثات سابقة` : `Show ${olderEvents.length} earlier update${olderEvents.length === 1 ? "" : "s"}`}</span>
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-2 space-y-2 border-t border-white/10 pt-2">{olderEvents.map(renderEvent)}</div>
        </details>
      ) : null}
      <div className="space-y-2">{recentEvents.map(renderEvent)}</div>
    </div>
  );
}

function LocalizedEvidenceFileInput({
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
        {selectedFile?.name ?? (isAr ? "لم يتم اختيار ملف" : "No file selected")}
      </span>
    </div>
  );
}

function formatIls(value: number) {
  return `₪${value.toFixed(2)}`;
}

function formatUsdt(value: number) {
  return `${value.toFixed(2)} USDT`;
}

export function formatIsraelDateKey(value: string | number | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Jerusalem",
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
      timeZone: "Asia/Jerusalem",
    }).format(new Date(items[0]?.createdAt ?? `${dayKey}T12:00:00.000Z`)),
    items,
  }));
}

function formatIntegerForInput(value: string | number | null | undefined) {
  const raw = String(value ?? "").replace(/[^\d]/g, "");
  if (!raw) return "";
  return Number(raw).toLocaleString("en-IL");
}

function normalizeDecimalInput(value: string | number | null | undefined) {
  const raw = String(value ?? "").replace(/[^\d.]/g, "");
  const firstDot = raw.indexOf(".");
  if (firstDot === -1) return raw;
  return `${raw.slice(0, firstDot + 1)}${raw.slice(firstDot + 1).replace(/\./g, "")}`;
}

function renderBankLogo(bank: (typeof ISRAELI_BANKS)[number]) {
  const wordmark = (() => {
    if (bank.id === "hapoalim") return { top: "POALIM", bottom: "BANK" };
    if (bank.id === "leumi") return { top: "LEUMI", bottom: "BANK" };
    if (bank.id === "mizrahi-tefahot") return { top: "MIZRAHI", bottom: "TEFAHOT" };
    if (bank.id === "discount") return { top: "DISCOUNT", bottom: "BANK" };
    if (bank.id === "fibi") return { top: "FIBI", bottom: "FIRST INTL" };
    if (bank.id === "mercantile") return { top: "MERC", bottom: "BANK" };
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
        {wordmark.top}
      </text>
      <text x="16" y="36" fill={bank.accent} fontSize="7" fontWeight="700" fontFamily="Arial, sans-serif" letterSpacing="0.3">
        {wordmark.bottom}
      </text>
    </svg>
  );
}

function shortListingRef(listing: Pick<MarketplaceListing, "displayNumber" | "id">) {
  return formatListingId(listing.displayNumber, listing.id);
}

function shortTradeRef(request: Pick<PurchaseRequest, "displayNumber" | "tradeId" | "id">, isAr = false) {
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

function greetingByTime(isAr: boolean) {
  const hour = new Date().getHours();
  if (hour < 12) return isAr ? "صباح الخير" : "Good morning";
  if (hour < 18) return isAr ? "مساء الخير" : "Good afternoon";
  return isAr ? "مساء النور" : "Good evening";
}

function toWorkspaceDisplayId(user: SessionUser | null, isApprovedSeller: boolean) {
  if (!user) return "#AT-000000";
  if (isApprovedSeller) return formatSellerId(undefined, user.id);
  if (user.role === "admin" || user.role === "owner") return formatSellerId(undefined, user.id);
  return formatBuyerId(undefined, user.id);
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
    workspace: "تعذّر تحميل مساحة عمل البائع. حدّث الصفحة وحاول مرة أخرى.",
    review: "تعذّر إرسال التقييم الآن. حاول مرة أخرى.",
    evidence: "تعذّر رفع الإثبات الآن. حاول مرة أخرى.",
  } : {
    application: "We could not submit your application right now. Please try again.",
    purchase: "We could not submit your purchase request right now. Please try again.",
    listing: "We could not update your listing at the moment. Please try again.",
    request: "We could not update this request right now. Please try again.",
    settings: "We could not update your settings right now. Please try again.",
    password: "We could not update your password right now. Please try again.",
    workspace: "We could not load your seller workspace right now. Please refresh and try again.",
    review: "We could not submit the review right now. Please try again.",
    evidence: "We could not upload evidence right now. Please try again.",
  } satisfies Record<string, string>;
  return map[context];
}

function purchaseRequestErrorMessage(code: string, isAr: boolean, englishMessage: string) {
  if (!isAr) return englishMessage;
  if (code === "EMAIL_VERIFICATION_REQUIRED") return "يجب تأكيد البريد الإلكتروني قبل بدء صفقة.";
  if (code === "BUYER_ROLE_REQUIRED") return "يلزم تفعيل دور المشتري لبدء صفقة.";
  if (code === "RATE_LIMITED") return "أرسلت طلبات كثيرة خلال وقت قصير. حاول مرة أخرى بعد قليل.";
  if (code === "LISTING_ID_REQUIRED") return "تعذر تحديد العرض. أعد فتح العرض وحاول مرة أخرى.";
  if (code === "BUYER_NAME_REQUIRED") return "أكمل اسمك في الملف الشخصي قبل بدء صفقة.";
  if (code === "RECEIVING_WALLET_REQUIRED") return "عنوان محفظة استلام USDT مطلوب.";
  if (code === "RECEIVING_WALLET_INVALID") return "عنوان محفظة الاستلام غير صالح.";
  if (code === "TRADE_AMOUNT_REQUIRED") return "مبلغ الصفقة مطلوب.";
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

type TradeQueueSectionKey = "action" | "active" | "waiting" | "completed" | "cancelled";
type TradePerspective = "buyer" | "seller";

function getTradeQueuePresentation(request: PurchaseRequest, perspective: TradePerspective, isAr = false) {
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

function formatRelativeMinutesLabel(value?: string, isAr = false) {
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

function sellerLevelLabel(level?: SellerLevel, isAr = false) {
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
  const rank = String(level ?? "bronze");
  if (rank === "legendary") return "legendary";
  if (rank === "diamond") return "diamond";
  if (rank === "platinum") return "platinum";
  if (rank === "gold") return "gold";
  if (rank === "silver") return "silver";
  return "bronze";
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

function formatWholeNumber(value: number) {
  return Math.round(Math.max(0, value)).toLocaleString("en-IL");
}

function sellerBadgeLabel(badge: SellerBadge, isAr = false) {
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

function listingChangeReasonLabel(reason: string, isAr = false) {
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

function roleBadgeVariantFromSession(user: SessionUser) {
  if (user.role === "admin" && isAlphaExchangeOwnerEmail(user.email)) return "owner" as const;
  if (user.role === "admin") return "administrator" as const;
  if (hasRole(user, "approved_seller")) return "approved_seller" as const;
  return "buyer" as const;
}

function listingRequiresFaceToFaceSafetyNotice(method: string | null | undefined) {
  return normalizeMarketplacePaymentMethod(method) === "Face-to-Face (Meet in Person)";
}

function normalizePaymentMethodList(methods: string[] | undefined, fallback: string | undefined) {
  return resolveListingPaymentMethods(methods, fallback).slice(0, MAX_LISTING_PAYMENT_METHODS);
}

function requiresBankSelection(methods: string[] | undefined, fallback?: string) {
  return requiresIsraeliBankSelection(methods, fallback);
}

function selectedMethodUsesBanks(method: string | null | undefined) {
  return isBankTransferPaymentMethod(method) || isCardlessAtmPaymentMethod(method);
}

function toggleSelection(values: string[], nextValue: string, maxSelections: number) {
  const nextSet = new Set(values);
  if (nextSet.has(nextValue)) {
    if (nextSet.size === 1) return values;
    nextSet.delete(nextValue);
    return Array.from(nextSet);
  }
  if (nextSet.size >= maxSelections) return values;
  nextSet.add(nextValue);
  return Array.from(nextSet);
}

function paymentMethodLabel(method: string, isAr = false) {
  const normalized = normalizeMarketplacePaymentMethod(method) ?? method;
  if (isAr) {
    if (normalized === "Bank Transfer") return "تحويل بنكي";
    if (normalized === "Face-to-Face (Meet in Person)") return "لقاء شخصي";
    if (normalized === "Cardless ATM Withdrawal") return "سحب من الصراف بلا بطاقة";
  }
  return PAYMENT_METHOD_META[normalized]?.shortLabel ?? normalized;
}

function paymentMethodEmoji(method: string) {
  const normalized = normalizeMarketplacePaymentMethod(method) ?? method;
  return PAYMENT_METHOD_META[normalized]?.emoji ?? "💳";
}

function paymentMethodTradeInstruction(method: string, actor: "buyer" | "seller", isAr = false) {
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
    if (isAr) return "إرشادات اللقاء الشخصي: التقيا في مكان عام، واحمِ معلوماتك الخاصة، وتأكد من تحويل USDT قبل المغادرة.";
    return "Face-to-Face Safety: meet in a public place, protect private information, and confirm USDT transfer before leaving.";
  }
  if (normalized === "Cardless ATM Withdrawal") {
    if (isAr) return actor === "seller"
      ? "السحب من الصراف بلا بطاقة: أكّد العملية فقط بعد استلام النقد من الصراف."
      : "السحب من الصراف بلا بطاقة: حدّد «السحب جاهز» فقط بعد إنشاء رمز السحب من الصراف.";
    return actor === "seller"
      ? "Cardless ATM Withdrawal: confirm only after you collect cash from the ATM."
      : "Cardless ATM Withdrawal: mark Withdrawal Ready only after generating the ATM withdrawal code.";
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
  onOpen: (listing: MarketplaceListing) => void;
  onManageListing: (listing: MarketplaceListing) => void;
};

const ListingCard = memo(function ListingCard({ listing, isAr, marketPricePerUsdt, isOwnerListing, isOwnListing, isBuying, onOpen, onManageListing }: ListingCardProps) {
  const sellerLevel = listing.sellerReputation?.level;
  const sellerRankKey = sellerLevelToneKey(sellerLevel);
  const formattedAvailableAmount = toNumber(listing.availableAmount).toLocaleString("en-IL");
  const availableAmountClassName = availableAmountScaleClass(listing.availableAmount);
  const presence = deriveSellerPresence({
    onlineStatus: listing.sellerProfile?.onlineStatus,
    lastActiveAt: listing.sellerProfile?.lastActiveAt,
  });
  const sellerEmailVerified = listing.sellerProfile?.emailVerified === true;
  const sellerRankBorderColor: Record<string, string> = {
    bronze: "rgba(201,122,69,0.62)",
    silver: "rgba(194,205,220,0.68)",
    gold: "rgba(212,175,55,0.7)",
    platinum: "rgba(203,219,243,0.72)",
    diamond: "rgba(138,197,255,0.74)",
    legendary: "rgba(212,175,55,0.78)",
  };
  return (
    <Card
      id={`listing-${listing.id}`}
      className={cn(
        "group seller-listing-shell border-white/10 bg-[#0B0B0B]/90 transition duration-300",
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
        <div className="flex items-center gap-2 rounded-t-xl border-b border-red-500/20 bg-gradient-to-r from-red-950/60 via-red-900/30 to-transparent px-4 py-2">
          <Sparkles className="h-3.5 w-3.5 text-red-300" />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">{isAr ? "عرض رسمي من Alpha Exchange" : "Official Alpha Exchange Listing"}</span>
          <span className="ms-auto text-[11px] text-red-400/70">{isAr ? "يُباع مباشرةً من مالك المنصة" : "Sold directly by the platform owner"}</span>
        </div>
      ) : null}
      <CardHeader className="pb-3">
        <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
          <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
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
                  {safeText(listing.sellerDisplayName, isAr ? "بائع" : "Seller")
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </div>
              )}
            </div>
            <div>
              <div className={`flex flex-wrap items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                <CardTitle className={cn("text-lg seller-listing-seller-name", isOwnerListing ? "profile-identity-name--owner" : `seller-rank-name seller-rank-name--${sellerRankKey}`)}>{safeText(listing.sellerDisplayName, isAr ? "بائع" : "Seller")}</CardTitle>
                {isOwnerListing ? <RoleBadge variant="owner" locale={isAr ? "ar" : "en"} /> : null}
              </div>
              {isOwnerListing ? (
                <p className="mt-0.5 text-[12px] font-semibold text-[#F87171]">{isAr ? "مالك Alpha Exchange" : "Alpha Exchange Owner"}</p>
              ) : null}
              <p className="seller-listing-seller-subtitle mt-1 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">
                <span className={cn("seller-listing-rank-label", `seller-listing-rank-label--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
                  {isOwnerListing ? (isAr ? "المالك" : "Owner") : (isAr ? `بائع ${sellerLevelLabel(listing.sellerReputation?.level, true)}` : `${sellerLevelLabel(listing.sellerReputation?.level)} Seller`)}
                </span>
                <span className="seller-listing-status-separator"> • </span>
                <span className={cn("seller-listing-presence inline-flex items-center gap-1.5", `seller-presence--${presence.tone}`)}>
                  <span className={cn("seller-presence-dot", `seller-presence-dot--${presence.tone}`)} aria-hidden="true" />
                  {isAr ? presence.labelAr : presence.label}
                </span>
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#93C5FD]">{isAr ? "العرض" : "Listing"} {shortListingRef(listing)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <RoleBadge variant="approved_seller" locale={isAr ? "ar" : "en"} className={cn("seller-rank-badge", `seller-rank-badge--${sellerRankKey}`)} />
                <span className={cn("seller-rank-pill", `seller-rank-pill--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
                  {isOwnerListing ? (isAr ? "بائع أسطوري" : "Legendary Seller") : (isAr ? `بائع ${sellerLevelLabel(sellerLevel, true)}` : `${sellerLevelLabel(sellerLevel)} Seller`)}
                </span>
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
            </div>
          </div>
          <span className="flex flex-col items-end gap-1.5">
            <span className={cn("seller-listing-availability", `seller-listing-availability--${isOwnerListing ? "legendary" : sellerRankKey}`)}>{isAr ? "متاح" : "Available"}</span>
            <ListingCountdownBadge expiresAt={listing.expiresAt} isAr={isAr} />
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className={cn(
          "rounded-2xl border p-4 shadow-[0_14px_36px_rgba(0,0,0,0.35)] transition duration-300",
          isOwnerListing
            ? "border-emerald-500/35 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(5,5,5,0.88))] group-hover:border-emerald-400/55 group-hover:shadow-[0_18px_42px_rgba(16,185,129,0.25)]"
            : `seller-rank-accent seller-rank-accent--${sellerRankKey}`,
        )}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.18fr)_auto_minmax(0,1fr)] md:items-stretch">
            <div className="seller-asset-usdt-card seller-card-keymetric min-w-0 rounded-xl border p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                {isAr ? "USDT المتاح" : "Available USDT"}
              </p>
              <div className="seller-asset-usdt-amount-row">
                <div className="seller-asset-usdt-amount-content">
                  <span className="seller-asset-usdt-amount-icon inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 text-emerald-200">
                    ₮
                  </span>
                  <p className={cn("seller-asset-usdt-value text-[#D6FFE7]", availableAmountClassName)}>
                    {formattedAvailableAmount}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-sm font-medium text-emerald-100">USDT</p>
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/45 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                {isAr ? "جاهز للتداول" : "Ready to trade"}
              </span>
            </div>
            <div className={cn("mx-auto hidden w-px md:block", `seller-rank-separator seller-rank-separator--${isOwnerListing ? "legendary" : sellerRankKey}`)} />
            <div className={cn("mx-auto h-px w-full md:hidden", `seller-rank-separator seller-rank-separator--${isOwnerListing ? "legendary" : sellerRankKey}`)} />
            <div className={cn("rounded-xl border p-3 seller-rank-price seller-card-keymetric min-w-0", `seller-rank-price--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#D4AF37]">
                {isAr ? "سعر العرض" : "Listing Price"}
              </p>
              <p className="seller-price-value mt-2 text-4xl font-semibold leading-none text-[#6EE7B7] md:text-5xl">
                {toNumber(listing.price).toLocaleString("en-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#E5E7EB]">ILS / USDT</p>
              <div className="seller-live-market-panel mt-2 rounded-lg border p-2 text-[11px] text-[#CFCFCF]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "السوق الحالي" : "Current Market"}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[#D1D5DB]">USDT / ILS</p>
                  </div>
                  <span className="seller-live-market-badge">{isAr ? "مباشر" : "Live"}</span>
                </div>
                <p className="mt-2 text-base font-semibold text-white">
                  {marketPricePerUsdt.toLocaleString("en-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center text-xs">
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
            <p className="mt-1 break-words font-semibold leading-snug text-white">{isAr ? `${parseMinutes(listing.responseTime) || 5} دقائق` : safeText(listing.responseTime, "5 min")}</p>
            <p className="text-[11px] text-[#9CA3AF]">{isAr ? "الاستجابة" : "Response Time"}</p>
          </div>
          <div className={cn("rounded-xl border border-white/10 bg-black/25 p-3 text-[#D1D5DB] transition duration-300 hover:bg-black/35", `seller-rank-microcard seller-rank-microcard--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
            <ShieldCheck className="h-4 w-4 mx-auto text-[#93C5FD]" />
            <p className="mt-1 break-words font-semibold leading-snug text-white">{(listing.sellerReputation?.trustScore ?? 0).toFixed(1)}</p>
            <p className="text-[11px] text-[#9CA3AF]">{isAr ? "درجة الثقة" : "Trust Score"}</p>
          </div>
        </div>
        <div className="grid gap-3 text-xs text-[#9CA3AF] md:grid-cols-2">
          <div className="seller-card-info-panel min-w-0 space-y-1.5 rounded-xl border border-white/10 bg-black/25 p-3">
            <p>{isAr ? "آخر نشاط" : "Last active"}: <span className={cn("text-white", presence.tone === "online" && "text-emerald-300")}>{presence.online ? (isAr ? presence.labelAr : presence.label) : formatRelativeMinutesLabel(listing.sellerProfile?.lastActiveAt, isAr)}</span></p>
            <p>{isAr ? "الشبكة" : "Network"}: <span className="text-white">{safeText(listing.network)}</span></p>
            <div>
              <p>{isAr ? "الدفع" : "Payment"}:</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod).map((method) => (
                  <span key={`${listing.id}-${method}`} className="max-w-full break-words rounded-full border border-white/15 bg-white/[0.03] px-2 py-0.5 text-[11px] text-[#D1D5DB]">
                    {paymentMethodLabel(method, isAr)}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="seller-card-info-panel min-w-0 space-y-1.5 rounded-xl border border-white/10 bg-black/25 p-3">
            <p>{isAr ? "حدود الصفقة" : "Trade limits"}: <span className="text-white">{toNumber(listing.minimumTrade).toLocaleString("en-IL")} – {toNumber(listing.maximumTrade).toLocaleString("en-IL")} USDT</span></p>
            <p>
              {isAr ? "الضمان" : "Escrow"}:{" "}
              <span className="seller-escrow-emphasis">
                {isAr ? "مؤمّن عبر " : "Secured by "}
                <span className="seller-escrow-brand">Alpha Traders</span>
              </span>
            </p>
            <p>{isAr ? "المنطقة" : "Region"}: <span className="text-white">{safeText(listing.sellerProfile?.country, isAr ? "إسرائيل" : "Israel")}</span></p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Link
            href={`/exchange/seller/${normalizePublicProfileUsername(listing.sellerProfile?.publicTradingName || listing.sellerDisplayName)}`}
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
              disabled={isBuying}
              onClick={() => onOpen(listing)}
              aria-label={isAr ? `شراء USDT من ${safeText(listing.sellerDisplayName, "البائع")}` : `Buy USDT from ${safeText(listing.sellerDisplayName, "seller")}`}
            >
              <span className="inline-flex items-center gap-2">
                {isBuying ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                {isBuying ? (isAr ? "جارٍ بدء الصفقة..." : "Starting trade...") : (isAr ? "شراء USDT الآن" : "Buy USDT")}
              </span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
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
      {isAr ? countdown.labelAr : countdown.label}
    </span>
  );
});

// Renders children into document.body so fixed-position overlays escape any
// transformed ancestor (framer-motion) and center against the real viewport.
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
  const router = useRouter();
  const canonicalSession = useOptionalCanonicalSession();
  const refreshCanonicalSession = canonicalSession?.refresh;
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
  });
  const marketFeed = useMarketFeed({ refreshMs: 45_000 });
  const marketSnapshot = marketFeed.snapshot;

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(initialSessionUser ?? null);
  const [buyerProfileSummary, setBuyerProfileSummary] = useState<BuyerRankSummary | null>(null);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  // The server-backed session is authoritative for seller-application eligibility.
  // The initial value is only a bootstrap snapshot and can have stale roles.
  const [isSessionResolving, setIsSessionResolving] = useState(Boolean(canonicalSession));
  const [sessionResolutionError, setSessionResolutionError] = useState(false);
  const [isLoadingListings, setIsLoadingListings] = useState(true);
  const [isWorkspaceWidgetsLoading, setIsWorkspaceWidgetsLoading] = useState(true);
  const [isSellerApplicationLoading, setIsSellerApplicationLoading] = useState(true);
  const [notificationsInitialized, setNotificationsInitialized] = useState(false);
  const [deferredSellerPanelsReady, setDeferredSellerPanelsReady] = useState(false);
  const listingsLoadedAtRef = useRef<number>(Date.now());
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
  const [purchaseSubmitted, setPurchaseSubmitted] = useState(false);
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [sellerProfileData, setSellerProfileData] = useState<PremiumSellerProfileData | null>(null);
  const [isSellerProfileLoading, setIsSellerProfileLoading] = useState(false);
  const sellerProfileRequestIdRef = useRef(0);
  const sellerProfileAbortControllerRef = useRef<AbortController | null>(null);
  const [isOwnerProfileActionLoading, setIsOwnerProfileActionLoading] = useState(false);
  const [sellerApplication, setSellerApplication] = useState<SellerApplication | null>(null);
  const [myRequests, setMyRequests] = useState<PurchaseRequest[]>([]);
  const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);
  const [discordSharing, setDiscordSharing] = useState<DiscordListingSharingStatus | null>(null);
  const [discordShareActionKey, setDiscordShareActionKey] = useState<string | null>(null);
  const discordSharePollTimersRef = useRef<number[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showVerificationCta, setShowVerificationCta] = useState(false);
  const [isRedirectingToVerification, setIsRedirectingToVerification] = useState(false);
  const [sellerWorkspaceMessage, setSellerWorkspaceMessage] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [listingActionKey, setListingActionKey] = useState<string | null>(null);
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
  const [commissionNetwork, setCommissionNetwork] = useState<CommissionNetworkId>("ERC20");
  const [commissionTxSignature, setCommissionTxSignature] = useState("");
  const [commissionPayBusy, setCommissionPayBusy] = useState(false);
  const [commissionPayMessage, setCommissionPayMessage] = useState<string | null>(null);
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
    currency: "",
    network: "TRC20" as SupportedNetwork,
    paymentMethods: ["Bank Transfer"],
    bankAccountId: "",
    bankName: "",
    minimumTrade: "0",
    maximumTrade: "",
    sellerDescription: "",
  });
  const [sellerBankAccounts, setSellerBankAccounts] = useState<SellerBankAccount[]>([]);
  const [sellerBankAccountsLoading, setSellerBankAccountsLoading] = useState(false);
  const [listingCreateCurrencyManualOverride, setListingCreateCurrencyManualOverride] = useState(false);
  const [selectedPurchasePaymentMethod, setSelectedPurchasePaymentMethod] = useState<string>("Bank Transfer");

  useEffect(() => {
    if (isSessionResolving) {
      setSellerBankAccounts([]);
      setSellerBankAccountsLoading(false);
      return;
    }
    const canLoadBankAccounts = Boolean(sessionUser && (sessionUser.sellerStatus === "approved_seller" || sessionUser.role === "admin"));
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
    if (!sellerBankAccounts.length) return;
    const preferredBankAccount = sellerBankAccounts.find((account) => account.isDefault) ?? sellerBankAccounts[0];
    if (!preferredBankAccount) return;
    setListingCreateForm((prev) => {
      const selectedAccount = sellerBankAccounts.find((account) => account.id === prev.bankAccountId) ?? preferredBankAccount;
      const nextBanks = ensurePayoutBankIsSupported(
        parseIsraeliBankSelection(prev.bankName),
        selectedAccount.bankName,
        MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS,
      );
      const nextBankName = serializeIsraeliBankSelection(nextBanks);
      if (prev.bankAccountId === selectedAccount.id && prev.bankName === nextBankName) return prev;
      return { ...prev, bankAccountId: selectedAccount.id, bankName: nextBankName };
    });
    const preferredBankAccountId = preferredBankAccount.id;
    setListingEditForm((prev) => (prev.bankAccountId ? prev : { ...prev, bankAccountId: preferredBankAccountId }));
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
    updateListingSelectionQuery(null);
  }, [updateListingSelectionQuery]);

  // Escape closes the open Buy or removal dialog (keyboard accessibility).
  useEffect(() => {
    if (!selectedListing && !removalListing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (removalListing) setRemovalListing(null);
      else if (selectedListing) closeListingModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedListing, removalListing, closeListingModal]);

  const goToVerificationGate = useCallback(() => {
    setIsRedirectingToVerification(true);
    setStatusMessage(isAr ? "جارٍ الانتقال إلى التحقق..." : "Redirecting to verification...");
    router.push(`/verify-account?redirectTo=${encodeURIComponent(tradeReturnPath)}`);
  }, [isAr, router, tradeReturnPath]);
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
  const [buyerTradeStatus, setBuyerTradeStatus] = useState<"all" | PurchaseRequest["status"]>("all");
  const [sellerTradeQuery, setSellerTradeQuery] = useState("");
  const [sellerTradeStatus, setSellerTradeStatus] = useState<"all" | PurchaseRequest["status"]>("all");
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
  const [notificationPreferences, setNotificationPreferences] = useState<{ inApp: boolean; email: boolean; sms: boolean }>({ inApp: true, email: false, sms: false });
  const [mobileVisibleListingsCount, setMobileVisibleListingsCount] = useState(MOBILE_MARKETPLACE_BATCH_SIZE);
  const notificationsRequestIdRef = useRef(0);
  const deepLinkAppliedRef = useRef(false);
  const commissionPayDeepLinkHandledRef = useRef(false);
  const sellerActiveTradeRedirectedRef = useRef<string | null>(null);
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

  const [buyerInfo, setBuyerInfo] = useState({ usdtAmount: "", receivingWalletAddress: "" });
  const [sellerForm, setSellerForm] = useState(() => ({
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
  const isApprovedSellerSession = sellerStatusForLanding === "approved_seller";
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

  const refreshBuyerProfileSummary = useCallback(async () => {
    if (!sessionUser || isApprovedSellerSession) {
      setBuyerProfileSummary(null);
      return;
    }

    try {
      const response = await tracedFetch("Buyer profile summary loading", "/api/auth/profile", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        stats?: {
          kind?: string;
          activeTrades?: number;
          completedTrades?: number;
          reviewsGiven?: number;
        };
      };
      if (payload.stats?.kind !== "buyer") return;
      setBuyerProfileSummary(deriveBuyerRankSummary({
        activeTrades: Number(payload.stats.activeTrades ?? 0),
        completedTrades: Number(payload.stats.completedTrades ?? 0),
        reviewsGiven: Number(payload.stats.reviewsGiven ?? 0),
      }));
    } catch {
      // Preserve current state if the profile payload is temporarily unavailable.
    }
  }, [isApprovedSellerSession, sessionUser, tracedFetch]);

  useEffect(() => () => {
    for (const timer of discordSharePollTimersRef.current) window.clearTimeout(timer);
    discordSharePollTimersRef.current = [];
  }, []);

  const refreshMyPurchaseRequests = useCallback(async () => {
    try {
      const response = await tracedFetch(
        "Workspace data loading: purchase requests",
        "/api/alpha-exchange/purchase-requests",
        { cache: "no-store" },
      );
      if (!response.ok) return false;
      const payload = (await response.json()) as { requests?: PurchaseRequest[] };
      setMyRequests(payload.requests ?? []);
      return true;
    } catch {
      return false;
    }
  }, [tracedFetch]);

  const refreshSellerWorkspace = useCallback(async (options?: { commissionId?: string }) => {
    try {
      const commissionQuery = options?.commissionId?.trim()
        ? `?commissionId=${encodeURIComponent(options.commissionId.trim())}`
        : "";
      const [, myListingsRes, discordSharingRes] = await Promise.all([
        refreshMyPurchaseRequests(),
        tracedFetch("Workspace data loading: my listings", `/api/alpha-exchange/my-listings${commissionQuery}`, { cache: "no-store" }),
        tracedFetch("Workspace data loading: Discord sharing", "/api/alpha-exchange/discord-sharing", { cache: "no-store" }),
      ]);
      let refreshedCommissionStatus: SellerCommissionStatus | null = null;
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
        setMyListings((myListingsJson.listings ?? []).filter((listing) => listing.status !== "closed" && listing.status !== "cancelled"));
        setSellerWorkspaceSummary(myListingsJson.summary ?? null);
        setSellerCommissionStatus(myListingsJson.commissionStatus ?? null);
        refreshedCommissionStatus = myListingsJson.commissionStatus ?? null;
        setCommissionWalletConfiguration(myListingsJson.commissionWalletConfiguration ?? null);
        setQaCommissionModeEnabled(Boolean(myListingsJson.qaCommissionModeEnabled));
        setQaCommissionResetEnabled(Boolean(myListingsJson.qaCommissionResetEnabled));
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
      setWorkspaceError(null);
      return refreshedCommissionStatus;
    } catch {
      setWorkspaceError(safeErrorMessage("workspace", isAr));
      return null;
    }
  }, [isAr, refreshMyPurchaseRequests, tracedFetch]);

  const syncListingState = useCallback((listing: MarketplaceListing | null, options?: { remove?: boolean }) => {
    if (!listing) return;
    const shouldRemove = options?.remove === true || listing.status === "closed" || listing.status === "cancelled";
    const isPubliclyVisible = listing.status === "active" && listing.approvalStatus !== "pending" && listing.approvalStatus !== "rejected";
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

  const refreshDiscordSharingStatus = useCallback(async () => {
    const response = await tracedFetch(
      "Discord sharing status refresh",
      "/api/alpha-exchange/discord-sharing",
      { cache: "no-store" },
    );
    if (!response.ok) return;
    setDiscordSharing(await response.json() as DiscordListingSharingStatus);
  }, [tracedFetch]);

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
  }, []);

  const openCommissionPayment = useCallback((commissionId: string) => {
    const normalizedCommissionId = commissionId.trim();
    if (!normalizedCommissionId) {
      setSellerWorkspaceMessage(isAr ? "لم يتم العثور على سجل عمولة محدد قابل للدفع." : "No exact payable commission record was found.");
      return;
    }
    router.push(commissionPaymentDestination(normalizedCommissionId));
  }, [isAr, router]);

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
    if (typeof window === "undefined" || commissionPayDeepLinkHandledRef.current) return;
    if (new URLSearchParams(window.location.search).get("commission") !== "pay") return;

    // Do not decide commission eligibility from a bootstrap role or before the
    // canonical seller workspace response has supplied the payable record.
    if (isSessionResolving || isWorkspaceWidgetsLoading) return;

    if (!sessionUser || !isApprovedSellerSession) {
      commissionPayDeepLinkHandledRef.current = true;
      clearCommissionPayDeepLink();
      setSellerWorkspaceMessage(isAr ? "يلزم وجود مساحة عمل للبائع لدفع العمولة." : "A seller workspace is required to pay a commission.");
      return;
    }
    const requestedCommissionId = new URLSearchParams(window.location.search).get("commissionId")?.trim() || undefined;
    commissionPayDeepLinkHandledRef.current = true;
    // Historical generic `commission=pay` links do not identify a record. Do
    // not turn them into permission to pay whichever commission happens to be
    // first in the seller workspace; the seller must reopen an exact current
    // payment notification instead.
    if (!requestedCommissionId) {
      clearCommissionPayDeepLink();
      setSellerWorkspaceMessage(isAr ? "رابط الدفع هذا لا يحتوي على سجل العمولة. افتح تذكير عمولة حاليًا." : "This payment link is missing its commission record. Please open a current commission reminder.");
      return;
    }
    let cancelled = false;
    void (async () => {
      // The normal workspace response selects the oldest due record. A
      // commission deep link must instead revalidate its exact record on the
      // server and must never silently pay a different one.
      const commissionStatus = await refreshSellerWorkspace({ commissionId: requestedCommissionId });
      if (cancelled) return;
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
      window.requestAnimationFrame(() => {
        document.getElementById("commission-payment")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    clearCommissionPayDeepLink,
    isAr,
    isApprovedSellerSession,
    isSessionResolving,
    isWorkspaceWidgetsLoading,
    openCommissionPaymentPanel,
    refreshSellerWorkspace,
    sellerCommissionStatus,
    sessionUser,
  ]);

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
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20_000);
        try {
          response = await tracedFetch("Notifications loading", `/api/alpha-exchange/notifications?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          break;
        } catch {
          if (attempt === 2) throw new Error("failed");
        } finally {
          window.clearTimeout(timeout);
        }
      }
      if (!response) throw new Error("failed");
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
      setStatusMessage(safeErrorMessage("workspace", isAr));
    } finally {
      setNotificationsLoading(false);
    }
  }, [isAr, notificationCategory, notificationQuery, notificationUnreadOnly, sessionUser, tracedFetch]);

  const refreshNotificationPreferences = useCallback(async () => {
    try {
      const response = await tracedFetch("Workspace data loading: notification preferences", "/api/alpha-exchange/notification-preferences", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { preferences: { inApp: boolean; email: boolean; sms: boolean } };
      if (payload.preferences) setNotificationPreferences(payload.preferences);
    } catch {
      // Keep silent to preserve UX messaging style.
    }
  }, [tracedFetch]);

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
  }, [isAr, refreshNotifications]);

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
  }, [isAr, refreshNotifications]);

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
  }, [isAr, refreshNotifications]);

  async function handleNotificationPreferencesSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await fetch("/api/alpha-exchange/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationPreferences),
      });
      if (!response.ok) {
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("settings", isAr)));
        return;
      }
      setSellerWorkspaceMessage(isAr ? "تم تحديث تفضيلات الإشعارات." : "Notification preferences updated.");
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("settings", isAr));
    }
  }

  useEffect(() => {
    if (!canonicalSession) return;
    setIsSessionResolving(canonicalSession.isResolving);
    setSessionResolutionError(canonicalSession.error);
    if (!canonicalSession.isResolving) {
      setSessionUser(canonicalSession.user);
    }
  }, [canonicalSession]);

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
        const listingsPromise = tracedFetch("Dashboard data loading: listings", "/api/alpha-exchange/listings", { cache: "no-store", signal: controller.signal });
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
  }, [isAr, tracedFetch]);

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
            tracedFetch("Workspace data loading: seller application", "/api/alpha-exchange/seller-application", { cache: "no-store" }),
            isApprovedSellerSession ? refreshSellerWorkspace() : refreshMyPurchaseRequests(),
            refreshNotificationPreferences(),
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
  }, [isApprovedSellerSession, isAr, isSessionResolving, refreshMyPurchaseRequests, refreshNotificationPreferences, refreshSellerWorkspace, sessionUser, tracedFetch]);

  useEffect(() => {
    if (!isApprovedSellerSession || isSessionResolving || deferredSellerPanelsReady) return;
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
  }, [deferredSellerPanelsReady, isApprovedSellerSession, isSessionResolving]);

  useEffect(() => {
    if (!isApprovedSellerSession) {
      setDeferredSellerPanelsReady(false);
    }
  }, [isApprovedSellerSession]);

  useEffect(() => {
    if (!sessionUser || notificationsInitialized) return;
    if (isSessionResolving) return;
    setNotificationsInitialized(true);
  }, [isSessionResolving, notificationsInitialized, sessionUser]);

  useEffect(() => {
    if (!sessionUser || isApprovedSellerSession) return;
    void refreshBuyerProfileSummary();
  }, [isApprovedSellerSession, myRequests, refreshBuyerProfileSummary, sessionUser]);

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
    } catch {
      // Keep stream updates best-effort and preserve current UI state on malformed payloads.
    }
  }, []);
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
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }, []);

  const scrollToMyListingsSection = useCallback(() => {
    if (typeof document === "undefined") return false;
    const target = document.getElementById("my-listings-section");
    if (!target) return false;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById("my-listings-section")?.focus({ preventScroll: true });
      });
    });
    return true;
  }, []);

  const scrollToBuyerTradeHistorySection = useCallback(() => {
    if (typeof document === "undefined") return false;
    const target = document.getElementById(BUYER_TRADE_HISTORY_SECTION_ID);
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
    return true;
  }, []);

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
  }, [isAr]);

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
    setSelectedPurchasePaymentMethod(normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod)[0] ?? "Bank Transfer");
    setSellerProfileData(null);
    setPurchaseSubmitted(false);
    setShowVerificationCta(false);
    setIsRedirectingToVerification(false);
    setFaceToFaceSafetyAcknowledged(false);
    setBuyerInfo((prev) => ({
      ...prev,
      usdtAmount: formatIntegerForInput(listing.minimumTrade || listing.availableAmount),
      receivingWalletAddress: "",
    }));
  }, [isAr, isLoadingListings, listings, selectedListing, sessionUser, updateListingSelectionQuery]);

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
  }, [isAr, qaCommissionModeEnabled, qaCommissionResetEnabled, refreshSellerWorkspace, sellerCommissionStatus]);

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

  const timelineSteps = useMemo<TimelineStep[]>(() => [
    {
      title: isAr ? "المشتري يرسل طلب الصفقة" : "Buyer submits trade request",
      body: isAr ? "يتم تسجيل طلب الصفقة فور الإرسال ضمن سجل زمني دائم." : "The request is recorded as a permanent timeline event immediately.",
    },
    {
      title: isAr ? "البائع يقبل الطلب" : "Seller accepts request and creates trade",
      body: isAr ? "يبقى Trade ID ثابتًا من لحظة الطلب وحتى إكمال الصفقة." : "The Trade ID stays fixed from the moment the request is created through trade completion.",
    },
    {
      title: isAr ? "المشتري يحدد Payment Sent" : "Buyer marks Payment Sent",
      body: isAr ? "يتم تحديث الحالة زمنيًا لبدء مرحلة التسليم." : "Timeline updates to payment-sent stage for delivery handoff.",
    },
    {
      title: isAr ? "البائع يحدد USDT Sent" : "Seller marks USDT Sent",
      body: isAr ? "يتم تسجيل إرسال USDT وتنتظر الصفقة تأكيد المشتري." : "USDT-sent step is logged and waits for buyer confirmation.",
    },
    {
      title: isAr ? "المشتري يؤكد الإتمام" : "Buyer confirms completion",
      body: isAr ? "تُقفل الصفقة تلقائيًا ثم تُفتح نافذة المراجعة." : "Trade auto-locks and review window opens after completion.",
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
      const onlinePass = !onlineOnlyFilter || listing.sellerProfile?.onlineStatus === "online";
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
  }, [listings, networkFilter, currencyFilter, paymentMethodFilter, minAmountFilter, maxAmountFilter, minPriceFilter, maxPriceFilter, trustScoreFilter, onlineOnlyFilter, sortBy]);

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
    if (!sessionUser) {
      router.push(`/login?redirectTo=${encodeURIComponent(tradeReturnPath)}`);
      return false;
    }
    return true;
  }, [sessionUser, router, tradeReturnPath]);

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

  const openListingModal = useCallback((listing: MarketplaceListing) => {
    if (!requireAuth()) return;
    const supportedMethods = normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod);
    setSelectedListing(listing);
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
      usdtAmount: formatIntegerForInput(listing.minimumTrade || listing.availableAmount),
      receivingWalletAddress: "",
    }));
  }, [requireAuth, updateListingSelectionQuery]);

  const handleManageOwnedListing = useCallback((listing: MarketplaceListing) => {
    if (!requireAuth()) return;
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
    router.push("/dashboard/seller#my-listings-section");
    setStatusMessage(isAr ? `أدر عرضك من لوحة البائع (${shortListingRef(listing)}).` : `Manage your listing in Seller Dashboard (${shortListingRef(listing)}).`);
  }, [isAr, isSellerDashboardWorkspace, requireAuth, router, scrollToMyListingsSection]);

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
        window.dispatchEvent(new Event("alpha-auth-changed"));
      }
    } catch {
      setStatusMessage(fallbackMessage);
    }
  }

  async function submitPurchaseRequest() {
    if (!selectedListing) return;
    if (isSubmittingPurchase) return;
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
    const maxTrade = toNumber(selectedListing.maximumTrade || selectedListing.availableAmount);
    if (requestedAmount < minTrade || requestedAmount > maxTrade) {
      setStatusMessage(isAr
        ? `يجب أن يكون مبلغ الصفقة بين ${minTrade.toLocaleString("en-IL")} و${maxTrade.toLocaleString("en-IL")} USDT.`
        : `Trade amount must be between ${minTrade.toLocaleString("en-IL")} and ${maxTrade.toLocaleString("en-IL")} USDT.`);
      return;
    }
    const walletValidationError = getWalletAddressValidationError(selectedListing.network, buyerInfo.receivingWalletAddress);
    if (walletValidationError) {
      setStatusMessage(localizeWalletValidationError(walletValidationError, selectedListing.network, isAr));
      return;
    }
    const fallbackMessage = isAr
      ? "تعذر بدء الصفقة بسبب خطأ غير متوقع. حاول مرة أخرى."
      : "We could not start this trade due to an unexpected server error.";
    setIsSubmittingPurchase(true);
    try {
      const response = await fetch("/api/alpha-exchange/purchase-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: selectedListing.id,
          usdtAmount: tradeAmount,
          buyerReceivingWalletAddress: normalizeWalletAddress(buyerInfo.receivingWalletAddress),
          paymentMethod: selectedListingPaymentMethod ?? undefined,
          safetyAcknowledged: faceToFaceSafetyAcknowledged,
        }),
      });
      if (!response.ok) {
        const requestId = response.headers.get("x-request-id");
        if (requestId) {
          console.warn("[alpha-exchange] purchase request rejected", { requestId, listingId: selectedListing.id });
        }
        let errorMessage = fallbackMessage;
        let errorCode = "";
        let errorDetails: Record<string, unknown> = {};
        try {
          const payload = (await response.json()) as { error?: unknown; message?: unknown; code?: unknown; details?: unknown };
          if (typeof payload.error === "string" && payload.error.trim()) errorMessage = payload.error;
          else if (typeof payload.message === "string" && payload.message.trim()) errorMessage = payload.message;
          if (typeof payload.code === "string" && payload.code.trim()) errorCode = payload.code;
          if (payload.details && typeof payload.details === "object") errorDetails = payload.details as Record<string, unknown>;
        } catch {
          const fallbackText = (await response.text()).trim();
          if (fallbackText && !/^<!doctype html>/i.test(fallbackText)) errorMessage = fallbackText;
        }
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
        if (errorCode === "PENDING_BUYER_FEEDBACK" && blockingId) {
          closeListingModal();
          router.push(`/trade-room/${blockingId}`);
          return;
        }
        setStatusMessage(purchaseRequestErrorMessage(errorCode, isAr, errorMessage));
        return;
      }
      const data = (await response.json()) as { purchase?: PurchaseRequest; destination?: string };
      if (data.purchase) {
        setMyRequests((prev) => [data.purchase as PurchaseRequest, ...prev]);
        setPurchaseSubmitted(true);
        setShowVerificationCta(false);
        setIsRedirectingToVerification(false);
        setStatusMessage(null);
        closeListingModal();
        navigateAfterSuccess(router, data.destination);
      }
    } catch (error) {
      const message = isAr
        ? "تعذر الاتصال بالخادم الآن. تحقق من اتصالك وحاول مرة أخرى."
        : (error instanceof Error && error.message.trim()
          ? error.message
          : "Unable to reach the server right now. Check your connection and try again.");
      setStatusMessage(message);
    } finally {
      setIsSubmittingPurchase(false);
    }
  }

  async function handlePurchaseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPurchaseRequest();
  }

  const selectedAmount = selectedListing ? toNumber(selectedListing.availableAmount) : 0;
  const selectedPrice = selectedListing ? toNumber(selectedListing.price) : 0;
  const commission = selectedAmount * selectedPrice * 0.01;
  const estimatedTotal = selectedAmount * selectedPrice + commission;

  const isApprovedSeller = isApprovedSellerSession;
  const hasBuyerRole = Boolean(sessionUser && hasRole(sessionUser, "buyer"));
  const sellerApplicationEligibility = getSellerApplicationEligibility({ isCanonicalUserLoading: isSessionResolving, canonicalUserError: sessionResolutionError, canonicalUser: sessionUser, application: sellerApplication, applicationSubmitted });
  const canAccessListingCreation = isApprovedSeller || isAdminSession;
  const isOwnerViewer = sessionUser?.role === "admin" && isAlphaExchangeOwnerEmail(sessionUser.email);
  const archivedConfirmationTrade = !isApprovedSeller
    ? myRequests.find((r) => r.status === "usdt_sent" && r.buyerConfirmationArchivedAt)
    : undefined;
  const pendingBuyerReviewTrade = !isApprovedSeller
    ? myRequests.find((r) => r.status === "review_open" && !r.buyerReview)
    : undefined;
  useEffect(() => {
    if (!sessionUser) return;
    if (typeof window === "undefined") return;
    if (!/^\/(ar|en)\/dashboard\/seller\/?$/.test(window.location.pathname)) return;
    const canAccessSellerDashboard = isApprovedSeller || sessionUser.role === "admin" || sessionUser.role === "owner";
    if (!canAccessSellerDashboard) {
      router.replace("/dashboard");
    }
  }, [isApprovedSeller, router, sessionUser]);

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
  const listingCreateRequiresBankAccount = listingCreateRequiresBank;
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
  const listingCreateCurrencyValue = Number.isFinite(listingCreateTotalIls) ? Math.round(listingCreateTotalIls) : 0;
  const listingCreationBlocked = Boolean(sellerWorkspaceSummary && !sellerWorkspaceSummary.canCreateListing);
  const listingCreationBlockedReason = sellerWorkspaceSummary?.blockedReason
    ?? (isAr ? "إنشاء العروض متوقف حالياً. راجع العروض النشطة أو العمولة أو حالة الامتثال." : "Listing creation is currently blocked.");
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
  useEffect(() => {
    const canAutoPopulate = listingCreateAmount > 0 && listingCreatePrice > 0 && !listingCreatePriceInvalid;
    if (!canAutoPopulate) {
      setListingCreateForm((prev) => (prev.currency === "" ? prev : { ...prev, currency: "" }));
      setListingCreateCurrencyManualOverride(false);
      return;
    }
    if (listingCreateCurrencyManualOverride) return;
    const nextValue = formatWholeNumber(listingCreateCurrencyValue);
    setListingCreateForm((prev) => (prev.currency === nextValue ? prev : { ...prev, currency: nextValue }));
  }, [listingCreateAmount, listingCreateCurrencyManualOverride, listingCreateCurrencyValue, listingCreatePrice, listingCreatePriceInvalid]);
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
  const listingEditRequiresBankAccount = listingEditRequiresBank;
  const listingEditMissingRequired = !listingEditAmount
    || !listingEditPrice
    || !listingEditSelectedMethods.length
    || (listingEditRequiresBank && !listingEditSelectedBanks.length)
    || (listingEditRequiresBankAccount && !listingEditForm.bankAccountId);
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
  const selectedMaxTrade = selectedListing ? toNumber(selectedListing.maximumTrade || selectedListing.availableAmount) : 0;
  const buyerTradeAmountInvalid = !!selectedListing && (buyerTradeAmount < selectedMinTrade || buyerTradeAmount > selectedMaxTrade);
  const buyerWalletValidationError = selectedListing
    ? localizeWalletValidationError(getWalletAddressValidationError(selectedListing.network, buyerInfo.receivingWalletAddress), selectedListing.network, isAr)
    : null;
  const buyerWalletInvalid = buyerWalletValidationError !== null;
  const selectedListingPaymentMethods = selectedListing ? normalizePaymentMethodList(selectedListing.paymentMethods, selectedListing.paymentMethod) : [];
  const selectedListingPaymentMethod = normalizeMarketplacePaymentMethod(selectedPurchasePaymentMethod) ?? selectedListingPaymentMethods[0] ?? null;
  const selectedListingRequiresSafetyNotice = listingRequiresFaceToFaceSafetyNotice(selectedListingPaymentMethod);
  const todayDateKey = useMemo(() => formatIsraelDateKey(new Date()), []);

  const sellerRequests = useMemo(() => myRequests.filter((request) => request.sellerId === sessionUser?.id), [myRequests, sessionUser?.id]);
  const buyerRequests = useMemo(() => myRequests.filter((request) => request.buyerId === sessionUser?.id), [myRequests, sessionUser?.id]);
  const showSellerWorkspace = !isMobileViewport || showDeepDeferredSections;
  const filteredBuyerRequests = useMemo(() => {
    return buyerRequests.filter((request) => {
      if (buyerTradeStatus !== "all" && request.status !== buyerTradeStatus) return false;
      const query = buyerTradeQuery.trim().toLowerCase();
      if (!query) return true;
      const haystack = `${request.tradeId ?? request.id} ${request.listingId} ${request.buyerName} ${request.sellerId}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [buyerRequests, buyerTradeQuery, buyerTradeStatus]);
  const filteredSellerRequests = useMemo(() => {
    return sellerRequests.filter((request) => {
      if (sellerTradeStatus !== "all" && request.status !== sellerTradeStatus) return false;
      const query = sellerTradeQuery.trim().toLowerCase();
      if (!query) return true;
      const haystack = `${request.tradeId ?? request.id} ${request.buyerName} ${request.listingId}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [sellerRequests, sellerTradeQuery, sellerTradeStatus]);
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
    prefetchTradeRoom(router, requestId);
  }, [router]);
  const handleOpenTradeRoom = useCallback((requestId: string) => {
    prefetchTradeRoom(router, requestId);
    router.push(`/trade-room/${requestId}`);
  }, [router]);
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
  const sellerCurrentRank = sellerOverviewStats.reputation?.level ?? "bronze";
  const sellerCurrentTier = SELLER_PRESTIGE_TIERS.find((tier) => tier.rank === sellerCurrentRank) ?? SELLER_PRESTIGE_TIERS[0];
  const sellerNextTier = SELLER_PRESTIGE_TIERS.find((tier) => tier.minVolumeUsdt > sellerCurrentTier.minVolumeUsdt);
  const sellerCompletedVolumeUsdt = Math.max(
    0,
    sellerOverviewStats.reputation?.lifetimeCompletedVolumeUsdt
      ?? sellerOverviewStats.reputation?.prestigeVolumeUsdt
      ?? sellerOverviewStats.reputation?.totalUsdtVolume
      ?? sellerOverviewStats.totalUsdtSold,
  );
  const sellerRequiredVolumeUsdt = sellerNextTier?.minVolumeUsdt ?? sellerCompletedVolumeUsdt;
  const sellerRemainingVolumeUsdt = sellerNextTier ? Math.max(0, sellerRequiredVolumeUsdt - sellerCompletedVolumeUsdt) : 0;
  const sellerLevelProgressPercent = sellerNextTier
    ? Math.min(
      100,
      Math.max(
        0,
        ((sellerCompletedVolumeUsdt - sellerCurrentTier.minVolumeUsdt) / Math.max(1, sellerNextTier.minVolumeUsdt - sellerCurrentTier.minVolumeUsdt)) * 100,
      ),
    )
    : 100;

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
  }, [buyerTradeQuery, buyerTradeStatus, isMobileViewport, sessionUser?.id]);

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
        .filter((listing) => listing.sellerProfile?.onlineStatus === "online")
        .map((listing) => listing.sellerId),
    );
    const totalUsdtAvailable = sourceListings.reduce((sum, listing) => sum + toNumber(listing.availableAmount), 0);
    const responseMinutes = sourceListings
      .map((listing) => parseMinutes(listing.responseTime))
      .filter((value) => value > 0);
    const averageResponseMinutes = responseMinutes.length
      ? Math.max(1, Math.round(responseMinutes.reduce((sum, value) => sum + value, 0) / responseMinutes.length))
      : 5;
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
  }, [filteredListings, isAr, listings]);

  const greetingLabel = greetingByTime(isAr);
  const workspaceDisplayId = toWorkspaceDisplayId(sessionUser, isApprovedSeller);
  const workspacePrimaryName = safeText(sessionUser?.fullName, isAr ? "المتداول" : "Trader").split(" ")[0] || (isAr ? "المتداول" : "Trader");
  const workspacePositiveMessage = isApprovedSeller
    ? (isAr ? "كل شيء تحت سيطرتك. عروضك وصفقاتك وتنبيهاتك جاهزة." : "You are in control. Your listings, trades, and alerts are ready.")
    : (isAr ? "مساحة عملك جاهزة. راقب نشاطك أولاً، ثم انتقل إلى السوق." : "Your workspace is ready. Track activity first, then jump into the marketplace.");

  const openTradeCount = isApprovedSeller
    ? sellerRequests.filter((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status)).length
    : buyerRequests.filter((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status)).length;
  const totalBuyerRequests = buyerRequests.length;
  const unreadNotificationsTotal = notificationUnreadCount ?? notifications.filter((item) => !item.isRead).length;
  const latestOpenBuyerTrade = recentBuyerRequests.find((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status));
  const latestOpenSellerTrade = recentSellerRequests.find((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status));
  const latestSellerInProgressTrade = recentSellerRequests.find((request) => ["accepted", "payment_sent", "funds_received", "usdt_release_pending"].includes(request.status));
  useEffect(() => {
    if (!sessionUser || !isApprovedSeller) return;
    if (typeof window === "undefined") return;
    if (!window.location.pathname.endsWith("/usdt-exchange")) return;
    // An explicit commission deep link must win over the convenience redirect
    // to an unrelated active trade. The commission flow clears its query only
    // after canonical seller status reaches a terminal state, then retains the
    // handled ref for this page instance.
    if (
      new URLSearchParams(window.location.search).get("commission") === "pay"
      || commissionPayDeepLinkHandledRef.current
    ) return;
    const tradeId = latestSellerInProgressTrade?.id;
    if (!tradeId) {
      sellerActiveTradeRedirectedRef.current = null;
      return;
    }
    if (sellerActiveTradeRedirectedRef.current === tradeId) return;
    sellerActiveTradeRedirectedRef.current = tradeId;
    handleOpenTradeRoom(tradeId);
  }, [handleOpenTradeRoom, isApprovedSeller, latestSellerInProgressTrade?.id, sessionUser]);
  const commissionWorkspaceAction = getCommissionWorkspaceAction(sellerCommissionStatus);
  const standardCommissionDueActive = isApprovedSeller && commissionWorkspaceAction.kind !== "none";
  const marketplaceComplianceActive = Boolean(sellerWorkspaceSummary?.enforcement?.restricted);
  const workspaceIdentityName = isAr ? `السيد/السيدة ${workspacePrimaryName}` : `Mr./Mrs. ${workspacePrimaryName}`;
  type AttentionItem = {
    title: string;
    body: string;
    action: string;
    onClick: () => void;
  };
  const isAttentionItem = (item: AttentionItem | null): item is AttentionItem => item !== null;
  const urgentSellerListing = isApprovedSeller
    ? myListings.find((listing) => {
        const countdown = deriveListingCountdown(listing.expiresAt, Date.now());
        return countdown.visible && countdown.tier === "urgent";
      })
    : null;
  const needsAttentionItems: AttentionItem[] = isApprovedSeller
    ? [
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
                : (isAr ? "ادفع العمولة الحالية لتبقى إجراءات العروض متاحة." : "Pay the current commission to keep listing actions available."),
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
    && !isApprovedSeller
    && hasBuyerRole
    && sellerApplication?.status !== "pending"
    && !applicationSubmitted,
  );

  const workspaceCards: Array<{
    key: string;
    title: string;
    subtitle: string;
    stat: string;
    onClick: () => void;
    icon: typeof Trophy;
    tone?: "gold" | "blue" | "green" | "amber";
  }> = isApprovedSeller
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
        subtitle: isAr
          ? `${openTradeCount.toLocaleString("en-IL")} من الصفقات النشطة`
          : `${openTradeCount.toLocaleString("en-IL")} active trade${openTradeCount === 1 ? "" : "s"}`,
        stat: `${sellerRequests.length.toLocaleString("en-IL")}`,
        onClick: () => {
          const target = document.getElementById("purchase-requests-section");
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
            return;
          }
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
        title: isAr ? "سوق اليوم" : "Today's Market",
        subtitle: isAr ? "تفاصيل السوق" : "Market Details",
        stat: formatIls(marketPricePerUsdt),
          onClick: () => {
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
        key: "public-profile",
        title: isAr ? "الملف العام" : "Public Profile",
        subtitle: isAr ? "عرض ملف البائع" : "View seller profile",
        stat: isAr ? "عرض الملف" : "View profile",
        onClick: () => router.push("/profile"),
        icon: Users,
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
          if (scrollToBuyerTradeHistorySection()) return;
          router.push(`/usdt-exchange#${BUYER_TRADE_HISTORY_SECTION_ID}`);
        },
        icon: HandCoins,
        tone: "blue",
      },
      {
        key: "active-trades",
        title: isAr ? "الصفقات النشطة" : "Active Trades",
        subtitle: isAr ? "متابعة الصفقة" : "Continue Trade",
        stat: `${openTradeCount.toLocaleString("en-IL")}`,
        onClick: () => {
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
    ];
  if (standardCommissionDueActive) {
    workspaceCards.push({
      key: "commission",
      title: isAr ? "عمولة مستحقة" : "Commission Due",
      subtitle: commissionWorkspaceAction.kind === "pay-one"
        ? (isAr ? "ادفع مبلغ العمولة المحدد" : "Pay the exact commission")
        : (isAr
          ? `راجع ${sellerCommissionStatus?.pendingCount ?? 0} من العمولات غير المدفوعة`
          : `Review ${sellerCommissionStatus?.pendingCount ?? 0} unpaid commissions`),
      stat: commissionWorkspaceAction.kind === "pay-one"
        ? formatUsdt(sellerCommissionStatus?.payableAmountDue ?? 0)
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

  const heroPrimaryActions = isApprovedSeller
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
        label: isAr ? "تصفّح السوق" : "Browse Marketplace",
        onClick: () => {
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
          if (scrollToBuyerTradeHistorySection()) return;
          router.push(`/usdt-exchange#${BUYER_TRADE_HISTORY_SECTION_ID}`);
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
    let action: "accept-trade" | "upload-payment-receipt" | "confirm-money-received" | "release-usdt" | "upload-seller-evidence" | "confirm-usdt-received" | "review-trade" | "open-trade" = "open-trade";
    if (snapshot.currentStage === "pending" && isSellerActor) action = "accept-trade";
    else if (snapshot.currentStage === "accepted" && isBuyerActor) action = "upload-payment-receipt";
    else if (snapshot.currentStage === "payment_sent" && isSellerActor) action = "confirm-money-received";
    else if (snapshot.currentStage === "funds_received" && isSellerActor) action = "upload-seller-evidence";
    else if (snapshot.currentStage === "usdt_release_pending" && isSellerActor) action = "upload-seller-evidence";
    else if (snapshot.currentStage === "usdt_sent" && isBuyerActor) action = "confirm-usdt-received";
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
    let action: "accept-trade" | "upload-payment-receipt" | "confirm-money-received" | "release-usdt" | "upload-seller-evidence" | "confirm-usdt-received" | "review-trade" | "open-trade" = "open-trade";
    if (request.status === "pending" && isSellerActor) action = "accept-trade";
    else if (request.status === "accepted" && isBuyerActor) action = "upload-payment-receipt";
    else if (request.status === "payment_sent" && isSellerActor) action = "confirm-money-received";
    else if (request.status === "funds_received" && isSellerActor) action = "upload-seller-evidence";
    else if (request.status === "usdt_release_pending" && isSellerActor) action = "upload-seller-evidence";
    else if (request.status === "usdt_sent" && isBuyerActor) action = "confirm-usdt-received";
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
    if (/trade request accepted/.test(text)) return "upload-payment-receipt";
    if (/buyer marked payment sent|payment sent/.test(text)) return "confirm-money-received";
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

    const explicit = (notification.actionHref ?? notification.relatedHref ?? "").trim();
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
    const destination = resolveNotificationHref(notification) ?? "/trade-room?includePending=1";
    if (!destination) return;
    const isTradeIntent = isTradeIntentNotification(notification);
    if (isTradeIntent) {
      const routerDestination = destination.replace(/^\/(en|ar)(?=\/)/i, "") || destination;
      router.push(routerDestination);
      return;
    }
    router.push(destination);
    if (!isTradeIntent && !notification.isRead) {
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
    (listingId: string) => Boolean(listingActionKey && listingActionKey.startsWith(`${listingId}:`)),
    [listingActionKey],
  );

  async function handleSellerListingStatus(listing: MarketplaceListing, nextStatus: "active" | "paused") {
    const actionLabel = nextStatus === "paused" ? "pause" : "resume";
    const confirmed = window.confirm(
      nextStatus === "paused"
        ? (isAr ? "هل تريد إيقاف هذا الإعلان مؤقتاً؟ لن يراه المشترون حتى تستأنفه." : "Pause this listing? Buyers will not see it until you resume.")
        : (isAr ? "هل تريد استئناف هذا الإعلان وإظهاره للمشترين؟" : "Resume this listing and make it visible to buyers?"),
    );
    if (!confirmed) return;
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

      setSellerWorkspaceMessage(nextStatus === "paused"
        ? (isAr ? "⏸ تم إيقاف العرض مؤقتًا. لن يظهر للمشترين حتى تستأنفه." : "⏸ Listing paused. It is no longer visible to buyers until you resume it.")
        : (isAr ? "▶ تم استئناف العرض وهو ظاهر الآن في السوق." : "▶ Listing resumed. Your listing is now live in the marketplace."));
      await refreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing", isAr));
    } finally {
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
    setRemovalListing(listing);
    setRemovalReason("");
    setRemovalExplanation("");
  }

  async function confirmSellerListingRemoval() {
    if (!removalListing) return;
    const reasonResult = validateListingChangeReason({ reason: removalReason, explanation: removalExplanation });
    if (!reasonResult.ok) {
      setSellerWorkspaceMessage(reasonResult.error);
      return;
    }
    const listing = removalListing;
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
          setSellerWorkspaceMessage(isAr ? "انتهت جلستك. سجّل الدخول مرة أخرى." : "Your session has expired. Please sign in again.");
          return;
        }
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing", isAr)));
        return;
      }
      syncListingState(listing, { remove: true });
      setSellerWorkspaceMessage(isAr ? "🗑 تم حذف العرض بنجاح." : "🗑 Listing removed successfully.");
      setRemovalListing(null);
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing", isAr));
    } finally {
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
      navigateOrRevealResult(router, payload.destination, "listing-publish-result");
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
      navigateOrRevealResult(router, "/usdt-exchange#listing-publish-result", "listing-publish-result");
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
          bankAccountId: listingCreateForm.bankAccountId || undefined,
          bankName: serializeIsraeliBankSelection(listingCreateSelectedBanks),
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
        navigateOrRevealResult(router, "/usdt-exchange#listing-publish-result", "listing-publish-result");
        return;
      }
      const payload = await response.json() as { listing?: MarketplaceListing; destination?: string };
      syncListingState(payload.listing ?? null);
      setListingCreateForm((prev) => ({
        ...prev,
        availableAmount: "",
        price: "",
        currency: "",
        paymentMethods: ["Bank Transfer"],
        bankAccountId: "",
        bankName: "",
        minimumTrade: "0",
        maximumTrade: "",
        sellerDescription: "",
      }));
      setListingCreateCurrencyManualOverride(false);
      setListingCommissionAgreement(false);
      setListingCreateResult({
        tone: "success",
        message: "Listing submitted. It is awaiting Alpha Traders admin approval and is not visible to buyers yet.",
      });
      navigateOrRevealResult(router, "/usdt-exchange#listing-publish-result", "listing-publish-result");
      backgroundRefreshSellerWorkspace();
    } catch {
      setListingCreateResult({ tone: "error", message: safeErrorMessage("listing", isAr) });
      navigateOrRevealResult(router, "/usdt-exchange#listing-publish-result", "listing-publish-result");
    } finally {
      listingCreateRequestInFlightRef.current = false;
      setListingActionKey(null);
    }
  }

  async function handleSellerListingEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingListingId) return;
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
          bankAccountId: listingEditForm.bankAccountId || undefined,
          bankName: serializeIsraeliBankSelection(listingEditSelectedBanks),
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
      navigateAfterSuccess(router, payload.destination);
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing", isAr));
    } finally {
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
    setRequestActionKey(actionKey);
    const safetyAcknowledged = nextStatus === "accepted"
      ? true
      : options?.safetyAcknowledged === true;
    try {
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, safetyAcknowledged }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSellerWorkspaceMessage(isAr ? safeErrorMessage("request", true) : (payload.error ?? safeErrorMessage("request", false)));
        return;
      }
      if (nextStatus === "accepted") setSellerWorkspaceMessage(isAr ? "تم قبول الطلب وإنشاء الصفقة." : "Request accepted and trade created.");
      else if (nextStatus === "funds_received") setSellerWorkspaceMessage(isAr ? "تم تأكيد استلام الأموال." : "Funds received confirmed.");
      else if (nextStatus === "usdt_release_pending") setSellerWorkspaceMessage(isAr ? "بدأ إرسال USDT." : "USDT release started.");
      else if (nextStatus === "usdt_sent") setSellerWorkspaceMessage(isAr ? "تم تحديد USDT كمُرسل." : "USDT sent marked.");
      else setSellerWorkspaceMessage(isAr ? "تم رفض الطلب." : "Request declined.");
      await refreshSellerWorkspace();
    } finally {
      setRequestActionKey(null);
    }
  }

  async function handleCommissionPayNow() {
    if (!sellerCommissionStatus?.commissionId) {
      setCommissionPayMessage(isAr ? "لم يتم العثور على سجل عمولة قابل للدفع." : "No payable commission record was found.");
      return;
    }
    if (!(commissionPayableAmountDue > 0)) {
      setCommissionPayMessage(isAr ? "مبلغ العمولة المحدد غير متاح. أعد فتح طلب الدفع." : "The exact commission amount is unavailable. Please reopen the payment request.");
      return;
    }
    if (!commissionTxSignature.trim()) {
      setCommissionPayMessage(isAr ? "ألصق معرّف المعاملة قبل التأكيد." : "Please paste your transaction hash before confirming.");
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
          commissionId: sellerCommissionStatus.commissionId,
          network: commissionNetwork,
          paymentSignature: commissionTxSignature.trim(),
        }),
      });
      const payload = (await response.json()) as { error?: string; verification?: { verified: boolean; notes: string } };
      if (!response.ok) {
        setCommissionPayMessage(isAr ? "تعذر التحقق من دفع العمولة." : (payload.error ?? "Unable to verify commission payment."));
        return;
      }
      setCommissionPayMessage(payload.verification?.verified
        ? (isAr ? "✅ تم التحقق من دفع العمولة واستعادة صلاحيات البائع." : "✅ Commission payment verified. Seller access has been unlocked.")
        : (isAr ? "فشل التحقق من الدفع." : (payload.verification?.notes ?? "Verification failed.")));
      setCommissionTxSignature("");
      await refreshSellerWorkspace();
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
      <Card id={sectionId} className={cn("border-white/10 bg-[#0B0B0B]/90", className)}>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <BellRing className="h-4 w-4 text-[#C9A227]" />
          {isAr ? "مركز الإشعارات" : "Notification Center"}
          <span className="rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2 py-0.5 text-[11px] text-[#C9A227]">{isAr ? `${unreadNotificationsCount} غير مقروء` : `${unreadNotificationsCount} unread`}</span>
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
                const looksTradeRelated = /trade/i.test(`${notification.title} ${notification.message}`);
                const hasAction = Boolean(actionHref) || looksTradeRelated || isTradeIntentNotification(notification);
                return (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div>
                        <p className="text-sm font-semibold text-white">{replaceExchangeEntityIdsWithHints(copy.title, notification)}</p>
                        <p className="mt-1 text-[11px] text-[#93C5FD]">
                          {notification.relatedListingDisplayNumber ? `${isAr ? "العرض" : "Listing"} ${formatListingId(notification.relatedListingDisplayNumber, notification.relatedListingId)}` : null}
                          {notification.relatedTradeDisplayNumber ? `${notification.relatedListingDisplayNumber ? " • " : ""}${isAr ? "الصفقة" : "Trade"} ${formatTradeId(notification.relatedTradeDisplayNumber, notification.relatedTradeId)}` : null}
                          {notification.relatedRequestDisplayNumber && !notification.relatedTradeDisplayNumber ? `${notification.relatedListingDisplayNumber ? " • " : ""}${isAr ? "الصفقة" : "Trade"} ${formatTradeId(notification.relatedRequestDisplayNumber, notification.relatedRequestId)}` : null}
                        </p>
                      </div>
                      <p className="max-w-3xl text-sm leading-6 text-white/90">{replaceExchangeEntityIdsWithHints(copy.message, notification)}</p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#9CA3AF]">
                        <span>{formatNotificationRelativeTime(notification.createdAt, locale)}</span>
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 capitalize text-[#D1D5DB]">{notificationCategoryLabel(notification.category, isAr)}</span>
                      </div>
                      {hasAction ? (
                        <button
                          type="button"
                          onClick={() => void handleNotificationActionClick(notification)}
                          className="inline-flex items-center rounded-full border border-[#6CAEFF]/40 bg-[#6CAEFF]/10 px-3 py-1.5 text-[11px] font-medium text-[#93C5FD] transition hover:border-[#6CAEFF]/70"
                        >
                          {actionLabel}
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
                {notificationCenterExpanded ? (isAr ? "عرض أقل" : "Show less") : (isAr ? `عرض المزيد (${sortedNotifications.length - defaultVisibleCount})` : `View more (${sortedNotifications.length - defaultVisibleCount})`)}
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
      </Card>
    );
  }

  const marketInsightsCard = sessionUser && isApprovedSeller ? (
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
                <p className="font-medium text-white">{update.title}</p>
                <p className="mt-1">{update.details}</p>
                <p className="mt-1 text-[#9CA3AF]">{formatNotificationRelativeTime(update.createdAt, locale)}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/10 p-4 text-sm text-[#E5E7EB]">
            <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">{isAr ? "تقدم مستوى البائع" : "Seller Level Progress"}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <p className="text-white">
                {isAr ? "الرتبة الحالية" : "Current Rank"}: <span className="font-semibold text-[#F3D979]">{sellerLevelLabel(sellerCurrentRank, isAr)}</span>
              </p>
              <p className="text-white">
                {isAr ? "الرتبة التالية" : "Next Rank"}: <span className="font-semibold text-[#F3D979]">{sellerNextTier ? (<span className="inline-flex items-center gap-1"><Trophy className="h-3.5 w-3.5 text-[#F4D87A]" />{sellerLevelLabel(sellerNextTier.rank, isAr)}</span>) : (isAr ? "وصلت إلى أعلى رتبة" : "Top Tier Reached")}</span>
              </p>
              <p>{isAr ? "الحجم المكتمل" : "Completed Volume"}: <span className="font-semibold text-white">{formatWholeNumber(sellerCompletedVolumeUsdt)} USDT</span></p>
              <p>{isAr ? "المطلوب" : "Required"}: <span className="font-semibold text-white">{formatWholeNumber(sellerRequiredVolumeUsdt)} USDT</span></p>
              <p>{isAr ? "المتبقي" : "Remaining"}: <span className="font-semibold text-white">{formatWholeNumber(sellerRemainingVolumeUsdt)} USDT</span></p>
              <p>{isAr ? "التقدم" : "Progress"}: <span className="font-semibold text-white">{Math.round(sellerLevelProgressPercent)}%</span></p>
            </div>
            <div className="mt-3">
              <div className="h-2.5 overflow-hidden rounded-full bg-black/35 ring-1 ring-white/10">
                <motion.div
                  className="relative h-full rounded-full bg-gradient-to-r from-[#B8860B] via-[#D4AF37] to-[#F7E7A6] shadow-[0_0_22px_rgba(212,175,55,0.6)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${sellerLevelProgressPercent}%` }}
                  transition={{ type: "spring", stiffness: 90, damping: 20, mass: 0.7 }}
                >
                  <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-white/30" />
                </motion.div>
              </div>
              <p className="mt-2 text-base font-semibold text-[#FDE68A]">
                {sellerNextTier
                  ? (isAr ? `متبقي ${formatWholeNumber(sellerRemainingVolumeUsdt)} USDT فقط للوصول إلى رتبة ${sellerLevelLabel(sellerNextTier.rank, true)}` : `Only ${formatWholeNumber(sellerRemainingVolumeUsdt)} USDT remaining to reach ${sellerLevelLabel(sellerNextTier.rank)}`)
                  : (isAr ? "لقد وصلت بالفعل إلى أعلى رتبة للبائعين." : "You are already at the highest seller tier.")}
              </p>
              {sellerNextTier ? <p className="mt-1 text-xs text-[#F4D87A]">{isAr ? `واصل التداول لفتح مزايا رتبة ${sellerLevelLabel(sellerNextTier.rank, true)}.` : <>Keep trading to unlock {sellerLevelLabel(sellerNextTier.rank)} benefits.</>}</p> : null}
              <p className="mt-1 text-xs text-[#F3F4F6]">{formatWholeNumber(sellerCompletedVolumeUsdt)} / {formatWholeNumber(sellerRequiredVolumeUsdt)} USDT {isAr ? "مكتمل" : "completed"}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  ) : null;
  const buyerOverviewCard = sessionUser && !isApprovedSeller ? (
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
              <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{item.label}</p>
              <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
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
                    <p className="font-medium text-white">{shortTradeRef(request, isAr)}</p>
                    <p className="mt-0.5">{toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT • {paymentMethodLabel(request.paymentMethod, isAr)}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#C9A227]">{tradeStatusLabel(request.status, isAr)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[#C9A227]/20 bg-[#C9A227]/10 p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#D4AF37]">{isAr ? "ملخص التداول" : "Trading Summary"}</p>
            <p className="mt-3 text-3xl font-semibold text-white">{buyerOverviewStats.totalUsdtBought.toLocaleString("en-IL")} USDT</p>
            <p className="mt-1 text-sm text-[#E5E7EB]">{isAr ? "إجمالي USDT الذي اشتريته عبر المنصة." : "Total USDT purchased through Alpha Exchange."}</p>
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
                <span className="font-semibold text-white">{formatIls(buyerOverviewStats.averagePurchasePrice)}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  ) : null;

  return (
    <section className="section-container page-shell exchange-marketplace-shell overflow-x-clip">
      {sessionUser ? (
        <>
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0A0A0A]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.4)] md:p-7">
            <div className="pointer-events-none absolute inset-0 opacity-40">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(201,162,39,0.18),transparent_42%),radial-gradient(circle_at_85%_25%,rgba(59,130,246,0.16),transparent_40%),linear-gradient(120deg,rgba(201,162,39,0.08),transparent_40%)]" />
            </div>
            <div className="relative z-10">
              {isApprovedSeller ? (
                <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-3 py-1.5 text-xs text-[#F4D87A]">
                  <span className="font-semibold uppercase tracking-[0.12em]">{isAr ? "حالة البائع" : "Seller Status"}</span>
                  <RoleBadge variant="approved_seller" locale={isAr ? "ar" : "en"} />
                  <span className="text-[#E5E7EB]">{isAr ? "بائع معتمد" : "Approved Seller"}</span>
                </div>
              ) : (
                <p className="text-xs uppercase tracking-[0.18em] text-[#D4AF37]">{greetingLabel}</p>
              )}
              <h1 className="mt-2 text-2xl font-semibold text-white md:text-4xl">
                {isAr ? `مرحباً بعودتك، ${workspacePrimaryName}` : `Welcome back, ${workspacePrimaryName}`}
              </h1>
              <p className="mt-1 text-sm text-[#D1D5DB]">{workspacePositiveMessage}</p>
              {!isApprovedSeller ? (
                <div className="buyer-rank-hero-card mt-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#6CAEFF]/30 bg-[#0F172A]/80 shadow-[0_0_32px_rgba(108,174,255,0.16)]">
                        <ShieldCheck className="h-6 w-6 text-[#BFDBFE]" />
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-[#93C5FD]">{isAr ? "هوية المشتري" : "Buyer identity"}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <h2 className={cn("text-[1.35rem] font-semibold text-white md:text-[1.6rem]", "profile-identity-name--buyer")}>{isAr ? (buyerProfileSummary?.labelAr ?? "مشتري مبتدئ") : (buyerProfileSummary?.label ?? "Rookie Buyer")}</h2>
                          <span className={cn("buyer-rank-pill", `buyer-rank-pill--${buyerProfileSummary?.key ?? "rookie"}`)}>
                            {isAr ? "مستوى المشتري" : "Buyer level"}
                          </span>
                        </div>
                        <p className="mt-2 max-w-2xl text-sm text-[#D1D5DB]">
                          {isAr ? (buyerProfileSummary?.descriptionAr ?? "يبدأ التقدم مع كل صفقة ومراجعة جديدة.") : (buyerProfileSummary?.description ?? "Your standing grows with every completed trade and review.")}
                        </p>
                      </div>
                    </div>
                    <div className="min-w-[min(18rem,100%)] rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur">
                      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-[#94A3B8]">
                        <span>{isAr ? "التقدم" : "Progress"}</span>
                        <span>{buyerProfileSummary?.progressPercent ?? 18}%</span>
                      </div>
                      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
                        <motion.div
                          className={cn("relative h-full rounded-full", `buyer-rank-progress buyer-rank-progress--${buyerProfileSummary?.key ?? "rookie"}`)}
                          initial={{ width: 0 }}
                          animate={{ width: `${buyerProfileSummary?.progressPercent ?? 18}%` }}
                          transition={{ type: "spring", stiffness: 90, damping: 20, mass: 0.7 }}
                        />
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-center">
                          <p className="text-[10px] uppercase tracking-[0.14em] text-[#94A3B8]">{isAr ? "المكتملة" : "Completed"}</p>
                          <p className="mt-1 text-sm font-semibold text-white">{buyerProfileSummary?.completedTrades ?? 0}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-center">
                          <p className="text-[10px] uppercase tracking-[0.14em] text-[#94A3B8]">{isAr ? "المراجعات" : "Reviews"}</p>
                          <p className="mt-1 text-sm font-semibold text-white">{buyerProfileSummary?.reviewsGiven ?? 0}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-center">
                          <p className="text-[10px] uppercase tracking-[0.14em] text-[#94A3B8]">{isAr ? "النشطة" : "Active"}</p>
                          <p className="mt-1 text-sm font-semibold text-white">{buyerProfileSummary?.activeTrades ?? 0}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {isApprovedSeller ? (
                <>
                  <p className="mt-2 text-xs text-[#9CA3AF]">
                    {isAr ? "تاريخ الموافقة" : "Approval Date"}: {new Date((sellerApplication?.updatedAt ?? sessionUser?.createdAt) || Date.now()).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}
                  </p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[#D4AF37]">{greetingLabel}</p>
                </>
              ) : null}
              {!isDashboardWorkspace ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {heroPrimaryActions.map((action, index) => (
                    <Button
                      key={action.key}
                      type="button"
                      variant={index === 0 ? "default" : "secondary"}
                      className="min-h-11"
                      onClick={action.onClick}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "اسم التداول" : "Trading Name"}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{safeText(sessionUser.fullName, isAr ? "المتداول" : "Trader")}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "مستوى البائع" : "Seller Level"}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{sellerLevelLabel(sellerOverviewStats.reputation?.level, isAr)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "معرّف AT" : "AT ID"}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Link href="/profile" className="text-sm font-semibold text-[#93C5FD] underline-offset-2 hover:underline">{workspaceDisplayId}</Link>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.clipboard) {
                          void navigator.clipboard.writeText(workspaceDisplayId);
                        }
                        if (isApprovedSeller) setSellerWorkspaceMessage(isAr ? `تم نسخ ${workspaceDisplayId}` : `Copied ${workspaceDisplayId}`);
                        else setStatusMessage(isAr ? `تم نسخ ${workspaceDisplayId}` : `Copied ${workspaceDisplayId}`);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "سوق اليوم" : "Today’s Market"}</p>
                  <p className="mt-1 text-sm font-semibold text-white">USDT / ILS {formatIls(marketPricePerUsdt)}</p>
                </div>
              </div>
            </div>
          </div>

          <div id="workspace-summary" className="mt-5 scroll-mt-24">
            <h2 className="text-lg font-semibold text-white md:text-xl">{isAr ? "مساحة العمل" : "Your workspace"}</h2>
            <p className="mt-1 text-sm leading-6 text-[#B6BDC8]">{isAr ? "اختر المهمة التي تريد تنفيذها الآن." : "Choose what you want to do next."}</p>
            <div className="mt-3 grid gap-2 min-[360px]:grid-cols-2 xl:grid-cols-4">
              {workspaceCards.map((card) => {
                const Icon = card.icon;
                const statIsAction = ["create-listing", "public-profile", "account-settings", "marketplace-compliance"].includes(card.key);
                const toneClass = card.tone === "gold"
                  ? "border-[#C9A227]/35 bg-[#C9A227]/10"
                  : card.tone === "blue"
                    ? "border-[#6CAEFF]/35 bg-[#6CAEFF]/10"
                    : card.tone === "green"
                      ? "border-emerald-500/35 bg-emerald-500/10"
                      : "border-amber-500/35 bg-amber-500/10";
                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={card.onClick}
                    aria-label={`${card.title}: ${card.subtitle}`}
                    className={`flex min-h-[116px] w-full flex-col rounded-2xl border p-3 text-start transition hover:-translate-y-0.5 hover:border-white/30 ${toneClass}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-5 text-white">{card.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#C8CDD5]">{card.subtitle}</p>
                      </div>
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/20">
                        <Icon className="h-4 w-4 text-[#F4D87A]" />
                      </span>
                    </div>
                    <p className={cn("mt-auto pt-2 font-semibold", statIsAction ? "inline-flex items-center gap-1 text-sm text-[#F4D87A]" : "text-xl tracking-tight text-white")}>
                      {card.stat}
                      {statIsAction ? <ArrowRight className={cn("h-4 w-4", isAr && "rotate-180")} aria-hidden="true" /> : null}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

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
                    <p className="text-xs uppercase tracking-[0.14em] text-amber-200/80">{item.title}</p>
                    <p className="mt-2 text-sm font-semibold text-white">{item.body}</p>
                    <p className="mt-3 text-xs font-medium text-amber-200">{item.action}</p>
                  </button>
                ))}
              </CardContent>
            </Card>
          ) : null}

        </>
      ) : null}

      {!sessionUser ? (
      <>
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0A0A0A]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.4)] md:p-10">
        <div className="pointer-events-none absolute inset-0 opacity-40">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(201,162,39,0.16),transparent_42%),radial-gradient(circle_at_82%_20%,rgba(201,162,39,0.12),transparent_40%),linear-gradient(120deg,rgba(201,162,39,0.08),transparent_40%)]" />
          <div className="absolute inset-0 bg-[repeating-linear-gradient(60deg,rgba(201,162,39,0.09)_0px,rgba(201,162,39,0.09)_1px,transparent_1px,transparent_56px),repeating-linear-gradient(-60deg,rgba(201,162,39,0.06)_0px,rgba(201,162,39,0.06)_1px,transparent_1px,transparent_56px)]" />
          <span className="absolute left-[15%] top-[22%] h-1.5 w-1.5 animate-pulse rounded-full bg-[#D4AF37]/80" />
          <span className="absolute left-[54%] top-[35%] h-1.5 w-1.5 animate-pulse rounded-full bg-[#D4AF37]/80 [animation-delay:0.7s]" />
          <span className="absolute left-[77%] top-[58%] h-1.5 w-1.5 animate-pulse rounded-full bg-[#D4AF37]/80 [animation-delay:1.2s]" />
        </div>

        <div className={`relative z-10 max-w-4xl ${isAr ? "md:ms-auto md:text-right" : ""}`}>
          <p className="inline-flex items-center gap-2 rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[#C9A227]">
            <Store className="h-3.5 w-3.5" />
            Alpha Exchange
          </p>
          <p className="mt-4 text-xs uppercase tracking-[0.18em] text-[#9CA3AF]">{isApprovedSeller ? (isAr ? "إعادة الدخول إلى مساحة البيع" : "Returning to your seller workspace") : (isAr ? "إعادة الدخول إلى مساحة الشراء" : "Returning to your buyer workspace")}</p>
          <h1 className="mt-2 text-4xl font-semibold leading-tight text-white md:text-6xl md:leading-[1.1]">{workspaceIdentityName}</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-white/85 md:text-lg">
            {workspacePositiveMessage}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-[#D1D5DB]">{isApprovedSeller ? (isAr ? "بائع معتمد" : "Approved seller") : (isAr ? "مشتري نشط" : "Active buyer")}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-[#D1D5DB]">{workspaceDisplayId}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-[#D1D5DB]">{isApprovedSeller ? sellerLevelLabel(sellerOverviewStats.reputation?.level, isAr) : (isAr ? "جاهز للتصفح" : "Ready to browse")}</span>
          </div>
          <div className={`mt-7 flex flex-wrap gap-3 ${isAr ? "md:justify-end" : ""}`}>
            <a href="#marketplace">
              <Button>{isAr ? "ابدأ صفقة" : "Start a Trade"}</Button>
            </a>
            <a href="#how-it-works">
              <Button variant="secondary">{isAr ? "تعرّف على آلية العمل" : "Learn How It Works"}</Button>
            </a>
          </div>
        </div>
      </div>

      <Card className="mt-8 border-white/10 bg-[#0B0B0B]/90">
        <CardHeader>
          <CardTitle>{isAr ? "للبائعين المعتمدين فقط" : "Approved Sellers Only"}</CardTitle>
          <CardDescription>
            {isAr
              ? "يسمح فقط للبائعين المعتمدين من Alpha Traders بنشر العروض. يتم مراجعة كل طلب بائع يدويًا قبل الموافقة."
              : "Only sellers approved by Alpha Traders are allowed to publish listings. Every seller application is reviewed manually before approval."}
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="mt-6">
        <AlphaMarketCenterView
          locale={locale}
          snapshot={marketSnapshot}
          isLoading={marketFeed.isLoading}
          error={marketFeed.error}
        />
      </div>

      <div className="mt-6">
        <h2 className="text-2xl font-semibold md:text-3xl">{isAr ? "مركز الثقة والأمان" : "Trust & Security"}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              title: isAr ? "البائعون المعتمدون" : "Approved Sellers",
              body: isAr ? "فقط البائعون المعتمدون يدويًا يمكنهم نشر العروض." : "Only manually approved sellers can publish listings.",
              icon: ShieldCheck,
            },
            {
              title: isAr ? "عمولة 1% شفافة" : "Transparent 1% Commission",
              body: isAr ? "تحتسب Alpha Traders عمولة واضحة 1% على المعاملات المكتملة." : "Alpha Traders charges a simple, transparent 1% commission on completed transactions.",
              icon: BadgePercent,
            },
            {
              title: isAr ? "الخصوصية" : "Privacy",
              body: isAr ? "يتم التعامل مع بيانات المستخدمين بشكل آمن." : "User information is handled securely.",
              icon: LockKeyhole,
            },
            {
              title: isAr ? "الدعم" : "Support",
              body: isAr ? "دعم مباشر داخل غرفة التداول أثناء عملية التداول." : "Direct support inside the Trade Room during the trading process.",
              icon: MessageCircle,
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} className="border-white/10 bg-[#0B0B0B]/90">
                <CardHeader>
                  <div className="inline-flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 text-[#C9A227]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>{item.body}</CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
      </>
      ) : null}

      {workspaceError ? (
        <Card className="mt-6 border-amber-500/30 bg-[#0B0B0B]/95">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-[#FDE68A]">
            <AlertTriangle className="h-4 w-4" />
            <span>{workspaceError}</span>
          </CardContent>
        </Card>
      ) : null}

      {!sessionUser ? (
      <div id="how-it-works" className="mt-12">
        <h2 className="text-2xl font-semibold md:text-3xl">{isAr ? "كيف يعمل Alpha Exchange" : "How It Works"}</h2>
        <div className="mt-6 space-y-3">
          {timelineSteps.map((step, index) => (
            <div key={step.title} className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0B0B0B]/85 p-5">
              <div className="pointer-events-none absolute inset-y-0 start-0 w-1 bg-gradient-to-b from-[#C9A227]/80 via-[#C9A227]/20 to-transparent" />
              <div className={`flex items-start gap-4 ${isAr ? "flex-row-reverse" : ""}`}>
                <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 text-sm font-semibold text-[#C9A227]">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-7 text-[#9CA3AF]">{step.body}</p>
                </div>
              </div>
              {index < timelineSteps.length - 1 ? (
                <div className={`mt-3 flex ${isAr ? "justify-end pe-2" : "ps-2"}`}>
                  <span className="text-[#C9A227]/65">↓</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
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
        <div id="market-overview" className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0A0A0A]/90 shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
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
                          <p className="text-[11px] uppercase tracking-[0.14em] text-[#F4D87A]">{pair.label}</p>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${positive ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : "border-rose-500/35 bg-rose-500/10 text-rose-300"}`}>
                            {formatMarketCardChange(pair.changePercent)}
                          </span>
                        </div>
                        <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{formatMarketCardPrice(pair.key, pair.price)}</p>
                        <div className="mt-3 h-10 rounded-xl border border-white/10 bg-black/30 px-2 py-1">
                          <svg viewBox="0 0 100 32" className="h-full w-full" preserveAspectRatio="none" role="img" aria-label={marketTrendAriaLabel(pair.label, isAr)}>
                            <path d={spark} fill="none" stroke={positive ? "#34D399" : "#F87171"} strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-[#AEB5C0]">{marketReferenceLabel(pair.reference, pair.source, isAr)}</p>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-[#9CA3AF] sm:px-5">
            <span>
              {isAr ? "آخر تحديث" : "Last update"}: {formatIsraelMarketTime(marketSnapshot?.updatedAt, isAr)}
            </span>
            <span>{isAr ? "الحالة" : "Status"}: <span className={marketSnapshot?.status === "live" ? "text-emerald-300" : "text-amber-200"}>{marketSnapshot?.status === "live" ? (isAr ? "مباشر" : "LIVE") : (isAr ? "متدهور" : "Degraded")}</span></span>
          </div>
        </div>

        {isApprovedSeller && showSellerWorkspace ? (() => {
          const sellerListingsWorkspace = (
          <Card
            id="my-listings-section"
            tabIndex={-1}
            className="scroll-mt-24 border-white/10 bg-[#0B0B0B]/90"
          >
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>{isAr ? "قائمتي" : "My Listings"}</CardTitle>
                  <CardDescription>{isAr ? "إدارة جميع عروضك كبائع معتمد." : "Manage all of your approved seller listings."}</CardDescription>
                </div>
                {sortedDashboardListings.length ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-9 w-full sm:w-auto"
                    onClick={() => {
                      const newestListing = sortedDashboardListings[0];
                      setSellerListingsExpanded(true);
                      setSellerExpandedListingId(newestListing?.id ?? null);
                      window.requestAnimationFrame(() => {
                        if (!newestListing) return;
                        document.getElementById(sellerListingWorkspaceAnchor(newestListing))?.focus({ preventScroll: true });
                      });
                    }}
                  >
                    {isAr ? "إدارة العروض" : "Manage Listings"}
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {isWorkspaceWidgetsLoading ? (
                Array.from({ length: 2 }).map((_, index) => (
                  <div key={`my-listings-skeleton-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
                    <div className="mt-3 h-4 w-full animate-pulse rounded bg-white/10" />
                    <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-white/10" />
                  </div>
                ))
              ) : null}
              {!isWorkspaceWidgetsLoading && myListings.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center shadow-[0_8px_24px_rgba(2,6,23,0.35)]">
                  <Store className="mx-auto h-5 w-5 text-[#C9A227]" />
                  <p className="mt-2 text-sm font-medium text-white">{isAr ? "ليس لديك عروض نشطة حتى الآن" : "You don’t have any active listings yet."}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "أنشئ أول عرضك الآن ليبدأ المشترون بطلب الشراء." : "Create your first listing now and start receiving buyer requests."}</p>
                  <Button type="button" size="sm" className="mt-3 h-9" onClick={() => { void scrollToCreateListingSection(); }}>
                    {isAr ? "إنشاء عرض" : "Create Listing"}
                  </Button>
                </div>
              ) : null}
              {(sellerListingsExpanded
                ? sortedDashboardListings
                : sortedDashboardListings.slice(0, isMobileViewport ? 1 : 2)
              ).map((listing) => {
                const requestsCount = sellerRequests.filter((request) => request.listingId === listing.id).length;
                const listingBusy = isListingActionBusy(listing.id);
                const isDashboardListingExpanded = sellerExpandedListingId === listing.id;
                const isAwaitingApproval = listing.status === "draft" && listing.approvalStatus === "pending";
                const isLockedForActiveTrade = Boolean(listing.activeTradeRequestId)
                  || listing.status === "matched"
                  || listing.status === "in_trade";
                const listingPaymentMethods = normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod)
                  .map((method) => paymentMethodLabel(method, isAr))
                  .join(isAr ? "، " : ", ") || (isAr ? "غير محدد" : "Not set");
                const listingAttention = isAwaitingApproval
                  ? (isAr ? "بانتظار موافقة الإدارة" : "Awaiting admin approval")
                  : isLockedForActiveTrade
                    ? (isAr ? "مقفل بسبب صفقة نشطة" : "Active trade lock")
                    : listing.status === "paused"
                      ? (isAr ? "متوقف مؤقتاً" : "Paused")
                      : listing.status === "active"
                        ? (isAr ? "مباشر" : "Live")
                        : listingStatusLabel(listing.status, isAr);
                const listingRequiredAction = isAwaitingApproval
                  ? (isAr ? "انتظر موافقة Alpha Traders" : "Wait for Alpha Traders approval")
                  : isLockedForActiveTrade
                    ? (isAr ? "أكمل الصفقة النشطة" : "Complete the active trade")
                    : listing.status === "paused"
                      ? (isAr ? "استأنف عندما تكون جاهزاً" : "Resume when ready")
                      : listing.status === "active"
                        ? (isAr ? "راقب طلبات الشراء" : "Monitor purchase requests")
                        : (isAr ? "راجع حالة العرض" : "Review listing status");
                return (
                  <div
                    id={sellerListingWorkspaceAnchor(listing)}
                    key={listing.id}
                    tabIndex={-1}
                    data-seller-compact-listing="true"
                    data-listing-id={listing.id}
                    className="scroll-mt-24 overflow-hidden rounded-2xl border border-white/10 bg-black/20 transition-all duration-200 hover:border-[#C9A227]/30"
                  >
                    <button
                      type="button"
                      className="grid w-full gap-2 px-3 py-3 text-start transition hover:bg-white/[0.03] sm:grid-cols-[1.15fr_0.8fr_0.7fr_1fr_1fr_auto] sm:items-center"
                      aria-expanded={isDashboardListingExpanded}
                      aria-controls={`seller-listing-details-${listing.id}`}
                      onClick={() => setSellerExpandedListingId((current) => current === listing.id ? null : listing.id)}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{isAr ? "العرض" : "Listing"} {shortListingRef(listing)}</p>
                        <p className="mt-0.5 text-xs text-[#9CA3AF]">{listingAttention}</p>
                      </div>
                      <p className="text-xs text-[#D1D5DB]"><span className="text-[#9CA3AF]">{isAr ? "الكمية " : "Amount "}</span>{toNumber(listing.availableAmount).toLocaleString("en-IL")} USDT</p>
                      <p className="text-xs text-[#D1D5DB]"><span className="text-[#9CA3AF]">{isAr ? "السعر " : "Price "}</span>{formatIls(toNumber(listing.price))}</p>
                      <p className="min-w-0 truncate text-xs text-[#D1D5DB]" title={listingPaymentMethods}><span className="text-[#9CA3AF]">{isAr ? "الدفع " : "Payment "}</span>{listingPaymentMethods}</p>
                      <p className={cn("text-xs font-medium", isAwaitingApproval || isLockedForActiveTrade ? "text-amber-200" : "text-[#BFDBFE]")}>{listingRequiredAction}</p>
                      <ChevronDown className={cn("h-4 w-4 text-[#9CA3AF] transition-transform", isDashboardListingExpanded && "rotate-180")} />
                    </button>
                    <div
                      id={`seller-listing-details-${listing.id}`}
                      className={cn(
                        "border-t border-white/10 px-3 pb-3 pt-3",
                        !isDashboardListingExpanded && "hidden",
                      )}
                    >
                    {listing.status === "draft" && listing.approvalStatus === "pending" ? (
                      <p className="mb-3 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-100">
                        {isAr ? "بانتظار موافقة إدارة Alpha Traders — هذا العرض غير ظاهر للمشترين بعد." : "Awaiting Alpha Traders admin approval — this listing is not visible to buyers yet."}
                      </p>
                    ) : null}
                    <div className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <p>{isAr ? "الحالة" : "Status"}: <span className="text-white">{listingStatusLabel(listing.status, isAr)}</span></p>
                      <p>{isAr ? "الإجراء المطلوب" : "Required action"}: <span className="text-white">{listingRequiredAction}</span></p>
                      <p>{isAr ? "طلبات الشراء" : "Purchase requests"}: <span className="text-white">{requestsCount}</span></p>
                      <p>{isAr ? "آخر نشاط" : "Last activity"}: <span className="text-white">{new Date(listing.updatedAt || listing.createdAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
                      <DiscordShareAction
                        listing={listing}
                        sharing={discordSharing}
                        busy={discordShareActionKey === listing.id}
                        locale={locale}
                        onShare={(selected) => {
                          void handleDiscordListingShare(selected);
                        }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-9"
                        disabled={listingBusy}
                        onClick={() => {
                          setEditingListingId(listing.id);
                          setListingEditForm({
                            availableAmount: listing.availableAmount,
                            price: listing.price,
                            currency: listing.currency,
                            network: listing.network,
                            paymentMethods: normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod),
                            bankAccountId: listing.bankAccountId ?? (sellerBankAccounts.find((account) => account.isDefault)?.id ?? sellerBankAccounts[0]?.id ?? ""),
                            bankName: listing.bankName ?? "",
                            minimumTrade: listing.minimumTrade ?? "0",
                            maximumTrade: listing.maximumTrade ?? listing.availableAmount,
                            sellerDescription: listing.sellerDescription ?? "",
                            changeReason: "",
                            changeExplanation: "",
                          });
                          setListingEditOriginal({
                            availableAmount: listing.availableAmount,
                            price: listing.price,
                            minimumTrade: listing.minimumTrade ?? "0",
                            maximumTrade: listing.maximumTrade ?? listing.availableAmount,
                          });
                        }}
                      >
                        <Edit3 className="h-4 w-4" />
                        {isAr ? "تعديل" : "Edit"}
                      </Button>
                      {listing.status === "paused" ? (
                        <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingStatus(listing, "active")}>
                          <PlayCircle className="h-4 w-4" />
                          {listingActionKey === `${listing.id}:resume` ? (isAr ? "جارٍ الاستئناف..." : "Resuming...") : (isAr ? "استئناف" : "Resume")}
                        </Button>
                      ) : listing.status === "active" ? (
                        <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingStatus(listing, "paused")}>
                          <PauseCircle className="h-4 w-4" />
                          {listingActionKey === `${listing.id}:pause` ? (isAr ? "جارٍ الإيقاف..." : "Pausing...") : (isAr ? "إيقاف مؤقت" : "Pause")}
                        </Button>
                      ) : null}
                      {listing.status !== "draft" ? (
                        <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingRenew(listing)}>
                          <Clock3 className="h-4 w-4" />
                          {listingActionKey === `${listing.id}:renew` ? (isAr ? "جارٍ التجديد..." : "Renewing...") : (isAr ? "تجديد" : "Renew")}
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingDelete(listing)}>
                        <Trash2 className="h-4 w-4" />
                        {listingActionKey === `${listing.id}:delete` ? (isAr ? "جارٍ الحذف..." : "Deleting...") : (isAr ? "حذف" : "Delete")}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingDuplicate(listing)}>
                        <Copy className="h-4 w-4" />
                        {listingActionKey === `${listing.id}:duplicate` ? (isAr ? "جارٍ النسخ..." : "Duplicating...") : (isAr ? "نسخ العرض" : "Duplicate Listing")}
                      </Button>
                    </div>
                    {editingListingId === listing.id ? (
                      <form className="mt-3 grid gap-2 md:grid-cols-4" onSubmit={handleSellerListingEditSubmit}>
                        <Input value={listingEditForm.availableAmount} onChange={(event) => setListingEditForm((prev) => ({ ...prev, availableAmount: formatIntegerForInput(event.target.value) }))} placeholder={isAr ? "الكمية المتاحة" : "Available Amount"} />
                        <div className="space-y-2">
                          <Input
                            value={listingEditForm.price}
                            onChange={(event) => setListingEditForm((prev) => ({ ...prev, price: normalizeDecimalInput(event.target.value) }))}
                            placeholder={isAr ? "السعر" : "Price"}
                            className={`transition-all duration-200 ${
                              listingEditPriceInvalid
                                ? "border-red-500/85 shadow-[0_0_0_3px_rgba(239,68,68,0.2)]"
                                : listingEditPriceValid
                                  ? "border-emerald-500/80 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]"
                                  : ""
                            }`}
                          />
                          <p className={`text-xs transition-colors duration-200 ${
                            listingEditPriceInvalid ? "text-red-300" : listingEditPriceValid ? "text-emerald-300" : "text-[#9CA3AF]"
                          }`}>
                            {listingEditPriceInvalid
                              ? (isAr ? `السعر يتجاوز الحد الأقصى المسموح (${formatIls(maxAllowedListingPrice)}).` : `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)}).`)
                              : listingEditPriceValid
                                ? (isAr ? `السعر صالح. الحد الأقصى المسموح هو ${formatIls(maxAllowedListingPrice)}.` : `Valid price. Maximum allowed is ${formatIls(maxAllowedListingPrice)}.`)
                                : (isAr ? `أدخل سعراً لا يتجاوز ${formatIls(maxAllowedListingPrice)}.` : `Enter a price up to ${formatIls(maxAllowedListingPrice)}.`)}
                          </p>
                        </div>
                        <Input value={listingEditForm.currency} onChange={(event) => setListingEditForm((prev) => ({ ...prev, currency: event.target.value }))} placeholder={isAr ? "العملة" : "Currency"} />
                        <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={listingEditForm.network} onChange={(event) => setListingEditForm((prev) => ({ ...prev, network: event.target.value as SupportedNetwork }))}>
                          <option value="TRC20">TRC20</option>
                          <option value="ERC20">ERC20</option>
                          <option value="BEP20">BEP20</option>
                          <option value="SOL">SOL</option>
                        </select>
                        <Input value={listingEditForm.minimumTrade} onChange={(event) => setListingEditForm((prev) => ({ ...prev, minimumTrade: formatIntegerForInput(event.target.value) }))} placeholder={isAr ? "الحد الأدنى للصفقة" : "Minimum Trade"} />
                        <Input value={listingEditForm.maximumTrade} onChange={(event) => setListingEditForm((prev) => ({ ...prev, maximumTrade: formatIntegerForInput(event.target.value) }))} placeholder={isAr ? "الحد الأقصى للصفقة" : "Maximum Trade"} />
                        <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "طريقة الدفع" : "Payment Method"} *</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-3">
                            {MARKETPLACE_PAYMENT_METHODS.map((method) => {
                              const selected = listingEditSelectedMethods.includes(method);
                              return (
                                <button
                                  key={`${listing.id}-method-${method}`}
                                  type="button"
                                  onClick={() => setListingEditForm((prev) => {
                                    const nextMethods = toggleSelection(prev.paymentMethods, method, MAX_LISTING_PAYMENT_METHODS);
                                    return {
                                      ...prev,
                                      paymentMethods: nextMethods,
                                      bankName: requiresBankSelection(nextMethods) ? prev.bankName : "",
                                    };
                                  })}
                                  className={`rounded-xl border p-2.5 text-start transition-all duration-200 ${
                                    selected
                                      ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                                      : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                                  }`}
                                >
                                  <p className="text-xs font-medium text-white">{paymentMethodEmoji(method)} {paymentMethodLabel(method, isAr)}</p>
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? `اختر حتى ${MAX_LISTING_PAYMENT_METHODS} طرق.` : `Select up to ${MAX_LISTING_PAYMENT_METHODS} methods.`}</p>
                        </div>
                        <Textarea className="md:col-span-2" value={listingEditForm.sellerDescription} onChange={(event) => setListingEditForm((prev) => ({ ...prev, sellerDescription: event.target.value }))} aria-label={isAr ? "وصف البائع" : "Seller description"} placeholder={isAr ? "وصف البائع" : "Seller Description"} />
                        {listingEditRequiresBank ? (
                        <div className="md:col-span-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "البنوك المدعومة" : "Supported banks"} *</p>
                          <p className="mt-1 text-xs text-[#D1D5DB]">{isAr ? `اختر حتى ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} بنوك للتحويل البنكي أو السحب بلا بطاقة.` : `Select up to ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} banks for bank transfer or cardless ATM listings.`}</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                            {ISRAELI_BANKS.map((bank) => {
                              const selected = listingEditSelectedBanks.includes(bank.name);
                              return (
                                <button
                                  key={`${listing.id}-${bank.id}`}
                                  type="button"
                                  onClick={() => setListingEditForm((prev) => {
                                    const nextBanks = toggleSelection(parseIsraeliBankSelection(prev.bankName), bank.name, MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS);
                                    return { ...prev, bankName: serializeIsraeliBankSelection(nextBanks) };
                                  })}
                                  className={`rounded-xl border p-2 text-start transition-all duration-200 ${
                                    selected
                                      ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                                      : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/35">
                                      {renderBankLogo(bank)}
                                    </span>
                                    <div>
                                      <p className="text-xs font-medium text-white">{getIsraeliBankDisplayName(bank.name, locale)}</p>
                                      <p className="text-[10px] text-[#9CA3AF]">{bank.code}</p>
                                    </div>
                                  </div>
                                  {selected ? <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#93C5FD]">{isAr ? "محدد" : "Selected"}</p> : null}
                                </button>
                              );
                            })}
                          </div>
                          {listingEditSelectedBanks.length ? <p className="mt-2 text-xs text-[#93C5FD]">{isAr ? "المحدد" : "Selected"}: {listingEditSelectedBanks.map((bankName) => getIsraeliBankDisplayName(bankName, locale)).join(isAr ? "، " : ", ")}</p> : null}
                        </div>
                        ) : null}
                        {listingEditRequiresBankAccount ? (
                        <div className="md:col-span-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "الحساب البنكي لاستلام الدفعات" : "Payout bank account"} *</p>
                          {sellerBankAccountsLoading ? (
                            <p className="mt-2 text-xs text-[#D1D5DB]">{isAr ? "جارٍ تحميل حساباتك البنكية المحفوظة..." : "Loading your saved bank accounts..."}</p>
                          ) : sellerBankAccounts.length === 0 ? (
                            <p className="mt-2 text-xs text-amber-300">
                              {isAr ? <>لم يتم العثور على حسابات بنكية محفوظة. أضف حساباً في <a href={`/${locale}/settings?tab=profile#seller-bank-accounts`} className="text-[#93C5FD] underline underline-offset-2">الإعدادات</a> قبل حفظ العرض.</> : <>No saved bank accounts found. Add one in <a href={`/${locale}/settings?tab=profile#seller-bank-accounts`} className="text-[#93C5FD] underline underline-offset-2">Settings</a> before saving this listing.</>}
                            </p>
                          ) : (
                            <>
                              <select
                                className="mt-2 flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white"
                                value={listingEditForm.bankAccountId}
                                onChange={(event) => setListingEditForm((prev) => ({ ...prev, bankAccountId: event.target.value }))}
                              >
                                <option value="">{isAr ? "اختر حساباً بنكياً" : "Select bank account"}</option>
                                {sellerBankAccounts.map((account) => (
                                  <option key={account.id} value={account.id}>
                                    {`${getIsraeliBankDisplayName(account.bankName, locale)} • ${account.maskedAccountNumber ?? `****${account.accountLast4}`}${account.isDefault ? (isAr ? " (افتراضي)" : " (Default)") : ""}`}
                                  </option>
                                ))}
                              </select>
                              <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? "لن يرى المشترون رقم حسابك الكامل أبداً." : "Buyers never see your full account number."}</p>
                            </>
                          )}
                        </div>
                        ) : null}
                        {listingEditNeedsReason ? (
                          <div className="md:col-span-4 rounded-2xl border border-amber-500/35 bg-amber-500/[0.06] p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#FDE68A]">{isAr ? "سبب التغيير" : "Reason for change"} <span className="text-red-300">*</span></p>
                            <p className="mt-1 text-xs text-[#D1D5DB]">{isAr ? "يتم تسجيل تعديل الكمية أو السعر أو التوفر لضمان الشفافية في السوق." : "Editing amount, price, or availability is recorded for marketplace accountability."}</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <select
                                aria-label={isAr ? "سبب تغيير العرض" : "Reason for listing change"}
                                className={cn(
                                  "flex h-11 w-full rounded-xl border bg-[#101010] px-3 py-2 text-sm text-white",
                                  listingEditForm.changeReason ? "border-emerald-500/60" : "border-red-500/70",
                                )}
                                value={listingEditForm.changeReason}
                                onChange={(event) => setListingEditForm((prev) => ({ ...prev, changeReason: event.target.value }))}
                              >
                                <option value="">{isAr ? "اختر سبباً…" : "Select a reason…"}</option>
                                {LISTING_CHANGE_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>{listingChangeReasonLabel(reason, isAr)}</option>
                                ))}
                              </select>
                              <Input
                                aria-label={isAr ? "شرح التغيير" : "Change explanation"}
                                placeholder={isAr ? "اشرح هذا التغيير باختصار" : "Briefly explain this change"}
                                value={listingEditForm.changeExplanation}
                                onChange={(event) => setListingEditForm((prev) => ({ ...prev, changeExplanation: event.target.value }))}
                                className={listingEditForm.changeExplanation.trim().length >= 5 ? "border-emerald-500/60" : "border-red-500/70"}
                              />
                            </div>
                            {!listingEditReasonValid ? (
                              <p className="mt-2 text-xs text-red-300">{isAr ? "اختر سبباً وأضف شرحاً قصيراً (5 أحرف على الأقل)." : "Choose a reason and add a short explanation (at least 5 characters)."}</p>
                            ) : null}
                          </div>
                        ) : null}
                        <div className={`md:col-span-4 rounded-2xl border p-3 text-xs transition-all duration-200 ${listingEditGuardTone}`}>
                          <div className="flex items-start gap-2">
                            {listingEditPriceInvalid ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                            <div className="space-y-1">
                              <p className="font-medium">
                                {listingEditPriceInvalid ? (isAr ? `السعر يتجاوز الحد الأقصى المسموح (${formatIls(maxAllowedListingPrice)})` : `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)})`) : (isAr ? "حماية سعر السوق مفعلة" : "Market guard active")}
                              </p>
                              <p>{isAr ? "سعر السوق الحالي" : "Current market"}: {formatIls(marketPricePerUsdt)} {isAr ? "لكل 1 USDT" : "per 1 USDT"}</p>
                              <p>{isAr ? "الحد الأقصى المسموح" : "Maximum allowed"}: {formatIls(maxAllowedListingPrice)}</p>
                              {listingEditTradeRangeInvalid ? <p className="text-amber-200">{isAr ? "يجب أن يكون الحد الأقصى للصفقة أكبر من الحد الأدنى وألا يتجاوز كمية USDT المتاحة." : "Maximum trade must be greater than minimum trade and less than or equal to available USDT."}</p> : null}
                              {listingEditRequiresBank && !listingEditSelectedBanks.length ? <p className="text-amber-200">{isAr ? "اختر بنكاً واحداً أو بنكين مدعومين قبل الحفظ." : "Select one or two supported banks before saving."}</p> : null}
                              {listingEditRequiresBankAccount && !listingEditForm.bankAccountId ? <p className="text-amber-200">{isAr ? "اختر حساباً بنكياً واحداً لاستلام الدفعات قبل الحفظ." : "Select one payout bank account before saving."}</p> : null}
                              {listingEditAmount > 0 ? <p>{listingEditAmount.toLocaleString("en-IL")} USDT ≈ {formatIls(listingEditAmount * marketPricePerUsdt)}</p> : null}
                            </div>
                          </div>
                        </div>
                        <div className="md:col-span-4 flex gap-2">
                          <Button type="submit" size="sm" disabled={isListingEditSubmitDisabled || !listingEditReasonValid || listingActionKey === `${listing.id}:save`}>
                            {listingActionKey === `${listing.id}:save` ? (isAr ? "جارٍ الحفظ..." : "Saving...") : (isAr ? "حفظ" : "Save")}
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingListingId(null); setListingEditOriginal(null); }}>{isAr ? "إلغاء" : "Cancel"}</Button>
                        </div>
                      </form>
                    ) : null}
                    </div>
                  </div>
                );
              })}
              {sortedDashboardListings.length > (isMobileViewport ? 1 : 2) ? (
                <div className="flex justify-start">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setSellerListingsExpanded((current) => !current)}
                  >
                    {sellerListingsExpanded
                      ? (isAr ? "عرض عدد أقل من العروض" : "Show fewer listings")
                      : (isAr ? `عرض جميع العروض (${sortedDashboardListings.length - (isMobileViewport ? 1 : 2)})` : `View All Listings (${sortedDashboardListings.length - (isMobileViewport ? 1 : 2)})`)}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
          );
          return sellerDashboardListingsTarget ? createPortal(sellerListingsWorkspace, sellerDashboardListingsTarget) : null;
        })() : null}

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
                      <p className="font-medium text-white">{shortTradeRef(trade, isAr)}</p>
                      <p className="mt-0.5">{toNumber(trade.usdtAmount).toLocaleString("en-IL")} USDT • {toNumber(trade.fiatAmount).toLocaleString("en-IL")} {trade.currency}</p>
                      <p className="mt-0.5 text-[#9CA3AF]">{new Date(trade.completedAt ?? trade.updatedAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</p>
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
                  {showAllCompletedTrades
                    ? (isAr ? "عرض أقل" : "Show less")
                    : (isAr ? `عرض ${recentCompletedTrades.length - 1} صفقات إضافية` : `Show ${recentCompletedTrades.length - 1} more`)}
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
                <Input placeholder={isAr ? "أقل كمية USDT" : "Min USDT amount"} value={minAmountFilter} onChange={(event) => setMinAmountFilter(event.target.value)} />
                <Input placeholder={isAr ? "أعلى كمية USDT" : "Max USDT amount"} value={maxAmountFilter} onChange={(event) => setMaxAmountFilter(event.target.value)} />
                <Input placeholder={isAr ? "أقل سعر (₪)" : "Min price (₪)"} value={minPriceFilter} onChange={(event) => setMinPriceFilter(event.target.value)} />
                <Input placeholder={isAr ? "أعلى سعر (₪)" : "Max price (₪)"} value={maxPriceFilter} onChange={(event) => setMaxPriceFilter(event.target.value)} />
                <Input placeholder={isAr ? "أقل درجة ثقة" : "Min trust score"} value={trustScoreFilter} onChange={(event) => setTrustScoreFilter(event.target.value)} />
                <Button type="button" variant={onlineOnlyFilter ? "default" : "secondary"} onClick={() => setOnlineOnlyFilter((prev) => !prev)}>
                  {onlineOnlyFilter ? (isAr ? "البائعون المتصلون فقط" : "Online Sellers Only") : (isAr ? "إظهار البائعين المتصلين فقط" : "Show Online Sellers Only")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-2 min-[1440px]:grid-cols-3">
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
                {isAr ? "لا توجد عروض USDT نشطة متاحة الآن." : "No active USDT listings are available right now."}
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
                    <CardTitle className="text-xl">{feature.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-7">{feature.body}</CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
      ) : null}

      {showDeferredSections && !isApprovedSeller && !isDashboardWorkspace ? (
      <div className="mt-10 grid gap-6 xl:grid-cols-2">
        {/* Seller Application */}
        <Card id="seller-application" className="border-white/10 bg-[#0B0B0B]/90">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#C9A227]/35 bg-[#C9A227]/10 text-[#C9A227]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">{isAr ? "انضم كبائع معتمد" : "Become an Approved Seller"}</CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  {isAr ? "يتم مراجعة الطلبات يدويًا قبل منح صلاحية النشر." : "Applications are reviewed manually before marketplace access is granted."}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {shouldCondenseSellerApplication && !isSellerApplicationExpanded ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                  {isAr ? "خيار إضافي" : "Optional Next Step"}
                </p>
                <p className="mt-2 text-base font-semibold text-white">
                  {isAr ? "هل تريد البيع أيضًا؟" : "Want to sell USDT too?"}
                </p>
                <p className="mt-2 text-sm text-[#9CA3AF]">
                  {isAr
                    ? "أبقينا هذه الصفحة مركزة على المشتري. افتح طلب البائع فقط إذا كنت تريد التقديم لبدء البيع أيضًا."
                    : "This page stays focused on the buyer workflow. Open the seller application only if you want to start selling too."}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => setIsSellerApplicationExpanded(true)}>
                    {isAr ? "فتح طلب البائع" : "Open Seller Application"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const target = document.getElementById("marketplace");
                      if (target) {
                        target.scrollIntoView({ behavior: "smooth", block: "start" });
                      }
                    }}
                  >
                    {isAr ? "العودة إلى السوق" : "Back to Marketplace"}
                  </Button>
                </div>
              </div>
            ) : isSellerApplicationLoading && isApprovedSellerSession ? (
              <div className="space-y-3">
                <div className="h-4 w-44 animate-pulse rounded bg-white/10" />
                <div className="h-20 w-full animate-pulse rounded-2xl bg-white/10" />
                <div className="h-20 w-full animate-pulse rounded-2xl bg-white/10" />
              </div>
            ) : (
            /* ── State 1: buyer role required ── */
            sellerApplicationEligibility === "loading" ? (
              <div className="space-y-3" aria-label={isAr ? "جارٍ تحميل حالة الحساب" : "Loading account status"}>
                <div className="h-4 w-44 animate-pulse rounded bg-white/10" />
                <div className="h-20 w-full animate-pulse rounded-2xl bg-white/10" />
              </div>
            ) : sellerApplicationEligibility === "retry" ? (
              <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-5">
                <p className="font-semibold text-white">{isAr ? "تعذر تحديث حالة الحساب" : "Unable to refresh account status"}</p>
                <Button type="button" className="mt-4" onClick={() => window.location.reload()}>{isAr ? "إعادة المحاولة" : "Retry"}</Button>
              </div>
            ) : sellerApplicationEligibility === "buyer_setup_required" ? (
              <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div>
                    <p className="font-semibold text-white">{isAr ? "أكمل إعداد حساب المشتري أولاً" : "Complete Buyer Setup First"}</p>
                    <p className="mt-2 text-sm text-[#E5E7EB]">
                      {isAr
                        ? "يجب أن يكون لديك حساب مشترٍ قبل التقديم كبائع. ستتم مراجعة طلبات البائعين يدويًا وقد يُطلب تحقق إضافي."
                        : "You need a buyer account before applying as a seller. Seller applications are reviewed manually and may require additional verification."}
                    </p>
                    <Button
                      type="button"
                      className="mt-4 w-full"
                      onClick={() => router.push("/onboarding")}
                    >
                      {isAr ? "إعداد حساب مشترٍ" : "Set Up Buyer Account"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : sellerApplicationEligibility === "application_pending" ? (
              /* ── State 2: Application pending ── */
              <div className="space-y-4">
                <div className="rounded-2xl border border-[#C9A227]/35 bg-[#C9A227]/10 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#C9A227]/50 bg-[#C9A227]/20">
                      <Clock3 className="h-5 w-5 text-[#F4D87A]" />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{isAr ? "الطلب قيد المراجعة" : "Application Pending Review"}</p>
                      <p className="mt-0.5 text-xs text-[#D1D5DB]">
                        {sellerApplication?.createdAt
                          ? `${isAr ? "تاريخ التقديم" : "Submitted"}: ${new Date(sellerApplication.createdAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}`
                          : (isAr ? "تم إرسال الطلب" : "Application submitted")}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-[#D1D5DB]">
                  <p className="mb-3 text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "ماذا يحدث بعد ذلك" : "What Happens Next"}</p>
                  <div className="space-y-2">
                    {[
                      isAr ? "سيراجع فريق Alpha Traders طلبك." : "The Alpha Traders team will review your application.",
                      isAr ? "سيتواصل معك المالك عبر WhatsApp باستخدام الرقم الذي قدمته في الطلب." : "The owner will contact you via WhatsApp using the number in your application.",
                      isAr ? "قد تُطلب منك معلومات أو تحقق إضافي." : "Additional verification or information may be requested.",
                      isAr ? "بعد الموافقة ستحصل على شارة البائع المعتمد." : "Upon approval, you receive the Approved Seller badge and marketplace access.",
                    ].map((step, index) => (
                      <div key={index} className="flex items-start gap-2">
                        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#C9A227]/40 bg-[#C9A227]/10 text-[10px] font-semibold text-[#F4D87A]">{index + 1}</span>
                        <p>{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="rounded-xl border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 px-4 py-3 text-xs text-[#BFDBFE]">
                  {isAr ? "سنتواصل معك عبر WhatsApp باستخدام الرقم الذي قدمته في الطلب." : "We'll contact you via WhatsApp using the number in your application."}
                </p>
              </div>
            ) : (
              /* ── State 3: Application form ── */
              <>
                {/* Approval process info panel */}
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                  <p className="mb-3 text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "عملية الموافقة" : "Approval Process"}</p>
                  <div className="space-y-2">
                    {[
                      isAr ? "يدخل طلبك في مراجعة يدوية." : "Your application enters manual review.",
                      isAr ? "سيتواصل معك مالك Alpha Traders عبر WhatsApp باستخدام الرقم الذي تقدمه في الطلب." : "The Alpha Traders owner will contact you via WhatsApp using the number you provide in your application.",
                      isAr ? "قد تُطلب منك معلومات إضافية." : "Additional verification or information may be requested.",
                      isAr ? "بعد الموافقة تحصل على شارة البائع المعتمد وصلاحيات النشر." : "Once approved, you receive the Approved Seller badge and marketplace selling privileges.",
                    ].map((step, index) => (
                      <div key={index} className="flex items-start gap-2">
                        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 text-[10px] font-semibold text-[#F4D87A]">{index + 1}</span>
                        <p>{step}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {statusMessage ? (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-[#FDE68A]">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>{statusMessage}</span>
                  </div>
                ) : null}

                <form className="space-y-3" onSubmit={handleSellerApplicationSubmit}>
                  {/* Personal Information */}
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "المعلومات الشخصية" : "Personal Information"}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="seller-first-name" required>{isAr ? "الاسم الأول" : "First Name"}</FieldLabel>
                      <Input
                        id="seller-first-name"
                        placeholder={isAr ? "الاسم الأول" : "First name"}
                        value={sellerForm.firstName}
                        required
                        aria-required
                        onChange={(event) => { sellerFormTouchedRef.current = true; setSellerForm((prev) => ({ ...prev, firstName: event.target.value })); }}
                        className={requiredFieldClasses({ value: sellerForm.firstName, required: true })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="seller-last-name" required>{isAr ? "اسم العائلة" : "Last Name"}</FieldLabel>
                      <Input
                        id="seller-last-name"
                        placeholder={isAr ? "اسم العائلة" : "Last name"}
                        value={sellerForm.lastName}
                        required
                        aria-required
                        onChange={(event) => { sellerFormTouchedRef.current = true; setSellerForm((prev) => ({ ...prev, lastName: event.target.value })); }}
                        className={requiredFieldClasses({ value: sellerForm.lastName, required: true })}
                      />
                    </div>
                  </div>
                  <div className="relative">
                    <FieldLabel htmlFor="seller-email" className="mb-1.5">{isAr ? "البريد الإلكتروني" : "Email"}</FieldLabel>
                    <Input
                      id="seller-email"
                      type="email"
                      value={sellerForm.email || (sessionUser?.email ?? "")}
                      readOnly
                      aria-label={isAr ? "البريد الإلكتروني" : "Email"}
                      className="cursor-default opacity-75"
                    />
                    <span className="pointer-events-none absolute end-3 top-[2.35rem] rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-2 py-0.5 text-[10px] font-medium text-[#D4AF37]">
                      {isAr ? "من الحساب" : "From account"}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="seller-whatsapp" required>{isAr ? "رقم الهاتف / WhatsApp" : "WhatsApp / Phone Number"}</FieldLabel>
                    <Input
                      id="seller-whatsapp"
                      placeholder={isAr ? "رقم الهاتف / WhatsApp" : "WhatsApp / phone number"}
                      value={sellerForm.whatsappNumber}
                      required
                      aria-required
                      onChange={(event) => { sellerFormTouchedRef.current = true; setSellerForm((prev) => ({ ...prev, whatsappNumber: event.target.value })); }}
                      className={requiredFieldClasses({ value: sellerForm.whatsappNumber, required: true })}
                    />
                  </div>

                  {/* Selling methods */}
                  <p className="pt-1 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "طرق البيع المدعومة" : "Supported Selling Methods"}</p>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="mb-3 text-xs text-[#9CA3AF]">
                      {isAr ? "اختر طريقة أو أكثر." : "Select one or more methods."}
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(["Crypto", "Fiat"] as const).map((group) => (
                        <div key={group} className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? (group === "Crypto" ? "عملات رقمية" : "عملات تقليدية") : group}</p>
                          <div className="grid gap-2">
                            {SELLER_APPLICATION_METHOD_OPTIONS.filter((m) => m.group === group).map((method) => {
                              const selected = sellerApplicationMethods.includes(method.id);
                              return (
                                <button
                                  key={method.id}
                                  type="button"
                                  onClick={() => setSellerApplicationMethods((prev) => prev.includes(method.id) ? prev.filter((item) => item !== method.id) : [...prev, method.id])}
                                  className={`rounded-xl border px-3 py-2.5 text-start text-sm transition ${
                                    selected
                                      ? "border-[#C9A227]/60 bg-[#C9A227]/10 text-white ring-1 ring-[#C9A227]/30"
                                      : "border-white/10 bg-black/25 text-[#D1D5DB] hover:border-[#C9A227]/30 hover:text-white"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{sellerApplicationMethodLabel(method.id, isAr)}</span>
                                    <span className="flex items-center gap-1.5">
                                      {method.recommended ? <span className="rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#D4AF37]">⭐ {isAr ? "موصى به" : "Recommended"}</span> : null}
                                      {selected ? <CheckCircle2 className="h-4 w-4 text-[#C9A227]" /> : <div className="h-4 w-4 rounded-full border border-white/20" />}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Expected Monthly Volume */}
                  <p className="pt-1 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "التداول الشهري المتوقع" : "Expected Monthly Trading Volume"}</p>
                  <Input
                    placeholder={isAr ? "مثال: 5,000 USDT شهريًا" : "e.g. 5,000 USDT per month"}
                    value={sellerForm.expectedMonthlyTradingVolume}
                    onChange={(event) => { sellerFormTouchedRef.current = true; setSellerForm((prev) => ({ ...prev, expectedMonthlyTradingVolume: event.target.value })); }}
                  />

                  {/* Additional notes */}
                  <Textarea
                    placeholder={isAr ? "ملاحظات إضافية (اختياري)" : "Additional notes (optional)"}
                    value={sellerForm.additionalNotes}
                    onChange={(event) => { sellerFormTouchedRef.current = true; setSellerForm((prev) => ({ ...prev, additionalNotes: event.target.value })); }}
                  />

                  <Button type="submit" className="w-full" disabled={!sellerForm.firstName || !sellerForm.lastName || !sellerForm.whatsappNumber || sellerApplicationMethods.length === 0}>
                    {isAr ? "قدّم طلب الاعتماد" : "Apply for Approval"}
                  </Button>
                </form>

                {/* Trust notice */}
                <p className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-[#9CA3AF]">
                  {isAr
                    ? "تتم الموافقة على البائعين يدويًا لحماية المشترين والحفاظ على سوق موثوق. تُراجَع الطلبات بشكل فردي وقد يُطلب تحقق إضافي."
                    : "Seller approval is performed manually to protect buyers and maintain a trusted marketplace. Applications are reviewed individually and additional verification may be requested before approval."}
                </p>
                {shouldCondenseSellerApplication ? (
                  <Button type="button" variant="secondary" onClick={() => setIsSellerApplicationExpanded(false)}>
                    {isAr ? "إخفاء طلب البائع" : "Hide Seller Application"}
                  </Button>
                ) : null}
              </>
            ))}
          </CardContent>
        </Card>

        {/* ── Find a Seller ── */}
        <Card className="border-white/10 bg-[#0B0B0B]/90">
          <CardHeader>
            <CardTitle>{isAr ? "ابحث عن بائع معتمد" : "Find an Approved Seller"}</CardTitle>
            <CardDescription>
              {isAr
                ? "تصفح البائعين المعتمدين وابدأ صفقة USDT آمنة ومُنسَّقة من خلال Alpha Exchange."
                : "Browse verified sellers and start a secure USDT trade coordinated through Alpha Exchange."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                <p className="mb-2 font-medium text-white">{isAr ? "كيف تشتري USDT:" : "How to buy USDT:"}</p>
                <ol className="list-inside list-decimal space-y-2">
                  <li>{isAr ? "تصفح" : "Browse the"} <a href="#marketplace" className="text-[#93C5FD] hover:underline">{isAr ? "السوق المباشر" : "Live Marketplace"}</a> {isAr ? "أعلاه" : "above"}</li>
                  <li>{isAr ? "اختر بائعًا موثقًا يناسب احتياجاتك" : "Choose a verified seller that fits your needs"}</li>
                  <li>{isAr ? "اضغط" : "Click"} <strong className="text-white">{isAr ? "شراء USDT" : "Buy USDT"}</strong> {isAr ? "على عرضه" : "on their listing"}</li>
                  <li>{isAr ? "أدخل تفاصيل الصفقة وأرسلها" : "Fill in your trade details and submit"}</li>
                  <li>{isAr ? "Alpha Traders تنسق الباقي" : "Alpha Traders coordinates the rest"}</li>
                </ol>
              </div>
              <a href="#marketplace">
                <Button className="w-full">{isAr ? "تصفح البائعين" : "Browse Sellers"}</Button>
              </a>
              <p className="text-center text-xs text-[#9CA3AF]">
                {isAr ? "هل تحتاج مساعدة؟" : "Need help?"}{" "}
                {WHATSAPP_URL ? <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="text-[#93C5FD] hover:underline">
                  {isAr ? "تواصل مع Alpha Traders على WhatsApp" : "Contact Alpha Traders on WhatsApp"}
                </a> : null}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      ) : null}

      {isApprovedSeller && showSellerWorkspace ? (
        <div className="mt-6 flex flex-col gap-5 xl:gap-6">
          {/* Seller Dashboard Hero */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0D0D0D] via-[#0A0A0A] to-[#111827]/60 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
            <div className="pointer-events-none absolute inset-0 opacity-30">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(201,162,39,0.18),transparent_40%),radial-gradient(circle_at_90%_80%,rgba(147,197,253,0.1),transparent_40%)]" />
            </div>
            <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-3 py-1.5 text-xs text-[#F4D87A]">
                  <span className="font-semibold uppercase tracking-[0.12em]">{isAr ? "حالة البائع" : "Seller Status"}</span>
                  <RoleBadge variant="approved_seller" locale={isAr ? "ar" : "en"} />
                  <span className="text-[#E5E7EB]">{isAr ? "بائع معتمد" : "Approved Seller"}</span>
                </div>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {isAr ? `مرحباً بعودتك، ${sessionUser?.fullName?.split(" ")[0] ?? "البائع"}` : `Welcome back, ${sessionUser?.fullName?.split(" ")[0] ?? "Seller"}`}
                </h2>
                <p className="mt-1 text-xs text-[#9CA3AF]">
                  {isAr ? "تاريخ الموافقة" : "Approval Date"}: {new Date((sellerApplication?.updatedAt ?? sessionUser?.createdAt) || Date.now()).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C9A227]/40 bg-[#C9A227]/10 px-3 py-1 text-xs font-medium text-[#F4D87A]">
                    <Trophy className="h-3 w-3" />
                    {isAr ? `بائع ${sellerLevelLabel(sellerOverviewStats.reputation?.level, true)}` : `${sellerLevelLabel(sellerOverviewStats.reputation?.level)} Seller`}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#93C5FD]/30 bg-[#93C5FD]/10 px-3 py-1 text-xs text-[#93C5FD]">
                    <ShieldCheck className="h-3 w-3" />
                    {isAr ? "الثقة" : "Trust"} {(sellerOverviewStats.reputation?.trustScore ?? 0).toFixed(1)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22C55E]/25 bg-[#22C55E]/10 px-3 py-1 text-xs text-[#86EFAC]">
                    <Star className="h-3 w-3" />
                    {(sellerOverviewStats.reputation?.rating ?? 0).toFixed(2)} {isAr ? "تقييم" : "Rating"}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3.5 text-xs text-[#D1D5DB] sm:min-w-[180px]">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "سوق اليوم" : "Today’s Market"}</p>
                <p className="mt-1 text-base font-semibold text-white">USDT/ILS {formatIls(marketPricePerUsdt)}</p>
                <div className="mt-2 space-y-0.5">
                  {sellerOverviewStats.activeListings > 0 && <p>• {sellerOverviewStats.activeListings} {isAr ? "عروض نشطة" : `Active Listing${sellerOverviewStats.activeListings !== 1 ? "s" : ""}`}</p>}
                  {sellerOverviewStats.pendingRequests > 0 && <p>• {sellerOverviewStats.pendingRequests} {isAr ? "طلبات شراء" : `Purchase Request${sellerOverviewStats.pendingRequests !== 1 ? "s" : ""}`}</p>}
                  {sellerOverviewStats.reputation?.completedTrades !== undefined && <p className="text-[#9CA3AF]">• {sellerOverviewStats.reputation.completedTrades} {isAr ? "إجمالي الصفقات" : "Total Trades"}</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {isWorkspaceWidgetsLoading
              ? Array.from({ length: 6 }).map((_, index) => (
                  <Card key={`seller-stat-skeleton-${index}`} className="border-white/10 bg-[#0B0B0B]/90">
                    <CardContent className="space-y-2.5 p-5">
                      <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
                      <div className="h-8 w-36 animate-pulse rounded bg-white/10" />
                    </CardContent>
                  </Card>
                ))
              : null}
            {!isWorkspaceWidgetsLoading
              ? [
              { label: isAr ? "العروض النشطة" : "Active Listings", value: sellerOverviewStats.activeListings.toLocaleString("en-IL"), icon: TrendingUp },
              { label: isAr ? "الصفقات المعلقة" : "Pending Trades", value: sellerOverviewStats.pendingRequests.toLocaleString("en-IL"), icon: MessageCircle },
              { label: isAr ? "مستوى البائع" : "Seller Level", value: sellerLevelLabel(sellerOverviewStats.reputation?.level, isAr), icon: Trophy },
              { label: isAr ? "درجة الثقة" : "Trust Score", value: (sellerOverviewStats.reputation?.trustScore ?? 0).toFixed(1), icon: ShieldCheck },
              { label: isAr ? "التقييم" : "Rating", value: (sellerOverviewStats.reputation?.rating ?? 0).toFixed(2), icon: Star },
              { label: isAr ? "حجم التداول الكلي" : "Lifetime Volume", value: `₪${sellerOverviewStats.revenueGenerated.toFixed(2)}`, icon: WalletCards },
              { label: isAr ? "متوسط وقت الاستجابة" : "Average Response Time", value: sellerOverviewStats.averageResponseTime, icon: Clock3 },
              { label: isAr ? "مشاهدات الملف" : "Profile Views", value: (sellerOverviewStats.reputation?.profileViews ?? 0).toLocaleString("en-IL"), icon: Users },
            ].map((stat) => (
              <Card key={stat.label} className="border-white/10 bg-[#0B0B0B]/90">
                <CardHeader className="pb-1.5">
                  <CardDescription className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em]">
                    <stat.icon className="h-3.5 w-3.5 text-[#C9A227]" />
                    {stat.label}
                  </CardDescription>
                  <CardTitle className="text-xl tracking-tight">{stat.value}</CardTitle>
                </CardHeader>
              </Card>
            )) : null}
          </div>

          <Card id="commission-status" tabIndex={-1} className={`order-15 scroll-mt-24 border-white/10 bg-[#0B0B0B]/90 ${sellerCommissionStatus?.status === "overdue" || sellerCommissionStatus?.status === "pending" ? "border-red-600/60" : ""}`}>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <LockKeyhole className="h-4 w-4 text-[#C9A227]" />
                {isAr ? "حالة العمولة" : "Commission Status"}
              </CardTitle>
              <CardDescription>
                {isAr ? "تتقاضى Alpha Traders عمولة بنسبة 1% على الصفقات المكتملة. تمنع العمولات غير المدفوعة إنشاء عروض جديدة أو تجديدها." : "Alpha Traders charges a 1% commission on completed trades. Pending commission payments block new listing creation and renewals."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {sellerCommissionStatus?.status === "overdue" || sellerCommissionStatus?.status === "pending" ? (
                <div className="rounded-2xl border border-red-600/60 bg-red-950/60 p-4 text-sm text-red-100">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                    <div className="flex-1 space-y-2">
                      <p className="font-semibold text-base">{sellerCommissionStatus.status === "overdue" ? (isAr ? "العمولة متأخرة" : "Commission Overdue") : (isAr ? "عمولة مستحقة" : "Commission Due")}</p>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-red-300">{isAr ? "المبلغ المستحق" : "Amount outstanding"}</span>
                          <span className="font-bold text-white text-sm">{formatUsdt(commissionTotalAmountDue)}</span>
                        </div>
                        {sellerCommissionStatus.relatedTradeDisplayNumber ? (
                          <div className="flex justify-between">
                            <span className="text-red-300">{isAr ? "مرجع الصفقة" : "Trade reference"}</span>
                            <span className="font-medium text-white">{isAr ? "الصفقة" : "Trade"} #{sellerCommissionStatus.relatedTradeDisplayNumber}</span>
                          </div>
                        ) : null}
                        {sellerCommissionStatus.dueAt ? (
                          <div className="flex justify-between">
                            <span className="text-red-300">{isAr ? "تاريخ الاستحقاق" : "Due date"}</span>
                            <span className="font-medium text-white">{new Date(sellerCommissionStatus.dueAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-4 text-sm text-emerald-100">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="font-medium">{isAr ? "لا توجد عمولة مستحقة — حسابك سليم." : "No commission due — you’re all clear."}</span>
                  </div>
                </div>
              )}
              {sellerWorkspaceSummary?.blockedReason ? (
                <p className="rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-xs text-red-100">⚠ {isAr && !containsArabicText(sellerWorkspaceSummary.blockedReason) ? "مساحة عمل البائع مقيدة حالياً. راجع حالة العمولة أو الامتثال." : sellerWorkspaceSummary.blockedReason}</p>
              ) : null}
              {commissionWorkspaceAction.kind === "pay-one" ? (
                <Button
                  type="button"
                  onClick={() => openCommissionPayment(commissionWorkspaceAction.commissionId)}
                  className="h-10 px-4 bg-red-600 hover:bg-red-700 text-white border-red-600"
                >
                  {isAr ? "ادفع الآن" : "Pay Now"}
                </Button>
              ) : null}
              {commissionWorkspaceAction.kind === "review-unpaid" ? (
                <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-sm font-medium text-amber-100">{isAr ? "اختر عمولة غير مدفوعة لتسديدها." : "Choose one unpaid commission to pay."}</p>
                  <div className="grid gap-2">
                    {(sellerCommissionStatus?.payableRecords ?? []).map((record) => (
                      <Button
                        key={record.commissionId}
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-auto min-h-10 justify-between px-3 text-start"
                        onClick={() => openCommissionPayment(record.commissionId)}
                      >
                        <span>
                          {record.relatedTradeDisplayNumber ? `${isAr ? "الصفقة" : "Trade"} #${record.relatedTradeDisplayNumber}` : (isAr ? "سجل العمولة" : "Commission record")}
                        </span>
                        <span className="text-[#FDE68A]">{formatUsdt(record.amountDue)}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {sellerCommissionStatus?.selectionError ? (
                <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                  {isAr && !containsArabicText(sellerCommissionStatus.selectionError) ? "تعذّر تحديد العمولة. اختر سجلاً غير مدفوع وحاول مرة أخرى." : sellerCommissionStatus.selectionError}
                </p>
              ) : null}
            </CardContent>
          </Card>
          {commissionPayOpen ? (
            <Card id="commission-payment" className="order-16 border-[#C9A227]/30 bg-[#0B0B0B]/98">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LockKeyhole className="h-4 w-4 text-[#C9A227]" />
                    {isAr ? "دفع العمولة" : "Commission Payment"}
                  </CardTitle>
                  <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-[#6B7280] hover:text-white" onClick={() => setCommissionPayOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {/* Amount badge */}
                <div className="flex items-center gap-3 rounded-xl border border-[#C9A227]/20 bg-[#C9A227]/5 px-4 py-3 mt-1">
                  <div className="flex-1">
                    <p className="text-xs text-[#9CA3AF]">{isAr ? "ادفع هذه العمولة" : "Pay this commission"}</p>
                    <p className="text-2xl font-bold text-white">{formatUsdt(commissionPayableAmountDue)}</p>
                  </div>
                  {sellerCommissionStatus?.relatedTradeDisplayNumber ? (
                    <div className="text-end">
                      <p className="text-xs text-[#9CA3AF]">{isAr ? "الصفقة" : "Trade"}</p>
                      <p className="text-sm font-medium text-[#C9A227]">#{sellerCommissionStatus.relatedTradeDisplayNumber}</p>
                    </div>
                  ) : null}
                </div>
                {sellerCommissionStatus && sellerCommissionStatus.pendingCount > 1 ? (
                  <p className="text-xs text-[#D1D5DB]">
                    {isAr ? `إجمالي المستحق ${formatUsdt(commissionTotalAmountDue)} موزع على ${sellerCommissionStatus.pendingCount} عمولات. هذه الدفعة تسدد الصفقة المحددة أعلاه فقط.` : `Total outstanding: ${formatUsdt(commissionTotalAmountDue)} across ${sellerCommissionStatus.pendingCount} commissions. This payment settles only the selected trade above.`}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-5">

                {/* ── Step 0: Payer type selection ── */}
                {!commissionPayerType ? (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-white">{isAr ? "كيف ستدفع العمولة؟" : "How are you paying your commission?"}</p>
                    <div className="grid gap-3">
                      {/* Personal Wallet */}
                      <button
                        type="button"
                        onClick={() => { setCommissionPayerType("personal"); setCommissionAdvancedOpen(false); }}
                        className="group flex w-full items-start gap-4 rounded-2xl border border-white/12 bg-white/[0.03] px-4 py-4 text-start transition-all hover:border-[#C9A227]/50 hover:bg-[#C9A227]/5"
                      >
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40 group-hover:border-emerald-400/60">
                          <Wallet className="h-5 w-5 text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white text-sm">{isAr ? "محفظة شخصية" : "Personal Wallet"}</p>
                          <p className="text-xs text-[#6B7280] mt-0.5">MetaMask · Phantom · Trust Wallet · Rabby · Ledger · Trezor</p>
                          <p className="text-xs text-[#9CA3AF] mt-2 leading-relaxed">{isAr ? "أرسل مباشرةً من محفظتك. ستحاول Alpha Traders اكتشاف دفعتك تلقائياً." : "Send directly from your wallet. Alpha Traders will attempt to detect your payment automatically."}</p>
                        </div>
                        <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-[#6B7280] group-hover:text-[#C9A227]" />
                      </button>
                      {/* Exchange / Broker */}
                      <button
                        type="button"
                        onClick={() => { setCommissionPayerType("exchange"); setCommissionAdvancedOpen(false); }}
                        className="group flex w-full items-start gap-4 rounded-2xl border border-white/12 bg-white/[0.03] px-4 py-4 text-start transition-all hover:border-[#C9A227]/50 hover:bg-[#C9A227]/5"
                      >
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-950/40 group-hover:border-blue-400/60">
                          <Building2 className="h-5 w-5 text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white text-sm">{isAr ? "منصة تداول أو وسيط" : "Crypto Exchange or Broker"}</p>
                          <p className="text-xs text-[#6B7280] mt-0.5">Binance · Bybit · OKX · Coinbase · Kraken · Bitget · MEXC</p>
                          <p className="text-xs text-[#9CA3AF] mt-2 leading-relaxed">{isAr ? "بعد الإرسال، الصق رمز معاملة السحب للتحقق من دفعتك." : "After sending, paste the withdrawal transaction hash to verify your payment."}</p>
                        </div>
                        <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-[#6B7280] group-hover:text-[#C9A227]" />
                      </button>
                    </div>
                    <Button type="button" variant="ghost" className="w-full text-[#6B7280] hover:text-white text-xs" onClick={() => setCommissionPayOpen(false)}>
                      {isAr ? "إلغاء" : "Cancel"}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* ── Back + payer type badge ── */}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => { setCommissionPayerType(null); setCommissionPayMessage(null); }} className="flex items-center gap-1 text-xs text-[#6B7280] hover:text-white transition-colors">
                        <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                        {isAr ? "رجوع" : "Back"}
                      </button>
                      <span className="text-[#6B7280]">·</span>
                      <span className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
                        {commissionPayerType === "personal" ? <><Wallet className="h-3.5 w-3.5 text-emerald-400" />{isAr ? "محفظة شخصية" : "Personal Wallet"}</> : <><Building2 className="h-3.5 w-3.5 text-blue-400" />{isAr ? "منصة / وسيط" : "Exchange / Broker"}</>}
                      </span>
                    </div>

                    {/* ── Network selector ── */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">{isAr ? "شبكة الدفع" : "Payment Network"}</p>
                      <div className="grid gap-2">
                        {COMMISSION_NETWORKS.map((net) => {
                          const selected = commissionNetwork === net.id;
                          const networkAvailable = Boolean(commissionWalletConfiguration?.[net.id]?.available && CLIENT_COMMISSION_WALLETS[net.id]);
                          return (
                            <button
                              key={net.id}
                              type="button"
                              disabled={!networkAvailable}
                              onClick={() => setCommissionNetwork(net.id)}
                              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-start transition-all ${networkAvailable ? (selected ? "border-[#C9A227] bg-[#C9A227]/10 text-white" : "border-white/12 bg-black/20 text-[#9CA3AF] hover:border-white/25 hover:text-white") : "cursor-not-allowed border-red-500/30 bg-red-950/20 text-red-200 opacity-75"}`}
                            >
                              <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-[#C9A227]" : "border-white/30"}`}>
                                {selected ? <div className="h-2 w-2 rounded-full bg-[#C9A227]" /> : null}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium">{net.label}</span>
                                {net.recommended ? <span className="ms-2 text-xs text-[#C9A227]">⭐ {isAr ? "موصى بها" : "Recommended"}</span> : null}
                                {!networkAvailable ? <span className="ms-2 text-xs text-red-200">{isAr ? "غير متاحة" : "Unavailable"}</span> : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Recipient address + QR ── */}
                    {selectedCommissionWalletAvailable ? (
                      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                        <p className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
                          {isAr ? "إرسال إلى" : "Send To"} · {COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork}
                        </p>
                        <div className="flex items-center gap-2">
                          <code dir="ltr" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-left text-xs font-mono text-white break-all select-all">
                            {selectedCommissionWallet}
                          </code>
                          <Button
                            type="button" size="sm" variant="secondary"
                            className="shrink-0 h-8 w-8 p-0"
                            onClick={() => { void navigator.clipboard.writeText(selectedCommissionWallet); setCommissionCopied(true); window.setTimeout(() => setCommissionCopied(false), 2000); }}
                          >
                            {commissionCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                        {commissionQrDataUrl ? (
                          <div className="flex justify-center pt-1">
                            <div className="rounded-xl bg-white p-3 shadow-lg">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={commissionQrDataUrl} alt={isAr ? `رمز QR لعنوان USDT على شبكة ${commissionNetwork}` : `QR code for ${commissionNetwork} USDT address`} className="h-36 w-36" />
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-center">
                            <div className="flex h-[168px] w-[168px] items-center justify-center rounded-xl border border-white/10 bg-black/30">
                              <Loader2 className="h-6 w-6 animate-spin text-[#C9A227]" />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-300">
                        {selectedCommissionWalletError}
                      </p>
                    )}

                    {/* ── Instructions panel ── */}
                    {commissionPayerType === "personal" ? (
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-4 space-y-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-emerald-300 uppercase tracking-wider">
                          <Wallet className="h-3.5 w-3.5" />
                          {isAr ? "الإرسال من محفظة شخصية" : "Sending from a Personal Wallet"}
                        </p>
                        <ol className="space-y-2">
                          {[
                            isAr ? "افتح محفظتك واضغط على إرسال أو تحويل." : "Open your wallet and tap Send or Transfer.",
                            isAr ? `اختر شبكة ${COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork}.` : `Select the ${COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork} network.`,
                            isAr ? "اختر USDT كعملة الإرسال." : "Select USDT as the token.",
                            isAr ? "الصق عنوان عمولة Alpha Traders الظاهر أعلاه." : "Paste the Alpha Traders commission address above.",
                            isAr ? `أدخل المبلغ الدقيق: ${formatUsdt(commissionPayableAmountDue)}.` : `Enter the exact amount: ${formatUsdt(commissionPayableAmountDue)}.`,
                            isAr ? "أكد الإرسال وانتظر تأكيد المعاملة." : "Confirm and send. Wait for the transaction to be confirmed.",
                          ].map((step, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-xs text-[#D1D5DB]">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-950/60 text-emerald-400 text-[10px] font-bold">
                                {i + 1}
                              </span>
                              {step}
                            </li>
                          ))}
                        </ol>
                        <p className="text-xs text-[#6B7280] pt-1">
                          {isAr ? "⚠️ تأكد أن المعاملة إرسال USDT وليست مبادلة أو إيداعاً أو تفاعلاً آخر مع عقد." : "⚠️ Make sure the transaction is a USDT send — not a swap, deposit, or any other contract interaction."}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-blue-500/20 bg-blue-950/20 p-4 space-y-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-blue-300 uppercase tracking-wider">
                          <Building2 className="h-3.5 w-3.5" />
                          {isAr ? "الإرسال من منصة تداول أو وسيط" : "Sending from an Exchange or Broker"}
                        </p>
                        <ol className="space-y-2">
                          {[
                            isAr ? `انتقل إلى صفحة السحب أو الإرسال في المنصة واختر USDT على شبكة ${COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork}.` : `Go to your exchange's Withdraw or Send page and select USDT on ${COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork}.`,
                            isAr ? "الصق عنوان عمولة Alpha Traders كمستلم." : "Paste the Alpha Traders commission address as the recipient.",
                            isAr ? `أدخل المبلغ الدقيق: ${formatUsdt(commissionPayableAmountDue)}.` : `Enter the exact amount: ${formatUsdt(commissionPayableAmountDue)}.`,
                            isAr ? "أكد السحب وانتظر تأكيد شبكة البلوك تشين." : "Confirm the withdrawal and wait for blockchain confirmation.",
                            isAr ? "انسخ رمز معاملة السحب من سجل المنصة." : "Copy the withdrawal transaction hash from your exchange history.",
                            isAr ? "الصقه أدناه واضغط على التحقق." : "Paste it below and click Verify.",
                          ].map((step, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-xs text-[#D1D5DB]">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-blue-500/40 bg-blue-950/60 text-blue-400 text-[10px] font-bold">
                                {i + 1}
                              </span>
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* ── Transaction hash ── */}
                    {commissionPayerType === "personal" ? (
                      <div>
                        <button
                          type="button"
                          onClick={() => setCommissionAdvancedOpen((v) => !v)}
                          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-[#9CA3AF] hover:text-white transition-colors"
                        >
                          <span className="font-medium">{isAr ? "تحقق يدوي — الصق رمز المعاملة" : "Manual Verification — paste transaction hash"}</span>
                          {commissionAdvancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        {commissionAdvancedOpen ? (
                          <div className="mt-2 space-y-1 rounded-xl border border-white/8 bg-black/20 px-4 py-3">
                            <Input
                              dir="ltr"
                              placeholder={isAr ? "0x… أو توقيع Solana" : "0x… or Solana signature"}
                              value={commissionTxSignature}
                              onChange={(event) => setCommissionTxSignature(event.target.value)}
                             onPaste={(event) => {
                               event.preventDefault();
                               setCommissionTxSignature(normalizeTransactionHash(event.clipboardData.getData("text")));
                             }}
                             className="text-left font-mono text-xs"
                           />
                           <p className="text-xs text-[#6B7280]">
                             {isAr ? "ستجده في نشاط المحفظة أو سجل المعاملات. يجب أن يكون معاملة إرسال USDT، وليس مبادلة أو صفقة أو تفاعلاً آخر." : "Find this in your wallet’s Activity or Transaction History. It must be the USDT send transaction — not a swap, trade, or other interaction."}
                           </p>
                         </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">{isAr ? "رمز المعاملة" : "Transaction Hash"}</p>
                        <Input
                         dir="ltr"
                         placeholder={isAr ? "0x… أو توقيع Solana" : "0x… or Solana signature"}
                         value={commissionTxSignature}
                         onChange={(event) => setCommissionTxSignature(event.target.value)}
                         onPaste={(event) => {
                           event.preventDefault();
                           setCommissionTxSignature(normalizeTransactionHash(event.clipboardData.getData("text")));
                         }}
                         className="text-left font-mono text-xs"
                        />
                        <p className="text-xs text-[#6B7280]">{isAr ? "انسخ هذا الرمز من سجل السحب في المنصة بعد تأكيد المعاملة." : "Copy this from your exchange withdrawal history after the transaction is confirmed."}</p>
                      </div>
                    )}

                    {/* ── Error / success message ── */}
                    {commissionPayMessage ? (
                      (() => {
                        const msg = commissionPayMessage;
                        if (msg.startsWith("✅")) {
                          return (
                            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                              <span>{isAr && !containsArabicText(msg) ? "تم التحقق من دفع العمولة بنجاح." : msg.replace("✅ ", "")}</span>
                            </div>
                          );
                        }
                        const wrongNetwork = msg.match(/found on (\w+), not (\w+)/i);
                        if (wrongNetwork) {
                          return (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs space-y-1 text-amber-100">
                              <p className="flex items-center gap-1.5 font-semibold text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                {isAr ? `تم العثور على المعاملة على شبكة ${wrongNetwork[1]}` : `Transaction found on ${wrongNetwork[1]}`}
                              </p>
                              <p>{isAr ? <>اختر <strong>{wrongNetwork[1]}</strong> كشبكة الدفع ثم أرسل المعاملة مرة أخرى.</> : <>Please select <strong>{wrongNetwork[1]}</strong> as your payment network and submit the transaction again.</>}</p>
                            </div>
                          );
                        }
                        if (msg.includes("but not the supported USDT contract") || msg.includes("send USDT (not USDC")) {
                          return (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs space-y-1 text-amber-100">
                              <p className="flex items-center gap-1.5 font-semibold text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                {isAr ? "تم اكتشاف عملة غير صحيحة" : "Wrong token detected"}
                              </p>
                              <p>{isAr ? "نقلت هذه المعاملة عملة مختلفة. يجب دفع العمولة بعملة USDT." : "This transaction transferred a different token. Commission must be paid in USDT."}</p>
                            </div>
                          );
                        }
                        if (msg.includes("does not include any transfer to or from the Alpha Traders commission wallet") || msg.includes("Please verify you submitted the correct transaction hash")) {
                          return (
                            <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs space-y-1 text-red-100">
                              <p className="flex items-center gap-1.5 font-semibold text-red-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                {isAr ? "هذه المعاملة ليست دفعة العمولة" : "Transaction is not your commission payment"}
                              </p>
                              <p>{isAr ? "تم العثور على المعاملة، لكنها لا تتضمن تحويلاً إلى محفظة عمولات Alpha Traders. أرسل رمز المعاملة الدقيق لدفعة USDT الموضحة أعلاه." : "We found this transaction, but it does not include a transfer to the Alpha Traders commission wallet. Please submit the exact transaction hash from when you sent the USDT payment above."}</p>
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                            <span>{isAr && !containsArabicText(msg) ? "تعذّر التحقق من الدفعة. تأكد من التفاصيل وحاول مرة أخرى." : msg}</span>
                          </div>
                        );
                      })()
                    ) : null}

                    {/* ── Actions ── */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        disabled={commissionPayBusy || !commissionTxSignature.trim() || !selectedCommissionWalletAvailable}
                        onClick={() => void handleCommissionPayNow()}
                        className="bg-[#C9A227] hover:bg-[#B8911F] text-black font-semibold border-[#C9A227]"
                      >
                        {commissionPayBusy ? <><Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />{isAr ? "جارٍ التحقق…" : "Verifying…"}</> : (isAr ? "التحقق من الدفع" : "Verify Payment")}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setCommissionPayOpen(false)}>
                        {isAr ? "إلغاء" : "Cancel"}
                      </Button>
                    </div>
                  </div>
                )}

              </CardContent>
            </Card>
          ) : null}

          <Card id="create-listing" className="order-30 border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>{isAr ? "إنشاء عرض جديد" : "Create Listing"}</CardTitle>
              <CardDescription>
                {isAr ? "يتم إرسال العرض للمراجعة أولًا قبل نشره في السوق." : "Listings are submitted to owner review before publishing live."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {listingCreationBlocked ? (
                <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                  <p className="font-semibold">{isAr ? "إنشاء العروض متوقف حالياً" : "Listing creation is currently blocked"}</p>
                  <p className="mt-1 text-xs text-[#FDE68A]">{isAr && !containsArabicText(listingCreationBlockedReason) ? "راجع العروض النشطة أو العمولات أو حالة الامتثال لمعرفة الإجراء المطلوب." : listingCreationBlockedReason}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {listingBlockedByActiveLimit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void scrollToMyListingsSection();
                        }}
                      >
                        {isAr ? "إدارة العروض" : "Manage Listings"}
                      </Button>
                    ) : null}
                    {listingBlockedByCommission && commissionWorkspaceAction.kind === "pay-one" ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => openCommissionPayment(commissionWorkspaceAction.commissionId)}>
                        {isAr ? "ادفع الآن" : "Pay Now"}
                      </Button>
                    ) : null}
                    {listingBlockedByCommission && commissionWorkspaceAction.kind === "review-unpaid" ? (
                      <Button type="button" size="sm" variant="secondary" onClick={reviewPayableCommissions}>
                        {isAr ? "مراجعة العمولات غير المدفوعة" : "Review Unpaid Commissions"}
                      </Button>
                    ) : null}
                    {listingBlockedByMarketplaceEnforcement ? (
                      <Button type="button" size="sm" variant="secondary" onClick={openMarketplaceCompliancePayment}>
                        {isAr ? "فتح امتثال السوق" : "Open Marketplace Compliance"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className={`mb-4 rounded-2xl border p-4 text-sm text-[#E5E7EB] transition-all duration-200 ${listingCreateGuardCardTone}`}>
                <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">{isAr ? "حماية سعر السوق المباشر" : "Live Market Price Guard"}</p>
                <p className={`mt-1 text-xs ${marketSnapshot?.status === "live" ? "text-emerald-300" : "text-amber-200"}`}>
                  {marketSnapshot?.status === "live" ? (isAr ? "مباشر" : "LIVE") : (isAr ? "السوق غير متاح مؤقتاً — يتم استخدام آخر سعر معروف." : "Market temporarily unavailable — using last known price.")}
                </p>
                <div className="mt-2 space-y-1">
                  <p>1 USDT = <span className="font-semibold text-white">{formatIls(marketPricePerUsdt)}</span></p>
                  <p>{isAr ? "أقصى سعر للعرض" : "Maximum listing price"}: <span className="font-semibold text-white">{formatIls(maxAllowedListingPrice)}</span></p>
                  {listingCreateAmount > 0 ? <p>{listingCreateAmount.toLocaleString("en-IL")} USDT ≈ <span className="font-semibold text-white">{formatIls(listingCreateAmount * marketPricePerUsdt)}</span></p> : null}
                </div>
              </div>
              <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSellerListingCreateSubmit}>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-available" required>{isAr ? "USDT المتاح" : "Available USDT"}</FieldLabel>
                  <Input
                    id="create-available"
                    placeholder={isAr ? "مثال: 25,000" : "e.g. 25,000"}
                    value={listingCreateForm.availableAmount}
                    onChange={(event) => {
                      const nextAmount = formatIntegerForInput(event.target.value);
                      setListingCreateForm((prev) => ({ ...prev, availableAmount: nextAmount, maximumTrade: nextAmount }));
                    }}
                    aria-required
                    className={cn("h-11", requiredFieldClasses({ value: listingCreateForm.availableAmount, required: true }))}
                  />
                  <p className="text-xs text-[#9CA3AF]">{isAr ? "يتم التنسيق تلقائيًا أثناء الكتابة." : "Amount is auto-formatted while typing (e.g. 25,000)."}</p>
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-price" required>{isAr ? "السعر" : "Price"}</FieldLabel>
                  <Input
                    id="create-price"
                    placeholder={isAr ? "السعر لكل USDT" : "Price per USDT"}
                    value={listingCreateForm.price}
                    onChange={(event) => setListingCreateForm((prev) => ({ ...prev, price: normalizeDecimalInput(event.target.value) }))}
                    aria-required
                    aria-invalid={listingCreatePriceInvalid || undefined}
                    className={cn("h-11 transition-all duration-200", requiredFieldClasses({ value: listingCreateForm.price, required: true, invalid: listingCreatePriceInvalid }))}
                  />
                  <p className={`text-xs transition-colors duration-200 ${
                    listingCreatePriceInvalid ? "text-red-300" : listingCreatePriceValid ? "text-emerald-300" : "text-[#9CA3AF]"
                  }`}>
                    {listingCreatePriceInvalid
                      ? (isAr ? `السعر يتجاوز الحد الأقصى المسموح (${formatIls(maxAllowedListingPrice)}).` : `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)}).`)
                      : listingCreatePriceValid
                        ? (isAr ? `السعر صالح. الحد الأقصى المسموح هو ${formatIls(maxAllowedListingPrice)}.` : `Valid price. Maximum allowed is ${formatIls(maxAllowedListingPrice)}.`)
                        : (isAr ? `أدخل سعراً لا يتجاوز ${formatIls(maxAllowedListingPrice)}.` : `Enter a price up to ${formatIls(maxAllowedListingPrice)}.`)}
                  </p>
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-currency" required>{isAr ? "العملة" : "Currency"}</FieldLabel>
                  <Input
                    id="create-currency"
                    placeholder="ILS"
                    value={listingCreateForm.currency}
                    onChange={(event) => {
                      setListingCreateCurrencyManualOverride(true);
                      setListingCreateForm((prev) => ({ ...prev, currency: formatIntegerForInput(event.target.value) }));
                    }}
                    className="h-11"
                  />
                  <p className={`text-xs ${listingCreateCurrencyManualOverride ? "text-amber-300" : "text-emerald-300"}`}>
                    {listingCreateCurrencyManualOverride ? (isAr ? "إدخال يدوي" : "Manual Override") : (isAr ? "محسوب تلقائياً" : "Auto Calculated")}
                  </p>
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-network" required>{isAr ? "الشبكة" : "Network"}</FieldLabel>
                  <select id="create-network" className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white transition focus:border-[#C9A227]/60 focus:outline-none focus:ring-2 focus:ring-[#C9A227]/30" value={listingCreateForm.network} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, network: event.target.value as SupportedNetwork }))}>
                    <option value="TRC20">TRC20</option>
                    <option value="ERC20">ERC20</option>
                    <option value="BEP20">BEP20</option>
                    <option value="SOL">SOL</option>
                  </select>
                </div>
                <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <FieldLabel required>{isAr ? "طريقة الدفع" : "Payment Method"}</FieldLabel>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    {MARKETPLACE_PAYMENT_METHODS.map((method) => {
                      const selected = listingCreateSelectedMethods.includes(method);
                      return (
                        <button
                          key={`create-method-${method}`}
                          type="button"
                          onClick={() => setListingCreateForm((prev) => {
                            const nextMethods = toggleSelection(prev.paymentMethods, method, MAX_LISTING_PAYMENT_METHODS);
                            return {
                              ...prev,
                              paymentMethods: nextMethods,
                              bankName: requiresBankSelection(nextMethods) ? prev.bankName : "",
                            };
                          })}
                          className={`rounded-xl border p-3 text-start transition-all duration-200 ${
                            selected
                              ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                              : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                          }`}
                        >
                          <p className="text-sm font-medium text-white">{paymentMethodEmoji(method)} {paymentMethodLabel(method, isAr)}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? `اختر حتى ${MAX_LISTING_PAYMENT_METHODS} طرق. يختار المشتري طريقة واحدة عند فتح الصفقة.` : `Select up to ${MAX_LISTING_PAYMENT_METHODS} methods. Buyers choose one method when they open the trade.`}</p>
                  <p className="mt-2 text-xs text-[#D1D5DB]">{isAr ? <>راجع إرشادات أمان الدفع في <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">مركز الأمان والثقة</Link>.</> : <>Review payment safety guidance in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</>}</p>
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-min-trade" required>{isAr ? "أدنى صفقة" : "Minimum Trade"}</FieldLabel>
                  <Input
                    id="create-min-trade"
                    placeholder={isAr ? "أدنى مبلغ" : "Smallest amount"}
                    value={listingCreateForm.minimumTrade}
                    onChange={(event) => setListingCreateForm((prev) => ({ ...prev, minimumTrade: formatIntegerForInput(event.target.value) }))}
                    aria-required
                    className={cn("h-11", requiredFieldClasses({ value: listingCreateForm.minimumTrade, required: true }))}
                  />
                  <p className="text-xs text-[#9CA3AF]">{isAr ? "أصغر مبلغ صفقة تقبله." : "The smallest trade amount you are willing to accept."}</p>
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="create-max-trade" required>{isAr ? "أقصى صفقة" : "Maximum Trade"}</FieldLabel>
                  <Input
                    id="create-max-trade"
                    placeholder={isAr ? "أكبر مبلغ" : "Largest amount"}
                    value={listingCreateForm.maximumTrade}
                    onChange={(event) => setListingCreateForm((prev) => {
                      const listedAmount = toNumber(prev.availableAmount);
                      if (listedAmount <= 0) {
                        return { ...prev, maximumTrade: "" };
                      }
                      const requestedMax = toNumber(formatIntegerForInput(event.target.value));
                      const clampedMax = Math.min(requestedMax || 0, listedAmount);
                      return { ...prev, maximumTrade: clampedMax > 0 ? formatIntegerForInput(clampedMax) : "" };
                    })}
                    aria-required
                    aria-invalid={listingCreateTradeRangeInvalid || undefined}
                    className={cn("h-11", requiredFieldClasses({ value: listingCreateForm.maximumTrade, required: true, invalid: listingCreateTradeRangeInvalid }))}
                  />
                  <p className="text-xs text-[#9CA3AF]">{isAr ? "لا يمكن أن يتجاوز مبلغ USDT المعروض." : "Maximum trade cannot exceed your listed USDT amount."}</p>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <FieldLabel htmlFor="create-description" optional optionalLabel={isAr ? "اختياري" : "optional"}>{isAr ? "وصف البائع" : "Seller Description"}</FieldLabel>
                  <Textarea id="create-description" className="min-h-[96px]" placeholder={isAr ? "أخبر المشترين عن شروطك" : "Tell buyers about your terms"} value={listingCreateForm.sellerDescription} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, sellerDescription: event.target.value }))} />
                </div>
                {listingCreateRequiresBank ? (
                <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <FieldLabel required>{isAr ? "البنوك المدعومة" : "Supported banks"}</FieldLabel>
                  <p className="mt-1 text-xs text-[#D1D5DB]">{isAr ? `اختر حتى ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} بنوك للتحويل البنكي أو السحب بلا بطاقة.` : `Select up to ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} banks for bank transfer or cardless ATM listings.`}</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {ISRAELI_BANKS.map((bank) => {
                      const selected = listingCreateSelectedBanks.includes(bank.name);
                      return (
                        <button
                          key={bank.id}
                          type="button"
                          onClick={() => setListingCreateForm((prev) => {
                            const nextBanks = toggleSelection(parseIsraeliBankSelection(prev.bankName), bank.name, MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS);
                            return { ...prev, bankName: serializeIsraeliBankSelection(nextBanks) };
                          })}
                          className={`rounded-xl border p-3 text-start transition-all duration-200 ${
                            selected
                              ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                              : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-black/35">
                              {renderBankLogo(bank)}
                            </span>
                            <div>
                              <p className="text-sm font-medium text-white">{getIsraeliBankDisplayName(bank.name, locale)}</p>
                              <p className="text-[11px] text-[#9CA3AF]">{bank.code}</p>
                            </div>
                          </div>
                          {selected ? <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#93C5FD]">{isAr ? "محدد" : "Selected"}</p> : null}
                        </button>
                      );
                    })}
                  </div>
                  {listingCreateSelectedBanks.length ? <p className="mt-2 text-xs text-[#93C5FD]">{isAr ? "المحدد" : "Selected"}: {listingCreateSelectedBanks.map((bankName) => getIsraeliBankDisplayName(bankName, locale)).join(isAr ? "، " : ", ")}</p> : null}
                </div>
                ) : null}
                {listingCreateRequiresBankAccount ? (
                <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <FieldLabel required>{isAr ? "حساب البنك لاستلام الدفع" : "Payout bank account"}</FieldLabel>
                  {sellerBankAccountsLoading ? (
                    <p className="mt-2 text-xs text-[#D1D5DB]">{isAr ? "جارٍ تحميل الحسابات البنكية..." : "Loading saved bank accounts..."}</p>
                  ) : sellerBankAccounts.length === 0 ? (
                    <p className="mt-2 text-xs text-amber-300">
                      {isAr ? "لا توجد حسابات بنكية محفوظة. أضف حسابًا في" : "No saved bank accounts found. Add one in"} <a href={`/${locale}/settings?tab=profile#seller-bank-accounts`} className="text-[#93C5FD] underline underline-offset-2">{isAr ? "الإعدادات" : "Settings"}</a>.
                    </p>
                  ) : (
                    <>
                      <select
                        className="mt-2 flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white"
                        value={listingCreateForm.bankAccountId}
                        onChange={(event) => setListingCreateForm((prev) => {
                          const bankAccountId = event.target.value;
                          const selectedAccount = sellerBankAccounts.find((account) => account.id === bankAccountId);
                          const nextBanks = ensurePayoutBankIsSupported(
                            parseIsraeliBankSelection(prev.bankName),
                            selectedAccount?.bankName,
                            MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS,
                          );
                          return {
                            ...prev,
                            bankAccountId,
                            bankName: serializeIsraeliBankSelection(nextBanks),
                          };
                        })}
                      >
                        <option value="">{isAr ? "اختر الحساب البنكي" : "Select bank account"}</option>
                        {sellerBankAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {`${getIsraeliBankDisplayName(account.bankName, locale)} • ${account.maskedAccountNumber ?? `****${account.accountLast4}`}${account.isDefault ? (isAr ? " (افتراضي)" : " (Default)") : ""}`}
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? "رقم الحساب الكامل يظل مخفيًا عن المشترين حتى بداية الصفقة." : "Your full account number stays hidden from buyers until the trade starts."}</p>
                    </>
                  )}
                </div>
                ) : null}
                <div className="md:col-span-2 rounded-2xl border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 p-4 text-sm text-[#E5E7EB]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#93C5FD]">{isAr ? "القيمة الإجمالية المباشرة" : "Live total value"}</p>
                  <p className="mt-1">{listingCreateAmount.toLocaleString("en-IL")} USDT</p>
                  <p className="mt-1">× {formatIls(listingCreatePrice || 0)} = <span className="font-semibold text-white">{formatIls(listingCreateTotalIls)}</span></p>
                </div>
                <div className="md:col-span-2 rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/10 p-4 text-sm text-[#F3F4F6]">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#F4D87A]">{isAr ? "عمولة المنصة" : "Platform Commission"}</p>
                  <p className="mt-1">{isAr ? "تتقاضى Alpha Traders عمولة بنسبة 1% على الصفقات المكتملة. بنشر هذا العرض، توافق على دفع عمولة المنصة بعد نجاح الصفقة." : "Alpha Traders charges a 1% commission on completed trades. By publishing this listing, you agree to pay the platform commission after a successful trade."}</p>
                  <label className="mt-3 inline-flex cursor-pointer items-start gap-2 text-xs text-[#E5E7EB]">
                    <input
                      type="checkbox"
                      checked={listingCommissionAgreement}
                      onChange={(event) => setListingCommissionAgreement(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]"
                    />
                    <span>{isAr ? "أفهم وأوافق على سياسة عمولة Alpha Traders البالغة 1%." : "I understand and agree to Alpha Traders’ 1% commission policy."}</span>
                  </label>
                  <p className="mt-2 text-xs text-[#D1D5DB]">{isAr ? <>اقرأ السياسة كاملة في <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">مركز الأمان والثقة</Link>.</> : <>Read full policy in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</>}</p>
                </div>
                <div className={`md:col-span-2 rounded-2xl border p-4 transition-all duration-200 ${listingCreateGuardTone}`}>
                  <div className="flex items-start gap-2">
                    {listingCreatePriceInvalid ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">
                        {listingCreatePriceInvalid ? (isAr ? `السعر يتجاوز الحد الأقصى المسموح (${formatIls(maxAllowedListingPrice)})` : `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)})`) : (isAr ? "حماية سعر السوق مفعلة" : "Market guard active")}
                      </p>
                      <p>{isAr ? "سعر السوق الحالي" : "Current market"}: {formatIls(marketPricePerUsdt)} {isAr ? "لكل 1 USDT" : "per 1 USDT"}</p>
                      <p>{isAr ? "الحد الأقصى المسموح" : "Maximum allowed"}: {formatIls(maxAllowedListingPrice)}</p>
                      {listingCreateTradeRangeInvalid ? <p className="text-amber-200">{isAr ? "يجب أن يكون الحد الأقصى للصفقة أكبر من الحد الأدنى وألا يتجاوز كمية USDT المتاحة." : "Maximum trade must be greater than minimum trade and less than or equal to available USDT."}</p> : null}
                      {listingCreateRequiresBank && !listingCreateSelectedBanks.length ? <p className="text-amber-200">{isAr ? "اختر بنكاً واحداً أو بنكين مدعومين قبل الإرسال." : "Select one or two supported banks before submitting."}</p> : null}
                      {listingCreateRequiresBankAccount && !listingCreateForm.bankAccountId ? <p className="text-amber-200">{isAr ? "اختر حساباً بنكياً واحداً لاستلام الدفعات قبل الإرسال." : "Select one payout bank account before submitting."}</p> : null}
                      {listingCreateBankAccountMismatch ? (
                        <p className="text-red-200">
                          {listingCreateSelectedBankAccount
                            ? (isAr ? `يجب أن تشمل البنوك المدعومة بنك استلام الدفعات (${getIsraeliBankDisplayName(listingCreateSelectedBankAccount.bankName, "ar")}).` : `Supported banks must include your payout bank (${getIsraeliBankDisplayName(listingCreateSelectedBankAccount.bankName, "en")}).`)
                            : (isAr ? "حساب استلام الدفعات المحدد لم يعد متاحاً. اختر حساباً بنكياً محفوظاً مرة أخرى." : "Your selected payout bank account is no longer available. Choose a saved bank account again.")}
                        </p>
                      ) : null}
                      {!listingCommissionAgreement ? <p className="text-amber-200">{isAr ? "يجب الموافقة على سياسة العمولة بنسبة 1% قبل النشر." : "You must accept the 1% commission policy before publishing."}</p> : null}
                      {listingCreateAmount > 0 ? <p>{listingCreateAmount.toLocaleString("en-IL")} USDT ≈ {formatIls(listingCreateAmount * marketPricePerUsdt)}</p> : null}
                    </div>
                  </div>
                </div>
                {listingCreateResult ? (
                  <div
                    id="listing-publish-result"
                    tabIndex={-1}
                    role={listingCreateResult.tone === "error" ? "alert" : "status"}
                    aria-live={listingCreateResult.tone === "error" ? "assertive" : "polite"}
                    className={cn(
                      "md:col-span-2 flex items-start justify-between gap-3 rounded-xl border p-4 text-sm shadow-[0_0_0_1px_rgba(255,255,255,0.03)] animate-in fade-in-0 slide-in-from-top-1 duration-300",
                      listingCreateResult.tone === "error"
                        ? "border-red-500/45 bg-red-950/35 text-red-100"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
                    )}
                  >
                    <span className="flex items-start gap-2">
                      {listingCreateResult.tone === "error" ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                      )}
                      <span>{isAr && !containsArabicText(listingCreateResult.message) ? (listingCreateResult.tone === "error" ? "تعذّر نشر العرض. راجع الحقول وحاول مرة أخرى." : "تم إرسال العرض للمراجعة بنجاح.") : listingCreateResult.message}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={isAr ? "إغلاق نتيجة نشر العرض" : "Dismiss listing result"}
                      onClick={() => setListingCreateResult(null)}
                      className={cn(
                        "shrink-0 rounded-full p-0.5 transition hover:text-white",
                        listingCreateResult.tone === "error" ? "text-red-300" : "text-emerald-300",
                      )}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
                <div className="md:col-span-2">
                  <Button type="submit" className="h-11 w-full sm:w-auto" disabled={isListingCreateSubmitDisabled || listingActionKey === "create:new"}>
                    {listingActionKey === "create:new" ? (isAr ? "جارٍ النشر..." : "Publishing...") : (isAr ? "إرسال العرض" : "Submit Listing")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {sellerWorkspaceMessage ? (
            <div id="listing-publish-result" tabIndex={-1} role="status" aria-live="polite" className="order-25 flex items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.08)] animate-in fade-in-0 slide-in-from-top-1 duration-300">
              <span>{isAr && !containsArabicText(sellerWorkspaceMessage) ? "تم تحديث مساحة عمل البائع بنجاح." : sellerWorkspaceMessage}</span>
              <button
                type="button"
                aria-label={isAr ? "إغلاق" : "Dismiss"}
                onClick={() => setSellerWorkspaceMessage(null)}
                className="shrink-0 rounded-full p-0.5 text-emerald-300 transition hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <Card id="purchase-requests-section" tabIndex={-1} className="order-5 scroll-mt-24 border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>{isAr ? "طلبات الشراء" : "Purchase Requests"}</CardTitle>
              <CardDescription>{isAr ? "إدارة طلبات المشترين الواردة لك." : "Manage incoming buyer purchase requests."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Input placeholder={isAr ? "ابحث بمعرّف الصفقة أو المشتري أو العرض..." : "Search by trade ID, buyer, listing..."} value={sellerTradeQuery} onChange={(event) => setSellerTradeQuery(event.target.value)} />
                <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={sellerTradeStatus} onChange={(event) => setSellerTradeStatus(event.target.value as typeof sellerTradeStatus)}>
                  <option value="all">{isAr ? "الحالة: الكل" : "Status: All"}</option>
                  <option value="pending">{tradeStatusLabel("pending", isAr)}</option>
                  <option value="accepted">{tradeStatusLabel("accepted", isAr)}</option>
                  <option value="payment_sent">{tradeStatusLabel("payment_sent", isAr)}</option>
                  <option value="funds_received">{tradeStatusLabel("funds_received", isAr)}</option>
                  <option value="usdt_release_pending">{tradeStatusLabel("usdt_release_pending", isAr)}</option>
                  <option value="usdt_sent">{tradeStatusLabel("usdt_sent", isAr)}</option>
                  <option value="review_open">{tradeStatusLabel("review_open", isAr)}</option>
                  <option value="declined">{tradeStatusLabel("declined", isAr)}</option>
                  <option value="cancelled">{tradeStatusLabel("cancelled", isAr)}</option>
                </select>
              </div>
              {isWorkspaceWidgetsLoading ? (
                Array.from({ length: 2 }).map((_, index) => (
                  <div key={`seller-requests-skeleton-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
                    <div className="mt-3 h-4 w-full animate-pulse rounded bg-white/10" />
                    <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-white/10" />
                  </div>
                ))
              ) : null}
              {!isWorkspaceWidgetsLoading && sellerRequests.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center">
                  <MessageCircle className="mx-auto h-5 w-5 text-[#C9A227]" />
                  <p className="mt-2 text-sm font-medium text-white">{isAr ? "لا توجد طلبات شراء قيد الانتظار" : "No purchase requests yet."}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "عند استلام أول طلب شراء، ستتمكن من الرد عليه فورًا من هنا." : "Your next buyer request will appear here with quick actions to accept, decline, or continue the trade."}</p>
                </div>
              ) : null}
              {(sellerRequestSections.action.length || sellerRequestSections.active.length || sellerRequestSections.waiting.length) ? (
                <div className="space-y-3">
                  {sellerRequestSections.action.length ? (
                    <div className="rounded-xl border border-[#C9A227]/35 bg-[#C9A227]/10 px-3 py-2 text-xs font-medium text-[#FDE68A]">
                      {isAr ? "تحتاج إلى إجراء منك" : "Requires Your Action"} · {sellerRequestSections.action.length}
                    </div>
                  ) : null}
                  {sellerRequestSections.active.length ? (
                    <div className="rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-xs font-medium text-white">
                      {isAr ? "صفقات نشطة" : "Active Trades"} · {sellerRequestSections.active.length}
                    </div>
                  ) : null}
                  {sellerRequestSections.waiting.length ? (
                    <div className="rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 px-3 py-2 text-xs font-medium text-[#BFDBFE]">
                      {isAr ? "قيد الانتظار" : "Waiting"} · {sellerRequestSections.waiting.length}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {(sellerPrimaryRequestsExpanded
                ? sortedSellerRequests
                : sortedSellerRequests.slice(0, isMobileViewport ? 1 : 2)
              ).map((request) => {
                const presentation = getTradeQueuePresentation(request, "seller", isAr);
                const isExpanded = sellerExpandedTradeId === request.id;
                return (
                  <div id={`trade-${request.id}`} key={request.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <button
                      type="button"
                      className="grid w-full gap-3 px-4 py-3 text-start transition hover:bg-white/[0.03] md:grid-cols-[1.1fr_0.9fr_0.9fr_0.9fr_auto] md:items-center"
                      aria-expanded={isExpanded}
                      aria-controls={`seller-trade-details-${request.id}`}
                      onClick={() => setSellerExpandedTradeId((previous) => previous === request.id ? null : request.id)}
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{shortTradeRef(request, isAr)}</p>
                        <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "المشتري" : "Buyer"} {safeText(request.buyerName, isAr ? "مشتري" : "Buyer")}</p>
                      </div>
                      <div className="text-xs">
                        <span className={`rounded-full border px-2.5 py-1 font-semibold tracking-[0.08em] ${presentation.badgeTone}`}>{presentation.badge}</span>
                      </div>
                      <div className="text-sm text-[#D1D5DB]">
                        <p>{toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT</p>
                        <p className="mt-1 text-xs text-[#9CA3AF]">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</p>
                      </div>
                      <p className="text-xs text-[#9CA3AF]">{new Date(request.updatedAt || request.createdAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</p>
                      <p className="text-sm text-[#C9A227] md:text-end">{isExpanded ? (isAr ? "إخفاء" : "Hide") : (isAr ? "عرض" : "View")}</p>
                    </button>
                    {isExpanded ? (
                    <div id={`seller-trade-details-${request.id}`} className="border-t border-white/10 bg-black/25 px-4 py-4">
                    <div className="grid gap-2 text-sm md:grid-cols-3">
                      <p>{isAr ? "مرجع الصفقة" : "Trade Ref"}: <span className="text-white">{shortTradeRef(request, isAr)}</span></p>
                      <p>{isAr ? "اسم المشتري" : "Buyer Name"}: <span className="text-white">{request.buyerName}</span></p>
                      <p>{isAr ? "كمية USDT" : "USDT Amount"}: <span className="text-white">{toNumber(request.usdtAmount).toLocaleString("en-IL")}</span></p>
                      <p>{isAr ? "المبلغ بالعملة التقليدية" : "Fiat Amount"}: <span className="text-white">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</span></p>
                      <p>{isAr ? "الشبكة" : "Network"}: <span className="text-white">{request.network}</span></p>
                      <p>{isAr ? "طريقة الدفع" : "Payment Method"}: <span className="text-white">{paymentMethodEmoji(request.paymentMethod)} {paymentMethodLabel(request.paymentMethod, isAr)}</span></p>
                      <p>{isAr ? "العرض" : "Listing"}: <span className="text-white">{shortListingRef({ id: request.listingId, displayNumber: myListingsById.get(request.listingId)?.displayNumber })}</span></p>
                      <p>{isAr ? "تاريخ الإرسال" : "Submitted"}: <span className="text-white">{new Date(request.createdAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p>
                      <p>{isAr ? "الحالة" : "Status"}: <span className="text-white">{tradeStatusLabel(request.status, isAr)}</span></p>
                      {request.completedAt ? <p>{isAr ? "اكتملت" : "Completed"}: <span className="text-white">{new Date(request.completedAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p> : null}
                      {request.reviewUnlockedAt ? <p>{isAr ? "تم فتح التقييم" : "Review Unlocked"}: <span className="text-white">{new Date(request.reviewUnlockedAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p> : null}
                    </div>
                    <div className="mt-3 rounded-xl border border-[#6CAEFF]/25 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                      <p className="font-medium text-white">{paymentMethodEmoji(request.paymentMethod)} {isAr ? "تعليمات الصفقة" : "Trade Instructions"}</p>
                      <p className="mt-1">{paymentMethodTradeInstruction(request.paymentMethod, "seller", isAr)}</p>
                    </div>
                    {normalizeMarketplacePaymentMethod(request.paymentMethod) === "Face-to-Face (Meet in Person)" && request.status === "pending" ? (
                      <div className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                        <p className="font-semibold text-[#FDE68A]">{isAr ? "إرشادات الأمان" : "Safety Guidelines"}</p>
                        <p className="mt-1 text-[#E5E7EB]">{isAr ? "التقيا في أماكن عامة فقط، ويفضل الأماكن المزودة بكاميرات، ولا تشارك معلومات شخصية غير ضرورية، وتأكد من تحويل USDT قبل المغادرة." : "Meet only in public places, prefer camera-covered locations, avoid sharing unnecessary personal details, and confirm USDT transfer before leaving."}</p>
                        <label className="mt-2 inline-flex cursor-pointer items-start gap-2 text-[#E5E7EB]">
                          <input
                            type="checkbox"
                            checked={sellerSafetyAcknowledgements[request.id] ?? false}
                            onChange={(event) => setSellerSafetyAcknowledgements((prev) => ({ ...prev, [request.id]: event.target.checked }))}
                            className="mt-0.5 h-4 w-4 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]"
                          />
                          <span>{isAr ? "قرأت إرشادات الأمان هذه وأوافق عليها." : "I have read and agree to these safety guidelines."}</span>
                        </label>
                        <p className="mt-1 text-[#D1D5DB]">{isAr ? <>اقرأ الإرشادات كاملة في <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">مركز الأمان والثقة</Link>.</> : <>Read full guidance in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</>}</p>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onMouseEnter={() => handlePrefetchTradeRoom(request.id)}
                        onFocus={() => handlePrefetchTradeRoom(request.id)}
                        onClick={() => handleOpenTradeRoom(request.id)}
                      >
                        {isAr ? "فتح غرفة التداول" : "Open Trade Room"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          request.status !== "pending"
                          || Boolean(sellerWorkspaceSummary?.pendingCommissionCount)
                          || requestActionKey === `${request.id}:accepted`
                          || (normalizeMarketplacePaymentMethod(request.paymentMethod) === "Face-to-Face (Meet in Person)" && !(sellerSafetyAcknowledgements[request.id] ?? false))
                        }
                        onClick={() => handleSellerRequestAction(request.id, "accepted", { safetyAcknowledged: sellerSafetyAcknowledgements[request.id] ?? false })}
                      >
                        {requestActionKey === `${request.id}:accepted` ? (isAr ? "جارٍ التنفيذ..." : "Processing...") : (isAr ? "قبول" : "Accept")}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={request.status !== "pending" || requestActionKey === `${request.id}:declined`} onClick={() => handleSellerRequestAction(request.id, "declined")}>
                        {requestActionKey === `${request.id}:declined` ? (isAr ? "جارٍ التنفيذ..." : "Processing...") : (isAr ? "رفض" : "Decline")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={request.status !== "payment_sent" || requestActionKey === `${request.id}:funds_received`}
                        onClick={() => handleSellerRequestAction(request.id, "funds_received")}
                      >
                        {requestActionKey === `${request.id}:funds_received`
                          ? (isAr ? "جارٍ التنفيذ..." : "Processing...")
                          : normalizeMarketplacePaymentMethod(request.paymentMethod) === "Cardless ATM Withdrawal" ? (isAr ? "تأكيد استلام النقد" : "Confirm Cash Collected") : (isAr ? "تأكيد استلام الأموال" : "Confirm Funds Received")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={request.status !== "funds_received" || requestActionKey === `${request.id}:usdt_release_pending`}
                        onClick={() => handleSellerRequestAction(request.id, "usdt_release_pending")}
                      >
                        {requestActionKey === `${request.id}:usdt_release_pending` ? (isAr ? "جارٍ التنفيذ..." : "Processing...") : (isAr ? "بدء إرسال USDT" : "Start USDT Release")}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={request.status !== "usdt_release_pending" || !request.sellerEvidence || requestActionKey === `${request.id}:usdt_sent`} onClick={() => handleSellerRequestAction(request.id, "usdt_sent")}>
                        {requestActionKey === `${request.id}:usdt_sent` ? (isAr ? "جارٍ التنفيذ..." : "Processing...") : (isAr ? "تحديد USDT كمُرسل" : "Mark USDT Sent")}
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB] md:grid-cols-2">
                      <div>
                        <p className="font-medium text-white">{isAr ? "إثبات المشتري" : "Buyer Evidence"}</p>
                        {request.buyerEvidence ? (
                          <a
                            href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.buyerEvidence.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-[#C9A227] underline-offset-2 hover:underline"
                          >
                            {request.buyerEvidence.fileName}
                          </a>
                        ) : (
                          <p className="mt-1 text-[#9CA3AF]">{isAr ? "لم يتم الرفع بعد." : "Not uploaded yet."}</p>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-white">{isAr ? "إثبات البائع" : "Seller Evidence"}</p>
                        {request.sellerEvidence ? (
                          <a
                            href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.sellerEvidence.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-[#C9A227] underline-offset-2 hover:underline"
                          >
                            {request.sellerEvidence.fileName}
                          </a>
                        ) : (
                          <p className="mt-1 text-[#9CA3AF]">{isAr ? "يجب رفع الإثبات قبل تحديد USDT كمُرسل." : "Upload required before marking USDT sent."}</p>
                        )}
                      </div>
                      {!request.sellerEvidence ? (
                        <div className="md:col-span-2">
                          <p className="text-sm font-semibold text-white">{isAr ? "رفع إثبات البائع" : "Upload seller evidence"}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <LocalizedEvidenceFileInput
                              id={`seller-evidence-file-${request.id}`}
                              isAr={isAr}
                              selectedFile={sellerEvidenceFiles[request.id] ?? null}
                              onSelect={(file) => {
                                setSellerEvidenceFiles((prev) => ({ ...prev, [request.id]: file }));
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={!sellerEvidenceFiles[request.id] || evidenceUploading[`${request.id}:seller`]}
                              onClick={() => {
                                const file = sellerEvidenceFiles[request.id];
                                if (!file) return;
                                void uploadTradeEvidenceFile(request.id, "seller", file);
                              }}
                            >
                              {evidenceUploading[`${request.id}:seller`] ? (isAr ? "جارٍ الرفع..." : "Uploading...") : (isAr ? "رفع الإثبات" : "Upload Evidence")}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4">
                      <CompactTradeTimeline events={request.timeline ?? []} isAr={isAr} />
                    </div>
                    {request.buyerReview ? (
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                        <p className="font-medium text-white">{isAr ? "تقييم المشتري" : "Buyer Review"}</p>
                        <p className="mt-1">{request.buyerReview.comment}</p>
                      </div>
                    ) : null}
                    {request.buyerReview && !request.sellerResponse ? (
                      <form
                        className="mt-3 grid gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleSubmitSellerResponse(request);
                        }}
                      >
                        <Textarea aria-label={isAr ? "الرد على تقييم المشتري" : "Respond to buyer review"} placeholder={isAr ? "اكتب ردك على تقييم المشتري" : "Respond to buyer review"} value={sellerResponseDrafts[request.id] ?? ""} onChange={(event) => setSellerResponseDrafts((prev) => ({ ...prev, [request.id]: event.target.value }))} />
                        <div>
                          <Button type="submit" size="sm" variant="secondary">{isAr ? "إرسال رد البائع" : "Submit Seller Response"}</Button>
                        </div>
                      </form>
                    ) : null}
                    {request.sellerResponse ? (
                      <div className="mt-3 rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                        <p className="font-medium text-white">{isAr ? "رد البائع" : "Seller Response"}</p>
                        <p className="mt-1">{request.sellerResponse.message}</p>
                      </div>
                    ) : null}
                    </div>
                    ) : null}
                  </div>
                );
              })}
              {sortedSellerRequests.length > (isMobileViewport ? 1 : 2) ? (
                <div className="flex justify-start">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setSellerPrimaryRequestsExpanded((prev) => !prev)}
                  >
                    {sellerPrimaryRequestsExpanded
                      ? (isAr ? "عرض أقل" : "Show less")
                      : (isAr ? `عرض الكل (${sortedSellerRequests.length - (isMobileViewport ? 1 : 2)})` : `View All (${sortedSellerRequests.length - (isMobileViewport ? 1 : 2)})`)}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <div ref={setSellerDashboardListingsTarget} className="order-5" />

          <div className="order-6">
            {renderNotificationCenterCard("notification-center-section")}
          </div>

          <div ref={sellerDeferredPanelsSentinelRef} className="order-39 h-px w-full" aria-hidden />
          {deferredSellerPanelsReady ? (
            <div className="order-40 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              <Card className="order-50 border-white/10 bg-[#0B0B0B]/90">
                <CardHeader>
                  <CardTitle>{isAr ? "ملف البائع" : "Seller Profile"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-[#D1D5DB]">
                  <div className="flex items-center gap-3">
                    {sessionUser?.profilePhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sessionUser.profilePhotoUrl} alt={isAr ? `صورة ${sessionUser.fullName}` : `${sessionUser.fullName} profile`} className="h-13 w-13 rounded-full border border-white/15 object-cover" />
                    ) : (
                      <div className="inline-flex h-13 w-13 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-sm font-semibold text-[#D1D5DB]">
                        {safeText(sessionUser?.fullName, isAr ? "بائع" : "Seller")
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)}
                      </div>
                    )}
                    <div>
                      <p className="text-base font-semibold text-white"><bdi dir="auto">{safeText(sessionUser?.fullName, isAr ? "بائع" : "Seller")}</bdi></p>
                      <RoleBadge variant="approved_seller" locale={isAr ? "ar" : "en"} />
                    </div>
                  </div>
                  <p>{isAr ? "عضو منذ" : "Member Since"}: <span className="text-white"><bdi dir="ltr">{sessionUser?.createdAt ? new Date(sessionUser.createdAt).toLocaleDateString(isAr ? "ar-IL-u-nu-latn" : "en-IL") : "—"}</bdi></span></p>
                  <p>{isAr ? "اللغات" : "Languages"}: <span className="text-white"><bdi dir="auto">{sessionUser?.languages?.length ? sessionUser.languages.map((language) => spokenLanguageLabel(language, isAr)).join(isAr ? "، " : ", ") : (isAr ? "العربية" : "English")}</bdi></span></p>
                  <p>{isAr ? "الشبكات المفضلة" : "Preferred Networks"}: <span className="text-white"><bdi dir="ltr">{sessionUser?.preferredNetworks?.join(", ") || "TRC20"}</bdi></span></p>
                  <p>{isAr ? "التقييم" : "Rating"}: <span className="text-white"><bdi dir="ltr">{(sellerOverviewStats.reputation?.rating ?? 4.5).toFixed(2)}</bdi></span></p>
                  <p>{isAr ? "نسبة النجاح" : "Success Rate"}: <span className="text-white"><bdi dir="ltr">{sellerOverviewStats.successRate.toFixed(1)}{isAr ? "٪" : "%"}</bdi></span></p>
                  <p>{isAr ? "الصفقات المكتملة" : "Completed Trades"}: <span className="text-white"><bdi dir="ltr">{sellerOverviewStats.completedTrades}</bdi></span></p>
                  <p>{isAr ? "إجمالي حجم USDT" : "Total USDT Volume"}: <span className="text-white"><bdi dir="ltr">{sellerOverviewStats.totalUsdtSold.toLocaleString("en-IL")} USDT</bdi></span></p>
                  <p>{isAr ? "العروض الحالية" : "Current Listings"}: <span className="text-white"><bdi dir="ltr">{sellerOverviewStats.activeListings}</bdi></span></p>
                  <p>{isAr ? "متوسط وقت الاستجابة" : "Average Response Time"}: <span className="text-white">{sellerOverviewStats.averageResponseTime}</span></p>
                  <p>{isAr ? "الحالة" : "Status"}: <span className="text-white">{sessionUser?.onlineStatus === "online" ? (isAr ? "متصل" : "Online") : (isAr ? "غير متصل" : "Offline")}</span></p>
                  <p>{isAr ? "آخر نشاط" : "Last Active"}: <span className="text-white">{formatRelativeMinutesLabel(sessionUser?.lastActiveAt, isAr)}</span></p>
                  <p>{isAr ? "نبذة" : "Bio"}: <span className="text-white"><bdi dir="auto">{safeText(sessionUser?.bio, isAr ? "بائع USDT محترف على Alpha Exchange." : "Professional USDT seller on Alpha Exchange.")}</bdi></span></p>
                  <p>{isAr ? "خبرة التداول" : "Trading Experience"}: <span className="text-white"><bdi dir="auto">{safeText(sessionUser?.tradingExperience, isAr ? "خبرة احترافية في التداول" : "Professional trading experience")}</bdi></span></p>
                  <p>{isAr ? "ساعات العمل" : "Working Hours"}: <span className="text-white"><bdi dir="auto">{safeText(sessionUser?.workingHours, isAr ? "الأحد-الخميس، 09:00-21:00" : "Sun-Thu, 09:00-21:00")}</bdi></span></p>
                  <p>{isAr ? "حالة الحساب" : "Account Status"}: <span className="text-white">{sellerAccountStatusLabel(sessionUser?.sellerStatus, isAr)}</span></p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(sellerOverviewStats.reputation?.badges ?? []).map((badge) => (
                      <span key={badge} className="rounded-full border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 px-2 py-1 text-[11px] text-[#93C5FD]">
                        {sellerBadgeLabel(badge, isAr)}
                      </span>
                    ))}
                  </div>
                  {sellerOverviewStats.completedTrades === 0 ? (
                    <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9CA3AF]">
                      {isAr ? "لا توجد صفقات مكتملة بعد. أكمل أول صفقة لبناء سجل ثقة قوي." : "No Trades Yet. Complete your first trade to start building trust history."}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {marketInsightsCard}

              <Card className="border-white/10 bg-[#0B0B0B]/90">
                <CardHeader>
                  <CardTitle>{isAr ? "لوحة البائع" : "Seller Command Center"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "حجم التداول الكلي" : "Lifetime Trade Volume"}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.totalUsdtSold.toLocaleString("en-IL")} USDT</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "متوسط التقييم" : "Average Rating"}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{(sellerOverviewStats.reputation?.rating ?? 4.5).toFixed(2)}★</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "الصفقات المكتملة" : "Completed Trades"}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.completedTrades.toLocaleString("en-IL")}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "مستوى البائع" : "Seller Level"}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{sellerLevelLabel(sellerOverviewStats.reputation?.level, isAr)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-white/10 bg-[#0B0B0B]/90 xl:col-span-2">
                <CardHeader>
                  <CardTitle>{isAr ? "الخط الزمني للنشاط" : "Activity Timeline"}</CardTitle>
                  <CardDescription>{isAr ? "الأحدث أولاً، مجمّع حسب التاريخ، في بطاقات نشاط مختصرة." : "Newest first, grouped by date, with compact activity cards."}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!activityHistory.length ? (
                    <p className="text-xs text-[#9CA3AF]">{isAr ? "يتم تحديث الخط الزمني تلقائياً عند التداول والتقييم وإدارة العروض." : "Your timeline updates automatically as you trade, review, and manage listings."}</p>
                  ) : (
                    groupedActivityHistory.map((group) => (
                      <div key={group.dayKey} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{group.label}</p>
                        <div className="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                          {group.items.slice(0, 3).map((entry) => {
                            const copy = localizeActivityCopy(entry, locale);
                            return (
                              <div key={entry.id} className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="font-medium text-white"><bdi dir="auto">{copy.title}</bdi></p>
                                  <p className="shrink-0 text-[#9CA3AF]">{new Date(entry.createdAt).toLocaleTimeString(isAr ? "ar-IL-u-nu-latn" : "en-IL", { hour: "2-digit", minute: "2-digit" })}</p>
                                </div>
                                <p className="mt-1 line-clamp-2 text-[#9CA3AF]"><bdi dir="auto">{copy.details}</bdi></p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="order-40 border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle>{isAr ? "جاري تحميل الرؤى المتقدمة" : "Advanced insights load on demand"}</CardTitle>
                <CardDescription>
                  {isAr
                    ? "تظهر الإشعارات، التحليلات، والملفات الثانوية عند فتح هذا الجزء لتسريع التفاعل الأولي."
                    : "Notifications, analytics, and secondary reputation widgets hydrate when this section comes into view so the shell stays fast."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={`deferred-seller-panel-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="h-3 w-44 animate-pulse rounded bg-white/10" />
                    <div className="mt-3 h-4 w-full animate-pulse rounded bg-white/10" />
                    <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-white/10" />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      ) : isApprovedSeller ? (
        <div className="mt-8 md:hidden">
          <Card className="border-white/10 bg-[#0B0B0B]/90">
            <CardContent className="p-4">
              <div className="h-5 w-40 animate-pulse rounded bg-white/10" />
              <div className="mt-3 h-16 animate-pulse rounded-2xl bg-white/10" />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] xl:items-start">
          {pendingBuyerReviewTrade ? (
            <Card className="md:col-span-2 border-[#C9A227]/40 bg-[#C9A227]/10">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">?</span>
                  <div>
                    <p className="font-semibold text-[#FDE68A]">{isAr ? "أكمل صفقتك السابقة أولاً" : "Complete your previous trade first"}</p>
                    <p className="mt-0.5 text-sm text-[#E5E7EB]">
                      {isAr
                        ? "قبل بدء صفقة جديدة، قيّم البائع في صفقتك السابقة."
                        : "Before starting another trade, please rate your previous seller."}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <Link href={`/trade-room/${pendingBuyerReviewTrade.id}`}>
                    <Button size="sm" className="w-full sm:w-auto">
                      {isAr ? "إضافة تقييم" : "Leave Feedback"}
                    </Button>
                  </Link>
                  <Link href={`/trade-room/${pendingBuyerReviewTrade.id}`}>
                    <Button size="sm" variant="secondary" className="w-full sm:w-auto">
                      {isAr ? "عرض الصفقة السابقة" : "View Previous Trade"}
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : archivedConfirmationTrade ? (
            <Card className="md:col-span-2 border-[#C9A227]/40 bg-[#C9A227]/10">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⏰</span>
                  <div>
                    <p className="font-semibold text-[#FDE68A]">{isAr ? "إجراء مطلوب — تأكيد استلام USDT" : "Action Required — Confirm USDT Receipt"}</p>
                    <p className="mt-0.5 text-sm text-[#E5E7EB]">
                      {isAr
                        ? "لديك صفقة تنتظر تأكيد استلام USDT. يرجى التأكيد لإكمال صفقتك والسماح بعمليات الشراء الجديدة."
                        : "You have a trade waiting for your USDT receipt confirmation. Please confirm receipt to complete your trade and unblock new purchases."}
                    </p>
                  </div>
                </div>
                <Link href={`/trade-room/${archivedConfirmationTrade.id}`} className="shrink-0">
                  <Button size="sm" className="w-full sm:w-auto">
                    {isAr ? "تأكيد الاستلام" : "Confirm Receipt"}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : null}
          {buyerOverviewCard}
          <Card className="border-white/10 bg-[#0B0B0B]/85">
            <CardHeader>
              <CardTitle>{isAr ? "جلسة المستخدم" : "Session"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-[#D1D5DB]">
                {sessionUser ? sessionUser.fullName : (isAr ? "غير مسجل الدخول" : "Not logged in")}
              </p>
              {sessionUser ? <RoleBadge variant={roleBadgeVariantFromSession(sessionUser)} locale={isAr ? "ar" : "en"} /> : <RoleBadge variant="guest" locale={isAr ? "ar" : "en"} />}
              <div className="flex flex-wrap gap-2">
                {!sessionUser ? (
                  <>
                    <Link href="/login">
                      <Button variant="secondary">{isAr ? "تسجيل الدخول" : "Login"}</Button>
                    </Link>
                    <Link href="/register">
                      <Button variant="secondary">{isAr ? "إنشاء حساب" : "Register"}</Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href="/profile">
                      <Button variant="secondary">{isAr ? "الملف الشخصي" : "Profile"}</Button>
                    </Link>
                    <LogoutButton
                      locale={locale}
                      variant="secondary"
                      idleLabel={isAr ? "تسجيل الخروج" : "Logout"}
                      pendingLabel={isAr ? "جارٍ تسجيل الخروج..." : "Signing out..."}
                      onSignedOut={() => setSessionUser(null)}
                    />
                  </>
                )}
              </div>
              {sessionUser ? (
                <form className="grid gap-2 border-t border-white/10 pt-3" onSubmit={handleNotificationPreferencesSave}>
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "تفضيلات الإشعارات" : "Notification Preferences"}</p>
                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-[#D1D5DB]">
                    <span>{isAr ? "داخل التطبيق" : "In-app"}</span>
                    <input type="checkbox" checked={notificationPreferences.inApp} onChange={(event) => setNotificationPreferences((prev) => ({ ...prev, inApp: event.target.checked }))} />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-[#D1D5DB]">
                    <span>{isAr ? "البريد الإلكتروني (قريباً)" : "Email (future-ready)"}</span>
                    <input type="checkbox" checked={notificationPreferences.email} onChange={(event) => setNotificationPreferences((prev) => ({ ...prev, email: event.target.checked }))} />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-[#D1D5DB]">
                    <span>{isAr ? "رسائل SMS (قريباً)" : "SMS (future-ready)"}</span>
                    <input type="checkbox" checked={notificationPreferences.sms} onChange={(event) => setNotificationPreferences((prev) => ({ ...prev, sms: event.target.checked }))} />
                  </label>
                  <Button type="submit" size="sm" variant="secondary">{isAr ? "حفظ التفضيلات" : "Save Preferences"}</Button>
                </form>
              ) : null}
            </CardContent>
          </Card>

          {sessionUser ? (
            <Card id={BUYER_TRADE_HISTORY_SECTION_ID} tabIndex={-1} className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
              <CardHeader>
                <CardTitle>{isAr ? "سجل صفقاتي" : "My Trade History"}</CardTitle>
                <CardDescription>{isAr ? "الأحدث أولاً، مع صفوف مختصرة وتفاصيل قابلة للتوسيع لكل صفقة." : "Newest first, compact rows, and expandable details for each trade."}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Input placeholder={isAr ? "ابحث بمعرّف الصفقة أو العرض..." : "Search by trade ID or listing..."} value={buyerTradeQuery} onChange={(event) => setBuyerTradeQuery(event.target.value)} />
                  <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={buyerTradeStatus} onChange={(event) => setBuyerTradeStatus(event.target.value as typeof buyerTradeStatus)}>
                    <option value="all">{isAr ? "الحالة: الكل" : "Status: All"}</option>
                    <option value="pending">{tradeStatusLabel("pending", isAr)}</option>
                    <option value="accepted">{tradeStatusLabel("accepted", isAr)}</option>
                    <option value="payment_sent">{tradeStatusLabel("payment_sent", isAr)}</option>
                    <option value="funds_received">{tradeStatusLabel("funds_received", isAr)}</option>
                    <option value="usdt_release_pending">{tradeStatusLabel("usdt_release_pending", isAr)}</option>
                    <option value="usdt_sent">{tradeStatusLabel("usdt_sent", isAr)}</option>
                    <option value="review_open">{tradeStatusLabel("review_open", isAr)}</option>
                    <option value="declined">{tradeStatusLabel("declined", isAr)}</option>
                    <option value="cancelled">{tradeStatusLabel("cancelled", isAr)}</option>
                  </select>
                </div>
                {!filteredBuyerRequests.length ? (
                  buyerRequests.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center">
                      <HandCoins className="mx-auto h-5 w-5 text-[#C9A227]" />
                      <p className="mt-2 text-sm font-medium text-white">{isAr ? "لا توجد صفقات بعد" : "No trades yet"}</p>
                      <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "تصفح البائعين الموثقين وابدأ صفقتك الأولى." : "Browse verified sellers and start your first trade."}</p>
                      <Link href="/usdt-exchange#marketplace" locale={locale} className="mt-3 inline-flex items-center gap-1 text-xs text-[#93C5FD] hover:underline">
                        {isAr ? "تصفح السوق ←" : "Browse Marketplace →"}
                      </Link>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-[#9CA3AF]">{isAr ? "لا توجد صفقات مطابقة للفلاتر الحالية." : "No trades found for current filters."}</div>
                  )
                ) : null}
                {sortedBuyerRequests.length ? (
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <div className="hidden grid-cols-[1.1fr_0.9fr_0.9fr_0.9fr_0.9fr_auto] gap-3 border-b border-white/10 px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF] md:grid">
                      <span>{isAr ? "الصفقة" : "Trade"}</span>
                      <span>{isAr ? "الحالة" : "Status"}</span>
                      <span>{isAr ? "الكمية" : "Amount"}</span>
                      <span>{isAr ? "الطريقة" : "Method"}</span>
                      <span>{isAr ? "آخر تحديث" : "Updated"}</span>
                      <span className="text-end">{isAr ? "التفاصيل" : "Details"}</span>
                    </div>
                    {sortedBuyerRequests.slice(0, buyerTradeVisibleCount).map((request) => {
                      const presentation = getTradeQueuePresentation(request, "buyer", isAr);
                      const isExpanded = buyerExpandedTradeId === request.id;
                      return (
                        <div key={request.id} className="border-t border-white/10 first:border-t-0">
                          <button
                            type="button"
                            className="grid w-full gap-3 px-4 py-3 text-start transition hover:bg-white/[0.03] md:grid-cols-[1.1fr_0.9fr_0.9fr_0.9fr_0.9fr_auto] md:items-center"
                            aria-expanded={isExpanded}
                            aria-controls={`buyer-trade-details-${request.id}`}
                            onClick={() => setBuyerExpandedTradeId((prev) => prev === request.id ? null : request.id)}
                          >
                            <div>
                              <p className="text-sm font-medium text-white">{shortTradeRef(request, isAr)}</p>
                              <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "العرض" : "Listing"} {shortListingRef({ id: request.listingId, displayNumber: listingsById.get(request.listingId)?.displayNumber })}</p>
                            </div>
                            <div className="text-xs">
                              <span className={`rounded-full border px-2.5 py-1 font-semibold tracking-[0.08em] ${presentation.badgeTone}`}>{presentation.badge}</span>
                            </div>
                            <div className="text-sm text-[#D1D5DB]">
                              <p>{toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT</p>
                              <p className="mt-1 text-xs text-[#9CA3AF]">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</p>
                            </div>
                            <p className="text-sm text-[#D1D5DB]">{paymentMethodEmoji(request.paymentMethod)} {paymentMethodLabel(request.paymentMethod, isAr)}</p>
                            <p className="text-sm text-[#D1D5DB]">{new Date(request.completedAt ?? request.updatedAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}</p>
                            <p className="text-sm text-[#C9A227] md:text-end">{isExpanded ? (isAr ? "إخفاء" : "Hide") : (isAr ? "توسيع" : "Expand")}</p>
                          </button>
                          {isExpanded ? (
                            <div id={`buyer-trade-details-${request.id}`} className="space-y-3 border-t border-white/10 bg-black/25 px-4 py-4">
                              <div className="grid gap-2 text-sm md:grid-cols-3">
                                <p>{isAr ? "الشبكة" : "Network"}: <span className="text-white">{request.network}</span></p>
                                <p>{isAr ? "تاريخ الإرسال" : "Submitted"}: <span className="text-white">{new Date(request.createdAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p>
                                {request.completedAt ? <p>{isAr ? "اكتملت" : "Completed"}: <span className="text-white">{new Date(request.completedAt).toLocaleString(isAr ? "ar-IL" : "en-IL")}</span></p> : null}
                              </div>
                              <div className="rounded-xl border border-[#6CAEFF]/25 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                                <p className="font-medium text-white">{paymentMethodEmoji(request.paymentMethod)} {isAr ? "تعليمات الصفقة" : "Trade Instructions"}</p>
                                <p className="mt-1">{paymentMethodTradeInstruction(request.paymentMethod, "buyer", isAr)}</p>
                                <p className="mt-1">{isAr ? <>راجع التفاصيل في <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">مركز الأمان والثقة</Link>.</> : <>Review details in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</>}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button type="button" size="sm" variant="secondary" onMouseEnter={() => handlePrefetchTradeRoom(request.id)} onFocus={() => handlePrefetchTradeRoom(request.id)} onClick={() => handleOpenTradeRoom(request.id)}>
                                  {isAr ? "فتح غرفة التداول" : "Open Trade Room"}
                                </Button>
                                <Button type="button" size="sm" disabled={request.status !== "accepted" || !request.buyerEvidence} onClick={() => handleBuyerTradeStatus(request, "payment_sent")}>
                                  {normalizeMarketplacePaymentMethod(request.paymentMethod) === "Cardless ATM Withdrawal" ? (isAr ? "تحديد السحب كجاهز" : "Mark Withdrawal Ready") : (isAr ? "تحديد الدفعة كمُرسلة" : "Mark Payment Sent")}
                                </Button>
                                <Button type="button" size="sm" variant="secondary" disabled={request.status !== "usdt_sent"} onClick={() => handleBuyerTradeStatus(request, "completed")}>
                                  {isAr ? "تأكيد اكتمال الصفقة" : "Confirm Trade Completed"}
                                </Button>
                                <Button type="button" size="sm" variant="secondary" disabled={request.status !== "pending" && request.status !== "accepted"} onClick={() => handleBuyerTradeStatus(request, "cancelled")}>
                                  {isAr ? "إلغاء" : "Cancel"}
                                </Button>
                              </div>
                              <div className="grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB] md:grid-cols-2">
                                <div>
                                  <p className="font-medium text-white">{isAr ? "إثبات المشتري" : "Buyer Evidence"}</p>
                                  {request.buyerEvidence ? (
                                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.buyerEvidence.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[#C9A227] underline-offset-2 hover:underline">
                                      {request.buyerEvidence.fileName}
                                    </a>
                                  ) : (
                                    <p className="mt-1 text-[#9CA3AF]">{isAr ? "يجب رفع الإثبات قبل تحديد الدفعة كمُرسلة." : "Upload required before marking payment sent."}</p>
                                  )}
                                </div>
                                <div>
                                  <p className="font-medium text-white">{isAr ? "إثبات البائع" : "Seller Evidence"}</p>
                                  {request.sellerEvidence ? (
                                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.sellerEvidence.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[#C9A227] underline-offset-2 hover:underline">
                                      {request.sellerEvidence.fileName}
                                    </a>
                                  ) : (
                                    <p className="mt-1 text-[#9CA3AF]">{isAr ? "بانتظار إثبات البائع." : "Waiting for seller evidence."}</p>
                                  )}
                                </div>
                                {!request.buyerEvidence ? (
                                  <div className="md:col-span-2">
                                    <p className="text-sm font-semibold text-white">{isAr ? "رفع إثبات الدفع" : "Upload payment evidence"}</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <LocalizedEvidenceFileInput
                                        id={`buyer-evidence-file-${request.id}`}
                                        isAr={isAr}
                                        selectedFile={buyerEvidenceFiles[request.id] ?? null}
                                        onSelect={(file) => {
                                          setBuyerEvidenceFiles((prev) => ({ ...prev, [request.id]: file }));
                                        }}
                                      />
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        disabled={!buyerEvidenceFiles[request.id] || evidenceUploading[`${request.id}:buyer`]}
                                        onClick={() => {
                                          const file = buyerEvidenceFiles[request.id];
                                          if (!file) return;
                                          void uploadTradeEvidenceFile(request.id, "buyer", file);
                                        }}
                                      >
                                        {evidenceUploading[`${request.id}:buyer`] ? (isAr ? "جارٍ الرفع..." : "Uploading...") : (isAr ? "رفع الإثبات" : "Upload Evidence")}
                                      </Button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                              <CompactTradeTimeline events={request.timeline ?? []} isAr={isAr} />
                              {request.status === "review_open" && !request.buyerReview ? (
                                <form
                                  className="grid gap-2"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void handleSubmitBuyerReview(request);
                                  }}
                                >
                                  <Textarea aria-label={isAr ? "إضافة تقييم للصفقة" : "Leave trade review"} placeholder={isAr ? "أضف تقييماً واحداً بعد اكتمال الصفقة" : "Leave one review after completed trade"} value={tradeReviewDrafts[request.id] ?? ""} onChange={(event) => setTradeReviewDrafts((prev) => ({ ...prev, [request.id]: event.target.value }))} />
                                  <div>
                                    <Button type="submit" size="sm" variant="secondary">{isAr ? "إرسال تقييم المشتري" : "Submit Buyer Review"}</Button>
                                  </div>
                                </form>
                              ) : null}
                              {request.buyerReview ? (
                                <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                                  <p className="font-medium text-white">{isAr ? "تقييم المشتري" : "Buyer Review"}</p>
                                  <p className="mt-1">{request.buyerReview.comment}</p>
                                </div>
                              ) : null}
                              {request.sellerResponse ? (
                                <div className="rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                                  <p className="font-medium text-white">{isAr ? "رد البائع" : "Seller Response"}</p>
                                  <p className="mt-1">{request.sellerResponse.message}</p>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {sortedBuyerRequests.length > buyerTradeVisibleCount ? (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setBuyerTradeVisibleCount((value) => (
                        value >= sortedBuyerRequests.length ? (isMobileViewport ? 1 : 2) : sortedBuyerRequests.length
                      ))}
                    >
                      {isAr ? "عرض المزيد" : "View more"}
                    </Button>
                  </div>
                ) : buyerTradeVisibleCount > (isMobileViewport ? 1 : 2) ? (
                  <div className="flex justify-center">
                    <Button type="button" variant="secondary" onClick={() => setBuyerTradeVisibleCount(isMobileViewport ? 1 : 2)}>
                      {isAr ? "عرض أقل" : "Show less"}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {sessionUser ? renderNotificationCenterCard("notification-center-section", "md:col-span-2") : null}
          {sessionUser ? (
            <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
              <CardHeader>
                <CardTitle>{isAr ? "الخط الزمني للنشاط" : "Activity Timeline"}</CardTitle>
                <CardDescription>{isAr ? "الأحدث أولاً، مجمّع حسب التاريخ، في بطاقات نشاط مختصرة." : "Newest first, grouped by date, with compact activity cards."}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!activityHistory.length ? (
                  <p className="text-xs text-[#9CA3AF]">{isAr ? "يتم تحديث الخط الزمني تلقائياً عند التداول والتقييم وإدارة العروض." : "Your timeline updates automatically as you trade, review, and manage listings."}</p>
                ) : (
                  groupedActivityHistory.map((group) => (
                    <div key={group.dayKey} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{group.label}</p>
                      <div className="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                        {group.items.slice(0, 3).map((entry) => {
                          const copy = localizeActivityCopy(entry, locale);
                          return (
                            <div key={entry.id} className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                              <div className="flex items-start justify-between gap-3">
                                <p className="font-medium text-white"><bdi dir="auto">{copy.title}</bdi></p>
                                <p className="shrink-0 text-[#9CA3AF]">{new Date(entry.createdAt).toLocaleTimeString(isAr ? "ar-IL-u-nu-latn" : "en-IL", { hour: "2-digit", minute: "2-digit" })}</p>
                              </div>
                              <p className="mt-1 line-clamp-2 text-[#9CA3AF]"><bdi dir="auto">{copy.details}</bdi></p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {showDeepDeferredSections && !sessionUser && !isDashboardWorkspace ? (
      <div className="mt-12 grid gap-4 md:grid-cols-4">
        {[
          { value: `${todaysCompletedTrades.toLocaleString("en-IL")}`, labelAr: "صفقات مكتملة اليوم", label: "Completed Trades Today", icon: HandCoins },
          { value: `${marketplacePulse.verifiedSellers.toLocaleString("en-IL")}+`, labelAr: "بائعون موثقون", label: "Verified Sellers", icon: ShieldCheck },
          { value: `${marketplacePulse.totalUsdtAvailable.toLocaleString("en-IL")} USDT`, labelAr: "USDT متاح", label: "USDT Available", icon: WalletCards },
          { value: isAr ? `${marketplacePulse.averageResponseMinutes} دقائق` : `${marketplacePulse.averageResponseMinutes} min`, labelAr: "متوسط الاستجابة", label: "Average Response", icon: Clock3 },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="border-white/10 bg-[#0B0B0B]/85 transition hover:-translate-y-0.5">
              <CardContent className="p-5 text-center">
                <div className="mx-auto mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 text-[#C9A227]">
                  <Icon className="h-4 w-4" />
                </div>
                <p className="text-xl font-semibold text-white">{item.value}</p>
                <p className="mt-1 text-sm text-[#9CA3AF]">{isAr ? item.labelAr : item.label}</p>
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
                {item.q}
                <CheckCircle2 className="h-4 w-4 text-[#C9A227] transition group-open:rotate-12" />
              </summary>
              <p className="mt-3 text-sm leading-7 text-[#9CA3AF]">{item.a}</p>
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
            <h3 className="text-2xl font-semibold md:text-3xl">{isAr ? "جاهز لتبادل USDT؟" : "Ready to Exchange USDT?"}</h3>
            <p className="mt-2 max-w-3xl text-[#D1D5DB]">
              {isAr
                ? "انضم إلى مجتمع Alpha Traders واستمتع بسوق احترافي يربط بين البائعين والمشترين عبر Alpha Exchange."
                : "Join the Alpha Traders community and experience a professional marketplace connecting buyers and sellers through Alpha Exchange."}
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
      <AnimatePresence>
        {removalListing ? (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={isAr ? "إزالة العرض" : "Remove listing"}
              className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0B0B0B]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{isAr ? "إزالة العرض" : "Remove listing"}</h3>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "يتم تسجيل سبب الإزالة للشفافية." : `Removing ${shortListingRef(removalListing)} is recorded for marketplace accountability.`}</p>
                </div>
                <button type="button" aria-label={isAr ? "إغلاق نافذة إزالة العرض" : "Close removal dialog"} onClick={() => setRemovalListing(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-[#D1D5DB] transition hover:border-[#C9A227] hover:text-[#C9A227]">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 space-y-3">
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
                    onClick={() => void confirmSellerListingRemoval()}
                  >
                    {listingActionKey === `${removalListing.id}:delete` ? (isAr ? "جارٍ الإزالة..." : "Removing...") : (isAr ? "إزالة العرض" : "Remove Listing")}
                  </Button>
                  <Button type="button" variant="secondary" className="w-full" onClick={() => setRemovalListing(null)}>{isAr ? "إلغاء" : "Cancel"}</Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      </Portal>

      <Portal>
      <AnimatePresence>
        {selectedListing ? (
         <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div role="dialog" aria-modal="true" aria-label={isAr ? "شراء USDT" : "Buy USDT"} className="flex max-h-[92vh] w-full max-w-[700px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0B0B0B]/95 shadow-[0_24px_80px_rgba(0,0,0,0.5)]" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <div className={`flex shrink-0 items-start justify-between gap-3 px-5 pt-5 sm:px-6 ${isAr ? "flex-row-reverse" : ""}`}>
                <div>
                  <h3 className="text-2xl font-semibold">{isAr ? "شراء USDT" : "Buy USDT"}</h3>
                  <p className={`mt-1 inline-flex items-center gap-1.5 text-xs text-[#C9A227] ${isAr ? "flex-row-reverse" : ""}`}>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>{isAr ? "صفقة مؤمّنة عبر Alpha Traders" : "Secured trade · escrow by Alpha Traders"}</span>
                  </p>
                </div>
                <button type="button" aria-label={isAr ? "إغلاق نافذة شراء USDT" : "Close Buy USDT sheet"} onClick={closeListingModal} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-[#D1D5DB] transition hover:border-[#C9A227] hover:text-[#C9A227]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {!purchaseSubmitted ? (
                <>
                <div className="flex-1 min-h-0 space-y-4 overflow-y-auto px-5 pb-4 pt-4 sm:px-6">
                  {(() => {
                    const modalPresence = deriveSellerPresence({
                      onlineStatus: (sellerProfileData?.profile ?? selectedListing.sellerProfile)?.onlineStatus,
                      lastActiveAt: (sellerProfileData?.profile ?? selectedListing.sellerProfile)?.lastActiveAt,
                    });
                    const modalName = sellerProfileData?.profile.sellerName ?? selectedListing.sellerDisplayName;
                    const modalLevel = sellerProfileData?.sellerLevel ?? selectedListing.sellerReputation?.level;
                    const modalToneKey = selectedListing.sellerProfile?.isOwner ? "legendary" : sellerLevelToneKey(modalLevel);
                    const modalTrust = sellerProfileData?.trustScore ?? selectedListing.sellerReputation?.trustScore ?? 0;
                    const modalResponse = sellerProfileData?.responseTimeMinutes ?? selectedListing.sellerReputation?.responseTimeMinutes ?? 0;
                    const modalCompleted = sellerProfileData?.completedTrades ?? selectedListing.sellerReputation?.completedTrades ?? 0;
                    const modalRating = sellerProfileData?.averageRating ?? selectedListing.sellerReputation?.rating ?? 0;
                    const modalPhoto = sellerProfileData?.profile.profilePhotoUrl ?? selectedListing.sellerProfile?.profilePhotoUrl;
                    return (
                      <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                        <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                          {modalPhoto ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={modalPhoto} alt={isAr ? `صورة ${safeText(modalName, "البائع")}` : `${safeText(modalName, "Seller")} profile`} className="h-12 w-12 shrink-0 rounded-full border border-white/15 object-cover" />
                          ) : (
                            <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-white">
                              {safeText(modalName, isAr ? "بائع" : "Seller").split(" ").map((part) => part[0]).join("").slice(0, 2)}
                            </div>
                          )}
                          <div className={`min-w-0 flex-1 ${isAr ? "text-right" : ""}`}>
                            <div className={`flex flex-wrap items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                              <p className={cn("truncate text-base font-semibold", selectedListing.sellerProfile?.isOwner ? "profile-identity-name--owner" : `seller-rank-name seller-rank-name--${modalToneKey}`)}>{safeText(modalName, isAr ? "بائع" : "Seller")}</p>
                              <RoleBadge variant="approved_seller" locale={isAr ? "ar" : "en"} className={cn("seller-rank-badge", `seller-rank-badge--${modalToneKey}`)} />
                              <span className={cn("seller-rank-pill", `seller-rank-pill--${modalToneKey}`)}>
                                {selectedListing.sellerProfile?.isOwner ? (isAr ? "بائع أسطوري" : "Legendary Seller") : (isAr ? `بائع ${sellerLevelLabel(modalLevel, true)}` : `${sellerLevelLabel(modalLevel)} Seller`)}
                              </span>
                            </div>
                            <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#9CA3AF] ${isAr ? "flex-row-reverse" : ""}`}>
                              <span className={cn("inline-flex items-center gap-1", `seller-presence--${modalPresence.tone}`)}>
                                <span className={cn("seller-presence-dot", `seller-presence-dot--${modalPresence.tone}`)} aria-hidden="true" />
                                {isAr ? modalPresence.labelAr : modalPresence.label}
                              </span>
                              <span><ShieldCheck className="mr-0.5 inline h-3 w-3 text-[#93C5FD]" />{modalTrust.toFixed(1)}</span>
                              <span><Zap className="me-0.5 inline h-3 w-3 text-[#F4D87A]" />{modalResponse.toFixed(0)} {isAr ? "دقائق" : "min"}</span>
                              <span><HandCoins className="me-0.5 inline h-3 w-3" />{modalCompleted.toLocaleString("en-IL")} {isAr ? "صفقات" : "trades"}</span>
                              <span><Star className="mr-0.5 inline h-3 w-3 text-[#F4D87A]" />{modalRating.toFixed(2)}</span>
                              {isSellerProfileLoading && !sellerProfileData ? <span className="text-[10px] italic text-[#9CA3AF]">{isAr ? "جارٍ التحديث…" : "refreshing…"}</span> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="rounded-2xl border border-[#C9A227]/25 bg-gradient-to-r from-emerald-500/10 via-black/50 to-[#C9A227]/12 p-3">
                    <div className={`flex items-end justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                      <div className={isAr ? "text-right" : ""}>
                        <p className="text-2xl font-bold leading-none text-white">{selectedAmount.toLocaleString("en-IL")}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-emerald-200/90">{isAr ? "USDT متاح" : "USDT Available"}</p>
                      </div>
                      <div className={isAr ? "text-left" : "text-right"}>
                        <p className="text-2xl font-bold leading-none text-[#C9A227]">{formatIls(selectedPrice)}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#D1D5DB]">ILS / USDT · {selectedListing.network}</p>
                      </div>
                    </div>
                    <p className={`mt-2 text-[11px] text-[#9CA3AF] ${isAr ? "text-right" : ""}`}>
                      {isAr ? "العمولة (1%)" : "Commission (1%)"}: <span className="text-white">₪{commission.toFixed(2)}</span> · {isAr ? "الإجمالي التقديري" : "Estimated total"}: <span className="text-[#C9A227]">₪{estimatedTotal.toFixed(2)}</span>
                    </p>
                  </div>

                  {isOwnerViewer && sellerProfileData ? (
                    <div className="rounded-2xl border border-[#C9A227]/25 bg-black/25 p-4 text-sm text-[#D1D5DB]">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "أدوات المالك" : "Owner Tools"}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="secondary" disabled={isOwnerProfileActionLoading} onClick={() => void handleOwnerSellerProfileState(sellerProfileData.sellerId, { feature: !sellerProfileData.profile.isFeaturedSeller }, sellerProfileData.profile.isFeaturedSeller ? (isAr ? "تمت إزالة البائع من المميزين." : "Seller unfeatured.") : (isAr ? "تم تمييز البائع." : "Seller featured."))}>
                          {sellerProfileData.profile.isFeaturedSeller ? (isAr ? "إلغاء تمييز البائع" : "Unfeature Seller") : (isAr ? "تمييز البائع" : "Feature Seller")}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={isOwnerProfileActionLoading} onClick={() => void handleOwnerSellerProfileState(sellerProfileData.sellerId, { hidden: !sellerProfileData.profile.isProfileHidden }, sellerProfileData.profile.isProfileHidden ? (isAr ? "تم إظهار ملف البائع." : "Seller profile unhidden.") : (isAr ? "تم إخفاء ملف البائع." : "Seller profile hidden."))}>
                          {sellerProfileData.profile.isProfileHidden ? (isAr ? "إظهار البائع" : "Unhide Seller") : (isAr ? "إخفاء البائع" : "Hide Seller")}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={isOwnerProfileActionLoading} onClick={() => void handleOwnerSuspendSeller(sellerProfileData.sellerId)}>
                          {isAr ? "تعليق البائع" : "Suspend Seller"}
                        </Button>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                          <p className="font-medium text-white">{isAr ? "سجل التدقيق" : "Audit History"}</p>
                          <p className="mt-1">{sellerProfileData.ownerTools?.auditHistory.length ?? 0} {isAr ? "سجلات" : "records"}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                          <p className="font-medium text-white">{isAr ? "سجل العمولات" : "Commission History"}</p>
                          <p className="mt-1">{sellerProfileData.ownerTools?.commissionHistory.length ?? 0} {isAr ? "سجلات" : "records"}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                          <p className="font-medium text-white">{isAr ? "سجل الصفقات" : "Trade History"}</p>
                          <p className="mt-1">{sellerProfileData.ownerTools?.tradeHistory.length ?? 0} {isAr ? "سجلات" : "records"}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                          <p className="font-medium text-white">{isAr ? "أحدث عمليات التدقيق" : "Recent Audit"}</p>
                          {(sellerProfileData.ownerTools?.auditHistory ?? []).slice(0, 3).map((entry) => (
                            <p key={entry.id} className="mt-1">{localizedAuditAction(entry.action, isAr)} • {new Date(entry.createdAt).toLocaleDateString(isAr ? "ar-IL-u-nu-latn" : "en-IL")}</p>
                          ))}
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                          <p className="font-medium text-white">{isAr ? "أحدث العمولات" : "Recent Commission"}</p>
                          {(sellerProfileData.ownerTools?.commissionHistory ?? []).slice(0, 3).map((entry) => (
                            <p key={entry.id} className="mt-1">{entry.commissionAmount.toFixed(2)} USDT • {new Date(entry.createdAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}</p>
                          ))}
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                          <p className="font-medium text-white">{isAr ? "أحدث الصفقات" : "Recent Trades"}</p>
                          {(sellerProfileData.ownerTools?.tradeHistory ?? []).slice(0, 3).map((entry) => (
                            <p key={entry.id} className="mt-1">{shortTradeRef(entry)} • {tradeStatusLabel(entry.status, isAr)}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <form id="buy-usdt-form" className="grid gap-3" onSubmit={handlePurchaseSubmit}>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "اختر طريقة الدفع" : "Choose payment method"}</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {selectedListingPaymentMethods.map((method) => {
                          const selected = selectedListingPaymentMethod === method;
                          return (
                            <button
                              key={`purchase-method-${selectedListing.id}-${method}`}
                              type="button"
                              onClick={() => {
                                setSelectedPurchasePaymentMethod(method);
                                setFaceToFaceSafetyAcknowledged(false);
                              }}
                              className={`rounded-xl border p-3 transition-all duration-200 ${isAr ? "text-right" : "text-left"} ${
                                selected
                                  ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                                  : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                              }`}
                            >
                              <p className="text-sm font-medium text-white">{paymentMethodEmoji(method)} {paymentMethodLabel(method, isAr)}</p>
                              {selected ? <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#93C5FD]">{isAr ? "مختارة لهذه الصفقة" : "Selected for this trade"}</p> : null}
                            </button>
                          );
                        })}
                      </div>
                      {selectedMethodUsesBanks(selectedListingPaymentMethod) && parseIsraeliBankSelection(selectedListing.bankName).length ? (
                        <p className="mt-3 text-xs text-[#D1D5DB]">{isAr ? "البنوك المدعومة" : "Supported banks"}: <span className="text-white">{parseIsraeliBankSelection(selectedListing.bankName).map((bankName) => getIsraeliBankDisplayName(bankName, locale)).join(isAr ? "، " : ", ")}</span></p>
                      ) : null}
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2 md:col-span-3">
                        <label htmlFor="buyer-usdt-amount" className="text-sm font-medium text-white">
                          {isAr ? "كمية USDT" : "USDT Amount"} <span className="text-red-300">*</span>
                        </label>
                        <Input
                          id="buyer-usdt-amount"
                          dir="ltr"
                          inputMode="numeric"
                          placeholder={isAr ? "أدخل الكمية" : "Enter amount"}
                          value={buyerInfo.usdtAmount}
                          onChange={(event) => setBuyerInfo((prev) => ({ ...prev, usdtAmount: formatIntegerForInput(event.target.value) }))}
                          className={`text-left ${buyerTradeAmountInvalid ? "border-red-500/80" : buyerTradeAmount > 0 ? "border-emerald-500/70" : ""}`}
                          aria-invalid={buyerTradeAmountInvalid || undefined}
                          aria-describedby="buyer-amount-help"
                        />
                        <p id="buyer-amount-help" className={`text-xs ${buyerTradeAmountInvalid ? "text-red-300" : "text-[#9CA3AF]"}`}>
                          {buyerTradeAmountInvalid ? "⚠ " : ""}{isAr ? "حدود الصفقة" : "Trade limits"}: {selectedMinTrade.toLocaleString("en-IL")} - {selectedMaxTrade.toLocaleString("en-IL")} USDT
                        </p>
                      </div>
                      <div className="space-y-2 md:col-span-3">
                        <label htmlFor="buyer-receiving-wallet" className="text-sm font-medium text-white">
                          {isAr ? "عنوان محفظة الاستلام" : "Receiving Wallet Address"} <span className="text-red-300">*</span>
                        </label>
                        <Input
                          id="buyer-receiving-wallet"
                          dir="ltr"
                          required
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={isAr ? `عنوان محفظة ${selectedListing.network}` : `${selectedListing.network} wallet address`}
                          value={buyerInfo.receivingWalletAddress}
                          onChange={(event) => setBuyerInfo((prev) => ({ ...prev, receivingWalletAddress: event.target.value }))}
                          className={`text-left font-mono ${buyerInfo.receivingWalletAddress && buyerWalletInvalid ? "border-red-500/80" : ""}`}
                          aria-describedby="buyer-wallet-guidance"
                          aria-invalid={buyerInfo.receivingWalletAddress ? buyerWalletInvalid : undefined}
                        />
                        <p
                          id="buyer-wallet-guidance"
                          className={`text-xs ${buyerInfo.receivingWalletAddress && buyerWalletInvalid ? "text-red-300" : "text-[#9CA3AF]"}`}
                        >
                          {buyerInfo.receivingWalletAddress && buyerWalletValidationError
                            ? buyerWalletValidationError
                            : isAr
                              ? `أدخل العنوان الذي تريد استلام USDT عليه عبر شبكة ${selectedListing.network}. سيبقى مخفياً عن البائع حتى تحدد أن الدفع تم إرساله.`
                              : `Enter the address where you want to receive USDT on ${selectedListing.network}. It stays hidden from the seller until you mark payment as sent.`}
                        </p>
                      </div>
                    </div>
                    {selectedListingRequiresSafetyNotice ? (
                      <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                        <p className="font-semibold text-[#FDE68A]">{isAr ? "إرشادات الأمان" : "Safety Guidelines"}</p>
                        <ul className="mt-1 list-disc space-y-1 ps-4 text-[#E5E7EB]">
                          <li>{isAr ? "التقِ في الأماكن العامة فقط." : "Meet only in public places."}</li>
                          <li>{isAr ? "اختر مكاناً توجد فيه كاميرات مراقبة." : "Prefer locations with security cameras."}</li>
                          <li>{isAr ? "التقِ خلال النهار قدر الإمكان." : "Meet during daylight when possible."}</li>
                          <li>{isAr ? "لا تكشف معلومات شخصية غير ضرورية." : "Do not reveal unnecessary personal information."}</li>
                          <li>{isAr ? "تأكد من تحويل USDT قبل المغادرة." : "Confirm the USDT transfer before leaving."}</li>
                          <li>{isAr ? "أبلغ فوراً عن أي سلوك مشبوه." : "Report suspicious behavior immediately."}</li>
                        </ul>
                        <label className="mt-2 inline-flex cursor-pointer items-start gap-2 text-[#E5E7EB]">
                          <input
                            type="checkbox"
                            checked={faceToFaceSafetyAcknowledged}
                            onChange={(event) => setFaceToFaceSafetyAcknowledged(event.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]"
                          />
                          <span>{isAr ? "قرأت إرشادات الخصوصية والأمان وفهمتها." : "I have read and understand the privacy and safety guidelines."}</span>
                        </label>
                        <p className="mt-1 text-[#D1D5DB]">{isAr ? "يجب على المشتري والبائع تأكيد هذه الإرشادات قبل بدء الصفقة." : "Both buyer and seller must acknowledge these guidelines before the trade can begin."}</p>
                        <p className="mt-1 text-[#D1D5DB]">{isAr ? <>اقرأ الإرشادات كاملة في <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">مركز الأمان والثقة</Link>.</> : <>Read full guidance in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</>}</p>
                      </div>
                    ) : null}
                    {showVerificationCta ? (
                      <Card className="border-[#C9A227]/50 bg-gradient-to-br from-amber-500/15 via-black/60 to-[#C9A227]/10 shadow-[0_0_26px_rgba(201,162,39,0.22)]">
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 text-[#FDE68A]" />
                            <div>
                              <p className="text-sm font-semibold text-[#FDE68A]">{isAr ? "⚠️ توثيق المشتري مطلوب" : "⚠️ Buyer Verification Required"}</p>
                              <p className="mt-1 text-xs text-[#E5E7EB]">
                                {isAr ? "أكمل التوثيق لبدء التداول بأمان على Alpha Exchange. تستغرق العملية أقل من دقيقة." : "Complete your verification to begin trading safely on Alpha Exchange. The verification takes less than one minute."}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              className="w-full sm:w-auto"
                              onClick={goToVerificationGate}
                              disabled={isRedirectingToVerification}
                            >
                              {isRedirectingToVerification ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                              {isRedirectingToVerification ? (isAr ? "جارٍ الانتقال إلى التوثيق..." : "Redirecting to verification...") : (isAr ? "✅ وثّق الآن" : "✅ Verify Now")}
                            </Button>
                            <button
                              type="button"
                              onClick={goToVerificationGate}
                              disabled={isRedirectingToVerification}
                              className={`${isAr ? "text-right" : "text-left"} text-xs text-[#FDE68A] underline underline-offset-2 transition hover:text-[#FFE8A3] disabled:cursor-not-allowed disabled:opacity-70`}
                            >
                              {isAr ? "الانتقال إلى التوثيق ←" : "Go to Verification →"}
                            </button>
                          </div>
                        </CardContent>
                      </Card>
                    ) : null}
                    {statusMessage && !showVerificationCta ? (
                      <Card className="border-amber-500/30 bg-black/30">
                        <CardContent className="flex items-center gap-2 p-3 text-xs text-[#FDE68A]">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>{statusMessage}</span>
                        </CardContent>
                      </Card>
                    ) : null}
                  </form>
                </div>
                <div className="shrink-0 border-t border-white/10 bg-[#0B0B0B]/95 px-5 py-3 sm:px-6 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
                  <div className="grid gap-2 md:grid-cols-2">
                    <Button type="submit" form="buy-usdt-form" className="w-full" disabled={isSubmittingPurchase || buyerTradeAmountInvalid || buyerWalletInvalid || (selectedListingRequiresSafetyNotice && !faceToFaceSafetyAcknowledged)}>
                      {isSubmittingPurchase ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                      {isSubmittingPurchase ? (isAr ? "جارٍ بدء الصفقة..." : "Starting trade...") : (isAr ? "بدء الصفقة" : "Start Trade")}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      disabled={isSubmittingPurchase || buyerTradeAmountInvalid || buyerWalletInvalid || (selectedListingRequiresSafetyNotice && !faceToFaceSafetyAcknowledged)}
                      onClick={() => void submitPurchaseRequest()}
                    >
                      {isSubmittingPurchase ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                      {isSubmittingPurchase ? (isAr ? "جارٍ الإرسال..." : "Submitting...") : (isAr ? "شراء سريع" : "Quick Buy")}
                    </Button>
                  </div>
                </div>
                </>
              ) : (
                <div className="px-5 pb-5 pt-4 sm:px-6">
                <div className="rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/10 p-4 text-sm">
                  <p className="text-base font-semibold text-white">{isAr ? "تم إرسال الطلب" : "Request Submitted"}</p>
                  <p className="mt-2 text-[#D1D5DB]">{isAr ? "استلمت Alpha Traders طلبك. سنربطك بالبائع المعتمد قريباً." : "Alpha Traders has received your request. We will connect you with the Approved Seller shortly."}</p>
                  <div className="mt-4">
                    <Button onClick={() => {
                      closeListingModal();
                    }}>{isAr ? "إغلاق" : "Close"}</Button>
                  </div>
                </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      </Portal>
    </section>
  );
}
