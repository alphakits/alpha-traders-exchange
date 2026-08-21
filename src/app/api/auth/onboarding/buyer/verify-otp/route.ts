import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireApiUser } from "@/lib/api-auth";
import { completeBuyerVerification, confirmProfilePhoneVerification, findUserById, recordBuyerVerificationAttempt } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import { AUTH_PHONE_VERIFIED_COOKIE_NAME } from "@/lib/auth";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";

const OTP_EXPIRY_MINUTES = Number(process.env.BUYER_OTP_EXPIRY_MINUTES ?? "10");

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: `auth:buyer-otp-verify:${user.id}`,
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
  });
  if (!rate.allowed) {
    logEvent("warn", {
      event: "buyer_verification_otp_verify",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "Hourly OTP verify rate limit exceeded",
    });
    return NextResponse.json({ error: "Too many verification attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json();
  const phone = String(body?.phone ?? "").trim();
  const token = String(body?.token ?? "").trim();
  if (!phone || !token || token.length !== 6) {
    return NextResponse.json({ error: "Phone and 6-digit code are required." }, { status: 400 });
  }

  const currentUser = await findUserById(user.id);
  if (!currentUser?.buyerOtpRequestedAt) {
    logEvent("warn", {
      event: "buyer_verification_otp_verify",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "OTP verification attempted without prior OTP send",
    });
    return NextResponse.json({ error: "Please request a new verification code." }, { status: 400 });
  }

  const requestedAt = new Date(currentUser.buyerOtpRequestedAt).getTime();
  const expiryWindowMs = (Number.isFinite(OTP_EXPIRY_MINUTES) && OTP_EXPIRY_MINUTES > 0 ? OTP_EXPIRY_MINUTES : 10) * 60 * 1000;
  if (Date.now() - requestedAt > expiryWindowMs) {
    logEvent("warn", {
      event: "buyer_verification_otp_verify",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "OTP expired before verification",
    });
    return NextResponse.json({ error: "Verification code expired. Please request a new code." }, { status: 400 });
  }

  try {
    await confirmProfilePhoneVerification({ userId: user.id, phone, code: token });
  } catch (error) {
    await recordBuyerVerificationAttempt(user.id);
    logEvent("warn", {
      event: "buyer_verification_otp_verify",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "OTP verify provider failure",
      metadata: { requestId },
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to verify OTP.",
        supportCode: "OTP_PROVIDER_UNKNOWN",
        requestId,
      },
      { status: 400 },
    );
  }

  try {
    const updated = await completeBuyerVerification({ userId: user.id, phone });
    const cookieStore = await cookies();
    const secureCookies = shouldUseSecureAuthCookie(request);
    cookieStore.set(AUTH_PHONE_VERIFIED_COOKIE_NAME, "1", {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
    });
    logEvent("info", {
      event: "buyer_verification_otp_verify",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "success",
      metadata: { requestId, phoneSuffix: phone.slice(-4) },
    });
    return NextResponse.json({
      ok: true,
      user: {
        id: updated.id,
        role: updated.role,
        roles: updated.roles ?? [updated.role],
        onboardingSelection: updated.onboardingSelection,
        onboardingCompletedAt: updated.onboardingCompletedAt,
      },
    });
  } catch (error) {
    logEvent("error", {
      event: "buyer_verification_otp_verify",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Unknown completion failure",
      metadata: { requestId },
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to complete buyer verification." }, { status: 400 });
  }
}
