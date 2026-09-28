export type DiscordAnnouncementRequest = {
  subject: string;
  body: string;
};

export interface DiscordAnnouncementBroadcasting {
  broadcast(request: DiscordAnnouncementRequest): Promise<void>;
}
