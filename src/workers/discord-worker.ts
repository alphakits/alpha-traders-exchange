import "server-only";

import { getDiscordService } from "@/lib/discord";
import { logEvent } from "@/lib/structured-logging";
import { readDiscordWorkerRuntimeConfig } from "@/lib/discord/worker-config";
import {
  DiscordWorkerRuntime,
  installDiscordWorkerSignalHandlers,
} from "@/lib/discord/worker-runtime";

async function main(): Promise<void> {
  let runtime: DiscordWorkerRuntime | null = null;
  let removeSignalHandlers: () => void = () => undefined;
  let signalReceived = false;

  try {
    const config = readDiscordWorkerRuntimeConfig();
    runtime = new DiscordWorkerRuntime({
      config,
      service: getDiscordService(),
    });
    removeSignalHandlers = installDiscordWorkerSignalHandlers(
      runtime,
      process,
      () => {
        signalReceived = true;
      },
    );
    await runtime.start();
  } catch (error) {
    removeSignalHandlers();
    if (!signalReceived) {
      process.exitCode = 1;
      logEvent("error", {
        event: "discord_worker_start_failed",
        outcome: "failed",
        metadata: {
          errorType: error instanceof Error ? error.name : typeof error,
        },
      });
    }
    await runtime?.shutdown().catch((shutdownError: unknown) => {
      process.exitCode = 1;
      logEvent("error", {
        event: "discord_worker_shutdown_failed",
        outcome: "failed",
        metadata: {
          errorType:
            shutdownError instanceof Error
              ? shutdownError.name
              : typeof shutdownError,
        },
      });
    });
  }
}

void main();
