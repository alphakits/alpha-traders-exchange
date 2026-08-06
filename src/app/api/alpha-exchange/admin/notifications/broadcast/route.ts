import { NextRequest, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { broadcastNotificationByAdmin } from "@/lib/alpha-exchange-store";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;

  try {
    const body = await request.json() as { title?: string; body?: string; type?: string; reason?: string };
    const title = String(body.title ?? "").trim();
    const notifBody = String(body.body ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    const type = body.type === "warning" || body.type === "success" ? body.type : "info";
    if (!title || !notifBody) return NextResponse.json({ error: "Title and body are required." }, { status: 400 });
    if (!reason) return NextResponse.json({ error: "Reason is required." }, { status: 400 });

    await broadcastNotificationByAdmin({ title, body: notifBody, type, actorUserId: user.id, reason });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to broadcast notification." }, { status: 400 });
  }
}
