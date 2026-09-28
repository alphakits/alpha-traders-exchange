// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  getAccountProfileData: vi.fn(),
  getPublicUrl: vi.fn(),
  remove: vi.fn(),
  requireMobileApiUser: vi.fn(),
  sanitizeProfileImage: vi.fn(),
  updateAccountProfileData: vi.fn(),
  upload: vi.fn(),
  validateUploadContent: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getAccountProfileData: mocks.getAccountProfileData,
  updateAccountProfileData: mocks.updateAccountProfileData,
}));
vi.mock("@/lib/file-content-validation", () => ({ validateUploadContent: mocks.validateUploadContent }));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireMobileApiUser }));
vi.mock("@/lib/profile-image-sanitization", () => ({ sanitizeProfileImage: mocks.sanitizeProfileImage }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: () => ({
        getPublicUrl: mocks.getPublicUrl,
        remove: mocks.remove,
        upload: mocks.upload,
      }),
    },
  }),
  getAdminMediaBucket: () => "media",
}));

import { DELETE, POST } from "@/app/api/mobile/v1/profile/photo/route";

const mobileHeaders = {
  "accept-language": "en",
  authorization: "Bearer mobile-access-token",
  "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
  "x-app-version": "1.0.0",
  "x-platform": "ios",
  "x-request-id": "profile-photo-request-1",
};

function uploadRequest(kind: "profile" | "cover", type = "image/png") {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    "private-contact-050-123-4567@example.test.png",
    { type },
  ));
  return {
    headers: new Headers(mobileHeaders),
    formData: async () => form,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.requireMobileApiUser.mockResolvedValue({
    accessToken: "mobile-access-token",
    unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    user: { id: "profile-user", role: "buyer" },
  });
  mocks.getAccountProfileData.mockResolvedValue({
    profile: { coverBannerUrl: "", profilePhotoUrl: "" },
    stats: {},
  });
  mocks.validateUploadContent.mockReturnValue(true);
  mocks.sanitizeProfileImage.mockResolvedValue({
    bytes: Buffer.from("safe-webp"),
    extension: ".webp",
    height: 100,
    mimeType: "image/webp",
    width: 100,
  });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockImplementation((key: string) => ({
    data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/media/${key}` },
  }));
});

describe("mobile v1 profile photo route", () => {
  it("uploads a sanitized cover under an owner-scoped generated key", async () => {
    const response = await POST(uploadRequest("cover"));
    const payload = await response.json();
    const storageKey = String(mocks.upload.mock.calls[0]?.[0] ?? "");

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ kind: "cover", requestId: "profile-photo-request-1" });
    expect(storageKey).toMatch(/^profiles\/cover\/profile-user\/cover-\d+-[a-f0-9]{8}\.webp$/);
    expect(storageKey).not.toContain("050-123-4567");
    expect(storageKey).not.toContain("example.test");
    expect(mocks.upload).toHaveBeenCalledWith(
      storageKey,
      Buffer.from("safe-webp"),
      expect.objectContaining({ contentType: "image/webp", upsert: false }),
    );
    expect(mocks.updateAccountProfileData).toHaveBeenCalledWith({
      coverBannerUrl: payload.url,
      userId: "profile-user",
    });
  });

  it("rejects unsupported media before validation, sanitization, or storage", async () => {
    const response = await POST(uploadRequest("profile", "image/svg+xml"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROFILE_INVALID" },
      requestId: "profile-photo-request-1",
    });
    expect(mocks.validateUploadContent).not.toHaveBeenCalled();
    expect(mocks.sanitizeProfileImage).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("removes only an owned profile object and clears the persisted field", async () => {
    mocks.getAccountProfileData.mockResolvedValue({
      profile: {
        coverBannerUrl: "",
        profilePhotoUrl: "https://project.supabase.co/storage/v1/object/public/media/profiles/profile/profile-user/old.webp",
      },
      stats: {},
    });
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/profile/photo", {
      body: JSON.stringify({ kind: "profile" }),
      headers: { ...mobileHeaders, "content-type": "application/json" },
      method: "DELETE",
    });

    const response = await DELETE(request);

    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(["profiles/profile/profile-user/old.webp"]);
    expect(mocks.updateAccountProfileData).toHaveBeenCalledWith({ profilePhotoUrl: "", userId: "profile-user" });
  });

  it("does not delete a foreign storage URL while clearing the profile reference", async () => {
    mocks.getAccountProfileData.mockResolvedValue({
      profile: {
        coverBannerUrl: "",
        profilePhotoUrl: "https://project.supabase.co/storage/v1/object/public/media/profiles/profile/another-user/foreign.webp",
      },
      stats: {},
    });
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/profile/photo", {
      body: JSON.stringify({ kind: "profile" }),
      headers: { ...mobileHeaders, "content-type": "application/json" },
      method: "DELETE",
    });

    const response = await DELETE(request);

    expect(response.status).toBe(200);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.updateAccountProfileData).toHaveBeenCalledWith({ profilePhotoUrl: "", userId: "profile-user" });
  });
});
