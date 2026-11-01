import type { QueryResult, QueryResultRow } from "pg";

type CatalogQueryable = { query<T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> };
type Column = { name: string; type: string; notNull: boolean; default: string | null; identity: string; generated: string };
type Constraint = { name: string; definition: string; validated: boolean; indexValid: boolean };
type Index = { definition: string; valid: boolean; unique: boolean; constraintBacked: boolean };
type Catalog = {
  kind: string; rls: boolean; serverAccess: boolean; clientAccess: boolean; publicAccess: boolean;
  policies: number; triggers: number; rules: number; columns: Column[]; constraints: Constraint[]; indexes: Index[];
};

// PostgreSQL's parsed, canonical definitions (17/18), not object names alone.
// An equivalent but differently authored constraint requires explicit review.
const REQUIRED_CONSTRAINTS = {
  primary_key: "PRIMARY KEY (id)",
  operation_unique: "UNIQUE (requester_id, operation_id)",
  purchase_unique: "UNIQUE (purchase_request_id)",
  requester_reference: "FOREIGN KEY (requester_id) REFERENCES alpha_exchange.users(id)",
  state: "CHECK ((state = ANY (ARRAY['open'::text, 'matched'::text, 'cancelled'::text, 'expired'::text])))",
  revision: "CHECK ((revision > 0))",
  matched_pointer: "CHECK (((state = 'matched'::text) = (purchase_request_id IS NOT NULL)))",
  payload_identity: "CHECK (COALESCE((((payload ->> 'id'::text) = id) AND ((payload ->> 'requesterId'::text) = requester_id) AND ((payload ->> 'operationId'::text) = operation_id) AND ((payload ->> 'state'::text) = state) AND (((payload ->> 'revision'::text))::integer = revision) AND (((payload ->> 'amount'::text))::numeric > (0)::numeric) AND (((payload ->> 'price'::text))::numeric > (0)::numeric)), false))",
  payload_pointer: "CHECK ((NOT ((payload ->> 'purchaseRequestId'::text) IS DISTINCT FROM purchase_request_id)))",
  decimal_terms: "CHECK (COALESCE(((jsonb_typeof((payload -> 'amount'::text)) = 'string'::text) AND ((payload ->> 'amount'::text) ~ '^[0-9]{1,9}([.][0-9]{1,6})?$'::text) AND (jsonb_typeof((payload -> 'price'::text)) = 'string'::text) AND ((payload ->> 'price'::text) ~ '^[0-9]{1,4}([.][0-9]{1,2})?$'::text)), false))",
} as const;
const REQUIRED_COLUMNS: [string, string, boolean, string | null][] = [
  ["id", "text", true, null], ["requester_id", "text", true, null], ["operation_id", "text", true, null],
  ["state", "text", true, null], ["revision", "integer", true, null], ["purchase_request_id", "text", false, null],
  ["expires_at", "timestamp with time zone", true, null], ["updated_at", "timestamp with time zone", true, null],
  ["sort_index", "integer", true, "0"], ["payload", "jsonb", true, null],
];
const REQUIRED_INDEXES = {
  one_open: "CREATE UNIQUE INDEX idx_usdt_demands_one_open ON alpha_exchange.usdt_demands USING btree (requester_id) WHERE (state = 'open'::text)",
  owner: "CREATE INDEX idx_usdt_demands_owner ON alpha_exchange.usdt_demands USING btree (requester_id, updated_at DESC)",
};

export const USDT_DEMAND_SCHEMA_CATALOG_SQL = `select jsonb_build_object(
  'kind', c.relkind, 'rls', c.relrowsecurity,
  'serverAccess', has_schema_privilege(current_user, c.relnamespace, 'USAGE')
    and has_table_privilege(current_user,c.oid,'SELECT') and has_table_privilege(current_user,c.oid,'INSERT')
    and has_table_privilege(current_user,c.oid,'UPDATE') and has_table_privilege(current_user,c.oid,'DELETE')
    and not row_security_active(c.oid),
  'clientAccess', exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated') and (
    has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
    or r.rolsuper or r.rolbypassrls or pg_has_role(r.oid,c.relowner,'MEMBER'))),
  'publicAccess', exists(select 1 from aclexplode(c.relacl) a where a.grantee=0)
    or exists(select 1 from pg_attribute a, lateral aclexplode(a.attacl) p where a.attrelid=c.oid and p.grantee=0),
  'policies', (select count(*)::int from pg_policy p where p.polrelid=c.oid),
  'triggers', (select count(*)::int from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
  'rules', (select count(*)::int from pg_rewrite r where r.ev_class=c.oid),
  'columns', coalesce((select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated))
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb),
  'constraints', coalesce((select jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid),
    'validated',k.convalidated,'indexValid',case when k.contype in ('p','u') then
      exists(select 1 from pg_index i where i.indexrelid=k.conindid and i.indisvalid and i.indisready and i.indimmediate)
      else true end)) from pg_constraint k where k.conrelid=c.oid and k.contype<>'n'),'[]'::jsonb),
  'indexes', coalesce((select jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),
    'valid',i.indisvalid and i.indisready and i.indimmediate,'unique',i.indisunique,
    'constraintBacked',exists(select 1 from pg_constraint k where k.conindid=i.indexrelid and k.contype in ('p','u'))))
    from pg_index i where i.indrelid=c.oid),'[]'::jsonb)
) as catalog from pg_class c where c.oid=to_regclass('alpha_exchange.usdt_demands')`;

export type UsdtDemandSchemaReadiness = { ready: boolean; issues: string[] };

/** Read-only release check. Reads PostgreSQL catalogs only; never row data or credentials. */
export async function readUsdtDemandSchemaReadiness(target: CatalogQueryable): Promise<UsdtDemandSchemaReadiness> {
  const { rows } = await target.query<{ catalog: Catalog }>(USDT_DEMAND_SCHEMA_CATALOG_SQL);
  const catalog = rows[0]?.catalog;
  if (!catalog) return { ready: false, issues: ["table_missing"] };
  const issues: string[] = [];
  if (catalog.kind !== "r") issues.push("table_kind");
  if (!catalog.rls) issues.push("rls_disabled");
  if (!catalog.serverAccess) issues.push("server_role_access");
  if (catalog.clientAccess) issues.push("client_privileges");
  if (catalog.publicAccess) issues.push("public_privileges");
  if (catalog.policies !== 0) issues.push("unexpected_rls_policies");
  if (catalog.triggers !== 0) issues.push("unexpected_triggers");
  if (catalog.rules !== 0) issues.push("unexpected_rules");
  for (const [name, type, notNull, defaultValue] of REQUIRED_COLUMNS) {
    const column = catalog.columns.find(entry => entry.name === name);
    if (!column || column.type !== type || column.notNull !== notNull || column.default !== defaultValue
      || column.identity || column.generated) issues.push(`column_${name}`);
  }
  if (catalog.columns.some(column => !REQUIRED_COLUMNS.some(([name]) => name === column.name))) issues.push("unexpected_columns");
  for (const [key, definition] of Object.entries(REQUIRED_CONSTRAINTS)) {
    const constraint = catalog.constraints.find(entry => entry.definition === definition);
    if (!constraint || !constraint.validated || !constraint.indexValid) {
      // Only this exact, absent additive check is safe to upgrade automatically.
      const missingDecimal = key === "decimal_terms" && !constraint
        && !catalog.constraints.some(entry => entry.name === "usdt_demands_decimal_terms");
      issues.push(missingDecimal ? "decimal_terms_missing" : `constraint_${key}`);
    }
  }
  const definitions = new Set<string>(Object.values(REQUIRED_CONSTRAINTS));
  if (catalog.constraints.some(entry => !definitions.has(entry.definition))) issues.push("unexpected_constraints");
  for (const [name, definition] of Object.entries(REQUIRED_INDEXES)) {
    if (!catalog.indexes.some(entry => entry.definition === definition && entry.valid)) issues.push(`index_${name}`);
  }
  if (catalog.indexes.some(entry => entry.unique && !entry.constraintBacked && entry.definition !== REQUIRED_INDEXES.one_open)) {
    issues.push("unexpected_unique_indexes");
  }
  return { ready: issues.length === 0, issues };
}
