// @vitest-environment node
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as unknown as Pool }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => state.pool }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/economic-news/config", () => ({ configuredNewsProvider: () => "trading-economics", newsProviderConfigured: () => true, newsProviderPrefix: () => "te-" }));

const paths = ["push registration", "owner content", "email schema", "email claim", "news schema", "news sync"] as const;
type Path = typeof paths[number];
const send = vi.fn();
async function run(path: Path) {
  if (path === "push registration") return (await import("@/lib/mobile-push")).registerMobilePushSubscription({
    userId: "member", sessionToken: "synthetic-session", installationId: "550e8400-e29b-41d4-a716-446655440000",
    expoPushToken: "ExpoPushToken[abcdefghijklmnop]", platform: "ios", locale: "en", appVersion: "1.0.0",
  });
  if (path === "owner content") {
    const { AdminContentRepository } = await import("@/lib/admin-content-repository");
    const repository = new AdminContentRepository(state.pool);
    vi.spyOn(repository, "ensureReady").mockResolvedValue();
    return repository.saveSnapshot({ lessons: [], versions: [], media: [] });
  }
  if (path.startsWith("email")) return (await import("@/lib/marketplace-email-outbox")).runMarketplaceEmailSweep(send);
  return (await import("@/lib/economic-news/repository")).persistNewsSnapshot([]);
}

function fixture(path: Path, failure: "timeout" | "rollback" | "server") {
  const original = failure === "timeout" ? new Error("Query read timeout")
    : Object.assign(new Error("controlled statement failure"), { code: "57014" });
  const clients: Array<{ query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }> = [];
  const target = path === "news sync" ? 1 : 0;
  const connect = vi.fn(async () => {
    const index = clients.length;
    const query = vi.fn(async (sql: string) => {
      if (index === target && sql === "commit") throw original;
      if (index === target && sql === "rollback" && failure === "rollback") throw new Error("rollback socket lost");
      if (sql.includes("select user_id")) return { rows: [{ user_id: "member" }] };
      if (sql.includes(" as wait_ms")) return { rows: [{ wait_ms: 0 }] };
      if (sql.includes(" as acquired")) return { rows: [{ acquired: true }] };
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() }; clients.push(client); return client;
  });
  state.pool = { connect, query: vi.fn(async () => ({ rows: [{ ready: path !== "email schema" }], rowCount: 0 })) } as unknown as Pool;
  return { clients, original, target };
}
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
describe.each(paths)("%s transaction recovery", path => {
  it.each(["timeout", "rollback", "server"] as const)("handles %s failure without false success or an unsafe pooled connection", async failure => {
    const { clients, original, target } = fixture(path, failure);
    await expect(run(path)).rejects.toBe(original);
    const client = clients[target];
    expect(client.release).toHaveBeenCalledTimes(1);
    if (failure === "server") expect(client.release).not.toHaveBeenCalledWith(true);
    else expect(client.release).toHaveBeenCalledWith(true);
    expect(client.query.mock.calls.some(([sql]) => sql === "rollback")).toBe(failure !== "timeout");
    expect(send).not.toHaveBeenCalled();
  });
});

it("does not proceed with owner content writes when its cross-instance lock fails", async () => {
  const error = new Error("Query read timeout");
  const query = vi.fn(async (sql: string) => { if (sql.includes("pg_advisory_xact_lock")) throw error; return { rows: [] }; });
  const release = vi.fn();
  state.pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool;
  await expect(run("owner content")).rejects.toBe(error);
  expect(query.mock.calls.some(([sql]) => /^(truncate|insert|commit|rollback)\b/i.test(sql))).toBe(false);
  expect(release).toHaveBeenCalledExactlyOnceWith(true);
});

it("retries owner content initialization after a transient schema failure", async () => {
  const query = vi.fn().mockRejectedValueOnce(new Error("temporary database outage")).mockResolvedValue({ rows: [{ count: "1" }] });
  const { AdminContentRepository } = await import("@/lib/admin-content-repository");
  const repository = new AdminContentRepository({ query, connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) } as unknown as Pool);
  await expect(repository.ensureReady()).rejects.toThrow("temporary database outage");
  await expect(repository.ensureReady()).resolves.toBeUndefined();
});
