"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BadgePercent, BellRing, CheckCircle2, ChevronDown, Clock3, Copy, Edit3, HandCoins, Layers3, LockKeyhole, MessageCircle, Network, PauseCircle, PlayCircle, ShieldCheck, Sparkles, Star, Store, Trash2, TrendingUp, Trophy, Users, WalletCards, X } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RoleBadge } from "@/components/ui/role-badge";
import { ExchangeMarketStats } from "@/components/sections/usdt-exchange/exchange-market-stats";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { hasRole } from "@/lib/roles";
import type { AlphaExchangeActivityLogEntry, AlphaExchangeNotification, BetaAnnouncement, BetaFeedbackCategory, BetaFeedbackEntry, MarketplaceListing, NotificationCategory, PremiumSellerProfileData, PurchaseRequest, SellerApplication, SellerAvailabilityStatus, SellerBadge, SellerLevel, SellerStatus, SupportedNetwork, UserRole } from "@/types/alpha-exchange";

const WHATSAPP_URL = "https://wa.me/972525967649";
const MAX_EVIDENCE_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const LISTING_EXPIRATION_OPTIONS = [
  { value: "1", label: "1 hour" },
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
] as const;

type Locale = "ar" | "en";

type SessionUser = {
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
  availabilityStatus: SellerAvailabilityStatus;
  lastActiveAt?: string;
  isFeaturedSeller?: boolean;
  isProfileHidden?: boolean;
  isFoundingMember?: boolean;
  isFoundingSeller?: boolean;
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

type SellerListingWorkspaceSummary = {
  activeListingLimit: number;
  openListingCount: number;
  openTradeCount: number;
  pendingCommissionCount: number;
  canCreateListing: boolean;
  blockedReason: string | null;
};

type TradeMilestone = {
  key: "request_submitted" | "request_accepted" | "payment_sent" | "usdt_sent" | "trade_completed" | "review_unlocked";
  titleEn: string;
  titleAr: string;
};

const TRADE_MILESTONES: TradeMilestone[] = [
  { key: "request_submitted", titleEn: "Request submitted", titleAr: "تم إرسال الطلب" },
  { key: "request_accepted", titleEn: "Seller accepted", titleAr: "البائع قبل الطلب" },
  { key: "payment_sent", titleEn: "Buyer payment sent", titleAr: "المشتري أكد الدفع" },
  { key: "usdt_sent", titleEn: "Seller USDT sent", titleAr: "البائع أكد إرسال USDT" },
  { key: "trade_completed", titleEn: "Buyer completed trade", titleAr: "المشتري أكد إتمام الصفقة" },
  { key: "review_unlocked", titleEn: "Review unlocked", titleAr: "نافذة المراجعة مفتوحة" },
];

function toNumber(value: string | number | null | undefined) {
  const normalized = String(value ?? "");
  return Number(normalized.replace(/[^\d.]/g, "")) || 0;
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
  const responseClone = response.clone();
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown; details?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
    if (typeof payload.details === "string" && payload.details.trim()) return payload.details;
  } catch {
    try {
      const text = (await responseClone.text()).trim();
      if (text && !/^<!doctype html>/i.test(text)) return text;
    } catch {
      return fallbackText;
    }
  }
  return fallbackText;
}

function tradeStatusLabel(status: PurchaseRequest["status"]) {
  if (status === "payment_sent") return "Payment Sent";
  if (status === "usdt_sent") return "USDT Sent";
  if (status === "review_open") return "Review Open";
  return status[0].toUpperCase() + status.slice(1);
}

function listingStatusLabel(status: MarketplaceListing["status"]) {
  if (status === "in_trade") return "In Trade";
  return status.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
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
  if (level === "elite") return "Elite";
  if (level === "diamond") return "Diamond";
  if (level === "gold") return "Gold";
  if (level === "silver") return "Silver";
  return "Bronze";
}

function sellerBadgeLabel(badge: SellerBadge) {
  if (badge === "elite_seller") return "🥇 Elite Seller";
  if (badge === "top_rated") return "💎 Top Rated";
  if (badge === "fast_responder") return "⚡ Fast Responder";
  if (badge === "trusted_seller") return "🛡 Trusted Seller";
  if (badge === "most_active") return "🔥 Most Active";
  if (badge === "platinum_seller") return "👑 Platinum Seller";
  return "🚀 1000+ Trades";
}

function betaFeedbackCategoryLabel(category: BetaFeedbackCategory) {
  if (category === "bug") return "Bug";
  if (category === "suggestion") return "Suggestion";
  if (category === "confusing_ux") return "Confusing UX";
  if (category === "feature_request") return "Feature Request";
  if (category === "performance") return "Performance";
  return "Other";
}

function roleBadgeVariantsFromSession(user: SessionUser) {
  const badges: Array<"guest" | "student" | "buyer" | "pending_seller" | "approved_seller" | "administrator" | "owner"> = [];
  const roles = user.roles ?? [];
  if (roles.includes("owner") || (user.role === "admin" && isAlphaExchangeOwnerEmail(user.email))) badges.push("owner");
  if (roles.includes("admin") || user.role === "admin") badges.push("administrator");
  if (roles.includes("approved_seller") || user.sellerStatus === "approved_seller") badges.push("approved_seller");
  if (roles.includes("pending_seller_approval") || user.sellerStatus === "pending_seller_approval") badges.push("pending_seller");
  if (roles.includes("buyer") || user.role === "buyer") badges.push("buyer");
  if (roles.includes("student") || user.role === "student") badges.push("student");
  if (roles.includes("guest") || user.role === "guest" || badges.length === 0) badges.push("guest");
  return Array.from(new Set(badges));
}

function tradeProgressRank(request: PurchaseRequest) {
  const timeline = request.timeline ?? [];
  const acceptedSeen = timeline.some((event) => event.type === "request_accepted");
  if (request.status === "pending") return 0;
  if (request.status === "accepted") return 1;
  if (request.status === "payment_sent") return 2;
  if (request.status === "usdt_sent") return 3;
  if (request.status === "completed" || request.status === "locked") return 4;
  if (request.status === "review_open") return 5;
  if (request.status === "cancelled") return acceptedSeen ? 1 : 0;
  return 0;
}

function nextTradeActionHint(request: PurchaseRequest, isAr: boolean) {
  if (request.status === "pending") {
    return isAr ? "الإجراء التالي: البائع يقبل أو يرفض الطلب." : "Next action: seller accepts or declines the request.";
  }
  if (request.status === "accepted") {
    return isAr ? "الإجراء التالي: المشتري يرفع إثبات الدفع ثم يؤكد Payment Sent." : "Next action: buyer uploads payment evidence and marks Payment Sent.";
  }
  if (request.status === "payment_sent") {
    return isAr ? "الإجراء التالي: البائع يرفع إثبات التحويل ثم يؤكد USDT Sent." : "Next action: seller uploads transfer evidence and marks USDT Sent.";
  }
  if (request.status === "usdt_sent") {
    return isAr ? "الإجراء التالي: المشتري يؤكد اكتمال الصفقة." : "Next action: buyer confirms trade completion.";
  }
  if (request.status === "review_open") {
    return isAr ? "الإجراء التالي: يمكن للطرفين مراجعة نتيجة الصفقة." : "Next action: parties can leave/track the trade review.";
  }
  if (request.status === "declined") {
    return isAr ? "تم إنهاء الصفقة: تم رفض الطلب من البائع." : "Trade ended: seller declined this request.";
  }
  return isAr ? "تم إنهاء الصفقة: تم إلغاء الطلب." : "Trade ended: request was cancelled.";
}

function tradeMilestoneTimestamp(request: PurchaseRequest, key: TradeMilestone["key"]) {
  const timeline = request.timeline ?? [];
  const event = timeline.find((item) => item.type === key);
  return event?.createdAt;
}

export function UsdtExchangePage({ locale }: { locale: Locale }) {
  const isAr = locale === "ar";
  const router = useRouter();
  const showLegacyNotificationCenter = false;

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [isLoadingListings, setIsLoadingListings] = useState(true);
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
  const [purchaseSubmitted, setPurchaseSubmitted] = useState(false);
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [sellerProfileData, setSellerProfileData] = useState<PremiumSellerProfileData | null>(null);
  const [isSellerProfileLoading, setIsSellerProfileLoading] = useState(false);
  const [isOwnerProfileActionLoading, setIsOwnerProfileActionLoading] = useState(false);
  const [sellerApplication, setSellerApplication] = useState<SellerApplication | null>(null);
  const [myRequests, setMyRequests] = useState<PurchaseRequest[]>([]);
  const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);
  const [listingWorkspaceSummary, setListingWorkspaceSummary] = useState<SellerListingWorkspaceSummary | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sellerWorkspaceMessage, setSellerWorkspaceMessage] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [listingEditForm, setListingEditForm] = useState({
    availableAmount: "",
    price: "",
    currency: "ILS",
    network: "TRC20" as SupportedNetwork,
    paymentMethods: "Bank transfer",
    minimumTrade: "0",
    maximumTrade: "",
    expirationHours: "24",
    notes: "",
  });
  const [listingCreateForm, setListingCreateForm] = useState({
    availableAmount: "",
    price: "",
    currency: "ILS",
    network: "TRC20" as SupportedNetwork,
    paymentMethods: "Bank transfer",
    minimumTrade: "0",
    maximumTrade: "",
    expirationHours: "24",
    notes: "",
    sellerDescription: "",
    responseTime: "5 min",
    photos: "",
  });
  const [sellerSettings, setSellerSettings] = useState({
    fullName: "",
    whatsappNumber: "",
    preferredNetworks: ["TRC20"] as SupportedNetwork[],
    profilePhotoUrl: "",
    coverBannerUrl: "",
    languages: ["English"],
    bio: "",
    tradingExperience: "",
    workingHours: "",
    preferredPaymentMethods: ["Bank transfer"],
    country: "Israel",
    city: "",
    onlineStatus: "online" as "online" | "offline",
    availabilityStatus: "available" as SellerAvailabilityStatus,
    currentPassword: "",
    newPassword: "",
  });

  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState<"all" | SupportedNetwork>("all");
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
  const [tradeReviewDrafts, setTradeReviewDrafts] = useState<Record<string, string>>({});
  const [sellerResponseDrafts, setSellerResponseDrafts] = useState<Record<string, string>>({});
  const [buyerEvidenceFiles, setBuyerEvidenceFiles] = useState<Record<string, File | null>>({});
  const [sellerEvidenceFiles, setSellerEvidenceFiles] = useState<Record<string, File | null>>({});
  const [evidenceUploading, setEvidenceUploading] = useState<Record<string, boolean>>({});
  const [notifications, setNotifications] = useState<AlphaExchangeNotification[]>([]);
  const [activityHistory, setActivityHistory] = useState<AlphaExchangeActivityLogEntry[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationQuery, setNotificationQuery] = useState("");
  const [notificationCategory, setNotificationCategory] = useState<"all" | NotificationCategory>("all");
  const [notificationUnreadOnly, setNotificationUnreadOnly] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<{ inApp: boolean; email: boolean; sms: boolean }>({ inApp: true, email: false, sms: false });
  const [betaAnnouncements, setBetaAnnouncements] = useState<BetaAnnouncement[]>([]);
  const [myBetaFeedback, setMyBetaFeedback] = useState<BetaFeedbackEntry[]>([]);
  const [betaFeedbackCategory, setBetaFeedbackCategory] = useState<BetaFeedbackCategory>("suggestion");
  const [betaFeedbackMessage, setBetaFeedbackMessage] = useState("");
  const notificationsRequestIdRef = useRef(0);
  const createListingFormRef = useRef<HTMLDivElement | null>(null);

  const [buyerInfo, setBuyerInfo] = useState({ amount: "", name: "", whatsapp: "", notes: "" });
  const [sellerForm, setSellerForm] = useState({
    fullName: "",
    email: "",
    whatsappNumber: "",
    preferredNetwork: "TRC20",
    expectedMonthlyTradingVolume: "",
    additionalNotes: "",
  });

  const refreshSellerWorkspace = useCallback(async () => {
    try {
      const [requestsRes, myListingsRes] = await Promise.all([
        fetch("/api/alpha-exchange/purchase-requests", { cache: "no-store" }),
        fetch("/api/alpha-exchange/my-listings", { cache: "no-store" }),
      ]);
      if (requestsRes.ok) {
        const requestsJson = (await requestsRes.json()) as { requests: PurchaseRequest[] };
        setMyRequests(requestsJson.requests ?? []);
      }
      if (myListingsRes.ok) {
        const myListingsJson = (await myListingsRes.json()) as { listings: MarketplaceListing[]; summary?: SellerListingWorkspaceSummary | null };
        setMyListings(myListingsJson.listings ?? []);
        setListingWorkspaceSummary(myListingsJson.summary ?? null);
      }
      setWorkspaceError(null);
    } catch {
      setWorkspaceError(safeErrorMessage("workspace"));
    }
  }, []);

  const refreshMarketplaceListings = useCallback(async () => {
    try {
      const listingsRes = await fetch("/api/alpha-exchange/listings", { cache: "no-store" });
      if (!listingsRes.ok) {
        setWorkspaceError(safeErrorMessage("workspace"));
        return;
      }
      const listingsJson = (await listingsRes.json()) as { listings: MarketplaceListing[] };
      setListings(listingsJson.listings ?? []);
      setWorkspaceError(null);
    } catch {
      setWorkspaceError(safeErrorMessage("workspace"));
    }
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
      const response = await fetch(`/api/alpha-exchange/notifications?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      const payload = (await response.json()) as { notifications: AlphaExchangeNotification[]; activity: AlphaExchangeActivityLogEntry[] };
      if (requestId !== notificationsRequestIdRef.current) return;
      setNotifications(payload.notifications ?? []);
      setActivityHistory(payload.activity ?? []);
    } catch {
      setStatusMessage(safeErrorMessage("workspace"));
    } finally {
      setNotificationsLoading(false);
    }
  }, [notificationCategory, notificationQuery, notificationUnreadOnly, sessionUser]);

  const refreshNotificationPreferences = useCallback(async () => {
    try {
      const response = await fetch("/api/alpha-exchange/notification-preferences", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { preferences: { inApp: boolean; email: boolean; sms: boolean } };
      if (payload.preferences) setNotificationPreferences(payload.preferences);
    } catch {
      // Keep silent to preserve UX messaging style.
    }
  }, []);

  async function handleMarkAllNotificationsRead() {
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
  }

  async function handleNotificationReadState(notificationId: string, isRead: boolean) {
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
  }

  async function handleDeleteNotification(notificationId: string) {
    const response = await fetch(`/api/alpha-exchange/notifications/${notificationId}`, { method: "DELETE" });
    await response.json();
    if (!response.ok) {
      setStatusMessage(safeErrorMessage("workspace"));
      return;
    }
    await refreshNotifications();
  }

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

  const refreshBetaChannels = useCallback(async () => {
    try {
      const [announcementsRes, feedbackRes] = await Promise.all([
        fetch("/api/alpha-exchange/private-beta/announcements", { cache: "no-store" }),
        fetch("/api/alpha-exchange/private-beta/feedback", { cache: "no-store" }),
      ]);
      if (announcementsRes.ok) {
        const announcementsJson = (await announcementsRes.json()) as { announcements: BetaAnnouncement[] };
        setBetaAnnouncements(announcementsJson.announcements ?? []);
      }
      if (feedbackRes.ok) {
        const feedbackJson = (await feedbackRes.json()) as { feedback: BetaFeedbackEntry[] };
        setMyBetaFeedback(feedbackJson.feedback ?? []);
      }
    } catch {
      setStatusMessage(safeErrorMessage("workspace"));
    }
  }, []);

  async function handleSubmitBetaFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/alpha-exchange/private-beta/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: betaFeedbackCategory,
        message: betaFeedbackMessage,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setStatusMessage(payload.error ?? safeErrorMessage("workspace"));
      return;
    }
    setBetaFeedbackMessage("");
    setStatusMessage("Beta feedback submitted.");
    await refreshBetaChannels();
  }

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function bootstrap() {
      try {
        const [meRes, listingsRes] = await Promise.all([
          fetch("/api/auth/me", { cache: "no-store", signal: controller.signal }),
          fetch("/api/alpha-exchange/listings", { cache: "no-store", signal: controller.signal }),
        ]);
        if (cancelled) return;
        const meJson = (await meRes.json()) as { user: SessionUser | null };
        const listingsJson = (await listingsRes.json()) as { listings: MarketplaceListing[] };
        if (cancelled) return;
        setSessionUser(meJson.user);
        setListings(listingsJson.listings ?? []);

        if (meJson.user) {
          const user = meJson.user;
          setSellerForm((prev) => ({
            ...prev,
            fullName: user.fullName,
            email: user.email,
            whatsappNumber: user.whatsappNumber || prev.whatsappNumber,
          }));
          setSellerSettings({
            fullName: user.fullName,
            whatsappNumber: user.whatsappNumber || "",
            preferredNetworks: user.preferredNetworks?.length ? user.preferredNetworks : ["TRC20"],
            profilePhotoUrl: user.profilePhotoUrl || "",
            coverBannerUrl: user.coverBannerUrl || "",
            languages: user.languages?.length ? user.languages : ["English"],
            bio: user.bio || "",
            tradingExperience: user.tradingExperience || "",
            workingHours: user.workingHours || "",
            preferredPaymentMethods: user.preferredPaymentMethods?.length ? user.preferredPaymentMethods : ["Bank transfer"],
            country: user.country || "Israel",
            city: user.city || "",
            onlineStatus: user.onlineStatus || "online",
            availabilityStatus: user.availabilityStatus || "available",
            currentPassword: "",
            newPassword: "",
          });
          setBuyerInfo((prev) => ({
            ...prev,
            name: user.fullName,
            whatsapp: user.whatsappNumber || prev.whatsapp,
          }));
          const [applicationRes] = await Promise.all([
            fetch("/api/alpha-exchange/seller-application", { cache: "no-store", signal: controller.signal }),
            refreshSellerWorkspace(),
            refreshNotificationPreferences(),
            refreshBetaChannels(),
          ]);
          if (cancelled) return;
          if (applicationRes.ok) {
            const applicationJson = (await applicationRes.json()) as { application: SellerApplication | null };
            if (cancelled) return;
            setSellerApplication(applicationJson.application);
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setWorkspaceError(safeErrorMessage("workspace"));
      } finally {
        if (!cancelled) setIsLoadingListings(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refreshBetaChannels, refreshNotificationPreferences, refreshSellerWorkspace]);

  useEffect(() => {
    if (!showLegacyNotificationCenter || !sessionUser) return;
    void refreshNotifications();
  }, [notificationCategory, notificationQuery, notificationUnreadOnly, refreshNotifications, sessionUser, showLegacyNotificationCenter]);

  const features: FeatureCard[] = [
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
  ];

  const timelineSteps: TimelineStep[] = [
    {
      title: isAr ? "المشتري يرسل طلب الصفقة" : "Buyer submits trade request",
      body: isAr ? "يتم تسجيل طلب الصفقة فور الإرسال ضمن سجل زمني دائم." : "The request is recorded as a permanent timeline event immediately.",
    },
    {
      title: isAr ? "البائع يقبل الطلب" : "Seller accepts request and creates trade",
      body: isAr ? "عند القبول يتم إنشاء Trade ID وتثبيت تفاصيل الصفقة." : "Accepting creates a Trade ID and locks in trade details.",
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
  ];

  const faqs = [
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
  ];

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
      if (sortBy === "trust-desc") return (b.sellerReputation?.trustScore ?? 0) - (a.sellerReputation?.trustScore ?? 0);
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

  const marketStats = useMemo(() => {
    const uniqueSellers = new Set(listings.map((l) => l.sellerId ?? l.sellerDisplayName));
    const onlineSellers = new Set(
      listings
        .filter((l) => l.sellerProfile?.onlineStatus === "online")
        .map((l) => l.sellerId ?? l.sellerDisplayName)
    );
    const responseMins = listings
      .map((l) => parseMinutes(l.responseTime))
      .filter((v) => v > 0);
    const avgMins =
      responseMins.length > 0
        ? Math.round(responseMins.reduce((sum, v) => sum + v, 0) / responseMins.length)
        : null;
    return {
      activeSellers: uniqueSellers.size,
      onlineNow: onlineSellers.size,
      averageResponse: avgMins !== null ? `${avgMins} min` : undefined,
      openListings: listings.length,
    };
  }, [listings]);

  function requireAuth() {
    if (!sessionUser) {
      router.push("/login");
      return false;
    }
    return true;
  }

  async function fetchSellerProfileData(sellerId: string) {
    setIsSellerProfileLoading(true);
    try {
      const response = await fetch(`/api/alpha-exchange/sellers/${sellerId}/profile`, { cache: "no-store" });
      const payload = (await response.json()) as { profile?: PremiumSellerProfileData; error?: string };
      if (!response.ok || !payload.profile) {
        setSellerProfileData(null);
        setStatusMessage(payload.error ?? safeErrorMessage("workspace"));
        return;
      }
      setSellerProfileData(payload.profile);
    } catch {
      setSellerProfileData(null);
      setStatusMessage(safeErrorMessage("workspace"));
    } finally {
      setIsSellerProfileLoading(false);
    }
  }

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

  function openListingModal(listing: MarketplaceListing) {
    if (!requireAuth()) return;
    setSelectedListing(listing);
    setSellerProfileData(null);
    void fetchSellerProfileData(listing.sellerId);
    setPurchaseSubmitted(false);
    setStatusMessage(null);
    setBuyerInfo((prev) => ({
      ...prev,
      amount: listing.minimumTrade && toNumber(listing.minimumTrade) > 0 ? listing.minimumTrade : listing.availableAmount,
    }));
  }

  function openCreateListingFlow() {
    if (listingWorkspaceSummary?.blockedReason) {
      setSellerWorkspaceMessage(listingWorkspaceSummary.blockedReason);
      return;
    }
    createListingFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
          ...sellerForm,
          preferredNetworks: [sellerForm.preferredNetwork],
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

  async function handlePurchaseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedListing) return;
    const fallbackMessage = safeErrorMessage("purchase");
    const response = await fetch("/api/alpha-exchange/purchase-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId: selectedListing.id,
        usdtAmount: buyerInfo.amount,
        buyerName: buyerInfo.name,
        buyerWhatsapp: buyerInfo.whatsapp,
        buyerNotes: buyerInfo.notes,
      }),
    });
    const data = (await response.json()) as { error?: string; purchase?: PurchaseRequest };
    if (!response.ok) {
      setStatusMessage(data.error ?? fallbackMessage);
      return;
    }
    if (data.purchase) {
      setMyRequests((prev) => [data.purchase as PurchaseRequest, ...prev]);
      setPurchaseSubmitted(true);
      setStatusMessage(null);
    }
  }

  const selectedAmount = toNumber(buyerInfo.amount || selectedListing?.minimumTrade || selectedListing?.availableAmount);
  const selectedPrice = selectedListing ? toNumber(selectedListing.price) : 0;
  const commission = selectedAmount * selectedPrice * 0.01;
  const estimatedTotal = selectedAmount * selectedPrice + commission;

  const buyerMenu = ["Profile", "My Requests", "Settings"];
  const sellerMenu = ["Profile", "My Listings", "Create Listing", "My Requests", "Settings"];
  const isApprovedSeller = Boolean(sessionUser && !hasRole(sessionUser, "admin") && hasRole(sessionUser, "approved_seller"));
  const isOwnerViewer = Boolean(sessionUser && (hasRole(sessionUser, "owner") || (hasRole(sessionUser, "admin") && isAlphaExchangeOwnerEmail(sessionUser.email))));
  const menuItems = isApprovedSeller ? sellerMenu : buyerMenu;

  const sellerRequests = useMemo(() => myRequests.filter((request) => request.sellerId === sessionUser?.id), [myRequests, sessionUser?.id]);
  const buyerRequests = useMemo(() => myRequests.filter((request) => request.buyerId === sessionUser?.id), [myRequests, sessionUser?.id]);
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
  const pendingSellerRequests = useMemo(() => sellerRequests.filter((request) => request.status === "pending"), [sellerRequests]);
  const completedSellerRequests = useMemo(
    () => sellerRequests.filter((request) => request.status === "completed" || request.status === "review_open" || Boolean(request.completedAt)),
    [sellerRequests],
  );
  const myListingsById = useMemo(() => new Map(myListings.map((listing) => [listing.id, listing])), [myListings]);

  const sellerOverviewStats = useMemo(() => {
    const completedByListing = completedSellerRequests.map((request) => {
      const listing = myListingsById.get(request.listingId);
      return {
        amount: toNumber(request.usdtAmount),
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
    const profileViews = Math.round(220 + completedSellerRequests.length * 6 + myListings.length * 18);
    const listingViews = myListings.reduce((sum, listing) => sum + (120 + String(listing.id ?? "").split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) % 900), 0);
    const monthlyGrowth = Math.min(64, Math.max(-6, pendingSellerRequests.length * 2 + completedSellerRequests.length * 1.6 - 4));
    const averageTradeSize = completedSellerRequests.length ? grossSales / completedSellerRequests.length : 0;
    const estimatedCommissionPaid = grossSales * 0.01;
    const selfReputation = myListings.find((listing) => Boolean(listing.sellerReputation))?.sellerReputation ?? null;
    return {
      activeListings: myListings.filter((listing) => listing.status === "active" || listing.status === "matched" || listing.status === "in_trade").length,
      pendingRequests: pendingSellerRequests.length,
      completedTrades: completedSellerRequests.length,
      totalUsdtSold,
      estimatedEarnings,
      averageResponseTime,
      profileViews,
      listingViews,
      tradeRequests: sellerRequests.length,
      successRate,
      completionRate,
      monthlyGrowth,
      estimatedCommissionPaid,
      revenueGenerated: grossSales,
      repeatBuyers: repeatBuyersCount,
      averageTradeSize,
      reputation: selfReputation,
    };
  }, [completedSellerRequests, myListings, myListingsById, pendingSellerRequests.length, sellerRequests]);

  async function handleSellerListingStatus(listing: MarketplaceListing, nextStatus: "active" | "paused") {
    const response = await fetch(`/api/alpha-exchange/listings/${listing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setSellerWorkspaceMessage(payload.error ?? safeErrorMessage("listing"));
      return;
    }
    setSellerWorkspaceMessage(nextStatus === "paused" ? "Listing paused." : "Listing resumed.");
    await Promise.all([refreshSellerWorkspace(), refreshMarketplaceListings()]);
  }

  async function handleSellerListingDelete(listingId: string) {
    const response = await fetch(`/api/alpha-exchange/listings/${listingId}`, { method: "DELETE" });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setSellerWorkspaceMessage(payload.error ?? safeErrorMessage("listing"));
      return;
    }
    setSellerWorkspaceMessage("Listing closed.");
    await Promise.all([refreshSellerWorkspace(), refreshMarketplaceListings()]);
  }

  async function handleSellerListingRenew(listingId: string, expirationHours = "24") {
    const response = await fetch(`/api/alpha-exchange/listings/${listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "renew", expirationHours }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setSellerWorkspaceMessage(payload.error ?? safeErrorMessage("listing"));
      return;
    }
    setSellerWorkspaceMessage("Listing renewed and visible to buyers again.");
    await Promise.all([refreshSellerWorkspace(), refreshMarketplaceListings()]);
  }

  async function handleSellerListingDuplicate(listing: MarketplaceListing) {
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
        minimumTrade: listing.minimumTrade ?? "0",
        maximumTrade: listing.maximumTrade ?? listing.availableAmount,
        expirationHours: "24",
        notes: listing.notes ?? "",
        sellerDescription: listing.sellerDescription ?? "",
        responseTime: listing.responseTime,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setSellerWorkspaceMessage(payload.error ?? safeErrorMessage("listing"));
      return;
    }
    setSellerWorkspaceMessage("Listing duplicated.");
    await Promise.all([refreshSellerWorkspace(), refreshMarketplaceListings()]);
  }

  async function handleSellerListingCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/alpha-exchange/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        availableAmount: listingCreateForm.availableAmount,
        price: listingCreateForm.price,
        currency: listingCreateForm.currency,
        network: listingCreateForm.network,
        paymentMethods: listingCreateForm.paymentMethods
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 8),
        minimumTrade: listingCreateForm.minimumTrade,
        maximumTrade: listingCreateForm.maximumTrade || listingCreateForm.availableAmount,
        expirationHours: listingCreateForm.expirationHours,
        notes: listingCreateForm.notes,
        sellerDescription: listingCreateForm.sellerDescription,
        responseTime: listingCreateForm.responseTime,
        photos: listingCreateForm.photos
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 6),
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setSellerWorkspaceMessage(payload.error ?? safeErrorMessage("listing"));
      return;
    }
    setListingCreateForm((prev) => ({
      ...prev,
      availableAmount: "",
      price: "",
      minimumTrade: "0",
      maximumTrade: "",
      expirationHours: "24",
      notes: "",
      sellerDescription: "",
      photos: "",
    }));
    setSellerWorkspaceMessage("Listing is now live.");
    await Promise.all([refreshSellerWorkspace(), refreshMarketplaceListings()]);
  }

  async function handleSellerListingEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingListingId) return;
    const response = await fetch(`/api/alpha-exchange/listings/${editingListingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        availableAmount: listingEditForm.availableAmount,
        price: listingEditForm.price,
        currency: listingEditForm.currency,
        network: listingEditForm.network,
        paymentMethods: listingEditForm.paymentMethods
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 8),
        minimumTrade: listingEditForm.minimumTrade,
        maximumTrade: listingEditForm.maximumTrade || listingEditForm.availableAmount,
        expirationHours: listingEditForm.expirationHours,
        notes: listingEditForm.notes,
        status: myListings.find((listing) => listing.id === editingListingId)?.status === "expired" ? "active" : undefined,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setSellerWorkspaceMessage(payload.error ?? safeErrorMessage("listing"));
      return;
    }
    setEditingListingId(null);
    setSellerWorkspaceMessage("Listing updated.");
    await Promise.all([refreshSellerWorkspace(), refreshMarketplaceListings()]);
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

  async function handleSellerRequestAction(requestId: string, nextStatus: "accepted" | "declined" | "usdt_sent") {
    const response = await fetch(`/api/alpha-exchange/purchase-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setSellerWorkspaceMessage(payload.error ?? safeErrorMessage("request"));
      return;
    }
    if (nextStatus === "accepted") setSellerWorkspaceMessage("Request accepted and trade created.");
    else if (nextStatus === "usdt_sent") setSellerWorkspaceMessage("USDT sent marked.");
    else setSellerWorkspaceMessage("Request declined.");
    await Promise.all([refreshSellerWorkspace(), refreshMarketplaceListings()]);
  }

  async function handleBuyerTradeStatus(requestId: string, nextStatus: "payment_sent" | "completed" | "cancelled") {
    const response = await fetch(`/api/alpha-exchange/purchase-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setStatusMessage(payload.error ?? safeErrorMessage("request"));
      return;
    }
    setStatusMessage(
      nextStatus === "payment_sent"
        ? "Payment sent confirmed."
        : nextStatus === "completed"
          ? "Trade completed. Review window is open."
          : "Request cancelled.",
    );
    await Promise.all([refreshSellerWorkspace(), refreshMarketplaceListings()]);
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

  async function handleSellerSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/alpha-exchange/seller-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: sellerSettings.fullName,
        whatsappNumber: sellerSettings.whatsappNumber,
        preferredNetworks: sellerSettings.preferredNetworks,
        profilePhotoUrl: sellerSettings.profilePhotoUrl,
        coverBannerUrl: sellerSettings.coverBannerUrl,
        languages: sellerSettings.languages,
        bio: sellerSettings.bio,
        tradingExperience: sellerSettings.tradingExperience,
        workingHours: sellerSettings.workingHours,
        preferredPaymentMethods: sellerSettings.preferredPaymentMethods,
        country: sellerSettings.country,
        city: sellerSettings.city,
        onlineStatus: sellerSettings.onlineStatus,
        availabilityStatus: sellerSettings.availabilityStatus,
      }),
    });
    const payload = (await response.json()) as {
      error?: string;
      profile?: {
        fullName: string;
        whatsappNumber: string;
        preferredNetworks: SupportedNetwork[];
        profilePhotoUrl: string;
        coverBannerUrl: string;
        languages: string[];
        bio: string;
        tradingExperience: string;
        workingHours: string;
        preferredPaymentMethods: string[];
        country: string;
        city: string;
        onlineStatus: "online" | "offline";
        availabilityStatus: SellerAvailabilityStatus;
      };
    };
    if (!response.ok || !payload.profile) {
      setSellerWorkspaceMessage(safeErrorMessage("settings"));
      return;
    }
    setSessionUser((prev) =>
      prev
        ? {
            ...prev,
            fullName: payload.profile!.fullName,
            whatsappNumber: payload.profile!.whatsappNumber,
            preferredNetworks: payload.profile!.preferredNetworks,
            profilePhotoUrl: payload.profile!.profilePhotoUrl,
            coverBannerUrl: payload.profile!.coverBannerUrl,
            languages: payload.profile!.languages,
            bio: payload.profile!.bio,
            tradingExperience: payload.profile!.tradingExperience,
            workingHours: payload.profile!.workingHours,
            preferredPaymentMethods: payload.profile!.preferredPaymentMethods,
            country: payload.profile!.country,
            city: payload.profile!.city,
            onlineStatus: payload.profile!.onlineStatus,
            availabilityStatus: payload.profile!.availabilityStatus,
          }
        : prev,
    );
    setSellerWorkspaceMessage("Seller profile updated.");
    await Promise.all([refreshSellerWorkspace(), refreshMarketplaceListings()]);
  }

  async function handleSellerPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/alpha-exchange/seller-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: sellerSettings.currentPassword,
        newPassword: sellerSettings.newPassword,
      }),
    });
    await response.json();
    if (!response.ok) {
      setSellerWorkspaceMessage(safeErrorMessage("password"));
      return;
    }
    setSellerSettings((prev) => ({ ...prev, currentPassword: "", newPassword: "" }));
    setSellerWorkspaceMessage("Password updated.");
  }

  const unreadNotificationsCount = notifications.filter((item) => !item.isRead).length;

  const notificationCenterCard = sessionUser ? (
    <Card className="border-white/10 bg-[#0B0B0B]/90">
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <BellRing className="h-4 w-4 text-[#C9A227]" />
          Notification Center
          <span className="rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2 py-0.5 text-[11px] text-[#C9A227]">{unreadNotificationsCount} unread</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder="Search notifications..." value={notificationQuery} onChange={(event) => setNotificationQuery(event.target.value)} />
          <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={notificationCategory} onChange={(event) => setNotificationCategory(event.target.value as typeof notificationCategory)}>
            <option value="all">Category: All</option>
            <option value="trade">Trade</option>
            <option value="listing">Listing</option>
            <option value="application">Application</option>
            <option value="trust">Trust</option>
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
        <div className="space-y-2">
          {notificationsLoading ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9CA3AF]">Loading notifications...</div>
          ) : null}
          {!notificationsLoading && notifications.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9CA3AF]">No notifications found.</div>
          ) : null}
          {notifications.slice(0, 10).map((notification) => (
            <div key={notification.id} className={`rounded-xl border p-3 text-xs ${notification.isRead ? "border-white/10 bg-black/20 text-[#9CA3AF]" : "border-[#C9A227]/35 bg-[#C9A227]/10 text-[#F3F4F6]"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-white">{notification.title}</p>
                  <p className="mt-1">{notification.message}</p>
                  <p className="mt-1 text-[11px]">{new Date(notification.createdAt).toLocaleString("en-IL")}</p>
                  {notification.relatedHref ? <a href={notification.relatedHref} className="mt-1 inline-block text-[#C9A227]">Open related</a> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" size="sm" variant="secondary" onClick={() => void handleNotificationReadState(notification.id, !notification.isRead)}>
                    {notification.isRead ? "Unread" : "Read"}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void handleDeleteNotification(notification.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  ) : null;

  const betaChannelsCard = sessionUser ? (
    <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
      <CardHeader>
        <CardTitle>Private Beta Center</CardTitle>
        <CardDescription>Founding badges, beta announcements, and product feedback.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {sessionUser.isFoundingMember ? <span className="rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2.5 py-1 text-xs text-[#C9A227]">Founding Member</span> : null}
            {sessionUser.isFoundingSeller ? <span className="rounded-full border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 px-2.5 py-1 text-xs text-[#93C5FD]">Founding Seller</span> : null}
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Announcements</p>
            {!betaAnnouncements.length ? <p className="text-xs text-[#9CA3AF]">No active announcements.</p> : null}
            {betaAnnouncements.slice(0, 6).map((announcement) => (
              <div key={announcement.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                <p className="font-medium text-white">{announcement.title}</p>
                <p className="mt-1">{announcement.message}</p>
                <p className="mt-1 text-[#9CA3AF]">{announcement.type.replaceAll("_", " ")} • {new Date(announcement.createdAt).toLocaleString("en-IL")}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <form className="grid gap-2" onSubmit={handleSubmitBetaFeedback}>
            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Submit Beta Feedback</p>
            <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={betaFeedbackCategory} onChange={(event) => setBetaFeedbackCategory(event.target.value as BetaFeedbackCategory)}>
              <option value="bug">Bug</option>
              <option value="suggestion">Suggestion</option>
              <option value="confusing_ux">Confusing UX</option>
              <option value="feature_request">Feature Request</option>
              <option value="performance">Performance</option>
              <option value="other">Other</option>
            </select>
            <Textarea placeholder="Share your feedback..." value={betaFeedbackMessage} onChange={(event) => setBetaFeedbackMessage(event.target.value)} />
            <Button type="submit" size="sm" variant="secondary">Submit Feedback</Button>
          </form>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">My Feedback</p>
            {!myBetaFeedback.length ? <p className="text-xs text-[#9CA3AF]">No feedback submitted yet.</p> : null}
            {myBetaFeedback.slice(0, 4).map((entry) => (
              <div key={entry.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                <p className="font-medium text-white">{betaFeedbackCategoryLabel(entry.category)} • {entry.status}</p>
                <p className="mt-1">{entry.message}</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  ) : null;

  return (
    <section className="section-container page-shell">
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
          <h1 className="mt-4 text-4xl font-semibold leading-tight md:text-6xl md:leading-[1.1]">Alpha Exchange</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-white/85 md:text-lg">
            {isAr
              ? "سوق بريميوم يربط بين البائعين والمشترين الراغبين في تبادل USDT. يقوم Alpha Traders بتنسيق كل معاملة عبر عملية شفافة واحترافية قائمة على المجتمع، مع رسوم خدمة بسيطة 1%."
              : "A premium marketplace connecting buyers and sellers looking to exchange USDT. Alpha Traders coordinates every transaction through a transparent, professional, and community-driven process while charging a simple 1% service fee."}
          </p>
          <div className={`mt-7 flex flex-wrap gap-3 ${isAr ? "md:justify-end" : ""}`}>
            <a href="#marketplace" className={buttonVariants()}>
              {isAr ? "ابدأ صفقة" : "Start a Trade"}
            </a>
            <a href="#how-it-works" className={buttonVariants({ variant: "secondary" })}>
              {isAr ? "تعرّف على آلية العمل" : "Learn How It Works"}
            </a>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <ExchangeMarketStats
          activeSellers={isLoadingListings ? undefined : marketStats.activeSellers}
          onlineNow={isLoadingListings ? undefined : marketStats.onlineNow}
          averageResponse={isLoadingListings ? undefined : marketStats.averageResponse}
          openListings={isLoadingListings ? undefined : marketStats.openListings}
        />
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
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#C9A227]">{isAr ? "الأمان أولاً" : "Security First"}</p>
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
              <Card key={item.title} className="border-white/10 bg-[#0B0B0B]/90 transition duration-300 hover:-translate-y-1 hover:border-[#C9A227]/30 hover:shadow-[0_12px_36px_rgba(201,162,39,0.10)]">
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

      {workspaceError ? (
        <Card className="mt-6 border-amber-500/30 bg-[#0B0B0B]/95">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-[#FDE68A]">
            <AlertTriangle className="h-4 w-4" />
            <span>{workspaceError}</span>
          </CardContent>
        </Card>
      ) : null}

      <div id="how-it-works" className="mt-12">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#C9A227]">{isAr ? "خطوة بخطوة" : "Step by Step"}</p>
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

      <div id="marketplace" className="mt-12">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#C9A227]">{isAr ? "متاح الآن" : "Available Now"}</p>
        <h2 className="text-2xl font-semibold md:text-3xl">{isAr ? "السوق المباشر" : "Live Marketplace"}</h2>

        <Card className="mt-5 border-white/10 bg-[#0B0B0B]/90">
          <CardContent className="p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]">
                <option value="all">{isAr ? "Currency: الكل" : "Currency: All"}</option>
                {Array.from(new Set(listings.map((listing) => listing.currency))).sort().map((currency) => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
              <select value={paymentMethodFilter} onChange={(event) => setPaymentMethodFilter(event.target.value)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]">
                <option value="all">{isAr ? "Payment: الكل" : "Payment: All"}</option>
                {Array.from(new Set(listings.flatMap((listing) => listing.paymentMethods?.length ? listing.paymentMethods : [listing.paymentMethod]))).sort().map((method) => (
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
                <option value="trust-desc">{isAr ? "Sort: أفضل ثقة" : "Sort: Best Trust Score"}</option>
                <option value="price-asc">{isAr ? "Sort: أقل سعر" : "Sort: Lowest Price"}</option>
                <option value="amount-desc">{isAr ? "Sort: أعلى كمية USDT" : "Sort: Highest Available USDT"}</option>
                <option value="trades-desc">{isAr ? "Sort: أكثر صفقات مكتملة" : "Sort: Most Completed Trades"}</option>
                <option value="rating-desc">{isAr ? "Sort: أعلى تقييم" : "Sort: Highest Rating"}</option>
                <option value="response-fast">{isAr ? "Sort: أسرع استجابة" : "Sort: Fastest Response Time"}</option>
                <option value="newest">{isAr ? "Sort: الأحدث" : "Sort: Newest Listing"}</option>
              </select>
              <Input placeholder={isAr ? "Min Amount" : "Min Amount"} value={minAmountFilter} onChange={(event) => setMinAmountFilter(event.target.value)} />
              <Input placeholder={isAr ? "Max Amount" : "Max Amount"} value={maxAmountFilter} onChange={(event) => setMaxAmountFilter(event.target.value)} />
              <Input placeholder={isAr ? "Min Price" : "Min Price"} value={minPriceFilter} onChange={(event) => setMinPriceFilter(event.target.value)} />
              <Input placeholder={isAr ? "Max Price" : "Max Price"} value={maxPriceFilter} onChange={(event) => setMaxPriceFilter(event.target.value)} />
              <Input placeholder={isAr ? "Min Trust Score" : "Min Trust Score"} value={trustScoreFilter} onChange={(event) => setTrustScoreFilter(event.target.value)} />
              <Button type="button" className="w-full" variant={onlineOnlyFilter ? "default" : "secondary"} onClick={() => setOnlineOnlyFilter((prev) => !prev)}>
                <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${onlineOnlyFilter ? "bg-[#22C55E]" : "bg-[#9CA3AF]"}`} />
                {isAr ? (onlineOnlyFilter ? "المتاحون الآن فقط" : "إظهار المتاحين الآن") : (onlineOnlyFilter ? "Online Sellers Only" : "Show Online Sellers Only")}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCurrencyFilter("all");
                  setPaymentMethodFilter("all");
                  setNetworkFilter("all");
                  setMinAmountFilter("");
                  setMaxAmountFilter("");
                  setMinPriceFilter("");
                  setMaxPriceFilter("");
                  setTrustScoreFilter("");
                  setOnlineOnlyFilter(false);
                  setSortBy("trust-desc");
                }}
              >
                {isAr ? "إعادة تعيين الفلاتر" : "Reset Filters"}
              </Button>
              {filteredListings.length !== listings.length ? (
                <p className="text-xs text-[#9CA3AF]">
                  {isAr ? `${filteredListings.length} نتيجة` : `${filteredListings.length} of ${listings.length} listings`}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {isLoadingListings
            ? Array.from({ length: 4 }).map((_, index) => (
                <Card key={`skeleton-${index}`} className="border-white/10 bg-[#0B0B0B]/90">
                  <CardContent className="space-y-4 p-6">
                    {/* avatar + name skeleton */}
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 animate-pulse rounded-full bg-white/10" />
                      <div className="space-y-1.5">
                        <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
                        <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
                      </div>
                    </div>
                    {/* hero stats skeleton */}
                    <div className="h-16 w-full animate-pulse rounded-xl bg-white/10" />
                    {/* trust bar skeleton */}
                    <div className="space-y-1.5">
                      <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
                      <div className="h-1.5 w-full animate-pulse rounded-full bg-white/10" />
                    </div>
                    {/* info grid skeleton */}
                    <div className="grid grid-cols-2 gap-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-3 animate-pulse rounded bg-white/10" />
                      ))}
                    </div>
                    {/* button skeleton */}
                    <div className="h-11 w-full animate-pulse rounded-full bg-white/10" />
                  </CardContent>
                </Card>
              ))
            : filteredListings.map((listing) => (
                <Card key={listing.id} className="group border-white/10 bg-[#0B0B0B]/90 transition duration-300 hover:-translate-y-1 hover:border-[#C9A227]/30 hover:shadow-[0_22px_60px_rgba(0,0,0,0.35)]">
                  <CardHeader>
                    <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${isAr ? "sm:flex-row-reverse" : ""}`}>
                      <div className={`flex items-start gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                        {listing.sellerProfile?.profilePhotoUrl ? (
                          <Image
                            src={listing.sellerProfile.profilePhotoUrl}
                            alt={`${safeText(listing.sellerDisplayName, "Seller")} profile`}
                            width={44}
                            height={44}
                            unoptimized
                            className="h-11 w-11 rounded-full border border-white/15 object-cover"
                          />
                        ) : (
                          <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-sm font-semibold text-[#D1D5DB]">
                            {safeText(listing.sellerDisplayName, "Seller")
                              .split(" ")
                              .map((part) => part[0])
                              .join("")
                              .slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <CardTitle className="text-lg">{safeText(listing.sellerDisplayName, "Seller")}</CardTitle>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">
                            {sellerLevelLabel(listing.sellerReputation?.level)} Seller
                            {listing.sellerProfile?.onlineStatus === "online" ? " • Online" : " • Offline"}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <RoleBadge variant="approved_seller" />
                            {listing.sellerProfile?.isFoundingSeller ? (
                              <span className="rounded-full border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 px-2 py-0.5 text-[11px] text-[#93C5FD]">Founding Seller</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <span className="rounded-full border border-[#22C55E]/25 bg-[#22C55E]/10 px-3 py-1 text-xs text-[#86EFAC]">{isAr ? "متاح" : "Available"}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-0">
                    {/* Hero: Price + USDT Amount */}
                    <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "السعر / USDT" : "Price / USDT"}</p>
                        <p className="mt-0.5 text-lg font-semibold text-[#C9A227]">{safeText(listing.price)} <span className="text-sm font-normal text-[#9CA3AF]">{listing.currency}</span></p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "USDT متاح" : "USDT Available"}</p>
                        <p className="mt-0.5 text-lg font-semibold text-white">{safeText(listing.availableAmount)}</p>
                      </div>
                    </div>

                    {/* Trust Score visual bar */}
                    <div>
                      <div className={`flex items-center justify-between text-xs ${isAr ? "flex-row-reverse" : ""}`}>
                        <span className="text-[#9CA3AF]">{isAr ? "درجة الثقة" : "Trust Score"}</span>
                        <span className="font-semibold text-white">{(listing.sellerReputation?.trustScore ?? 0).toFixed(1)}<span className="text-[#9CA3AF]">/10</span></span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#C9A227] to-[#E8C547] transition-all duration-500"
                          style={{ width: `${Math.min((listing.sellerReputation?.trustScore ?? 0) * 10, 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Compact info grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <p className="text-[#9CA3AF]">{isAr ? "صفقات مكتملة" : "Trades"}: <span className="text-white">{(listing.sellerReputation?.completedTrades ?? 0).toLocaleString("en-IL")}</span></p>
                      <p className="text-[#9CA3AF]">{isAr ? "وقت الاستجابة" : "Response"}: <span className="text-white">{safeText(listing.responseTime, "5 min")}</span></p>
                      <p className="text-[#9CA3AF]">{isAr ? "الدفع" : "Payment"}: <span className="truncate text-white">{(listing.paymentMethods?.length ? listing.paymentMethods : [listing.paymentMethod]).slice(0, 2).join(", ")}</span></p>
                      <p className="text-[#9CA3AF]">{isAr ? "الشبكة" : "Network"}: <span className="text-white">{safeText(listing.network)}</span></p>
                      <p className="text-[#9CA3AF]">{isAr ? "حد التداول" : "Min/Max"}: <span className="text-white">{safeText(listing.minimumTrade, "—")} / {safeText(listing.maximumTrade, "—")}</span></p>
                      <p className="text-[#9CA3AF]">{isAr ? "آخر نشاط" : "Last active"}: <span className="text-white">{formatRelativeMinutesLabel(listing.sellerProfile?.lastActiveAt)}</span></p>
                    </div>

                    {/* Badges */}
                    {(listing.sellerReputation?.badges ?? []).length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(listing.sellerReputation?.badges ?? []).slice(0, 2).map((badge) => (
                          <span key={`${listing.id}-${badge}`} className="rounded-full border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 px-2 py-0.5 text-[11px] text-[#93C5FD]">
                            {sellerBadgeLabel(badge)}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {/* CTA */}
                    <Button className="w-full transition-transform group-hover:scale-[1.01]" onClick={() => openListingModal(listing)} aria-label={`Open seller profile for ${safeText(listing.sellerDisplayName, "seller")}`}>
                      {isAr ? "ملف البائع" : "View Seller Profile"}
                    </Button>
                  </CardContent>
                </Card>
              ))}
        </div>

        {!isLoadingListings && filteredListings.length === 0 ? (
          <Card className="mt-4 border-white/10 bg-[#0B0B0B]/90">
            <CardContent className="p-8 text-center">
              <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[#C9A227]/20 bg-[#C9A227]/10">
                <Store className="h-6 w-6 text-[#C9A227]" />
              </div>
              <p className="text-base font-semibold text-white">
                {isAr ? "لا توجد عروض USDT نشطة متاحة الآن." : "No active USDT listings right now"}
              </p>
              <p className="mt-2 text-sm text-[#9CA3AF]">
                {isAr ? "يمكن للبائعين المعتمدين إنشاء عرض من لوحة البائع." : "Approved sellers can create a listing from their Seller Dashboard."}
              </p>
              {isApprovedSeller ? (
                <Button type="button" className="mt-5" onClick={() => router.push("/dashboard/seller")}>
                  {isAr ? "إنشاء عرض" : "Create Listing"}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="mt-12">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#C9A227]">{isAr ? "المزايا" : "Why Choose Us"}</p>
        <h2 className="text-2xl font-semibold md:text-3xl">{isAr ? "لماذا Alpha Exchange" : "Why Alpha Exchange"}</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="h-full border-white/10 bg-[#0B0B0B]/90 transition duration-300 hover:-translate-y-1 hover:border-[#C9A227]/30 hover:shadow-[0_12px_36px_rgba(201,162,39,0.10)]">
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

      <div className="mt-12 grid gap-6 xl:grid-cols-2">
        <Card className="border-white/10 bg-[#0B0B0B]/90">
          <CardHeader>
            <CardTitle>{isAr ? "Become an Approved Seller" : "Become an Approved Seller"}</CardTitle>
            <CardDescription>
              {isAr ? "التقديم كبائع يتم مراجعته يدويًا قبل منح صلاحية النشر." : "Seller access is granted only after manual review and approval."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-[#9CA3AF]">
                <span>{isAr ? "Application" : "Application"}</span>
                <span>↓</span>
                <span>{isAr ? "Review" : "Review"}</span>
                <span>↓</span>
                <span>{isAr ? "Approval" : "Approval"}</span>
              </div>
              <p className="mt-3 text-sm text-[#D1D5DB]">
                {isAr ? "Current Status:" : "Current Status:"}{" "}
                <span className="font-medium text-[#C9A227]">
                  {sellerApplication?.status === "approved"
                    ? "Approved"
                    : sellerApplication?.status === "rejected"
                      ? "Rejected"
                      : "Pending Review"}
                </span>
              </p>
            </div>

            <form className="grid gap-3" onSubmit={handleSellerApplicationSubmit}>
              <Input placeholder={isAr ? "الاسم الكامل" : "Full Name"} value={sellerForm.fullName} onChange={(event) => setSellerForm((prev) => ({ ...prev, fullName: event.target.value }))} />
              <Input placeholder={isAr ? "البريد الإلكتروني" : "Email"} type="email" value={sellerForm.email} onChange={(event) => setSellerForm((prev) => ({ ...prev, email: event.target.value }))} />
              <Input placeholder={isAr ? "رقم الواتساب" : "WhatsApp Number"} value={sellerForm.whatsappNumber} onChange={(event) => setSellerForm((prev) => ({ ...prev, whatsappNumber: event.target.value }))} />
              <select
                value={sellerForm.preferredNetwork}
                onChange={(event) => setSellerForm((prev) => ({ ...prev, preferredNetwork: event.target.value }))}
                className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]"
              >
                <option>TRC20</option>
                <option>ERC20</option>
                <option>BEP20</option>
                <option>SOL</option>
              </select>
              <Input placeholder={isAr ? "حجم التداول الشهري المتوقع" : "Expected Monthly Trading Volume"} value={sellerForm.expectedMonthlyTradingVolume} onChange={(event) => setSellerForm((prev) => ({ ...prev, expectedMonthlyTradingVolume: event.target.value }))} />
              <Textarea placeholder={isAr ? "ملاحظات إضافية" : "Additional Notes"} value={sellerForm.additionalNotes} onChange={(event) => setSellerForm((prev) => ({ ...prev, additionalNotes: event.target.value }))} />
              <Button type="submit">{isAr ? "قدّم طلب الاعتماد" : "Apply for Approval"}</Button>
            </form>
            {applicationSubmitted ? (
              <div className="mt-4 rounded-xl border border-[#C9A227]/30 bg-[#C9A227]/10 p-4 text-sm">
                <p className="font-medium text-white">{isAr ? "تم إرسال الطلب" : "Application Submitted"}</p>
                <p className="mt-1 text-[#D1D5DB]">
                  {isAr
                    ? "طلبك قيد المراجعة حاليًا من فريق Alpha Traders."
                    : "Your application is currently under review by Alpha Traders."}
                </p>
              </div>
            ) : null}
            {statusMessage ? (
              <Card className="mt-3 border-amber-500/30 bg-black/30">
                <CardContent className="flex items-center gap-2 p-3 text-xs text-[#FDE68A]">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>{statusMessage}</span>
                </CardContent>
              </Card>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-[#0B0B0B]/90">
          <CardHeader>
            <CardTitle>{isAr ? "Find an Approved Seller" : "Find an Approved Seller"}</CardTitle>
            <CardDescription>
              {isAr
                ? "أخبرنا بالكمية التي تحتاجها من USDT وسيساعدك فريق Alpha Traders على التواصل مع بائع معتمد متاح."
                : "Tell us how much USDT you need and Alpha Traders will help connect you with an available Approved Seller."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <Input placeholder={isAr ? "الكمية المطلوبة" : "Desired Amount"} type="number" min="0" step="any" />
              <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-1 focus-visible:ring-offset-[#050505]">
                <option>TRC20</option>
                <option>ERC20</option>
                <option>BEP20</option>
                <option>SOL</option>
              </select>
              <Input placeholder={isAr ? "رقم الواتساب" : "WhatsApp Number"} />
              <Textarea placeholder={isAr ? "ملاحظات إضافية" : "Additional Notes"} />
              <Button type="submit">{isAr ? "ابحث عن البائعين المتاحين" : "Find Available Sellers"}</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {isApprovedSeller ? (
        <div className="mt-8 space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {isLoadingListings
              ? Array.from({ length: 6 }).map((_, index) => (
                  <Card key={`seller-stat-skeleton-${index}`} className="border-white/10 bg-[#0B0B0B]/90">
                    <CardContent className="space-y-3 p-6">
                      <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
                      <div className="h-8 w-36 animate-pulse rounded bg-white/10" />
                    </CardContent>
                  </Card>
                ))
              : null}
            {!isLoadingListings
              ? [
              { label: "Profile Views", value: sellerOverviewStats.profileViews.toLocaleString("en-IL"), icon: Users },
              { label: "Listing Views", value: sellerOverviewStats.listingViews.toLocaleString("en-IL"), icon: TrendingUp },
              { label: "Trade Requests", value: sellerOverviewStats.tradeRequests.toLocaleString("en-IL"), icon: MessageCircle },
              { label: "Completed Trades", value: sellerOverviewStats.completedTrades.toLocaleString("en-IL"), icon: Trophy },
              { label: "Success Rate", value: `${sellerOverviewStats.successRate.toFixed(1)}%`, icon: ShieldCheck },
              { label: "Monthly Growth", value: `${sellerOverviewStats.monthlyGrowth >= 0 ? "+" : ""}${sellerOverviewStats.monthlyGrowth.toFixed(1)}%`, icon: TrendingUp },
              { label: "Estimated Commission Paid", value: `₪${sellerOverviewStats.estimatedCommissionPaid.toFixed(2)}`, icon: BadgePercent },
              { label: "Revenue Generated", value: `₪${sellerOverviewStats.revenueGenerated.toFixed(2)}`, icon: WalletCards },
              { label: "Repeat Buyers", value: sellerOverviewStats.repeatBuyers.toLocaleString("en-IL"), icon: Users },
              { label: "Average Trade Size", value: `₪${sellerOverviewStats.averageTradeSize.toFixed(2)}`, icon: HandCoins },
              { label: "Response Time", value: sellerOverviewStats.averageResponseTime, icon: Clock3 },
              { label: "Seller Level", value: sellerLevelLabel(sellerOverviewStats.reputation?.level), icon: Star },
            ].map((stat) => (
              <Card key={stat.label} className="border-white/10 bg-[#0B0B0B]/90">
                <CardHeader className="pb-2">
                  <CardDescription className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em]">
                    <stat.icon className="h-3.5 w-3.5 text-[#C9A227]" />
                    {stat.label}
                  </CardDescription>
                  <CardTitle className="text-2xl">{stat.value}</CardTitle>
                </CardHeader>
              </Card>
            )) : null}
          </div>

          <div ref={createListingFormRef}>
            <Card className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle>{isAr ? "إنشاء عرض جديد" : "Create Listing"}</CardTitle>
                <CardDescription>
                  {isAr ? "أنشئ عرضًا مباشرًا مع حد أقصى عرضين نشطين في نفس الوقت." : "Create a live listing with a maximum of 2 open listings at the same time."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {listingWorkspaceSummary ? (
                  <div className={`rounded-2xl border p-3 text-sm ${listingWorkspaceSummary.canCreateListing ? "border-[#6CAEFF]/20 bg-[#6CAEFF]/8 text-[#D1D5DB]" : "border-[#C9A227]/25 bg-[#C9A227]/10 text-[#FDE68A]"}`}>
                    <p>
                      Open listing slots: <span className="text-white">{listingWorkspaceSummary.openListingCount}/{listingWorkspaceSummary.activeListingLimit}</span>
                    </p>
                    <p>
                      Trades in progress: <span className="text-white">{listingWorkspaceSummary.openTradeCount}</span>
                      {" • "}
                      Pending commissions: <span className="text-white">{listingWorkspaceSummary.pendingCommissionCount}</span>
                    </p>
                    {listingWorkspaceSummary.blockedReason ? <p className="mt-1 text-[#FDE68A]">{listingWorkspaceSummary.blockedReason}</p> : null}
                  </div>
                ) : null}
                <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSellerListingCreateSubmit}>
                  <Input placeholder="Available Amount" value={listingCreateForm.availableAmount} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, availableAmount: event.target.value }))} />
                  <Input placeholder="Price" value={listingCreateForm.price} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, price: event.target.value }))} />
                  <Input placeholder="Currency (e.g. ILS)" value={listingCreateForm.currency} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, currency: event.target.value }))} />
                  <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={listingCreateForm.network} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, network: event.target.value as SupportedNetwork }))}>
                    <option value="TRC20">TRC20</option>
                    <option value="ERC20">ERC20</option>
                    <option value="BEP20">BEP20</option>
                    <option value="SOL">SOL</option>
                  </select>
                  <Input placeholder="Payment Methods (comma separated)" value={listingCreateForm.paymentMethods} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, paymentMethods: event.target.value }))} />
                  <Input placeholder="Minimum Trade" value={listingCreateForm.minimumTrade} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, minimumTrade: event.target.value }))} />
                  <Input placeholder="Maximum Trade" value={listingCreateForm.maximumTrade} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, maximumTrade: event.target.value }))} />
                  <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={listingCreateForm.expirationHours} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, expirationHours: event.target.value }))}>
                    {LISTING_EXPIRATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>Expires in {option.label}</option>
                    ))}
                  </select>
                  <Input placeholder="Response Time (e.g. 5 min)" value={listingCreateForm.responseTime} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, responseTime: event.target.value }))} />
                  <Input className="md:col-span-2" placeholder="Photo URLs (comma separated)" value={listingCreateForm.photos} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, photos: event.target.value }))} />
                  <Textarea className="md:col-span-2" placeholder="Optional Notes" value={listingCreateForm.notes} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, notes: event.target.value }))} />
                  <Textarea className="md:col-span-2" placeholder="Seller Description" value={listingCreateForm.sellerDescription} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, sellerDescription: event.target.value }))} />
                  <div className="md:col-span-2">
                    <Button type="submit">Create Live Listing</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          <Card className="border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>{isAr ? "قائمتي" : "My Listings"}</CardTitle>
              <CardDescription>{isAr ? "إدارة جميع عروضك كبائع معتمد." : "Manage all of your approved seller listings."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!isLoadingListings && myListings.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center">
                  <Store className="mx-auto h-5 w-5 text-[#C9A227]" />
                  <p className="mt-2 text-sm font-medium text-white">{isAr ? "لا توجد عروض بعد" : "No Listings Yet"}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "أنشئ أول عرض لتظهر للمشترين المعتمدين." : "Create your first listing to start receiving buyer requests."}</p>
                  <Button type="button" size="sm" className="mt-3 w-full sm:w-auto" onClick={openCreateListingFlow}>
                    {isAr ? "إنشاء عرض" : "Create Listing"}
                  </Button>
                </div>
              ) : null}
              {myListings.map((listing) => {
                const requestsCount = sellerRequests.filter((request) => request.listingId === listing.id).length;
                const views = 120 + String(listing.id ?? "").split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) % 900;
                const isLockedListing = listing.status === "matched" || listing.status === "in_trade";
                return (
                  <div key={listing.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="grid gap-2 text-sm md:grid-cols-4">
                      <p>Status: <span className="text-white">{listingStatusLabel(listing.status)}</span></p>
                      <p>Available Amount: <span className="text-white">{safeText(listing.availableAmount)}</span></p>
                      <p>Original Amount: <span className="text-white">{safeText(listing.originalAmount)}</span></p>
                      <p>Price: <span className="text-white">{safeText(listing.price)}</span></p>
                      <p>Network: <span className="text-white">{safeText(listing.network)}</span></p>
                      <p>Views: <span className="text-white">{views}</span></p>
                      <p>Purchase Requests: <span className="text-white">{requestsCount}</span></p>
                      <p>Created Date: <span className="text-white">{new Date(listing.createdAt).toLocaleDateString("en-IL")}</span></p>
                    </div>
                    {isLockedListing ? <p className="mt-2 text-xs text-[#FDE68A]">This listing is locked by an active trade. Editing, pausing, and closing are unavailable until the trade finishes.</p> : null}
                    {listing.status === "expired" ? <p className="mt-2 text-xs text-[#FDE68A]">This listing expired and is hidden from buyers until you renew it.</p> : null}
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={isLockedListing || listing.status === "completed" || listing.status === "closed" || listing.status === "cancelled"}
                        onClick={() => {
                          setEditingListingId(listing.id);
                          setListingEditForm({
                            availableAmount: listing.availableAmount,
                            price: listing.price,
                            currency: listing.currency,
                            network: listing.network,
                            paymentMethods: (listing.paymentMethods?.length ? listing.paymentMethods : [listing.paymentMethod]).join(", "),
                            minimumTrade: listing.minimumTrade ?? "0",
                            maximumTrade: listing.maximumTrade ?? listing.availableAmount,
                            expirationHours: "24",
                            notes: listing.notes ?? "",
                          });
                        }}
                      >
                        <Edit3 className="h-4 w-4" />
                        Edit
                      </Button>
                      {listing.status === "expired" ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => handleSellerListingRenew(listing.id)}>
                          <PlayCircle className="h-4 w-4" />
                          Renew
                        </Button>
                      ) : listing.status === "paused" ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => handleSellerListingStatus(listing, "active")}>
                          <PlayCircle className="h-4 w-4" />
                          Resume
                        </Button>
                      ) : listing.status === "active" ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => handleSellerListingStatus(listing, "paused")}>
                          <PauseCircle className="h-4 w-4" />
                          Pause
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="secondary" disabled={isLockedListing || listing.status === "completed" || listing.status === "closed" || listing.status === "cancelled"} onClick={() => handleSellerListingDelete(listing.id)}>
                        <Trash2 className="h-4 w-4" />
                        Close Listing
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (listingWorkspaceSummary?.blockedReason) {
                            setSellerWorkspaceMessage(listingWorkspaceSummary.blockedReason);
                            return;
                          }
                          void handleSellerListingDuplicate(listing);
                        }}
                      >
                        <Copy className="h-4 w-4" />
                        Duplicate Listing
                      </Button>
                    </div>
                    {editingListingId === listing.id ? (
                      <form className="mt-3 grid gap-2 md:grid-cols-4" onSubmit={handleSellerListingEditSubmit}>
                        <Input value={listingEditForm.availableAmount} onChange={(event) => setListingEditForm((prev) => ({ ...prev, availableAmount: event.target.value }))} placeholder="Available Amount" />
                        <Input value={listingEditForm.price} onChange={(event) => setListingEditForm((prev) => ({ ...prev, price: event.target.value }))} placeholder="Price" />
                        <Input value={listingEditForm.currency} onChange={(event) => setListingEditForm((prev) => ({ ...prev, currency: event.target.value }))} placeholder="Currency" />
                        <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={listingEditForm.network} onChange={(event) => setListingEditForm((prev) => ({ ...prev, network: event.target.value as SupportedNetwork }))}>
                          <option value="TRC20">TRC20</option>
                          <option value="ERC20">ERC20</option>
                          <option value="BEP20">BEP20</option>
                          <option value="SOL">SOL</option>
                        </select>
                        <Input value={listingEditForm.minimumTrade} onChange={(event) => setListingEditForm((prev) => ({ ...prev, minimumTrade: event.target.value }))} placeholder="Minimum Trade" />
                        <Input value={listingEditForm.maximumTrade} onChange={(event) => setListingEditForm((prev) => ({ ...prev, maximumTrade: event.target.value }))} placeholder="Maximum Trade" />
                        <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={listingEditForm.expirationHours} onChange={(event) => setListingEditForm((prev) => ({ ...prev, expirationHours: event.target.value }))}>
                          {LISTING_EXPIRATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>Expires in {option.label}</option>
                          ))}
                        </select>
                        <Input className="md:col-span-2" value={listingEditForm.paymentMethods} onChange={(event) => setListingEditForm((prev) => ({ ...prev, paymentMethods: event.target.value }))} placeholder="Payment Methods (comma separated)" />
                        <Input className="md:col-span-2" value={listingEditForm.notes} onChange={(event) => setListingEditForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Optional Notes" />
                        <div className="md:col-span-4 flex gap-2">
                          <Button type="submit" size="sm">Save</Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setEditingListingId(null)}>Cancel</Button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[#0B0B0B]/90">
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
                  <option value="usdt_sent">USDT Sent</option>
                  <option value="review_open">Review Open</option>
                  <option value="declined">Declined</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              {!isLoadingListings && sellerRequests.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center">
                  <MessageCircle className="mx-auto h-5 w-5 text-[#C9A227]" />
                  <p className="mt-2 text-sm font-medium text-white">{isAr ? "لا توجد طلبات شراء" : "No Purchase Requests"}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "ستظهر طلبات المشترين هنا عند وصولها." : "Incoming buyer requests will appear here."}</p>
                </div>
              ) : null}
              {filteredSellerRequests.map((request) => {
                return (
                  <div key={request.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="grid gap-2 text-sm md:grid-cols-3">
                      <p>Trade ID: <span className="text-white">{request.tradeId ?? "Pending Creation"}</span></p>
                      <p>Buyer Name: <span className="text-white">{request.buyerName}</span></p>
                      <p>WhatsApp: <span className="text-white">{request.buyerWhatsapp}</span></p>
                      <p>USDT Amount: <span className="text-white">{request.usdtAmount}</span></p>
                      <p>Fiat Amount: <span className="text-white">{request.fiatAmount} {request.currency}</span></p>
                      <p>Network: <span className="text-white">{request.network}</span></p>
                      <p>Payment Method: <span className="text-white">{request.paymentMethod}</span></p>
                      <p>Listing: <span className="text-white">{request.listingId}</span></p>
                      <p>Submitted: <span className="text-white">{new Date(request.createdAt).toLocaleString("en-IL")}</span></p>
                      <p>Status: <span className="text-white">{tradeStatusLabel(request.status)}</span></p>
                      {request.completedAt ? <p>Completed: <span className="text-white">{new Date(request.completedAt).toLocaleString("en-IL")}</span></p> : null}
                      {request.reviewUnlockedAt ? <p>Review Unlocked: <span className="text-white">{new Date(request.reviewUnlockedAt).toLocaleString("en-IL")}</span></p> : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" size="sm" disabled={request.status !== "pending"} onClick={() => handleSellerRequestAction(request.id, "accepted")}>Accept</Button>
                      <Button type="button" size="sm" variant="secondary" disabled={request.status !== "pending"} onClick={() => handleSellerRequestAction(request.id, "declined")}>Decline</Button>
                      <Button type="button" size="sm" variant="secondary" disabled={request.status !== "payment_sent" || !request.sellerEvidence} onClick={() => handleSellerRequestAction(request.id, "usdt_sent")}>
                        Mark USDT Sent
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => handleMessageBuyer(request)}>
                        <MessageCircle className="h-4 w-4" />
                        Message Buyer
                      </Button>
                    </div>
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">
                        {isAr ? "حالة الصفقة اللحظية" : "Live Trade Status"}
                      </p>
                      <p className="mt-1 text-xs text-[#D1D5DB]">{nextTradeActionHint(request, isAr)}</p>
                      <div className="mt-3 space-y-2">
                        {TRADE_MILESTONES.map((step, index) => {
                          const rank = tradeProgressRank(request);
                          const terminal = request.status === "declined" || request.status === "cancelled";
                          const stepTimestamp = tradeMilestoneTimestamp(request, step.key);
                          const done = index <= rank || Boolean(stepTimestamp);
                          const current = !terminal && request.status !== "review_open" && index === Math.min(rank + 1, TRADE_MILESTONES.length - 1);
                          const reviewCurrent = !terminal && request.status === "review_open" && step.key === "review_unlocked";
                          return (
                            <div key={`${request.id}-${step.key}`} className="flex items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`inline-flex h-4 w-4 rounded-full border ${
                                    done ? "border-[#C9A227]/40 bg-[#C9A227]/25" : current || reviewCurrent ? "border-[#6CAEFF]/50 bg-[#6CAEFF]/25" : "border-white/15 bg-transparent"
                                  }`}
                                />
                                <span className={done || current || reviewCurrent ? "text-[#F3F4F6]" : "text-[#9CA3AF]"}>
                                  {isAr ? step.titleAr : step.titleEn}
                                </span>
                              </div>
                              <span className="text-[11px] text-[#9CA3AF]">
                                {stepTimestamp ? new Date(stepTimestamp).toLocaleTimeString("en-IL", { hour: "2-digit", minute: "2-digit" }) : done ? "✓" : current || reviewCurrent ? "•" : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
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
                        <Textarea placeholder="Respond to buyer review" value={sellerResponseDrafts[request.id] ?? ""} onChange={(event) => setSellerResponseDrafts((prev) => ({ ...prev, [request.id]: event.target.value }))} />
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
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle>{isAr ? "ملف البائع" : "Seller Profile"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-[#D1D5DB]">
                <div className="flex items-center gap-3">
                  {sessionUser?.profilePhotoUrl ? (
                    <Image src={sessionUser.profilePhotoUrl} alt={`${sessionUser.fullName} profile`} width={52} height={52} unoptimized className="h-13 w-13 rounded-full border border-white/15 object-cover" />
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
                <p>Availability: <span className="text-white capitalize">{sessionUser?.availabilityStatus ?? "available"}</span></p>
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

            {showLegacyNotificationCenter ? notificationCenterCard : null}
            {betaChannelsCard}

            <Card className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle>{isAr ? "الإعدادات" : "Settings"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoadingListings ? (
                  <div className="space-y-2">
                    <div className="h-10 animate-pulse rounded-xl bg-white/10" />
                    <div className="h-10 animate-pulse rounded-xl bg-white/10" />
                  </div>
                ) : null}
                <form className="grid gap-2" onSubmit={handleSellerSettingsSubmit}>
                  <Input placeholder="Profile" value={sellerSettings.fullName} onChange={(event) => setSellerSettings((prev) => ({ ...prev, fullName: event.target.value }))} />
                  <Input placeholder="WhatsApp" value={sellerSettings.whatsappNumber} onChange={(event) => setSellerSettings((prev) => ({ ...prev, whatsappNumber: event.target.value }))} />
                  <Input placeholder="Languages (comma separated)" value={sellerSettings.languages.join(", ")} onChange={(event) => setSellerSettings((prev) => ({ ...prev, languages: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} />
                  <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={sellerSettings.preferredNetworks[0] ?? "TRC20"} onChange={(event) => setSellerSettings((prev) => ({ ...prev, preferredNetworks: [event.target.value as SupportedNetwork] }))}>
                    <option value="TRC20">Preferred Network: TRC20</option>
                    <option value="ERC20">Preferred Network: ERC20</option>
                    <option value="BEP20">Preferred Network: BEP20</option>
                    <option value="SOL">Preferred Network: SOL</option>
                  </select>
                  <Input placeholder="Profile Photo URL" value={sellerSettings.profilePhotoUrl} onChange={(event) => setSellerSettings((prev) => ({ ...prev, profilePhotoUrl: event.target.value }))} />
                  <Input placeholder="Cover Banner URL" value={sellerSettings.coverBannerUrl} onChange={(event) => setSellerSettings((prev) => ({ ...prev, coverBannerUrl: event.target.value }))} />
                  <Textarea placeholder="Bio" value={sellerSettings.bio} onChange={(event) => setSellerSettings((prev) => ({ ...prev, bio: event.target.value }))} />
                  <Input placeholder="Trading Experience" value={sellerSettings.tradingExperience} onChange={(event) => setSellerSettings((prev) => ({ ...prev, tradingExperience: event.target.value }))} />
                  <Input placeholder="Working Hours" value={sellerSettings.workingHours} onChange={(event) => setSellerSettings((prev) => ({ ...prev, workingHours: event.target.value }))} />
                  <Input placeholder="Preferred Payment Methods (comma separated)" value={sellerSettings.preferredPaymentMethods.join(", ")} onChange={(event) => setSellerSettings((prev) => ({ ...prev, preferredPaymentMethods: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} />
                  <Input placeholder="Country" value={sellerSettings.country} onChange={(event) => setSellerSettings((prev) => ({ ...prev, country: event.target.value }))} />
                  <Input placeholder="City (optional)" value={sellerSettings.city} onChange={(event) => setSellerSettings((prev) => ({ ...prev, city: event.target.value }))} />
                  <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={sellerSettings.onlineStatus} onChange={(event) => setSellerSettings((prev) => ({ ...prev, onlineStatus: event.target.value as "online" | "offline" }))}>
                    <option value="online">Status: Online</option>
                    <option value="offline">Status: Offline</option>
                  </select>
                  <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={sellerSettings.availabilityStatus} onChange={(event) => setSellerSettings((prev) => ({ ...prev, availabilityStatus: event.target.value as SellerAvailabilityStatus }))}>
                    <option value="available">Availability: Available</option>
                    <option value="away">Availability: Away</option>
                    <option value="vacation">Availability: Vacation Mode</option>
                  </select>
                  {sellerSettings.availabilityStatus === "vacation" ? (
                    <p className="text-xs text-[#FDE68A]">Vacation Mode hides your active listings from buyers and blocks new matches until you switch back.</p>
                  ) : null}
                  <Button type="submit" size="sm">Save Profile</Button>
                </form>
                <form className="grid gap-2" onSubmit={handleSellerPasswordSubmit}>
                  <Input type="password" placeholder="Current Password" value={sellerSettings.currentPassword} onChange={(event) => setSellerSettings((prev) => ({ ...prev, currentPassword: event.target.value }))} />
                  <Input type="password" placeholder="New Password" value={sellerSettings.newPassword} onChange={(event) => setSellerSettings((prev) => ({ ...prev, newPassword: event.target.value }))} />
                  <Button type="submit" size="sm" variant="secondary">Update Password</Button>
                </form>
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
                  <div>
                    <Button type="submit" size="sm" variant="secondary">Save Notification Preferences</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
          <Card className="border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>Private Activity History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!activityHistory.length ? (
                <p className="text-xs text-[#9CA3AF]">No activity entries yet.</p>
              ) : (
                activityHistory.slice(0, 12).map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                    <p className="font-medium text-white">{entry.title}</p>
                    <p className="mt-1">{entry.details}</p>
                    <p className="mt-1 text-[#9CA3AF]">{new Date(entry.createdAt).toLocaleString("en-IL")}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
            {sellerWorkspaceMessage ? (
              <Card className="border-[#C9A227]/30 bg-[#C9A227]/10">
                <CardContent className="p-3 text-xs text-white">{sellerWorkspaceMessage}</CardContent>
              </Card>
            ) : null}
        </div>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Card className="border-white/10 bg-[#0B0B0B]/85">
            <CardHeader>
              <CardTitle>{isAr ? "بعد تسجيل الدخول" : "After Login"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-[#D1D5DB]">
              {menuItems.map((item) => (
                <p key={item}>• {item}</p>
              ))}
              <p className="pt-2 text-xs text-[#9CA3AF]">
                {isAr
                  ? `My Requests: ${myRequests.length} | My Listings: ${myListings.length}`
                  : `My Requests: ${myRequests.length} | My Listings: ${myListings.length}`}
              </p>
            </CardContent>
          </Card>
          <Card className="border-white/10 bg-[#0B0B0B]/85">
            <CardHeader>
              <CardTitle>{isAr ? "جلسة المستخدم" : "Session"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-[#D1D5DB]">
                {sessionUser ? sessionUser.fullName : (isAr ? "غير مسجل الدخول" : "Not logged in")}
              </p>
              {sessionUser ? (
                <div className="flex flex-wrap items-center gap-2">
                  {roleBadgeVariantsFromSession(sessionUser).map((badge) => (
                    <RoleBadge key={badge} variant={badge} />
                  ))}
                </div>
              ) : <RoleBadge variant="guest" />}
              <div className="flex flex-wrap gap-2">
                {!sessionUser ? (
                  <>
                    <Link href="/login" className={buttonVariants({ variant: "secondary" })}>Login</Link>
                    <Link href="/register" className={buttonVariants({ variant: "secondary" })}>Register</Link>
                  </>
                ) : (
                  <>
                    <Link href="/profile" className={buttonVariants({ variant: "secondary" })}>Profile</Link>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        await fetch("/api/auth/logout", { method: "POST" });
                        router.push("/login");
                      }}
                    >
                      Logout
                    </Button>
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
            <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
              <CardHeader>
                <CardTitle>My Trade History</CardTitle>
                <CardDescription>Track each lifecycle step from request to review unlock.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Input placeholder="Search by trade ID or listing..." value={buyerTradeQuery} onChange={(event) => setBuyerTradeQuery(event.target.value)} />
                  <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={buyerTradeStatus} onChange={(event) => setBuyerTradeStatus(event.target.value as typeof buyerTradeStatus)}>
                    <option value="all">Status: All</option>
                    <option value="pending">Pending</option>
                    <option value="accepted">Accepted</option>
                    <option value="payment_sent">Payment Sent</option>
                    <option value="usdt_sent">USDT Sent</option>
                    <option value="review_open">Review Open</option>
                    <option value="declined">Declined</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                {!filteredBuyerRequests.length ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-[#9CA3AF]">No trades found for current filters.</div>
                ) : null}
                {filteredBuyerRequests.map((request) => (
                  <div key={request.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="grid gap-2 text-sm md:grid-cols-3">
                      <p>Trade ID: <span className="text-white">{request.tradeId ?? "Pending Creation"}</span></p>
                      <p>Listing: <span className="text-white">{request.listingId}</span></p>
                      <p>Status: <span className="text-white">{tradeStatusLabel(request.status)}</span></p>
                      <p>USDT Amount: <span className="text-white">{request.usdtAmount}</span></p>
                      <p>Fiat Amount: <span className="text-white">{request.fiatAmount} {request.currency}</span></p>
                      <p>Network: <span className="text-white">{request.network}</span></p>
                      <p>Payment Method: <span className="text-white">{request.paymentMethod}</span></p>
                      <p>Submitted: <span className="text-white">{new Date(request.createdAt).toLocaleString("en-IL")}</span></p>
                      {request.completedAt ? <p>Completed: <span className="text-white">{new Date(request.completedAt).toLocaleString("en-IL")}</span></p> : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" size="sm" disabled={request.status !== "accepted" || !request.buyerEvidence} onClick={() => handleBuyerTradeStatus(request.id, "payment_sent")}>
                        Mark Payment Sent
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={request.status !== "usdt_sent"} onClick={() => handleBuyerTradeStatus(request.id, "completed")}>
                        Confirm Trade Completed
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={request.status !== "pending" && request.status !== "accepted"} onClick={() => handleBuyerTradeStatus(request.id, "cancelled")}>
                        Cancel
                      </Button>
                    </div>
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">
                        {isAr ? "حالة الصفقة اللحظية" : "Live Trade Status"}
                      </p>
                      <p className="mt-1 text-xs text-[#D1D5DB]">{nextTradeActionHint(request, isAr)}</p>
                      <div className="mt-3 space-y-2">
                        {TRADE_MILESTONES.map((step, index) => {
                          const rank = tradeProgressRank(request);
                          const terminal = request.status === "declined" || request.status === "cancelled";
                          const stepTimestamp = tradeMilestoneTimestamp(request, step.key);
                          const done = index <= rank || Boolean(stepTimestamp);
                          const current = !terminal && request.status !== "review_open" && index === Math.min(rank + 1, TRADE_MILESTONES.length - 1);
                          const reviewCurrent = !terminal && request.status === "review_open" && step.key === "review_unlocked";
                          return (
                            <div key={`${request.id}-buyer-${step.key}`} className="flex items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`inline-flex h-4 w-4 rounded-full border ${
                                    done ? "border-[#C9A227]/40 bg-[#C9A227]/25" : current || reviewCurrent ? "border-[#6CAEFF]/50 bg-[#6CAEFF]/25" : "border-white/15 bg-transparent"
                                  }`}
                                />
                                <span className={done || current || reviewCurrent ? "text-[#F3F4F6]" : "text-[#9CA3AF]"}>
                                  {isAr ? step.titleAr : step.titleEn}
                                </span>
                              </div>
                              <span className="text-[11px] text-[#9CA3AF]">
                                {stepTimestamp ? new Date(stepTimestamp).toLocaleTimeString("en-IL", { hour: "2-digit", minute: "2-digit" }) : done ? "✓" : current || reviewCurrent ? "•" : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
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
                          <p className="mt-1 text-[#9CA3AF]">Upload required before marking payment sent.</p>
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
                    <div className="mt-3 space-y-2">
                      {(request.timeline ?? []).map((event) => (
                        <div key={event.id} className="flex items-start gap-2 text-xs">
                          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#C9A227]" />
                          <span className="text-[#D1D5DB]">
                            {new Date(event.createdAt).toLocaleTimeString("en-IL", { hour: "2-digit", minute: "2-digit" })} {event.message}
                          </span>
                        </div>
                      ))}
                    </div>
                    {request.status === "review_open" && !request.buyerReview ? (
                      <form
                        className="mt-3 grid gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleSubmitBuyerReview(request);
                        }}
                      >
                        <Textarea placeholder="Leave one review after completed trade" value={tradeReviewDrafts[request.id] ?? ""} onChange={(event) => setTradeReviewDrafts((prev) => ({ ...prev, [request.id]: event.target.value }))} />
                        <div>
                          <Button type="submit" size="sm" variant="secondary">Submit Buyer Review</Button>
                        </div>
                      </form>
                    ) : null}
                    {request.buyerReview ? (
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-[#D1D5DB]">
                        <p className="font-medium text-white">Buyer Review</p>
                        <p className="mt-1">{request.buyerReview.comment}</p>
                      </div>
                    ) : null}
                    {request.sellerResponse ? (
                      <div className="mt-3 rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                        <p className="font-medium text-white">Seller Response</p>
                        <p className="mt-1">{request.sellerResponse.message}</p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {showLegacyNotificationCenter && sessionUser ? notificationCenterCard : null}
          {sessionUser ? betaChannelsCard : null}
          {sessionUser ? (
            <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
              <CardHeader>
                <CardTitle>Private Activity History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!activityHistory.length ? (
                  <p className="text-xs text-[#9CA3AF]">No activity entries yet.</p>
                ) : (
                  activityHistory.slice(0, 12).map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                      <p className="font-medium text-white">{entry.title}</p>
                      <p className="mt-1">{entry.details}</p>
                      <p className="mt-1 text-[#9CA3AF]">{new Date(entry.createdAt).toLocaleString("en-IL")}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      <div className="mt-12 grid gap-4 md:grid-cols-4">
        {[
          { value: "900+", labelAr: "عضو في المجتمع", label: "Community Members", icon: Users },
          { value: isAr ? "متنامٍ" : "Growing", labelAr: "مجتمع تداول", label: "Trading Community", icon: Layers3 },
          { value: isAr ? "احترافي" : "Professional", labelAr: "دعم", label: "Support", icon: WalletCards },
          { value: isAr ? "واضح" : "Transparent", labelAr: "العملية", label: "Process", icon: CheckCircle2 },
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

      <div className="mt-12">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#C9A227]">{isAr ? "أسئلة شائعة" : "Frequently Asked"}</p>
        <h2 className="text-2xl font-semibold md:text-3xl">FAQ</h2>
        <div className="mt-5 space-y-3">
          {faqs.map((item) => (
            <details key={item.q} className="group rounded-2xl border border-white/10 bg-[#0B0B0B]/85 p-5 transition-colors hover:border-white/20">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-medium text-white">
                {item.q}
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-[#C9A227] transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-7 text-[#9CA3AF]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>

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
              <a href="#marketplace" className={buttonVariants()}>
                {isAr ? "ابدأ التداول" : "Start Trading"}
              </a>
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "secondary" }), "gap-2")}>
                <MessageCircle className="h-4 w-4" />
                {isAr ? "تواصل عبر واتساب" : "Contact on WhatsApp"}
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      <AnimatePresence>
        {selectedListing ? (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-[#0B0B0B]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.5)]" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              <div className={`mb-4 flex items-start justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                <div>
                  <h3 className="text-2xl font-semibold">{isAr ? "ملف البائع" : "Seller Business Profile"}</h3>
                  <p className={`mt-1 inline-flex items-center gap-1.5 text-xs text-[#C9A227] ${isAr ? "flex-row-reverse" : ""}`}>
                    <Star className="h-3.5 w-3.5 fill-[#C9A227] text-[#C9A227]" />
                    <span className="inline-flex flex-col leading-tight">
                      <span>{isAr ? "بائع معتمد" : "Approved Seller"}</span>
                      <span className="opacity-90">{isAr ? "موثق من Alpha Traders" : "Verified by Alpha Traders"}</span>
                    </span>
                  </p>
                </div>
                <button type="button" aria-label="Close listing details" onClick={() => {
                  setSelectedListing(null);
                  setSellerProfileData(null);
                }} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-[#D1D5DB] transition hover:border-[#C9A227] hover:text-[#C9A227]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {!purchaseSubmitted ? (
                <div className="space-y-4">
                  {isSellerProfileLoading ? (
                    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="h-32 animate-pulse rounded-xl bg-white/10" />
                      <div className="h-6 w-2/5 animate-pulse rounded bg-white/10" />
                      <div className="h-20 animate-pulse rounded-xl bg-white/10" />
                    </div>
                  ) : null}
                  {!isSellerProfileLoading ? (
                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                      <div
                        className="relative h-30 w-full border-b border-white/10 bg-cover bg-center"
                        style={{
                          backgroundImage: sellerProfileData?.profile.coverBannerUrl
                            ? `linear-gradient(to bottom, rgba(5,5,5,0.28), rgba(5,5,5,0.7)), url(${sellerProfileData.profile.coverBannerUrl})`
                            : "linear-gradient(120deg, rgba(201,162,39,0.2), rgba(16,16,16,0.9))",
                        }}
                      />
                      <div className="grid gap-4 p-4 md:grid-cols-[auto_1fr]">
                        <div className="-mt-12">
                          {sellerProfileData?.profile.profilePhotoUrl ? (
                            <Image src={sellerProfileData.profile.profilePhotoUrl} alt={`${sellerProfileData.profile.sellerName} profile`} width={80} height={80} unoptimized className="h-20 w-20 rounded-full border-2 border-[#0B0B0B] object-cover" />
                          ) : (
                            <div className="inline-flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#0B0B0B] bg-white/[0.06] text-xl font-semibold text-white">
                              {safeText(sellerProfileData?.profile.sellerName ?? selectedListing.sellerDisplayName, "Seller")
                                .split(" ")
                                .map((part) => part[0])
                                .join("")
                                .slice(0, 2)}
                            </div>
                          )}
                        </div>
                        <div className="space-y-2 text-sm text-[#D1D5DB]">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-semibold text-white">{sellerProfileData?.profile.sellerName ?? selectedListing.sellerDisplayName}</p>
                            <RoleBadge variant="approved_seller" />
                            {sellerProfileData?.profile.isFoundingSeller ? <span className="rounded-full border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 px-2 py-0.5 text-[11px] text-[#93C5FD]">Founding Seller</span> : null}
                            {sellerProfileData?.profile.isFeaturedSeller ? <span className="rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2 py-0.5 text-[11px] text-[#C9A227]">Featured Seller</span> : null}
                          </div>
                          <div className="grid gap-1 md:grid-cols-2">
                            <p>Seller Level: <span className="text-white">{sellerLevelLabel(sellerProfileData?.sellerLevel)}</span></p>
                            <p>Trust Score: <span className="text-white">{sellerProfileData?.trustScore.toFixed(1) ?? (selectedListing.sellerReputation?.trustScore ?? 0).toFixed(1)}</span></p>
                            <p>Status: <span className="text-white">{sellerProfileData?.profile.onlineStatus === "online" ? "Online" : "Offline"}</span></p>
                            <p>Last Active: <span className="text-white">{formatRelativeMinutesLabel(sellerProfileData?.profile.lastActiveAt)}</span></p>
                            <p>Member Since: <span className="text-white">{new Date(sellerProfileData?.profile.memberSince ?? selectedListing.createdAt).toLocaleDateString("en-IL")}</span></p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: "Completed Trades", value: sellerProfileData?.completedTrades ?? selectedListing.sellerReputation?.completedTrades ?? 0 },
                      { label: "Trade Volume", value: `${(sellerProfileData?.tradeVolume ?? selectedListing.sellerReputation?.totalUsdtVolume ?? 0).toLocaleString("en-IL")} USDT` },
                      { label: "Average Rating", value: (sellerProfileData?.averageRating ?? selectedListing.sellerReputation?.rating ?? 0).toFixed(2) },
                      { label: "Response Time", value: `${(sellerProfileData?.responseTimeMinutes ?? selectedListing.sellerReputation?.responseTimeMinutes ?? 0).toFixed(1)} min` },
                      { label: "Completion Rate", value: `${(sellerProfileData?.completionRate ?? selectedListing.sellerReputation?.completionRate ?? 0).toFixed(1)}%` },
                      { label: "Repeat Buyers", value: `${(sellerProfileData?.repeatBuyersPercent ?? selectedListing.sellerReputation?.repeatBuyers ?? 0).toFixed(1)}%` },
                      { label: "Total Reviews", value: sellerProfileData?.totalReviews ?? 0 },
                      { label: "Years on Platform", value: (sellerProfileData?.yearsOnPlatform ?? 0).toFixed(1) },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                        <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">{item.label}</p>
                        <p className="mt-1 text-sm font-medium text-white">{item.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">About Seller</p>
                      <p className="mt-2">{safeText(sellerProfileData?.profile.bio || selectedListing.sellerDescription, "Professional USDT seller on Alpha Exchange.")}</p>
                      <div className="mt-3 grid gap-1 text-xs">
                        <p>Trading Experience: <span className="text-white">{safeText(sellerProfileData?.profile.tradingExperience, "Professional marketplace experience")}</span></p>
                        <p>Languages: <span className="text-white">{(sellerProfileData?.profile.languages ?? []).join(", ") || "English"}</span></p>
                        <p>Working Hours: <span className="text-white">{safeText(sellerProfileData?.profile.workingHours, "Sun-Thu, 09:00-21:00")}</span></p>
                        <p>Payment Methods: <span className="text-white">{(sellerProfileData?.profile.preferredPaymentMethods ?? [selectedListing.paymentMethod]).join(", ")}</span></p>
                        <p>Supported Networks: <span className="text-white">{(sellerProfileData?.profile.preferredNetworks ?? [selectedListing.network]).join(", ")}</span></p>
                        <p>Country: <span className="text-white">{safeText(sellerProfileData?.profile.country, "Israel")}</span></p>
                        {sellerProfileData?.profile.city ? <p>City: <span className="text-white">{sellerProfileData.profile.city}</span></p> : null}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Listing & Trade Quote</p>
                      <div className="mt-2 space-y-1 text-xs">
                        <p>Remaining Amount: <span className="text-white">{selectedListing.availableAmount}</span></p>
                        <p>Minimum Trade: <span className="text-white">{selectedListing.minimumTrade}</span></p>
                        <p>Maximum Trade: <span className="text-white">{selectedListing.maximumTrade}</span></p>
                        <p>Network: <span className="text-white">{selectedListing.network}</span></p>
                        <p>Price: <span className="text-white">{selectedListing.price}</span></p>
                        <p>Commission (1%): <span className="text-white">₪{commission.toFixed(2)}</span></p>
                        <p className="font-medium">Estimated Total: <span className="text-[#C9A227]">₪{estimatedTotal.toFixed(2)}</span></p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(sellerProfileData?.badges ?? selectedListing.sellerReputation?.badges ?? []).map((badge) => (
                          <span key={`seller-profile-badge-${badge}`} className="rounded-full border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 px-2 py-1 text-[11px] text-[#93C5FD]">
                            {sellerBadgeLabel(badge)}
                          </span>
                        ))}
                        {sellerProfileData?.profile.isFoundingSeller ? (
                          <span className="rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2 py-1 text-[11px] text-[#C9A227]">🎖 Founding Seller</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Latest Reviews</p>
                      {!sellerProfileData?.latestReviews?.length ? <p className="mt-2 text-xs text-[#9CA3AF]">No reviews yet.</p> : null}
                      <div className="mt-2 space-y-2">
                        {(sellerProfileData?.latestReviews ?? []).slice(0, 4).map((review) => (
                          <div key={review.id} className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs">
                            <p className="text-white">{review.buyerName} • {review.rating.toFixed(1)}★ {review.verifiedPurchase ? "• Verified Purchase" : ""}</p>
                            <p className="mt-1">{review.comment}</p>
                            <p className="mt-1 text-[#9CA3AF]">{new Date(review.createdAt).toLocaleString("en-IL")}</p>
                            {review.sellerResponse ? (
                              <div className="mt-2 rounded-lg border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 p-2 text-[#D1D5DB]">
                                <p className="font-medium text-white">Seller Response</p>
                                <p className="mt-1">{review.sellerResponse.message}</p>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Recent Activity</p>
                      <div className="mt-2 space-y-2">
                        {(sellerProfileData?.recentActivity ?? []).slice(0, 6).map((activity) => (
                          <div key={activity.id} className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs">
                            <p className="text-white">{activity.message}</p>
                            <p className="mt-1 text-[#9CA3AF]">{new Date(activity.createdAt).toLocaleString("en-IL")}</p>
                          </div>
                        ))}
                        {!sellerProfileData?.recentActivity?.length ? <p className="text-xs text-[#9CA3AF]">No activity published yet.</p> : null}
                      </div>
                    </div>
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
                            <p key={entry.id} className="mt-1">{entry.commissionAmount.toFixed(2)} • {new Date(entry.createdAt).toLocaleDateString("en-IL")}</p>
                          ))}
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                          <p className="font-medium text-white">Recent Trades</p>
                          {(sellerProfileData.ownerTools?.tradeHistory ?? []).slice(0, 3).map((entry) => (
                            <p key={entry.id} className="mt-1">{entry.tradeId ?? entry.id} • {tradeStatusLabel(entry.status)}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <form className="grid gap-3" onSubmit={handlePurchaseSubmit}>
                    <div className="grid gap-3 md:grid-cols-3">
                      <Input placeholder="Trade Amount (USDT)" value={buyerInfo.amount} onChange={(event) => setBuyerInfo((prev) => ({ ...prev, amount: event.target.value }))} />
                      <Input placeholder="Name" value={buyerInfo.name} onChange={(event) => setBuyerInfo((prev) => ({ ...prev, name: event.target.value }))} />
                      <Input placeholder="WhatsApp" value={buyerInfo.whatsapp} onChange={(event) => setBuyerInfo((prev) => ({ ...prev, whatsapp: event.target.value }))} />
                      <Textarea className="md:col-span-3" placeholder="Notes" value={buyerInfo.notes} onChange={(event) => setBuyerInfo((prev) => ({ ...prev, notes: event.target.value }))} />
                    </div>
                    <div className="sticky bottom-0 z-10 rounded-xl border border-[#C9A227]/30 bg-[#0B0B0B]/95 p-3">
                      <Button type="submit" className="w-full">Start Trade</Button>
                    </div>
                    {statusMessage ? (
                      <Card className="border-amber-500/30 bg-black/30">
                        <CardContent className="flex items-center gap-2 p-3 text-xs text-[#FDE68A]">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>{statusMessage}</span>
                        </CardContent>
                      </Card>
                    ) : null}
                  </form>
                </div>
              ) : (
                <div className="rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/10 p-4 text-sm">
                  <p className="text-base font-semibold text-white">Request Submitted</p>
                  <p className="mt-2 text-[#D1D5DB]">Alpha Traders has received your request. We will connect you with the Approved Seller shortly.</p>
                  <div className="mt-4">
                    <Button onClick={() => {
                      setSelectedListing(null);
                      setSellerProfileData(null);
                    }}>Close</Button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
