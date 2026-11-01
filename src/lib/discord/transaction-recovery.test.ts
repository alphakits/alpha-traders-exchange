// @vitest-environment node
import type { Pool } from "pg";
import type { ChatInputCommandInteraction, REST } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { linkDiscordIdentity } from "./identity-repository";
import { claimDiscordListingShare } from "./listing-share-repository";
import { enqueueDiscordOperatorReconciliation } from "./management";
import { DiscordCommunityCommandService } from "./community-commands";
import { DiscordRoleSyncWorker } from "./role-sync-worker";
import { DiscordListingSyncWorker } from "./listing-sync-worker";
import type { DiscordGatewayClient } from "./gateway-client";
import type { DiscordRoleManager } from "./role-manager";
import type { DiscordListingPublisher } from "./listing-publisher";

const paths = ["identity", "operator", "share denial audit", "role provisioning", "role job", "listing job", "community claim"] as const;
const applicationId = "111111111111111111", guildId = "222222222222222222";
function community(pool: Pool) { return new DiscordCommunityCommandService({ pool, gateway: {} as DiscordGatewayClient,
  token: "synthetic", applicationId, guildId, siteUrl: "https://www.alphatraders.co.il", rest: { get: vi.fn().mockResolvedValue([]) } as unknown as REST }); }
async function run(path: typeof paths[number], pool: Pool) {
  if (path === "identity") return linkDiscordIdentity({ platformUserId: "member", profile: { id: "333333333333333333", username: "synthetic", globalName: null }, pool });
  if (path === "operator") return enqueueDiscordOperatorReconciliation({ actorUserId: "owner", idempotencyKey: "550e8400-e29b-41d4-a716-446655440000", pool });
  if (path === "share denial audit") return claimDiscordListingShare({ sellerId: "member", listingId: "listing", requestKey: "synthetic-operation-key", pool });
  if (path === "community claim") return community(pool).handle({ applicationId, guildId, commandName: "help", id: "interaction", user: { id: "333333333333333333" }, deferReply: vi.fn().mockResolvedValue(undefined) } as unknown as ChatInputCommandInteraction);
  if (path === "listing job") return new DiscordListingSyncWorker({ pool, publisher: {} as DiscordListingPublisher, siteUrl: "https://www.alphatraders.co.il" }).processAvailableJobs();
  const worker = new DiscordRoleSyncWorker({ pool, manager: {} as DiscordRoleManager });
  if (path === "role provisioning") return worker.start();
  Object.assign(worker, { roleIds: {} });
  return worker.processAvailableJobs();
}
describe.each(paths)("Discord %s transaction cleanup", path => {
  it.each(["timeout", "rollback", "server"] as const)("recovers from %s without masking the error or reusing an uncertain connection", async failure => {
    const original = failure === "timeout" ? new Error("Query read timeout") : Object.assign(new Error("controlled statement failure"), { code: "57014" });
    const query = vi.fn(async (sql: string) => {
      if (sql === (path === "share denial audit" ? "commit" : "begin")) throw original;
      if (sql === "rollback" && failure === "rollback") throw new Error("rollback socket lost");
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query, release }), query: vi.fn().mockResolvedValue({ rows: [{ id: "job", seller_id: "seller", event_version: "1" }] }) } as unknown as Pool;
    await expect(run(path, pool)).rejects.toBe(original);
    expect(release).toHaveBeenCalledTimes(1);
    if (failure === "server") expect(release).not.toHaveBeenCalledWith(true);
    else expect(release).toHaveBeenCalledWith(true);
    expect(query.mock.calls.some(([sql]) => sql === "rollback")).toBe(failure !== "timeout");
  });
});

it.each(["lock", "registry"])("discards a command registry connection after an uncertain %s query without queuing unlock", async stage => {
  const original = new Error("Query read timeout");
  const query = vi.fn(async (sql: string) => {
    if ((stage === "lock" && sql.includes("pg_advisory_lock")) || (stage === "registry" && sql.includes("from alpha_exchange.discord_command_registry"))) throw original;
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool;
  await expect(community(pool).reconcile()).rejects.toBe(original);
  expect(query.mock.calls.some(([sql]) => sql.includes("pg_advisory_unlock"))).toBe(false);
  expect(release).toHaveBeenCalledExactlyOnceWith(true);
});
