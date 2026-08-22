import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  updateAccountProfileData: vi.fn(),
  validateUploadContent: vi.fn(),
  upload: vi.fn(),
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
}));

vi.mock("@/lib/file-content-validation", () => ({
  validateUploadContent: mocks.validateUploadContent,
}));

vi.mock("@/lib/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ storage: { from: mocks.from } }),
  getAdminMediaBucket: () => "media",
}));

import { POST } from "@/app/api/auth/profile/photo/route";

describe("profile photo upload privacy", () => {
  it("uses a generated public media name instead of a contact-bearing source filename", async () => {
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "profile-user" },
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.validateUploadContent.mockReturnValue(true);
    mocks.upload.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockImplementation((storageKey: string) => ({
      data: { publicUrl: `https://media.invalid/${storageKey}` },
    }));
    mocks.from.mockReturnValue({ upload: mocks.upload, getPublicUrl: mocks.getPublicUrl });

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
    expect(storageKey).toMatch(/^profiles\/profile\/profile-user\/profile-\d+-[a-f0-9]{8}\.png$/);
    expect(storageKey).not.toContain("050-123-4567");
    expect(storageKey).not.toContain("example.test");
    expect(payload.url).not.toContain("050-123-4567");
    expect(payload.url).not.toContain("example.test");
    expect(mocks.updateAccountProfileData).toHaveBeenCalledWith({
      userId: "profile-user",
      profilePhotoUrl: payload.url,
    });
  });
});
