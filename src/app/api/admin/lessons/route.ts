import { NextRequest, NextResponse } from "next/server";
import { adminErrorStatus, resolveAdminIdentity } from "@/lib/admin-auth";
import { createLesson, readLessons, searchLessons } from "@/lib/admin-store";
import type { LessonCategory, LessonStatus } from "@/types/academy";

export async function GET(request: NextRequest) {
  try {
    await resolveAdminIdentity(request);
    const url = new URL(request.url);
    const lessons = await readLessons();
    const filtered = searchLessons(lessons, {
      term: url.searchParams.get("q") || "",
      category: (url.searchParams.get("category") as LessonCategory | "all" | null) || "all",
      status: (url.searchParams.get("status") as LessonStatus | "all" | null) || "all",
      lessonNumber: url.searchParams.get("lessonNumber") ? Number(url.searchParams.get("lessonNumber")) : undefined,
    });
    return NextResponse.json({ lessons: filtered });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to read lessons." }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = await resolveAdminIdentity(request);
    const body = (await request.json()) as { lesson: Record<string, unknown> };
    const lesson = await createLesson((body.lesson || {}) as never, identity.role);
    return NextResponse.json({ lesson }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create lesson." }, { status: adminErrorStatus(error) });
  }
}
