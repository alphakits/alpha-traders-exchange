import "server-only";

import { DiscordJsGatewayClient } from "@/lib/discord/gateway-client";
import {
  DiscordService,
} from "@/lib/discord/service";

type DiscordGlobalRegistry = typeof globalThis & {
  __alphaDiscordService?: DiscordService;
};

const discordGlobal = globalThis as DiscordGlobalRegistry;

export function getDiscordService(): DiscordService {
  if (!discordGlobal.__alphaDiscordService) {
    discordGlobal.__alphaDiscordService = new DiscordService({
      gateway: new DiscordJsGatewayClient(),
    });
  }
  return discordGlobal.__alphaDiscordService;
}

export type { DiscordDiagnostics } from "@/lib/discord/diagnostics";
