import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { adminErrorStatus, resolveAdminIdentity } from "@/lib/admin-auth";
import { addMediaItem, appendVersion, createLesson, inferMediaType, saveUploadedFile, validateUpload } from "@/lib/admin-store";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import type { Lesson } from "@/types/academy";

function guessLessonFromFileName(fileName: string): Partial<Lesson> {
  const stem = path.basename(fileName, path.extname(fileName));
  const cleaned = stem.replace(/[_-]+/g, " ").trim();
  return {
    title: cleaned,
    titleAr: cleaned,
    slug: cleaned,
    description: cleaned,
    descriptionAr: cleaned,
    summary: cleaned,
    summaryAr: cleaned,
    module: "Imported Module",
    moduleAr: "وحدة مستوردة",
    category: "beginner",
    courseId: "c1",
    durationMinutes: 20,
    xpReward: 100,
    difficulty: "medium",
  };
}

export async function POST(request: NextRequest) {
  try {
    const identity = await resolveAdminIdentity(request);
    const rate = await checkSharedRateLimit({ headers: request.headers, key: "admin:lesson-import", identifier: identity.actor, maxRequests: 5, windowMs: 60 * 60_000 });
    if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
    const formData = await request.formData();
    const files = formData.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length) {
      return NextResponse.json({ error: "No files provided for import." }, { status: 400 });
    }

    const createdLessons: Lesson[] = [];
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const mimeType = validateUpload(file.name, file.size, bytes);
      const upload = await saveUploadedFile(bytes, file.name, mimeType);
      const mediaType = inferMediaType(file.name);
      const base = guessLessonFromFileName(file.name);
      const lesson = await createLesson(
        {
          ...base,
          assets: {
            videoProvider: mediaType === "video" ? "supabase" : "self-hosted",
            videoId: "",
            videoUrl: mediaType === "video" ? upload.publicUrl : "",
            videoChapters: [],
            pdfProvider: mediaType === "pdf" ? "supabase" : "google-drive",
            pdfFileId: "",
            pdfUrl: mediaType === "pdf" ? upload.publicUrl : "",
            presentationUrl: "",
            notes: "",
            notesAr: "",
            resources: [],
          },
          thumbnail: mediaType === "image" ? upload.publicUrl : "",
          status: "draft",
        },
        identity.role,
      );

      await addMediaItem({
        type: mediaType,
        provider: "supabase",
        name: file.name,
        url: upload.publicUrl,
        storageBucket: upload.storageBucket,
        storageKey: upload.storageKey,
        mimeType,
        size: file.size,
        lessonId: lesson.id,
      });
      createdLessons.push(lesson);
    }

    await appendVersion({
      lessonId: "bulk-import",
      action: "imported",
      role: identity.role,
      snapshot: null,
    });

    return NextResponse.json({
      created: createdLessons.length,
      lessons: createdLessons,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to import lessons." }, { status: adminErrorStatus(error) });
  }
}
