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

import { resolveDiscordContactOwnerUrl } from "@/lib/discord/contact-owner-link";
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
import {
  getNextSellerPrestigeRank,
  getSellerPrestigeProgress,
  resolveSellerPrestigeRank,
} from "@/lib/seller-prestige";
import type { SellerLevel } from "@/types/alpha-exchange";
import { buildDiscordSellerProfileCard } from "@/lib/discord/seller-profile-card";
import { logEvent } from "@/lib/structured-logging";

const RESPONSE_TIMEOUT_MS = 2_500;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const COMMAND_RESERVATION_RECOVERY_MINUTES = 5;

export const DISCORD_COMMUNITY_COMMAND_NAMES = [
  "buy",
  "seller",
  "rank",
  "rules",
  "support",
  "exchange",
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
    name: "buy",
    description: "Open buyer onboarding and safe trading guidance",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
  {
    name: "seller",
    description: "Check seller application status and onboarding next step",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
  {
    name: "rank",
    description: "View your private seller rank progress",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
  {
    name: "rules",
    description: "Open seller rules and trust policy guidance",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
  {
    name: "support",
    description: "Open onboarding support and owner contact links",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
  {
    name: "exchange",
    description: "Open the Alpha Exchange marketplace",
    type: ApplicationCommandType.ChatInput,
    dm_permission: false,
  },
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
      await client.query(
        `insert into alpha_exchange.discord_interaction_audit
           (command_name, outcome)
         values ($1, 'replayed')`,
        [input.commandName],
      );
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
    await client.query(
      `insert into alpha_exchange.discord_interaction_audit
         (command_name, outcome)
       values ($1, $2)`,
      [input.commandName, outcome],
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
      "`/buy` — buyer onboarding and safe trading flow",
      "`/seller` — seller application status and next steps",
      "`/rank` — private seller rank progress",
      "`/rules` — seller rules and trust policies",
      "`/support` — onboarding support and owner contact",
      "`/exchange` — open Alpha Exchange marketplace",
      "`/market` and `/pulse` — privacy-safe marketplace totals",
      "`/profile [seller]` — eligible public seller card",
      "`/listing [seller]` — authoritative public listing link",
      "`/share` — open My Listings on the website; never publishes from Discord",
      "`/website` — official links",
      "",
      `New here? Start with Alpha Academy: ${siteUrl}/en/academy`,
      `Safety and rules: ${siteUrl}/en/safety-trust`,
      `Link your account and apply to become an Approved Seller: ${siteUrl}/en/settings`,
    ].join("\n"),
  };
}

function buyMessage(siteUrl: string): RESTPostAPIChannelMessageJSONBody {
  return {
    allowed_mentions: { parse: [] },
    content: [
      "Buyer onboarding starts with platform safety and verified flow:",
      "1) Read buyer guide and safety policy.",
      "2) Open Alpha Exchange and submit a request only through the website.",
      "3) Never share payment details, wallet credentials, or identity documents in Discord.",
    ].join("\n"),
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Open Buyer Guide",
        url: `${siteUrl}/en/academy`,
      }, {
        type: 2,
        style: 5,
        label: "Open Exchange",
        url: `${siteUrl}/en/usdt-exchange`,
      }, {
        type: 2,
        style: 5,
        label: "Safety Center",
        url: `${siteUrl}/en/safety-trust`,
      }],
    }],
  };
}

function rulesMessage(siteUrl: string): RESTPostAPIChannelMessageJSONBody {
  return {
    allowed_mentions: { parse: [] },
    content:
      "Seller rules are enforced from website state: approved listings only, privacy-safe conduct, and no off-platform trade handling in Discord.",
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Seller Rules",
        url: `${siteUrl}/en/safety-trust`,
      }, {
        type: 2,
        style: 5,
        label: "Account Settings",
        url: `${siteUrl}/en/settings`,
      }],
    }],
  };
}

function supportMessage(input: {
  siteUrl: string;
  contactOwnerUrl: string;
}): RESTPostAPIChannelMessageJSONBody {
  return {
    allowed_mentions: { parse: [] },
    content:
      "Use support for onboarding questions. Never post payment proof, wallet credentials, or identity documents in Discord.",
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Open Support",
        url: `${input.siteUrl}/en/contact`,
      }, {
        type: 2,
        style: 5,
        label: "Contact Owner",
        url: input.contactOwnerUrl,
      }],
    }],
  };
}

function exchangeMessage(siteUrl: string): RESTPostAPIChannelMessageJSONBody {
  return {
    allowed_mentions: { parse: [] },
    content: "Open the Alpha Exchange marketplace for live verified listings and buyer requests.",
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Open Exchange",
        url: `${siteUrl}/en/usdt-exchange`,
      }],
    }],
  };
}

type LinkedSellerState = {
  sellerStatus: string;
  rank: SellerLevel;
  volumeUsdt: number;
};

async function linkedSellerState(
  pool: Pool,
  discordUserId: string,
): Promise<LinkedSellerState | null> {
  const result = await pool.query<{
    seller_status: string;
    trust_payload: unknown;
  }>(
    `select users.seller_status,
            trust.payload as trust_payload
       from alpha_exchange.discord_identities identity
       join alpha_exchange.users users
         on users.id = identity.platform_user_id
       left join alpha_exchange.trust_snapshots trust
         on trust.seller_id = users.id
      where identity.discord_user_id = $1
      limit 1`,
    [discordUserId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const trust = row.trust_payload
    && typeof row.trust_payload === "object"
    ? row.trust_payload as { snapshot?: Record<string, unknown> }
    : null;
  const snapshot = trust?.snapshot ?? null;
  const rankRaw = typeof snapshot?.level === "string"
    ? snapshot.level.toLowerCase()
    : null;
  const normalizedRank: SellerLevel | null = rankRaw === "bronze"
    || rankRaw === "silver"
    || rankRaw === "gold"
    || rankRaw === "diamond"
    || rankRaw === "elite"
    ? rankRaw
    : null;
  const volumeRaw = snapshot?.totalUsdtVolume;
  const volume = typeof volumeRaw === "number"
    ? volumeRaw
    : typeof volumeRaw === "string"
      ? Number(volumeRaw)
      : 0;
  const safeVolume = Number.isFinite(volume) ? Math.max(0, volume) : 0;
  return {
    sellerStatus: row.seller_status,
    rank: normalizedRank ?? resolveSellerPrestigeRank(safeVolume),
    volumeUsdt: safeVolume,
  };
}

async function sellerMessage(input: {
  pool: Pool;
  siteUrl: string;
  discordUserId: string;
}): Promise<RESTPostAPIChannelMessageJSONBody> {
  const state = await linkedSellerState(input.pool, input.discordUserId);
  if (!state) {
    return {
      allowed_mentions: { parse: [] },
      content:
        "Link your website account first, then apply to become a seller from Account Settings.",
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: "Link Account",
          url: `${input.siteUrl}/en/settings`,
        }],
      }],
    };
  }
  if (state.sellerStatus === "approved_seller") {
    return {
      allowed_mentions: { parse: [] },
      content:
        "Your account is already approved as a seller. Manage listings and seller settings on the website.",
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: "Seller Dashboard",
          url: `${input.siteUrl}/en/dashboard/seller`,
        }],
      }],
    };
  }
  if (state.sellerStatus === "pending_seller_approval") {
    return {
      allowed_mentions: { parse: [] },
      content:
        "Your seller application is pending review. Discord cannot accelerate approval decisions.",
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: "Open Settings",
          url: `${input.siteUrl}/en/settings`,
        }],
      }],
    };
  }
  if (state.sellerStatus === "suspended") {
    return {
      allowed_mentions: { parse: [] },
      content:
        "Your seller status is suspended. Use website support to resolve compliance or account issues.",
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: "Open Support",
          url: `${input.siteUrl}/en/contact`,
        }],
      }],
    };
  }
  return {
    allowed_mentions: { parse: [] },
    content:
      "Ready to become a seller? Complete your application in Account Settings. Discord cannot submit or edit applications.",
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Become a Seller",
        url: `${input.siteUrl}/en/settings`,
      }],
    }],
  };
}

async function rankMessage(input: {
  pool: Pool;
  siteUrl: string;
  discordUserId: string;
}): Promise<RESTPostAPIChannelMessageJSONBody> {
  const state = await linkedSellerState(input.pool, input.discordUserId);
  if (!state) {
    return {
      allowed_mentions: { parse: [] },
      content:
        "Link your website account to check seller rank progress. Rank details are private to your linked account.",
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: "Link Account",
          url: `${input.siteUrl}/en/settings`,
        }],
      }],
    };
  }
  if (
    state.sellerStatus !== "approved_seller"
    && state.sellerStatus !== "suspended"
  ) {
    return {
      allowed_mentions: { parse: [] },
      content:
        "Seller rank progress is available after seller approval. Apply first from Account Settings.",
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: "Open Settings",
          url: `${input.siteUrl}/en/settings`,
        }],
      }],
    };
  }
  const progress = getSellerPrestigeProgress(state.volumeUsdt, state.rank);
  const nextRank = getNextSellerPrestigeRank(state.rank);
  return {
    allowed_mentions: { parse: [] },
    content: [
      `Your current private seller rank: **${state.rank.toUpperCase()}**`,
      `Lifetime completed volume (private): ${Math.round(state.volumeUsdt).toLocaleString("en-IL")} USDT`,
      nextRank
        ? `Next rank: **${nextRank.toUpperCase()}** (${Math.round(progress.remainingUsdt).toLocaleString("en-IL")} USDT remaining)`
        : "You are at the highest available rank.",
    ].join("\n"),
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "Open Seller Dashboard",
        url: `${input.siteUrl}/en/dashboard/seller`,
      }],
    }],
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
  private readonly contactOwnerUrl: string;
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
    this.contactOwnerUrl = resolveDiscordContactOwnerUrl(this.siteUrl);
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
    const database = await this.pool.connect();
    let locked = false;
    try {
      await database.query(
        "select pg_advisory_lock(hashtext($1))",
        [`discord-community-commands:${this.applicationId}:${this.guildId}`],
      );
      locked = true;
      const route = Routes.applicationGuildCommands(
        this.applicationId,
        this.guildId,
      );
      const remote = await this.rest.get(route) as APIApplicationCommand[];
      const registry = await database.query<{
      command_name: string;
      discord_command_id: string | null;
      definition_hash: string;
    }>(
      `select command_name, discord_command_id, definition_hash
         from alpha_exchange.discord_command_registry`,
    );
    const ownership = new Map(
      registry.rows.map((row) => [row.command_name, {
        commandId: row.discord_command_id,
        definitionHash: row.definition_hash,
      }]),
    );
    const desiredNames = new Set<string>(
      DISCORD_COMMUNITY_COMMANDS.map((definition) => definition.name),
    );
    for (const definition of DISCORD_COMMUNITY_COMMANDS) {
      const reserved = ownership.get(definition.name);
      const sameName = remote.find((command) =>
        command.name === definition.name);
      if (!sameName || sameName.id === reserved?.commandId) continue;
      if (
        reserved
        && reserved.commandId === null
        && commandHash(sameName) === reserved.definitionHash
      ) {
        const recovered = await database.query(
          `update alpha_exchange.discord_command_registry
              set discord_command_id = $2,
                  reconciled_at = now()
            where command_name = $1
              and discord_command_id is null
              and definition_hash = $3`,
          [definition.name, sameName.id, reserved.definitionHash],
        );
        if (recovered.rowCount === 1) {
          reserved.commandId = sameName.id;
          continue;
        }
      }
      this.diagnostics = {
        status: "degraded",
        registeredCount: null,
        definitionHash: DISCORD_COMMUNITY_COMMAND_DEFINITION_HASH,
        lastReconciledAt: null,
        errorCode: "unowned_command_name_conflict",
      };
      throw new Error("unowned_command_name_conflict");
    }

    for (const staleName of ownership.keys()) {
      if (desiredNames.has(staleName)) continue;
      const ownedId = ownership.get(staleName)?.commandId;
      const stale = remote.find((command) =>
        command.name === staleName
        && command.id === ownedId);
      if (stale) {
        await this.rest.delete(
          Routes.applicationGuildCommand(
            this.applicationId,
            this.guildId,
            stale.id,
          ),
        );
      }
      await database.query(
        `delete from alpha_exchange.discord_command_registry
          where command_name = $1`,
        [staleName],
      );
    }

    for (const definition of DISCORD_COMMUNITY_COMMANDS) {
      let reserved = ownership.get(definition.name);
      if (!reserved) {
        const definitionDigest = definitionHash(definition);
        const reservation = await database.query(
          `insert into alpha_exchange.discord_command_registry
             (command_name, discord_command_id, definition_hash, reconciled_at)
           values ($1, null, $2, now())
           on conflict (command_name) do nothing
           returning command_name`,
          [definition.name, definitionDigest],
        );
        if (reservation.rowCount !== 1) {
          throw new Error("command_ownership_changed");
        }
        reserved = {
          commandId: null,
          definitionHash: definitionDigest,
        };
        ownership.set(definition.name, reserved);
      }
      const definitionDigest = definitionHash(definition);
      if (
        reserved.commandId === null
        && reserved.definitionHash !== definitionDigest
      ) {
        const takeover = await database.query(
          `update alpha_exchange.discord_command_registry
              set definition_hash = $3,
                  reconciled_at = now()
            where command_name = $1
              and discord_command_id is null
              and definition_hash = $2
              and reconciled_at <= now()
                - ($4 * interval '1 minute')
          returning command_name`,
          [
            definition.name,
            reserved.definitionHash,
            definitionDigest,
            COMMAND_RESERVATION_RECOVERY_MINUTES,
          ],
        );
        if (takeover.rowCount !== 1) {
          throw new Error("command_reconciliation_pending");
        }
        reserved.definitionHash = definitionDigest;
      }
      const ownedId = reserved.commandId;
      const existing = ownedId
        ? remote.find((command) => command.id === ownedId)
        : undefined;
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
      const completed = await database.query(
        `update alpha_exchange.discord_command_registry
            set discord_command_id = $2,
                definition_hash = $3,
                reconciled_at = now()
          where command_name = $1
            and discord_command_id is not distinct from $4
            and definition_hash = $5
        returning command_name`,
        [
          definition.name,
          commandId,
          definitionDigest,
          ownedId,
          reserved.definitionHash,
        ],
      );
      if (completed.rowCount !== 1) {
        throw new Error("command_ownership_changed");
      }
      reserved.commandId = commandId;
      reserved.definitionHash = definitionDigest;
    }
      this.diagnostics = {
        status: "ready",
        registeredCount: DISCORD_COMMUNITY_COMMANDS.length,
        definitionHash: DISCORD_COMMUNITY_COMMAND_DEFINITION_HASH,
        lastReconciledAt: new Date().toISOString(),
        errorCode: null,
      };
    } finally {
      let destroyClient = false;
      let unlockError: unknown;
      if (locked) {
        try {
          await database.query(
            "select pg_advisory_unlock(hashtext($1))",
            [`discord-community-commands:${this.applicationId}:${this.guildId}`],
          );
        } catch (error: unknown) {
          destroyClient = true;
          unlockError = error;
        }
      }
      database.release(destroyClient);
      if (unlockError) throw unlockError;
    }
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
    if (commandName === "buy") return buyMessage(this.siteUrl);
    if (commandName === "rules") return rulesMessage(this.siteUrl);
    if (commandName === "support") {
      return supportMessage({
        siteUrl: this.siteUrl,
        contactOwnerUrl: this.contactOwnerUrl,
      });
    }
    if (commandName === "exchange") return exchangeMessage(this.siteUrl);
    if (commandName === "seller") {
      return sellerMessage({
        pool: this.pool,
        siteUrl: this.siteUrl,
        discordUserId: interaction.user.id,
      });
    }
    if (commandName === "rank") {
      return rankMessage({
        pool: this.pool,
        siteUrl: this.siteUrl,
        discordUserId: interaction.user.id,
      });
    }
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
