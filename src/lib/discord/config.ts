import {
  validateDiscordEnv,
  type EnvironmentValues,
} from "@/lib/env-validation";

export type DiscordConfig = {
  token: string;
  applicationId: string;
  guildId: string;
};

export class DiscordConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Discord configuration is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}).`);
    this.name = "DiscordConfigurationError";
    this.issues = issues;
  }
}

export function readDiscordConfig(env: EnvironmentValues = process.env): DiscordConfig {
  const { errors } = validateDiscordEnv(env);
  if (errors.length > 0) {
    throw new DiscordConfigurationError(errors);
  }

  return {
    token: env.DISCORD_BOT_TOKEN!.trim(),
    applicationId: env.DISCORD_APPLICATION_ID!.trim(),
    guildId: env.DISCORD_GUILD_ID!.trim(),
  };
}
