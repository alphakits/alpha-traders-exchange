import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { resolveAdminIdentity } from "@/lib/admin-auth";
import { addMediaItem, appendVersion, createLesson, inferMediaType, saveUploadedFile, validateUpload } from "@/lib/admin-store";
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
    const identity = resolveAdminIdentity(request);
    const formData = await request.formData();
    const files = formData.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length) {
      return NextResponse.json({ error: "No files provided for import." }, { status: 400 });
    }

    const createdLessons: Lesson[] = [];
    for (const file of files) {
      validateUpload(file.name, file.size);
      const mediaUrl = await saveUploadedFile(file, file.name);
      const mediaType = inferMediaType(file.name);
      const base = guessLessonFromFileName(file.name);
      const lesson = await createLesson(
        {
          ...base,
          assets: {
            videoProvider: mediaType === "video" ? "self-hosted" : "self-hosted",
            videoId: "",
            videoUrl: mediaType === "video" ? mediaUrl : "",
            videoChapters: [],
            pdfProvider: "google-drive",
            pdfFileId: "",
            pdfUrl: mediaType === "pdf" ? mediaUrl : "",
            presentationUrl: "",
            notes: "",
            notesAr: "",
            resources: [],
          },
          thumbnail: mediaType === "image" ? mediaUrl : "",
          status: "draft",
        },
        identity.role,
      );

      await addMediaItem({
        type: mediaType,
        provider: "local",
        name: file.name,
        url: mediaUrl,
        mimeType: file.type,
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to import lessons." }, { status: 400 });
  }
}
