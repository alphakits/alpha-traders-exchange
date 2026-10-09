import { z } from "zod";
import { EMOTIONS, MISTAKES, validDate, weekStart } from "./model";

export const journalDate = z.string().refine(validDate);
export const journalId = z.string().uuid();
const cents = z.number().int().min(-99999999999).max(99999999999);
const positive = z.number().finite().positive().max(1e12).nullable();
export const journalTradeInput = z.object({
  id: journalId, version: z.number().int().min(0), date: journalDate,
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  symbol: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9./:_-]+$/).transform(s => s.toUpperCase()),
  direction: z.enum(["long", "short"]), status: z.enum(["closed", "open"]),
  grossPnlCents: cents, feesCents: cents.nonnegative(), riskCents: cents.positive().nullable(),
  quantity: positive, entry: positive, exit: positive, stop: positive, target: positive,
  strategy: z.string().trim().max(80), session: z.enum(["", "asia", "london", "new_york", "other"]),
  emotion: z.union([z.literal(""), z.enum(EMOTIONS)]), followedPlan: z.boolean().nullable(),
  mistakes: z.array(z.enum(MISTAKES)).max(6).refine(a => new Set(a).size === a.length),
  notes: z.string().max(8000),
}).strict().superRefine((trade, ctx) => {
  if (trade.status === "open" && trade.grossPnlCents !== 0) ctx.addIssue({ code: "custom", path: ["grossPnlCents"], message: "Open trades have no realized result." });
});
export const journalReviewInput = z.object({
  date: journalDate, period: z.enum(["day","week"]), version: z.number().int().min(0), preparation: z.string().max(4000),
  wentWell: z.string().max(4000), improve: z.string().max(4000), nextSession: z.string().max(4000),
  rating: z.number().int().min(1).max(5).nullable(),
}).strict().refine(review=>review.period!=="week" || !validDate(review.date) || weekStart(review.date)===review.date,{message:"Weekly reviews start on Monday.",path:["date"]});
export const journalSettingsInput = z.object({
  version: z.number().int().min(0), timezone: z.string().max(80).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
  }), dailyLossLimitCents: cents.positive(), maxTradesPerDay: z.number().int().min(1).max(100),
  rules: z.string().max(4000),
}).strict();
