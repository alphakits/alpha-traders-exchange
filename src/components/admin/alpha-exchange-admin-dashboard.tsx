"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BarChart3, CheckCircle2, Coins, FileClock, FileSearch, ListChecks, Search, Settings, ShieldCheck, Store, Users, WalletCards, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RoleBadge } from "@/components/ui/role-badge";
import type { AuditLogEntry, BetaAnnouncement, BetaAnnouncementType, BetaFeedbackCategory, CommissionRecord, MarketplaceListing, OwnerBusinessDashboardMetrics, OwnerPrivateBetaDashboardData, PurchaseRequest, SellerApplication, SupportedNetwork } from "@/types/alpha-exchange";

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
  role: "buyer" | "approved_seller" | "admin";
  sellerStatus: "buyer" | "pending_seller_approval" | "approved_seller" | "rejected" | "suspended";
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
  | "settings";

const pageSize = 8;

const sectionItems: Array<{ key: SectionKey; label: string; icon: typeof BarChart3 }> = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "seller-applications", label: "Seller Applications", icon: FileSearch },
  { key: "approved-sellers", label: "Approved Sellers", icon: Users },
  { key: "marketplace-listings", label: "Marketplace Listings", icon: Store },
  { key: "purchase-requests", label: "Purchase Requests", icon: ListChecks },
  { key: "commissions", label: "Commissions", icon: Coins },
  { key: "audit-logs", label: "Audit Logs", icon: FileClock },
  { key: "private-beta", label: "Private Beta", icon: ShieldCheck },
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
  const [listingsStatus, setListingsStatus] = useState<"all" | "pending_approval" | "changes_requested" | "rejected" | "available" | "paused" | "sold">("all");
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
  const [inviteMaxUses, setInviteMaxUses] = useState("10");
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [betaFeedbackStatusFilter, setBetaFeedbackStatusFilter] = useState<"all" | "new" | "in_review" | "resolved">("all");
  const [announcementType, setAnnouncementType] = useState<BetaAnnouncementType>("maintenance");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const toastTimeoutRef = useRef<number | null>(null);

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
      const haystack = `${record.id} ${request?.buyerName ?? record.buyerId} ${seller?.fullName ?? record.sellerId}`.toLowerCase();
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
      const haystack = `${entry.action} ${entry.details ?? ""} ${actor} ${entry.listingId ?? ""} ${entry.purchaseRequestId ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...items].sort((a, b) => {
      if (auditSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return paginate(sorted, auditPage);
  }, [auditAction, auditPage, auditQuery, auditSort, data?.auditLogs, sellersById]);

  const betaFeedbackRows = useMemo(() => {
    const items = (data?.privateBeta.feedback ?? []).filter((entry) => (betaFeedbackStatusFilter === "all" ? true : entry.status === betaFeedbackStatusFilter));
    return items.slice(0, 20);
  }, [betaFeedbackStatusFilter, data?.privateBeta.feedback]);

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
      "Invite code created.",
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

  function exportCommissionsCsv() {
    const rows = commissionsRows.rows;
    const csvRows = [
      ["Trade ID", "Buyer", "Seller", "Trade Value", "1% Commission", "Date"].join(","),
      ...rows.map((record) => {
        const request = requestsById.get(record.purchaseRequestId);
        const seller = sellersById.get(record.sellerId);
        const buyerName = request?.buyerName ?? record.buyerId;
        const sellerName = seller?.fullName ?? record.sellerId;
        return [record.purchaseRequestId, buyerName, sellerName, record.grossAmount.toFixed(2), record.commissionAmount.toFixed(2), record.createdAt].join(",");
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
      ["Trade ID", "Request ID", "Buyer", "Seller", "USDT Amount", "Fiat Amount", "Currency", "Network", "Payment Method", "Status", "Submitted", "Completed"].join(","),
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
    <section className="section-container page-shell pb-14">
      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <aside className="h-fit rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-4 backdrop-blur-sm">
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
                    <div className="space-y-6">
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
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2">
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
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2">
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
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2">
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
                          <CardContent className="grid gap-3 text-sm text-[#D1D5DB] md:grid-cols-2">
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
                          <CardContent className="space-y-2 text-sm text-[#D1D5DB]">
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
                        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                                <th className="px-4 py-3">Preferred Networks</th>
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
                                        onClick={() => runAction(fetch(`/api/alpha-exchange/admin/seller-applications/${application.id}/approve`, { method: "POST" }), "Application approved.")}
                                      >
                                        Approve
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        disabled={application.status !== "pending"}
                                        onClick={() => runAction(fetch(`/api/alpha-exchange/admin/seller-applications/${application.id}/reject`, { method: "POST" }), "Application rejected.")}
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
                                <th className="px-4 py-3">Active Listings</th>
                                <th className="px-4 py-3">Completed Trades</th>
                                <th className="px-4 py-3">Current Status</th>
                                <th className="px-4 py-3">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sellersRows.rows.map((seller) => {
                                const activeListings = (data.listings ?? []).filter((listing) => listing.sellerId === seller.id && listing.status === "available").length;
                                const completedTrades = (data.purchaseRequests ?? []).filter((request) => request.sellerId === seller.id && request.status === "completed").length;
                                const isSuspended = seller.sellerStatus === "suspended";
                                return (
                                  <tr key={seller.id} className="border-t border-white/10">
                                    <td className="px-4 py-3">
                                      <p className="font-medium text-white">{seller.fullName}</p>
                                      <p className="text-xs text-[#9CA3AF]">{seller.email}</p>
                                      <div className="mt-2">
                                        <RoleBadge variant={seller.role === "admin" ? "administrator" : seller.role === "approved_seller" ? "approved_seller" : "buyer"} />
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(seller.createdAt)}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{activeListings}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{completedTrades}</td>
                                    <td className="px-4 py-3">
                                      {isSuspended ? (
                                        <span className="rounded-full border border-red-500/35 bg-red-500/10 px-2.5 py-1 text-xs text-red-300">Suspended</span>
                                      ) : (
                                        <RoleBadge variant="approved_seller" />
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        {!isSuspended ? (
                                          <Button type="button" size="sm" variant="secondary" onClick={() => runAction(fetch(`/api/alpha-exchange/admin/sellers/${seller.id}/suspend`, { method: "POST" }), "Seller suspended.")}>
                                            Suspend
                                          </Button>
                                        ) : (
                                          <Button type="button" size="sm" onClick={() => runAction(fetch(`/api/alpha-exchange/admin/sellers/${seller.id}/reactivate`, { method: "POST" }), "Seller reactivated.")}>
                                            Reactivate
                                          </Button>
                                        )}
                                        <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedSeller(seller)}>
                                          View Profile
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                              {sellersRows.rows.length === 0 ? renderEmptyTableRow("No approved sellers match your filters.", 6) : null}
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
                            <option value="pending_approval">Pending Approval</option>
                            <option value="changes_requested">Changes Requested</option>
                            <option value="rejected">Rejected</option>
                            <option value="available">Available</option>
                            <option value="paused">Paused</option>
                            <option value="sold">Sold</option>
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
                          <table className="w-full min-w-[980px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">Seller</th>
                                <th className="px-4 py-3">Amount</th>
                                <th className="px-4 py-3">Price</th>
                                <th className="px-4 py-3">Network</th>
                                <th className="px-4 py-3">Status</th>
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
                                  <td className="px-4 py-3">
                                    <span className={`rounded-full px-2.5 py-1 text-xs ${listing.status === "available" ? "border border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : listing.status === "pending_approval" ? "border border-[#6CAEFF]/35 bg-[#6CAEFF]/10 text-[#93C5FD]" : listing.status === "changes_requested" ? "border border-amber-500/35 bg-amber-500/10 text-amber-300" : listing.status === "rejected" ? "border border-red-500/35 bg-red-500/10 text-red-300" : listing.status === "paused" ? "border border-[#C9A227]/35 bg-[#C9A227]/10 text-[#C9A227]" : "border border-white/20 bg-white/5 text-white/75"}`}>
                                      {listing.status}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(listing.createdAt)}</td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      {listing.status === "pending_approval" ? (
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
                                      <Button type="button" size="sm" variant="secondary" onClick={() => runAction(fetch(`/api/alpha-exchange/admin/listings/${listing.id}`, { method: "DELETE" }), "Listing deleted.")}>
                                        Delete
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {listingsRows.rows.length === 0 ? renderEmptyTableRow("No marketplace listings match your filters.", 7) : null}
                            </tbody>
                          </table>
                        </div>

                        <p className="mt-3 text-xs text-[#9CA3AF]">Owner-only Pending Listings page: /admin/alpha-exchange/pending-listings</p>

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
                                    <td className="px-4 py-3 text-[#D1D5DB]">{request.tradeId ?? "Pending"}</td>
                                    <td className="px-4 py-3 text-white">{request.buyerName}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{seller?.fullName ?? request.sellerId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{request.usdtAmount ?? listing?.availableAmount ?? "—"}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{request.listingId}</td>
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
                              {requestsRows.rows.length === 0 ? renderEmptyTableRow("No purchase requests match your filters.", 8) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(requestsRows.safePage, requestsRows.totalPages, setRequestsPage)}
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
                                <th className="px-4 py-3">Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {commissionsRows.rows.map((record) => {
                                const request = (data.purchaseRequests ?? []).find((item) => item.id === record.purchaseRequestId);
                                const seller = sellersById.get(record.sellerId);
                                return (
                                  <tr key={record.id} className="border-t border-white/10">
                                    <td className="px-4 py-3 text-[#D1D5DB]">{record.purchaseRequestId}</td>
                                    <td className="px-4 py-3 text-white">{request?.buyerName ?? record.buyerId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{seller?.fullName ?? record.sellerId}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatCurrency(record.grossAmount)}</td>
                                    <td className="px-4 py-3 text-[#C9A227]">{formatCurrency(record.commissionAmount)}</td>
                                    <td className="px-4 py-3 text-[#D1D5DB]">{formatDate(record.createdAt)}</td>
                                  </tr>
                                );
                              })}
                              {commissionsRows.rows.length === 0 ? renderEmptyTableRow("No commission records match your filters.", 6) : null}
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
                            <option value="listing_edited">listing_edited</option>
                            <option value="listing_removed">listing_removed</option>
                            <option value="purchase_request_submitted">purchase_request_submitted</option>
                            <option value="purchase_completed">purchase_completed</option>
                            <option value="trade_review_submitted">trade_review_submitted</option>
                            <option value="trade_review_responded">trade_review_responded</option>
                            <option value="trust_score_updated">trust_score_updated</option>
                          </select>
                          <select value={auditSort} onChange={(event) => setAuditSort(event.target.value as typeof auditSort)} className="flex h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white">
                            <option value="newest">Sort: Newest</option>
                            <option value="oldest">Sort: Oldest</option>
                          </select>
                        </div>

                        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full min-w-[980px] text-sm">
                            <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">
                              <tr>
                                <th className="px-4 py-3">Timestamp</th>
                                <th className="px-4 py-3">User</th>
                                <th className="px-4 py-3">Action</th>
                                <th className="px-4 py-3">Resource</th>
                                <th className="px-4 py-3">Status</th>
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
                                    <td className="px-4 py-3 text-[#D1D5DB]">{entry.listingId ?? entry.purchaseRequestId ?? entry.targetUserId ?? "system"}</td>
                                    <td className="px-4 py-3">
                                      <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">success</span>
                                    </td>
                                  </tr>
                                );
                              })}
                              {auditRows.rows.length === 0 ? renderEmptyTableRow("No audit logs match your filters.", 5) : null}
                            </tbody>
                          </table>
                        </div>
                        {renderPagination(auditRows.safePage, auditRows.totalPages, setAuditPage)}
                      </CardContent>
                    </Card>
                  ) : null}

                  {activeSection === "private-beta" ? (
                    <div className="space-y-6">
                      <Card className="border-white/10 bg-[#0B0B0B]/90">
                        <CardHeader>
                          <CardTitle>Private Beta Access</CardTitle>
                          <CardDescription>Invite-only onboarding controls and invite history.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid gap-3 md:grid-cols-4">
                            <Input value={inviteMaxUses} onChange={(event) => setInviteMaxUses(event.target.value)} placeholder="Max uses" />
                            <Input type="datetime-local" value={inviteExpiresAt} onChange={(event) => setInviteExpiresAt(event.target.value)} />
                            <div className="md:col-span-2">
                              <Button type="button" onClick={handleCreateInvite}>Generate Invite Code</Button>
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
                                {!data.privateBeta.inviteCodes.length ? renderEmptyTableRow("No invite codes yet.", 6) : null}
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
                            <CardDescription>Publish updates to private beta users only.</CardDescription>
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
                            Total earned: <span className="text-white">{formatCurrency(data.summary.totalCommissionAmount)}</span>
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
            <motion.div initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0B0B0B]/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
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
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {selectedRequest ? (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0B0B0B]/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">Purchase Request Details</h3>
                <button type="button" aria-label="Close request details" onClick={() => setSelectedRequest(null)} className="rounded-full border border-white/15 p-2 text-[#9CA3AF] transition hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid gap-2 text-sm text-[#D1D5DB]">
                <p>Request ID: <span className="text-white">{selectedRequest.id}</span></p>
                <p>Trade ID: <span className="text-white">{selectedRequest.tradeId ?? "Pending"}</span></p>
                <p>Buyer: <span className="text-white">{selectedRequest.buyerName}</span></p>
                <p>WhatsApp: <span className="text-white">{selectedRequest.buyerWhatsapp}</span></p>
                <p>Listing: <span className="text-white">{selectedRequest.listingId}</span></p>
                <p>Seller: <span className="text-white">{sellersById.get(selectedRequest.sellerId)?.fullName ?? selectedRequest.sellerId}</span></p>
                <p>Status: <span className="text-white">{selectedRequest.status}</span></p>
                <p>USDT Amount: <span className="text-white">{selectedRequest.usdtAmount}</span></p>
                <p>Fiat Amount: <span className="text-white">{selectedRequest.fiatAmount} {selectedRequest.currency}</span></p>
                <p>Network: <span className="text-white">{selectedRequest.network}</span></p>
                <p>Payment Method: <span className="text-white">{selectedRequest.paymentMethod}</span></p>
                <p>Submitted: <span className="text-white">{formatDate(selectedRequest.createdAt)}</span></p>
                {selectedRequest.completedAt ? <p>Completed: <span className="text-white">{formatDate(selectedRequest.completedAt)}</span></p> : null}
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
