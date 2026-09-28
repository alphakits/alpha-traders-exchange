import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchDiscordWorkerDiagnostics } from "@/lib/discord/worker-health-client";
import {
  createDiscordWorkerResponseAuthHeaders,
  DISCORD_WORKER_AUTH_HEADERS,
} from "@/lib/discord/worker-health-auth";

const healthSecret = "s".repeat(32);
const nonce = "123e4567-e89b-42d3-a456-426614174000";
const now = 1_700_000_000_000;
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
  resources: {
    status: "ready",
    totalCount: 13,
    readyCount: 13,
    missingCount: 0,
    errorCode: null,
  },
  notifications: {
    status: "ready",
    pendingCount: 0,
    deadCount: 0,
    suppressedCount: 0,
    lastDeliveredAt: null,
    errorCode: null,
  },
  commands: {
    status: "ready",
    registeredCount: 7,
    definitionHash: "a".repeat(64),
    lastReconciledAt: "2026-08-08T05:00:00.000Z",
    errorCode: null,
  },
  marketIntelligence: {
    status: "ready",
    activeCount: 3,
    pendingCount: 0,
    deadCount: 0,
    lastSuccessAt: "2026-08-08T05:00:00.000Z",
    errorCode: null,
  },
  requiredPrivilegedIntents: ["GuildMembers"],
  deployment: {
    source: "railway",
    revision: "de96c1b0ffcc3e256e6990bc8a5b9d0b9013bedb",
    environment: "production",
  },
};

function signedFetch(
  payload: unknown,
  options: {
    status?: number;
    responseNonce?: string;
    responseNow?: number;
    tamperBodyAfterSigning?: boolean;
  } = {},
) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const requestHeaders = init?.headers as Record<string, string>;
    const requestNonce =
      options.responseNonce ?? requestHeaders[DISCORD_WORKER_AUTH_HEADERS.nonce];
    const signedBody = JSON.stringify(payload);
    const body = options.tamperBodyAfterSigning
      ? signedBody.replace("\"healthy\"", "\"degraded\"")
      : signedBody;
    const status = options.status ?? 200;
    return new Response(body, {
      status,
      headers: {
        "content-type": "application/json",
        ...createDiscordWorkerResponseAuthHeaders({
          secret: healthSecret,
          requestNonce,
          statusCode: status,
          body: signedBody,
          now: () => options.responseNow ?? now,
        }),
      },
    });
  });
}

describe("Discord worker health client", () => {
  it("uses only the configured HTTPS origin and verifies signed diagnostics", async () => {
    const fetchMock = signedFetch(healthyDiagnostics);
    const diagnostics = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: fetchMock,
      now: () => now,
      createNonce: () => nonce,
    });

    expect(diagnostics).toEqual(healthyDiagnostics);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://discord-worker.example.com/health/ready");
    expect(options).toMatchObject({
      method: "GET",
      cache: "no-store",
      headers: {
        [DISCORD_WORKER_AUTH_HEADERS.timestamp]: String(now),
        [DISCORD_WORKER_AUTH_HEADERS.nonce]: nonce,
      },
    });
    expect(JSON.stringify(options)).not.toContain(healthSecret);
  });

  it("rejects response tampering, nonce replay, and stale signatures", async () => {
    const tampered = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: signedFetch(healthyDiagnostics, { tamperBodyAfterSigning: true }),
      now: () => now,
      createNonce: () => nonce,
    });
    expect(tampered.error?.code).toBe("worker_response_authentication_failed");

    const replayed = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: signedFetch(healthyDiagnostics, {
        responseNonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      now: () => now,
      createNonce: () => nonce,
    });
    expect(replayed.error?.code).toBe("worker_response_authentication_failed");

    const stale = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: signedFetch(healthyDiagnostics, { responseNow: now - 31_000 }),
      now: () => now,
      createNonce: () => nonce,
    });
    expect(stale.error?.code).toBe("worker_response_authentication_failed");
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
    expect(unavailable.error?.code).toBe("worker_unavailable");
  });

  it("reports authorization and invalid payload failures without forwarding unsafe data", async () => {
    const unauthorized = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    });
    expect(unauthorized.error?.code).toBe("worker_authentication_failed");

    const invalid = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: signedFetch({
        ...healthyDiagnostics,
        error: { code: "unknown", message: "provider credential leaked" },
      }),
      now: () => now,
      createNonce: () => nonce,
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

  it("rejects secret-shaped aggregate diagnostics", async () => {
    const malformed = await fetchDiscordWorkerDiagnostics({
      env: proxyEnv,
      fetch: signedFetch({
        ...healthyDiagnostics,
        resources: {
          status: "degraded",
          totalCount: 13,
          readyCount: 0,
          missingCount: 13,
          errorCode: "token=raw-secret",
          channelId: "9".repeat(18),
        },
      }),
      now: () => now,
      createNonce: () => nonce,
    });
    expect(malformed.error?.code).toBe("worker_response_invalid");
    expect(JSON.stringify(malformed)).not.toContain("raw-secret");
  });
});
