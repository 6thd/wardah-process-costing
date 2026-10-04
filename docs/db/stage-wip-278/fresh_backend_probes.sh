#!/usr/bin/env bash
# Every probe runs in a BRAND-NEW backend: its own psql process.
#
# The M194 guard must not depend on session state. In a backend where nothing
# has defined the marker setting, current_setting(name,true) is SQL NULL, and a
# NULL test once let the table owner overwrite a posted cost and close a row
# without the audited RPC. The in-session acceptance scripts cannot see this:
# by the time they run, earlier M192 calls in the same session have defined the
# marker (M192 resets it to ''), so the comparison was never NULL there.
#
# Disposable PostgreSQL only. Called by run_green.sh right after M194.
set -Eeuo pipefail
DB="${1:-}"
if [[ ! "$DB" =~ ^wardah_192_green_[0-9]+$ ]]; then
  echo 'REFUSED: disposable M194 database required' >&2; exit 2
fi
if [[ -n "${DATABASE_URL:-}" || -n "${PGSERVICE:-}" || -n "${SUPABASE_DB_URL:-}" ]]; then
  echo 'REFUSED: remote connection configuration present' >&2; exit 2
fi
case "${PGHOST:-}" in ''|localhost|127.0.0.1|/*) ;; *) echo 'REFUSED: nonlocal PGHOST' >&2; exit 2;; esac

ADMIN='ed000000-0000-4000-8000-0000000000a1'
CONSUMER='ed000000-0000-4000-8000-0000000000a2'
HIST="(SELECT id FROM public.manufacturing_orders WHERE order_number='GREEN-278-HISTORICAL')"
H1="mo_id=$HIST AND period_start=DATE '2025-11-16'"

fresh() {  # fresh <label> <text the output must contain> <sql>
  local label="$1" expected="$2" sql="$3" out
  # One psql process per probe. The SQL goes through stdin, not -c: only stdin
  # prints every statement's result on every psql version (older clients print
  # just the last result of a -c string).
  out="$(printf '%s\n' "$sql" | psql -X -d "$DB" 2>&1 || true)"
  if [[ "$out" != *"$expected"* ]]; then
    echo "FRESH_BACKEND_PROBE_FAILED[$label]: expected '$expected', got: $out" >&2
    exit 1
  fi
  echo "GREEN_278_FRESH_BACKEND_$label"
}

# The table owner (this connection) is denied everything the RPCs own.
fresh OWNER_COST_OVERWRITE WIP_POSTED_MATERIAL_IMMUTABLE \
  "BEGIN; UPDATE public.stage_wip_log SET cost_material=0 WHERE mo_id=$HIST; ROLLBACK;"
fresh OWNER_DIRECT_CLOSE WIP_CLOSE_REQUIRES_RPC \
  "BEGIN; SELECT set_config('request.jwt.claim.sub','$ADMIN',true);
   UPDATE public.stage_wip_log SET is_closed=true,closed_at=now(),closed_by='$ADMIN'
   WHERE $H1; ROLLBACK;"
fresh OWNER_ID_REKEY WIP_IDENTITY_OR_PERIOD_IMMUTABLE \
  "BEGIN; UPDATE public.stage_wip_log SET id=gen_random_uuid() WHERE $H1; ROLLBACK;"
fresh OWNER_PERIOD_CHANGE WIP_IDENTITY_OR_PERIOD_IMMUTABLE \
  "BEGIN; UPDATE public.stage_wip_log SET period_end=period_end+1 WHERE $H1; ROLLBACK;"
fresh OWNER_INSERT_WITH_COST WIP_CLIENT_POSTED_FIELDS_DENIED \
  "BEGIN; INSERT INTO public.stage_wip_log
     (org_id,mo_id,stage_id,period_start,period_end,cost_material)
   SELECT org_id,mo_id,stage_id,DATE '2030-01-01',DATE '2030-01-02',5
   FROM public.stage_wip_log WHERE $H1; ROLLBACK;"

# Positive controls: the two reviewed writers still work from a fresh backend.
# Row ids are resolved as the harness first, so RLS cannot hide a lookup.
read -r FMO FRES FWO FUOM FWIP < <(psql -X -tA -F ' ' -d "$DB" -c "
  SELECT m.id,
    (SELECT id FROM public.material_reservations WHERE mo_id=m.id ORDER BY id LIMIT 1),
    (SELECT id FROM public.work_orders WHERE mo_id=m.id ORDER BY id LIMIT 1),
    (SELECT base_uom_id FROM public.products
      WHERE id='ed000000-0000-4000-8000-0000000000c1'),
    (SELECT id FROM public.stage_wip_log WHERE mo_id=m.id)
  FROM public.manufacturing_orders m WHERE m.order_number='GREEN-278-FRESH-ISSUE'")
if [[ -z "${FWIP:-}" ]]; then
  echo 'FRESH_BACKEND_FIXTURE_MISSING: GREEN-278-FRESH-ISSUE' >&2; exit 1
fi
AUTH="BEGIN; SELECT set_config('request.jwt.claim.sub','%s',true);
  SELECT set_config('request.jwt.claims','{\"sub\":\"%s\",\"role\":\"authenticated\"}',true);
  SET LOCAL ROLE authenticated;"
fresh M192_ISSUE_STILL_POSTS '"success": true' "$(printf "$AUTH" "$CONSUMER" "$CONSUMER")
  SELECT public.rpc_consume_material_event('$FMO','ed000000-0000-4000-8000-0000000000f1',
    gen_random_uuid(),jsonb_build_array(jsonb_build_object(
      'item_id','ed000000-0000-4000-8000-0000000000d1','reservation_id','$FRES',
      'warehouse_id','ed000000-0000-4000-8000-0000000000e1','work_order_id','$FWO',
      'uom_id','$FUOM','quantity',10,'consumption_type','MANUAL')));
  ROLLBACK;"
fresh CLOSE_RPC_STILL_CLOSES '"is_closed": true' "$(printf "$AUTH" "$ADMIN" "$ADMIN")
  SELECT public.rpc_close_stage_wip_194('$FWIP'::uuid); ROLLBACK;"
