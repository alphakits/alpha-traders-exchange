"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, AlertTriangle, BadgePercent, BellRing, CheckCircle2, Clock3, Copy, Edit3, HandCoins, LockKeyhole, MessageCircle, Network, PauseCircle, PlayCircle, ShieldCheck, Sparkles, Star, Store, Trash2, TrendingUp, Trophy, Users, WalletCards, X, Zap } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RoleBadge } from "@/components/ui/role-badge";
import { AlphaMarketCenter } from "@/components/market/alpha-market-center";
import { useMarketFeed } from "@/components/market/use-market-feed";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import type { AlphaExchangeActivityLogEntry, AlphaExchangeNotification, MarketplaceListing, NotificationCategory, PremiumSellerProfileData, PurchaseRequest, SellerApplication, SellerBadge, SellerLevel, SellerStatus, SupportedNetwork, UserRole } from "@/types/alpha-exchange";

const WHATSAPP_URL = "https://wa.me/972525967649";
const MAX_EVIDENCE_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const MAX_PRICE_MARKUP_ILS = 0.35;
const DEFAULT_MARKET_PRICE_PER_USDT = 3.05;
const DEFAULT_RESPONSE_TIME = "5 min";

const ISRAELI_BANKS = [
  { id: "hapoalim", name: "Bank Hapoalim", code: "בנק הפועלים", brandPrimary: "#E31C23", brandSecondary: "#B01016", accent: "#FCA5A5" },
  { id: "leumi", name: "Bank Leumi", code: "בנק לאומי", brandPrimary: "#2458A6", brandSecondary: "#1D4B8F", accent: "#93C5FD" },
  { id: "mizrahi-tefahot", name: "Mizrahi-Tefahot", code: "מזרחי טפחות", brandPrimary: "#F58220", brandSecondary: "#C8600E", accent: "#FDBA74" },
  { id: "discount", name: "Discount Bank", code: "דיסקונט", brandPrimary: "#148A79", brandSecondary: "#0F7668", accent: "#5EEAD4" },
  { id: "fibi", name: "First International", code: "הבינלאומי", brandPrimary: "#7C3AED", brandSecondary: "#6D28D9", accent: "#C4B5FD" },
  { id: "mercantile", name: "Mercantile", code: "מרכנתיל", brandPrimary: "#0B5CAD", brandSecondary: "#073F7A", accent: "#93C5FD" },
  { id: "yahav", name: "Yahav", code: "יהב", brandPrimary: "#2563EB", brandSecondary: "#1E40AF", accent: "#BFDBFE" },
  { id: "jerusalem", name: "Bank Jerusalem", code: "בנק ירושלים", brandPrimary: "#1F2937", brandSecondary: "#111827", accent: "#D1D5DB" },
] as const;

type Locale = "ar" | "en";

type SessionUser = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
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
  if (bank.id === "hapoalim") {
    return <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill={bank.brandPrimary} /><path d="M8 16h16M16 8v16" stroke="white" strokeWidth="3" strokeLinecap="round" /></svg>;
  }
  if (bank.id === "leumi") {
    return <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill={bank.brandPrimary} /><path d="M16 7l3.4 5.8L26 14.3l-4.6 4.6.9 6.5-6.3-3.2-6.3 3.2.9-6.5L6 14.3l6.6-1.5z" fill="white" /></svg>;
  }
  if (bank.id === "mizrahi-tefahot") {
    return <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill={bank.brandPrimary} /><path d="M7 23L16 7l9 16h-4l-5-9-5 9z" fill="white" /></svg>;
  }
  if (bank.id === "discount") {
    return <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill={bank.brandPrimary} /><circle cx="16" cy="16" r="7.5" fill="none" stroke="white" strokeWidth="3" /><path d="M16 9.5a6.5 6.5 0 100 13" fill="none" stroke={bank.accent} strokeWidth="3" strokeLinecap="round" /></svg>;
  }
  if (bank.id === "fibi") {
    return <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill={bank.brandPrimary} /><path d="M8 10h16v3H8zm0 5h12v3H8zm0 5h16v3H8z" fill="white" /></svg>;
  }
  if (bank.id === "mercantile") {
    return <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill={bank.brandPrimary} /><path d="M7 23V9h3l6 7 6-7h3v14h-3v-9l-6 6-6-6v9z" fill="white" /></svg>;
  }
  if (bank.id === "yahav") {
    return <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill={bank.brandPrimary} /><path d="M9 9h4l3 5 3-5h4l-5 8v6h-4v-6z" fill="white" /></svg>;
  }
  return <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill={bank.brandPrimary} /><path d="M9 24V8h9a5 5 0 010 10H13v6zm4-9h4a2 2 0 000-4h-4z" fill="white" /></svg>;
}

function shortListingRef(listing: Pick<MarketplaceListing, "displayNumber" | "id">) {
  return `#${listing.displayNumber ?? String(listing.id).slice(-6)}`;
}

function shortTradeRef(request: Pick<PurchaseRequest, "displayNumber" | "tradeId" | "id">) {
  if (request.displayNumber) return `Trade #${request.displayNumber}`;
  if (request.tradeId?.trim()) return request.tradeId;
  return `Trade #${String(request.id).slice(-6)}`;
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
  if (level === "legendary") return "Legendary";
  if (level === "diamond") return "Diamond";
  if (level === "platinum") return "Platinum";
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

function roleBadgeVariantFromSession(user: SessionUser) {
  if (user.role === "admin" && isAlphaExchangeOwnerEmail(user.email)) return "owner" as const;
  if (user.role === "admin") return "administrator" as const;
  if (user.role === "approved_seller") return "approved_seller" as const;
  return "buyer" as const;
}

function listingRequiresFaceToFaceSafetyNotice(listing: MarketplaceListing | null) {
  if (!listing) return false;
  const methods = listing.paymentMethods?.length ? listing.paymentMethods : [listing.paymentMethod];
  return methods.some((method) => /face\s*[- ]?\s*to\s*[- ]?\s*face|cash/i.test(String(method ?? "")));
}

export function UsdtExchangePage({ locale }: { locale: Locale }) {
  const isAr = locale === "ar";
  const router = useRouter();
  const { snapshot: marketSnapshot } = useMarketFeed({ refreshMs: 45_000 });

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [isLoadingListings, setIsLoadingListings] = useState(true);
  const [pulseNow, setPulseNow] = useState(() => Date.now());
  const listingsLoadedAtRef = useRef<number>(Date.now());
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
  const [purchaseSubmitted, setPurchaseSubmitted] = useState(false);
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [sellerProfileData, setSellerProfileData] = useState<PremiumSellerProfileData | null>(null);
  const [isSellerProfileLoading, setIsSellerProfileLoading] = useState(false);
  const [isOwnerProfileActionLoading, setIsOwnerProfileActionLoading] = useState(false);
  const [sellerApplication, setSellerApplication] = useState<SellerApplication | null>(null);
  const [myRequests, setMyRequests] = useState<PurchaseRequest[]>([]);
  const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sellerWorkspaceMessage, setSellerWorkspaceMessage] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [listingActionKey, setListingActionKey] = useState<string | null>(null);
  const [listingEditForm, setListingEditForm] = useState({
    availableAmount: "",
    price: "",
    currency: "ILS",
    network: "TRC20" as SupportedNetwork,
    paymentMethods: "Bank transfer",
    bankName: "",
    minimumTrade: "0",
    maximumTrade: "",
    sellerDescription: "",
  });
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
  const [listingCreateForm, setListingCreateForm] = useState({
    availableAmount: "",
    price: "",
    currency: "ILS",
    network: "TRC20" as SupportedNetwork,
    paymentMethods: "Bank transfer",
    bankName: "",
    minimumTrade: "0",
    maximumTrade: "",
    sellerDescription: "",
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
  const notificationsRequestIdRef = useRef(0);

  const [buyerInfo, setBuyerInfo] = useState({ name: "", whatsapp: "", notes: "", usdtAmount: "" });
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
        };
        setMyListings((myListingsJson.listings ?? []).filter((listing) => listing.status !== "closed" && listing.status !== "cancelled"));
        setSellerWorkspaceSummary(myListingsJson.summary ?? null);
        setSellerCommissionStatus(myListingsJson.commissionStatus ?? null);
      }
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
        listingsLoadedAtRef.current = Date.now();

        if (meJson.user) {
          const user = meJson.user;
          setSellerForm((prev) => ({
            ...prev,
            fullName: user.fullName,
            email: user.email,
            whatsappNumber: user.whatsappNumber || prev.whatsappNumber,
          }));
          setBuyerInfo((prev) => ({
            ...prev,
            name: user.fullName,
            whatsapp: user.whatsappNumber || prev.whatsapp,
          }));
          const [applicationRes] = await Promise.all([
            fetch("/api/alpha-exchange/seller-application", { cache: "no-store", signal: controller.signal }),
            refreshSellerWorkspace(),
            refreshNotificationPreferences(),
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
  }, [refreshNotificationPreferences, refreshSellerWorkspace]);

  useEffect(() => {
    if (!sessionUser) return;
    void refreshNotifications();
  }, [sessionUser, notificationCategory, notificationQuery, notificationUnreadOnly, refreshNotifications]);

  useEffect(() => {
    const id = window.setInterval(() => setPulseNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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
    setFaceToFaceSafetyAcknowledged(false);
    setBuyerInfo((prev) => ({
      ...prev,
      usdtAmount: formatIntegerForInput(listing.minimumTrade || listing.availableAmount),
    }));
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

  async function submitPurchaseRequest(notesOverride?: string) {
    if (!selectedListing) return;
    if (listingRequiresFaceToFaceSafetyNotice(selectedListing) && !faceToFaceSafetyAcknowledged) {
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
    const response = await fetch("/api/alpha-exchange/purchase-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId: selectedListing.id,
        usdtAmount: tradeAmount,
        buyerName: buyerInfo.name,
        buyerWhatsapp: buyerInfo.whatsapp,
        buyerNotes: notesOverride ?? buyerInfo.notes,
        safetyAcknowledged: faceToFaceSafetyAcknowledged,
      }),
    });
    const data = (await response.json()) as { error?: string; purchase?: PurchaseRequest };
    if (!response.ok) {
      setStatusMessage(safeErrorMessage("purchase"));
      return;
    }
    if (data.purchase) {
      setMyRequests((prev) => [data.purchase as PurchaseRequest, ...prev]);
      setPurchaseSubmitted(true);
      setStatusMessage(null);
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

  const buyerMenu = ["Profile", "My Requests", "Settings"];
  const sellerMenu = ["Profile", "My Listings", "Create Listing", "My Requests", "Notifications"];
  const isApprovedSeller = sessionUser?.role === "approved_seller" && sessionUser?.sellerStatus === "approved_seller";
  const isOwnerViewer = sessionUser?.role === "admin" && isAlphaExchangeOwnerEmail(sessionUser.email);
  const menuItems = isApprovedSeller ? sellerMenu : buyerMenu;
  const marketPricePerUsdt = marketSnapshot?.pairs.usdtIls.price ?? DEFAULT_MARKET_PRICE_PER_USDT;
  const maxAllowedListingPrice = marketPricePerUsdt + MAX_PRICE_MARKUP_ILS;
  const listingCreatePrice = toNumber(listingCreateForm.price);
  const listingCreateAmount = toNumber(listingCreateForm.availableAmount);
  const listingCreateMinTrade = toNumber(listingCreateForm.minimumTrade);
  const listingCreateMaxTrade = toNumber(listingCreateForm.maximumTrade || listingCreateForm.availableAmount);
  const listingCreateCurrency = listingCreateForm.currency.trim().toUpperCase();
  const listingCreatePriceInvalid = listingCreateCurrency === "ILS" && listingCreatePrice > maxAllowedListingPrice;
  const listingCreatePriceValid = listingCreatePrice > 0 && !listingCreatePriceInvalid;
  const listingCreateTradeRangeInvalid = listingCreateMaxTrade <= 0 || listingCreateMaxTrade > listingCreateAmount || listingCreateMaxTrade < listingCreateMinTrade;
  const listingCreateMissingRequired = !listingCreateAmount || !listingCreatePrice || !listingCreateForm.bankName.trim() || !listingCommissionAgreement;
  const listingCreateTotalIls = listingCreateAmount * listingCreatePrice;
  const isListingCreateSubmitDisabled = listingCreateMissingRequired || listingCreatePriceInvalid || listingCreateTradeRangeInvalid;
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
  const listingEditMissingRequired = !listingEditAmount || !listingEditPrice || !listingEditForm.bankName.trim();
  const isListingEditSubmitDisabled = listingEditMissingRequired || listingEditPriceInvalid || listingEditTradeRangeInvalid;
  const listingEditGuardTone = listingEditPriceInvalid
    ? "border-red-500/60 bg-red-500/10 text-red-200"
    : listingEditPriceValid
      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200"
      : "border-white/10 bg-black/20 text-[#D1D5DB]";
  const buyerTradeAmount = toNumber(buyerInfo.usdtAmount);
  const selectedMinTrade = selectedListing ? Math.max(0, toNumber(selectedListing.minimumTrade)) : 0;
  const selectedMaxTrade = selectedListing ? toNumber(selectedListing.maximumTrade || selectedListing.availableAmount) : 0;
  const buyerTradeAmountInvalid = !!selectedListing && (buyerTradeAmount < selectedMinTrade || buyerTradeAmount > selectedMaxTrade);
  const selectedListingRequiresSafetyNotice = listingRequiresFaceToFaceSafetyNotice(selectedListing);
  const todayDateKey = new Date().toISOString().slice(0, 10);

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

  const recentCompletedTrades = useMemo(
    () =>
      myRequests
        .filter((request) => request.status === "completed" || Boolean(request.completedAt))
        .sort((left, right) => new Date(right.completedAt ?? right.updatedAt).getTime() - new Date(left.completedAt ?? left.updatedAt).getTime())
        .slice(0, 4),
    [myRequests],
  );
  const todaysCompletedTrades = useMemo(
    () =>
      myRequests.filter((request) => {
        const completedAt = request.completedAt ?? (request.status === "completed" ? request.updatedAt : "");
        return completedAt.slice(0, 10) === todayDateKey;
      }).length,
    [myRequests, todayDateKey],
  );
  const marketplaceUpdates = useMemo(() => {
    const activityItems = activityHistory.slice(0, 6).map((entry) => ({
      id: `activity-${entry.id}`,
      title: entry.title,
      details: entry.details,
      createdAt: entry.createdAt,
    }));
    if (activityItems.length) return activityItems;
    return notifications.slice(0, 6).map((notification) => ({
      id: `notification-${notification.id}`,
      title: notification.title,
      details: notification.message,
      createdAt: notification.createdAt,
    }));
  }, [activityHistory, notifications]);

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
        const normalized = safeText(method, "Bank transfer");
        acc[normalized] = (acc[normalized] ?? 0) + 1;
      });
      return acc;
    }, {});
    const topPaymentMethod = Object.entries(paymentMethodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Bank transfer";
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

  async function handleSellerListingDelete(listing: MarketplaceListing) {
    const confirmed = window.confirm(`Delete listing ${shortListingRef(listing)}? This action cannot be undone.`);
    if (!confirmed) return;
    setListingActionKey(`${listing.id}:delete`);
    try {
      const response = await fetch(`/api/alpha-exchange/listings/${listing.id}`, { method: "DELETE" });
      if (!response.ok) {
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing")));
        return;
      }
      setSellerWorkspaceMessage("🗑 Listing removed successfully.");
      await refreshSellerWorkspace();
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
      setSellerWorkspaceMessage("📋 Listing duplicated successfully. Review and publish it when ready.");
      setEditingListingId(null);
      await refreshSellerWorkspace();
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
      setSellerWorkspaceMessage("🔄 Listing renewed. Your listing is now live with a refreshed expiry.");
      await refreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing"));
    } finally {
      setListingActionKey(null);
    }
  }

  async function handleSellerListingCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setListingActionKey("create:new");
    try {
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
          bankName: listingCreateForm.bankName,
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
      setListingCreateForm((prev) => ({
        ...prev,
        availableAmount: "",
        price: "",
        bankName: "",
        minimumTrade: "0",
        maximumTrade: "",
        sellerDescription: "",
      }));
      setListingCommissionAgreement(false);
      setSellerWorkspaceMessage("✅ Listing published successfully. Buyers can now see your listing in the marketplace.");
      await refreshSellerWorkspace();
    } catch {
      setSellerWorkspaceMessage(safeErrorMessage("listing"));
    } finally {
      setListingActionKey(null);
    }
  }

  async function handleSellerListingEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingListingId) return;
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
          paymentMethods: listingEditForm.paymentMethods
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
            .slice(0, 8),
          bankName: listingEditForm.bankName,
          minimumTrade: listingEditForm.minimumTrade,
          maximumTrade: listingEditForm.maximumTrade || listingEditForm.availableAmount,
          sellerDescription: listingEditForm.sellerDescription,
        }),
      });
      if (!response.ok) {
        setSellerWorkspaceMessage(await readApiErrorMessage(response, safeErrorMessage("listing")));
        return;
      }
      setEditingListingId(null);
      setSellerWorkspaceMessage("✅ Listing updated successfully. Changes are now visible to buyers.");
      await refreshSellerWorkspace();
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
    await refreshSellerWorkspace();
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
        <div className="space-y-2">
          {notificationsLoading ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9CA3AF]">Loading notifications...</div>
          ) : null}
          {!notificationsLoading && notifications.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-center text-xs text-[#9CA3AF]">
              <BellRing className="mx-auto mb-2 h-4 w-4 text-[#9CA3AF]" />
              No notifications yet. You&apos;ll be notified here about trades, listings, reviews, and account activity.
            </div>
          ) : null}
          {notifications.slice(0, 10).map((notification) => (
            <div key={notification.id} className={`rounded-xl border p-3 text-xs ${notification.isRead ? "border-white/10 bg-black/20 text-[#9CA3AF]" : "border-[#C9A227]/35 bg-[#C9A227]/10 text-[#F3F4F6]"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-white">{notification.title}</p>
                  <p className="mt-1 text-[11px] text-[#93C5FD]">
                    {notification.relatedListingDisplayNumber ? `Listing #${notification.relatedListingDisplayNumber}` : null}
                    {notification.relatedTradeDisplayNumber ? `${notification.relatedListingDisplayNumber ? " • " : ""}Trade #${notification.relatedTradeDisplayNumber}` : null}
                    {notification.relatedRequestDisplayNumber && !notification.relatedTradeDisplayNumber ? `${notification.relatedListingDisplayNumber ? " • " : ""}Trade #${notification.relatedRequestDisplayNumber}` : null}
                  </p>
                  <p className="mt-1">{notification.message}</p>
                  <p className="mt-1 text-[11px]">{new Date(notification.createdAt).toLocaleString("en-IL")}</p>
                  {notification.actionHref ? (
                    <a href={notification.actionHref} className="mt-2 inline-flex items-center rounded-full border border-[#6CAEFF]/40 bg-[#6CAEFF]/10 px-2.5 py-1 text-[11px] text-[#93C5FD] transition hover:border-[#6CAEFF]/70">
                      {notification.actionLabel?.trim() || "Review now"}
                    </a>
                  ) : notification.relatedHref ? (
                    <a href={notification.relatedHref} className="mt-2 inline-flex items-center rounded-full border border-[#6CAEFF]/40 bg-[#6CAEFF]/10 px-2.5 py-1 text-[11px] text-[#93C5FD] transition hover:border-[#6CAEFF]/70">
                      Review now
                    </a>
                  ) : null}
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

  const marketInsightsCard = sessionUser ? (
    <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
      <CardHeader>
        <CardTitle>Marketplace Insights</CardTitle>
        <CardDescription>Daily signals to help you trade faster and build seller trust.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
              <p className="uppercase tracking-[0.12em] text-[#9CA3AF]">Today&apos;s Completed Trades</p>
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
                <p className="mt-1 text-[#9CA3AF]">{new Date(update.createdAt).toLocaleString("en-IL")}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/10 p-4 text-sm text-[#E5E7EB]">
            <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">Seller Level Progress</p>
            <p className="mt-2 text-white">
              Current level: <span className="font-semibold text-[#F3D979]">{sellerLevelLabel(sellerOverviewStats.reputation?.level)}</span>
            </p>
            <p className="mt-1 text-xs">
              {Math.max(0, 12 - sellerOverviewStats.completedTrades)} more completed trades to unlock your next tier.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Quick Actions</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => document.getElementById("create-listing-form")?.scrollIntoView({ behavior: "smooth", block: "start" })}
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
        <AlphaMarketCenter locale={locale} />
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

      {workspaceError ? (
        <Card className="mt-6 border-amber-500/30 bg-[#0B0B0B]/95">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-[#FDE68A]">
            <AlertTriangle className="h-4 w-4" />
            <span>{workspaceError}</span>
          </CardContent>
        </Card>
      ) : null}

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

      <div id="marketplace" className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold md:text-3xl">{isAr ? "السوق المباشر" : "Live Marketplace"}</h2>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            LIVE
          </div>
        </div>

        {/* Marketplace Heartbeat */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0A0A0A]/90 shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
          <div className="border-b border-white/[0.07] px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
              <Activity className="h-3.5 w-3.5 text-emerald-400" />
              {isAr ? "نبض السوق" : "Marketplace Pulse"}
            </div>
            <span className="text-[11px] text-[#9CA3AF]">
              {isAr ? "محدّث" : "Updated"}{" "}
              {Math.max(0, Math.round((pulseNow - listingsLoadedAtRef.current) / 1000))}{" "}
              {isAr ? "ثانية" : "sec ago"}
            </span>
          </div>
          <div className="grid divide-x divide-white/[0.06] md:grid-cols-3 xl:grid-cols-6">
            {[
              {
                icon: ShieldCheck,
                label: isAr ? "بائعون موثقون" : "Verified Sellers",
                value: marketplacePulse.onlineVerifiedSellers > 0
                  ? `${marketplacePulse.onlineVerifiedSellers} online`
                  : marketplacePulse.verifiedSellers > 0 ? `${marketplacePulse.verifiedSellers}` : "—",
                accent: "text-emerald-300",
                show: true,
              },
              {
                icon: Store,
                label: isAr ? "العروض النشطة" : "Live Listings",
                value: marketplacePulse.liveListings > 0 ? marketplacePulse.liveListings.toLocaleString("en-IL") : "—",
                accent: "text-[#C9A227]",
                show: true,
              },
              {
                icon: WalletCards,
                label: isAr ? "USDT متاح" : "USDT Available",
                value: marketplacePulse.totalUsdtAvailable > 0
                  ? `${marketplacePulse.totalUsdtAvailable.toLocaleString("en-IL")} USDT`
                  : "—",
                accent: "text-[#93C5FD]",
                show: true,
              },
              {
                icon: Zap,
                label: isAr ? "متوسط الاستجابة" : "Avg Response",
                value: marketplacePulse.averageResponseMinutes > 0 ? `${marketplacePulse.averageResponseMinutes} min` : "—",
                accent: "text-amber-300",
                show: true,
              },
              {
                icon: Network,
                label: isAr ? "الشبكة الرائجة" : "Trending Network",
                value: marketplacePulse.topNetwork || "—",
                accent: "text-violet-300",
                show: Boolean(marketplacePulse.topNetwork),
              },
              {
                icon: TrendingUp,
                label: isAr ? "طريقة الدفع الشائعة" : "Popular Payment",
                value: marketplacePulse.topPaymentMethod || "—",
                accent: "text-rose-300",
                show: Boolean(marketplacePulse.topPaymentMethod),
              },
            ]
              .filter((item) => item.show)
              .map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex flex-col gap-1 px-5 py-4">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">
                      <Icon className={`h-3 w-3 ${item.accent}`} />
                      {item.label}
                    </div>
                    <p className={`mt-0.5 text-base font-semibold ${item.accent}`}>{item.value}</p>
                  </div>
                );
              })}
          </div>
          {marketplacePulse.newestSellers.length ? (
            <div className="border-t border-white/[0.07] px-5 py-3 text-xs text-[#9CA3AF]">
              <span className="text-emerald-400">↑ {isAr ? "أحدث البائعين النشطين" : "Recently active"}: </span>
              <span className="text-white">{marketplacePulse.newestSellers.join(" • ")}</span>
            </div>
          ) : null}
        </div>

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

        <Card className="mt-5 border-white/10 bg-[#0B0B0B]/90">
          <CardContent className="p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

        <div className="mt-5 grid gap-4 md:grid-cols-2">
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
            : filteredListings.map((listing) => (
                <Card key={listing.id} className="group border-white/10 bg-[#0B0B0B]/90 transition duration-300 hover:-translate-y-1 hover:border-[#C9A227]/30 hover:shadow-[0_22px_60px_rgba(0,0,0,0.35)]" style={{ borderLeft: `2px solid ${listing.sellerReputation?.level === "gold" || listing.sellerReputation?.level === "diamond" ? "#C9A227" : "rgba(255,255,255,0.1)"}` }}>
                  <CardHeader>
                    <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
                      <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                        {listing.sellerProfile?.profilePhotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={listing.sellerProfile.profilePhotoUrl}
                            alt={`${safeText(listing.sellerDisplayName, "Seller")} profile`}
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
                          <CardTitle className="profile-identity-name--seller text-lg">{safeText(listing.sellerDisplayName, "Seller")}</CardTitle>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">
                            {sellerLevelLabel(listing.sellerReputation?.level)} Seller
                            {listing.sellerProfile?.onlineStatus === "online" ? " • Online" : " • Offline"}
                          </p>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#93C5FD]">Listing {shortListingRef(listing)}</p>
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
                  <CardContent className="space-y-4">
                    <div className="rounded-xl border border-[#C9A227]/25 bg-[#C9A227]/10 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">{isAr ? "سعر العرض" : "Listing Price"}</p>
                      <div className="mt-2 flex items-end justify-between">
                        <p className="text-2xl font-semibold text-white">{formatIls(toNumber(listing.price))}</p>
                        <p className="text-xs text-[#E5E7EB]">{toNumber(listing.availableAmount).toLocaleString("en-IL")} USDT</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl border border-white/10 bg-black/25 p-2.5 text-[#D1D5DB]">⭐ {(listing.sellerReputation?.rating ?? 0).toFixed(2)} Rating</div>
                      <div className="rounded-xl border border-white/10 bg-black/25 p-2.5 text-[#D1D5DB]">🤝 {(listing.sellerReputation?.completedTrades ?? 0).toLocaleString("en-IL")} Trades</div>
                      <div className="rounded-xl border border-white/10 bg-black/25 p-2.5 text-[#D1D5DB]">⚡ {safeText(listing.responseTime, "5 min")}</div>
                      <div className="rounded-xl border border-white/10 bg-black/25 p-2.5 text-[#D1D5DB]">🛡 {(listing.sellerReputation?.trustScore ?? 0).toFixed(1)} Trust</div>
                    </div>
                    <div className="space-y-1.5 text-xs text-[#9CA3AF]">
                      <p>{isAr ? "آخر نشاط" : "Last active"}: <span className="text-white">{formatRelativeMinutesLabel(listing.sellerProfile?.lastActiveAt)}</span></p>
                      <p>{isAr ? "الشبكة" : "Network"}: <span className="text-white">{safeText(listing.network)}</span></p>
                      <p>{isAr ? "الدفع" : "Payment"}: <span className="text-white">{(listing.paymentMethods?.length ? listing.paymentMethods : [listing.paymentMethod]).join(", ")}</span></p>
                      <p>{isAr ? "حدود الصفقة" : "Trade limits"}: <span className="text-white">{toNumber(listing.minimumTrade).toLocaleString("en-IL")} – {toNumber(listing.maximumTrade).toLocaleString("en-IL")} USDT</span></p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(listing.sellerReputation?.badges ?? []).slice(0, 2).map((badge) => (
                        <span key={`${listing.id}-${badge}`} className="rounded-full border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 px-2 py-1 text-[11px] text-[#93C5FD]">
                          {sellerBadgeLabel(badge)}
                        </span>
                      ))}
                      {listing.bankName ? (
                        <span className="rounded-full border border-white/15 bg-white/[0.03] px-2 py-1 text-[11px] text-[#D1D5DB]">
                          🏦 {listing.bankName}
                        </span>
                      ) : null}
                    </div>
                    <Button className="w-full transition-transform group-hover:scale-[1.01]" onClick={() => openListingModal(listing)} aria-label={`Open listing from ${safeText(listing.sellerDisplayName, "seller")}`}>
                      {isAr ? "شراء USDT الآن" : "Buy USDT"}
                    </Button>
                  </CardContent>
                </Card>
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
              {isApprovedSeller ? (
                <Button type="button" className="mt-4" onClick={() => router.push("/dashboard/seller")}>
                  {isAr ? "إنشاء عرض" : "Create Listing"}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

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

      {!isApprovedSeller ? (
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
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                <p className="mb-2 font-medium text-white">How to buy USDT:</p>
                <ol className="list-inside list-decimal space-y-2">
                  <li>Browse the <a href="#marketplace" className="text-[#93C5FD] hover:underline">Live Marketplace</a> above</li>
                  <li>Choose a verified seller that fits your needs</li>
                  <li>Click <strong className="text-white">Buy USDT</strong> on their listing</li>
                  <li>Fill in your trade details and submit</li>
                  <li>Alpha Traders coordinates the rest</li>
                </ol>
              </div>
              <a href="#marketplace">
                <Button className="w-full">{isAr ? "ابدأ صفقة" : "Browse Sellers"}</Button>
              </a>
              <p className="text-center text-xs text-[#9CA3AF]">
                Need help?{" "}
                <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="text-[#93C5FD] hover:underline">
                  Contact Alpha Traders on WhatsApp
                </a>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      ) : null}

      {isApprovedSeller ? (
        <div className="mt-8 space-y-6">
          {/* Seller Dashboard Hero */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0D0D0D] via-[#0A0A0A] to-[#111827]/60 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
            <div className="pointer-events-none absolute inset-0 opacity-30">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(201,162,39,0.18),transparent_40%),radial-gradient(circle_at_90%_80%,rgba(147,197,253,0.1),transparent_40%)]" />
            </div>
            <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[#9CA3AF]">Seller Workspace</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">
                  Welcome back, {sessionUser?.fullName?.split(" ")[0] ?? "Seller"} 👋
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
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
              <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-xs text-[#D1D5DB] sm:min-w-[180px]">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">Today&apos;s Market</p>
                <p className="mt-1 text-base font-semibold text-white">USD/ILS {formatIls(marketPricePerUsdt)}</p>
                <div className="mt-2 space-y-0.5">
                  {sellerOverviewStats.activeListings > 0 && <p>• {sellerOverviewStats.activeListings} Active Listing{sellerOverviewStats.activeListings !== 1 ? "s" : ""}</p>}
                  {sellerOverviewStats.pendingRequests > 0 && <p>• {sellerOverviewStats.pendingRequests} Purchase Request{sellerOverviewStats.pendingRequests !== 1 ? "s" : ""}</p>}
                  {sellerOverviewStats.reputation?.completedTrades !== undefined && <p className="text-[#9CA3AF]">• {sellerOverviewStats.reputation.completedTrades} Total Trades</p>}
                </div>
              </div>
            </div>
          </div>

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
              { label: "Active Listings", value: sellerOverviewStats.activeListings.toLocaleString("en-IL"), icon: TrendingUp },
              { label: "Pending Trades", value: sellerOverviewStats.pendingRequests.toLocaleString("en-IL"), icon: MessageCircle },
              { label: "Rating", value: (sellerOverviewStats.reputation?.rating ?? 0).toFixed(2), icon: Star },
              { label: "Lifetime Volume", value: `₪${sellerOverviewStats.revenueGenerated.toFixed(2)}`, icon: WalletCards },
              { label: "Profile Views", value: (sellerOverviewStats.reputation?.profileViews ?? 0).toLocaleString("en-IL"), icon: Users },
              { label: "Average Response Time", value: sellerOverviewStats.averageResponseTime, icon: Clock3 },
              { label: "Seller Level", value: sellerLevelLabel(sellerOverviewStats.reputation?.level), icon: Trophy },
              { label: "Trust Score", value: (sellerOverviewStats.reputation?.trustScore ?? 0).toFixed(1), icon: ShieldCheck },
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

          <Card className="border-white/10 bg-[#0B0B0B]/90">
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
              <div className={`rounded-2xl border p-4 text-sm ${
                sellerCommissionStatus?.status === "overdue"
                  ? "border-red-500/50 bg-red-500/10 text-red-100"
                  : sellerCommissionStatus?.status === "pending"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
              }`}>
                <p className="font-semibold">
                  {sellerCommissionStatus?.status === "overdue"
                    ? "🔴 Overdue"
                    : sellerCommissionStatus?.status === "pending"
                      ? "🟡 Pending payment"
                      : "🟢 No commission due"}
                </p>
                {sellerCommissionStatus?.status !== "clear" ? (
                  <div className="mt-2 space-y-1 text-xs text-[#E5E7EB]">
                    <p>Amount due: <span className="font-medium text-white">{formatIls(sellerCommissionStatus?.amountDue ?? 0)}</span></p>
                    <p>Related trade: <span className="font-medium text-white">{sellerCommissionStatus?.relatedTradeDisplayNumber ? `Trade #${sellerCommissionStatus.relatedTradeDisplayNumber}` : sellerCommissionStatus?.relatedTradeId ?? "Pending reference"}</span></p>
                    {sellerCommissionStatus?.dueAt ? <p>Due date: <span className="font-medium text-white">{new Date(sellerCommissionStatus.dueAt).toLocaleDateString("en-IL")}</span></p> : null}
                  </div>
                ) : null}
              </div>
              {sellerWorkspaceSummary?.blockedReason ? (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">{sellerWorkspaceSummary.blockedReason}</p>
              ) : null}
              {sellerCommissionStatus?.status !== "clear" ? (
                <a
                  href={`${WHATSAPP_URL}?text=${encodeURIComponent("Hi Alpha Traders, I need to settle my pending platform commission.")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-[#6CAEFF]/45 bg-[#6CAEFF]/10 px-4 text-sm font-medium text-[#93C5FD] transition hover:border-[#6CAEFF]/70 hover:bg-[#6CAEFF]/15"
                >
                  Pay Commission
                </a>
              ) : null}
            </CardContent>
          </Card>

          <Card id="create-listing-form" className="border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>{isAr ? "إنشاء عرض جديد" : "Create Listing"}</CardTitle>
              <CardDescription>
                {isAr ? "يتم إرسال العرض للمراجعة أولًا قبل نشره في السوق." : "Listings are submitted to owner review before publishing live."}
              </CardDescription>
            </CardHeader>
            <CardContent>
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
              <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSellerListingCreateSubmit}>
                <div className="space-y-2">
                  <Input
                    placeholder="Available USDT *"
                    value={listingCreateForm.availableAmount}
                    onChange={(event) => setListingCreateForm((prev) => ({ ...prev, availableAmount: formatIntegerForInput(event.target.value) }))}
                    className={!listingCreateAmount ? "border-amber-400/70" : ""}
                  />
                  <p className="text-xs text-[#9CA3AF]">Amount is auto-formatted while typing (e.g. 25,000).</p>
                </div>
                <div className="space-y-2">
                  <Input
                    placeholder="Price"
                    value={listingCreateForm.price}
                    onChange={(event) => setListingCreateForm((prev) => ({ ...prev, price: normalizeDecimalInput(event.target.value) }))}
                    className={`transition-all duration-200 ${
                      listingCreatePriceInvalid
                        ? "border-red-500/85 shadow-[0_0_0_3px_rgba(239,68,68,0.2)]"
                        : listingCreatePriceValid
                          ? "border-emerald-500/80 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]"
                          : ""
                    }`}
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
                <Input placeholder="Currency (e.g. ILS)" value={listingCreateForm.currency} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, currency: event.target.value }))} />
                <select className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white" value={listingCreateForm.network} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, network: event.target.value as SupportedNetwork }))}>
                  <option value="TRC20">TRC20</option>
                  <option value="ERC20">ERC20</option>
                  <option value="BEP20">BEP20</option>
                  <option value="SOL">SOL</option>
                </select>
                <Input placeholder="Payment Methods (comma separated)" value={listingCreateForm.paymentMethods} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, paymentMethods: event.target.value }))} />
                <div className="space-y-2">
                  <Input
                    placeholder="Minimum Trade (Required)"
                    value={listingCreateForm.minimumTrade}
                    onChange={(event) => setListingCreateForm((prev) => ({ ...prev, minimumTrade: formatIntegerForInput(event.target.value) }))}
                    className={!listingCreateMinTrade && listingCreateAmount > 0 ? "border-amber-400/70" : ""}
                  />
                  <p className="text-xs text-[#9CA3AF]">The smallest trade amount you are willing to accept.</p>
                </div>
                <div className="space-y-2">
                  <Input
                    placeholder="Maximum Trade (Required)"
                    value={listingCreateForm.maximumTrade}
                    onChange={(event) => setListingCreateForm((prev) => ({ ...prev, maximumTrade: formatIntegerForInput(event.target.value) }))}
                    className={listingCreateTradeRangeInvalid ? "border-amber-400/70" : ""}
                  />
                  <p className="text-xs text-[#9CA3AF]">The largest amount a buyer can purchase in a single transaction.</p>
                </div>
                <Textarea className="md:col-span-2" placeholder="Seller Description" value={listingCreateForm.sellerDescription} onChange={(event) => setListingCreateForm((prev) => ({ ...prev, sellerDescription: event.target.value }))} />
                <div className="md:col-span-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">Bank selection *</p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {ISRAELI_BANKS.map((bank) => {
                      const selected = listingCreateForm.bankName === bank.name;
                      return (
                        <button
                          key={bank.id}
                          type="button"
                          onClick={() => setListingCreateForm((prev) => ({ ...prev, bankName: bank.name }))}
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
                </div>
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
                    <span>I understand and agree to Alpha Traders&apos; 1% commission policy.</span>
                  </label>
                  <p className="mt-2 text-xs text-[#D1D5DB]">Read full policy in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety &amp; Trust Center</Link>.</p>
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
                      {!listingCreateForm.bankName.trim() ? <p className="text-amber-200">Select a receiving bank before submitting.</p> : null}
                      {!listingCommissionAgreement ? <p className="text-amber-200">You must accept the 1% commission policy before publishing.</p> : null}
                      {listingCreateAmount > 0 ? <p>{listingCreateAmount.toLocaleString("en-IL")} USDT ≈ {formatIls(listingCreateAmount * marketPricePerUsdt)}</p> : null}
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" disabled={isListingCreateSubmitDisabled || listingActionKey === "create:new"}>
                    {listingActionKey === "create:new" ? "Publishing..." : "Submit Listing"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {sellerWorkspaceMessage ? (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]">
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

          <Card className="border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>{isAr ? "قائمتي" : "My Listings"}</CardTitle>
              <CardDescription>{isAr ? "إدارة جميع عروضك كبائع معتمد." : "Manage all of your approved seller listings."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!isLoadingListings && myListings.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-center">
                  <Store className="mx-auto h-5 w-5 text-[#C9A227]" />
                  <p className="mt-2 text-sm font-medium text-white">{isAr ? "ليس لديك عروض نشطة حتى الآن" : "You don&apos;t have any active listings yet."}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "أنشئ أول عرضك الآن ليبدأ المشترون بطلب الشراء." : "Create your first listing now and start receiving buyer requests."}</p>
                  <Button type="button" size="sm" className="mt-3" onClick={() => document.getElementById("create-listing-form")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                    {isAr ? "إنشاء عرض" : "Create Listing"}
                  </Button>
                </div>
              ) : null}
              {myListings.map((listing) => {
                const requestsCount = sellerRequests.filter((request) => request.listingId === listing.id).length;
                const listingBusy = isListingActionBusy(listing.id);
                return (
                  <div key={listing.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-[#93C5FD]">Listing {shortListingRef(listing)}</p>
                    <div className="grid gap-2 text-sm md:grid-cols-4">
                      <p>Status: <span className="text-white">{safeText(listing.status)}</span></p>
                      <p>Available Amount: <span className="text-white">{toNumber(listing.availableAmount).toLocaleString("en-IL")} USDT</span></p>
                      <p>Price: <span className="text-white">{formatIls(toNumber(listing.price))}</span></p>
                      <p>Network: <span className="text-white">{safeText(listing.network)}</span></p>
                      <p>Bank: <span className="text-white">{safeText(listing.bankName, "Not set")}</span></p>
                      <p>Purchase Requests: <span className="text-white">{requestsCount}</span></p>
                      <p>Created Date: <span className="text-white">{new Date(listing.createdAt).toLocaleDateString("en-IL")}</span></p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={listingBusy}
                        onClick={() => {
                          setEditingListingId(listing.id);
                          setListingEditForm({
                            availableAmount: listing.availableAmount,
                            price: listing.price,
                            currency: listing.currency,
                            network: listing.network,
                            paymentMethods: (listing.paymentMethods?.length ? listing.paymentMethods : [listing.paymentMethod]).join(", "),
                            bankName: listing.bankName ?? "",
                            minimumTrade: listing.minimumTrade ?? "0",
                            maximumTrade: listing.maximumTrade ?? listing.availableAmount,
                            sellerDescription: listing.sellerDescription ?? "",
                          });
                        }}
                      >
                        <Edit3 className="h-4 w-4" />
                        Edit
                      </Button>
                      {listing.status === "paused" ? (
                        <Button type="button" size="sm" variant="secondary" disabled={listingBusy} onClick={() => void handleSellerListingStatus(listing, "active")}>
                          <PlayCircle className="h-4 w-4" />
                          {listingActionKey === `${listing.id}:resume` ? "Resuming..." : "Resume"}
                        </Button>
                      ) : listing.status === "active" ? (
                        <Button type="button" size="sm" variant="secondary" disabled={listingBusy} onClick={() => void handleSellerListingStatus(listing, "paused")}>
                          <PauseCircle className="h-4 w-4" />
                          {listingActionKey === `${listing.id}:pause` ? "Pausing..." : "Pause"}
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="secondary" disabled={listingBusy} onClick={() => void handleSellerListingRenew(listing)}>
                        <Clock3 className="h-4 w-4" />
                        {listingActionKey === `${listing.id}:renew` ? "Renewing..." : "Renew"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={listingBusy} onClick={() => void handleSellerListingDelete(listing)}>
                        <Trash2 className="h-4 w-4" />
                        {listingActionKey === `${listing.id}:delete` ? "Deleting..." : "Delete"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={listingBusy} onClick={() => void handleSellerListingDuplicate(listing)}>
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
                        <Input className="md:col-span-2" value={listingEditForm.paymentMethods} onChange={(event) => setListingEditForm((prev) => ({ ...prev, paymentMethods: event.target.value }))} placeholder="Payment Methods (comma separated)" />
                        <Textarea className="md:col-span-2" value={listingEditForm.sellerDescription} onChange={(event) => setListingEditForm((prev) => ({ ...prev, sellerDescription: event.target.value }))} placeholder="Seller Description" />
                        <div className="md:col-span-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">Receiving bank *</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                            {ISRAELI_BANKS.map((bank) => {
                              const selected = listingEditForm.bankName === bank.name;
                              return (
                                <button
                                  key={`${listing.id}-${bank.id}`}
                                  type="button"
                                  onClick={() => setListingEditForm((prev) => ({ ...prev, bankName: bank.name }))}
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
                        </div>
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
                              {!listingEditForm.bankName.trim() ? <p className="text-amber-200">Select a receiving bank before saving.</p> : null}
                              {listingEditAmount > 0 ? <p>{listingEditAmount.toLocaleString("en-IL")} USDT ≈ {formatIls(listingEditAmount * marketPricePerUsdt)}</p> : null}
                            </div>
                          </div>
                        </div>
                        <div className="md:col-span-4 flex gap-2">
                          <Button type="submit" size="sm" disabled={isListingEditSubmitDisabled || listingActionKey === `${listing.id}:save`}>
                            {listingActionKey === `${listing.id}:save` ? "Saving..." : "Save"}
                          </Button>
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
                  <p className="mt-2 text-sm font-medium text-white">{isAr ? "لا توجد طلبات شراء قيد الانتظار" : "No purchase requests yet."}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "عند استلام أول طلب شراء، ستتمكن من الرد عليه فورًا من هنا." : "Your next buyer request will appear here with quick actions to accept, decline, or continue the trade."}</p>
                </div>
              ) : null}
              {filteredSellerRequests.map((request) => {
                return (
                  <div key={request.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-[#93C5FD]">{shortTradeRef(request)}</p>
                    <div className="grid gap-2 text-sm md:grid-cols-3">
                      <p>Trade Ref: <span className="text-white">{shortTradeRef(request)}</span></p>
                      <p>Buyer Name: <span className="text-white">{request.buyerName}</span></p>
                      <p>WhatsApp: <span className="text-white">{request.buyerWhatsapp}</span></p>
                      <p>USDT Amount: <span className="text-white">{toNumber(request.usdtAmount).toLocaleString("en-IL")}</span></p>
                      <p>Fiat Amount: <span className="text-white">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</span></p>
                      <p>Network: <span className="text-white">{request.network}</span></p>
                      <p>Payment Method: <span className="text-white">{request.paymentMethod}</span></p>
                      <p>Listing: <span className="text-white">{shortListingRef({ id: request.listingId, displayNumber: myListingsById.get(request.listingId)?.displayNumber })}</span></p>
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

            {notificationCenterCard}
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
                      onClick={() => document.getElementById("create-listing-form")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      Create New Listing
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card className="border-white/10 bg-[#0B0B0B]/90">
            <CardHeader>
              <CardTitle>Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!activityHistory.length ? (
                <p className="text-xs text-[#9CA3AF]">Your timeline updates automatically as you trade, review, and manage listings.</p>
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
                {filteredBuyerRequests.map((request) => (
                  <div key={request.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-[#93C5FD]">{shortTradeRef(request)}</p>
                    <div className="grid gap-2 text-sm md:grid-cols-3">
                      <p>Trade Ref: <span className="text-white">{shortTradeRef(request)}</span></p>
                      <p>Listing: <span className="text-white">{shortListingRef({ id: request.listingId, displayNumber: listingsById.get(request.listingId)?.displayNumber })}</span></p>
                      <p>Status: <span className="text-white">{tradeStatusLabel(request.status)}</span></p>
                      <p>USDT Amount: <span className="text-white">{toNumber(request.usdtAmount).toLocaleString("en-IL")}</span></p>
                      <p>Fiat Amount: <span className="text-white">{toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}</span></p>
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
          {sessionUser ? notificationCenterCard : null}
          {sessionUser ? marketInsightsCard : null}
          {sessionUser ? (
            <Card className="border-white/10 bg-[#0B0B0B]/90 md:col-span-2">
              <CardHeader>
                <CardTitle>Activity Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!activityHistory.length ? (
                  <p className="text-xs text-[#9CA3AF]">Your timeline updates automatically as you trade, review, and manage listings.</p>
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

      <div className="mt-12">
        <h2 className="text-2xl font-semibold md:text-3xl">FAQ</h2>
        <div className="mt-5 space-y-3">
          {faqs.map((item) => (
            <details key={item.q} className="group rounded-2xl border border-white/10 bg-[#0B0B0B]/85 p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-medium text-white">
                {item.q}
                <CheckCircle2 className="h-4 w-4 text-[#C9A227] transition group-open:rotate-12" />
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
              <a href="#marketplace">
                <Button>{isAr ? "ابدأ التداول" : "Start Trading"}</Button>
              </a>
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                <Button variant="secondary" className="gap-2">
                  <MessageCircle className="h-4 w-4" />
                  {isAr ? "تواصل عبر واتساب" : "Contact on WhatsApp"}
                </Button>
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
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sellerProfileData.profile.profilePhotoUrl} alt={`${sellerProfileData.profile.sellerName} profile`} className="h-20 w-20 rounded-full border-2 border-[#0B0B0B] object-cover" />
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
                            <p className="profile-identity-name--seller text-lg font-semibold">{sellerProfileData?.profile.sellerName ?? selectedListing.sellerDisplayName}</p>
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
                      <p className="mt-2">{safeText(sellerProfileData?.profile.bio || selectedListing.sellerDescription, "Not provided yet.")}</p>
                      <div className="mt-3 grid gap-1 text-xs">
                        <p>Trading Experience: <span className="text-white">{safeText(sellerProfileData?.profile.tradingExperience, "Not provided yet.")}</span></p>
                        <p>Languages: <span className="text-white">{(sellerProfileData?.profile.languages ?? []).join(", ") || "Not provided yet."}</span></p>
                        <p>Working Hours: <span className="text-white">{safeText(sellerProfileData?.profile.workingHours, "Not provided yet.")}</span></p>
                        <p>Payment Methods: <span className="text-white">{(sellerProfileData?.profile.preferredPaymentMethods ?? [selectedListing.paymentMethod]).join(", ")}</span></p>
                        <p>Supported Networks: <span className="text-white">{(sellerProfileData?.profile.preferredNetworks ?? [selectedListing.network]).join(", ")}</span></p>
                        <p>Country: <span className="text-white">{safeText(sellerProfileData?.profile.country, "Not provided yet.")}</span></p>
                        {sellerProfileData?.profile.city ? <p>City: <span className="text-white">{sellerProfileData.profile.city}</span></p> : null}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Listing & Trade Quote</p>
                      <div className="mt-2 space-y-1 text-xs">
                        <p>Available Amount: <span className="text-white">{selectedListing.availableAmount}</span></p>
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
                      <div className="space-y-2 md:col-span-3">
                        <Input
                          placeholder="USDT Amount"
                          value={buyerInfo.usdtAmount}
                          onChange={(event) => setBuyerInfo((prev) => ({ ...prev, usdtAmount: formatIntegerForInput(event.target.value) }))}
                          className={buyerTradeAmountInvalid ? "border-red-500/80" : ""}
                        />
                        <p className={`text-xs ${buyerTradeAmountInvalid ? "text-red-300" : "text-[#9CA3AF]"}`}>
                          Trade limits: {selectedMinTrade.toLocaleString("en-IL")} - {selectedMaxTrade.toLocaleString("en-IL")} USDT
                        </p>
                      </div>
                      <Input placeholder="Name" value={buyerInfo.name} onChange={(event) => setBuyerInfo((prev) => ({ ...prev, name: event.target.value }))} />
                      <Input placeholder="WhatsApp" value={buyerInfo.whatsapp} onChange={(event) => setBuyerInfo((prev) => ({ ...prev, whatsapp: event.target.value }))} />
                      <Textarea placeholder="Notes" value={buyerInfo.notes} onChange={(event) => setBuyerInfo((prev) => ({ ...prev, notes: event.target.value }))} />
                    </div>
                    {selectedListingRequiresSafetyNotice ? (
                      <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                        <p className="font-semibold text-[#FDE68A]">Privacy &amp; Safety Notice</p>
                        <p className="mt-1 text-[#E5E7EB]">Alpha Traders protects the privacy of buyers and sellers. Share only required details, meet in safe public locations, and never move payments outside the official trade flow.</p>
                        <label className="mt-2 inline-flex cursor-pointer items-start gap-2 text-[#E5E7EB]">
                          <input
                            type="checkbox"
                            checked={faceToFaceSafetyAcknowledged}
                            onChange={(event) => setFaceToFaceSafetyAcknowledged(event.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-white/25 bg-black/40 text-[#C9A227] focus:ring-[#C9A227]"
                          />
                          <span>I have read and understand the privacy and safety guidelines.</span>
                        </label>
                        <p className="mt-1 text-[#D1D5DB]">Read full guidance in the <Link href="/safety-trust" locale={locale} className="text-[#93C5FD] underline underline-offset-2">Safety &amp; Trust Center</Link>.</p>
                      </div>
                    ) : null}
                    <div className="sticky bottom-0 z-10 rounded-xl border border-[#C9A227]/30 bg-[#0B0B0B]/95 p-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <Button type="submit" className="w-full" disabled={buyerTradeAmountInvalid || (selectedListingRequiresSafetyNotice && !faceToFaceSafetyAcknowledged)}>Start Trade</Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full"
                          disabled={buyerTradeAmountInvalid || (selectedListingRequiresSafetyNotice && !faceToFaceSafetyAcknowledged)}
                          onClick={() => void submitPurchaseRequest("Please proceed with this trade.")}
                        >
                          Quick Buy
                        </Button>
                      </div>
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
