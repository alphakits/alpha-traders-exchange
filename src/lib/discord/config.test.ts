import { describe, expect, it } from "vitest";

import {
  DiscordConfigurationError,
  readDiscordConfig,
} from "@/lib/discord/config";
import { validateDiscordEnv } from "@/lib/env-validation";

describe("Discord environment validation", () => {
  it("reports every missing Discord variable by name without values", () => {
    const result = validateDiscordEnv({});

    expect(result.errors).toEqual([
      "Missing required Discord environment variable: DISCORD_BOT_TOKEN.",
      "Missing required Discord environment variable: DISCORD_APPLICATION_ID.",
      "Missing required Discord environment variable: DISCORD_GUILD_ID.",
    ]);
    expect(() => readDiscordConfig({})).toThrow(DiscordConfigurationError);
  });

  it("rejects malformed application and guild snowflakes", () => {
    const result = validateDiscordEnv({
      DISCORD_BOT_TOKEN: "unit-test-credential",
      DISCORD_APPLICATION_ID: "not-an-id",
      DISCORD_GUILD_ID: "also-not-an-id",
    });

    expect(result.errors).toHaveLength(2);
    expect(result.errors.join(" ")).not.toContain("unit-test-credential");
  });

  it("returns trimmed service configuration", () => {
    const applicationId = "3".repeat(18);
    const guildId = "4".repeat(18);

    expect(readDiscordConfig({
      DISCORD_BOT_TOKEN: " unit-test-credential ",
      DISCORD_APPLICATION_ID: ` ${applicationId} `,
      DISCORD_GUILD_ID: ` ${guildId} `,
    })).toEqual({
      token: "unit-test-credential",
      applicationId,
      guildId,
    });
  });
});
