import "server-only";

import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { EnvironmentValues } from "@/lib/env-validation";

const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
const DISCORD_CURRENT_USER_URL = "https://discord.com/api/v10/users/@me";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const DISCORD_OAUTH_PKCE_COOKIE = "alpha_discord_pkce";

export type DiscordOAuthConfig = {
  applicationId: string;
  clientSecret: string;
  redirectUri: string;
};

export type DiscordOAuthState = {
  state: string;
  stateHash: string;
  verifier: string;
  challenge: string;
  expiresAt: Date;
  authorizationUrl: string;
};

export type DiscordIdentityProfile = {
  id: string;
  username: string;
  globalName: string | null;
};

export class DiscordOAuthError extends Error {
  readonly code: "configuration" | "exchange_failed" | "profile_failed" | "profile_invalid";

  constructor(code: DiscordOAuthError["code"]) {
    super(code);
    this.name = "DiscordOAuthError";
    this.code = code;
  }
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function hashDiscordOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function createPkceChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function verifyPkceChallenge(verifier: string, expectedChallenge: string): boolean {
  const actual = Buffer.from(createPkceChallenge(verifier));
  const expected = Buffer.from(expectedChallenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function readDiscordOAuthConfig(
  env: EnvironmentValues = process.env,
): DiscordOAuthConfig {
  const applicationId = env.DISCORD_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim() ?? "";
  const configuredRedirectUri = env.DISCORD_REDIRECT_URI?.trim() ?? "";
  let redirectUri: URL;
  try {
    redirectUri = new URL(configuredRedirectUri);
  } catch {
    throw new DiscordOAuthError("configuration");
  }

  const localhostDevelopment = process.env.NODE_ENV !== "production"
    && redirectUri.hostname === "localhost"
    && redirectUri.protocol === "http:";
  if (
    !/^\d{17,20}$/.test(applicationId)
    || !clientSecret
    || (redirectUri.protocol !== "https:" && !localhostDevelopment)
    || redirectUri.username !== ""
    || redirectUri.password !== ""
    || redirectUri.pathname !== "/api/discord/oauth/callback"
    || redirectUri.search !== ""
    || redirectUri.hash !== ""
  ) {
    throw new DiscordOAuthError("configuration");
  }

  return {
    applicationId,
    clientSecret,
    redirectUri: redirectUri.toString(),
  };
}

export function createDiscordOAuthState(
  config: DiscordOAuthConfig,
  now: () => number = Date.now,
): DiscordOAuthState {
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(64));
  const challenge = createPkceChallenge(verifier);
  const expiresAt = new Date(now() + OAUTH_STATE_TTL_MS);
  const authorizationUrl = new URL(DISCORD_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("client_id", config.applicationId);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("scope", "identify");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "consent");

  return {
    state,
    stateHash: hashDiscordOAuthState(state),
    verifier,
    challenge,
    expiresAt,
    authorizationUrl: authorizationUrl.toString(),
  };
}

export async function exchangeDiscordAuthorizationCode(input: {
  code: string;
  verifier: string;
  config: DiscordOAuthConfig;
  fetchImpl?: typeof fetch;
}): Promise<DiscordIdentityProfile> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const tokenResponse = await fetchImpl(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.config.applicationId,
      client_secret: input.config.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.config.redirectUri,
      code_verifier: input.verifier,
    }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) throw new DiscordOAuthError("exchange_failed");

  const tokenBody = await tokenResponse.json() as { access_token?: unknown; token_type?: unknown };
  if (
    typeof tokenBody.access_token !== "string"
    || tokenBody.access_token.length < 10
    || String(tokenBody.token_type).toLowerCase() !== "bearer"
  ) {
    throw new DiscordOAuthError("exchange_failed");
  }

  const profileResponse = await fetchImpl(DISCORD_CURRENT_USER_URL, {
    headers: {
      authorization: `${String(tokenBody.token_type)} ${tokenBody.access_token}`,
    },
    cache: "no-store",
  });
  if (!profileResponse.ok) throw new DiscordOAuthError("profile_failed");

  const profile = await profileResponse.json() as {
    id?: unknown;
    username?: unknown;
    global_name?: unknown;
  };
  if (
    typeof profile.id !== "string"
    || !/^\d{17,20}$/.test(profile.id)
    || typeof profile.username !== "string"
    || profile.username.length < 1
    || profile.username.length > 80
  ) {
    throw new DiscordOAuthError("profile_invalid");
  }

  return {
    id: profile.id,
    username: profile.username,
    globalName:
      typeof profile.global_name === "string"
        ? profile.global_name.slice(0, 100)
        : null,
  };
}
