import "server-only";

import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  REST,
  Routes,
} from "discord.js";

import type { EnvironmentValues } from "@/lib/env-validation";

export const DISCORD_LAYER_A_PERMISSION_BITSET = "93200";
export const DISCORD_LAYER_A_WITH_MANAGE_ROLES_BITSET = "268528656";

export const DISCORD_MANAGED_RESOURCE_KEYS = [
  "seller_category",
  "seller_lounge",
  "seller_announcements",
  "seller_updates",
  "seller_guides",
  "seller_support",
  "marketplace_listings",
] as const;

export type DiscordManagedResourceKey =
  (typeof DISCORD_MANAGED_RESOURCE_KEYS)[number];
export type DiscordManagedResourceType = "category" | "text_channel";
export type DiscordResourceAction =
  | "created"
  | "recovered"
  | "repaired"
  | "verified";
export type DiscordResourceDisplayNames = Record<
  DiscordManagedResourceKey,
  string
>;

export type DiscordPersistedResource = {
  discordId: string | null;
  resourceType: DiscordManagedResourceType;
  displayName: string;
  provisioningToken: string;
};

export type DiscordReconciledResource = {
  key: DiscordManagedResourceKey;
  discordId: string;
  resourceType: DiscordManagedResourceType;
  displayName: string;
  action: DiscordResourceAction;
};

export type DiscordResourceOperationErrorCode =
  | "approved_role_missing"
  | "channel_permission_rejected"
  | "channel_limit_reached"
  | "excessive_bot_permissions"
  | "missing_channel_permissions"
  | "missing_manage_channels"
  | "missing_manage_roles"
  | "reconciliation_lease_lost"
  | "role_hierarchy"
  | "unsafe_guild_role_permissions"
  | "api_failure";

type PermissionOverwrite = {
  id: string;
  type: number;
  allow: string;
  deny: string;
};

type ApiChannel = {
  id: string;
  type: number;
  name: string;
  parent_id: string | null;
  permission_overwrites?: PermissionOverwrite[];
};

type ApiRole = {
  id: string;
  permissions: string;
  position: number;
  managed?: boolean;
  tags?: {
    bot_id?: string;
  };
};

type ApiMember = {
  roles: string[];
};

type ApiUser = {
  id: string;
};

type ManagedOverwrite = {
  id: string;
  type: 0 | 1;
  allow: bigint;
  deny: bigint;
};

type ResourceDefinition = {
  key: DiscordManagedResourceKey;
  resourceType: DiscordManagedResourceType;
  parentKey: "seller_category" | null;
  topic?: string;
  sellerCanSend: boolean;
  publicRead: boolean;
};

const RESOURCE_DEFINITIONS: readonly ResourceDefinition[] = [
  {
    key: "seller_category",
    resourceType: "category",
    parentKey: null,
    sellerCanSend: false,
    publicRead: false,
  },
  {
    key: "seller_lounge",
    resourceType: "text_channel",
    parentKey: "seller_category",
    topic: "Private conversation space for approved Alpha Traders sellers.",
    sellerCanSend: true,
    publicRead: false,
  },
  {
    key: "seller_announcements",
    resourceType: "text_channel",
    parentKey: "seller_category",
    topic: "Official announcements for approved Alpha Traders sellers.",
    sellerCanSend: false,
    publicRead: false,
  },
  {
    key: "seller_updates",
    resourceType: "text_channel",
    parentKey: "seller_category",
    topic: "Operational and marketplace updates for approved sellers.",
    sellerCanSend: false,
    publicRead: false,
  },
  {
    key: "seller_guides",
    resourceType: "text_channel",
    parentKey: "seller_category",
    topic: "Approved seller guides and operating standards.",
    sellerCanSend: false,
    publicRead: false,
  },
  {
    key: "seller_support",
    resourceType: "text_channel",
    parentKey: "seller_category",
    topic: "Private support channel for approved sellers.",
    sellerCanSend: true,
    publicRead: false,
  },
  {
    key: "marketplace_listings",
    resourceType: "text_channel",
    parentKey: null,
    topic: "Automated Alpha Traders marketplace listings. Posting is bot-only.",
    sellerCanSend: false,
    publicRead: true,
  },
];

const DEFAULT_DISPLAY_NAMES: DiscordResourceDisplayNames = {
  seller_category: "ALPHA SELLER SUITE",
  seller_lounge: "seller-lounge",
  seller_announcements: "seller-announcements",
  seller_updates: "seller-updates",
  seller_guides: "seller-guides",
  seller_support: "seller-support",
  marketplace_listings: "marketplace-listings",
};

const DISPLAY_NAME_ENV: Record<DiscordManagedResourceKey, string> = {
  seller_category: "DISCORD_SELLER_CATEGORY_NAME",
  seller_lounge: "DISCORD_SELLER_LOUNGE_CHANNEL_NAME",
  seller_announcements: "DISCORD_SELLER_ANNOUNCEMENTS_CHANNEL_NAME",
  seller_updates: "DISCORD_SELLER_UPDATES_CHANNEL_NAME",
  seller_guides: "DISCORD_SELLER_GUIDES_CHANNEL_NAME",
  seller_support: "DISCORD_SELLER_SUPPORT_CHANNEL_NAME",
  marketplace_listings: "DISCORD_MARKETPLACE_LISTINGS_CHANNEL_NAME",
};

const VIEW_AND_READ =
  PermissionFlagsBits.ViewChannel
  | PermissionFlagsBits.ReadMessageHistory;
const BOT_PUBLISH =
  VIEW_AND_READ
  | PermissionFlagsBits.ManageChannels
  | PermissionFlagsBits.SendMessages
  | PermissionFlagsBits.EmbedLinks
  | PermissionFlagsBits.ManageMessages;
const PRIVILEGE_ESCALATION_PERMISSIONS =
  PermissionFlagsBits.ManageChannels
  | PermissionFlagsBits.ManageMessages
  | PermissionFlagsBits.ManageRoles
  | PermissionFlagsBits.ManageWebhooks
  | PermissionFlagsBits.UseExternalApps;
const BOT_UNMANAGEABLE_OVERWRITE_PERMISSIONS =
  PermissionFlagsBits.Administrator
  | PermissionFlagsBits.ManageRoles
  | PermissionFlagsBits.ManageWebhooks
  | PermissionFlagsBits.ManageThreads
  | PermissionFlagsBits.PinMessages;
const BOT_MANAGEABLE_PRIVILEGE_ESCALATION_PERMISSIONS =
  PRIVILEGE_ESCALATION_PERMISSIONS
  & ~BOT_UNMANAGEABLE_OVERWRITE_PERMISSIONS;
const USER_POSTING =
  PermissionFlagsBits.SendMessages
  | PermissionFlagsBits.AddReactions
  | PermissionFlagsBits.CreatePublicThreads
  | PermissionFlagsBits.CreatePrivateThreads
  | PermissionFlagsBits.SendMessagesInThreads
  | PermissionFlagsBits.UseApplicationCommands
  | PermissionFlagsBits.SendVoiceMessages
  | PermissionFlagsBits.SendPolls
  | BOT_MANAGEABLE_PRIVILEGE_ESCALATION_PERMISSIONS;
const MANAGED_PERMISSION_MASK =
  VIEW_AND_READ
  | BOT_PUBLISH
  | USER_POSTING
  | BOT_UNMANAGEABLE_OVERWRITE_PERMISSIONS;
const REQUIRED_BOT_PERMISSIONS =
  PermissionFlagsBits.ManageRoles
  | PermissionFlagsBits.ManageChannels
  | PermissionFlagsBits.SendMessages
  | PermissionFlagsBits.EmbedLinks
  | PermissionFlagsBits.ManageMessages
  | PermissionFlagsBits.ViewChannel
  | PermissionFlagsBits.ReadMessageHistory;
const FORBIDDEN_BOT_PERMISSIONS =
  PermissionFlagsBits.Administrator
  | PermissionFlagsBits.BanMembers
  | PermissionFlagsBits.KickMembers
  | PermissionFlagsBits.ManageGuild
  | PermissionFlagsBits.ManageThreads
  | PermissionFlagsBits.ManageWebhooks
  | PermissionFlagsBits.MentionEveryone
  | PermissionFlagsBits.ModerateMembers
  | PermissionFlagsBits.ViewAuditLog;
const TRUSTED_STAFF_PERMISSIONS = [
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
] as const;

export class DiscordResourceConfigurationError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`Discord resource display name configuration is invalid (${variable}).`);
    this.name = "DiscordResourceConfigurationError";
    this.variable = variable;
  }
}

export class DiscordResourceOperationError extends Error {
  readonly code: DiscordResourceOperationErrorCode;

  constructor(code: DiscordResourceOperationErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "DiscordResourceOperationError";
    this.code = code;
  }
}

class DiscordResourcePersistenceError extends Error {
  readonly original: unknown;

  constructor(original: unknown) {
    super("Discord resource persistence callback failed.", { cause: original });
    this.name = "DiscordResourcePersistenceError";
    this.original = original;
  }
}

async function runPersistenceCallback(
  callback: ((resource: DiscordReconciledResource) => Promise<void>) | undefined,
  resource: DiscordReconciledResource,
): Promise<void> {
  if (!callback) return;
  try {
    await callback(resource);
  } catch (error) {
    throw new DiscordResourcePersistenceError(error);
  }
}

export interface DiscordResourceManager {
  reconcileResources(input: {
    persisted: Partial<Record<DiscordManagedResourceKey, DiscordPersistedResource>>;
    approvedSellerRoleId: string;
    displayNames: DiscordResourceDisplayNames;
    persistResolvedResource?: (
      resource: DiscordReconciledResource,
    ) => Promise<void>;
    persistReconciledResource?: (
      resource: DiscordReconciledResource,
    ) => Promise<void>;
    beforeResourceReconcile?: () => Promise<void>;
  }): Promise<DiscordReconciledResource[]>;
}

export function readDiscordResourceDisplayNames(
  env: EnvironmentValues = process.env,
): DiscordResourceDisplayNames {
  const entries = DISCORD_MANAGED_RESOURCE_KEYS.map((key) => {
    const variable = DISPLAY_NAME_ENV[key];
    const configured = env[variable]?.trim();
    const name = configured || DEFAULT_DISPLAY_NAMES[key];
    const valid = key === "seller_category"
      ? name.length >= 1 && name.length <= 100
      : /^[a-z0-9][a-z0-9_-]{0,99}$/.test(name);
    if (!valid) throw new DiscordResourceConfigurationError(variable);
    return [key, name] as const;
  });
  const channelNames = entries.filter(([key]) => key !== "seller_category");
  if (new Set(channelNames.map(([, name]) => name)).size !== channelNames.length) {
    throw new DiscordResourceConfigurationError("Discord channel display names");
  }
  return Object.fromEntries(entries) as DiscordResourceDisplayNames;
}

function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function provisioningName(
  key: DiscordManagedResourceKey,
  token: string,
): string {
  return `alpha-provision-${key.replaceAll("_", "-")}-${token.slice(0, 12)}`;
}

function apiErrorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function channelType(resourceType: DiscordManagedResourceType): ChannelType {
  return resourceType === "category"
    ? ChannelType.GuildCategory
    : ChannelType.GuildText;
}

function compareRolePositions(left: ApiRole, right: ApiRole): number {
  if (left.position !== right.position) return left.position - right.position;
  if (left.id === right.id) return 0;
  return BigInt(right.id) > BigInt(left.id) ? 1 : -1;
}

function replaceManagedPermissions(
  current: PermissionOverwrite | undefined,
  desired: ManagedOverwrite,
): { allow: string; deny: string } {
  const currentAllow = BigInt(current?.allow ?? "0");
  const currentDeny = BigInt(current?.deny ?? "0");
  return {
    allow: ((currentAllow & ~MANAGED_PERMISSION_MASK) | desired.allow).toString(),
    deny: ((currentDeny & ~MANAGED_PERMISSION_MASK) | desired.deny).toString(),
  };
}

function overwriteMatches(
  current: PermissionOverwrite | undefined,
  desired: ManagedOverwrite,
): boolean {
  if (!current || current.type !== desired.type) return false;
  const replacement = replaceManagedPermissions(current, desired);
  return current.allow === replacement.allow && current.deny === replacement.deny;
}

function hasTrustedStaffPermission(
  overwrite: PermissionOverwrite,
  roles: ApiRole[],
): boolean {
  if (overwrite.type !== 0) return false;
  const role = roles.find((candidate) => candidate.id === overwrite.id);
  if (!role) return false;
  return hasTrustedStaffRolePermission(role);
}

function hasTrustedStaffRolePermission(role: ApiRole): boolean {
  const permissions = BigInt(role.permissions);
  return TRUSTED_STAFF_PERMISSIONS.some(
    (permission) => (permissions & permission) === permission,
  );
}

function unsafeUntrustedAllowMask(
  definition: ResourceDefinition,
): bigint {
  if (definition.publicRead) {
    return USER_POSTING | BOT_UNMANAGEABLE_OVERWRITE_PERMISSIONS;
  }
  if (definition.resourceType === "category" || definition.sellerCanSend) {
    return PermissionFlagsBits.ViewChannel
      | PRIVILEGE_ESCALATION_PERMISSIONS
      | BOT_UNMANAGEABLE_OVERWRITE_PERMISSIONS;
  }
  return PermissionFlagsBits.ViewChannel
    | USER_POSTING
    | BOT_UNMANAGEABLE_OVERWRITE_PERMISSIONS;
}

export function managedResourceOverwrites(input: {
  definition: ResourceDefinition;
  guildId: string;
  approvedSellerRoleId: string;
  botId: string;
}): ManagedOverwrite[] {
  const { definition, guildId, approvedSellerRoleId, botId } = input;
  if (definition.publicRead) {
    return [
      { id: guildId, type: 0, allow: VIEW_AND_READ, deny: USER_POSTING },
      {
        id: approvedSellerRoleId,
        type: 0,
        allow: VIEW_AND_READ,
        deny: USER_POSTING,
      },
      { id: botId, type: 1, allow: BOT_PUBLISH, deny: BigInt(0) },
    ];
  }

  if (definition.resourceType === "category") {
    return [
      {
        id: guildId,
        type: 0,
        allow: BigInt(0),
        deny:
          PermissionFlagsBits.ViewChannel
          | PermissionFlagsBits.ManageChannels,
      },
      {
        id: approvedSellerRoleId,
        type: 0,
        allow: VIEW_AND_READ,
        deny: PermissionFlagsBits.ManageChannels,
      },
      {
        id: botId,
        type: 1,
        allow:
          VIEW_AND_READ
          | PermissionFlagsBits.ManageChannels,
        deny: BigInt(0),
      },
    ];
  }

  return [
    {
      id: guildId,
      type: 0,
      allow: BigInt(0),
      deny:
        PermissionFlagsBits.ViewChannel
        | BOT_MANAGEABLE_PRIVILEGE_ESCALATION_PERMISSIONS,
    },
    {
      id: approvedSellerRoleId,
      type: 0,
      allow: VIEW_AND_READ
        | (
          definition.sellerCanSend
            ? PermissionFlagsBits.SendMessages
            : BigInt(0)
        ),
      deny: definition.sellerCanSend
        ? BOT_MANAGEABLE_PRIVILEGE_ESCALATION_PERMISSIONS
        : USER_POSTING,
    },
    { id: botId, type: 1, allow: BOT_PUBLISH, deny: BigInt(0) },
  ];
}

export class DiscordRestResourceManager implements DiscordResourceManager {
  private readonly rest: REST;
  private readonly guildId: string;

  constructor(input: { token: string; guildId: string; rest?: REST }) {
    this.rest = input.rest ?? new REST({ version: "10" }).setToken(input.token);
    this.guildId = input.guildId;
  }

  async reconcileResources(input: {
    persisted: Partial<Record<DiscordManagedResourceKey, DiscordPersistedResource>>;
    approvedSellerRoleId: string;
    displayNames: DiscordResourceDisplayNames;
    persistResolvedResource?: (
      resource: DiscordReconciledResource,
    ) => Promise<void>;
    persistReconciledResource?: (
      resource: DiscordReconciledResource,
    ) => Promise<void>;
    beforeResourceReconcile?: () => Promise<void>;
  }): Promise<DiscordReconciledResource[]> {
    try {
      const [channels, roles, bot] = await Promise.all([
        this.fetchChannels(),
        this.fetchRoles(),
        this.rest.get(Routes.user("@me")) as Promise<ApiUser>,
      ]);
      if (!isSnowflake(bot.id)) {
        throw new DiscordResourceOperationError("api_failure");
      }
      await this.assertAuthorized(roles, bot.id, input.approvedSellerRoleId);

      const resolved = new Map<DiscordManagedResourceKey, ApiChannel>();
      const reconciled: DiscordReconciledResource[] = [];
      for (const definition of RESOURCE_DEFINITIONS) {
        await input.beforeResourceReconcile?.();
        const displayName = input.displayNames[definition.key];
        const expectedParent = definition.parentKey
          ? resolved.get(definition.parentKey)?.id ?? null
          : null;
        const persisted = input.persisted[definition.key];
        let channel = channels.find((candidate) =>
          candidate.id === persisted?.discordId
          && candidate.type === channelType(definition.resourceType));

        let action: DiscordResourceAction = "verified";
        if (!channel) {
          const recoveryName = persisted
            ? provisioningName(definition.key, persisted.provisioningToken)
            : null;
          channel = recoveryName
            ? channels.find((candidate) =>
                candidate.type === channelType(definition.resourceType)
                && candidate.name === recoveryName
                && (
                  definition.resourceType === "category"
                  || candidate.parent_id === expectedParent
                ))
            : undefined;
          if (channel) {
            action = "recovered";
          } else {
            if (!persisted) {
              throw new DiscordResourceOperationError("api_failure");
            }
            channel = await this.createResource({
              definition,
              provisioningToken: persisted.provisioningToken,
              parentId: expectedParent,
              approvedSellerRoleId: input.approvedSellerRoleId,
              botId: bot.id,
            });
            channels.push(channel);
            action = "created";
          }
          await runPersistenceCallback(input.persistResolvedResource, {
            key: definition.key,
            discordId: channel.id,
            resourceType: definition.resourceType,
            displayName,
            action,
          });
        }

        const repaired = await this.repairResource({
          channel,
          roles,
          definition,
          displayName,
          parentId: expectedParent,
          approvedSellerRoleId: input.approvedSellerRoleId,
          botId: bot.id,
        });
        if (action === "verified" && repaired) action = "repaired";

        const resource = {
          key: definition.key,
          discordId: channel.id,
          resourceType: definition.resourceType,
          displayName,
          action,
        };
        await runPersistenceCallback(input.persistReconciledResource, resource);
        resolved.set(definition.key, channel);
        reconciled.push(resource);
      }
      return reconciled;
    } catch (error) {
      if (error instanceof DiscordResourcePersistenceError) {
        throw error.original;
      }
      if (error instanceof DiscordResourceOperationError) throw error;
      const code = apiErrorCode(error);
      if (code === 30013) {
        throw new DiscordResourceOperationError("channel_limit_reached", {
          cause: error,
        });
      }
      throw new DiscordResourceOperationError("api_failure", { cause: error });
    }
  }

  private async fetchChannels(): Promise<ApiChannel[]> {
    const channels = await this.rest.get(Routes.guildChannels(this.guildId));
    if (!Array.isArray(channels)) {
      throw new DiscordResourceOperationError("api_failure");
    }
    return channels as ApiChannel[];
  }

  private async fetchRoles(): Promise<ApiRole[]> {
    const roles = await this.rest.get(Routes.guildRoles(this.guildId));
    if (!Array.isArray(roles)) {
      throw new DiscordResourceOperationError("api_failure");
    }
    return roles as ApiRole[];
  }

  private async assertAuthorized(
    roles: ApiRole[],
    botId: string,
    approvedSellerRoleId: string,
  ): Promise<void> {
    const member = await this.rest.get(
      Routes.guildMember(this.guildId, botId),
    ) as ApiMember;
    const botRoles = roles.filter((role) =>
      role.id === this.guildId || member.roles.includes(role.id));
    const permissions = botRoles.reduce(
      (combined, role) => combined.add(BigInt(role.permissions)),
      new PermissionsBitField(),
    );
    if ((permissions.bitfield & FORBIDDEN_BOT_PERMISSIONS) !== BigInt(0)) {
      throw new DiscordResourceOperationError("excessive_bot_permissions");
    }
    if (!permissions.has(PermissionFlagsBits.ManageChannels, false)) {
      throw new DiscordResourceOperationError("missing_manage_channels");
    }
    if (!permissions.has(PermissionFlagsBits.ManageRoles, false)) {
      throw new DiscordResourceOperationError("missing_manage_roles");
    }
    if (!permissions.has(REQUIRED_BOT_PERMISSIONS, false)) {
      throw new DiscordResourceOperationError("missing_channel_permissions");
    }
    const unsafeGuildRole = roles.find((role) =>
      role.tags?.bot_id !== botId
      && (
        role.id === this.guildId
        || role.id === approvedSellerRoleId
        || !hasTrustedStaffRolePermission(role)
      )
      && (
        BigInt(role.permissions) & BOT_UNMANAGEABLE_OVERWRITE_PERMISSIONS
      ) !== BigInt(0));
    if (unsafeGuildRole) {
      throw new DiscordResourceOperationError("unsafe_guild_role_permissions");
    }

    const approvedRole = roles.find((role) => role.id === approvedSellerRoleId);
    if (!approvedRole) {
      throw new DiscordResourceOperationError("approved_role_missing");
    }
    const highestBotRole = botRoles.reduce((highest, role) =>
      compareRolePositions(role, highest) > 0 ? role : highest);
    if (compareRolePositions(highestBotRole, approvedRole) <= 0) {
      throw new DiscordResourceOperationError("role_hierarchy");
    }
  }

  private async createResource(input: {
    definition: ResourceDefinition;
    provisioningToken: string;
    parentId: string | null;
    approvedSellerRoleId: string;
    botId: string;
  }): Promise<ApiChannel> {
    const overwrites = managedResourceOverwrites({
      definition: input.definition,
      guildId: this.guildId,
      approvedSellerRoleId: input.approvedSellerRoleId,
      botId: input.botId,
    });
    let created: ApiChannel;
    try {
      created = await this.rest.post(Routes.guildChannels(this.guildId), {
        body: {
          name: provisioningName(
            input.definition.key,
            input.provisioningToken,
          ),
          type: channelType(input.definition.resourceType),
          ...(input.definition.resourceType === "text_channel"
            ? {
                parent_id: input.parentId,
                topic: input.definition.topic,
              }
            : {}),
          permission_overwrites: overwrites.map((overwrite) => ({
            id: overwrite.id,
            type: overwrite.type,
            allow: overwrite.allow.toString(),
            deny: overwrite.deny.toString(),
          })),
        },
        reason: `Alpha Traders managed Discord resource: ${input.definition.key}`,
      }) as ApiChannel;
    } catch (error) {
      const code = apiErrorCode(error);
      if (code === 50001 || code === 50013) {
        throw new DiscordResourceOperationError("channel_permission_rejected", {
          cause: error,
        });
      }
      throw error;
    }
    if (
      !isSnowflake(created.id)
      || created.type !== channelType(input.definition.resourceType)
    ) {
      throw new DiscordResourceOperationError("api_failure");
    }
    created.permission_overwrites ??= overwrites.map((overwrite) => ({
      id: overwrite.id,
      type: overwrite.type,
      allow: overwrite.allow.toString(),
      deny: overwrite.deny.toString(),
    }));
    return created;
  }

  private async repairResource(input: {
    channel: ApiChannel;
    roles: ApiRole[];
    definition: ResourceDefinition;
    displayName: string;
    parentId: string | null;
    approvedSellerRoleId: string;
    botId: string;
  }): Promise<boolean> {
    const expectedParent = input.definition.resourceType === "category"
      ? null
      : input.parentId;
    const desiredOverwrites = managedResourceOverwrites({
      definition: input.definition,
      guildId: this.guildId,
      approvedSellerRoleId: input.approvedSellerRoleId,
      botId: input.botId,
    });
    const nextOverwrites = (input.channel.permission_overwrites ?? []).map(
      (overwrite) => ({ ...overwrite }),
    );
    let permissionsChanged = false;
    for (const desired of desiredOverwrites) {
      const current = nextOverwrites.find(
        (overwrite) => overwrite.id === desired.id,
      );
      if (overwriteMatches(current, desired)) continue;
      const replacement = replaceManagedPermissions(current, desired);
      const updated = {
        id: desired.id,
        type: desired.type,
        ...replacement,
      };
      if (current) Object.assign(current, updated);
      else nextOverwrites.push(updated);
      permissionsChanged = true;
    }

    const managedSubjectIds = new Set(
      desiredOverwrites.map((overwrite) => overwrite.id),
    );
    const unsafeAllowMask = unsafeUntrustedAllowMask(input.definition);
    for (const current of nextOverwrites) {
      if (hasTrustedStaffPermission(current, input.roles)) continue;
      const currentAllow = BigInt(current.allow);
      const currentDeny = BigInt(current.deny);
      const removableAllowMask = managedSubjectIds.has(current.id)
        ? BOT_UNMANAGEABLE_OVERWRITE_PERMISSIONS
        : unsafeAllowMask;
      const replacement = {
        allow: (currentAllow & ~removableAllowMask).toString(),
        deny: (
          currentDeny & ~BOT_UNMANAGEABLE_OVERWRITE_PERMISSIONS
        ).toString(),
      };
      if (
        replacement.allow === current.allow
        && replacement.deny === current.deny
      ) continue;
      Object.assign(current, replacement);
      permissionsChanged = true;
    }
    const patchBody: {
      name?: string;
      parent_id?: string | null;
      permission_overwrites?: PermissionOverwrite[];
    } = {
      ...(input.channel.name !== input.displayName
        ? { name: input.displayName }
        : {}),
      ...(input.channel.parent_id !== expectedParent
        ? { parent_id: expectedParent }
        : {}),
    };
    if (permissionsChanged) {
      if (nextOverwrites.some((overwrite) =>
        (
          (BigInt(overwrite.allow) | BigInt(overwrite.deny))
          & BOT_UNMANAGEABLE_OVERWRITE_PERMISSIONS
        ) !== BigInt(0))) {
        throw new DiscordResourceOperationError("channel_permission_rejected");
      }
      patchBody.permission_overwrites = nextOverwrites;
    }
    if (Object.keys(patchBody).length === 0) return false;
    try {
      await this.rest.patch(Routes.channel(input.channel.id), {
        body: patchBody,
        reason: `Alpha Traders managed Discord resource repair: ${input.definition.key}`,
      });
    } catch (error) {
      const code = apiErrorCode(error);
      if (
        patchBody.permission_overwrites
        && (code === 50001 || code === 50013)
      ) {
        throw new DiscordResourceOperationError("channel_permission_rejected", {
          cause: error,
        });
      }
      throw error;
    }
    input.channel.name = input.displayName;
    input.channel.parent_id = expectedParent;
    if (permissionsChanged) {
      input.channel.permission_overwrites = nextOverwrites;
    }
    return true;
  }
}

export { RESOURCE_DEFINITIONS as DISCORD_MANAGED_RESOURCE_DEFINITIONS };
export { provisioningName as discordResourceProvisioningName };
