import "server-only";

import {
  getDiscordGatewayClient,
  getDiscordService,
} from "@/lib/discord";
import { logEvent } from "@/lib/structured-logging";
import { readDiscordWorkerRuntimeConfig } from "@/lib/discord/worker-config";
import {
  DiscordWorkerRuntime,
  installDiscordWorkerSignalHandlers,
} from "@/lib/discord/worker-runtime";
import { createDiscordRoleSyncWorker } from "@/lib/discord/role-sync-worker";
import { createDiscordResourceSyncWorker } from "@/lib/discord/resource-sync-worker";
import { createDiscordListingSyncWorker } from "@/lib/discord/listing-sync-worker";
import { createDiscordMarketIntelligenceWorker } from "@/lib/discord/market-intelligence-worker";
import {
  DiscordCommunityNotificationWorker,
  DiscordRestDirectMessagePublisher,
} from "@/lib/discord/community-notifications";
import { DiscordCommunityCommandService } from "@/lib/discord/community-commands";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { readDiscordConfig } from "@/lib/discord/config";
import { getSiteUrl } from "@/lib/site-url";

async function main(): Promise<void> {
  let runtime: DiscordWorkerRuntime | null = null;
  let removeSignalHandlers: () => void = () => undefined;
  let signalReceived = false;

  try {
    const config = readDiscordWorkerRuntimeConfig();
    const discordConfig = readDiscordConfig();
    const pool = getRuntimePostgresPool();
    if (!pool) {
      throw new Error(
        "Discord community interactions require DATABASE_URL or SUPABASE_DB_URL.",
      );
    }
    const gateway = getDiscordGatewayClient();
    const siteUrl = getSiteUrl();
    runtime = new DiscordWorkerRuntime({
      config,
      service: getDiscordService(),
      roleSync: createDiscordRoleSyncWorker(),
      resourceSync: createDiscordResourceSyncWorker(),
      listingSync: createDiscordListingSyncWorker(),
      marketIntelligence: createDiscordMarketIntelligenceWorker(),
      commands: new DiscordCommunityCommandService({
        pool,
        gateway,
        token: discordConfig.token,
        applicationId: discordConfig.applicationId,
        guildId: discordConfig.guildId,
        siteUrl,
      }),
      notifications: new DiscordCommunityNotificationWorker({
        pool,
        gateway,
        publisher: new DiscordRestDirectMessagePublisher(discordConfig.token),
        siteUrl,
        guildId: discordConfig.guildId,
      }),
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
