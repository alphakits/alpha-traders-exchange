import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getCurrentSessionUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentSessionUser: mocks.getCurrentSessionUser }));

import { resolveAdminIdentity } from "@/lib/admin-auth";

describe("resolveAdminIdentity", () => {
  beforeEach(() => {
    mocks.getCurrentSessionUser.mockReset().mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      role: "admin",
      roles: ["admin"],
    });
    delete process.env.ADMIN_ACCESS_KEY;
  });

  it("derives audit identity from the session instead of client headers", async () => {
    const identity = await resolveAdminIdentity(new NextRequest("https://example.test/api/admin/bootstrap", {
      headers: { "x-admin-role": "editor", "x-admin-actor": "forged@example.test" },
    }));

    expect(identity).toEqual({ role: "admin", actor: "admin@example.com" });
  });
});