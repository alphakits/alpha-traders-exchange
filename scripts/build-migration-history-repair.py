#!/usr/bin/env python3
"""Generate the bounded October 18 history adoption; never connect to a database."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--target", choices=("production", "recovery"), required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((ROOT / "scripts/integration/migration-history-adoption-20261018.json").read_text())
catalog = (ROOT / "scripts/integration/application-schema-catalog.sql").read_text().strip().rstrip(";")
files = manifest["files"]
assert len(files) == 39 and len(manifest["existing"]) == 19 and len(manifest["adopt"]) == 20
assert len({item["version"] for item in files}) == len(files)
assert {str(path.relative_to(ROOT)) for path in (ROOT / "supabase/migrations").glob("*.sql")} == {item["file"] for item in files}

def literal(value):
    return "'" + value.replace("'", "''") + "'"

adopt = []
for item in files:
    content = (ROOT / item["file"]).read_text()
    assert hashlib.sha256(content.encode()).hexdigest() == item["sha256"], item["file"]
    if item["version"] in manifest["adopt"]:
        statement = "-- Existing end state verified and adopted on 2026-10-18. Historical SQL below was NOT replayed.\n" + content
        adopt.append({**item, "statement": statement, "digest": hashlib.md5(statement.encode()).hexdigest()})

expected = [{"version": x["version"], "name": x["name"], "digest": x["statementsMd5"],
             "alternate": x["recoveryVersion"] if args.target == "recovery" else x["version"]}
            for x in manifest["existing"]]
allowed = expected + [{"version": x["version"], "alternate": x["version"], "name": x["name"], "digest": x["digest"]} for x in adopt]
trust = (ROOT / "supabase/migrations/20260911113000_reconcile_resurrected_owner_trust_notifications.sql").read_text()
assert trust.count("), repaired as (") == 1
trust_query = trust.split("), repaired as (")[0] + ") select count(*) from resurrected_alerts"

sql = f"""-- Metadata-only adoption. Never replays application DDL or data transformations.
-- Intended target: {args.target}. Abort on any unexpected schema, history or data state.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $audit_history$
declare observed text; item jsonb; matches integer;
begin
  select md5(catalog::text) into observed from ({catalog}) verified_catalog;
  if observed is distinct from {literal(manifest['schemaFingerprint'])} then
    raise exception 'Application schema differs from the restored, verified baseline';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) not in (19,39) then
    raise exception 'Unexpected migration history size';
  end if;
  for item in select value from jsonb_array_elements({literal(json.dumps(expected))}::jsonb) loop
    select count(*) into matches from supabase_migrations.schema_migrations m
      where m.version in (item->>'version',item->>'alternate') and m.name=item->>'name'
        and md5(array_to_string(m.statements,E'\\n'))=item->>'digest';
    if matches <> 1 then raise exception 'Existing migration changed: %',item->>'name'; end if;
  end loop;
  if exists (
    select 1 from supabase_migrations.schema_migrations m where not exists (
      select 1 from jsonb_array_elements({literal(json.dumps(allowed))}::jsonb) e
      where m.version in (e->>'version',e->>'alternate') and m.name=e->>'name'
        and md5(array_to_string(m.statements,E'\\n'))=e->>'digest'
    )
  ) then raise exception 'Unexpected or modified migration history record'; end if;
  if exists (select 1 from alpha_exchange.users where payload->>'preferredLocale' is null or payload->>'preferredLocale' not in ('ar','en'))
    or exists (select 1 from alpha_exchange.discord_managed_resources where provisioning_token is null)
    or (select count(*) from alpha_exchange.runtime_meta where singleton=true) <> 1
    or (select count(*) from alpha_exchange.discord_market_content where (content_key,channel_resource_key) in
      (('live_market_pulse','live_market_pulse'),('market_activity_digest','market_activity'),('weekly_top_sellers','market_activity'))) <> 3
    or not exists (select 1 from storage.buckets where id='admin-media' and public=true and file_size_limit=157286400
      and allowed_mime_types=array['video/mp4','video/webm','video/quicktime','video/x-matroska','application/pdf','image/png','image/jpeg','image/webp','image/gif','image/svg+xml','application/json','text/csv'])
    then raise exception 'A historical data transformation is not satisfied'; end if;
  if ({trust_query}) <> 0 then raise exception 'Legacy notification reconciliation still has work'; end if;
end
$audit_history$;
"""
if args.target == "recovery":
    for item in expected:
        if item["alternate"] != item["version"]:
            sql += f"update supabase_migrations.schema_migrations set version={literal(item['version'])} where version={literal(item['alternate'])} and name={literal(item['name'])};\n"
for item in adopt:
    sql += "insert into supabase_migrations.schema_migrations(version,name,statements) values (" + ",".join(
        [literal(item["version"]), literal(item["name"]), "array[" + literal(item["statement"]) + "]"]
    ) + ") on conflict(version) do nothing;\n"
sql += "commit;\n"
args.output.write_text(sql)
print(json.dumps({"output": str(args.output), "target": args.target, "adoptedRecords": len(adopt),
                  "existingRecordsPreserved": len(expected), "sqlSha256": hashlib.sha256(sql.encode()).hexdigest()}))
