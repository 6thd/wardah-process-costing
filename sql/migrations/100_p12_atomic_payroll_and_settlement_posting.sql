-- ===================================================================
-- Migration 100: مسير رواتب وتسوية نهاية خدمة ذرّيان Fail-closed (P12-B)
-- ===================================================================
-- الفجوة (مؤكَّدة): payroll-engine.ts كان يرحّل GL بإدراج مباشر client-side في
-- gl_entries/gl_entry_lines متجاوزاً القناة القانونية rpc_create_journal_entry
-- (المفروضة منذ 76) — غير ذرّي (رأس بلا سطور ممكن)، بلا فحص عضوية خادمي، بلا
-- idempotency (إعادة المعالجة تكرّر القيود)، ولا يكتب payroll_details إطلاقاً
-- (لا قسائم رواتب). والتسويات لا تُرحَّل أصلاً.
--
-- الحل: دالتان بنمط 93/95 الحرفي (SECURITY DEFINER + wardah_org_id + عضوية +
-- قفل استشاري + idempotency ببصمة حمولة) تجعلان: سطور المسير + القيد عبر
-- rpc_create_journal_entry + القفل = معاملة واحدة. أي فشل ⇒ إجهاض كامل.
--
-- تصميم القيد المحاسبي للمسير (حسابات كلها من hr_payroll_account_mappings —
-- قرار المالك: قابلة للاختيار من ضبط الرواتب):
--   مدين : basic_salary + housing_allowance + transport_allowance +
--          other_allowance + overtime + gosi_employer_expense
--   دائن : gosi_payable (حصتا الموظف وصاحب العمل) + deductions + loans +
--          absence_recovery (استرداد غياب) + payable (الصافي)
-- التوازن يتحقق داخل الدالة؛ أي bucket غير صفري بلا خريطة ⇒ MAPPING_MISSING.
-- ===================================================================

-- 0) أعمدة إضافية لازمة (إضافي 100%)
ALTER TABLE payroll_details ALTER COLUMN component_id DROP NOT NULL;
ALTER TABLE payroll_details ADD COLUMN IF NOT EXISTS component_code  TEXT;
ALTER TABLE payroll_details ADD COLUMN IF NOT EXISTS component_label TEXT;
ALTER TABLE payroll_details ADD COLUMN IF NOT EXISTS is_deduction    BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE hr_settlements ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES gl_entries(id);
ALTER TABLE hr_settlements ADD COLUMN IF NOT EXISTS idempotency_key  TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_settlements_idem
    ON hr_settlements (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ===================================================================
-- 1) rpc_post_payroll_run — اعتماد مسير شهر ذرّياً
-- ===================================================================
CREATE OR REPLACE FUNCTION public.rpc_post_payroll_run(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org        UUID;
    v_year       INT;
    v_month      INT;
    v_idem       TEXT;
    v_hash       TEXT;
    v_period_id  UUID;
    v_run_id     UUID;
    v_existing   payroll_runs%ROWTYPE;
    v_totals     JSONB;
    v_entry_date DATE;
    v_gl_lines   JSONB := '[]'::JSONB;
    v_line_no    INT := 0;
    v_debits     NUMERIC := 0;
    v_credits    NUMERIC := 0;
    v_journal    JSONB;
    v_amount     NUMERIC;
    v_acct       UUID;
    v_bucket     TEXT;
    -- ترتيب حتمي: المدينون ثم الدائنون
    c_debit_buckets  TEXT[] := ARRAY['basic_salary','housing_allowance',
        'transport_allowance','other_allowance','overtime','gosi_employer_expense'];
    c_credit_buckets TEXT[] := ARRAY['gosi_payable','deductions','loans',
        'absence_recovery','payable'];
BEGIN
    -- عضوية + اشتقاق org (نمط 93/95)
    v_org := wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
    IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM user_organizations
                   WHERE user_id = auth.uid() AND org_id = v_org) THEN
        RAISE EXCEPTION 'NOT_ORG_MEMBER';
    END IF;

    v_year  := (p_payload->>'year')::int;
    v_month := (p_payload->>'month')::int;
    v_idem  := NULLIF(p_payload->>'idempotency_key','');
    IF v_year IS NULL OR v_month IS NULL OR v_idem IS NULL THEN
        RAISE EXCEPTION 'INVALID_PAYLOAD: year/month/idempotency_key إلزامية';
    END IF;
    v_totals := COALESCE(p_payload->'totals', '{}'::jsonb);
    v_entry_date := COALESCE(NULLIF(p_payload->>'entry_date','')::date,
                             make_date(v_year, v_month, 1) + INTERVAL '1 month' - INTERVAL '1 day');
    -- بصمة الحمولة (بلا المفتاح نفسه) لكشف إعادة استخدام المفتاح بحمولة مختلفة
    v_hash := md5((p_payload - 'idempotency_key')::text);

    -- قفل استشاري لكل (org, year, month)
    PERFORM pg_advisory_xact_lock(hashtext(v_org::text || ':payroll:' || v_year || '-' || v_month));

    -- idempotency أولاً (قبل فحص قفل الشهر): إعادة نفس المفتاح بعد نجاح المسير —
    -- الذي يقفل الشهر بنفسه — يجب أن تعيد النتيجة المخزنة لا PAYROLL_MONTH_LOCKED
    SELECT * INTO v_existing FROM payroll_runs
    WHERE org_id = v_org AND idempotency_key = v_idem;
    IF FOUND THEN
        IF v_existing.request_hash IS DISTINCT FROM v_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
        END IF;
        RETURN jsonb_build_object(
            'success', true, 'replayed', true,
            'payroll_run_id', v_existing.id,
            'journal_entry_id', v_existing.journal_entry_id,
            'status', v_existing.status);
    END IF;

    -- شهر مقفل ⇒ رفض (لمفاتيح جديدة فقط)
    IF EXISTS (SELECT 1 FROM hr_payroll_locks
               WHERE org_id = v_org AND year = v_year AND month = v_month
                 AND status = 'locked') THEN
        RAISE EXCEPTION 'PAYROLL_MONTH_LOCKED';
    END IF;

    -- الفترة (تُنشأ إن غابت)
    SELECT id INTO v_period_id FROM payroll_periods
    WHERE org_id = v_org AND period_code = format('%s-%s', v_year, lpad(v_month::text,2,'0'));
    IF v_period_id IS NULL THEN
        INSERT INTO payroll_periods (org_id, period_code, period_name, period_type,
                                     start_date, end_date, status)
        VALUES (v_org, format('%s-%s', v_year, lpad(v_month::text,2,'0')),
                format('مسير %s-%s', v_year, lpad(v_month::text,2,'0')), 'monthly',
                make_date(v_year, v_month, 1), v_entry_date, 'open')
        RETURNING id INTO v_period_id;
    END IF;

    -- مسير سابق لنفس الفترة بمفتاح مختلف ⇒ رفض (UNIQUE يحمي أيضاً)
    IF EXISTS (SELECT 1 FROM payroll_runs WHERE org_id = v_org AND period_id = v_period_id) THEN
        RAISE EXCEPTION 'PAYROLL_RUN_EXISTS: يوجد مسير لهذه الفترة';
    END IF;

    -- رأس المسير
    INSERT INTO payroll_runs (org_id, period_id, run_date, status,
                              total_gross, total_deductions, total_net,
                              idempotency_key, request_hash)
    VALUES (v_org, v_period_id, CURRENT_DATE, 'calculated',
            COALESCE((p_payload->>'total_gross')::numeric, 0),
            COALESCE((p_payload->>'total_deductions')::numeric, 0),
            COALESCE((p_payload->>'total_net')::numeric, 0),
            v_idem, v_hash)
    RETURNING id INTO v_run_id;

    -- سطور القسائم (payroll_details) — سطر لكل موظف/بند
    INSERT INTO payroll_details (org_id, payroll_run_id, employee_id,
                                 component_id, component_code, component_label,
                                 is_deduction, amount, is_processed, processed_at)
    SELECT v_org, v_run_id,
           (l->>'employee_id')::uuid,
           NULLIF(l->>'component_id','')::uuid,
           l->>'component_code',
           l->>'component_label',
           COALESCE((l->>'is_deduction')::boolean, false),
           (l->>'amount')::numeric,
           true, NOW()
    FROM jsonb_array_elements(COALESCE(p_payload->'lines','[]'::jsonb)) l;

    -- بناء سطور القيد من الإجماليات + خرائط الحسابات (fail-closed)
    FOREACH v_bucket IN ARRAY c_debit_buckets LOOP
        v_amount := ROUND(COALESCE((v_totals->>v_bucket)::numeric, 0), 2);
        CONTINUE WHEN v_amount = 0;
        SELECT gl_account_id INTO v_acct FROM hr_payroll_account_mappings
        WHERE org_id = v_org AND account_type = v_bucket;
        IF v_acct IS NULL THEN
            RAISE EXCEPTION 'MAPPING_MISSING: % — اضبط الحساب من ضبط الرواتب', v_bucket;
        END IF;
        v_line_no := v_line_no + 1;
        v_debits := v_debits + v_amount;
        v_gl_lines := v_gl_lines || jsonb_build_array(jsonb_build_object(
            'line_number', v_line_no, 'account_id', v_acct,
            'debit', v_amount, 'credit', 0,
            'description', 'مسير رواتب ' || v_year || '-' || lpad(v_month::text,2,'0') || ' — ' || v_bucket));
    END LOOP;

    FOREACH v_bucket IN ARRAY c_credit_buckets LOOP
        v_amount := ROUND(COALESCE((v_totals->>v_bucket)::numeric, 0), 2);
        CONTINUE WHEN v_amount = 0;
        SELECT gl_account_id INTO v_acct FROM hr_payroll_account_mappings
        WHERE org_id = v_org AND account_type = v_bucket;
        IF v_acct IS NULL THEN
            RAISE EXCEPTION 'MAPPING_MISSING: % — اضبط الحساب من ضبط الرواتب', v_bucket;
        END IF;
        v_line_no := v_line_no + 1;
        v_credits := v_credits + v_amount;
        v_gl_lines := v_gl_lines || jsonb_build_array(jsonb_build_object(
            'line_number', v_line_no, 'account_id', v_acct,
            'debit', 0, 'credit', v_amount,
            'description', 'مسير رواتب ' || v_year || '-' || lpad(v_month::text,2,'0') || ' — ' || v_bucket));
    END LOOP;

    IF v_line_no < 2 THEN
        RAISE EXCEPTION 'EMPTY_PAYROLL: لا مبالغ للترحيل';
    END IF;
    IF ROUND(v_debits,2) <> ROUND(v_credits,2) THEN
        RAISE EXCEPTION 'UNBALANCED_PAYROLL: مدين % ≠ دائن %', v_debits, v_credits;
    END IF;

    -- القيد عبر القناة القانونية (نفس المعاملة ⇒ fail-closed)
    v_journal := rpc_create_journal_entry(jsonb_build_object(
        'org_id', v_org::text,
        'entry_date', v_entry_date::text,
        'description', 'Payroll run ' || v_year || '-' || lpad(v_month::text,2,'0'),
        'description_ar', 'مسير رواتب ' || v_year || '-' || lpad(v_month::text,2,'0'),
        'reference_type', 'PAYROLL',
        'reference_number', v_year || '-' || lpad(v_month::text,2,'0'),
        'idempotency_key', v_idem || ':gl',
        'auto_post', true,
        'lines', v_gl_lines));

    -- اعتماد + قفل الشهر
    UPDATE payroll_runs
    SET status = 'approved', journal_entry_id = (v_journal->>'entry_id')::uuid,
        updated_at = NOW()
    WHERE id = v_run_id;

    INSERT INTO hr_payroll_locks (org_id, year, month, status, locked_at, locked_by, journal_entry_id)
    VALUES (v_org, v_year, v_month, 'locked', NOW(), auth.uid(), (v_journal->>'entry_id')::uuid)
    ON CONFLICT (org_id, year, month) DO UPDATE SET
        status = 'locked', locked_at = NOW(), locked_by = auth.uid(),
        journal_entry_id = (v_journal->>'entry_id')::uuid;

    RETURN jsonb_build_object(
        'success', true, 'replayed', false,
        'payroll_run_id', v_run_id,
        'journal_entry_id', v_journal->>'entry_id',
        'entry_number', v_journal->>'entry_number',
        'total_debit', v_debits, 'total_credit', v_credits,
        'status', 'approved');
END;
$$;

COMMENT ON FUNCTION public.rpc_post_payroll_run(JSONB) IS
'اعتماد مسير رواتب ذرّي Fail-closed (Migration 100): عضوية + قفل استشاري + idempotency ببصمة + سطور payroll_details + قيد متزن عبر rpc_create_journal_entry بحسابات hr_payroll_account_mappings + قفل الشهر — معاملة واحدة.';

GRANT EXECUTE ON FUNCTION public.rpc_post_payroll_run(JSONB) TO authenticated;

-- ===================================================================
-- 2) rpc_post_settlement — اعتماد تسوية نهاية خدمة/إجازة وترحيلها
-- ===================================================================
CREATE OR REPLACE FUNCTION public.rpc_post_settlement(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org        UUID;
    v_idem       TEXT;
    v_settlement hr_settlements%ROWTYPE;
    v_amount     NUMERIC;
    v_exp_acct   UUID;
    v_pay_acct   UUID;
    v_journal    JSONB;
    v_entry_date DATE;
BEGIN
    v_org := wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
    IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM user_organizations
                   WHERE user_id = auth.uid() AND org_id = v_org) THEN
        RAISE EXCEPTION 'NOT_ORG_MEMBER';
    END IF;

    v_idem := NULLIF(p_payload->>'idempotency_key','');
    IF v_idem IS NULL THEN RAISE EXCEPTION 'INVALID_PAYLOAD: idempotency_key إلزامي'; END IF;

    SELECT * INTO v_settlement FROM hr_settlements
    WHERE id = (p_payload->>'settlement_id')::uuid AND org_id = v_org
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND'; END IF;

    -- replay بنفس المفتاح على تسوية مرحَّلة ⇒ إعادة النتيجة
    IF v_settlement.idempotency_key = v_idem AND v_settlement.journal_entry_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'replayed', true,
            'settlement_id', v_settlement.id,
            'journal_entry_id', v_settlement.journal_entry_id,
            'status', v_settlement.status);
    END IF;
    IF v_settlement.status NOT IN ('draft','review') THEN
        RAISE EXCEPTION 'SETTLEMENT_NOT_POSTABLE: الحالة %', v_settlement.status;
    END IF;

    v_amount := ROUND(COALESCE(v_settlement.payable_amount, v_settlement.calculated_amount, 0), 2);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'SETTLEMENT_ZERO_AMOUNT'; END IF;
    v_entry_date := COALESCE(NULLIF(p_payload->>'entry_date','')::date, CURRENT_DATE);

    SELECT gl_account_id INTO v_exp_acct FROM hr_payroll_account_mappings
    WHERE org_id = v_org AND account_type = 'eos_expense';
    SELECT gl_account_id INTO v_pay_acct FROM hr_payroll_account_mappings
    WHERE org_id = v_org AND account_type = 'eos_payable';
    IF v_exp_acct IS NULL OR v_pay_acct IS NULL THEN
        RAISE EXCEPTION 'MAPPING_MISSING: eos_expense/eos_payable — اضبطهما من ضبط الرواتب';
    END IF;

    v_journal := rpc_create_journal_entry(jsonb_build_object(
        'org_id', v_org::text,
        'entry_date', v_entry_date::text,
        'description', 'End of service settlement',
        'description_ar', 'تسوية نهاية خدمة',
        'reference_type', 'SETTLEMENT',
        'reference_number', v_settlement.id::text,
        'idempotency_key', v_idem || ':gl',
        'auto_post', true,
        'lines', jsonb_build_array(
            jsonb_build_object('line_number', 1, 'account_id', v_exp_acct,
                               'debit', v_amount, 'credit', 0,
                               'description', 'مكافأة نهاية خدمة'),
            jsonb_build_object('line_number', 2, 'account_id', v_pay_acct,
                               'debit', 0, 'credit', v_amount,
                               'description', 'مستحق نهاية خدمة'))));

    UPDATE hr_settlements
    SET status = 'approved', approved_by = auth.uid(), approved_at = NOW(),
        journal_entry_id = (v_journal->>'entry_id')::uuid,
        idempotency_key = v_idem, updated_at = NOW()
    WHERE id = v_settlement.id;

    -- نهاية الخدمة تقفل الموظف
    IF v_settlement.settlement_type = 'end_of_service' THEN
        UPDATE employees
        SET status = 'terminated',
            termination_date = COALESCE(v_settlement.service_end, CURRENT_DATE),
            updated_at = NOW()
        WHERE id = v_settlement.employee_id AND org_id = v_org;
    END IF;

    RETURN jsonb_build_object('success', true, 'replayed', false,
        'settlement_id', v_settlement.id,
        'journal_entry_id', v_journal->>'entry_id',
        'entry_number', v_journal->>'entry_number',
        'amount', v_amount, 'status', 'approved');
END;
$$;

COMMENT ON FUNCTION public.rpc_post_settlement(JSONB) IS
'اعتماد وترحيل تسوية نهاية خدمة ذرّياً (Migration 100): عضوية + FOR UPDATE + idempotency + قيد eos_expense/eos_payable عبر rpc_create_journal_entry + قلب حالة الموظف terminated — معاملة واحدة Fail-closed.';

GRANT EXECUTE ON FUNCTION public.rpc_post_settlement(JSONB) TO authenticated;
