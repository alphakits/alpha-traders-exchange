export type DiscordChannelReference = {
  channelId: string;
};

export interface DiscordChannelManagement {
  resolve(name: string): Promise<DiscordChannelReference>;
}
