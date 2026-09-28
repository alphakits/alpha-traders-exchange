#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const ENV_FILE = path.resolve(process.cwd(), ".env.local");

function normalizeEnvValue(key, value) {
  let normalized = String(value ?? "").trim();

  if (normalized.length >= 2) {
    const wrappedInSingleQuotes = normalized.startsWith("'") && normalized.endsWith("'");
    const wrappedInDoubleQuotes = normalized.startsWith('"') && normalized.endsWith('"');
    if (wrappedInSingleQuotes || wrappedInDoubleQuotes) {
      normalized = normalized.slice(1, -1).trim();
    }
  }

  if (!normalized) {
    throw new Error(`${key} is required.`);
  }

  for (const character of normalized) {
    const code = character.charCodeAt(0);
    if ((code >= 0 && code <= 31) || code === 127) {
      throw new Error(`${key} contains control characters. Paste again without hidden characters.`);
    }
  }

  return normalized;
}

async function ensureEnvFile() {
  try {
    await fs.access(ENV_FILE);
  } catch {
    await fs.writeFile(ENV_FILE, "", "utf8");
  }
}

function upsertEnvValue(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }

  if (content.length > 0 && !content.endsWith("\n")) {
    return `${content}\r\n${line}\r\n`;
  }

  return `${content}${line}\r\n`;
}

function askVisibleQuestion(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(`${prompt}: `, resolve);
  });
}

function askHiddenQuestion(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY || !stdout.isTTY) {
      reject(new Error("Secret prompt requires an interactive terminal."));
      return;
    }

    let buffer = "";
    const wasRaw = stdin.isRaw;

    function cleanup() {
      stdin.off("data", onData);
      stdin.pause();
      if (!wasRaw) {
        stdin.setRawMode(false);
      }
    }

    function onData(chunk) {
      const text = chunk.toString("utf8");

      if (text === "\u0003") {
        cleanup();
        reject(new Error("Input cancelled."));
        return;
      }

      if (text === "\r" || text === "\n") {
        stdout.write("\n");
        cleanup();
        resolve(buffer);
        return;
      }

      if (text === "\b" || text === "\x7f") {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }

      const sanitized = text.replace(/[\r\n]/g, "");
      if (!sanitized) {
        return;
      }

      buffer += sanitized;
      stdout.write("*".repeat(sanitized.length));
    }

    stdout.write(`${prompt}: `);
    if (!wasRaw) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main() {
  await ensureEnvFile();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("Configure Discord environment values for Alpha Traders");
    console.log("Paste directly into the terminal. The bot token stays masked.");

    const botToken = normalizeEnvValue("DISCORD_BOT_TOKEN", await askHiddenQuestion("DISCORD_BOT_TOKEN"));
    const applicationId = normalizeEnvValue("DISCORD_APPLICATION_ID", await askVisibleQuestion(rl, "DISCORD_APPLICATION_ID"));
    const guildId = normalizeEnvValue("DISCORD_GUILD_ID", await askVisibleQuestion(rl, "DISCORD_GUILD_ID"));

    let content = await fs.readFile(ENV_FILE, "utf8");
    content = upsertEnvValue(content, "DISCORD_BOT_TOKEN", botToken);
    content = upsertEnvValue(content, "DISCORD_APPLICATION_ID", applicationId);
    content = upsertEnvValue(content, "DISCORD_GUILD_ID", guildId);
    content = upsertEnvValue(content, "DISCORD_BLUEPRINT_PATH", "scripts/discord/alpha-discord-blueprint.json");
    content = upsertEnvValue(content, "DISCORD_DRY_RUN", "0");

    await fs.writeFile(ENV_FILE, content, "utf8");
    console.log("Saved Discord keys to .env.local");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});