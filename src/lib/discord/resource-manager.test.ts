// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ChannelType,
  PermissionFlagsBits,
  type REST,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DISCORD_LAYER_A_PERMISSION_BITSET,
  DISCORD_LAYER_A_WITH_MANAGE_ROLES_BITSET,
  DISCORD_MANAGED_RESOURCE_DEFINITIONS,
  DiscordRestResourceManager,
  discordResourceProvisioningName,
  readDiscordResourceDisplayNames,
  type DiscordManagedResourceKey,
  type DiscordPersistedResource,
  type DiscordResourceDisplayNames,
} from "@/lib/discord/resource-manager";

const guildId = "111111111111111111";
const botId = "222222222222222222";
const botRoleId = "333333333333333333";
const approvedRoleId = "444444444444444444";
const unrelatedRoleId = "555555555555555555";
const moderatorRoleId = "555555555555555556";
const additionalBotRoleId = "555555555555555557";
const requiredBotPermissions = DISCORD_LAYER_A_WITH_MANAGE_ROLES_BITSET;
const displayNames: DiscordResourceDisplayNames =
  readDiscordResourceDisplayNames({});
const managedResourceCount = DISCORD_MANAGED_RESOURCE_DEFINITIONS.length;
const provisioningToken = "123e4567-e89b-42d3-a456-426614174000";

function seededPersisted(): Partial<
  Record<DiscordManagedResourceKey, DiscordPersistedResource>
> {
  return Object.fromEntries(DISCORD_MANAGED_RESOURCE_DEFINITIONS.map(
    (definition) => [
      definition.key,
      {
        discordId: null,
        resourceType: definition.resourceType,
        displayName: displayNames[definition.key],
        provisioningToken,
      },
    ],
  ));
}

type FakeChannel = {
  id: string;
  type: number;
  name: string;
  parent_id: string | null;
  topic?: string | null;
  position?: number;
  permission_overwrites: Array<{
    id: string;
    type: number;
    allow: string;
    deny: string;
  }>;
};

function fakeDiscord(input: {
  additionalBotRolePermissions?: string;
  approvedRolePermissions?: string;
  channelCreateErrorCode?: number;
  everyonePermissions?: string;
  moderatorRolePermissions?: string;
  patchErrorCode?: number;
  permissions?: string;
  rejectUnsupportedOverwritePermissions?: boolean;
  roleFetchErrorCode?: number;
  unrelatedRolePermissions?: string;
} = {}) {
  const channels: FakeChannel[] = [];
  let nextId = BigInt("600000000000000000");
  const roles = [
    {
      id: guildId,
      permissions: input.everyonePermissions ?? "0",
      position: 0,
    },
    {
      id: botRoleId,
      permissions: input.permissions ?? requiredBotPermissions,
      position: 10,
      managed: true,
      tags: { bot_id: botId },
    },
    {
      id: approvedRoleId,
      permissions: input.approvedRolePermissions ?? "0",
      position: 3,
    },
    {
      id: unrelatedRoleId,
      permissions: input.unrelatedRolePermissions ?? "0",
      position: 2,
    },
    {
      id: additionalBotRoleId,
      permissions: input.additionalBotRolePermissions ?? "0",
      position: 5,
    },
    {
      id: moderatorRoleId,
      permissions: input.moderatorRolePermissions
        ?? PermissionFlagsBits.ManageMessages.toString(),
      position: 4,
    },
  ];
  const get = vi.fn(async (route: string) => {
    if (route.includes("/users/%40me")) return { id: botId };
    if (route.endsWith(`/members/${botId}`)) {
      return { roles: [botRoleId, additionalBotRoleId] };
    }
    if (route.endsWith("/roles")) {
      if (input.roleFetchErrorCode) {
        throw Object.assign(
          new Error("Discord role fetch rejected"),
          { code: input.roleFetchErrorCode },
        );
      }
      return roles;
    }
    if (route.endsWith("/channels")) return structuredClone(channels);
    throw new Error(`Unexpected GET ${route}`);
  });
  const post = vi.fn(async (_route: string, options: {
    body: Record<string, unknown>;
  }) => {
    if (input.channelCreateErrorCode) {
      throw Object.assign(
        new Error("Discord channel create rejected"),
        { code: input.channelCreateErrorCode },
      );
    }
    if (input.rejectUnsupportedOverwritePermissions) {
      const unsupported =
        PermissionFlagsBits.Administrator
        | PermissionFlagsBits.ManageRoles
        | PermissionFlagsBits.ManageWebhooks
        | PermissionFlagsBits.ManageThreads
        | PermissionFlagsBits.PinMessages;
      const overwrites =
        options.body.permission_overwrites as FakeChannel["permission_overwrites"];
      if (overwrites.some((overwrite) =>
        ((BigInt(overwrite.allow) | BigInt(overwrite.deny)) & unsupported)
          !== BigInt(0))) {
        throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
      }
    }
    nextId += BigInt(1);
    const created: FakeChannel = {
      id: nextId.toString(),
      type: options.body.type as number,
      name: options.body.name as string,
      parent_id: (options.body.parent_id as string | undefined) ?? null,
      topic: (options.body.topic as string | undefined) ?? null,
      position: channels.length,
      permission_overwrites: structuredClone(
        options.body.permission_overwrites as FakeChannel["permission_overwrites"],
      ),
    };
    channels.push(created);
    return created;
  });
  const patch = vi.fn(async (route: string, options: {
    body: Array<{
      id: string;
      position: number;
      parent_id: string;
    }> | {
      name?: string;
      parent_id?: string | null;
      topic?: string;
      permission_overwrites?: FakeChannel["permission_overwrites"];
    };
  }) => {
    if (Array.isArray(options.body)) {
      for (const update of options.body) {
        const channel = channels.find((candidate) => candidate.id === update.id);
        if (!channel) throw new Error(`Unknown channel ${update.id}`);
        channel.position = update.position;
        channel.parent_id = update.parent_id;
      }
      return channels;
    }
    const channel = channels.find((candidate) => route.endsWith(candidate.id));
    if (!channel) throw new Error(`Unknown channel ${route}`);
    if (input.patchErrorCode) {
      throw Object.assign(
        new Error("Discord channel patch rejected"),
        { code: input.patchErrorCode },
      );
    }
    if (
      input.rejectUnsupportedOverwritePermissions
      && options.body.permission_overwrites
    ) {
      const unsupported =
        PermissionFlagsBits.Administrator
        | PermissionFlagsBits.ManageRoles
        | PermissionFlagsBits.ManageWebhooks
        | PermissionFlagsBits.ManageThreads
        | PermissionFlagsBits.PinMessages;
      if (options.body.permission_overwrites.some((overwrite) =>
        ((BigInt(overwrite.allow) | BigInt(overwrite.deny)) & unsupported)
          !== BigInt(0))) {
        throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
      }
    }
    Object.assign(channel, options.body);
    return channel;
  });
  const put = vi.fn(async (route: string, options: {
    body: { type: number; allow: string; deny: string };
  }) => {
    const channel = channels.find((candidate) => route.includes(candidate.id));
    if (!channel) throw new Error(`Unknown channel ${route}`);
    const overwriteId = route.split("/").at(-1)!;
    const current = channel.permission_overwrites.find(
      (overwrite) => overwrite.id === overwriteId,
    );
    const next = { id: overwriteId, ...options.body };
    if (current) Object.assign(current, next);
    else channel.permission_overwrites.push(next);
  });
  return {
    channels,
    rest: { get, post, patch, put, delete: vi.fn() },
  };
}

function persistedFrom(
  resources: Awaited<ReturnType<DiscordRestResourceManager["reconcileResources"]>>,
): Partial<Record<DiscordManagedResourceKey, DiscordPersistedResource>> {
  return Object.fromEntries(resources.map((resource) => [
    resource.key,
    {
      discordId: resource.discordId,
      resourceType: resource.resourceType,
      displayName: resource.displayName,
      provisioningToken,
    },
  ]));
}

function overwrite(channel: FakeChannel, id: string) {
  const value = channel.permission_overwrites.find((entry) => entry.id === id);
  expect(value).toBeDefined();
  return value!;
}

describe("Discord managed resource manager", () => {
  it("provisions every Phase C1 resource once and repeats idempotently", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });

    const first = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const patchCallsAfterFirst = discord.rest.patch.mock.calls.length;
    const second = await manager.reconcileResources({
      persisted: persistedFrom(first),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    expect(first).toHaveLength(managedResourceCount);
    expect(first.every((resource) => resource.action === "created")).toBe(true);
    expect(second.every((resource) => resource.action === "verified")).toBe(true);
    expect(discord.rest.post).toHaveBeenCalledTimes(managedResourceCount);
    expect(patchCallsAfterFirst).toBe(managedResourceCount);
    expect(discord.rest.patch).toHaveBeenCalledTimes(patchCallsAfterFirst);
    expect(discord.rest.put).not.toHaveBeenCalled();
  });

  it("accepts the production-shaped role payload without unsettable overwrite bits", async () => {
    const discord = fakeDiscord({
      everyonePermissions: "2248473465619009",
      rejectUnsupportedOverwritePermissions: true,
    });
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });

    const resources = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    expect(resources).toHaveLength(managedResourceCount);
    expect(discord.rest.post).toHaveBeenCalledTimes(managedResourceCount);
  });

  it("fails before mutation when a non-staff guild role can bypass unsettable denies", async () => {
    const discord = fakeDiscord({
      unrelatedRolePermissions: PermissionFlagsBits.ManageThreads.toString(),
    });

    await expect(new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    }).reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "unsafe_guild_role_permissions" });
    expect(discord.rest.post).not.toHaveBeenCalled();
  });

  it("does not exempt an ordinary unsafe role merely because the bot has it", async () => {
    const discord = fakeDiscord({
      additionalBotRolePermissions: PermissionFlagsBits.ManageRoles.toString(),
    });

    await expect(new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    }).reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "unsafe_guild_role_permissions" });
    expect(discord.rest.post).not.toHaveBeenCalled();
  });

  it("never grants the approved seller role a trusted-staff exemption", async () => {
    const discord = fakeDiscord({
      approvedRolePermissions: (
        PermissionFlagsBits.ManageMessages | PermissionFlagsBits.PinMessages
      ).toString(),
    });

    await expect(new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    }).reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "unsafe_guild_role_permissions" });
    expect(discord.rest.post).not.toHaveBeenCalled();
  });

  it("recovers an orphaned create by its durable provisioning token", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });
    await expect(manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
      persistResolvedResource: vi.fn().mockRejectedValueOnce(
        new Error("database unavailable"),
      ),
    })).rejects.toThrow("database unavailable");

    expect(discord.channels).toHaveLength(1);
    expect(discord.channels[0]?.name).toBe(discordResourceProvisioningName(
      DISCORD_MANAGED_RESOURCE_DEFINITIONS[0]!.key,
      provisioningToken,
    ));

    const recovered = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
      persistResolvedResource: vi.fn(async () => undefined),
    });

    expect(recovered.find((resource) =>
      resource.key === DISCORD_MANAGED_RESOURCE_DEFINITIONS[0]!.key,
    ))
      .toMatchObject({ action: "recovered" });
    expect(discord.rest.post).toHaveBeenCalledTimes(managedResourceCount);
    expect(discord.channels.filter((channel) =>
      channel.type === ChannelType.GuildCategory)).toHaveLength(3);
  });

  it("keeps shared support and community topics explicit about privacy and off-platform safety", () => {
    const byKey = new Map(DISCORD_MANAGED_RESOURCE_DEFINITIONS.map(
      (definition) => [definition.key, definition.topic],
    ));

    expect(byKey.get("seller_support")).toContain("Shared support");
    expect(byKey.get("seller_support")).not.toContain("Private support");
    expect(byKey.get("seller_lounge")).toContain("Do not post buyer identities");
    expect(byKey.get("seller_chat")).toContain("Never share buyer data");
    expect(byKey.get("seller_chat")).toContain("off-platform trade");
    expect(byKey.get("share_your_success")).toContain("Never identify buyers");
    expect(byKey.get("buyer_support")).toContain("Never send payments");
    expect(byKey.get("buyer_support")).toContain("off-platform trades");
  });

  it("applies exact private, read-only, writable, and bot-only public permissions", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });
    await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    const category = discord.channels.find((channel) =>
      channel.name === displayNames.seller_category)!;
    const marketplaceCategory = discord.channels.find((channel) =>
      channel.name === displayNames.marketplace_category)!;
    const lounge = discord.channels.find((channel) =>
      channel.name === displayNames.seller_lounge)!;
    const announcements = discord.channels.find((channel) =>
      channel.name === displayNames.seller_announcements)!;
    const marketplace = discord.channels.find((channel) =>
      channel.name === displayNames.marketplace_listings)!;
    const activity = discord.channels.find((channel) =>
      channel.name === displayNames.market_activity)!;
    const pulse = discord.channels.find((channel) =>
      channel.name === displayNames.live_market_pulse)!;
    const buyerSupport = discord.channels.find((channel) =>
      channel.name === displayNames.buyer_support)!;
    const viewAndRead =
      PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
    const botManageable =
      PermissionFlagsBits.ManageChannels
      | PermissionFlagsBits.ManageMessages
      | PermissionFlagsBits.UseExternalApps;
    const userPosting =
      PermissionFlagsBits.SendMessages
      | PermissionFlagsBits.AddReactions
      | PermissionFlagsBits.CreatePublicThreads
      | PermissionFlagsBits.CreatePrivateThreads
      | PermissionFlagsBits.SendMessagesInThreads
      | PermissionFlagsBits.UseApplicationCommands
      | PermissionFlagsBits.SendVoiceMessages
      | PermissionFlagsBits.SendPolls
      | botManageable;
    const writableDeny = userPosting & ~(
      PermissionFlagsBits.SendMessages | PermissionFlagsBits.AddReactions
    );
    const botPublish =
      viewAndRead
      | PermissionFlagsBits.ManageChannels
      | PermissionFlagsBits.SendMessages
      | PermissionFlagsBits.EmbedLinks
      | PermissionFlagsBits.ManageMessages;

    expect(overwrite(category, guildId)).toMatchObject({
      allow: "0",
      deny: (
        PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageChannels
      ).toString(),
    });
    expect(overwrite(category, approvedRoleId)).toMatchObject({
      allow: viewAndRead.toString(),
      deny: PermissionFlagsBits.ManageChannels.toString(),
    });
    expect(overwrite(category, botId)).toMatchObject({
      allow: (
        viewAndRead | PermissionFlagsBits.ManageChannels
      ).toString(),
      deny: "0",
    });
    for (const publicBotOnly of [
      marketplaceCategory,
      marketplace,
      activity,
      pulse,
    ]) {
      expect(overwrite(publicBotOnly, guildId)).toMatchObject({
        allow: viewAndRead.toString(),
        deny: userPosting.toString(),
      });
      expect(overwrite(publicBotOnly, approvedRoleId)).toMatchObject({
        allow: viewAndRead.toString(),
        deny: userPosting.toString(),
      });
      expect(overwrite(publicBotOnly, botId)).toMatchObject({
        allow: botPublish.toString(),
        deny: "0",
      });
    }
    expect(overwrite(lounge, guildId)).toMatchObject({
      allow: "0",
      deny: (
        PermissionFlagsBits.ViewChannel | botManageable
      ).toString(),
    });
    expect(overwrite(lounge, approvedRoleId)).toMatchObject({
      allow: (
        viewAndRead | PermissionFlagsBits.SendMessages
      ).toString(),
      deny: writableDeny.toString(),
    });
    expect(overwrite(announcements, approvedRoleId)).toMatchObject({
      allow: viewAndRead.toString(),
      deny: userPosting.toString(),
    });
    expect(overwrite(buyerSupport, guildId)).toMatchObject({
      allow: (
        viewAndRead | PermissionFlagsBits.SendMessages
      ).toString(),
      deny: writableDeny.toString(),
    });
    expect(overwrite(buyerSupport, approvedRoleId)).toMatchObject({
      allow: (
        viewAndRead | PermissionFlagsBits.SendMessages
      ).toString(),
      deny: writableDeny.toString(),
    });
    expect(overwrite(buyerSupport, botId)).toMatchObject({
      allow: botPublish.toString(),
      deny: "0",
    });

    expect(BigInt(overwrite(category, guildId).deny)
      & PermissionFlagsBits.ViewChannel).toBe(PermissionFlagsBits.ViewChannel);
    expect(BigInt(overwrite(lounge, approvedRoleId).allow)
      & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
    expect(BigInt(overwrite(announcements, approvedRoleId).deny)
      & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
    expect(BigInt(overwrite(marketplace, guildId).allow))
      .toBe(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory);
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.AddReactions).toBe(PermissionFlagsBits.AddReactions);
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.ManageWebhooks).toBe(BigInt(0));
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.UseExternalApps).toBe(PermissionFlagsBits.UseExternalApps);
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.ManageRoles).toBe(BigInt(0));
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.ManageChannels).toBe(PermissionFlagsBits.ManageChannels);
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.ManageMessages).toBe(PermissionFlagsBits.ManageMessages);
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.PinMessages).toBe(BigInt(0));
    expect(BigInt(overwrite(marketplace, botId).allow)
      & PermissionFlagsBits.EmbedLinks).toBe(PermissionFlagsBits.EmbedLinks);
    expect(BigInt(overwrite(marketplace, botId).allow)
      & PermissionFlagsBits.ManageRoles).toBe(BigInt(0));
    expect(BigInt(overwrite(marketplace, botId).allow)
      & PermissionFlagsBits.ManageChannels).toBe(PermissionFlagsBits.ManageChannels);
    for (const botOnly of [marketplace, activity, pulse]) {
      const everyone = overwrite(botOnly, guildId);
      expect(BigInt(everyone.allow)).toBe(
        PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory,
      );
      expect(BigInt(everyone.deny) & (
        PermissionFlagsBits.SendMessages
        | PermissionFlagsBits.CreatePublicThreads
        | PermissionFlagsBits.CreatePrivateThreads
        | PermissionFlagsBits.SendMessagesInThreads
      )).toBe(
        PermissionFlagsBits.SendMessages
        | PermissionFlagsBits.CreatePublicThreads
        | PermissionFlagsBits.CreatePrivateThreads
        | PermissionFlagsBits.SendMessagesInThreads,
      );
    }
    expect(BigInt(overwrite(buyerSupport, guildId).allow)).toBe(
      PermissionFlagsBits.ViewChannel
      | PermissionFlagsBits.ReadMessageHistory
      | PermissionFlagsBits.SendMessages,
    );
    expect(BigInt(overwrite(buyerSupport, guildId).deny) & (
      PermissionFlagsBits.ManageChannels
      | PermissionFlagsBits.ManageMessages
      | PermissionFlagsBits.CreatePublicThreads
      | PermissionFlagsBits.CreatePrivateThreads
      | PermissionFlagsBits.SendMessagesInThreads
    )).toBe(
      PermissionFlagsBits.ManageChannels
      | PermissionFlagsBits.ManageMessages
      | PermissionFlagsBits.CreatePublicThreads
      | PermissionFlagsBits.CreatePrivateThreads
      | PermissionFlagsBits.SendMessagesInThreads,
    );
    const liveEveryonePermissions = BigInt("2248473465619009");
    const marketplaceEveryone = overwrite(marketplace, guildId);
    const ordinaryMarketplacePermissions =
      (liveEveryonePermissions & ~BigInt(marketplaceEveryone.deny))
      | BigInt(marketplaceEveryone.allow);
    const marketplaceSeller = overwrite(marketplace, approvedRoleId);
    const approvedMarketplacePermissions =
      (ordinaryMarketplacePermissions & ~BigInt(marketplaceSeller.deny))
      | BigInt(marketplaceSeller.allow);
    const prohibitedMarketplacePermissions =
      PermissionFlagsBits.SendMessages
      | PermissionFlagsBits.AddReactions
      | PermissionFlagsBits.CreatePublicThreads
      | PermissionFlagsBits.CreatePrivateThreads
      | PermissionFlagsBits.SendMessagesInThreads
      | PermissionFlagsBits.ManageThreads
      | PermissionFlagsBits.PinMessages
      | PermissionFlagsBits.UseApplicationCommands
      | PermissionFlagsBits.SendVoiceMessages
      | PermissionFlagsBits.SendPolls
      | PermissionFlagsBits.ManageChannels
      | PermissionFlagsBits.ManageMessages
      | PermissionFlagsBits.ManageRoles
      | PermissionFlagsBits.ManageWebhooks
      | PermissionFlagsBits.UseExternalApps;
    expect(ordinaryMarketplacePermissions & prohibitedMarketplacePermissions)
      .toBe(BigInt(0));
    expect(approvedMarketplacePermissions & prohibitedMarketplacePermissions)
      .toBe(BigInt(0));
    const unsettable =
      PermissionFlagsBits.Administrator
      | PermissionFlagsBits.ManageRoles
      | PermissionFlagsBits.ManageWebhooks
      | PermissionFlagsBits.ManageThreads
      | PermissionFlagsBits.PinMessages;
    for (const channel of discord.channels) {
      for (const entry of channel.permission_overwrites) {
        expect((BigInt(entry.allow) | BigInt(entry.deny)) & unsettable)
          .toBe(BigInt(0));
      }
    }

    const everyoneCanViewPrivate =
      (BigInt(overwrite(category, guildId).deny)
        & PermissionFlagsBits.ViewChannel) === BigInt(0);
    const approvedCanViewPrivate =
      (BigInt(overwrite(category, approvedRoleId).allow)
        & PermissionFlagsBits.ViewChannel) !== BigInt(0);
    expect(everyoneCanViewPrivate).toBe(false);
    expect(approvedCanViewPrivate).toBe(true);
  });

  it("recreates a deleted persisted channel and updates only that stable key", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });

    const first = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const persisted = persistedFrom(first);
    const staleId = persisted.seller_guides!.discordId;
    discord.channels.splice(
      discord.channels.findIndex((channel) => channel.id === staleId),
      1,
    );

    const reconciled = await manager.reconcileResources({
      persisted,
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    expect(reconciled.find((resource) => resource.key === "seller_guides"))
      .toMatchObject({ action: "created" });
    expect(reconciled.find((resource) => resource.key === "seller_guides")?.discordId)
      .not.toBe(staleId);
    expect(discord.rest.post).toHaveBeenCalledTimes(managedResourceCount + 1);
  });

  it("preserves accepted IDs and reconciles only managed channel ordering", async () => {
    const discord = fakeDiscord();
    const unrelatedId = "888888888888888888";
    discord.channels.push({
      id: unrelatedId,
      type: ChannelType.GuildText,
      name: "unrelated-community-channel",
      parent_id: null,
      position: 99,
      permission_overwrites: [],
    });
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });
    const first = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const acceptedIds = new Map(first.map((resource) => [
      resource.key,
      resource.discordId,
    ]));
    const onboardingChildren = [
      "welcome",
      "how_alpha_exchange_works",
      "buyer_guide",
      "become_a_seller",
      "seller_ranks",
      "seller_rules",
      "support",
      "contact_owner",
    ] as const;
    const marketplaceChildren = [
      "marketplace_listings",
      "market_activity",
      "live_market_pulse",
      "buyer_support",
    ] as const;
    const sellerChildren = [
      "seller_lounge",
      "seller_announcements",
      "seller_updates",
      "seller_chat",
      "seller_guides",
      "seller_support",
      "share_your_success",
    ] as const;
    for (const [index, key] of [...marketplaceChildren].reverse().entries()) {
      discord.channels.find((channel) =>
        channel.id === acceptedIds.get(key))!.position = index;
    }
    for (const [index, key] of [...sellerChildren].reverse().entries()) {
      discord.channels.find((channel) =>
        channel.id === acceptedIds.get(key))!.position = index;
    }
    for (const [index, key] of [...onboardingChildren].reverse().entries()) {
      discord.channels.find((channel) =>
        channel.id === acceptedIds.get(key))!.position = index;
    }
    const patchCallsBeforeRepair = discord.rest.patch.mock.calls.length;

    const repaired = await manager.reconcileResources({
      persisted: persistedFrom(first),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    expect(new Map(repaired.map((resource) => [
      resource.key,
      resource.discordId,
    ]))).toEqual(acceptedIds);
    expect(discord.rest.post).toHaveBeenCalledTimes(managedResourceCount);
    const orderingCalls = discord.rest.patch.mock.calls
      .slice(patchCallsBeforeRepair)
      .filter(([, options]) => Array.isArray(options.body));
    expect(orderingCalls).toHaveLength(1);
    const orderedIds = orderingCalls[0]![1].body as Array<{
      id: string;
      position: number;
      parent_id?: string;
    }>;
    expect(orderedIds.map((entry) => entry.id)).not.toContain(unrelatedId);
    expect(orderedIds.every((entry) => entry.parent_id === undefined)).toBe(true);
    expect(orderedIds.map((entry) => entry.id)).toEqual([
      ...onboardingChildren.map((key) => acceptedIds.get(key)!),
      ...sellerChildren.map((key) => acceptedIds.get(key)!),
      ...marketplaceChildren.map((key) => acceptedIds.get(key)!),
    ]);
    expect(discord.channels.find((channel) => channel.id === unrelatedId))
      .toMatchObject({ position: 99, parent_id: null });
  });

  it("never adopts or mutates an unrelated same-name channel", async () => {
    const discord = fakeDiscord();
    const unrelatedId = "888888888888888888";
    discord.channels.push({
      id: unrelatedId,
      type: ChannelType.GuildCategory,
      name: displayNames.seller_category,
      parent_id: null,
      permission_overwrites: [{
        id: unrelatedRoleId,
        type: 0,
        allow: PermissionFlagsBits.ViewChannel.toString(),
        deny: "0",
      }],
    });
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });

    const resources = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    expect(resources.find((resource) => resource.key === "seller_category")?.discordId)
      .not.toBe(unrelatedId);
    expect(discord.channels.find((channel) => channel.id === unrelatedId))
      .toMatchObject({
        name: displayNames.seller_category,
        permission_overwrites: [{
          id: unrelatedRoleId,
          allow: PermissionFlagsBits.ViewChannel.toString(),
        }],
      });
    expect(discord.rest.patch).not.toHaveBeenCalledWith(
      expect.stringContaining(unrelatedId),
      expect.anything(),
    );
    expect(discord.rest.put).not.toHaveBeenCalledWith(
      expect.stringContaining(unrelatedId),
      expect.anything(),
    );
  });

  it("repairs owned drift while preserving unrelated overwrites and permission bits", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });
    const first = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const lounge = discord.channels.find((channel) =>
      channel.name === displayNames.seller_lounge)!;
    lounge.name = "drifted-name";
    lounge.parent_id = null;
    lounge.topic = "Private conversation space for approved Alpha Traders sellers.";
    overwrite(lounge, approvedRoleId).allow = (
      PermissionFlagsBits.AttachFiles
    ).toString();
    lounge.permission_overwrites.push({
      id: unrelatedRoleId,
      type: 0,
      allow: (
        PermissionFlagsBits.UseExternalEmojis
        | PermissionFlagsBits.ViewChannel
      ).toString(),
      deny: "0",
    });

    const reconciled = await manager.reconcileResources({
      persisted: persistedFrom(first),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    expect(reconciled.find((resource) => resource.key === "seller_lounge"))
      .toMatchObject({ action: "repaired" });
    expect(lounge.name).toBe(displayNames.seller_lounge);
    expect(lounge.parent_id).toBe(
      first.find((resource) => resource.key === "seller_category")?.discordId,
    );
    expect(lounge.topic).toBe(
      DISCORD_MANAGED_RESOURCE_DEFINITIONS.find(
        (definition) => definition.key === "seller_lounge",
      )?.topic,
    );
    expect(BigInt(overwrite(lounge, approvedRoleId).allow)
      & PermissionFlagsBits.AttachFiles).toBe(PermissionFlagsBits.AttachFiles);
    expect(overwrite(lounge, unrelatedRoleId).allow)
      .toBe(PermissionFlagsBits.UseExternalEmojis.toString());
    expect(discord.rest.delete).not.toHaveBeenCalled();
    expect(discord.rest.put).not.toHaveBeenCalled();
    expect(discord.rest.patch).toHaveBeenCalledWith(
      expect.stringContaining(lounge.id),
      expect.objectContaining({
        body: expect.objectContaining({
          topic: expect.stringContaining("Do not post buyer identities"),
          permission_overwrites: expect.any(Array),
        }),
      }),
    );
  });

  it("removes legacy access and posting bypasses but retains staff exceptions", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });
    const first = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const announcements = discord.channels.find((channel) =>
      channel.name === displayNames.seller_announcements)!;
    const lounge = discord.channels.find((channel) =>
      channel.name === displayNames.seller_lounge)!;
    const marketplace = discord.channels.find((channel) =>
      channel.name === displayNames.marketplace_listings)!;
    const buyerSupport = discord.channels.find((channel) =>
      channel.name === displayNames.buyer_support)!;
    const legacyMemberId = "777777777777777777";
    for (const channel of [announcements, marketplace]) {
      channel.permission_overwrites.push({
        id: legacyMemberId,
        type: 1,
        allow: (
          PermissionFlagsBits.ViewChannel
          | PermissionFlagsBits.SendMessages
          | PermissionFlagsBits.ManageWebhooks
          | PermissionFlagsBits.UseExternalApps
          | PermissionFlagsBits.ManageRoles
          | PermissionFlagsBits.ManageChannels
          | PermissionFlagsBits.ManageMessages
          | PermissionFlagsBits.PinMessages
          | PermissionFlagsBits.UseExternalEmojis
        ).toString(),
        deny: "0",
      });
      channel.permission_overwrites.push({
        id: moderatorRoleId,
        type: 0,
        allow: (
          PermissionFlagsBits.ViewChannel
          | PermissionFlagsBits.SendMessages
        ).toString(),
        deny: "0",
      });
    }
    buyerSupport.permission_overwrites.push({
      id: legacyMemberId,
      type: 1,
      allow: (
        PermissionFlagsBits.SendMessages
        | PermissionFlagsBits.CreatePublicThreads
        | PermissionFlagsBits.CreatePrivateThreads
        | PermissionFlagsBits.SendMessagesInThreads
        | PermissionFlagsBits.UseApplicationCommands
        | PermissionFlagsBits.SendVoiceMessages
        | PermissionFlagsBits.SendPolls
        | PermissionFlagsBits.UseExternalEmojis
      ).toString(),
      deny: "0",
    });
    lounge.permission_overwrites.push({
      id: legacyMemberId,
      type: 1,
      allow: (
        PermissionFlagsBits.CreatePublicThreads
        | PermissionFlagsBits.CreatePrivateThreads
        | PermissionFlagsBits.SendMessagesInThreads
        | PermissionFlagsBits.UseApplicationCommands
        | PermissionFlagsBits.SendVoiceMessages
        | PermissionFlagsBits.SendPolls
        | PermissionFlagsBits.UseExternalEmojis
      ).toString(),
      deny: "0",
    });

    await manager.reconcileResources({
      persisted: persistedFrom(first),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    expect(BigInt(overwrite(announcements, legacyMemberId).allow))
      .toBe(PermissionFlagsBits.UseExternalEmojis);
    expect(BigInt(overwrite(marketplace, legacyMemberId).allow))
      .toBe(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.UseExternalEmojis);
    expect(BigInt(overwrite(announcements, moderatorRoleId).allow))
      .toBe(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages);
    expect(BigInt(overwrite(marketplace, moderatorRoleId).allow))
      .toBe(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages);
    expect(BigInt(overwrite(buyerSupport, legacyMemberId).allow)).toBe(
      PermissionFlagsBits.SendMessages | PermissionFlagsBits.UseExternalEmojis,
    );
    expect(BigInt(overwrite(lounge, legacyMemberId).allow)).toBe(
      PermissionFlagsBits.UseExternalEmojis,
    );
  });

  it("atomically removes unsettable untrusted drift without resending rejected bits", async () => {
    const discord = fakeDiscord({ rejectUnsupportedOverwritePermissions: true });
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });
    const first = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const lounge = discord.channels.find((channel) =>
      channel.name === displayNames.seller_lounge)!;
    overwrite(lounge, approvedRoleId).allow =
      PermissionFlagsBits.ViewChannel.toString();
    lounge.permission_overwrites.push({
      id: unrelatedRoleId,
      type: 0,
      allow: (
        PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageThreads
      ).toString(),
      deny: PermissionFlagsBits.PinMessages.toString(),
    });

    await manager.reconcileResources({
      persisted: persistedFrom(first),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    expect(overwrite(lounge, unrelatedRoleId)).toMatchObject({
      allow: "0",
      deny: "0",
    });
    expect(BigInt(overwrite(lounge, approvedRoleId).allow)
      & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
    expect(discord.rest.put).not.toHaveBeenCalled();
  });

  it("fails closed instead of rewriting unsettable trusted staff permissions", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });
    const first = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const lounge = discord.channels.find((channel) =>
      channel.name === displayNames.seller_lounge)!;
    overwrite(lounge, approvedRoleId).allow =
      PermissionFlagsBits.ViewChannel.toString();
    lounge.permission_overwrites.push({
      id: moderatorRoleId,
      type: 0,
      allow: PermissionFlagsBits.ManageThreads.toString(),
      deny: "0",
    });
    const patchCalls = discord.rest.patch.mock.calls.length;

    await expect(manager.reconcileResources({
      persisted: persistedFrom(first),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "channel_permission_rejected" });

    expect(discord.rest.patch).toHaveBeenCalledTimes(patchCalls);
    expect(overwrite(lounge, approvedRoleId).allow)
      .toBe(PermissionFlagsBits.ViewChannel.toString());
    expect(overwrite(lounge, moderatorRoleId).allow)
      .toBe(PermissionFlagsBits.ManageThreads.toString());
  });

  it("preserves authorized staff permissions when no managed repair is needed", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });
    const first = await manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const lounge = discord.channels.find((channel) =>
      channel.name === displayNames.seller_lounge)!;
    lounge.permission_overwrites.push({
      id: moderatorRoleId,
      type: 0,
      allow: (
        PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageThreads
      ).toString(),
      deny: "0",
    });
    const patchCalls = discord.rest.patch.mock.calls.length;

    const reconciled = await manager.reconcileResources({
      persisted: persistedFrom(first),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    expect(reconciled.every((resource) => resource.action === "verified"))
      .toBe(true);
    expect(discord.rest.patch).toHaveBeenCalledTimes(patchCalls);
    expect(overwrite(lounge, moderatorRoleId).allow).toBe((
      PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageThreads
    ).toString());
  });

  it("degrades before mutation when Manage Channels or publishing permissions are absent", async () => {
    const missingManageChannels = fakeDiscord({
      permissions: (
        BigInt(requiredBotPermissions) & ~PermissionFlagsBits.ManageChannels
      ).toString(),
    });
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: missingManageChannels.rest as unknown as REST,
    });
    await expect(manager.reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "missing_manage_channels" });
    expect(missingManageChannels.rest.post).not.toHaveBeenCalled();

    const missingEmbedLinks = fakeDiscord({
      permissions: (
        BigInt(requiredBotPermissions) & ~PermissionFlagsBits.EmbedLinks
      ).toString(),
    });
    await expect(new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: missingEmbedLinks.rest as unknown as REST,
    }).reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "missing_channel_permissions" });

    const missingManageRoles = fakeDiscord({
      permissions: (
        BigInt(requiredBotPermissions) & ~PermissionFlagsBits.ManageRoles
      ).toString(),
    });
    await expect(new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: missingManageRoles.rest as unknown as REST,
    }).reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "missing_manage_roles" });
    expect(missingManageRoles.rest.post).not.toHaveBeenCalled();
  });

  it("distinguishes Discord overwrite rejection from a missing preflight grant", async () => {
    const discord = fakeDiscord({ channelCreateErrorCode: 50013 });

    await expect(new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    }).reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "channel_permission_rejected" });
  });

  it("does not misclassify role fetch or name-only patch failures as overwrite rejection", async () => {
    const roleFetchFailure = fakeDiscord({ roleFetchErrorCode: 50013 });
    await expect(new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: roleFetchFailure.rest as unknown as REST,
    }).reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "api_failure" });

    const namePatchFailure = fakeDiscord({ patchErrorCode: 50013 });
    await expect(new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: namePatchFailure.rest as unknown as REST,
    }).reconcileResources({
      persisted: seededPersisted(),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "api_failure" });
  });

  it("fails closed before mutation when legacy broad bot permissions remain", async () => {
    for (const forbidden of [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ManageThreads,
      PermissionFlagsBits.ManageWebhooks,
    ]) {
      const discord = fakeDiscord({
        permissions: (BigInt(requiredBotPermissions) | forbidden).toString(),
      });
      const manager = new DiscordRestResourceManager({
        token: "bot-token",
        guildId,
        rest: discord.rest as unknown as REST,
      });
      await expect(manager.reconcileResources({
        persisted: seededPersisted(),
        approvedSellerRoleId: approvedRoleId,
        displayNames,
      })).rejects.toMatchObject({ code: "excessive_bot_permissions" });
      expect(discord.rest.post).not.toHaveBeenCalled();
    }
  });

  it("publishes the exact least-privilege bitsets without hardcoded Discord IDs", () => {
    expect(DISCORD_LAYER_A_PERMISSION_BITSET).toBe("93200");
    expect(DISCORD_LAYER_A_WITH_MANAGE_ROLES_BITSET).toBe("268528656");
    const source = readFileSync(
      resolve("src/lib/discord/resource-manager.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/["']\d{17,20}["']/);
    expect(source).toContain("PermissionFlagsBits.Administrator");
    expect(source.match(/PermissionFlagsBits\.Administrator/g)).toHaveLength(2);
  });

  it("rejects duplicate configurable channel names before provisioning", () => {
    expect(() => readDiscordResourceDisplayNames({
      DISCORD_SELLER_LOUNGE_CHANNEL_NAME: "duplicate-channel",
      DISCORD_SELLER_SUPPORT_CHANNEL_NAME: "duplicate-channel",
    })).toThrow("Discord channel display names");
  });

  it("uses the exact requested managed display names", () => {
    expect(readDiscordResourceDisplayNames({})).toMatchObject({
      onboarding_category: "00 START HERE",
      welcome: "welcome",
      how_alpha_exchange_works: "how-alpha-exchange-works",
      buyer_guide: "buyer-guide",
      become_a_seller: "become-a-seller",
      seller_ranks: "seller-ranks",
      seller_rules: "seller-rules",
      support: "support",
      contact_owner: "contact-owner",
      seller_category: "🛡️ Seller Lounge",
      seller_announcements: "📢 seller-announcements",
      seller_updates: "seller-updates",
      seller_chat: "💬 seller-chat",
      seller_guides: "📚 seller-guides",
      seller_support: "❓ seller-support",
      share_your_success: "🚀 share-your-success",
      marketplace_category: "💰 Alpha Exchange",
      marketplace_listings: "📢 marketplace-listings",
      market_activity: "📈 market-activity",
      live_market_pulse: "🔥 live-market-pulse",
      buyer_support: "💬 buyer-support",
    });
  });
});
