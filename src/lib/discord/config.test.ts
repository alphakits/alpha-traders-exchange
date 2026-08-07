import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DiscordConfigurationError,
  readDiscordConfig,
} from "@/lib/discord/config";
import { validateDiscordEnv } from "@/lib/env-validation";
import {
  DiscordWorkerConfigurationError,
  readDiscordWorkerProxyConfig,
  readDiscordWorkerRuntimeConfig,
} from "@/lib/discord/worker-config";

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

  describe("Discord worker environment validation", () => {
    const healthSecret = "h".repeat(32);

    it("validates Railway worker settings without exposing the secret", () => {
      expect(readDiscordWorkerRuntimeConfig({
        DISCORD_WORKER_HEALTH_SECRET: healthSecret,
        PORT: "8080",
      })).toEqual({ healthSecret, port: 8080 });

      expect(() => readDiscordWorkerRuntimeConfig({
        DISCORD_WORKER_HEALTH_SECRET: "short-secret",
        PORT: "invalid",
      })).toThrow(DiscordWorkerConfigurationError);
      try {
        readDiscordWorkerRuntimeConfig({
          DISCORD_WORKER_HEALTH_SECRET: "short-secret",
          PORT: "invalid",
        });
      } catch (error) {
        expect(String(error)).not.toContain("short-secret");
      }
    });

    it("requires a fixed HTTPS origin for Vercel diagnostics", () => {
      expect(readDiscordWorkerProxyConfig({
        DISCORD_WORKER_BASE_URL: "https://discord-worker.example.com/",
        DISCORD_WORKER_HEALTH_SECRET: healthSecret,
      })).toEqual({
        baseUrl: "https://discord-worker.example.com",
        healthSecret,
      });

      for (const unsafeUrl of [
        "http://discord-worker.example.com",
        "https://discord-worker.example.com/tenant",
        "https://user@example.com",
        "https://discord-worker.example.com?target=internal",
      ]) {
        expect(() => readDiscordWorkerProxyConfig({
          DISCORD_WORKER_BASE_URL: unsafeUrl,
          DISCORD_WORKER_HEALTH_SECRET: healthSecret,
        })).toThrow(DiscordWorkerConfigurationError);
      }
    });
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
