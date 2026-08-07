import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchDiscordWorkerDiagnostics } from "@/lib/discord/worker-health-client";
import { DISCORD_WORKER_AUTH_HEADERS } from "@/lib/discord/worker-health-auth";

const healthSecret = "s".repeat(32);
const nonce = "123e4567-e89b-42d3-a456-426614174000";
const proxyEnv = {
  DISCORD_WORKER_BASE_URL: "https://discord-worker.example.com",
  DISCORD_WORKER_HEALTH_SECRET: healthSecret,
};
const healthyDiagnostics = {
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

describe("Discord worker health client", () => {
  it("uses only the configured HTTPS origin and signed authorization headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => Response.json(healthyDiagnostics),
    );

    const diagnostics = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: fetchMock,
      now: () => 1_700_000_000_000,
      createNonce: () => nonce,
    });

    expect(diagnostics).toEqual(healthyDiagnostics);
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [url, options] = call!;
    expect(url).toBe("https://discord-worker.example.com/health/ready");
    expect(options).toMatchObject({
      method: "GET",
      cache: "no-store",
      headers: {
        [DISCORD_WORKER_AUTH_HEADERS.timestamp]: "1700000000000",
        [DISCORD_WORKER_AUTH_HEADERS.nonce]: nonce,
      },
    });
    expect(
      (options?.headers as Record<string, string>)[
        DISCORD_WORKER_AUTH_HEADERS.signature
      ],
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(options)).not.toContain(healthSecret);
  });

  it("maps bounded timeouts and unavailable workers to explicit degraded states", async () => {
    const timeoutError = new Error("request timed out");
    timeoutError.name = "TimeoutError";
    const timeout = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: vi.fn().mockRejectedValue(timeoutError),
    });
    expect(timeout).toMatchObject({
      status: "degraded",
      error: { code: "worker_timeout" },
    });

    const unavailable = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    });
    expect(unavailable).toMatchObject({
      status: "degraded",
      error: { code: "worker_unavailable" },
    });
  });

  it("reports authorization and response failures without forwarding unsafe data", async () => {
    const unauthorized = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    });
    expect(unauthorized.error?.code).toBe("worker_authentication_failed");

    const invalid = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: vi.fn(async () => Response.json({
        ...healthyDiagnostics,
        botUsername: "raw-secret-that-must-not-be-forwarded",
        error: { code: "unknown", message: "provider credential leaked" },
      })),
    });
    expect(invalid.error?.code).toBe("worker_response_invalid");
    expect(JSON.stringify(invalid)).not.toContain("provider credential leaked");
  });

  it("fails closed when proxy configuration is absent", async () => {
    const fetchMock = vi.fn();
    const diagnostics = await fetchDiscordWorkerDiagnostics({
      env: {},
      fetch: fetchMock,
    });

    expect(diagnostics.error?.code).toBe("worker_configuration_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
