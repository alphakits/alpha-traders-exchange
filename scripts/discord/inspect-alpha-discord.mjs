#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DISCORD_API_BASE = "https://discord.com/api/v10";

const CHANNEL_TYPE = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  15: "forum",
};

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const BLUEPRINT_PATH = process.env.DISCORD_BLUEPRINT_PATH || path.join(process.cwd(), "scripts", "discord", "alpha-discord-blueprint.json");
const REPORT_DIR = process.env.DISCORD_REPORT_DIR || path.join(process.cwd(), "docs", "discord", "reports");

if (!BOT_TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN");
  process.exit(1);
}
if (!GUILD_ID) {
  console.error("Missing DISCORD_GUILD_ID");
  process.exit(1);
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function lc(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeName(value) {
  return lc(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function tokenize(value) {
  return normalizeName(value).split("-").filter(Boolean);
}

function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  if (!union) return 0;
  return inter / union;
}

async function discordRequest(endpoint) {
  const response = await fetch(`${DISCORD_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const err = new Error(`GET ${endpoint} failed: ${response.status}`);
    err.status = response.status;
    err.payload = parsed;
    throw err;
  }

  return parsed;
}

async function safeDiscordRequest(endpoint) {
  try {
    const data = await discordRequest(endpoint);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : "request_failed",
        status: error?.status || null,
        payload: error?.payload || null,
      },
    };
  }
}

async function readBlueprint() {
  const raw = await fs.readFile(BLUEPRINT_PATH, "utf8");
  return JSON.parse(raw);
}

function mapBlueprint(blueprint) {
  const categoryByName = new Map();
  const channels = [];
  for (const category of blueprint.categories || []) {
    categoryByName.set(lc(category.name), category);
    for (const channel of category.channels || []) {
      channels.push({
        ...channel,
        categoryName: category.name,
        categoryKey: category.key,
      });
    }
  }

  return {
    roles: blueprint.roles || [],
    categories: blueprint.categories || [],
    channels,
    categoryByName,
  };
}

function mapExisting(channels, roles) {
  const categories = channels.filter((c) => c.type === 4);
  const nonCategories = channels.filter((c) => c.type !== 4);

  const channelByName = new Map(nonCategories.map((c) => [lc(c.name), c]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const categoryByName = new Map(categories.map((c) => [lc(c.name), c]));
  const roleByName = new Map(roles.map((r) => [lc(r.name), r]));

  return {
    categories,
    nonCategories,
    channelByName,
    categoryById,
    categoryByName,
    roleByName,
  };
}

function compareRoles(blueprintRoles, existingRoleByName) {
  const create = [];
  const modify = [];

  for (const desired of blueprintRoles) {
    const existing = existingRoleByName.get(lc(desired.name));
    if (!existing) {
      create.push(desired.name);
      continue;
    }

    const diffs = [];
    if (Number(existing.color || 0) !== Number(desired.color || 0)) diffs.push("color");
    if (Boolean(existing.hoist) !== Boolean(desired.hoist)) diffs.push("hoist");
    if (Boolean(existing.mentionable) !== Boolean(desired.mentionable)) diffs.push("mentionable");

    const desiredPermSet = new Set((desired.permissions || []).map(String));
    if (desiredPermSet.size > 0) {
      diffs.push("permissions_review");
    }

    if (diffs.length) {
      modify.push({ role: desired.name, diffs });
    }
  }

  return { create, modify };
}

function compareCategories(blueprintCategories, existingCategoryByName) {
  const create = [];
  for (const desired of blueprintCategories) {
    if (!existingCategoryByName.has(lc(desired.name))) create.push(desired.name);
  }
  return { create };
}

function findRenameCandidates(blueprintChannelsMissing, existingUnmatchedChannels) {
  const suggestions = [];
  const used = new Set();

  for (const desired of blueprintChannelsMissing) {
    let best = null;
    const desiredTokens = tokenize(desired.name);

    for (const existing of existingUnmatchedChannels) {
      if (used.has(existing.id)) continue;
      const sameType = CHANNEL_TYPE[existing.type] === desired.type;
      if (!sameType) continue;

      const score = jaccard(desiredTokens, tokenize(existing.name));
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { existing, score };
      }
    }

    if (best) {
      used.add(best.existing.id);
      suggestions.push({
        from: best.existing.name,
        to: desired.name,
        type: desired.type,
        confidence: Number(best.score.toFixed(2)),
      });
    }
  }

  return suggestions;
}

function compareChannels(blueprintChannels, existing) {
  const create = [];
  const move = [];
  const archive = [];

  const matchedExistingIds = new Set();

  for (const desired of blueprintChannels) {
    const current = existing.channelByName.get(lc(desired.name));
    if (!current) {
      create.push({ name: desired.name, type: desired.type, category: desired.categoryName });
      continue;
    }

    matchedExistingIds.add(current.id);

    const currentCategory = current.parent_id ? existing.categoryById.get(current.parent_id) : null;
    const currentCategoryName = currentCategory ? currentCategory.name : null;
    if (lc(currentCategoryName) !== lc(desired.categoryName)) {
      move.push({
        channel: desired.name,
        fromCategory: currentCategoryName || "(none)",
        toCategory: desired.categoryName,
      });
    }
  }

  const existingUnmatchedChannels = existing.nonCategories.filter((c) => !matchedExistingIds.has(c.id));
  const renameSuggestions = findRenameCandidates(create, existingUnmatchedChannels);

  const renameTargetNames = new Set(renameSuggestions.map((r) => lc(r.to)));
  const createAfterRename = create.filter((item) => !renameTargetNames.has(lc(item.name)));

  for (const channel of existingUnmatchedChannels) {
    const suggestedRename = renameSuggestions.find((item) => lc(item.from) === lc(channel.name));
    if (suggestedRename) continue;
    archive.push({ name: channel.name, type: CHANNEL_TYPE[channel.type] || String(channel.type) });
  }

  return {
    create: createAfterRename,
    rename: renameSuggestions,
    move,
    archive,
  };
}

function comparePermissionIntents(blueprint, existing) {
  const changes = [];
  const blueprintRoleNames = new Set((blueprint.roles || []).map((r) => lc(r.name)));

  for (const desiredCategory of blueprint.categories || []) {
    const category = existing.categoryByName.get(lc(desiredCategory.name));
    if (!category) continue;

    const desiredOverwriteCount = (desiredCategory.overwrites || []).length;
    const currentOverwriteCount = (category.permission_overwrites || []).length;
    if (desiredOverwriteCount !== currentOverwriteCount) {
      changes.push({
        target: desiredCategory.name,
        kind: "category_overwrites_count",
        current: currentOverwriteCount,
        desired: desiredOverwriteCount,
      });
    }

    for (const desiredChannel of desiredCategory.channels || []) {
      const current = existing.channelByName.get(lc(desiredChannel.name));
      if (!current) continue;
      const desiredCount = ((desiredCategory.overwrites || []).length + (desiredChannel.overwrites || []).length);
      const currentCount = (current.permission_overwrites || []).length;
      if (desiredCount !== currentCount) {
        changes.push({
          target: desiredChannel.name,
          kind: "channel_overwrites_count",
          current: currentCount,
          desired: desiredCount,
        });
      }
    }
  }

  return { changes, blueprintRoleNames: [...blueprintRoleNames] };
}

function gatherPotentialRisks(integrationInfo, permissionChanges, channelDiff, roleDiff) {
  const risks = [];

  if (!integrationInfo.ok) {
    risks.push("Could not read integrations endpoint with current bot permissions; existing integration inventory may be incomplete.");
  }
  if (channelDiff.archive.length > 0) {
    risks.push("Archival candidates detected; avoid delete operations until manual approval confirms no active workflows depend on them.");
  }
  if (channelDiff.rename.length > 0) {
    risks.push("Rename suggestions are heuristic; verify each before applying to avoid breaking existing links/bookmarks.");
  }
  if (roleDiff.modify.length > 0) {
    risks.push("Role modifications can affect moderation and bot command access; preserve owner/admin effective permissions during rollout.");
  }
  if (permissionChanges.changes.length > 0) {
    risks.push("Permission overwrite drift detected; apply in phases and validate private staff/log channels remain hidden.");
  }

  return risks;
}

function markdownList(items, formatter) {
  if (!items.length) return "- None";
  return items.map((item) => `- ${formatter(item)}`).join("\n");
}

function buildReportMarkdown(input) {
  const {
    guild,
    timestamp,
    stats,
    categoryDiff,
    channelDiff,
    roleDiff,
    permissionChanges,
    integrationInfo,
    risks,
  } = input;

  const integrationsSection = integrationInfo.ok
    ? markdownList(integrationInfo.data || [], (i) => `${i.name} (type: ${i.type ?? "unknown"})`)
    : `- Unable to fetch integrations: ${integrationInfo.error?.message || "unknown_error"}`;

  return [
    `# Alpha Traders Discord Migration Report`,
    ``,
    `Generated: ${timestamp}`,
    `Target Guild: ${guild.name} (${guild.id})`,
    ``,
    `## Phase 1 - Inspection Summary`,
    ``,
    `- Categories detected: ${stats.categories}`,
    `- Channels detected (non-category): ${stats.channels}`,
    `- Roles detected: ${stats.roles}`,
    `- Integrations detected: ${integrationInfo.ok ? (integrationInfo.data || []).length : "unknown"}`,
    ``,
    `### Existing Integrations`,
    integrationsSection,
    ``,
    `## Phase 2 - Migration Plan`,
    ``,
    `### New Categories To Create`,
    markdownList(categoryDiff.create, (x) => x),
    ``,
    `### New Channels To Create`,
    markdownList(channelDiff.create, (x) => `${x.name} [${x.type}] in ${x.category}`),
    ``,
    `### Channels To Rename (Suggested)`,
    markdownList(channelDiff.rename, (x) => `${x.from} -> ${x.to} (${x.type}, confidence ${x.confidence})`),
    ``,
    `### Channels To Move`,
    markdownList(channelDiff.move, (x) => `${x.channel}: ${x.fromCategory} -> ${x.toCategory}`),
    ``,
    `### Channels To Archive (Never Delete Without Approval)`,
    markdownList(channelDiff.archive, (x) => `${x.name} [${x.type}]`),
    ``,
    `### Roles To Create`,
    markdownList(roleDiff.create, (x) => x),
    ``,
    `### Roles To Modify`,
    markdownList(roleDiff.modify, (x) => `${x.role}: ${x.diffs.join(", ")}`),
    ``,
    `### Permission Changes`,
    markdownList(permissionChanges.changes, (x) => `${x.target}: ${x.kind} (current ${x.current}, desired ${x.desired})`),
    ``,
    `### Potential Risks`,
    markdownList(risks, (x) => x),
    ``,
    `## Approval Gate`,
    ``,
    `No destructive operation should run until archive/rename candidates are approved by the server owner.`,
  ].join("\n");
}

async function main() {
  const blueprint = await readBlueprint();
  const blueprintMap = mapBlueprint(blueprint);

  const [guild, roles, channels, integrationInfo] = await Promise.all([
    discordRequest(`/guilds/${GUILD_ID}`),
    discordRequest(`/guilds/${GUILD_ID}/roles`),
    discordRequest(`/guilds/${GUILD_ID}/channels`),
    safeDiscordRequest(`/guilds/${GUILD_ID}/integrations`),
  ]);

  const existing = mapExisting(channels || [], roles || []);

  const categoryDiff = compareCategories(blueprintMap.categories, existing.categoryByName);
  const channelDiff = compareChannels(blueprintMap.channels, existing);
  const roleDiff = compareRoles(blueprintMap.roles, existing.roleByName);
  const permissionChanges = comparePermissionIntents(blueprint, existing);
  const risks = gatherPotentialRisks(integrationInfo, permissionChanges, channelDiff, roleDiff);

  const timestamp = new Date().toISOString();
  const stamp = nowStamp();

  const reportJson = {
    timestamp,
    guild: { id: guild.id, name: guild.name },
    stats: {
      categories: existing.categories.length,
      channels: existing.nonCategories.length,
      roles: roles.length,
      integrations: integrationInfo.ok ? (integrationInfo.data || []).length : null,
    },
    categoryDiff,
    channelDiff,
    roleDiff,
    permissionChanges,
    integrationInfo,
    risks,
    snapshot: {
      roles,
      channels,
      integrations: integrationInfo.ok ? integrationInfo.data : null,
    },
  };

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, `discord-migration-report-${stamp}.json`);
  const mdPath = path.join(REPORT_DIR, `discord-migration-report-${stamp}.md`);

  await fs.writeFile(jsonPath, JSON.stringify(reportJson, null, 2));
  await fs.writeFile(mdPath, buildReportMarkdown({
    guild,
    timestamp,
    stats: reportJson.stats,
    categoryDiff,
    channelDiff,
    roleDiff,
    permissionChanges,
    integrationInfo,
    risks,
  }));

  console.log(`Report JSON: ${jsonPath}`);
  console.log(`Report MD: ${mdPath}`);
}

main().catch((error) => {
  console.error("Inspection failed.");
  console.error(error);
  process.exit(1);
});
