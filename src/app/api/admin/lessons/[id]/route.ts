import { NextRequest, NextResponse } from "next/server";
import { adminErrorStatus, resolveAdminIdentity } from "@/lib/admin-auth";
import { deleteLesson, LessonConflictError, setLessonStatus, updateLesson } from "@/lib/admin-store";
import type { LessonStatus } from "@/types/academy";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await resolveAdminIdentity(request);
    const { id } = await params;
    const body = (await request.json()) as { lesson?: unknown };
    if (!body || !body.lesson || typeof body.lesson !== "object" || Array.isArray(body.lesson)) {
      return NextResponse.json({ error: "Lesson changes must be an object." }, { status: 400 });
    }
    const lessonPatch = body.lesson as Record<string, unknown>;
    if (lessonPatch.id !== undefined && lessonPatch.id !== id) {
      return NextResponse.json({ error: "Lesson ID does not match the request path." }, { status: 400 });
    }
    const requestedStatus = lessonPatch.status as LessonStatus | undefined;
    if (requestedStatus !== undefined && requestedStatus !== "draft" && requestedStatus !== "published") {
      return NextResponse.json({ error: "Invalid lesson status." }, { status: 400 });
    }
    const statusOnly = requestedStatus !== undefined && Object.keys(lessonPatch).every(key => key === "status" || key === "id");
    const lesson = statusOnly
      ? await setLessonStatus(id, requestedStatus, identity.role)
      : await updateLesson({ ...lessonPatch, id }, identity.role);
    return NextResponse.json({ lesson });
  } catch (error) {
    if (error instanceof LessonConflictError) return NextResponse.json({ error: error.message, currentLesson: error.currentLesson }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update lesson." }, { status: adminErrorStatus(error) });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await resolveAdminIdentity(request);
    const { id } = await params;
    await deleteLesson(id, identity.role);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete lesson." }, { status: adminErrorStatus(error) });
  }
}
