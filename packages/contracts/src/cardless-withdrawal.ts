export type CardlessVerificationKind = "id_number" | "date_of_birth";

export type CardlessWithdrawalDetails = {
  withdrawalCode: string;
  verificationKind: CardlessVerificationKind;
  verificationValue: string;
};

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
      return `Cardless withdrawal code: ${withdrawalCode}\n${label}: ${displayValue}`;
    }
  } catch { /* Malformed or unavailable credentials are never displayed. */ }
  return "Cardless withdrawal details unavailable";
}

export function localizeCardlessWithdrawalMessage(message: string, locale: string) {
  if (locale !== "ar") return message;
  return message
    .replace(/^Cardless withdrawal (?:code|details) hidden after cash collection$/, "تم إخفاء بيانات السحب بعد استلام النقد")
    .replace(/^Cardless withdrawal (?:code|details) unavailable$/, "بيانات السحب غير متاحة")
    .replace(/^Cardless withdrawal code: /m, "رمز السحب دون بطاقة: ")
    .replace(/^ID number: /m, "رقم الهوية: ")
    .replace(/^Date of birth: /m, "تاريخ الميلاد (يوم/شهر/سنة): ");
}
