import { z } from "zod";
import type { MarketplaceListing } from "@/types/alpha-exchange";
import { MARKETPLACE_PAYMENT_METHODS, resolveListingPaymentMethods } from "@/lib/marketplace-payment-methods";

export const priceAlertSchema = z.object({
  enabled: z.boolean(),
  maxPrice: z.string().trim().max(18).regex(/^(?:\d+(?:\.\d{1,4})?)?$/),
  minUsdt: z.string().trim().max(18).regex(/^(?:\d+(?:\.\d{1,6})?)?$/),
  paymentMethod: z.enum(["all", ...MARKETPLACE_PAYMENT_METHODS]),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && (!(Number(value.maxPrice) > 0) || Number(value.maxPrice) > 100_000)) ctx.addIssue({ code: "custom", path: ["maxPrice"], message: "Choose a positive maximum price." });
  if (Number(value.minUsdt) > 1_000_000_000) ctx.addIssue({ code: "custom", path: ["minUsdt"], message: "Choose a valid amount." });
});

export type MarketplacePriceAlert = z.infer<typeof priceAlertSchema>;
export const DEFAULT_PRICE_ALERT: MarketplacePriceAlert = { enabled: false, maxPrice: "", minUsdt: "", paymentMethod: "all" };

export function readMarketplacePriceAlert(value: unknown): MarketplacePriceAlert {
  const parsed = priceAlertSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_PRICE_ALERT };
}

/** Public listing fields only; private seller/account data never enters alerts. */
export function priceAlertMatchesListing(preference: MarketplacePriceAlert, listing: Pick<MarketplaceListing, "status" | "approvalStatus" | "price" | "currency" | "availableAmount" | "minimumTrade" | "maximumTrade" | "paymentMethod" | "paymentMethods" | "expiresAt">, nowMs = Date.now()) {
  if (!preference.enabled || !["active", "matched", "in_trade"].includes(listing.status) || listing.approvalStatus !== "approved") return false;
  if (!["ILS", "₪", "NIS"].includes(listing.currency.toUpperCase())) return false;
  const price = Number(listing.price);
  const available = Number(listing.availableAmount);
  const listingMinimum = Number(listing.minimumTrade ?? 0);
  const maximum = Number(listing.maximumTrade ?? available);
  const minimum = Math.max(Number(preference.minUsdt) || 0, listingMinimum);
  if (!Number.isFinite(listingMinimum) || listingMinimum < 0 || !Number.isFinite(maximum) || maximum <= 0) return false;
  if (!(price > 0) || !Number.isFinite(price) || price > Number(preference.maxPrice) || !(available > 0) || !Number.isFinite(available) || minimum > available || minimum > maximum) return false;
  if (listing.expiresAt && !(new Date(listing.expiresAt).getTime() > nowMs)) return false;
  const methods = resolveListingPaymentMethods(listing.paymentMethods, listing.paymentMethod);
  return preference.paymentMethod === "all" || methods.includes(preference.paymentMethod);
}
