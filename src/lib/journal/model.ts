export type JournalLocale = "en" | "ar";
export type JournalTrade = {
  id: string; version: number; date: string; time: string;
  symbol: string; direction: "long" | "short"; status: "closed" | "open";
  grossPnlCents: number; feesCents: number; riskCents: number | null;
  quantity: number | null; entry: number | null; exit: number | null;
  stop: number | null; target: number | null;
  strategy: string; session: string; emotion: string;
  followedPlan: boolean | null; mistakes: string[]; notes: string;
  createdAt?: string; updatedAt?: string;
};
export type JournalReview = {
  date: string; period: "day" | "week"; version: number; preparation: string; wentWell: string;
  improve: string; nextSession: string; rating: number | null;
};
export type JournalSettings = {
  version: number; timezone: string; dailyLossLimitCents: number;
  maxTradesPerDay: number; rules: string;
};
export type JournalAttachment = { id: string; tradeId: string; name: string; url: string };
export type JournalSnapshot = {
  trades: JournalTrade[]; reviews: JournalReview[]; settings: JournalSettings;
};
export type JournalPeriod = "today" | "week" | "month" | "all";
export const DEFAULT_SETTINGS: JournalSettings = {
  version: 0, timezone: "Asia/Jerusalem", dailyLossLimitCents: 30000,
  maxTradesPerDay: 4, rules: "",
};
export const EMOTIONS = ["calm", "confident", "fearful", "greedy", "frustrated", "fomo", "revenge"] as const;
export const MISTAKES = ["early_exit", "moved_stop", "no_stop", "oversized", "overtraded", "chased_entry"] as const;

/** Integer cents prevent floating point rounding from changing win/loss classification. */
export function parseMoney(value: string): number | null {
  const text = value.trim();
  if (!/^-?\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, decimals = ""] = text.replace(/^-/, "").split(".");
  return (negative ? -1 : 1) * (Number(whole) * 100 + Number(decimals.padEnd(2, "0")));
}
export function money(cents: number, locale: JournalLocale = "en", signed = false) {
  // Keep financial figures LTR in both interfaces; translated currency markers
  // can reorder signs or overflow the compact Arabic mobile cards.
  void locale;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
    maximumFractionDigits: 2, signDisplay: signed && cents !== 0 ? "always" : "auto",
  }).format(cents / 100);
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function dayInZone(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find(p => p.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function weekStart(date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDate(date, -(weekday === 0 ? 6 : weekday - 1));
}
export function inPeriod(date: string, period: JournalPeriod, today: string) {
  if (period === "all") return true;
  if (period === "today") return date === today;
  if (period === "week") return date >= weekStart(today) && date <= shiftDate(weekStart(today), 6);
  return date.startsWith(today.slice(0, 7));
}
export function netPnl(trade: JournalTrade) { return trade.grossPnlCents - trade.feesCents; }
export function chronological(trades: JournalTrade[]) {
  return [...trades].sort((a, b) => `${a.date} ${a.time} ${a.createdAt ?? a.id}`.localeCompare(`${b.date} ${b.time} ${b.createdAt ?? b.id}`));
}
export function metrics(trades: JournalTrade[]) {
  const closed = chronological(trades.filter(t => t.status === "closed"));
  let net = 0, fees = 0, gains = 0, losses = 0, wins = 0, lossCount = 0, breakeven = 0;
  let peak = 0, maxDrawdown = 0, streak = 0, maxLosingStreak = 0;
  let rSum = 0, rCount = 0, assessed = 0, followed = 0;
  for (const trade of closed) {
    const pnl = netPnl(trade);
    net += pnl; fees += trade.feesCents;
    if (pnl > 0) { wins++; gains += pnl; streak = 0; }
    else if (pnl < 0) { lossCount++; losses += -pnl; streak++; }
    else { breakeven++; streak = 0; }
    maxLosingStreak = Math.max(maxLosingStreak, streak);
    peak = Math.max(peak, net); maxDrawdown = Math.max(maxDrawdown, peak - net);
    if (trade.riskCents && trade.riskCents > 0) { rSum += pnl / trade.riskCents; rCount++; }
    if (trade.followedPlan !== null) { assessed++; if (trade.followedPlan) followed++; }
  }
  return { count: closed.length, open: trades.length - closed.length, net, fees, gains, losses,
    wins, lossCount, breakeven, winRate: closed.length ? wins / closed.length * 100 : null,
    profitFactor: losses ? gains / losses : null,
    expectancy: closed.length ? Math.round(net / closed.length) : null,
    maxDrawdown, maxLosingStreak, averageR: rCount ? rSum / rCount : null, rCount,
    discipline: assessed ? followed / assessed * 100 : null, assessed };
}
export function dailyResults(trades: JournalTrade[]) {
  const days = new Map<string, { date: string; net: number; count: number; wins: number }>();
  for (const trade of chronological(trades.filter(t => t.status === "closed"))) {
    const day = days.get(trade.date) ?? { date: trade.date, net: 0, count: 0, wins: 0 };
    day.net += netPnl(trade); day.count++; if (netPnl(trade) > 0) day.wins++;
    days.set(trade.date, day);
  }
  return [...days.values()];
}
export function groupResults(trades: JournalTrade[], key: "strategy" | "emotion" | "session" | "symbol") {
  const groups = new Map<string, JournalTrade[]>();
  for (const trade of trades.filter(t => t.status === "closed")) {
    const name = trade[key] || "unrecorded";
    groups.set(name, [...(groups.get(name) ?? []), trade]);
  }
  return [...groups].map(([name, rows]) => ({ name, ...metrics(rows) })).sort((a, b) => b.net - a.net);
}
export function emptyTrade(date: string): JournalTrade {
  return { id: crypto.randomUUID(), version: 0, date, time: "09:30", symbol: "", direction: "long", status: "closed",
    grossPnlCents: 0, feesCents: 0, riskCents: null, quantity: null, entry: null, exit: null,
    stop: null, target: null, strategy: "", session: "", emotion: "", followedPlan: null, mistakes: [], notes: "" };
}
export function emptyReview(date: string, period: "day" | "week" = "day"): JournalReview {
  return { date, period, version: 0, preparation: "", wentWell: "", improve: "", nextSession: "", rating: null };
}
