-- Migration 183 — exact RBAC for financial report reads.
--
-- SEC-172 proved that same-organization membership alone could call financial
-- reporting functions directly, bypassing the UI's route guards. This migration
-- closes the server boundary with permission keys already present in the live
-- RBAC catalog:
--
--   get_account_statement              general_ledger.account_statement.view
--   rpc_get_trial_balance              reports.financial.read
--   rpc_subledger_gl_reconciliation    reports.financial.read
--   get_gl_accounts_by_category        accounting.accounts.read
--
-- rpc_get_trial_balance deliberately reproduces Migration 182's complete legal-
-- ledger body, fiscal-year fallback, completeness semantics, return shape and
-- grants. The only body change is the exact permission assertion after the
-- existing membership assertion. See TRIAL_BALANCE_CONTRACT_182_183_CHAIN.md.
--
-- wardah_178_assert_permission delegates to wardah_has_exact_permission, so
-- Super Admin, active Org Admin, active-role, role-org, expiry and revocation
-- semantics stay centralized. No new permission aliases or automatic grants are
-- invented here.

BEGIN;

DO $preflight$
DECLARE
  v_missing text[];
BEGIN
  IF to_regprocedure('public.wardah_178_assert_permission(uuid,text)') IS NULL
     OR to_regprocedure(
          'public.wardah_has_exact_permission(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.wardah_assert_org_member(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'FINANCIAL_REPORT_RBAC_183_PREREQUISITE_MISSING';
  END IF;

  SELECT array_agg(required_key ORDER BY required_key)
  INTO v_missing
  FROM unnest(ARRAY[
    'accounting.accounts.read',
    'general_ledger.account_statement.view',
    'reports.financial.read'
  ]::text[]) AS required(required_key)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.permissions p
    WHERE p.permission_key = required.required_key
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'FINANCIAL_REPORT_RBAC_183_PERMISSION_KEYS_MISSING: %', v_missing;
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.get_account_statement(p_account_code text, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(entry_date date, entry_number text, description text, debit numeric, credit numeric, running_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org_id UUID;
    v_opening_balance NUMERIC(18,4) := 0;
    v_category TEXT;
BEGIN
    -- [120] مؤسسة المستدعي من عضويته (كانت تسقط للمؤسسة الافتراضية 000...001)
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED';
    END IF;
    v_org_id := public.wardah_org_id(NULL);
    IF v_org_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM user_organizations
        WHERE user_id = auth.uid() AND org_id = v_org_id AND COALESCE(is_active, TRUE)
    ) THEN
        SELECT org_id INTO v_org_id
        FROM user_organizations
        WHERE user_id = auth.uid() AND COALESCE(is_active, TRUE)
        ORDER BY joined_at NULLS LAST
        LIMIT 1;
    END IF;
    PERFORM public.wardah_assert_org_member(v_org_id);
    PERFORM public.wardah_178_assert_permission(
        v_org_id, 'general_ledger.account_statement.view');

    -- Get account category from gl_accounts
    SELECT category INTO v_category
    FROM gl_accounts
    WHERE code = p_account_code
    AND org_id = v_org_id
    LIMIT 1;

    IF v_category IS NULL THEN
        -- Return empty result instead of raising exception
        RETURN;
    END IF;

    -- Calculate opening balance if from_date is provided
    IF p_from_date IS NOT NULL THEN
        SELECT
            CASE
                WHEN v_category IN ('ASSET', 'EXPENSE') THEN
                    COALESCE(SUM(debit_amount - credit_amount), 0)
                ELSE
                    COALESCE(SUM(credit_amount - debit_amount), 0)
            END
        INTO v_opening_balance
        FROM gl_entry_lines gel
        WHERE gel.account_code = p_account_code
        AND gel.entry_id IN (
            SELECT ge.id FROM gl_entries ge
            WHERE ge.org_id = v_org_id
            AND ge.entry_date < p_from_date
            AND ge.status = 'POSTED'
        );
    END IF;

    -- Return statement lines with running balance
    RETURN QUERY
    WITH lines_with_balance AS (
        SELECT
            ge.entry_date,
            ge.entry_number,
            COALESCE(gel.description, ge.description) as description,
            gel.debit_amount as debit,
            gel.credit_amount as credit,
            CASE
                WHEN v_category IN ('ASSET', 'EXPENSE') THEN
                    gel.debit_amount - gel.credit_amount
                ELSE
                    gel.credit_amount - gel.debit_amount
            END as balance_change
        FROM gl_entry_lines gel
        INNER JOIN gl_entries ge ON gel.entry_id = ge.id
        WHERE gel.account_code = p_account_code
        AND ge.org_id = v_org_id
        AND (p_from_date IS NULL OR ge.entry_date >= p_from_date)
        AND ge.entry_date <= p_to_date
        AND ge.status = 'POSTED'
        ORDER BY ge.entry_date, ge.entry_number, gel.line_number
    )
    -- [120] تأهيل الأعمدة lwb.* — كانت غامضة مع معاملات الإخراج (علة أصلية:
    -- الدالة كانت تنهار بـ 42702 عند أي حساب موجود والواجهة تتحايل بمسار بديل)
    SELECT
        lwb.entry_date,
        lwb.entry_number,
        lwb.description,
        lwb.debit,
        lwb.credit,
        v_opening_balance + SUM(lwb.balance_change) OVER (
            ORDER BY lwb.entry_date, lwb.entry_number
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) as running_balance
    FROM lines_with_balance lwb;
END;
$function$;

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
    v_org            uuid;
    v_fy_start       date;
    v_fy_start_month integer;
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
    PERFORM public.wardah_178_assert_permission(
        v_org, 'reports.financial.read');

    -- Fiscal-year start for the opening/period split. accounting_periods is
    -- authoritative when it covers the requested date. Otherwise honor the
    -- organization's configured start month, including the preceding calendar
    -- year when p_as_of_date falls before that month.
    SELECT MIN(p2.start_date)
    INTO v_fy_start
    FROM accounting_periods p1
    JOIN accounting_periods p2
      ON p2.org_id = p1.org_id
     AND p2.fiscal_year = p1.fiscal_year
    WHERE p1.org_id = v_org
      AND p_as_of_date BETWEEN p1.start_date AND p1.end_date;

    IF v_fy_start IS NULL THEN
        SELECT CASE
                   WHEN o.fiscal_year_start BETWEEN 1 AND 12
                   THEN o.fiscal_year_start
                   ELSE 1
               END
        INTO v_fy_start_month
        FROM organizations o
        WHERE o.id = v_org;

        v_fy_start_month := COALESCE(v_fy_start_month, 1);
        v_fy_start := make_date(
            CASE
                WHEN EXTRACT(MONTH FROM p_as_of_date)::integer < v_fy_start_month
                THEN EXTRACT(YEAR FROM p_as_of_date)::integer - 1
                ELSE EXTRACT(YEAR FROM p_as_of_date)::integer
            END,
            v_fy_start_month,
            1
        );
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

CREATE OR REPLACE FUNCTION public.rpc_subledger_gl_reconciliation(
    p_as_of_date DATE  DEFAULT CURRENT_DATE,
    p_tenant     UUID  DEFAULT NULL,
    -- بادئات الحسابات قابلة للتخصيص لو اختلفت شجرة الحسابات
    p_inventory_prefixes TEXT[] DEFAULT ARRAY['131', '132', '133', '135'],
    p_wip_prefixes       TEXT[] DEFAULT ARRAY['134']
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org UUID;

    -- كشف أعمدة gl_entry_lines (الأرشيف: debit_amount/account_code — الحي: debit/account_id)
    v_debit_col   TEXT;
    v_credit_col  TEXT;
    v_has_acct_id BOOLEAN;
    v_sql         TEXT;

    -- أرصدة GL لكل قسم + تفصيل الحسابات
    v_gl_inventory      NUMERIC := 0;
    v_gl_wip            NUMERIC := 0;
    v_inv_accounts      JSONB   := '[]'::JSONB;
    v_wip_accounts      JSONB   := '[]'::JSONB;
    v_gl_available      BOOLEAN := FALSE;

    -- الدفاتر الفرعية
    v_sub_inventory        NUMERIC := NULL;  -- NULL = غير متاح
    v_sub_inventory_source TEXT    := NULL;
    v_sub_wip              NUMERIC := NULL;
    v_sub_wip_source       TEXT    := NULL;
    v_open_mo_count        INTEGER := 0;

    -- تسوية
    v_inv_diff      NUMERIC;
    v_wip_diff      NUMERIC;
    v_inv_balanced  BOOLEAN;
    v_wip_balanced  BOOLEAN;

    -- أعمدة stage_costs الديناميكية
    v_sc_tenant_col TEXT;
    v_sc_mo_col     TEXT;
BEGIN
    -- ===== هوية المؤسسة =====
    v_org := wardah_org_id(p_tenant);
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'ORG_NOT_RESOLVED: تعذر تحديد هوية المؤسسة';
    END IF;
    PERFORM public.wardah_assert_org_member(v_org);
    PERFORM public.wardah_178_assert_permission(
        v_org, 'reports.financial.read');

    -- ================================================================
    -- جانب GL: أرصدة الحسابات من القيود المرحَّلة حتى التاريخ المطلوب
    -- ================================================================
    IF to_regclass('public.gl_entries') IS NOT NULL
       AND to_regclass('public.gl_entry_lines') IS NOT NULL THEN

        SELECT column_name INTO v_debit_col
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'gl_entry_lines'
          AND column_name IN ('debit', 'debit_amount')
        ORDER BY CASE column_name WHEN 'debit' THEN 1 ELSE 2 END
        LIMIT 1;

        SELECT column_name INTO v_credit_col
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'gl_entry_lines'
          AND column_name IN ('credit', 'credit_amount')
        ORDER BY CASE column_name WHEN 'credit' THEN 1 ELSE 2 END
        LIMIT 1;

        v_has_acct_id := EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'gl_entry_lines'
              AND column_name = 'account_id'
        ) AND to_regclass('public.gl_accounts') IS NOT NULL;

        IF v_debit_col IS NOT NULL AND v_credit_col IS NOT NULL THEN
            v_gl_available := TRUE;

            -- الرصيد المدين الصافي لكل حساب (طبيعة حسابات الأصول)
            IF v_has_acct_id THEN
                v_sql := format(
                    'SELECT COALESCE(a.code, '''') AS code,
                            COALESCE(a.name, a.name_ar, '''') AS name,
                            SUM(COALESCE(l.%I,0) - COALESCE(l.%I,0)) AS balance
                     FROM gl_entry_lines l
                     JOIN gl_entries e ON e.id = l.entry_id
                     JOIN gl_accounts a ON a.id = l.account_id
                     WHERE e.org_id = $1
                       AND e.status = ''posted''
                       AND e.entry_date <= $2
                       AND a.code LIKE ANY (SELECT unnest($3) || ''%%'')
                     GROUP BY a.code, COALESCE(a.name, a.name_ar, '''')
                     ORDER BY a.code',
                    v_debit_col, v_credit_col
                );
            ELSE
                v_sql := format(
                    'SELECT l.account_code AS code,
                            COALESCE(MAX(l.account_name), '''') AS name,
                            SUM(COALESCE(l.%I,0) - COALESCE(l.%I,0)) AS balance
                     FROM gl_entry_lines l
                     JOIN gl_entries e ON e.id = l.entry_id
                     WHERE e.org_id = $1
                       AND e.status = ''posted''
                       AND e.entry_date <= $2
                       AND l.account_code LIKE ANY (SELECT unnest($3) || ''%%'')
                     GROUP BY l.account_code
                     ORDER BY l.account_code',
                    v_debit_col, v_credit_col
                );
            END IF;

            -- قسم المخزون
            EXECUTE format(
                'SELECT COALESCE(SUM(balance),0),
                        COALESCE(jsonb_agg(jsonb_build_object(
                            ''code'', code, ''name'', name,
                            ''balance'', ROUND(balance,6))), ''[]''::jsonb)
                 FROM (%s) t', v_sql)
            INTO v_gl_inventory, v_inv_accounts
            USING v_org, p_as_of_date, p_inventory_prefixes;

            -- قسم WIP
            EXECUTE format(
                'SELECT COALESCE(SUM(balance),0),
                        COALESCE(jsonb_agg(jsonb_build_object(
                            ''code'', code, ''name'', name,
                            ''balance'', ROUND(balance,6))), ''[]''::jsonb)
                 FROM (%s) t', v_sql)
            INTO v_gl_wip, v_wip_accounts
            USING v_org, p_as_of_date, p_wip_prefixes;
        END IF;
    END IF;

    -- ================================================================
    -- الدفتر الفرعي للمخزون: آخر رصيد جارٍ لكل صنف حتى التاريخ
    -- ================================================================
    IF to_regclass('public.inventory_ledger') IS NOT NULL THEN
        BEGIN
            SELECT COALESCE(SUM(running_value), 0), 'inventory_ledger'
            INTO v_sub_inventory, v_sub_inventory_source
            FROM (
                SELECT DISTINCT ON (item_id) running_value
                FROM inventory_ledger
                WHERE tenant_id = v_org
                  AND moved_at::date <= p_as_of_date
                ORDER BY item_id, moved_at DESC, created_at DESC
            ) latest;
        EXCEPTION WHEN OTHERS THEN
            v_sub_inventory := NULL;  -- بنية أعمدة مختلفة — نجرّب المصدر الآخر
        END;
    END IF;

    IF v_sub_inventory IS NULL
       AND to_regclass('public.stock_ledger_entries') IS NOT NULL THEN
        BEGIN
            SELECT COALESCE(SUM(stock_value), 0), 'stock_ledger_entries'
            INTO v_sub_inventory, v_sub_inventory_source
            FROM (
                SELECT DISTINCT ON (product_id, warehouse_id) stock_value
                FROM stock_ledger_entries
                WHERE org_id = v_org
                  AND posting_date <= p_as_of_date
                  AND COALESCE(is_cancelled, FALSE) = FALSE
                ORDER BY product_id, warehouse_id, posting_datetime DESC
            ) latest;
        EXCEPTION WHEN OTHERS THEN
            v_sub_inventory := NULL;
        END;
    END IF;

    -- ================================================================
    -- الدفتر الفرعي لـ WIP: تكاليف مراحل الأوامر المفتوحة
    -- (أمر مكتمل/ملغى يجب أن يكون WIP الخاص به صفراً — تحوَّل لـ FG)
    -- ================================================================
    IF to_regclass('public.stage_costs') IS NOT NULL
       AND to_regclass('public.manufacturing_orders') IS NOT NULL THEN

        SELECT column_name INTO v_sc_tenant_col
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'stage_costs'
          AND column_name IN ('tenant_id', 'org_id')
        ORDER BY CASE column_name WHEN 'tenant_id' THEN 1 ELSE 2 END
        LIMIT 1;

        SELECT column_name INTO v_sc_mo_col
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'stage_costs'
          AND column_name IN ('mo_id', 'manufacturing_order_id')
        ORDER BY CASE column_name WHEN 'mo_id' THEN 1 ELSE 2 END
        LIMIT 1;

        IF v_sc_tenant_col IS NOT NULL AND v_sc_mo_col IS NOT NULL THEN
            BEGIN
                EXECUTE format(
                    'SELECT COALESCE(SUM(sc.total_cost),0), COUNT(DISTINCT mo.id)
                     FROM stage_costs sc
                     JOIN manufacturing_orders mo ON mo.id = sc.%I
                     WHERE sc.%I = $1
                       AND mo.org_id = $1
                       AND lower(replace(mo.status, ''-'', ''_''))
                           NOT IN (''done'', ''completed'', ''cancelled'', ''closed'')',
                    v_sc_mo_col, v_sc_tenant_col
                )
                INTO v_sub_wip, v_open_mo_count
                USING v_org;
                v_sub_wip_source := 'stage_costs (أوامر مفتوحة)';
            EXCEPTION WHEN OTHERS THEN
                v_sub_wip := NULL;
            END;
        END IF;
    END IF;

    -- ================================================================
    -- التسوية
    -- ================================================================
    v_inv_diff     := CASE WHEN v_gl_available AND v_sub_inventory IS NOT NULL
                           THEN v_gl_inventory - v_sub_inventory ELSE NULL END;
    v_wip_diff     := CASE WHEN v_gl_available AND v_sub_wip IS NOT NULL
                           THEN v_gl_wip - v_sub_wip ELSE NULL END;
    v_inv_balanced := v_inv_diff IS NOT NULL AND ABS(v_inv_diff) < 0.01;
    v_wip_balanced := v_wip_diff IS NOT NULL AND ABS(v_wip_diff) < 0.01;

    RETURN jsonb_build_object(
        'success', TRUE,
        'report_type', 'subledger_gl_reconciliation',
        'as_of_date', p_as_of_date,
        'generated_at', now(),
        'gl_available', v_gl_available,
        'sections', jsonb_build_array(
            jsonb_build_object(
                'section', 'inventory',
                'title_ar', 'المخزون (مواد خام + إنتاج تام)',
                'gl_prefixes', to_jsonb(p_inventory_prefixes),
                'gl_balance', CASE WHEN v_gl_available THEN ROUND(v_gl_inventory, 6) END,
                'gl_accounts', v_inv_accounts,
                'subledger_balance', CASE WHEN v_sub_inventory IS NOT NULL
                                          THEN ROUND(v_sub_inventory, 6) END,
                'subledger_source', v_sub_inventory_source,
                'difference', CASE WHEN v_inv_diff IS NOT NULL
                                   THEN ROUND(v_inv_diff, 6) END,
                'is_balanced', v_inv_balanced,
                'status', CASE
                    WHEN NOT v_gl_available          THEN 'gl_unavailable'
                    WHEN v_sub_inventory IS NULL     THEN 'subledger_unavailable'
                    WHEN v_inv_balanced              THEN 'balanced'
                    ELSE 'unbalanced' END
            ),
            jsonb_build_object(
                'section', 'wip',
                'title_ar', 'الإنتاج تحت التشغيل',
                'gl_prefixes', to_jsonb(p_wip_prefixes),
                'gl_balance', CASE WHEN v_gl_available THEN ROUND(v_gl_wip, 6) END,
                'gl_accounts', v_wip_accounts,
                'subledger_balance', CASE WHEN v_sub_wip IS NOT NULL
                                          THEN ROUND(v_sub_wip, 6) END,
                'subledger_source', v_sub_wip_source,
                'open_mo_count', v_open_mo_count,
                'difference', CASE WHEN v_wip_diff IS NOT NULL
                                   THEN ROUND(v_wip_diff, 6) END,
                'is_balanced', v_wip_balanced,
                'status', CASE
                    WHEN NOT v_gl_available      THEN 'gl_unavailable'
                    WHEN v_sub_wip IS NULL       THEN 'subledger_unavailable'
                    WHEN v_wip_balanced          THEN 'balanced'
                    ELSE 'unbalanced' END
            )
        ),
        'all_balanced', v_inv_balanced AND v_wip_balanced
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_gl_accounts_by_category(
    p_org_id uuid,
    p_category text
)
RETURNS TABLE (
    id uuid,
    code varchar,
    name varchar,
    category varchar,
    subtype varchar,
    parent_code varchar,
    allow_posting boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    PERFORM public.wardah_assert_org_member(p_org_id);
    PERFORM public.wardah_178_assert_permission(
        p_org_id, 'accounting.accounts.read');

    RETURN QUERY
    SELECT
        a.id,
        a.code,
        a.name,
        a.category,
        a.subtype,
        a.parent_code,
        a.allow_posting
    FROM public.gl_accounts a
    WHERE a.org_id = p_org_id
      AND a.category = p_category
      AND a.is_active
      AND a.allow_posting
    ORDER BY a.code ASC;
END;
$function$;

COMMENT ON FUNCTION public.get_account_statement(text, date, date) IS
  'Same-org account statement guarded by exact '
  'general_ledger.account_statement.view authorization. Migration 183.';

COMMENT ON FUNCTION public.rpc_get_trial_balance(uuid, date) IS
  'Trial balance from legal gl_entries/gl_entry_lines with Migration 182 fiscal-'
  'year and completeness semantics, plus exact reports.financial.read '
  'authorization from Migration 183.';

COMMENT ON FUNCTION public.rpc_subledger_gl_reconciliation(
  date, uuid, text[], text[]) IS
  'Subledger-to-GL reconciliation guarded by exact reports.financial.read '
  'authorization. Migration 183 preserves the Migration 81 calculation body.';

COMMENT ON FUNCTION public.get_gl_accounts_by_category(uuid, text) IS
  'Postable GL account lookup guarded by same-org membership and exact '
  'accounting.accounts.read authorization. Migration 183.';

-- CREATE OR REPLACE retains ACLs; restate the intended boundary so later
-- replacements cannot silently inherit an unsafe PUBLIC/anon grant.
REVOKE ALL ON FUNCTION public.get_account_statement(text, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_statement(text, date, date)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.rpc_get_trial_balance(uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_trial_balance(uuid, date)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.rpc_subledger_gl_reconciliation(
  date, uuid, text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_subledger_gl_reconciliation(
  date, uuid, text[], text[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_gl_accounts_by_category(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gl_accounts_by_category(uuid, text)
  TO authenticated, service_role;

DO $postflight$
DECLARE
  v_def text;
  v_sig regprocedure;
  v_expected_key text;
BEGIN
  FOR v_sig, v_expected_key IN
    SELECT *
    FROM (VALUES
      ('public.get_account_statement(text,date,date)'::regprocedure,
       'general_ledger.account_statement.view'),
      ('public.rpc_get_trial_balance(uuid,date)'::regprocedure,
       'reports.financial.read'),
      ('public.rpc_subledger_gl_reconciliation(date,uuid,text[],text[])'::regprocedure,
       'reports.financial.read'),
      ('public.get_gl_accounts_by_category(uuid,text)'::regprocedure,
       'accounting.accounts.read')
    ) expected(sig, permission_key)
  LOOP
    SELECT pg_get_functiondef(v_sig::oid) INTO v_def;
    IF v_def NOT LIKE '%wardah_178_assert_permission%'
       OR v_def NOT LIKE '%' || v_expected_key || '%' THEN
      RAISE EXCEPTION
        'FINANCIAL_REPORT_RBAC_183_GUARD_MISSING: % / %',
        v_sig, v_expected_key;
    END IF;

    -- anon also inherits PUBLIC. A false result therefore proves neither an
    -- anon grant nor an inherited PUBLIC grant remains.
    IF has_function_privilege('anon', v_sig, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_sig, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION
        'FINANCIAL_REPORT_RBAC_183_EXECUTE_BOUNDARY_INVALID: %', v_sig;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(
    'public.rpc_get_trial_balance(uuid,date)'::regprocedure)
  INTO v_def;
  IF v_def NOT LIKE '%gl_entry_lines%'
     OR v_def NOT LIKE '%gl_entries%'
     OR v_def LIKE '%FROM journal_lines%'
     OR v_def LIKE '%FROM journal_entries%'
     OR v_def NOT LIKE '%fiscal_year_start%'
     OR v_def NOT LIKE '%account_id IS NULL%'
     OR v_def NOT LIKE '%COALESCE(a.name_ar, a.name, l.account_name)%' THEN
    RAISE EXCEPTION
      'FINANCIAL_REPORT_RBAC_183_TRIAL_BALANCE_182_LAYER_REGRESSED';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'rpc_get_trial_balance'
  ) <> 1 THEN
    RAISE EXCEPTION
      'FINANCIAL_REPORT_RBAC_183_TRIAL_BALANCE_OVERLOAD_DRIFT';
  END IF;
END;
$postflight$;

COMMIT;
