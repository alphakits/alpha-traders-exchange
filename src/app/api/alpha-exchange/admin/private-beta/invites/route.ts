import { NextRequest, NextResponse } from "next/server";
import { createPrivateBetaInvite, getOwnerPrivateBetaDashboardData } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";

export async function GET() {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  const payload = await getOwnerPrivateBetaDashboardData();
  return NextResponse.json({
    inviteCodes: payload.inviteCodes,
    inviteUses: payload.inviteUses,
    pendingInvites: payload.pendingInvites,
  });
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  try {
    const body = await request.json();
    const maxUses = Number(body.maxUses ?? 1);
    if (Number.isNaN(maxUses) || maxUses < 1) {
      return NextResponse.json({ error: "maxUses must be a positive number." }, { status: 400 });
    }
    const expiresAtRaw = String(body.expiresAt ?? "").trim();
    let expiresAt: string | undefined;
    if (expiresAtRaw) {
      const parsed = new Date(expiresAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid invite expiration date." }, { status: 400 });
      }
      expiresAt = parsed.toISOString();
    }
    const invite = await createPrivateBetaInvite({
      ownerUserId: user.id,
      maxUses,
      expiresAt,
    });
    return NextResponse.json({ invite }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create invite." }, { status: 400 });
  }
}
