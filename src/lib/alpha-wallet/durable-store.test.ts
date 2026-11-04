// @vitest-environment node
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConfig } from "pg";
import {
  CommitOutcomeUnknownError,
  createFileWalletStore,
  createPostgresWalletStore,
  type WalletSql,
  type WalletStore,
} from "./durable-store";

const pgFixture = vi.hoisted(() => ({
  created: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(async () => undefined),
  on: vi.fn(),
}));

// The native PostgreSQL adapter is tested without making a network connection.
// Actual PostgreSQL races belong in the explicit disposable-server harness.
vi.mock("pg", async importOriginal => {
  const original = await importOriginal<typeof import("pg")>();
  class FixturePool {
    constructor(configuration: unknown) { pgFixture.created(configuration); }
    connect = pgFixture.connect;
    end = pgFixture.end;
    on(...args: unknown[]) { pgFixture.on(...args); return this; }
  }
  return { ...original, Pool: FixturePool };
});

const LOCAL_URL = "postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_transport";
const stores: WalletStore[] = [];
const directories: string[] = [];

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function databaseError(code: string, message = "synthetic database failure") {
  return Object.assign(new Error(message), { code });
}

type FixtureResult = { rows: Record<string, unknown>[]; command: string };

function fixtureClient(intercept?: (sql: string, params?: unknown[]) => Promise<FixtureResult | undefined>) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]): Promise<FixtureResult> => {
      const intercepted = await intercept?.(sql, params);
      return intercepted ?? { rows: [], command: sql.trim().split(/\s+/)[0].toUpperCase() };
    }),
    release: vi.fn(),
  };
}

async function fileStore(dataDir?: string) {
  const directory = dataDir ?? await mkdtemp(join(tmpdir(), "alpha-wallet-transport-"));
  if (!dataDir) directories.push(directory);
  const store = await createFileWalletStore({ mode: "simulation-only", dataDir: directory });
  stores.push(store);
  return { store, directory };
}

async function postgresStore(connectionString = LOCAL_URL) {
  const store = await createPostgresWalletStore({ mode: "simulation-only", connectionString });
  stores.push(store);
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  pgFixture.connect.mockReset().mockRejectedValue(new Error("No fixture PostgreSQL connection was configured"));
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(async () => {
  await Promise.allSettled(stores.splice(0).map(store => store.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

describe("durable local simulation transport", () => {
  it("persists exact large amounts across close and reopen, with multi-statement bootstrap", async () => {
    const first = await fileStore();
    const amount = "999999999999999999999999999999999999999999999999999999999999999999";
    await first.store.transaction(async tx => {
      await tx.exec("CREATE SCHEMA fixture; CREATE TABLE fixture.balances (id integer PRIMARY KEY, amount numeric(78,0) NOT NULL, sequence bigint NOT NULL)");
      await tx.query("INSERT INTO fixture.balances VALUES (1, $1::numeric, $2::bigint)", [amount, "9007199254740993"]);
    });
    await first.store.close();
    const reopened = await fileStore(first.directory);
    const rows = await reopened.store.transaction(async tx => {
      const isolation = await tx.query<{ level: string; guard: string }>("SELECT current_setting('transaction_isolation') AS level, current_setting('alpha_wallet.development_schema') AS guard");
      expect(isolation.rows).toEqual([{ level: "serializable", guard: "simulation-only" }]);
      return (await tx.query("SELECT amount, sequence FROM fixture.balances WHERE id=1")).rows;
    });
    expect(rows).toEqual([{ amount, sequence: "9007199254740993" }]);
  }, 20000);

  it("rolls back failed callbacks and refuses a success result after a swallowed SQL error", async () => {
    const { store } = await fileStore();
    await store.transaction(tx => tx.exec("CREATE TABLE fixture_values (value integer NOT NULL)"));
    const failure = new Error("synthetic callback failure");
    await expect(store.transaction(async tx => {
      await tx.query("INSERT INTO fixture_values VALUES (1)");
      throw failure;
    })).rejects.toBe(failure);
    await expect(store.transaction(async tx => {
      await tx.query("INSERT INTO fixture_values VALUES (2)");
      try { await tx.query("INSERT INTO fixture_values VALUES (NULL)"); } catch { /* The transport must not commit. */ }
      return "claimed success";
    })).rejects.toMatchObject({ code: "23502" });
    await store.transaction(tx => tx.query("INSERT INTO fixture_values VALUES (3)"));
    await expect(store.transaction(tx => tx.query("SELECT value FROM fixture_values"))).resolves.toEqual({ rows: [{ value: 3 }] });
  }, 20000);

  it("serializes callbacks in one process and prevents use of an escaped transaction handle", async () => {
    const { store } = await fileStore();
    const entered = deferred();
    const release = deferred();
    let escaped!: WalletSql;
    let secondEntered = false;
    const first = store.transaction(async tx => {
      escaped = tx;
      await tx.exec("CREATE TABLE fixture_counter (value integer NOT NULL); INSERT INTO fixture_counter VALUES (0)");
      entered.resolve();
      await release.promise;
      await tx.query("UPDATE fixture_counter SET value=value+1");
    });
    await entered.promise;
    const second = store.transaction(async tx => {
      secondEntered = true;
      await tx.query("UPDATE fixture_counter SET value=value+1");
    });
    await new Promise<void>(done => setImmediate(done));
    expect(secondEntered).toBe(false);
    release.resolve();
    await Promise.all([first, second]);
    expect(secondEntered).toBe(true);
    await expect(escaped.query("SELECT 1")).rejects.toThrow("no longer active");
    await expect(escaped.exec("SELECT 1")).rejects.toThrow("no longer active");
    await expect(store.transaction(tx => tx.query("SELECT value FROM fixture_counter"))).resolves.toEqual({ rows: [{ value: 2 }] });
    // This exercises serialized callbacks in one process, not PostgreSQL races.
  }, 20000);

  it("waits for accepted work during close and refuses any new work", async () => {
    const { store } = await fileStore();
    const entered = deferred();
    const release = deferred();
    const pending = store.transaction(async tx => {
      entered.resolve();
      await release.promise;
      await tx.query("SELECT 1");
      return "finished";
    });
    await entered.promise;
    const closing = store.close();
    expect(store.close()).toBe(closing);
    await expect(store.transaction(async () => undefined)).rejects.toThrow("closing or closed");
    release.resolve();
    await expect(pending).resolves.toBe("finished");
    await closing;
  }, 20000);

  it("refuses a second local instance for the same canonical path until the first closes", async () => {
    const { store, directory } = await fileStore();
    await expect(createFileWalletStore({ mode: "simulation-only", dataDir: join(directory, ".") })).rejects.toThrow("already open");
    await store.close();
    const next = await fileStore(directory);
    await expect(next.store.transaction(tx => tx.query("SELECT 1 AS value"))).resolves.toEqual({ rows: [{ value: 1 }] });
  }, 20000);

  it("refuses unrelated folders, relative paths, roots, and redirected database folders", async () => {
    await expect(createFileWalletStore({ mode: "simulation-only", dataDir: "relative" })).rejects.toThrow("absolute local directory");
    await expect(createFileWalletStore({ mode: "simulation-only", dataDir: "/" })).rejects.toThrow("filesystem root");
    const directory = await mkdtemp(join(tmpdir(), "alpha-wallet-transport-guard-"));
    directories.push(directory);
    await writeFile(join(directory, "unrelated.txt"), "leave this alone");
    await expect(createFileWalletStore({ mode: "simulation-only", dataDir: directory })).rejects.toThrow("nonempty directory");
    expect(await readFile(join(directory, "unrelated.txt"), "utf8")).toBe("leave this alone");
    await writeFile(join(directory, ".alpha-wallet-simulation"), "alpha-wallet-file-store-v1\nsimulation-only\n");
    await symlink(tmpdir(), join(directory, "database"));
    await expect(createFileWalletStore({ mode: "simulation-only", dataDir: directory })).rejects.toThrow("real database subdirectory");
  });
});

describe("simulation and PostgreSQL destination guards", () => {
  it.each([
    "postgresql://fixture:fixture@database.example/alpha_wallet_dev_fixture",
    "postgresql://fixture:fixture@localhost/alpha_wallet_dev_fixture",
    "postgresql://fixture:fixture@127.0.0.2/alpha_wallet_dev_fixture",
    "postgresql://fixture:fixture@[::ffff:127.0.0.1]/alpha_wallet_dev_fixture",
    "postgresql://fixture:fixture@%2Ftmp/alpha_wallet_dev_fixture",
    "postgresql://fixture:fixture@127.0.0.1/production",
    "postgresql://fixture:fixture@127.0.0.1/alpha_wallet_dev_",
    "postgresql://fixture:fixture@127.0.0.1/alpha_wallet_dev_fixture/extra",
    "postgresql://fixture:fixture@127.0.0.1/alpha_wallet_dev_fixture%2Fextra",
    "postgresql://fixture:fixture@127.0.0.1/alpha_wallet_dev_fixture?host=remote.example",
    "postgresql://fixture:fixture@127.0.0.1/alpha_wallet_dev_fixture?",
    "postgresql://fixture:fixture@127.0.0.1/alpha_wallet_dev_fixture#fragment",
    "postgresql://fixture:fixture@127.0.0.1/alpha_wallet_dev_fixture#",
    "postgresql://fixture@127.0.0.1/alpha_wallet_dev_fixture",
    "postgresql://:fixture@127.0.0.1/alpha_wallet_dev_fixture",
    "postgresql://fixture:%00@127.0.0.1/alpha_wallet_dev_fixture",
    "postgresql://fixture:fixture@127.0.0.1:0/alpha_wallet_dev_fixture",
    "https://fixture:fixture@127.0.0.1/alpha_wallet_dev_fixture",
  ])("rejects an unsafe connection URL before constructing a pool: %s", async connectionString => {
    await expect(postgresStore(connectionString)).rejects.toThrow();
    expect(pgFixture.created).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1", "[::1]"])("accepts only the explicit local destination %s without connecting", async host => {
    await postgresStore(`postgresql://fixture:fixture@${host}:5454/alpha_wallet_dev_fixture`);
    const configuration = pgFixture.created.mock.calls[0][0] as PoolConfig;
    expect(configuration).toMatchObject({ host: host === "[::1]" ? "::1" : host, port: 5454, database: "alpha_wallet_dev_fixture", user: "fixture", password: "fixture", ssl: false, max: 4, statement_timeout: 5000, connectionTimeoutMillis: 3000 });
    expect(pgFixture.connect).not.toHaveBeenCalled();
  });

  it("keeps explicit connection and parser settings despite ambient PG variables", async () => {
    for (const [key, value] of Object.entries({ PGHOST: "remote.invalid", PGPORT: "6543", PGDATABASE: "production", PGUSER: "ambient", PGPASSWORD: "ambient-fixture", PGOPTIONS: "-c search_path=public", PGSSLMODE: "require", PGSSLNEGOTIATION: "direct", PGAPPNAME: "ambient", PGCLIENT_ENCODING: "SQL_ASCII", PGCONNECT_TIMEOUT: "90", PGREPLICATION: "database", PGBINARY: "1" })) vi.stubEnv(key, value);
    await postgresStore("postgresql://fixture:percent%25literal@127.0.0.1:5454/alpha_wallet_dev_fixture");
    const configuration = pgFixture.created.mock.calls[0][0] as PoolConfig;
    const client = new configuration.Client!() as unknown as {
      connectionParameters: Record<string, unknown>;
      replication: unknown;
    };
    expect(client.connectionParameters).toMatchObject({ host: "127.0.0.1", port: 5454, database: "alpha_wallet_dev_fixture", user: "fixture", password: "percent%literal", ssl: false, binary: false, replication: undefined, application_name: "alpha-wallet-development-only", options: "-c search_path=pg_catalog -c lock_timeout=2000", client_encoding: "UTF8", sslnegotiation: "postgres", connect_timeout: 3 });
    expect(client.replication).toBeUndefined();
    const parser = configuration.types!.getTypeParser(20, "text");
    expect(parser("9007199254740993")).toBe("9007199254740993");
    expect(configuration.types!.getTypeParser(1700, "text")("12345678901234567890.000000")).toBe("12345678901234567890.000000");
    expect(pgFixture.connect).not.toHaveBeenCalled();
  });

  it("checks the actual runtime at construction, on each transaction, and before commit", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(postgresStore()).rejects.toThrow("local development or test");
    await expect(createFileWalletStore({ mode: "simulation-only", dataDir: "/never-created-alpha-wallet-fixture" })).rejects.toThrow("local development or test");
    expect(pgFixture.created).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "test");
    const store = await postgresStore();
    vi.stubEnv("VERCEL", "1");
    await expect(store.transaction(async () => "no")).rejects.toThrow("refuses hosted runtimes");
    expect(pgFixture.connect).not.toHaveBeenCalled();
    vi.stubEnv("VERCEL", undefined);
    const client = fixtureClient();
    pgFixture.connect.mockResolvedValue(client);
    await expect(store.transaction(async () => {
      vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "true");
      return "no";
    })).rejects.toThrow("cannot enable mainnet or signing");
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("PostgreSQL transaction recovery", () => {
  it("runs trusted SQL inside a serializable guarded transaction and commits once", async () => {
    const client = fixtureClient(async (sql, params) => sql === "SELECT $1::text AS amount" ? { command: "SELECT", rows: [{ amount: params?.[0] }] } : undefined);
    pgFixture.connect.mockResolvedValue(client);
    const store = await postgresStore();
    let escaped!: WalletSql;
    const result = await store.transaction(async tx => {
      escaped = tx;
      await tx.exec("CREATE SCHEMA fixture; CREATE TABLE fixture.values (value integer)");
      return tx.query("SELECT $1::text AS amount", ["9007199254740993"]);
    });
    expect(result.rows).toEqual([{ amount: "9007199254740993" }]);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN ISOLATION LEVEL SERIALIZABLE", "SET LOCAL alpha_wallet.development_schema = 'simulation-only'", "CREATE SCHEMA fixture; CREATE TABLE fixture.values (value integer)", "SELECT $1::text AS amount", "COMMIT"]);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    await expect(escaped.query("SELECT 1")).rejects.toThrow("no longer active");
    await expect(escaped.exec("SELECT 1")).rejects.toThrow("no longer active");
  });

  it.each(["40001", "40P01"])("retries the whole callback after a database work error %s", async code => {
    const failed = fixtureClient(async sql => { if (sql === "SELECT fixture") throw databaseError(code); return undefined; });
    const healthy = fixtureClient();
    pgFixture.connect.mockResolvedValueOnce(failed).mockResolvedValueOnce(healthy);
    const store = await postgresStore();
    const work = vi.fn(async (tx: WalletSql) => { await tx.query("SELECT fixture"); return "committed"; });
    await expect(store.transaction(work)).resolves.toBe("committed");
    expect(work).toHaveBeenCalledTimes(2);
    expect(failed.query).toHaveBeenCalledWith("ROLLBACK");
    expect(failed.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
    expect(failed.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(healthy.query).toHaveBeenCalledWith("COMMIT");
  });

  it.each(["40001", "40P01"])("retries a definitely rejected COMMIT %s with a fresh connection", async code => {
    const failed = fixtureClient(async sql => { if (sql === "COMMIT") throw databaseError(code); return undefined; });
    const healthy = fixtureClient();
    pgFixture.connect.mockResolvedValueOnce(failed).mockResolvedValueOnce(healthy);
    const store = await postgresStore();
    const work = vi.fn(async (tx: WalletSql) => { await tx.query("SELECT fixture"); return "committed"; });
    await expect(store.transaction(work)).resolves.toBe("committed");
    expect(work).toHaveBeenCalledTimes(2);
    expect(failed.query).toHaveBeenCalledWith("ROLLBACK");
    expect(healthy.query).toHaveBeenCalledWith("COMMIT");
    expect(pgFixture.connect).toHaveBeenCalledTimes(2);
  });

  it("stops after exactly three serialization attempts", async () => {
    const failure = databaseError("40001");
    const clients = Array.from({ length: 3 }, () => fixtureClient(async sql => { if (sql === "COMMIT") throw failure; return undefined; }));
    for (const client of clients) pgFixture.connect.mockResolvedValueOnce(client);
    const store = await postgresStore();
    const work = vi.fn(async () => "result");
    await expect(store.transaction(work)).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(3);
    expect(pgFixture.connect).toHaveBeenCalledTimes(3);
    for (const client of clients) expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it.each([new Error("synthetic callback error"), databaseError("40001", "callback invented this code")])("does not retry a callback error that did not come from SQL", async failure => {
    const client = fixtureClient();
    pgFixture.connect.mockResolvedValue(client);
    const store = await postgresStore();
    const work = vi.fn(async () => { throw failure; });
    await expect(store.transaction(work)).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
  });

  it.each(["P0001", "23505"])("propagates a definitive deferred constraint COMMIT rejection %s", async code => {
    const failure = databaseError(code);
    const client = fixtureClient(async sql => { if (sql === "COMMIT") throw failure; return undefined; });
    pgFixture.connect.mockResolvedValue(client);
    const store = await postgresStore();
    await expect(store.transaction(async () => "no")).rejects.toBe(failure);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(pgFixture.connect).toHaveBeenCalledTimes(1);
  });

  it.each([databaseError("ECONNRESET"), databaseError("57014"), new Error("Query read timeout"), new Error("unclassified transport failure")])("keeps a lost COMMIT acknowledgement unknown without retry or rollback", async failure => {
    const client = fixtureClient(async sql => { if (sql === "COMMIT") throw failure; return undefined; });
    pgFixture.connect.mockResolvedValue(client);
    const store = await postgresStore();
    const work = vi.fn(async (tx: WalletSql) => { await tx.query("SELECT fixture"); return "must not escape"; });
    const result = store.transaction(work);
    await expect(result).rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    await expect(result).rejects.toMatchObject({ code: "ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN", cause: failure });
    expect(work).toHaveBeenCalledTimes(1);
    expect(pgFixture.connect).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("discards a connection lost during work and does not rerun the callback", async () => {
    const failure = databaseError("ECONNRESET");
    const client = fixtureClient(async sql => { if (sql === "SELECT fixture") throw failure; return undefined; });
    pgFixture.connect.mockResolvedValue(client);
    const store = await postgresStore();
    const work = vi.fn(async (tx: WalletSql) => tx.query("SELECT fixture"));
    await expect(store.transaction(work)).rejects.toBe(failure);
    expect(work).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("ROLLBACK");
  });

  it("does not report success if PostgreSQL responds to COMMIT with ROLLBACK", async () => {
    const client = fixtureClient(async sql => sql === "COMMIT" ? { command: "ROLLBACK", rows: [] } : undefined);
    pgFixture.connect.mockResolvedValue(client);
    const store = await postgresStore();
    await expect(store.transaction(async () => "no")).rejects.toThrow("rolled back instead of committed");
    expect(pgFixture.connect).toHaveBeenCalledTimes(1);
  });

  it("cannot hide a failed statement by swallowing the query error inside the callback", async () => {
    const failure = databaseError("23502");
    const client = fixtureClient(async sql => { if (sql === "SELECT fixture") throw failure; return undefined; });
    pgFixture.connect.mockResolvedValue(client);
    const store = await postgresStore();
    await expect(store.transaction(async tx => {
      try { await tx.query("SELECT fixture"); } catch { /* Transport must reject. */ }
      return "no";
    })).rejects.toBe(failure);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
  });

  it("waits for outstanding transactions before closing the pool exactly once", async () => {
    const client = fixtureClient();
    pgFixture.connect.mockResolvedValue(client);
    const store = await postgresStore();
    const entered = deferred();
    const release = deferred();
    const pending = store.transaction(async () => { entered.resolve(); await release.promise; return "done"; });
    await entered.promise;
    const closing = store.close();
    expect(store.close()).toBe(closing);
    expect(pgFixture.end).not.toHaveBeenCalled();
    await expect(store.transaction(async () => undefined)).rejects.toThrow("closing or closed");
    release.resolve();
    await expect(pending).resolves.toBe("done");
    await closing;
    expect(pgFixture.end).toHaveBeenCalledTimes(1);
  });
});
