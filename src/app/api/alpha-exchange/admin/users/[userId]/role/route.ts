import { NextRequest, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { changeUserRoleByAdmin } from "@/lib/alpha-exchange-store";
import type { UserRole } from "@/types/alpha-exchange";

type RouteContext = { params: Promise<{ userId: string }> };

const VALID_ROLES: UserRole[] = ["guest", "student", "buyer", "admin"];

function isValidRole(value: string): value is UserRole {
  return VALID_ROLES.includes(value as UserRole);
}

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
  if (typeof input.role !== "string" || !isValidRole(input.role.trim())) return invalidInput("Invalid role.");
  if (typeof input.reason !== "string" || !input.reason.trim()) return invalidInput("Reason is required.");
  const role = input.role.trim() as UserRole;
  const reason = input.reason.trim();

  let mutationAttempted = false;
  try {
    const { userId } = await context.params;

    mutationAttempted = true;
    await changeUserRoleByAdmin({ userId, role, reason, actorUserId: user.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ code: "owner_command_outcome_unknown", commandOutcome: "unknown", mutationAttempted, error: error instanceof Error ? error.message : "Failed to change user role." }, { status: 400 });
  }
}
