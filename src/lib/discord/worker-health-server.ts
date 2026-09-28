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
  DiscordDeploymentDiagnostics,
  DiscordOnboardingContentDiagnostics,
} from "@/lib/discord/diagnostics";
import { readDiscordDeploymentDiagnostics } from "@/lib/discord/diagnostics";
import {
  DISCORD_WORKER_AUTH_HEADERS,
  DiscordWorkerAuthVerifier,
  createDiscordWorkerResponseAuthHeaders,
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
type OnboardingContentHealth = {
  getDiagnostics(): DiscordOnboardingContentDiagnostics;
};

export type DiscordWorkerHealthServerDependencies = {
  service: HealthService;
  resources?: ResourceHealth;
  listings?: ListingHealth;
  marketIntelligence?: MarketIntelligenceHealth;
  notifications?: NotificationHealth;
  commands?: CommandHealth;
  onboardingContent?: OnboardingContentHealth;
  healthSecret: string;
  now?: () => number;
  deployment?: DiscordDeploymentDiagnostics;
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
  headers: Record<string, string> = {},
): void {
  const serialized = JSON.stringify(body);
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(serialized);
}

export function createDiscordWorkerHealthServer({
  service,
  resources,
  listings,
  marketIntelligence,
  notifications,
  commands,
  onboardingContent,
  healthSecret,
  now,
  deployment = readDiscordDeploymentDiagnostics(),
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
      const onboardingContentDiagnostics =
        onboardingContent?.getDiagnostics();
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
          && (!onboardingContentDiagnostics
            || onboardingContentDiagnostics.status === "ready")
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
        ...(onboardingContentDiagnostics
          ? { onboardingContent: onboardingContentDiagnostics }
          : {}),
        requiredPrivilegedIntents: ["GuildMembers"] as const,
        deployment,
      };
      const statusCode = diagnostics.status === "healthy" ? 200 : 503;
      const serialized = JSON.stringify(diagnostics);
      const requestNonce = headerValue(
        request.headers,
        DISCORD_WORKER_AUTH_HEADERS.nonce,
      );
      if (!requestNonce) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }
      response.writeHead(statusCode, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        ...createDiscordWorkerResponseAuthHeaders({
          secret: healthSecret,
          requestNonce,
          statusCode,
          body: serialized,
          now,
        }),
      });
      response.end(serialized);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });
}
