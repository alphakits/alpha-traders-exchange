// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));

it("preserves ordered financial payloads, nested values and empty collections through the snapshot wire format", async () => {
  const database = new PGlite();
  const client = { query: (sql: string, params?: unknown[]) => database.query(sql, params), release() {} };
  const repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
  vi.spyOn(repository, "ensureReady").mockResolvedValue();
  try {
    await database.exec(`create schema alpha_exchange;
      create table alpha_exchange.runtime_meta(singleton boolean primary key, version bigint);
      insert into alpha_exchange.runtime_meta values(true, 73);
      create table alpha_exchange.purchase_requests(sort_index int, payload jsonb);
      create table alpha_exchange.commissions(sort_index int, payload jsonb);
      create table alpha_exchange.notifications(sort_index int, payload jsonb);`);
    const first = { id: "first", usdtAmount: "415.202811", fiatAmount: "1300.00", pricePerUsdt: "3.10",
      messages: [{ message: "العربية / English", unread: false, extra: null }], amountAdjustmentCount: 2 };
    const second = { id: "second", usdtAmount: "0.100000", fiatAmount: "0.31", messages: [] };
    const commission = { id: "fee", sellerFeeAmount: 4.152028, buyerFeeCollectedAmount: 4.152028, commissionAmount: 8.304056 };
    await database.query("insert into alpha_exchange.purchase_requests values (9,$1::jsonb),(3,$2::jsonb)", [JSON.stringify(second), JSON.stringify(first)]);
    await database.query("insert into alpha_exchange.commissions values (0,$1::jsonb)", [JSON.stringify(commission)]);
    const snapshot = await repository.loadSelectedSnapshot(["purchase_requests", "commissions", "notifications"]);
    expect(snapshot.purchaseRequests).toEqual([first, second]);
    expect(snapshot.commissionRecords).toEqual([commission]);
    expect(snapshot.notifications).toEqual([]);
    expect(snapshot.__runtimeVersion).toBe(73);
  } finally { await database.close(); }
}, 30_000);
