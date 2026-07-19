import { NextRequest, NextResponse } from "next/server";
import { adminErrorStatus, resolveAdminIdentity } from "@/lib/admin-auth";
import { deleteLesson, setLessonStatus, updateLesson } from "@/lib/admin-store";
import type { LessonStatus } from "@/types/academy";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await resolveAdminIdentity(request);
    const { id } = await params;
    const body = (await request.json()) as { lesson: Record<string, unknown> };
    const lessonPatch = (body.lesson || {}) as Record<string, unknown>;
    const requestedStatus = body.lesson?.status as LessonStatus | undefined;
    const lesson =
      requestedStatus === "draft" || requestedStatus === "published"
        ? await setLessonStatus(id, requestedStatus, identity.role)
        : await updateLesson(Object.assign({ id }, lessonPatch), identity.role);
    return NextResponse.json({ lesson });
  } catch (error) {
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
