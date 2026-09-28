import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireApiUser } from "@/lib/api-auth";
import { getAccountProfileData, updateAccountProfileData } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient, getAdminMediaBucket } from "@/lib/supabase-admin";
import { validateUploadContent } from "@/lib/file-content-validation";
import { sanitizeProfileImage } from "@/lib/profile-image-sanitization";
import { resolveSupportedRequestLocale } from "@/lib/request-locale";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);
const PHOTO_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

type ProfilePhotoErrorCode =
  | "PHOTO_RATE_LIMITED"
  | "INVALID_FORM_DATA"
  | "INVALID_PHOTO_KIND"
  | "PHOTO_REQUIRED"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "PHOTO_TOO_LARGE"
  | "PHOTO_CONTENT_MISMATCH"
  | "PHOTO_UPLOAD_FAILED"
  | "PHOTO_REMOVE_FAILED";

const PHOTO_ERROR_COPY: Record<ProfilePhotoErrorCode, { ar: string; en: string }> = {
  PHOTO_RATE_LIMITED: {
    ar: "تم تجاوز عدد محاولات رفع الصور. يرجى الانتظار قبل المحاولة مرة أخرى.",
    en: "Too many photo uploads. Please wait before trying again.",
  },
  INVALID_FORM_DATA: {
    ar: "بيانات الصورة غير صالحة.",
    en: "Invalid form data.",
  },
  INVALID_PHOTO_KIND: {
    ar: "نوع الصورة غير صالح.",
    en: "Photo kind must be profile or cover.",
  },
  PHOTO_REQUIRED: {
    ar: "يرجى اختيار صورة للرفع.",
    en: "Please choose an image to upload.",
  },
  UNSUPPORTED_IMAGE_FORMAT: {
    ar: "صيغة الصورة غير مدعومة. استخدم JPEG أو PNG أو WebP أو GIF.",
    en: "Unsupported image format. Use JPEG, PNG, WebP, or GIF.",
  },
  PHOTO_TOO_LARGE: {
    ar: "حجم الصورة يتجاوز الحد الأقصى المسموح وهو 5 ميغابايت.",
    en: "Image exceeds the maximum allowed size of 5 MB.",
  },
  PHOTO_CONTENT_MISMATCH: {
    ar: "محتوى الصورة لا يطابق صيغتها المعلنة.",
    en: "Image content does not match its declared format.",
  },
  PHOTO_UPLOAD_FAILED: {
    ar: "تعذر رفع الصورة. يرجى المحاولة مرة أخرى.",
    en: "Photo upload failed. Please try again.",
  },
  PHOTO_REMOVE_FAILED: {
    ar: "تعذر حذف الصورة. يرجى المحاولة مرة أخرى.",
    en: "Failed to remove the photo. Please try again.",
  },
};

function resolveLocale(request: NextRequest): "ar" | "en" {
  return resolveSupportedRequestLocale(request.headers, "en");
}

function photoErrorResponse(request: NextRequest, code: ProfilePhotoErrorCode, status: number) {
  const locale = resolveLocale(request);
  return NextResponse.json(
    { code, error: PHOTO_ERROR_COPY[code][locale] },
    { status, headers: PHOTO_RESPONSE_HEADERS },
  );
}

function ownedProfileStorageKey(
  publicUrl: string | null | undefined,
  bucket: string,
  userId: string,
  kind: "profile" | "cover",
) {
  if (!publicUrl) return null;
  try {
    const pathname = new URL(publicUrl).pathname;
    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/public/${encodeURIComponent(bucket)}/`,
    ];
    const marker = markers.find((candidate) => pathname.includes(candidate));
    if (!marker) return null;
    const storageKey = decodeURIComponent(pathname.slice(pathname.indexOf(marker) + marker.length));
    const expectedPrefix = `profiles/${kind}/${userId}/`;
    return storageKey.startsWith(expectedPrefix) && !storageKey.includes("..") ? storageKey : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "auth:photo-upload",
    identifier: user.id,
    maxRequests: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!rate.allowed) {
    return photoErrorResponse(request, "PHOTO_RATE_LIMITED", 429);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return photoErrorResponse(request, "INVALID_FORM_DATA", 400);
  }

  const kind = String(formData.get("kind") ?? "profile"); // "profile" | "cover"
  if (kind !== "profile" && kind !== "cover") {
    return photoErrorResponse(request, "INVALID_PHOTO_KIND", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return photoErrorResponse(request, "PHOTO_REQUIRED", 400);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return photoErrorResponse(request, "UNSUPPORTED_IMAGE_FORMAT", 400);
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return photoErrorResponse(request, "PHOTO_TOO_LARGE", 400);
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const normalizedMimeType = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (!validateUploadContent(bytes, normalizedMimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif")) {
    return photoErrorResponse(request, "PHOTO_CONTENT_MISMATCH", 400);
  }
  let sanitizedImage: Awaited<ReturnType<typeof sanitizeProfileImage>>;
  try {
    sanitizedImage = await sanitizeProfileImage(bytes);
  } catch {
    return photoErrorResponse(request, "PHOTO_CONTENT_MISMATCH", 400);
  }
  // A public media URL must never carry a user-provided filename: filenames
  // are otherwise an easy way to publish direct contact details.
  const safeName = `${kind}-${Date.now()}-${randomUUID().slice(0, 8)}${sanitizedImage.extension}`;
  const storageKey = `profiles/${kind}/${user.id}/${safeName}`;

  try {
    const client = createSupabaseAdminClient();
    const bucket = getAdminMediaBucket();
    const storage = client.storage.from(bucket);
    const currentProfile = await getAccountProfileData(user.id);
    const previousPublicUrl = kind === "profile"
      ? currentProfile.profile.profilePhotoUrl
      : currentProfile.profile.coverBannerUrl;
    const previousStorageKey = ownedProfileStorageKey(previousPublicUrl, bucket, user.id, kind);

    const { error: uploadError } = await storage.upload(storageKey, sanitizedImage.bytes, {
      contentType: sanitizedImage.mimeType,
      upsert: false,
    });
    if (uploadError) return photoErrorResponse(request, "PHOTO_UPLOAD_FAILED", 500);

    const { data: urlData } = storage.getPublicUrl(storageKey);
    const publicUrl = urlData.publicUrl;

    // Persist the URL to the user profile immediately.
    await updateAccountProfileData({
      userId: user.id,
      ...(kind === "profile" ? { profilePhotoUrl: publicUrl } : { coverBannerUrl: publicUrl }),
    });

    if (previousStorageKey && previousStorageKey !== storageKey) {
      const { error: cleanupError } = await storage.remove([previousStorageKey]);
      if (cleanupError) {
        console.warn("[profile-photo] previous object cleanup failed", { userId: user.id, kind });
      }
    }

    return NextResponse.json({ url: publicUrl, kind }, { headers: PHOTO_RESPONSE_HEADERS });
  } catch {
    // Never expose storage-provider or database details to the browser.
    return photoErrorResponse(request, "PHOTO_UPLOAD_FAILED", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  let body: { kind?: string };
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return photoErrorResponse(request, "INVALID_FORM_DATA", 400);
    }
    body = parsed as { kind?: string };
  } catch {
    return photoErrorResponse(request, "INVALID_FORM_DATA", 400);
  }
  if (body.kind !== undefined && body.kind !== "profile" && body.kind !== "cover") {
    return photoErrorResponse(request, "INVALID_PHOTO_KIND", 400);
  }
  const kind = body.kind === "cover" ? "cover" : "profile";

  try {
    const currentProfile = await getAccountProfileData(user.id);
    const previousPublicUrl = kind === "profile"
      ? currentProfile.profile.profilePhotoUrl
      : currentProfile.profile.coverBannerUrl;
    const bucket = getAdminMediaBucket();
    const previousStorageKey = ownedProfileStorageKey(previousPublicUrl, bucket, user.id, kind);
    if (previousStorageKey) {
      const client = createSupabaseAdminClient();
      const { error: removeError } = await client.storage.from(bucket).remove([previousStorageKey]);
      if (removeError) return photoErrorResponse(request, "PHOTO_REMOVE_FAILED", 500);
    }
    await updateAccountProfileData({
      userId: user.id,
      ...(kind === "profile" ? { profilePhotoUrl: "" } : { coverBannerUrl: "" }),
    });
  } catch {
    return photoErrorResponse(request, "PHOTO_REMOVE_FAILED", 500);
  }

  return NextResponse.json({ ok: true, kind }, { headers: PHOTO_RESPONSE_HEADERS });
}
