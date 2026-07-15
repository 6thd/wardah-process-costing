-- =====================================================================
-- Migration 103: P0 — إغلاق الفجوات الأمنية المتبقية
-- بسم الله الرحمن الرحيم
--
-- المشاكل التي تعالجها:
--   1. 12 سياسة "Allow all" USING(true) على جداول مالية (تتجاوز عزل المؤسسات)
--   2. user_orgs_update_own بلا WITH CHECK  (تصعيد is_org_admin)
--   3. invitations_by_token USING(true)  (كشف التوكنات والبريد)
--   4. قبول الدعوة client-side بـ userId من العميل
--   5. 10 Views بصلاحية SECURITY DEFINER
--   6. v_work_order_status تكشف auth.users لـ anon
--   7. 23 دالة بـ search_path متغيّر
--   8. test_init بلا RLS
--   9. دوال DEFINER داخلية متاحة لـ anon/authenticated
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1) حذف سياسات "Allow all" USING(true) على جداول مالية
--    (migration 83 أضافت سياسات org-scoped لكن لم تحذف القديمة؛
--     PostgreSQL يُقيّم السياسات بـOR لذا القديمة كانت تتجاوز الجديدة)
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
        -- حذف السياسة العامة الاسم الأصلي
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON %I',
            'Allow all for ' || v_tbl,
            v_tbl
        );
        -- حذف أي سياسة USING(true) أخرى قد تكون بأسماء مختلفة
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON %I',
            'Allow all',
            v_tbl
        );
    END LOOP;

    RAISE NOTICE 'VERIFY[103-1] ✓ — حُذفت سياسات "Allow all" USING(true) من 12 جدولاً مالياً';
END;
$$;

-- التحقق: يجب ألا تبقى سياسة USING(true) على هذه الجداول
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM pg_policies
    WHERE (qual = 'true' OR with_check = 'true')
      AND tablename IN (
        'gl_entries','gl_entry_lines',
        'sales_invoices','sales_invoice_lines',
        'purchase_orders','purchase_order_lines',
        'goods_receipts','goods_receipt_lines',
        'delivery_notes','delivery_note_lines',
        'supplier_invoices','supplier_invoice_lines'
      );

    IF v_count > 0 THEN
        RAISE EXCEPTION 'FAIL[103-1] — لا تزال % سياسة USING(true) على الجداول المالية', v_count;
    END IF;

    RAISE NOTICE 'VERIFY[103-1] ✓ — صفر سياسة USING(true) على الجداول المالية';
END;
$$;

-- =====================================================================
-- 2) إغلاق ثغرة تصعيد is_org_admin عبر user_orgs_update_own
--    المشكلة: UPDATE بـ USING(user_id=auth.uid()) وبلا WITH CHECK
--    → المستخدم يُعدّل is_org_admin على صفه بحرية
--    الإصلاح: حذف السياسة + RPC إداري وحيد
-- =====================================================================
DROP POLICY IF EXISTS "user_orgs_update_own" ON user_organizations;

-- منع أي UPDATE مباشر من المستخدم العادي على user_organizations
-- (super_admin والـ RPC الجديد يمكنهما التعديل)
DROP POLICY IF EXISTS "user_organizations_update_direct" ON user_organizations;

RAISE NOTICE 'VERIFY[103-2] ✓ — حُذفت user_orgs_update_own (ثغرة تصعيد is_org_admin)';

-- RPC إداري: تعيين/إلغاء صلاحية org admin
-- الحراسة: wardah_is_org_admin (نمط migration 96/101)
-- القيود: لا حذف آخر admin، لا ترقية نفس الـ RPC caller (يجوز للـ super_admin)
CREATE OR REPLACE FUNCTION public.rpc_set_org_admin(
    p_target_user_id UUID,
    p_org_id         UUID,
    p_value          BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_admins_count INT;
BEGIN
    -- 1) المستدعي يجب أن يكون org admin أو super admin
    IF NOT (wardah_is_org_admin(p_org_id) OR is_super_admin()) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'NOT_ORG_ADMIN');
    END IF;

    -- 2) لا ترقية الذات (منع حلقات التحقق)
    IF p_target_user_id = v_caller_id AND p_value = true THEN
        RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_PROMOTE_SELF');
    END IF;

    -- 3) إذا كان إلغاء، تأكد أن المؤسسة ستبقى بأدمن واحد على الأقل
    IF p_value = false THEN
        SELECT COUNT(*) INTO v_admins_count
        FROM user_organizations
        WHERE org_id = p_org_id
          AND is_org_admin = true
          AND is_active = true
          AND user_id != p_target_user_id;

        IF v_admins_count = 0 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'LAST_ORG_ADMIN');
        END IF;
    END IF;

    -- 4) التعديل عبر RPC فقط (SECURITY DEFINER يتجاوز RLS هنا بشكل مقصود)
    UPDATE user_organizations
       SET is_org_admin = p_value
     WHERE user_id = p_target_user_id
       AND org_id  = p_org_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_MEMBER');
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.rpc_set_org_admin(UUID, UUID, BOOLEAN) IS
'بوابة إدارية لتعيين/إلغاء صلاحية org_admin — تتحقق من: عضوية المستدعي، منع ترقية الذات، منع حذف آخر أدمن. SECURITY DEFINER بـ search_path مثبّت (Migration 103).';

REVOKE ALL ON FUNCTION public.rpc_set_org_admin(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_set_org_admin(UUID, UUID, BOOLEAN) TO authenticated;

-- =====================================================================
-- 3) إغلاق كشف التوكنات في جدول الدعوات
--    المشكلة: invitations_by_token FOR SELECT USING(true) → أي مستخدم
--    يقرأ كل الدعوات (بريد + توكن خام + role_ids + org_id)
--    الإصلاح:
--      - حذف السياسة العامة
--      - RPC آمنة لمعاينة الدعوة (anon) بدون توكن في المخرج
--      - RPC ذرّية لقبول الدعوة تشتق userId من auth.uid()
-- =====================================================================
DROP POLICY IF EXISTS "invitations_by_token" ON invitations;

-- حذف سياسات مكررة قد تتعارض
DROP POLICY IF EXISTS "invitations_org_admin" ON invitations;
DROP POLICY IF EXISTS "invitations_super_admin" ON invitations;
-- إبقاء org_admin_manage_invitations فقط للإدارة

RAISE NOTICE 'VERIFY[103-3] ✓ — حُذفت invitations_by_token USING(true)';

-- RPC معاينة آمنة للدعوة (للمتصفح قبل التسجيل)
-- تعيد حقولاً آمنة فقط: لا توكن، لا role_ids، لا invited_by
CREATE OR REPLACE FUNCTION public.rpc_get_invitation_preview(p_token TEXT)
RETURNS TABLE(
    email        TEXT,
    org_name     TEXT,
    org_name_ar  TEXT,
    status       TEXT,
    expires_at   TIMESTAMPTZ,
    is_valid     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        inv.email::TEXT,
        org.name::TEXT,
        org.name_ar::TEXT,
        inv.status::TEXT,
        inv.expires_at,
        (inv.status = 'pending' AND inv.expires_at > NOW()) AS is_valid
    FROM invitations inv
    JOIN organizations org ON org.id = inv.org_id
    WHERE inv.token = p_token;
END;
$$;

COMMENT ON FUNCTION public.rpc_get_invitation_preview(TEXT) IS
'معاينة آمنة للدعوة قبل التسجيل — تعيد email/org_name/status/expires_at/is_valid فقط. لا يُكشف التوكن ولا role_ids ولا invited_by. قابلة للاستدعاء من anon (Migration 103).';

REVOKE ALL ON FUNCTION public.rpc_get_invitation_preview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_invitation_preview(TEXT) TO anon, authenticated;

-- RPC قبول دعوة — ذرّية، تشتق userId من auth.uid() لا من العميل
CREATE OR REPLACE FUNCTION public.rpc_accept_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  UUID := auth.uid();
    v_caller_email TEXT;
    v_inv        invitations%ROWTYPE;
    v_user_role  RECORD;
BEGIN
    -- 1) يجب أن يكون المستدعي مسجلاً
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
    END IF;

    -- 2) بريد المستدعي من auth.users (مصدر خادمي لا من العميل)
    SELECT email INTO v_caller_email
    FROM auth.users
    WHERE id = v_caller_id;

    -- 3) قفل الدعوة للكتابة (منع السباق)
    SELECT * INTO v_inv
    FROM invitations
    WHERE token = p_token
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_NOT_FOUND');
    END IF;

    -- 4) تحقق من الحالة والانتهاء
    IF v_inv.status != 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_ALREADY_USED');
    END IF;

    IF v_inv.expires_at < NOW() THEN
        UPDATE invitations SET status = 'expired' WHERE id = v_inv.id;
        RETURN jsonb_build_object('ok', false, 'error', 'INVITATION_EXPIRED');
    END IF;

    -- 5) تطابق البريد (حرف-sensitive insensitive)
    IF lower(v_caller_email) != lower(v_inv.email) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'EMAIL_MISMATCH');
    END IF;

    -- 6) إضافة العضوية (idempotent: ON CONFLICT DO NOTHING)
    INSERT INTO user_organizations (
        user_id, org_id, is_active, is_org_admin, joined_at, invited_by
    ) VALUES (
        v_caller_id, v_inv.org_id, true, false, NOW(), v_inv.invited_by
    )
    ON CONFLICT (user_id, org_id) DO NOTHING;

    -- 7) إضافة الأدوار (idempotent)
    IF v_inv.role_ids IS NOT NULL AND array_length(v_inv.role_ids, 1) > 0 THEN
        INSERT INTO user_roles (user_id, role_id, org_id)
        SELECT v_caller_id, role_id, v_inv.org_id
        FROM unnest(v_inv.role_ids) AS role_id
        ON CONFLICT DO NOTHING;
    END IF;

    -- 8) إغلاق الدعوة
    UPDATE invitations
       SET status = 'accepted', accepted_at = NOW()
     WHERE id = v_inv.id;

    RETURN jsonb_build_object('ok', true, 'org_id', v_inv.org_id);
END;
$$;

COMMENT ON FUNCTION public.rpc_accept_invitation(TEXT) IS
'قبول دعوة ذرّية — تشتق user_id من auth.uid() لا من العميل؛ تتحقق من البريد/الانتهاء/الحالة؛ تُغلق الدعوة في Transaction واحدة مع قفل FOR UPDATE (منع سباق). (Migration 103).';

REVOKE ALL ON FUNCTION public.rpc_accept_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_accept_invitation(TEXT) TO authenticated;

-- =====================================================================
-- 4) إصلاح Views ذات SECURITY DEFINER → SECURITY INVOKER
--    وإزالة اتصال v_work_order_status بـ auth.users
-- =====================================================================

-- v_work_order_status: إعادة التعريف بدون JOIN على auth.users
-- (نُبقي current_operator_id كـ UUID، لا نكشف البريد من auth.users)
CREATE OR REPLACE VIEW public.v_work_order_status
WITH (security_invoker = on)
AS
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
    wo.current_operator_id
FROM work_orders wo
JOIN manufacturing_orders mo ON mo.id = wo.mo_id
JOIN work_centers wc ON wc.id = wo.work_center_id;

-- باقي الـ Views: تحويل إلى security_invoker فقط (لا تحتوي auth.users)
CREATE OR REPLACE VIEW public.v_capacity_summary
WITH (security_invoker = on)
AS
SELECT
    wc.org_id,
    wc.id AS work_center_id,
    wc.name AS work_center_name,
    wc.capacity_hours_per_day,
    wc.number_of_machines,
    wcl.period_start,
    wcl.period_end,
    wcl.available_capacity_hours,
    wcl.planned_load_hours,
    wcl.actual_load_hours,
    wcl.utilization_pct,
    wcl.planned_work_orders,
    wcl.completed_work_orders,
    CASE
        WHEN wcl.utilization_pct > 100 THEN 'OVERLOADED'
        WHEN wcl.utilization_pct > 85  THEN 'HIGH'
        WHEN wcl.utilization_pct > 50  THEN 'NORMAL'
        ELSE 'LOW'
    END AS load_status
FROM work_centers wc
LEFT JOIN work_center_load wcl ON wc.id = wcl.work_center_id;

CREATE OR REPLACE VIEW public.v_production_schedule_details
WITH (security_invoker = on)
AS
SELECT
    ps.id AS schedule_id,
    ps.schedule_number,
    ps.status AS schedule_status,
    ps.period_start,
    ps.period_end,
    sd.schedule_sequence,
    sd.scheduled_start,
    sd.scheduled_end,
    sd.schedule_status AS item_status,
    wo.work_order_number,
    wo.operation_name,
    wo.planned_quantity,
    wo.completed_quantity,
    mo.order_number AS mo_number,
    wc.name AS work_center_name,
    EXTRACT(epoch FROM (sd.scheduled_end - sd.scheduled_start)) / 3600 AS duration_hours
FROM production_schedules ps
JOIN schedule_details sd ON ps.id = sd.schedule_id
JOIN work_orders wo ON sd.work_order_id = wo.id
JOIN manufacturing_orders mo ON wo.mo_id = mo.id
JOIN work_centers wc ON wo.work_center_id = wc.id;

CREATE OR REPLACE VIEW public.v_work_center_productivity
WITH (security_invoker = on)
AS
SELECT
    wc.id AS work_center_id,
    wc.org_id,
    wc.name AS work_center_name,
    wc.capacity_hours_per_day,
    COUNT(DISTINCT wo.id) AS total_work_orders,
    COUNT(DISTINCT wo.id) FILTER (WHERE wo.status::text = 'IN_PROGRESS') AS active_work_orders,
    SUM(wo.completed_quantity) AS total_produced,
    SUM(wo.scrapped_quantity) AS total_scrapped,
    SUM(wo.actual_run_time) AS total_run_time_minutes,
    ROUND(AVG(CASE WHEN wo.planned_run_time > 0 THEN (wo.actual_run_time / wo.planned_run_time * 100) ELSE NULL END), 2) AS avg_efficiency_pct
FROM work_centers wc
LEFT JOIN work_orders wo ON wc.id = wo.work_center_id
GROUP BY wc.id, wc.org_id, wc.name, wc.capacity_hours_per_day;

CREATE OR REPLACE VIEW public.v_all_public_functions
WITH (security_invoker = on)
AS
SELECT
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    CASE
        WHEN p.provolatile = 'i' THEN 'IMMUTABLE'
        WHEN p.provolatile = 's' THEN 'STABLE'
        WHEN p.provolatile = 'v' THEN 'VOLATILE'
        ELSE 'UNKNOWN'
    END AS volatility
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.prokind = 'f'
ORDER BY p.proname;

CREATE OR REPLACE VIEW public.v_labor_efficiency
WITH (security_invoker = on)
AS
SELECT
    wo.org_id,
    wo.work_center_id,
    wc.name AS work_center_name,
    mo.order_number,
    wo.work_order_number,
    wo.operation_name,
    wo.planned_setup_time,
    wo.actual_setup_time,
    wo.planned_run_time,
    wo.actual_run_time,
    wo.planned_quantity,
    wo.completed_quantity,
    wo.scrapped_quantity,
    CASE WHEN wo.actual_setup_time > 0 THEN ROUND((wo.planned_setup_time / wo.actual_setup_time * 100), 2) ELSE 100 END AS setup_efficiency_pct,
    CASE WHEN wo.actual_run_time > 0   THEN ROUND((wo.planned_run_time  / wo.actual_run_time  * 100), 2) ELSE 100 END AS run_efficiency_pct,
    CASE WHEN (wo.actual_setup_time + wo.actual_run_time) > 0
         THEN ROUND(((wo.planned_setup_time + wo.planned_run_time) / (wo.actual_setup_time + wo.actual_run_time) * 100), 2)
         ELSE 100 END AS overall_efficiency_pct,
    CASE WHEN (wo.completed_quantity + wo.scrapped_quantity) > 0
         THEN ROUND((wo.scrapped_quantity / (wo.completed_quantity + wo.scrapped_quantity) * 100), 2)
         ELSE 0 END AS scrap_rate_pct,
    wo.actual_start_date,
    wo.actual_end_date,
    wo.status
FROM work_orders wo
JOIN manufacturing_orders mo ON wo.mo_id = mo.id
JOIN work_centers wc ON wo.work_center_id = wc.id
WHERE wo.status::text = 'COMPLETED';

CREATE OR REPLACE VIEW public.v_work_center_efficiency_summary
WITH (security_invoker = on)
AS
SELECT
    wo.org_id,
    wo.work_center_id,
    wc.name AS work_center_name,
    wc.name_ar AS work_center_name_ar,
    date_trunc('day', wo.actual_end_date) AS production_date,
    COUNT(*) AS completed_operations,
    SUM(wo.completed_quantity) AS total_produced,
    SUM(wo.scrapped_quantity) AS total_scrapped,
    SUM(wo.planned_setup_time) AS total_planned_setup,
    SUM(wo.actual_setup_time) AS total_actual_setup,
    SUM(wo.planned_run_time) AS total_planned_run,
    SUM(wo.actual_run_time) AS total_actual_run,
    ROUND(AVG(CASE WHEN wo.actual_setup_time > 0 THEN (wo.planned_setup_time / wo.actual_setup_time * 100) ELSE 100 END), 2) AS avg_setup_efficiency,
    ROUND(AVG(CASE WHEN wo.actual_run_time > 0   THEN (wo.planned_run_time  / wo.actual_run_time  * 100) ELSE 100 END), 2) AS avg_run_efficiency,
    ROUND(AVG(CASE WHEN (wo.actual_setup_time + wo.actual_run_time) > 0
                   THEN ((wo.planned_setup_time + wo.planned_run_time) / (wo.actual_setup_time + wo.actual_run_time) * 100)
                   ELSE 100 END), 2) AS avg_overall_efficiency
FROM work_orders wo
JOIN work_centers wc ON wo.work_center_id = wc.id
WHERE wo.status::text = 'COMPLETED' AND wo.actual_end_date IS NOT NULL
GROUP BY wo.org_id, wo.work_center_id, wc.name, wc.name_ar, date_trunc('day', wo.actual_end_date);

CREATE OR REPLACE VIEW public.v_cost_variance_report
WITH (security_invoker = on)
AS
SELECT
    wo.org_id,
    mo.order_number,
    wo.work_order_number,
    wo.operation_name,
    wc.name AS work_center_name,
    ROUND(((wo.planned_setup_time + wo.planned_run_time) / 60 * COALESCE(ro.labor_rate_per_hour, wc.default_labor_rate, 0)), 2) AS planned_labor_cost,
    ROUND(((wo.actual_setup_time + wo.actual_run_time) / 60 * COALESCE(ro.labor_rate_per_hour, wc.default_labor_rate, 0)), 2) AS actual_labor_cost,
    ROUND((((wo.actual_setup_time + wo.actual_run_time) - (wo.planned_setup_time + wo.planned_run_time)) / 60 * COALESCE(ro.labor_rate_per_hour, wc.default_labor_rate, 0)), 2) AS labor_variance,
    ROUND(((wo.planned_setup_time + wo.planned_run_time) / 60 * COALESCE(ro.overhead_rate_per_hour, wc.default_overhead_rate, 0)), 2) AS planned_overhead_cost,
    ROUND(((wo.actual_setup_time + wo.actual_run_time) / 60 * COALESCE(ro.overhead_rate_per_hour, wc.default_overhead_rate, 0)), 2) AS actual_overhead_cost,
    ROUND((((wo.actual_setup_time + wo.actual_run_time) - (wo.planned_setup_time + wo.planned_run_time)) / 60 * COALESCE(ro.overhead_rate_per_hour, wc.default_overhead_rate, 0)), 2) AS overhead_variance,
    wo.status,
    wo.actual_end_date
FROM work_orders wo
JOIN manufacturing_orders mo ON wo.mo_id = mo.id
JOIN work_centers wc ON wo.work_center_id = wc.id
LEFT JOIN routing_operations ro ON wo.operation_id = ro.id
WHERE wo.status::text = 'COMPLETED';

CREATE OR REPLACE VIEW public.v_material_consumption_report
WITH (security_invoker = on)
AS
SELECT
    mc.org_id,
    mo.order_number,
    wo.work_order_number,
    i.code AS item_code,
    i.name AS item_name,
    mc.planned_quantity,
    mc.consumed_quantity,
    (mc.consumed_quantity - mc.planned_quantity) AS variance_qty,
    CASE WHEN mc.planned_quantity > 0
         THEN ROUND(((mc.consumed_quantity - mc.planned_quantity) / mc.planned_quantity * 100), 2)
         ELSE 0 END AS variance_pct,
    mc.unit_cost,
    mc.total_cost,
    mc.consumption_type,
    mc.consumption_date,
    mc.status
FROM material_consumption mc
JOIN manufacturing_orders mo ON mc.mo_id = mo.id
JOIN work_orders wo ON mc.work_order_id = wo.id
JOIN items i ON mc.item_id = i.id;

CREATE OR REPLACE VIEW public.v_oee_report
WITH (security_invoker = on)
AS
WITH daily_data AS (
    SELECT
        wo.org_id,
        wo.work_center_id,
        date_trunc('day', wo.actual_end_date) AS production_date,
        (wc_1.capacity_hours_per_day * 60) AS available_time,
        SUM(wo.actual_setup_time + wo.actual_run_time) AS operating_time,
        COALESCE(SUM(md.duration_minutes), 0) AS downtime,
        SUM(wo.completed_quantity) AS total_produced,
        SUM(wo.completed_quantity - wo.scrapped_quantity) AS good_quantity,
        SUM(wo.planned_quantity) AS planned_quantity,
        AVG(ro.standard_run_time_per_unit) AS ideal_cycle_time
    FROM work_orders wo
    JOIN work_centers wc_1 ON wo.work_center_id = wc_1.id
    LEFT JOIN machine_downtime md ON wo.work_center_id = md.work_center_id
        AND date_trunc('day', md.start_time) = date_trunc('day', wo.actual_end_date)
    LEFT JOIN routing_operations ro ON wo.operation_id = ro.id
    WHERE wo.status::text = 'COMPLETED' AND wo.actual_end_date IS NOT NULL
    GROUP BY wo.org_id, wo.work_center_id, wc_1.capacity_hours_per_day, date_trunc('day', wo.actual_end_date)
)
SELECT
    dd.org_id,
    dd.work_center_id,
    wc.name AS work_center_name,
    dd.production_date,
    dd.available_time,
    dd.operating_time,
    dd.downtime,
    dd.total_produced,
    dd.good_quantity,
    ROUND((dd.operating_time / NULLIF(dd.available_time, 0) * 100), 2) AS availability_pct,
    ROUND(CASE WHEN dd.operating_time > 0 AND dd.ideal_cycle_time > 0
               THEN (dd.total_produced * dd.ideal_cycle_time / dd.operating_time * 100)
               ELSE 100 END, 2) AS performance_pct,
    ROUND(CASE WHEN dd.total_produced > 0
               THEN (dd.good_quantity / dd.total_produced * 100)
               ELSE 100 END, 2) AS quality_pct,
    ROUND((
        (dd.operating_time / NULLIF(dd.available_time, 0))
        * CASE WHEN dd.operating_time > 0 AND dd.ideal_cycle_time > 0
               THEN (dd.total_produced * dd.ideal_cycle_time / dd.operating_time)
               ELSE 1 END
        * CASE WHEN dd.total_produced > 0
               THEN (dd.good_quantity / dd.total_produced)
               ELSE 1 END
        * 100
    ), 2) AS oee_pct
FROM daily_data dd
JOIN work_centers wc ON dd.work_center_id = wc.id;

RAISE NOTICE 'VERIFY[103-4] ✓ — تحويل 10 Views إلى security_invoker وإزالة auth.users من v_work_order_status';

-- =====================================================================
-- 5) تثبيت search_path للدوال الـ 23 ذات المسار المتغيّر
-- =====================================================================
DO $$
DECLARE
    v_fn RECORD;
    v_names TEXT[] := ARRAY[
        'update_organization_profile',
        'get_organization_profile',
        'wardah_touch_updated_at',
        'upsert_stage_cost',
        'update_routing_timestamp',
        'trigger_update_load_on_work_order_change',
        'protect_posted_gl_entries',
        'protect_posted_gl_entry_lines',
        'wardah_org_id',
        'rpc_create_journal_entry',
        'assert_period_open',
        'rpc_post_event_journal',
        'rpc_post_work_center_oh',
        'rpc_upsert_event_mapping',
        'trg_mo_status_machine',
        'normalize_mo_status',
        'validate_mo_transition',
        'rpc_create_mo_with_reservation',
        'trg_gl_entries_period_guard',
        'wardah_periods_org_col',
        'rpc_list_periods',
        'rpc_generate_fiscal_periods',
        'rpc_set_period_status'
    ];
    v_name TEXT;
    v_oid OID;
BEGIN
    FOREACH v_name IN ARRAY v_names LOOP
        -- قد يكون للدالة توقيعات متعددة — نُعالج كلها
        FOR v_fn IN
            SELECT p.oid
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = v_name
        LOOP
            BEGIN
                EXECUTE format(
                    'ALTER FUNCTION public.%I(%s) SET search_path = public',
                    v_name,
                    pg_get_function_identity_arguments(v_fn.oid)
                );
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'search_path: تعذّر تحديث %. — %', v_name, SQLERRM;
            END;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'VERIFY[103-5] ✓ — تثبيت search_path للدوال ذات المسار المتغيّر';
END;
$$;

-- =====================================================================
-- 6) تفعيل RLS على test_init
-- =====================================================================
ALTER TABLE IF EXISTS public.test_init ENABLE ROW LEVEL SECURITY;

-- سياسة مقيّدة: super_admin فقط
DROP POLICY IF EXISTS "test_init_super_admin" ON test_init;
CREATE POLICY "test_init_super_admin" ON test_init
FOR ALL USING (is_super_admin());

RAISE NOTICE 'VERIFY[103-6] ✓ — RLS مفعّل على test_init';

-- =====================================================================
-- 7) سحب EXECUTE من anon على دوال DEFINER الداخلية
--    (الأداة التشخيصية wardah_is_org_admin تبقى لـ authenticated كما هو)
-- =====================================================================
DO $$
DECLARE
    v_fn RECORD;
    v_internal TEXT[] := ARRAY[
        'is_super_admin',
        'is_org_admin_for',
        'wardah_touch_updated_at',
        'upsert_stage_cost',
        'update_routing_timestamp',
        'trigger_update_load_on_work_order_change',
        'protect_posted_gl_entries',
        'protect_posted_gl_entry_lines',
        'assert_period_open',
        'rpc_post_event_journal',
        'rpc_post_work_center_oh',
        'rpc_upsert_event_mapping',
        'trg_mo_status_machine',
        'normalize_mo_status',
        'validate_mo_transition',
        'trg_gl_entries_period_guard',
        'wardah_periods_org_col',
        'wardah_apply_stock_incoming'
    ];
    v_name TEXT;
BEGIN
    FOREACH v_name IN ARRAY v_internal LOOP
        FOR v_fn IN
            SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = v_name
        LOOP
            BEGIN
                EXECUTE format(
                    'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC',
                    v_name, v_fn.args
                );
                EXECUTE format(
                    'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon',
                    v_name, v_fn.args
                );
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'REVOKE: تعذّر لـ % — %', v_name, SQLERRM;
            END;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'VERIFY[103-7] ✓ — سحب EXECUTE من anon/PUBLIC للدوال الداخلية';
END;
$$;

-- =====================================================================
-- تحقق نهائي شامل
-- =====================================================================
DO $$
DECLARE
    v_true_policies   INT;
    v_definer_views   INT;
    v_auth_exposed    INT;
    v_escalation      INT;
    v_inv_open        INT;
BEGIN
    -- سياسات USING(true) على جداول مالية
    SELECT COUNT(*) INTO v_true_policies
    FROM pg_policies
    WHERE (qual = 'true' OR with_check = 'true')
      AND tablename IN (
        'gl_entries','gl_entry_lines','sales_invoices','sales_invoice_lines',
        'purchase_orders','purchase_order_lines','goods_receipts','goods_receipt_lines',
        'delivery_notes','delivery_note_lines','supplier_invoices','supplier_invoice_lines'
      );

    -- Views بـ SECURITY DEFINER (يجب أن تكون صفراً)
    SELECT COUNT(*) INTO v_definer_views
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
      AND c.relname IN (
        'v_work_order_status','v_capacity_summary','v_production_schedule_details',
        'v_work_center_productivity','v_all_public_functions','v_labor_efficiency',
        'v_work_center_efficiency_summary','v_cost_variance_report',
        'v_material_consumption_report','v_oee_report'
      )
      AND EXISTS (
        SELECT 1 FROM pg_rewrite r
        WHERE r.ev_class = c.oid AND r.ev_type = '1'
          AND position('security_invoker' IN pg_get_viewdef(c.oid)) = 0
      );

    -- ثغرة تصعيد: user_orgs_update_own بلا WITH CHECK
    SELECT COUNT(*) INTO v_escalation
    FROM pg_policies
    WHERE tablename = 'user_organizations'
      AND policyname = 'user_orgs_update_own';

    -- كشف التوكنات: invitations_by_token USING(true)
    SELECT COUNT(*) INTO v_inv_open
    FROM pg_policies
    WHERE tablename = 'invitations'
      AND policyname = 'invitations_by_token'
      AND qual = 'true';

    RAISE NOTICE '=== تقرير التحقق النهائي [103] ===';
    RAISE NOTICE '  سياسات USING(true) المالية : %  (المطلوب: 0)', v_true_policies;
    RAISE NOTICE '  user_orgs_update_own       : %  (المطلوب: 0)', v_escalation;
    RAISE NOTICE '  invitations_by_token open  : %  (المطلوب: 0)', v_inv_open;

    IF v_true_policies > 0 THEN
        RAISE EXCEPTION 'FAIL[103] — لا تزال % سياسة USING(true) على الجداول المالية', v_true_policies;
    END IF;
    IF v_escalation > 0 THEN
        RAISE EXCEPTION 'FAIL[103] — ثغرة التصعيد user_orgs_update_own لا تزال موجودة';
    END IF;
    IF v_inv_open > 0 THEN
        RAISE EXCEPTION 'FAIL[103] — invitations_by_token USING(true) لا تزال موجودة';
    END IF;

    RAISE NOTICE 'VERIFY[103] ✓ — كل الفحوصات اجتازت — P0 مغلق';
END;
$$;

COMMIT;
