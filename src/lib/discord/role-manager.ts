import "server-only";

import {
  PermissionFlagsBits,
  PermissionsBitField,
  REST,
  Routes,
} from "discord.js";

export const DISCORD_MANAGED_ROLES = [
  { key: "approved_seller", name: "Approved Seller" },
  { key: "pending_seller", name: "Pending Seller" },
  { key: "suspended_seller", name: "Suspended Seller" },
] as const;

export type DiscordManagedRoleKey = (typeof DISCORD_MANAGED_ROLES)[number]["key"];
export type DiscordSellerRoleStatus = "approved" | "pending" | "suspended" | "none";
export type DiscordManagedRoleIds = Record<DiscordManagedRoleKey, string>;

type ApiRole = {
  id: string;
  name: string;
  permissions: string;
  position: number;
  managed: boolean;
};

type ApiMember = {
  roles: string[];
};

type ApiUser = {
  id: string;
};

export class DiscordRoleOperationError extends Error {
  readonly code: "member_not_in_guild" | "missing_manage_roles" | "role_hierarchy" | "role_permissions" | "api_failure";

  constructor(code: DiscordRoleOperationError["code"], options?: ErrorOptions) {
    super(code, options);
    this.name = "DiscordRoleOperationError";
    this.code = code;
  }
}

export function desiredDiscordRoleKeys(
  status: DiscordSellerRoleStatus,
): ReadonlySet<DiscordManagedRoleKey> {
  if (status === "approved") return new Set(["approved_seller"]);
  if (status === "pending") return new Set(["pending_seller"]);
  if (status === "suspended") return new Set(["suspended_seller"]);
  return new Set();
}

function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function apiErrorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

export interface DiscordRoleManager {
  discoverOrCreateManagedRoles(
    persisted: Partial<DiscordManagedRoleIds>,
  ): Promise<DiscordManagedRoleIds>;
  synchronizeMemberRoles(input: {
    discordUserId: string;
    desiredStatus: DiscordSellerRoleStatus;
    roleIds: DiscordManagedRoleIds;
  }): Promise<void>;
}

export class DiscordRestRoleManager implements DiscordRoleManager {
  private readonly rest: REST;
  private readonly guildId: string;

  constructor(input: { token: string; guildId: string; rest?: REST }) {
    this.rest = input.rest ?? new REST({ version: "10" }).setToken(input.token);
    this.guildId = input.guildId;
  }

  async discoverOrCreateManagedRoles(
    persisted: Partial<DiscordManagedRoleIds>,
  ): Promise<DiscordManagedRoleIds> {
    const roles = await this.fetchRoles();
    await this.assertManageable(roles);
    const resolved = {} as DiscordManagedRoleIds;

    for (const definition of DISCORD_MANAGED_ROLES) {
      const persistedRole = roles.find((role) => role.id === persisted[definition.key]);
      if (persistedRole) {
        resolved[definition.key] = persistedRole.id;
        continue;
      }

      const discovered = roles
        .filter((role) =>
          role.name === definition.name
          && !role.managed
          && BigInt(role.permissions) === BigInt(0))
        .sort((left, right) => right.position - left.position)[0];
      if (discovered) {
        resolved[definition.key] = discovered.id;
        continue;
      }

      const created = await this.rest.post(Routes.guildRoles(this.guildId), {
        body: {
          name: definition.name,
          permissions: "0",
          mentionable: false,
          hoist: false,
        },
        reason: "Alpha Traders managed seller role provisioning",
      }) as ApiRole;
      if (!isSnowflake(created.id)) {
        throw new DiscordRoleOperationError("api_failure");
      }
      roles.push(created);
      resolved[definition.key] = created.id;
    }

    await this.assertManageable(await this.fetchRoles(), resolved);
    return resolved;
  }

  async synchronizeMemberRoles(input: {
    discordUserId: string;
    desiredStatus: DiscordSellerRoleStatus;
    roleIds: DiscordManagedRoleIds;
  }): Promise<void> {
    try {
      const [member, roles] = await Promise.all([
        this.rest.get(
          Routes.guildMember(this.guildId, input.discordUserId),
        ) as Promise<ApiMember>,
        this.fetchRoles(),
      ]);
      await this.assertManageable(roles, input.roleIds);
      const current = new Set(member.roles);
      const desired = desiredDiscordRoleKeys(input.desiredStatus);

      for (const definition of DISCORD_MANAGED_ROLES) {
        const roleId = input.roleIds[definition.key];
        const shouldHave = desired.has(definition.key);
        if (shouldHave && !current.has(roleId)) {
          await this.rest.put(
            Routes.guildMemberRole(this.guildId, input.discordUserId, roleId),
            { reason: "Alpha Traders seller status synchronization" },
          );
        } else if (!shouldHave && current.has(roleId)) {
          await this.rest.delete(
            Routes.guildMemberRole(this.guildId, input.discordUserId, roleId),
            { reason: "Alpha Traders seller status synchronization" },
          );
        }
      }
    } catch (error) {
      const code = apiErrorCode(error);
      if (code === 10007 || code === 10013) {
        throw new DiscordRoleOperationError("member_not_in_guild", { cause: error });
      }
      if (error instanceof DiscordRoleOperationError) throw error;
      throw new DiscordRoleOperationError("api_failure", { cause: error });
    }
  }

  private async fetchRoles(): Promise<ApiRole[]> {
    const roles = await this.rest.get(Routes.guildRoles(this.guildId));
    if (!Array.isArray(roles)) throw new DiscordRoleOperationError("api_failure");
    return roles as ApiRole[];
  }

  private async assertManageable(
    roles: ApiRole[],
    managedRoleIds?: Partial<DiscordManagedRoleIds>,
  ): Promise<void> {
    const bot = await this.rest.get(Routes.user("@me")) as ApiUser;
    const member = await this.rest.get(
      Routes.guildMember(this.guildId, bot.id),
    ) as ApiMember;
    const botRoles = roles.filter(
      (role) => role.id === this.guildId || member.roles.includes(role.id),
    );
    const permissions = botRoles.reduce(
      (combined, role) => combined.add(BigInt(role.permissions)),
      new PermissionsBitField(),
    );
    if (!permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new DiscordRoleOperationError("missing_manage_roles");
    }

    if (!managedRoleIds) return;
    const highestBotPosition = Math.max(0, ...botRoles.map((role) => role.position));
    for (const roleId of Object.values(managedRoleIds)) {
      if (!roleId) continue;
      const role = roles.find((candidate) => candidate.id === roleId);
      if (!role || role.managed || role.position >= highestBotPosition) {
        throw new DiscordRoleOperationError("role_hierarchy");
      }
      if (BigInt(role.permissions) !== BigInt(0)) {
        throw new DiscordRoleOperationError("role_permissions");
      }
    }
  }
}
