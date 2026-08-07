// @vitest-environment node

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  requireUser: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireUser,
}));
vi.mock("@/lib/discord/identity-repository", () => ({
  getDiscordConnection: mocks.getConnection,
  unlinkDiscordIdentity: mocks.unlink,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
}));

import { DELETE, GET } from "@/app/api/discord/identity/route";

describe("Discord identity route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: "alpha-user" },
      unauthorized: null,
    });
    mocks.getConnection.mockResolvedValue(null);
    mocks.unlink.mockResolvedValue(true);
  });

  it("does not disclose connection status without website authentication", async () => {
    mocks.requireUser.mockResolvedValue({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it("rejects cross-site unlink requests", async () => {
    const response = await DELETE(new NextRequest(
      "http://localhost/api/discord/identity",
      {
        method: "DELETE",
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
      },
    ));
    expect(response.status).toBe(403);
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it("unlinks only the authenticated user's identity", async () => {
    const response = await DELETE(new NextRequest(
      "http://localhost/api/discord/identity",
      {
        method: "DELETE",
        headers: {
          origin: "http://localhost",
          "sec-fetch-site": "same-origin",
        },
      },
    ));
    expect(response.status).toBe(200);
    expect(mocks.unlink).toHaveBeenCalledWith({ platformUserId: "alpha-user" });
  });
});
