export const DEFAULT_USD_ILS_DISPLAY_RATE = 3.05;

type FinancialValue = string | number | null | undefined;

type NumberFormatOptions = {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

export function financialNumber(value: FinancialValue) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatFinancialNumber(
  value: FinancialValue,
  options: NumberFormatOptions = {},
) {
  const minimumFractionDigits = options.minimumFractionDigits ?? 0;
  const maximumFractionDigits = Math.max(
    minimumFractionDigits,
    options.maximumFractionDigits ?? 2,
  );
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping: true,
  }).format(financialNumber(value));
}

export function formatCount(value: FinancialValue) {
  return formatFinancialNumber(value, { maximumFractionDigits: 0 });
}

export function formatUsdt(value: FinancialValue, maximumFractionDigits = 6) {
  return `${formatFinancialNumber(value, { maximumFractionDigits })} USDT`;
}

function validUsdIlsRate(rate: FinancialValue) {
  const numericRate = financialNumber(rate);
  return numericRate >= 2 && numericRate <= 10
    ? numericRate
    : DEFAULT_USD_ILS_DISPLAY_RATE;
}

export function currencyAmountToUsd(
  value: FinancialValue,
  currency: string | null | undefined,
  usdIlsRate: FinancialValue,
) {
  const amount = financialNumber(value);
  const normalizedCurrency = String(currency ?? "USD").trim().toUpperCase();
  if (normalizedCurrency === "ILS") return amount / validUsdIlsRate(usdIlsRate);
  return amount;
}

export function usdAmountToCurrency(
  value: FinancialValue,
  currency: string | null | undefined,
  usdIlsRate: FinancialValue,
) {
  const amount = financialNumber(value);
  const normalizedCurrency = String(currency ?? "USD").trim().toUpperCase();
  if (normalizedCurrency === "ILS") return amount * validUsdIlsRate(usdIlsRate);
  return amount;
}

export function formatUsd(value: FinancialValue, maximumFractionDigits = 2) {
  return `$${formatFinancialNumber(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits,
  })} USD`;
}

export function formatCurrencyAmountAsUsd(
  value: FinancialValue,
  currency: string | null | undefined,
  usdIlsRate: FinancialValue,
  maximumFractionDigits = 2,
) {
  return formatUsd(currencyAmountToUsd(value, currency, usdIlsRate), maximumFractionDigits);
}

export function formatFinancialText(
  value: string | null | undefined,
  usdIlsRate: FinancialValue,
) {
  const source = String(value ?? "");
  const usdFromIls = (rawAmount: string) => formatUsd(
    currencyAmountToUsd(rawAmount, "ILS", usdIlsRate),
    4,
  );

  return source
    .replace(/\$\s*(\d[\d,]*(?:\.\d+)?)(?:\s*USD)?/gi, (_match, amount: string) => formatUsd(amount))
    .replace(/₪\s*(\d[\d,]*(?:\.\d+)?)/g, (_match, amount: string) => usdFromIls(amount))
    .replace(/\bILS\s*(\d[\d,]*(?:\.\d+)?)/gi, (_match, amount: string) => usdFromIls(amount))
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*ILS\s*\/\s*USDT\b/gi, (_match, amount: string) => `${usdFromIls(amount)}/USDT`)
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*ILS\b/gi, (_match, amount: string) => usdFromIls(amount))
    .replace(/\bUSDT\s*\/\s*ILS\b/gi, "USDT / USD")
    .replace(/(\d[\d,]*(?:\.\d+)?)\s+USDT\b/gi, (_match, amount: string) => formatUsdt(amount));
}

export function priceForUsdInput(
  value: FinancialValue,
  currency: string | null | undefined,
  usdIlsRate: FinancialValue,
) {
  return formatFinancialNumber(currencyAmountToUsd(value, currency, usdIlsRate), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}
