export type MarketPairKey = "usdIls" | "btcUsdt" | "usdtIls";

export type MarketPair = {
  key: MarketPairKey;
  label: string;
  price: number;
  changePercent: number | null;
  source: string;
  reference?: string;
};

export type MarketSnapshot = {
  status: "live" | "degraded";
  updatedAt: string;
  stale: boolean;
  unavailablePairs: MarketPairKey[];
  pairs: {
    usdIls: MarketPair;
    btcUsdt: MarketPair;
    usdtIls: MarketPair;
  };
};
