import "server-only";

import type { Server } from "node:http";
import { performance } from "node:perf_hooks";

import type {
  DiscordDiagnostics,
  DiscordListingDiagnostics,
  DiscordMarketIntelligenceDiagnostics,
  DiscordResourceDiagnostics,
} from "@/lib/discord/diagnostics";
import type { DiscordService } from "@/lib/discord/service";
import { logEvent } from "@/lib/structured-logging";
import { createDiscordWorkerHealthServer } from "@/lib/discord/worker-health-server";
import type { DiscordWorkerRuntimeConfig } from "@/lib/discord/worker-config";

type WorkerService = Pick<
  DiscordService,
  "getDiagnostics" | "shutdown" | "start"
>;

type WorkerRuntimeDependencies = {
  config: DiscordWorkerRuntimeConfig;
  service: WorkerService;
  roleSync?: {
    start(): Promise<void>;
    shutdown(): Promise<void>;
  };
  resourceSync?: {
    start(): Promise<void>;
    shutdown(): Promise<void>;
    getDiagnostics(): DiscordResourceDiagnostics;
  };
  listingSync?: {
    start(): Promise<void>;
    shutdown(): Promise<void>;
    getDiagnostics(): DiscordListingDiagnostics;
  };
  marketIntelligence?: {
    start(): Promise<void>;
    shutdown(): Promise<void>;
    getDiagnostics(): DiscordMarketIntelligenceDiagnostics;
  };
  createHealthServer?: typeof createDiscordWorkerHealthServer;
};

type SignalName = "SIGINT" | "SIGTERM";

type SignalProcess = {
  exitCode?: string | number;
  on(signal: SignalName, listener: () => void): unknown;
  removeListener(signal: SignalName, listener: () => void): unknown;
};

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "0.0.0.0");
  });
}

function close(server: Server | null): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export class DiscordWorkerRuntime {
  private readonly config: DiscordWorkerRuntimeConfig;
  private readonly service: WorkerService;
  private readonly createHealthServer: typeof createDiscordWorkerHealthServer;
  private readonly roleSync: WorkerRuntimeDependencies["roleSync"];
  private readonly resourceSync: WorkerRuntimeDependencies["resourceSync"];
  private readonly listingSync: WorkerRuntimeDependencies["listingSync"];
  private readonly marketIntelligence: WorkerRuntimeDependencies["marketIntelligence"];
  private healthServer: Server | null = null;
  private startPromise: Promise<DiscordDiagnostics> | null = null;
  private shutdownPromise: Promise<void> | null = null;

  constructor({
    config,
    service,
    roleSync,
    resourceSync,
    listingSync,
    marketIntelligence,
    createHealthServer = createDiscordWorkerHealthServer,
  }: WorkerRuntimeDependencies) {
    this.config = config;
    this.service = service;
    this.createHealthServer = createHealthServer;
    this.roleSync = roleSync;
    this.resourceSync = resourceSync;
    this.listingSync = listingSync;
    this.marketIntelligence = marketIntelligence;
  }

  start(): Promise<DiscordDiagnostics> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.performStart();
    return this.startPromise;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performStart(): Promise<DiscordDiagnostics> {
    const startedAt = performance.now();
    const recordPhase = (phase: string) => {
      logEvent("info", {
        event: "discord_worker_start_phase",
        outcome: "success",
        metadata: {
          phase,
          elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        },
      });
    };
    this.healthServer = this.createHealthServer({
      service: this.service,
      resources: this.resourceSync,
      listings: this.listingSync,
      marketIntelligence: this.marketIntelligence,
      healthSecret: this.config.healthSecret,
    });

    try {
      await listen(this.healthServer, this.config.port);
      recordPhase("health_server_listening");
      const diagnostics = await this.service.start();
      if (diagnostics.status !== "healthy") {
        throw new Error("Discord worker startup completed without healthy diagnostics.");
      }
      recordPhase("gateway_ready");
      if (this.roleSync) {
        await this.roleSync.start();
        recordPhase("role_sync_ready");
      }
      if (this.resourceSync) {
        await this.resourceSync.start();
        recordPhase("resource_sync_ready");
      }
      if (this.listingSync) {
        await this.listingSync.start();
        recordPhase("listing_sync_ready");
      }
      if (this.marketIntelligence) {
        await this.marketIntelligence.start();
        recordPhase("market_intelligence_scheduled");
      }
      logEvent("info", {
        event: "discord_worker_started",
        outcome: "success",
        metadata: {
          botUsername: diagnostics.botUsername,
          guildName: diagnostics.guildName,
          guildId: diagnostics.guildId,
          connectionStatus: diagnostics.readyState,
          apiLatencyMs: diagnostics.apiLatencyMs,
        },
      });
      return diagnostics;
    } catch (startupError) {
      try {
        await this.shutdown();
      } catch (shutdownError) {
        throw new AggregateError(
          [startupError, shutdownError],
          "Discord worker startup and cleanup failed.",
        );
      }
      throw startupError;
    }
  }

  private async performShutdown(): Promise<void> {
    const failures: unknown[] = [];
    try {
      await this.marketIntelligence?.shutdown();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.listingSync?.shutdown();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.resourceSync?.shutdown();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.roleSync?.shutdown();
    } catch (error) {
      failures.push(error);
    }
    try {
      await close(this.healthServer);
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.service.shutdown();
    } catch (error) {
      failures.push(error);
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "Discord worker shutdown failed.");
    }

    logEvent("info", {
      event: "discord_worker_stopped",
      outcome: "success",
    });
  }
}

export function installDiscordWorkerSignalHandlers(
  runtime: Pick<DiscordWorkerRuntime, "shutdown">,
  processLike: SignalProcess = process,
  onSignal: () => void = () => undefined,
): () => void {
  let signalHandled = false;
  const cleanup = () => {
    processLike.removeListener("SIGINT", handleSignal);
    processLike.removeListener("SIGTERM", handleSignal);
  };
  const handleSignal = () => {
    if (signalHandled) return;
    signalHandled = true;
    onSignal();
    void runtime.shutdown()
      .catch((error: unknown) => {
        processLike.exitCode = 1;
        logEvent("error", {
          event: "discord_worker_shutdown_failed",
          outcome: "failed",
          metadata: {
            errorType: error instanceof Error ? error.name : typeof error,
          },
        });
      })
      .finally(cleanup);
  };

  processLike.on("SIGINT", handleSignal);
  processLike.on("SIGTERM", handleSignal);
  return cleanup;
}
