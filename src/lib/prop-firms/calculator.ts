import type { AccountTier, FirmProgram } from "./types";

export type PayoutInputs = {
  profit: number;
  cycleProfit: number;
  bestDay: number;
  days: number;
  elapsedDays: number;
  payoutNumber: number;
  requested: number;
  fee: number;
  dashboardAvailable: number;
  dllPromotion: boolean;
};
export type PayoutCheck = { id: "days" | "time" | "consistency" | "profit" | "cycle" | "count" | "amount"; passed: boolean; required: number };

// Amounts are calculated in cents. This is an educational numerical check,
// never a connection to, or approval from, the firm's account systems.
export function calculatePayout(program: FirmProgram, tier: AccountTier, input: PayoutInputs) {
  const values = Object.values(input).filter((value): value is number => typeof value === "number");
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1e9) ||
      !Number.isInteger(input.days) || !Number.isInteger(input.payoutNumber) || input.payoutNumber < 1 ||
      (program.payout.mode !== "dashboard" && program.payout.consistency !== undefined && input.cycleProfit > 0 && input.bestDay <= 0) ||
      input.fee > input.requested * program.payout.share / 100) {
    return { valid: false as const, checks: [], max: 0, net: 0, remaining: 0, withinNumbers: false };
  }
  const rule = program.payout;
  const cents = (value: number) => Math.round(value * 100);
  const cap = tier.caps?.[Math.min(input.payoutNumber - 1, tier.caps.length - 1)] ?? Infinity;
  let maximum: number;
  if (rule.mode === "topstep") {
    maximum = Math.min(Math.floor(cents(input.profit) / 2), cents(cap * (input.dllPromotion ? 2 : 1)));
  } else if (rule.mode === "above-buffer") {
    maximum = Math.min(Math.max(0, cents(input.profit) - cents(tier.buffer)), cents(cap));
  } else {
    maximum = Math.min(cents(input.dashboardAvailable), cents(input.profit), cents(cap));
  }
  const checks: PayoutCheck[] = [];
  if (rule.mode !== "dashboard") {
    checks.push({ id: "days", passed: input.days >= rule.days, required: rule.days });
    if (rule.calendarDays) checks.push({ id: "time", passed: input.elapsedDays >= rule.calendarDays, required: rule.calendarDays });
    if (rule.consistency) {
      const best = cents(input.bestDay) * 100;
      const allowed = cents(input.cycleProfit) * rule.consistency;
      checks.push({ id: "consistency", passed: input.cycleProfit > 0 && (rule.strictConsistency ? best < allowed : best <= allowed), required: rule.consistency });
    }
    if (rule.positiveCycleRequired && input.payoutNumber > 1) checks.push({ id: "cycle", passed: cents(input.cycleProfit) >= 1, required: 0.01 });
    checks.push({ id: "profit", passed: maximum >= cents(tier.minPayout), required: tier.minPayout });
  }
  if (rule.maxPayouts) checks.push({ id: "count", passed: input.payoutNumber <= rule.maxPayouts, required: rule.maxPayouts });
  checks.push({ id: "amount", passed: cents(input.requested) >= cents(tier.minPayout) && cents(input.requested) <= maximum, required: tier.minPayout });
  const grossShare = Math.floor(cents(input.requested) * rule.share / 100);
  return {
    valid: true as const,
    checks,
    max: maximum / 100,
    net: Math.max(0, grossShare - cents(input.fee)) / 100,
    remaining: Math.max(0, cents(input.profit) - cents(input.requested)) / 100,
    withinNumbers: checks.every(check => check.passed),
  };
}
