/** A deliberately small, versioned payload: never store a client URL, label or contact details. */
export interface TradeChatLocation {
  version: 1;
  latitude: number;
  longitude: number;
  source: "current" | "meeting_point";
  accuracyMeters?: number;
}

export const TRADE_LOCATION_MESSAGE = "Meeting location shared.";
const allowedKeys = new Set(["version", "latitude", "longitude", "source", "accuracyMeters"]);

export function parseTradeChatLocation(value: unknown): TradeChatLocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid meeting location.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !allowedKeys.has(key)) || data.version !== 1
    || typeof data.latitude !== "number" || !Number.isFinite(data.latitude) || Math.abs(data.latitude) > 90
    || typeof data.longitude !== "number" || !Number.isFinite(data.longitude) || Math.abs(data.longitude) > 180
    || (data.source !== "current" && data.source !== "meeting_point")
    || (data.accuracyMeters !== undefined && (typeof data.accuracyMeters !== "number"
      || !Number.isFinite(data.accuracyMeters) || data.accuracyMeters < 0 || data.accuracyMeters > 100_000))) {
    throw new Error("Invalid meeting location.");
  }
  return {
    version: 1,
    latitude: Number(data.latitude.toFixed(6)),
    longitude: Number(data.longitude.toFixed(6)),
    source: data.source,
    ...(data.accuracyMeters !== undefined ? { accuracyMeters: Math.ceil(data.accuracyMeters as number) } : {}),
  };
}

/** Defensive reader for old data and all client presentation boundaries. */
export function readTradeChatLocation(value: unknown): TradeChatLocation | undefined {
  try { return parseTradeChatLocation(value); } catch { return undefined; }
}

export function tradeLocationMapLinks(value: TradeChatLocation) {
  const location = parseTradeChatLocation(value);
  const point = encodeURIComponent(`${location.latitude},${location.longitude}`);
  return {
    waze: `https://www.waze.com/ul?ll=${point}&navigate=yes&utm_source=alphatraders`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving`,
  };
}
