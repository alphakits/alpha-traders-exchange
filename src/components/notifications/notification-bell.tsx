"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellDot, CircleDot, Megaphone, Scale, ShieldCheck, Star, Tags, UserRound, XCircle } from "lucide-react";
import type { AppLocale } from "@/i18n/routing";
import { Link, useRouter } from "@/i18n/navigation";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";
import { Button } from "@/components/ui/button";
import { appendLoginJourneyStep, incrementLoginJourneyApiCall } from "@/lib/login-journey-trace";
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

const BELL_REFRESH_WINDOW_MS = 30_000;

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

function notificationIcon(notification: AlphaExchangeNotification) {
  if (notification.category === "trade") return Scale;
  if (notification.category === "listing") return Tags;
  if (notification.category === "application") return UserRound;
  if (notification.category === "report" || notification.category === "dispute") return ShieldCheck;
  if (notification.category === "trust") return Star;
  if (notification.title.toLowerCase().includes("announcement")) return Megaphone;
  return BellDot;
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

function extractRequestIdFromTradeRoomHref(href: string | null | undefined) {
  if (!href) return null;
  try {
    const parsed = new URL(href, "https://www.alphatraders.co.il");
    const normalizedPath = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    const match = normalizedPath.match(/\/trade-room\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
    return null;
  } catch {
    const normalized = href.split("?")[0]?.split("#")[0]?.replace(/\/+$/, "") ?? "";
    const match = normalized.match(/\/trade-room\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
    return null;
  }
}

function formatNotificationTitle(notification: AlphaExchangeNotification) {
  return replaceExchangeEntityIdsWithHints(notification.title, notification);
}

function formatNotificationMessage(notification: AlphaExchangeNotification) {
  return replaceExchangeEntityIdsWithHints(notification.message, notification);
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

function inferTradeActionFromNotificationText(notification: AlphaExchangeNotification) {
  const text = `${notification.title} ${notification.message}`.toLowerCase();
  if (/new trade request/.test(text)) return "accept-trade";
  if (/trade request accepted/.test(text)) return "upload-payment-receipt";
  if (/buyer marked payment sent|payment sent/.test(text)) return "confirm-money-received";
  if (/seller confirmed funds received|usdt release pending/.test(text)) return "upload-seller-evidence";
  if (/seller marked usdt sent|usdt sent/.test(text)) return "confirm-usdt-received";
  if (/review available|trade completed/.test(text)) return "review-trade";
  return "open-trade";
}

function buildTradeDestinationFromNotification(notification: AlphaExchangeNotification) {
  const conversationDestination = getTradeRoomConversationDestination(notification);
  if (conversationDestination) return conversationDestination;
  const requestId = notification.relatedRequestId?.trim()
    || (notification.tradeSnapshot as TradeSnapshotPayload | undefined)?.requestId?.trim()
    || extractRequestIdFromTradeRoomHref(notification.relatedHref ?? notification.actionHref)
    || null;
  if (!requestId) return null;

  const snapshotAction = notification.userId
    ? buildTradeRoomActionForSnapshot(notification.tradeSnapshot as TradeSnapshotPayload, notification.userId)
    : null;
  const action = snapshotAction ?? inferTradeActionFromNotificationText(notification);
  const hash = buildTradeRoomHashForAction(action);
  return `/trade-room/${requestId}?action=${encodeURIComponent(action)}#${hash}`;
}

export function NotificationBell({ locale }: { locale: AppLocale }) {
  const canonicalSession = useOptionalCanonicalSession();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [notifications, setNotifications] = useState<AlphaExchangeNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState(0);
  const [openNotificationsSnapshot, setOpenNotificationsSnapshot] = useState<AlphaExchangeNotification[] | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const isOpenRef = useRef(false);
  const notificationsCountRef = useRef(0);
  const router = useRouter();
  const canLoadNotifications = !canonicalSession || (!canonicalSession.isResolving && Boolean(canonicalSession.user));

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setOpenNotificationsSnapshot(null);
      return;
    }
    if (openNotificationsSnapshot === null && notifications.length > 0) {
      setOpenNotificationsSnapshot(notifications);
    }
  }, [isOpen, notifications, openNotificationsSnapshot]);

  useEffect(() => {
    notificationsCountRef.current = notifications.length;
  }, [notifications.length]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    const closeOutside = (event: PointerEvent) => {
      if (panelRef.current && event.target instanceof Node && !panelRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [isOpen]);

  const loadNotifications = useCallback(async (limit: number, options?: { preserveOpenList?: boolean }) => {
    if (!canLoadNotifications) return;
    const startedAt = Date.now();
    const shouldPreserveList = options?.preserveOpenList && isOpenRef.current && notificationsCountRef.current > 0;
    if (!shouldPreserveList) {
      setIsLoading(true);
    }
    setError(null);
    try {
      incrementLoginJourneyApiCall("/api/alpha-exchange/notifications");
      const response = await fetch(`/api/alpha-exchange/notifications?limit=${limit}&includeActivity=0`, { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) void canonicalSession?.refresh({ force: true });
        throw new Error("Failed to load notifications.");
      }
      const payload = (await response.json()) as NotificationsPayload;
      const keepVisibleList = isOpenRef.current && notificationsCountRef.current > 0;
      if (!shouldPreserveList && !keepVisibleList) {
        setNotifications(sortNotificationsNewestFirst(payload.notifications ?? []));
      }
      setUnreadCount(payload.unreadCount ?? 0);
      setLastLoadedAt(Date.now());
      appendLoginJourneyStep("Notifications loading (header bell)", startedAt, Date.now(), { limit, status: response.status });
    } catch {
      setError("Failed to load notifications.");
    } finally {
      if (!shouldPreserveList) {
        setIsLoading(false);
      }
    }
  }, [canLoadNotifications, canonicalSession]);

  useEffect(() => {
    if (!canLoadNotifications) return;
    void loadNotifications(20);
  }, [canLoadNotifications, loadNotifications]);

  const handleNotificationStream = useCallback((event: Event) => {
    const messageEvent = event as MessageEvent<string>;
    try {
      const payload = JSON.parse(messageEvent.data) as NotificationsStreamPayload;
      if (!isOpenRef.current) {
        setNotifications(sortNotificationsNewestFirst(Array.isArray(payload.notifications) ? payload.notifications : []));
      }
      setUnreadCount(typeof payload.unreadCount === "number" ? payload.unreadCount : 0);
    } catch {
      // Ignore malformed stream payloads and keep current state.
    }
  }, []);
  useAuthenticatedNotificationStream({ enabled: canLoadNotifications, onNotifications: handleNotificationStream });

  async function handleToggleOpen() {
    const nextOpen = !isOpen;
    if (nextOpen) {
      router.prefetch("/notifications");
      const isFresh = Date.now() - lastLoadedAt < BELL_REFRESH_WINDOW_MS;
      if (!isFresh || notifications.length === 0) {
        await loadNotifications(20);
      }
      setIsOpen(true);
      return;
    }
    setIsOpen(false);
  }

  async function handleMarkOneRead(notificationId: string) {
    const target = notifications.find((item) => item.id === notificationId);
    if (!target || target.isRead) return;
    // Optimistic update — reflect the change immediately without waiting for the server.
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, isRead: true, state: "read" as const } : n)),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      const response = await fetch(`/api/alpha-exchange/notifications/${notificationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
      if (!response.ok) {
        // Revert on failure with a fresh server fetch.
        await loadNotifications(20);
      }
    } catch {
      await loadNotifications(20);
    }
  }

  async function handleMarkAllRead() {
    // Optimistic update — mark everything read locally before the server confirms.
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true, state: "read" as const })));
    setUnreadCount(0);
    try {
      const response = await fetch("/api/alpha-exchange/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      if (!response.ok) {
        await loadNotifications(20);
      }
    } catch {
      await loadNotifications(20);
    }
  }

  async function handleOpenNotification(notification: AlphaExchangeNotification) {
    const destination = await resolveNotificationDestination(notification);
    if (!destination) return;

    const requestId = extractRequestIdFromTradeRoomHref(destination);
    if (requestId) prefetchTradeRoom(router, requestId);
    setIsOpen(false);
    router.push(destination);

    if (!notification.isRead) {
      void handleMarkOneRead(notification.id);
    }
  }

  function isTradeNotification(notification: AlphaExchangeNotification) {
    return notification.category === "trade";
  }

  function resolveNotificationDestination(notification: AlphaExchangeNotification) {
    const commissionDestination = getCommissionPaymentNotificationDestination(notification);
    if (commissionDestination) return commissionDestination;
    // A category is not an authorization boundary. Explicit internal actions
    // for an admin/nonparticipant must not be rewritten to a Trade Room.
    const explicitInternalDestination = getExplicitNonTradeRoomNotificationDestination(notification);
    if (explicitInternalDestination) return explicitInternalDestination;
    if (isTradeNotification(notification)) {
      const fallbackHref = resolveTradeRoomHref(notification);
      return buildTradeDestinationFromNotification(notification) ?? fallbackHref;
    }
    return notification.actionHref ?? notification.relatedHref ?? null;
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

  async function handleSellerApplicationDecision(notification: AlphaExchangeNotification, decision: "approve" | "reject") {
    const applicationId = extractSellerApplicationId(notification);
    if (!applicationId) return;
    const actionKey = `${notification.id}:${decision}`;
    if (actionLoading[actionKey]) return;
    setActionLoading((prev) => ({ ...prev, [actionKey]: true }));
    try {
      const reason = decision === "approve" ? "Approved from notification workflow" : "Rejected from notification workflow";
      const response = await fetch(`/api/alpha-exchange/admin/seller-applications/${encodeURIComponent(applicationId)}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (response.ok) {
        // The server archives every matching admin action notification after a
        // decision. Reload instead of marking this item read, which would
        // otherwise turn an archived action back into a visible read item.
        await loadNotifications(20);
      }
    } finally {
      setActionLoading((prev) => ({ ...prev, [actionKey]: false }));
    }
  }

  function resolveNotificationActionLabel(notification: AlphaExchangeNotification) {
    if (getCommissionPaymentNotificationDestination(notification)) return "Pay Commission";
    if (isTradeNotification(notification)) return "Continue Trade";
    if (notification.actionLabel?.trim()) return notification.actionLabel.trim();
    if (notification.category === "application") return "Review Application";
    if (notification.category === "listing") return "Manage Listing";
    return "View Details";
  }

  function resolveTradeRoomHref(notification: AlphaExchangeNotification) {
    if (notification.relatedRequestId?.trim()) return `/trade-room/${notification.relatedRequestId.trim()}`;
    return extractTradeRoomHrefFromRelatedHref(notification.relatedHref ?? notification.actionHref);
  }

  const hasUnread = unreadCount > 0;
  const actionRequiredCount = notifications.filter(
    (notification) => isNotificationActionRequired(notification),
  ).length;
  const hasActionRequired = actionRequiredCount > 0;
  const renderedNotifications = isOpen ? (openNotificationsSnapshot ?? notifications) : notifications;
  const wrapperDirection = useMemo(() => (locale === "ar" ? "rtl" : "ltr"), [locale]);

  return (
    <div className="relative" ref={panelRef} dir={wrapperDirection}>
      <button
        type="button"
        onClick={() => void handleToggleOpen()}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/[0.02] text-[#D1D5DB] transition hover:border-[#C9A227] hover:text-[#C9A227] md:h-9 md:w-9"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {hasUnread ? (
          <span className="absolute -end-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full border border-[#C9A227]/45 bg-[#C9A227] px-1 text-[10px] font-semibold text-black">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
        {hasActionRequired ? <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-amber-400" /> : null}
      </button>

      <div
        data-testid="notification-panel"
        className={`absolute end-0 top-12 z-50 flex max-h-[min(26rem,calc(100vh-5rem))] max-h-[min(26rem,calc(100dvh-5rem))] w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0b0b0b]/95 shadow-2xl backdrop-blur-xl transition-all duration-200 [padding-bottom:env(safe-area-inset-bottom)] md:top-11 md:origin-top-right ${
          isOpen ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-white">
            <BellDot className="h-4 w-4 text-[#C9A227]" />
            Notifications
            {hasUnread ? (
              <span className="badge-chip border-[#C9A227]/35 bg-[#C9A227]/10 font-normal text-[#C9A227]">
                {unreadCount} unread
              </span>
            ) : null}
            {hasActionRequired ? (
              <span className="badge-chip border-amber-400/40 bg-amber-400/10 font-normal text-amber-200">
                {actionRequiredCount} need action
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close notifications"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 text-[#9CA3AF] transition hover:border-white/30 hover:text-white"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 [touch-action:pan-y]">
          {isLoading ? <p className="empty-state-panel p-3 text-xs">Loading...</p> : null}
          {error ? <p className="rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs text-red-200">{error}</p> : null}
          {renderedNotifications.length === 0 ? <p className="empty-state-panel p-3 text-xs">No notifications yet.</p> : null}
          {renderedNotifications.map((notification) => {
                const Icon = notificationIcon(notification);
                const destination = isTradeNotification(notification) ? resolveNotificationDestination(notification) : null;
                const actionRequired = isNotificationActionRequired(notification);
                return (
                  <div
                    key={notification.id}
                    data-notification-id={notification.id}
                    className={`rounded-xl border p-3 text-xs ${
                      actionRequired
                        ? "border-amber-400/55 bg-amber-500/10 text-amber-50"
                        : notification.isRead
                        ? "border-white/10 bg-black/20 text-[#9CA3AF]"
                        : "border-[#C9A227]/35 bg-[#C9A227]/10 text-[#F3F4F6]"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A227]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-white">{formatNotificationTitle(notification)}</p>
                          <span className="shrink-0 text-[11px] text-[#9CA3AF]">{formatNotificationRelativeTime(notification.createdAt, locale)}</span>
                        </div>
                        <p className="mt-1 line-clamp-2">{formatNotificationMessage(notification)}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {!notification.isRead ? <span className="inline-flex items-center rounded-full bg-[#C9A227]/20 px-2 py-0.5 text-[10px] text-[#C9A227]">Unread</span> : null}
                          {actionRequired ? <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">Action required</span> : null}
                          {isTradeNotification(notification) && (notification.relatedTradeId || notification.relatedTradeDisplayNumber || notification.relatedRequestId || notification.relatedRequestDisplayNumber)
                            ? <span className="inline-flex items-center rounded-full border border-white/15 px-2 py-0.5 text-[10px]">Trade {formatTradeId(notification.relatedTradeDisplayNumber ?? notification.relatedRequestDisplayNumber, notification.relatedTradeId ?? notification.relatedRequestId)}</span>
                            : null}
                          {notification.relatedListingId || notification.relatedListingDisplayNumber
                            ? <span className="inline-flex items-center rounded-full border border-white/15 px-2 py-0.5 text-[10px]">Listing {formatListingId(notification.relatedListingDisplayNumber, notification.relatedListingId)}</span>
                            : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {isTradeNotification(notification) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-7 px-2.5 text-[11px] transition-none hover:translate-y-0 active:scale-100"
                              onMouseEnter={() => {
                                if (!destination) return;
                                const requestId = extractRequestIdFromTradeRoomHref(destination);
                                if (requestId) prefetchTradeRoom(router, requestId);
                              }}
                              onFocus={() => {
                                if (!destination) return;
                                const requestId = extractRequestIdFromTradeRoomHref(destination);
                                if (requestId) prefetchTradeRoom(router, requestId);
                              }}
                              onClick={() => void handleOpenNotification(notification)}
                            >
                              {resolveNotificationActionLabel(notification)}
                            </Button>
                          ) : null}
                          {!isTradeNotification(notification) && (notification.actionHref || notification.relatedHref) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-7 px-2.5 text-[11px]"
                              onClick={() => void handleOpenNotification(notification)}
                            >
                              {resolveNotificationActionLabel(notification)}
                            </Button>
                          ) : null}
                          {notification.category === "application" && extractSellerApplicationId(notification) ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2.5 text-[11px]"
                                disabled={Boolean(actionLoading[`${notification.id}:approve`])}
                                onClick={() => void handleSellerApplicationDecision(notification, "approve")}
                              >
                                Approve
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2.5 text-[11px]"
                                disabled={Boolean(actionLoading[`${notification.id}:reject`])}
                                onClick={() => void handleSellerApplicationDecision(notification, "reject")}
                              >
                                Reject
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2.5 text-[11px]"
                                onClick={() => {
                                  if (!notification.isRead) {
                                    void handleMarkOneRead(notification.id);
                                  }
                                  setIsOpen(false);
                                }}
                              >
                                Later
                              </Button>
                            </>
                          ) : (
                            <>
                              {!notification.isRead ? (
                                <Button type="button" size="sm" variant="secondary" className="h-7 px-2.5 text-[11px]" onClick={() => void handleMarkOneRead(notification.id)}>
                                  Mark read
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

        <div className="flex items-center justify-between border-t border-white/10 px-3 py-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void handleMarkAllRead()} className="h-8 px-3 text-xs">
            Mark all as read
          </Button>
          <Link href="/notifications" locale={locale} className="inline-flex h-8 items-center gap-1 rounded-full border border-white/20 px-3 text-xs text-[#D1D5DB] transition hover:border-[#C9A227] hover:text-[#C9A227]">
            <CircleDot className="h-3 w-3" />
            View all notifications
          </Link>
        </div>
      </div>
    </div>
  );
}
