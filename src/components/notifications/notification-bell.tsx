"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellDot, CircleDot, ExternalLink, Megaphone, Scale, ShieldCheck, Star, Tags, UserRound, XCircle } from "lucide-react";
import type { AppLocale } from "@/i18n/routing";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";
import { Button, buttonVariants } from "@/components/ui/button";

type NotificationsPayload = {
  notifications: AlphaExchangeNotification[];
  total: number;
  unreadCount: number;
};

const BELL_REFRESH_WINDOW_MS = 30_000;

function formatRelativeTime(isoDate: string, locale: AppLocale) {
  const date = new Date(isoDate);
  const diffMs = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute))}m`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }
  return date.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-IL", { month: "short", day: "numeric" });
}

function notificationIcon(notification: AlphaExchangeNotification) {
  if (notification.category === "trade") return Scale;
  if (notification.category === "listing") return Tags;
  if (notification.category === "application") return UserRound;
  if (notification.category === "report" || notification.category === "dispute") return ShieldCheck;
  if (notification.category === "trust") return Star;
  if (notification.title.toLowerCase().includes("announcement")) return Megaphone;
  return BellDot;
}

export function NotificationBell({ locale }: { locale: AppLocale }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [notifications, setNotifications] = useState<AlphaExchangeNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!panelRef.current) return;
      if (!(event.target instanceof Node)) return;
      if (!panelRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  async function loadNotifications(limit: number) {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/alpha-exchange/notifications?limit=${limit}&includeActivity=0`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load notifications.");
      const payload = (await response.json()) as NotificationsPayload;
      setNotifications(payload.notifications ?? []);
      setUnreadCount(payload.unreadCount ?? 0);
      setLastLoadedAt(Date.now());
    } catch {
      setError("Failed to load notifications.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadNotifications(1);
  }, []);

  async function handleToggleOpen() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      router.prefetch("/notifications");
      const isFresh = Date.now() - lastLoadedAt < BELL_REFRESH_WINDOW_MS;
      if (!isFresh || notifications.length === 0) {
        await loadNotifications(20);
      }
    }
  }

  async function handleMarkOneRead(notificationId: string) {
    const target = notifications.find((item) => item.id === notificationId);
    if (!target || target.isRead) return;
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
      setNotifications((prev) => prev.map((item) => (item.id === notificationId ? { ...item, isRead: true } : item)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      setError("Failed to update notification.");
    }
  }

  async function handleMarkAllRead() {
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
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch {
      setError("Failed to update notifications.");
    }
  }

  async function handleOpenNotification(notification: AlphaExchangeNotification) {
    if (!notification.isRead) {
      await handleMarkOneRead(notification.id);
    }
    if (notification.relatedHref) {
      router.push(notification.relatedHref);
      setIsOpen(false);
    }
  }

  const hasUnread = unreadCount > 0;
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
      </button>

      <div
        className={`absolute end-0 top-11 z-50 w-[min(22rem,calc(100vw-1rem))] origin-top-right rounded-2xl border border-white/15 bg-[#0b0b0b]/95 shadow-2xl backdrop-blur-xl transition-all duration-200 ${
          isOpen ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0"
        }`}
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
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 text-[#9CA3AF] transition hover:border-white/30 hover:text-white"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[26rem] space-y-2 overflow-y-auto p-3">
          {isLoading ? <p className="empty-state-panel p-3 text-xs">Loading...</p> : null}
          {!isLoading && error ? <p className="rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs text-red-200">{error}</p> : null}
          {!isLoading && !error && notifications.length === 0 ? <p className="empty-state-panel p-3 text-xs">No notifications yet.</p> : null}
          {!isLoading && !error
            ? notifications.map((notification) => {
                const Icon = notificationIcon(notification);
                return (
                  <div
                    key={notification.id}
                    className={`rounded-xl border p-3 text-xs ${
                      notification.isRead
                        ? "border-white/10 bg-black/20 text-[#9CA3AF]"
                        : "border-[#C9A227]/35 bg-[#C9A227]/10 text-[#F3F4F6]"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A227]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-white">{notification.title}</p>
                          <span className="shrink-0 text-[11px] text-[#9CA3AF]">{formatRelativeTime(notification.createdAt, locale)}</span>
                        </div>
                        <p className="mt-1 line-clamp-2">{notification.message}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {!notification.isRead ? <span className="inline-flex items-center rounded-full bg-[#C9A227]/20 px-2 py-0.5 text-[10px] text-[#C9A227]">Unread</span> : null}
                          {notification.relatedTradeId ? <span className="inline-flex items-center rounded-full border border-white/15 px-2 py-0.5 text-[10px]">Trade #{notification.relatedTradeId.slice(-6)}</span> : null}
                          {notification.relatedListingId ? <span className="inline-flex items-center rounded-full border border-white/15 px-2 py-0.5 text-[10px]">Listing #{notification.relatedListingId.slice(-6)}</span> : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Button type="button" size="sm" variant="secondary" className="h-7 px-2.5 text-[11px]" onClick={() => void handleOpenNotification(notification)}>
                            Open
                          </Button>
                          {!notification.isRead ? (
                            <Button type="button" size="sm" variant="secondary" className="h-7 px-2.5 text-[11px]" onClick={() => void handleMarkOneRead(notification.id)}>
                              Mark read
                            </Button>
                          ) : null}
                          {notification.relatedHref ? (
                            <button
                              type="button"
                              onClick={() => {
                                router.push(notification.relatedHref!);
                                setIsOpen(false);
                              }}
                              className={buttonVariants({ variant: "secondary", size: "sm" })}
                            >
                              <ExternalLink className="h-3 w-3" />
                              Related
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            : null}
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
