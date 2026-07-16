-- ============================================================================
-- Migration 120: تحصين دوال SECURITY DEFINER من الفئة C (إغلاق مراجعة كودكس)
-- المرجع: docs/security/SECURITY_DEFINER_AUDIT.md — فحص حي 2026-07-16
--
-- 28 دالة كانت متاحة لـ authenticated بلا تحقق عضوية داخلي:
--   • 10 دوال قرائية حسابية بحتة ⇒ SECURITY INVOKER (تعمل تحت RLS المستدعي؛
--     كل الجداول التي تقرؤها لديها سياسة SELECT عاملة — تحقق حي قبل التحويل)
--   • 17 دالة كتابية/حساسة ⇒ حارس عضوية داخلي، وorg يُشتق من السجل
--     المستهدف لا من معامل العميل حيثما أمكن
--   • upsert_stage_cost (ضخمة) ⇒ نمط الغلاف: النواة تُعاد تسميتها
--     upsert_stage_cost_core وتُسحب صلاحيتها، والغلاف يتحقق ثم يفوّض
--
-- إصلاحات وظيفية مرافقة (كانت الدوال معطلة بسياق app.* الميت الذي لا يضبطه
-- عميل Supabase — نفس جذر Migration 118):
--   • approve_journal_entry / batch_post_journal_entries /
--     reverse_journal_entry_enhanced: كانت تقرأ app.current_tenant_id (=NULL)
--     ⇒ الآن tenant يُشتق من صف القيد نفسه + بوابة admin
--   • get_account_statement: كانت تسقط للمؤسسة الافتراضية 000...001 عند غياب
--     السياق ⇒ الآن تشتق مؤسسة المستدعي من عضويته وترفض غير الأعضاء
--   • rpc_get_trial_balance: تقبل p_tenant NULL (تشتق من العضوية) وترفض
--     أي p_tenant ليس المستدعي عضواً فيه
--   • approve_journal_entry: السطر (check_entry_approval_required(..)->>'..')
--     كان خطأ نوعياً (الدالة ترجع boolean لا json) ⇒ استُبدل بعدّ سجلات
--     الاعتماد المعرّفة للقيد
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) الحارسان المعياريان (داخليان — لا EXECUTE للعملاء)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wardah_assert_org_member(p_org uuid)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED';
    END IF;
    IF p_org IS NULL THEN
        RAISE EXCEPTION 'ORG_UNRESOLVED';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.user_organizations
        WHERE user_id = auth.uid()
          AND org_id = p_org
          AND COALESCE(is_active, TRUE)
    ) THEN
        RAISE EXCEPTION 'NOT_ORG_MEMBER';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.wardah_assert_org_admin(p_org uuid)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.wardah_assert_org_member(p_org);
    IF NOT (COALESCE(public.is_super_admin(), FALSE)
            OR public.wardah_is_org_admin(p_org)) THEN
        RAISE EXCEPTION 'NOT_ORG_ADMIN';
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.wardah_assert_org_member(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wardah_assert_org_admin(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1) القرائية الحسابية ⇒ SECURITY INVOKER (تعمل تحت RLS المستدعي)
--    داخل دوال DEFINER الأخرى تُنفَّذ بهوية المالك فتتجاوز RLS كما قبل — لا كسر
-- ----------------------------------------------------------------------------

ALTER FUNCTION public.calculate_available_capacity(uuid, date, date) SECURITY INVOKER;
ALTER FUNCTION public.calculate_planned_load(uuid, date, date) SECURITY INVOKER;
ALTER FUNCTION public.calculate_labor_variances(uuid, date, date) SECURITY INVOKER;
ALTER FUNCTION public.calculate_material_variances(uuid, date, date) SECURITY INVOKER;
ALTER FUNCTION public.calculate_routing_standard_cost(uuid, numeric) SECURITY INVOKER;
ALTER FUNCTION public.calculate_routing_total_time(uuid, numeric) SECURITY INVOKER;
ALTER FUNCTION public.get_labor_efficiency_summary(uuid, date, date, uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_oee_summary(uuid, date, date, uuid) SECURITY INVOKER;
ALTER FUNCTION public.identify_bottlenecks(uuid, date, date) SECURITY INVOKER;
ALTER FUNCTION public.check_entry_approval_required(uuid) SECURITY INVOKER;

-- ----------------------------------------------------------------------------
-- 2) المحاسبة — القيود القديمة (journal_entries): اشتقاق tenant من صف القيد
--    + بوابة admin (كان السياق app.current_tenant_id ميتاً = NULL)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_journal_entry(p_entry_id uuid, p_approval_level integer, p_comments text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_approval RECORD;
    v_tenant_id UUID;
    v_user_id UUID;
    v_required_levels INTEGER;
    v_approved_levels INTEGER;
BEGIN
    -- [120] اشتقاق tenant من القيد نفسه + بوابة admin (بدل app.* الميت)
    SELECT tenant_id INTO v_tenant_id FROM journal_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Entry not found'
        );
    END IF;
    PERFORM public.wardah_assert_org_admin(v_tenant_id);
    v_user_id := auth.uid();

    -- Check if approval exists
    SELECT * INTO v_approval
    FROM journal_entry_approvals
    WHERE entry_id = p_entry_id
    AND approval_level = p_approval_level
    AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Approval record not found'
        );
    END IF;

    IF v_approval.status != 'pending' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Approval already processed'
        );
    END IF;

    -- Update approval
    UPDATE journal_entry_approvals SET
        status = 'approved',
        comments = p_comments,
        approved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_approval.id;

    -- [120] المطلوب = عدد سجلات الاعتماد المعرّفة للقيد (السطر السابق كان
    -- يطبّق ->> على boolean — خطأ نوعي كان سيفشل وقت التشغيل)
    SELECT COUNT(*) INTO v_required_levels
    FROM journal_entry_approvals
    WHERE entry_id = p_entry_id AND tenant_id = v_tenant_id;
    SELECT COUNT(*) INTO v_approved_levels
    FROM journal_entry_approvals
    WHERE entry_id = p_entry_id AND status = 'approved';

    RETURN json_build_object(
        'success', true,
        'message', 'Entry approved at level ' || p_approval_level,
        'approved_levels', v_approved_levels,
        'required_levels', v_required_levels,
        'can_post', v_approved_levels >= v_required_levels
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.batch_post_journal_entries(p_entry_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_entry_id UUID;
    v_result JSON;
    v_success_count INTEGER := 0;
    v_fail_count INTEGER := 0;
    v_results JSONB := '[]'::JSONB;
    v_entry_result JSON;
    v_tenant_id UUID;
    v_org UUID;
BEGIN
    IF p_entry_ids IS NULL OR array_length(p_entry_ids, 1) IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'No entries provided'
        );
    END IF;

    -- [120] حارس: كل قيد في الدفعة يجب أن ينتمي لمؤسسة المستدعي (admin)
    IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = ANY(p_entry_ids)) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Entries not found'
        );
    END IF;
    FOR v_org IN SELECT DISTINCT tenant_id FROM journal_entries WHERE id = ANY(p_entry_ids)
    LOOP
        IF v_org IS NULL THEN
            RAISE EXCEPTION 'ORG_UNRESOLVED';
        END IF;
        PERFORM public.wardah_assert_org_admin(v_org);
    END LOOP;
    SELECT tenant_id INTO v_tenant_id FROM journal_entries WHERE id = ANY(p_entry_ids) LIMIT 1;

    -- Process each entry
    FOREACH v_entry_id IN ARRAY p_entry_ids
    LOOP
        BEGIN
            -- Try to post the entry
            SELECT post_journal_entry(v_entry_id) INTO v_entry_result;

            IF (v_entry_result->>'success')::BOOLEAN THEN
                v_success_count := v_success_count + 1;
                v_results := v_results || jsonb_build_object(
                    'entry_id', v_entry_id,
                    'success', true,
                    'message', v_entry_result->>'message'
                );
            ELSE
                v_fail_count := v_fail_count + 1;
                v_results := v_results || jsonb_build_object(
                    'entry_id', v_entry_id,
                    'success', false,
                    'error', v_entry_result->>'error'
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_fail_count := v_fail_count + 1;
            v_results := v_results || jsonb_build_object(
                'entry_id', v_entry_id,
                'success', false,
                'error', SQLERRM
            );
        END;
    END LOOP;

    -- Return summary
    RETURN json_build_object(
        'success', v_fail_count = 0,
        'total', array_length(p_entry_ids, 1),
        'success_count', v_success_count,
        'fail_count', v_fail_count,
        'results', v_results
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_journal_entry_enhanced(p_entry_id uuid, p_reversal_reason text DEFAULT NULL::text, p_reversal_date date DEFAULT CURRENT_DATE)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_original_entry RECORD;
    v_reversal_entry_id UUID;
    v_reversal_number TEXT;
    v_line RECORD;
    v_tenant_id UUID;
    v_result JSON;
BEGIN
    -- Get original entry
    SELECT * INTO v_original_entry
    FROM journal_entries
    WHERE id = p_entry_id;

    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Original entry not found'
        );
    END IF;

    -- [120] tenant من صف القيد + بوابة admin (بدل app.current_tenant_id الميت)
    v_tenant_id := v_original_entry.tenant_id;
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'ORG_UNRESOLVED';
    END IF;
    PERFORM public.wardah_assert_org_admin(v_tenant_id);

    IF v_original_entry.status != 'posted' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Can only reverse posted entries'
        );
    END IF;

    IF v_original_entry.reversed_by_entry_id IS NOT NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Entry already reversed'
        );
    END IF;

    -- Generate reversal entry
    v_reversal_entry_id := gen_random_uuid();
    v_reversal_number := generate_entry_number_enhanced(v_original_entry.journal_id, p_reversal_date);

    -- Create reversal entry ([120] المستخدم من auth.uid() بدل app.current_user_id الميت)
    INSERT INTO journal_entries (
        id, journal_id, entry_number, entry_date, posting_date,
        reference_type, reference_id, reference_number,
        description, description_ar,
        status, posted_at, posted_by,
        total_debit, total_credit,
        reversed_by_entry_id, reversal_reason,
        tenant_id, created_by, updated_by
    ) VALUES (
        v_reversal_entry_id,
        v_original_entry.journal_id,
        v_reversal_number,
        p_reversal_date,
        p_reversal_date,
        'reversal',
        p_entry_id,
        'REV-' || v_original_entry.entry_number,
        COALESCE('Reversal: ' || v_original_entry.description, 'Reversal Entry'),
        COALESCE('عكس: ' || v_original_entry.description_ar, 'عكس قيد'),
        'posted',
        CURRENT_TIMESTAMP,
        auth.uid(),
        v_original_entry.total_credit, -- Swap totals
        v_original_entry.total_debit,  -- Swap totals
        NULL,
        p_reversal_reason,
        v_tenant_id,
        auth.uid(),
        auth.uid()
    );

    -- Create reversal lines (swap debit/credit)
    FOR v_line IN
        SELECT * FROM journal_lines
        WHERE entry_id = p_entry_id
        ORDER BY line_number
    LOOP
        INSERT INTO journal_lines (
            entry_id, line_number, account_id,
            cost_center_id, partner_id, product_id, project_id,
            debit, credit, currency_code,
            description, description_ar,
            tenant_id
        ) VALUES (
            v_reversal_entry_id,
            v_line.line_number,
            v_line.account_id,
            v_line.cost_center_id,
            v_line.partner_id,
            v_line.product_id,
            v_line.project_id,
            v_line.credit, -- Swap
            v_line.debit,  -- Swap
            v_line.currency_code,
            'REV: ' || COALESCE(v_line.description, ''),
            'عكس: ' || COALESCE(v_line.description_ar, ''),
            v_tenant_id
        );
    END LOOP;

    -- Update original entry
    UPDATE journal_entries SET
        status = 'reversed',
        reversed_by_entry_id = v_reversal_entry_id,
        reversal_reason = p_reversal_reason,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_entry_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Entry reversed successfully',
        'original_entry_id', p_entry_id,
        'reversal_entry_id', v_reversal_entry_id,
        'reversal_number', v_reversal_number
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3) المحاسبة — GL الحي: اشتقاق مؤسسة المستدعي من عضويته + رفض غير الأعضاء
-- ----------------------------------------------------------------------------

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
        FROM gl_entry_lines
        WHERE account_code = p_account_code
        AND entry_id IN (
            SELECT id FROM gl_entries
            WHERE org_id = v_org_id
            AND entry_date < p_from_date
            AND status = 'POSTED'
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

CREATE OR REPLACE FUNCTION public.rpc_get_trial_balance(p_tenant uuid, p_as_of_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(account_code text, account_name text, account_name_ar text, account_type text, opening_debit numeric, opening_credit numeric, period_debit numeric, period_credit numeric, closing_debit numeric, closing_credit numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_org UUID;
BEGIN
    -- [120] حارس: p_tenant يجب أن يكون مؤسسة المستدعي؛ NULL ⇒ اشتقاق من العضوية
    v_org := p_tenant;
    IF v_org IS NULL AND auth.uid() IS NOT NULL THEN
        SELECT org_id INTO v_org
        FROM user_organizations
        WHERE user_id = auth.uid() AND COALESCE(is_active, TRUE)
        ORDER BY joined_at NULLS LAST
        LIMIT 1;
    END IF;
    PERFORM public.wardah_assert_org_member(v_org);

    RETURN QUERY
    WITH account_movements AS (
        SELECT
            ga.id as account_id,
            ga.code,
            ga.name,
            ga.name_en,
            ga.category,
            COALESCE(SUM(CASE WHEN je.status = 'posted' THEN jl.debit ELSE 0 END), 0) as total_debit,
            COALESCE(SUM(CASE WHEN je.status = 'posted' THEN jl.credit ELSE 0 END), 0) as total_credit
        FROM gl_accounts ga
        LEFT JOIN journal_lines jl ON ga.id = jl.account_id
        LEFT JOIN journal_entries je ON jl.entry_id = je.id
            AND je.status = 'posted'
            AND COALESCE(je.posting_date, je.entry_date) <= p_as_of_date
        WHERE ga.allow_posting = true
            AND ga.is_active = true
            AND (ga.org_id = v_org OR ga.org_id IS NULL)
        GROUP BY ga.id, ga.code, ga.name, ga.name_en, ga.category
    )
    SELECT
        am.code::TEXT,
        am.name::TEXT,
        COALESCE(am.name_en, am.name)::TEXT as account_name_ar,
        am.category::TEXT as account_type,
        0::NUMERIC(18,4) as opening_debit,
        0::NUMERIC(18,4) as opening_credit,
        am.total_debit::NUMERIC(18,4) as period_debit,
        am.total_credit::NUMERIC(18,4) as period_credit,
        CASE
            WHEN am.total_debit > am.total_credit
            THEN (am.total_debit - am.total_credit)::NUMERIC(18,4)
            ELSE 0::NUMERIC(18,4)
        END as closing_debit,
        CASE
            WHEN am.total_credit > am.total_debit
            THEN (am.total_credit - am.total_debit)::NUMERIC(18,4)
            ELSE 0::NUMERIC(18,4)
        END as closing_credit
    FROM account_movements am
    WHERE am.total_debit > 0 OR am.total_credit > 0
    ORDER BY am.code;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4) الأدوار: بوابة admin على p_org_id + تجاهل p_created_by القادم من العميل
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_role_from_template(p_org_id uuid, p_template_id uuid, p_custom_name character varying DEFAULT NULL::character varying, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_template role_templates%ROWTYPE;
    v_new_role_id UUID;
    v_perm_key TEXT;
BEGIN
    -- [120] بوابة admin على المؤسسة الهدف؛ p_created_by يُتجاهل (تصعيد محتمل)
    PERFORM public.wardah_assert_org_admin(p_org_id);

    -- جلب القالب
    SELECT * INTO v_template FROM role_templates WHERE id = p_template_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template not found';
    END IF;

    -- إنشاء الدور
    INSERT INTO roles (org_id, name, name_ar, description_ar, created_by)
    VALUES (
        p_org_id,
        COALESCE(p_custom_name, v_template.name),
        v_template.name_ar,
        v_template.description_ar,
        auth.uid()
    )
    RETURNING id INTO v_new_role_id;

    -- إضافة الصلاحيات
    FOREACH v_perm_key IN ARRAY v_template.permission_keys
    LOOP
        INSERT INTO role_permissions (role_id, permission_id, created_by)
        SELECT v_new_role_id, p.id, auth.uid()
        FROM permissions p
        WHERE p.permission_key LIKE REPLACE(v_perm_key, '%', '%%')
           OR p.permission_key LIKE v_perm_key
        ON CONFLICT DO NOTHING;
    END LOOP;

    RETURN v_new_role_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5) التصنيع (MES): الحارس بعد جلب السجل المستهدف — org من السجل لا من العميل
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_manufacturing_order(p_mo_id uuid)
 RETURNS manufacturing_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_mo manufacturing_orders;
    v_org UUID;
BEGIN
    -- [120] حارس عضوية على مؤسسة أمر التصنيع
    SELECT org_id INTO v_org FROM manufacturing_orders WHERE id = p_mo_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing order not found or invalid status';
    END IF;
    PERFORM public.wardah_assert_org_member(v_org);

    -- تحديث حالة أمر التصنيع لـ RELEASED
    UPDATE manufacturing_orders SET
        status = 'RELEASED',
        start_date = COALESCE(start_date, CURRENT_DATE),
        updated_at = NOW()
    WHERE id = p_mo_id
    AND status IN ('PENDING', 'PLANNED')
    RETURNING * INTO v_mo;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing order not found or invalid status';
    END IF;

    RETURN v_mo;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_operation(p_work_order_id uuid, p_operator_id uuid DEFAULT NULL::uuid, p_is_setup boolean DEFAULT true)
 RETURNS work_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_work_order work_orders;
    v_event_type VARCHAR;
BEGIN
    -- التحقق من حالة أمر العمل
    SELECT * INTO v_work_order FROM work_orders WHERE id = p_work_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order not found: %', p_work_order_id;
    END IF;

    -- [120] حارس عضوية على مؤسسة أمر العمل
    PERFORM public.wardah_assert_org_member(v_work_order.org_id);

    IF v_work_order.status NOT IN ('PENDING', 'READY', 'ON_HOLD') THEN
        RAISE EXCEPTION 'Work order cannot be started. Current status: %', v_work_order.status;
    END IF;

    -- تحديد نوع الحدث
    IF p_is_setup THEN
        v_event_type := 'SETUP_START';
    ELSE
        v_event_type := 'PRODUCTION_START';
    END IF;

    -- تحديث أمر العمل
    UPDATE work_orders SET
        status = CASE WHEN p_is_setup THEN 'IN_SETUP' ELSE 'IN_PROGRESS' END,
        actual_start_date = COALESCE(actual_start_date, NOW()),
        current_operator_id = COALESCE(p_operator_id, auth.uid()),
        updated_at = NOW()
    WHERE id = p_work_order_id
    RETURNING * INTO v_work_order;

    -- تسجيل الحدث
    INSERT INTO operation_execution_logs (
        org_id, work_order_id, event_type, operator_id, event_timestamp
    ) VALUES (
        v_work_order.org_id, p_work_order_id, v_event_type,
        COALESCE(p_operator_id, auth.uid()), NOW()
    );

    -- بدء تسجيل الوقت
    INSERT INTO labor_time_tracking (
        org_id, work_order_id, employee_id, labor_type, clock_in, status
    ) VALUES (
        v_work_order.org_id, p_work_order_id, COALESCE(p_operator_id, auth.uid()),
        CASE WHEN p_is_setup THEN 'SETUP' ELSE 'DIRECT' END, NOW(), 'ACTIVE'
    );

    RETURN v_work_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_operation(p_work_order_id uuid, p_quantity_produced numeric, p_quantity_scrapped numeric DEFAULT 0, p_notes text DEFAULT NULL::text)
 RETURNS work_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_work_order work_orders;
    v_labor_tracking labor_time_tracking;
    v_duration DECIMAL;
BEGIN
    -- الحصول على أمر العمل
    SELECT * INTO v_work_order FROM work_orders WHERE id = p_work_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order not found: %', p_work_order_id;
    END IF;

    -- [120] حارس عضوية على مؤسسة أمر العمل
    PERFORM public.wardah_assert_org_member(v_work_order.org_id);

    -- إغلاق تسجيل الوقت
    UPDATE labor_time_tracking SET
        clock_out = NOW(),
        total_minutes = EXTRACT(EPOCH FROM (NOW() - clock_in)) / 60,
        billable_minutes = EXTRACT(EPOCH FROM (NOW() - clock_in)) / 60 - break_minutes,
        status = 'COMPLETED',
        updated_at = NOW()
    WHERE work_order_id = p_work_order_id AND status = 'ACTIVE'
    RETURNING * INTO v_labor_tracking;

    -- حساب الوقت الفعلي
    IF v_labor_tracking.labor_type = 'SETUP' THEN
        v_duration := COALESCE(v_labor_tracking.billable_minutes, 0);
        UPDATE work_orders SET
            actual_setup_time = actual_setup_time + v_duration
        WHERE id = p_work_order_id;
    ELSE
        v_duration := COALESCE(v_labor_tracking.billable_minutes, 0);
        UPDATE work_orders SET
            actual_run_time = actual_run_time + v_duration
        WHERE id = p_work_order_id;
    END IF;

    -- تحديث أمر العمل
    UPDATE work_orders SET
        completed_quantity = completed_quantity + p_quantity_produced,
        scrapped_quantity = scrapped_quantity + p_quantity_scrapped,
        status = CASE
            WHEN (completed_quantity + p_quantity_produced + scrapped_quantity + p_quantity_scrapped) >= planned_quantity
            THEN 'COMPLETED'
            ELSE status
        END,
        actual_end_date = CASE
            WHEN (completed_quantity + p_quantity_produced + scrapped_quantity + p_quantity_scrapped) >= planned_quantity
            THEN NOW()
            ELSE actual_end_date
        END,
        notes = COALESCE(notes || E'\n', '') || COALESCE(p_notes, ''),
        updated_at = NOW()
    WHERE id = p_work_order_id
    RETURNING * INTO v_work_order;

    -- تسجيل الحدث
    INSERT INTO operation_execution_logs (
        org_id, work_order_id, event_type, operator_id,
        quantity_produced, quantity_scrapped, notes, event_timestamp
    ) VALUES (
        v_work_order.org_id, p_work_order_id, 'PRODUCTION_END', v_work_order.current_operator_id,
        p_quantity_produced, p_quantity_scrapped, p_notes, NOW()
    );

    RETURN v_work_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backflush_materials(p_work_order_id uuid, p_quantity_produced numeric)
 RETURNS SETOF material_consumption
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_work_order RECORD;
    v_mo RECORD;
    v_bom_line RECORD;
BEGIN
    -- الحصول على أمر العمل وأمر التصنيع
    SELECT wo.*, mo.bom_id, mo.org_id as mo_org_id
    INTO v_work_order
    FROM work_orders wo
    JOIN manufacturing_orders mo ON wo.mo_id = mo.id
    WHERE wo.id = p_work_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order not found: %', p_work_order_id;
    END IF;

    -- [120] حارس عضوية على مؤسسة أمر التصنيع
    PERFORM public.wardah_assert_org_member(v_work_order.mo_org_id);

    -- استهلاك المواد بناءً على BOM
    FOR v_bom_line IN
        SELECT bl.*, i.name as item_name
        FROM bom_lines bl
        JOIN items i ON bl.item_id = i.id
        WHERE bl.bom_id = v_work_order.bom_id
        AND bl.item_type IN ('RAW_MATERIAL', 'COMPONENT')
    LOOP
        RETURN QUERY
        INSERT INTO material_consumption (
            org_id, work_order_id, mo_id, item_id,
            planned_quantity, consumed_quantity, consumption_type,
            unit_cost, total_cost, status, consumption_date, created_by
        ) VALUES (
            v_work_order.mo_org_id, p_work_order_id, v_work_order.mo_id, v_bom_line.item_id,
            v_bom_line.quantity * (v_work_order.planned_quantity),
            v_bom_line.quantity * p_quantity_produced,
            'BACKFLUSH',
            v_bom_line.unit_cost,
            v_bom_line.unit_cost * v_bom_line.quantity * p_quantity_produced,
            'PENDING', NOW(), auth.uid()
        )
        RETURNING *;
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_work_orders_from_mo(p_mo_id uuid)
 RETURNS SETOF work_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_mo RECORD;
    v_operation RECORD;
    v_work_order_number VARCHAR;
    v_sequence INTEGER := 0;
BEGIN
    -- الحصول على معلومات أمر التصنيع
    SELECT * INTO v_mo FROM manufacturing_orders WHERE id = p_mo_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing order not found: %', p_mo_id;
    END IF;

    -- [120] حارس عضوية على مؤسسة أمر التصنيع
    PERFORM public.wardah_assert_org_member(v_mo.org_id);

    -- إنشاء أوامر عمل لكل عملية في المسار
    FOR v_operation IN
        SELECT ro.*, wc.name as work_center_name, wc.name_ar as work_center_name_ar
        FROM routing_operations ro
        JOIN work_centers wc ON ro.work_center_id = wc.id
        WHERE ro.routing_id = v_mo.routing_id
        AND ro.is_active = true
        ORDER BY ro.operation_sequence
    LOOP
        v_sequence := v_sequence + 1;
        v_work_order_number := v_mo.order_number || '-' || LPAD(v_sequence::TEXT, 3, '0');

        RETURN QUERY
        INSERT INTO work_orders (
            org_id, mo_id, operation_id, work_center_id,
            work_order_number, operation_sequence, operation_name, operation_name_ar,
            planned_quantity, planned_setup_time, planned_run_time,
            status, created_by
        ) VALUES (
            v_mo.org_id, p_mo_id, v_operation.id, v_operation.work_center_id,
            v_work_order_number, v_operation.operation_sequence,
            v_operation.operation_name, v_operation.operation_name_ar,
            v_mo.quantity, v_operation.standard_setup_time,
            v_operation.standard_run_time_per_unit * v_mo.quantity,
            'PENDING', auth.uid()
        )
        RETURNING *;
    END LOOP;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6) المسارات والجدولة والطاقة
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_routing_to_mo(p_mo_id uuid, p_routing_id uuid)
 RETURNS manufacturing_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_mo manufacturing_orders;
    v_org UUID;
BEGIN
    -- [120] حارس عضوية على مؤسسة أمر التصنيع
    SELECT org_id INTO v_org FROM manufacturing_orders WHERE id = p_mo_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing order not found: %', p_mo_id;
    END IF;
    PERFORM public.wardah_assert_org_member(v_org);

    -- التحقق من صلاحية المسار ([120] + انتماؤه لنفس المؤسسة)
    IF NOT EXISTS (
        SELECT 1 FROM routings
        WHERE id = p_routing_id
        AND org_id = v_org
        AND status = 'APPROVED'
        AND is_active = true
    ) THEN
        RAISE EXCEPTION 'Routing must be approved and active';
    END IF;

    -- تحديث أمر التصنيع
    UPDATE manufacturing_orders SET
        routing_id = p_routing_id,
        updated_at = NOW()
    WHERE id = p_mo_id
    RETURNING * INTO v_mo;

    RETURN v_mo;
END;
$function$;

CREATE OR REPLACE FUNCTION public.copy_routing(p_routing_id uuid, p_new_code character varying, p_new_version integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_new_routing_id UUID;
    v_org_id UUID;
BEGIN
    -- الحصول على org_id من المسار الأصلي
    SELECT org_id INTO v_org_id FROM routings WHERE id = p_routing_id;

    -- [120] حارس عضوية على مؤسسة المسار
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Routing not found: %', p_routing_id;
    END IF;
    PERFORM public.wardah_assert_org_member(v_org_id);

    -- إنشاء المسار الجديد
    INSERT INTO routings (
        org_id, routing_code, routing_name, routing_name_ar,
        description, description_ar, version, status, item_id,
        effective_date, created_by
    )
    SELECT
        org_id, p_new_code, routing_name || ' (Copy)', routing_name_ar,
        description, description_ar, p_new_version, 'DRAFT', item_id,
        CURRENT_DATE, auth.uid()
    FROM routings
    WHERE id = p_routing_id
    RETURNING id INTO v_new_routing_id;

    -- نسخ العمليات
    INSERT INTO routing_operations (
        org_id, routing_id, operation_sequence, operation_code,
        operation_name, operation_name_ar, description, work_center_id,
        standard_setup_time, standard_run_time_per_unit, standard_queue_time,
        standard_move_time, time_unit, labor_rate_per_hour, overhead_rate_per_hour,
        operation_type, is_outsourced, requires_inspection
    )
    SELECT
        org_id, v_new_routing_id, operation_sequence, operation_code,
        operation_name, operation_name_ar, description, work_center_id,
        standard_setup_time, standard_run_time_per_unit, standard_queue_time,
        standard_move_time, time_unit, labor_rate_per_hour, overhead_rate_per_hour,
        operation_type, is_outsourced, requires_inspection
    FROM routing_operations
    WHERE routing_id = p_routing_id;

    -- نسخ الموارد
    INSERT INTO operation_resources (
        org_id, operation_id, resource_type, resource_code,
        resource_name, quantity_required, unit_of_measure, cost_rate, notes
    )
    SELECT
        orr.org_id,
        (SELECT nro.id FROM routing_operations nro
         WHERE nro.routing_id = v_new_routing_id
         AND nro.operation_sequence = ro.operation_sequence),
        orr.resource_type, orr.resource_code, orr.resource_name,
        orr.quantity_required, orr.unit_of_measure, orr.cost_rate, orr.notes
    FROM operation_resources orr
    JOIN routing_operations ro ON orr.operation_id = ro.id
    WHERE ro.routing_id = p_routing_id;

    RETURN v_new_routing_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.schedule_work_order(p_work_order_id uuid, p_scheduled_start timestamp with time zone, p_schedule_id uuid DEFAULT NULL::uuid)
 RETURNS schedule_details
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_work_order work_orders;
    v_scheduled_end TIMESTAMP WITH TIME ZONE;
    v_result schedule_details;
    v_sequence INTEGER;
BEGIN
    -- الحصول على أمر العمل
    SELECT * INTO v_work_order FROM work_orders WHERE id = p_work_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order not found: %', p_work_order_id;
    END IF;

    -- [120] حارس عضوية على مؤسسة أمر العمل
    PERFORM public.wardah_assert_org_member(v_work_order.org_id);

    -- حساب وقت الانتهاء المتوقع
    v_scheduled_end := p_scheduled_start +
        ((v_work_order.planned_setup_time + v_work_order.planned_run_time) * INTERVAL '1 minute');

    -- تحديث أمر العمل
    UPDATE work_orders SET
        planned_start_date = p_scheduled_start,
        planned_end_date = v_scheduled_end,
        updated_at = NOW()
    WHERE id = p_work_order_id;

    -- إذا تم تحديد جدول
    IF p_schedule_id IS NOT NULL THEN
        -- الحصول على التسلسل التالي
        SELECT COALESCE(MAX(schedule_sequence), 0) + 1 INTO v_sequence
        FROM schedule_details WHERE schedule_id = p_schedule_id;

        -- إدراج تفاصيل الجدولة
        INSERT INTO schedule_details (
            org_id, schedule_id, work_order_id, schedule_sequence,
            scheduled_start, scheduled_end, priority, schedule_status
        ) VALUES (
            v_work_order.org_id, p_schedule_id, p_work_order_id, v_sequence,
            p_scheduled_start, v_scheduled_end, v_work_order.priority, 'SCHEDULED'
        )
        ON CONFLICT (schedule_id, work_order_id)
        DO UPDATE SET
            scheduled_start = EXCLUDED.scheduled_start,
            scheduled_end = EXCLUDED.scheduled_end,
            updated_at = NOW()
        RETURNING * INTO v_result;

        RETURN v_result;
    END IF;

    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_schedule_work_orders(p_work_center_id uuid, p_start_date timestamp with time zone, p_schedule_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_work_order RECORD;
    v_current_time TIMESTAMP WITH TIME ZONE := p_start_date;
    v_scheduled_count INTEGER := 0;
    v_daily_capacity DECIMAL;
    v_daily_used DECIMAL := 0;
    v_current_date DATE := p_start_date::DATE;
    v_org UUID;
BEGIN
    -- [120] حارس عضوية على مؤسسة مركز العمل
    SELECT org_id INTO v_org FROM work_centers WHERE id = p_work_center_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work center not found: %', p_work_center_id;
    END IF;
    PERFORM public.wardah_assert_org_member(v_org);

    -- الحصول على الطاقة اليومية
    SELECT capacity_hours_per_day * 60 INTO v_daily_capacity -- بالدقائق
    FROM work_centers WHERE id = p_work_center_id;

    -- جدولة أوامر العمل حسب الأولوية وتاريخ الاستحقاق
    FOR v_work_order IN
        SELECT wo.*
        FROM work_orders wo
        JOIN manufacturing_orders mo ON wo.mo_id = mo.id
        WHERE wo.work_center_id = p_work_center_id
        AND wo.status IN ('PENDING', 'READY')
        ORDER BY wo.priority ASC, mo.due_date ASC NULLS LAST, wo.created_at ASC
    LOOP
        -- التحقق من الطاقة المتبقية لليوم
        IF v_daily_used + (v_work_order.planned_setup_time + v_work_order.planned_run_time) > v_daily_capacity THEN
            -- الانتقال لليوم التالي
            v_current_date := v_current_date + 1;
            v_current_time := v_current_date::TIMESTAMP WITH TIME ZONE + INTERVAL '8 hours'; -- بداية اليوم
            v_daily_used := 0;
        END IF;

        -- جدولة أمر العمل
        PERFORM schedule_work_order(v_work_order.id, v_current_time, p_schedule_id);

        -- تحديث الوقت الحالي والطاقة المستخدمة
        v_current_time := v_current_time +
            ((v_work_order.planned_setup_time + v_work_order.planned_run_time) * INTERVAL '1 minute');
        v_daily_used := v_daily_used + (v_work_order.planned_setup_time + v_work_order.planned_run_time);
        v_scheduled_count := v_scheduled_count + 1;
    END LOOP;

    RETURN v_scheduled_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_work_center_load(p_work_center_id uuid, p_start_date date, p_end_date date)
 RETURNS work_center_load
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_org_id UUID;
    v_capacity RECORD;
    v_load RECORD;
    v_result work_center_load;
BEGIN
    -- الحصول على org_id
    SELECT org_id INTO v_org_id FROM work_centers WHERE id = p_work_center_id;

    -- [120] حارس عضوية على مؤسسة مركز العمل
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Work center not found: %', p_work_center_id;
    END IF;
    PERFORM public.wardah_assert_org_member(v_org_id);

    -- حساب الطاقة المتاحة
    SELECT * INTO v_capacity FROM calculate_available_capacity(p_work_center_id, p_start_date, p_end_date);

    -- حساب الحمل المخطط
    SELECT * INTO v_load FROM calculate_planned_load(p_work_center_id, p_start_date, p_end_date);

    -- إدراج أو تحديث السجل
    INSERT INTO work_center_load (
        org_id, work_center_id, period_start, period_end,
        available_capacity_hours, planned_load_hours,
        utilization_pct, planned_work_orders, status, calculated_at
    ) VALUES (
        v_org_id, p_work_center_id, p_start_date, p_end_date,
        v_capacity.total_available_hours, v_load.total_planned_hours,
        CASE
            WHEN v_capacity.total_available_hours > 0
            THEN ROUND((v_load.total_planned_hours / v_capacity.total_available_hours * 100)::NUMERIC, 2)
            ELSE 0
        END,
        v_load.total_work_orders, 'PLANNED', NOW()
    )
    ON CONFLICT (work_center_id, period_start, period_end)
    DO UPDATE SET
        available_capacity_hours = EXCLUDED.available_capacity_hours,
        planned_load_hours = EXCLUDED.planned_load_hours,
        utilization_pct = EXCLUDED.utilization_pct,
        planned_work_orders = EXCLUDED.planned_work_orders,
        calculated_at = NOW(),
        updated_at = NOW()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 7) generate_entry_number(uuid): حارس عضوية على مؤسسة الدفتر
--    (النسخة الثانية generate_entry_number(uuid,date) ليست SECURITY DEFINER)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_entry_number(p_journal_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_prefix VARCHAR(10);
    v_sequence_name TEXT;
    v_next_number INTEGER;
    v_entry_number TEXT;
    v_org_id UUID;
BEGIN
    -- الحصول على معلومات الدفتر
    SELECT sequence_prefix, org_id INTO v_prefix, v_org_id
    FROM journals
    WHERE id = p_journal_id;

    IF v_prefix IS NULL THEN
        RAISE EXCEPTION 'Journal not found: %', p_journal_id;
    END IF;

    -- [120] حارس عضوية على مؤسسة الدفتر
    PERFORM public.wardah_assert_org_member(v_org_id);

    -- إنشاء اسم تسلسل فريد لكل دفتر
    -- استخدام أسماء أبسط للـ sequences
    v_sequence_name := 'seq_' || lower(v_prefix);

    -- إنشاء التسلسل إذا لم يكن موجوداً
    BEGIN
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I START WITH 1', v_sequence_name);
    EXCEPTION
        WHEN duplicate_table THEN
            -- التسلسل موجود بالفعل، لا مشكلة
            NULL;
        WHEN OTHERS THEN
            -- في حالة أي خطأ آخر، نحاول المتابعة
            RAISE NOTICE 'Could not create sequence %, continuing...', v_sequence_name;
    END;

    -- الحصول على الرقم التالي
    BEGIN
        EXECUTE format('SELECT nextval(%L)', v_sequence_name) INTO v_next_number;
    EXCEPTION WHEN OTHERS THEN
        -- إذا فشل، نستخدم رقم 1
        v_next_number := 1;
    END;

    -- تنسيق رقم القيد: PREFIX-YYYY-NNNNNN
    v_entry_number := v_prefix || '-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_number::text, 6, '0');

    RETURN v_entry_number;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 8) upsert_stage_cost (ضخمة): نمط الغلاف — النواة داخلية والغلاف يتحقق ثم يفوّض
-- ----------------------------------------------------------------------------

ALTER FUNCTION public.upsert_stage_cost(uuid, uuid, integer, uuid, numeric, numeric, text, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric)
    RENAME TO upsert_stage_cost_core;

REVOKE EXECUTE ON FUNCTION public.upsert_stage_cost_core(uuid, uuid, integer, uuid, numeric, numeric, text, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric)
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.upsert_stage_cost(
    p_tenant uuid,
    p_mo uuid,
    p_stage integer,
    p_wc uuid,
    p_good_qty numeric,
    p_dm numeric DEFAULT 0,
    p_mode text DEFAULT 'precosted'::text,
    p_scrap_qty numeric DEFAULT 0,
    p_rework_qty numeric DEFAULT 0,
    p_input_qty numeric DEFAULT NULL::numeric,
    p_notes text DEFAULT NULL::text,
    p_wip_end_qty numeric DEFAULT 0,
    p_wip_end_dm_completion_pct numeric DEFAULT 0,
    p_wip_end_cc_completion_pct numeric DEFAULT 0,
    p_regrind_cost numeric DEFAULT 0,
    p_waste_credit numeric DEFAULT 0,
    p_wip_beginning_qty numeric DEFAULT 0,
    p_wip_beginning_dm_completion_pct numeric DEFAULT 0,
    p_wip_beginning_cc_completion_pct numeric DEFAULT 0,
    p_wip_beginning_cost numeric DEFAULT 0
)
RETURNS TABLE(stage_id uuid, total_cost numeric, unit_cost numeric, transferred_in numeric, labor_cost numeric, overhead_cost numeric, eup numeric, normal_scrap_cost numeric, abnormal_scrap_cost numeric, costing_method text, wip_beginning_cost numeric, current_period_cost numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    -- [120] حارس عضوية على p_tenant قبل تفويض النواة (النواة تحتفظ بفحص
    -- get_current_tenant_id القديم — الغلاف يغلق ثغرة السقوط للمؤسسة الافتراضية)
    PERFORM public.wardah_assert_org_member(p_tenant);
    RETURN QUERY SELECT * FROM public.upsert_stage_cost_core(
        p_tenant, p_mo, p_stage, p_wc, p_good_qty, p_dm, p_mode,
        p_scrap_qty, p_rework_qty, p_input_qty, p_notes,
        p_wip_end_qty, p_wip_end_dm_completion_pct, p_wip_end_cc_completion_pct,
        p_regrind_cost, p_waste_credit,
        p_wip_beginning_qty, p_wip_beginning_dm_completion_pct,
        p_wip_beginning_cc_completion_pct, p_wip_beginning_cost
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.upsert_stage_cost(uuid, uuid, integer, uuid, numeric, numeric, text, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_stage_cost(uuid, uuid, integer, uuid, numeric, numeric, text, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric)
    TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9) تحقق ختامي — يفشل الـ migration كله إن بقيت دالة C بلا حارس
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    v_bad TEXT;
    v_count INTEGER;
BEGIN
    -- 9-1: الحارسان موجودان وغير متاحين للعملاء
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.proname = 'wardah_assert_org_member') THEN
        RAISE EXCEPTION 'FAIL[120-1] wardah_assert_org_member غير موجودة';
    END IF;
    IF has_function_privilege('authenticated', 'public.wardah_assert_org_member(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.wardah_assert_org_member(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL[120-2] الحارس متاح للعملاء';
    END IF;

    -- 9-2: النواة upsert_stage_cost_core مسحوبة من العملاء
    IF has_function_privilege('authenticated',
        'public.upsert_stage_cost_core(uuid,uuid,integer,uuid,numeric,numeric,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric)',
        'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL[120-3] upsert_stage_cost_core متاحة لـ authenticated';
    END IF;

    -- 9-3: صفر دوال SECURITY DEFINER متاحة لـ authenticated بلا علامة تحقق
    --      عضوية في الجسم. الاستثناءان الموثقان:
    --      rpc_get_invitation_preview (توكن bearer) و
    --      is_super_admin (ذاتية النطاق — تفحص صف المستدعي في super_admins فقط)
    SELECT string_agg(p.proname, ', '), COUNT(*)
    INTO v_bad, v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname NOT IN ('rpc_get_invitation_preview', 'is_super_admin')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.prosrc !~ '(user_organizations|wardah_is_org_admin|wardah_org_id|is_org_admin|is_super_admin|get_current_tenant_id|wardah_assert_org)';
    IF v_count > 0 THEN
        RAISE EXCEPTION 'FAIL[120-4] % دالة DEFINER بلا حارس: %', v_count, v_bad;
    END IF;

    -- 9-4: الدوال القرائية العشر تحولت إلى INVOKER
    SELECT COUNT(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname IN ('calculate_available_capacity','calculate_planned_load',
        'calculate_labor_variances','calculate_material_variances',
        'calculate_routing_standard_cost','calculate_routing_total_time',
        'get_labor_efficiency_summary','get_oee_summary','identify_bottlenecks',
        'check_entry_approval_required');
    IF v_count > 0 THEN
        RAISE EXCEPTION 'FAIL[120-5] % دالة قرائية ما زالت DEFINER', v_count;
    END IF;

    RAISE NOTICE 'PASS[120] كل فحوصات التحصين نجحت';
END $$;
