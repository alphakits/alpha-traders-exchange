// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  currentUser: vi.fn(),
  exchange: vi.fn(),
  link: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getCurrentSessionUser: mocks.currentUser,
}));
vi.mock("@/lib/discord/identity-repository", () => ({
  consumeDiscordOAuthState: mocks.consume,
  DiscordIdentityConflictError: class DiscordIdentityConflictError extends Error {},
  linkDiscordIdentity: mocks.link,
  recordDiscordIdentityAudit: mocks.recordAudit,
}));
vi.mock("@/lib/discord/oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discord/oauth")>();
  return {
    ...actual,
    exchangeDiscordAuthorizationCode: mocks.exchange,
  };
});

import {
  createPkceChallenge,
  DISCORD_OAUTH_PKCE_COOKIE,
} from "@/lib/discord/oauth";
import { GET } from "@/app/api/discord/oauth/callback/route";

const verifier = "v".repeat(64);

function callbackRequest(query: string) {
  return new NextRequest(`http://localhost/api/discord/oauth/callback?${query}`, {
    headers: { cookie: `${DISCORD_OAUTH_PKCE_COOKIE}=${verifier}` },
  });
}

describe("Discord OAuth callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost";
    process.env.DISCORD_CLIENT_ID = "123456789012345678";
    process.env.DISCORD_CLIENT_SECRET = "oauth-client-secret";
    process.env.DISCORD_REDIRECT_URI = "http://localhost/api/discord/oauth/callback";
    mocks.currentUser.mockResolvedValue({ id: "alpha-user" });
    mocks.consume.mockResolvedValue({
      codeChallenge: createPkceChallenge(verifier),
      locale: "en",
    });
    mocks.exchange.mockResolvedValue({
      id: "987654321098765432",
      username: "alpha_user",
      globalName: "Alpha User",
    });
    mocks.link.mockResolvedValue(undefined);
    mocks.recordAudit.mockResolvedValue(undefined);
  });

  it("rejects replayed, expired, or differently-bound state before code exchange", async () => {
    mocks.consume.mockResolvedValue(null);
    const response = await GET(callbackRequest(`state=${"s".repeat(43)}&code=authorization-code`));
    expect(response.headers.get("location")).toContain("discord=expired");
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.consume).toHaveBeenCalledWith(expect.objectContaining({
      platformUserId: "alpha-user",
    }));
  });

  it("consumes state once and returns safe UX when Discord code exchange fails", async () => {
    mocks.exchange.mockRejectedValue(new Error("provider response must stay private"));
    const response = await GET(callbackRequest(`state=${"s".repeat(43)}&code=authorization-code`));
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("discord=failed");
    expect(location).not.toContain("provider");
    expect(mocks.consume).toHaveBeenCalledOnce();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it("links only the currently authenticated Alpha account", async () => {
    const response = await GET(callbackRequest(`state=${"s".repeat(43)}&code=authorization-code`));
    expect(response.headers.get("location")).toContain("discord=linked");
    expect(mocks.link).toHaveBeenCalledWith({
      platformUserId: "alpha-user",
      profile: {
        id: "987654321098765432",
        username: "alpha_user",
        globalName: "Alpha User",
      },
    });
    expect(response.headers.get("set-cookie")).toContain(`${DISCORD_OAUTH_PKCE_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
  });
});
