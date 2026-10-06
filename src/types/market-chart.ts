export type MarketChartSymbol = "ETHUSDT" | "BTCUSDT";

export type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MarketChartSnapshot = {
  symbol: MarketChartSymbol;
  interval: "1h";
  source: "Binance";
  updatedAt: string;
  stale: boolean;
  candles: MarketCandle[];
};
