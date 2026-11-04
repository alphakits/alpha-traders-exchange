// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  createAdminAnnouncementRun: vi.fn(),
  getAdminAnnouncementOverview: vi.fn(),
  sendAdminAnnouncementTest: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  createAdminAnnouncementRun: mocks.createAdminAnnouncementRun,
  getAdminAnnouncementOverview: mocks.getAdminAnnouncementOverview,
  sendAdminAnnouncementTest: mocks.sendAdminAnnouncementTest,
  isAdminAnnouncementAudience: (audience: string) => ["all_verified_users", "buyers", "approved_sellers", "administrators"].includes(audience),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: vi.fn(async () => ({ allowed: true })),
  createRateLimitResponse: vi.fn(),
}));

import { GET, POST } from "@/app/api/alpha-exchange/admin/announcements/route";
import { POST as POST_TEST } from "@/app/api/alpha-exchange/admin/announcements/test/route";

const attachment = {
  filename: "Seller Guide & Rules.pdf",
  contentType: "application/pdf",
  contentBase64: Buffer.from("%PDF-1.7\nfixture\n%%EOF\n").toString("base64"),
  sizeBytes: 28,
  sha256: "f".repeat(64),
};
const run = {
  id: "announcement-pdf-1",
  audience: "approved_sellers",
  subject: "دليل البائع | Seller guide",
  title: "دليل البائع | Seller guide",
  attachment,
  recipients: [{ email: "private-seller@example.com" }],
  recipientCount: 2,
  successCount: 0,
  failureCount: 0,
  retryCount: 0,
  status: "queued",
  startedAt: "2026-11-04T12:00:00.000Z",
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: "2026-11-04T12:00:00.000Z",
};

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/admin/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestKey: "guide-1", audience: "approved_sellers", expectedRecipientCount: 2, attachment, ...body }),
  });
}

describe("owner PDF announcement routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({ user: { id: "owner-1", role: "owner" }, unauthorized: null });
    mocks.createAdminAnnouncementRun.mockResolvedValue(run);
    mocks.getAdminAnnouncementOverview.mockResolvedValue({ recipientCount: 2, runs: [run] });
    mocks.sendAdminAnnouncementTest.mockResolvedValue({ ok: true });
  });

  it("requires authentication before reading or sending attachment data", async () => {
    mocks.requireApiAdmin.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await POST(request())).status).toBe(401);
    expect((await POST_TEST(request())).status).toBe(401);
    expect(mocks.createAdminAnnouncementRun).not.toHaveBeenCalled();
    expect(mocks.sendAdminAnnouncementTest).not.toHaveBeenCalled();
  });

  it("rejects nonowner attachment creation and test delivery", async () => {
    mocks.requireApiAdmin.mockResolvedValue({ user: { id: "admin-1", role: "admin" }, unauthorized: null });
    expect((await POST(request())).status).toBe(403);
    expect((await POST_TEST(request())).status).toBe(403);
    expect(mocks.createAdminAnnouncementRun).not.toHaveBeenCalled();
    expect(mocks.sendAdminAnnouncementTest).not.toHaveBeenCalled();
  });

  it("rejects an owner PDF announcement addressed to another audience", async () => {
    expect((await POST(request({ audience: "all_verified_users" }))).status).toBe(403);
    expect(mocks.createAdminAnnouncementRun).not.toHaveBeenCalled();
  });

  it.each([
    { route: "create", handler: POST, contentLength: undefined },
    { route: "create", handler: POST, contentLength: "1" },
    { route: "test", handler: POST_TEST, contentLength: undefined },
    { route: "test", handler: POST_TEST, contentLength: "1" },
  ])("rejects and cancels an oversized $route stream with Content-Length=$contentLength", async ({ handler, contentLength }) => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024).fill(65)); },
      cancel,
    });
    const headers = new Headers({ "Content-Type": "application/json" });
    if (contentLength !== undefined) headers.set("Content-Length", contentLength);
    const oversizedRequest = new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/admin/announcements", {
      method: "POST", headers, body: stream, duplex: "half",
    } as RequestInit);

    const response = await handler(oversizedRequest);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Announcement upload is too large. PDFs must be no larger than 2 MB." });
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.createAdminAnnouncementRun).not.toHaveBeenCalled();
    expect(mocks.sendAdminAnnouncementTest).not.toHaveBeenCalled();
  });

  it("passes the owner upload to the durable store without exposing file bytes in the response", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.createAdminAnnouncementRun).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: "owner-1", audience: "approved_sellers", expectedRecipientCount: 2, attachment,
    }));
    const payload = await response.json();
    expect(payload.run.attachment).toEqual({ filename: attachment.filename, sizeBytes: attachment.sizeBytes, sha256: attachment.sha256 });
    expect(payload.run).not.toHaveProperty("recipients");
    expect(JSON.stringify(payload)).not.toContain(attachment.contentBase64);
  });

  it("uses the attachment recipient count and redacts bytes in the overview", async () => {
    const response = await GET(new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/admin/announcements?audience=approved_sellers&attachment=pdf"));
    expect(response.status).toBe(200);
    expect(mocks.getAdminAnnouncementOverview).toHaveBeenCalledWith("approved_sellers", { attachment: true });
    const payload = await response.json();
    expect(payload.recipientCount).toBe(2);
    expect(payload.runs[0].attachment.filename).toBe(attachment.filename);
    expect(JSON.stringify(payload)).not.toContain(attachment.contentBase64);
    expect(payload.runs[0]).not.toHaveProperty("recipients");
  });

  it.each([
    { role: "admin", audience: "approved_sellers" },
    { role: "owner", audience: "buyers" },
  ])("rejects attachment previews outside the permitted owner audience ($role/$audience)", async ({ role, audience }) => {
    mocks.requireApiAdmin.mockResolvedValue({ user: { id: "actor-1", role }, unauthorized: null });
    const response = await GET(new NextRequest(`https://www.alphatraders.co.il/api/alpha-exchange/admin/announcements?audience=${audience}&attachment=pdf`));
    expect(response.status).toBe(403);
    expect(mocks.getAdminAnnouncementOverview).not.toHaveBeenCalled();
  });

  it("forwards an owner test attachment for recipient eligibility checks in the store", async () => {
    const response = await POST_TEST(request({ recipientEmail: "seller@example.com" }));
    expect(response.status).toBe(200);
    expect(mocks.sendAdminAnnouncementTest).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: "owner-1", recipientEmail: "seller@example.com", attachment,
    }));
  });

  it("keeps regular text-only announcements available to administrators", async () => {
    mocks.requireApiAdmin.mockResolvedValue({ user: { id: "admin-1", role: "admin" }, unauthorized: null });
    expect((await POST(request({ attachment: undefined, audience: "all_verified_users" }))).status).toBe(201);
    expect(mocks.createAdminAnnouncementRun).toHaveBeenCalledWith(expect.objectContaining({ adminUserId: "admin-1", attachment: undefined }));
  });
});
