import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { adminErrorStatus, resolveAdminIdentity } from "@/lib/admin-auth";
import { addMediaItem, inferMediaType, readMediaLibrary, removeMediaItem, saveUploadedFile, validateUpload } from "@/lib/admin-store";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
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
    const identity = await resolveAdminIdentity(request);
    const rate = await checkSharedRateLimit({ headers: request.headers, key: "admin:media-upload", identifier: identity.actor, maxRequests: 20, windowMs: 60 * 60_000 });
    if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = validateUpload(file.name, file.size, bytes);
    const upload = await saveUploadedFile(bytes, file.name, mimeType);
    const provider = (((formData.get("provider") as string) || "supabase") === "local" ? "supabase" : ((formData.get("provider") as string) || "supabase")) as MediaProvider;
    const lessonId = (formData.get("lessonId") as string) || undefined;
    const media = await addMediaItem({
      type: inferMediaType(file.name),
      provider,
      name: path.basename(file.name),
      url: upload.publicUrl,
      storageBucket: upload.storageBucket,
      storageKey: upload.storageKey,
      mimeType,
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
