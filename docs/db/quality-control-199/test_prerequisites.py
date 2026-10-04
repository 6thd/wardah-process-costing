#!/usr/bin/env python3
"""Real M196/M197 refusal and M198 catalog controls on a disposable QC database.

The runner installs 190..196. This script proves refusal, applies 197, proves
refusal, then applies 198 and checks each mutation transactionally. Positive M199
installation and all existing QC assertions follow in run_local.sh.
"""
import os
from pathlib import Path
import sys

import psycopg

ROOT = Path(__file__).resolve().parents[3]
SETUP = "public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid)"
HELPER = "wardah_internal.bump_issue_maintenance_version()"

# Include all affected-schema functions, relations, attributes, triggers,
# policies and constraints, plus the reference rows M199 can write. Compare
# before/after rollback so a refusal cannot leave schema, ACL or seed residue.
SNAPSHOT = """
WITH relations AS (
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','wardah_internal')
), functions AS (
  SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','wardah_internal')
)
SELECT jsonb_build_object(
  'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM functions p),
  -- VACUUM/ANALYZE can update physical estimates/horizons independently of
  -- this transaction. Keep every schema/owner/ACL/RLS/option/identity field.
  'relations',(SELECT jsonb_agg(to_jsonb(c) - ARRAY['relpages','reltuples','relallvisible','relfrozenxid','relminmxid'] ORDER BY c.oid) FROM pg_class c WHERE c.oid IN (SELECT oid FROM relations)),
  'attributes',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a WHERE a.attrelid IN (SELECT oid FROM relations)),
  'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM relations)),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid IN (SELECT oid FROM relations)),
  'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c WHERE c.conrelid IN (SELECT oid FROM relations)),
  'permissions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.permissions p),
  'role_templates',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.role_templates r),
  'quality_inspections',(SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.quality_inspections q)
)
"""


def snapshot_controls(conn):
    before = conn.execute(SNAPSHOT).fetchone()[0]
    # Real maintenance must not masquerade as failed rollback.
    conn.execute("ANALYZE public.permissions")
    if conn.execute(SNAPSHOT).fetchone()[0] != before:
        raise AssertionError("M199_SNAPSHOT_MAINTENANCE_FALSE_RED")
    for label, mutation in [
        ("acl", "REVOKE ALL ON public.permissions FROM PUBLIC,anon,authenticated,service_role"),
        ("trigger", "ALTER TABLE public.manufacturing_orders DISABLE TRIGGER zz_issue_maintenance_version"),
    ]:
        conn.execute("BEGIN")
        try:
            conn.execute(mutation)
            if conn.execute(SNAPSHOT).fetchone()[0] == before:
                raise AssertionError("M199_SNAPSHOT_FALSE_GREEN: " + label)
        finally:
            conn.rollback()
        if conn.execute(SNAPSHOT).fetchone()[0] != before:
            raise AssertionError("M199_SNAPSHOT_CONTROL_RESIDUE: " + label)
    print("M199_SNAPSHOT_CONTROLS_PASS maintenance=1 semantic=2 restored=true", flush=True)


def refuse(conn, migration, label, expected, mutation=None):
    before = conn.execute(SNAPSHOT).fetchone()[0]
    conn.execute("BEGIN")
    try:
        if mutation:
            conn.execute(mutation)
        try:
            conn.execute(migration)
        except psycopg.Error as error:
            if error.sqlstate != "P0001" or error.diag.message_primary != expected:
                raise AssertionError(f"{label}: unexpected refusal {error}") from error
        else:
            raise AssertionError(f"M199_PREREQUISITE_FALSE_GREEN: {label}")
    finally:
        conn.rollback()
    if conn.execute(SNAPSHOT).fetchone()[0] != before:
        raise AssertionError(f"M199_PREREQUISITE_RESIDUE: {label}")
    print(f"M199_PREREQUISITE_REFUSED {label} {expected} restored=true", flush=True)


def changed_body(signature):
    # Catalog-derived DDL is owner-only test material, never caller-supplied SQL.
    return psycopg.sql.SQL("""DO $mutant$ BEGIN
      EXECUTE replace(pg_get_functiondef({signature}::regprocedure),
        (SELECT prosrc FROM pg_proc WHERE oid={signature}::regprocedure),
        (SELECT prosrc || E'\\n-- prerequisite control' FROM pg_proc WHERE oid={signature}::regprocedure));
    END $mutant$""").format(signature=psycopg.sql.Literal(signature))


def replacement_trigger(clause, function=HELPER):
    # Both fragments are fixed control definitions below, not runtime input.
    return psycopg.sql.SQL("""DROP TRIGGER zz_issue_maintenance_version ON public.manufacturing_orders;
      CREATE TRIGGER zz_issue_maintenance_version {} EXECUTE FUNCTION {}""").format(
        psycopg.sql.SQL(clause), psycopg.sql.SQL(function))


def verify_start(conn):
    if not conn.execute("SHOW server_version_num").fetchone()[0].startswith("17"):
        raise SystemExit("REFUSED: prerequisite controls require PostgreSQL 17")
    # A mislabeled starting database must not substitute for a real prefix.
    body = conn.execute("SELECT md5(prosrc) FROM pg_proc WHERE oid=%s::regprocedure", (SETUP,)).fetchone()[0]
    if body != "b2db34b75954d2f08ece6ae86df7f2c4":
        raise AssertionError("M199_CONTROL_REQUIRES_M196_START")


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit("usage: test_prerequisites.py disposable_db [migration_file]")
    database = sys.argv[1]
    if (not database.startswith("wardah_quality_199_")
            or os.environ.get("PGHOST") not in ("127.0.0.1", "localhost")
            or any(os.environ.get(k) for k in ("DATABASE_URL", "PGSERVICE", "SUPABASE_DB_URL", "PGHOSTADDR"))):
        raise SystemExit("REFUSED: prerequisite controls require the local disposable QC database")
    migration_path = Path(sys.argv[2]) if len(sys.argv) == 3 else ROOT / "sql/migrations/199_manufacturing_quality_control.sql"
    migration = migration_path.read_text()
    setup_error = "M199_REQUIRES_FROZEN_M198_SETUP"
    trigger_error = "M199_REQUIRES_FROZEN_PARENT_VERSION_TRIGGER"
    with psycopg.connect(dbname=database, autocommit=True) as conn:
        verify_start(conn)
        snapshot_controls(conn)
        refuse(conn, migration, "chain_196", setup_error)
        conn.execute((ROOT / "sql/migrations/197_material_issue_stale_version.sql").read_text())
        refuse(conn, migration, "chain_197", setup_error)
        conn.execute((ROOT / "sql/migrations/198_material_issue_parent_version.sql").read_text())
        controls = [
            ("setup_body", setup_error, changed_body(SETUP)),
            ("setup_invoker", setup_error, "ALTER FUNCTION public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid) SECURITY INVOKER"),
            ("setup_search_path", setup_error, "ALTER FUNCTION public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid) SET search_path=public"),
            ("setup_missing", "M199_REQUIRES_M190_THROUGH_M198", "ALTER FUNCTION public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid) RENAME TO prerequisite_missing_setup"),
            ("trigger_disabled", trigger_error, "ALTER TABLE public.manufacturing_orders DISABLE TRIGGER zz_issue_maintenance_version"),
            ("trigger_always", trigger_error, "ALTER TABLE public.manufacturing_orders ENABLE ALWAYS TRIGGER zz_issue_maintenance_version"),
            ("trigger_replica", trigger_error, "ALTER TABLE public.manufacturing_orders ENABLE REPLICA TRIGGER zz_issue_maintenance_version"),
            ("trigger_missing", trigger_error, "DROP TRIGGER zz_issue_maintenance_version ON public.manufacturing_orders"),
            ("trigger_event", trigger_error, replacement_trigger("BEFORE INSERT ON public.manufacturing_orders FOR EACH ROW")),
            ("trigger_columns", trigger_error, replacement_trigger("BEFORE UPDATE OF status ON public.manufacturing_orders FOR EACH ROW")),
            ("trigger_condition", trigger_error, replacement_trigger("BEFORE UPDATE ON public.manufacturing_orders FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)")),
            ("trigger_arguments", trigger_error, replacement_trigger("BEFORE UPDATE ON public.manufacturing_orders FOR EACH ROW", "wardah_internal.bump_issue_maintenance_version('unexpected')")),
            ("trigger_function", trigger_error, psycopg.sql.SQL("CREATE FUNCTION wardah_internal.prerequisite_wrong_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; ") + replacement_trigger("BEFORE UPDATE ON public.manufacturing_orders FOR EACH ROW", "wardah_internal.prerequisite_wrong_trigger()")),
            ("helper_body", trigger_error, changed_body(HELPER)),
        ]
        if len(controls) != 14:
            raise AssertionError("M199_PREREQUISITE_CONTROL_COUNT_DRIFT")
        for label, expected, mutation in controls:
            refuse(conn, migration, label, expected, mutation)
    print("M199_PREREQUISITE_CONTROLS_PASS prefixes=2 mutations=14 restored=true", flush=True)


if __name__ == "__main__":
    main()
