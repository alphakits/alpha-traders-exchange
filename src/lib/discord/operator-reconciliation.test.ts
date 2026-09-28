import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));

import { DiscordOperatorReconciliationWorker } from "@/lib/discord/operator-reconciliation";

function harness(
  resourcesCompleted = true,
  resultCode: string | null = null,
) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    void params;
    if (sql.includes("select id, lease_fence, attempts, result_code from claimed")) {
      return {
        rows: [{
          id: crypto.randomUUID(),
          lease_fence: 1,
          attempts: 1,
          result_code: resultCode,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("discord_market_content")) return { rows: [], rowCount: 3 };
    if (sql.includes("event_type, detail_code")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const dependencies = {
    pool: { query } as unknown as Pool,
    resources: { reconcile: vi.fn().mockResolvedValue(resourcesCompleted) },
    listings: {
      reconcile: vi.fn().mockResolvedValue(undefined),
      processAvailableJobs: vi.fn().mockResolvedValue(undefined),
      getDiagnostics: vi.fn(() => ({
        status: "ready" as const,
        pendingJobs: 0,
        deadJobs: 0,
        failedMappings: 0,
      })),
    },
    marketIntelligence: {
      tick: vi.fn().mockResolvedValue(undefined),
      getDiagnostics: vi.fn(() => ({
        status: "ready" as const,
        pendingCount: 0,
        deadCount: 0,
      })),
    },
    commands: { reconcile: vi.fn().mockResolvedValue(undefined) },
    pollIntervalMs: 60_000,
  };
  return {
    worker: new DiscordOperatorReconciliationWorker(dependencies),
    dependencies,
    query,
  };
}

describe("Discord operator reconciliation worker", () => {
  it("processes only integration-owned reconciliation methods and completes with fencing", async () => {
    const { worker, dependencies, query } = harness();
    await worker.tick();

    expect(dependencies.resources.reconcile).toHaveBeenCalledOnce();
    expect(dependencies.commands.reconcile).toHaveBeenCalledOnce();
    expect(dependencies.listings.reconcile).toHaveBeenCalledOnce();
    expect(dependencies.marketIntelligence.tick).toHaveBeenCalledOnce();
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("lease_token = $2::uuid")
      && String(sql).includes("lease_fence = $3"))).toBe(true);
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("operator_attempts_exhausted")
      && String(sql).includes("attempts < 3"))).toBe(true);
    expect(JSON.stringify(query.mock.calls)).not.toMatch(
      /cooldown.*reset|sold.*publish|discord_user_id|channel_id|message_id/i,
    );
  });

  it("schedules a bounded retry when resource reconciliation is busy", async () => {
    const { worker, dependencies, query } = harness(false);
    await worker.tick();

    expect(dependencies.commands.reconcile).not.toHaveBeenCalled();
    const queryCalls = query.mock.calls as Array<[string, unknown[]?]>;
    expect(queryCalls.some(([, params]) =>
      Array.isArray(params)
      && params.includes("retry_scheduled")
      && params.includes("resource_reconciliation_busy"))).toBe(true);
  });

  it("defers without consuming an attempt while downstream work remains", async () => {
    const { worker, dependencies, query } = harness();
    dependencies.listings.getDiagnostics.mockReturnValue({
      status: "ready",
      pendingJobs: 2,
      deadJobs: 0,
      failedMappings: 0,
    });

    await worker.tick();

    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("attempts = greatest(attempts - 1, 0)")
      && String(sql).includes("downstream_processing"))).toBe(true);
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("result_code = 'reconciliation_completed'"))).toBe(false);
  });

  it("drains a deferred listing batch without re-enqueuing active mappings", async () => {
    const { worker, dependencies, query } = harness(
      true,
      "downstream_processing",
    );

    await worker.tick();

    expect(dependencies.listings.reconcile).not.toHaveBeenCalled();
    expect(dependencies.listings.processAvailableJobs).toHaveBeenCalledOnce();
    expect(dependencies.resources.reconcile).not.toHaveBeenCalled();
    expect(dependencies.commands.reconcile).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("set refresh_after = now()"))).toBe(false);
  });

  it("waits for an active listing reconciliation before reading fresh diagnostics", async () => {
    const { worker, dependencies, query } = harness();
    let release!: () => void;
    const active = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    dependencies.listings.reconcile.mockImplementation(async () => {
      await active;
      settled = true;
    });
    dependencies.listings.getDiagnostics.mockImplementation(() => ({
      status: "ready",
      pendingJobs: settled ? 0 : 1,
      deadJobs: 0,
      failedMappings: 0,
    }));

    const tick = worker.tick();
    await Promise.resolve();
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("result_code = 'reconciliation_completed'"))).toBe(
      false,
    );

    release();
    await tick;

    expect(settled).toBe(true);
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("result_code = 'reconciliation_completed'"))).toBe(
      true,
    );
  });

  it("propagates an active listing reconciliation failure into the operator retry", async () => {
    const { worker, dependencies, query } = harness();
    dependencies.listings.reconcile.mockRejectedValue(
      new Error("listing_active_run_failed"),
    );

    await worker.tick();

    const queryCalls = query.mock.calls as Array<[string, unknown[]?]>;
    expect(queryCalls.some(([, params]) =>
      Array.isArray(params)
      && params.includes("listing_active_run_failed")
      && params.includes("retry_scheduled"))).toBe(true);
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("result_code = 'reconciliation_completed'"))).toBe(
      false,
    );
  });
});
