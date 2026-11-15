// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

let sql: PGlite;
beforeAll(async () => {
  sql = await PGlite.create();
  await sql.exec("create schema alpha_exchange; create table alpha_exchange.notifications (id text primary key, payload jsonb not null)");
}, 20_000);
afterAll(async () => { await sql.close(); });

describe("demand email pending-intent lookup", () => {
  it("reads current SQL state as a boolean without returning notification or trade payloads", async () => {
    const query = vi.fn(async (text: string, values?: unknown[]) => sql.query(text, values));
    const repository = new AlphaExchangeRepository({ query, on: vi.fn() } as unknown as Pool);
    vi.spyOn(repository, "ensureReady").mockResolvedValue();
    vi.spyOn(repository, "loadSnapshot").mockRejectedValue(new Error("Full snapshot must not be used"));
    await expect(repository.hasPendingDemandEmailNotifications()).resolves.toBe(false);
    await sql.query("insert into alpha_exchange.notifications values ($1, $2::jsonb)", ["notice", JSON.stringify({
      message: "synthetic fixture".repeat(10000), demandEmail: { state: "queued" },
    })]);
    await expect(repository.hasPendingDemandEmailNotifications()).resolves.toBe(false);
    await sql.exec("update alpha_exchange.notifications set payload = jsonb_set(payload, '{demandEmail,state}', '\"pending\"')");
    await expect(repository.hasPendingDemandEmailNotifications()).resolves.toBe(true);
    await sql.exec("update alpha_exchange.notifications set payload = jsonb_set(payload, '{demandEmail,state}', '\"suppressed\"')");
    await expect(repository.hasPendingDemandEmailNotifications()).resolves.toBe(false);
    for (const result of query.mock.results) {
      expect((await result.value).rows).toEqual([{ has_pending: expect.any(Boolean) }]);
    }
    expect(repository.loadSnapshot).not.toHaveBeenCalled();
  });

  it("propagates database failure without falling back to cached or full snapshots", async () => {
    const repository = new AlphaExchangeRepository({
      query: vi.fn().mockRejectedValue(new Error("preflight unavailable")), on: vi.fn(),
    } as unknown as Pool);
    vi.spyOn(repository, "ensureReady").mockResolvedValue();
    const fallback = vi.spyOn(repository, "loadSnapshot");
    await expect(repository.hasPendingDemandEmailNotifications()).rejects.toThrow("preflight unavailable");
    expect(fallback).not.toHaveBeenCalled();
  });
});
