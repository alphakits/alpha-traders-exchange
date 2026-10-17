import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => ({ connect: state.connect }) }));
import { PostgresMobileDeviceSessionStore, type MobileDeviceSessionRecord } from "@/lib/mobile-auth-store";

const now = "2026-10-17T00:00:00.000Z";
const record: MobileDeviceSessionRecord = { id: "synthetic-session", userId: "synthetic-user", deviceIdHash: "synthetic-device", accessTokenHash: "synthetic-access", refreshTokenHash: "synthetic-refresh", tokenFamilyId: "synthetic-family", refreshGeneration: 0, platform: "ios", appVersion: "1.0.0", locale: "en", accessExpiresAt: now, refreshExpiresAt: now, lastSeenAt: now, revokedAt: null, revokeReason: null, createdAt: now, updatedAt: now };
const paths = [
  { name: "session issuance", run: () => new PostgresMobileDeviceSessionStore().createOrReplace(record) },
  { name: "refresh rotation", run: () => new PostgresMobileDeviceSessionStore().rotateByRefreshToken({ refreshTokenHash: record.refreshTokenHash, deviceIdHash: record.deviceIdHash, nextAccessTokenHash: "next-access", nextRefreshTokenHash: "next-refresh", nextAccessExpiresAt: now, nextRefreshExpiresAt: now, platform: "ios", appVersion: "1.0.0", locale: "en", now }) },
];
beforeEach(() => vi.clearAllMocks());
describe.each(paths)("mobile $name recovery", ({ run }) => {
  it("discards a timed-out socket without queuing rollback or issuing credentials", async () => {
    const original = new Error("Query read timeout");
    const query = vi.fn(async (sql: string) => { if (sql.includes("pg_advisory_xact_lock")) throw original; return { rows: [] }; });
    const release = vi.fn(); state.connect.mockResolvedValue({ query, release });
    await expect(run()).rejects.toBe(original);
    expect(query.mock.calls.some(([sql]) => /^(insert|update|delete|commit|rollback)\b/i.test(sql))).toBe(false);
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("destroys the connection when rollback fails and preserves the issuance failure", async () => {
    const original = new Error("transaction setup failed");
    const query = vi.fn(async (sql: string) => { if (sql === "begin") throw original; if (sql === "rollback") throw new Error("socket closed"); return { rows: [] }; });
    const release = vi.fn(); state.connect.mockResolvedValue({ query, release });
    await expect(run()).rejects.toBe(original);
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("rolls back a server-cancelled statement before reusing the socket", async () => {
    const original = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    const query = vi.fn(async (sql: string) => { if (sql.includes("pg_advisory_xact_lock")) throw original; return { rows: [] }; });
    const release = vi.fn(); state.connect.mockResolvedValue({ query, release });
    await expect(run()).rejects.toBe(original);
    expect(query).toHaveBeenLastCalledWith("rollback");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalledWith(true);
  });
});
