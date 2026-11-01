import { describe, expect, it } from "vitest";
import { calculatePayout, type PayoutInputs } from "./calculator";
import { topstep } from "./topstep";
import { apex } from "./apex";
import { mffu } from "./mffu";

const input: PayoutInputs = { profit: 10000, cycleProfit: 6000, bestDay: 1000, days: 5, elapsedDays: 14, payoutNumber: 1, requested: 1000, fee: 30, dashboardAvailable: 3000, dllPromotion: false };
const standard = topstep.programs[0];
const consistency = topstep.programs[1];
const eod = apex.programs[0];

describe("funded-account payout boundaries", () => {
  it("keeps the 50% Topstep balance limit even with a promotional DLL cap", () => {
    const small = calculatePayout(standard, standard.tiers[0], { ...input, profit: 3000, dllPromotion: true });
    const ordinary = calculatePayout(standard, standard.tiers[0], input);
    const doubled = calculatePayout(standard, standard.tiers[0], { ...input, dllPromotion: true });
    expect(small.max).toBe(1500); expect(ordinary.max).toBe(2000); expect(doubled.max).toBe(4000);
    expect(ordinary.net).toBe(870); expect(ordinary.remaining).toBe(9000);
  });
  it("requires positive cycle profit after the first Standard payout", () => {
    expect(calculatePayout(standard, standard.tiers[0], { ...input, cycleProfit: 0 }).withinNumbers).toBe(true);
    expect(calculatePayout(standard, standard.tiers[0], { ...input, cycleProfit: 0, payoutNumber: 2 }).withinNumbers).toBe(false);
  });
  it("allows exactly 40% for Topstep Consistency and rejects a cent above", () => {
    const exact = { ...input, cycleProfit: 5000, bestDay: 2000, days: 3 };
    expect(calculatePayout(consistency, consistency.tiers[0], exact).withinNumbers).toBe(true);
    expect(calculatePayout(consistency, consistency.tiers[0], { ...exact, bestDay: 2000.01 }).withinNumbers).toBe(false);
  });
  it("preserves Apex's safety net and rejects exactly 50% consistency", () => {
    const tier = eod.tiers[1];
    const exact = { ...input, profit: 3000, cycleProfit: 3000, bestDay: 1500, requested: 900, fee: 0 };
    expect(calculatePayout(eod, tier, exact).max).toBe(900);
    expect(calculatePayout(eod, tier, exact).withinNumbers).toBe(false);
    const under = calculatePayout(eod, tier, { ...exact, bestDay: 1499.99 });
    expect(under.withinNumbers).toBe(true); expect(under.remaining).toBe(2100);
    expect(calculatePayout(eod, tier, { ...exact, bestDay: 1499.99, requested: 900.01 }).withinNumbers).toBe(false);
  });
  it("uses the size and payout-number-specific cap and stops at six Apex payouts", () => {
    expect(calculatePayout(eod, eod.tiers[1], { ...input, payoutNumber: 1 }).max).toBe(1500);
    expect(calculatePayout(eod, eod.tiers[1], { ...input, payoutNumber: 6 }).max).toBe(3000);
    expect(calculatePayout(eod, eod.tiers[1], { ...input, payoutNumber: 7 }).withinNumbers).toBe(false);
    expect(calculatePayout(apex.programs[1], apex.programs[1].tiers[1], { ...input, payoutNumber: 2 }).max).toBe(2000);
  });
  it("does not subtract a buffer again from a dashboard-confirmed gross amount", () => {
    const rapid = mffu.programs[0];
    const result = calculatePayout(rapid, rapid.tiers[1], { ...input, profit: 700, dashboardAvailable: 700, requested: 700, fee: 0 });
    expect(result.max).toBe(700); expect(result.net).toBe(630);
    expect(result.checks.map(c => c.id)).toEqual(["amount"]);
  });
  it("rounds a fractional half-cent down so a request cannot exceed half the balance", () => {
    const result = calculatePayout(standard, standard.tiers[0], { ...input, profit: 2000.01, requested: 1000.01 });
    expect(result.max).toBe(1000); expect(result.withinNumbers).toBe(false);
  });
  it.each([NaN, Infinity, -1, 1e10])("rejects invalid financial input %s", profit => {
    expect(calculatePayout(standard, standard.tiers[0], { ...input, profit }).valid).toBe(false);
  });
  it("rejects fractional days, impossible zero best day and fees greater than proceeds", () => {
    expect(calculatePayout(standard, standard.tiers[0], { ...input, days: 4.5 }).valid).toBe(false);
    expect(calculatePayout(consistency, consistency.tiers[0], { ...input, bestDay: 0 }).valid).toBe(false);
    expect(calculatePayout(standard, standard.tiers[0], { ...input, fee: 901 }).valid).toBe(false);
  });
});
