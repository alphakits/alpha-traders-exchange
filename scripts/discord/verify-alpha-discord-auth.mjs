#!/usr/bin/env node

const DISCORD_API_BASE = "https://discord.com/api/v10";

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!BOT_TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN");
  process.exit(1);
}
if (!GUILD_ID) {
  console.error("Missing DISCORD_GUILD_ID");
  process.exit(1);
}

async function discordGet(endpoint) {
  const response = await fetch(`${DISCORD_API_BASE}${endpoint}`, {
    method: "GET",
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(`GET ${endpoint} failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }

  return payload;
}

async function main() {
  const botUser = await discordGet("/users/@me");
  const guild = await discordGet(`/guilds/${GUILD_ID}`);

  console.log(`Bot authenticated as: ${botUser.username} (${botUser.id})`);
  console.log(`Guild access confirmed: ${guild.name} (${guild.id})`);
  console.log("Discord bot verification passed.");
}

main().catch((error) => {
  console.error("Discord bot verification failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
