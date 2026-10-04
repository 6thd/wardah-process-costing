#!/usr/bin/env bash
# Layer-order proof for Migration 201 and a later fence on the same functions.
#
# 201 replaces five functions (runbook section 4). #313 proposes a G05 pause
# fence that would replace some of the same functions. Whichever lands second
# must carry both layers. This script proves each order with a simulated
# fence: a pause check injected at the top of each body, which keeps every
# other line, so a marker-based check would still see the old body.
#
#   A. fence first, then 201: for each function, 201 refuses to run
#      (MFG_SETTINGS_201_UNEXPECTED_BODY naming that function), rolls back,
#      and leaves the fence in place.
#   B1. 201 first, then a fence that keeps the 201 layer: the full 201
#      acceptance still passes and the fence is live in all five functions.
#   B2. 201 first, then a fence re-derived from the pre-201 body (the 201
#      layer dropped): for each function, the 201 acceptance fails.
#
# Inputs: PRE_DB (chain through 200, without 201) and POST_DB (chain through
# 201). Both are used only as templates; every case runs on a fresh copy.
set -Eeuo pipefail

: "${PRE_DB:?PRE_DB must be set}"
: "${POST_DB:?POST_DB must be set}"

MIGRATION=sql/migrations/201_manufacturing_settings_permissions.sql
ACCEPTANCE=scripts/ci/fresh-db/acceptance_201_manufacturing_settings_permissions.sql
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)
work=$(mktemp -d)
copies=()
cleanup() {
  for c in "${copies[@]}"; do dropdb --if-exists "$c" >/dev/null 2>&1 || true; done
  rm -rf "$work"
}
trap cleanup EXIT

SIGS=(
  'public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)'
  'public.rpc_set_material_issue_wo_statuses(uuid,text[])'
  'public.rpc_set_quality_policy(uuid,jsonb,bigint)'
  'public.rpc_get_quality_policy(uuid)'
  'public.create_role_from_template(uuid,uuid,character varying,uuid)'
)

# Sets $db to a fresh copy of template $2. Not called in a subshell, so the
# copy is tracked for cleanup and a failed createdb stops the script.
copy_db() {
  db="l201_${1}_${#copies[@]}_$$"
  createdb -T "$2" "$db"
  copies+=("$db")
}

# Prints a CREATE OR REPLACE for $2 as it exists in database $1, with the
# simulated fence inserted after the body's single top-level BEGIN line.
fenced_ddl() {
  "${PSQL[@]}" -At -d "$1" -v sig="$2" <<'SQL'
SELECT CASE WHEN strpos(d, E'\nBEGIN\n') = 0 THEN NULL ELSE
  overlay(d PLACING E'\n  IF current_setting(''wardah.g05_pause_sim'', true) = ''on'' THEN\n    RAISE EXCEPTION USING ERRCODE = ''55000'', MESSAGE = ''G05_PAUSED_SIM'';\n  END IF;'
          FROM strpos(d, E'\nBEGIN\n') + 6 FOR 0) || E';\n'
  END
FROM pg_get_functiondef(:'sig'::regprocedure) AS d;
SQL
}

apply_fence() {  # $1 target db, $2 source db, $3 signature
  local ddl="$work/fence.sql"
  fenced_ddl "$2" "$3" >"$ddl"
  if ! grep -q 'G05_PAUSED_SIM' "$ddl"; then
    echo "MFG_SETTINGS_201_LAYER_ORDER_FAIL: no top-level BEGIN in $3" >&2
    exit 1
  fi
  "${PSQL[@]}" -d "$1" -f "$ddl"
}

fence_present() {  # $1 db, $2 signature
  # psql interpolates :'sig' only in script input, not in -c.
  [[ $("${PSQL[@]}" -At -d "$1" -v sig="$2" <<<"SELECT position('G05_PAUSED_SIM' IN pg_get_functiondef(:'sig'::regprocedure)) > 0;") == t ]]
}

# --------------------------------------------------------------------------
# 0. 201 leaves the complete ACL of all five functions unchanged: proacl
#    (every grantee, including PUBLIC, anon and service_role) and the owner,
#    before 201 versus after it.
# --------------------------------------------------------------------------
acl_query="SELECT string_agg(p.oid::regprocedure::text || ' owner=' || pg_get_userbyid(p.proowner) || ' acl=' || COALESCE(p.proacl::text, 'NULL'), E'\\n' ORDER BY p.oid::regprocedure::text)
FROM pg_proc p
WHERE p.oid IN ('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)'::regprocedure,
                'public.rpc_set_material_issue_wo_statuses(uuid,text[])'::regprocedure,
                'public.rpc_set_quality_policy(uuid,jsonb,bigint)'::regprocedure,
                'public.rpc_get_quality_policy(uuid)'::regprocedure,
                'public.create_role_from_template(uuid,uuid,character varying,uuid)'::regprocedure);"
acl_pre=$("${PSQL[@]}" -At -d "$PRE_DB" -c "$acl_query")
acl_post=$("${PSQL[@]}" -At -d "$POST_DB" -c "$acl_query")
if [[ -z "$acl_pre" || "$acl_pre" != "$acl_post" ]]; then
  printf 'before:\n%s\nafter:\n%s\n' "$acl_pre" "$acl_post" >&2
  echo 'MFG_SETTINGS_201_LAYER_ORDER_FAIL: 201 changed the ACL or owner of a replaced function' >&2
  exit 1
fi
printf '%s\n' "$acl_post"
echo 'MFG_SETTINGS_201_FULL_ACL_UNCHANGED_OK: proacl and owner identical before and after 201 for all five functions'

# --------------------------------------------------------------------------
# A. Fence first, then 201.
# --------------------------------------------------------------------------
for sig in "${SIGS[@]}"; do
  copy_db a "$PRE_DB"
  before=$("${PSQL[@]}" -At -d "$db" -v sig="$sig" <<<"SELECT md5(prosrc) FROM pg_proc WHERE oid = :'sig'::regprocedure;")
  apply_fence "$db" "$db" "$sig"
  # The fence only adds lines: removing them restores the original body
  # exactly, so every line a marker-based preflight looked for is still
  # there. Only an exact body check can refuse this case.
  without=$("${PSQL[@]}" -At -d "$db" -v sig="$sig" <<'SQL'
SELECT md5(replace(prosrc,
  E'\n  IF current_setting(''wardah.g05_pause_sim'', true) = ''on'' THEN\n    RAISE EXCEPTION USING ERRCODE = ''55000'', MESSAGE = ''G05_PAUSED_SIM'';\n  END IF;', ''))
FROM pg_proc WHERE oid = :'sig'::regprocedure;
SQL
)
  if [[ "$before" != "$without" ]]; then
    echo "MFG_SETTINGS_201_LAYER_ORDER_FAIL: the simulated fence did more than add lines to $sig" >&2
    exit 1
  fi

  if "${PSQL[@]}" -d "$db" -f "$MIGRATION" >"$work/a.out" 2>&1; then
    echo "MFG_SETTINGS_201_LAYER_ORDER_FAIL: 201 overwrote a fenced $sig" >&2
    exit 1
  fi
  if ! grep -q "MFG_SETTINGS_201_UNEXPECTED_BODY: .*${sig%%(*}" "$work/a.out"; then
    cat "$work/a.out" >&2
    echo "MFG_SETTINGS_201_LAYER_ORDER_FAIL: 201 failed for another reason on fenced $sig" >&2
    exit 1
  fi
  if [[ $("${PSQL[@]}" -At -d "$db" -c "SELECT count(*) FROM public.permissions WHERE permission_key LIKE 'manufacturing.settings.%'") != 0 ]] \
     || ! fence_present "$db" "$sig"; then
    echo "MFG_SETTINGS_201_LAYER_ORDER_FAIL: refused 201 left partial state on $sig" >&2
    exit 1
  fi
  echo "fenced first, 201 refused: $sig"
done
echo 'MFG_SETTINGS_201_LAYER_ORDER_FENCE_FIRST_OK: 201 refuses every fenced function and changes nothing'

# A2. A change outside the body that 201's CREATE OR REPLACE would also
# overwrite: only search_path differs. A3. A target function is missing.
copy_db a2 "$PRE_DB"
"${PSQL[@]}" -d "$db" -c "ALTER FUNCTION public.rpc_set_quality_policy(uuid,jsonb,bigint) SET search_path = public"
if "${PSQL[@]}" -d "$db" -f "$MIGRATION" >"$work/a2.out" 2>&1 \
   || ! grep -q 'MFG_SETTINGS_201_UNEXPECTED_BODY: .*rpc_set_quality_policy' "$work/a2.out"; then
  cat "$work/a2.out" >&2
  echo 'MFG_SETTINGS_201_LAYER_ORDER_FAIL: 201 did not refuse a changed search_path' >&2
  exit 1
fi
copy_db a3 "$PRE_DB"
"${PSQL[@]}" -d "$db" -c "DROP FUNCTION public.rpc_get_quality_policy(uuid)"
if "${PSQL[@]}" -d "$db" -f "$MIGRATION" >"$work/a3.out" 2>&1 \
   || ! grep -q 'MFG_SETTINGS_201_TARGET_FUNCTION_MISSING' "$work/a3.out"; then
  cat "$work/a3.out" >&2
  echo 'MFG_SETTINGS_201_LAYER_ORDER_FAIL: 201 did not refuse a missing target function' >&2
  exit 1
fi
echo 'MFG_SETTINGS_201_LAYER_ORDER_CONFIG_AND_MISSING_OK: 201 refuses a changed search_path and a missing target'

# --------------------------------------------------------------------------
# B1. 201 first, then a fence that keeps the 201 layer.
# --------------------------------------------------------------------------
copy_db b1 "$POST_DB"
for sig in "${SIGS[@]}"; do
  apply_fence "$db" "$db" "$sig"
done
"${PSQL[@]}" -d "$db" -f "$ACCEPTANCE" >"$work/b1.out" 2>&1 || {
  cat "$work/b1.out" >&2
  echo 'MFG_SETTINGS_201_LAYER_ORDER_FAIL: 201 acceptance fails under a layer-keeping fence' >&2
  exit 1
}
grep -q 'MFG_SETTINGS_201_ACCEPTANCE_PASS' "$work/b1.out"

# The fence is live in each function: with the pause on, every call stops at
# the fence before any guard or write.
"${PSQL[@]}" -d "$db" <<'SQL'
DO $fence_live$
DECLARE
  v_org uuid := '52010201-0000-0000-0000-00000000f001';
  v_paused int := 0;
BEGIN
  PERFORM set_config('wardah.g05_pause_sim', 'on', true);
  BEGIN PERFORM public.rpc_set_gl_event_mapping(v_org, 'FG_RECEIPT', '1', '2');
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'G05_PAUSED_SIM' THEN v_paused := v_paused + 1; ELSE RAISE; END IF; END;
  BEGIN PERFORM public.rpc_set_material_issue_wo_statuses(v_org, ARRAY['READY']);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'G05_PAUSED_SIM' THEN v_paused := v_paused + 1; ELSE RAISE; END IF; END;
  BEGIN PERFORM public.rpc_set_quality_policy(v_org, '{}'::jsonb, 0);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'G05_PAUSED_SIM' THEN v_paused := v_paused + 1; ELSE RAISE; END IF; END;
  BEGIN PERFORM public.rpc_get_quality_policy(v_org);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'G05_PAUSED_SIM' THEN v_paused := v_paused + 1; ELSE RAISE; END IF; END;
  BEGIN PERFORM public.create_role_from_template(v_org, v_org, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'G05_PAUSED_SIM' THEN v_paused := v_paused + 1; ELSE RAISE; END IF; END;
  IF v_paused <> 5 THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_LAYER_ORDER_FENCE_NOT_LIVE: paused=%', v_paused;
  END IF;
END
$fence_live$;
SQL
echo 'MFG_SETTINGS_201_LAYER_ORDER_BOTH_LAYERS_OK: fence after 201 keeps the 201 acceptance green and pauses all five functions'

# --------------------------------------------------------------------------
# B2. 201 first, then a fence re-derived from the pre-201 body.
# --------------------------------------------------------------------------
for sig in "${SIGS[@]}"; do
  copy_db b2 "$POST_DB"
  apply_fence "$db" "$PRE_DB" "$sig"
  if "${PSQL[@]}" -d "$db" -f "$ACCEPTANCE" >"$work/b2.out" 2>&1; then
    echo "MFG_SETTINGS_201_LAYER_ORDER_FAIL: acceptance missed a dropped 201 layer in $sig" >&2
    exit 1
  fi
  echo "fence dropped the 201 layer, acceptance failed: $sig ($(grep -m1 -oE 'ERROR: .*' "$work/b2.out" | cut -c1-120))"
done
echo 'MFG_SETTINGS_201_LAYER_ORDER_DROPPED_LAYER_CAUGHT_OK: the 201 acceptance fails whenever a later body drops the 201 layer'

echo 'MFG_SETTINGS_201_LAYER_ORDER_PASS'
