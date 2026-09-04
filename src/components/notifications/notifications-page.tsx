"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellDot, CheckCheck, Megaphone, Scale, Search, ShieldCheck, Star, Tags, UserRound } from "lucide-react";
import type { AppLocale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
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
import { localizeNotificationActionLabel, localizeNotificationCopy } from "@/lib/notification-localization";

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

type NotificationGroup = {
  key: string;
  label: string;
  description?: string;
  isActionGroup: boolean;
  items: AlphaExchangeNotification[];
};

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

function buildTradeRoomActionForSnapshot(snapshot: TradeSnapshotPayload | null | undefined, actorUserId: string) {
  const requestId = String(snapshot?.requestId ?? "").trim();
  const status = String(snapshot?.currentStage ?? "").trim();
  const sellerId = String(snapshot?.sellerId ?? "").trim();
  const buyerId = String(snapshot?.buyerId ?? "").trim();
  if (!requestId || !status || !sellerId || !buyerId) return null;
  return buildTradeRoomActionForRequest({ id: requestId, status, sellerId, buyerId }, actorUserId);
}

function notificationNeedsUserAction(notification: AlphaExchangeNotification) {
  if (isNotificationActionRequired(notification)) return true;
  if (notification.category !== "trade") return false;
  const tradeAction = buildTradeRoomActionForSnapshot(notification.tradeSnapshot, notification.userId);
  return Boolean(tradeAction && tradeAction !== "open-trade");
}

function tradeRoomActionLabel(action: string, locale: AppLocale) {
  const isAr = locale === "ar";
  if (action === "accept-trade") return isAr ? "مراجعة طلب الصفقة" : "Review trade request";
  if (action === "upload-payment-receipt") return isAr ? "رفع إيصال الدفع" : "Upload payment receipt";
  if (action === "confirm-money-received") return isAr ? "تأكيد استلام الدفعة" : "Confirm payment received";
  if (action === "upload-seller-evidence") return isAr ? "رفع الإثبات وإرسال USDT" : "Upload proof and send USDT";
  if (action === "confirm-usdt-received") return isAr ? "تأكيد استلام USDT" : "Confirm USDT received";
  if (action === "review-trade") return isAr ? "إضافة تقييم للصفقة" : "Leave a trade review";
  return isAr ? "عرض تفاصيل الصفقة" : "View trade details";
}

function matchesFilter(notification: AlphaExchangeNotification, filter: NotificationFilter) {
  if (filter === "history") return notification.state === "archived";
  if (filter === "all") return true;
  if (filter === "actions") return notificationNeedsUserAction(notification);
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

function notificationFilterLabel(filter: NotificationFilter, locale: AppLocale) {
  const isAr = locale === "ar";
  if (filter === "all") return isAr ? "الكل" : "All";
  if (filter === "actions") return isAr ? "تحتاج إلى إجراء" : "Needs action";
  if (filter === "unread") return isAr ? "غير مقروء" : "Unread";
  if (filter === "trades") return isAr ? "الصفقات" : "Trades";
  if (filter === "listings") return isAr ? "العروض" : "Listings";
  if (filter === "reviews") return isAr ? "التقييمات" : "Reviews";
  if (filter === "announcements") return isAr ? "الإعلانات" : "Announcements";
  return isAr ? "السجل" : "History";
}

function buildNotificationGroups(
  notifications: AlphaExchangeNotification[],
  filter: NotificationFilter,
  locale: AppLocale,
) {
  const groups: NotificationGroup[] = [];
  const dayGroups = new Map<string, AlphaExchangeNotification[]>();
  const actionItems = filter === "all"
    ? notifications.filter(notificationNeedsUserAction)
    : [];
  const remainingItems = filter === "all"
    ? notifications.filter((notification) => !notificationNeedsUserAction(notification))
    : notifications;

  if (actionItems.length > 0) {
    groups.push({
      key: "needs-action",
      label: locale === "ar" ? "تحتاج إلى إجراء الآن" : "Needs your action",
      description: locale === "ar" ? "ابدأ بهذه الإشعارات أولاً" : "Start with these notifications first",
      isActionGroup: true,
      items: actionItems,
    });
  }

  for (const notification of remainingItems) {
    const key = notificationGroupLabel(new Date(notification.createdAt), locale);
    const items = dayGroups.get(key) ?? [];
    items.push(notification);
    dayGroups.set(key, items);
  }

  for (const [label, items] of dayGroups) {
    groups.push({ key: `date-${label}`, label, isActionGroup: false, items });
  }

  return groups;
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
    const match = parsed.pathname.match(/\/trade-room\/([^/]+)\/?$/i);
    return match?.[1] ? decodeURIComponent(match[1]).trim() || null : null;
  } catch {
    const match = href.split("?")[0]?.split("#")[0]?.match(/\/trade-room\/([^/]+)\/?$/i);
    return match?.[1] ? decodeURIComponent(match[1]).trim() || null : null;
  }
}

function canResolveNotificationDestination(notification: AlphaExchangeNotification) {
  if (getCommissionPaymentNotificationDestination(notification)) return true;
  if (getTradeRoomConversationDestination(notification)) return true;
  if (getExplicitNonTradeRoomNotificationDestination(notification)) return true;
  if (notification.category !== "trade") return false;
  return Boolean(
    notification.relatedRequestId?.trim()
    || (notification.tradeSnapshot as TradeSnapshotPayload | undefined)?.requestId?.trim()
    || extractTradeRoomHrefFromRelatedHref(notification.relatedHref ?? notification.actionHref),
  );
}

function formatNotificationTitle(notification: AlphaExchangeNotification, locale: AppLocale) {
  return replaceExchangeEntityIdsWithHints(localizeNotificationCopy(notification, locale).title, notification);
}

function formatNotificationMessage(notification: AlphaExchangeNotification, locale: AppLocale) {
  return replaceExchangeEntityIdsWithHints(localizeNotificationCopy(notification, locale).message, notification);
}

export function NotificationsPage({ locale }: { locale: AppLocale }) {
  const isAr = locale === "ar";
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
        throw new Error(isAr ? "تعذر تحميل الإشعارات." : "Failed to load notifications.");
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
      setError(isAr ? "تعذر تحميل الإشعارات." : "Failed to load notifications.");
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [canLoadNotifications, canonicalSession, fetchLimit, filter, isAr]);

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
      const haystack = `${formatNotificationTitle(notification, locale)} ${formatNotificationMessage(notification, locale)} ${notification.relatedSellerName ?? ""} ${notification.relatedSellerUsername ?? ""} ${notification.relatedTradeId ?? ""} ${notification.relatedListingId ?? ""}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [filter, locale, notifications, search]);

  const actionRequiredCount = useMemo(
    () => notifications.filter(notificationNeedsUserAction).length,
    [notifications],
  );

  const orderedFilteredNotifications = useMemo(() => {
    if (filter !== "all") return filteredNotifications;
    const actionItems = filteredNotifications.filter(notificationNeedsUserAction);
    const otherItems = filteredNotifications.filter((notification) => !notificationNeedsUserAction(notification));
    return [...actionItems, ...otherItems];
  }, [filter, filteredNotifications]);

  const totalPages = Math.max(1, Math.ceil(orderedFilteredNotifications.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageItems = orderedFilteredNotifications.slice(pageStart, pageStart + PAGE_SIZE);

  const groupedPageItems = useMemo(() => {
    return buildNotificationGroups(pageItems, filter, locale);
  }, [filter, locale, pageItems]);

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
    if (getCommissionPaymentNotificationDestination(notification)) {
      return isAr ? "دفع العمولة" : "Pay commission";
    }

    if (isTradeNotification(notification)) {
      const text = `${notification.title} ${notification.message}`.toLowerCase();
      const normalizedTitle = notification.title.toLowerCase();
      if (notification.reason === "trade_room_message" || normalizedTitle.includes("trade room message")) {
        return isAr ? "فتح رسالة الصفقة" : "Open trade message";
      }
      const tradeAction = buildTradeRoomActionForSnapshot(notification.tradeSnapshot, notification.userId);
      if (tradeAction && tradeAction !== "open-trade") return tradeRoomActionLabel(tradeAction, locale);
      if (notification.actionLabel?.trim()) {
        return localizeNotificationActionLabel(notification.actionLabel, locale, notification);
      }
      if (text.includes("review") || text.includes("feedback")) return isAr ? "إضافة تقييم" : "Leave a review";
      if (text.includes("new trade request")) return isAr ? "مراجعة طلب الصفقة" : "Review trade request";
      if (text.includes("completed") || text.includes("cancelled") || text.includes("closed")) return isAr ? "عرض تفاصيل الصفقة" : "View trade details";
      return isAr ? "متابعة الصفقة" : "Continue trade";
    }

    if (notification.actionLabel?.trim()) {
      return localizeNotificationActionLabel(notification.actionLabel, locale, notification);
    }

    const label = notification.category === "application"
      ? "Review Application"
      : notification.category === "listing"
        ? "Manage Listing"
        : "View Details";
    return localizeNotificationActionLabel(label, locale, notification);
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
      setError(isAr ? "تعذر تحديد وجهة هذا الإشعار." : "Could not resolve this notification destination.");
      return;
    }
    const requestId = extractRequestIdFromTradeRoomHref(destination);
    if (requestId) {
      prefetchTradeRoom(router, requestId);
    }
    if (!notification.isRead) {
      await handleMarkOneRead(notification.id);
    }
    router.push(destination);
  }

  async function handleSellerApplicationDecision(notification: AlphaExchangeNotification, decision: "approve" | "reject") {
    const applicationId = extractSellerApplicationId(notification);
    if (!applicationId) return;
    const actionKey = `${decision}:${notification.id}`;
    if (itemLoading[`approve:${notification.id}`] || itemLoading[`reject:${notification.id}`]) return;
    setItemLoading((prev) => ({ ...prev, [actionKey]: true }));
    try {
      const reason = decision === "approve" ? "Approved from notification workflow" : "Rejected from notification workflow";
      const response = await fetch(`/api/alpha-exchange/admin/seller-applications/${encodeURIComponent(applicationId)}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        setError(isAr ? "تعذر تحديث طلب البائع." : "Failed to update seller application.");
        return;
      }
      // A completed decision archives the matching owner/admin action alert on
      // the server. Reload it instead of marking it read and resurrecting it.
      await loadNotifications();
    } catch {
      setError(isAr ? "تعذر تحديث طلب البائع." : "Failed to update seller application.");
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
        setError(isAr ? "تعذر تحديث الإشعار." : "Failed to update notification.");
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
        setError(isAr ? "تعذر تحديث الإشعارات." : "Failed to update notifications.");
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
    <section className="section-container page-shell" dir={isAr ? "rtl" : "ltr"}>
      <Card className="border-white/10 bg-[#0B0B0B]/90">
        <CardHeader className="space-y-4 p-4 sm:p-6">
          <div className="space-y-2">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold leading-snug tracking-tight text-white sm:text-2xl">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10">
                <BellDot className="h-5 w-5 text-[#C9A227]" aria-hidden="true" />
              </span>
              <span>{isAr ? "مركز الإشعارات" : "Notification center"}</span>
              {unreadCount > 0 ? (
                <span className="rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2.5 py-1 text-xs font-semibold text-[#F3CF58]">
                  {unreadCount} {isAr ? "غير مقروء" : "unread"}
                </span>
              ) : null}
            </h1>
            <CardDescription className="text-[15px] leading-6 text-[#B8BEC8] sm:text-base">
              {isAr
                ? "ابدأ بما يحتاج إلى إجراء، ثم راجع آخر تحديثات حسابك."
                : "Start with what needs action, then review your latest account updates."}
            </CardDescription>
          </div>

          <div className="grid grid-cols-2 gap-2" aria-live="polite">
            <button
              type="button"
              aria-label={isAr ? `عرض الإشعارات التي تحتاج إلى إجراء: ${actionRequiredCount}` : `Show notifications that need action: ${actionRequiredCount}`}
              aria-pressed={filter === "actions"}
              onClick={() => setFilter("actions")}
              className={`min-h-[76px] rounded-2xl border p-3 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] ${
                filter === "actions"
                  ? "border-amber-300/60 bg-amber-400/15"
                  : "border-amber-400/25 bg-amber-500/[0.07] hover:border-amber-300/45"
              }`}
            >
              <span className="block text-sm font-medium leading-5 text-amber-100">{isAr ? "تحتاج إلى إجراء" : "Needs action"}</span>
              <span className="mt-1 block text-2xl font-semibold leading-none text-amber-300">{actionRequiredCount}</span>
            </button>
            <button
              type="button"
              aria-label={isAr ? `عرض الإشعارات غير المقروءة: ${unreadCount}` : `Show unread notifications: ${unreadCount}`}
              aria-pressed={filter === "unread"}
              onClick={() => setFilter("unread")}
              className={`min-h-[76px] rounded-2xl border p-3 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] ${
                filter === "unread"
                  ? "border-[#C9A227]/60 bg-[#C9A227]/15"
                  : "border-white/15 bg-white/[0.03] hover:border-[#C9A227]/35"
              }`}
            >
              <span className="block text-sm font-medium leading-5 text-[#D7DBE2]">{isAr ? "غير مقروء" : "Unread"}</span>
              <span className="mt-1 block text-2xl font-semibold leading-none text-white">{unreadCount}</span>
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-4 pt-0 sm:p-6 sm:pt-0">
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
              <Input
                aria-label={isAr ? "البحث في الإشعارات" : "Search notifications"}
                className="h-12 ps-10 text-base md:h-11"
                placeholder={isAr ? "ابحث عن صفقة، عرض، أو بائع" : "Search a trade, listing, or seller"}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-12 px-4 text-sm md:h-11"
              disabled={unreadCount === 0}
              loading={isMarkingAllRead}
              loadingLabel={isAr ? "جاري التحديد..." : "Marking..."}
              onClick={() => void handleMarkAllRead()}
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              {isAr ? "تحديد الكل كمقروء" : "Mark all as read"}
            </Button>
          </div>

          <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0">
            <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap" role="group" aria-label={isAr ? "تصنيف الإشعارات" : "Notification filters"}>
              {(["all", "actions", "unread", "trades", "listings", "reviews", "announcements", "history"] as NotificationFilter[]).map((item) => {
                const count = item === "actions" ? actionRequiredCount : item === "unread" ? unreadCount : null;
                return (
                  <button
                    key={item}
                    type="button"
                    aria-label={`${notificationFilterLabel(item, locale)}${count !== null ? `: ${count}` : ""}`}
                    aria-pressed={filter === item}
                    onClick={() => setFilter(item)}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] ${
                      filter === item
                        ? "border-[#C9A227]/55 bg-[#C9A227]/15 text-[#F3CF58]"
                        : "border-white/15 bg-black/20 text-[#D1D5DB] hover:border-white/25 hover:text-white"
                    }`}
                  >
                    <span>{notificationFilterLabel(item, locale)}</span>
                    {count !== null && count > 0 ? (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-white/10 px-1.5 text-xs leading-5 text-white">{count}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3" aria-label={isAr ? "جاري تحميل الإشعارات" : "Loading notifications"}>
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-36 animate-pulse rounded-2xl border border-white/10 bg-black/20" />
              ))}
            </div>
          ) : null}
          {!loading && error ? <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-base leading-6 text-red-200">{error}</p> : null}
          {!loading && !error && pageItems.length === 0 ? (
            <div className="empty-state-panel py-8 text-center">
              <CheckCheck className="mx-auto h-7 w-7 text-[#C9A227]" aria-hidden="true" />
              <p className="mt-2 text-base font-medium text-white">{isAr ? "لا توجد إشعارات هنا" : "Nothing here right now"}</p>
              <p className="mt-1 text-sm leading-6 text-[#AEB4BE]">
                {isAr
                  ? `لا توجد إشعارات ضمن تصنيف «${notificationFilterLabel(filter, locale)}».`
                  : `There are no notifications in “${notificationFilterLabel(filter, locale)}”.`}
              </p>
            </div>
          ) : null}

          {!loading && !error ? <div className="space-y-6">
            {groupedPageItems.map((group) => (
              <section key={group.key} className="space-y-3">
                <div className={`flex items-end justify-between gap-3 border-b pb-2 ${group.isActionGroup ? "border-amber-400/25" : "border-white/10"}`}>
                  <div>
                    <h2 className={`text-sm font-semibold leading-5 ${group.isActionGroup ? "text-amber-200" : "text-[#D7DBE2]"} ${!isAr && !group.isActionGroup ? "uppercase tracking-[0.08em]" : ""}`}>
                      {group.label}
                    </h2>
                    {group.description ? <p className="mt-0.5 text-sm leading-5 text-[#AEB4BE]">{group.description}</p> : null}
                  </div>
                  <span className="shrink-0 text-xs text-[#8F96A1]">{group.items.length}</span>
                </div>
                {group.items.map((notification) => {
                  const Icon = notificationIcon(notification);
                  const actionRequired = notificationNeedsUserAction(notification);
                  const hasPrimaryDestination = canResolveNotificationDestination(notification);
                  return (
                    <article
                      key={notification.id}
                      className={`rounded-2xl border p-4 transition sm:p-5 ${actionRequired ? "border-amber-400/45 bg-amber-500/[0.09]" : notification.isRead ? "border-white/10 bg-black/20" : "border-[#C9A227]/35 bg-[#C9A227]/[0.08]"}`}
                    >
                      <div className="flex items-start gap-3.5">
                        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${actionRequired ? "border-amber-400/35 bg-amber-400/10" : "border-[#C9A227]/25 bg-[#C9A227]/10"}`}>
                          <Icon className={`h-5 w-5 ${actionRequired ? "text-amber-300" : "text-[#D6B13F]"}`} aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-base font-semibold leading-6 text-white"><bdi dir="auto">{formatNotificationTitle(notification, locale)}</bdi></h3>
                            {!notification.isRead ? (
                              <span role="img" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#E5BD3D]" aria-label={isAr ? "غير مقروء" : "Unread"} />
                            ) : null}
                          </div>
                          <span className="mt-1 block text-xs leading-5 text-[#9CA3AF]">{formatNotificationRelativeTime(notification.createdAt, locale)}</span>
                          <p className="mt-2 text-base leading-7 text-[#D7DBE2]"><bdi dir="auto" className="text-base">{formatNotificationMessage(notification, locale)}</bdi></p>
                          <div className="mt-3 flex flex-wrap gap-1.5 text-xs leading-5">
                            {actionRequired ? <span className="rounded-full border border-amber-400/35 bg-amber-400/10 px-2.5 py-1 font-semibold text-amber-200">{isAr ? "مطلوب منك إجراء" : "Action required"}</span> : null}
                            {isTradeNotification(notification) && (notification.relatedTradeId || notification.relatedTradeDisplayNumber || notification.relatedRequestId || notification.relatedRequestDisplayNumber) ? <span className="rounded-full border border-white/15 px-2.5 py-1 text-[#D1D5DB]">{isAr ? "صفقة" : "Trade"} <bdi dir="ltr">{formatTradeId(notification.relatedTradeDisplayNumber ?? notification.relatedRequestDisplayNumber, notification.relatedTradeId ?? notification.relatedRequestId)}</bdi></span> : null}
                            {notification.relatedListingId || notification.relatedListingDisplayNumber ? <span className="rounded-full border border-white/15 px-2.5 py-1 text-[#D1D5DB]">{isAr ? "عرض" : "Listing"} <bdi dir="ltr">{formatListingId(notification.relatedListingDisplayNumber, notification.relatedListingId)}</bdi></span> : null}
                            {notification.relatedSellerName ? <span className="max-w-full truncate rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-2.5 py-1 text-[#FDE68A]">{isAr ? "البائع" : "Seller"}: <bdi dir="auto">{notification.relatedSellerName}</bdi>{notification.relatedSellerUsername ? <> • <bdi dir="ltr">@{notification.relatedSellerUsername}</bdi></> : null}</span> : null}
                            {notification.tradeSnapshot?.usdtAmount ? <span className="rounded-full border border-white/15 px-2.5 py-1 text-[#D1D5DB]"><bdi dir="ltr">{notification.tradeSnapshot.usdtAmount} USDT</bdi></span> : null}
                            {notification.tradeSnapshot?.counterpartyName ? <span className="rounded-full border border-white/15 px-2.5 py-1 text-[#D1D5DB]"><bdi dir="auto">{notification.tradeSnapshot.counterpartyName}</bdi></span> : null}
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                            {hasPrimaryDestination ? (
                              <Button
                                type="button"
                                size="sm"
                                variant={actionRequired && notification.category !== "application" ? "default" : "secondary"}
                                className="col-span-2 h-auto min-h-11 px-4 py-2 text-sm sm:col-auto md:min-h-9"
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
                            ) : null}
                            {notification.category === "application" && extractSellerApplicationId(notification) ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="default"
                                  className="h-auto min-h-11 px-4 py-2 text-sm md:min-h-9"
                                  disabled={Boolean(itemLoading[`approve:${notification.id}`] || itemLoading[`reject:${notification.id}`])}
                                  loading={Boolean(itemLoading[`approve:${notification.id}`])}
                                  loadingLabel={isAr ? "جاري القبول..." : "Approving..."}
                                  onClick={() => void handleSellerApplicationDecision(notification, "approve")}
                                >
                                  {isAr ? "قبول الطلب" : "Approve application"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  className="h-auto min-h-11 px-4 py-2 text-sm md:min-h-9"
                                  disabled={Boolean(itemLoading[`approve:${notification.id}`] || itemLoading[`reject:${notification.id}`])}
                                  loading={Boolean(itemLoading[`reject:${notification.id}`])}
                                  loadingLabel={isAr ? "جاري الرفض..." : "Rejecting..."}
                                  onClick={() => void handleSellerApplicationDecision(notification, "reject")}
                                >
                                  {isAr ? "رفض الطلب" : "Reject application"}
                                </Button>
                                {!notification.isRead ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="col-span-2 h-auto min-h-11 px-4 py-2 text-sm sm:col-auto md:min-h-9"
                                    loading={Boolean(itemLoading[`read:${notification.id}`])}
                                    loadingLabel={isAr ? "جاري الحفظ..." : "Saving..."}
                                    onClick={() => void handleMarkOneRead(notification.id)}
                                  >
                                    {isAr ? "تحديد كمقروء" : "Mark as read"}
                                  </Button>
                                ) : null}
                              </>
                            ) : !notification.isRead ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="col-span-2 h-auto min-h-11 px-4 py-2 text-sm sm:col-auto md:min-h-9"
                                loading={Boolean(itemLoading[`read:${notification.id}`])}
                                loadingLabel={isAr ? "جاري الحفظ..." : "Saving..."}
                                onClick={() => void handleMarkOneRead(notification.id)}
                              >
                                {isAr ? "تحديد كمقروء" : "Mark as read"}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </div> : null}

          {canLoadOlder ? (
            <div className="flex justify-center pt-1">
              <Button type="button" size="sm" variant="secondary" className="h-11 px-4 text-sm md:h-9" loading={isLoadingMore} loadingLabel={isAr ? "جاري التحميل..." : "Loading..."} onClick={() => void handleLoadOlder()}>
                {isAr ? "تحميل إشعارات أقدم" : "Load older notifications"}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-5 text-[#9CA3AF]">
              {isAr ? "عرض" : "Showing"} {pageItems.length ? pageStart + 1 : 0}-{Math.min(pageStart + PAGE_SIZE, filteredNotifications.length)} {isAr ? "من" : "of"} {filteredNotifications.length}
              {totalCount > notifications.length ? (isAr ? ` (تم تحميل ${notifications.length} من ${totalCount})` : ` loaded (${notifications.length}/${totalCount} total)`) : ""}
            </p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex">
              <Button type="button" size="sm" variant="secondary" className="h-11 px-3 text-sm md:h-9" disabled={currentPage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                {isAr ? "السابق" : "Previous"}
              </Button>
              <span className="min-w-12 text-center text-sm text-[#D1D5DB]">
                {currentPage}/{totalPages}
              </span>
              <Button type="button" size="sm" variant="secondary" className="h-11 px-3 text-sm md:h-9" disabled={currentPage >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>
                {isAr ? "التالي" : "Next"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
