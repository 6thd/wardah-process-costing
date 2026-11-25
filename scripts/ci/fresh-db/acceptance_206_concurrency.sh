#!/usr/bin/env bash
# Migration 206: a BOM snapshot change and a production record on the same order, in two real
# sessions, in both orders. The per-order advisory lock serializes them:
#   1. record first (uncommitted, holds the lock) -> the change approval waits, then refuses
#      (MFG_BOM_SNAPSHOT_CHANGE_CONFLICTS_RECORDS) instead of re-attributing the record;
#   2. change approval first (uncommitted) -> the record waits, then lands on the new snapshot.
# And a record against a calendar version (order 0): the version waits, then refuses (review item 5).
# Usage: PGDATABASE=<db through 206> bash acceptance_206_concurrency.sh   (the database is changed:
# use a disposable copy).
set -Eeuo pipefail

ORG=52060206-0000-0000-0000-0000000c00a1
MO=52060206-0000-0000-0000-0000000c03a1
PLANNER=52060206-0000-0000-0000-0000000c0a02
SNAPAPPR=52060206-0000-0000-0000-0000000c0a03
RECORDER=52060206-0000-0000-0000-0000000c0a04
OUT=$(mktemp -d)

as_user() { # $1 user id -> SQL prefix that acts as that authenticated user inside the transaction
  printf "SELECT set_config('request.jwt.claim.sub', '%s', true), set_config('request.jwt.claims', json_build_object('sub', '%s', 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;" "$1" "$1"
}

psql -X -q -v ON_ERROR_STOP=1 <<SQL
INSERT INTO public.organizations (id, name, code, timezone) VALUES ('$ORG', 'PR206 conc', 'PR206-C', 'Asia/Riyadh');
INSERT INTO auth.users (id, email) VALUES ('$PLANNER', 'p@pr206c.test'), ('$SNAPAPPR', 's@pr206c.test'), ('$RECORDER', 'r@pr206c.test');
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin)
SELECT u, '$ORG', 'user', true, false FROM unnest(ARRAY['$PLANNER', '$SNAPAPPR', '$RECORDER']::uuid[]) u;
INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES ('52060206-0000-0000-0000-0000000c00c1', '$ORG', 'PR206C all', 'الكل', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '52060206-0000-0000-0000-0000000c00c1', id FROM public.permissions
WHERE permission_key IN ('manufacturing.bom_snapshots.create', 'manufacturing.bom_snapshots.change',
  'manufacturing.bom_snapshots.approve', 'manufacturing.production_records.record', 'manufacturing.settings.update');
INSERT INTO public.user_roles (user_id, role_id, org_id)
SELECT u, '52060206-0000-0000-0000-0000000c00c1', '$ORG' FROM unnest(ARRAY['$PLANNER', '$SNAPAPPR', '$RECORDER']::uuid[]) u;
INSERT INTO public.work_centers (id, org_id, code, name, is_active) VALUES ('52060206-0000-0000-0000-0000000c00d1', '$ORG', 'WC', 'WC', true);
INSERT INTO public.manufacturing_stages (org_id, code, name, order_sequence, work_center_id, is_active)
VALUES ('$ORG', 'ST', 'ST', 10, '52060206-0000-0000-0000-0000000c00d1', true);
INSERT INTO wardah_internal.mfg_cost_policy_versions (org_id, version_no, effective_from, labor_cost_source, default_labor_rate_per_hour, pin_event, idempotency_key, payload_hash)
VALUES ('$ORG', 1, wardah_internal.mfg_cost_policy_org_today_204('$ORG', true) - 60, 'work_center_rate', 30, 'mo_created', gen_random_uuid(), 'c');
INSERT INTO public.bom_headers (id, org_id, bom_number, item_id, quantity, bom_version, effective_date, status, is_active) VALUES
  ('52060206-0000-0000-0000-0000000c0103', '$ORG', 'C-3', '52060206-0000-0000-0000-0000000c01aa', 1, 3, '2026-01-01', 'APPROVED', true),
  ('52060206-0000-0000-0000-0000000c0104', '$ORG', 'C-4', '52060206-0000-0000-0000-0000000c01aa', 1, 4, '2026-01-01', 'DRAFT', true);
INSERT INTO public.bom_operations (org_id, bom_id, operation_sequence, operation_code, operation_name, work_center_id)
SELECT '$ORG', b, 10, 'OP', 'Op', '52060206-0000-0000-0000-0000000c00d1'
FROM unnest(ARRAY['52060206-0000-0000-0000-0000000c0103', '52060206-0000-0000-0000-0000000c0104']::uuid[]) b;
ALTER TABLE public.bom_lines DISABLE TRIGGER USER;
INSERT INTO public.bom_lines (org_id, bom_id, sequence, item_id, quantity, quantity_base, scrap_factor, yield_percentage, operation_sequence)
SELECT '$ORG', b, 1, '52060206-0000-0000-0000-0000000c02f1', 1, 1, 0, 100, 10
FROM unnest(ARRAY['52060206-0000-0000-0000-0000000c0103', '52060206-0000-0000-0000-0000000c0104']::uuid[]) b;
ALTER TABLE public.bom_lines ENABLE TRIGGER USER;
INSERT INTO public.manufacturing_orders (id, org_id, order_number, item_id, quantity, status)
VALUES ('$MO', '$ORG', 'PR206C-MO', '52060206-0000-0000-0000-0000000c01aa', 100, 'in_progress');
-- Backdate the 204 pin (created today) to the calendar start, so earlier execution is allowed.
ALTER TABLE wardah_internal.mo_cost_policy_pins DISABLE TRIGGER USER;
UPDATE wardah_internal.mo_cost_policy_pins
SET pinned_on = (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') - interval '2 months')::date WHERE mo_id = '$MO';
ALTER TABLE wardah_internal.mo_cost_policy_pins ENABLE TRIGGER USER;
BEGIN; $(as_user "$PLANNER")
SELECT public.rpc_add_mfg_period_calendar_206('$ORG', (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') - interval '2 months')::date, 'conc');
SELECT public.rpc_create_mo_bom_snapshot_206('$ORG', '$MO', NULL, NULL, NULL, '52060206-0000-0000-0000-0000000c0aa1');
COMMIT;
SELECT id AS snap1 FROM wardah_internal.mo_bom_snapshots_206 WHERE idempotency_key = '52060206-0000-0000-0000-0000000c0aa1' \\gset
BEGIN; $(as_user "$SNAPAPPR")
SELECT public.rpc_approve_mo_bom_snapshot_206('$ORG', :'snap1');
COMMIT;
UPDATE public.bom_headers SET status = 'APPROVED' WHERE id = '52060206-0000-0000-0000-0000000c0104';
BEGIN; $(as_user "$PLANNER")
SELECT public.rpc_create_mo_bom_snapshot_206('$ORG', '$MO', '52060206-0000-0000-0000-0000000c0104', date_trunc('minute', now()) - interval '2 days', 'change', '52060206-0000-0000-0000-0000000c0aa2');
COMMIT;
SQL
SNAP2=$(psql -X -At -c "SELECT id FROM wardah_internal.mo_bom_snapshots_206 WHERE idempotency_key = '52060206-0000-0000-0000-0000000c0aa2'")

# ---- Order 0 (review item 5), run first so no earlier record sits in the new version's months: record first (holds the org lock shared), calendar version second ->
# the calendar waits, then sees the record and refuses instead of re-dating its period.
NEWCAL=$(psql -X -At -c "SELECT date_trunc('month', (now() - interval '2 hours') AT TIME ZONE 'Asia/Riyadh')::date")
( psql -X -q -v ON_ERROR_STOP=1 > "$OUT/a0.out" 2>&1 <<SQL
BEGIN; $(as_user "$RECORDER")
SELECT public.rpc_record_production_206('$ORG', '$MO', 10, NULL, 3, 0, now() - interval '2 hours', now() - interval '1 hour', 'conc0', gen_random_uuid());
SELECT pg_sleep(3);
COMMIT;
SQL
) &
A=$!
sleep 1
set +e
psql -X -q -v ON_ERROR_STOP=1 > "$OUT/c0.out" 2>&1 <<SQL
BEGIN; $(as_user "$PLANNER")
SELECT public.rpc_add_mfg_period_calendar_206('$ORG', '$NEWCAL', 'conc0');
COMMIT;
SQL
C_RC=$?
set -e
wait $A
grep -q 'MFG_PERIOD_CALENDAR_RECORDS_EXIST' "$OUT/c0.out" || { cat "$OUT/a0.out" "$OUT/c0.out"; echo 'PR206_CONC_ORDER0_FAILED'; exit 1; }
[ "$C_RC" -ne 0 ] || { echo 'PR206_CONC_ORDER0_CALENDAR_ADDED'; exit 1; }
echo 'PR206_CONC_ORDER0_OK (calendar version waited for the record and refused)'

# Withdraw the order-0 record so it does not block the snapshot change below.
REC0=$(psql -X -At -c "SELECT id FROM wardah_internal.mfg_production_records_206 WHERE notes = 'conc0'")
psql -X -q -v ON_ERROR_STOP=1 <<SQL
BEGIN; $(as_user "$RECORDER")
SELECT public.rpc_transition_production_entry_206('$ORG', 'record', '$REC0', 'withdraw', 'conc');
COMMIT;
SQL

# ---- Order 1: record first, approval second -> approval refuses.
( psql -X -q -v ON_ERROR_STOP=1 > "$OUT/a1.out" 2>&1 <<SQL
BEGIN; $(as_user "$RECORDER")
SELECT public.rpc_record_production_206('$ORG', '$MO', 10, NULL, 5, 0, now() - interval '1 day', now() - interval '23 hours', 'conc1', gen_random_uuid());
SELECT pg_sleep(3);
COMMIT;
SQL
) &
A=$!
sleep 1
set +e
psql -X -q -v ON_ERROR_STOP=1 > "$OUT/b1.out" 2>&1 <<SQL
BEGIN; $(as_user "$SNAPAPPR")
SELECT public.rpc_approve_mo_bom_snapshot_206('$ORG', '$SNAP2');
COMMIT;
SQL
B_RC=$?
set -e
wait $A
grep -q 'MFG_BOM_SNAPSHOT_CHANGE_CONFLICTS_RECORDS' "$OUT/b1.out" || { cat "$OUT/a1.out" "$OUT/b1.out"; echo 'PR206_CONC_ORDER1_FAILED'; exit 1; }
[ "$B_RC" -ne 0 ] || { echo 'PR206_CONC_ORDER1_APPROVED'; exit 1; }
echo 'PR206_CONC_ORDER1_OK (approval waited for the record and refused)'

# Withdraw the conflicting record so the change can be approved.
REC1=$(psql -X -At -c "SELECT id FROM wardah_internal.mfg_production_records_206 WHERE notes = 'conc1'")
psql -X -q -v ON_ERROR_STOP=1 <<SQL
BEGIN; $(as_user "$RECORDER")
SELECT public.rpc_transition_production_entry_206('$ORG', 'record', '$REC1', 'withdraw', 'conc');
COMMIT;
SQL

# ---- Order 2: approval first (held open), record second -> record lands on snapshot 2.
( psql -X -q -v ON_ERROR_STOP=1 > "$OUT/b2.out" 2>&1 <<SQL
BEGIN; $(as_user "$SNAPAPPR")
SELECT public.rpc_approve_mo_bom_snapshot_206('$ORG', '$SNAP2');
SELECT pg_sleep(3);
COMMIT;
SQL
) &
B=$!
sleep 1
psql -X -q -v ON_ERROR_STOP=1 > "$OUT/a2.out" 2>&1 <<SQL
BEGIN; $(as_user "$RECORDER")
SELECT public.rpc_record_production_206('$ORG', '$MO', 10, NULL, 7, 0, now() - interval '1 day', now() - interval '23 hours', 'conc2', gen_random_uuid());
COMMIT;
SQL
wait $B
GOT=$(psql -X -At -c "SELECT s.snapshot_no FROM wardah_internal.mfg_production_records_206 r JOIN wardah_internal.mo_bom_snapshots_206 s ON s.id = r.snapshot_id WHERE r.notes = 'conc2'")
[ "$GOT" = "2" ] || { cat "$OUT/a2.out" "$OUT/b2.out"; echo "PR206_CONC_ORDER2_FAILED: snapshot $GOT"; exit 1; }
echo 'PR206_CONC_ORDER2_OK (record waited for the approval and landed on snapshot 2)'

echo 'PRODUCTION_RECORDING_206_CONCURRENCY_OK'
