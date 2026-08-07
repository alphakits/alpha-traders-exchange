import "server-only";

/**
 * Contracts only. Phase 1 intentionally provides no role, messaging, event,
 * channel, or audit behavior and registers no Discord listeners or commands.
 */
export type {
  DiscordRoleSynchronization,
  DiscordRoleSynchronizationRequest,
} from "@/lib/discord/modules/role-synchronization";
export type {
  DiscordNotifications,
  DiscordNotificationRequest,
} from "@/lib/discord/modules/notifications";
export type {
  DiscordAnnouncementBroadcasting,
  DiscordAnnouncementRequest,
} from "@/lib/discord/modules/announcement-broadcasting";
export type {
  DiscordSellerEvents,
  DiscordSellerEvent,
} from "@/lib/discord/modules/seller-events";
export type {
  DiscordBuyerEvents,
  DiscordBuyerEvent,
} from "@/lib/discord/modules/buyer-events";
export type {
  DiscordChannelManagement,
  DiscordChannelReference,
} from "@/lib/discord/modules/channel-management";
export type {
  DiscordAuditLogging,
  DiscordAuditRecord,
} from "@/lib/discord/modules/audit-logging";
