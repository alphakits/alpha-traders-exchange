// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function filesUnder(path: string): string[] {
  return readdirSync(path).flatMap((entry) => {
    const candidate = resolve(path, entry);
    return statSync(candidate).isDirectory() ? filesUnder(candidate) : [candidate];
  });
}

describe("Discord worker trust boundary", () => {
  it("keeps discord.js and server secrets out of website and client modules", () => {
    const websiteFiles = [
      ...filesUnder(resolve("src/app")),
      ...filesUnder(resolve("src/components")),
    ].filter((path) => /\.(ts|tsx)$/.test(path) && !path.endsWith(".test.ts"));
    const source = websiteFiles.map((path) => readFileSync(path, "utf8")).join("\n");

    expect(source).not.toMatch(/from ["']discord\.js["']/);
    expect(source).not.toContain("DISCORD_BOT_TOKEN");
    expect(source).not.toContain("DISCORD_CLIENT_SECRET");
    expect(source).not.toContain("getDiscordService()");
  });

  it("builds Railway from an allow-listed context without public media or client code", () => {
    const dockerfile = readFileSync(resolve("Dockerfile.discord-worker"), "utf8");
    const dockerignore = readFileSync(resolve(".dockerignore"), "utf8");
    const railway = readFileSync(resolve("railway.json"), "utf8");

    expect(dockerignore).toMatch(/^\*\*$/m);
    expect(dockerignore).not.toContain("!public");
    expect(dockerfile).not.toMatch(/COPY\s+public/i);
    expect(dockerfile).not.toMatch(/COPY\s+src\/components/i);
    expect(railway).toContain('"dockerfilePath": "Dockerfile.discord-worker"');
  });
});
