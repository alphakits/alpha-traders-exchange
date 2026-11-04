/** Development-only asset definitions. These identifiers cannot address a live chain. */
export const SANDBOX_ASSETS = Object.freeze({
  "tron-sim-usdt": Object.freeze({ id: "tron-sim-usdt", network: "tron-simulation", token: "sim-token-tron-usdt", decimals: 6 }),
  "bsc-sim-binance-peg-usdt": Object.freeze({ id: "bsc-sim-binance-peg-usdt", network: "bsc-simulation", token: "sim-token-bsc-binance-peg-usdt", decimals: 18 }),
});

export type AssetId = keyof typeof SANDBOX_ASSETS;
export const ZERO = BigInt(0);
export const MAX_RAW_UNITS = (BigInt(2) ** BigInt(256)) - BigInt(1);

export function assetFor(id: AssetId) {
  if (!Object.hasOwn(SANDBOX_ASSETS, id)) throw new Error("Unsupported simulation asset");
  return SANDBOX_ASSETS[id];
}

export function parseRawUnits(value: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,77})$/.test(value)) throw new Error("Invalid integer units");
  const units = BigInt(value);
  if (units > MAX_RAW_UNITS) throw new Error("Amount exceeds uint256");
  return units;
}

/** Decimal strings only: no floats, exponent notation, silent rounding, or negative amounts. */
export function parseUnits(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("Invalid asset precision");
  if (typeof value !== "string" || value.length > 100 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("Invalid decimal amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("Amount exceeds asset precision");
  const result = BigInt(whole!) * (BigInt(10) ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (result > MAX_RAW_UNITS) throw new Error("Amount exceeds uint256");
  return result;
}

export function formatUnits(value: bigint, decimals: number): string {
  if (value < ZERO) return `-${formatUnits(-value, decimals)}`;
  const scale = BigInt(10) ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${value / scale}${fraction ? `.${fraction}` : ""}`;
}

/** Existing marketplace quantities and per-party fee rounding stay at six decimals. */
export function quoteTrade(assetId: AssetId, principal: string, price: string) {
  const asset = assetFor(assetId);
  const micros = parseUnits(principal, 6);
  const priceMinor = parseUnits(price, 2);
  if (micros <= ZERO || priceMinor <= ZERO) throw new Error("Trade amount and price must be positive");
  const onePercentMicros = (micros + BigInt(50)) / BigInt(100);
  if (onePercentMicros === ZERO) throw new Error("Trade amount cannot produce a payable fee");
  const scale = BigInt(10) ** BigInt(asset.decimals - 6);
  const principalRaw = micros * scale;
  const partyFeeRaw = onePercentMicros * scale;
  const totalFeeRaw = partyFeeRaw * BigInt(2);
  if (principalRaw > MAX_RAW_UNITS || totalFeeRaw > MAX_RAW_UNITS) throw new Error("Amount exceeds uint256");
  // Current published policy: 1% buyer fee included in fiat, rounded once to cents.
  const fiatTotalMinor = (micros * priceMinor * BigInt(101) + BigInt(50_000_000)) / BigInt(100_000_000);
  if (fiatTotalMinor <= ZERO || fiatTotalMinor > MAX_RAW_UNITS) throw new Error("Fiat total is outside supported bounds");
  return { principalRaw, buyerFeeRaw: partyFeeRaw, sellerFeeRaw: partyFeeRaw, totalFeeRaw, fiatTotalMinor };
}
