#!/usr/bin/env node

const DISCORD_API_BASE = "https://discord.com/api/v10";

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = process.env.DISCORD_APPLICATION_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!BOT_TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN");
  process.exit(1);
}
if (!APP_ID) {
  console.error("Missing DISCORD_APPLICATION_ID");
  process.exit(1);
}
if (!GUILD_ID) {
  console.error("Missing DISCORD_GUILD_ID");
  process.exit(1);
}

const commands = [
  {
    name: "market-status",
    description: "Show current Alpha Exchange status links",
    type: 1,
  },
  {
    name: "open-ticket",
    description: "Get the support ticket workflow",
    type: 1,
  },
  {
    name: "seller-apply",
    description: "Get approved-seller application instructions",
    type: 1,
  },
  {
    name: "report-scam",
    description: "Get emergency anti-scam reporting steps",
    type: 1,
  },
];

async function main() {
  const response = await fetch(`${DISCORD_API_BASE}/applications/${APP_ID}/guilds/${GUILD_ID}/commands`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Command registration failed (${response.status}): ${errorText}`);
  }

  const registered = await response.json();
  console.log(`Registered ${Array.isArray(registered) ? registered.length : 0} slash commands.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
