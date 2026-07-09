-- ===================================================================
-- Migration 80: تقرير تكلفة الإنتاج بالوحدات المكافئة
-- Cost of Production Report (CPR) — الخطوات الخمس القياسية
-- ===================================================================
-- المتطلبات: Migrations 66-69 (WIP/EUP/Scrap/FIFO) + 76 (wardah_org_id)
-- المبدأ: إضافي 100% — دالة قراءة فقط (READ ONLY)، لا تعديل على أي جدول
--
-- التقرير يتبع الشكل المحاسبي القياسي:
--   الخطوة 1: جدول الكميات (Quantity Schedule)
--   الخطوة 2: الوحدات المكافئة لكل عنصر تكلفة (EUP)
--   الخطوة 3: التكاليف الواجب حسابها (Costs to Account For)
--   الخطوة 4: تكلفة الوحدة المكافئة (Cost per EU)
--   الخطوة 5: توزيع التكاليف + التسوية (Cost Assignment + Reconciliation)
--
-- معادلات EUP مطابقة تماماً لمعادلات upsert_stage_cost (Migration 69):
--   WA:   EUP = مكتمل + (WIP نهائي × نسبة إتمامه)
--   FIFO: EUP = مكتمل + (WIP نهائي × نسبته) − (WIP أول × نسبته)
--   مراحل > 1: EUP_DM = المكتمل فقط (المواد ضمن المحوَّل من المرحلة السابقة)
-- ===================================================================

CREATE OR REPLACE FUNCTION public.rpc_cost_of_production_report(
    p_mo_id    UUID,
    p_stage_no INTEGER DEFAULT NULL,   -- NULL = كل المراحل
    p_tenant   UUID    DEFAULT NULL    -- NULL = من جلسة المستخدم
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE                                 -- قراءة فقط — لا كتابة إطلاقاً
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org        UUID;
    v_mo         RECORD;
    v_stage      RECORD;
    v_stages     JSONB := '[]'::JSONB;
    v_stage_rpt  JSONB;

    -- أعمدة ديناميكية (org_id/tenant_id على غرار Migrations 67-69)
    v_tenant_col TEXT;
    v_mo_col     TEXT;
    v_stage_col  TEXT;
    v_sql        TEXT;

    -- الخطوة 1: جدول الكميات
    v_units_in           NUMERIC;  -- الوحدات الواجب حسابها
    v_units_out          NUMERIC;  -- الوحدات المحسوبة
    v_qty_balanced       BOOLEAN;

    -- الخطوة 2: EUP
    v_eup_dm             NUMERIC;
    v_eup_cc             NUMERIC;

    -- الخطوة 3: التكاليف الواجب حسابها
    v_cc_cost            NUMERIC;  -- تكاليف التحويل = عمالة + أوفرهيد
    v_costs_in           NUMERIC;

    -- الخطوة 4: تكلفة الوحدة المكافئة
    v_ti_per_eu          NUMERIC := 0;
    v_dm_per_eu          NUMERIC := 0;
    v_cc_per_eu          NUMERIC := 0;
    v_unit_cost_total    NUMERIC := 0;
    v_ti_eup_base        NUMERIC;

    -- الخطوة 5: توزيع التكاليف
    v_cost_completed     NUMERIC;
    v_cost_ending_wip    NUMERIC;
    v_cost_abnormal      NUMERIC;
    v_costs_out          NUMERIC;
    v_reconcile_diff     NUMERIC;
    v_is_balanced        BOOLEAN;

    -- إجماليات على مستوى الأمر كاملاً
    v_grand_costs_in     NUMERIC := 0;
    v_grand_completed    NUMERIC := 0;
    v_grand_ending_wip   NUMERIC := 0;
    v_grand_abnormal     NUMERIC := 0;
    v_all_balanced       BOOLEAN := TRUE;
BEGIN
    -- ===== هوية المؤسسة =====
    v_org := wardah_org_id(p_tenant);
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'ORG_NOT_RESOLVED: تعذر تحديد هوية المؤسسة';
    END IF;

    -- ===== كشف أسماء الأعمدة (نفس نمط Migrations 67-69) =====
    SELECT column_name INTO v_tenant_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stage_costs'
      AND column_name IN ('tenant_id', 'org_id')
    ORDER BY CASE column_name WHEN 'tenant_id' THEN 1 ELSE 2 END
    LIMIT 1;

    SELECT column_name INTO v_mo_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stage_costs'
      AND column_name IN ('mo_id', 'manufacturing_order_id')
    ORDER BY CASE column_name WHEN 'mo_id' THEN 1 ELSE 2 END
    LIMIT 1;

    SELECT column_name INTO v_stage_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stage_costs'
      AND column_name IN ('stage_no', 'stage_number')
    ORDER BY CASE column_name WHEN 'stage_no' THEN 1 ELSE 2 END
    LIMIT 1;

    IF v_tenant_col IS NULL OR v_mo_col IS NULL OR v_stage_col IS NULL THEN
        RAISE EXCEPTION 'SCHEMA_MISMATCH: جدول stage_costs لا يحتوي الأعمدة المتوقعة';
    END IF;

    -- ===== رأس التقرير: بيانات أمر التصنيع =====
    SELECT * INTO v_mo
    FROM manufacturing_orders
    WHERE id = p_mo_id AND org_id = v_org;

    IF v_mo IS NULL THEN
        RAISE EXCEPTION 'MO_NOT_FOUND: أمر التصنيع غير موجود أو لا يتبع مؤسستك';
    END IF;

    -- ===== المرور على المراحل =====
    v_sql := format(
        'SELECT *,
                %I  AS k_stage_no
         FROM stage_costs
         WHERE %I = $1 AND %I = $2
           AND ($3::INTEGER IS NULL OR %I = $3)
         ORDER BY %I',
        v_stage_col, v_tenant_col, v_mo_col, v_stage_col, v_stage_col
    );

    FOR v_stage IN EXECUTE v_sql USING v_org, p_mo_id, p_stage_no
    LOOP
        -- ============================================================
        -- الخطوة 1: جدول الكميات
        -- الوحدات الواجب حسابها = WIP أول المدة + وحدات بدأت
        -- الوحدات المحسوبة = مكتمل + WIP آخر المدة + تالف طبيعي + تالف غير طبيعي
        -- ============================================================
        v_units_in  := COALESCE(v_stage.wip_beginning_qty, 0)
                     + COALESCE(v_stage.input_qty, 0);
        v_units_out := COALESCE(v_stage.good_qty, 0)
                     + COALESCE(v_stage.wip_end_qty, 0)
                     + COALESCE(v_stage.normal_scrap_qty, 0)
                     + COALESCE(v_stage.abnormal_scrap_qty, 0)
                     + COALESCE(v_stage.rework_qty, 0);
        v_qty_balanced := ABS(v_units_in - v_units_out) < 0.000001;

        -- ============================================================
        -- الخطوة 2: EUP — نفس معادلات upsert_stage_cost حرفياً
        -- ============================================================
        IF COALESCE(v_stage.costing_method, 'weighted_average') = 'fifo' THEN
            IF v_stage.k_stage_no = 1 THEN
                v_eup_dm := COALESCE(v_stage.good_qty, 0)
                          + COALESCE(v_stage.wip_end_qty, 0) * COALESCE(v_stage.wip_end_dm_completion_pct, 0) / 100
                          - COALESCE(v_stage.wip_beginning_qty, 0) * COALESCE(v_stage.wip_beginning_dm_completion_pct, 0) / 100;
            ELSE
                v_eup_dm := COALESCE(v_stage.good_qty, 0);
            END IF;
            v_eup_cc := COALESCE(v_stage.good_qty, 0)
                      + COALESCE(v_stage.wip_end_qty, 0) * COALESCE(v_stage.wip_end_cc_completion_pct, 0) / 100
                      - COALESCE(v_stage.wip_beginning_qty, 0) * COALESCE(v_stage.wip_beginning_cc_completion_pct, 0) / 100;
        ELSE
            -- المتوسط المرجّح
            IF v_stage.k_stage_no = 1 THEN
                v_eup_dm := COALESCE(v_stage.good_qty, 0)
                          + COALESCE(v_stage.wip_end_qty, 0) * COALESCE(v_stage.wip_end_dm_completion_pct, 0) / 100;
            ELSE
                v_eup_dm := COALESCE(v_stage.good_qty, 0);
            END IF;
            v_eup_cc := COALESCE(v_stage.good_qty, 0)
                      + COALESCE(v_stage.wip_end_qty, 0) * COALESCE(v_stage.wip_end_cc_completion_pct, 0) / 100;
        END IF;

        -- ============================================================
        -- الخطوة 3: التكاليف الواجب حسابها
        -- WIP أول + محوَّل وارد + مواد + تحويل (عمالة+أوفرهيد) + إعادة طحن − رصيد خردة
        -- ============================================================
        v_cc_cost  := COALESCE(v_stage.dl_cost, 0) + COALESCE(v_stage.moh_cost, 0);
        v_costs_in := COALESCE(v_stage.wip_beginning_cost, 0)
                    + COALESCE(v_stage.transferred_in, 0)
                    + COALESCE(v_stage.dm_cost, 0)
                    + v_cc_cost
                    + COALESCE(v_stage.regrind_proc_cost, 0)
                    - COALESCE(v_stage.waste_credit, 0);

        -- ============================================================
        -- الخطوة 4: تكلفة الوحدة المكافئة لكل عنصر
        -- المحوَّل الوارد مكتمل 100% دائماً ⇒ قاعدته = مكتمل + WIP نهائي كامل
        -- ============================================================
        v_ti_eup_base := COALESCE(v_stage.good_qty, 0) + COALESCE(v_stage.wip_end_qty, 0);

        v_ti_per_eu := CASE WHEN v_ti_eup_base > 0
                            THEN COALESCE(v_stage.transferred_in, 0) / v_ti_eup_base
                            ELSE 0 END;
        v_dm_per_eu := CASE WHEN v_eup_dm > 0
                            THEN COALESCE(v_stage.dm_cost, 0) / v_eup_dm
                            ELSE 0 END;
        -- تكاليف التحويل تشمل تسويات إعادة الطحن ورصيد الخردة (نفس منطق 69)
        v_cc_per_eu := CASE WHEN v_eup_cc > 0
                            THEN (v_cc_cost
                                  + COALESCE(v_stage.regrind_proc_cost, 0)
                                  - COALESCE(v_stage.waste_credit, 0)
                                  + COALESCE(v_stage.wip_beginning_cost, 0)) / v_eup_cc
                            ELSE 0 END;
        v_unit_cost_total := v_ti_per_eu + v_dm_per_eu + v_cc_per_eu;

        -- ============================================================
        -- الخطوة 5: توزيع التكاليف
        -- مكتمل ومحوَّل = بالباقي (يمتص التالف الطبيعي تلقائياً — لا تسريب)
        -- WIP نهائي = كمية × (TI كامل + DM بنسبته + CC بنسبته)
        -- تالف غير طبيعي = القيمة المخزنة (احتُسبت وقت الترحيل — خسارة فترة)
        -- ============================================================
        v_cost_ending_wip := COALESCE(v_stage.wip_end_qty, 0) * (
                                 v_ti_per_eu
                               + v_dm_per_eu * COALESCE(v_stage.wip_end_dm_completion_pct, 0) / 100
                               + v_cc_per_eu * COALESCE(v_stage.wip_end_cc_completion_pct, 0) / 100
                             );
        v_cost_abnormal   := COALESCE(v_stage.abnormal_scrap_cost, 0);
        v_cost_completed  := v_costs_in - v_cost_ending_wip - v_cost_abnormal;

        v_costs_out      := v_cost_completed + v_cost_ending_wip + v_cost_abnormal;
        v_reconcile_diff := v_costs_in - v_costs_out;
        v_is_balanced    := ABS(v_reconcile_diff) < 0.01;

        v_all_balanced     := v_all_balanced AND v_is_balanced AND v_qty_balanced;
        v_grand_costs_in   := v_grand_costs_in   + v_costs_in;
        v_grand_completed  := v_grand_completed  + v_cost_completed;
        v_grand_ending_wip := v_grand_ending_wip + v_cost_ending_wip;
        v_grand_abnormal   := v_grand_abnormal   + v_cost_abnormal;

        -- ===== بناء JSON المرحلة =====
        v_stage_rpt := jsonb_build_object(
            'stage_no',       v_stage.k_stage_no,
            'work_center_id', v_stage.wc_id,
            'costing_method', COALESCE(v_stage.costing_method, 'weighted_average'),
            'mode',           v_stage.mode,

            'quantity_schedule', jsonb_build_object(
                'wip_beginning_qty',   COALESCE(v_stage.wip_beginning_qty, 0),
                'units_started',       COALESCE(v_stage.input_qty, 0),
                'units_to_account',    v_units_in,
                'units_completed',     COALESCE(v_stage.good_qty, 0),
                'wip_ending_qty',      COALESCE(v_stage.wip_end_qty, 0),
                'normal_scrap_qty',    COALESCE(v_stage.normal_scrap_qty, 0),
                'abnormal_scrap_qty',  COALESCE(v_stage.abnormal_scrap_qty, 0),
                'rework_qty',          COALESCE(v_stage.rework_qty, 0),
                'units_accounted',     v_units_out,
                'qty_difference',      v_units_in - v_units_out,
                'is_balanced',         v_qty_balanced
            ),

            'equivalent_units', jsonb_build_object(
                'eup_dm',                       ROUND(v_eup_dm, 6),
                'eup_cc',                       ROUND(v_eup_cc, 6),
                'wip_end_dm_completion_pct',    COALESCE(v_stage.wip_end_dm_completion_pct, 0),
                'wip_end_cc_completion_pct',    COALESCE(v_stage.wip_end_cc_completion_pct, 0),
                'wip_beg_dm_completion_pct',    COALESCE(v_stage.wip_beginning_dm_completion_pct, 0),
                'wip_beg_cc_completion_pct',    COALESCE(v_stage.wip_beginning_cc_completion_pct, 0)
            ),

            'costs_to_account', jsonb_build_object(
                'wip_beginning_cost', COALESCE(v_stage.wip_beginning_cost, 0),
                'transferred_in',     COALESCE(v_stage.transferred_in, 0),
                'direct_materials',   COALESCE(v_stage.dm_cost, 0),
                'direct_labor',       COALESCE(v_stage.dl_cost, 0),
                'overhead_applied',   COALESCE(v_stage.moh_cost, 0),
                'conversion_costs',   v_cc_cost,
                'regrind_cost',       COALESCE(v_stage.regrind_proc_cost, 0),
                'waste_credit',       COALESCE(v_stage.waste_credit, 0),
                'total_costs_in',     ROUND(v_costs_in, 6)
            ),

            'cost_per_eu', jsonb_build_object(
                'transferred_in_per_eu', ROUND(v_ti_per_eu, 6),
                'dm_per_eu',             ROUND(v_dm_per_eu, 6),
                'cc_per_eu',             ROUND(v_cc_per_eu, 6),
                'total_per_eu',          ROUND(v_unit_cost_total, 6),
                'stored_unit_cost',      COALESCE(v_stage.unit_cost, 0)
            ),

            'cost_assignment', jsonb_build_object(
                'completed_and_transferred', ROUND(v_cost_completed, 6),
                'ending_wip',                ROUND(v_cost_ending_wip, 6),
                'abnormal_scrap_loss',       ROUND(v_cost_abnormal, 6),
                'normal_scrap_absorbed',     COALESCE(v_stage.normal_scrap_cost, 0),
                'total_costs_out',           ROUND(v_costs_out, 6)
            ),

            'reconciliation', jsonb_build_object(
                'costs_in',          ROUND(v_costs_in, 6),
                'costs_out',         ROUND(v_costs_out, 6),
                'difference',        ROUND(v_reconcile_diff, 6),
                'is_balanced',       v_is_balanced,
                'stored_total_cost', COALESCE(v_stage.total_cost, 0),
                'stored_vs_computed_diff', ROUND(COALESCE(v_stage.total_cost, 0) - v_cost_completed, 6)
            )
        );

        v_stages := v_stages || v_stage_rpt;
    END LOOP;

    IF jsonb_array_length(v_stages) = 0 THEN
        RAISE EXCEPTION 'NO_STAGE_DATA: لا توجد بيانات مراحل لهذا الأمر%',
            CASE WHEN p_stage_no IS NOT NULL
                 THEN format(' (المرحلة %s)', p_stage_no) ELSE '' END;
    END IF;

    -- ===== التقرير الكامل =====
    RETURN jsonb_build_object(
        'success', TRUE,
        'report_type', 'cost_of_production',
        'generated_at', now(),
        'manufacturing_order', jsonb_build_object(
            'id',             v_mo.id,
            'order_number',   v_mo.order_number,
            'product_id',     v_mo.product_id,
            'status',         v_mo.status,
            'qty_planned',    v_mo.qty_planned
        ),
        'stages', v_stages,
        'totals', jsonb_build_object(
            'total_costs_in',            ROUND(v_grand_costs_in, 6),
            'total_completed',           ROUND(v_grand_completed, 6),
            'total_ending_wip',          ROUND(v_grand_ending_wip, 6),
            'total_abnormal_scrap_loss', ROUND(v_grand_abnormal, 6),
            'all_stages_balanced',       v_all_balanced
        )
    );
END;
$$;

COMMENT ON FUNCTION public.rpc_cost_of_production_report(UUID, INTEGER, UUID) IS
'تقرير تكلفة الإنتاج بالوحدات المكافئة — الخطوات الخمس القياسية: جدول الكميات، EUP، التكاليف الواجب حسابها، تكلفة الوحدة المكافئة، توزيع التكاليف مع التسوية. قراءة فقط (STABLE) — لا يعدّل أي بيانات. Migration 80';

GRANT EXECUTE ON FUNCTION public.rpc_cost_of_production_report(UUID, INTEGER, UUID) TO authenticated;

-- ===================================================================
-- التحقق بعد التطبيق:
--   SELECT proname FROM pg_proc WHERE proname = 'rpc_cost_of_production_report';
-- الاستخدام:
--   SELECT rpc_cost_of_production_report('<mo-uuid>');            -- كل المراحل
--   SELECT rpc_cost_of_production_report('<mo-uuid>', 2);         -- مرحلة محددة
-- ===================================================================
