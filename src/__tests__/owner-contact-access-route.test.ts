import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), dashboard: vi.fn(), applications: vi.fn(), approvalEmail: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getCurrentSessionUserForAuthorization: mocks.session,
  getCurrentSessionToken: vi.fn().mockResolvedValue(null),
  clearUserSession: vi.fn(),
  AUTH_COOKIE_NAME: "session", AUTH_PHONE_VERIFIED_COOKIE_NAME: "phone", AUTH_VERIFIED_COOKIE_NAME: "verified",
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getAdminPrepDashboardData: mocks.dashboard,
  getAllSellerApplicationsForAdmin: mocks.applications,
  getPendingSellerApplicationsForAdmin: mocks.applications,
  sendSellerApprovalEmailByAdmin: mocks.approvalEmail,
}));
import { GET as dashboard } from "@/app/api/alpha-exchange/admin-prep/route";
import { GET as applications } from "@/app/api/alpha-exchange/admin/seller-applications/route";
import { POST as approvalEmail } from "@/app/api/alpha-exchange/admin/seller-applications/[applicationId]/approval-email/route";
import { NextRequest } from "next/server";

beforeEach(() => { vi.clearAllMocks(); });

describe("owner-only personal records", () => {
  it.each(["buyer", "approved_seller", "admin", "guest"])("blocks %s before reading personal records", async role => {
    mocks.session.mockResolvedValue({ id: "other", role, roles: [role], sellerStatus: "buyer", emailVerified: true });
    expect((await dashboard()).status).toBe(403);
    expect((await applications()).status).toBe(403);
    expect((await approvalEmail(new NextRequest("https://example.test/api/approval-email", { method: "POST" }), { params: Promise.resolve({ applicationId: "application-1" }) })).status).toBe(403);
    expect(mocks.dashboard).not.toHaveBeenCalled();
    expect(mocks.applications).not.toHaveBeenCalled();
    expect(mocks.approvalEmail).not.toHaveBeenCalled();
  });

  it("uses the authenticated owner ID and prevents shared caching", async () => {
    mocks.session.mockResolvedValue({ id: "owner-real", role: "owner", roles: ["owner", "admin"], emailVerified: true });
    mocks.dashboard.mockResolvedValue({ users: [{ fullName: "Private Member", whatsappNumber: "+12025550123" }] });
    const response = await dashboard();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.dashboard).toHaveBeenCalledWith("owner-real");
    expect((await response.json()).users[0]).toMatchObject({ fullName: "Private Member", whatsappNumber: "+12025550123" });
  });

  it("rejects disabled owners", async () => {
    mocks.session.mockResolvedValue({ id: "disabled-owner", role: "owner", roles: ["owner", "admin"], disabled: true });
    expect((await dashboard()).status).toBe(403);
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
});
