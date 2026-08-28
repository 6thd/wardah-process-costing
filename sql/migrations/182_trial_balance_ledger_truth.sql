-- Migration 182 — rpc_get_trial_balance reads the legal ledger.
--
-- Problem this closes
-- -------------------
-- rpc_get_trial_balance read journal_lines/journal_entries — the retired
-- historical ledger — while every posting path writes gl_entries/gl_entry_lines,
-- the legal ledger (see CLAUDE.md, "Inventory architecture"). On Production its
-- source held 2 posted lines / 500.00 against a legal ledger of 22 lines /
-- 30,805.00. Reproduced independently on a clean database by
-- scripts/ci/fresh-db/acceptance_trial_balance_ledger_truth.sql, where the
-- function returned 0.00 for a ledger holding 2,000.00 — so the defect is in
-- the function, not in historical rows.
--
-- Two further defects fixed here
-- ------------------------------
--  * opening_debit/opening_credit were hardcoded to 0, so p_as_of_date had no
--    effect on the opening side and the result was a period movement summary,
--    not a trial balance.
--  * account_name_ar was fed from gl_accounts.name_en, so the Arabic column
--    carried English text. Aligned with v_trial_balance: COALESCE(name_ar, name).
--
-- Deliberate behaviour changes, both in the direction of completeness
-- ------------------------------------------------------------------
--  * Accounts are no longer filtered by allow_posting/is_active. An account
--    deactivated after carrying movement still owns its balance; excluding it
--    silently understates the trial balance — the same class of defect this
--    migration exists to remove.
--  * Lines whose account_id is NULL (historical rows predating the legal
--    column) are matched by account_code within the same organization instead
--    of being dropped, so nothing posted disappears from the report.
--
-- What is preserved exactly
-- -------------------------
--  * Signature and return shape — CREATE OR REPLACE, no DROP, no new overload.
--  * The Migration 120 guard chain: NULL p_tenant derives from active
--    membership, then wardah_assert_org_member enforces it.
--  * Grants: PUBLIC/anon revoked, authenticated and service_role granted.
--
-- Opening balance definition
-- --------------------------
-- Fiscal-year-to-date. Opening = posted movement strictly before the start of
-- the fiscal year containing p_as_of_date; period = posted movement from that
-- start through p_as_of_date. The fiscal year is read from accounting_periods
-- for the organization; with no periods defined it falls back to the calendar
-- year of p_as_of_date. The signature carries no from-date, so this is derived
-- rather than passed — deliberately, to avoid a second overload.
--
-- Acceptance: .github/workflows/trial-balance-ledger-truth.yml with
-- RPC_CONTRACT=enforced. Cases A–D in the acceptance script cover a balanced
-- ledger, opening balances, tenant isolation, and proof that journal_lines rows
-- no longer influence the result.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_get_trial_balance(
    p_tenant uuid,
    p_as_of_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
    account_code text,
    account_name text,
    account_name_ar text,
    account_type text,
    opening_debit numeric,
    opening_credit numeric,
    period_debit numeric,
    period_credit numeric,
    closing_debit numeric,
    closing_credit numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org      uuid;
    v_fy_start date;
BEGIN
    -- [120] Guard: p_tenant must be the caller's organization; NULL derives it
    -- from active membership. Preserved verbatim from the previous definition.
    v_org := p_tenant;
    IF v_org IS NULL AND auth.uid() IS NOT NULL THEN
        SELECT org_id INTO v_org
        FROM user_organizations
        WHERE user_id = auth.uid() AND COALESCE(is_active, TRUE)
        ORDER BY joined_at NULLS LAST
        LIMIT 1;
    END IF;
    PERFORM public.wardah_assert_org_member(v_org);

    -- Fiscal-year start for the opening/period split. accounting_periods is
    -- org-scoped and carries fiscal_year; fall back to the calendar year when
    -- the organization has no periods defined.
    SELECT MIN(p2.start_date)
    INTO v_fy_start
    FROM accounting_periods p1
    JOIN accounting_periods p2
      ON p2.org_id = p1.org_id
     AND p2.fiscal_year = p1.fiscal_year
    WHERE p1.org_id = v_org
      AND p_as_of_date BETWEEN p1.start_date AND p1.end_date;

    IF v_fy_start IS NULL THEN
        v_fy_start := date_trunc('year', p_as_of_date)::date;
    END IF;

    RETURN QUERY
    WITH posted_lines AS (
        SELECT
            COALESCE(a.code, l.account_code)::text          AS code,
            COALESCE(a.name, l.account_name, l.account_code)::text AS name,
            COALESCE(a.name_ar, a.name, l.account_name)::text      AS name_ar,
            COALESCE(a.category, '')::text                  AS category,
            e.entry_date                                    AS entry_date,
            COALESCE(l.debit, 0)                            AS debit,
            COALESCE(l.credit, 0)                           AS credit
        FROM gl_entry_lines l
        JOIN gl_entries e
          ON e.id = l.entry_id
        LEFT JOIN gl_accounts a
          ON a.org_id = e.org_id
         AND (
              a.id = l.account_id
              OR (l.account_id IS NULL AND a.code = l.account_code)
             )
        WHERE e.org_id = v_org
          AND e.status = 'posted'
          AND e.entry_date <= p_as_of_date
    ),
    per_account AS (
        SELECT
            pl.code,
            MAX(pl.name)     AS name,
            MAX(pl.name_ar)  AS name_ar,
            MAX(pl.category) AS category,
            COALESCE(SUM(pl.debit)  FILTER (WHERE pl.entry_date <  v_fy_start), 0) AS open_dr,
            COALESCE(SUM(pl.credit) FILTER (WHERE pl.entry_date <  v_fy_start), 0) AS open_cr,
            COALESCE(SUM(pl.debit)  FILTER (WHERE pl.entry_date >= v_fy_start), 0) AS per_dr,
            COALESCE(SUM(pl.credit) FILTER (WHERE pl.entry_date >= v_fy_start), 0) AS per_cr
        FROM posted_lines pl
        GROUP BY pl.code
    )
    SELECT
        pa.code,
        pa.name,
        pa.name_ar,
        pa.category,
        -- Opening is presented netted on its natural side, so a single account
        -- never reports both an opening debit and an opening credit.
        GREATEST(pa.open_dr - pa.open_cr, 0)::numeric(18,4),
        GREATEST(pa.open_cr - pa.open_dr, 0)::numeric(18,4),
        pa.per_dr::numeric(18,4),
        pa.per_cr::numeric(18,4),
        GREATEST((pa.open_dr + pa.per_dr) - (pa.open_cr + pa.per_cr), 0)::numeric(18,4),
        GREATEST((pa.open_cr + pa.per_cr) - (pa.open_dr + pa.per_dr), 0)::numeric(18,4)
    FROM per_account pa
    -- Any account with movement is reported, including one whose activity is
    -- entirely in the opening balance.
    WHERE pa.open_dr <> 0 OR pa.open_cr <> 0
       OR pa.per_dr  <> 0 OR pa.per_cr  <> 0
    ORDER BY pa.code;
END;
$function$;

COMMENT ON FUNCTION public.rpc_get_trial_balance(uuid, date) IS
    'Trial balance from the legal ledger (gl_entries/gl_entry_lines), posted '
    'entries only, fiscal-year-to-date opening balances. Migration 182 moved it '
    'off the retired journal_entries/journal_lines tables. Guarded by '
    'wardah_assert_org_member.';

-- Re-establish the access contract on the replaced function. CREATE OR REPLACE
-- preserves existing ACLs, but restating them keeps the contract legible and
-- survives a future recreate.
REVOKE ALL ON FUNCTION public.rpc_get_trial_balance(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_get_trial_balance(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_trial_balance(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_trial_balance(uuid, date) TO service_role;

COMMIT;
