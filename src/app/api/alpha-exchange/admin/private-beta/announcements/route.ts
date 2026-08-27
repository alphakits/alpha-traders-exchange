import { NextRequest, NextResponse } from "next/server";
import { createBetaAnnouncement, getOwnerPrivateBetaDashboardData } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";
import type { BetaAnnouncementType } from "@/types/alpha-exchange";

function isAnnouncementType(value: string): value is BetaAnnouncementType {
  return value === "maintenance" || value === "new_feature" || value === "bug_fix" || value === "known_issue";
}

export async function GET() {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  const payload = await getOwnerPrivateBetaDashboardData();
  return NextResponse.json({ announcements: payload.announcements });
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  try {
    const body = await request.json();
    const typeRaw = String(body.type ?? "").trim();
    const titleEn = String(body.titleEn ?? "").trim();
    const messageEn = String(body.messageEn ?? "").trim();
    const titleAr = String(body.titleAr ?? "").trim();
    const messageAr = String(body.messageAr ?? "").trim();
    if (!isAnnouncementType(typeRaw)) {
      return NextResponse.json({ error: "Invalid announcement type." }, { status: 400 });
    }
    const announcement = await createBetaAnnouncement({
      ownerUserId: user.id,
      titleEn,
      messageEn,
      titleAr,
      messageAr,
      type: typeRaw,
    });
    return NextResponse.json({ announcement }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create announcement." }, { status: 400 });
  }
}
