import { sellerPrestigeRankWeight } from "@/lib/seller-prestige";
import { normalizeSellerLevel } from "@/types/alpha-exchange";

type MarketplaceSellerPriority = {
  level?: string | null;
  completedTrades?: number | null;
  trustScore?: number | null;
};

function metric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Default marketplace order: highest rank, most completed trades, then trust. */
export function compareMarketplaceSellers(
  left: MarketplaceSellerPriority = {},
  right: MarketplaceSellerPriority = {},
) {
  return sellerPrestigeRankWeight(normalizeSellerLevel(right.level) ?? "bronze")
      - sellerPrestigeRankWeight(normalizeSellerLevel(left.level) ?? "bronze")
    || metric(right.completedTrades) - metric(left.completedTrades)
    || metric(right.trustScore) - metric(left.trustScore);
}
