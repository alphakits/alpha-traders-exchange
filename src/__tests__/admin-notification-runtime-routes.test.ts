import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ requireApiAdmin: vi.fn(), checkSharedRateLimit: vi.fn() }));

vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
  createRateLimitResponse: vi.fn(),
}));

import { GET as getRuntime } from "@/app/api/admin/notifications/runtime/route";
import { GET as getSnapshot } from "@/app/api/admin/notifications/runtime/snapshot/route";

describe("admin notification runtime routes", () => {
  beforeEach(() => {
    mocks.requireApiAdmin.mockReset().mockResolvedValue({
      user: null,
      unauthorized: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    mocks.checkSharedRateLimit.mockReset();
  });

  it("rejects unauthenticated requests before returning diagnostics", async () => {
    const request = new NextRequest("https://example.test/api/admin/notifications/runtime");
    expect((await getRuntime(request)).status).toBe(401);
    expect((await getSnapshot(request)).status).toBe(401);
    expect(mocks.checkSharedRateLimit).not.toHaveBeenCalled();
  });
});