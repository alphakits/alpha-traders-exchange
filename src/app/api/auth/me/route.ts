import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, clearUserSession, getCurrentSessionToken, getCurrentSessionUser } from "@/lib/auth";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const AUTH_ME_TRACE_LOG_PATH = path.join(process.cwd(), "tmp", "auth-me-route-trace.log");
const AUTH_ME_TRACE_TO_FILE = process.env.AUTH_ME_TRACE_TO_FILE === "1";

type TraceEvent = {
  traceId: string;
  event: string;
  status?: number;
  bodyBytes?: number;
  note?: string;
  error?: string;
  stack?: string;
  at: string;
};

async function writeTrace(event: Omit<TraceEvent, "at">) {
  if (!AUTH_ME_TRACE_TO_FILE) return;
  try {
    await mkdir(path.dirname(AUTH_ME_TRACE_LOG_PATH), { recursive: true });
    await appendFile(
      AUTH_ME_TRACE_LOG_PATH,
      `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`,
      "utf8",
    );
  } catch {
    // Never fail auth endpoint because of diagnostics.
  }
}

async function buildJsonResponse(traceId: string, event: string, payload: unknown, status = 200) {
  const body = JSON.stringify(payload);
  const bodyBytes = Buffer.byteLength(body, "utf8");

  await writeTrace({
    traceId,
    event: `${event}:before-return`,
    status,
    bodyBytes,
    note: "About to call NextResponse.json",
  });

  const response = NextResponse.json(payload, {
    status,
    headers: {
      ...AUTH_RESPONSE_HEADERS,
      "x-auth-me-trace-id": traceId,
      "x-auth-me-body-bytes": String(bodyBytes),
    },
  });

  await writeTrace({
    traceId,
    event: `${event}:after-return`,
    status: response.status,
    bodyBytes,
    note: "NextResponse.json reached",
  });

  return response;
}

export async function GET() {
  const traceId = `auth-me-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeTrace({ traceId, event: "route-entry", note: "Entered GET /api/auth/me" });

  try {
    const user = await getCurrentSessionUser();
    await writeTrace({
      traceId,
      event: "session-user-resolved",
      note: user ? "Resolved authenticated user" : "No authenticated user",
    });

    if (!user) {
      const token = await getCurrentSessionToken();
      await clearUserSession(token);
      const cookieStore = await cookies();
      cookieStore.delete(AUTH_COOKIE_NAME);
      cookieStore.delete(AUTH_VERIFIED_COOKIE_NAME);
      cookieStore.delete(AUTH_PHONE_VERIFIED_COOKIE_NAME);
      return await buildJsonResponse(traceId, "return-anonymous", { user: null }, 200);
    }

    const payload = {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        roles: user.roles ?? [user.role],
        sellerStatus: user.sellerStatus,
        whatsappNumber: user.whatsappNumber,
        preferredNetworks: user.preferredNetworks,
        profilePhotoUrl: user.profilePhotoUrl,
        coverBannerUrl: user.coverBannerUrl ?? "",
        languages: user.languages,
        bio: user.bio,
        tradingExperience: user.tradingExperience ?? "",
        workingHours: user.workingHours ?? "",
        preferredPaymentMethods: user.preferredPaymentMethods ?? [],
        country: user.country ?? "",
        city: user.city ?? "",
        onlineStatus: user.onlineStatus,
        availabilityStatus: user.availabilityStatus,
        lastActiveAt: user.lastActiveAt ?? user.updatedAt,
        isFeaturedSeller: user.isFeaturedSeller === true,
        isProfileHidden: user.isProfileHidden === true,
        isFoundingMember: user.isFoundingMember === true,
        isFoundingSeller: user.isFoundingSeller === true,
        emailVerified: user.emailVerified === true,
        verifiedPhone: user.verifiedPhone ?? "",
        phoneVerifiedAt: user.phoneVerifiedAt ?? "",
        onboardingSelection: user.onboardingSelection,
        onboardingCompletedAt: user.onboardingCompletedAt,
        lifetimeCompletedVolumeUsdt: user.lifetimeCompletedVolumeUsdt ?? 0,
        sellerPrestigeRank: user.sellerPrestigeRank ?? "bronze",
        sellerRankOverride: user.sellerRankOverride,
        sellerPromotionHistory: user.sellerPromotionHistory ?? [],
        notificationPreferences: user.notificationPreferences ?? { inApp: true, email: false, sms: false },
        createdAt: user.createdAt,
      },
    };

    return await buildJsonResponse(traceId, "return-authenticated", payload, 200);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await writeTrace({
      traceId,
      event: "route-exception",
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }
}
