// @vitest-environment node

import { EventEmitter } from "node:events";
import type { Server } from "node:http";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DiscordDiagnostics } from "@/lib/discord/diagnostics";
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

function runtimeFixture(start = vi.fn(async () => diagnostics)) {
  const server = new FakeServer();
  const service = {
    start,
    shutdown: vi.fn(async () => undefined),
    getDiagnostics: vi.fn(() => diagnostics),
  };
  const runtime = new DiscordWorkerRuntime({
    config: { healthSecret: "x".repeat(32), port: 3000 },
    service,
    createHealthServer: vi.fn(() => server as unknown as Server),
  });
  return { runtime, server, service };
}

describe("Discord worker runtime", () => {
  it("starts health serving and the singleton service, then shuts both down once", async () => {
    const { runtime, server, service } = runtimeFixture();

    await expect(runtime.start()).resolves.toEqual(diagnostics);
    await Promise.all([runtime.shutdown(), runtime.shutdown()]);

    expect(server.listen).toHaveBeenCalledOnce();
    expect(service.start).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    expect(service.shutdown).toHaveBeenCalledOnce();
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
