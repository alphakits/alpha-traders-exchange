import { canonicalizeNonNegativeTradeAmount, canonicalizeTradeAmount } from "./trade-amount";

export type CardlessVerificationKind = "id_number" | "date_of_birth";

export type CardlessWithdrawalDetails = {
  withdrawalCode: string;
  verificationKind: CardlessVerificationKind;
  verificationValue: string;
  ilsAmount?: string;
};

export function parseCardlessCashAmount(value: unknown) {
  const normalized = typeof value === "string" ? normalizeCardlessDigits(value).trim() : "";
  if (!/^\d{3,5}(?:\.00)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return amount >= 100 && amount <= 10000 && amount % 100 === 0 ? amount.toFixed(2) : null;
}

/** Divide the bank's cash amount by the agreed price using integer arithmetic. */
export function calculateCardlessUsdtAmount(cash: unknown, price: string) {
  const amount = parseCardlessCashAmount(cash);
  if (!amount || !/^\d+(?:\.\d{1,2})?$/.test(price)) return null;
  const [whole, fraction = ""] = price.split(".");
  const priceCents = BigInt(whole!) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (priceCents <= BigInt(0)) return null;
  const cashCents = BigInt(Math.round(Number(amount) * 100));
  const micros = (cashCents * BigInt(1000000) + priceCents / BigInt(2)) / priceCents;
  return `${micros / BigInt(1000000)}.${(micros % BigInt(1000000)).toString().padStart(6, "0")}`.replace(/\.?0+$/, "");
}

/** Only offer bank cash amounts whose rounded USDT fits the actual listing limits. */
export function getCardlessCashAmountOptions(price: string, minimumUsdt: string | number, maximumUsdt: string | number) {
  const minimum = canonicalizeNonNegativeTradeAmount(minimumUsdt);
  const maximum = canonicalizeTradeAmount(maximumUsdt);
  if (minimum === null || maximum === null) return [];
  const micros = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole!) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
  };
  const min = micros(minimum);
  const max = micros(maximum);
  if (min > max) return [];
  const options: { ilsAmount: string; usdtAmount: string }[] = [];
  for (let cash = 100; cash <= 10000; cash += 100) {
    const usdtAmount = calculateCardlessUsdtAmount(String(cash), price);
    if (usdtAmount === null) return [];
    const amount = micros(usdtAmount);
    if (amount > BigInt(0) && amount >= min && amount <= max) options.push({ ilsAmount: String(cash), usdtAmount });
  }
  return options;
}

/** Cash must match the locked trade total exactly, to the agora. */
export function validateCardlessIlsAmount(value: unknown, expectedTotal: string) {
  const normalized = typeof value === "string" ? normalizeCardlessDigits(value).trim().replace("٫", ".") : "";
  if (!parseCardlessCashAmount(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents > 0 && Number.isSafeInteger(cents) && cents === Math.round(Number(expectedTotal) * 100)
    ? (cents / 100).toFixed(2) : null;
}

export function normalizeCardlessDigits(value: string) {
  return value.normalize("NFKC")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

/** Validate the ATM's details, without treating them as identity verification. */
export function parseCardlessWithdrawalDetails(input: {
  withdrawalCode?: unknown;
  verificationKind?: unknown;
  verificationValue?: unknown;
}): { ok: true; details: CardlessWithdrawalDetails } | {
  ok: false; field: "withdrawalCode" | "verificationKind" | "verificationValue";
} {
  const code = typeof input.withdrawalCode === "string"
    ? normalizeCardlessDigits(input.withdrawalCode).replace(/\s+/g, "") : "";
  if (!/^\d{4,12}$/.test(code)) return { ok: false, field: "withdrawalCode" };
  const kind = input.verificationKind;
  if (kind !== "id_number" && kind !== "date_of_birth") return { ok: false, field: "verificationKind" };
  let value = typeof input.verificationValue === "string"
    ? normalizeCardlessDigits(input.verificationValue).trim() : "";
  if (kind === "id_number") {
    value = value.replace(/\s+/g, "");
    if (!/^\d{5,12}$/.test(value)) return { ok: false, field: "verificationValue" };
  } else {
    const dayFirst = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (dayFirst) value = `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, field: "verificationValue" };
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value
      || value < "1900-01-01" || value > new Date().toISOString().slice(0, 10)) {
      return { ok: false, field: "verificationValue" };
    }
  }
  return { ok: true, details: { withdrawalCode: code, verificationKind: kind, verificationValue: value } };
}

/** Existing encrypted code-only messages remain readable for active trades. */
export function formatCardlessWithdrawalPayload(value: string | null) {
  if (value && /^\d{4,12}$/.test(value)) return `Cardless withdrawal code: ${value}`;
  try {
    const parsed = parseCardlessWithdrawalDetails(JSON.parse(value ?? "null") ?? {});
    if (parsed.ok) {
      const { withdrawalCode, verificationKind, verificationValue } = parsed.details;
      const label = verificationKind === "id_number" ? "ID number" : "Date of birth";
      const displayValue = verificationKind === "date_of_birth"
        ? verificationValue.split("-").reverse().join("/") : verificationValue;
      const raw = JSON.parse(value ?? "null");
      const amount = validateCardlessIlsAmount(raw?.ilsAmount, String(raw?.ilsAmount ?? ""));
      return `${amount ? `ILS amount: ${amount}\n` : ""}Cardless withdrawal code: ${withdrawalCode}\n${label}: ${displayValue}`;
    }
  } catch { /* Malformed or unavailable credentials are never displayed. */ }
  return "Cardless withdrawal details unavailable";
}

export function localizeCardlessWithdrawalMessage(message: string, locale: string) {
  if (locale !== "ar") return message;
  return message
    .replace(/^Cardless withdrawal details protected$/, "بيانات السحب محمية ولا تظهر إلا بعد القبول وقبل استلام النقد")
    .replace(/^Cardless withdrawal (?:code|details) hidden after cash collection$/, "تم إخفاء بيانات السحب بعد استلام النقد")
    .replace(/^Cardless withdrawal (?:code|details) unavailable$/, "بيانات السحب غير متاحة")
    .replace(/^Cardless withdrawal code: /m, "رمز السحب دون بطاقة: ")
    .replace(/^ID number: /m, "رقم الهوية: ")
    .replace(/^ILS amount: /m, "مبلغ السحب بالشيكل: ")
    .replace(/^Date of birth: /m, "تاريخ الميلاد (يوم/شهر/سنة): ");
}
