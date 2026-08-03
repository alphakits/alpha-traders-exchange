type DisplayEntityType = "trade" | "listing" | "request" | "commission" | "dispute" | "application" | "order" | "transaction";

const DISPLAY_PREFIX: Record<DisplayEntityType, string> = {
  trade: "TR",
  listing: "LS",
  request: "RQ",
  commission: "CM",
  dispute: "DS",
  application: "AP",
  order: "OR",
  transaction: "TX",
};

function normalizePositiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function stableNumberFromId(id: string | null | undefined) {
  const text = String(id ?? "").trim();
  if (!text) return 1;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 1_000_000;
  }
  return hash + 1;
}

export function formatDisplayId(type: DisplayEntityType, displayNumber?: unknown, fallbackId?: string | null) {
  const resolved = normalizePositiveInteger(displayNumber) ?? stableNumberFromId(fallbackId);
  return `#${DISPLAY_PREFIX[type]}-${String(resolved).padStart(6, "0")}`;
}

export function formatTradeId(displayNumber?: unknown, fallbackId?: string | null) {
  return formatDisplayId("trade", displayNumber, fallbackId);
}

export function formatListingId(displayNumber?: unknown, fallbackId?: string | null) {
  return formatDisplayId("listing", displayNumber, fallbackId);
}

export function formatRequestId(displayNumber?: unknown, fallbackId?: string | null) {
  return formatDisplayId("request", displayNumber, fallbackId);
}

export function formatCommissionId(displayNumber?: unknown, fallbackId?: string | null) {
  return formatDisplayId("commission", displayNumber, fallbackId);
}
