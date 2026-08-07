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
  DiscordRestResourceManager,
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
const requiredBotPermissions = DISCORD_LAYER_A_WITH_MANAGE_ROLES_BITSET;
const displayNames: DiscordResourceDisplayNames = {
  seller_category: "ALPHA SELLER SUITE",
  seller_lounge: "seller-lounge",
  seller_announcements: "seller-announcements",
  seller_updates: "seller-updates",
  seller_guides: "seller-guides",
  seller_support: "seller-support",
  marketplace_listings: "marketplace-listings",
};

type FakeChannel = {
  id: string;
  type: number;
  name: string;
  parent_id: string | null;
  permission_overwrites: Array<{
    id: string;
    type: number;
    allow: string;
    deny: string;
  }>;
};

function fakeDiscord(input: { permissions?: string } = {}) {
  const channels: FakeChannel[] = [];
  let nextId = BigInt("600000000000000000");
  const roles = [
    { id: guildId, permissions: "0", position: 0 },
    {
      id: botRoleId,
      permissions: input.permissions ?? requiredBotPermissions,
      position: 10,
    },
    { id: approvedRoleId, permissions: "0", position: 3 },
    { id: unrelatedRoleId, permissions: "0", position: 2 },
    {
      id: moderatorRoleId,
      permissions: PermissionFlagsBits.ManageMessages.toString(),
      position: 4,
    },
  ];
  const get = vi.fn(async (route: string) => {
    if (route.includes("/users/%40me")) return { id: botId };
    if (route.endsWith(`/members/${botId}`)) return { roles: [botRoleId] };
    if (route.endsWith("/roles")) return roles;
    if (route.endsWith("/channels")) return structuredClone(channels);
    throw new Error(`Unexpected GET ${route}`);
  });
  const post = vi.fn(async (_route: string, options: {
    body: Record<string, unknown>;
  }) => {
    nextId += BigInt(1);
    const created: FakeChannel = {
      id: nextId.toString(),
      type: options.body.type as number,
      name: options.body.name as string,
      parent_id: (options.body.parent_id as string | undefined) ?? null,
      permission_overwrites: structuredClone(
        options.body.permission_overwrites as FakeChannel["permission_overwrites"],
      ),
    };
    channels.push(created);
    return created;
  });
  const patch = vi.fn(async (route: string, options: {
    body: { name?: string; parent_id?: string | null };
  }) => {
    const channel = channels.find((candidate) => route.endsWith(candidate.id));
    if (!channel) throw new Error(`Unknown channel ${route}`);
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
    },
  ]));
}

function overwrite(channel: FakeChannel, id: string) {
  const value = channel.permission_overwrites.find((entry) => entry.id === id);
  expect(value).toBeDefined();
  return value!;
}

describe("Discord seller resource manager", () => {
  it("provisions every Layer A resource once and repeats idempotently", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });

    const first = await manager.reconcileResources({
      persisted: {},
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const second = await manager.reconcileResources({
      persisted: persistedFrom(first),
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    expect(first).toHaveLength(7);
    expect(first.every((resource) => resource.action === "created")).toBe(true);
    expect(second.every((resource) => resource.action === "verified")).toBe(true);
    expect(discord.rest.post).toHaveBeenCalledTimes(7);
    expect(discord.rest.patch).not.toHaveBeenCalled();
    expect(discord.rest.put).not.toHaveBeenCalled();
  });

  it("applies exact private, read-only, writable, and bot-only public permissions", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });
    await manager.reconcileResources({
      persisted: {},
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });

    const category = discord.channels.find((channel) =>
      channel.type === ChannelType.GuildCategory)!;
    const lounge = discord.channels.find((channel) =>
      channel.name === displayNames.seller_lounge)!;
    const announcements = discord.channels.find((channel) =>
      channel.name === displayNames.seller_announcements)!;
    const marketplace = discord.channels.find((channel) =>
      channel.name === displayNames.marketplace_listings)!;

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
      & PermissionFlagsBits.ManageWebhooks).toBe(PermissionFlagsBits.ManageWebhooks);
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.UseExternalApps).toBe(PermissionFlagsBits.UseExternalApps);
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.ManageRoles).toBe(PermissionFlagsBits.ManageRoles);
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.ManageChannels).toBe(PermissionFlagsBits.ManageChannels);
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.ManageMessages).toBe(PermissionFlagsBits.ManageMessages);
    expect(BigInt(overwrite(marketplace, guildId).deny)
      & PermissionFlagsBits.PinMessages).toBe(PermissionFlagsBits.PinMessages);
    expect(BigInt(overwrite(marketplace, botId).allow)
      & PermissionFlagsBits.EmbedLinks).toBe(PermissionFlagsBits.EmbedLinks);
    expect(BigInt(overwrite(marketplace, botId).allow)
      & PermissionFlagsBits.ManageRoles).toBe(PermissionFlagsBits.ManageRoles);
    expect(BigInt(overwrite(marketplace, botId).allow)
      & PermissionFlagsBits.ManageChannels).toBe(PermissionFlagsBits.ManageChannels);

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
      persisted: {},
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
    expect(discord.rest.post).toHaveBeenCalledTimes(8);
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
      persisted: {},
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
      persisted: {},
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const lounge = discord.channels.find((channel) =>
      channel.name === displayNames.seller_lounge)!;
    lounge.name = "drifted-name";
    lounge.parent_id = null;
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
    expect(BigInt(overwrite(lounge, approvedRoleId).allow)
      & PermissionFlagsBits.AttachFiles).toBe(PermissionFlagsBits.AttachFiles);
    expect(overwrite(lounge, unrelatedRoleId).allow)
      .toBe(PermissionFlagsBits.UseExternalEmojis.toString());
    expect(discord.rest.delete).not.toHaveBeenCalled();
  });

  it("removes legacy access and posting bypasses but retains staff exceptions", async () => {
    const discord = fakeDiscord();
    const manager = new DiscordRestResourceManager({
      token: "bot-token",
      guildId,
      rest: discord.rest as unknown as REST,
    });
    const first = await manager.reconcileResources({
      persisted: {},
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    });
    const announcements = discord.channels.find((channel) =>
      channel.name === displayNames.seller_announcements)!;
    const marketplace = discord.channels.find((channel) =>
      channel.name === displayNames.marketplace_listings)!;
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
      persisted: {},
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
      persisted: {},
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
      persisted: {},
      approvedSellerRoleId: approvedRoleId,
      displayNames,
    })).rejects.toMatchObject({ code: "missing_manage_roles" });
    expect(missingManageRoles.rest.post).not.toHaveBeenCalled();
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
        persisted: {},
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
    expect(source.match(/PermissionFlagsBits\.Administrator/g)).toHaveLength(1);
  });

  it("rejects duplicate configurable channel names before provisioning", () => {
    expect(() => readDiscordResourceDisplayNames({
      DISCORD_SELLER_LOUNGE_CHANNEL_NAME: "duplicate-channel",
      DISCORD_SELLER_SUPPORT_CHANNEL_NAME: "duplicate-channel",
    })).toThrow("Discord channel display names");
  });
});
