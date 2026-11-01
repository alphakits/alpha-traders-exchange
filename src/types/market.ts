export type MarketPairKey = "ethUsdt" | "btcUsdt" | "usdtIls";

export type MarketPair = {
  key: MarketPairKey;
  label: string;
  price: number;
  changePercent: number | null;
  source: string;
  reference?: string;
  quotedAt?: string;
  validUntil?: string;
  quoteStatus?: "live" | "closed" | "stale" | "unavailable";
};

export type MarketSnapshot = {
  status: "live" | "degraded";
  updatedAt: string;
  stale: boolean;
  unavailablePairs: MarketPairKey[];
  pairs: {
    ethUsdt: MarketPair;
    btcUsdt: MarketPair;
    usdtIls: MarketPair;
  };
};
