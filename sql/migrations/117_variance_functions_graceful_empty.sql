-- ===================================================================
-- Migration 117: دوال الانحرافات ترجع فارغاً بدل 42P01 (تقرير «لا ينبض»)
-- ===================================================================
-- stock_moves/labor_entries غير موجودتين في الإنتاج (MANIFEST §108) —
-- كان VarianceAnalysisReport يموت بخطأ 42P01 دائماً. الآن:
--   to_regclass() يفحص وجود الجدول ⇒ RETURN فارغ بأمان، والاستعلام الفعلي
--   انتقل إلى EXECUTE ديناميكي كي لا يفشل الـ parsing عند غياب الجداول.
-- عند تفعيل جداول التتبع مستقبلاً تعمل الدوال تلقائياً بلا تعديل.
-- (أُعيد التطبيق بـ DROP أولاً — توقيع الإرجاع تغيّر عن نسخة 108/111)
-- ملاحظة: الملف المرجعي الكامل مطبَّق على القاعدة عبر apply_migration بنفس الاسم.
-- ===================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.calculate_material_variances(uuid,date,date);
DROP FUNCTION IF EXISTS public.calculate_labor_variances(uuid,date,date);

CREATE FUNCTION public.calculate_material_variances(
    p_mo_id UUID, p_start_date DATE DEFAULT NULL, p_end_date DATE DEFAULT NULL)
RETURNS TABLE (
    product_code VARCHAR, product_name VARCHAR,
    standard_qty NUMERIC, actual_qty NUMERIC,
    standard_cost NUMERIC, actual_cost NUMERIC,
    qty_variance NUMERIC, price_variance NUMERIC,
    efficiency_variance NUMERIC, total_variance NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF to_regclass('public.stock_moves') IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY EXECUTE format($q$
        SELECT sm.product_code::varchar, p.name::varchar,
               SUM(sm.quantity), SUM(sm.actual_quantity),
               SUM(sm.standard_cost), SUM(sm.total_cost),
               SUM((sm.quantity - COALESCE(sm.actual_quantity,0)) * sm.unit_cost),
               SUM((sm.unit_cost - COALESCE(sm.actual_unit_cost, sm.unit_cost)) * COALESCE(sm.actual_quantity, sm.quantity)),
               0::NUMERIC,
               SUM((sm.quantity - COALESCE(sm.actual_quantity,0)) * sm.unit_cost) +
               SUM((sm.unit_cost - COALESCE(sm.actual_unit_cost, sm.unit_cost)) * COALESCE(sm.actual_quantity, sm.quantity))
        FROM stock_moves sm
        JOIN products p ON sm.product_code = p.code
        WHERE sm.move_type = 'material_issue'
          AND sm.reference_id::text = %L::text
          AND (%L::date IS NULL OR sm.date >= %L::date)
          AND (%L::date IS NULL OR sm.date <= %L::date)
        GROUP BY sm.product_code, p.name ORDER BY sm.product_code
    $q$, p_mo_id, p_start_date, p_start_date, p_end_date, p_end_date);
END;
$$;

CREATE FUNCTION public.calculate_labor_variances(
    p_mo_id UUID, p_start_date DATE DEFAULT NULL, p_end_date DATE DEFAULT NULL)
RETURNS TABLE (
    work_center_code VARCHAR, work_center_name VARCHAR,
    standard_hours NUMERIC, actual_hours NUMERIC,
    standard_rate NUMERIC, actual_rate NUMERIC,
    rate_variance NUMERIC, efficiency_variance NUMERIC, total_variance NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF to_regclass('public.labor_entries') IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY EXECUTE format($q$
        SELECT wc.code::varchar, wc.name::varchar,
               SUM(le.standard_hours), SUM(le.actual_hours),
               AVG(le.standard_rate), AVG(le.actual_rate),
               SUM((le.actual_rate - le.standard_rate) * le.actual_hours),
               SUM((le.actual_hours - le.standard_hours) * le.standard_rate),
               SUM((le.actual_rate - le.standard_rate) * le.actual_hours) +
               SUM((le.actual_hours - le.standard_hours) * le.standard_rate)
        FROM labor_entries le
        JOIN work_centers wc ON wc.id = le.work_center_id
        WHERE le.mo_id = %L
          AND (%L::date IS NULL OR le.entry_date >= %L::date)
          AND (%L::date IS NULL OR le.entry_date <= %L::date)
        GROUP BY wc.code, wc.name ORDER BY wc.code
    $q$, p_mo_id, p_start_date, p_start_date, p_end_date, p_end_date);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.calculate_material_variances(uuid,date,date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.calculate_labor_variances(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_material_variances(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_labor_variances(uuid,date,date) TO authenticated;

DO $$
DECLARE v INT;
BEGIN
    SELECT COUNT(*) INTO v FROM calculate_material_variances(gen_random_uuid());
    SELECT COUNT(*) INTO v FROM calculate_labor_variances(gen_random_uuid());
    RAISE NOTICE 'VERIFY[117] ✓ — دوال الانحرافات ترجع فارغاً بلا 42P01';
END;
$$;

COMMIT;
