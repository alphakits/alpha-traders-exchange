// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDiscordOAuthState,
  createPkceChallenge,
  DiscordOAuthError,
  exchangeDiscordAuthorizationCode,
  readDiscordOAuthConfig,
  verifyPkceChallenge,
} from "@/lib/discord/oauth";

const config = {
  applicationId: "123456789012345678",
  clientSecret: "oauth-client-secret",
  redirectUri: "https://www.alphatraders.co.il/api/discord/oauth/callback",
};

describe("Discord OAuth", () => {
  it("creates a bounded one-time state request with S256 PKCE and identify only", () => {
    const now = Date.UTC(2026, 7, 7, 12, 0, 0);
    const request = createDiscordOAuthState(config, () => now);
    const url = new URL(request.authorizationUrl);

    expect(request.expiresAt.getTime() - now).toBe(10 * 60 * 1000);
    expect(request.state).toHaveLength(43);
    expect(request.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(request.challenge);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(request.authorizationUrl).not.toContain(config.clientSecret);
    expect(verifyPkceChallenge(request.verifier, request.challenge)).toBe(true);
    expect(verifyPkceChallenge(`${request.verifier}x`, request.challenge)).toBe(false);
  });

  it("requires the website OAuth client secret and never substitutes the bot token", () => {
    expect(() => readDiscordOAuthConfig({
      DISCORD_CLIENT_ID: config.applicationId,
      DISCORD_REDIRECT_URI: config.redirectUri,
      DISCORD_BOT_TOKEN: "bot-token-must-not-be-used",
    })).toThrow(DiscordOAuthError);
  });

  it("reads the dedicated website OAuth configuration", () => {
    expect(readDiscordOAuthConfig({
      DISCORD_CLIENT_ID: config.applicationId,
      DISCORD_CLIENT_SECRET: config.clientSecret,
      DISCORD_REDIRECT_URI: config.redirectUri,
      DISCORD_APPLICATION_ID: "987654321098765432",
    })).toEqual(config);
  });

  it.each([
    "http://www.alphatraders.co.il/api/discord/oauth/callback",
    "https://www.alphatraders.co.il/api/discord/oauth/callback?next=https://attacker.example",
    "https://www.alphatraders.co.il/other",
  ])("rejects an unsafe redirect URI: %s", (redirectUri) => {
    expect(() => readDiscordOAuthConfig({
      DISCORD_CLIENT_ID: config.applicationId,
      DISCORD_CLIENT_SECRET: config.clientSecret,
      DISCORD_REDIRECT_URI: redirectUri,
    })).toThrow(DiscordOAuthError);
  });

  it("exchanges the code server-side and returns only durable safe identity metadata", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "short-lived-access-token",
        token_type: "Bearer",
        refresh_token: "must-not-be-returned",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "987654321098765432",
        username: "alpha_user",
        global_name: "Alpha User",
        avatar: "avatar-hash",
      }), { status: 200 }));

    await expect(exchangeDiscordAuthorizationCode({
      code: "authorization-code",
      verifier: "v".repeat(64),
      config,
      fetchImpl,
    })).resolves.toEqual({
      id: "987654321098765432",
      username: "alpha_user",
      globalName: "Alpha User",
    });

    const tokenRequest = fetchImpl.mock.calls[0]![1] as RequestInit;
    const tokenBody = new URLSearchParams(String(tokenRequest.body));
    expect(tokenBody.get("client_secret")).toBe(config.clientSecret);
    expect(tokenBody.get("code_verifier")).toBe("v".repeat(64));
    const profileRequest = fetchImpl.mock.calls[1]![1] as RequestInit;
    expect((profileRequest.headers as Record<string, string>).authorization)
      .toBe("Bearer short-lived-access-token");
  });

  it("fails closed when Discord rejects the code exchange", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 400 }));
    await expect(exchangeDiscordAuthorizationCode({
      code: "bad-code",
      verifier: "v".repeat(64),
      config,
      fetchImpl,
    })).rejects.toMatchObject({ code: "exchange_failed" });
  });

  it("derives deterministic PKCE challenges without exposing the verifier", () => {
    expect(createPkceChallenge("v".repeat(64))).toBe(createPkceChallenge("v".repeat(64)));
    expect(createPkceChallenge("v".repeat(64))).not.toContain("v".repeat(16));
  });
});
