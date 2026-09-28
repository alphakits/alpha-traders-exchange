// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createState: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireUser,
}));
vi.mock("@/lib/discord/identity-repository", () => ({
  createDiscordOAuthStateRecord: mocks.createState,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}));

import { POST } from "@/app/api/discord/oauth/start/route";

describe("Discord OAuth start route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISCORD_CLIENT_ID = "123456789012345678";
    process.env.DISCORD_CLIENT_SECRET = "oauth-client-secret";
    process.env.DISCORD_REDIRECT_URI = "http://localhost/api/discord/oauth/callback";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost";
    mocks.requireUser.mockResolvedValue({
      user: { id: "alpha-user" },
      unauthorized: null,
    });
  });

  it("requires authenticated same-origin POST before creating state", async () => {
    const response = await POST(new NextRequest(
      "http://localhost/api/discord/oauth/start",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ locale: "en" }),
      },
    ));
    expect(response.status).toBe(403);
    expect(mocks.createState).not.toHaveBeenCalled();
  });

  it("returns a fixed Discord authorize URL and an HttpOnly PKCE cookie", async () => {
    const response = await POST(new NextRequest(
      "http://localhost/api/discord/oauth/start",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ locale: "en" }),
      },
    ));
    const body = await response.json() as { authorizationUrl: string };
    const url = new URL(body.authorizationUrl);

    expect(response.status).toBe(200);
    expect(url.origin).toBe("https://discord.com");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(mocks.createState).toHaveBeenCalledWith(expect.objectContaining({
      platformUserId: "alpha-user",
      locale: "en",
    }));
  });
});
