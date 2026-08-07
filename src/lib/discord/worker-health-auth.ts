import "server-only";

import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const AUTH_VERSION = "v1";
const AUTH_WINDOW_MS = 30_000;
const READY_METHOD = "GET";
const READY_PATH = "/health/ready";

export const DISCORD_WORKER_AUTH_HEADERS = {
  nonce: "x-discord-worker-nonce",
  signature: "x-discord-worker-signature",
  timestamp: "x-discord-worker-timestamp",
} as const;

export type DiscordWorkerAuthHeaders = {
  [DISCORD_WORKER_AUTH_HEADERS.nonce]: string;
  [DISCORD_WORKER_AUTH_HEADERS.signature]: string;
  [DISCORD_WORKER_AUTH_HEADERS.timestamp]: string;
};

function canonicalRequest(timestamp: string, nonce: string): string {
  return [AUTH_VERSION, timestamp, nonce, READY_METHOD, READY_PATH].join("\n");
}

function signature(secret: string, timestamp: string, nonce: string): string {
  return createHmac("sha256", secret)
    .update(canonicalRequest(timestamp, nonce))
    .digest("hex");
}

export function createDiscordWorkerAuthHeaders(
  secret: string,
  now: () => number = Date.now,
  createNonce: () => string = randomUUID,
): DiscordWorkerAuthHeaders {
  const timestamp = String(now());
  const nonce = createNonce();
  return {
    [DISCORD_WORKER_AUTH_HEADERS.timestamp]: timestamp,
    [DISCORD_WORKER_AUTH_HEADERS.nonce]: nonce,
    [DISCORD_WORKER_AUTH_HEADERS.signature]: signature(secret, timestamp, nonce),
  };
}

export class DiscordWorkerAuthVerifier {
  private readonly usedNonces = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  verify(
    headers: Readonly<Record<string, string | undefined>>,
    secret: string,
  ): boolean {
    const timestamp = headers[DISCORD_WORKER_AUTH_HEADERS.timestamp];
    const nonce = headers[DISCORD_WORKER_AUTH_HEADERS.nonce];
    const providedSignature = headers[DISCORD_WORKER_AUTH_HEADERS.signature];
    const currentTime = this.now();

    this.deleteExpiredNonces(currentTime);
    if (
      !timestamp
      || !/^\d{13}$/.test(timestamp)
      || !nonce
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce)
      || !providedSignature
      || !/^[0-9a-f]{64}$/i.test(providedSignature)
      || Math.abs(currentTime - Number(timestamp)) > AUTH_WINDOW_MS
      || this.usedNonces.has(nonce)
    ) {
      return false;
    }

    const expected = Buffer.from(signature(secret, timestamp, nonce), "hex");
    const provided = Buffer.from(providedSignature, "hex");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return false;
    }

    this.usedNonces.set(nonce, currentTime + AUTH_WINDOW_MS);
    return true;
  }

  private deleteExpiredNonces(currentTime: number): void {
    for (const [nonce, expiresAt] of this.usedNonces) {
      if (expiresAt <= currentTime) this.usedNonces.delete(nonce);
    }
  }
}
