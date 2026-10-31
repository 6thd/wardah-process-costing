#!/bin/bash
# Negative controls for the Migration 205 acceptance: each control applies a deliberately broken copy of
# 205 to a fresh copy of the database through 204 and requires the named check to FAIL. A control whose
# mutation does not apply (the source text moved) aborts the run instead of passing.
#   target main:   acceptance_205_manufacturing_cost_policy_approval.sql
#   target parity: acceptance_205_parity.sql with the calculator cases ($CASES)
#   target conc:   acceptance_205_concurrency.sh
#
# Usage: PRE_DB=<database through 204> CASES=<parity cases .jsonl> bash acceptance_205_negative_controls.sh
set -Eeuo pipefail

PRE_DB="${PRE_DB:?PRE_DB must name a database built through 204}"
CASES="${CASES:?CASES must name the parity cases from gen_205_parity_cases.py}"
MIGRATION="sql/migrations/205_manufacturing_cost_policy_approval_and_overhead.sql"
MAIN="scripts/ci/fresh-db/acceptance_205_manufacturing_cost_policy_approval.sql"
PARITY="scripts/ci/fresh-db/acceptance_205_parity.sql"
CONC="scripts/ci/fresh-db/acceptance_205_concurrency.sh"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
n=0

run_control() {
  local name="$1" target="$2" expect="$3" from="$4" to="$5"
  local db="cp205_nc_${name}"
  # Literal (not regex) replacement of exactly one occurrence.
  OLD="$from" NEW="$to" perl -0777 -ne '
    my ($old, $new) = ($ENV{OLD}, $ENV{NEW});
    my $count = () = /\Q$old\E/g;
    die "CONTROL_MUTATION_NOT_APPLIED: found $count occurrences\n" unless $count == 1;
    my $at = index($_, $old);
    substr($_, $at, length($old)) = $new;
    print;
  ' "$MIGRATION" >"$work/$name.sql"
  dropdb --if-exists "$db"
  createdb -T "$PRE_DB" "$db"
  "${PSQL[@]}" --single-transaction -d "$db" -f "$work/$name.sql"
  local rc=0
  case "$target" in
    main)   "${PSQL[@]}" -d "$db" -f "$MAIN" >"$work/$name.out" 2>&1 || rc=$? ;;
    parity) "${PSQL[@]}" -d "$db" -f "$PARITY" <"$CASES" >"$work/$name.out" 2>&1 || rc=$? ;;
    conc)   DB="$db" bash "$CONC" >"$work/$name.out" 2>&1 || rc=$? ;;
    *) echo "UNKNOWN_TARGET $target"; exit 2 ;;
  esac
  if [ "$rc" -eq 0 ]; then
    echo "CONTROL_NOT_CAUGHT: $name"
    exit 1
  fi
  if ! grep -qF -- "$expect" "$work/$name.out"; then
    echo "CONTROL_FAILED_ELSEWHERE: $name (wanted $expect)"
    grep -E 'ERROR|FAILED' "$work/$name.out" | head -3
    exit 1
  fi
  dropdb "$db"
  n=$((n + 1))
  echo "CONTROL_CAUGHT: $name -> $expect"
}

# --- the 205-only checker
run_control checker_org_admin_override main '[set self-approval as admin]' \
  "      AND (ur.expires_at IS NULL OR ur.expires_at > now()));" \
  "      AND (ur.expires_at IS NULL OR ur.expires_at > now())) OR public.wardah_is_org_admin(p_org);"
run_control checker_platform_override main '[set self-approval as super]' \
  "      AND (ur.expires_at IS NULL OR ur.expires_at > now()));" \
  "      AND (ur.expires_at IS NULL OR ur.expires_at > now())) OR COALESCE(public.is_super_admin(), false);"
run_control checker_expiry_ignored main '[set self-approval as expired]' \
  "      AND (ur.expires_at IS NULL OR ur.expires_at > now()));" \
  "      );"
run_control checker_disabled_role main '[set self-approval as disabled]' \
  "ON r.id = ur.role_id AND r.org_id = p_org AND COALESCE(r.is_active, true)" \
  "ON r.id = ur.role_id AND r.org_id = p_org"
# --- 205-Q1
run_control self_approval_unchecked main '[self-approval while off]' \
  "  IF v_self AND NOT ((v_settings->>'self_approval_enabled')::boolean" \
  "  IF false AND NOT ((v_settings->>'self_approval_enabled')::boolean"
run_control self_approve_key_ignored main '[self-approval without self_approve]' \
  "       AND wardah_internal.mfg_cost_policy_has_assigned_205(p_org_id, 'manufacturing.cost_policy.self_approve')) THEN" \
  ") THEN"
run_control approve_right_ignored main '[member approves]' \
  "  IF NOT COALESCE(public.has_permission(v_uid, p_org_id, 'manufacturing.cost_policy.approve'), false) THEN" \
  "  IF false THEN"
run_control settings_by_approve_right main '[set self-approval as approver]' \
  "  IF NOT wardah_internal.mfg_cost_policy_has_assigned_205(p_org_id, 'manufacturing.cost_policy.approval_settings.manage') THEN" \
  "  IF NOT COALESCE(public.has_permission(auth.uid(), p_org_id, 'manufacturing.cost_policy.approve'), false) THEN"
# --- 205-Q4
run_control q4_not_admin_only main '[set Q4 policy as q4member]' \
  "  IF NOT (public.wardah_is_org_admin(p_org_id)
          AND wardah_internal.mfg_cost_policy_has_assigned_205(p_org_id, 'manufacturing.cost_policy.unallocated_policy.manage')) THEN" \
  "  IF NOT (wardah_internal.mfg_cost_policy_has_assigned_205(p_org_id, 'manufacturing.cost_policy.unallocated_policy.manage')) THEN"
run_control exception_under_block main '[exception under block]' \
  "  IF v_exc IS NOT NULL AND p_policy <> 'controlled_exception' THEN" \
  "  IF false THEN"
run_control unallocated_dropped_silently main '[unallocated under block]' \
  "      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_BUDGET_UNALLOCATED';" \
  "      CONTINUE;"
# --- identity, ownership, immutability
run_control identity_field_accepted main '[identity top]' \
  "  v_key := wardah_internal.mfg_cost_policy_identity_key_205(p_draft);" \
  "  v_key := NULL;"
run_control foreign_account_accepted main '[gl of org B]' \
  "      IF NOT EXISTS (SELECT 1 FROM public.gl_accounts WHERE id = v_gl AND org_id = p_org) THEN" \
  "      IF false THEN"
run_control cost_center_accepted main '[cost center (tenant relation unproven)]' \
  "      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_COST_CENTER_FOREIGN: budgets[%s]', v_idx);" \
  "      NULL;"
run_control side_rows_after_approval main 'CP205_IMMUTABILITY_NOT_ENFORCED: add budget after approval' \
  "  IF EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approvals_205
             WHERE policy_version_id = NEW.policy_version_id) THEN" \
  "  IF false THEN"
# --- arithmetic and version rules against the calculator
run_control rounding_truncates parity 'PARITY_205_MISMATCH' \
  "    v_n := floor(v_driver * (wardah_internal.mfg_cost_policy_rate_205(v_rate) * 100) + 0.5);" \
  "    v_n := floor(v_driver * (wardah_internal.mfg_cost_policy_rate_205(v_rate) * 100));"
# --- rate precision (204's numeric(18,6)) and rounding at the amount
run_control rate_scale_unchecked parity 'PARITY_205_MISMATCH' \
  "  IF pg_catalog.scale(v_n) > 6 OR v_n > 999999999 THEN" \
  "  IF false THEN"
run_control rate_rounded_to_cents_first parity 'PARITY_205_MISMATCH' \
  "    v_n := floor(v_driver * (wardah_internal.mfg_cost_policy_rate_205(v_rate) * 100) + 0.5);" \
  "    v_n := floor(v_driver * round(wardah_internal.mfg_cost_policy_rate_205(v_rate) * 100) + 0.5);"
run_control labor_on_run_only parity 'PARITY_205_MISMATCH' \
  "    v_labor := floor(((v_h->>'labor.run')::numeric + (v_h->>'labor.setup')::numeric)" \
  "    v_labor := floor(((v_h->>'labor.run')::numeric + 0)"
run_control overlap_allowed parity 'PARITY_205_MISMATCH' \
  "             WHERE a->>'cc' IS NULL AND b->>'cc' IS NOT NULL) THEN" \
  "             WHERE false) THEN"
# --- saving an unchanged draft is a no-op (without it the update moves the revision and the guard refuses)
run_control unchanged_save_not_noop main '[save unchanged draft]' \
  "  IF v_d.payload = p_draft AND v_d.expected_latest_version_no = p_expected_latest_version_no THEN" \
  "  IF false THEN"
# --- the org lock
run_control approval_without_org_lock conc 'CASE1_FAILED' \
  "  PERFORM wardah_internal.mfg_cost_policy_lock_org_205(p_org_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('wardah.mfg_cost_policy:' || p_org_id::text, 204));" \
  "  PERFORM pg_advisory_xact_lock(hashtextextended('wardah.mfg_cost_policy:' || p_org_id::text, 204));"
# Caught by case 1 (the first settings row is created without the lock, so the approval reads the default);
# case 2 runs after case 1 and is not reached by this control.
run_control setting_without_org_lock conc 'CASE1_FAILED' \
  "  PERFORM wardah_internal.mfg_cost_policy_lock_org_205(p_org_id);
  v_old := wardah_internal.mfg_cost_policy_settings_205(p_org_id);
  IF (v_old->>'self_approval_enabled')::boolean = p_enabled THEN" \
  "  v_old := wardah_internal.mfg_cost_policy_settings_205(p_org_id);
  IF (v_old->>'self_approval_enabled')::boolean = p_enabled THEN"

# --- the approval bound to the reviewed revision
run_control revision_not_checked main '[approve the revision read before the edit]' \
  "  IF p_expected_revision IS NULL OR p_expected_revision <> v_d.revision THEN" \
  "  IF false THEN"
run_control revision_not_checked_under_edit conc 'CASE8_FAILED' \
  "  IF p_expected_revision IS NULL OR p_expected_revision <> v_d.revision THEN" \
  "  IF false THEN"
run_control revision_guard_missing main 'CP205_REVISION_MOVED_WITHOUT_CONTENT' \
  "  IF NEW.revision IS DISTINCT FROM OLD.revision + v_content_changed::int THEN" \
  "  IF false THEN"
# --- role templates (section 1b)
run_control template_wildcard_grants main 'CP205_TEMPLATE_WILDCARD_GRANTS_EXPLICIT_KEY' \
  "  EXECUTE replace(v_def, v_src, v_new);" \
  "  v_new := v_src;"

# The same key sent twice at once answered with a conflict instead of a replay.
run_control concurrent_replay_conflict conc 'CASE7_FAILED' \
  "    -- A concurrent call with the same key committed first (the insert waited for it): a replay if it
    -- is the same request, a conflict otherwise.
" \
  "    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_IDEMPOTENCY_CONFLICT';
"

# --- the draft check (205-Q-1)
run_control check_ignores_revision main '[check: older revision]' \
  "  IF p_expected_revision IS DISTINCT FROM v_d.revision THEN" \
  "  IF false THEN"
run_control check_open_to_any_member main '[check: plain member]' \
  "  IF NOT (wardah_internal.mfg_cost_policy_can_read_204(p_org_id)
          OR COALESCE(public.has_permission(auth.uid(), p_org_id, 'manufacturing.cost_policy.approve'), false)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_READ_DENIED';
  END IF;

  SELECT * INTO v_d FROM wardah_internal.mfg_cost_policy_drafts_205
  WHERE id = p_draft_id AND org_id = p_org_id;" \
  "  SELECT * INTO v_d FROM wardah_internal.mfg_cost_policy_drafts_205
  WHERE id = p_draft_id AND org_id = p_org_id;"
run_control check_skips_approval_rules main '[unallocated under block]' \
  "    PERFORM wardah_internal.mfg_cost_policy_approve_check_205(v_v, v_policy);
    FOR v_b IN SELECT e FROM jsonb_array_elements(v_v->'budgets') e LOOP" \
  "    FOR v_b IN SELECT e FROM jsonb_array_elements(v_v->'budgets') e LOOP"
run_control check_swallows_every_error main 'CP205_CHECK_SWALLOWED' \
  "  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'P0001' THEN
    IF SQLERRM !~ '^COST_POLICY_[A-Z0-9_]+(:|\$)' THEN
      RAISE;
    END IF;
    v_refusal := wardah_internal.mfg_cost_policy_refusal_205(SQLERRM);" \
  "  EXCEPTION WHEN OTHERS THEN
    v_refusal := wardah_internal.mfg_cost_policy_refusal_205(SQLERRM);"
run_control check_keeps_no_policy_filter main 'CP205_CHECK_SWALLOWED' \
  "  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'P0001' THEN
    IF SQLERRM !~ '^COST_POLICY_[A-Z0-9_]+(:|\$)' THEN
      RAISE;
    END IF;
    v_refusal := wardah_internal.mfg_cost_policy_refusal_205(SQLERRM);" \
  "  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'P0001' THEN
    v_refusal := wardah_internal.mfg_cost_policy_refusal_205(SQLERRM);"
run_control check_returns_cents main 'CP205_CHECK_UNALLOCATED_UNEXPECTED' \
  "(u.value::numeric * 0.01)::numeric(18,2)" \
  "u.value::numeric"
run_control check_preview_in_cents main 'CP205_CHECK_FIGURES_DIFFER' \
  "        'total', ((v_c->>'total')::numeric / 100)::numeric(18,2));
    EXCEPTION WHEN SQLSTATE '22023' THEN" \
  "        'total', (v_c->>'total')::numeric);
    EXCEPTION WHEN SQLSTATE '22023' THEN"
run_control check_takes_a_lock conc 'CASE9_FAILED' \
  "  v_settings := wardah_internal.mfg_cost_policy_settings_205(p_org_id);
  v_policy := v_settings->>'unallocated_budget_policy';
  SELECT COALESCE(max(version_no), 0) INTO v_latest_no" \
  "  PERFORM wardah_internal.mfg_cost_policy_lock_org_205(p_org_id);
  v_settings := wardah_internal.mfg_cost_policy_settings_205(p_org_id);
  v_policy := v_settings->>'unallocated_budget_policy';
  SELECT COALESCE(max(version_no), 0) INTO v_latest_no"

echo "CP205_NEGATIVE_CONTROLS_PASS controls=$n"
