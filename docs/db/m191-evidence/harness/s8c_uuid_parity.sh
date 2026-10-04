#!/usr/bin/env bash
# =============================================================================
# 8.C  Fix E UUID parser-parity matrix  (final-review remediation, Finding 3)
# =============================================================================
#
# WHY THIS EXISTS. Both Fix E candidate prepasses gate their cast with
# pg_input_is_valid(..., 'uuid') — PostgreSQL's own uuid parser — precisely so
# that every spelling the later raw ::uuid cast accepts also enters the prelock
# set. At the reviewed head fa1de77f07077af97623c34c0a743b5d00000785 nothing
# exercised that: every fixture passed canonical 8-4-4-4-12 text, so replacing
# the parser call with a hand-written canonical regex would have stayed GREEN
# while silently rejecting brace-wrapped and 32-hex-hyphenless UUIDs. Such a
# line drops out of v_products, survives the prepass, and then dies in the
# unchanged loop at PRODUCT_NOT_PRELOCKED.
#
# WHAT THIS PROVES. A full 2x2 of real RPC calls:
#            | brace-wrapped {…}      | 32-hex hyphenless
#   ---------+------------------------+----------------------
#   GR       | 8.C1 product_id        | 8.C2 product_id
#   DN       | 8.C3 sales_invoice_… | 8.C4 sales_invoice_…
# Each call must succeed exactly as the canonical spelling does, must NOT raise
# PRODUCT_NOT_PRELOCKED, and must move real stock. §8.C5 then proves the matrix
# is not vacuous: a canonical-regex mutant derived from the DEPLOYED goods
# receipt body fails 8.C1's payload with PRODUCT_NOT_PRELOCKED.
#
# No predecessor business validation is weakened anywhere: the payloads are the
# ordinary ones from s8_fixture.sh with one identifier respelled.
source "$SCRATCH/s8_fixture.sh"

MUTANT_GR=public.zz_m191_testonly_gr_canonical_uuid
drop_mutant() {
  "${PSQL[@]}" -c "DROP FUNCTION IF EXISTS $MUTANT_GR(jsonb);" >/dev/null 2>&1 || true
}
trap drop_mutant EXIT

brace()      { printf '{%s}' "$1"; }               # {a0eebc99-…-380a11}
hyphenless() { printf '%s' "${1//-/}"; }           # a0eebc999c0b4ef8bb6d…

A_BRACE=$(brace "$A")
B_HYPHENLESS=$(hyphenless "$B")
ILA_BRACE=$(brace "$ILA")
ILB_HYPHENLESS=$(hyphenless "$ILB")

bin_qty() { "${PSQL[@]}" -c "SELECT actual_qty FROM public.bins WHERE org_id='$org' AND product_id='$1'"; }

# Run one RPC under the fixture identity, capturing the RPC's own error rather
# than aborting: 8.C5 deliberately expects a failure, and the four positive
# cases assert on the captured stderr through expect_ok.
call_rpc() { # $1 label  $2 sql
  local lbl=$1
  "${PSQL[@]}" >"$tmp/$lbl.out" 2>"$tmp/$lbl.err" <<SQL || true
BEGIN;
SELECT set_config('request.jwt.claim.sub','$usr',true);
SELECT set_config('request.jwt.claims','{"sub":"$usr","role":"authenticated"}',true);
$2
COMMIT;
SQL
}

expect_ok() { # $1 label
  local lbl=$1 err
  err=$(tr -d '\n' < "$tmp/$lbl.err")
  case "$err" in
    *PRODUCT_NOT_PRELOCKED*)
      fail "$CURRENT_SCENARIO: the candidate prepass rejected a PostgreSQL-valid UUID spelling, so the line died at PRODUCT_NOT_PRELOCKED: $err" ;;
  esac
  [[ -z "$err" ]] || fail "$CURRENT_SCENARIO: the call must succeed exactly as a canonical UUID would: $err"
}

echo '=== 8.C1 Goods Receipt: brace-wrapped product_id flows through the prepass ==='
CURRENT_SCENARIO=8.C1
q0=$(bin_qty "$A")
call_rpc c1 "SELECT public.rpc_post_goods_receipt(jsonb_build_object(
  'tenant_id','$org','vendor_id','$VEND','warehouse_id','$W',
  'idempotency_key','s12-uuidp-gr-brace-$RUN_NONCE',
  'lines',jsonb_build_array(jsonb_build_object('product_id','$A_BRACE','qty_entered',4,'unit_cost',10))));"
expect_ok c1
q1=$(bin_qty "$A")
num_eq "$q1" "$(awk -v a="$q0" 'BEGIN{print a+4}')" || fail "8.C1: A bin went $q0 -> $q1, expected +4"
lp=$("${PSQL[@]}" -c "SELECT count(*) FROM public.goods_receipt_lines l JOIN public.goods_receipts g ON g.id=l.goods_receipt_id WHERE g.org_id='$org' AND g.idempotency_key='s12-uuidp-gr-brace-$RUN_NONCE' AND l.product_id='$A'")
num_eq "$lp" 1 || fail "8.C1: the brace-wrapped id did not resolve to product A on the persisted line ($lp)"
echo "  8.C1 PASS product_id='$A_BRACE' prelocked and posted; A bin $q0 -> $q1"

echo '=== 8.C2 Goods Receipt: 32-hex hyphenless product_id flows through the prepass ==='
CURRENT_SCENARIO=8.C2
q0=$(bin_qty "$B")
call_rpc c2 "SELECT public.rpc_post_goods_receipt(jsonb_build_object(
  'tenant_id','$org','vendor_id','$VEND','warehouse_id','$W',
  'idempotency_key','s12-uuidp-gr-hyphenless-$RUN_NONCE',
  'lines',jsonb_build_array(jsonb_build_object('product_id','$B_HYPHENLESS','qty_entered',4,'unit_cost',10))));"
expect_ok c2
q1=$(bin_qty "$B")
num_eq "$q1" "$(awk -v a="$q0" 'BEGIN{print a+4}')" || fail "8.C2: B bin went $q0 -> $q1, expected +4"
lp=$("${PSQL[@]}" -c "SELECT count(*) FROM public.goods_receipt_lines l JOIN public.goods_receipts g ON g.id=l.goods_receipt_id WHERE g.org_id='$org' AND g.idempotency_key='s12-uuidp-gr-hyphenless-$RUN_NONCE' AND l.product_id='$B'")
num_eq "$lp" 1 || fail "8.C2: the hyphenless id did not resolve to product B on the persisted line ($lp)"
echo "  8.C2 PASS product_id='$B_HYPHENLESS' prelocked and posted; B bin $q0 -> $q1"

echo '=== 8.C3 Delivery Note: brace-wrapped sales_invoice_line_id extraction ==='
CURRENT_SCENARIO=8.C3
q0=$(bin_qty "$A")
call_rpc c3 "SELECT public.rpc_post_delivery_note(jsonb_build_object(
  'tenant_id','$org','sales_invoice_id','$INV','warehouse_id','$W',
  'idempotency_key','s12-uuidp-dn-brace-$RUN_NONCE',
  'lines',jsonb_build_array(jsonb_build_object('sales_invoice_line_id','$ILA_BRACE','qty_entered',3))));"
expect_ok c3
q1=$(bin_qty "$A")
num_eq "$q1" "$(awk -v a="$q0" 'BEGIN{print a-3}')" || fail "8.C3: A bin went $q0 -> $q1, expected -3"
lp=$("${PSQL[@]}" -c "SELECT count(*) FROM public.delivery_note_lines l JOIN public.delivery_notes d ON d.id=l.delivery_note_id WHERE d.org_id='$org' AND d.idempotency_key='s12-uuidp-dn-brace-$RUN_NONCE' AND l.sales_invoice_line_id='$ILA' AND l.product_id='$A'")
num_eq "$lp" 1 || fail "8.C3: the brace-wrapped invoice-line id did not resolve to line ILA / product A ($lp)"
echo "  8.C3 PASS sales_invoice_line_id='$ILA_BRACE' prelocked and delivered; A bin $q0 -> $q1"

echo '=== 8.C4 Delivery Note: 32-hex hyphenless sales_invoice_line_id extraction ==='
CURRENT_SCENARIO=8.C4
q0=$(bin_qty "$B")
call_rpc c4 "SELECT public.rpc_post_delivery_note(jsonb_build_object(
  'tenant_id','$org','sales_invoice_id','$INV','warehouse_id','$W',
  'idempotency_key','s12-uuidp-dn-hyphenless-$RUN_NONCE',
  'lines',jsonb_build_array(jsonb_build_object('sales_invoice_line_id','$ILB_HYPHENLESS','qty_entered',3))));"
expect_ok c4
q1=$(bin_qty "$B")
num_eq "$q1" "$(awk -v a="$q0" 'BEGIN{print a-3}')" || fail "8.C4: B bin went $q0 -> $q1, expected -3"
lp=$("${PSQL[@]}" -c "SELECT count(*) FROM public.delivery_note_lines l JOIN public.delivery_notes d ON d.id=l.delivery_note_id WHERE d.org_id='$org' AND d.idempotency_key='s12-uuidp-dn-hyphenless-$RUN_NONCE' AND l.sales_invoice_line_id='$ILB' AND l.product_id='$B'")
num_eq "$lp" 1 || fail "8.C4: the hyphenless invoice-line id did not resolve to line ILB / product B ($lp)"
echo "  8.C4 PASS sales_invoice_line_id='$ILB_HYPHENLESS' prelocked and delivered; B bin $q0 -> $q1"

echo '=== 8.C5 DISCRIMINATOR: canonical-only regex mutant of the deployed GR body ==='
CURRENT_SCENARIO=8.C5
# Derived from the DEPLOYED body so it differs in exactly one respect: the
# candidate gate. Without this, 8.C1-8.C4 could pass on a body that never
# consulted the payload spelling at all.
"${PSQL[@]}" <<'SQL'
DO $mut$
DECLARE
  v_def text;
  v_mut text;
BEGIN
  v_def := pg_get_functiondef('public.rpc_post_goods_receipt(jsonb)'::regprocedure);

  IF position('pg_input_is_valid(line.value->>''product_id'', ''uuid'')' IN v_def) = 0 THEN
    RAISE EXCEPTION 'S12_S8C_MUTANT_VALIDATOR_CALL_NOT_FOUND';
  END IF;

  v_mut := replace(v_def,
    'FUNCTION public.rpc_post_goods_receipt(',
    'FUNCTION public.zz_m191_testonly_gr_canonical_uuid(');
  IF v_mut = v_def THEN
    RAISE EXCEPTION 'S12_S8C_MUTANT_RENAME_FAILED';
  END IF;

  v_mut := replace(v_mut,
    'pg_input_is_valid(line.value->>''product_id'', ''uuid'')',
    'line.value->>''product_id'' ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''');
  EXECUTE v_mut;
END
$mut$;
SQL
call_rpc c5 "SELECT $MUTANT_GR(jsonb_build_object(
  'tenant_id','$org','vendor_id','$VEND','warehouse_id','$W',
  'idempotency_key','s12-uuidp-gr-mutant-$RUN_NONCE',
  'lines',jsonb_build_array(jsonb_build_object('product_id','$A_BRACE','qty_entered',4,'unit_cost',10))));"
merr=$(tr -d '\n' < "$tmp/c5.err")
case "$merr" in
  *PRODUCT_NOT_PRELOCKED*)
    echo "  8.C5 RED CONFIRMED: the canonical-only regex drops the brace-wrapped id from the prelock set => $merr" ;;
  '')
    fail "8.C5: a canonical-only UUID regex accepted the brace-wrapped spelling, so 8.C1-8.C4 prove nothing about parser parity" ;;
  *)
    fail "8.C5: expected PRODUCT_NOT_PRELOCKED from the canonical-regex mutant, got: $merr" ;;
esac
# The mutant must leave no trace: the catalog contract fails closed on public.zz_%.
drop_mutant
leaked=$("${PSQL[@]}" -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'zz\_%'")
num_eq "$leaked" 0 || fail "8.C5: test-only instrumentation survived ($leaked function(s))"
mrows=$("${PSQL[@]}" -c "SELECT count(*) FROM public.goods_receipts WHERE org_id='$org' AND idempotency_key='s12-uuidp-gr-mutant-$RUN_NONCE'")
num_eq "$mrows" 0 || fail "8.C5: the failed mutant call left $mrows goods receipt(s) behind"

reconcile_product 8.C-A "$org" "$A"
reconcile_product 8.C-B "$org" "$B"
echo "SLICE12_S8C_PASS"
