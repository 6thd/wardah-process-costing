"""Exact permitted delta from frozen M197; never derive from a live database."""
from pathlib import Path
import hashlib
ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'docs/db/material-issue-release/migrations/197_material_issue_stale_version.sql'
CANDIDATE = ROOT / 'docs/db/material-issue-parent-version-198/candidate.sql'
SIGNATURE = 'public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid)'

def function(text):
    start = text.index('CREATE OR REPLACE FUNCTION public.rpc_manage_material_issue_setup(')
    return text[start:text.index('END $$;', start) + len('END $$;')]

def fingerprint(fn):
    return hashlib.sha256(fn[fn.index('AS $$') + 5:-3].encode()).hexdigest()

def replacement():
    source = function(BASE.read_text())
    edits = [
        ("new_status text; response jsonb; line jsonb;", "new_status text; response jsonb; line jsonb;\n expected_parent_version numeric; parent_version bigint;"),
        ("ARRAY['operation','mo_id','work_center_id','name','quantity']", "ARRAY['operation','mo_id','work_center_id','name','quantity','expected_version']"),
        ("ARRAY['operation','mo_id','item_id','uom_id','quantity']", "ARRAY['operation','mo_id','item_id','uom_id','quantity','expected_version']"),
        ("  IF op='set_order_status' THEN", """  -- Replay above remains valid even for pre-M198 saved commands without a version.
  -- New child intent must use the displayed MO version, under the existing MO lock.
  IF op IN ('reserve','create_work_order') THEN
   IF jsonb_typeof(p_command->'expected_version') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'ISSUE_SETUP_VERSION_REQUIRED'; END IF;
   expected_parent_version:=(p_command->>'expected_version')::numeric;
   IF expected_parent_version<1 OR expected_parent_version>9223372036854775807
    OR expected_parent_version<>trunc(expected_parent_version) THEN
    RAISE EXCEPTION 'ISSUE_SETUP_VERSION_REQUIRED'; END IF;
   IF mo.maintenance_version IS DISTINCT FROM expected_parent_version::bigint THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ISSUE_SETUP_STALE_VERSION'; END IF;
  END IF;
  IF op='set_order_status' THEN"""),
        (" -- Recheck after lock waits/writes;", """ -- A successful child creation invalidates concurrent drafts on this parent.
 -- The frozen BEFORE UPDATE trigger performs the single increment. Any failure
 -- below rolls back the child, parent version, audit and event together.
 IF op IN ('reserve','create_work_order') THEN
  UPDATE public.manufacturing_orders SET maintenance_version=maintenance_version
   WHERE id=mo.id AND org_id=p_org_id RETURNING maintenance_version INTO parent_version;
  IF parent_version IS DISTINCT FROM mo.maintenance_version+1 THEN
   RAISE EXCEPTION 'ISSUE_SETUP_PARENT_VERSION_BUMP_FAILED'; END IF;
 END IF;
 -- Recheck after lock waits/writes;"""),
    ]
    for old, new in edits:
        if source.count(old) != 1:
            raise ValueError('M198_DERIVATION_ANCHOR_DRIFT')
        source = source.replace(old, new)
    return source
