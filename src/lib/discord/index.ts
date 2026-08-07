import "server-only";

import { DiscordJsGatewayClient } from "@/lib/discord/gateway-client";
import {
  DiscordService,
  DiscordServiceError,
  type DiscordDiagnostics,
} from "@/lib/discord/service";
import { logEvent } from "@/lib/structured-logging";

type DiscordGlobalRegistry = typeof globalThis & {
  __alphaDiscordService?: DiscordService;
  __alphaDiscordShutdownHandlersInstalled?: boolean;
};

const discordGlobal = globalThis as DiscordGlobalRegistry;

export function getDiscordService(): DiscordService {
  if (!discordGlobal.__alphaDiscordService) {
    discordGlobal.__alphaDiscordService = new DiscordService({
      gateway: new DiscordJsGatewayClient(),
    });
  }
  installShutdownHandlers();
  return discordGlobal.__alphaDiscordService;
}

export async function initializeDiscordForRuntime(): Promise<DiscordDiagnostics | null> {
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const isEdge = process.env.NEXT_RUNTIME === "edge";
  const isVercel = process.env.VERCEL === "1";
  if (isBuild || isEdge || isVercel) {
    if (isVercel && !isBuild) {
      logEvent("info", {
        event: "discord_gateway_initialization_deferred",
        outcome: "success",
        reason: "Vercel does not guarantee a durable eager server process.",
      });
    }
    return null;
  }

  try {
    return await getDiscordService().start();
  } catch (error) {
    if (error instanceof DiscordServiceError) {
      return getDiscordService().getDiagnostics();
    }
    throw error;
  }
}

function installShutdownHandlers(): void {
  if (
    discordGlobal.__alphaDiscordShutdownHandlersInstalled
    || process.env.VERCEL === "1"
    || process.env.NODE_ENV === "test"
  ) {
    return;
  }
  discordGlobal.__alphaDiscordShutdownHandlersInstalled = true;

  const shutdown = () => {
    void discordGlobal.__alphaDiscordService?.shutdown().catch((error: unknown) => {
      logEvent("error", {
        event: "discord_gateway_shutdown_failed",
        outcome: "failed",
        metadata: {
          errorType: error instanceof Error ? error.name : typeof error,
        },
      });
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export type { DiscordDiagnostics } from "@/lib/discord/service";
