#!/usr/bin/env bash
# F2 / Issue #228 RED proof: two independent, deterministic lost-update races
# in the live wardah_apply_stock_incoming / wardah_apply_stock_outgoing pair.
# Proof only. No migration is applied or proposed here, and no Production
# access is made.
#
# RED-A: first-bin (product, warehouse) race — the original Astra hypothesis.
#   Both live wardah_apply_stock_incoming overloads read the target bin with
#   `SELECT ... FOR UPDATE` before deriving a new balance, then upsert with
#   `INSERT ... ON CONFLICT (product_id, warehouse_id) DO UPDATE`. A row that
#   does not exist yet cannot be row-locked, so two independent transactions
#   that both start from "no bin" derive their new balance from the same
#   empty state. The loser's `ON CONFLICT DO UPDATE` overwrites the winner's
#   insert with its own (stale) EXCLUDED values instead of the sum of both.
#
# RED-B: product-aggregate race across two warehouses for one product —
#   surfaced while building #228's own required "two warehouses, one
#   product" regression check (acceptance item 6), not part of the original
#   hypothesis. The tail of wardah_apply_stock_incoming does:
#     SELECT COALESCE(SUM(actual_qty),0) INTO v_prod_qty FROM bins WHERE ...;
#     UPDATE products SET stock_quantity = v_prod_qty WHERE id = ...;
#   with no lock on the product row and no lock on the bins scan. Two
#   concurrent incoming calls against *different* warehouses for the *same*
#   product each insert their own bin correctly (no key collision at all),
#   but each one's SUM only sees its own uncommitted bin row. Whichever
#   UPDATE commits last blindly overwrites the other's aggregate instead of
#   the sum surviving. This is a distinct root cause from RED-A: it has
#   nothing to do with a missing bin row, and it reproduces even when both
#   underlying bin writes are individually correct.
#
# Both races are reproduced here with genuinely separate PostgreSQL backends
# (no in-process simulation): the first backend of each race is forced to
# complete its RPC call and hold its transaction open via a file-based
# rendezvous; the second backend only starts once the first has returned;
# the script then polls pg_stat_activity to prove the second backend is
# genuinely blocked on the first's uncommitted write (real lock contention,
# not a race between two independent shell timings) before releasing the
# first to commit. This makes both outcomes deterministic across repeated
# runs, not probabilistic.
#
# Two control scenarios bound RED-A precisely:
#   - an existing bin (the FOR UPDATE lock has a row to protect => correct)
#   - incoming vs outgoing lock ordering on an existing bin (no deadlock)
#
# Any failure below is reported with a STOCK_F2_RED_FAIL prefix and a
# non-zero exit code; a clean run prints STOCK_F2_RED_PROOF_PASS.

set -Eeuo pipefail

: "${PGDATABASE:?PGDATABASE must be set}"

PSQL=(psql -X -v ON_ERROR_STOP=1 -qAt)
tmp_prefix=/tmp/stock-f2-race

rm -f "${tmp_prefix}"-*.ready "${tmp_prefix}"-*.release \
      "${tmp_prefix}"-*.out "${tmp_prefix}"-*.err

fail() {
  echo "STOCK_F2_RED_FAIL: $1" >&2
  exit 1
}

# Waits until $1 exists, polling every 50ms up to $2 (default 200) tries.
wait_for_file() {
  local f=$1 tries=${2:-200}
  for _ in $(seq 1 "$tries"); do
    [[ -f "$f" ]] && return 0
    sleep 0.05
  done
  return 1
}

# Waits until exactly $1 backends among application_name IN ($2) are actively
# waiting on a lock. Echoes the last observed count on stdout.
wait_for_lock_waiters() {
  local expected=$1 names=$2 tries=${3:-200} waiting=0
  for _ in $(seq 1 "$tries"); do
    waiting=$("${PSQL[@]}" <<SQL
SELECT count(*)
FROM pg_stat_activity
WHERE application_name IN ($names)
  AND state = 'active'
  AND wait_event_type = 'Lock';
SQL
)
    if [[ "$waiting" == "$expected" ]]; then
      printf '%s' "$waiting"
      return 0
    fi
    sleep 0.05
  done
  printf '%s' "$waiting"
  return 1
}

org_id='00002280-f2f2-0000-0000-000000000001'
actor_id='00002280-f2f2-0000-0000-000000000002'

# RED-A: first-bin race, single (product, warehouse) key.
a_product='00002280-f2f2-0000-0000-0000000000a1'
a_wh='00002280-f2f2-0000-0000-0000000000a2'
a_voucher_1='00002280-f2f2-0000-0000-0000000000a3'
a_voucher_2='00002280-f2f2-0000-0000-0000000000a4'

# Control (bounds RED-A): existing bin race, single (product, warehouse) key.
ctl1_product='00002280-f2f2-0000-0000-0000000000b1'
ctl1_wh='00002280-f2f2-0000-0000-0000000000b2'
ctl1_bin='00002280-f2f2-0000-0000-0000000000b3'
ctl1_voucher_1='00002280-f2f2-0000-0000-0000000000b4'
ctl1_voucher_2='00002280-f2f2-0000-0000-0000000000b5'

# RED-B: product-aggregate race, two warehouses, one product.
b_product='00002280-f2f2-0000-0000-0000000000c1'
b_wh_1='00002280-f2f2-0000-0000-0000000000c2'
b_wh_2='00002280-f2f2-0000-0000-0000000000c3'
b_voucher_1='00002280-f2f2-0000-0000-0000000000c4'
b_voucher_2='00002280-f2f2-0000-0000-0000000000c5'

# Control (bounds RED-A): incoming vs outgoing lock ordering, existing bin.
ctl2_product='00002280-f2f2-0000-0000-0000000000d1'
ctl2_wh='00002280-f2f2-0000-0000-0000000000d2'
ctl2_bin='00002280-f2f2-0000-0000-0000000000d3'
ctl2_voucher_in='00002280-f2f2-0000-0000-0000000000d4'
ctl2_voucher_out='00002280-f2f2-0000-0000-0000000000d5'

"${PSQL[@]}" <<SQL
INSERT INTO public.organizations (id, name, code)
VALUES ('$org_id', 'Stock F2 Race', 'STKF2-RACE');

INSERT INTO auth.users (id, email)
VALUES ('$actor_id', 'stock-f2-race@wardah-e2e.invalid');

INSERT INTO public.user_organizations (user_id, org_id, is_active)
VALUES ('$actor_id', '$org_id', true);

INSERT INTO public.products (id, org_id, code, name, is_stockable, base_uom_id)
SELECT p.id, '$org_id', p.code, p.name, true, u.id
FROM (VALUES
  ('$a_product'::uuid, 'STKF2-RACE-A', 'Stock F2 RED-A Product'),
  ('$ctl1_product'::uuid, 'STKF2-RACE-CTL1', 'Stock F2 Control-1 Product'),
  ('$b_product'::uuid, 'STKF2-RACE-B', 'Stock F2 RED-B Product'),
  ('$ctl2_product'::uuid, 'STKF2-RACE-CTL2', 'Stock F2 Control-2 Product')
) AS p(id, code, name)
CROSS JOIN LATERAL (
  SELECT id FROM public.uoms
  WHERE org_id IS NULL AND is_active AND NOT is_product_specific
  LIMIT 1
) AS u;

INSERT INTO public.warehouses (id, org_id, code, name)
VALUES
  ('$a_wh', '$org_id', 'STKF2-RACE-WH-A', 'Stock F2 RED-A Warehouse'),
  ('$ctl1_wh', '$org_id', 'STKF2-RACE-WH-CTL1', 'Stock F2 Control-1 Warehouse'),
  ('$b_wh_1', '$org_id', 'STKF2-RACE-WH-B1', 'Stock F2 RED-B Warehouse 1'),
  ('$b_wh_2', '$org_id', 'STKF2-RACE-WH-B2', 'Stock F2 RED-B Warehouse 2'),
  ('$ctl2_wh', '$org_id', 'STKF2-RACE-WH-CTL2', 'Stock F2 Control-2 Warehouse');

-- The controls start from an existing bin; RED-A and RED-B deliberately
-- start with none for their target (product, warehouse) keys.
INSERT INTO public.bins (
  id, org_id, product_id, warehouse_id, actual_qty, reserved_qty,
  valuation_rate, stock_value, stock_queue
) VALUES
  ('$ctl1_bin', '$org_id', '$ctl1_product', '$ctl1_wh', 20, 0,
   10, 200, '[{"qty":20,"rate":10}]'::jsonb),
  ('$ctl2_bin', '$org_id', '$ctl2_product', '$ctl2_wh', 50, 0,
   10, 500, '[{"qty":50,"rate":10}]'::jsonb);
SQL

echo '--- RED-A: first-bin race, single (product, warehouse) key ---'

a1_ready="${tmp_prefix}-a1.ready"
a1_release="${tmp_prefix}-a1.release"

PGAPPNAME='stock-f2-reda-1' "${PSQL[@]}" \
  >"${tmp_prefix}-a1.out" 2>"${tmp_prefix}-a1.err" <<SQL &
BEGIN;
SELECT public.wardah_apply_stock_incoming(
  '$org_id', '$a_product', '$a_wh', 5, 10,
  'Goods Receipt', '$a_voucher_1', 'STKF2-REDA-1', CURRENT_DATE
);
\! touch $a1_ready
\! bash -c 'while [ ! -f "$a1_release" ]; do sleep 0.05; done'
COMMIT;
SQL
a_pid_1=$!

wait_for_file "$a1_ready" \
  || fail "RED-A: first transaction never completed its RPC body"

PGAPPNAME='stock-f2-reda-2' "${PSQL[@]}" \
  >"${tmp_prefix}-a2.out" 2>"${tmp_prefix}-a2.err" <<SQL &
BEGIN;
SELECT public.wardah_apply_stock_incoming(
  '$org_id', '$a_product', '$a_wh', 7, 10,
  'Goods Receipt', '$a_voucher_2', 'STKF2-REDA-2', CURRENT_DATE
);
COMMIT;
SQL
a_pid_2=$!

waiting=$(wait_for_lock_waiters 1 "'stock-f2-reda-2'") \
  || fail "RED-A: second transaction never blocked on the first's uncommitted bin insert (got $waiting waiter(s)); this is not the deterministic race this proof requires"

touch "$a1_release"

status_a1=0
status_a2=0
wait "$a_pid_1" || status_a1=$?
wait "$a_pid_2" || status_a2=$?

if [[ "$status_a1" -ne 0 || "$status_a2" -ne 0 ]]; then
  fail "RED-A: expected both first-bin incoming calls to succeed (this defect is silent, not error-raising); statuses=$status_a1,$status_a2"
fi

a_state=$("${PSQL[@]}" <<SQL
SELECT
  (SELECT count(*) FROM public.bins
   WHERE product_id = '$a_product' AND warehouse_id = '$a_wh')::text || '|' ||
  (SELECT COALESCE(actual_qty, -1)::text FROM public.bins
   WHERE product_id = '$a_product' AND warehouse_id = '$a_wh') || '|' ||
  (SELECT count(*) FROM public.stock_ledger_entries
   WHERE product_id = '$a_product' AND warehouse_id = '$a_wh'
     AND voucher_id IN ('$a_voucher_1', '$a_voucher_2'))::text || '|' ||
  (SELECT COALESCE(stock_quantity, -1)::text FROM public.products
   WHERE id = '$a_product')
SQL
)
IFS='|' read -r a_bin_count a_bin_qty a_sle_count a_product_qty <<<"$a_state"

[[ "$a_bin_count" == '1' ]] \
  || fail "RED-A: expected exactly one bin row for the racing key; got $a_bin_count"
[[ "$a_sle_count" == '2' ]] \
  || fail "RED-A: expected both stock-ledger effects to survive; got $a_sle_count rows"
if [[ "$a_bin_qty" == '12' || "$a_bin_qty" == '12.000000' ]]; then
  fail "RED-A: bin quantity equals the correct sum (12) - the lost-update defect did NOT reproduce. Do not treat F2-A as confirmed; re-examine the race before proposing any fix."
fi
if [[ "$a_bin_qty" != '5' && "$a_bin_qty" != '5.000000' \
   && "$a_bin_qty" != '7' && "$a_bin_qty" != '7.000000' ]]; then
  fail "RED-A: bin quantity ($a_bin_qty) is neither input value nor their sum - unexpected corruption shape, not the documented lost-update signature"
fi
[[ "$a_product_qty" == "$a_bin_qty" ]] \
  || fail "RED-A: product aggregate ($a_product_qty) diverged from its own single bin ($a_bin_qty), a defect beyond the lost update itself"

echo "STOCK_F2_REDA_REPRODUCED_OK bin_qty=$a_bin_qty (sum of both effects would be 12; both SLE rows survived; both calls reported success)"

echo '--- Control 1 (bounds RED-A): existing-bin race, single (product, warehouse) key ---'

ctl1_blocker_ready="${tmp_prefix}-ctl1-blocker.ready"
"${PSQL[@]}" >"${tmp_prefix}-ctl1-blocker.out" 2>"${tmp_prefix}-ctl1-blocker.err" <<SQL &
BEGIN;
SELECT id FROM public.bins WHERE id = '$ctl1_bin' FOR UPDATE;
\! touch $ctl1_blocker_ready
SELECT pg_sleep(2);
COMMIT;
SQL
ctl1_pid_blocker=$!

wait_for_file "$ctl1_blocker_ready" \
  || fail "control 1: blocker transaction never became ready"

PGAPPNAME='stock-f2-ctl1-1' "${PSQL[@]}" \
  >"${tmp_prefix}-ctl1-1.out" 2>"${tmp_prefix}-ctl1-1.err" <<SQL &
BEGIN;
SELECT public.wardah_apply_stock_incoming(
  '$org_id', '$ctl1_product', '$ctl1_wh', 3, 10,
  'Goods Receipt', '$ctl1_voucher_1', 'STKF2-CTL1-1', CURRENT_DATE
);
COMMIT;
SQL
ctl1_pid_1=$!

PGAPPNAME='stock-f2-ctl1-2' "${PSQL[@]}" \
  >"${tmp_prefix}-ctl1-2.out" 2>"${tmp_prefix}-ctl1-2.err" <<SQL &
BEGIN;
SELECT public.wardah_apply_stock_incoming(
  '$org_id', '$ctl1_product', '$ctl1_wh', 4, 10,
  'Goods Receipt', '$ctl1_voucher_2', 'STKF2-CTL1-2', CURRENT_DATE
);
COMMIT;
SQL
ctl1_pid_2=$!

waiting=$(wait_for_lock_waiters 2 "'stock-f2-ctl1-1','stock-f2-ctl1-2'") \
  || fail "control 1: expected two callers waiting on the pre-existing bin lock; got $waiting"

wait "$ctl1_pid_blocker"
status_ctl1_1=0
status_ctl1_2=0
wait "$ctl1_pid_1" || status_ctl1_1=$?
wait "$ctl1_pid_2" || status_ctl1_2=$?

[[ "$status_ctl1_1" -eq 0 && "$status_ctl1_2" -eq 0 ]] \
  || fail "control 1: expected both existing-bin incoming calls to succeed; statuses=$status_ctl1_1,$status_ctl1_2"

ctl1_bin_qty=$("${PSQL[@]}" <<SQL
SELECT actual_qty FROM public.bins WHERE id = '$ctl1_bin';
SQL
)
if [[ "$ctl1_bin_qty" != '27' && "$ctl1_bin_qty" != '27.000000' ]]; then
  fail "control 1: expected existing-bin race to sum correctly to 27 (20+3+4); got $ctl1_bin_qty - the FOR UPDATE lock on a pre-existing row is expected to serialize correctly, so this would be a third, unrelated defect"
fi

echo "STOCK_F2_CONTROL1_EXISTING_BIN_OK bin_qty=$ctl1_bin_qty"

echo '--- RED-B: product-aggregate race, two warehouses, one product ---'

b1_ready="${tmp_prefix}-b1.ready"
b1_release="${tmp_prefix}-b1.release"

# The first call targets warehouse 1 and is held open *after* it has already
# executed its own SELECT SUM(bins)/UPDATE products (i.e. it holds an
# uncommitted row lock on the products row), forcing the second call to
# block there rather than on any bins key (the two warehouses do not
# collide, so there is nothing for the bins upsert itself to contend on).
PGAPPNAME='stock-f2-redb-1' "${PSQL[@]}" \
  >"${tmp_prefix}-b1.out" 2>"${tmp_prefix}-b1.err" <<SQL &
BEGIN;
SELECT public.wardah_apply_stock_incoming(
  '$org_id', '$b_product', '$b_wh_1', 6, 10,
  'Goods Receipt', '$b_voucher_1', 'STKF2-REDB-1', CURRENT_DATE
);
\! touch $b1_ready
\! bash -c 'while [ ! -f "$b1_release" ]; do sleep 0.05; done'
COMMIT;
SQL
b_pid_1=$!

wait_for_file "$b1_ready" \
  || fail "RED-B: first transaction never completed its RPC body"

PGAPPNAME='stock-f2-redb-2' "${PSQL[@]}" \
  >"${tmp_prefix}-b2.out" 2>"${tmp_prefix}-b2.err" <<SQL &
BEGIN;
SELECT public.wardah_apply_stock_incoming(
  '$org_id', '$b_product', '$b_wh_2', 9, 10,
  'Goods Receipt', '$b_voucher_2', 'STKF2-REDB-2', CURRENT_DATE
);
COMMIT;
SQL
b_pid_2=$!

waiting=$(wait_for_lock_waiters 1 "'stock-f2-redb-2'") \
  || fail "RED-B: second transaction never blocked on the first's uncommitted products-row update (got $waiting waiter(s)); this is not the deterministic race this proof requires"

touch "$b1_release"

status_b1=0
status_b2=0
wait "$b_pid_1" || status_b1=$?
wait "$b_pid_2" || status_b2=$?

if [[ "$status_b1" -ne 0 || "$status_b2" -ne 0 ]]; then
  fail "RED-B: expected both non-colliding incoming calls to succeed (this defect is silent, not error-raising); statuses=$status_b1,$status_b2"
fi

b_state=$("${PSQL[@]}" <<SQL
SELECT
  (SELECT COALESCE(actual_qty, -1) FROM public.bins
   WHERE product_id = '$b_product' AND warehouse_id = '$b_wh_1')::text || '|' ||
  (SELECT COALESCE(actual_qty, -1) FROM public.bins
   WHERE product_id = '$b_product' AND warehouse_id = '$b_wh_2')::text || '|' ||
  (SELECT count(*) FROM public.stock_ledger_entries
   WHERE product_id = '$b_product'
     AND voucher_id IN ('$b_voucher_1', '$b_voucher_2'))::text || '|' ||
  (SELECT COALESCE(stock_quantity, -1) FROM public.products
   WHERE id = '$b_product')::text
SQL
)
IFS='|' read -r b_bin_1_qty b_bin_2_qty b_sle_count b_product_qty <<<"$b_state"

if [[ "$b_bin_1_qty" != '6' && "$b_bin_1_qty" != '6.000000' ]]; then
  fail "RED-B: expected warehouse 1's own bin to correctly hold 6 regardless of the aggregate race; got $b_bin_1_qty"
fi
if [[ "$b_bin_2_qty" != '9' && "$b_bin_2_qty" != '9.000000' ]]; then
  fail "RED-B: expected warehouse 2's own bin to correctly hold 9 regardless of the aggregate race; got $b_bin_2_qty"
fi
[[ "$b_sle_count" == '2' ]] \
  || fail "RED-B: expected both stock-ledger effects to survive; got $b_sle_count rows"
if [[ "$b_product_qty" == '15' || "$b_product_qty" == '15.000000' ]]; then
  fail "RED-B: product aggregate equals the correct sum (15) - the product-aggregate lost-update defect did NOT reproduce. Do not treat F2-B as confirmed; re-examine the race before proposing any fix."
fi
if [[ "$b_product_qty" != '6' && "$b_product_qty" != '6.000000' \
   && "$b_product_qty" != '9' && "$b_product_qty" != '9.000000' ]]; then
  fail "RED-B: product aggregate ($b_product_qty) is neither per-warehouse input value nor their sum - unexpected corruption shape, not the documented lost-update signature"
fi

echo "STOCK_F2_REDB_REPRODUCED_OK bin_1=$b_bin_1_qty bin_2=$b_bin_2_qty product=$b_product_qty (both bins individually correct; sum would be 15; both SLE rows survived; both calls reported success)"

echo '--- Control 2 (bounds RED-A): incoming vs outgoing lock ordering, existing bin ---'

ctl2_blocker_ready="${tmp_prefix}-ctl2-blocker.ready"
"${PSQL[@]}" >"${tmp_prefix}-ctl2-blocker.out" 2>"${tmp_prefix}-ctl2-blocker.err" <<SQL &
BEGIN;
SELECT id FROM public.bins WHERE id = '$ctl2_bin' FOR UPDATE;
\! touch $ctl2_blocker_ready
SELECT pg_sleep(2);
COMMIT;
SQL
ctl2_pid_blocker=$!

wait_for_file "$ctl2_blocker_ready" \
  || fail "control 2: blocker transaction never became ready"

PGAPPNAME='stock-f2-ctl2-in' "${PSQL[@]}" \
  >"${tmp_prefix}-ctl2-in.out" 2>"${tmp_prefix}-ctl2-in.err" <<SQL &
BEGIN;
SELECT public.wardah_apply_stock_incoming(
  '$org_id', '$ctl2_product', '$ctl2_wh', 8, 10,
  'Goods Receipt', '$ctl2_voucher_in', 'STKF2-CTL2-IN', CURRENT_DATE
);
COMMIT;
SQL
ctl2_pid_in=$!

PGAPPNAME='stock-f2-ctl2-out' "${PSQL[@]}" \
  >"${tmp_prefix}-ctl2-out.out" 2>"${tmp_prefix}-ctl2-out.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$actor_id', true);
SELECT public.wardah_apply_stock_outgoing(
  '$org_id', '$ctl2_product', '$ctl2_wh', 10,
  'Delivery Note', '$ctl2_voucher_out', 'STKF2-CTL2-OUT', CURRENT_DATE
);
COMMIT;
SQL
ctl2_pid_out=$!

waiting=$(wait_for_lock_waiters 2 "'stock-f2-ctl2-in','stock-f2-ctl2-out'") \
  || fail "control 2: expected incoming and outgoing to both queue on the pre-existing bin lock; got $waiting"

wait "$ctl2_pid_blocker"
status_ctl2_in=0
status_ctl2_out=0
wait "$ctl2_pid_in" || status_ctl2_in=$?
wait "$ctl2_pid_out" || status_ctl2_out=$?

if [[ "$status_ctl2_in" -ne 0 || "$status_ctl2_out" -ne 0 ]]; then
  fail "control 2: expected both incoming and outgoing to complete without deadlock or error on an existing bin; statuses=$status_ctl2_in,$status_ctl2_out"
fi
if grep -qi 'deadlock' "${tmp_prefix}-ctl2-in.err" "${tmp_prefix}-ctl2-out.err"; then
  fail "control 2: deadlock detected between incoming and outgoing on the same existing bin"
fi

ctl2_bin_qty=$("${PSQL[@]}" <<SQL
SELECT actual_qty FROM public.bins WHERE id = '$ctl2_bin';
SQL
)
if [[ "$ctl2_bin_qty" != '48' && "$ctl2_bin_qty" != '48.000000' ]]; then
  fail "control 2: expected existing-bin incoming/outgoing mix to net to 48 (50+8-10); got $ctl2_bin_qty"
fi

echo "STOCK_F2_CONTROL2_INCOMING_VS_OUTGOING_OK bin_qty=$ctl2_bin_qty statuses=$status_ctl2_in,$status_ctl2_out"

printf 'STOCK_F2_RED_PROOF_PASS reda_bin=%s ctl1_bin=%s redb_bin1=%s redb_bin2=%s redb_product=%s ctl2_bin=%s\n' \
  "$a_bin_qty" "$ctl1_bin_qty" "$b_bin_1_qty" "$b_bin_2_qty" "$b_product_qty" "$ctl2_bin_qty"
