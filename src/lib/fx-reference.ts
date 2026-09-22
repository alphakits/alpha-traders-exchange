export const FX_CURRENCIES = ["ILS", "EUR", "RON", "GBP", "CHF", "AED", "JPY", "CAD", "AUD"] as const;
export type FxCurrency = typeof FX_CURRENCIES[number];
export type FxReference = { rates: Partial<Record<FxCurrency, number>>; date: string; history: Array<{ date: string; rate: number }> };

export function parseFxReference(input: unknown): FxReference {
  if (!Array.isArray(input)) throw new Error("Invalid FX response");
  const rows = input.filter((row): row is { date: string; base: string; quote: FxCurrency; rate: number } =>
    Boolean(row && typeof row === "object" && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      && row.base === "USD" && FX_CURRENCIES.includes(row.quote) && typeof row.rate === "number"
      && Number.isFinite(row.rate) && row.rate > 0)).sort((a, b) => a.date.localeCompare(b.date));
  const date = rows.at(-1)?.date;
  if (!date) throw new Error("FX data unavailable");
  const rates: FxReference["rates"] = {};
  for (const row of rows.filter((item) => item.date === date)) rates[row.quote] = row.rate;
  const history = rows.filter((row) => row.quote === "ILS").map(({ date, rate }) => ({ date, rate }));
  return { rates, date, history };
}
