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

const EXCHANGE_ID_PATTERN = /\b(listing|request|trade|commission|dispute|application)-[a-z0-9-]+\b/gi;

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

function collect(lookup: Record<string, string>, rows: DisplayEntity[] | undefined, label: string) {
  if (!rows?.length) return;
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    const displayNumber = toDisplayNumber(row.displayNumber);
    if (!id || !displayNumber) continue;
    lookup[id] = `${label} #${displayNumber}`;
    if (row.tradeId?.trim()) {
      lookup[row.tradeId.trim()] = `${label} #${displayNumber}`;
    }
  }
}

export function createExchangeDisplayLookup(input: DisplayLookupInput) {
  const lookup: Record<string, string> = {};
  collect(lookup, input.listings, "Listing");
  collect(lookup, input.requests, "Trade");
  collect(lookup, input.commissions, "Commission");
  collect(lookup, input.disputes, "Dispute");
  collect(lookup, input.applications, "Application");
  return lookup;
}

export function replaceExchangeEntityIds(value: string | undefined, lookup?: Record<string, string>) {
  if (!value) return "";
  if (!lookup) return value;
  const replaced = value.replace(EXCHANGE_ID_PATTERN, (token) => lookup[token] ?? token);
  return replaced.replace(/\b(Listing|Trade|Commission|Dispute|Application)\s+\1\s+#/g, "$1 #");
}
