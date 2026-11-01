export type Localized = { en: string; ar: string };
export const text = (en: string, ar: string): Localized => ({ en, ar });
export type GuideSource = { title: string; url: string };
export type AccountTier = {
  size: number;
  targets: number[];
  maxLoss: number;
  dailyLoss?: number;
  contracts?: number;
  price?: number;
  noActivationPrice?: number;
  minPayout: number;
  buffer: number;
  dailyProfit?: number;
  caps?: number[];
};
export type PayoutRule = {
  mode: "topstep" | "above-buffer" | "dashboard";
  share: number;
  days: number;
  calendarDays?: number;
  consistency?: number;
  strictConsistency?: boolean;
  maxPayouts?: number;
  positiveCycleRequired?: boolean;
};
export type FirmProgram = {
  id: string;
  name: string;
  tagline: Localized;
  tiers: AccountTier[];
  evaluationDays: Localized;
  evaluationConsistency: Localized;
  drawdown: Localized;
  pricing: Localized;
  priceCurrency?: "USD" | "EUR";
  activation: Localized;
  funded: Localized[];
  payoutDetails: Localized[];
  cautions: Localized[];
  payout: PayoutRule;
  sources: GuideSource[];
  legacy?: boolean;
};
export type PropFirm = {
  slug: string;
  name: string;
  short: string;
  accent: string;
  market: Localized;
  description: Localized;
  website: string;
  programs: FirmProgram[];
  receiving: Localized[];
  important: Localized[];
  sources: GuideSource[];
};
export const REVIEWED_ON = "2026-09-28";

export function usd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
}
