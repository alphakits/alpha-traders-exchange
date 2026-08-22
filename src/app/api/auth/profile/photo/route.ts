import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireApiUser } from "@/lib/api-auth";
import { updateAccountProfileData } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient, getAdminMediaBucket } from "@/lib/supabase-admin";
import { validateUploadContent } from "@/lib/file-content-validation";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const rate = await checkSharedRateLimit({ headers: request.headers, key: `auth:photo-upload:${user.id}`, maxRequests: 10, windowMs: 60 * 60 * 1000 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many photo uploads. Please wait before trying again." }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const kind = String(formData.get("kind") ?? "profile"); // "profile" | "cover"
  if (kind !== "profile" && kind !== "cover") {
    return NextResponse.json({ error: "kind must be 'profile' or 'cover'." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: "Unsupported image format. Use JPEG, PNG, WebP, or GIF." }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Image exceeds maximum allowed size (5 MB)." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const normalizedMimeType = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (!validateUploadContent(bytes, normalizedMimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif")) {
    return NextResponse.json({ error: "Image content does not match its declared format." }, { status: 400 });
  }
  const ext = file.type === "image/gif" ? ".gif" : file.type === "image/webp" ? ".webp" : file.type === "image/png" ? ".png" : ".jpg";
  // A public media URL must never carry a user-provided filename: filenames
  // are otherwise an easy way to publish direct contact details.
  const safeName = `${kind}-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  const storageKey = `profiles/${kind}/${user.id}/${safeName}`;

  const client = createSupabaseAdminClient();
  const bucket = getAdminMediaBucket();

  const { error: uploadError } = await client.storage.from(bucket).upload(storageKey, bytes, {
    contentType: normalizedMimeType,
    upsert: false,
  });
  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
  }

  const { data: urlData } = client.storage.from(bucket).getPublicUrl(storageKey);
  const publicUrl = urlData.publicUrl;

  // Persist the URL to the user profile immediately
  await updateAccountProfileData({
    userId: user.id,
    ...(kind === "profile" ? { profilePhotoUrl: publicUrl } : { coverBannerUrl: publicUrl }),
  });

  return NextResponse.json({ url: publicUrl, kind });
}

export async function DELETE(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const body = (await request.json()) as { kind?: string };
  const kind = body.kind === "cover" ? "cover" : "profile";

  await updateAccountProfileData({
    userId: user.id,
    ...(kind === "profile" ? { profilePhotoUrl: "" } : { coverBannerUrl: "" }),
  });

  return NextResponse.json({ ok: true, kind });
}
