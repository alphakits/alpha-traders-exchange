import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { getAccountProfileData, updateAccountProfileData } from "@/lib/alpha-exchange-store";
import { validateUploadContent } from "@/lib/file-content-validation";
import { sanitizeProfileImage } from "@/lib/profile-image-sanitization";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient, getAdminMediaBucket } from "@/lib/supabase-admin";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_PHOTO_BYTES + 256 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

type MultipartPhoto = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  size: number;
  type: string;
};

function isMultipartPhoto(value: unknown): value is MultipartPhoto {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as MultipartPhoto).arrayBuffer === "function"
      && typeof (value as MultipartPhoto).size === "number"
      && typeof (value as MultipartPhoto).type === "string",
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
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
      return mobileError("PROFILE_INVALID", requestId, locale, 413);
    }
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:profile:photo",
      identifier: auth.user.id,
      maxRequests: 10,
      windowMs: 60 * 60 * 1_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, { retryAfterSeconds: rate.retryAfterSeconds });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return mobileError("PROFILE_INVALID", requestId, locale, 400);
    }
    const kind = String(form.get("kind") ?? "profile");
    const file = form.get("file");
    if ((kind !== "profile" && kind !== "cover") || !isMultipartPhoto(file)) {
      return mobileError("PROFILE_INVALID", requestId, locale, 400);
    }
    const mimeType = file.type.trim().toLowerCase();
    if (!ALLOWED_MIME.has(mimeType) || file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
      return mobileError("PROFILE_INVALID", requestId, locale, 400);
    }
    const normalizedMimeType = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    const bytes = Buffer.from(await file.arrayBuffer());
    if (
      bytes.length !== file.size
      || !validateUploadContent(bytes, normalizedMimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif")
    ) {
      return mobileError("PROFILE_INVALID", requestId, locale, 400);
    }

    let sanitized: Awaited<ReturnType<typeof sanitizeProfileImage>>;
    try {
      sanitized = await sanitizeProfileImage(bytes);
    } catch {
      return mobileError("PROFILE_INVALID", requestId, locale, 400);
    }
    const storageKey = `profiles/${kind}/${auth.user.id}/${kind}-${Date.now()}-${randomUUID().slice(0, 8)}${sanitized.extension}`;
    const client = createSupabaseAdminClient();
    const bucket = getAdminMediaBucket();
    const storage = client.storage.from(bucket);
    const current = await getAccountProfileData(auth.user.id);
    const previousUrl = kind === "profile" ? current.profile.profilePhotoUrl : current.profile.coverBannerUrl;
    const previousKey = ownedProfileStorageKey(previousUrl, bucket, auth.user.id, kind);
    const { error: uploadError } = await storage.upload(storageKey, sanitized.bytes, {
      contentType: sanitized.mimeType,
      upsert: false,
    });
    if (uploadError) return mobileError("PROFILE_UPDATE_FAILED", requestId, locale, 500);
    const { data } = storage.getPublicUrl(storageKey);
    await updateAccountProfileData({
      userId: auth.user.id,
      ...(kind === "profile" ? { profilePhotoUrl: data.publicUrl } : { coverBannerUrl: data.publicUrl }),
    });
    if (previousKey && previousKey !== storageKey) {
      const { error: cleanupError } = await storage.remove([previousKey]);
      if (cleanupError) console.warn("[mobile-profile-photo] cleanup failed", { userId: auth.user.id, kind });
    }
    return mobileJson({ kind, url: data.publicUrl }, requestId);
  } catch {
    return mobileError("PROFILE_UPDATE_FAILED", requestId, locale, 500);
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:profile:photo-remove",
      identifier: auth.user.id,
      maxRequests: 20,
      windowMs: 60 * 60 * 1_000,
    });
    if (!rate.allowed) return mobileError("RATE_LIMITED", requestId, locale, 429, { retryAfterSeconds: rate.retryAfterSeconds });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return mobileError("PROFILE_INVALID", requestId, locale, 400);
    }
    const kind = body && typeof body === "object" && !Array.isArray(body) ? String((body as { kind?: unknown }).kind ?? "profile") : "";
    if (kind !== "profile" && kind !== "cover") return mobileError("PROFILE_INVALID", requestId, locale, 400);
    const current = await getAccountProfileData(auth.user.id);
    const previousUrl = kind === "profile" ? current.profile.profilePhotoUrl : current.profile.coverBannerUrl;
    const bucket = getAdminMediaBucket();
    const previousKey = ownedProfileStorageKey(previousUrl, bucket, auth.user.id, kind);
    if (previousKey) {
      const { error } = await createSupabaseAdminClient().storage.from(bucket).remove([previousKey]);
      if (error) return mobileError("PROFILE_UPDATE_FAILED", requestId, locale, 500);
    }
    await updateAccountProfileData({
      userId: auth.user.id,
      ...(kind === "profile" ? { profilePhotoUrl: "" } : { coverBannerUrl: "" }),
    });
    return mobileJson({ kind, url: "" }, requestId);
  } catch {
    return mobileError("PROFILE_UPDATE_FAILED", requestId, locale, 500);
  }
}
