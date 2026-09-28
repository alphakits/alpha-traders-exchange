export const SELLER_APPLICATION_ERROR_CODES = {
  "Invalid request body.": "INVALID_REQUEST_BODY",
  "Account not found.": "ACCOUNT_NOT_FOUND",
  "Owner accounts cannot submit seller applications.": "OWNER_NOT_ELIGIBLE",
  "Administrator accounts cannot submit seller applications.": "ADMIN_NOT_ELIGIBLE",
  "You are already an approved seller.": "ALREADY_APPROVED",
  "Your seller application is already pending review.": "APPLICATION_PENDING",
  "Your account is suspended.": "ACCOUNT_SUSPENDED",
  "Buyer verification required before seller application.": "BUYER_REQUIRED",
  "Full name is required.": "FULL_NAME_REQUIRED",
  "WhatsApp number is required.": "WHATSAPP_REQUIRED",
  "At least one selling method is required.": "SELLING_METHOD_REQUIRED",
  "An unexpected error occurred. Please try again.": "UNEXPECTED",
} as const;

export type SellerApplicationErrorCode = (typeof SELLER_APPLICATION_ERROR_CODES)[keyof typeof SELLER_APPLICATION_ERROR_CODES];

type SellerApplicationErrorPayload = {
  code?: unknown;
  error?: unknown;
  supportCode?: unknown;
  requestId?: unknown;
};

const SELLER_APPLICATION_ERROR_COPY: Record<SellerApplicationErrorCode, { ar: string; en: string }> = {
  INVALID_REQUEST_BODY: { ar: "تعذّر قراءة بيانات الطلب. حدّث الصفحة وحاول مرة أخرى.", en: "The application data could not be read. Refresh and try again." },
  ACCOUNT_NOT_FOUND: { ar: "تعذّر العثور على حسابك. سجّل الدخول مرة أخرى.", en: "Your account could not be found. Please sign in again." },
  OWNER_NOT_ELIGIBLE: { ar: "لا يمكن لحساب المالك تقديم طلب بائع.", en: "Owner accounts cannot submit seller applications." },
  ADMIN_NOT_ELIGIBLE: { ar: "لا يمكن لحساب المسؤول تقديم طلب بائع.", en: "Administrator accounts cannot submit seller applications." },
  ALREADY_APPROVED: { ar: "أنت بائع معتمد بالفعل.", en: "You are already an approved seller." },
  APPLICATION_PENDING: { ar: "طلب البائع الخاص بك قيد المراجعة بالفعل.", en: "Your seller application is already pending review." },
  ACCOUNT_SUSPENDED: { ar: "حسابك معلّق. تواصل مع الدعم للمساعدة.", en: "Your account is suspended. Contact support for help." },
  BUYER_REQUIRED: { ar: "يجب تفعيل حساب المشتري قبل تقديم طلب بائع.", en: "Activate your buyer account before submitting a seller application." },
  FULL_NAME_REQUIRED: { ar: "أدخل اسمك الكامل قبل تقديم الطلب.", en: "Enter your full name before submitting the application." },
  WHATSAPP_REQUIRED: { ar: "أدخل رقم واتساب قبل تقديم طلب البائع.", en: "Enter a WhatsApp number before submitting the seller application." },
  SELLING_METHOD_REQUIRED: { ar: "اختر طريقة بيع واحدة على الأقل.", en: "Select at least one selling method." },
  UNEXPECTED: { ar: "تعذّر تقديم طلب البائع الآن. حاول مرة أخرى.", en: "We could not submit your seller application right now. Please try again." },
};

export function sellerApplicationErrorCodeFromMessage(message: unknown): SellerApplicationErrorCode | undefined {
  if (typeof message !== "string") return undefined;
  return SELLER_APPLICATION_ERROR_CODES[message.trim() as keyof typeof SELLER_APPLICATION_ERROR_CODES];
}

export function sellerApplicationErrorMessage(payload: SellerApplicationErrorPayload, isAr: boolean) {
  const rawCode = typeof payload.code === "string" ? payload.code : undefined;
  const rawMessage = typeof payload.error === "string" ? payload.error.trim() : "";
  const inferredCode = sellerApplicationErrorCodeFromMessage(rawMessage);
  const code = (rawCode && rawCode in SELLER_APPLICATION_ERROR_COPY
    ? rawCode
    : inferredCode ?? "UNEXPECTED") as SellerApplicationErrorCode;
  const message = isAr
    ? SELLER_APPLICATION_ERROR_COPY[code].ar
    : (rawMessage || SELLER_APPLICATION_ERROR_COPY[code].en);
  const details = [payload.supportCode, payload.requestId]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" • ");
  return details ? `${message} (${details})` : message;
}
