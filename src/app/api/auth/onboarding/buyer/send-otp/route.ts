import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { beginBuyerVerification } from "@/lib/alpha-exchange-store";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import { getSmsProvider, OtpProviderError } from "@/lib/sms-provider";

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = checkRateLimit({
    headers: request.headers,
    key: `auth:buyer-otp-send:${user.id}`,
    maxRequests: 5,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (!rate.allowed) {
    logEvent("warn", {
      event: "buyer_verification_otp_send",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "Daily OTP send limit reached",
    });
    return NextResponse.json({ error: "OTP send limit reached for today." }, { status: 429 });
  }

  const body = await request.json();
  const firstName = String(body?.firstName ?? "").trim();
  const lastName = String(body?.lastName ?? "").trim();
  const displayName = String(body?.displayName ?? "").trim();
  const phone = String(body?.phone ?? "").trim();

  if (!firstName || !lastName || !phone) {
    return NextResponse.json({ error: "First name, last name, and phone are required." }, { status: 400 });
  }

  try {
    logEvent("info", {
      event: "buyer_verification_otp_send_start",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "success",
      metadata: {
        requestId,
        hasFirstName: Boolean(firstName),
        hasLastName: Boolean(lastName),
        hasDisplayName: Boolean(displayName),
        phonePrefix: phone.startsWith("+972") ? "+972" : phone.startsWith("05") ? "05" : "other",
        phoneLength: phone.length,
      },
    });

    const started = await beginBuyerVerification({
      userId: user.id,
      firstName,
      lastName,
      displayName: displayName || undefined,
      phone,
    });

    logEvent("info", {
      event: "buyer_verification_otp_send_pre_provider",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "success",
      metadata: {
        requestId,
        normalizedPhonePrefix: started.phone.startsWith("+972") ? "+972" : "other",
        normalizedPhoneLength: started.phone.length,
      },
    });

    const smsProvider = getSmsProvider();
    await smsProvider.sendOtp({ phone: started.phone });
    logEvent("info", {
      event: "buyer_verification_otp_send",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "success",
      metadata: { requestId, phoneSuffix: started.phone.slice(-4) },
    });
    return NextResponse.json({ ok: true, message: "Verification code sent." });
  } catch (error) {
    if (error instanceof OtpProviderError) {
      logEvent("error", {
        event: "buyer_verification_otp_send_provider_failed",
        actorUserId: user.id,
        actorRole: user.role,
        outcome: "failed",
        reason: error.message,
        metadata: {
          requestId,
          supportCode: error.supportCode,
          stage: error.stage,
          provider: error.provider,
          rawCode: error.rawCode ?? null,
          rawStatus: error.rawStatus ?? null,
          rawMessage: error.rawMessage,
        },
      });
      return NextResponse.json(
        {
          error: error.message,
          supportCode: error.supportCode,
          requestId,
        },
        { status: 503 },
      );
    }

    logEvent("error", {
      event: "buyer_verification_otp_send",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Unknown error",
      metadata: { requestId },
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to send OTP.",
        supportCode: "OTP_PROVIDER_UNKNOWN",
        requestId,
      },
      { status: 400 },
    );
  }
}
