import { NextRequest, NextResponse } from "next/server";
import { resolveAdminIdentity } from "@/lib/admin-auth";
import { reorderLessons } from "@/lib/admin-store";

export async function POST(request: NextRequest) {
  try {
    const identity = resolveAdminIdentity(request);
    const body = (await request.json()) as {
      items: Array<{ id: string; order: number; category?: "beginner" | "intermediate" | "advanced"; courseId?: string }>;
    };
    const lessons = await reorderLessons(body.items || [], identity.role);
    return NextResponse.json({ lessons });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reorder lessons." }, { status: 400 });
  }
}
