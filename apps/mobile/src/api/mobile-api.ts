import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import type {
  MobileApiErrorCode,
  MobileApiErrorResponse,
  MobileAuthTokens,
  MobileCreateTradeRequest,
  MobileLocale,
  MobileLoginResponse,
  MobileMarketplaceListingsResponse,
  MobileMeResponse,
  MobileNotificationResponse,
  MobileNotificationsResponse,
  MobileNotificationsUpdateResponse,
  MobileRefreshResponse,
  MobileSellerProfileResponse,
  MobileTradeBankDetailsResponse,
  MobileTradeDetailResponse,
  MobileTradeMessageResponse,
  MobileTradeResponse,
  MobileTradesResponse,
} from "@alpha-traders/contracts";
import { getOrCreateDeviceId } from "../auth/session-storage";

const DEFAULT_API_ORIGIN = "https://www.alphatraders.co.il";
const REQUEST_TIMEOUT_MS = 12_000;

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly code: MobileApiErrorCode,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

function apiOrigin() {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_API_ORIGIN;
  const parsed = new URL(configured);
  if (!__DEV__ && parsed.protocol !== "https:") {
    throw new Error("Release builds require an HTTPS API origin.");
  }
  return parsed.origin;
}

function clientPlatform() {
  return Platform.OS === "ios" ? "ios" : "android";
}

function appVersion() {
  return Constants.expoConfig?.version ?? "1.0.0";
}

type MobileRequestOptions = {
  locale: MobileLocale;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  accessToken?: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

async function mobileRequest<T>(path: string, options: MobileRequestOptions): Promise<T> {
  const requestId = Crypto.randomUUID();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const deviceId = await getOrCreateDeviceId();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Accept-Language": options.locale,
      "X-App-Version": appVersion(),
      "X-Device-Id": deviceId,
      "X-Platform": clientPlatform(),
      "X-Request-Id": requestId,
    };
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
    if (options.body) headers["Content-Type"] = "application/json";

    const response = await fetch(`${apiOrigin()}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const apiError = payload as Partial<MobileApiErrorResponse> | null;
      throw new MobileApiError(
        apiError?.error?.message ?? `Request failed with status ${response.status}.`,
        apiError?.error?.code ?? "INTERNAL_ERROR",
        response.status,
        apiError?.requestId ?? response.headers.get("x-request-id") ?? requestId,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof MobileApiError) throw error;
    if (controller.signal.aborted) {
      const message = timedOut
        ? (options.locale === "ar" ? "انتهت مهلة الطلب. حاول مرة أخرى." : "The request timed out. Please try again.")
        : (options.locale === "ar" ? "تم إلغاء الطلب." : "The request was cancelled.");
      throw new MobileApiError(message, "SERVICE_UNAVAILABLE", 0, requestId);
    }
    throw new MobileApiError(
      options.locale === "ar" ? "تعذر الوصول إلى الخدمة." : "The service could not be reached.",
      "SERVICE_UNAVAILABLE",
      0,
      requestId,
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function loginMobile(email: string, password: string, locale: MobileLocale) {
  return mobileRequest<MobileLoginResponse>("/api/mobile/v1/auth/login", {
    locale,
    method: "POST",
    body: { email, password },
  });
}

let refreshInFlight: { refreshToken: string; promise: Promise<MobileRefreshResponse> } | null = null;

export function refreshMobile(tokens: MobileAuthTokens, locale: MobileLocale) {
  if (!refreshInFlight || refreshInFlight.refreshToken !== tokens.refreshToken) {
    const promise = mobileRequest<MobileRefreshResponse>("/api/mobile/v1/auth/refresh", {
      locale,
      method: "POST",
      body: { refreshToken: tokens.refreshToken },
    }).finally(() => {
      if (refreshInFlight?.promise === promise) refreshInFlight = null;
    });
    refreshInFlight = { refreshToken: tokens.refreshToken, promise };
  }
  return refreshInFlight.promise;
}

export function getMobileMe(tokens: MobileAuthTokens, locale: MobileLocale) {
  return mobileRequest<MobileMeResponse>("/api/mobile/v1/auth/me", {
    locale,
    accessToken: tokens.accessToken,
  });
}

export function logoutMobile(tokens: MobileAuthTokens, locale: MobileLocale, scope: "device" | "all" = "device") {
  return mobileRequest<{ revoked: true }>(`/api/mobile/v1/auth/session?scope=${scope}`, {
    locale,
    method: "DELETE",
    accessToken: tokens.accessToken,
  });
}

export function getMobileNotifications(
  tokens: MobileAuthTokens,
  locale: MobileLocale,
  signal?: AbortSignal,
) {
  return mobileRequest<MobileNotificationsResponse>("/api/mobile/v1/notifications", {
    locale,
    accessToken: tokens.accessToken,
    signal,
  });
}

export function setMobileNotificationRead(
  tokens: MobileAuthTokens,
  locale: MobileLocale,
  notificationId: string,
  isRead: boolean,
) {
  return mobileRequest<MobileNotificationResponse>(
    `/api/mobile/v1/notifications/${encodeURIComponent(notificationId)}`,
    {
      locale,
      method: "PATCH",
      accessToken: tokens.accessToken,
      body: { isRead },
    },
  );
}

export function markAllMobileNotificationsRead(
  tokens: MobileAuthTokens,
  locale: MobileLocale,
) {
  return mobileRequest<MobileNotificationsUpdateResponse>("/api/mobile/v1/notifications", {
    locale,
    method: "PATCH",
    accessToken: tokens.accessToken,
    body: { action: "mark_all_read" },
  });
}

export function getMobileMarketplace(locale: MobileLocale, signal?: AbortSignal) {
  return mobileRequest<MobileMarketplaceListingsResponse>("/api/mobile/v1/marketplace/listings", {
    locale,
    signal,
  });
}

export function getMobileSellerProfile(listingId: string, locale: MobileLocale, signal?: AbortSignal) {
  return mobileRequest<MobileSellerProfileResponse>(
    `/api/mobile/v1/marketplace/listings/${encodeURIComponent(listingId)}/seller`,
    { locale, signal },
  );
}

export function getMobileTrades(tokens: MobileAuthTokens, locale: MobileLocale, signal?: AbortSignal) {
  return mobileRequest<MobileTradesResponse>("/api/mobile/v1/trades", {
    locale,
    accessToken: tokens.accessToken,
    signal,
  });
}

export function createMobileTrade(tokens: MobileAuthTokens, locale: MobileLocale, input: MobileCreateTradeRequest) {
  return mobileRequest<MobileTradeResponse>("/api/mobile/v1/trades", {
    locale,
    method: "POST",
    accessToken: tokens.accessToken,
    body: {
      listingId: input.listingId,
      usdtAmount: input.usdtAmount,
      receivingWalletAddress: input.receivingWalletAddress,
      paymentMethod: input.paymentMethod,
      priceMode: input.priceMode,
      offeredPrice: input.offeredPrice,
      safetyAcknowledged: input.safetyAcknowledged,
    },
  });
}

export function getMobileTrade(
  tokens: MobileAuthTokens,
  locale: MobileLocale,
  requestId: string,
  signal?: AbortSignal,
) {
  return mobileRequest<MobileTradeDetailResponse>(`/api/mobile/v1/trades/${encodeURIComponent(requestId)}`, {
    locale,
    accessToken: tokens.accessToken,
    signal,
  });
}

export function updateMobileTrade(
  tokens: MobileAuthTokens,
  locale: MobileLocale,
  requestId: string,
  status: string,
  safetyAcknowledged = false,
) {
  return mobileRequest<MobileTradeResponse>(`/api/mobile/v1/trades/${encodeURIComponent(requestId)}`, {
    locale,
    method: "PATCH",
    accessToken: tokens.accessToken,
    body: { status, safetyAcknowledged },
  });
}

export function getMobileTradeBankDetails(
  tokens: MobileAuthTokens,
  locale: MobileLocale,
  requestId: string,
) {
  return mobileRequest<MobileTradeBankDetailsResponse>(
    `/api/mobile/v1/trades/${encodeURIComponent(requestId)}/bank-details`,
    { locale, accessToken: tokens.accessToken },
  );
}

export function uploadMobileTradeEvidence(
  tokens: MobileAuthTokens,
  locale: MobileLocale,
  input: {
    requestId: string;
    side: "buyer" | "seller";
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    sizeBytes: number;
    contentBase64: string;
  },
) {
  return mobileRequest<MobileTradeResponse>(
    `/api/mobile/v1/trades/${encodeURIComponent(input.requestId)}/evidence`,
    {
      locale,
      method: "POST",
      accessToken: tokens.accessToken,
      body: {
        side: input.side,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        contentBase64: input.contentBase64,
      },
      timeoutMs: 45_000,
    },
  );
}

export function sendMobileTradeMessage(
  tokens: MobileAuthTokens,
  locale: MobileLocale,
  input: {
    requestId: string;
    message: string;
    clientMessageId: string;
  },
) {
  return mobileRequest<MobileTradeMessageResponse>(
    `/api/mobile/v1/trades/${encodeURIComponent(input.requestId)}/messages`,
    {
      locale,
      method: "POST",
      accessToken: tokens.accessToken,
      body: {
        message: input.message,
        clientMessageId: input.clientMessageId,
      },
    },
  );
}
