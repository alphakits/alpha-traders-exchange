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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createExchangeDisplayLookup(_input: Record<string, unknown>) {
  return {} as Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function replaceExchangeEntityIds(value: string | undefined, _lookup?: Record<string, string>) {
  return value ?? "";
}
