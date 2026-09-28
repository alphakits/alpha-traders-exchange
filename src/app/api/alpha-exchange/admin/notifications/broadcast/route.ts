import { NextRequest, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { broadcastNotificationByAdmin } from "@/lib/alpha-exchange-store";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;

  try {
    const body = await request.json() as {
      titleEn?: string;
      bodyEn?: string;
      titleAr?: string;
      bodyAr?: string;
      type?: string;
      reason?: string;
    };
    const titleEn = String(body.titleEn ?? "").trim();
    const bodyEn = String(body.bodyEn ?? "").trim();
    const titleAr = String(body.titleAr ?? "").trim();
    const bodyAr = String(body.bodyAr ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    const type = body.type === "warning" || body.type === "success" ? body.type : "info";
    if (!titleEn || !bodyEn || !titleAr || !bodyAr) {
      return NextResponse.json({ error: "English and Arabic titles and bodies are required." }, { status: 400 });
    }
    if (!reason) return NextResponse.json({ error: "Reason is required." }, { status: 400 });

    await broadcastNotificationByAdmin({ titleEn, bodyEn, titleAr, bodyAr, type, actorUserId: user.id, reason });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to broadcast notification." }, { status: 400 });
  }
}
