import { NextRequest } from "next/server";
import type { MobileAccountProfileUpdateRequest } from "@alpha-traders/contracts";
import {
  findUserById,
  getAccountProfileData,
  updateAccountProfileData,
} from "@/lib/alpha-exchange-store";
import { toMobileAccountProfile, toMobileAccountStats } from "@/lib/mobile-account-profile";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { toMobileSessionUser } from "@/lib/mobile-session-user";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

const PROFILE_UPDATE_KEYS = new Set<keyof MobileAccountProfileUpdateRequest>([
  "fullName",
  "bio",
  "country",
  "showTradeStats",
  "showLastActive",
  "allowDirectMessages",
  "allowProfileSearch",
  "showPhonePublic",
  "showEmailPublic",
]);

function parseProfileUpdate(body: Record<string, unknown>): MobileAccountProfileUpdateRequest | null {
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => !PROFILE_UPDATE_KEYS.has(key as keyof MobileAccountProfileUpdateRequest))) {
    return null;
  }
  if (
    (body.fullName !== undefined && (
      typeof body.fullName !== "string"
      || !body.fullName.trim()
      || body.fullName.trim().length > 100
    ))
    || (body.bio !== undefined && (typeof body.bio !== "string" || body.bio.length > 2_000))
    || (body.country !== undefined && (typeof body.country !== "string" || body.country.trim().length > 100))
  ) {
    return null;
  }

  const booleanKeys = [
    "showTradeStats",
    "showLastActive",
    "allowDirectMessages",
    "allowProfileSearch",
    "showPhonePublic",
    "showEmailPublic",
  ] as const;
  if (booleanKeys.some((key) => body[key] !== undefined && typeof body[key] !== "boolean")) {
    return null;
  }

  return {
    ...(body.fullName !== undefined ? { fullName: body.fullName.trim() } : {}),
    ...(body.bio !== undefined ? { bio: body.bio.trim() } : {}),
    ...(body.country !== undefined ? { country: body.country.trim() } : {}),
    ...Object.fromEntries(
      booleanKeys
        .filter((key) => body[key] !== undefined)
        .map((key) => [key, body[key] as boolean]),
    ),
  };
}

async function profilePayload(userId: string) {
  const [account, user] = await Promise.all([
    getAccountProfileData(userId),
    findUserById(userId),
  ]);
  if (!user) return null;
  return {
    profile: toMobileAccountProfile(account.profile),
    stats: toMobileAccountStats(account.stats),
    user: toMobileSessionUser(user),
  };
}

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:profile:read",
      identifier: auth.user.id,
      maxRequests: 120,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }
    const payload = await profilePayload(auth.user.id);
    return payload
      ? mobileJson(payload, requestId)
      : mobileError("UNAUTHORIZED", requestId, locale, 401);
  } catch (error) {
    logEvent("error", {
      event: "mobile_profile_read",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:profile:update",
      identifier: auth.user.id,
      maxRequests: 20,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }
    const body = await readMobileJsonBody(request);
    const update = body ? parseProfileUpdate(body) : null;
    if (!update) return mobileError("PROFILE_INVALID", requestId, locale, 400);

    await updateAccountProfileData({ userId: auth.user.id, ...update });
    const payload = await profilePayload(auth.user.id);
    if (!payload) return mobileError("UNAUTHORIZED", requestId, locale, 401);
    logEvent("info", {
      event: "mobile_profile_update",
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      outcome: "success",
      metadata: { updatedFields: Object.keys(update), requestId },
    });
    return mobileJson(payload, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_profile_update",
      outcome: "failed",
      reason: "update_failed",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("PROFILE_UPDATE_FAILED", requestId, locale, 500);
  }
}
