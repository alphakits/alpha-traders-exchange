#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DISCORD_API_BASE = "https://discord.com/api/v10";

const CHANNEL_TYPE = {
  text: 0,
  voice: 2,
  announcement: 5,
  forum: 15,
};

const PERMISSION_BITS = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_EMOJIS_AND_STICKERS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
};

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const BLUEPRINT_PATH = process.env.DISCORD_BLUEPRINT_PATH || path.join(process.cwd(), "scripts", "discord", "alpha-discord-blueprint.json");
const DRY_RUN = process.env.DISCORD_DRY_RUN === "1";

if (!BOT_TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN");
  process.exit(1);
}
if (!GUILD_ID) {
  console.error("Missing DISCORD_GUILD_ID");
  process.exit(1);
}

function toPermissionString(symbols = []) {
  let value = 0n;
  for (const symbol of symbols) {
    const bit = PERMISSION_BITS[symbol];
    if (!bit) {
      throw new Error(`Unsupported permission symbol: ${symbol}`);
    }
    value |= bit;
  }
  return value.toString();
}

async function discordRequest(method, endpoint, body, auditReason) {
  const url = `${DISCORD_API_BASE}${endpoint}`;
  const headers = {
    Authorization: `Bot ${BOT_TOKEN}`,
    "Content-Type": "application/json",
  };
  if (auditReason) {
    headers["X-Audit-Log-Reason"] = encodeURIComponent(auditReason);
  }

  if (DRY_RUN) {
    console.log(`[dry-run] ${method} ${endpoint}`, body ? JSON.stringify(body) : "");
    return null;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${endpoint} failed: ${response.status} ${text}`);
  }

  if (response.status === 204) return null;
  return await response.json();
}

async function getBlueprint() {
  const raw = await fs.readFile(BLUEPRINT_PATH, "utf8");
  return JSON.parse(raw);
}

function normalizeOverwrites(overwrites, roleIdsByKey, guildId) {
  return (overwrites || []).map((entry) => {
    const target = entry.subject;
    const targetId = target === "@everyone" ? guildId : roleIdsByKey[target];
    if (!targetId) {
      throw new Error(`Permission overwrite references unknown subject: ${target}`);
    }
    return {
      id: targetId,
      type: 0,
      allow: toPermissionString(entry.allow || []),
      deny: toPermissionString(entry.deny || []),
    };
  });
}

async function fetchGuildState() {
  const [roles, channels, automod] = await Promise.all([
    discordRequest("GET", `/guilds/${GUILD_ID}/roles`),
    discordRequest("GET", `/guilds/${GUILD_ID}/channels`),
    discordRequest("GET", `/guilds/${GUILD_ID}/auto-moderation/rules`),
  ]);

  return {
    roles: roles || [],
    channels: channels || [],
    automod: automod || [],
  };
}

async function ensureRoles(blueprintRoles, existingRoles) {
  const existingByName = new Map(existingRoles.map((r) => [r.name.toLowerCase(), r]));
  const roleIdsByKey = {};

  for (const role of blueprintRoles) {
    const existing = existingByName.get(role.name.toLowerCase());
    const payload = {
      name: role.name,
      color: role.color,
      hoist: Boolean(role.hoist),
      mentionable: Boolean(role.mentionable),
      permissions: toPermissionString(role.permissions || []),
    };

    if (!existing) {
      const created = await discordRequest("POST", `/guilds/${GUILD_ID}/roles`, payload, `Alpha setup: create role ${role.name}`);
      roleIdsByKey[role.key] = created.id;
      console.log(`Created role: ${role.name}`);
    } else {
      const updated = await discordRequest("PATCH", `/guilds/${GUILD_ID}/roles/${existing.id}`, payload, `Alpha setup: update role ${role.name}`);
      roleIdsByKey[role.key] = updated.id;
      console.log(`Updated role: ${role.name}`);
    }
  }

  return roleIdsByKey;
}

function buildChannelPayload(channel, parentId, categoryOverwrites, roleIdsByKey) {
  const ownOverwrites = normalizeOverwrites(channel.overwrites, roleIdsByKey, GUILD_ID);
  const merged = [...(categoryOverwrites || []), ...ownOverwrites];

  const payload = {
    name: channel.name,
    type: CHANNEL_TYPE[channel.type],
    parent_id: parentId,
    permission_overwrites: merged,
    topic: channel.topic,
  };

  if (typeof channel.userLimit === "number") payload.user_limit = channel.userLimit;
  if (typeof channel.rateLimitPerUser === "number") payload.rate_limit_per_user = channel.rateLimitPerUser;
  if (typeof channel.defaultAutoArchiveDuration === "number") payload.default_auto_archive_duration = channel.defaultAutoArchiveDuration;

  return payload;
}

async function ensureCategoriesAndChannels(blueprint, existingChannels, roleIdsByKey) {
  const existingByName = new Map(existingChannels.map((c) => [c.name.toLowerCase(), c]));
  const categoryIdByKey = {};
  const channelIdByName = {};

  for (const category of blueprint.categories) {
    const existingCategory = existingByName.get(category.name.toLowerCase());
    const categoryOverwrites = normalizeOverwrites(category.overwrites, roleIdsByKey, GUILD_ID);

    let categoryId;
    if (!existingCategory) {
      const created = await discordRequest(
        "POST",
        `/guilds/${GUILD_ID}/channels`,
        {
          name: category.name,
          type: 4,
          position: category.position,
          permission_overwrites: categoryOverwrites,
        },
        `Alpha setup: create category ${category.name}`,
      );
      categoryId = created.id;
      channelIdByName[created.name.toLowerCase()] = created.id;
      console.log(`Created category: ${category.name}`);
    } else {
      const updated = await discordRequest(
        "PATCH",
        `/channels/${existingCategory.id}`,
        {
          name: category.name,
          position: category.position,
          permission_overwrites: categoryOverwrites,
        },
        `Alpha setup: update category ${category.name}`,
      );
      categoryId = updated.id;
      channelIdByName[updated.name.toLowerCase()] = updated.id;
      console.log(`Updated category: ${category.name}`);
    }

    categoryIdByKey[category.key] = categoryId;

    for (const channel of category.channels) {
      const existingChannel = existingByName.get(channel.name.toLowerCase());
      const payload = buildChannelPayload(channel, categoryId, categoryOverwrites, roleIdsByKey);

      if (!existingChannel) {
        try {
          const created = await discordRequest("POST", `/guilds/${GUILD_ID}/channels`, payload, `Alpha setup: create channel ${channel.name}`);
          channelIdByName[created.name.toLowerCase()] = created.id;
          console.log(`Created channel: ${channel.name}`);
        } catch (error) {
          if (channel.type === "announcement") {
            const fallbackPayload = { ...payload, type: CHANNEL_TYPE.text };
            const createdFallback = await discordRequest("POST", `/guilds/${GUILD_ID}/channels`, fallbackPayload, `Alpha setup: fallback channel ${channel.name}`);
            channelIdByName[createdFallback.name.toLowerCase()] = createdFallback.id;
            console.warn(`Announcement channel fallback to text: ${channel.name}`);
          } else {
            throw error;
          }
        }
      } else {
        const updatePayload = {
          name: channel.name,
          parent_id: categoryId,
          permission_overwrites: payload.permission_overwrites,
          topic: payload.topic,
          rate_limit_per_user: payload.rate_limit_per_user,
          user_limit: payload.user_limit,
          default_auto_archive_duration: payload.default_auto_archive_duration,
        };
        const updated = await discordRequest("PATCH", `/channels/${existingChannel.id}`, updatePayload, `Alpha setup: update channel ${channel.name}`);
        channelIdByName[updated.name.toLowerCase()] = updated.id;
        console.log(`Updated channel: ${channel.name}`);
      }
    }
  }

  return { categoryIdByKey, channelIdByName };
}

async function ensureWelcomeScreen(welcomeScreenConfig, channelIdByName) {
  if (!welcomeScreenConfig) return;
  const welcomeChannels = [];
  for (const item of welcomeScreenConfig.channels || []) {
    const channelId = channelIdByName[item.name.toLowerCase()];
    if (!channelId) {
      console.warn(`Skipping welcome channel not found: ${item.name}`);
      continue;
    }
    welcomeChannels.push({
      channel_id: channelId,
      description: item.description,
      emoji_name: item.emoji_name,
    });
  }

  try {
    await discordRequest(
      "PATCH",
      `/guilds/${GUILD_ID}/welcome-screen`,
      {
        enabled: Boolean(welcomeScreenConfig.enabled),
        description: welcomeScreenConfig.description,
        welcome_channels: welcomeChannels,
      },
      "Alpha setup: configure welcome screen",
    );
    console.log("Configured welcome screen");
  } catch (error) {
    console.warn("Welcome screen could not be configured automatically. Ensure Community mode is enabled.");
    console.warn(String(error));
  }
}

function resolveRoleKeysToIds(roleKeys, roleIdsByKey) {
  return (roleKeys || []).map((key) => {
    const id = roleIdsByKey[key];
    if (!id) throw new Error(`Unknown role key in automod rule: ${key}`);
    return id;
  });
}

function resolveChannelNamesToIds(channelNames, channelIdByName) {
  return (channelNames || []).map((name) => {
    const id = channelIdByName[String(name).toLowerCase()];
    if (!id) throw new Error(`Unknown channel name in automod rule: ${name}`);
    return id;
  });
}

function normalizeAutomodActions(actions, channelIdByName) {
  return (actions || []).map((action) => {
    if (action.type === 2 && action.metadata?.channel_name) {
      const id = channelIdByName[String(action.metadata.channel_name).toLowerCase()];
      if (!id) throw new Error(`Unknown log channel in automod action: ${action.metadata.channel_name}`);
      return {
        type: action.type,
        metadata: { channel_id: id },
      };
    }
    return action;
  });
}

async function ensureAutomodRules(automodRules, existingAutomod, roleIdsByKey, channelIdByName) {
  const existingByName = new Map((existingAutomod || []).map((rule) => [String(rule.name).toLowerCase(), rule]));

  for (const rule of automodRules || []) {
    const payload = {
      name: rule.name,
      event_type: rule.event_type,
      trigger_type: rule.trigger_type,
      trigger_metadata: rule.trigger_metadata || {},
      actions: normalizeAutomodActions(rule.actions, channelIdByName),
      enabled: Boolean(rule.enabled),
      exempt_roles: resolveRoleKeysToIds(rule.exempt_roles, roleIdsByKey),
      exempt_channels: resolveChannelNamesToIds(rule.exempt_channels, channelIdByName),
    };

    const existing = existingByName.get(rule.name.toLowerCase());
    if (!existing) {
      await discordRequest("POST", `/guilds/${GUILD_ID}/auto-moderation/rules`, payload, `Alpha setup: create automod ${rule.name}`);
      console.log(`Created automod rule: ${rule.name}`);
    } else {
      await discordRequest("PATCH", `/guilds/${GUILD_ID}/auto-moderation/rules/${existing.id}`, payload, `Alpha setup: update automod ${rule.name}`);
      console.log(`Updated automod rule: ${rule.name}`);
    }
  }
}

async function configureGuildSettings(guildConfig) {
  if (!guildConfig) return;

  const payload = {
    name: guildConfig.name,
    description: guildConfig.description,
    verification_level: guildConfig.verification_level,
    default_message_notifications: guildConfig.default_message_notifications,
    explicit_content_filter: guildConfig.explicit_content_filter,
    preferred_locale: guildConfig.preferred_locale,
  };

  await discordRequest("PATCH", `/guilds/${GUILD_ID}`, payload, "Alpha setup: harden guild settings");
  console.log("Configured guild security settings");
}

async function main() {
  const blueprint = await getBlueprint();
  const state = await fetchGuildState();

  await configureGuildSettings(blueprint.guild);

  const roleIdsByKey = await ensureRoles(blueprint.roles || [], state.roles || []);
  const { channelIdByName } = await ensureCategoriesAndChannels(blueprint, state.channels || [], roleIdsByKey);
  await ensureWelcomeScreen(blueprint.welcomeScreen, channelIdByName);
  await ensureAutomodRules(blueprint.automod || [], state.automod || [], roleIdsByKey, channelIdByName);

  console.log("Alpha Discord provisioning completed.");
}

main().catch((error) => {
  console.error("Provisioning failed.");
  console.error(error);
  process.exit(1);
});
