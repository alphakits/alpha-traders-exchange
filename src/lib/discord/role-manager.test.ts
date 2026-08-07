// @vitest-environment node

import type { REST } from "discord.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  desiredDiscordRoleKeys,
  DiscordRestRoleManager,
  DiscordRoleOperationError,
  type DiscordManagedRoleIds,
} from "@/lib/discord/role-manager";

const guildId = "111111111111111111";
const botId = "222222222222222222";
const botRoleId = "333333333333333333";
const roleIds: DiscordManagedRoleIds = {
  approved_seller: "444444444444444444",
  pending_seller: "555555555555555555",
  suspended_seller: "666666666666666666",
};

const manageRoles = String(1n << 28n);

function roles(overrides: Partial<Record<keyof DiscordManagedRoleIds, number>> = {}) {
  return [
    { id: guildId, name: "@everyone", permissions: "0", position: 0, managed: false },
    { id: botRoleId, name: "Alpha Bot", permissions: manageRoles, position: 10, managed: false },
    { id: roleIds.approved_seller, name: "Approved Seller", permissions: "0", position: overrides.approved_seller ?? 3, managed: false },
    { id: roleIds.pending_seller, name: "Pending Seller", permissions: "0", position: overrides.pending_seller ?? 2, managed: false },
    { id: roleIds.suspended_seller, name: "Suspended Seller", permissions: "0", position: overrides.suspended_seller ?? 1, managed: false },
  ];
}

function fakeRest(input: {
  roleRows?: ReturnType<typeof roles>;
  memberRoles?: string[];
  memberError?: unknown;
}) {
  const get = vi.fn(async (route: string) => {
    if (route.includes("/users/%40me")) return { id: botId };
    if (route.endsWith(`/members/${botId}`)) return { roles: [botRoleId] };
    if (route.includes("/roles")) return input.roleRows ?? roles();
    if (input.memberError) throw input.memberError;
    return { roles: input.memberRoles ?? [] };
  });
  return {
    get,
    post: vi.fn(),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
}

describe("Discord managed seller roles", () => {
  it.each([
    ["approved", ["approved_seller"]],
    ["pending", ["pending_seller"]],
    ["suspended", ["suspended_seller"]],
    ["none", []],
  ] as const)("maps %s deterministically", (status, expected) => {
    expect([...desiredDiscordRoleKeys(status)]).toEqual(expected);
  });

  it("reuses persisted role IDs and applies only the required idempotent mutations", async () => {
    const rest = fakeRest({ memberRoles: [roleIds.pending_seller] });
    const manager = new DiscordRestRoleManager({
      token: "bot-token",
      guildId,
      rest: rest as unknown as REST,
    });

    await expect(manager.discoverOrCreateManagedRoles(roleIds)).resolves.toEqual(roleIds);
    expect(rest.post).not.toHaveBeenCalled();

    await manager.synchronizeMemberRoles({
      discordUserId: "777777777777777777",
      desiredStatus: "approved",
      roleIds,
    });
    expect(rest.put).toHaveBeenCalledOnce();
    expect(rest.delete).toHaveBeenCalledOnce();
  });

  it("fails clearly when the member has not joined the configured guild", async () => {
    const rest = fakeRest({ memberError: { code: 10007 } });
    const manager = new DiscordRestRoleManager({
      token: "bot-token",
      guildId,
      rest: rest as unknown as REST,
    });

    await expect(manager.synchronizeMemberRoles({
      discordUserId: "777777777777777777",
      desiredStatus: "approved",
      roleIds,
    })).rejects.toMatchObject({ code: "member_not_in_guild" });
  });

  it("rejects managed roles above the bot hierarchy without escalating permissions", async () => {
    const rest = fakeRest({ roleRows: roles({ approved_seller: 10 }) });
    const manager = new DiscordRestRoleManager({
      token: "bot-token",
      guildId,
      rest: rest as unknown as REST,
    });

    await expect(manager.discoverOrCreateManagedRoles(roleIds))
      .rejects.toEqual(expect.objectContaining<Partial<DiscordRoleOperationError>>({
        code: "role_hierarchy",
      }));
  });

  it("requires Manage Roles rather than silently requesting Administrator", async () => {
    const rows = roles().map((role) =>
      role.id === botRoleId ? { ...role, permissions: "0" } : role);
    const rest = fakeRest({ roleRows: rows });
    const manager = new DiscordRestRoleManager({
      token: "bot-token",
      guildId,
      rest: rest as unknown as REST,
    });

    await expect(manager.discoverOrCreateManagedRoles(roleIds))
      .rejects.toMatchObject({ code: "missing_manage_roles" });
  });

  it("refuses a managed seller role that grants Discord permissions", async () => {
    const rows = roles().map((role) =>
      role.id === roleIds.approved_seller ? { ...role, permissions: "1024" } : role);
    const rest = fakeRest({ roleRows: rows });
    const manager = new DiscordRestRoleManager({
      token: "bot-token",
      guildId,
      rest: rest as unknown as REST,
    });

    await expect(manager.discoverOrCreateManagedRoles(roleIds))
      .rejects.toMatchObject({ code: "role_permissions" });
  });
});
