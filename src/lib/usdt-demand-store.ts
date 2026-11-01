import "server-only";
import { getAlphaExchangeRepository, type SnapshotTableName } from "./alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache, assertBuyerEligibleForDemand, publishCommittedNotifications } from "./alpha-exchange-store";
import { getMarketSnapshot } from "./market-service";
import { assertDemandEnabled } from "./usdt-demand-policy";
import { appendDueDemandExpiryNotifications, changeDemand, createDemand, readDemandWorkspace, respondToDemand, withdrawDemandOffer } from "./usdt-demand-engine";
import type { AlphaExchangeDb, AlphaExchangeNotification } from "@/types/alpha-exchange";
import type { MarketSnapshot } from "@/types/market";

export const DEMAND_TABLES: readonly SnapshotTableName[] = ["users", "listings", "purchase_requests", "commissions", "marketplace_enforcement_records", "usdt_demands", "notifications"];
let localQueue: Promise<unknown> = Promise.resolve();
export async function mutateDemands<T>(mutate: (db: AlphaExchangeDb) => T, beforeMutation?: () => Promise<void>) {
  assertDemandEnabled();
  const run = async () => {
    // Refresh after waiting in the local queue, before acquiring a database
    // lock. The policy checks its source expiry again when applying the write.
    if (beforeMutation) await beforeMutation();
    const repository = await getAlphaExchangeRepository();
    const tx = await repository.beginTradeLifecycleTransaction(DEMAND_TABLES);
    let result: T;
    let committedNotifications: AlphaExchangeNotification[] = [];
    const apply = (snapshot: AlphaExchangeDb) => {
      const existingIds = new Set(snapshot.notifications.map(notification => notification.id));
      result = mutate(snapshot);
      // A rebase replaces the speculative publications. Replays and notices
      // already committed by another request must not alert devices again.
      committedNotifications = snapshot.notifications.filter(notification => !existingIds.has(notification.id));
      return snapshot;
    };
    try {
      const db = tx?.snapshot ?? await repository.loadSelectedSnapshot(DEMAND_TABLES);
      apply(db);
      const selectedTables = ["usdt_demands", "notifications"] as const;
      if (tx) await tx.commit(db, { selectedTables });
      else await repository.saveSnapshot(db, { selectedTables, rebaseTables: DEMAND_TABLES,
        rebaseOnLatest: apply });
    } finally { await tx?.close(); }
    invalidateAlphaExchangeStoreCache();
    publishCommittedNotifications(committedNotifications);
    return result!;
  };
  const pending = localQueue.then(run, run); localQueue = pending.catch(() => undefined); return pending;
}
async function mutateAtCurrentReference<T>(mutate: (db: AlphaExchangeDb, market: MarketSnapshot) => T) {
  let market: MarketSnapshot;
  return mutateDemands(db => mutate(db, market), async () => { market = await getMarketSnapshot({ forceRefresh: true }); });
}
export async function readDemands(userId: string, input: Parameters<typeof readDemandWorkspace>[3]) {
  assertDemandEnabled();
  const [db, market] = await Promise.all([(await getAlphaExchangeRepository()).loadSelectedSnapshot(DEMAND_TABLES.filter(t => t !== "notifications")), getMarketSnapshot()]);
  return readDemandWorkspace(db, userId, market, input);
}
export async function publishDemand(userId: string, body: unknown) {
  return mutateAtCurrentReference((db, market) => createDemand(db, userId, body, market, () => assertBuyerEligibleForDemand(db, userId)));
}
export async function editDemand(userId: string, id: string, body: unknown) {
  if ((body as { action?: string })?.action === "cancel") return mutateDemands(db => changeDemand(db, userId, id, body));
  return mutateAtCurrentReference((db, market) => {
    if (["edit", "renew"].includes((body as { action?: string })?.action ?? "")) assertBuyerEligibleForDemand(db, userId);
    return changeDemand(db, userId, id, body, market);
  });
}
export async function offerDemand(userId: string, id: string, body: unknown) {
  return mutateAtCurrentReference((db, market) => respondToDemand(db, userId, id, body, market));
}
export async function withdrawOffer(userId: string, id: string, offerId: string) {
  return mutateDemands(db => withdrawDemandOffer(db, userId, id, offerId));
}
export async function runDemandExpiryNotifications(): Promise<{ notified: number }> {
  return mutateDemands(db => appendDueDemandExpiryNotifications(db));
}
