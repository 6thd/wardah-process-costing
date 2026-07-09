-- ===================================================================
-- Migration 81: تسوية الدفاتر الفرعية مع الأستاذ العام
-- Subledger ↔ GL Reconciliation — بند 13 (P2)
-- ===================================================================
-- المتطلبات: Migration 76 (wardah_org_id) — والبقية اختيارية:
--   الدالة دفاعية 100%: أي جدول غير موجود ⇒ قسمه يُعلَّم unavailable
--   ولا تفشل الدالة بأكملها
-- المبدأ: إضافي 100% — دالة قراءة فقط (STABLE)، لا تعديل على أي جدول
--
-- الأقسام:
--   1) المخزون (مواد خام 131* + إنتاج تام 135*) مقابل الدفتر الفرعي
--      للمخزون (inventory_ledger أو stock_ledger_entries — أيهما وُجد)
--   2) الإنتاج تحت التشغيل (134*) مقابل stage_costs للأوامر المفتوحة
--
-- أي فرق = قيد يدوي شارد أو ترحيل ناقص — يظهر فوراً بدلاً من
-- اكتشافه في إقفال نهاية السنة
-- ===================================================================

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

COMMENT ON FUNCTION public.rpc_subledger_gl_reconciliation(DATE, UUID, TEXT[], TEXT[]) IS
'تسوية الدفاتر الفرعية مع الأستاذ العام: المخزون (131*/135*) مقابل دفتر المخزون الفرعي، وWIP (134*) مقابل stage_costs للأوامر المفتوحة. قراءة فقط (STABLE) — دفاعية: أي جدول غير موجود يُعلَّم قسمه unavailable دون فشل. Migration 81';

GRANT EXECUTE ON FUNCTION public.rpc_subledger_gl_reconciliation(DATE, UUID, TEXT[], TEXT[]) TO authenticated;

-- ===================================================================
-- التحقق بعد التطبيق:
--   SELECT proname FROM pg_proc WHERE proname = 'rpc_subledger_gl_reconciliation';
-- الاستخدام:
--   SELECT rpc_subledger_gl_reconciliation();                    -- اليوم
--   SELECT rpc_subledger_gl_reconciliation('2026-06-30');        -- تاريخ محدد
-- ===================================================================
