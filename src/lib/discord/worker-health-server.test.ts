// @vitest-environment node

import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DiscordDiagnostics } from "@/lib/discord/diagnostics";
import { createDiscordWorkerAuthHeaders } from "@/lib/discord/worker-health-auth";
import { createDiscordWorkerHealthServer } from "@/lib/discord/worker-health-server";

const healthSecret = "w".repeat(32);
const now = 1_700_000_000_000;
const nonce = "123e4567-e89b-42d3-a456-426614174000";
const diagnostics: DiscordDiagnostics = {
  status: "healthy",
  connected: true,
  readyState: "ready",
  botUsername: "test-bot",
  guildName: "Test Guild",
  guildId: "5".repeat(18),
  apiLatencyMs: 38,
  connectionUptimeMs: 900,
  error: null,
};
const servers: ReturnType<typeof createDiscordWorkerHealthServer>[] = [];

async function startServer() {
  const server = createDiscordWorkerHealthServer({
    service: { getDiagnostics: () => diagnostics },
    healthSecret,
    now: () => now,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(
    (server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  ));
});

describe("Discord worker health server", () => {
  it("exposes generic unauthenticated liveness without Discord data", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/health/live`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "alive" });
  });

  it("requires a fresh valid signature for detailed readiness", async () => {
    const baseUrl = await startServer();
    expect((await fetch(`${baseUrl}/health/ready`)).status).toBe(401);

    const headers = createDiscordWorkerAuthHeaders(
      healthSecret,
      () => now,
      () => nonce,
    );
    const authorized = await fetch(`${baseUrl}/health/ready`, { headers });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual(diagnostics);

    const replayed = await fetch(`${baseUrl}/health/ready`, { headers });
    expect(replayed.status).toBe(401);
  });

  it("returns 503 for authenticated degraded readiness", async () => {
    const server = createDiscordWorkerHealthServer({
      service: {
        getDiagnostics: () => ({
          ...diagnostics,
          status: "degraded",
          connected: false,
          readyState: "reconnecting",
        }),
      },
      healthSecret,
      now: () => now,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const headers = createDiscordWorkerAuthHeaders(
      healthSecret,
      () => now,
      () => nonce,
    );

    expect(
      (await fetch(`http://127.0.0.1:${port}/health/ready`, { headers })).status,
    ).toBe(503);
  });
});
