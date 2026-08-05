"use client";

import { useEffect, useMemo, useState } from "react";
import { BellDot, Megaphone, Scale, Search, ShieldCheck, Star, Tags, UserRound } from "lucide-react";
import type { AppLocale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type NotificationsPayload = {
  notifications: AlphaExchangeNotification[];
  total: number;
  unreadCount: number;
};

type NotificationFilter = "all" | "unread" | "trades" | "listings" | "reviews" | "announcements";

const PAGE_SIZE = 20;
const MOBILE_FETCH_LIMIT = 40;
const DESKTOP_FETCH_LIMIT = 120;
const NOTIFICATIONS_CACHE_KEY = "alpha.notifications.page.v1";
const NOTIFICATIONS_CACHE_MAX_AGE_MS = 45_000;

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
  if (filter === "all") return true;
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

export function NotificationsPage({ locale }: { locale: AppLocale }) {
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

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  const fetchLimit = isMobileViewport ? MOBILE_FETCH_LIMIT : DESKTOP_FETCH_LIMIT;

  async function loadNotifications({
    offset = 0,
    append = false,
    force = false,
  }: {
    offset?: number;
    append?: boolean;
    force?: boolean;
  } = {}) {
    if (append) {
      setIsLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      if (!append && !force && offset === 0) {
        const cached = readNotificationsCache();
        if (cached && Date.now() - cached.fetchedAt <= NOTIFICATIONS_CACHE_MAX_AGE_MS) {
          const incoming = cached.payload.notifications ?? [];
          setNotifications(incoming);
          setTotalCount(cached.payload.total ?? incoming.length);
          setUnreadCount(cached.payload.unreadCount ?? 0);
          return;
        }
      }

      const response = await fetch(`/api/alpha-exchange/notifications?limit=${fetchLimit}&offset=${offset}&includeActivity=0`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load notifications.");
      const payload = (await response.json()) as NotificationsPayload;
      const incoming = payload.notifications ?? [];
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
        return merged;
      });
      setTotalCount(payload.total ?? incoming.length);
      setUnreadCount(payload.unreadCount ?? 0);
      if (offset === 0) {
        writeNotificationsCache(payload);
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
  }

  useEffect(() => {
    if (isMobileViewport === null) return;
    void loadNotifications({ offset: 0, append: false });
  }, [fetchLimit, isMobileViewport]);

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
      const nextUnreadCount = Math.max(0, unreadCount - 1);
      setNotifications(nextNotifications);
      setUnreadCount(nextUnreadCount);
      writeNotificationsCache({
        notifications: nextNotifications,
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
      const nextNotifications = notifications.map((item) => ({ ...item, isRead: true }));
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
            {(["all", "unread", "trades", "listings", "reviews", "announcements"] as NotificationFilter[]).map((item) => (
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
                {item === "all" ? "All" : item === "unread" ? "Unread" : item === "trades" ? "Trades" : item === "listings" ? "Listings" : item === "reviews" ? "Reviews" : "Announcements"}
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
                              className="h-10 px-3 text-xs md:h-8"
                              onClick={() => {
                                if (!notification.isRead) {
                                  void handleMarkOneRead(notification.id);
                                }
                                if (notification.relatedHref) {
                                  router.push(notification.relatedHref);
                                }
                              }}
                            >
                              Open notification
                            </Button>
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
                            {notification.relatedHref ? (
                              <Button type="button" size="sm" variant="secondary" className="h-10 px-3 text-xs md:h-8" onClick={() => router.push(notification.relatedHref!)}>
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
