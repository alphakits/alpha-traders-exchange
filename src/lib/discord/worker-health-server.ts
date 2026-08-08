import "server-only";

import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";

import type { DiscordService } from "@/lib/discord/service";
import type {
  DiscordListingDiagnostics,
  DiscordMarketIntelligenceDiagnostics,
  DiscordResourceDiagnostics,
  DiscordCommunityCommandDiagnostics,
  DiscordCommunityNotificationDiagnostics,
} from "@/lib/discord/diagnostics";
import {
  DISCORD_WORKER_AUTH_HEADERS,
  DiscordWorkerAuthVerifier,
} from "@/lib/discord/worker-health-auth";

type HealthService = Pick<DiscordService, "getDiagnostics">;
type ResourceHealth = {
  getDiagnostics(): DiscordResourceDiagnostics;
};
type ListingHealth = {
  getDiagnostics(): DiscordListingDiagnostics;
};
type MarketIntelligenceHealth = {
  getDiagnostics(): DiscordMarketIntelligenceDiagnostics;
};
type NotificationHealth = {
  getDiagnostics(): DiscordCommunityNotificationDiagnostics;
};
type CommandHealth = {
  getDiagnostics(): DiscordCommunityCommandDiagnostics;
};

export type DiscordWorkerHealthServerDependencies = {
  service: HealthService;
  resources?: ResourceHealth;
  listings?: ListingHealth;
  marketIntelligence?: MarketIntelligenceHealth;
  notifications?: NotificationHealth;
  commands?: CommandHealth;
  healthSecret: string;
  now?: () => number;
};

function headerValue(
  headers: IncomingHttpHeaders,
  key: string,
): string | undefined {
  const value = headers[key];
  return Array.isArray(value) ? undefined : value;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export function createDiscordWorkerHealthServer({
  service,
  resources,
  listings,
  marketIntelligence,
  notifications,
  commands,
  healthSecret,
  now,
}: DiscordWorkerHealthServerDependencies): Server {
  const authVerifier = new DiscordWorkerAuthVerifier(now);

  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://worker.local");

    if (request.method === "GET" && url.pathname === "/health/live") {
      sendJson(response, 200, { status: "alive" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/health/ready") {
      const authorized = authVerifier.verify({
        [DISCORD_WORKER_AUTH_HEADERS.timestamp]: headerValue(
          request.headers,
          DISCORD_WORKER_AUTH_HEADERS.timestamp,
        ),
        [DISCORD_WORKER_AUTH_HEADERS.nonce]: headerValue(
          request.headers,
          DISCORD_WORKER_AUTH_HEADERS.nonce,
        ),
        [DISCORD_WORKER_AUTH_HEADERS.signature]: headerValue(
          request.headers,
          DISCORD_WORKER_AUTH_HEADERS.signature,
        ),
      }, healthSecret);

      if (!authorized) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }

      const serviceDiagnostics = service.getDiagnostics();
      const resourceDiagnostics = resources?.getDiagnostics();
      const listingDiagnostics = listings?.getDiagnostics();
      const marketIntelligenceDiagnostics = marketIntelligence?.getDiagnostics();
      const notificationDiagnostics = notifications?.getDiagnostics();
      const commandDiagnostics = commands?.getDiagnostics();
      const diagnostics = {
        ...serviceDiagnostics,
        status:
          serviceDiagnostics.status === "healthy"
          && (!resourceDiagnostics || resourceDiagnostics.status === "ready")
          && (!listingDiagnostics || listingDiagnostics.status === "ready")
          && (!marketIntelligenceDiagnostics
            || marketIntelligenceDiagnostics.status === "ready")
          && (!notificationDiagnostics
            || notificationDiagnostics.status === "ready")
          && (!commandDiagnostics || commandDiagnostics.status === "ready")
            ? "healthy" as const
            : "degraded" as const,
        ...(resourceDiagnostics ? { resources: resourceDiagnostics } : {}),
        ...(listingDiagnostics ? { listings: listingDiagnostics } : {}),
        ...(marketIntelligenceDiagnostics
          ? { marketIntelligence: marketIntelligenceDiagnostics }
          : {}),
        ...(notificationDiagnostics
           ? { notifications: notificationDiagnostics }
           : {}),
        ...(commandDiagnostics ? { commands: commandDiagnostics } : {}),
      };
      sendJson(response, diagnostics.status === "healthy" ? 200 : 503, diagnostics);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });
}
