// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolConstructor: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: function PoolMock(config: unknown) {
    mocks.poolConstructor(config);
    return { on: () => undefined };
  },
}));

import { getRuntimePostgresPool } from "@/lib/postgres-runtime";

const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined) {
  Object.defineProperty(process.env, "NODE_ENV", {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

describe("PostgreSQL runtime TLS", () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & {
      __alphaTradersRuntimeDbPool?: unknown;
    }).__alphaTradersRuntimeDbPool;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.SUPABASE_DB_SSL;
    delete process.env.SUPABASE_DB_CA;
    setNodeEnv(originalNodeEnv);
    vi.clearAllMocks();
  });

  it("forbids disabling database TLS verification in production", () => {
    setNodeEnv("production");
    process.env.SUPABASE_DB_URL = "postgresql://user:pass@pooler.example.com/db";
    process.env.SUPABASE_DB_SSL = "false";
    expect(() => getRuntimePostgresPool()).toThrow(/cannot be disabled/i);
    expect(mocks.poolConstructor).not.toHaveBeenCalled();
  });

  it("verifies the server certificate and accepts an explicit provider CA", () => {
    setNodeEnv("production");
    process.env.SUPABASE_DB_URL = "postgresql://user:pass@pooler.example.com/db?ssl=no-verify&sslmode=no-verify&uselibpqcompat=true";
    process.env.SUPABASE_DB_CA = "test-provider-ca";
    getRuntimePostgresPool();
    expect(mocks.poolConstructor).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: "postgresql://user:pass@pooler.example.com/db",
      ssl: {
        rejectUnauthorized: true,
        ca: "test-provider-ca",
      },
    }));
  });

  it.each(["0", "no-verify"])(
    "strips the pg ssl=%s connection-string TLS bypass",
    (ssl) => {
      setNodeEnv("production");
      process.env.SUPABASE_DB_URL =
        `postgresql://user:pass@pooler.example.com/db?ssl=${ssl}`;
      getRuntimePostgresPool();
      expect(mocks.poolConstructor).toHaveBeenCalledWith(expect.objectContaining({
        connectionString: "postgresql://user:pass@pooler.example.com/db",
        ssl: { rejectUnauthorized: true },
      }));
    },
  );
});
