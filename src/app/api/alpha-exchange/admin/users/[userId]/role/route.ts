import { NextRequest, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { changeUserRoleByAdmin } from "@/lib/alpha-exchange-store";
import type { UserRole } from "@/types/alpha-exchange";

type RouteContext = { params: Promise<{ userId: string }> };

const VALID_ROLES: UserRole[] = ["guest", "student", "buyer", "pending_seller_approval", "approved_seller", "admin", "owner"];

function isValidRole(value: string): value is UserRole {
  return VALID_ROLES.includes(value as UserRole);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;

  try {
    const { userId } = await context.params;
    const body = await request.json() as { role?: string; reason?: string };
    const role = String(body.role ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (!isValidRole(role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    if (!reason) return NextResponse.json({ error: "Reason is required." }, { status: 400 });

    await changeUserRoleByAdmin({ userId, role, reason, actorUserId: user.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to change user role." }, { status: 400 });
  }
}
