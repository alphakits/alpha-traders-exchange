// @vitest-environment node

import { EventEmitter } from "node:events";
import type { Server } from "node:http";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  DiscordDiagnostics,
  DiscordResourceDiagnostics,
} from "@/lib/discord/diagnostics";
import {
  DiscordWorkerRuntime,
  installDiscordWorkerSignalHandlers,
} from "@/lib/discord/worker-runtime";

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

class FakeServer extends EventEmitter {
  listening = false;
  readonly listen = vi.fn(() => {
    this.listening = true;
    queueMicrotask(() => this.emit("listening"));
    return this;
  });
  readonly close = vi.fn((callback?: (error?: Error) => void) => {
    this.listening = false;
    queueMicrotask(() => callback?.());
    return this;
  });
}

class FakeSignalProcess extends EventEmitter {
  exitCode?: number;
}

function runtimeFixture(
  start = vi.fn(async () => diagnostics),
  roleSync = {
    start: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  },
  resourceSync: {
    start: () => Promise<void>;
    shutdown: () => Promise<void>;
    getDiagnostics: () => DiscordResourceDiagnostics;
  } = {
    start: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    getDiagnostics: vi.fn(() => ({
      status: "ready" as const,
      totalCount: 13,
      readyCount: 13,
      missingCount: 0,
      errorCode: null,
    })),
  },
) {
  const server = new FakeServer();
  const service = {
    start,
    shutdown: vi.fn(async () => undefined),
    getDiagnostics: vi.fn(() => diagnostics),
  };
  const runtime = new DiscordWorkerRuntime({
    config: { healthSecret: "x".repeat(32), port: 3000 },
    service,
    roleSync,
    resourceSync,
    createHealthServer: vi.fn(() => server as unknown as Server),
  });
  return { runtime, server, service, roleSync, resourceSync };
}

describe("Discord worker runtime", () => {
  it("starts health serving and the singleton service, then shuts both down once", async () => {
    const { runtime, server, service, roleSync, resourceSync } = runtimeFixture();

    await expect(runtime.start()).resolves.toEqual(diagnostics);
    await Promise.all([runtime.shutdown(), runtime.shutdown()]);

    expect(server.listen).toHaveBeenCalledOnce();
    expect(service.start).toHaveBeenCalledOnce();
    expect(roleSync.start).toHaveBeenCalledOnce();
    expect(resourceSync.start).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    expect(service.shutdown).toHaveBeenCalledOnce();
    expect(roleSync.shutdown).toHaveBeenCalledOnce();
    expect(resourceSync.shutdown).toHaveBeenCalledOnce();
  });

  it("fails startup and cleans up when durable role synchronization cannot start", async () => {
    const roleSync = {
      start: vi.fn().mockRejectedValue(new Error("database unavailable")),
      shutdown: vi.fn(async () => undefined),
    };
    const { runtime, server, service } = runtimeFixture(
      vi.fn(async () => diagnostics),
      roleSync,
    );

    await expect(runtime.start()).rejects.toThrow("database unavailable");
    expect(server.close).toHaveBeenCalledOnce();
    expect(roleSync.shutdown).toHaveBeenCalledOnce();
    expect(service.shutdown).toHaveBeenCalledOnce();
  });

  it("keeps the gateway running when channel permissions are degraded", async () => {
    const resourceSync = {
      start: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      getDiagnostics: vi.fn(() => ({
        status: "degraded" as const,
        totalCount: 13,
        readyCount: 0,
        missingCount: 13,
        errorCode: "missing_manage_channels",
      })),
    };
    const { runtime, server, service } = runtimeFixture(
      vi.fn(async () => diagnostics),
      undefined,
      resourceSync,
    );

    await expect(runtime.start()).resolves.toEqual(diagnostics);
    expect(server.listening).toBe(true);
    expect(service.shutdown).not.toHaveBeenCalled();
    await runtime.shutdown();
  });

  it("cleans up and rejects startup failures for a non-zero entrypoint exit", async () => {
    const { runtime, server, service } = runtimeFixture(
      vi.fn().mockRejectedValue(new Error("login failed")),
    );

    await expect(runtime.start()).rejects.toThrow("login failed");
    expect(server.close).toHaveBeenCalledOnce();
    expect(service.shutdown).toHaveBeenCalledOnce();
  });

  it("handles SIGINT and SIGTERM through one idempotent shutdown", async () => {
    const processLike = new FakeSignalProcess();
    const shutdown = vi.fn(async () => undefined);
    const onSignal = vi.fn();
    installDiscordWorkerSignalHandlers(
      { shutdown },
      processLike,
      onSignal,
    );

    processLike.emit("SIGINT");
    processLike.emit("SIGTERM");
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
    expect(onSignal).toHaveBeenCalledOnce();
  });
});
