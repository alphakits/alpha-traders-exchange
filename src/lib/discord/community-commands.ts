import "server-only";

import { createHash } from "node:crypto";

import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  MessageFlags,
  REST,
  Routes,
  type APIApplicationCommand,
  type APIApplicationCommandOption,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord.js";
import type { Pool, PoolClient } from "pg";

import type { DiscordGatewayClient } from "@/lib/discord/gateway-client";
import {
  buildDiscordMarketContentMessage,
  normalizeMarketSiteUrl,
} from "@/lib/discord/market-intelligence-publisher";
import {
  getPublicDiscordSellerProfileByDiscordUserId,
  getPublicDiscordSellerProfileByUsername,
  PostgresDiscordMarketContentRepository,
} from "@/lib/discord/market-intelligence-repository";
import { buildDiscordSellerProfileCard } from "@/lib/discord/seller-profile-card";
import { logEvent } from "@/lib/structured-logging";

const RESPONSE_TIMEOUT_MS = 2_500;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5;

export const DISCORD_COMMUNITY_COMMAND_NAMES = [
  "market",
  "profile",
  "listing",
  "share",
  "website",
  "help",
  "pulse",
] as const;

export type DiscordCommunityCommandName =
  (typeof DISCORD_COMMUNITY_COMMAND_NAMES)[number];

type CommandDefinition = {
  name: DiscordCommunityCommandName;
  description: string;
  type: typeof ApplicationCommandType.ChatInput;
  dm_permission: false;
  options?: APIApplicationCommandOption[];
};

const PUBLIC_SELLER_OPTION: APIApplicationCommandOption = {
  type: ApplicationCommandOptionType.String,
  name: "seller",
  description: "Public Alpha Traders seller display name",
  required: false,
  max_length: 100,
};

export const DISCORD_COMMUNITY_COMMANDS: readonly CommandDefinition[] = [
  {
    name: "market",
    description: "View the current privacy-safe Alpha Traders market summary",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
  {
    name: "profile",
    description: "View an eligible public seller profile",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
    options: [PUBLIC_SELLER_OPTION],
  },
  {
    name: "listing",
    description: "Find authoritative public active seller listings",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
    options: [PUBLIC_SELLER_OPTION],
  },
  {
    name: "share",
    description: "Open the authoritative website listing share flow",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
  {
    name: "website",
    description: "Open official Alpha Traders website links",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
  {
    name: "help",
    description: "View Alpha Traders commands and onboarding help",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
  {
    name: "pulse",
    description: "View the current privacy-safe live market pulse",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
] as const;

export const DISCORD_COMMUNITY_COMMAND_DEFINITION_HASH = createHash("sha256")
  .update(JSON.stringify(DISCORD_COMMUNITY_COMMANDS))
  .digest("hex");

type InteractionClaimOutcome = "accepted" | "rate_limited" | "replayed";

export type DiscordCommunityCommandDiagnostics = {
  status: "ready" | "degraded";
  registeredCount: number | null;
  definitionHash: string;
  lastReconciledAt: string | null;
  errorCode: string | null;
};

function commandHash(command: Pick<
  APIApplicationCommand,
  "name" | "description" | "type" | "options"
>): string {
  return createHash("sha256").update(JSON.stringify({
    name: command.name,
    description: command.description,
    type: command.type,
    dm_permission: false,
    options: command.options ?? [],
  })).digest("hex");
}

function definitionHash(command: CommandDefinition): string {
  return createHash("sha256").update(JSON.stringify({
    name: command.name,
    description: command.description,
    type: command.type,
    dm_permission: command.dm_permission,
    options: command.options ?? [],
  })).digest("hex");
}

function isCommunityCommand(
  value: string,
): value is DiscordCommunityCommandName {
  return DISCORD_COMMUNITY_COMMAND_NAMES.includes(
    value as DiscordCommunityCommandName,
  );
}

async function claimInteraction(input: {
  pool: Pool;
  interactionId: string;
  discordUserId: string;
  commandName: DiscordCommunityCommandName;
  now?: Date;
}): Promise<InteractionClaimOutcome> {
  const client = await input.pool.connect();
  const now = input.now ?? new Date();
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      [`${input.discordUserId}:${input.commandName}`],
    );
    const replay = await client.query(
      `select 1
         from alpha_exchange.discord_interaction_claims
        where interaction_id = $1`,
      [input.interactionId],
    );
    if (replay.rowCount === 1) {
      await client.query("commit");
      return "replayed";
    }

    const existing = await client.query<{
      window_started_at: Date;
      request_count: number;
    }>(
      `select window_started_at, request_count
         from alpha_exchange.discord_command_rate_limits
        where discord_user_id = $1
          and command_name = $2
        for update`,
      [input.discordUserId, input.commandName],
    );
    const row = existing.rows[0];
    const inWindow = row
      && now.getTime() - row.window_started_at.getTime() < RATE_LIMIT_WINDOW_MS;
    const nextCount = inWindow ? row.request_count + 1 : 1;
    const outcome = nextCount > RATE_LIMIT_MAX_REQUESTS
      ? "rate_limited"
      : "accepted";
    await client.query(
      `insert into alpha_exchange.discord_command_rate_limits
         (discord_user_id, command_name, window_started_at, request_count)
       values ($1, $2, $3, $4)
       on conflict (discord_user_id, command_name) do update set
         window_started_at = excluded.window_started_at,
         request_count = excluded.request_count,
         updated_at = now()`,
      [
        input.discordUserId,
        input.commandName,
        inWindow ? row.window_started_at : now,
        Math.min(RATE_LIMIT_MAX_REQUESTS, nextCount),
      ],
    );
    await client.query(
      `insert into alpha_exchange.discord_interaction_claims
         (interaction_id, discord_user_id, command_name, outcome)
       values ($1, $2, $3, $4)`,
      [
        input.interactionId,
        input.discordUserId,
        input.commandName,
        outcome,
      ],
    );
    await client.query("commit");
    return outcome;
  } catch (error) {
    await rollback(client, error);
    throw error;
  } finally {
    client.release();
  }
}

async function rollback(client: PoolClient, cause: unknown): Promise<void> {
  try {
    await client.query("rollback");
  } catch (rollbackError) {
    throw new AggregateError(
      [cause, rollbackError],
      "Discord interaction transaction rollback failed.",
    );
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("interaction_response_timeout")),
      milliseconds,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function toInteractionReply(
  body: RESTPostAPIChannelMessageJSONBody,
): InteractionEditReplyOptions {
  return {
    ...(body.content === undefined ? {} : { content: body.content }),
    ...(body.embeds === undefined ? {} : { embeds: body.embeds }),
    ...(body.components === undefined
      ? {}
      : {
          components:
            body.components as InteractionEditReplyOptions["components"],
        }),
    ...(body.allowed_mentions === undefined
      ? {}
      : { allowedMentions: body.allowed_mentions }),
  };
}

function linksMessage(siteUrl: string): RESTPostAPIChannelMessageJSONBody {
  return {
    allowed_mentions: { parse: [] },
    content: "Official Alpha Traders links:",
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Website",
        url: siteUrl,
      }, {
        type: 2,
        style: 5,
        label: "Marketplace",
        url: `${siteUrl}/en/usdt-exchange`,
      }, {
        type: 2,
        style: 5,
        label: "Account Settings",
        url: `${siteUrl}/en/settings`,
      }],
    }],
  };
}

function helpMessage(siteUrl: string): RESTPostAPIChannelMessageJSONBody {
  return {
    allowed_mentions: { parse: [] },
    content: [
      "**Alpha Traders commands**",
      "`/market` and `/pulse` — privacy-safe marketplace totals",
      "`/profile [seller]` — eligible public seller card",
      "`/listing [seller]` — authoritative public listing link",
      "`/share` — open My Listings on the website; never publishes from Discord",
      "`/website` — official links",
      "",
      `Link your account and apply to become an Approved Seller: ${siteUrl}/en/settings`,
    ].join("\n"),
  };
}

async function linkedPlatformUserId(
  pool: Pool,
  discordUserId: string,
): Promise<string | null> {
  const result = await pool.query<{ platform_user_id: string }>(
    `select platform_user_id
       from alpha_exchange.discord_identities
      where discord_user_id = $1`,
    [discordUserId],
  );
  return result.rows[0]?.platform_user_id ?? null;
}

async function listingMessage(input: {
  pool: Pool;
  siteUrl: string;
  discordUserId: string;
  seller: string | null;
}): Promise<RESTPostAPIChannelMessageJSONBody> {
  const result = await input.pool.query<{ listing_count: number }>(
    `select count(*)::int as listing_count
       from alpha_exchange.listings listings
       join alpha_exchange.users users on users.id = listings.seller_id
       left join alpha_exchange.discord_identities identity
         on identity.platform_user_id = users.id
      where users.seller_status = 'approved_seller'
        and coalesce((users.payload ->> 'disabled')::boolean, false) = false
        and coalesce((users.payload ->> 'isProfileHidden')::boolean, false) = false
        and coalesce((users.payload ->> 'allowProfileSearch')::boolean, true) = true
        and listings.status = 'active'
        and listings.payload ->> 'approvalStatus' = 'approved'
        and (listings.expires_at is null or listings.expires_at > now())
        and (
          ($2::text is null and identity.discord_user_id = $1)
          or (
            $2::text is not null
            and lower(btrim(users.payload ->> 'buyerDisplayName')) = lower(btrim($2))
          )
        )`,
    [input.discordUserId, input.seller],
  );
  const count = result.rows[0]?.listing_count ?? 0;
  return {
    allowed_mentions: { parse: [] },
    content: count > 0
      ? `${count} authoritative public active listing${count === 1 ? "" : "s"} found. Open the marketplace for current terms and availability.`
      : "No eligible public active listing was found. Hidden, suspended, unapproved, and expired listings are never exposed.",
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Open Marketplace",
        url: `${input.siteUrl}/en/usdt-exchange`,
      }],
    }],
  };
}

async function shareMessage(input: {
  pool: Pool;
  siteUrl: string;
  discordUserId: string;
}): Promise<RESTPostAPIChannelMessageJSONBody> {
  const platformUserId = await linkedPlatformUserId(
    input.pool,
    input.discordUserId,
  );
  let guidance =
    "Link your Discord account first. Listing creation and sharing remain website-only.";
  if (platformUserId) {
    const result = await input.pool.query<{
      next_eligible_at: Date | null;
      server_time: Date;
    }>(
      `select cooldown.next_eligible_at, now() as server_time
         from (select 1) base
         left join alpha_exchange.discord_listing_share_cooldowns cooldown
           on cooldown.seller_id = $1`,
      [platformUserId],
    );
    const row = result.rows[0];
    const seconds = row?.next_eligible_at
      ? Math.max(
          0,
          Math.ceil(
            (row.next_eligible_at.getTime() - row.server_time.getTime()) / 1000,
          ),
        )
      : 0;
    guidance = seconds > 0
      ? `Your website share cooldown has about ${Math.ceil(seconds / 3600)} hour(s) remaining. Discord cannot reset or bypass it.`
      : "Use My Listings on the website to share an eligible listing. Discord never claims the cooldown or publishes directly.";
  }
  return {
    allowed_mentions: { parse: [] },
    content: guidance,
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: platformUserId ? "Open My Listings" : "Link Account",
        url: platformUserId
          ? `${input.siteUrl}/en/usdt-exchange`
          : `${input.siteUrl}/en/settings`,
      }],
    }],
  };
}

export class DiscordCommunityCommandService {
  private readonly pool: Pool;
  private readonly gateway: DiscordGatewayClient;
  private readonly rest: REST;
  private readonly applicationId: string;
  private readonly guildId: string;
  private readonly siteUrl: string;
  private unsubscribeInteraction: (() => void) | null = null;
  private diagnostics: DiscordCommunityCommandDiagnostics = {
    status: "degraded",
    registeredCount: null,
    definitionHash: DISCORD_COMMUNITY_COMMAND_DEFINITION_HASH,
    lastReconciledAt: null,
    errorCode: "not_reconciled",
  };

  constructor(input: {
    pool: Pool;
    gateway: DiscordGatewayClient;
    token: string;
    applicationId: string;
    guildId: string;
    siteUrl: string;
    rest?: REST;
  }) {
    this.pool = input.pool;
    this.gateway = input.gateway;
    this.rest = input.rest ?? new REST({ version: "10" }).setToken(input.token);
    this.applicationId = input.applicationId;
    this.guildId = input.guildId;
    this.siteUrl = normalizeMarketSiteUrl(input.siteUrl);
  }

  getDiagnostics(): DiscordCommunityCommandDiagnostics {
    return { ...this.diagnostics };
  }

  async start(): Promise<void> {
    if (this.unsubscribeInteraction) return;
    await this.reconcile();
    this.unsubscribeInteraction = this.gateway.subscribeInteraction(
      (interaction) => {
        void this.handle(interaction).catch((error: unknown) => {
          logEvent("error", {
            event: "discord_interaction_handler",
            outcome: "failed",
            reason: "interaction_handler_failed",
            metadata: {
              commandName: interaction.commandName,
              errorType: error instanceof Error ? error.name : typeof error,
            },
          });
        });
      },
    );
  }

  async shutdown(): Promise<void> {
    this.unsubscribeInteraction?.();
    this.unsubscribeInteraction = null;
  }

  async reconcile(): Promise<void> {
    const route = Routes.applicationGuildCommands(
      this.applicationId,
      this.guildId,
    );
    const remote = await this.rest.get(route) as APIApplicationCommand[];
    const registry = await this.pool.query<{
      command_name: string;
      discord_command_id: string | null;
    }>(
      `select command_name, discord_command_id
         from alpha_exchange.discord_command_registry`,
    );
    const previousOwned = new Map(
      registry.rows.map((row) => [row.command_name, row.discord_command_id]),
    );
    const desiredNames = new Set<string>(
      DISCORD_COMMUNITY_COMMANDS.map((definition) => definition.name),
    );

    for (const staleName of previousOwned.keys()) {
      if (desiredNames.has(staleName)) continue;
      const stale = remote.find((command) =>
        command.name === staleName
        && command.id === previousOwned.get(staleName));
      if (stale) {
        await this.rest.delete(
          Routes.applicationGuildCommand(
            this.applicationId,
            this.guildId,
            stale.id,
          ),
        );
      }
      await this.pool.query(
        `delete from alpha_exchange.discord_command_registry
          where command_name = $1`,
        [staleName],
      );
    }

    for (const definition of DISCORD_COMMUNITY_COMMANDS) {
      const existing = remote.find((command) => command.name === definition.name);
      const body = { ...definition };
      let commandId: string;
      if (!existing) {
        const created = await this.rest.post(route, { body }) as APIApplicationCommand;
        commandId = created.id;
      } else if (commandHash(existing) !== definitionHash(definition)) {
        const updated = await this.rest.patch(
          Routes.applicationGuildCommand(
            this.applicationId,
            this.guildId,
            existing.id,
          ),
          { body },
        ) as APIApplicationCommand;
        commandId = updated.id;
      } else {
        commandId = existing.id;
      }
      await this.pool.query(
        `insert into alpha_exchange.discord_command_registry
           (command_name, discord_command_id, definition_hash, reconciled_at)
         values ($1, $2, $3, now())
         on conflict (command_name) do update set
           discord_command_id = excluded.discord_command_id,
           definition_hash = excluded.definition_hash,
           reconciled_at = now()`,
        [definition.name, commandId, definitionHash(definition)],
      );
    }
    this.diagnostics = {
      status: "ready",
      registeredCount: DISCORD_COMMUNITY_COMMANDS.length,
      definitionHash: DISCORD_COMMUNITY_COMMAND_DEFINITION_HASH,
      lastReconciledAt: new Date().toISOString(),
      errorCode: null,
    };
  }

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    const validContext =
      interaction.guildId === this.guildId
      && interaction.applicationId === this.applicationId
      && isCommunityCommand(interaction.commandName);
    await withTimeout(
      interaction.deferReply({ flags: MessageFlags.Ephemeral }),
      RESPONSE_TIMEOUT_MS,
    );
    if (!validContext) {
      await interaction.editReply({
        content: "This command is not available in this context.",
        allowedMentions: { parse: [] },
      });
      return;
    }

    const commandName = interaction.commandName as DiscordCommunityCommandName;
    const claim = await claimInteraction({
      pool: this.pool,
      interactionId: interaction.id,
      discordUserId: interaction.user.id,
      commandName,
    });
    if (claim === "replayed") {
      await interaction.editReply({
        content: "This interaction was already handled.",
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (claim === "rate_limited") {
      await interaction.editReply({
        content: "Please wait before using this command again.",
        allowedMentions: { parse: [] },
      });
      return;
    }

    try {
      await interaction.editReply(toInteractionReply(
        await this.buildResponse(commandName, interaction),
      ));
    } catch (error) {
      await interaction.editReply({
        content:
          "Alpha Traders could not load this command safely. Please use the website and try again later.",
        allowedMentions: { parse: [] },
      });
      logEvent("error", {
        event: "discord_command_response",
        outcome: "failed",
        reason: "command_response_failed",
        metadata: {
          commandName,
          errorType: error instanceof Error ? error.name : typeof error,
        },
      });
    }
  }

  private async buildResponse(
    commandName: DiscordCommunityCommandName,
    interaction: ChatInputCommandInteraction,
  ): Promise<RESTPostAPIChannelMessageJSONBody> {
    if (commandName === "website") return linksMessage(this.siteUrl);
    if (commandName === "help") return helpMessage(this.siteUrl);
    if (commandName === "share") {
      return shareMessage({
        pool: this.pool,
        siteUrl: this.siteUrl,
        discordUserId: interaction.user.id,
      });
    }
    const repository = new PostgresDiscordMarketContentRepository({
      pool: this.pool,
      siteUrl: this.siteUrl,
    });
    if (commandName === "market") {
      return buildDiscordMarketContentMessage(
        await repository.buildSnapshot("market_activity_digest"),
      );
    }
    if (commandName === "pulse") {
      return buildDiscordMarketContentMessage(
        await repository.buildSnapshot("live_market_pulse"),
      );
    }
    const seller = interaction.options.getString("seller")?.trim() || null;
    if (commandName === "listing") {
      return listingMessage({
        pool: this.pool,
        siteUrl: this.siteUrl,
        discordUserId: interaction.user.id,
        seller,
      });
    }
    const profile = seller
      ? await getPublicDiscordSellerProfileByUsername({
          username: seller,
          pool: this.pool,
          siteUrl: this.siteUrl,
        })
      : await getPublicDiscordSellerProfileByDiscordUserId({
          discordUserId: interaction.user.id,
          pool: this.pool,
          siteUrl: this.siteUrl,
        });
    return profile
      ? buildDiscordSellerProfileCard(profile)
      : {
          allowed_mentions: { parse: [] },
          content:
            "No eligible public seller profile was found. Hidden, suspended, unapproved, and unsearchable sellers are never exposed.",
          components: [{
            type: 1,
            components: [{
              type: 2,
              style: 5,
              label: "Account Settings",
              url: `${this.siteUrl}/en/settings`,
            }],
          }],
        };
  }
}
