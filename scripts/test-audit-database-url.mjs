import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { requireAuditDatabaseUrl } from "./integration/audit-database-url.mjs";

const base = "postgresql://postgres:synthetic-only@127.0.0.1:5432/alpha_exchange_ci";

test("the driver can override a URL host without opening a connection; the audit must reject it", () => {
  const override = `${base}?host=external.invalid&user=unexpected-user&port=6543`;
  assert.equal(new URL(override).hostname, "127.0.0.1");
  const connection = new pg.Client({ connectionString: override }).connectionParameters;
  assert.equal(connection.host, "external.invalid");
  assert.equal(connection.user, "unexpected-user");
  assert.equal(connection.port, 6543);
  assert.throws(() => requireAuditDatabaseUrl(override), /Dedicated loopback CI database required/);
});

test("audit tools reject connection overrides, file options and malformed targets without exposing input", () => {
  const rejected = [
    `${base}?host=external.invalid`, `${base}?%68ost=external.invalid`, `${base}?host=localhost&host=external.invalid`,
    `${base}?user=unexpected-user`, `${base}?password=not-a-real-secret`, `${base}?port=6543`,
    `${base}?sslrootcert=/private/not-a-real-file`, `${base}?options=-csearch_path%3Dpublic`, `${base}#unreviewed`,
    base.replace("postgresql:", "https:"), base.replace("127.0.0.1", "external.invalid"),
    base.replace("/alpha_exchange_ci", "/postgres"), base.replace("postgres:", "other-user:"),
    "not-a-url-with-a-private-password", "", undefined,
  ];
  for (const value of rejected) {
    assert.throws(() => requireAuditDatabaseUrl(value), error => {
      assert.equal(error.message, "Dedicated loopback CI database required");
      return true;
    });
  }
  assert.throws(() => requireAuditDatabaseUrl(base.replace("alpha_exchange_ci", "customer_database"), "customer_database"), /Dedicated loopback CI database required/);
});

test("valid loopback fixtures retain the exact driver host, database, user and escaped password", () => {
  for (const host of ["localhost", "127.0.0.1"]) {
    for (const protocol of ["postgres:", "postgresql:"]) {
      for (const database of ["alpha_exchange_ci", "alpha_exchange_restore_ci"]) {
        const url = `${protocol}//postgres:synthetic%40pass%3Fword@${host}:5432/${database}`;
        const checked = requireAuditDatabaseUrl(url, database);
        const connection = new pg.Client({ connectionString: checked.toString() }).connectionParameters;
        assert.equal(connection.host, host); assert.equal(connection.database, database);
        assert.equal(connection.user, "postgres"); assert.equal(connection.password, "synthetic@pass?word");
        assert.equal(connection.port, 5432);
      }
    }
  }
});
