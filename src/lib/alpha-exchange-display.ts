import { formatDisplayId, formatListingId, formatTradeId } from "@/lib/format-id";

type DisplayEntity = {
  id: string;
  displayNumber?: number;
  tradeId?: string;
};

type DisplayLookupInput = {
  listings?: DisplayEntity[];
  requests?: DisplayEntity[];
  commissions?: DisplayEntity[];
  disputes?: DisplayEntity[];
  applications?: DisplayEntity[];
};

const EXCHANGE_ID_PATTERN = /\b(listing|request|purchase|trade|commission|dispute|application)-[a-z0-9-]+\b/gi;

function toDisplayNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

export function normalizeDisplayNumber(value: unknown) {
  return toDisplayNumber(value);
}

function collect(lookup: Record<string, string>, rows: DisplayEntity[] | undefined, label: string, type: "trade" | "listing" | "commission" | "dispute" | "application") {
  if (!rows?.length) return;
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    const displayNumber = toDisplayNumber(row.displayNumber);
    if (!id) continue;
    lookup[id] = `${label} ${formatDisplayId(type, displayNumber, id)}`;
    if (row.tradeId?.trim()) {
      lookup[row.tradeId.trim()] = `${label} ${formatDisplayId(type, displayNumber, row.tradeId.trim())}`;
    }
  }
}

export function createExchangeDisplayLookup(input: DisplayLookupInput) {
  const lookup: Record<string, string> = {};
  collect(lookup, input.listings, "Listing", "listing");
  collect(lookup, input.requests, "Trade", "trade");
  collect(lookup, input.commissions, "Commission", "commission");
  collect(lookup, input.disputes, "Dispute", "dispute");
  collect(lookup, input.applications, "Application", "application");
  return lookup;
}

export function replaceExchangeEntityIds(value: string | undefined, lookup?: Record<string, string>) {
  if (!value) return "";
  if (!lookup) return value;
  const replaced = value.replace(EXCHANGE_ID_PATTERN, (token) => lookup[token] ?? token);
  return replaced.replace(/\b(Listing|Trade|Commission|Dispute|Application)\s+\1\s+#/g, "$1 #");
}

type ExchangeDisplayHint = {
  relatedTradeId?: string | null;
  relatedTradeDisplayNumber?: number | null;
  relatedRequestId?: string | null;
  relatedRequestDisplayNumber?: number | null;
  relatedListingId?: string | null;
  relatedListingDisplayNumber?: number | null;
};

export function replaceExchangeEntityIdsWithHints(value: string | undefined, hints: ExchangeDisplayHint) {
  let text = String(value ?? "");
  if (!text) return "";

  const tradeDisplayId = formatTradeId(
    hints.relatedTradeDisplayNumber ?? hints.relatedRequestDisplayNumber ?? undefined,
    hints.relatedTradeId ?? hints.relatedRequestId ?? undefined,
  );
  if (hints.relatedTradeId) {
    text = text.split(hints.relatedTradeId).join(tradeDisplayId);
  }
  if (hints.relatedRequestId) {
    text = text.split(hints.relatedRequestId).join(tradeDisplayId);
  }

  const listingDisplayId = formatListingId(hints.relatedListingDisplayNumber ?? undefined, hints.relatedListingId ?? undefined);
  if (hints.relatedListingId) {
    text = text.split(hints.relatedListingId).join(listingDisplayId);
  }

  return text;
}
