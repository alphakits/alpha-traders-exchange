// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), workspace: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiSellerWorkspaceActor: mocks.actor }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getSellerListingWorkspaceData: mocks.workspace,
  getCommissionQaModeStatus: () => false,
  getCommissionQaResetStatus: () => false,
}));
import { GET } from "@/app/api/alpha-exchange/my-listings/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ user: { id: "seller-session", role: "approved_seller" }, unauthorized: null });
  mocks.workspace.mockResolvedValue({ listings: [], summary: {}, commissionStatus: { payableRecords: [] } });
});

describe("private seller workspace access", () => {
  it("ignores forged seller identity parameters and scopes commission deep links to the session seller", async () => {
    const response = await GET(new NextRequest("https://example.test/api/alpha-exchange/my-listings?sellerId=other-seller&userId=other-seller&commissionId=other-commission&status=all"));
    expect(response.status).toBe(200);
    expect(mocks.workspace).toHaveBeenCalledExactlyOnceWith({ sellerId: "seller-session", status: "all", commissionId: "other-commission" });
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it.each([401, 403])("does not read private records after an authorization rejection (%s)", async (status) => {
    mocks.actor.mockResolvedValue({ user: null, unauthorized: new Response(null, { status }) });
    const response = await GET(new NextRequest("https://example.test/api/alpha-exchange/my-listings?sellerId=other-seller"));
    expect(response.status).toBe(status);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
});
