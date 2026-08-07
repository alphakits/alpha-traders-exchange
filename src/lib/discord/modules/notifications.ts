export type DiscordNotificationRequest = {
  recipientDiscordUserId: string;
  subject: string;
  body: string;
};

export interface DiscordNotifications {
  send(request: DiscordNotificationRequest): Promise<void>;
}
