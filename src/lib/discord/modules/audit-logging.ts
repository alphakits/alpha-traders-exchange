export type DiscordAuditRecord = {
  action: string;
  actorId: string;
  targetId?: string;
  occurredAt: string;
};

export interface DiscordAuditLogging {
  write(record: DiscordAuditRecord): Promise<void>;
}
