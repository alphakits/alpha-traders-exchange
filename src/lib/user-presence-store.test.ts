// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

const state = vi.hoisted(() => ({ db: null as unknown as PGlite }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => ({
  query: async (sql: string, params?: unknown[]) => params ? state.db.query(sql, params) : (await state.db.exec(sql)).at(-1),
}) }));
import { recordUserPresence, readUserPresence, endPresenceSession, visibleUserPresence } from "./user-presence-store";

beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`create schema alpha_exchange;
    create table alpha_exchange.users(id text primary key, payload jsonb not null default '{}');
    create table alpha_exchange.sessions(token_hash text primary key, user_id text, expires_at timestamptz);
    insert into alpha_exchange.users values ('seller', '{}'), ('disabled', '{"disabled":true}');
    insert into alpha_exchange.sessions values ('web-a', 'seller', now() + interval '1 day'), ('web-b', 'seller', now() + interval '1 day'), ('disabled-session', 'disabled', now() + interval '1 day');`);
});
afterAll(async () => state.db?.close());

describe("durable presence without trade/profile writes", () => {
  it("tracks two sessions independently, rejects late packets, and keeps actual activity on departure", async () => {
    await recordUserPresence("seller", "web-a", { clientId: "tab-a", sequence: 1, active: true, activity: true });
    await recordUserPresence("seller", "web-b", { clientId: "tab-b", sequence: 1, active: true, activity: true });
    const active = (await readUserPresence(["seller"])).seller;
    expect(active.onlineStatus).toBe("online");
    await recordUserPresence("seller", "web-a", { clientId: "tab-a", sequence: 3, active: false, activity: false });
    await recordUserPresence("seller", "web-a", { clientId: "tab-a", sequence: 2, active: true, activity: true });
    expect((await readUserPresence(["seller"])).seller.onlineStatus).toBe("online");
    await endPresenceSession("web-b");
    const offline = (await readUserPresence(["seller"])).seller;
    expect(offline.onlineStatus).toBe("offline");
    expect(offline.lastActiveAt).toBe(active.lastActiveAt);
    const user = await state.db.query<{ payload: object }>("select payload from alpha_exchange.users where id = 'seller'");
    expect(user.rows[0].payload).toEqual({});
  });

  it("heartbeats alone never fabricate activity; leases expire after disconnection", async () => {
    await recordUserPresence("seller", "web-a", { clientId: "tab-c", sequence: 1, active: true, activity: false });
    expect((await readUserPresence(["seller"])).seller.onlineStatus).toBe("offline");
    await recordUserPresence("seller", "web-a", { clientId: "tab-c", sequence: 2, active: true, activity: true });
    await state.db.exec("update alpha_exchange.user_presence set last_seen_at = now() - interval '91 seconds' where client_id = 'tab-c'");
    expect((await readUserPresence(["seller"])).seller.onlineStatus).toBe("offline");
    await state.db.exec("update alpha_exchange.user_presence set last_seen_at = now(), last_active_at = now() - interval '6 minutes' where client_id = 'tab-c'");
    expect((await readUserPresence(["seller"])).seller.onlineStatus).toBe("offline");
  });

  it("cannot restore online presence after revocation or for a disabled account", async () => {
    await recordUserPresence("disabled", "disabled-session", { clientId: "tab", sequence: 1, active: true, activity: true });
    expect((await readUserPresence(["disabled"])).disabled.lastActiveAt).toBeNull();
    await recordUserPresence("seller", "web-a", { clientId: "tab-c", sequence: 3, active: true, activity: true });
    await state.db.exec("delete from alpha_exchange.sessions where token_hash = 'web-a'");
    expect((await readUserPresence(["seller"])).seller.onlineStatus).toBe("offline");
    await recordUserPresence("seller", "web-a", { clientId: "late-tab", sequence: 9, active: true, activity: true });
    expect((await readUserPresence(["seller"])).seller.onlineStatus).toBe("offline");
  });
});

describe("activity privacy", () => {
  const seller = { id: "private-seller", role: "approved_seller", showLastActive: false } as AlphaExchangeUser;
  const data = { onlineStatus: "online" as const, lastActiveAt: new Date().toISOString() };
  it("hides activity from other users and exposes it only to self and owner", () => {
    expect(visibleUserPresence(seller, data).presenceHidden).toBe(true);
    expect(visibleUserPresence(seller, data, { id: "admin", role: "admin" } as AlphaExchangeUser).lastActiveAt).toBeNull();
    expect(visibleUserPresence(seller, data, seller).lastActiveAt).toBe(data.lastActiveAt);
    expect(visibleUserPresence(seller, data, { id: "owner", role: "owner" } as AlphaExchangeUser).lastActiveAt).toBe(data.lastActiveAt);
  });
  it("respects blocks and never shows a disabled account online", () => {
    expect(visibleUserPresence({ ...seller, showLastActive: true, blockedUserIds: ["buyer"] }, data, { id: "buyer" } as AlphaExchangeUser).presenceHidden).toBe(true);
    expect(visibleUserPresence({ ...seller, disabled: true }, data, seller).onlineStatus).toBe("offline");
  });
});
