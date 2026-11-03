import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { hasTrustedSameOrigin } from "@/lib/request-origin";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import {
  MENTORSHIP_EMAIL_CONSENT_VERSION,
  isMentorshipEmailCampaignOpen,
  isMentorshipEmailRequestEnabled,
  mentorshipEmailConsentText,
} from "@/lib/mentorship-email-config";
import {
  declineMentorshipEmail,
  getMentorshipEmailStatus,
  requestMentorshipEmail,
} from "@/lib/mentorship-email-campaign";
import type { AppLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), locale: z.enum(["en", "ar"]), consent: z.literal(true), consentVersion: z.literal(MENTORSHIP_EMAIL_CONSENT_VERSION) }).strict(),
  z.object({ action: z.literal("decline"), locale: z.enum(["en", "ar"]) }).strict(),
]);

type Status = Awaited<ReturnType<typeof getMentorshipEmailStatus>>;

function maskedEmail(email: string) {
  const at = email.lastIndexOf("@");
  if (at < 1) return "";
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

// Deliberately return only display state. Ledger IDs, holds, provider IDs,
// frozen HTML and unsubscribe capability tokens never leave this boundary.
function publicStatus(status: Pick<Status, "status" | "canRequest">, email: string, locale: AppLocale) {
  return {
    status: status.status,
    canRequest: status.canRequest,
    maskedEmail: maskedEmail(email),
    consentVersion: MENTORSHIP_EMAIL_CONSENT_VERSION,
    consentText: mentorshipEmailConsentText(locale),
  };
}

function failure(code: string, status: number, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json({ error: code }, { status, headers: { ...HEADERS, ...extraHeaders } });
}

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const expectedUserId = request.headers.get("x-alpha-expected-user-id");
  if (expectedUserId && expectedUserId !== user.id) return failure("account_changed", 409);
  const locale = request.nextUrl.searchParams.get("locale") === "ar" ? "ar" : "en";
  try {
    const status = await getMentorshipEmailStatus(user);
    return NextResponse.json(publicStatus(status, user.email, locale), { headers: HEADERS });
  } catch (error) {
    logEvent("error", { event: "mentorship_email_status", outcome: "failed", reason: "status_unavailable", metadata: { errorType: error instanceof Error ? error.name : typeof error } });
    return failure("status_unavailable", 503);
  }
}

export async function POST(request: NextRequest) {
  if (!hasTrustedSameOrigin(request)) return failure("invalid_origin", 403);
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  // Bind a click to the account shown when the form was opened. Signing into
  // another account in a different tab must not transfer that choice.
  if (request.headers.get("x-alpha-expected-user-id") !== user.id) return failure("account_changed", 409);

  let parsed: z.infer<typeof inputSchema>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 2_048) return failure("request_too_large", 413);
    const result = inputSchema.safeParse(JSON.parse(raw));
    if (!result.success) return failure("invalid_choice", 400);
    parsed = result.data;
  } catch { return failure("invalid_choice", 400); }

  if (parsed.action === "request") {
    if (user.emailVerified !== true) {
      return NextResponse.json(publicStatus({ status: "unverified", canRequest: false }, user.email, parsed.locale), { status: 409, headers: HEADERS });
    }
    if (!isMentorshipEmailRequestEnabled() || !isMentorshipEmailCampaignOpen()) {
      return NextResponse.json(publicStatus({ status: isMentorshipEmailCampaignOpen() ? "held" : "expired", canRequest: false }, user.email, parsed.locale), { status: 409, headers: HEADERS });
    }
  }

  try {
    const rate = await checkSharedRateLimit({ headers: request.headers, key: `marketing:mentorship-invitation:${parsed.action}`, identifier: user.id, maxRequests: parsed.action === "request" ? 6 : 12, windowMs: parsed.action === "request" ? 60 * 60_000 : 60_000 });
    if (!rate.allowed) return failure("too_many_requests", 429, { "Retry-After": String(rate.retryAfterSeconds) });
    const status = parsed.action === "request"
      ? await requestMentorshipEmail(user, parsed.locale, parsed.consentVersion)
      : await declineMentorshipEmail(user);
    const pending = status.status === "queued" || status.status === "sending";
    return NextResponse.json(publicStatus(status, user.email, parsed.locale), { status: pending ? 202 : 200, headers: HEADERS });
  } catch (error) {
    logEvent("error", { event: "mentorship_email_choice", outcome: "failed", reason: "choice_unconfirmed", metadata: { errorType: error instanceof Error ? error.name : typeof error, action: parsed.action } });
    return failure("choice_unconfirmed", 503);
  }
}
