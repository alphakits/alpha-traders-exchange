import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { confirmAdultEligibility } from "@/lib/alpha-exchange-store";
import { toClientSessionUser } from "@/lib/client-session-user";
import { logEvent } from "@/lib/structured-logging";

const headers = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) return NextResponse.json({ code: "AGE_CONFIRMATION_REQUIRED",
    error: "Confirm that you are 18 or older to continue." }, { status: 400, headers });
  try {
    // The principal comes only from the authenticated session, never the body.
    const saved = await confirmAdultEligibility(user.id, body.confirmed);
    return NextResponse.json({ ok: true, user: toClientSessionUser(saved) }, { headers });
  } catch (error) {
    logEvent("error", { event: "age_eligibility_confirmation", outcome: "failed",
      reason: "account_update_unavailable", metadata: { errorType: error instanceof Error ? error.name : typeof error } });
    return NextResponse.json({ error: "Account update unavailable. Please try again." }, { status: 503, headers });
  }
}
