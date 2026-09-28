export type DiscordBuyerEvent = {
  buyerId: string;
  eventName: string;
  occurredAt: string;
};

export interface DiscordBuyerEvents {
  publish(event: DiscordBuyerEvent): Promise<void>;
}
