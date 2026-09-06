import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type {
  MobileApiErrorCode,
  MobileApiErrorResponse,
  MobileLocale,
  MobilePlatform,
} from "@alpha-traders/contracts";
import { resolveSupportedRequestLocale } from "@/lib/request-locale";

export const MOBILE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
} as const;

export type MobileClientMetadata = {
  deviceId: string;
  appVersion: string;
  platform: MobilePlatform;
  locale: MobileLocale;
};

const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const APP_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,49}$/;

const errorMessages: Record<MobileApiErrorCode, Record<MobileLocale, string>> = {
  INVALID_REQUEST: {
    ar: "الطلب غير صالح.",
    en: "The request is invalid.",
  },
  DEVICE_HEADERS_REQUIRED: {
    ar: "بيانات الجهاز وإصدار التطبيق مطلوبة.",
    en: "Device and app version headers are required.",
  },
  INVALID_CREDENTIALS: {
    ar: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    en: "The email or password is incorrect.",
  },
  EMAIL_VERIFICATION_REQUIRED: {
    ar: "يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول.",
    en: "Please verify your email before signing in.",
  },
  ACCOUNT_DISABLED: {
    ar: "هذا الحساب غير متاح حاليًا.",
    en: "This account is currently unavailable.",
  },
  BUYER_ROLE_REQUIRED: {
    ar: "يلزم حساب مشتري لإجراء صفقة.",
    en: "A buyer account is required to start a trade.",
  },
  RATE_LIMITED: {
    ar: "محاولات كثيرة جدًا. حاول مرة أخرى بعد قليل.",
    en: "Too many attempts. Please try again shortly.",
  },
  UNAUTHORIZED: {
    ar: "يرجى تسجيل الدخول للمتابعة.",
    en: "Please sign in to continue.",
  },
  SESSION_EXPIRED: {
    ar: "انتهت صلاحية جلسة التطبيق.",
    en: "The app session has expired.",
  },
  SESSION_REVOKED: {
    ar: "تم تسجيل الخروج من هذه الجلسة.",
    en: "This session has been signed out.",
  },
  REFRESH_TOKEN_REUSED: {
    ar: "تم إيقاف الجلسة لحماية حسابك. سجل الدخول مجددًا.",
    en: "The session was stopped to protect your account. Please sign in again.",
  },
  NOT_FOUND: {
    ar: "تعذر العثور على العنصر المطلوب.",
    en: "The requested item could not be found.",
  },
  LISTING_UNAVAILABLE: {
    ar: "هذا الإعلان غير متاح لصفقة جديدة الآن.",
    en: "This listing is not available for a new trade right now.",
  },
  TRADE_NOT_FOUND: {
    ar: "تعذر العثور على الصفقة.",
    en: "The trade could not be found.",
  },
  TRADE_ACTION_NOT_ALLOWED: {
    ar: "لا يمكن تنفيذ هذا الإجراء في المرحلة الحالية من الصفقة.",
    en: "This action is not allowed at the current trade stage.",
  },
  TRADE_AMOUNT_INVALID: {
    ar: "تحقق من مبلغ USDT وحدود الإعلان.",
    en: "Check the USDT amount and the listing limits.",
  },
  WALLET_ADDRESS_INVALID: {
    ar: "عنوان محفظة الاستلام غير صالح للشبكة المحددة.",
    en: "The receiving wallet address is invalid for the selected network.",
  },
  PAYMENT_METHOD_INVALID: {
    ar: "طريقة الدفع المحددة غير متاحة لهذا الإعلان.",
    en: "The selected payment method is not available for this listing.",
  },
  PRICE_OFFER_INVALID: {
    ar: "تحقق من سعر العرض. يجب أن يكون صالحًا وأقل من سعر البائع ضمن الحد المسموح.",
    en: "Check the offer price. It must be valid, below the seller price, and within the allowed range.",
  },
  SAFETY_ACKNOWLEDGEMENT_REQUIRED: {
    ar: "يجب الموافقة على إرشادات السلامة قبل المتابعة.",
    en: "You must acknowledge the safety guidance before continuing.",
  },
  ACTIVE_TRADE_EXISTS: {
    ar: "لديك صفقة نشطة بالفعل. أكملها أو ألغها أولًا.",
    en: "You already have an active trade. Complete or cancel it first.",
  },
  PURCHASE_REQUEST_ALREADY_SUBMITTED: {
    ar: "لقد أرسلت طلبًا لهذا الإعلان بالفعل.",
    en: "You already submitted a request for this listing.",
  },
  PENDING_BUYER_FEEDBACK: {
    ar: "أكمل تقييم صفقتك السابقة قبل بدء صفقة جديدة.",
    en: "Complete feedback for your previous trade before starting a new one.",
  },
  AWAITING_BUYER_CONFIRMATION: {
    ar: "أكد استلام USDT في صفقتك السابقة قبل بدء صفقة جديدة.",
    en: "Confirm receipt of USDT in your previous trade before starting a new one.",
  },
  COMMISSION_DUE: {
    ar: "لديك عمولة معلقة. قم بتسويتها قبل قبول صفقة جديدة.",
    en: "You have a pending commission. Settle it before accepting a new trade.",
  },
  MESSAGE_INVALID: {
    ar: "أدخل رسالة من 1 إلى 1200 حرف.",
    en: "Enter a message between 1 and 1,200 characters.",
  },
  DIRECT_CONTACT_BLOCKED: {
    ar: "لحماية خصوصيتك، لا يمكن مشاركة معلومات الاتصال المباشر. أبقِ المحادثة داخل غرفة الصفقة.",
    en: "To protect your privacy, direct contact details cannot be shared. Keep the conversation inside the Trade Room.",
  },
  EVIDENCE_INVALID: {
    ar: "تعذر قبول صورة الإثبات. استخدم صورة واضحة ومدعومة ضمن الحجم المسموح.",
    en: "The evidence image could not be accepted. Use a clear supported image within the size limit.",
  },
  SERVICE_UNAVAILABLE: {
    ar: "الخدمة غير متاحة مؤقتًا. حاول مرة أخرى.",
    en: "The service is temporarily unavailable. Please try again.",
  },
  INTERNAL_ERROR: {
    ar: "حدث خطأ غير متوقع.",
    en: "An unexpected error occurred.",
  },
};

export function createMobileRequestId(request: NextRequest) {
  const supplied = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{8,64}$/.test(supplied) ? supplied : randomUUID();
}

export function resolveMobileLocale(request: NextRequest): MobileLocale {
  return resolveSupportedRequestLocale(request.headers, "en");
}

export function parseMobileClientMetadata(request: NextRequest): MobileClientMetadata | null {
  const deviceId = request.headers.get("x-device-id")?.trim() ?? "";
  const appVersion = request.headers.get("x-app-version")?.trim() ?? "";
  const platform = request.headers.get("x-platform")?.trim().toLowerCase() ?? "";
  if (!DEVICE_ID_PATTERN.test(deviceId) || !APP_VERSION_PATTERN.test(appVersion)) return null;
  if (platform !== "ios" && platform !== "android") return null;
  return {
    deviceId,
    appVersion,
    platform,
    locale: resolveMobileLocale(request),
  };
}

export function readMobileBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

export async function readMobileJsonBody(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) return null;
  try {
    const value = await request.json();
    if (!value || Array.isArray(value) || typeof value !== "object") return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function mobileJson<T extends Record<string, unknown>>(
  payload: T,
  requestId: string,
  options: { status?: number; headers?: Record<string, string> } = {},
) {
  return NextResponse.json(
    { ...payload, requestId },
    {
      status: options.status ?? 200,
      headers: {
        ...MOBILE_RESPONSE_HEADERS,
        "X-Request-Id": requestId,
        Vary: "Accept-Language",
        ...(options.headers ?? {}),
      },
    },
  );
}

export function mobileError(
  code: MobileApiErrorCode,
  requestId: string,
  locale: MobileLocale,
  status: number,
  options: { retryAfterSeconds?: number } = {},
) {
  const payload: MobileApiErrorResponse = {
    error: {
      code,
      message: errorMessages[code][locale],
    },
    requestId,
  };
  return NextResponse.json(payload, {
    status,
    headers: {
      ...MOBILE_RESPONSE_HEADERS,
      "X-Request-Id": requestId,
      Vary: "Accept-Language",
      ...(options.retryAfterSeconds
        ? { "Retry-After": String(options.retryAfterSeconds) }
        : {}),
    },
  });
}
