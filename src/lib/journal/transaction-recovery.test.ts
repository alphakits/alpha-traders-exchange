import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => ({ connect: state.connect }) }));
import { withJournalUser } from "./repository";

beforeEach(() => vi.clearAllMocks());
describe("private journal transaction recovery", () => {
  it.each(["begin", "context", "operation", "commit"])("discards an uncertain connection after a %s timeout without queuing another query", async stage => {
    const original = new Error("Query read timeout");
    const query = vi.fn(async (sql: string) => {
      if ((stage === "begin" && sql.startsWith("begin")) || (stage === "context" && sql.includes("set_config")) || (stage === "commit" && sql === "commit")) throw original;
      return { rows: [] };
    });
    const release = vi.fn();
    state.connect.mockResolvedValue({ query, release });
    const operation = vi.fn(async () => { if (stage === "operation") throw original; return "saved"; });
    await expect(withJournalUser("synthetic-alice", operation)).rejects.toBe(original);
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain("rollback");
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("preserves the original failure and destroys the connection if rollback fails", async () => {
    const original = new Error("journal write conflict");
    const query = vi.fn(async (sql: string) => { if (sql === "rollback") throw new Error("socket closed"); return { rows: [] }; });
    const release = vi.fn(); state.connect.mockResolvedValue({ query, release });
    await expect(withJournalUser("synthetic-alice", async () => { throw original; })).rejects.toBe(original);
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("rolls back an ordinary rejected write before returning the connection", async () => {
    const original = new Error("version conflict");
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn(); state.connect.mockResolvedValue({ query, release });
    await expect(withJournalUser("synthetic-alice", async () => { throw original; })).rejects.toBe(original);
    expect(query).toHaveBeenLastCalledWith("rollback");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalledWith(true);
  });

  it("commits the authenticated read snapshot before returning its data", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn(); state.connect.mockResolvedValue({ query, release });
    await expect(withJournalUser("synthetic-alice", async () => "private-result", true)).resolves.toBe("private-result");
    expect(query).toHaveBeenCalledWith("begin isolation level repeatable read read only");
    expect(query).toHaveBeenCalledWith("select set_config('alpha_journal.user_id',$1,true)", ["synthetic-alice"]);
    expect(query).toHaveBeenLastCalledWith("commit");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalledWith(true);
  });
});
