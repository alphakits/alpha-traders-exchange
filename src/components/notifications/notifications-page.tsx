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

type NotificationsPayload = {
  notifications: AlphaExchangeNotification[];
  total: number;
  unreadCount: number;
};

type NotificationFilter = "all" | "unread" | "trades" | "listings" | "reviews" | "announcements" | "history";

const PAGE_SIZE = 20;

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

function formatTimestamp(isoDate: string, locale: AppLocale) {
  return new Date(isoDate).toLocaleString(locale === "ar" ? "ar-EG" : "en-IL");
}

function isAnnouncement(notification: AlphaExchangeNotification) {
  const text = `${notification.title} ${notification.message}`.toLowerCase();
  return notification.category === "system" || text.includes("announcement");
}

function isReview(notification: AlphaExchangeNotification) {
  return notification.category === "review" || `${notification.title} ${notification.message}`.toLowerCase().includes("review");
}

function matchesFilter(notification: AlphaExchangeNotification, filter: NotificationFilter) {
  if (filter === "history") return notification.state === "archived";
  if (filter === "all") return true;
  if (filter === "unread") return !notification.isRead;
  if (filter === "trades") return notification.category === "trade";
  if (filter === "listings") return notification.category === "listing";
  if (filter === "reviews") return isReview(notification);
  return isAnnouncement(notification);
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
  const normalized = href.replace(/\/+$/, "");
  const requestId = normalized.slice(normalized.lastIndexOf("/") + 1).trim();
  return requestId || null;
}

export function NotificationsPage({ locale }: { locale: AppLocale }) {
  const [notifications, setNotifications] = useState<AlphaExchangeNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [page, setPage] = useState(1);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [itemLoading, setItemLoading] = useState<Record<string, boolean>>({});
  const router = useRouter();

  const loadNotifications = useCallback(async (nextFilter: NotificationFilter = filter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200", includeActivity: "0" });
      if (nextFilter === "history") params.set("state", "archived");
      const response = await fetch(`/api/alpha-exchange/notifications?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load notifications.");
      const payload = (await response.json()) as NotificationsPayload;
      setNotifications(payload.notifications ?? []);
      setUnreadCount(payload.unreadCount ?? 0);
    } catch {
      setError("Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadNotifications(filter);
  }, [filter, loadNotifications]);

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

  const totalPages = Math.max(1, Math.ceil(filteredNotifications.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredNotifications.slice(pageStart, pageStart + PAGE_SIZE);

  function resolveTradeRoomHref(notification: AlphaExchangeNotification) {
    if (notification.relatedRequestId?.trim()) return `/trade-room/${notification.relatedRequestId.trim()}`;
    const fromHref = extractTradeRoomHrefFromRelatedHref(notification.relatedHref ?? notification.actionHref);
    if (fromHref) return fromHref;
    return null;
  }

  async function resolveActiveTradeHref(input?: { notificationId?: string; includePending?: boolean }) {
    try {
      const query = new URLSearchParams();
      if (input?.notificationId) query.set("notificationId", input.notificationId);
      if (input?.includePending) query.set("includePending", "1");
      const suffix = query.size ? `?${query.toString()}` : "";
      const response = await fetch(`/api/alpha-exchange/trade-room/active${suffix}`, { cache: "no-store" });
      if (!response.ok) return null;
      const payload = (await response.json()) as { activeRequestId?: string | null; destination?: string | null };
      if (payload.destination?.trim()) return payload.destination.trim();
      if (!payload.activeRequestId) return null;
      return `/trade-room/${payload.activeRequestId}`;
    } catch {
      return null;
    }
  }

  async function openTradeRoomFromNotification(notification: AlphaExchangeNotification) {
    const resolvedDestination = resolveTradeRoomHref(notification);
    const destination = resolvedDestination
      ?? await resolveActiveTradeHref({ notificationId: notification.id, includePending: true });
    const localizedDestination = destination
      ? (destination.startsWith(`/${locale}/`) ? destination : `/${locale}${destination.startsWith("/") ? destination : `/${destination}`}`)
      : null;
    console.log("[trade-room-open] notification click", {
      notificationId: notification.id,
      relatedRequestId: notification.relatedRequestId ?? null,
      relatedListingId: notification.relatedListingId ?? null,
      relatedTradeId: notification.relatedTradeId ?? null,
      destination: localizedDestination,
    });
    if (!localizedDestination) {
      setError("Could not resolve this trade room.");
      return;
    }
    const requestId = extractRequestIdFromTradeRoomHref(localizedDestination);
    if (requestId) {
      prefetchTradeRoom(router, requestId);
    }
    if (!notification.isRead) {
      void handleMarkOneRead(notification.id);
    }
    router.push(localizedDestination);
  }

  async function handleMarkOneRead(notificationId: string) {
    const key = `read:${notificationId}`;
    if (itemLoading[key]) return;
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
      await loadNotifications();
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
      await loadNotifications();
    } finally {
      setIsMarkingAllRead(false);
    }
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
            {(["all", "unread", "trades", "listings", "reviews", "announcements", "history"] as NotificationFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  filter === item
                    ? "border-[#C9A227]/50 bg-[#C9A227]/15 text-[#C9A227]"
                    : "border-white/15 bg-black/20 text-[#D1D5DB] hover:border-white/25 hover:text-white"
                }`}
              >
                {item === "all" ? "All" : item === "unread" ? "Unread" : item === "trades" ? "Trades" : item === "listings" ? "Listings" : item === "reviews" ? "Reviews" : item === "announcements" ? "Announcements" : "History"}
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

          <div className="space-y-2">
            {pageItems.map((notification) => {
              const Icon = notificationIcon(notification);
              return (
                <div
                  key={notification.id}
                  className={`rounded-xl border p-3 md:p-4 ${notification.isRead ? "border-white/10 bg-black/20" : "border-[#C9A227]/35 bg-[#C9A227]/10"}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A227]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-medium text-white">{notification.title}</p>
                        <span className="text-[11px] text-[#9CA3AF]">{formatTimestamp(notification.createdAt, locale)}</span>
                      </div>
                      <p className="mt-1 text-sm text-[#D1D5DB]">{notification.message}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[#C9A227]">
                        {!notification.isRead ? <span className="rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2 py-0.5">Unread</span> : <span className="rounded-full border border-white/15 px-2 py-0.5 text-[#9CA3AF]">Read</span>}
                        {notification.relatedTradeId ? <span className="rounded-full border border-white/15 px-2 py-0.5 text-[#D1D5DB]">Trade #{notification.relatedTradeId.slice(-6)}</span> : null}
                        {notification.relatedListingId ? <span className="rounded-full border border-white/15 px-2 py-0.5 text-[#D1D5DB]">Listing #{notification.relatedListingId.slice(-6)}</span> : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-8 px-3 text-xs"
                          onMouseEnter={() => {
                            const href = resolveTradeRoomHref(notification);
                            const requestId = extractRequestIdFromTradeRoomHref(href);
                            if (requestId) prefetchTradeRoom(router, requestId);
                          }}
                          onFocus={() => {
                            const href = resolveTradeRoomHref(notification);
                            const requestId = extractRequestIdFromTradeRoomHref(href);
                            if (requestId) prefetchTradeRoom(router, requestId);
                          }}
                          onClick={() => void openTradeRoomFromNotification(notification)}
                        >
                          Open Trade Room
                        </Button>
                        {!notification.isRead ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 px-3 text-xs"
                            loading={Boolean(itemLoading[`read:${notification.id}`])}
                            loadingLabel="Saving..."
                            onClick={() => void handleMarkOneRead(notification.id)}
                          >
                            Mark as read
                          </Button>
                        ) : null}
                        {(notification.actionHref || notification.relatedHref) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 px-3 text-xs"
                            onClick={() => {
                              const fallbackHref = notification.actionHref ?? notification.relatedHref;
                              if (fallbackHref) router.push(fallbackHref);
                            }}
                          >
                            Open related page
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-3">
            <p className="text-xs text-[#9CA3AF]">
              Showing {pageItems.length ? pageStart + 1 : 0}-{Math.min(pageStart + PAGE_SIZE, filteredNotifications.length)} of {filteredNotifications.length}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="secondary" className="h-8 px-3 text-xs" disabled={currentPage <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                Previous
              </Button>
              <span className="text-xs text-[#D1D5DB]">
                {currentPage}/{totalPages}
              </span>
              <Button type="button" size="sm" variant="secondary" className="h-8 px-3 text-xs" disabled={currentPage >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
