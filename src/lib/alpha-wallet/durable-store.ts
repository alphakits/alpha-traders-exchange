import { mkdir, lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, parse, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Client, Pool, types as pgTypes, type PoolClient, type PoolConfig } from "pg";
import { assertSimulationRuntime } from "./runtime";

/** Trusted repository SQL only. Callers must not issue transaction boundaries. */
export interface WalletSql {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
  exec(sql: string): Promise<void>;
}

export interface WalletStore {
  transaction<T>(work: (tx: WalletSql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class CommitOutcomeUnknownError extends Error {
  readonly code = "ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN";
  constructor(cause: unknown) {
    super("Wallet commit outcome is unknown. Reconcile the same command identity before continuing.", { cause });
    this.name = "CommitOutcomeUnknownError";
  }
}

const MAX_TRANSACTION_ATTEMPTS = 3;
const FILE_MARKER = ".alpha-wallet-simulation";
const FILE_MARKER_CONTENT = "alpha-wallet-file-store-v1\nsimulation-only\n";
const openFilePaths = new Set<string>();
const SIMULATION_GUARD = "SET LOCAL alpha_wallet.development_schema = 'simulation-only'";

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

function retryable(error: unknown) {
  return codeOf(error) === "40001" || codeOf(error) === "40P01";
}

function connectionUncertain(error: unknown) {
  const code = codeOf(error);
  return Boolean(code && (/^08/.test(code) || ["57014", "57P01", "57P02", "57P03", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"].includes(code)))
    || (error instanceof Error && /timeout|timed out|connection (?:terminated|closed|lost)|socket|ECONNRESET|EPIPE|ETIMEDOUT/i.test(error.message));
}

/** A server-side constraint/statement rejection is different from losing COMMIT's reply. */
function knownCommitRejection(error: unknown) {
  const code = codeOf(error);
  return !connectionUncertain(error) && Boolean(code && /^(?:22|23|25|40|42|P0)[A-Z0-9]{3}$/.test(code));
}

function assertStoreOpen(closing: boolean, poisoned = false) {
  if (closing) throw new Error("Wallet store is closing or closed");
  if (poisoned) throw new Error("Wallet store requires close and recovery after an uncertain commit");
}

function transactionSql(
  mode: string,
  isActive: () => boolean,
  query: <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>,
  exec: (sql: string) => Promise<void>,
  failed: (error: unknown) => void,
): WalletSql {
  const permitted = () => {
    assertSimulationRuntime(mode);
    if (!isActive()) throw new Error("Wallet transaction is no longer active");
  };
  return Object.freeze({
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) {
      permitted();
      try { return await query<Row>(sql, params); }
      catch (error) { failed(error); throw error; }
    },
    async exec(sql: string) {
      permitted();
      try { await exec(sql); }
      catch (error) { failed(error); throw error; }
    },
  });
}

/**
 * Durable local simulation, with one open PGlite instance per canonical path
 * in this process. Concurrent processes must use PostgreSQL instead. The
 * container marker protects unrelated folders; PostgreSQL files live below it.
 */
export async function createFileWalletStore(options: { mode: "simulation-only"; dataDir: string }): Promise<WalletStore> {
  assertSimulationRuntime(options.mode);
  if (typeof options.dataDir !== "string" || !isAbsolute(options.dataDir) || /[\0-\x1f]/.test(options.dataDir)) {
    throw new Error("Wallet file store requires an explicit absolute local directory");
  }
  const requested = resolve(options.dataDir);
  if (requested === parse(requested).root) throw new Error("Wallet file store cannot use the filesystem root");
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const info = await lstat(requested);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Wallet file store requires a real local directory");
  const canonicalPath = await realpath(requested);
  if (openFilePaths.has(canonicalPath)) throw new Error("Wallet file store is already open in this process");
  openFilePaths.add(canonicalPath);
  let db: PGlite;
  try {
    const files = await readdir(canonicalPath);
    const marker = join(canonicalPath, FILE_MARKER);
    if (files.includes(FILE_MARKER)) {
      if (!(await lstat(marker)).isFile() || await readFile(marker, "utf8") !== FILE_MARKER_CONTENT) {
        throw new Error("Wallet file store simulation marker is invalid");
      }
    } else {
      if (files.length) throw new Error("Wallet file store refuses a nonempty directory without its simulation marker");
      await writeFile(marker, FILE_MARKER_CONTENT, { flag: "wx", mode: 0o600 });
    }
    if (files.includes("database") && !(await lstat(join(canonicalPath, "database"))).isDirectory()) {
      throw new Error("Wallet file store requires a real database subdirectory");
    }
    assertSimulationRuntime(options.mode);
    db = await PGlite.create({
      dataDir: join(canonicalPath, "database"),
      relaxedDurability: false,
      username: "postgres",
      database: "postgres",
      // PostgreSQL int8/numeric must never round custody values through Number.
      parsers: { 20: value => value, 1700: value => value },
    });
  } catch (error) {
    openFilePaths.delete(canonicalPath);
    throw error;
  }

  let closing = false;
  let poisoned = false;
  let tail: Promise<void> = Promise.resolve();
  let closePromise: Promise<void> | undefined;

  async function run<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
      assertSimulationRuntime(options.mode);
      if (poisoned) throw new Error("Wallet store requires close and recovery after an uncertain commit");
      let commitPending = false;
      let active = false;
      let queryFailure: unknown;
      const driverFailures = new Set<unknown>();
      try {
        return await db.transaction(async client => {
          active = true;
          try {
            await client.exec("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
            await client.exec(SIMULATION_GUARD);
            await client.exec("SET LOCAL statement_timeout = '5s'");
            const tx = transactionSql(options.mode, () => active,
              async <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => ({ rows: (await client.query<Row>(sql, params)).rows }),
              async sql => { await client.exec(sql); },
              error => { queryFailure = error; driverFailures.add(error); });
            const result = await work(tx);
            if (driverFailures.size) throw queryFailure;
            assertSimulationRuntime(options.mode);
            commitPending = true;
            return result;
          } finally { active = false; }
        });
      } catch (error) {
        active = false;
        if (commitPending && !knownCommitRejection(error)) {
          poisoned = true;
          throw new CommitOutcomeUnknownError(error);
        }
        if (retryable(error) && (commitPending || driverFailures.has(error)) && attempt + 1 < MAX_TRANSACTION_ATTEMPTS) continue;
        throw error;
      }
    }
    throw new Error("Wallet transaction retries exhausted");
  }

  return Object.freeze({
    transaction<T>(work: (tx: WalletSql) => Promise<T>) {
      try { assertStoreOpen(closing, poisoned); assertSimulationRuntime(options.mode); }
      catch (error) { return Promise.reject(error); }
      // Includes schema bootstrap. Rejections do not poison the scheduling tail.
      const pending = tail.then(() => run(work));
      tail = pending.then(() => undefined, () => undefined);
      return pending;
    },
    close() {
      if (!closePromise) {
        closing = true;
        closePromise = tail.then(() => db.close()).finally(() => { openFilePaths.delete(canonicalPath); });
      }
      return closePromise;
    },
  });
}

function postgresConfiguration(connectionString: string): PoolConfig {
  let url: URL;
  try {
    if (typeof connectionString !== "string" || connectionString.length > 2048 || connectionString.trim() !== connectionString) throw new Error();
    url = new URL(connectionString);
  } catch { throw new Error("Wallet PostgreSQL requires an explicit loopback PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || url.search || url.hash || connectionString.includes("?") || connectionString.includes("#")) {
    throw new Error("Wallet PostgreSQL accepts only exact loopback addresses with no URL options or fragment");
  }
  let username: string, password: string, database: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch { throw new Error("Wallet PostgreSQL URL contains invalid encoding"); }
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(username) || !password || password.length > 128 || /[\0-\x1f\x7f]/.test(password)) {
    throw new Error("Wallet PostgreSQL requires explicit nonempty fixture credentials");
  }
  if (!/^alpha_wallet_dev_[A-Za-z0-9_]{1,46}$/.test(database)) throw new Error("Wallet PostgreSQL requires a dedicated alpha_wallet_dev_ database");
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Wallet PostgreSQL port is invalid");
  const normalized = new URL("postgresql://127.0.0.1");
  normalized.hostname = url.hostname;
  normalized.port = String(port);
  normalized.username = encodeURIComponent(username);
  normalized.password = encodeURIComponent(password);
  normalized.pathname = `/${database}`;
  const configuration: PoolConfig & { binary: boolean; replication: string; sslnegotiation: string } = {
    connectionString: normalized.toString(),
    host: url.hostname === "[::1]" ? "::1" : "127.0.0.1",
    port, database, user: username, password,
    ssl: false, sslnegotiation: "postgres", binary: false, replication: "false",
    client_encoding: "UTF8",
    application_name: "alpha-wallet-development-only",
    fallback_application_name: "alpha-wallet-development-only",
    options: "-c search_path=pg_catalog -c lock_timeout=2000",
    max: 4, min: 0, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000,
    statement_timeout: 5000, query_timeout: 7000, lock_timeout: 2000,
    idle_in_transaction_session_timeout: 5000,
    keepAlive: true, keepAliveInitialDelayMillis: 1000, allowExitOnIdle: true,
    types: {
      getTypeParser(oid, format) {
        if (format !== "binary" && (oid === 20 || oid === 1700)) return (value: string) => value;
        return pgTypes.getTypeParser(oid, format);
      },
    },
  };
  // pg's connection parameters use truthy fallback for PGBINARY/PGREPLICATION.
  // Supply every routing/auth/session field and remove those irrelevant ambient
  // modes from the final client, without reading or changing process PG variables.
  class ExplicitSimulationClient extends Client {
    constructor() {
      super(configuration);
      const client = this as unknown as { connectionParameters: { binary: boolean; replication: undefined }; replication: undefined };
      client.connectionParameters.binary = false;
      client.connectionParameters.replication = undefined;
      client.replication = undefined;
    }
  }
  return { ...configuration, Client: ExplicitSimulationClient };
}

/** No ambient database URL, host, socket, credential file, or SSL option is used. */
export async function createPostgresWalletStore(options: { mode: "simulation-only"; connectionString: string }): Promise<WalletStore> {
  assertSimulationRuntime(options.mode);
  const pool = new Pool(postgresConfiguration(options.connectionString));
  // Idle client errors are emitted by pg-pool after it removes that connection.
  // Active transaction errors still reject their operations below.
  pool.on("error", () => undefined);
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const activeTransactions = new Set<Promise<unknown>>();

  async function run<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
      assertSimulationRuntime(options.mode);
      const client: PoolClient = await pool.connect();
      let phase: "begin" | "work" | "commit" | "done" = "begin";
      let active = false;
      let destroy = false;
      let queryFailure: unknown;
      const driverFailures = new Set<unknown>();
      try {
        assertSimulationRuntime(options.mode);
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await client.query(SIMULATION_GUARD);
        phase = "work";
        active = true;
        const tx = transactionSql(options.mode, () => active,
          async <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
            const result = await client.query<Row>(sql, params);
            if (Array.isArray(result)) throw new Error("Wallet query requires one statement; use exec for trusted schema SQL");
            return { rows: result.rows };
          },
          async sql => { await client.query(sql); },
          error => { queryFailure = error; driverFailures.add(error); });
        const result = await work(tx);
        active = false;
        if (driverFailures.size) throw queryFailure;
        assertSimulationRuntime(options.mode);
        phase = "commit";
        const committed = await client.query("COMMIT");
        if (committed.command !== "COMMIT") {
          phase = "work";
          throw new Error("Wallet transaction was rolled back instead of committed");
        }
        phase = "done";
        return result;
      } catch (error) {
        active = false;
        if (phase === "commit" && !knownCommitRejection(error)) {
          destroy = true;
          throw new CommitOutcomeUnknownError(error);
        }
        destroy = connectionUncertain(error);
        if (!destroy) {
          try { await client.query("ROLLBACK"); }
          catch { destroy = true; }
        }
        if (retryable(error) && (phase === "commit" || driverFailures.has(error)) && attempt + 1 < MAX_TRANSACTION_ATTEMPTS) continue;
        throw error;
      } finally {
        active = false;
        client.release(destroy);
      }
    }
    throw new Error("Wallet transaction retries exhausted");
  }

  return Object.freeze({
    transaction<T>(work: (tx: WalletSql) => Promise<T>) {
      try { assertStoreOpen(closing); assertSimulationRuntime(options.mode); }
      catch (error) { return Promise.reject(error); }
      const pending = run(work);
      activeTransactions.add(pending);
      void pending.then(() => activeTransactions.delete(pending), () => activeTransactions.delete(pending));
      return pending;
    },
    close() {
      if (!closePromise) {
        closing = true;
        closePromise = Promise.allSettled([...activeTransactions]).then(async () => { await pool.end(); });
      }
      return closePromise;
    },
  });
}
