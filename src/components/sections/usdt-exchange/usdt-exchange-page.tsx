"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, BadgePercent, BellRing, Building2, CheckCircle2, Check, ChevronDown, ChevronRight, Clock3, Copy, Edit3, HandCoins, Loader2, LockKeyhole, MessageCircle, Network, PauseCircle, PlayCircle, ShieldCheck, Sparkles, Star, Store, Trash2, TrendingUp, Trophy, Users, Wallet, WalletCards, X, Zap } from "lucide-react";
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
import { MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS, parseIsraeliBankSelection, serializeIsraeliBankSelection } from "@/lib/israeli-banks";
import { MARKETPLACE_PAYMENT_METHODS, MAX_LISTING_PAYMENT_METHODS, isCardlessAtmPaymentMethod, isBankTransferPaymentMethod, normalizeMarketplacePaymentMethod, requiresIsraeliBankSelection, resolveListingPaymentMethods } from "@/lib/marketplace-payment-methods";
import { CLIENT_COMMISSION_WALLETS, COMMISSION_NETWORKS, type CommissionNetworkId } from "@/lib/commission-config";
import { appendLoginJourneyServerTimeline, appendLoginJourneyStep, finalizeLoginJourneyRedirectEnd, incrementLoginJourneyApiCall, isLoginJourneyTraceEnabled } from "@/lib/login-journey-trace";
import { formatBuyerId, formatListingId, formatSellerId, formatTradeId } from "@/lib/format-id";
import { replaceExchangeEntityIdsWithHints } from "@/lib/alpha-exchange-display";
import { prefetchTradeRoom } from "@/lib/trade-room-client";
import { normalizeTransactionHash } from "@/lib/tx-hash-utils";
import { getWalletAddressValidationError, normalizeWalletAddress } from "@/lib/wallet-address";
import { deriveListingCountdown, deriveSellerPresence } from "@/lib/seller-presence";
import { LISTING_CHANGE_REASONS, listingEditRequiresReason, validateListingChangeReason } from "@/lib/listing-change-reasons";
import { normalizePublicProfileUsername } from "@/lib/public-profile-username";
import { sortNotificationsNewestFirst } from "@/lib/notification-sort";
import { formatNotificationRelativeTime } from "@/lib/notification-time";
import { cn } from "@/lib/utils";
import { SELLER_PRESTIGE_TIERS } from "@/lib/seller-prestige";
import { getOfficialOwnerWhatsAppUrl } from "@/lib/official-contact";
import type { AlphaExchangeActivityLogEntry, AlphaExchangeNotification, MarketplaceListing, NotificationCategory, PremiumSellerProfileData, PurchaseRequest, SellerApplication, SellerBadge, SellerLevel, SellerStatus, SupportedNetwork, UserRole } from "@/types/alpha-exchange";

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

type Locale = "ar" | "en";

export type SessionUser = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  roles?: UserRole[];
  sellerStatus: SellerStatus;
  whatsappNumber: string;
  preferredNetworks: SupportedNetwork[];
  profilePhotoUrl: string;
  coverBannerUrl?: string;
  languages: string[];
  bio: string;
  tradingExperience?: string;
  workingHours?: string;
  preferredPaymentMethods?: string[];
  country?: string;
  city?: string;
  onlineStatus: "online" | "offline";
  lastActiveAt?: string;
  isFeaturedSeller?: boolean;
  isProfileHidden?: boolean;
  isFoundingMember?: boolean;
  isFoundingSeller?: boolean;
  isPhotoVerified?: boolean;
  notificationPreferences?: { inApp: boolean; email: boolean; sms: boolean };
  createdAt: string;
};

type FeatureCard = {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
};

type TimelineStep = {
  title: string;
  body: string;
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

function formatIls(value: number) {
  return `₪${value.toFixed(2)}`;
}

function formatUsdt(value: number) {
  return `${value.toFixed(2)} USDT`;
}

function tradeHistoryTimestamp(request: PurchaseRequest) {
  return new Date(request.completedAt ?? request.updatedAt ?? request.createdAt).getTime();
}

function groupActivityEntriesByDay(entries: AlphaExchangeActivityLogEntry[]) {
  const sorted = [...entries].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const grouped = new Map<string, AlphaExchangeActivityLogEntry[]>();
  for (const entry of sorted) {
    const dayKey = entry.createdAt.slice(0, 10);
    grouped.set(dayKey, [...(grouped.get(dayKey) ?? []), entry]);
  }
  return Array.from(grouped.entries()).map(([dayKey, items]) => ({
    dayKey,
    label: new Date(`${dayKey}T00:00:00`).toLocaleDateString("en-IL", { weekday: "short", month: "short", day: "numeric" }),
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

function shortTradeRef(request: Pick<PurchaseRequest, "displayNumber" | "tradeId" | "id">) {
  return `Trade ${formatTradeId(request.displayNumber, request.tradeId ?? request.id)}`;
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

function safeErrorMessage(context: "application" | "purchase" | "listing" | "request" | "settings" | "password" | "workspace" | "review" | "evidence") {
  const map = {
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

async function readApiErrorMessage(response: Response, fallback: string) {
  const fallbackText = fallback.trim();
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
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
    if (typeof payload.details === "string" && payload.details.trim()) return payload.details;
  } catch {
    return fallbackText;
  }

  if (rawBody.length > 0 && rawBody.length < 2048 && !rawBody.includes("{")) return fallbackText;
  return fallbackText;
}

function tradeStatusLabel(status: PurchaseRequest["status"]) {
  if (status === "payment_sent") return "Payment Sent";
  if (status === "funds_received") return "Funds Received";
  if (status === "usdt_release_pending") return "USDT Release Pending";
  if (status === "usdt_sent") return "USDT Sent";
  if (status === "review_open") return "Review Open";
  return status[0].toUpperCase() + status.slice(1);
}

type TradeQueueSectionKey = "action" | "active" | "waiting" | "completed" | "cancelled";
type TradePerspective = "buyer" | "seller";

function getTradeQueuePresentation(request: PurchaseRequest, perspective: TradePerspective) {
  if (request.status === "declined" || request.status === "cancelled") {
    return { section: "cancelled" as const, badge: "CANCELLED", badgeTone: "border-white/20 bg-white/5 text-[#9CA3AF]", rank: 4 };
  }
  if (request.status === "completed" || request.status === "review_open") {
    return { section: "completed" as const, badge: "COMPLETED", badgeTone: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200", rank: 3 };
  }

  if (perspective === "seller") {
    if (request.status === "pending" || request.status === "payment_sent" || request.status === "funds_received" || request.status === "usdt_release_pending") {
      const overdue = request.timeoutReason === "USDT release SLA expired.";
      return {
        section: "action" as const,
        badge: overdue ? "OVERDUE" : "YOUR ACTION",
        badgeTone: overdue ? "border-red-400/50 bg-red-500/15 text-red-200" : "border-[#C9A227]/50 bg-[#C9A227]/15 text-[#FDE68A]",
        rank: 0,
      };
    }
    if (request.status === "accepted" || request.status === "usdt_sent") {
      return { section: "waiting" as const, badge: "WAITING FOR BUYER", badgeTone: "border-[#6CAEFF]/40 bg-[#6CAEFF]/15 text-[#BFDBFE]", rank: 2 };
    }
    return { section: "active" as const, badge: "ACTIVE", badgeTone: "border-white/20 bg-white/5 text-[#D1D5DB]", rank: 1 };
  }

  if (request.status === "accepted" || request.status === "usdt_sent") {
    return { section: "action" as const, badge: "YOUR ACTION", badgeTone: "border-[#C9A227]/50 bg-[#C9A227]/15 text-[#FDE68A]", rank: 0 };
  }
  if (request.status === "pending" || request.status === "payment_sent" || request.status === "funds_received" || request.status === "usdt_release_pending") {
    return { section: "waiting" as const, badge: "WAITING FOR SELLER", badgeTone: "border-[#6CAEFF]/40 bg-[#6CAEFF]/15 text-[#BFDBFE]", rank: 2 };
  }
  return { section: "active" as const, badge: "ACTIVE", badgeTone: "border-white/20 bg-white/5 text-[#D1D5DB]", rank: 1 };
}

function prioritizeTradeRequests(requests: PurchaseRequest[], perspective: TradePerspective) {
  return [...requests].sort((left, right) => {
    const leftMeta = getTradeQueuePresentation(left, perspective);
    const rightMeta = getTradeQueuePresentation(right, perspective);
    if (leftMeta.rank !== rightMeta.rank) return leftMeta.rank - rightMeta.rank;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function groupTradeRequests(requests: PurchaseRequest[], perspective: TradePerspective) {
  const grouped: Record<TradeQueueSectionKey, PurchaseRequest[]> = {
    action: [],
    active: [],
    waiting: [],
    completed: [],
    cancelled: [],
  };
  for (const request of prioritizeTradeRequests(requests, perspective)) {
    grouped[getTradeQueuePresentation(request, perspective).section].push(request);
  }
  return grouped;
}

function formatRelativeMinutesLabel(value?: string) {
  if (!value) return "Unknown";
  const ms = new Date(value).getTime();
  if (!ms) return "Unknown";
  const deltaMinutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (deltaMinutes < 1) return "Just now";
  if (deltaMinutes < 60) return `${deltaMinutes} min ago`;
  const hours = Math.round(deltaMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function sellerLevelLabel(level?: SellerLevel) {
  const rank = String(level ?? "bronze");
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

function sellerBadgeLabel(badge: SellerBadge) {
  if (badge === "elite_seller") return "Elite Seller";
  if (badge === "top_rated") return "Top Rated";
  if (badge === "fast_responder") return "Fast Responder";
  if (badge === "trusted_seller") return "Trusted Seller";
  if (badge === "most_active") return "Most Active";
  if (badge === "platinum_seller") return "Platinum Seller";
  return "1000+ Trades";
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

function paymentMethodLabel(method: string) {
  const normalized = normalizeMarketplacePaymentMethod(method) ?? method;
  return PAYMENT_METHOD_META[normalized]?.shortLabel ?? normalized;
}

function paymentMethodEmoji(method: string) {
  const normalized = normalizeMarketplacePaymentMethod(method) ?? method;
  return PAYMENT_METHOD_META[normalized]?.emoji ?? "💳";
}

function paymentMethodTradeInstruction(method: string, actor: "buyer" | "seller") {
  const normalized = normalizeMarketplacePaymentMethod(method);
  if (normalized === "Bank Transfer") {
    return actor === "seller"
      ? "Bank Transfer Instructions: verify funds directly in your bank account before continuing."
      : "Bank Transfer Instructions: after marking Payment Sent, wait for seller bank confirmation.";
  }
  if (normalized === "Face-to-Face (Meet in Person)") {
    return "Face-to-Face Safety: meet in a public place, protect private information, and confirm USDT transfer before leaving.";
  }
  if (normalized === "Cardless ATM Withdrawal") {
    return actor === "seller"
      ? "Cardless ATM Withdrawal: confirm only after you collect cash from the ATM."
      : "Cardless ATM Withdrawal: mark Withdrawal Ready only after generating the ATM withdrawal code.";
  }
  return "Follow the trade timeline and complete each verification step before moving forward.";
}

function shouldRevealFaceToFaceContact(request: PurchaseRequest) {
  const method = normalizeMarketplacePaymentMethod(request.paymentMethod);
  if (method !== "Face-to-Face (Meet in Person)") return true;
  if (request.status === "pending") return false;
  return Boolean(request.buyerSafetyAcknowledged && request.sellerSafetyAcknowledged);
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
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">Official Alpha Exchange Listing</span>
          <span className="ml-auto text-[11px] text-red-400/70">Sold directly by the platform owner</span>
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
                  alt={`${safeText(listing.sellerDisplayName, "Seller")} profile`}
                  className={cn("h-11 w-11 rounded-full border border-transparent object-cover")}
                />
              ) : (
                <div className={cn("inline-flex h-11 w-11 items-center justify-center rounded-full border border-transparent text-sm font-semibold", isOwnerListing ? "bg-red-950/60 text-red-200" : "bg-white/[0.04] text-[#D1D5DB]")}>
                  {safeText(listing.sellerDisplayName, "Seller")
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </div>
              )}
            </div>
            <div>
              <div className={`flex flex-wrap items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                <CardTitle className={cn("text-lg seller-listing-seller-name", isOwnerListing ? "profile-identity-name--owner" : `seller-rank-name seller-rank-name--${sellerRankKey}`)}>{safeText(listing.sellerDisplayName, "Seller")}</CardTitle>
                {isOwnerListing ? <RoleBadge variant="owner" /> : null}
              </div>
              {isOwnerListing ? (
                <p className="mt-0.5 text-[12px] font-semibold text-[#F87171]">Alpha Exchange Owner</p>
              ) : null}
              <p className="seller-listing-seller-subtitle mt-1 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">
                <span className={cn("seller-listing-rank-label", `seller-listing-rank-label--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
                  {isOwnerListing ? "Owner" : `${sellerLevelLabel(listing.sellerReputation?.level)} Seller`}
                </span>
                <span className="seller-listing-status-separator"> • </span>
                <span className={cn("seller-listing-presence inline-flex items-center gap-1.5", `seller-presence--${presence.tone}`)}>
                  <span className={cn("seller-presence-dot", `seller-presence-dot--${presence.tone}`)} aria-hidden="true" />
                  {presence.label}
                </span>
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#93C5FD]">Listing {shortListingRef(listing)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <RoleBadge variant="approved_seller" className={cn("seller-rank-badge", `seller-rank-badge--${sellerRankKey}`)} />
                <span className={cn("seller-rank-pill", `seller-rank-pill--${isOwnerListing ? "legendary" : sellerRankKey}`)}>
                  {isOwnerListing ? "Legendary Seller" : `${sellerLevelLabel(sellerLevel)} Seller`}
                </span>
                {isOwnerListing ? (
                  <>
                    <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">✓ Email Verified</span>
                    <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">✓ Phone Verified</span>
                    <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">✓ Official Platform Account</span>
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
                  <span className="seller-live-market-badge">Live</span>
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
            <p className="mt-1 break-words font-semibold leading-snug text-white">{safeText(listing.responseTime, "5 min")}</p>
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
            <p>{isAr ? "آخر نشاط" : "Last active"}: <span className={cn("text-white", presence.tone === "online" && "text-emerald-300")}>{presence.online ? (isAr ? presence.labelAr : presence.label) : formatRelativeMinutesLabel(listing.sellerProfile?.lastActiveAt)}</span></p>
            <p>{isAr ? "الشبكة" : "Network"}: <span className="text-white">{safeText(listing.network)}</span></p>
            <div>
              <p>{isAr ? "الدفع" : "Payment"}:</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod).map((method) => (
                  <span key={`${listing.id}-${method}`} className="max-w-full break-words rounded-full border border-white/15 bg-white/[0.03] px-2 py-0.5 text-[11px] text-[#D1D5DB]">
                    {paymentMethodLabel(method)}
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
            <p>{isAr ? "المنطقة" : "Region"}: <span className="text-white">{safeText(listing.sellerProfile?.country, "Israel")}</span></p>
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
              aria-label={`Manage listing ${shortListingRef(listing)}`}
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
              aria-label={`Buy USDT from ${safeText(listing.sellerDisplayName, "seller")}`}
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
      aria-label={`Listing eligibility: ${isAr ? countdown.labelAr : countdown.label}`}
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

export function UsdtExchangePage({ locale, initialSessionUser }: { locale: Locale; initialSessionUser?: SessionUser | null }) {
  const isAr = locale === "ar";
  const router = useRouter();
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
  });
  const marketFeed = useMarketFeed({ refreshMs: 45_000 });
  const marketSnapshot = marketFeed.snapshot;

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(initialSessionUser ?? null);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [isSessionResolving, setIsSessionResolving] = useState(true);
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
  const [listingEditForm, setListingEditForm] = useState({
    availableAmount: "",
    price: "",
    currency: "ILS",
    network: "TRC20" as SupportedNetwork,
    paymentMethods: ["Bank Transfer"],
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
  } | null>(null);
  const [sellerCommissionStatus, setSellerCommissionStatus] = useState<{
    status: "clear" | "pending" | "overdue";
    pendingCount: number;
    amountDue: number;
    dueAt?: string;
    commissionId?: string;
    relatedRequestId?: string;
    relatedTradeId?: string;
    relatedTradeDisplayNumber?: number;
  } | null>(null);
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
  const [requestActionKey, setRequestActionKey] = useState<string | null>(null);
  const qaCommissionResetAttemptedRef = useRef(false);
  const [listingCreateForm, setListingCreateForm] = useState({
    availableAmount: "",
    price: "",
    currency: "",
    network: "TRC20" as SupportedNetwork,
    paymentMethods: ["Bank Transfer"],
    bankName: "",
    minimumTrade: "0",
    maximumTrade: "",
    sellerDescription: "",
  });
  const [listingCreateCurrencyManualOverride, setListingCreateCurrencyManualOverride] = useState(false);
  const [selectedPurchasePaymentMethod, setSelectedPurchasePaymentMethod] = useState<string>("Bank Transfer");

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
    setStatusMessage("Redirecting to verification...");
    router.push(`/verify-account?redirectTo=${encodeURIComponent(tradeReturnPath)}`);
  }, [router, tradeReturnPath]);
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState<"all" | SupportedNetwork>("all");
  const [showMarketplaceFilters, setShowMarketplaceFilters] = useState(false);
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
  const [sellerClosedRequestsCollapsed, setSellerClosedRequestsCollapsed] = useState(true);
  const [buyerExpandedTradeId, setBuyerExpandedTradeId] = useState<string | null>(null);
  const [isSellerApplicationExpanded, setIsSellerApplicationExpanded] = useState(false);
  const [buyerTradeVisibleCount, setBuyerTradeVisibleCount] = useState(8);
  const [tradeReviewDrafts, setTradeReviewDrafts] = useState<Record<string, string>>({});
  const [sellerResponseDrafts, setSellerResponseDrafts] = useState<Record<string, string>>({});
  const [buyerEvidenceFiles, setBuyerEvidenceFiles] = useState<Record<string, File | null>>({});
  const [sellerEvidenceFiles, setSellerEvidenceFiles] = useState<Record<string, File | null>>({});
  const [sellerSafetyAcknowledgements, setSellerSafetyAcknowledgements] = useState<Record<string, boolean>>({});
  const [evidenceUploading, setEvidenceUploading] = useState<Record<string, boolean>>({});
  const [notifications, setNotifications] = useState<AlphaExchangeNotification[]>([]);
  const [activityHistory, setActivityHistory] = useState<AlphaExchangeActivityLogEntry[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationQuery, setNotificationQuery] = useState("");
  const [notificationCategory, setNotificationCategory] = useState<"all" | NotificationCategory>("all");
  const [notificationUnreadOnly, setNotificationUnreadOnly] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<{ inApp: boolean; email: boolean; sms: boolean }>({ inApp: true, email: false, sms: false });
  const [mobileVisibleListingsCount, setMobileVisibleListingsCount] = useState(MOBILE_MARKETPLACE_BATCH_SIZE);
  const notificationsRequestIdRef = useRef(0);
  const deepLinkAppliedRef = useRef(false);
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

  const [buyerInfo, setBuyerInfo] = useState({ name: "", whatsapp: "", notes: "", usdtAmount: "", receivingWalletAddress: "" });
  const [sellerForm, setSellerForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    whatsappNumber: "",
    expectedMonthlyTradingVolume: "",
    additionalNotes: "",
  });
  const [sellerApplicationMethods, setSellerApplicationMethods] = useState<SellerApplicationMethod[]>(["USDT (ERC20 / Ethereum)"]);
  const isApprovedSellerSession = Boolean(sessionUser && hasRole(sessionUser, "approved_seller"));
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
    return response;
  }, []);

  useEffect(() => () => {
    for (const timer of discordSharePollTimersRef.current) window.clearTimeout(timer);
    discordSharePollTimersRef.current = [];
  }, []);

  const refreshSellerWorkspace = useCallback(async () => {
    try {
      const [requestsRes, myListingsRes, discordSharingRes] = await Promise.all([
        tracedFetch("Workspace data loading: purchase requests", "/api/alpha-exchange/purchase-requests", { cache: "no-store" }),
        tracedFetch("Workspace data loading: my listings", "/api/alpha-exchange/my-listings", { cache: "no-store" }),
        tracedFetch("Workspace data loading: Discord sharing", "/api/alpha-exchange/discord-sharing", { cache: "no-store" }),
      ]);
      if (requestsRes.ok) {
        const requestsJson = (await requestsRes.json()) as { requests: PurchaseRequest[] };
        setMyRequests(requestsJson.requests ?? []);
      }
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
          };
          commissionStatus?: {
            status: "clear" | "pending" | "overdue";
            pendingCount: number;
            amountDue: number;
            dueAt?: string;
            commissionId?: string;
            relatedRequestId?: string;
            relatedTradeId?: string;
            relatedTradeDisplayNumber?: number;
          };
          qaCommissionModeEnabled?: boolean;
          qaCommissionResetEnabled?: boolean;
        };
        setMyListings((myListingsJson.listings ?? []).filter((listing) => listing.status !== "closed" && listing.status !== "cancelled"));
        setSellerWorkspaceSummary(myListingsJson.summary ?? null);
        setSellerCommissionStatus(myListingsJson.commissionStatus ?? null);
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
    } catch {
      setWorkspaceError(safeErrorMessage("workspace"));
    }
  }, [tracedFetch]);

  const syncListingState = useCallback((listing: MarketplaceListing | null, options?: { remove?: boolean }) => {
    if (!listing) return;
    const shouldRemove = options?.remove === true || listing.status === "closed" || listing.status === "cancelled";
    setMyListings((prev) => {
      const next = shouldRemove ? prev.filter((item) => item.id !== listing.id) : [listing, ...prev.filter((item) => item.id !== listing.id)];
      return next.filter((item) => item.status !== "closed" && item.status !== "cancelled");
    });
    setListings((prev) => {
      const next = shouldRemove ? prev.filter((item) => item.id !== listing.id) : [listing, ...prev.filter((item) => item.id !== listing.id)];
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

  const openCommissionPayment = useCallback(() => {
    setCommissionPayOpen(true);
    setCommissionPayMessage(null);
    setCommissionTxSignature("");
    setCommissionPayerType(null);
    setCommissionAdvancedOpen(false);
  }, []);

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
      const notificationsStartedAt = Date.now();
      const response = await tracedFetch("Notifications loading", `/api/alpha-exchange/notifications?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      const payload = (await response.json()) as { notifications: AlphaExchangeNotification[]; activity: AlphaExchangeActivityLogEntry[] };
      if (requestId !== notificationsRequestIdRef.current) return;
      setNotifications(keepLatestItems(sortNotificationsNewestFirst(payload.notifications ?? []), MAX_NOTIFICATION_ITEMS));
      setActivityHistory(keepLatestItems(payload.activity ?? [], MAX_ACTIVITY_ITEMS));
      if (!notificationsLoadRecordedRef.current) {
        notificationsLoadRecordedRef.current = true;
        appendLoginJourneyStep("Notifications loading (first dashboard load)", notificationsStartedAt, Date.now(), { firstLoad: true });
      }
    } catch {
      setStatusMessage(safeErrorMessage("workspace"));
    } finally {
      setNotificationsLoading(false);
    }
  }, [notificationCategory, notificationQuery, notificationUnreadOnly, sessionUser, tracedFetch]);

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
    const response = await fetch("/api/alpha-exchange/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    await response.json();
    if (!response.ok) {
      setStatusMessage(safeErrorMessage("workspace"));
      return;
    }
    await refreshNotifications();
  }, [refreshNotifications]);

  const handleNotificationReadState = useCallback(async (notificationId: string, isRead: boolean) => {
    const response = await fetch(`/api/alpha-exchange/notifications/${notificationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead }),
    });
    await response.json();
    if (!response.ok) {
      setStatusMessage(safeErrorMessage("workspace"));
      return;
    }
    await refreshNotifications();
  }, [refreshNotifications]);

  const handleDeleteNotification = useCallback(async (notificationId: string) => {
    const response = await fetch(`/api/alpha-exchange/notifications/${notificationId}`, { method: "DELETE" });
    await response.json();
    if (!response.ok) {
      setStatusMessage(safeErrorMessage("workspace"));
      return;
    }
    await refreshNotifications();
  }, [refreshNotifications]);

  async function handleNotificationPreferencesSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/alpha-exchange/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(notificationPreferences),
    });
    await response.json();
    if (!response.ok) {
      setSellerWorkspaceMessage(safeErrorMessage("settings"));
      return;
    }
    setSellerWorkspaceMessage("Notification preferences updated.");
  }

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
        if (!cancelled) setWorkspaceError(safeErrorMessage("workspace"));
      } finally {
        if (!cancelled) setIsLoadingListings(false);
      }
    }

    async function bootstrap() {
      const workspaceInitStartedAt = Date.now();
      try {
        const listingsPromise = tracedFetch("Dashboard data loading: listings", "/api/alpha-exchange/listings", { cache: "no-store", signal: controller.signal });
        let resolvedUser = initialSessionUser ?? null;

        if (!resolvedUser) {
          const meRes = await tracedFetch("/api/auth/me", "/api/auth/me", { cache: "no-store", signal: controller.signal });
          if (cancelled) return;
          const meJson = (await meRes.json()) as { user: SessionUser | null };
          if (cancelled) return;
          resolvedUser = meJson.user;
        }

        setSessionUser(resolvedUser);
        setIsSessionResolving(false);
        const shellReadyAt = Date.now();
        appendLoginJourneyStep("Dashboard shell ready", workspaceInitStartedAt, shellReadyAt);
        bootstrapCompletedAtRef.current = shellReadyAt;
        appendLoginJourneyStep("Workspace initialization", workspaceInitStartedAt, shellReadyAt);

        if (resolvedUser) {
          const user = resolvedUser;
          setSellerForm((prev) => ({
            ...prev,
            firstName: user.fullName?.split(" ")[0] ?? prev.firstName,
            lastName: user.fullName?.split(" ").slice(1).join(" ") ?? prev.lastName,
            email: user.email ?? prev.email,
            whatsappNumber: user.whatsappNumber || prev.whatsappNumber,
          }));
          setBuyerInfo((prev) => ({
            ...prev,
            name: user.fullName,
            whatsapp: user.whatsappNumber || prev.whatsapp,
          }));
        }

        // Listings are not required to make the dashboard shell interactive.
        // Start the fetch in parallel with session bootstrap and resolve it after shell-ready.
        void loadListings(shellReadyAt, listingsPromise);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setIsSessionResolving(false);
        setIsLoadingListings(false);
        setIsWorkspaceWidgetsLoading(false);
        setIsSellerApplicationLoading(false);
        setWorkspaceError(safeErrorMessage("workspace"));
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [initialSessionUser, tracedFetch]);

  useEffect(() => {
    if (!sessionUser) return;
    setIsWorkspaceWidgetsLoading(true);
    setIsSellerApplicationLoading(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [applicationRes] = await Promise.all([
            tracedFetch("Workspace data loading: seller application", "/api/alpha-exchange/seller-application", { cache: "no-store" }),
            refreshSellerWorkspace(),
            refreshNotificationPreferences(),
          ]);
          if (cancelled) return;
          if (applicationRes.ok) {
            const applicationJson = (await applicationRes.json()) as { application: SellerApplication | null };
            if (cancelled) return;
            setSellerApplication(applicationJson.application);
          }
        } catch {
          if (!cancelled) setWorkspaceError(safeErrorMessage("workspace"));
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
  }, [refreshNotificationPreferences, refreshSellerWorkspace, sessionUser, tracedFetch]);

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
    if (isApprovedSellerSession && !deferredSellerPanelsReady) return;
    setNotificationsInitialized(true);
  }, [deferredSellerPanelsReady, isApprovedSellerSession, isSessionResolving, notificationsInitialized, sessionUser]);

  useEffect(() => {
    if (!sessionUser || !notificationsInitialized) return;
    void refreshNotifications();
  }, [sessionUser, notificationsInitialized, notificationCategory, notificationQuery, notificationUnreadOnly, refreshNotifications]);

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
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }, []);

  const scrollToBuyerTradeHistorySection = useCallback(() => {
    if (typeof document === "undefined") return false;
    const target = document.getElementById(BUYER_TRADE_HISTORY_SECTION_ID);
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
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
        setStatusMessage(payload.error ?? safeErrorMessage("workspace"));
        return;
      }
      setSellerProfileData(payload.profile);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (requestId !== sellerProfileRequestIdRef.current) return;
      setSellerProfileData(null);
      setStatusMessage(safeErrorMessage("workspace"));
    } finally {
      if (requestId === sellerProfileRequestIdRef.current) {
        sellerProfileAbortControllerRef.current = null;
        setIsSellerProfileLoading(false);
      }
    }
  }, []);

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

  useEffect(() => {
    if (isLoadingListings || selectedListing || !sessionUser) return;
    if (typeof window === "undefined") return;
    const listingId = new URLSearchParams(window.location.search).get("listing");
    if (!listingId) return;
    const listing = listings.find((item) => item.id === listingId);
    if (!listing) {
      updateListingSelectionQuery(null);
      setStatusMessage("This listing is no longer available.");
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
  }, [isLoadingListings, listings, selectedListing, sessionUser, updateListingSelectionQuery]);

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
  }, [scrollToCreateListingSection, updateListingSelectionQuery]);

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
        setCommissionPayMessage("QA commission cleanup completed.");
        await refreshSellerWorkspace();
      } catch {
        // Keep normal commission flow available if QA cleanup fails.
      }
    })();
  }, [qaCommissionModeEnabled, qaCommissionResetEnabled, refreshSellerWorkspace, sellerCommissionStatus]);

  // Generate QR code when commission modal opens or network changes
  useEffect(() => {
    if (!commissionPayOpen) return;
    const address = CLIENT_COMMISSION_WALLETS[commissionNetwork];
    if (!address) { setCommissionQrDataUrl(null); return; }
    let cancelled = false;
    void import("qrcode").then((QRCode) => {
      void QRCode.toDataURL(address, { width: 160, margin: 1, color: { dark: "#000000", light: "#ffffff" } }).then((url: string) => {
        if (!cancelled) setCommissionQrDataUrl(url);
      });
    });
    return () => { cancelled = true; };
  }, [commissionPayOpen, commissionNetwork]);

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
        setStatusMessage(payload.error ?? safeErrorMessage("request"));
        return;
      }
      setStatusMessage(successMessage);
      await Promise.all([refreshSellerWorkspace(), fetchSellerProfileData(sellerId)]);
    } catch {
      setStatusMessage(safeErrorMessage("request"));
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
        setStatusMessage(payload.error ?? safeErrorMessage("request"));
        return;
      }
      setStatusMessage("Seller suspended.");
      await Promise.all([refreshSellerWorkspace(), fetchSellerProfileData(sellerId)]);
    } catch {
      setStatusMessage(safeErrorMessage("request"));
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
    router.push("/dashboard/seller");
    setStatusMessage(`Manage your listing in Seller Dashboard (${shortListingRef(listing)}).`);
  }, [requireAuth, router, scrollToMyListingsSection]);

  async function handleSellerApplicationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requireAuth()) return;
    setStatusMessage(null);
    const fallbackMessage = safeErrorMessage("application");
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
      }
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message : fallbackMessage;
      setStatusMessage(message);
    }
  }

  async function submitPurchaseRequest(notesOverride?: string) {
    if (!selectedListing) return;
    if (isSubmittingPurchase) return;
    if (listingRequiresFaceToFaceSafetyNotice(selectedListingPaymentMethod) && !faceToFaceSafetyAcknowledged) {
      setStatusMessage("Please acknowledge the Face-to-Face privacy and safety guidelines before continuing.");
      return;
    }
    const tradeAmount = String(buyerInfo.usdtAmount ?? "").trim();
    if (!tradeAmount || toNumber(tradeAmount) <= 0) {
      setStatusMessage("Enter a valid USDT trade amount to continue.");
      return;
    }
    const requestedAmount = toNumber(tradeAmount);
    const minTrade = Math.max(0, toNumber(selectedListing.minimumTrade));
    const maxTrade = toNumber(selectedListing.maximumTrade || selectedListing.availableAmount);
    if (requestedAmount < minTrade || requestedAmount > maxTrade) {
      setStatusMessage(`Trade amount must be between ${minTrade.toLocaleString("en-IL")} and ${maxTrade.toLocaleString("en-IL")} USDT.`);
      return;
    }
    const walletValidationError = getWalletAddressValidationError(selectedListing.network, buyerInfo.receivingWalletAddress);
    if (walletValidationError) {
      setStatusMessage(walletValidationError);
      return;
    }
    const fallbackMessage = "We could not start this trade due to an unexpected server error.";
    setIsSubmittingPurchase(true);
    try {
      const response = await fetch("/api/alpha-exchange/purchase-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: selectedListing.id,
          usdtAmount: tradeAmount,
          buyerName: buyerInfo.name,
          buyerWhatsapp: buyerInfo.whatsapp,
          buyerNotes: notesOverride ?? buyerInfo.notes,
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
          && sessionUser?.isPhotoVerified !== true
          && (
            errorCode === "PHONE_VERIFICATION_REQUIRED"
            || /phone verification is required/i.test(errorMessage)
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
        setStatusMessage(errorMessage);
        return;
      }
      const data = (await response.json()) as { purchase?: PurchaseRequest };
      if (data.purchase) {
        setMyRequests((prev) => [data.purchase as PurchaseRequest, ...prev]);
        setPurchaseSubmitted(true);
        setShowVerificationCta(false);
        setIsRedirectingToVerification(false);
        setStatusMessage(null);
        closeListingModal();
        router.push(`/trade-room/${data.purchase.id}`);
      }
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to reach the server right now. Check your connection and try again.";
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
  const listingCreateMissingRequired = !listingCreateAmount
    || !listingCreatePrice
    || !listingCreateSelectedMethods.length
    || (listingCreateRequiresBank && !listingCreateSelectedBanks.length)
    || !listingCommissionAgreement;
  const listingCreateTotalIls = listingCreateAmount * listingCreatePrice;
  const listingCreateCurrencyValue = Number.isFinite(listingCreateTotalIls) ? Math.round(listingCreateTotalIls) : 0;
  const listingCreationBlocked = Boolean(sellerWorkspaceSummary && !sellerWorkspaceSummary.canCreateListing);
  const listingCreationBlockedReason = sellerWorkspaceSummary?.blockedReason ?? "Listing creation is currently blocked.";
  const listingBlockedByCommission = (sellerWorkspaceSummary?.pendingCommissionCount ?? 0) > 0;
  const listingBlockedByActiveLimit = Boolean(
    sellerWorkspaceSummary &&
    !sellerWorkspaceSummary.canCreateListing &&
    sellerWorkspaceSummary.openListingCount >= sellerWorkspaceSummary.activeListingLimit &&
    !listingBlockedByCommission,
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
  const listingEditMissingRequired = !listingEditAmount
    || !listingEditPrice
    || !listingEditSelectedMethods.length
    || (listingEditRequiresBank && !listingEditSelectedBanks.length);
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
    ? getWalletAddressValidationError(selectedListing.network, buyerInfo.receivingWalletAddress)
    : null;
  const buyerWalletInvalid = buyerWalletValidationError !== null;
  const selectedListingPaymentMethods = selectedListing ? normalizePaymentMethodList(selectedListing.paymentMethods, selectedListing.paymentMethod) : [];
  const selectedListingPaymentMethod = normalizeMarketplacePaymentMethod(selectedPurchasePaymentMethod) ?? selectedListingPaymentMethods[0] ?? null;
  const selectedListingRequiresSafetyNotice = listingRequiresFaceToFaceSafetyNotice(selectedListingPaymentMethod);
  const todayDateKey = useMemo(() => new Date().toISOString().slice(0, 10), []);

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
      const haystack = `${request.tradeId ?? request.id} ${request.buyerName} ${request.buyerWhatsapp} ${request.listingId}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [sellerRequests, sellerTradeQuery, sellerTradeStatus]);
  const sellerRequestSections = useMemo(() => groupTradeRequests(filteredSellerRequests, "seller"), [filteredSellerRequests]);
  const sortedBuyerRequests = useMemo(
    () => [...filteredBuyerRequests].sort((left, right) => tradeHistoryTimestamp(right) - tradeHistoryTimestamp(left)),
    [filteredBuyerRequests],
  );
  const handlePrefetchTradeRoom = useCallback((requestId: string) => {
    prefetchTradeRoom(router, requestId);
  }, [router]);
  const handleOpenTradeRoom = useCallback((requestId: string) => {
    prefetchTradeRoom(router, requestId);
    router.push(`/trade-room/${requestId}`);
  }, [router]);
  const pendingSellerRequests = useMemo(() => sellerRequests.filter((request) => request.status === "pending"), [sellerRequests]);
  const completedSellerRequests = useMemo(
    () => sellerRequests.filter((request) => request.status === "completed" || request.status === "review_open" || Boolean(request.completedAt)),
    [sellerRequests],
  );
  const myListingsById = useMemo(() => new Map(myListings.map((listing) => [listing.id, listing])), [myListings]);
  const listingsById = useMemo(() => new Map(listings.map((listing) => [listing.id, listing])), [listings]);

  const sellerOverviewStats = useMemo(() => {
    const completedByListing = completedSellerRequests.map((request) => {
      const listing = myListingsById.get(request.listingId);
      return {
        amount: toNumber(listing?.availableAmount ?? "0"),
        price: toNumber(listing?.price ?? "0"),
      };
    });
    const totalUsdtSold = completedByListing.reduce((sum, item) => sum + item.amount, 0);
    const grossSales = completedByListing.reduce((sum, item) => sum + item.amount * item.price, 0);
    const estimatedEarnings = grossSales * 0.99;
    const responseMinutes = myListings.map((listing) => parseMinutes(listing.responseTime)).filter((value) => value > 0);
    const averageResponseTime = responseMinutes.length ? `${Math.round(responseMinutes.reduce((sum, value) => sum + value, 0) / responseMinutes.length)} min` : "5 min";
    const acceptedCount = sellerRequests.filter((request) => request.status !== "pending" && request.status !== "declined" && request.status !== "cancelled").length;
    const completionRate = sellerRequests.length ? (completedSellerRequests.length / sellerRequests.length) * 100 : 0;
    const successRate = sellerRequests.length ? ((acceptedCount + Math.max(0, sellerRequests.length - acceptedCount - 1)) / sellerRequests.length) * 100 : 0;
    const repeatBuyers = sellerRequests.reduce<Record<string, number>>((acc, request) => {
      if (request.status !== "completed") return acc;
      acc[request.buyerId] = (acc[request.buyerId] ?? 0) + 1;
      return acc;
    }, {});
    const repeatBuyersCount = Object.values(repeatBuyers).filter((count) => count > 1).length;
    const averageTradeSize = completedSellerRequests.length ? grossSales / completedSellerRequests.length : 0;
    const estimatedCommissionPaid = grossSales * 0.01;
    const selfReputation = myListings.find((listing) => Boolean(listing.sellerReputation))?.sellerReputation ?? null;
    return {
      activeListings: myListings.filter((listing) => listing.status === "active").length,
      pendingRequests: pendingSellerRequests.length,
      completedTrades: completedSellerRequests.length,
      totalUsdtSold,
      estimatedEarnings,
      averageResponseTime,
      tradeRequests: sellerRequests.length,
      successRate,
      completionRate,
      estimatedCommissionPaid,
      revenueGenerated: grossSales,
      repeatBuyers: repeatBuyersCount,
      averageTradeSize,
      reputation: selfReputation,
    };
  }, [completedSellerRequests, myListings, myListingsById, pendingSellerRequests.length, sellerRequests]);
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
  const todaysCompletedTrades = useMemo(
    () =>
      !deferredSellerPanelsReady
        ? 0
        :
      myRequests.filter((request) => {
        const completedAt = request.completedAt ?? (request.status === "completed" ? request.updatedAt : "");
        return completedAt.slice(0, 10) === todayDateKey;
      }).length,
    [deferredSellerPanelsReady, myRequests, todayDateKey],
  );
  const sortedNotifications = useMemo(() => sortNotificationsNewestFirst(notifications), [notifications]);
  const marketplaceUpdates = useMemo(() => {
    if (!deferredSellerPanelsReady) return [];
    const activityItems = activityHistory.slice(0, 6).map((entry) => ({
      id: `activity-${entry.id}`,
      title: entry.title,
      details: entry.details,
      createdAt: entry.createdAt,
    }));
    if (activityItems.length) return activityItems;
    return sortedNotifications.slice(0, 6).map((notification) => ({
      id: `notification-${notification.id}`,
      title: notification.title,
      details: notification.message,
      createdAt: notification.createdAt,
    }));
  }, [activityHistory, deferredSellerPanelsReady, sortedNotifications]);
  const groupedActivityHistory = useMemo(
    () => (deferredSellerPanelsReady ? groupActivityEntriesByDay(activityHistory).slice(0, 4) : []),
    [activityHistory, deferredSellerPanelsReady],
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
      .map(([method]) => paymentMethodLabel(method))
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
      activeDays: new Set(buyerRequests.map((request) => (request.completedAt ?? request.updatedAt ?? request.createdAt).slice(0, 10))).size,
    };
  }, [buyerRequests, listingsById, marketPricePerUsdt, sortedBuyerRequests]);

  useEffect(() => {
    setBuyerTradeVisibleCount(8);
    setBuyerExpandedTradeId(null);
  }, [buyerTradeQuery, buyerTradeStatus, sessionUser?.id]);

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
        const normalized = paymentMethodLabel(String(method ?? "Bank Transfer"));
        acc[normalized] = (acc[normalized] ?? 0) + 1;
      });
      return acc;
    }, {});
    const topPaymentMethod = Object.entries(paymentMethodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Bank Transfer";
    const newestSellers = [...sourceListings]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .reduce<string[]>((acc, listing) => {
        const name = safeText(listing.sellerDisplayName, "Seller");
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
  }, [filteredListings, listings]);

  const greetingLabel = greetingByTime(isAr);
  const workspaceDisplayId = toWorkspaceDisplayId(sessionUser, isApprovedSeller);
  const workspacePrimaryName = safeText(sessionUser?.fullName, "Trader").split(" ")[0] || "Trader";
  const workspacePositiveMessage = isApprovedSeller
    ? "You are in control. Your listings, trades, and alerts are ready."
    : "Your workspace is ready. Track activity first, then jump into the marketplace.";

  const openTradeCount = isApprovedSeller
    ? sellerRequests.filter((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status)).length
    : buyerRequests.filter((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status)).length;
  const totalBuyerRequests = buyerRequests.length;
  const unreadNotificationsTotal = notifications.filter((item) => !item.isRead).length;
  const latestOpenBuyerTrade = buyerRequests.find((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status));
  const latestOpenSellerTrade = sellerRequests.find((request) => !["completed", "review_open", "declined", "cancelled"].includes(request.status));
  const complianceCaseActive = (sellerCommissionStatus?.status ?? "clear") !== "clear";
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
        sellerCommissionStatus && sellerCommissionStatus.status !== "clear"
          ? {
              title: sellerCommissionStatus.status === "overdue" ? "Commission overdue" : "Commission due",
              body: sellerCommissionStatus.status === "overdue"
                ? "Complete the payment to restore full seller access."
                : "Pay the current commission to keep listing actions available.",
              action: "Pay now",
              onClick: openCommissionPayment,
            }
          : null,
        latestOpenSellerTrade
          ? {
              title: "Trade waiting",
              body: `Trade ${formatTradeId(latestOpenSellerTrade.displayNumber, latestOpenSellerTrade.tradeId ?? latestOpenSellerTrade.id)} needs your attention.`,
              action: "Open trade",
              onClick: () => handleOpenTradeRoom(latestOpenSellerTrade.id),
            }
          : null,
        sellerOverviewStats.pendingRequests > 0
          ? {
              title: "Pending requests",
              body: `${sellerOverviewStats.pendingRequests.toLocaleString("en-IL")} buyer requests are waiting for review.`,
              action: "Review listings",
              onClick: () => {
                if (!scrollToMyListingsSection()) {
                  void scrollToCreateListingSection();
                }
              },
            }
          : null,
        unreadNotificationsTotal > 0
          ? {
              title: "Unread notifications",
              body: `${unreadNotificationsTotal.toLocaleString("en-IL")} new updates are ready.`,
              action: "Open notifications",
              onClick: () => router.push("/notifications"),
            }
          : null,
        urgentSellerListing
          ? {
              title: "Listing expiring soon",
              body: "Renew the listing before it drops out of view.",
              action: "Review listing",
              onClick: () => {
                document.getElementById(`listing-${urgentSellerListing.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              },
            }
          : null,
      ].filter(isAttentionItem)
    : [
        pendingBuyerReviewTrade
          ? {
              title: "Complete your previous trade",
              body: "Leave feedback before starting another request.",
              action: "Leave feedback",
              onClick: () => router.push(`/trade-room/${pendingBuyerReviewTrade.id}`),
            }
          : null,
        latestOpenBuyerTrade
          ? {
              title: "Active trade",
              body: `Trade ${formatTradeId(latestOpenBuyerTrade.displayNumber, latestOpenBuyerTrade.tradeId ?? latestOpenBuyerTrade.id)} is in progress.`,
              action: "Open trade",
              onClick: () => handleOpenTradeRoom(latestOpenBuyerTrade.id),
            }
          : null,
        unreadNotificationsTotal > 0
          ? {
              title: "Unread notifications",
              body: `${unreadNotificationsTotal.toLocaleString("en-IL")} new updates are ready.`,
              action: "Open notifications",
              onClick: () => router.push("/notifications"),
            }
          : null,
      ].filter(isAttentionItem);
  const shouldCondenseSellerApplication = Boolean(
    sessionUser
    && !isApprovedSeller
    && sessionUser.isPhotoVerified === true
    && sellerApplication?.status !== "pending"
    && !applicationSubmitted,
  );

  const workspaceCards: Array<{ key: string; title: string; subtitle: string; stat: string; onClick: () => void; icon: typeof Trophy; tone?: "gold" | "blue" | "green" | "amber" }> = isApprovedSeller
    ? [
      {
        key: "listings",
        title: "Active Listings",
        subtitle: "Manage Listings",
        stat: `${sellerOverviewStats.activeListings.toLocaleString("en-IL")}`,
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
        title: "Active Trades",
        subtitle: "Trade Center",
        stat: `${openTradeCount.toLocaleString("en-IL")}`,
        onClick: () => {
          if (sessionUser?.id && openTradeCount > 0) {
            if (latestOpenSellerTrade) {
              handleOpenTradeRoom(latestOpenSellerTrade.id);
              return;
            }
          }
          router.push("/trade-room");
        },
        icon: HandCoins,
        tone: "blue",
      },
      {
        key: "notifications",
        title: "Notifications",
        subtitle: "Notification Center",
        stat: `${notifications.filter((item) => !item.isRead).length.toLocaleString("en-IL")}`,
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
        title: "Today's Market",
        subtitle: "Market Details",
        stat: formatIls(marketPricePerUsdt),
        onClick: () => {
          const target = document.getElementById("market-overview");
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        },
        icon: TrendingUp,
        tone: "amber",
      },
    ]
    : [
      {
        key: "browse-marketplace",
        title: "Browse Marketplace",
        subtitle: "Live Offers",
        stat: `${marketplacePulse.liveListings.toLocaleString("en-IL")}`,
        onClick: () => {
          const target = document.getElementById("marketplace");
          if (target) {
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
        title: "My Trade Requests",
        subtitle: "Request Queue",
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
        title: "Active Trades",
        subtitle: "Continue Trade",
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
        title: "Notifications",
        subtitle: "Notification Center",
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
        title: "Market Overview",
        subtitle: "Today’s Market",
        stat: formatIls(marketPricePerUsdt),
        onClick: () => {
          const target = document.getElementById("market-overview");
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        },
        icon: TrendingUp,
        tone: "amber",
      },
    ];
  if (complianceCaseActive) {
    workspaceCards.push({
      key: "compliance",
      title: "Compliance",
      subtitle: "Compliance Case",
      stat: "Action",
      onClick: () => openCommissionPayment(),
      icon: ShieldCheck,
      tone: "amber",
    });
  }

  const quickActions = isApprovedSeller
    ? [
      {
        key: "create-listing",
        label: "Create Listing",
        enabled: canAccessListingCreation,
        onClick: () => {
          void scrollToCreateListingSection();
        },
      },
      {
        key: "manage-listings",
        label: "Manage Listings",
        enabled: true,
        onClick: () => {
          void scrollToMyListingsSection();
        },
      },
      {
        key: "active-trades",
        label: "Active Trades",
        enabled: true,
        onClick: () => {
          if (latestOpenSellerTrade) {
            handleOpenTradeRoom(latestOpenSellerTrade.id);
            return;
          }
          router.push("/trade-room");
        },
      },
      {
        key: "notifications",
        label: "Notifications",
        enabled: true,
        onClick: () => router.push("/notifications"),
      },
      {
        key: "market-overview",
        label: "Market Overview",
        enabled: true,
        onClick: () => {
          const target = document.getElementById("market-overview");
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
          router.push("/usdt-exchange#market-overview");
        },
      },
      {
        key: "seller-dashboard",
        label: "Seller Dashboard",
        enabled: true,
        onClick: () => {
          router.push("/dashboard/seller");
        },
      },
    ]
    : [
      {
        key: "browse-marketplace",
        label: "Browse Marketplace",
        enabled: true,
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
        key: "trade-requests",
        label: "My Trade Requests",
        enabled: true,
        onClick: () => {
          if (scrollToBuyerTradeHistorySection()) return;
          router.push(`/usdt-exchange#${BUYER_TRADE_HISTORY_SECTION_ID}`);
        },
      },
      {
        key: "active-trades",
        label: "Active Trades",
        enabled: true,
        onClick: () => {
          if (latestOpenBuyerTrade) {
            handleOpenTradeRoom(latestOpenBuyerTrade.id);
            return;
          }
          router.push("/trade-room");
        },
      },
      {
        key: "notifications",
        label: "Notifications",
        enabled: true,
        onClick: () => router.push("/notifications"),
      },
      {
        key: "market-overview",
        label: "Market Overview",
        enabled: true,
        onClick: () => {
          const target = document.getElementById("market-overview");
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
          router.push("/usdt-exchange#market-overview");
        },
      },
    ];

  const heroPrimaryActions = isApprovedSeller
    ? [
      {
        key: "hero-create-listing",
        label: "Create Listing",
        onClick: () => {
          void scrollToCreateListingSection();
        },
      },
      {
        key: "hero-active-trades",
        label: "Active Trades",
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
        label: "Browse Marketplace",
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
        label: "My Trade Requests",
        onClick: () => {
          if (scrollToBuyerTradeHistorySection()) return;
          router.push(`/usdt-exchange#${BUYER_TRADE_HISTORY_SECTION_ID}`);
        },
      },
    ];

  const resolveNotificationHref = useCallback((notification: AlphaExchangeNotification) => {
    const explicit = (notification.actionHref ?? notification.relatedHref ?? "").trim();
    if (explicit) return explicit;
    if (notification.relatedTradeId) return `/trade-room/${notification.relatedTradeId}`;
    if (notification.relatedRequestId) return `/trade-room/${notification.relatedRequestId}`;
    if (notification.relatedListingId) return `/usdt-exchange#listing-${notification.relatedListingId}`;
    const text = `${notification.title} ${notification.message}`.toLowerCase();
    if (text.includes("compliance") || text.includes("flagged seller") || text.includes("recovery fee")) {
      return isOwnerViewer
        ? "/admin/alpha-exchange?section=marketplace-enforcement"
        : "/dashboard/seller/compliance-payment";
    }
    return null;
  }, [isOwnerViewer]);

  const resolveNotificationLabel = useCallback((notification: AlphaExchangeNotification) => {
    if (notification.actionLabel?.trim()) return notification.actionLabel.trim();
    if (notification.relatedTradeId || notification.relatedRequestId) return "Open Trade Room";
    if (notification.relatedListingId) return "Open Listing";
    const text = `${notification.title} ${notification.message}`.toLowerCase();
    if (text.includes("compliance") || text.includes("flagged seller") || text.includes("recovery fee")) {
      return "Open Compliance";
    }
    return "Open";
  }, []);

  const isListingActionBusy = useCallback(
    (listingId: string) => Boolean(listingActionKey && listingActionKey.startsWith(`${listingId}:`)),
    [listingActionKey],
  );

  async function handleSellerListingStatus(listing: MarketplaceListing, nextStatus: "active" | "paused") {
    const actionLabel = nextStatus === "paused" ? "pause" : "resume";
    const confirmed = window.confirm(nextStatus === "paused" ? "Pause this listing? Buyers will not see it until you resume." : "Resume this listing and make it visible to buyers?");
    if (!confirmed) return;
    setListingActionKey(`${listing.id}:${actionLabel}`);
    try {
      const response = await fetch(`/api/alpha-exchange/listings/${listing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) {
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing")));
        return;
      }

      setSellerWorkspaceMessage(nextStatus === "paused" ? "⏸ Listing paused. It is no longer visible to buyers until you resume it." : "▶ Listing resumed. Your listing is now live in the marketplace.");
      await refreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing"));
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
        setSellerWorkspaceMessage(payload.error || "Discord listing sharing is temporarily unavailable.");
        return;
      }
      setSellerWorkspaceMessage(
        payload.accepted
          ? "Discord share accepted. Publishing is processing in the background."
          : "This listing already has a current Discord share state.",
      );
      scheduleDiscordSharingRefreshes();
    } catch {
      setSellerWorkspaceMessage("Discord listing sharing is temporarily unavailable.");
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
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing")));
        return;
      }
      syncListingState(listing, { remove: true });
      setSellerWorkspaceMessage("🗑 Listing removed successfully.");
      setRemovalListing(null);
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing"));
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
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing")));
        return;
      }
      const payload = await response.json() as { listing?: MarketplaceListing };
      syncListingState(payload.listing ?? null);
      setSellerWorkspaceMessage("📋 Listing duplicated successfully. Review and publish it when ready.");
      setEditingListingId(null);
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing"));
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
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing")));
        return;
      }
      const payload = await response.json() as { listing?: MarketplaceListing };
      syncListingState(payload.listing ?? listing);
      setSellerWorkspaceMessage("🔄 Listing renewed. Your listing is now live with a refreshed expiry.");
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing"));
    } finally {
      setListingActionKey(null);
    }
  }

  async function handleSellerListingCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (listingCreationBlocked) {
      setSellerWorkspaceMessage(listingCreationBlockedReason);
      return;
    }
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
          bankName: serializeIsraeliBankSelection(listingCreateSelectedBanks),
          minimumTrade: listingCreateForm.minimumTrade,
          maximumTrade: listingCreateForm.maximumTrade || listingCreateForm.availableAmount,
          sellerDescription: listingCreateForm.sellerDescription,
          responseTime: DEFAULT_RESPONSE_TIME,
          acceptedCommissionPolicy: listingCommissionAgreement,
        }),
      });
      if (!response.ok) {
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing")));
        return;
      }
      const payload = await response.json() as { listing?: MarketplaceListing };
      syncListingState(payload.listing ?? null);
      setListingCreateForm((prev) => ({
        ...prev,
        availableAmount: "",
        price: "",
        currency: "",
        paymentMethods: ["Bank Transfer"],
        bankName: "",
        minimumTrade: "0",
        maximumTrade: "",
        sellerDescription: "",
      }));
      setListingCreateCurrencyManualOverride(false);
      setListingCommissionAgreement(false);
      setSellerWorkspaceMessage("✅ Listing published successfully. Buyers can now see your listing in the marketplace.");
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing"));
    } finally {
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
          bankName: serializeIsraeliBankSelection(listingEditSelectedBanks),
          minimumTrade: listingEditForm.minimumTrade,
          maximumTrade: listingEditForm.maximumTrade || listingEditForm.availableAmount,
          sellerDescription: listingEditForm.sellerDescription,
          changeReason: requiresReason ? listingEditForm.changeReason : undefined,
          changeExplanation: requiresReason ? listingEditForm.changeExplanation : undefined,
        }),
      });
      if (!response.ok) {
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing")));
        return;
      }
      const payload = await response.json() as { listing?: MarketplaceListing };
      syncListingState(payload.listing ?? null);
      setEditingListingId(null);
      setListingEditOriginal(null);
      setSellerWorkspaceMessage("✅ Listing updated successfully. Changes are now visible to buyers.");
      backgroundRefreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing"));
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
      const message = "Evidence file is too large. Maximum size is 8MB.";
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
        const message = payload.error ?? safeErrorMessage("evidence");
        if (side === "buyer") setStatusMessage(message);
        else setSellerWorkspaceMessage(message);
        return false;
      }
      if (side === "buyer") {
        setBuyerEvidenceFiles((prev) => ({ ...prev, [requestId]: null }));
        setStatusMessage("Buyer evidence uploaded.");
      } else {
        setSellerEvidenceFiles((prev) => ({ ...prev, [requestId]: null }));
        setSellerWorkspaceMessage("Seller evidence uploaded.");
      }
      await refreshSellerWorkspace();
      return true;
    } catch {
      if (side === "buyer") setStatusMessage(safeErrorMessage("evidence"));
      else setSellerWorkspaceMessage(safeErrorMessage("evidence"));
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
        setSellerWorkspaceMessage(payload.error ?? safeErrorMessage("request"));
        return;
      }
      if (nextStatus === "accepted") setSellerWorkspaceMessage("Request accepted and trade created.");
      else if (nextStatus === "funds_received") setSellerWorkspaceMessage("Funds received confirmed.");
      else if (nextStatus === "usdt_release_pending") setSellerWorkspaceMessage("USDT release started.");
      else if (nextStatus === "usdt_sent") setSellerWorkspaceMessage("USDT sent marked.");
      else setSellerWorkspaceMessage("Request declined.");
      await refreshSellerWorkspace();
    } finally {
      setRequestActionKey(null);
    }
  }

  async function handleCommissionPayNow() {
    if (!sellerCommissionStatus?.commissionId) {
      setCommissionPayMessage("No payable commission record was found.");
      return;
    }
    if (!commissionTxSignature.trim()) {
      setCommissionPayMessage("Please paste your transaction hash before confirming.");
      return;
    }
    const walletAddress = CLIENT_COMMISSION_WALLETS[commissionNetwork];
    if (!walletAddress) {
      setCommissionPayMessage(`No wallet address configured for ${commissionNetwork}. Please contact support.`);
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
        setCommissionPayMessage(payload.error ?? "Unable to verify commission payment.");
        return;
      }
      setCommissionPayMessage(payload.verification?.verified ? "✅ Commission payment verified. Seller access has been unlocked." : (payload.verification?.notes ?? "Verification failed."));
      setCommissionTxSignature("");
      await refreshSellerWorkspace();
    } catch {
      setCommissionPayMessage("Unable to verify commission payment.");
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
      setStatusMessage(payload.error ?? safeErrorMessage("request"));
      return;
    }
    const paymentMethod = normalizeMarketplacePaymentMethod(request.paymentMethod) ?? request.paymentMethod;
    setStatusMessage(
      nextStatus === "payment_sent"
        ? (paymentMethod === "Cardless ATM Withdrawal" ? "Withdrawal marked as ready." : "Payment sent confirmed.")
        : nextStatus === "completed"
          ? "Trade completed. Review window is open."
          : "Request cancelled.",
    );
    await refreshSellerWorkspace();
  }

  async function handleSubmitBuyerReview(request: PurchaseRequest) {
    const comment = String(tradeReviewDrafts[request.id] ?? "").trim();
    if (!comment) {
      setStatusMessage(safeErrorMessage("review"));
      return;
    }
    const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "buyer_review", rating: 5, comment }),
    });
    await response.json();
    if (!response.ok) {
      setStatusMessage(safeErrorMessage("review"));
      return;
    }
    setTradeReviewDrafts((prev) => ({ ...prev, [request.id]: "" }));
    setStatusMessage("Review submitted.");
    await refreshSellerWorkspace();
  }

  async function handleSubmitSellerResponse(request: PurchaseRequest) {
    const message = String(sellerResponseDrafts[request.id] ?? "").trim();
    if (!message) {
      setSellerWorkspaceMessage(safeErrorMessage("review"));
      return;
    }
    const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "seller_response", message }),
    });
    await response.json();
    if (!response.ok) {
      setSellerWorkspaceMessage(safeErrorMessage("review"));
      return;
    }
    setSellerResponseDrafts((prev) => ({ ...prev, [request.id]: "" }));
    setSellerWorkspaceMessage("Review response submitted.");
    await refreshSellerWorkspace();
  }

  function handleMessageBuyer(request: PurchaseRequest) {
    const number = request.buyerWhatsapp.replace(/[^\d]/g, "");
    if (!number) return;
    window.open(`https://wa.me/${number}`, "_blank", "noopener,noreferrer");
  }

  const unreadNotificationsCount = notifications.filter((item) => !item.isRead).length;

  const notificationCenterCard = sessionUser ? (
    <Card id="notification-center-section" className="border-white/10 bg-[#0B0B0B]/90">
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <BellRing className="h-4 w-4 text-[#C9A227]" />
          Notification Center
          <span className="rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2 py-0.5 text-[11px] text-[#C9A227]">{unreadNotificationsCount} unread</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder="Search notifications..." value={notificationQuery} onChange={(event) => setNotificationQuery(event.target.value)} />
          <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={notificationCategory} onChange={(event) => setNotificationCategory(event.target.value as typeof notificationCategory)}>
            <option value="all">Category: All</option>
            <option value="trade">Trade</option>
            <option value="listing">Listing</option>
            <option value="application">Application</option>
            <option value="trust">Trust</option>
            <option value="review">Review</option>
            <option value="account">Account</option>
            <option value="dispute">Dispute</option>
            <option value="report">Report</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setNotificationUnreadOnly((prev) => !prev)}>
            {notificationUnreadOnly ? "Showing unread only" : "Show unread only"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void handleMarkAllNotificationsRead()}>
            Mark All Read
          </Button>
        </div>
        <div className="space-y-3">
          {!notificationsInitialized ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9CA3AF]">
              Loading notification center…
            </div>
          ) : null}
          {notificationsLoading ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9CA3AF]">Loading notifications...</div>
          ) : null}
          {notificationsInitialized && !notificationsLoading && notifications.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center text-xs text-[#9CA3AF]">
              <BellRing className="mx-auto mb-2 h-4 w-4 text-[#9CA3AF]" />
              No notifications yet. You’ll be notified here about trades, listings, reviews, and account activity.
            </div>
          ) : null}
          {sortedNotifications.slice(0, 10).map((notification) => (
            <div key={notification.id} className={`rounded-2xl border p-4 text-xs ${notification.isRead ? "border-white/10 bg-black/20 text-[#9CA3AF]" : "border-[#C9A227]/35 bg-[#C9A227]/10 text-[#F3F4F6]"}`}>
              {(() => {
                const actionHref = resolveNotificationHref(notification);
                const actionLabel = resolveNotificationLabel(notification);
                return (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div>
                        <p className="text-sm font-semibold text-white">{replaceExchangeEntityIdsWithHints(notification.title, notification)}</p>
                        <p className="mt-1 text-[11px] text-[#93C5FD]">
                          {notification.relatedListingDisplayNumber ? `Listing ${formatListingId(notification.relatedListingDisplayNumber, notification.relatedListingId)}` : null}
                          {notification.relatedTradeDisplayNumber ? `${notification.relatedListingDisplayNumber ? " • " : ""}Trade ${formatTradeId(notification.relatedTradeDisplayNumber, notification.relatedTradeId)}` : null}
                          {notification.relatedRequestDisplayNumber && !notification.relatedTradeDisplayNumber ? `${notification.relatedListingDisplayNumber ? " • " : ""}Trade ${formatTradeId(notification.relatedRequestDisplayNumber, notification.relatedRequestId)}` : null}
                        </p>
                      </div>
                      <p className="max-w-3xl text-sm leading-6 text-white/90">{replaceExchangeEntityIdsWithHints(notification.message, notification)}</p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#9CA3AF]">
                        <span>{formatNotificationRelativeTime(notification.createdAt, locale)}</span>
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 capitalize text-[#D1D5DB]">{notification.category}</span>
                      </div>
                      {actionHref ? (
                        <a href={actionHref} className="inline-flex items-center rounded-full border border-[#6CAEFF]/40 bg-[#6CAEFF]/10 px-3 py-1.5 text-[11px] font-medium text-[#93C5FD] transition hover:border-[#6CAEFF]/70">
                          {actionLabel}
                        </a>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button type="button" size="sm" variant="secondary" className="h-9 px-3" onClick={() => void handleNotificationReadState(notification.id, !notification.isRead)}>
                        {notification.isRead ? "Unread" : "Read"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" className="h-9 px-3" onClick={() => void handleDeleteNotification(notification.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  ) : null;

  const marketInsightsCard = sessionUser && isApprovedSeller ? (
    <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
      <CardHeader>
        <CardTitle>Marketplace Insights</CardTitle>
        <CardDescription>Daily signals to help you trade faster and build seller trust.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
              <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">Today’s Completed Trades</p>
              <p className="mt-1 text-lg font-semibold text-white">{todaysCompletedTrades.toLocaleString("en-IL")}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
              <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">Active Listings</p>
              <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.activeListings.toLocaleString("en-IL")}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
              <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">Trade Success Rate</p>
              <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.successRate.toFixed(1)}%</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
              <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">Pending Requests</p>
              <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.pendingRequests.toLocaleString("en-IL")}</p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Marketplace Updates</p>
            {!marketplaceUpdates.length ? <p className="text-xs text-[#9CA3AF]">No updates yet. Your activity appears here as soon as you trade.</p> : null}
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
            <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">Seller Level Progress</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <p className="text-white">
                Current Rank: <span className="font-semibold text-[#F3D979]">{sellerLevelLabel(sellerCurrentRank)}</span>
              </p>
              <p className="text-white">
                Next Rank: <span className="font-semibold text-[#F3D979]">{sellerNextTier ? (<span className="inline-flex items-center gap-1"><Trophy className="h-3.5 w-3.5 text-[#F4D87A]" />{sellerLevelLabel(sellerNextTier.rank)}</span>) : "Top Tier Reached"}</span>
              </p>
              <p>Completed Volume: <span className="font-semibold text-white">{formatWholeNumber(sellerCompletedVolumeUsdt)} USDT</span></p>
              <p>Required: <span className="font-semibold text-white">{formatWholeNumber(sellerRequiredVolumeUsdt)} USDT</span></p>
              <p>Remaining: <span className="font-semibold text-white">{formatWholeNumber(sellerRemainingVolumeUsdt)} USDT</span></p>
              <p>Progress: <span className="font-semibold text-white">{Math.round(sellerLevelProgressPercent)}%</span></p>
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
                  ? `Only ${formatWholeNumber(sellerRemainingVolumeUsdt)} USDT remaining to reach ${sellerLevelLabel(sellerNextTier.rank)}`
                  : "You are already at the highest seller tier."}
              </p>
              {sellerNextTier ? <p className="mt-1 text-xs text-[#F4D87A]">Keep trading to unlock {sellerLevelLabel(sellerNextTier.rank)} benefits.</p> : null}
              <p className="mt-1 text-xs text-[#F3F4F6]">{formatWholeNumber(sellerCompletedVolumeUsdt)} / {formatWholeNumber(sellerRequiredVolumeUsdt)} USDT completed</p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Quick Actions</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (!scrollToMyListingsSection()) {
                    void scrollToCreateListingSection();
                  }
                }}
              >
                Create Listing
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => router.push("/dashboard/seller")}>Seller Dashboard</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => router.push("/profile")}>Public Profile</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => router.push("/settings")}>Account Settings</Button>
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
                    <p className="font-medium text-white">{shortTradeRef(request)}</p>
                    <p className="mt-0.5">{toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT • {paymentMethodLabel(request.paymentMethod)}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#C9A227]">{tradeStatusLabel(request.status)}</span>
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
                  <span className="font-semibold uppercase tracking-[0.12em]">Seller Status</span>
                  <RoleBadge variant="approved_seller" />
                  <span className="text-[#E5E7EB]">Approved Seller</span>
                </div>
              ) : (
                <p className="text-xs uppercase tracking-[0.18em] text-[#D4AF37]">{greetingLabel}</p>
              )}
              <h1 className="mt-2 text-2xl font-semibold text-white md:text-4xl">
                Welcome back, {workspacePrimaryName}
              </h1>
              <p className="mt-1 text-sm text-[#D1D5DB]">{workspacePositiveMessage}</p>
              {isApprovedSeller ? (
                <>
                  <p className="mt-2 text-xs text-[#9CA3AF]">
                    Approval Date: {new Date((sellerApplication?.updatedAt ?? sessionUser?.createdAt) || Date.now()).toLocaleDateString("en-IL")}
                  </p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[#D4AF37]">{greetingLabel}</p>
                </>
              ) : null}
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
              <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">Trading Name</p>
                  <p className="mt-1 text-sm font-semibold text-white">{safeText(sessionUser.fullName, "Trader")}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">Seller Level</p>
                  <p className="mt-1 text-sm font-semibold text-white">{sellerLevelLabel(sellerOverviewStats.reputation?.level)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">AT ID</p>
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
                        if (isApprovedSeller) setSellerWorkspaceMessage(`Copied ${workspaceDisplayId}`);
                        else setStatusMessage(`Copied ${workspaceDisplayId}`);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">Today&apos;s Market</p>
                  <p className="mt-1 text-sm font-semibold text-white">USDT / ILS {formatIls(marketPricePerUsdt)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[#9CA3AF]">{isApprovedSeller ? (isAr ? "ملخص مساحة العمل" : "Workspace Summary") : (isAr ? "ملخص الحساب" : "Account Summary")}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {workspaceCards.map((card) => {
                const Icon = card.icon;
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
                    className={`w-full rounded-2xl border p-3.5 text-left transition hover:-translate-y-0.5 hover:border-white/30 ${toneClass}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{card.title}</p>
                        <p className="mt-1 text-xs font-medium text-[#D1D5DB]">{card.subtitle}</p>
                      </div>
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/20">
                        <Icon className="h-4 w-4 text-[#F4D87A]" />
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{card.stat}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <Card className="mt-4 border-white/10 bg-[#0B0B0B]/90">
            <CardHeader className="pb-3">
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>{isApprovedSeller ? "One tap actions for your daily seller workflow." : "One tap actions for your daily buyer workflow."}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {quickActions.map((action) => (
                  <Button
                    key={action.key}
                    type="button"
                    variant="secondary"
                    className="h-12 justify-between rounded-2xl px-4 text-sm font-semibold"
                    onClick={action.onClick}
                    disabled={!action.enabled}
                  >
                    <span>{action.label}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

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
                    className="rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4 text-left transition hover:-translate-y-0.5 hover:border-amber-400/35 hover:bg-amber-500/12"
                  >
                    <p className="text-xs uppercase tracking-[0.14em] text-amber-200/80">{item.title}</p>
                    <p className="mt-2 text-sm font-semibold text-white">{item.body}</p>
                    <p className="mt-3 text-xs font-medium text-amber-200">{item.action}</p>
                  </button>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card className="mt-4 border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>{isAr ? "السوق المباشر" : "Live Marketplace"}</CardTitle>
              <CardDescription>{isApprovedSeller ? (isAr ? "اقفز مباشرة من إدارة حسابك إلى السوق عند الحاجة." : "Move naturally from workspace management into the market when you're ready to browse or buy.") : (isAr ? "استكشف السوق عندما تكون جاهزًا للشراء." : "Move from your account overview into the market when you're ready to browse.")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">USDT / ILS</p>
                <p className="mt-1 text-lg font-semibold text-white">{formatIls(marketPricePerUsdt)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">Live Listings</p>
                <p className="mt-1 text-lg font-semibold text-white">{marketplacePulse.liveListings.toLocaleString("en-IL")}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">Sellers Online</p>
                <p className="mt-1 text-lg font-semibold text-white">{marketplacePulse.onlineVerifiedSellers.toLocaleString("en-IL")}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">Avg Response</p>
                <p className="mt-1 text-lg font-semibold text-white">{marketplacePulse.averageResponseMinutes} min</p>
              </div>
            </CardContent>
          </Card>

          <div className="mt-4">
            {notificationCenterCard}
          </div>
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
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-[#D1D5DB]">{isApprovedSeller ? sellerLevelLabel(sellerOverviewStats.reputation?.level) : (isAr ? "جاهز للتصفح" : "Ready to browse")}</span>
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
          <CardTitle>{isAr ? "Approved Sellers Only" : "Approved Sellers Only"}</CardTitle>
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
              body: isAr ? "دعم مباشر عبر واتساب أثناء عملية التداول." : "Direct WhatsApp support during the trading process.",
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

      <div id="marketplace" className="mt-12">
        <div id="marketplace-sellers" className="scroll-mt-28" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold md:text-3xl">{isAr ? "السوق المباشر" : "Live Marketplace"}</h2>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            LIVE
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
              {marketSnapshot?.status === "live" ? "LIVE" : (isAr ? "آخر تحديث" : "Last update")}
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
                          <svg viewBox="0 0 100 32" className="h-full w-full" preserveAspectRatio="none" role="img" aria-label={`${pair.label} sparkline`}>
                            <path d={spark} fill="none" stroke={positive ? "#34D399" : "#F87171"} strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </div>
                        <p className="mt-2 text-[11px] text-[#9CA3AF]">{pair.reference ?? pair.source}</p>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-[#9CA3AF] sm:px-5">
            <span>
              {isAr ? "آخر تحديث" : "Last update"}: {marketSnapshot?.updatedAt ? new Date(marketSnapshot.updatedAt).toISOString().slice(11, 16) : "--:--"}
            </span>
            <span>{isAr ? "الحالة" : "Status"}: <span className={marketSnapshot?.status === "live" ? "text-emerald-300" : "text-amber-200"}>{marketSnapshot?.status === "live" ? "LIVE" : (isAr ? "متدهور" : "Degraded")}</span></span>
          </div>
        </div>

        {isApprovedSeller && showSellerWorkspace ? (
          <Card id="my-listings-section" className="mt-4 border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>{isAr ? "قائمتي" : "My Listings"}</CardTitle>
              <CardDescription>{isAr ? "إدارة جميع عروضك كبائع معتمد." : "Manage all of your approved seller listings."}</CardDescription>
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
              {myListings.map((listing) => {
                const requestsCount = sellerRequests.filter((request) => request.listingId === listing.id).length;
                const listingBusy = isListingActionBusy(listing.id);
                return (
                  <div id={`listing-${listing.id}`} key={listing.id} className="rounded-2xl border border-white/10 bg-black/20 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#C9A227]/35 hover:shadow-[0_14px_30px_rgba(2,6,23,0.45)]">
                    <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-[#93C5FD]">Listing {shortListingRef(listing)}</p>
                    <div className="grid gap-2 text-sm md:grid-cols-4">
                      <p>Status: <span className="text-white">{safeText(listing.status)}</span></p>
                      <p>Available Amount: <span className="text-white">{toNumber(listing.availableAmount).toLocaleString("en-IL")} USDT</span></p>
                      <p>Price: <span className="text-white">{formatIls(toNumber(listing.price))}</span></p>
                      <p>Network: <span className="text-white">{safeText(listing.network)}</span></p>
                      <p>Payment Methods: <span className="text-white">{normalizePaymentMethodList(listing.paymentMethods, listing.paymentMethod).map(paymentMethodLabel).join(", ") || "Not set"}</span></p>
                      <p>Banks: <span className="text-white">{parseIsraeliBankSelection(listing.bankName).join(", ") || "Not set"}</span></p>
                      <p>Purchase Requests: <span className="text-white">{requestsCount}</span></p>
                      <p>Created Date: <span className="text-white">{new Date(listing.createdAt).toLocaleDateString("en-IL")}</span></p>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
                      <DiscordShareAction
                        listing={listing}
                        sharing={discordSharing}
                        busy={discordShareActionKey === listing.id}
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
                        Edit
                      </Button>
                      {listing.status === "paused" ? (
                        <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingStatus(listing, "active")}>
                          <PlayCircle className="h-4 w-4" />
                          {listingActionKey === `${listing.id}:resume` ? "Resuming..." : "Resume"}
                        </Button>
                      ) : listing.status === "active" ? (
                        <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingStatus(listing, "paused")}>
                          <PauseCircle className="h-4 w-4" />
                          {listingActionKey === `${listing.id}:pause` ? "Pausing..." : "Pause"}
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingRenew(listing)}>
                        <Clock3 className="h-4 w-4" />
                        {listingActionKey === `${listing.id}:renew` ? "Renewing..." : "Renew"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingDelete(listing)}>
                        <Trash2 className="h-4 w-4" />
                        {listingActionKey === `${listing.id}:delete` ? "Deleting..." : "Delete"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" className="h-9" disabled={listingBusy} onClick={() => void handleSellerListingDuplicate(listing)}>
                        <Copy className="h-4 w-4" />
                        {listingActionKey === `${listing.id}:duplicate` ? "Duplicating..." : "Duplicate Listing"}
                      </Button>
                    </div>
                    {editingListingId === listing.id ? (
                      <form className="mt-3 grid gap-2 md:grid-cols-4" onSubmit={handleSellerListingEditSubmit}>
                        <Input value={listingEditForm.availableAmount} onChange={(event) => setListingEditForm((prev) => ({ ...prev, availableAmount: formatIntegerForInput(event.target.value) }))} placeholder="Available Amount" />
                        <div className="space-y-2">
                          <Input
                            value={listingEditForm.price}
                            onChange={(event) => setListingEditForm((prev) => ({ ...prev, price: normalizeDecimalInput(event.target.value) }))}
                            placeholder="Price"
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
                              ? `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)}).`
                              : listingEditPriceValid
                                ? `Valid price. Maximum allowed is ${formatIls(maxAllowedListingPrice)}.`
                                : `Enter a price up to ${formatIls(maxAllowedListingPrice)}.`}
                          </p>
                        </div>
                        <Input value={listingEditForm.currency} onChange={(event) => setListingEditForm((prev) => ({ ...prev, currency: event.target.value }))} placeholder="Currency" />
                        <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={listingEditForm.network} onChange={(event) => setListingEditForm((prev) => ({ ...prev, network: event.target.value as SupportedNetwork }))}>
                          <option value="TRC20">TRC20</option>
                          <option value="ERC20">ERC20</option>
                          <option value="BEP20">BEP20</option>
                          <option value="SOL">SOL</option>
                        </select>
                        <Input value={listingEditForm.minimumTrade} onChange={(event) => setListingEditForm((prev) => ({ ...prev, minimumTrade: formatIntegerForInput(event.target.value) }))} placeholder="Minimum Trade" />
                        <Input value={listingEditForm.maximumTrade} onChange={(event) => setListingEditForm((prev) => ({ ...prev, maximumTrade: formatIntegerForInput(event.target.value) }))} placeholder="Maximum Trade" />
                        <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">Payment Method *</p>
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
                                  className={`rounded-xl border p-2.5 text-left transition-all duration-200 ${
                                    selected
                                      ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                                      : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                                  }`}
                                >
                                  <p className="text-xs font-medium text-white">{paymentMethodEmoji(method)} {paymentMethodLabel(method)}</p>
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-2 text-xs text-[#9CA3AF]">Select up to {MAX_LISTING_PAYMENT_METHODS} methods.</p>
                        </div>
                        <Textarea className="md:col-span-2" value={listingEditForm.sellerDescription} onChange={(event) => setListingEditForm((prev) => ({ ...prev, sellerDescription: event.target.value }))} aria-label="Seller description" placeholder="Seller Description" />
                        {listingEditRequiresBank ? (
                        <div className="md:col-span-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">Supported banks *</p>
                          <p className="mt-1 text-xs text-[#D1D5DB]">Select up to {MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} banks for bank transfer or cardless ATM listings.</p>
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
                                  className={`rounded-xl border p-2 text-left transition-all duration-200 ${
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
                                      <p className="text-xs font-medium text-white">{bank.name}</p>
                                      <p className="text-[10px] text-[#9CA3AF]">{bank.code}</p>
                                    </div>
                                  </div>
                                  {selected ? <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#93C5FD]">Selected</p> : null}
                                </button>
                              );
                            })}
                          </div>
                          {listingEditSelectedBanks.length ? <p className="mt-2 text-xs text-[#93C5FD]">Selected: {listingEditSelectedBanks.join(", ")}</p> : null}
                        </div>
                        ) : null}
                        {listingEditNeedsReason ? (
                          <div className="md:col-span-4 rounded-2xl border border-amber-500/35 bg-amber-500/[0.06] p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#FDE68A]">Reason for change <span className="text-red-300">*</span></p>
                            <p className="mt-1 text-xs text-[#D1D5DB]">Editing amount, price, or availability is recorded for marketplace accountability.</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <select
                                aria-label="Reason for listing change"
                                className={cn(
                                  "flex h-11 w-full rounded-xl border bg-[#101010] px-3 py-2 text-sm text-white",
                                  listingEditForm.changeReason ? "border-emerald-500/60" : "border-red-500/70",
                                )}
                                value={listingEditForm.changeReason}
                                onChange={(event) => setListingEditForm((prev) => ({ ...prev, changeReason: event.target.value }))}
                              >
                                <option value="">Select a reason…</option>
                                {LISTING_CHANGE_REASONS.map((reason) => (
                                  <option key={reason} value={reason}>{reason}</option>
                                ))}
                              </select>
                              <Input
                                aria-label="Change explanation"
                                placeholder="Briefly explain this change"
                                value={listingEditForm.changeExplanation}
                                onChange={(event) => setListingEditForm((prev) => ({ ...prev, changeExplanation: event.target.value }))}
                                className={listingEditForm.changeExplanation.trim().length >= 5 ? "border-emerald-500/60" : "border-red-500/70"}
                              />
                            </div>
                            {!listingEditReasonValid ? (
                              <p className="mt-2 text-xs text-red-300">Choose a reason and add a short explanation (at least 5 characters).</p>
                            ) : null}
                          </div>
                        ) : null}
                        <div className={`md:col-span-4 rounded-2xl border p-3 text-xs transition-all duration-200 ${listingEditGuardTone}`}>
                          <div className="flex items-start gap-2">
                            {listingEditPriceInvalid ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                            <div className="space-y-1">
                              <p className="font-medium">
                                {listingEditPriceInvalid ? `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)})` : "Market guard active"}
                              </p>
                              <p>Current market: {formatIls(marketPricePerUsdt)} per 1 USDT</p>
                              <p>Maximum allowed: {formatIls(maxAllowedListingPrice)}</p>
                              {listingEditTradeRangeInvalid ? <p className="text-amber-200">Maximum trade must be greater than minimum trade and less than or equal to available USDT.</p> : null}
                              {listingEditRequiresBank && !listingEditSelectedBanks.length ? <p className="text-amber-200">Select one or two supported banks before saving.</p> : null}
                              {listingEditAmount > 0 ? <p>{listingEditAmount.toLocaleString("en-IL")} USDT ≈ {formatIls(listingEditAmount * marketPricePerUsdt)}</p> : null}
                            </div>
                          </div>
                        </div>
                        <div className="md:col-span-4 flex gap-2">
                          <Button type="submit" size="sm" disabled={isListingEditSubmitDisabled || !listingEditReasonValid || listingActionKey === `${listing.id}:save`}>
                            {listingActionKey === `${listing.id}:save` ? "Saving..." : "Save"}
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingListingId(null); setListingEditOriginal(null); }}>Cancel</Button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        {/* Recent completed trades — visible to all to signal activity */}
        {recentCompletedTrades.length ? (
          <Card className="mt-4 border-white/10 bg-[#0B0B0B]/90">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                {isAr ? "الصفقات المكتملة مؤخرًا" : "Recently Completed Trades"}
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {recentCompletedTrades.map((trade) => (
                  <div key={`recent-completed-${trade.id}`} className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <div>
                      <p className="font-medium text-white">{shortTradeRef(trade)}</p>
                      <p className="mt-0.5">{toNumber(trade.usdtAmount).toLocaleString("en-IL")} USDT • {toNumber(trade.fiatAmount).toLocaleString("en-IL")} {trade.currency}</p>
                      <p className="mt-0.5 text-[#9CA3AF]">{new Date(trade.completedAt ?? trade.updatedAt).toLocaleString("en-IL")}</p>
                    </div>
                  </div>
                ))}
              </div>
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
                  <option value="all">{isAr ? "Currency: الكل" : "Currency: All"}</option>
                  {uniqueCurrencies.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
                <select value={paymentMethodFilter} onChange={(event) => setPaymentMethodFilter(event.target.value)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]">
                  <option value="all">{isAr ? "Payment: الكل" : "Payment: All"}</option>
                  {uniquePaymentMethods.map((method) => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
                <select value={networkFilter} onChange={(event) => setNetworkFilter(event.target.value as "all" | SupportedNetwork)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]">
                  <option value="all">{isAr ? "Network: الكل" : "Network: All"}</option>
                  <option value="TRC20">TRC20</option>
                  <option value="ERC20">ERC20</option>
                  <option value="BEP20">BEP20</option>
                  <option value="SOL">SOL</option>
                </select>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "trust-desc" | "price-asc" | "amount-desc" | "trades-desc" | "rating-desc" | "response-fast" | "newest")} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]">
                  <option value="trust-desc">{isAr ? "ترتيب: أفضل البائعين" : "Sort: Best Sellers"}</option>
                  <option value="price-asc">{isAr ? "Sort: أقل سعر" : "Sort: Lowest Price"}</option>
                  <option value="amount-desc">{isAr ? "Sort: أعلى كمية USDT" : "Sort: Highest Available USDT"}</option>
                  <option value="trades-desc">{isAr ? "Sort: أكثر صفقات مكتملة" : "Sort: Most Completed Trades"}</option>
                  <option value="rating-desc">{isAr ? "Sort: أعلى تقييم" : "Sort: Highest Rating"}</option>
                  <option value="response-fast">{isAr ? "Sort: أسرع استجابة" : "Sort: Fastest Response Time"}</option>
                  <option value="newest">{isAr ? "Sort: الأحدث" : "Sort: Newest Listing"}</option>
                </select>
                <Input placeholder={isAr ? "أقل كمية USDT" : "Min USDT amount"} value={minAmountFilter} onChange={(event) => setMinAmountFilter(event.target.value)} />
                <Input placeholder={isAr ? "أعلى كمية USDT" : "Max USDT amount"} value={maxAmountFilter} onChange={(event) => setMaxAmountFilter(event.target.value)} />
                <Input placeholder={isAr ? "أقل سعر (₪)" : "Min price (₪)"} value={minPriceFilter} onChange={(event) => setMinPriceFilter(event.target.value)} />
                <Input placeholder={isAr ? "أعلى سعر (₪)" : "Max price (₪)"} value={maxPriceFilter} onChange={(event) => setMaxPriceFilter(event.target.value)} />
                <Input placeholder={isAr ? "أقل درجة ثقة" : "Min trust score"} value={trustScoreFilter} onChange={(event) => setTrustScoreFilter(event.target.value)} />
                <Button type="button" variant={onlineOnlyFilter ? "default" : "secondary"} onClick={() => setOnlineOnlyFilter((prev) => !prev)}>
                  {onlineOnlyFilter ? "Online Sellers Only" : "Show Online Sellers Only"}
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

      {showDeferredSections ? (
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

      {showDeferredSections && !isApprovedSeller ? (
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
            ) : isSellerApplicationLoading ? (
              <div className="space-y-3">
                <div className="h-4 w-44 animate-pulse rounded bg-white/10" />
                <div className="h-20 w-full animate-pulse rounded-2xl bg-white/10" />
                <div className="h-20 w-full animate-pulse rounded-2xl bg-white/10" />
              </div>
            ) : (
            /* ── State 1: Buyer verification not complete ── */
            sessionUser && sessionUser.isPhotoVerified !== true ? (
              <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div>
                    <p className="font-semibold text-white">{isAr ? "إكمال التحقق من المشتري أولاً" : "Complete Buyer Verification First"}</p>
                    <p className="mt-2 text-sm text-[#E5E7EB]">
                      {isAr
                        ? "يجب عليك إكمال التحقق من رقم هاتفك كمشترٍ قبل التقديم كبائع. التحقق يحمي السوق ويضمن الثقة للجميع."
                        : "You must complete phone verification as a buyer before applying as a seller. Verification protects the marketplace and ensures trust for everyone."}
                    </p>
                    <Button
                      type="button"
                      className="mt-4 w-full"
                      onClick={goToVerificationGate}
                      disabled={isRedirectingToVerification}
                    >
                      {isRedirectingToVerification ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {isRedirectingToVerification ? (isAr ? "جاري التوجيه..." : "Redirecting...") : (isAr ? "إكمال التحقق الآن" : "Complete Verification Now")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (sellerApplication?.status === "pending" || applicationSubmitted) ? (
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
                          ? `${isAr ? "تاريخ التقديم" : "Submitted"}: ${new Date(sellerApplication.createdAt).toLocaleDateString("en-IL")}`
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
                      isAr ? "سيتواصل معك المالك عبر WhatsApp على رقمك المحقق." : "The owner will contact you via WhatsApp using your verified phone number.",
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
                  {isAr ? "سنتواصل معك عبر WhatsApp على رقم هاتفك المحقق." : "We'll contact you via WhatsApp using your verified phone number."}
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
                      isAr ? "سيتواصل معك مالك Alpha Traders عبر WhatsApp على رقمك المحقق." : "The Alpha Traders owner will contact you via WhatsApp using your verified phone number.",
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
                        onChange={(event) => setSellerForm((prev) => ({ ...prev, firstName: event.target.value }))}
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
                        onChange={(event) => setSellerForm((prev) => ({ ...prev, lastName: event.target.value }))}
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
                      onChange={(event) => setSellerForm((prev) => ({ ...prev, whatsappNumber: event.target.value }))}
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
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">{group}</p>
                          <div className="grid gap-2">
                            {SELLER_APPLICATION_METHOD_OPTIONS.filter((m) => m.group === group).map((method) => {
                              const selected = sellerApplicationMethods.includes(method.id);
                              return (
                                <button
                                  key={method.id}
                                  type="button"
                                  onClick={() => setSellerApplicationMethods((prev) => prev.includes(method.id) ? prev.filter((item) => item !== method.id) : [...prev, method.id])}
                                  className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                                    selected
                                      ? "border-[#C9A227]/60 bg-[#C9A227]/10 text-white ring-1 ring-[#C9A227]/30"
                                      : "border-white/10 bg-black/25 text-[#D1D5DB] hover:border-[#C9A227]/30 hover:text-white"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{method.id}</span>
                                    <span className="flex items-center gap-1.5">
                                      {method.recommended ? <span className="rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#D4AF37]">⭐ Recommended</span> : null}
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
                    onChange={(event) => setSellerForm((prev) => ({ ...prev, expectedMonthlyTradingVolume: event.target.value }))}
                  />

                  {/* Additional notes */}
                  <Textarea
                    placeholder={isAr ? "ملاحظات إضافية (اختياري)" : "Additional notes (optional)"}
                    value={sellerForm.additionalNotes}
                    onChange={(event) => setSellerForm((prev) => ({ ...prev, additionalNotes: event.target.value }))}
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
                  <span className="font-semibold uppercase tracking-[0.12em]">Seller Status</span>
                  <RoleBadge variant="approved_seller" />
                  <span className="text-[#E5E7EB]">Approved Seller</span>
                </div>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  Welcome back, {sessionUser?.fullName?.split(" ")[0] ?? "Seller"}
                </h2>
                <p className="mt-1 text-xs text-[#9CA3AF]">
                  Approval Date: {new Date((sellerApplication?.updatedAt ?? sessionUser?.createdAt) || Date.now()).toLocaleDateString("en-IL")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C9A227]/40 bg-[#C9A227]/10 px-3 py-1 text-xs font-medium text-[#F4D87A]">
                    <Trophy className="h-3 w-3" />
                    {sellerLevelLabel(sellerOverviewStats.reputation?.level)} Seller
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#93C5FD]/30 bg-[#93C5FD]/10 px-3 py-1 text-xs text-[#93C5FD]">
                    <ShieldCheck className="h-3 w-3" />
                    Trust {(sellerOverviewStats.reputation?.trustScore ?? 0).toFixed(1)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22C55E]/25 bg-[#22C55E]/10 px-3 py-1 text-xs text-[#86EFAC]">
                    <Star className="h-3 w-3" />
                    {(sellerOverviewStats.reputation?.rating ?? 0).toFixed(2)} Rating
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3.5 text-xs text-[#D1D5DB] sm:min-w-[180px]">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">Today’s Market</p>
                <p className="mt-1 text-base font-semibold text-white">USDT/ILS {formatIls(marketPricePerUsdt)}</p>
                <div className="mt-2 space-y-0.5">
                  {sellerOverviewStats.activeListings > 0 && <p>• {sellerOverviewStats.activeListings} Active Listing{sellerOverviewStats.activeListings !== 1 ? "s" : ""}</p>}
                  {sellerOverviewStats.pendingRequests > 0 && <p>• {sellerOverviewStats.pendingRequests} Purchase Request{sellerOverviewStats.pendingRequests !== 1 ? "s" : ""}</p>}
                  {sellerOverviewStats.reputation?.completedTrades !== undefined && <p className="text-[#9CA3AF]">• {sellerOverviewStats.reputation.completedTrades} Total Trades</p>}
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
              { label: "Active Listings", value: sellerOverviewStats.activeListings.toLocaleString("en-IL"), icon: TrendingUp },
              { label: "Pending Trades", value: sellerOverviewStats.pendingRequests.toLocaleString("en-IL"), icon: MessageCircle },
              { label: "Seller Level", value: sellerLevelLabel(sellerOverviewStats.reputation?.level), icon: Trophy },
              { label: "Trust Score", value: (sellerOverviewStats.reputation?.trustScore ?? 0).toFixed(1), icon: ShieldCheck },
              { label: "Rating", value: (sellerOverviewStats.reputation?.rating ?? 0).toFixed(2), icon: Star },
              { label: "Lifetime Volume", value: `₪${sellerOverviewStats.revenueGenerated.toFixed(2)}`, icon: WalletCards },
              { label: "Average Response Time", value: sellerOverviewStats.averageResponseTime, icon: Clock3 },
              { label: "Profile Views", value: (sellerOverviewStats.reputation?.profileViews ?? 0).toLocaleString("en-IL"), icon: Users },
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

          <Card className={`order-15 border-white/10 bg-[#0B0B0B]/90 ${sellerCommissionStatus?.status === "overdue" || sellerCommissionStatus?.status === "pending" ? "border-red-600/60" : ""}`}>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <LockKeyhole className="h-4 w-4 text-[#C9A227]" />
                Commission Status
              </CardTitle>
              <CardDescription>
                Alpha Traders charges a 1% commission on completed trades. Pending commission payments block new listing creation and renewals.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {sellerCommissionStatus?.status === "overdue" || sellerCommissionStatus?.status === "pending" ? (
                <div className="rounded-2xl border border-red-600/60 bg-red-950/60 p-4 text-sm text-red-100">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                    <div className="flex-1 space-y-2">
                      <p className="font-semibold text-base">{sellerCommissionStatus.status === "overdue" ? "Commission Overdue" : "Commission Due"}</p>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-red-300">Amount outstanding</span>
                          <span className="font-bold text-white text-sm">{formatUsdt(sellerCommissionStatus.amountDue)}</span>
                        </div>
                        {sellerCommissionStatus.relatedTradeDisplayNumber ? (
                          <div className="flex justify-between">
                            <span className="text-red-300">Trade reference</span>
                            <span className="font-medium text-white">Trade #{sellerCommissionStatus.relatedTradeDisplayNumber}</span>
                          </div>
                        ) : null}
                        {sellerCommissionStatus.dueAt ? (
                          <div className="flex justify-between">
                            <span className="text-red-300">Due date</span>
                            <span className="font-medium text-white">{new Date(sellerCommissionStatus.dueAt).toLocaleDateString("en-IL")}</span>
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
                    <span className="font-medium">No commission due — you’re all clear.</span>
                  </div>
                </div>
              )}
              {sellerWorkspaceSummary?.blockedReason ? (
                <p className="rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-xs text-red-100">⚠ {sellerWorkspaceSummary.blockedReason}</p>
              ) : null}
              {sellerCommissionStatus?.status !== "clear" ? (
                <Button
                  type="button"
                  onClick={openCommissionPayment}
                  className="h-10 px-4 bg-red-600 hover:bg-red-700 text-white border-red-600"
                >
                  Pay Now
                </Button>
              ) : null}
            </CardContent>
          </Card>
          {commissionPayOpen ? (
            <Card className="order-16 border-[#C9A227]/30 bg-[#0B0B0B]/98">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LockKeyhole className="h-4 w-4 text-[#C9A227]" />
                    Commission Payment
                  </CardTitle>
                  <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-[#6B7280] hover:text-white" onClick={() => setCommissionPayOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {/* Amount badge */}
                <div className="flex items-center gap-3 rounded-xl border border-[#C9A227]/20 bg-[#C9A227]/5 px-4 py-3 mt-1">
                  <div className="flex-1">
                    <p className="text-xs text-[#9CA3AF]">Amount Due</p>
                    <p className="text-2xl font-bold text-white">{formatUsdt(sellerCommissionStatus?.amountDue ?? 0)}</p>
                  </div>
                  {sellerCommissionStatus?.relatedTradeDisplayNumber ? (
                    <div className="text-right">
                      <p className="text-xs text-[#9CA3AF]">Trade</p>
                      <p className="text-sm font-medium text-[#C9A227]">#{sellerCommissionStatus.relatedTradeDisplayNumber}</p>
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-5">

                {/* ── Step 0: Payer type selection ── */}
                {!commissionPayerType ? (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-white">How are you paying your commission?</p>
                    <div className="grid gap-3">
                      {/* Personal Wallet */}
                      <button
                        type="button"
                        onClick={() => { setCommissionPayerType("personal"); setCommissionAdvancedOpen(false); }}
                        className="group flex w-full items-start gap-4 rounded-2xl border border-white/12 bg-white/[0.03] px-4 py-4 text-left transition-all hover:border-[#C9A227]/50 hover:bg-[#C9A227]/5"
                      >
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40 group-hover:border-emerald-400/60">
                          <Wallet className="h-5 w-5 text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white text-sm">Personal Wallet</p>
                          <p className="text-xs text-[#6B7280] mt-0.5">MetaMask · Phantom · Trust Wallet · Rabby · Ledger · Trezor</p>
                          <p className="text-xs text-[#9CA3AF] mt-2 leading-relaxed">Send directly from your wallet. Alpha Traders will attempt to detect your payment automatically.</p>
                        </div>
                        <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-[#6B7280] group-hover:text-[#C9A227]" />
                      </button>
                      {/* Exchange / Broker */}
                      <button
                        type="button"
                        onClick={() => { setCommissionPayerType("exchange"); setCommissionAdvancedOpen(false); }}
                        className="group flex w-full items-start gap-4 rounded-2xl border border-white/12 bg-white/[0.03] px-4 py-4 text-left transition-all hover:border-[#C9A227]/50 hover:bg-[#C9A227]/5"
                      >
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-950/40 group-hover:border-blue-400/60">
                          <Building2 className="h-5 w-5 text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white text-sm">Crypto Exchange or Broker</p>
                          <p className="text-xs text-[#6B7280] mt-0.5">Binance · Bybit · OKX · Coinbase · Kraken · Bitget · MEXC</p>
                          <p className="text-xs text-[#9CA3AF] mt-2 leading-relaxed">After sending, paste the withdrawal transaction hash to verify your payment.</p>
                        </div>
                        <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-[#6B7280] group-hover:text-[#C9A227]" />
                      </button>
                    </div>
                    <Button type="button" variant="ghost" className="w-full text-[#6B7280] hover:text-white text-xs" onClick={() => setCommissionPayOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* ── Back + payer type badge ── */}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => { setCommissionPayerType(null); setCommissionPayMessage(null); }} className="flex items-center gap-1 text-xs text-[#6B7280] hover:text-white transition-colors">
                        <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                        Back
                      </button>
                      <span className="text-[#6B7280]">·</span>
                      <span className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
                        {commissionPayerType === "personal" ? <><Wallet className="h-3.5 w-3.5 text-emerald-400" />Personal Wallet</> : <><Building2 className="h-3.5 w-3.5 text-blue-400" />Exchange / Broker</>}
                      </span>
                    </div>

                    {/* ── Network selector ── */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Payment Network</p>
                      <div className="grid gap-2">
                        {COMMISSION_NETWORKS.map((net) => {
                          const selected = commissionNetwork === net.id;
                          return (
                            <button
                              key={net.id}
                              type="button"
                              onClick={() => setCommissionNetwork(net.id)}
                              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${selected ? "border-[#C9A227] bg-[#C9A227]/10 text-white" : "border-white/12 bg-black/20 text-[#9CA3AF] hover:border-white/25 hover:text-white"}`}
                            >
                              <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-[#C9A227]" : "border-white/30"}`}>
                                {selected ? <div className="h-2 w-2 rounded-full bg-[#C9A227]" /> : null}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium">{net.label}</span>
                                {net.recommended ? <span className="ml-2 text-xs text-[#C9A227]">⭐ Recommended</span> : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Recipient address + QR ── */}
                    {CLIENT_COMMISSION_WALLETS[commissionNetwork] ? (
                      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                        <p className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
                          Send To · {COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork}
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs font-mono text-white break-all select-all">
                            {CLIENT_COMMISSION_WALLETS[commissionNetwork]}
                          </code>
                          <Button
                            type="button" size="sm" variant="secondary"
                            className="shrink-0 h-8 w-8 p-0"
                            onClick={() => { void navigator.clipboard.writeText(CLIENT_COMMISSION_WALLETS[commissionNetwork]); setCommissionCopied(true); window.setTimeout(() => setCommissionCopied(false), 2000); }}
                          >
                            {commissionCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                        {commissionQrDataUrl ? (
                          <div className="flex justify-center pt-1">
                            <div className="rounded-xl bg-white p-3 shadow-lg">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={commissionQrDataUrl} alt={`QR code for ${commissionNetwork} USDT address`} className="h-36 w-36" />
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
                        No wallet address configured for {commissionNetwork}. Please contact Alpha Traders support.
                      </p>
                    )}

                    {/* ── Instructions panel ── */}
                    {commissionPayerType === "personal" ? (
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-4 space-y-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-emerald-300 uppercase tracking-wider">
                          <Wallet className="h-3.5 w-3.5" />
                          Sending from a Personal Wallet
                        </p>
                        <ol className="space-y-2">
                          {[
                            "Open your wallet and tap Send or Transfer.",
                            `Select the ${COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork} network.`,
                            "Select USDT as the token.",
                            "Paste the Alpha Traders commission address above.",
                            `Enter the exact amount: ${formatUsdt(sellerCommissionStatus?.amountDue ?? 0)}.`,
                            "Confirm and send. Wait for the transaction to be confirmed.",
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
                          ⚠️ Make sure the transaction is a USDT send — not a swap, deposit, or any other contract interaction.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-blue-500/20 bg-blue-950/20 p-4 space-y-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-blue-300 uppercase tracking-wider">
                          <Building2 className="h-3.5 w-3.5" />
                          Sending from an Exchange or Broker
                        </p>
                        <ol className="space-y-2">
                          {[
                            `Go to your exchange's Withdraw or Send page and select USDT on ${COMMISSION_NETWORKS.find((n) => n.id === commissionNetwork)?.sublabel ?? commissionNetwork}.`,
                            "Paste the Alpha Traders commission address as the recipient.",
                            `Enter the exact amount: ${formatUsdt(sellerCommissionStatus?.amountDue ?? 0)}.`,
                            "Confirm the withdrawal and wait for blockchain confirmation.",
                            "Copy the withdrawal transaction hash from your exchange history.",
                            "Paste it below and click Verify.",
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
                          <span className="font-medium">Manual Verification — paste transaction hash</span>
                          {commissionAdvancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        {commissionAdvancedOpen ? (
                          <div className="mt-2 space-y-1 rounded-xl border border-white/8 bg-black/20 px-4 py-3">
                            <Input
                              placeholder="0x… or Solana signature"
                              value={commissionTxSignature}
                              onChange={(event) => setCommissionTxSignature(event.target.value)}
                             onPaste={(event) => {
                               event.preventDefault();
                               setCommissionTxSignature(normalizeTransactionHash(event.clipboardData.getData("text")));
                             }}
                             className="font-mono text-xs"
                           />
                           <p className="text-xs text-[#6B7280]">
                             Find this in your wallet’s Activity or Transaction History. It must be the USDT send transaction — not a swap, trade, or other interaction.
                           </p>
                         </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Transaction Hash</p>
                        <Input
                         placeholder="0x… or Solana signature"
                         value={commissionTxSignature}
                         onChange={(event) => setCommissionTxSignature(event.target.value)}
                         onPaste={(event) => {
                           event.preventDefault();
                           setCommissionTxSignature(normalizeTransactionHash(event.clipboardData.getData("text")));
                         }}
                         className="font-mono text-xs"
                        />
                        <p className="text-xs text-[#6B7280]">Copy this from your exchange withdrawal history after the transaction is confirmed.</p>
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
                              <span>{msg.replace("✅ ", "")}</span>
                            </div>
                          );
                        }
                        const wrongNetwork = msg.match(/found on (\w+), not (\w+)/i);
                        if (wrongNetwork) {
                          return (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs space-y-1 text-amber-100">
                              <p className="flex items-center gap-1.5 font-semibold text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                Transaction found on {wrongNetwork[1]}
                              </p>
                              <p>Please select <strong>{wrongNetwork[1]}</strong> as your payment network and submit the transaction again.</p>
                            </div>
                          );
                        }
                        if (msg.includes("but not the supported USDT contract") || msg.includes("send USDT (not USDC")) {
                          return (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs space-y-1 text-amber-100">
                              <p className="flex items-center gap-1.5 font-semibold text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                Wrong token detected
                              </p>
                              <p>This transaction transferred a different token. Commission must be paid in USDT.</p>
                            </div>
                          );
                        }
                        if (msg.includes("does not include any transfer to or from the Alpha Traders commission wallet") || msg.includes("Please verify you submitted the correct transaction hash")) {
                          return (
                            <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs space-y-1 text-red-100">
                              <p className="flex items-center gap-1.5 font-semibold text-red-300">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                Transaction is not your commission payment
                              </p>
                              <p>We found this transaction, but it does not include a transfer to the Alpha Traders commission wallet. Please submit the exact transaction hash from when you sent the USDT payment above.</p>
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                            <span>{msg}</span>
                          </div>
                        );
                      })()
                    ) : null}

                    {/* ── Actions ── */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        disabled={commissionPayBusy || !commissionTxSignature.trim() || !CLIENT_COMMISSION_WALLETS[commissionNetwork]}
                        onClick={() => void handleCommissionPayNow()}
                        className="bg-[#C9A227] hover:bg-[#B8911F] text-black font-semibold border-[#C9A227]"
                      >
                        {commissionPayBusy ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Verifying…</> : "Verify Payment"}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setCommissionPayOpen(false)}>
                        Cancel
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
                  <p className="font-semibold">Listing creation is currently blocked</p>
                  <p className="mt-1 text-xs text-[#FDE68A]">{listingCreationBlockedReason}</p>
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
                        Manage Listings
                      </Button>
                    ) : null}
                    {listingBlockedByCommission ? (
                      <Button type="button" size="sm" variant="secondary" onClick={openCommissionPayment}>
                        Pay Now
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className={`mb-4 rounded-2xl border p-4 text-sm text-[#E5E7EB] transition-all duration-200 ${listingCreateGuardCardTone}`}>
                <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">Live Market Price Guard</p>
                <p className={`mt-1 text-xs ${marketSnapshot?.status === "live" ? "text-emerald-300" : "text-amber-200"}`}>
                  {marketSnapshot?.status === "live" ? "LIVE" : "Market temporarily unavailable — using last known price."}
                </p>
                <div className="mt-2 space-y-1">
                  <p>1 USDT = <span className="font-semibold text-white">{formatIls(marketPricePerUsdt)}</span></p>
                  <p>Maximum listing price: <span className="font-semibold text-white">{formatIls(maxAllowedListingPrice)}</span></p>
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
                      ? `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)}).`
                      : listingCreatePriceValid
                        ? `Valid price. Maximum allowed is ${formatIls(maxAllowedListingPrice)}.`
                        : `Enter a price up to ${formatIls(maxAllowedListingPrice)}.`}
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
                    {listingCreateCurrencyManualOverride ? "Manual Override" : "Auto Calculated"}
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
                          className={`rounded-xl border p-3 text-left transition-all duration-200 ${
                            selected
                              ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                              : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                          }`}
                        >
                          <p className="text-sm font-medium text-white">{paymentMethodEmoji(method)} {paymentMethodLabel(method)}</p>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-[#9CA3AF]">Select up to {MAX_LISTING_PAYMENT_METHODS} methods. Buyers choose one method when they open the trade.</p>
                  <p className="mt-2 text-xs text-[#D1D5DB]">Review payment safety guidance in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</p>
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
                  <FieldLabel htmlFor="create-description" optional>{isAr ? "وصف البائع" : "Seller Description"}</FieldLabel>
                  <Textarea id="create-description" className="min-h-[96px]" placeholder={isAr ? "أخبر المشترين عن شروطك" : "Tell buyers about your terms"} value={listingCreateForm.sellerDescription} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, sellerDescription: event.target.value }))} />
                </div>
                {listingCreateRequiresBank ? (
                <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <FieldLabel required>{isAr ? "البنوك المدعومة" : "Supported banks"}</FieldLabel>
                  <p className="mt-1 text-xs text-[#D1D5DB]">Select up to {MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} banks for bank transfer or cardless ATM listings.</p>
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
                          className={`rounded-xl border p-3 text-left transition-all duration-200 ${
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
                              <p className="text-sm font-medium text-white">{bank.name}</p>
                              <p className="text-[11px] text-[#9CA3AF]">{bank.code}</p>
                            </div>
                          </div>
                          {selected ? <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#93C5FD]">Selected</p> : null}
                        </button>
                      );
                    })}
                  </div>
                  {listingCreateSelectedBanks.length ? <p className="mt-2 text-xs text-[#93C5FD]">Selected: {listingCreateSelectedBanks.join(", ")}</p> : null}
                </div>
                ) : null}
                <div className="md:col-span-2 rounded-2xl border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 p-4 text-sm text-[#E5E7EB]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#93C5FD]">Live total value</p>
                  <p className="mt-1">{listingCreateAmount.toLocaleString("en-IL")} USDT</p>
                  <p className="mt-1">× {formatIls(listingCreatePrice || 0)} = <span className="font-semibold text-white">{formatIls(listingCreateTotalIls)}</span></p>
                </div>
                <div className="md:col-span-2 rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/10 p-4 text-sm text-[#F3F4F6]">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#F4D87A]">Platform Commission</p>
                  <p className="mt-1">Alpha Traders charges a 1% commission on completed trades. By publishing this listing, you agree to pay the platform commission after a successful trade.</p>
                  <label className="mt-3 inline-flex cursor-pointer items-start gap-2 text-xs text-[#E5E7EB]">
                    <input
                      type="checkbox"
                      checked={listingCommissionAgreement}
                      onChange={(event) => setListingCommissionAgreement(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]"
                    />
                    <span>I understand and agree to Alpha Traders’ 1% commission policy.</span>
                  </label>
                  <p className="mt-2 text-xs text-[#D1D5DB]">Read full policy in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</p>
                </div>
                <div className={`md:col-span-2 rounded-2xl border p-4 transition-all duration-200 ${listingCreateGuardTone}`}>
                  <div className="flex items-start gap-2">
                    {listingCreatePriceInvalid ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">
                        {listingCreatePriceInvalid ? `Price exceeds maximum allowed (${formatIls(maxAllowedListingPrice)})` : "Market guard active"}
                      </p>
                      <p>Current market: {formatIls(marketPricePerUsdt)} per 1 USDT</p>
                      <p>Maximum allowed: {formatIls(maxAllowedListingPrice)}</p>
                      {listingCreateTradeRangeInvalid ? <p className="text-amber-200">Maximum trade must be greater than minimum trade and less than or equal to available USDT.</p> : null}
                      {listingCreateRequiresBank && !listingCreateSelectedBanks.length ? <p className="text-amber-200">Select one or two supported banks before submitting.</p> : null}
                      {!listingCommissionAgreement ? <p className="text-amber-200">You must accept the 1% commission policy before publishing.</p> : null}
                      {listingCreateAmount > 0 ? <p>{listingCreateAmount.toLocaleString("en-IL")} USDT ≈ {formatIls(listingCreateAmount * marketPricePerUsdt)}</p> : null}
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" className="h-11 w-full sm:w-auto" disabled={isListingCreateSubmitDisabled || listingActionKey === "create:new"}>
                    {listingActionKey === "create:new" ? "Publishing..." : "Submit Listing"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {sellerWorkspaceMessage ? (
            <div className="order-25 flex items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.08)] animate-in fade-in-0 slide-in-from-top-1 duration-300">
              <span>{sellerWorkspaceMessage}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setSellerWorkspaceMessage(null)}
                className="shrink-0 rounded-full p-0.5 text-emerald-300 transition hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <Card className="order-5 border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>{isAr ? "طلبات الشراء" : "Purchase Requests"}</CardTitle>
              <CardDescription>{isAr ? "إدارة طلبات المشترين الواردة لك." : "Manage incoming buyer purchase requests."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Input placeholder="Search by trade ID, buyer, listing..." value={sellerTradeQuery} onChange={(event) => setSellerTradeQuery(event.target.value)} />
                <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={sellerTradeStatus} onChange={(event) => setSellerTradeStatus(event.target.value as typeof sellerTradeStatus)}>
                  <option value="all">Status: All</option>
                  <option value="pending">Pending</option>
                  <option value="accepted">Accepted</option>
                  <option value="payment_sent">Payment Sent</option>
                  <option value="funds_received">Funds Received</option>
                  <option value="usdt_release_pending">USDT Release Pending</option>
                  <option value="usdt_sent">USDT Sent</option>
                  <option value="review_open">Review Open</option>
                  <option value="declined">Declined</option>
                  <option value="cancelled">Cancelled</option>
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
                      Requires Your Action · {sellerRequestSections.action.length}
                    </div>
                  ) : null}
                  {sellerRequestSections.active.length ? (
                    <div className="rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-xs font-medium text-white">
                      Active Trades · {sellerRequestSections.active.length}
                    </div>
                  ) : null}
                  {sellerRequestSections.waiting.length ? (
                    <div className="rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 px-3 py-2 text-xs font-medium text-[#BFDBFE]">
                      Waiting · {sellerRequestSections.waiting.length}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {sellerRequestSections.action.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-[#9CA3AF]">
                  No trades require your action. You’re all caught up.
                </div>
              ) : null}
              {sellerRequestSections.active.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-[#9CA3AF]">
                  No active trades right now.
                </div>
              ) : null}
              {sellerRequestSections.waiting.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-[#9CA3AF]">
                  No waiting trades right now.
                </div>
              ) : null}
              {[...sellerRequestSections.action, ...sellerRequestSections.active, ...sellerRequestSections.waiting].map((request) => {
                const presentation = getTradeQueuePresentation(request, "seller");
                return (
                  <div id={`trade-${request.id}`} key={request.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#93C5FD]">{shortTradeRef(request)}</p>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] ${presentation.badgeTone}`}>{presentation.badge}</span>
                    </div>
                    <div className="grid gap-2 text-sm md:grid-cols-3">
                      <p>Trade Ref: <span className="text-white">{shortTradeRef(request)}</span></p>
                      <p>Buyer Name: <span className="text-white">{request.buyerName}</span></p>
                      <p>WhatsApp: <span className="text-white">{shouldRevealFaceToFaceContact(request) ? request.buyerWhatsapp : "Hidden until safety acknowledgment is completed."}</span></p>
                      <p>USDT Amount: <span className="text-white">{toNumber(request.usdtAmount).toLocaleString("en-IL")}</span></p>
                      <p>Fiat Amount: <span className="text-white">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</span></p>
                      <p>Network: <span className="text-white">{request.network}</span></p>
                      <p>Payment Method: <span className="text-white">{paymentMethodEmoji(request.paymentMethod)} {paymentMethodLabel(request.paymentMethod)}</span></p>
                      <p>Listing: <span className="text-white">{shortListingRef({ id: request.listingId, displayNumber: myListingsById.get(request.listingId)?.displayNumber })}</span></p>
                      <p>Submitted: <span className="text-white">{new Date(request.createdAt).toLocaleString("en-IL")}</span></p>
                      <p>Status: <span className="text-white">{tradeStatusLabel(request.status)}</span></p>
                      {request.completedAt ? <p>Completed: <span className="text-white">{new Date(request.completedAt).toLocaleString("en-IL")}</span></p> : null}
                      {request.reviewUnlockedAt ? <p>Review Unlocked: <span className="text-white">{new Date(request.reviewUnlockedAt).toLocaleString("en-IL")}</span></p> : null}
                    </div>
                    <div className="mt-3 rounded-xl border border-[#6CAEFF]/25 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                      <p className="font-medium text-white">{paymentMethodEmoji(request.paymentMethod)} Trade Instructions</p>
                      <p className="mt-1">{paymentMethodTradeInstruction(request.paymentMethod, "seller")}</p>
                    </div>
                    {normalizeMarketplacePaymentMethod(request.paymentMethod) === "Face-to-Face (Meet in Person)" && request.status === "pending" ? (
                      <div className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                        <p className="font-semibold text-[#FDE68A]">Safety Guidelines</p>
                        <p className="mt-1 text-[#E5E7EB]">Meet only in public places, prefer camera-covered locations, avoid sharing unnecessary personal details, and confirm USDT transfer before leaving.</p>
                        <label className="mt-2 inline-flex cursor-pointer items-start gap-2 text-[#E5E7EB]">
                          <input
                            type="checkbox"
                            checked={sellerSafetyAcknowledgements[request.id] ?? false}
                            onChange={(event) => setSellerSafetyAcknowledgements((prev) => ({ ...prev, [request.id]: event.target.checked }))}
                            className="mt-0.5 h-4 w-4 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]"
                          />
                          <span>I have read and agree to these safety guidelines.</span>
                        </label>
                        <p className="mt-1 text-[#D1D5DB]">Read full guidance in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</p>
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
                        Open Trade Room
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
                        {requestActionKey === `${request.id}:accepted` ? "Processing..." : "Accept"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={request.status !== "pending" || requestActionKey === `${request.id}:declined`} onClick={() => handleSellerRequestAction(request.id, "declined")}>
                        {requestActionKey === `${request.id}:declined` ? "Processing..." : "Decline"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={request.status !== "payment_sent" || requestActionKey === `${request.id}:funds_received`}
                        onClick={() => handleSellerRequestAction(request.id, "funds_received")}
                      >
                        {requestActionKey === `${request.id}:funds_received`
                          ? "Processing..."
                          : normalizeMarketplacePaymentMethod(request.paymentMethod) === "Cardless ATM Withdrawal" ? "Confirm Cash Collected" : "Confirm Funds Received"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={request.status !== "funds_received" || requestActionKey === `${request.id}:usdt_release_pending`}
                        onClick={() => handleSellerRequestAction(request.id, "usdt_release_pending")}
                      >
                        {requestActionKey === `${request.id}:usdt_release_pending` ? "Processing..." : "Start USDT Release"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={request.status !== "usdt_release_pending" || !request.sellerEvidence || requestActionKey === `${request.id}:usdt_sent`} onClick={() => handleSellerRequestAction(request.id, "usdt_sent")}>
                        {requestActionKey === `${request.id}:usdt_sent` ? "Processing..." : "Mark USDT Sent"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => handleMessageBuyer(request)}>
                        <MessageCircle className="h-4 w-4" />
                        Message Buyer
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB] md:grid-cols-2">
                      <div>
                        <p className="font-medium text-white">Buyer Evidence</p>
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
                          <p className="mt-1 text-[#9CA3AF]">Not uploaded yet.</p>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-white">Seller Evidence</p>
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
                          <p className="mt-1 text-[#9CA3AF]">Upload required before marking USDT sent.</p>
                        )}
                      </div>
                      {!request.sellerEvidence ? (
                        <div className="md:col-span-2">
                          <label className="text-[11px] uppercase tracking-[0.1em] text-[#9CA3AF]">Upload Seller Evidence</label>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Input
                              type="file"
                              accept=".png,.jpg,.jpeg,.webp,.pdf"
                              className="h-10 max-w-xs"
                              onChange={(event) => {
                                const file = event.target.files?.[0] ?? null;
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
                              {evidenceUploading[`${request.id}:seller`] ? "Uploading..." : "Upload Evidence"}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 space-y-2">
                      {(request.timeline ?? []).map((event) => (
                        <div key={event.id} className="flex items-start gap-2 text-xs">
                          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#C9A227]" />
                          <span className="text-[#D1D5DB]">
                            {new Date(event.createdAt).toLocaleTimeString("en-IL", { hour: "2-digit", minute: "2-digit" })} {event.message}
                          </span>
                        </div>
                      ))}
                    </div>
                    {request.buyerReview ? (
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                        <p className="font-medium text-white">Buyer Review</p>
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
                        <Textarea aria-label="Respond to buyer review" placeholder="Respond to buyer review" value={sellerResponseDrafts[request.id] ?? ""} onChange={(event) => setSellerResponseDrafts((prev) => ({ ...prev, [request.id]: event.target.value }))} />
                        <div>
                          <Button type="submit" size="sm" variant="secondary">Submit Seller Response</Button>
                        </div>
                      </form>
                    ) : null}
                    {request.sellerResponse ? (
                      <div className="mt-3 rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                        <p className="font-medium text-white">Seller Response</p>
                        <p className="mt-1">{request.sellerResponse.message}</p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {(sellerRequestSections.completed.length || sellerRequestSections.cancelled.length) ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                    onClick={() => setSellerClosedRequestsCollapsed((value) => !value)}
                  >
                    <span className="text-sm font-medium text-white">
                      Completed / Closed ({sellerRequestSections.completed.length + sellerRequestSections.cancelled.length})
                    </span>
                    <span className="text-xs text-[#9CA3AF]">{sellerClosedRequestsCollapsed ? "Show" : "Hide"}</span>
                  </button>
                  {!sellerClosedRequestsCollapsed ? (
                    <div className="mt-3 space-y-3">
                      {[...sellerRequestSections.completed, ...sellerRequestSections.cancelled].map((request) => {
                        const presentation = getTradeQueuePresentation(request, "seller");
                        return (
                          <div key={request.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#93C5FD]">{shortTradeRef(request)}</p>
                              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] ${presentation.badgeTone}`}>{presentation.badge}</span>
                            </div>
                            <div className="grid gap-2 text-sm md:grid-cols-3">
                              <p>Trade Ref: <span className="text-white">{shortTradeRef(request)}</span></p>
                              <p>Buyer Name: <span className="text-white">{request.buyerName}</span></p>
                              <p>Status: <span className="text-white">{tradeStatusLabel(request.status)}</span></p>
                              <p>USDT Amount: <span className="text-white">{toNumber(request.usdtAmount).toLocaleString("en-IL")}</span></p>
                              <p>Fiat Amount: <span className="text-white">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</span></p>
                              <p>Updated: <span className="text-white">{new Date(request.updatedAt).toLocaleString("en-IL")}</span></p>
                            </div>
                            <div className="mt-3">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onMouseEnter={() => handlePrefetchTradeRoom(request.id)}
                                onFocus={() => handlePrefetchTradeRoom(request.id)}
                                onClick={() => handleOpenTradeRoom(request.id)}
                              >
                                Open Trade Room
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

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
                      <img src={sessionUser.profilePhotoUrl} alt={`${sessionUser.fullName} profile`} className="h-13 w-13 rounded-full border border-white/15 object-cover" />
                    ) : (
                      <div className="inline-flex h-13 w-13 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-sm font-semibold text-[#D1D5DB]">
                        {safeText(sessionUser?.fullName, "Seller")
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)}
                      </div>
                    )}
                    <div>
                      <p className="text-base font-semibold text-white">{safeText(sessionUser?.fullName, "Seller")}</p>
                      <RoleBadge variant="approved_seller" />
                    </div>
                  </div>
                  <p>Member Since: <span className="text-white">{sessionUser?.createdAt ? new Date(sessionUser.createdAt).toLocaleDateString("en-IL") : "—"}</span></p>
                  <p>Languages: <span className="text-white">{sessionUser?.languages?.join(", ") || "English"}</span></p>
                  <p>Preferred Networks: <span className="text-white">{sessionUser?.preferredNetworks?.join(", ") || "TRC20"}</span></p>
                  <p>Rating: <span className="text-white">{(sellerOverviewStats.reputation?.rating ?? 4.5).toFixed(2)}</span></p>
                  <p>Success Rate: <span className="text-white">{sellerOverviewStats.successRate.toFixed(1)}%</span></p>
                  <p>Completed Trades: <span className="text-white">{sellerOverviewStats.completedTrades}</span></p>
                  <p>Total USDT Volume: <span className="text-white">{sellerOverviewStats.totalUsdtSold.toLocaleString("en-IL")}</span></p>
                  <p>Current Listings: <span className="text-white">{sellerOverviewStats.activeListings}</span></p>
                  <p>Average Response Time: <span className="text-white">{sellerOverviewStats.averageResponseTime}</span></p>
                  <p>Status: <span className="text-white">{sessionUser?.onlineStatus === "online" ? "Online" : "Offline"}</span></p>
                  <p>Last Active: <span className="text-white">{formatRelativeMinutesLabel(sessionUser?.lastActiveAt)}</span></p>
                  <p>Bio: <span className="text-white">{safeText(sessionUser?.bio, "Professional USDT seller on Alpha Exchange.")}</span></p>
                  <p>Trading Experience: <span className="text-white">{safeText(sessionUser?.tradingExperience, "Professional trading experience")}</span></p>
                  <p>Working Hours: <span className="text-white">{safeText(sessionUser?.workingHours, "Sun-Thu, 09:00-21:00")}</span></p>
                  <p>Account Status: <span className="text-white">{sessionUser?.sellerStatus ?? "buyer"}</span></p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(sellerOverviewStats.reputation?.badges ?? []).map((badge) => (
                      <span key={badge} className="rounded-full border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 px-2 py-1 text-[11px] text-[#93C5FD]">
                        {sellerBadgeLabel(badge)}
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
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">Lifetime Trade Volume</p>
                      <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.totalUsdtSold.toLocaleString("en-IL")} USDT</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">Average Rating</p>
                      <p className="mt-1 text-lg font-semibold text-white">{(sellerOverviewStats.reputation?.rating ?? 4.5).toFixed(2)}★</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">Completed Trades</p>
                      <p className="mt-1 text-lg font-semibold text-white">{sellerOverviewStats.completedTrades.toLocaleString("en-IL")}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">Seller Level</p>
                      <p className="mt-1 text-lg font-semibold text-white">{sellerLevelLabel(sellerOverviewStats.reputation?.level)}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-[#D1D5DB]">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Quick Actions</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => router.push("/dashboard/seller")}>Open Seller Dashboard</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => router.push("/profile")}>Update Public Profile</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => router.push("/settings")}>Account & Security</Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => { void scrollToCreateListingSection(); }}
                      >
                        Create New Listing
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-white/10 bg-[#0B0B0B]/90 xl:col-span-2">
                <CardHeader>
                  <CardTitle>Activity Timeline</CardTitle>
                  <CardDescription>Newest first, grouped by date, with compact activity cards.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!activityHistory.length ? (
                    <p className="text-xs text-[#9CA3AF]">Your timeline updates automatically as you trade, review, and manage listings.</p>
                  ) : (
                    groupedActivityHistory.map((group) => (
                      <div key={group.dayKey} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{group.label}</p>
                        <div className="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                          {group.items.slice(0, 3).map((entry) => (
                            <div key={entry.id} className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                              <div className="flex items-start justify-between gap-3">
                                <p className="font-medium text-white">{entry.title}</p>
                                <p className="shrink-0 text-[#9CA3AF]">{new Date(entry.createdAt).toLocaleTimeString("en-IL", { hour: "2-digit", minute: "2-digit" })}</p>
                              </div>
                              <p className="mt-1 line-clamp-2 text-[#9CA3AF]">{entry.details}</p>
                            </div>
                          ))}
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
                    <p className="font-semibold text-[#FDE68A]">{isAr ? "???? ????? ????? ??????? ?????" : "Complete your previous trade first"}</p>
                    <p className="mt-0.5 text-sm text-[#E5E7EB]">
                      {isAr
                        ? "??? ??? ???? ?????? ???? ????? ?????? ?? ????? ???????."
                        : "Before starting another trade, please rate your previous seller."}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <Link href={`/trade-room/${pendingBuyerReviewTrade.id}`}>
                    <Button size="sm" className="w-full sm:w-auto">
                      {isAr ? "???? ???????" : "Leave Feedback"}
                    </Button>
                  </Link>
                  <Link href={`/trade-room/${pendingBuyerReviewTrade.id}`}>
                    <Button size="sm" variant="secondary" className="w-full sm:w-auto">
                      {isAr ? "??? ?????? ???????" : "View Previous Trade"}
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
              {sessionUser ? <RoleBadge variant={roleBadgeVariantFromSession(sessionUser)} /> : <RoleBadge variant="guest" />}
              <div className="flex flex-wrap gap-2">
                {!sessionUser ? (
                  <>
                    <Link href="/login">
                      <Button variant="secondary">Login</Button>
                    </Link>
                    <Link href="/register">
                      <Button variant="secondary">Register</Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href="/profile">
                      <Button variant="secondary">Profile</Button>
                    </Link>
                    <LogoutButton
                      locale={locale}
                      variant="secondary"
                      idleLabel="Logout"
                      pendingLabel="Signing out..."
                      onSignedOut={() => setSessionUser(null)}
                    />
                  </>
                )}
              </div>
              {sessionUser ? (
                <form className="grid gap-2 border-t border-white/10 pt-3" onSubmit={handleNotificationPreferencesSave}>
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Notification Preferences</p>
                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-[#D1D5DB]">
                    <span>In-app</span>
                    <input type="checkbox" checked={notificationPreferences.inApp} onChange={(event) => setNotificationPreferences((prev) => ({ ...prev, inApp: event.target.checked }))} />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-[#D1D5DB]">
                    <span>Email (future-ready)</span>
                    <input type="checkbox" checked={notificationPreferences.email} onChange={(event) => setNotificationPreferences((prev) => ({ ...prev, email: event.target.checked }))} />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-[#D1D5DB]">
                    <span>SMS (future-ready)</span>
                    <input type="checkbox" checked={notificationPreferences.sms} onChange={(event) => setNotificationPreferences((prev) => ({ ...prev, sms: event.target.checked }))} />
                  </label>
                  <Button type="submit" size="sm" variant="secondary">Save Preferences</Button>
                </form>
              ) : null}
            </CardContent>
          </Card>

          {sessionUser ? (
            <Card id={BUYER_TRADE_HISTORY_SECTION_ID} className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
              <CardHeader>
                <CardTitle>My Trade History</CardTitle>
                <CardDescription>Newest first, compact rows, and expandable details for each trade.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Input placeholder="Search by trade ID or listing..." value={buyerTradeQuery} onChange={(event) => setBuyerTradeQuery(event.target.value)} />
                  <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={buyerTradeStatus} onChange={(event) => setBuyerTradeStatus(event.target.value as typeof buyerTradeStatus)}>
                    <option value="all">Status: All</option>
                    <option value="pending">Pending</option>
                    <option value="accepted">Accepted</option>
                    <option value="payment_sent">Payment Sent</option>
                    <option value="funds_received">Funds Received</option>
                    <option value="usdt_release_pending">USDT Release Pending</option>
                    <option value="usdt_sent">USDT Sent</option>
                    <option value="review_open">Review Open</option>
                    <option value="declined">Declined</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                {!filteredBuyerRequests.length ? (
                  buyerRequests.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center">
                      <HandCoins className="mx-auto h-5 w-5 text-[#C9A227]" />
                      <p className="mt-2 text-sm font-medium text-white">No trades yet</p>
                      <p className="mt-1 text-xs text-[#9CA3AF]">Browse verified sellers and start your first trade.</p>
                      <a href="#marketplace" className="mt-3 inline-flex items-center gap-1 text-xs text-[#93C5FD] hover:underline">
                        Browse Marketplace →
                      </a>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-[#9CA3AF]">No trades found for current filters.</div>
                  )
                ) : null}
                {sortedBuyerRequests.length ? (
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <div className="hidden grid-cols-[1.1fr_0.9fr_0.9fr_0.9fr_0.9fr_auto] gap-3 border-b border-white/10 px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF] md:grid">
                      <span>Trade</span>
                      <span>Status</span>
                      <span>Amount</span>
                      <span>Method</span>
                      <span>Updated</span>
                      <span className="text-right">Details</span>
                    </div>
                    {sortedBuyerRequests.slice(0, buyerTradeVisibleCount).map((request) => {
                      const presentation = getTradeQueuePresentation(request, "buyer");
                      const isExpanded = buyerExpandedTradeId === request.id;
                      return (
                        <div key={request.id} className="border-t border-white/10 first:border-t-0">
                          <button
                            type="button"
                            className="grid w-full gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03] md:grid-cols-[1.1fr_0.9fr_0.9fr_0.9fr_0.9fr_auto] md:items-center"
                            onClick={() => setBuyerExpandedTradeId((prev) => prev === request.id ? null : request.id)}
                          >
                            <div>
                              <p className="text-sm font-medium text-white">{shortTradeRef(request)}</p>
                              <p className="mt-1 text-xs text-[#9CA3AF]">Listing {shortListingRef({ id: request.listingId, displayNumber: listingsById.get(request.listingId)?.displayNumber })}</p>
                            </div>
                            <div className="text-xs">
                              <span className={`rounded-full border px-2.5 py-1 font-semibold tracking-[0.08em] ${presentation.badgeTone}`}>{presentation.badge}</span>
                            </div>
                            <div className="text-sm text-[#D1D5DB]">
                              <p>{toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT</p>
                              <p className="mt-1 text-xs text-[#9CA3AF]">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</p>
                            </div>
                            <p className="text-sm text-[#D1D5DB]">{paymentMethodEmoji(request.paymentMethod)} {paymentMethodLabel(request.paymentMethod)}</p>
                            <p className="text-sm text-[#D1D5DB]">{new Date(request.completedAt ?? request.updatedAt).toLocaleDateString("en-IL")}</p>
                            <p className="text-sm text-[#C9A227] md:text-right">{isExpanded ? "Hide" : "Expand"}</p>
                          </button>
                          {isExpanded ? (
                            <div className="space-y-3 border-t border-white/10 bg-black/25 px-4 py-4">
                              <div className="grid gap-2 text-sm md:grid-cols-3">
                                <p>Network: <span className="text-white">{request.network}</span></p>
                                <p>Submitted: <span className="text-white">{new Date(request.createdAt).toLocaleString("en-IL")}</span></p>
                                {request.completedAt ? <p>Completed: <span className="text-white">{new Date(request.completedAt).toLocaleString("en-IL")}</span></p> : null}
                              </div>
                              <div className="rounded-xl border border-[#6CAEFF]/25 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                                <p className="font-medium text-white">{paymentMethodEmoji(request.paymentMethod)} Trade Instructions</p>
                                <p className="mt-1">{paymentMethodTradeInstruction(request.paymentMethod, "buyer")}</p>
                                <p className="mt-1">Review details in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button type="button" size="sm" variant="secondary" onMouseEnter={() => handlePrefetchTradeRoom(request.id)} onFocus={() => handlePrefetchTradeRoom(request.id)} onClick={() => handleOpenTradeRoom(request.id)}>
                                  Open Trade Room
                                </Button>
                                <Button type="button" size="sm" disabled={request.status !== "accepted" || !request.buyerEvidence} onClick={() => handleBuyerTradeStatus(request, "payment_sent")}>
                                  {normalizeMarketplacePaymentMethod(request.paymentMethod) === "Cardless ATM Withdrawal" ? "Mark Withdrawal Ready" : "Mark Payment Sent"}
                                </Button>
                                <Button type="button" size="sm" variant="secondary" disabled={request.status !== "usdt_sent"} onClick={() => handleBuyerTradeStatus(request, "completed")}>
                                  Confirm Trade Completed
                                </Button>
                                <Button type="button" size="sm" variant="secondary" disabled={request.status !== "pending" && request.status !== "accepted"} onClick={() => handleBuyerTradeStatus(request, "cancelled")}>
                                  Cancel
                                </Button>
                              </div>
                              <div className="grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB] md:grid-cols-2">
                                <div>
                                  <p className="font-medium text-white">Buyer Evidence</p>
                                  {request.buyerEvidence ? (
                                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.buyerEvidence.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[#C9A227] underline-offset-2 hover:underline">
                                      {request.buyerEvidence.fileName}
                                    </a>
                                  ) : (
                                    <p className="mt-1 text-[#9CA3AF]">Upload required before marking payment sent.</p>
                                  )}
                                </div>
                                <div>
                                  <p className="font-medium text-white">Seller Evidence</p>
                                  {request.sellerEvidence ? (
                                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.sellerEvidence.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[#C9A227] underline-offset-2 hover:underline">
                                      {request.sellerEvidence.fileName}
                                    </a>
                                  ) : (
                                    <p className="mt-1 text-[#9CA3AF]">Waiting for seller evidence.</p>
                                  )}
                                </div>
                                {!request.buyerEvidence ? (
                                  <div className="md:col-span-2">
                                    <label className="text-[11px] uppercase tracking-[0.1em] text-[#9CA3AF]">Upload Payment Evidence</label>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <Input
                                        type="file"
                                        accept=".png,.jpg,.jpeg,.webp,.pdf"
                                        className="h-10 max-w-xs"
                                        onChange={(event) => {
                                          const file = event.target.files?.[0] ?? null;
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
                                        {evidenceUploading[`${request.id}:buyer`] ? "Uploading..." : "Upload Evidence"}
                                      </Button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                              <div className="space-y-2">
                                {(request.timeline ?? []).map((event) => (
                                  <div key={event.id} className="flex items-start gap-2 text-xs">
                                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#C9A227]" />
                                    <span className="text-[#D1D5DB]">{new Date(event.createdAt).toLocaleTimeString("en-IL", { hour: "2-digit", minute: "2-digit" })} {event.message}</span>
                                  </div>
                                ))}
                              </div>
                              {request.status === "review_open" && !request.buyerReview ? (
                                <form
                                  className="grid gap-2"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void handleSubmitBuyerReview(request);
                                  }}
                                >
                                  <Textarea aria-label="Leave trade review" placeholder="Leave one review after completed trade" value={tradeReviewDrafts[request.id] ?? ""} onChange={(event) => setTradeReviewDrafts((prev) => ({ ...prev, [request.id]: event.target.value }))} />
                                  <div>
                                    <Button type="submit" size="sm" variant="secondary">Submit Buyer Review</Button>
                                  </div>
                                </form>
                              ) : null}
                              {request.buyerReview ? (
                                <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                                  <p className="font-medium text-white">Buyer Review</p>
                                  <p className="mt-1">{request.buyerReview.comment}</p>
                                </div>
                              ) : null}
                              {request.sellerResponse ? (
                                <div className="rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                                  <p className="font-medium text-white">Seller Response</p>
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
                    <Button type="button" variant="secondary" onClick={() => setBuyerTradeVisibleCount((value) => value + 8)}>
                      Load More
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {sessionUser ? notificationCenterCard : null}
          {sessionUser ? (
            <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
              <CardHeader>
                <CardTitle>Activity Timeline</CardTitle>
                <CardDescription>Newest first, grouped by date, with compact activity cards.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!activityHistory.length ? (
                  <p className="text-xs text-[#9CA3AF]">Your timeline updates automatically as you trade, review, and manage listings.</p>
                ) : (
                  groupedActivityHistory.map((group) => (
                    <div key={group.dayKey} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{group.label}</p>
                      <div className="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                        {group.items.slice(0, 3).map((entry) => (
                          <div key={entry.id} className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                            <div className="flex items-start justify-between gap-3">
                              <p className="font-medium text-white">{entry.title}</p>
                              <p className="shrink-0 text-[#9CA3AF]">{new Date(entry.createdAt).toLocaleTimeString("en-IL", { hour: "2-digit", minute: "2-digit" })}</p>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[#9CA3AF]">{entry.details}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {showDeepDeferredSections ? (
      <div className="mt-12 grid gap-4 md:grid-cols-4">
        {[
          { value: `${todaysCompletedTrades.toLocaleString("en-IL")}`, labelAr: "صفقات مكتملة اليوم", label: "Completed Trades Today", icon: HandCoins },
          { value: `${marketplacePulse.verifiedSellers.toLocaleString("en-IL")}+`, labelAr: "بائعون موثقون", label: "Verified Sellers", icon: ShieldCheck },
          { value: `${marketplacePulse.totalUsdtAvailable.toLocaleString("en-IL")} USDT`, labelAr: "USDT متاح", label: "USDT Available", icon: WalletCards },
          { value: `${marketplacePulse.averageResponseMinutes} min`, labelAr: "متوسط الاستجابة", label: "Average Response", icon: Clock3 },
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

      {showDeepDeferredSections ? (
      <div className="mt-12">
        <h2 className="text-2xl font-semibold md:text-3xl">FAQ</h2>
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

      {showDeepDeferredSections ? (
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
                <button type="button" aria-label="Close removal dialog" onClick={() => setRemovalListing(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-[#D1D5DB] transition hover:border-[#C9A227] hover:text-[#C9A227]">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="removal-reason" className="text-xs font-semibold uppercase tracking-[0.12em] text-[#FDE68A]">Reason <span className="text-red-300">*</span></label>
                  <select
                    id="removal-reason"
                    className={cn(
                      "mt-1 flex h-11 w-full rounded-xl border bg-[#101010] px-3 py-2 text-sm text-white",
                      removalReason ? "border-emerald-500/60" : "border-red-500/70",
                    )}
                    value={removalReason}
                    onChange={(event) => setRemovalReason(event.target.value)}
                  >
                    <option value="">Select a reason…</option>
                    {LISTING_CHANGE_REASONS.map((reason) => (
                      <option key={reason} value={reason}>{reason}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="removal-explanation" className="text-xs font-semibold uppercase tracking-[0.12em] text-[#9CA3AF]">Explanation <span className="text-red-300">*</span></label>
                  <Textarea
                    id="removal-explanation"
                    aria-label="Removal explanation"
                    placeholder="Briefly explain why you're removing this listing"
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
                    {listingActionKey === `${removalListing.id}:delete` ? "Removing..." : "Remove Listing"}
                  </Button>
                  <Button type="button" variant="secondary" className="w-full" onClick={() => setRemovalListing(null)}>Cancel</Button>
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
                <button type="button" aria-label="Close Buy USDT sheet" onClick={closeListingModal} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-[#D1D5DB] transition hover:border-[#C9A227] hover:text-[#C9A227]">
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
                            <img src={modalPhoto} alt={`${safeText(modalName, "Seller")} profile`} className="h-12 w-12 shrink-0 rounded-full border border-white/15 object-cover" />
                          ) : (
                            <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-sm font-semibold text-white">
                              {safeText(modalName, "Seller").split(" ").map((part) => part[0]).join("").slice(0, 2)}
                            </div>
                          )}
                          <div className={`min-w-0 flex-1 ${isAr ? "text-right" : ""}`}>
                            <div className={`flex flex-wrap items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                              <p className={cn("truncate text-base font-semibold", selectedListing.sellerProfile?.isOwner ? "profile-identity-name--owner" : `seller-rank-name seller-rank-name--${modalToneKey}`)}>{safeText(modalName, "Seller")}</p>
                              <RoleBadge variant="approved_seller" className={cn("seller-rank-badge", `seller-rank-badge--${modalToneKey}`)} />
                              <span className={cn("seller-rank-pill", `seller-rank-pill--${modalToneKey}`)}>
                                {selectedListing.sellerProfile?.isOwner ? "Legendary Seller" : `${sellerLevelLabel(modalLevel)} Seller`}
                              </span>
                            </div>
                            <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#9CA3AF] ${isAr ? "flex-row-reverse" : ""}`}>
                              <span className={cn("inline-flex items-center gap-1", `seller-presence--${modalPresence.tone}`)}>
                                <span className={cn("seller-presence-dot", `seller-presence-dot--${modalPresence.tone}`)} aria-hidden="true" />
                                {isAr ? modalPresence.labelAr : modalPresence.label}
                              </span>
                              <span><ShieldCheck className="mr-0.5 inline h-3 w-3 text-[#93C5FD]" />{modalTrust.toFixed(1)}</span>
                              <span><Zap className="mr-0.5 inline h-3 w-3 text-[#F4D87A]" />{modalResponse.toFixed(0)} min</span>
                              <span><HandCoins className="mr-0.5 inline h-3 w-3" />{modalCompleted.toLocaleString("en-IL")} trades</span>
                              <span><Star className="mr-0.5 inline h-3 w-3 text-[#F4D87A]" />{modalRating.toFixed(2)}</span>
                              {isSellerProfileLoading && !sellerProfileData ? <span className="text-[10px] italic text-[#9CA3AF]">refreshing…</span> : null}
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
                        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-emerald-200/90">USDT Available</p>
                      </div>
                      <div className={isAr ? "text-left" : "text-right"}>
                        <p className="text-2xl font-bold leading-none text-[#C9A227]">{formatIls(selectedPrice)}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#D1D5DB]">ILS / USDT · {selectedListing.network}</p>
                      </div>
                    </div>
                    <p className={`mt-2 text-[11px] text-[#9CA3AF] ${isAr ? "text-right" : ""}`}>
                      Commission (1%): <span className="text-white">₪{commission.toFixed(2)}</span> · Estimated total: <span className="text-[#C9A227]">₪{estimatedTotal.toFixed(2)}</span>
                    </p>
                  </div>

                  {isOwnerViewer && sellerProfileData ? (
                    <div className="rounded-2xl border border-[#C9A227]/25 bg-black/25 p-4 text-sm text-[#D1D5DB]">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Owner Tools</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="secondary" disabled={isOwnerProfileActionLoading} onClick={() => void handleOwnerSellerProfileState(sellerProfileData.sellerId, { feature: !sellerProfileData.profile.isFeaturedSeller }, sellerProfileData.profile.isFeaturedSeller ? "Seller unfeatured." : "Seller featured.")}>
                          {sellerProfileData.profile.isFeaturedSeller ? "Unfeature Seller" : "Feature Seller"}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={isOwnerProfileActionLoading} onClick={() => void handleOwnerSellerProfileState(sellerProfileData.sellerId, { hidden: !sellerProfileData.profile.isProfileHidden }, sellerProfileData.profile.isProfileHidden ? "Seller profile unhidden." : "Seller profile hidden.")}>
                          {sellerProfileData.profile.isProfileHidden ? "Unhide Seller" : "Hide Seller"}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={isOwnerProfileActionLoading} onClick={() => void handleOwnerSuspendSeller(sellerProfileData.sellerId)}>
                          Suspend Seller
                        </Button>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                          <p className="font-medium text-white">Audit History</p>
                          <p className="mt-1">{sellerProfileData.ownerTools?.auditHistory.length ?? 0} records</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                          <p className="font-medium text-white">Commission History</p>
                          <p className="mt-1">{sellerProfileData.ownerTools?.commissionHistory.length ?? 0} records</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                          <p className="font-medium text-white">Trade History</p>
                          <p className="mt-1">{sellerProfileData.ownerTools?.tradeHistory.length ?? 0} records</p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                          <p className="font-medium text-white">Recent Audit</p>
                          {(sellerProfileData.ownerTools?.auditHistory ?? []).slice(0, 3).map((entry) => (
                            <p key={entry.id} className="mt-1">{entry.action} • {new Date(entry.createdAt).toLocaleDateString("en-IL")}</p>
                          ))}
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                          <p className="font-medium text-white">Recent Commission</p>
                          {(sellerProfileData.ownerTools?.commissionHistory ?? []).slice(0, 3).map((entry) => (
                            <p key={entry.id} className="mt-1">{entry.commissionAmount.toFixed(2)} USDT • {new Date(entry.createdAt).toLocaleDateString("en-IL")}</p>
                          ))}
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                          <p className="font-medium text-white">Recent Trades</p>
                          {(sellerProfileData.ownerTools?.tradeHistory ?? []).slice(0, 3).map((entry) => (
                            <p key={entry.id} className="mt-1">{shortTradeRef(entry)} • {tradeStatusLabel(entry.status)}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <form id="buy-usdt-form" className="grid gap-3" onSubmit={handlePurchaseSubmit}>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Choose payment method</p>
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
                              className={`rounded-xl border p-3 text-left transition-all duration-200 ${
                                selected
                                  ? "border-[#6CAEFF]/70 bg-[#6CAEFF]/15 shadow-[0_10px_24px_rgba(36,121,255,0.25)]"
                                  : "border-white/10 bg-black/25 hover:-translate-y-0.5 hover:border-[#6CAEFF]/45 hover:shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
                              }`}
                            >
                              <p className="text-sm font-medium text-white">{paymentMethodEmoji(method)} {paymentMethodLabel(method)}</p>
                              {selected ? <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#93C5FD]">Selected for this trade</p> : null}
                            </button>
                          );
                        })}
                      </div>
                      {selectedMethodUsesBanks(selectedListingPaymentMethod) && parseIsraeliBankSelection(selectedListing.bankName).length ? (
                        <p className="mt-3 text-xs text-[#D1D5DB]">Supported banks: <span className="text-white">{parseIsraeliBankSelection(selectedListing.bankName).join(", ")}</span></p>
                      ) : null}
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2 md:col-span-3">
                        <label htmlFor="buyer-usdt-amount" className="text-sm font-medium text-white">
                          {isAr ? "كمية USDT" : "USDT Amount"} <span className="text-red-300">*</span>
                        </label>
                        <Input
                          id="buyer-usdt-amount"
                          inputMode="numeric"
                          placeholder={isAr ? "أدخل الكمية" : "Enter amount"}
                          value={buyerInfo.usdtAmount}
                          onChange={(event) => setBuyerInfo((prev) => ({ ...prev, usdtAmount: formatIntegerForInput(event.target.value) }))}
                          className={buyerTradeAmountInvalid ? "border-red-500/80" : buyerTradeAmount > 0 ? "border-emerald-500/70" : ""}
                          aria-invalid={buyerTradeAmountInvalid || undefined}
                          aria-describedby="buyer-amount-help"
                        />
                        <p id="buyer-amount-help" className={`text-xs ${buyerTradeAmountInvalid ? "text-red-300" : "text-[#9CA3AF]"}`}>
                          {buyerTradeAmountInvalid ? "⚠ " : ""}Trade limits: {selectedMinTrade.toLocaleString("en-IL")} - {selectedMaxTrade.toLocaleString("en-IL")} USDT
                        </p>
                      </div>
                      <Input aria-label={isAr ? "الاسم" : "Name"} placeholder={isAr ? "الاسم" : "Name"} value={buyerInfo.name} onChange={(event) => setBuyerInfo((prev) => ({ ...prev, name: event.target.value }))} />
                      <Input aria-label={isAr ? "واتساب" : "WhatsApp"} placeholder={isAr ? "واتساب" : "WhatsApp"} value={buyerInfo.whatsapp} onChange={(event) => setBuyerInfo((prev) => ({ ...prev, whatsapp: event.target.value }))} />
                      <Textarea aria-label={isAr ? "ملاحظات" : "Buyer notes"} placeholder={isAr ? "ملاحظات (اختياري)" : "Notes (optional)"} value={buyerInfo.notes} onChange={(event) => setBuyerInfo((prev) => ({ ...prev, notes: event.target.value }))} />
                      <div className="space-y-2 md:col-span-3">
                        <label htmlFor="buyer-receiving-wallet" className="text-sm font-medium text-white">
                          Receiving Wallet Address <span className="text-red-300">*</span>
                        </label>
                        <Input
                          id="buyer-receiving-wallet"
                          required
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={`${selectedListing.network} wallet address`}
                          value={buyerInfo.receivingWalletAddress}
                          onChange={(event) => setBuyerInfo((prev) => ({ ...prev, receivingWalletAddress: event.target.value }))}
                          className={buyerInfo.receivingWalletAddress && buyerWalletInvalid ? "border-red-500/80" : ""}
                          aria-describedby="buyer-wallet-guidance"
                          aria-invalid={buyerInfo.receivingWalletAddress ? buyerWalletInvalid : undefined}
                        />
                        <p
                          id="buyer-wallet-guidance"
                          className={`text-xs ${buyerInfo.receivingWalletAddress && buyerWalletInvalid ? "text-red-300" : "text-[#9CA3AF]"}`}
                        >
                          {buyerInfo.receivingWalletAddress && buyerWalletValidationError
                            ? buyerWalletValidationError
                            : `Enter the address where you want to receive USDT on ${selectedListing.network}. It stays hidden from the seller until you mark payment as sent.`}
                        </p>
                      </div>
                    </div>
                    {selectedListingRequiresSafetyNotice ? (
                      <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                        <p className="font-semibold text-[#FDE68A]">Safety Guidelines</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-[#E5E7EB]">
                          <li>Meet only in public places.</li>
                          <li>Prefer locations with security cameras.</li>
                          <li>Meet during daylight when possible.</li>
                          <li>Do not reveal unnecessary personal information.</li>
                          <li>Confirm the USDT transfer before leaving.</li>
                          <li>Report suspicious behavior immediately.</li>
                        </ul>
                        <label className="mt-2 inline-flex cursor-pointer items-start gap-2 text-[#E5E7EB]">
                          <input
                            type="checkbox"
                            checked={faceToFaceSafetyAcknowledged}
                            onChange={(event) => setFaceToFaceSafetyAcknowledged(event.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]"
                          />
                          <span>I have read and understand the privacy and safety guidelines.</span>
                        </label>
                        <p className="mt-1 text-[#D1D5DB]">Both buyer and seller must acknowledge these guidelines before the trade can begin.</p>
                        <p className="mt-1 text-[#D1D5DB]">Read full guidance in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety & Trust Center</Link>.</p>
                      </div>
                    ) : null}
                    {showVerificationCta ? (
                      <Card className="border-[#C9A227]/50 bg-gradient-to-br from-amber-500/15 via-black/60 to-[#C9A227]/10 shadow-[0_0_26px_rgba(201,162,39,0.22)]">
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 text-[#FDE68A]" />
                            <div>
                              <p className="text-sm font-semibold text-[#FDE68A]">⚠️ Buyer Verification Required</p>
                              <p className="mt-1 text-xs text-[#E5E7EB]">
                                Complete your verification to begin trading safely on Alpha Exchange. The verification takes less than one minute.
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
                              {isRedirectingToVerification ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              {isRedirectingToVerification ? "Redirecting to verification..." : "✅ Verify Now"}
                            </Button>
                            <button
                              type="button"
                              onClick={goToVerificationGate}
                              disabled={isRedirectingToVerification}
                              className="text-left text-xs text-[#FDE68A] underline underline-offset-2 transition hover:text-[#FFE8A3] disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              Go to Verification →
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
                      {isSubmittingPurchase ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {isSubmittingPurchase ? "Starting trade..." : "Start Trade"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      disabled={isSubmittingPurchase || buyerTradeAmountInvalid || buyerWalletInvalid || (selectedListingRequiresSafetyNotice && !faceToFaceSafetyAcknowledged)}
                      onClick={() => void submitPurchaseRequest("Please proceed with this trade.")}
                    >
                      {isSubmittingPurchase ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {isSubmittingPurchase ? "Submitting..." : "Quick Buy"}
                    </Button>
                  </div>
                </div>
                </>
              ) : (
                <div className="px-5 pb-5 pt-4 sm:px-6">
                <div className="rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/10 p-4 text-sm">
                  <p className="text-base font-semibold text-white">Request Submitted</p>
                  <p className="mt-2 text-[#D1D5DB]">Alpha Traders has received your request. We will connect you with the Approved Seller shortly.</p>
                  <div className="mt-4">
                    <Button onClick={() => {
                      closeListingModal();
                    }}>Close</Button>
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
