export function normalizeDisplayNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

export function createExchangeDisplayLookup(_input: Record<string, unknown>) {
  return {} as Record<string, string>;
}

export function replaceExchangeEntityIds(value: string | undefined, _lookup?: Record<string, string>) {
  return value ?? "";
}
