"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BarChart3, CheckCircle2, Coins, FileClock, FileSearch, ListChecks, Search, Settings, ShieldCheck, Star, Store, TrendingUp, Users, Users2, WalletCards, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RoleBadge } from "@/components/ui/role-badge";
import type { AlphaExchangeActivityLogEntry, AlphaExchangeNotification, AuditLogEntry, BetaAnnouncement, BetaAnnouncementType, BetaFeedbackCategory, CommissionRecord, MarketplaceListing, OwnerBusinessDashboardMetrics, OwnerPrivateBetaDashboardData, PurchaseRequest, SellerApplication, SellerAvailabilityStatus, SellerLevel, SellerReviewRecord, SupportedNetwork } from "@/types/alpha-exchange";

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
};

type SectionKey =
  | "overview"
  | "seller-applications"
  | "approved-sellers"
  | "marketplace-listings"
  | "purchase-requests"
  | "commissions"
  | "audit-logs"
  | "private-beta"
  | "settings"
  | "users"
  | "reviews"
  | "analytics"
  | "emergency";

const pageSize = 8;

const sectionItems: Array<{ key: SectionKey; label: string; icon: typeof BarChart3 }> = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "seller-applications", label: "Seller Applications", icon: FileSearch },
  { key: "approved-sellers", label: "Approved Sellers", icon: Users },
  { key: "marketplace-listings", label: "Marketplace Listings", icon: Store },
  { key: "purchase-requests", label: "Purchase Requests", icon: ListChecks },
  { key: "commissions", label: "Commissions", icon: Coins },
  { key: "audit-logs", label: "Audit Logs", icon: FileClock },
  { key: "private-beta", label: "Access Control", icon: ShieldCheck },
  { key: "analytics", label: "Analytics", icon: TrendingUp },
  { key: "users", label: "User Management", icon: Users2 },
  { key: "reviews", label: "Reviews", icon: Star },
  { key: "emergency", label: "Emergency", icon: Zap },
  { key: "settings", label: "Settings", icon: Settings },
];

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IL", { dateStyle: "medium", timeStyle: "short" }).format(date);
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

function sellerLevelLabel(level?: SellerLevel) {
  if (level === "legendary") return "Legendary";
  if (level === "diamond") return "Diamond";
  if (level === "platinum") return "Platinum";
  if (level === "gold") return "Gold";
  if (level === "silver") return "Silver";
  return "Bronze";
}

function isSellerLevel(value: string): value is SellerLevel {
  return value === "bronze" || value === "silver" || value === "gold" || value === "platinum" || value === "diamond" || value === "legendary";
}

function feedbackCategoryLabel(value: BetaFeedbackCategory) {
  if (value === "bug") return "Bug";
  if (value === "suggestion") return "Suggestion";
  if (value === "confusing_ux") return "Confusing UX";
  if (value === "feature_request") return "Feature Request";
  if (value === "performance") return "Performance";
  return "Other";
}

function safeAdminError(scope: "load" | "action") {
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

export function AlphaExchangeAdminDashboard() {
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [data, setData] = useState<AdminPayload | null>(null);

  const [applicationsQuery, setApplicationsQuery] = useState("");
  const [applicationsStatus, setApplicationsStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [applicationsSort, setApplicationsSort] = useState<"newest" | "oldest" | "name">("newest");
  const [applicationsPage, setApplicationsPage] = useState(1);

  const [sellersQuery, setSellersQuery] = useState("");
  const [sellersStatus, setSellersStatus] = useState<"all" | "approved_seller" | "suspended">("all");
  const [sellersSort, setSellersSort] = useState<"newest" | "oldest" | "name">("newest");
  const [sellersPage, setSellersPage] = useState(1);
  const [selectedSeller, setSelectedSeller] = useState<AdminSeller | null>(null);

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
  const [inviteMaxUses, setInviteMaxUses] = useState("10");
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [betaFeedbackStatusFilter, setBetaFeedbackStatusFilter] = useState<"all" | "new" | "in_review" | "resolved">("all");
  const [announcementType, setAnnouncementType] = useState<BetaAnnouncementType>("maintenance");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const toastTimeoutRef = useRef<number | null>(null);

  const [usersQuery, setUsersQuery] = useState("");
  const [usersPage, setUsersPage] = useState(1);
  const [usersRoleFilter, setUsersRoleFilter] = useState<"all" | string>("all");
  const [reviewsQuery, setReviewsQuery] = useState("");
  const [reviewsPage, setReviewsPage] = useState(1);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastType, setBroadcastType] = useState<"info" | "warning" | "success">("info");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/alpha-exchange/admin-prep", { cache: "no-store" });
      const payload = (await response.json()) as AdminPayload & { error?: string };
      if (!response.ok) throw new Error(safeAdminError("load"));
      setData(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : safeAdminError("load"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

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

  const applicationsRows = useMemo(() => {
    const items = (data?.applications ?? []).filter((application) => {
      if (applicationsStatus !== "all" && application.status !== applicationsStatus) return false;
      const query = applicationsQuery.trim().toLowerCase();
      if (!query) return true;
      const haystack = `${application.fullName} ${application.email} ${application.whatsappNumber} ${application.preferredNetworks.join(" ")}`.toLowerCase();
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
      const haystack = `${listing.sellerDisplayName} ${listing.availableAmount} ${listing.price} ${listing.network}`.toLowerCase();
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
      const haystack = `${request.tradeId ?? request.id} ${request.buyerName} ${request.buyerWhatsapp} ${seller?.fullName ?? request.sellerId} ${listing?.id ?? request.listingId}`.toLowerCase();
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
      const haystack = `${record.id} ${tradeId} ${request?.buyerName ?? record.buyerId} ${seller?.fullName ?? record.sellerId}`.toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...items].sort((a, b) => {
      if (commissionsSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (commissionsSort === "highest") return b.commissionAmount - a.commissionAmount;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return paginate(sorted, commissionsPage);
  }, [commissionsPage, commissionsQuery, commissionsSort, data?.commissionRecords, requestsById, sellersById]);

  const auditRows = useMemo(() => {
    const items = (data?.auditLogs ?? []).filter((entry) => {
      if (auditAction !== "all" && entry.action !== auditAction) return false;
      const query = auditQuery.trim().toLowerCase();
      if (!query) return true;
      const actor = sellersById.get(entry.actorUserId)?.fullName ?? entry.actorUserId;
      const tradeId = entry.purchaseRequestId ? (requestsById.get(entry.purchaseRequestId)?.tradeId ?? entry.purchaseRequestId) : "";
      const haystack = `${entry.action} ${entry.details ?? ""} ${actor} ${entry.listingId ?? ""} ${tradeId}`.toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...items].sort((a, b) => {
      if (auditSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return paginate(sorted, auditPage);
  }, [auditAction, auditPage, auditQuery, auditSort, data?.auditLogs, requestsById, sellersById]);

  const notificationRows = useMemo(() => {
    const items = (data?.notifications ?? []).filter((entry) => {
      const query = notificationQuery.trim().toLowerCase();
      if (!query) return true;
      const seller = sellersById.get(entry.userId);
      const haystack = `${entry.title} ${entry.message} ${entry.category} ${seller?.fullName ?? entry.userId} ${entry.relatedTradeId ?? ""} ${entry.relatedListingId ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
    return paginate(items, notificationPage);
  }, [data?.notifications, notificationPage, notificationQuery, sellersById]);

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

  async function runAction(request: Promise<Response>, successMessage: string) {
    try {
      const response = await request;
      let payload: { error?: string } | null = null;
      try {
        payload = (await response.json()) as { error?: string };
      } catch {
        payload = null;
      }
      if (!response.ok) throw new Error(payload?.error || safeAdminError("action"));
      pushToast(successMessage);
      await fetchData();
    } catch (actionError) {
      pushToast(actionError instanceof Error ? actionError.message : safeAdminError("action"));
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
      clearOverride ? "Prestige override cleared." : `Seller prestige set to ${sellerLevelLabel(rank)}.`,
    );
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
      "Access code created.",
    );
  }

  async function handleInviteStatus(inviteId: string, action: "expire" | "disable") {
    await runAction(
      fetch(`/api/alpha-exchange/admin/private-beta/invites/${inviteId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      }),
      action === "expire" ? "Invite expired." : "Invite disabled.",
    );
  }

  async function handleFeedbackStatus(feedbackId: string, status: "new" | "in_review" | "resolved") {
    await runAction(
      fetch(`/api/alpha-exchange/admin/private-beta/feedback/${feedbackId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }),
      "Feedback status updated.",
    );
  }

  async function handleCreateAnnouncement() {
    await runAction(
      fetch("/api/alpha-exchange/admin/private-beta/announcements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: announcementType,
          title: announcementTitle,
          message: announcementMessage,
        }),
      }),
      "Announcement published.",
    );
    setAnnouncementTitle("");
    setAnnouncementMessage("");
  }

  async function handleAnnouncementState(announcement: BetaAnnouncement, isActive: boolean) {
    await runAction(
      fetch(`/api/alpha-exchange/admin/private-beta/announcements/${announcement.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive }),
      }),
      isActive ? "Announcement enabled." : "Announcement disabled.",
    );
  }

  async function handleForceComplete(requestId: string) {
    const reason = window.prompt("Reason for force-completing this trade:");
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/purchase-requests/${requestId}/force-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? "Trade force-completed." : (p.error ?? "Error"));
    if (r.ok) { setSelectedRequest(null); await fetchData(); }
  }

  async function handleForceCancel(requestId: string) {
    const reason = window.prompt("Reason for cancelling this trade:");
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/purchase-requests/${requestId}/force-cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? "Trade cancelled." : (p.error ?? "Error"));
    if (r.ok) { setSelectedRequest(null); await fetchData(); }
  }

  async function handleUnlockReview(requestId: string) {
    const reason = window.prompt("Reason for unlocking review:");
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/purchase-requests/${requestId}/unlock-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? "Review window unlocked." : (p.error ?? "Error"));
    if (r.ok) await fetchData();
  }

  async function handleReverifyCommission(commissionId: string) {
    if (!window.confirm("Reverify this commission against the blockchain now?")) return;
    const reason = requestReason("Reason for reverifying this commission:", "Manual admin reverification");
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/commissions/${commissionId}/reverify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const p = await r.json() as { error?: string; notes?: string };
    pushToast(r.ok ? `Reverification: ${p.notes ?? "complete"}` : (p.error ?? "Error"));
    if (r.ok) await fetchData();
  }

  async function handleChangeUserRole(userId: string, currentRole: string) {
    const newRole = window.prompt(`Change role for user (current: ${currentRole})\nOptions: buyer, approved_seller, admin, owner`);
    if (!newRole) return;
    if (!window.confirm(`Change this user's role from ${currentRole} to ${newRole.trim()}?`)) return;
    const reason = window.prompt("Reason for role change:");
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/users/${userId}/role`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: newRole, reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? "Role updated." : (p.error ?? "Error"));
    if (r.ok) await fetchData();
  }

  async function handleDisableUser(userId: string, disabled: boolean) {
    if (!window.confirm(`${disabled ? "Disable" : "Enable"} this account?`)) return;
    const reason = window.prompt(`Reason for ${disabled ? "disabling" : "enabling"} this account:`);
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/users/${userId}/disable`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled, reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? `Account ${disabled ? "disabled" : "enabled"}.` : (p.error ?? "Error"));
    if (r.ok) await fetchData();
  }

  async function handleModerateReview(reviewId: string, hide: boolean) {
    const reason = window.prompt(`Reason for ${hide ? "hiding" : "restoring"} this review:`);
    if (!reason) return;
    const r = await fetch(`/api/alpha-exchange/admin/reviews/${reviewId}/moderate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hide, reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? `Review ${hide ? "hidden" : "restored"}.` : (p.error ?? "Error"));
    if (r.ok) await fetchData();
  }

  async function handleBroadcast() {
    if (!broadcastTitle.trim() || !broadcastBody.trim()) { pushToast("Title and body are required."); return; }
    if (!window.confirm("Broadcast this notification to all users?")) return;
    const reason = requestReason("Reason for this broadcast:", "Operational announcement");
    if (!reason) return;
    const r = await fetch("/api/alpha-exchange/admin/notifications/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: broadcastTitle, body: broadcastBody, type: broadcastType, reason }) });
    const p = await r.json() as { error?: string };
    pushToast(r.ok ? "Broadcast sent." : (p.error ?? "Error"));
    if (r.ok) { setBroadcastTitle(""); setBroadcastBody(""); }
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
        const tradeId = request?.tradeId ?? record.tradeId ?? record.purchaseRequestId;
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
          request.tradeId ?? "",
          request.id,
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
          Page {page} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
            Previous
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
            Next
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
            <p className="mt-1 text-xs text-[#9CA3AF]">Adjust your filters or search terms to view matching results.</p>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <section className="section-container page-shell">
      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)] xl:items-start">
        <aside className="h-fit rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-4 backdrop-blur-sm xl:sticky xl:top-4">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#C9A227]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Alpha Exchange Admin
          </p>
          <nav className="space-y-1">
            {sectionItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  aria-label={`Open ${item.label}`}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${isActive ? "border border-[#C9A227]/30 bg-[#C9A227]/10 text-white" : "text-[#9CA3AF] hover:bg-white/5 hover:text-white"}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div key={activeSection} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
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
                    <span className="text-sm text-red-200">{safeAdminError("load")}</span>
                  </CardContent>
                </Card>
              ) : null}

              {!loading && !error && data ? (
                <>
                  {activeSection === "overview" ? (
                    <div className="space-y-5 xl:space-y-6">
                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle>Owner Business Dashboard</CardTitle>
                          <CardDescription>Business health at a glance for Alpha Exchange.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          {[
                            { label: "Today • Completed Trades", value: data.ownerBusiness.today.completedTrades, icon: CheckCircle2 },
                            { label: "Today • Trade Volume", value: formatUsdt(data.ownerBusiness.today.tradeVolumeUsdt), icon: WalletCards },
                            { label: "Today • Estimated Commission", value: formatCurrency(data.ownerBusiness.today.estimatedCommission), icon: Coins },
                            { label: "Today • Trades Waiting Evidence", value: data.ownerBusiness.today.tradesWaitingEvidence, icon: AlertTriangle },
                          ].map((stat) => {
                            const Icon = stat.icon;
                            return (
                              <Card key={stat.label} className="border-white/10 bg-black/20">
                                <CardHeader className="pb-2">
                                  <CardDescription className="text-xs uppercase tracking-[0.15em] text-[#9CA3AF]">{stat.label}</CardDescription>
                                  <CardTitle className="text-2xl">{stat.value}</CardTitle>
                                </CardHeader>
                                <CardContent className="pt-0">
                                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 text-[#C9A227]">
                                    <Icon className="h-4 w-4" />
                                  </span>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </CardContent>
                      </Card>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>Today</CardTitle>
                            <CardDescription>Operational metrics for the current day.</CardDescription>
                          </CardHeader>
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2 xl:grid-cols-3">
                            <p>Completed Trades: <span className="text-white">{data.ownerBusiness.today.completedTrades}</span></p>
                            <p>Trade Volume: <span className="text-white">{formatUsdt(data.ownerBusiness.today.tradeVolumeUsdt)}</span></p>
                            <p>Estimated Commission: <span className="text-white">{formatCurrency(data.ownerBusiness.today.estimatedCommission)}</span></p>
                            <p>New Buyers: <span className="text-white">{data.ownerBusiness.today.newBuyers}</span></p>
                            <p>New Sellers: <span className="text-white">{data.ownerBusiness.today.newSellers}</span></p>
                            <p>New Listings: <span className="text-white">{data.ownerBusiness.today.newListings}</span></p>
                            <p>Listings Approved: <span className="text-white">{data.ownerBusiness.today.listingsApproved}</span></p>
                            <p>Listings Rejected: <span className="text-white">{data.ownerBusiness.today.listingsRejected}</span></p>
                            <p>Pending Listings: <span className="text-white">{data.ownerBusiness.today.pendingListings}</span></p>
                            <p>Pending Seller Applications: <span className="text-white">{data.ownerBusiness.today.pendingSellerApplications}</span></p>
                            <p>Open Disputes: <span className="text-white">{data.ownerBusiness.today.openDisputes}</span></p>
                            <p>Resolved Disputes: <span className="text-white">{data.ownerBusiness.today.resolvedDisputes}</span></p>
                            <p>Missing Buyer Evidence: <span className="text-white">{data.ownerBusiness.today.missingBuyerEvidence}</span></p>
                            <p>Missing Seller Evidence: <span className="text-white">{data.ownerBusiness.today.missingSellerEvidence}</span></p>
                            <p>Trades Waiting Evidence: <span className="text-white">{data.ownerBusiness.today.tradesWaitingEvidence}</span></p>
                            <p>Evidence Verified: <span className="text-white">{data.ownerBusiness.today.evidenceVerified}</span></p>
                            <p>Evidence Missing: <span className="text-white">{data.ownerBusiness.today.evidenceMissing}</span></p>
                          </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>This Week</CardTitle>
                            <CardDescription>Weekly business momentum and trust movement.</CardDescription>
                          </CardHeader>
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2 xl:grid-cols-3">
                            <p>Trade Volume: <span className="text-white">{formatUsdt(data.ownerBusiness.thisWeek.tradeVolumeUsdt)}</span></p>
                            <p>Revenue: <span className="text-white">{formatCurrency(data.ownerBusiness.thisWeek.revenue)}</span></p>
                            <p>Top Seller: <span className="text-white">{data.ownerBusiness.thisWeek.topSeller}</span></p>
                            <p>Fastest Growing Seller: <span className="text-white">{data.ownerBusiness.thisWeek.fastestGrowingSeller}</span></p>
                            <p>Highest Trust Score Increase: <span className="text-white">{data.ownerBusiness.thisWeek.highestTrustScoreIncrease}</span></p>
                            <p>Avg Response Time: <span className="text-white">{data.ownerBusiness.thisWeek.averageResponseTimeMinutes.toFixed(2)} min</span></p>
                            <p>Avg Completion Time: <span className="text-white">{data.ownerBusiness.thisWeek.averageTradeCompletionTimeMinutes.toFixed(2)} min</span></p>
                            <p>Avg Buyer Rating: <span className="text-white">{data.ownerBusiness.thisWeek.averageBuyerRating.toFixed(2)}</span></p>
                            <p>Repeat Buyers: <span className="text-white">{formatPercent(data.ownerBusiness.thisWeek.repeatBuyersPercent)}</span></p>
                          </CardContent>
                        </Card>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>Seller Leaderboard</CardTitle>
                            <CardDescription>Top sellers ranked by trust and marketplace performance.</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-2 text-sm">
                            {data.ownerBusiness.sellerLeaderboard.slice(0, 5).map((seller, index) => (
                              <div key={seller.sellerId} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                                <div>
                                  <p className="font-medium text-white">#{index + 1} {seller.sellerName}</p>
                                  <p className="text-xs text-[#9CA3AF]">
                                    Trust {seller.trustScore.toFixed(1)} • Volume {formatUsdt(seller.tradeVolumeUsdt)} • Trades {seller.completedTrades}
                                  </p>
                                </div>
                                <p className="text-xs text-[#D1D5DB]">
                                  Rating {seller.averageRating.toFixed(2)} • {seller.responseTimeMinutes.toFixed(2)} min
                                </p>
                              </div>
                            ))}
                            {!data.ownerBusiness.sellerLeaderboard.length ? <p className="text-[#9CA3AF]">No seller leaderboard data yet.</p> : null}
                          </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>Marketplace Health</CardTitle>
                            <CardDescription>Core performance, risk, and participation indicators.</CardDescription>
                          </CardHeader>
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2 xl:grid-cols-2">
                            <p>Completion Rate: <span className="text-white">{formatPercent(data.ownerBusiness.marketplaceHealth.completionRatePercent)}</span></p>
                            <p>Cancellation Rate: <span className="text-white">{formatPercent(data.ownerBusiness.marketplaceHealth.cancellationRatePercent)}</span></p>
                            <p>Dispute Rate: <span className="text-white">{formatPercent(data.ownerBusiness.marketplaceHealth.disputeRatePercent)}</span></p>
                            <p>Average Trust Score: <span className="text-white">{data.ownerBusiness.marketplaceHealth.averageTrustScore.toFixed(2)}</span></p>
                            <p>Active Sellers: <span className="text-white">{data.ownerBusiness.marketplaceHealth.activeSellers}</span></p>
                            <p>Active Buyers: <span className="text-white">{data.ownerBusiness.marketplaceHealth.activeBuyers}</span></p>
                            <p>Listings Sold: <span className="text-white">{data.ownerBusiness.marketplaceHealth.listingsSold}</span></p>
                            <p>Listings Waiting Approval: <span className="text-white">{data.ownerBusiness.marketplaceHealth.listingsWaitingApproval}</span></p>
                          </CardContent>
                        </Card>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>Financial Overview</CardTitle>
                            <CardDescription>Commission and trade-value performance snapshot.</CardDescription>
                          </CardHeader>
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2 xl:grid-cols-2">
                            <p>Commission Today: <span className="text-white">{formatCurrency(data.ownerBusiness.financialOverview.estimatedCommissionToday)}</span></p>
                            <p>Commission This Week: <span className="text-white">{formatCurrency(data.ownerBusiness.financialOverview.estimatedCommissionThisWeek)}</span></p>
                            <p>Commission This Month: <span className="text-white">{formatCurrency(data.ownerBusiness.financialOverview.estimatedCommissionThisMonth)}</span></p>
                            <p>Largest Trade: <span className="text-white">{formatUsdt(data.ownerBusiness.financialOverview.largestTradeUsdt)}</span></p>
                            <p>Largest Trade ID: <span className="text-white">{data.ownerBusiness.financialOverview.largestTradeId}</span></p>
                            <p>Largest Seller: <span className="text-white">{data.ownerBusiness.financialOverview.largestSeller}</span></p>
                            <p>Average Trade Size: <span className="text-white">{formatUsdt(data.ownerBusiness.financialOverview.averageTradeSizeUsdt)}</span></p>
                          </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>Live Activity</CardTitle>
                            <CardDescription>Recent marketplace events for owner oversight.</CardDescription>
                          </CardHeader>
                          <CardContent className="max-h-[360px] space-y-2 overflow-y-auto text-sm text-[#D1D5DB]">
                            {data.ownerBusiness.liveActivity.slice(0, 10).map((entry) => (
                              <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                                <p className="text-white">{entry.message}</p>
                                <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">
                                  {entry.type.replaceAll("_", " ")} • {formatDate(entry.createdAt)}
                                </p>
                              </div>
                            ))}
                            {!data.ownerBusiness.liveActivity.length ? <p className="text-[#9CA3AF]">No recent activity.</p> : null}
                          </CardContent>
                        </Card>
                      </div>

                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle>Trust Engine</CardTitle>
                          <CardDescription>
                            Marketplace trust average: {data.trustEngine.marketplaceHealth.averageTrustScore}/100 across {data.trustEngine.marketplaceHealth.sellerCount} sellers.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Highest Trust Sellers</p>
                            <div className="mt-3 space-y-2 text-sm text-[#D1D5DB]">
                              {data.trustEngine.highestTrustSellers.slice(0, 5).map((seller) => (
                                <p key={seller.sellerId}>
                                  <span className="text-white">{seller.sellerName}</span> — {seller.trustScore}/100
                                </p>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Accounts Losing Trust</p>
                            <div className="mt-3 space-y-2 text-sm text-[#D1D5DB]">
                              {data.trustEngine.accountsLosingTrust.length ? data.trustEngine.accountsLosingTrust.slice(0, 5).map((seller) => (
                                <p key={seller.sellerId}>
                                  <span className="text-white">{seller.sellerName}</span> — {seller.trustDelta.toFixed(1)}
                                </p>
                              )) : <p className="text-[#9CA3AF]">No trust decline detected.</p>}
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Flagged Sellers</p>
                            <div className="mt-3 space-y-2 text-sm text-[#D1D5DB]">
                              {data.trustEngine.flaggedSellers.length ? data.trustEngine.flaggedSellers.slice(0, 5).map((seller) => (
                                <p key={seller.sellerId}>
                                  <span className="text-white">{seller.sellerName}</span> — {seller.reason}
                                </p>
                              )) : <p className="text-[#9CA3AF]">No sellers currently flagged.</p>}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ) : null}

                  {activeSection === "seller-applications" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>Seller Applications</CardTitle>
                        <CardDescription>Review, approve, or reject seller applications.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="pl-9" placeholder="Search applicant, email, WhatsApp..." value={applicationsQuery} onChange={(event) => setApplicationsQuery(event.target.value)} />
                          </div>
                          <select value={applicationsStatus} onChange={(event) => setApplicationsStatus(event.target.value as typeof applicationsStatus)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">Status: All</option>
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                          </select>
                          <select value={applicationsSort} onChange={(event) => setApplicationsSort(event.target.value as typeof applicationsSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">Sort: Newest</option>
                            <option value="oldest">Sort: Oldest</option>
                            <option value="name">Sort: Name</option>
                          </select>
                        </div>

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[900px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">Applicant</th>
                                <th className="px-4 py-3">WhatsApp</th>
                                <th className="px-4 py-3">Selling Methods</th>
                                <th className="px-4 py-3">Submitted Date</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {applicationsRows.rows.map((application) => (
                                <tr key={application.id} className="border-t border-white/10">
                                  <td className="px-4 py-3">
                                    <p className="font-medium text-white">{application.fullName}</p>
                                    <p className="text-xs text-[#9CA3AF]">{application.email}</p>
                                  </td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{application.whatsappNumber}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{application.preferredNetworks.join(", ")}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(application.createdAt)}</td>
                                  <td className="px-4 py-3">
                                    <span className={`rounded-full px-2.5 py-1 text-xs ${application.status === "approved" ? "border border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : application.status === "rejected" ? "border border-red-500/35 bg-red-500/10 text-red-300" : "border border-[#C9A227]/35 bg-[#C9A227]/10 text-[#C9A227]"}`}>
                                      {application.status}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        disabled={application.status !== "pending"}
                                        onClick={() => {
                                          if (!window.confirm("Approve this seller application?")) return;
                                          const reason = requestReason("Reason for approving this seller application:", "Seller approved for launch");
                                          if (!reason) return;
                                          void runAction(fetch(`/api/alpha-exchange/admin/seller-applications/${application.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), "Application approved.");
                                        }}
                                      >
                                        Approve
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        disabled={application.status !== "pending"}
                                        onClick={() => {
                                          if (!window.confirm("Reject this seller application?")) return;
                                          const reason = requestReason("Reason for rejecting this seller application:", "Application rejected");
                                          if (!reason) return;
                                          void runAction(fetch(`/api/alpha-exchange/admin/seller-applications/${application.id}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), "Application rejected.");
                                        }}
                                      >
                                        Reject
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {applicationsRows.rows.length === 0 ? renderEmptyTableRow("No seller applications match your filters.", 6) : null}
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
                        <CardTitle>Approved Sellers</CardTitle>
                        <CardDescription>Manage approved seller status and monitor activity.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="pl-9" placeholder="Search seller..." value={sellersQuery} onChange={(event) => setSellersQuery(event.target.value)} />
                          </div>
                          <select value={sellersStatus} onChange={(event) => setSellersStatus(event.target.value as typeof sellersStatus)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">Status: All</option>
                            <option value="approved_seller">Approved</option>
                            <option value="suspended">Suspended</option>
                          </select>
                          <select value={sellersSort} onChange={(event) => setSellersSort(event.target.value as typeof sellersSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">Sort: Newest</option>
                            <option value="oldest">Sort: Oldest</option>
                            <option value="name">Sort: Name</option>
                          </select>
                        </div>

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[980px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">Seller</th>
                                <th className="px-4 py-3">Member Since</th>
                                <th className="px-4 py-3">Prestige Rank</th>
                                <th className="px-4 py-3">Lifetime Volume</th>
                                <th className="px-4 py-3">Active Listings</th>
                                <th className="px-4 py-3">Completed Trades</th>
                                <th className="px-4 py-3">Current Status</th>
                                <th className="px-4 py-3">Actions</th>
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
                                            <RoleBadge key={badge} variant={badge as "guest" | "student" | "buyer" | "pending_seller" | "approved_seller" | "administrator" | "owner"} />
                                          ))}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(seller.createdAt)}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">
                                      <span className="font-medium capitalize text-white">{sellerLevelLabel(seller.sellerPrestigeRank)}</span>
                                      {seller.sellerRankOverride ? <p className="text-[11px] text-[#FDE68A]">Override active</p> : null}
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatUsdt(Math.max(0, Number(seller.lifetimeCompletedVolumeUsdt ?? 0)))}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{activeListings}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{completedTrades}</td>
                                    <td className="px-4 py-3">
                                      {isSuspended ? (
                                        <span className="rounded-full border border-red-500/35 bg-red-500/10 px-2.5 py-1 text-xs text-red-300">Suspended</span>
                                      ) : (
                                        <div className="flex flex-wrap gap-2">
                                          <RoleBadge variant="approved_seller" />
                                          <span className={`rounded-full px-2.5 py-1 text-xs ${isOnVacation ? "border border-amber-500/35 bg-amber-500/10 text-amber-300" : "border border-emerald-500/35 bg-emerald-500/10 text-emerald-300"}`}>
                                            {isOnVacation ? "Vacation" : seller.availabilityStatus ?? "available"}
                                          </span>
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        {!isSuspended ? (
                                          <Button type="button" size="sm" variant="secondary" onClick={() => {
                                            if (!window.confirm("Suspend this seller?")) return;
                                            const reason = requestReason("Reason for suspending this seller:", "Seller suspended");
                                            if (!reason) return;
                                            void runAction(fetch(`/api/alpha-exchange/admin/sellers/${seller.id}/suspend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), "Seller suspended.");
                                          }}>
                                            Suspend
                                          </Button>
                                        ) : (
                                          <Button type="button" size="sm" onClick={() => {
                                            if (!window.confirm("Reactivate this seller?")) return;
                                            const reason = requestReason("Reason for reactivating this seller:", "Seller reactivated");
                                            if (!reason) return;
                                            void runAction(fetch(`/api/alpha-exchange/admin/sellers/${seller.id}/reactivate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), "Seller reactivated.");
                                          }}>
                                            Reactivate
                                          </Button>
                                        )}
                                        {isOnVacation ? (
                                          <Button type="button" size="sm" variant="secondary" onClick={() => {
                                            if (!window.confirm("End vacation mode for this seller?")) return;
                                            const reason = requestReason("Reason for ending vacation mode:", "Vacation Mode ended.");
                                            if (!reason) return;
                                            void handleSellerAvailabilityStatus(seller.id, "available", "Vacation Mode ended.", reason);
                                          }}>
                                            End Vacation
                                          </Button>
                                        ) : (
                                          <Button type="button" size="sm" variant="secondary" onClick={() => {
                                            if (!window.confirm("Enable vacation mode for this seller?")) return;
                                            const reason = requestReason("Reason for enabling vacation mode:", "Vacation Mode enabled.");
                                            if (!reason) return;
                                            void handleSellerAvailabilityStatus(seller.id, "vacation", "Vacation Mode enabled.", reason);
                                          }}>
                                            Enable Vacation
                                          </Button>
                                        )}
                                        <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedSeller(seller)}>
                                          View Profile
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => {
                                            const nextRank = window.prompt("Set rank (bronze, silver, gold, platinum, diamond, legendary)", seller.sellerPrestigeRank ?? "bronze");
                                            if (!nextRank) return;
                                            const rankInput = nextRank.trim().toLowerCase();
                                            if (!isSellerLevel(rankInput)) {
                                              pushToast("Invalid prestige rank.");
                                              return;
                                            }
                                            const reason = window.prompt("Override reason", "Manual admin override");
                                            if (!reason) return;
                                            void handleSellerPrestigeOverride(seller.id, rankInput, reason, false);
                                          }}
                                        >
                                          Override Rank
                                        </Button>
                                        {seller.sellerRankOverride ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              const reason = window.prompt("Reason for clearing override", "Return to automatic progression");
                                              if (!reason) return;
                                              void handleSellerPrestigeOverride(seller.id, seller.sellerPrestigeRank ?? "bronze", reason, true);
                                            }}
                                          >
                                            Clear Override
                                          </Button>
                                        ) : null}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                              {sellersRows.rows.length === 0 ? renderEmptyTableRow("No approved sellers match your filters.", 8) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(sellersRows.safePage, sellersRows.totalPages, setSellersPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "marketplace-listings" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <CardTitle>Marketplace Listings</CardTitle>
                        <CardDescription>Manage listing availability and listing details.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-5">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="pl-9" placeholder="Search seller, amount, price..." value={listingsQuery} onChange={(event) => setListingsQuery(event.target.value)} />
                          </div>
                          <select value={listingsStatus} onChange={(event) => setListingsStatus(event.target.value as typeof listingsStatus)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">Status: All</option>
                            <option value="draft">Draft</option>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                            <option value="matched">Matched</option>
                            <option value="in_trade">In Trade</option>
                            <option value="expired">Expired</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="closed">Closed</option>
                          </select>
                          <select value={listingsNetwork} onChange={(event) => setListingsNetwork(event.target.value as typeof listingsNetwork)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">Network: All</option>
                            <option value="TRC20">TRC20</option>
                            <option value="ERC20">ERC20</option>
                            <option value="BEP20">BEP20</option>
                            <option value="SOL">SOL</option>
                          </select>
                          <select value={listingsSort} onChange={(event) => setListingsSort(event.target.value as typeof listingsSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">Sort: Newest</option>
                            <option value="price-asc">Price: Low to High</option>
                            <option value="price-desc">Price: High to Low</option>
                            <option value="amount-desc">Amount: High to Low</option>
                          </select>
                        </div>

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[1240px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">Seller</th>
                                <th className="px-4 py-3">Amount</th>
                                <th className="px-4 py-3">Price</th>
                                <th className="px-4 py-3">Network</th>
                                <th className="px-4 py-3">Bank</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Expiration</th>
                                <th className="px-4 py-3">Created</th>
                                <th className="px-4 py-3">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {listingsRows.rows.map((listing) => (
                                <tr key={listing.id} className="border-t border-white/10">
                                  <td className="px-4 py-3 text-white">{listing.sellerDisplayName}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{listing.availableAmount}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{listing.price}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{listing.network}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{listing.bankName ?? "—"}</td>
                                  <td className="px-4 py-3">
                                    <span className={`rounded-full px-2.5 py-1 text-xs ${listing.status === "active" ? "border border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : listing.status === "draft" ? "border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 text-[#93C5FD]" : listing.status === "matched" || listing.status === "in_trade" ? "border border-amber-500/35 bg-amber-500/10 text-amber-300" : listing.status === "completed" ? "border border-violet-500/35 bg-violet-500/10 text-violet-300" : listing.status === "cancelled" ? "border border-red-500/35 bg-red-500/10 text-red-300" : listing.status === "paused" ? "border border-[#C9A227]/35 bg-[#C9A227]/10 text-[#C9A227]" : "border border-white/20 bg-white/5 text-white/75"}`}>
                                      {listing.status}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-xs text-[#D1D5DB]">
                                    <p>{listing.expiresAt ? formatDate(listing.expiresAt) : "—"}</p>
                                    {listing.lastRenewedAt ? <p className="text-[11px] text-[#9CA3AF]">Renewed {formatDate(listing.lastRenewedAt)}</p> : null}
                                    {listing.expiredAt ? <p className="text-[11px] text-amber-300">Expired {formatDate(listing.expiredAt)}</p> : null}
                                  </td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(listing.createdAt)}</td>
                                  <td className="px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {listing.status === "draft" ? (
                                        <>
                                          <Button type="button" size="sm" onClick={() => runAction(fetch(`/api/alpha-exchange/admin/listings/${listing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve" }) }), "Listing approved.")}>
                                            Approve
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              const reason = window.prompt("Reject reason");
                                              if (!reason) return;
                                              void runAction(
                                                fetch(`/api/alpha-exchange/admin/listings/${listing.id}`, {
                                                  method: "PATCH",
                                                  headers: { "content-type": "application/json" },
                                                  body: JSON.stringify({ action: "reject", reason }),
                                                }),
                                                "Listing rejected.",
                                              );
                                            }}
                                          >
                                            Reject
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              const reason = window.prompt("Change request");
                                              if (!reason) return;
                                              void runAction(
                                                fetch(`/api/alpha-exchange/admin/listings/${listing.id}`, {
                                                  method: "PATCH",
                                                  headers: { "content-type": "application/json" },
                                                  body: JSON.stringify({ action: "request_changes", reason }),
                                                }),
                                                "Changes requested.",
                                              );
                                            }}
                                          >
                                            Request Changes
                                          </Button>
                                        </>
                                      ) : null}
                                      {(listing.status === "expired" || listing.status === "paused" || listing.status === "closed") ? (
                                        <Button type="button" size="sm" variant="secondary" onClick={() => {
                                          if (!window.confirm(`${listing.status === "closed" ? "Reopen" : "Renew"} this listing?`)) return;
                                          const reason = requestReason(`Reason for ${listing.status === "closed" ? "reopening" : "renewing"} this listing:`, listing.status === "closed" ? "Listing reopened by admin." : "Listing renewed by admin.");
                                          if (!reason) return;
                                          void handleAdminListingAction(listing.id, "renew", listing.status === "closed" ? "Listing reopened by admin." : "Listing renewed by admin.", 24, reason);
                                        }}>
                                          {listing.status === "closed" ? "Reopen" : "Renew"}
                                        </Button>
                                      ) : null}
                                      {listing.status !== "completed" && listing.status !== "cancelled" && listing.status !== "closed" ? (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => {
                                            if (!window.confirm("Extend this listing expiration?")) return;
                                            const hours = window.prompt("Extend expiration by hours (1, 6, 12, 24)", "24");
                                            if (!hours) return;
                                            const reason = requestReason("Reason for extending this listing:", "Listing expiration extended.");
                                            if (!reason) return;
                                            void handleAdminListingAction(listing.id, "extend", "Listing expiration extended.", Number(hours), reason);
                                          }}
                                        >
                                          Extend Expiration
                                        </Button>
                                      ) : null}
                                      {listing.status !== "closed" && listing.status !== "completed" && listing.status !== "cancelled" ? (
                                        <Button type="button" size="sm" variant="secondary" onClick={() => {
                                          if (!window.confirm("Close this listing?")) return;
                                          const reason = requestReason("Reason for closing this listing:", "Listing closed by admin.");
                                          if (!reason) return;
                                          void handleAdminListingAction(listing.id, "close", "Listing closed by admin.", undefined, reason);
                                        }}>
                                          Close
                                        </Button>
                                      ) : null}
                                      {(listing.status === "matched" || listing.status === "in_trade") ? (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => {
                                            const reason = window.prompt("Force-close reason", "Admin override");
                                            if (!reason) return;
                                            void handleAdminListingAction(listing.id, "force_close", "Listing force closed.", undefined, reason);
                                          }}
                                        >
                                          Force Close
                                        </Button>
                                      ) : null}
                                      <Button type="button" size="sm" variant="secondary" onClick={() => runAction(fetch(`/api/alpha-exchange/admin/listings/${listing.id}`, { method: "DELETE" }), "Listing deleted.")}>
                                        Delete
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {listingsRows.rows.length === 0 ? renderEmptyTableRow("No marketplace listings match your filters.", 9) : null}
                            </tbody>
                          </table>
                        </div>

                        <p className="mt-3 text-xs text-[#9CA3AF]">Owner-only Pending Listings page: /admin/alpha-exchange/pending-listings</p>
                        <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                          <p className="text-sm font-medium text-white">Expiration History</p>
                          <div className="mt-3 space-y-2 text-xs text-[#D1D5DB]">
                            {expirationHistory.slice(0, 10).map((entry) => (
                              <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="text-white">{entry.action}</p>
                                <p>{entry.details ?? "—"}</p>
                                <p className="text-[#9CA3AF]">{formatDate(entry.createdAt)}</p>
                              </div>
                            ))}
                            {expirationHistory.length === 0 ? <p className="text-[#9CA3AF]">No expiration events recorded yet.</p> : null}
                          </div>
                        </div>

                        {renderPagination(listingsRows.safePage, listingsRows.totalPages, setListingsPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "purchase-requests" ? (
                    <Card className="border-white/10 bg-[#0B0B0B]/90">
                      <CardHeader>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <CardTitle>Purchase Requests</CardTitle>
                            <CardDescription>Monitor request flow and inspect request details.</CardDescription>
                          </div>
                          <Button type="button" variant="secondary" onClick={exportTradesCsv}>
                            Export Trades
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="pl-9" placeholder="Search buyer, seller, listing..." value={requestsQuery} onChange={(event) => setRequestsQuery(event.target.value)} />
                          </div>
                          <select value={requestsStatus} onChange={(event) => setRequestsStatus(event.target.value as typeof requestsStatus)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">Status: All</option>
                            <option value="pending">Pending</option>
                            <option value="accepted">Accepted</option>
                            <option value="payment_sent">Payment Sent</option>
                            <option value="usdt_sent">USDT Sent</option>
                            <option value="declined">Declined</option>
                            <option value="completed">Completed</option>
                            <option value="locked">Locked</option>
                            <option value="review_open">Review Open</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                          <select value={requestsSort} onChange={(event) => setRequestsSort(event.target.value as typeof requestsSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">Sort: Newest</option>
                            <option value="oldest">Sort: Oldest</option>
                          </select>
                        </div>

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[980px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">Trade ID</th>
                                <th className="px-4 py-3">Buyer</th>
                                <th className="px-4 py-3">Seller</th>
                                <th className="px-4 py-3">Amount</th>
                                <th className="px-4 py-3">Listing</th>
                                <th className="px-4 py-3">Bank</th>
                                <th className="px-4 py-3">Current Status</th>
                                <th className="px-4 py-3">Submitted</th>
                                <th className="px-4 py-3">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {requestsRows.rows.map((request) => {
                                const listing = listingById.get(request.listingId);
                                const seller = sellersById.get(request.sellerId);
                                return (
                                  <tr key={request.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-[#D1D5DB]">{request.tradeId ?? request.id}</td>
                                    <td className="px-4 py-3 text-white">{request.buyerName}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{seller?.fullName ?? request.sellerId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{request.usdtAmount ?? listing?.availableAmount ?? "—"}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{request.listingId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{request.bankName ?? listing?.bankName ?? "—"}</td>
                                    <td className="px-4 py-3">
                                      <span className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-xs text-white/80">{request.status}</span>
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(request.createdAt)}</td>
                                    <td className="px-4 py-3">
                                      <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedRequest(request)}>
                                        View Details
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                              {requestsRows.rows.length === 0 ? renderEmptyTableRow("No purchase requests match your filters.", 9) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(requestsRows.safePage, requestsRows.totalPages, setRequestsPage)}
                        <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                          <p className="text-sm font-medium text-white">Timeout History</p>
                          <div className="mt-3 space-y-2 text-xs text-[#D1D5DB]">
                            {timeoutHistory.slice(0, 10).map((request) => (
                              <div key={request.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="text-white">{request.tradeId ?? request.id}</p>
                                <p>{request.timeoutReason ?? "Trade timed out."}</p>
                                <p className="text-[#9CA3AF]">{request.timedOutAt ? formatDate(request.timedOutAt) : "—"}</p>
                              </div>
                            ))}
                            {timeoutHistory.length === 0 ? <p className="text-[#9CA3AF]">No timeout events recorded yet.</p> : null}
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
                            <CardTitle>Commissions</CardTitle>
                            <CardDescription>Track all 1% service-fee records.</CardDescription>
                          </div>
                          <Button type="button" variant="secondary" onClick={exportCommissionsCsv}>
                            Export CSV
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="relative md:col-span-3">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="pl-9" placeholder="Search trade, buyer, seller..." value={commissionsQuery} onChange={(event) => setCommissionsQuery(event.target.value)} />
                          </div>
                          <select value={commissionsSort} onChange={(event) => setCommissionsSort(event.target.value as typeof commissionsSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">Sort: Newest</option>
                            <option value="oldest">Sort: Oldest</option>
                            <option value="highest">Sort: Highest Commission</option>
                          </select>
                        </div>

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[980px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">Trade ID</th>
                                <th className="px-4 py-3">Buyer</th>
                                <th className="px-4 py-3">Seller</th>
                                <th className="px-4 py-3">Trade Value</th>
                                <th className="px-4 py-3">1% Commission</th>
                                <th className="px-4 py-3">Payment Status</th>
                                <th className="px-4 py-3">Date</th>
                                <th className="px-4 py-3">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {commissionsRows.rows.map((record) => {
                                const request = (data.purchaseRequests ?? []).find((item) => item.id === record.purchaseRequestId);
                                const seller = sellersById.get(record.sellerId);
                                return (
                                  <tr key={record.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-[#D1D5DB]">{request?.tradeId ?? record.tradeId ?? record.purchaseRequestId}</td>
                                    <td className="px-4 py-3 text-white">{request?.buyerName ?? record.buyerId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{seller?.fullName ?? record.sellerId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatCurrency(record.grossAmount)}</td>
                                    <td className="px-4 py-3 text-[#C9A227]">{formatUsdt(record.commissionAmount)}</td>
                                    <td className="px-4 py-3">
                                      <span className={`rounded-full px-2.5 py-1 text-xs ${record.paymentStatus === "paid" ? "border border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : record.paymentStatus === "overdue" ? "border border-red-500/35 bg-red-500/10 text-red-300" : "border border-amber-500/35 bg-amber-500/10 text-amber-300"}`}>
                                        {record.paymentStatus}
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
                                              if (!window.confirm("Mark this commission as paid?")) return;
                                              const reason = requestReason("Reason for marking this commission paid:", "Commission manually marked paid.");
                                              if (!reason) return;
                                              void runAction(fetch(`/api/alpha-exchange/admin/commissions/${record.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentStatus: "paid", paymentVerificationStatus: "verified", reason }) }), "Commission marked paid.");
                                            }}
                                          >
                                            Mark Paid
                                          </Button>
                                        ) : (
                                          <span className="text-xs text-[#9CA3AF]">Settled</span>
                                        )}
                                        {record.paymentVerificationStatus !== "failed" ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              if (!window.confirm("Reject this commission payment verification?")) return;
                                              const reason = requestReason("Reason for rejecting this commission:", "Commission verification rejected.");
                                              if (!reason) return;
                                              void runAction(fetch(`/api/alpha-exchange/admin/commissions/${record.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentStatus: "pending", paymentVerificationStatus: "failed", paymentVerificationNotes: reason, reason }) }), "Commission rejected.");
                                            }}
                                          >
                                            Reject
                                          </Button>
                                        ) : null}
                                        {record.paymentStatus !== "pending" || record.paymentVerificationStatus === "failed" ? (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => {
                                              if (!window.confirm("Reset this commission to pending?")) return;
                                              const reason = requestReason("Reason for resetting this commission to pending:", "Commission reset to pending.");
                                              if (!reason) return;
                                              void runAction(fetch(`/api/alpha-exchange/admin/commissions/${record.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentStatus: "pending", paymentVerificationStatus: "pending_verification", paymentVerificationNotes: reason, reason }) }), "Commission reset to pending.");
                                            }}
                                          >
                                            Reset Pending
                                          </Button>
                                        ) : null}
                                        <Button type="button" size="sm" variant="secondary" onClick={() => void handleReverifyCommission(record.id)}>
                                          Reverify
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                              {commissionsRows.rows.length === 0 ? renderEmptyTableRow("No commission records match your filters.", 8) : null}
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
                        <CardTitle>Audit Logs</CardTitle>
                        <CardDescription>Newest actions first with full traceability.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="pl-9" placeholder="Search logs..." value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} />
                          </div>
                          <select value={auditAction} onChange={(event) => setAuditAction(event.target.value as typeof auditAction)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">Action: All</option>
                            <option value="seller_approved">seller_approved</option>
                            <option value="seller_rejected">seller_rejected</option>
                            <option value="seller_suspended">seller_suspended</option>
                            <option value="seller_reactivated">seller_reactivated</option>
                            <option value="listing_created">listing_created</option>
                            <option value="listing_expired">listing_expired</option>
                            <option value="listing_renewed">listing_renewed</option>
                            <option value="listing_expiration_extended">listing_expiration_extended</option>
                            <option value="listing_edited">listing_edited</option>
                            <option value="listing_closed">listing_closed</option>
                            <option value="admin_override">admin_override</option>
                            <option value="listing_removed">listing_removed</option>
                            <option value="purchase_request_submitted">purchase_request_submitted</option>
                            <option value="purchase_completed">purchase_completed</option>
                            <option value="trade_timed_out">trade_timed_out</option>
                            <option value="seller_vacation_enabled">seller_vacation_enabled</option>
                            <option value="seller_vacation_disabled">seller_vacation_disabled</option>
                            <option value="commission_overdue">commission_overdue</option>
                            <option value="commission_paid">commission_paid</option>
                            <option value="trade_review_submitted">trade_review_submitted</option>
                            <option value="trade_review_responded">trade_review_responded</option>
                            <option value="trust_score_updated">trust_score_updated</option>
                            <option value="seller_prestige_promoted">seller_prestige_promoted</option>
                            <option value="seller_prestige_overridden">seller_prestige_overridden</option>
                          </select>
                          <select value={auditSort} onChange={(event) => setAuditSort(event.target.value as typeof auditSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">Sort: Newest</option>
                            <option value="oldest">Sort: Oldest</option>
                          </select>
                        </div>

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[1180px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">Timestamp</th>
                                <th className="px-4 py-3">User</th>
                                <th className="px-4 py-3">Action</th>
                                <th className="px-4 py-3">Resource</th>
                                <th className="px-4 py-3">Reason</th>
                                <th className="px-4 py-3">Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {auditRows.rows.map((entry) => {
                                const actor = sellersById.get(entry.actorUserId);
                                return (
                                  <tr key={entry.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(entry.createdAt)}</td>
                                    <td className="px-4 py-3 text-white">{actor?.fullName ?? entry.actorUserId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.action}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.listingId ?? (entry.purchaseRequestId ? (requestsById.get(entry.purchaseRequestId)?.tradeId ?? entry.purchaseRequestId) : undefined) ?? entry.targetUserId ?? "system"}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.reason ?? "—"}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.details ?? "—"}</td>
                                  </tr>
                                );
                              })}
                              {auditRows.rows.length === 0 ? renderEmptyTableRow("No audit logs match your filters.", 6) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(auditRows.safePage, auditRows.totalPages, setAuditPage)}
                        <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm font-medium text-white">Notification History</p>
                            <Input className="max-w-sm" placeholder="Search notifications..." value={notificationQuery} onChange={(event) => setNotificationQuery(event.target.value)} />
                          </div>
                          <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full min-w-[980px] text-sm">
                              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                                <tr>
                                  <th className="px-4 py-3">Timestamp</th>
                                  <th className="px-4 py-3">Recipient</th>
                                  <th className="px-4 py-3">Category</th>
                                  <th className="px-4 py-3">Title</th>
                                  <th className="px-4 py-3">Message</th>
                                </tr>
                              </thead>
                              <tbody>
                                {notificationRows.rows.map((entry) => (
                                  <tr key={entry.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(entry.createdAt)}</td>
                                    <td className="px-4 py-3 text-white">{sellersById.get(entry.userId)?.fullName ?? entry.userId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.category}</td>
                                    <td className="px-4 py-3 text-white">{entry.title}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.message}</td>
                                  </tr>
                                ))}
                                {notificationRows.rows.length === 0 ? renderEmptyTableRow("No notifications match your search.", 5) : null}
                              </tbody>
                            </table>
                          </div>
                          <div className="mt-3">{renderPagination(notificationRows.safePage, notificationRows.totalPages, setNotificationPage)}</div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "private-beta" ? (
                    <div className="space-y-6">
                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle>Access Control</CardTitle>
                          <CardDescription>Onboarding controls and registration history.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid gap-3 md:grid-cols-4">
                            <Input value={inviteMaxUses} onChange={(event) => setInviteMaxUses(event.target.value)} placeholder="Max uses" />
                            <Input type="datetime-local" value={inviteExpiresAt} onChange={(event) => setInviteExpiresAt(event.target.value)} />
                            <div className="md:col-span-2">
                              <Button type="button" onClick={handleCreateInvite}>Generate Access Code</Button>
                            </div>
                          </div>
                          <div className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-3">
                            <p>Pending Invites: <span className="text-white">{data.privateBeta.pendingInvites.length}</span></p>
                            <p>Used Invites: <span className="text-white">{data.privateBeta.inviteUses.length}</span></p>
                            <p>Invite History: <span className="text-white">{data.privateBeta.inviteCodes.length}</span></p>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full min-w-[900px] text-sm">
                              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                                <tr>
                                  <th className="px-4 py-3">Code</th>
                                  <th className="px-4 py-3">Status</th>
                                  <th className="px-4 py-3">Usage</th>
                                  <th className="px-4 py-3">Expires</th>
                                  <th className="px-4 py-3">Created</th>
                                  <th className="px-4 py-3">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {data.privateBeta.inviteCodes.slice(0, 20).map((invite) => (
                                  <tr key={invite.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-white">{invite.code}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{invite.status}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{invite.usedCount}/{invite.maxUses}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{invite.expiresAt ? formatDate(invite.expiresAt) : "No expiry"}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(invite.createdAt)}</td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        <Button type="button" size="sm" variant="secondary" onClick={() => void handleInviteStatus(invite.id, "expire")}>
                                          Expire
                                        </Button>
                                        <Button type="button" size="sm" variant="secondary" onClick={() => void handleInviteStatus(invite.id, "disable")}>
                                          Disable
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                {!data.privateBeta.inviteCodes.length ? renderEmptyTableRow("No onboarding codes yet.", 6) : null}
                              </tbody>
                            </table>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full min-w-[760px] text-sm">
                              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                                <tr>
                                  <th className="px-4 py-3">Used Code</th>
                                  <th className="px-4 py-3">Used By</th>
                                  <th className="px-4 py-3">Used At</th>
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
                                {!data.privateBeta.inviteUses.length ? renderEmptyTableRow("No used invites yet.", 3) : null}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>Owner Feedback Panel</CardTitle>
                            <CardDescription>Newest feedback, request trends, and critical bugs.</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2">
                              <p>Critical Bugs: <span className="text-white">{data.privateBeta.feedbackSummary.criticalBugs}</span></p>
                              <p>Suggestions: <span className="text-white">{data.privateBeta.feedbackSummary.suggestions}</span></p>
                              <p>Resolved: <span className="text-white">{data.privateBeta.feedbackSummary.resolved}</span></p>
                            </div>
                            <select value={betaFeedbackStatusFilter} onChange={(event) => setBetaFeedbackStatusFilter(event.target.value as typeof betaFeedbackStatusFilter)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                              <option value="all">Status: All</option>
                              <option value="new">New</option>
                              <option value="in_review">In review</option>
                              <option value="resolved">Resolved</option>
                            </select>
                            <div className="space-y-2">
                              {betaFeedbackRows.map((entry) => (
                                <div key={entry.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                                  <p className="text-white">{feedbackCategoryLabel(entry.category)} • {entry.status}</p>
                                  <p className="mt-1 text-[#D1D5DB]">{entry.message}</p>
                                  <p className="mt-1 text-[#9CA3AF]">{formatDate(entry.createdAt)}</p>
                                  <div className="mt-2 flex gap-2">
                                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleFeedbackStatus(entry.id, "in_review")}>In Review</Button>
                                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleFeedbackStatus(entry.id, "resolved")}>Resolve</Button>
                                  </div>
                                </div>
                              ))}
                              {!betaFeedbackRows.length ? <p className="text-xs text-[#9CA3AF]">No feedback entries.</p> : null}
                            </div>
                          </CardContent>
                        </Card>

                        <Card className="border-white/10 bg-[#0B0B0B]/90">
                          <CardHeader>
                            <CardTitle>Beta Announcements</CardTitle>
                            <CardDescription>Publish updates to users.</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <select value={announcementType} onChange={(event) => setAnnouncementType(event.target.value as BetaAnnouncementType)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                              <option value="maintenance">Maintenance</option>
                              <option value="new_feature">New Feature</option>
                              <option value="bug_fix">Bug Fix</option>
                              <option value="known_issue">Known Issue</option>
                            </select>
                            <Input placeholder="Announcement title" value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} />
                            <Input placeholder="Announcement message" value={announcementMessage} onChange={(event) => setAnnouncementMessage(event.target.value)} />
                            <Button type="button" onClick={handleCreateAnnouncement}>Publish Announcement</Button>
                            <div className="space-y-2">
                              {data.privateBeta.announcements.slice(0, 10).map((announcement) => (
                                <div key={announcement.id} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                                  <p className="text-white">{announcement.title}</p>
                                  <p className="mt-1 text-[#D1D5DB]">{announcement.message}</p>
                                  <p className="mt-1 text-[#9CA3AF]">{announcement.type} • {formatDate(announcement.createdAt)}</p>
                                  <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => void handleAnnouncementState(announcement, !announcement.isActive)}>
                                    {announcement.isActive ? "Disable" : "Enable"}
                                  </Button>
                                </div>
                              ))}
                              {!data.privateBeta.announcements.length ? <p className="text-xs text-[#9CA3AF]">No announcements yet.</p> : null}
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
                          <CardTitle>Analytics</CardTitle>
                          <CardDescription>Key marketplace metrics at a glance.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          {[
                            { label: "Active Trades", value: (data.purchaseRequests ?? []).filter((r) => r.status !== "completed" && r.status !== "cancelled" && r.status !== "declined").length },
                            { label: "Completed Trades", value: (data.purchaseRequests ?? []).filter((r) => r.status === "completed").length },
                            { label: "Open Listings", value: (data.listings ?? []).filter((l) => l.status === "active").length },
                            { label: "Revenue Today (est.)", value: formatCurrency(data.ownerBusiness.today.estimatedCommission) },
                            { label: "Revenue This Week", value: formatCurrency(data.ownerBusiness.financialOverview.estimatedCommissionThisWeek) },
                            { label: "Revenue This Month", value: formatCurrency(data.ownerBusiness.financialOverview.estimatedCommissionThisMonth) },
                            { label: "Volume Today", value: formatUsdt(data.ownerBusiness.today.tradeVolumeUsdt) },
                            { label: "Top Seller (Week)", value: data.ownerBusiness.thisWeek.topSeller || "—" },
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
                        <CardTitle>User Management</CardTitle>
                        <CardDescription>Manage all platform users, roles, and account states.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="relative md:col-span-2">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                            <Input className="pl-9" placeholder="Search name, email, role..." value={usersQuery} onChange={(event) => { setUsersQuery(event.target.value); setUsersPage(1); }} />
                          </div>
                          <select value={usersRoleFilter} onChange={(event) => { setUsersRoleFilter(event.target.value); setUsersPage(1); }} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="all">Role: All</option>
                            <option value="buyer">Buyer</option>
                            <option value="approved_seller">Approved Seller</option>
                            <option value="pending_seller_approval">Pending Seller</option>
                            <option value="admin">Admin</option>
                            <option value="owner">Owner</option>
                            <option value="guest">Guest</option>
                            <option value="student">Student</option>
                          </select>
                        </div>
                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[860px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">Name</th>
                                <th className="px-4 py-3">Email</th>
                                <th className="px-4 py-3">Role</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Joined</th>
                                <th className="px-4 py-3">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {usersRows.rows.map((user) => (
                                <tr key={user.id} className="border-t border-white/10">
                                  <td className="px-4 py-3 font-medium text-white">{user.fullName}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{user.email}</td>
                                  <td className="px-4 py-3 text-[#D1D5DB] capitalize">{user.role}</td>
                                  <td className="px-4 py-3">
                                    {user.disabled ? (
                                      <span className="rounded-full border border-red-500/35 bg-red-500/10 px-2.5 py-1 text-xs text-red-300">Disabled</span>
                                    ) : (
                                      <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">Active</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(user.createdAt)}</td>
                                  <td className="px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Button type="button" size="sm" variant="secondary" onClick={() => void handleChangeUserRole(user.id, user.role)}>
                                        Change Role
                                      </Button>
                                      <Button type="button" size="sm" variant="secondary" onClick={() => void handleDisableUser(user.id, !user.disabled)} className={user.disabled ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20" : "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"}>
                                        {user.disabled ? "Enable" : "Disable"}
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {usersRows.rows.length === 0 ? renderEmptyTableRow("No users match your filters.", 6) : null}
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
                        <CardTitle>Reviews</CardTitle>
                        <CardDescription>Moderate buyer reviews submitted after completed trades.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
                          <Input className="pl-9" placeholder="Search seller, buyer, comment..." value={reviewsQuery} onChange={(event) => { setReviewsQuery(event.target.value); setReviewsPage(1); }} />
                        </div>
                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[860px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">Seller</th>
                                <th className="px-4 py-3">Buyer</th>
                                <th className="px-4 py-3">Rating</th>
                                <th className="px-4 py-3">Comment</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Actions</th>
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
                                        <span className="rounded-full border border-red-500/35 bg-red-500/10 px-2.5 py-1 text-xs text-red-300">Hidden</span>
                                      ) : (
                                        <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">Visible</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <Button type="button" size="sm" variant="secondary" onClick={() => void handleModerateReview(review.id, !review.hidden)}>
                                        {review.hidden ? "Restore" : "Hide"}
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                              {reviewsRows.rows.length === 0 ? renderEmptyTableRow("No reviews found.", 6) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(reviewsRows.safePage, reviewsRows.totalPages, setReviewsPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "emergency" ? (
                    <div className="space-y-5">
                      <Card className="border-amber-500/30 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <div className="flex items-center gap-2">
                            <Zap className="h-5 w-5 text-amber-400" />
                            <CardTitle className="text-amber-300">Emergency Controls</CardTitle>
                          </div>
                          <CardDescription>Owner-only controls. These actions affect all users and cannot be undone.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                            <p className="mb-3 text-sm font-medium text-amber-300">Broadcast Notification to All Users</p>
                            <div className="space-y-3">
                              <select value={broadcastType} onChange={(event) => setBroadcastType(event.target.value as typeof broadcastType)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                                <option value="info">Info</option>
                                <option value="warning">Warning</option>
                                <option value="success">Success</option>
                              </select>
                              <Input placeholder="Notification title" value={broadcastTitle} onChange={(event) => setBroadcastTitle(event.target.value)} />
                              <textarea
                                placeholder="Notification body"
                                value={broadcastBody}
                                onChange={(event) => setBroadcastBody(event.target.value)}
                                rows={3}
                                className="flex w-full rounded-xl border border-white/15 bg-[#101010] px-3 py-2 text-sm text-white placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#C9A227]/40"
                              />
                              <Button type="button" onClick={() => void handleBroadcast()} className="border-amber-500/40 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30">
                                Broadcast to All Users
                              </Button>
                            </div>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                              <p className="mb-2 text-sm font-medium text-red-300">Force Expire Listings</p>
                              <p className="mb-3 text-xs text-[#9CA3AF]">Immediately expire all listings that are past their expiry date.</p>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                                onClick={() => {
                                  if (!window.confirm("Force-expire all overdue listings? This cannot be undone.")) return;
                                  void runAction(fetch("/api/alpha-exchange/admin/listings/force-expire", { method: "POST" }), "Expired listings force-closed.");
                                }}
                              >
                                Run Now
                              </Button>
                            </div>
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                              <p className="mb-2 text-sm font-medium text-amber-300">Recalculate All Trust Scores</p>
                              <p className="mb-3 text-xs text-[#9CA3AF]">Trigger a full trust engine recalculation for all sellers.</p>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                                onClick={() => {
                                  if (!window.confirm("Recalculate trust scores now? This may take a moment.")) return;
                                  const reason = requestReason("Reason for recalculating trust scores:", "Launch trust recalculation");
                                  if (!reason) return;
                                  void runAction(fetch("/api/alpha-exchange/admin/trust/recalculate-all", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), "Trust score recalculation triggered.");
                                }}
                              >
                                Run Now
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
                        <CardTitle>Settings</CardTitle>
                        <CardDescription>Operational controls for Alpha Exchange administration.</CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-4 md:grid-cols-2">
                        <Card className="border-white/10 bg-black/20">
                          <CardHeader>
                            <CardTitle className="text-base">Security</CardTitle>
                            <CardDescription>Admin-only permissions are enforced on every admin endpoint.</CardDescription>
                          </CardHeader>
                          <CardContent className="pt-0 text-sm text-[#D1D5DB]">
                            Route: <span className="text-white">/api/alpha-exchange/admin/*</span>
                          </CardContent>
                        </Card>
                        <Card className="border-white/10 bg-black/20">
                          <CardHeader>
                            <CardTitle className="text-base">Commission Rules</CardTitle>
                            <CardDescription>Current fee logic is tracked at 1% per completed trade.</CardDescription>
                          </CardHeader>
                          <CardContent className="pt-0 text-sm text-[#D1D5DB]">
                            Total earned: <span className="text-white">{formatUsdt(data.summary.totalCommissionAmount)}</span>
                          </CardContent>
                        </Card>
                      </CardContent>
                    </Card>
                  ) : null}
                </>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {selectedSeller ? (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} className="modal-panel max-h-[90vh] w-full max-w-xl overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">{selectedSeller.fullName}</h3>
                <button type="button" aria-label="Close seller profile" onClick={() => setSelectedSeller(null)} className="rounded-full border border-white/15 p-2 text-[#9CA3AF] transition hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid gap-2 text-sm text-[#D1D5DB]">
                <p>Email: <span className="text-white">{selectedSeller.email}</span></p>
                <p>WhatsApp: <span className="text-white">{selectedSeller.whatsappNumber}</span></p>
                <p>Member Since: <span className="text-white">{formatDate(selectedSeller.createdAt)}</span></p>
                <p>Status: <span className="text-white">{selectedSeller.sellerStatus}</span></p>
                <p>Availability: <span className="text-white">{selectedSeller.availabilityStatus ?? "available"}</span></p>
                <p>Prestige Rank: <span className="text-white capitalize">{sellerLevelLabel(selectedSeller.sellerPrestigeRank)}</span></p>
                <p>Lifetime Completed Volume: <span className="text-white">{formatUsdt(Math.max(0, Number(selectedSeller.lifetimeCompletedVolumeUsdt ?? 0)))}</span></p>
                {selectedSeller.sellerRankOverride ? (
                  <p>Override: <span className="text-white capitalize">{selectedSeller.sellerRankOverride.rank}</span> • {selectedSeller.sellerRankOverride.reason}</p>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {selectedSeller.availabilityStatus === "vacation" ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => {
                    if (!window.confirm("End vacation mode for this seller?")) return;
                    const reason = requestReason("Reason for ending vacation mode:", "Vacation Mode ended.");
                    if (!reason) return;
                    void handleSellerAvailabilityStatus(selectedSeller.id, "available", "Vacation Mode ended.", reason);
                  }}>
                    End Vacation
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="secondary" onClick={() => {
                    if (!window.confirm("Enable vacation mode for this seller?")) return;
                    const reason = requestReason("Reason for enabling vacation mode:", "Vacation Mode enabled.");
                    if (!reason) return;
                    void handleSellerAvailabilityStatus(selectedSeller.id, "vacation", "Vacation Mode enabled.", reason);
                  }}>
                    Enable Vacation
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const nextRank = window.prompt("Set rank (bronze, silver, gold, platinum, diamond, legendary)", selectedSeller.sellerPrestigeRank ?? "bronze");
                    if (!nextRank) return;
                    const rankInput = nextRank.trim().toLowerCase();
                    if (!isSellerLevel(rankInput)) {
                      pushToast("Invalid prestige rank.");
                      return;
                    }
                    const reason = window.prompt("Override reason", "Manual admin override");
                    if (!reason) return;
                    void handleSellerPrestigeOverride(selectedSeller.id, rankInput, reason, false);
                  }}
                >
                  Override Rank
                </Button>
                {selectedSeller.sellerRankOverride ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const reason = window.prompt("Reason for clearing override", "Return to automatic progression");
                      if (!reason) return;
                      void handleSellerPrestigeOverride(selectedSeller.id, selectedSeller.sellerPrestigeRank ?? "bronze", reason, true);
                    }}
                  >
                    Clear Override
                  </Button>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {selectedRequest ? (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} className="modal-panel max-h-[90vh] w-full max-w-xl overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">Purchase Request Details</h3>
                <button type="button" aria-label="Close request details" onClick={() => setSelectedRequest(null)} className="rounded-full border border-white/15 p-2 text-[#9CA3AF] transition hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid gap-2 text-sm text-[#D1D5DB]">
                <p>Request ID: <span className="text-white">{selectedRequest.id}</span></p>
                <p>Trade ID: <span className="text-white">{selectedRequest.tradeId ?? selectedRequest.id}</span></p>
                <p>Buyer: <span className="text-white">{selectedRequest.buyerName}</span></p>
                <p>WhatsApp: <span className="text-white">{selectedRequest.buyerWhatsapp}</span></p>
                <p>Listing: <span className="text-white">{selectedRequest.listingId}</span></p>
                <p>Seller: <span className="text-white">{sellersById.get(selectedRequest.sellerId)?.fullName ?? selectedRequest.sellerId}</span></p>
                <p>Status: <span className="text-white">{selectedRequest.status}</span></p>
                <p>USDT Amount: <span className="text-white">{selectedRequest.usdtAmount}</span></p>
                <p>Fiat Amount: <span className="text-white">{selectedRequest.fiatAmount} {selectedRequest.currency}</span></p>
                <p>Network: <span className="text-white">{selectedRequest.network}</span></p>
                <p>Payment Method: <span className="text-white">{selectedRequest.paymentMethod}</span></p>
                <p>Receiving Bank: <span className="text-white">{selectedRequest.bankName ?? "—"}</span></p>
                <p>Submitted: <span className="text-white">{formatDate(selectedRequest.createdAt)}</span></p>
                {selectedRequest.completedAt ? <p>Completed: <span className="text-white">{formatDate(selectedRequest.completedAt)}</span></p> : null}
                {selectedRequest.timedOutAt ? <p>Timed Out: <span className="text-white">{formatDate(selectedRequest.timedOutAt)}</span></p> : null}
                {selectedRequest.timeoutReason ? <p>Timeout Reason: <span className="text-white">{selectedRequest.timeoutReason}</span></p> : null}
                {selectedRequest.reviewUnlockedAt ? <p>Review Unlocked: <span className="text-white">{formatDate(selectedRequest.reviewUnlockedAt)}</span></p> : null}
                <p>Notes: <span className="text-white">{selectedRequest.buyerNotes || "—"}</span></p>
                <p>
                  Buyer Evidence:{" "}
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
                    <span className="text-white">Missing</span>
                  )}
                </p>
                <p>
                  Seller Evidence:{" "}
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
                    <span className="text-white">Missing</span>
                  )}
                </p>
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-sm font-medium text-white">Timeline</p>
                <div className="mt-2 space-y-2 text-xs text-[#D1D5DB]">
                  {(selectedRequest.timeline ?? []).map((event) => (
                    <div key={event.id} className="flex items-start gap-2">
                      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#C9A227]" />
                      <span>{formatDate(event.createdAt)} — {event.message}</span>
                    </div>
                  ))}
                </div>
              </div>
              {selectedRequest.buyerReview ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#D1D5DB]">
                  <p className="text-sm font-medium text-white">Buyer Review</p>
                  <p className="mt-2">{selectedRequest.buyerReview.comment}</p>
                </div>
              ) : null}
              {selectedRequest.sellerResponse ? (
                <div className="mt-3 rounded-xl border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 p-3 text-xs text-[#D1D5DB]">
                  <p className="text-sm font-medium text-white">Seller Response</p>
                  <p className="mt-2">{selectedRequest.sellerResponse.message}</p>
                </div>
              ) : null}
              {selectedRequest.status !== "completed" && selectedRequest.status !== "cancelled" && selectedRequest.status !== "declined" ? (
                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <p className="mb-3 text-sm font-medium text-amber-300">Admin Actions</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => void handleForceComplete(selectedRequest.id)} className="border-[#C9A227]/40 bg-[#C9A227]/20 text-[#C9A227] hover:bg-[#C9A227]/30">
                      Force Complete
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleForceCancel(selectedRequest.id)} className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20">
                      Force Cancel
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void handleUnlockReview(selectedRequest.id)}>
                      Unlock Review
                    </Button>
                  </div>
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {toast ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="fixed bottom-5 right-5 z-50 rounded-full border border-[#C9A227]/35 bg-[#0B0B0B]/95 px-4 py-2 text-sm text-white shadow-[0_14px_34px_rgba(0,0,0,0.4)]">
            {toast}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
