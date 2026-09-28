import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  updateAccountProfileData: vi.fn(),
  getAccountProfileData: vi.fn(),
  validateUploadContent: vi.fn(),
  sanitizeProfileImage: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  updateAccountProfileData: mocks.updateAccountProfileData,
  getAccountProfileData: mocks.getAccountProfileData,
}));

vi.mock("@/lib/file-content-validation", () => ({
  validateUploadContent: mocks.validateUploadContent,
}));

vi.mock("@/lib/profile-image-sanitization", () => ({
  sanitizeProfileImage: mocks.sanitizeProfileImage,
}));

vi.mock("@/lib/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ storage: { from: mocks.from } }),
  getAdminMediaBucket: () => "media",
}));

import { DELETE, POST } from "@/app/api/auth/profile/photo/route";

describe("profile photo upload privacy", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "profile-user" },
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.validateUploadContent.mockReturnValue(true);
    mocks.sanitizeProfileImage.mockResolvedValue({
      bytes: Buffer.from("safe-webp"),
      mimeType: "image/webp",
      extension: ".webp",
      width: 100,
      height: 100,
    });
    mocks.getAccountProfileData.mockResolvedValue({
      profile: { profilePhotoUrl: "", coverBannerUrl: "" },
      stats: {},
    });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockImplementation((storageKey: string) => ({
      data: { publicUrl: `https://media.invalid/${storageKey}` },
    }));
    mocks.from.mockReturnValue({ upload: mocks.upload, getPublicUrl: mocks.getPublicUrl, remove: mocks.remove });
  });

  it("uses a generated public media name instead of a contact-bearing source filename", async () => {
    const form = new FormData();
    form.set("kind", "profile");
    form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "call-050-123-4567@example.test.png", { type: "image/png" }));
    const request = {
      headers: new Headers(),
      formData: async () => form,
    } as unknown as NextRequest;
    const response = await POST(request);
    const payload = await response.json() as { url?: string };
    const storageKey = String(mocks.upload.mock.calls[0]?.[0] ?? "");

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(storageKey).toMatch(/^profiles\/profile\/profile-user\/profile-\d+-[a-f0-9]{8}\.webp$/);
    expect(storageKey).not.toContain("050-123-4567");
    expect(storageKey).not.toContain("example.test");
    expect(payload.url).not.toContain("050-123-4567");
    expect(payload.url).not.toContain("example.test");
    expect(mocks.updateAccountProfileData).toHaveBeenCalledWith({
      userId: "profile-user",
      profilePhotoUrl: payload.url,
    });
    expect(mocks.upload).toHaveBeenCalledWith(storageKey, Buffer.from("safe-webp"), expect.objectContaining({ contentType: "image/webp" }));
    expect(mocks.checkSharedRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      key: "auth:photo-upload",
      identifier: "profile-user",
    }));
  });

  it("returns a stable Arabic validation error for unsupported formats", async () => {
    const form = new FormData();
    form.set("kind", "cover");
    form.set("file", new File(["svg"], "cover.svg", { type: "image/svg+xml" }));
    const request = {
      headers: new Headers({ "X-Locale": "ar" }),
      formData: async () => form,
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { code?: string; error?: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      code: "UNSUPPORTED_IMAGE_FORMAT",
      error: "صيغة الصورة غير مدعومة. استخدم JPEG أو PNG أو WebP أو GIF.",
    });
  });

  it("does not expose storage-provider errors to Arabic users", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "private storage bucket details" } });
    const form = new FormData();
    form.set("kind", "profile");
    form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "profile.png", { type: "image/png" }));
    const request = {
      headers: new Headers({ "X-Locale": "ar" }),
      formData: async () => form,
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { code?: string; error?: string };

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      code: "PHOTO_UPLOAD_FAILED",
      error: "تعذر رفع الصورة. يرجى المحاولة مرة أخرى.",
    });
    expect(JSON.stringify(payload)).not.toContain("private storage bucket details");
  });

  it("removes the previous owned object after a replacement", async () => {
    mocks.getAccountProfileData.mockResolvedValue({
      profile: {
        profilePhotoUrl: "https://project.supabase.co/storage/v1/object/public/media/profiles/profile/profile-user/old.webp",
        coverBannerUrl: "",
      },
      stats: {},
    });
    const form = new FormData();
    form.set("kind", "profile");
    form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "profile.png", { type: "image/png" }));
    const request = { headers: new Headers(), formData: async () => form } as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(["profiles/profile/profile-user/old.webp"]);
  });

  it("deletes an owned stored photo and rejects malformed delete JSON", async () => {
    mocks.getAccountProfileData.mockResolvedValue({
      profile: {
        profilePhotoUrl: "https://project.supabase.co/storage/v1/object/public/media/profiles/profile/profile-user/old.webp",
        coverBannerUrl: "",
      },
      stats: {},
    });
    const deleteRequest = new NextRequest("http://localhost/api/auth/profile/photo", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      body: JSON.stringify({ kind: "profile" }),
    });
    const response = await DELETE(deleteRequest);
    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(["profiles/profile/profile-user/old.webp"]);
    expect(mocks.updateAccountProfileData).toHaveBeenCalledWith({ userId: "profile-user", profilePhotoUrl: "" });

    const malformed = new NextRequest("http://localhost/api/auth/profile/photo", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      body: "null",
    });
    const malformedResponse = await DELETE(malformed);
    expect(malformedResponse.status).toBe(400);
    expect(await malformedResponse.json()).toEqual({ code: "INVALID_FORM_DATA", error: "بيانات الصورة غير صالحة." });
  });
});
