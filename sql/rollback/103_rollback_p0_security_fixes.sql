-- ===================================================================
-- تراجع Migration 103: استعادة الحالة قبل إصلاحات P0 الأمنية
-- ===================================================================
-- ⚠️ احتفظ بهذا الملف للطوارئ فقط — لا تنفّذه في الإنتاج إلا إذا
--    تعطّل وصول شرعي بسبب Migration 103 ولا يمكن إصلاحه بطريقة أخرى.
--
-- ما يُعيده هذا الملف:
--   1. سياسات USING(true) على الجداول المالية الـ12
--      (تحذير: هذا يُعيد ثغرة كشف البيانات بين المؤسسات — للطوارئ فقط)
--   2. سياسة user_orgs_update_own (بلا WITH CHECK — ثغرة تصعيد)
--   3. سياسة invitations_by_token USING(true) — لاستمرار معاينة الدعوات
--   4. إعادة v_work_order_status بعمود current_operator (نص بريد) إن كان
--      التطبيق يقرؤه بهذا الاسم
--   5. ترك الـ RPCs الجديدة (rpc_set_org_admin/rpc_accept_invitation/
--      rpc_get_invitation_preview) — لا ضرر من إبقائها
--
-- بعد الطوارئ: أصلح سبب الفشل وأعد تطبيق 103.
-- ===================================================================

BEGIN;

-- =====================================================================
-- 1) استعادة سياسات USING(true) على الجداول المالية
-- =====================================================================
DO $$
DECLARE
    v_tables TEXT[] := ARRAY[
        'gl_entries','gl_entry_lines',
        'sales_invoices','sales_invoice_lines',
        'purchase_orders','purchase_order_lines',
        'goods_receipts','goods_receipt_lines',
        'delivery_notes','delivery_note_lines',
        'supplier_invoices','supplier_invoice_lines'
    ];
    v_tbl TEXT;
BEGIN
    FOREACH v_tbl IN ARRAY v_tables LOOP
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL USING (true) WITH CHECK (true)',
            'Allow all for ' || v_tbl,
            v_tbl
        );
    END LOOP;
END;
$$;

-- =====================================================================
-- 2) استعادة user_orgs_update_own (بلا WITH CHECK — ثغرة مقصودة للتراجع)
-- =====================================================================
CREATE POLICY "user_orgs_update_own" ON user_organizations
    FOR UPDATE
    USING (user_id = auth.uid());

-- =====================================================================
-- 3) استعادة invitations_by_token USING(true)
-- =====================================================================
CREATE POLICY "invitations_by_token" ON invitations
    FOR SELECT
    USING (true);

-- =====================================================================
-- 4) إعادة v_work_order_status بالبنية القديمة (مع JOIN على auth.users)
-- =====================================================================
DROP VIEW IF EXISTS public.v_work_order_status CASCADE;
CREATE VIEW public.v_work_order_status AS
SELECT
    wo.id,
    wo.org_id,
    wo.work_order_number,
    wo.operation_name,
    wo.status,
    mo.order_number AS mo_number,
    wc.name AS work_center_name,
    wo.planned_quantity,
    wo.completed_quantity,
    wo.scrapped_quantity,
    wo.planned_setup_time,
    wo.actual_setup_time,
    wo.planned_run_time,
    wo.actual_run_time,
    CASE
        WHEN wo.planned_setup_time > 0
        THEN ROUND(((wo.actual_setup_time - wo.planned_setup_time) / wo.planned_setup_time * 100), 2)
        ELSE 0
    END AS setup_variance_pct,
    CASE
        WHEN wo.planned_run_time > 0
        THEN ROUND(((wo.actual_run_time - wo.planned_run_time) / wo.planned_run_time * 100), 2)
        ELSE 0
    END AS run_variance_pct,
    wo.current_operator_id AS current_operator
FROM work_orders wo
JOIN manufacturing_orders mo ON mo.id = wo.mo_id
JOIN work_centers wc ON wc.id = wo.work_center_id;

COMMIT;
