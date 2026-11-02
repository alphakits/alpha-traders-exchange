import { formatMoneyNumber } from "./display-amount";

/** Counts are optional so older snapshots and native clients can still be read. */
export interface SellerMetricEvidence {
  totalReviews?: number;
  responseSampleCount?: number;
  alphaScore?: { value: number; starter: boolean };
}

type SellerMetrics = SellerMetricEvidence & {
  rating?: number | null;
  averageRating?: number;
  trustScore?: number | null;
  responseTimeMinutes?: number | null;
};

export function sellerRatingDisplay(facts: SellerMetrics | null | undefined, isAr = false) {
  const rating = facts?.rating ?? facts?.averageRating;
  const count = facts?.totalReviews;
  const label = isAr ? "تقييم المشترين" : "Buyer rating";
  if (count === 0 || (count == null && rating === 0)) {
    const starter = isAr ? "تقييم مبدئي" : "Starter rating";
    return { value: "4.0", label: starter, text: isAr ? "4.0 · مبدئي" : "4.0 · Starter" };
  }
  if (rating == null || !Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { value: "—", label, text: "—" };
  }
  const value = rating.toFixed(2);
  const reviews = count == null ? label : isAr
    ? count === 1 ? "تقييم واحد" : count === 2 ? "تقييمان" : `${formatMoneyNumber(count)} ${count > 10 ? "تقييم" : "تقييمات"}`
    : `${formatMoneyNumber(count)} ${count === 1 ? "review" : "reviews"}`;
  return { value, label: reviews, text: count == null ? `${value} ★` : `${value} ★ · ${reviews}` };
}

export function sellerScoreDisplay(facts: SellerMetrics | null | undefined, isAr = false) {
  const alpha = facts?.alphaScore;
  const score = alpha?.value ?? facts?.trustScore;
  const label = alpha?.starter ? (isAr ? "نقاط ألفا المبدئية" : "Starting Alpha Score")
    : alpha ? (isAr ? "نقاط ألفا" : "Alpha Score") : (isAr ? "درجة الثقة" : "Trust score");
  const value = score != null && Number.isFinite(score) ? `${Number(score.toFixed(1))}/100` : "—";
  return { label, value, text: `${label} ${value}` };
}

/** Legacy packets used zero for missing history. A counted zero is an instant acceptance. */
export function measuredSellerResponseMinutes(facts?: SellerMetrics | null): number | null {
  const minutes = facts?.responseTimeMinutes;
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0 || facts?.responseSampleCount === 0) return null;
  return minutes > 0 || (facts?.responseSampleCount ?? 0) > 0 ? minutes : null;
}

export function compareSellerResponseTimes(left?: SellerMetrics | null, right?: SellerMetrics | null) {
  const a = measuredSellerResponseMinutes(left);
  const b = measuredSellerResponseMinutes(right);
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export function formatMeasuredResponseTime(minutes: number | undefined | null, isAr = false, sampleCount?: number) {
  const measured = measuredSellerResponseMinutes({ responseTimeMinutes: minutes, responseSampleCount: sampleCount });
  if (measured === null) return isAr ? "جديد" : "New";
  if (measured < 1) return isAr ? "أقل من دقيقة" : "<1 min";
  if (measured > 10) return isAr ? "أكثر من 10 دقائق" : "10+ min";
  const rounded = Math.round(measured);
  if (!isAr) return `${rounded} min`;
  if (rounded === 1) return "دقيقة واحدة";
  if (rounded === 2) return "دقيقتان";
  return `${rounded} دقائق`;
}
