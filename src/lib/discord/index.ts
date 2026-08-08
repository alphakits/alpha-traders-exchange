import "server-only";

import { DiscordJsGatewayClient } from "@/lib/discord/gateway-client";
import {
  DiscordService,
} from "@/lib/discord/service";

type DiscordGlobalRegistry = typeof globalThis & {
  __alphaDiscordService?: DiscordService;
  __alphaDiscordGateway?: DiscordJsGatewayClient;
};

const discordGlobal = globalThis as DiscordGlobalRegistry;

export function getDiscordService(): DiscordService {
  if (!discordGlobal.__alphaDiscordService) {
    discordGlobal.__alphaDiscordGateway ??= new DiscordJsGatewayClient();
    discordGlobal.__alphaDiscordService = new DiscordService({
      gateway: discordGlobal.__alphaDiscordGateway,
    });
  }
  return discordGlobal.__alphaDiscordService;
}

export function getDiscordGatewayClient(): DiscordJsGatewayClient {
  getDiscordService();
  return discordGlobal.__alphaDiscordGateway!;
}

export type { DiscordDiagnostics } from "@/lib/discord/diagnostics";
