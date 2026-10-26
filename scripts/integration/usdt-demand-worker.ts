import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { createPurchaseRequest, getTradeRoomData, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { publishDemand, offerDemand } from "@/lib/usdt-demand-store";
import { demandTestDb } from "@/test-utils/usdt-demand-fixtures";
import { readUsdtDemandSchemaReadiness } from "@/lib/usdt-demand-schema-readiness";
import { getRuntimePostgresPool } from "./postgres-runtime";

globalThis.fetch = async () => { throw new Error("External HTTP disabled in isolated USDT audit"); };
async function execute(operation: string, input: unknown) {
  // The catalog-only command deliberately avoids repository bootstrap.
  if (operation === "catalog") return readUsdtDemandSchemaReadiness(getRuntimePostgresPool());
  if (operation === "flag") { process.env.ALPHA_USDT_REQUESTS_ENABLED = input === "on" ? "1" : "0"; return true; }
  const repository = await getAlphaExchangeRepository();
  if (operation === "ready") { await repository.ensureReady(); return { pid: process.pid }; }
  if (operation === "seed") {
    const fixture = demandTestDb();
    await repository.saveSnapshot(fixture);
    invalidateAlphaExchangeStoreCache();
    return true;
  }
  if (operation === "snapshot") return repository.loadSnapshot();
  if (operation === "publish") {
    const action = input as { userId: string; body: unknown };
    return publishDemand(action.userId, action.body);
  }
  if (operation === "offer") {
    const action = input as { userId: string; demandId: string; body: unknown };
    return offerDemand(action.userId, action.demandId, action.body);
  }
  if (operation === "match") return createPurchaseRequest(input as Parameters<typeof createPurchaseRequest>[0]);
  if (operation === "room") return getTradeRoomData(input as Parameters<typeof getTradeRoomData>[0]);
  throw new Error("Unknown isolated audit operation");
}
process.on("message", async ({ id, operation, input }: { id: number; operation: string; input: unknown }) => {
  try { process.send?.({ id, ok: true, result: await execute(operation, input) }); }
  catch (error) { process.send?.({ id, ok: false, error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code }); }
});
