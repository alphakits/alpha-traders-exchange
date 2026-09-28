export type DiscordSellerEvent = {
  sellerId: string;
  eventName: string;
  occurredAt: string;
};

export interface DiscordSellerEvents {
  publish(event: DiscordSellerEvent): Promise<void>;
}
