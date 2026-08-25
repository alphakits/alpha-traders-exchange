"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellDot, Megaphone, Scale, Search, ShieldCheck, Star, Tags, UserRound } from "lucide-react";
import type { AppLocale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { prefetchTradeRoom } from "@/lib/trade-room-client";
import { formatListingId, formatTradeId } from "@/lib/format-id";
import { replaceExchangeEntityIdsWithHints } from "@/lib/alpha-exchange-display";
import { formatNotificationRelativeTime } from "@/lib/notification-time";
import { sortNotificationsNewestFirst } from "@/lib/notification-sort";
import { getTradeRoomConversationDestination } from "@/lib/trade-room-notification-destination";
import { getCommissionPaymentNotificationDestination } from "@/lib/commission-payment-destination";
import { getExplicitNonTradeRoomNotificationDestination } from "@/lib/notification-action-destination";
import { isNotificationActionRequired } from "@/lib/notification-action-required";
import { useAuthenticatedNotificationStream } from "@/components/notifications/use-authenticated-notification-stream";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";

type NotificationsPayload = {
  notifications: AlphaExchangeNotification[];
  total: number;
  unreadCount: number;
};

type NotificationsStreamPayload = {
  notifications: AlphaExchangeNotification[];
  unreadCount: number;
};

type TradeRoomRequestPayload = {
  id: string;
  status: string;
  sellerId: string;
  buyerId: string;
};

type TradeSnapshotPayload = {
  requestId?: string;
  currentStage?: string;
  sellerId?: string;
  buyerId?: string;
};

type NotificationFilter = "all" | "actions" | "unread" | "trades" | "listings" | "reviews" | "announcements" | "history";

const PAGE_SIZE = 20;
const MOBILE_FETCH_LIMIT = 40;
const DESKTOP_FETCH_LIMIT = 120;
const NOTIFICATIONS_CACHE_KEY = "alpha.notifications.page.v1";
const NOTIFICATIONS_CACHE_MAX_AGE_MS = 45_000;
const TRADE_ROOM_DEBUG = process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";

type NotificationsCachePayload = {
  fetchedAt: number;
  payload: NotificationsPayload;
};

function notificationIcon(notification: AlphaExchangeNotification) {
  if (notification.category === "trade") return Scale;
  if (notification.category === "listing") return Tags;
  if (notification.category === "application") return UserRound;
  if (notification.category === "report" || notification.category === "dispute") return ShieldCheck;
  if (notification.category === "trust") return Star;
  if (notification.category === "review") return Star;
  if (notification.title.toLowerCase().includes("announcement")) return Megaphone;
  return BellDot;
}

function isAnnouncement(notification: AlphaExchangeNotification) {
  const text = `${notification.title} ${notification.message}`.toLowerCase();
  return notification.category === "system" || text.includes("announcement");
}

function isReview(notification: AlphaExchangeNotification) {
  return notification.category === "review" || `${notification.title} ${notification.message}`.toLowerCase().includes("review");
}

function buildTradeRoomHashForAction(action: string) {
  if (action === "upload-payment-receipt" || action === "upload-seller-evidence") return "evidence";
  if (action === "review-trade" || action === "open-trade") return "status-banner";
  return "action-required";
}

function buildTradeRoomActionForRequest(request: TradeRoomRequestPayload, actorUserId: string) {
  const isSeller = request.sellerId === actorUserId;
  const isBuyer = request.buyerId === actorUserId;
  if (request.status === "pending" && isSeller) return "accept-trade";
  if (request.status === "accepted" && isBuyer) return "upload-payment-receipt";
  if (request.status === "payment_sent" && isSeller) return "confirm-money-received";
  if (request.status === "funds_received" && isSeller) return "upload-seller-evidence";
  if (request.status === "usdt_release_pending" && isSeller) return "upload-seller-evidence";
  if (request.status === "usdt_sent" && isBuyer) return "confirm-usdt-received";
  if ((request.status === "review_open" || request.status === "completed" || request.status === "locked") && isBuyer) return "review-trade";
  return "open-trade";
}

function buildTradeRoomActionForSnapshot(snapshot: TradeSnapshotPayload, actorUserId: string) {
  const requestId = String(snapshot.requestId ?? "").trim();
  const status = String(snapshot.currentStage ?? "").trim();
  const sellerId = String(snapshot.sellerId ?? "").trim();
  const buyerId = String(snapshot.buyerId ?? "").trim();
  if (!requestId || !status || !sellerId || !buyerId) return null;
  return buildTradeRoomActionForRequest({ id: requestId, status, sellerId, buyerId }, actorUserId);
}

function matchesFilter(notification: AlphaExchangeNotification, filter: NotificationFilter) {
  if (filter === "history") return notification.state === "archived";
  if (filter === "all") return true;
  if (filter === "actions") return isNotificationActionRequired(notification);
  if (filter === "unread") return !notification.isRead;
  if (filter === "trades") return notification.category === "trade";
  if (filter === "listings") return notification.category === "listing";
  if (filter === "reviews") return isReview(notification);
  return isAnnouncement(notification);
}

function readNotificationsCache() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(NOTIFICATIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotificationsCachePayload;
    if (!parsed?.payload || typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeNotificationsCache(payload: NotificationsPayload) {
  if (typeof window === "undefined") return;
  const serialized: NotificationsCachePayload = {
    fetchedAt: Date.now(),
    payload,
  };
  window.sessionStorage.setItem(NOTIFICATIONS_CACHE_KEY, JSON.stringify(serialized));
}

function notificationGroupLabel(notificationDate: Date, locale: AppLocale) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const notificationTime = notificationDate.getTime();
  if (notificationTime >= todayStart) {
    return locale === "ar" ? "اليوم" : "Today";
  }
  if (notificationTime >= yesterdayStart) {
    return locale === "ar" ? "أمس" : "Yesterday";
  }
  return locale === "ar" ? "أقدم" : "Earlier";
}

function extractTradeRoomHrefFromRelatedHref(relatedHref?: string) {
  const href = relatedHref?.trim();
  if (!href) return null;
  const normalized = href.startsWith("/") ? href : `/${href}`;
  const roomMatch = normalized.match(/\/trade-room\/([^/?#]+)/i);
  if (roomMatch?.[1]) return `/trade-room/${decodeURIComponent(roomMatch[1])}`;
  const requestMatch = normalized.match(/[?&]requestId=([^&]+)/i);
  if (requestMatch?.[1]) return `/trade-room/${decodeURIComponent(requestMatch[1])}`;
  return null;
}

function extractRequestIdFromTradeRoomHref(href: string | null) {
  if (!href) return null;
  try {
    const parsed = new URL(href, "https://www.alphatraders.co.il");
    const segments = parsed.pathname.replace(/\/+$/, "").split("/");
    const requestId = segments[segments.length - 1]?.trim();
    return requestId || null;
  } catch {
    const normalized = href.split("?")[0]?.split("#")[0]?.replace(/\/+$/, "") ?? "";
    const requestId = normalized.slice(normalized.lastIndexOf("/") + 1).trim();
    return requestId || null;
  }
}

function formatNotificationTitle(notification: AlphaExchangeNotification) {
  return replaceExchangeEntityIdsWithHints(notification.title, notification);
}

function formatNotificationMessage(notification: AlphaExchangeNotification) {
  return replaceExchangeEntityIdsWithHints(notification.message, notification);
}

export function NotificationsPage({ locale }: { locale: AppLocale }) {
  const canonicalSession = useOptionalCanonicalSession();
  const [notifications, setNotifications] = useState<AlphaExchangeNotification[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [page, setPage] = useState(1);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [itemLoading, setItemLoading] = useState<Record<string, boolean>>({});
  const [isMobileViewport, setIsMobileViewport] = useState<boolean | null>(null);
  const router = useRouter();
  const canLoadNotifications = !canonicalSession || (!canonicalSession.isResolving && Boolean(canonicalSession.user));

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  const fetchLimit = isMobileViewport ? MOBILE_FETCH_LIMIT : DESKTOP_FETCH_LIMIT;

  const loadNotifications = useCallback(async ({
    offset = 0,
    append = false,
    force = false,
  }: {
    offset?: number;
    append?: boolean;
    force?: boolean;
  } = {}) => {
    if (!canLoadNotifications) return;
    if (append) {
      setIsLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      if (filter === "all" && !append && !force && offset === 0) {
        const cached = readNotificationsCache();
        if (cached && Date.now() - cached.fetchedAt <= NOTIFICATIONS_CACHE_MAX_AGE_MS) {
          const incoming = sortNotificationsNewestFirst(cached.payload.notifications ?? []);
          setNotifications(incoming);
          setTotalCount(cached.payload.total ?? incoming.length);
          setUnreadCount(cached.payload.unreadCount ?? 0);
          return;
        }
      }

      const params = new URLSearchParams({
        limit: String(fetchLimit),
        offset: String(offset),
        includeActivity: "0",
      });
      if (filter === "history") params.set("state", "archived");
      const response = await fetch(`/api/alpha-exchange/notifications?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) void canonicalSession?.refresh({ force: true });
        throw new Error("Failed to load notifications.");
      }
      const payload = (await response.json()) as NotificationsPayload;
      const incoming = sortNotificationsNewestFirst(payload.notifications ?? []);
      setNotifications((prev) => {
        if (!append) return incoming;
        const merged = [...prev];
        const seen = new Set(prev.map((item) => item.id));
        for (const item of incoming) {
          if (!seen.has(item.id)) {
            merged.push(item);
            seen.add(item.id);
          }
        }
        return sortNotificationsNewestFirst(merged);
      });
      setTotalCount(payload.total ?? incoming.length);
      setUnreadCount(payload.unreadCount ?? 0);
      if (filter === "all" && offset === 0) {
        writeNotificationsCache({
          ...payload,
          notifications: incoming,
        });
      }
    } catch {
      setError("Failed to load notifications.");
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [canLoadNotifications, canonicalSession, fetchLimit, filter]);

  useEffect(() => {
    if (isMobileViewport === null || !canLoadNotifications) return;
    void loadNotifications({ offset: 0, append: false });
  }, [canLoadNotifications, isMobileViewport, loadNotifications]);

  const handleNotificationStream = useCallback((event: Event) => {
    const messageEvent = event as MessageEvent<string>;
    try {
      const payload = JSON.parse(messageEvent.data) as NotificationsStreamPayload;
      if (!Array.isArray(payload.notifications)) return;
      setNotifications(sortNotificationsNewestFirst(payload.notifications));
      setUnreadCount(typeof payload.unreadCount === "number" ? payload.unreadCount : 0);
    } catch {
      // Ignore malformed stream payloads.
    }
  }, []);
  useAuthenticatedNotificationStream({ enabled: canLoadNotifications && filter !== "history", onNotifications: handleNotificationStream });

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  const filteredNotifications = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return notifications.filter((notification) => {
      if (!matchesFilter(notification, filter)) return false;
      if (!normalizedSearch) return true;
      const haystack = `${notification.title} ${notification.message} ${notification.relatedTradeId ?? ""} ${notification.relatedListingId ?? ""}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [filter, notifications, search]);

  const highlightedReminder = useMemo(
    () => notifications.find((notification) => isNotificationActionRequired(notification) && !notification.isRead) ?? notifications.find(isNotificationActionRequired) ?? null,
    [notifications],
  );

  const totalPages = Math.max(1, Math.ceil(filteredNotifications.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredNotifications.slice(pageStart, pageStart + PAGE_SIZE);

  const groupedPageItems = useMemo(() => {
    const groups = new Map<string, AlphaExchangeNotification[]>();
    for (const notification of pageItems) {
      const key = notificationGroupLabel(new Date(notification.createdAt), locale);
      const list = groups.get(key) ?? [];
      list.push(notification);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }, [locale, pageItems]);

  useEffect(() => {
    const relatedHrefs = pageItems
      .map((item) => item.relatedHref)
      .filter((href): href is string => Boolean(href))
      .slice(0, 6);
    for (const href of relatedHrefs) {
      router.prefetch(href);
    }
  }, [pageItems, router]);

  function isTradeNotification(notification: AlphaExchangeNotification) {
    return notification.category === "trade";
  }

  function resolveNotificationActionLabel(notification: AlphaExchangeNotification) {
    if (getCommissionPaymentNotificationDestination(notification)) return "Pay Commission";
    if (isTradeNotification(notification)) return "Continue Trade";
    if (notification.actionLabel?.trim()) return notification.actionLabel.trim();
    if (notification.category === "application") return "Review Application";
    if (notification.category === "listing") return "Manage Listing";
    return "Open";
  }

  function resolveTradeRoomHref(notification: AlphaExchangeNotification) {
    if (notification.relatedRequestId?.trim()) return `/trade-room/${notification.relatedRequestId.trim()}`;
    const fromHref = extractTradeRoomHrefFromRelatedHref(notification.relatedHref ?? notification.actionHref);
    if (fromHref) return fromHref;
    return null;
  }

  function extractSellerApplicationId(notification: AlphaExchangeNotification) {
    const href = (notification.actionHref ?? notification.relatedHref ?? "").trim();
    if (!href) return null;
    try {
      const parsed = new URL(href, "https://www.alphatraders.co.il");
      const byQuery = parsed.searchParams.get("sellerApplication");
      if (byQuery?.trim()) return byQuery.trim();
    } catch {
      return null;
    }
    return null;
  }

  async function resolveActiveTradeHref(input?: { notificationId?: string; requestId?: string | null; includePending?: boolean; fallbackHref?: string | null }) {
    try {
      const query = new URLSearchParams();
      if (input?.notificationId) query.set("notificationId", input.notificationId);
      if (input?.includePending) query.set("includePending", "1");
      if (input?.requestId?.trim()) query.set("requestId", input.requestId.trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      const response = await fetch(`/api/alpha-exchange/trade-room/active${suffix}`, { cache: "no-store" });
      if (!response.ok) return input?.fallbackHref ?? null;
      const payload = (await response.json()) as { activeRequestId?: string | null; destination?: string | null };
      if (payload.destination?.trim()) return payload.destination.trim();
      if (!payload.activeRequestId) return null;
      return `/trade-room/${payload.activeRequestId}`;
    } catch {
      return input?.fallbackHref ?? null;
    }
  }

  async function resolveNotificationDestination(notification: AlphaExchangeNotification) {
    const commissionDestination = getCommissionPaymentNotificationDestination(notification);
    if (commissionDestination) return commissionDestination;
    const conversationDestination = getTradeRoomConversationDestination(notification);
    if (conversationDestination) return conversationDestination;
    const explicitInternalDestination = getExplicitNonTradeRoomNotificationDestination(notification);
    if (explicitInternalDestination) return explicitInternalDestination;
    if (isTradeNotification(notification)) {
      const relatedRequestId = notification.relatedRequestId?.trim() || null;
      const snapshotAction = buildTradeRoomActionForSnapshot(notification.tradeSnapshot as TradeSnapshotPayload, notification.userId);
      if (snapshotAction && (notification.tradeSnapshot as TradeSnapshotPayload | undefined)?.requestId) {
        const requestId = String((notification.tradeSnapshot as TradeSnapshotPayload).requestId ?? "").trim();
        const hash = buildTradeRoomHashForAction(snapshotAction);
        return `/trade-room/${requestId}?action=${encodeURIComponent(snapshotAction)}#${hash}`;
      }
      if (relatedRequestId && notification.userId) {
        try {
          const response = await fetch(`/api/alpha-exchange/trade-room/${relatedRequestId}`, { cache: "no-store" });
          if (response.ok) {
            const payload = (await response.json()) as { request?: TradeRoomRequestPayload };
            const request = payload.request;
            if (request?.id) {
              const action = buildTradeRoomActionForRequest(request, notification.userId);
              const hash = buildTradeRoomHashForAction(action);
              return `/trade-room/${request.id}?action=${encodeURIComponent(action)}#${hash}`;
            }
          }
        } catch {
          // Fall back to active trade resolution below.
        }
      }
      const fallbackHref = resolveTradeRoomHref(notification);
      return await resolveActiveTradeHref({
        notificationId: notification.id,
        requestId: relatedRequestId,
        includePending: true,
        fallbackHref,
      })
        ?? fallbackHref;
    }
    return notification.actionHref ?? notification.relatedHref ?? null;
  }

  async function openNotificationDestination(notification: AlphaExchangeNotification) {
    const destination = await resolveNotificationDestination(notification);
    if (TRADE_ROOM_DEBUG) {
      console.log("[notification-open] notification click", {
        notificationId: notification.id,
        category: notification.category,
        relatedRequestId: notification.relatedRequestId ?? null,
        relatedListingId: notification.relatedListingId ?? null,
        relatedTradeId: notification.relatedTradeId ?? null,
        destination,
      });
    }
    if (!destination) {
      setError("Could not resolve this notification destination.");
      return;
    }
    const requestId = extractRequestIdFromTradeRoomHref(destination);
    if (requestId) {
      prefetchTradeRoom(router, requestId);
    }
    if (!notification.isRead) {
      void handleMarkOneRead(notification.id);
    }
    router.push(destination);
  }

  async function handleSellerApplicationDecision(notification: AlphaExchangeNotification, decision: "approve" | "reject") {
    const applicationId = extractSellerApplicationId(notification);
    if (!applicationId) return;
    const actionKey = `${decision}:${notification.id}`;
    if (itemLoading[actionKey]) return;
    setItemLoading((prev) => ({ ...prev, [actionKey]: true }));
    try {
      const reason = decision === "approve" ? "Approved from notification workflow" : "Rejected from notification workflow";
      const response = await fetch(`/api/alpha-exchange/admin/seller-applications/${encodeURIComponent(applicationId)}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        setError("Failed to update seller application.");
        return;
      }
      // A completed decision archives the matching owner/admin action alert on
      // the server. Reload it instead of marking it read and resurrecting it.
      await loadNotifications();
    } finally {
      setItemLoading((prev) => ({ ...prev, [actionKey]: false }));
    }
  }

  async function handleMarkOneRead(notificationId: string) {
    const key = `read:${notificationId}`;
    if (itemLoading[key]) return;
    const target = notifications.find((item) => item.id === notificationId);
    if (!target || target.isRead) return;
    setItemLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const response = await fetch(`/api/alpha-exchange/notifications/${notificationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
      if (!response.ok) {
        setError("Failed to update notification.");
        return;
      }
      const nextNotifications = notifications.map((item) => (item.id === notificationId ? { ...item, isRead: true } : item));
      const sortedNextNotifications = sortNotificationsNewestFirst(nextNotifications);
      const nextUnreadCount = Math.max(0, unreadCount - 1);
      setNotifications(sortedNextNotifications);
      setUnreadCount(nextUnreadCount);
      writeNotificationsCache({
        notifications: sortedNextNotifications,
        total: totalCount,
        unreadCount: nextUnreadCount,
      });
    } finally {
      setItemLoading((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function handleMarkAllRead() {
    if (isMarkingAllRead) return;
    setIsMarkingAllRead(true);
    try {
      const response = await fetch("/api/alpha-exchange/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      if (!response.ok) {
        setError("Failed to update notifications.");
        return;
      }
      const nextNotifications = sortNotificationsNewestFirst(notifications.map((item) => ({ ...item, isRead: true })));
      setNotifications(nextNotifications);
      setUnreadCount(0);
      writeNotificationsCache({
        notifications: nextNotifications,
        total: totalCount,
        unreadCount: 0,
      });
    } finally {
      setIsMarkingAllRead(false);
    }
  }

  const canLoadOlder = notifications.length < totalCount;

  async function handleLoadOlder() {
    if (isLoadingMore || !canLoadOlder) return;
    await loadNotifications({ offset: notifications.length, append: true });
  }

  return (
    <section className="section-container page-shell">
      <Card className="border-white/10 bg-[#0B0B0B]/90">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-white">
            <BellDot className="h-5 w-5 text-[#C9A227]" />
            Notifications
            {unreadCount > 0 ? (
              <span className="badge-chip border-[#C9A227]/35 bg-[#C9A227]/10 font-normal text-[#C9A227]">
                {unreadCount} unread
              </span>
            ) : null}
          </CardTitle>
          <CardDescription>Complete notification history for your account.</CardDescription>
          {highlightedReminder ? (
            <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <p className="font-semibold">{highlightedReminder.title}</p>
              <p className="mt-1">{highlightedReminder.message}</p>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
              <Input className="ps-9" placeholder="Search notifications" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Button type="button" size="sm" variant="secondary" className="h-11 px-4" loading={isMarkingAllRead} loadingLabel="Marking..." onClick={() => void handleMarkAllRead()}>
              Mark all as read
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {(["all", "actions", "unread", "trades", "listings", "reviews", "announcements", "history"] as NotificationFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`inline-flex min-h-10 items-center rounded-full border px-3 text-sm transition ${
                  filter === item
                    ? "border-[#C9A227]/50 bg-[#C9A227]/15 text-[#C9A227]"
                    : "border-white/15 bg-black/20 text-[#D1D5DB] hover:border-white/25 hover:text-white"
                }`}
              >
                {item === "all" ? "All" : item === "actions" ? "Needs action" : item === "unread" ? "Unread" : item === "trades" ? "Trades" : item === "listings" ? "Listings" : item === "reviews" ? "Reviews" : item === "announcements" ? "Announcements" : "History"}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-20 animate-pulse rounded-xl border border-white/10 bg-black/20" />
              ))}
            </div>
          ) : null}
          {!loading && error ? <p className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</p> : null}
          {!loading && !error && pageItems.length === 0 ? <p className="empty-state-panel">No notifications found for this filter.</p> : null}

          <div className="space-y-4">
            {groupedPageItems.map((group) => (
              <div key={group.label} className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{group.label}</p>
                {group.items.map((notification) => {
                  const Icon = notificationIcon(notification);
                  const actionRequired = isNotificationActionRequired(notification);
                  return (
                    <div
                      key={notification.id}
                      className={`rounded-xl border p-3 md:p-4 ${actionRequired ? "border-amber-400/55 bg-amber-500/10" : notification.isRead ? "border-white/10 bg-black/20" : "border-[#C9A227]/35 bg-[#C9A227]/10"}`}
                    >
                      <div className="flex items-start gap-3">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A227]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="text-sm font-medium text-white">{formatNotificationTitle(notification)}</p>
                            <span className="text-[11px] text-[#9CA3AF]">{formatNotificationRelativeTime(notification.createdAt, locale)}</span>
                          </div>
                          <p className="mt-1 text-sm text-[#D1D5DB]">{formatNotificationMessage(notification)}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[#C9A227]">
                            {!notification.isRead ? <span className="rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2 py-0.5">Unread</span> : <span className="rounded-full border border-white/15 px-2 py-0.5 text-[#9CA3AF]">Read</span>}
                            {actionRequired ? <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-semibold text-amber-200">Action required</span> : null}
                            {isTradeNotification(notification) && (notification.relatedTradeId || notification.relatedTradeDisplayNumber || notification.relatedRequestId || notification.relatedRequestDisplayNumber) ? <span className="rounded-full border border-white/15 px-2 py-0.5 text-[#D1D5DB]">Trade {formatTradeId(notification.relatedTradeDisplayNumber ?? notification.relatedRequestDisplayNumber, notification.relatedTradeId ?? notification.relatedRequestId)}</span> : null}
                            {notification.relatedListingId || notification.relatedListingDisplayNumber ? <span className="rounded-full border border-white/15 px-2 py-0.5 text-[#D1D5DB]">Listing {formatListingId(notification.relatedListingDisplayNumber, notification.relatedListingId)}</span> : null}
                            {notification.tradeSnapshot?.usdtAmount ? <span className="rounded-full border border-white/15 px-2 py-0.5 text-[#D1D5DB]">{notification.tradeSnapshot.usdtAmount} USDT</span> : null}
                            {notification.tradeSnapshot?.counterpartyName ? <span className="rounded-full border border-white/15 px-2 py-0.5 text-[#D1D5DB]">{notification.tradeSnapshot.counterpartyName}</span> : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-10 px-3 text-xs md:h-8"
                              onMouseEnter={() => {
                                if (!isTradeNotification(notification)) return;
                                const href = resolveTradeRoomHref(notification);
                                const requestId = extractRequestIdFromTradeRoomHref(href);
                                if (requestId) prefetchTradeRoom(router, requestId);
                              }}
                              onFocus={() => {
                                if (!isTradeNotification(notification)) return;
                                const href = resolveTradeRoomHref(notification);
                                const requestId = extractRequestIdFromTradeRoomHref(href);
                                if (requestId) prefetchTradeRoom(router, requestId);
                              }}
                              onClick={() => void openNotificationDestination(notification)}
                            >
                              {resolveNotificationActionLabel(notification)}
                            </Button>
                            {notification.category === "application" && extractSellerApplicationId(notification) ? (
                              <>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-10 px-3 text-xs md:h-8"
                              loading={Boolean(itemLoading[`approve:${notification.id}`])}
                              loadingLabel="Approving..."
                              onClick={() => void handleSellerApplicationDecision(notification, "approve")}
                            >
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-10 px-3 text-xs md:h-8"
                              loading={Boolean(itemLoading[`reject:${notification.id}`])}
                              loadingLabel="Rejecting..."
                              onClick={() => void handleSellerApplicationDecision(notification, "reject")}
                            >
                              Reject
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-10 px-3 text-xs md:h-8"
                              onClick={() => void handleMarkOneRead(notification.id)}
                            >
                              Later
                            </Button>
                          </>
                        ) : (
                          <>
                            {!notification.isRead ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-10 px-3 text-xs md:h-8"
                                loading={Boolean(itemLoading[`read:${notification.id}`])}
                                loadingLabel="Saving..."
                                onClick={() => void handleMarkOneRead(notification.id)}
                              >
                                Mark as read
                              </Button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                  );
                })}
              </div>
            ))}
          </div>

          {canLoadOlder ? (
            <div className="flex justify-center pt-1">
              <Button type="button" size="sm" variant="secondary" className="h-10 px-4 text-xs md:h-8" loading={isLoadingMore} loadingLabel="Loading..." onClick={() => void handleLoadOlder()}>
                Load older notifications
              </Button>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-white/10 pt-3">
            <p className="text-xs text-[#9CA3AF]">
              Showing {pageItems.length ? pageStart + 1 : 0}-{Math.min(pageStart + PAGE_SIZE, filteredNotifications.length)} of {filteredNotifications.length}
              {totalCount > notifications.length ? ` loaded (${notifications.length}/${totalCount} total)` : ""}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="secondary" className="h-10 px-3 text-xs md:h-8" disabled={currentPage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                Previous
              </Button>
              <span className="text-xs text-[#D1D5DB]">
                {currentPage}/{totalPages}
              </span>
              <Button type="button" size="sm" variant="secondary" className="h-10 px-3 text-xs md:h-8" disabled={currentPage >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
