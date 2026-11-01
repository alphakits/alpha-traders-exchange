import { privateAdminResponse } from "@/lib/admin-response";
import { NextRequest, NextResponse } from "next/server";
import { adminErrorStatus, resolveAdminIdentity } from "@/lib/admin-auth";
import { duplicateLesson } from "@/lib/admin-store";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await resolveAdminIdentity(request);
    const { id } = await params;
    const lesson = await duplicateLesson(id, identity.role);
    return privateAdminResponse(NextResponse.json({ lesson }));
  } catch (error) {
    return privateAdminResponse(NextResponse.json({ error: error instanceof Error ? error.message : "Failed to duplicate lesson." }, { status: adminErrorStatus(error) }));
  }
}
