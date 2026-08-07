export type DiscordRoleSynchronizationRequest = {
  platformUserId: string;
  discordUserId: string;
};

export interface DiscordRoleSynchronization {
  synchronize(request: DiscordRoleSynchronizationRequest): Promise<void>;
}
