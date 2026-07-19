import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { adminErrorStatus, resolveAdminIdentity } from "@/lib/admin-auth";
import { addMediaItem, inferMediaType, readMediaLibrary, removeMediaItem, saveUploadedFile, validateUpload } from "@/lib/admin-store";
import type { MediaProvider } from "@/types/admin";

export async function GET(request: NextRequest) {
  try {
    await resolveAdminIdentity(request);
    const items = await readMediaLibrary();
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load media library." }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await resolveAdminIdentity(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    validateUpload(file.name, file.size);
    const publicUrl = await saveUploadedFile(file, file.name);
    const provider = ((formData.get("provider") as string) || "local") as MediaProvider;
    const lessonId = (formData.get("lessonId") as string) || undefined;
    const media = await addMediaItem({
      type: inferMediaType(file.name),
      provider,
      name: path.basename(file.name),
      url: publicUrl,
      mimeType: file.type,
      size: file.size,
      lessonId,
    });
    return NextResponse.json({ media }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to upload media." }, { status: adminErrorStatus(error) });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await resolveAdminIdentity(request);
    const url = new URL(request.url);
    const mediaId = url.searchParams.get("id");
    if (!mediaId) {
      return NextResponse.json({ error: "Media ID is required." }, { status: 400 });
    }
    await removeMediaItem(mediaId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to remove media." }, { status: adminErrorStatus(error) });
  }
}
