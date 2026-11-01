import { NextRequest, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { disableUserAccountByAdmin } from "@/lib/alpha-exchange-store";

type RouteContext = { params: Promise<{ userId: string }> };

// This marker is emitted only before the audited store mutation is called.
function invalidInput(error: string) {
  return NextResponse.json({
    error, code: "owner_command_validation", commandOutcome: "rejected", mutationAttempted: false,
  }, { status: 400 });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;

  let body: unknown;
  try { body = await request.json(); }
  catch { return invalidInput("Invalid JSON request body."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalidInput("Invalid request body.");
  const input = body as Record<string, unknown>;
  if (typeof input.disabled !== "boolean") return invalidInput("Disabled must be a boolean.");
  if (typeof input.reason !== "string" || !input.reason.trim()) return invalidInput("Reason is required.");
  const disabled = input.disabled;
  const reason = input.reason.trim();

  let mutationAttempted = false;
  try {
    const { userId } = await context.params;

    mutationAttempted = true;
    await disableUserAccountByAdmin({ userId, disabled, reason, actorUserId: user.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ code: "owner_command_outcome_unknown", commandOutcome: "unknown", mutationAttempted, error: error instanceof Error ? error.message : "Failed to update user account." }, { status: 400 });
  }
}
