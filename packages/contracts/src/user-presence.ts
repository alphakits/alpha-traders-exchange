/** Shared by web, the native app, and the server. All timestamps are server observations. */
export const PRESENCE_HEARTBEAT_MS = 30_000;
export const PRESENCE_POLL_MS = 15_000;
export const PRESENCE_LEASE_MS = 90_000;
export const PRESENCE_IDLE_MS = 5 * 60_000;

export type UserPresenceData = {
  onlineStatus?: "online" | "offline" | null;
  lastActiveAt?: string | null;
  lastSeenAt?: string | null;
  presenceHidden?: boolean;
};

export type PresenceUpdate = {
  clientId: string;
  sequence: number;
  active: boolean;
  activity: boolean;
};

export function deriveUserPresence(input: UserPresenceData, now = Date.now()) {
  const parse = (value?: string | null) => {
    const ms = value ? Date.parse(value) : NaN;
    // Never turn invalid or future-dated data into a green status.
    return Number.isFinite(ms) && ms > 0 && ms <= now + 5_000 ? ms : null;
  };
  const lastActive = parse(input.lastActiveAt);
  const lastSeen = parse(input.lastSeenAt ?? input.lastActiveAt);
  const elapsed = lastActive === null ? null : Math.max(0, now - lastActive);
  const minutesSinceActive = elapsed === null ? null : Math.floor(elapsed / 60_000);
  const online = !input.presenceHidden && input.onlineStatus === "online"
    && lastSeen !== null && now - lastSeen < PRESENCE_LEASE_MS
    && elapsed !== null && elapsed < PRESENCE_IDLE_MS;
  if (input.presenceHidden) return { online: false, tone: "idle" as const, label: "Activity hidden", labelAr: "النشاط مخفي", compactLabel: "Activity hidden", compactLabelAr: "النشاط مخفي", minutesSinceActive: null };
  if (online) return { online, tone: "online" as const, label: "Online", labelAr: "متصل الآن", compactLabel: "Online", compactLabelAr: "متصل الآن", minutesSinceActive };
  // Only a valid live activity lease is Online. Without one, show Offline;
  // append a last-active time only when the server actually recorded it.
  if (elapsed === null) {
    return {
      online: false, tone: "idle" as const,
      label: "Offline", labelAr: "غير متصل",
      compactLabel: "Offline", compactLabelAr: "غير متصل", minutesSinceActive,
    };
  }
  const recent = elapsed < 60_000;
  const amount = elapsed < 3_600_000 ? Math.max(1, Math.floor(elapsed / 60_000))
    : elapsed < 86_400_000 ? Math.floor(elapsed / 3_600_000) : Math.floor(elapsed / 86_400_000);
  const unit = elapsed < 3_600_000 ? "min" : elapsed < 86_400_000 ? "h" : "d";
  const unitAr = unit === "min" ? "دقيقة" : unit === "h" ? "ساعة" : "يوم";
  return {
    online: false,
    tone: elapsed < 3_600_000 ? "recent" as const : "idle" as const,
    label: recent ? "Offline · Active just now" : `Offline · Active ${amount}${unit === "min" ? " " : ""}${unit} ago`,
    labelAr: recent ? "غير متصل · نشط للتو" : `غير متصل · نشط قبل ${amount} ${unitAr}`,
    compactLabel: "Offline",
    compactLabelAr: "غير متصل",
    minutesSinceActive,
  };
}

/** Measured from actual trade responses, never the seller's default estimate. */
export function formatMeasuredResponseTime(minutes: number | undefined | null, isAr = false) {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return isAr ? "لا توجد بيانات بعد" : "No data yet";
  if (minutes < 1) return isAr ? "أقل من دقيقة" : "<1 min";
  return `${Math.round(minutes)} ${isAr ? "دقيقة" : "min"}`;
}
