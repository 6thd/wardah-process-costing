-- =====================================================================
-- Migration 76: P0 — القيد الذرّي + إحياء الترحيل التشغيلي (gl_event_mappings)
-- =====================================================================
-- المرجع: docs/improvements/03_ACCOUNTING_IMPROVEMENTS.md (البنود 1، 2، 3، 4)
--
-- ⚠️ هذا الملف إضافي بحت (Additive):
--   - لا يحذف أي جدول أو عمود أو دالة موجودة
--   - كل الجداول IF NOT EXISTS، كل الدوال CREATE OR REPLACE
--   - الـ Triggers تُنشأ داخل DO blocks تتحقق من وجود الجداول أولاً
--   - الواجهة تعمل قبل تطبيقه وبعده (Fallback في journal-service.ts)
--
-- ما يضيفه:
--   1. wardah_org_id()            — اشتقاق موحّد لهوية المؤسسة
--   2. assert_period_open()       — حارس الفترات المحاسبية (متسامح إن لم تُعرَّف فترات)
--   3. rpc_create_journal_entry() — إنشاء قيد ذرّي (رأس + سطور في معاملة واحدة)
--   4. gl_event_mappings          — خريطة حدث تشغيلي ⇒ حسابات
--   5. rpc_post_event_journal()   — الدالة التي تستدعيها الواجهة أصلاً ولم تكن موجودة!
--      (src/services/accounting/posting-service.ts:67)
--   6. rpc_post_work_center_oh()  — ترحيل أوفرهيد مركز عمل (posting-service.ts:87)
--   7. rpc_upsert_event_mapping() — إدارة الخرائط
--   8. حماية القيود المرحّلة من التعديل/الحذف (Trigger)
-- =====================================================================

-- =====================================================================
-- 1. اشتقاق هوية المؤسسة بشكل موحّد
-- =====================================================================
-- يعتمد أولاً على get_current_tenant_id() الموجودة (sql/functions/15_tenant_functions.sql)
-- ثم على JWT claims مباشرة، ويقبل قيمة صريحة كخيار أخير (للتوافق مع الكود الحالي
-- الذي يمرر tenantId من العميل — سيُشدَّد لاحقاً ضمن توحيد Multi-Tenancy)
CREATE OR REPLACE FUNCTION wardah_org_id(p_explicit UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_org UUID;
BEGIN
    -- المحاولة 1: الدالة الموجودة في النظام
    BEGIN
        v_org := get_current_tenant_id();
        IF v_org IS NOT NULL THEN RETURN v_org; END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- المحاولة 2: JWT claims مباشرة (org_id أو tenant_id)
    BEGIN
        v_org := COALESCE(
            (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid,
            (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid,
            (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_id')::uuid
        );
        IF v_org IS NOT NULL THEN RETURN v_org; END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- المحاولة 3: القيمة الصريحة الممررة من الخدمة
    RETURN p_explicit;
END;
$$;

COMMENT ON FUNCTION wardah_org_id(UUID) IS
'اشتقاق موحّد لهوية المؤسسة: JWT أولاً ثم القيمة الصريحة. المرجع: docs/improvements/01_CROSS_CUTTING_FOUNDATIONS.md بند 2';

-- =====================================================================
-- 2. حارس الفترات المحاسبية — متسامح (Fail-Open) إن لم تُعرَّف فترات
-- =====================================================================
-- إذا لم يوجد جدول فترات أو لا توجد فترة تغطي التاريخ ⇒ يسمح (لا يكسر العمل اليومي)
-- إذا وُجدت فترة مقفلة تغطي التاريخ ⇒ يرفض بخطأ واضح PERIOD_CLOSED
CREATE OR REPLACE FUNCTION assert_period_open(p_org UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF to_regclass('public.accounting_periods') IS NULL THEN
        RETURN; -- لا يوجد نظام فترات بعد — نسمح
    END IF;

    BEGIN
        SELECT status INTO v_status
        FROM accounting_periods
        WHERE org_id = p_org
          AND p_date BETWEEN start_date AND end_date
        ORDER BY start_date DESC
        LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        -- اختلاف أسماء الأعمدة في بيئة قديمة ⇒ لا نكسر الإدخال
        RETURN;
    END;

    IF v_status IS NOT NULL AND v_status <> 'open' THEN
        RAISE EXCEPTION 'PERIOD_CLOSED: لا يمكن القيد بتاريخ % لأن الفترة المحاسبية بحالة "%"', p_date, v_status;
    END IF;
END;
$$;

-- =====================================================================
-- 3. إنشاء قيد يومي ذرّي — رأس + سطور + توازن في معاملة واحدة
-- =====================================================================
-- يستبدل المسار غير الذرّي في journal-service.ts (INSERT رأس ثم INSERT سطور من المتصفح)
-- شكل p_payload:
-- {
--   "org_id": "...",              -- اختياري (fallback فقط، الأولوية للـ JWT)
--   "journal_id": "...",          -- اختياري (يُختار الافتراضي إن غاب)
--   "entry_date": "2026-07-07",
--   "description": "...", "description_ar": "...",
--   "reference_type": "...", "reference_number": "...",
--   "reference_id": "...",        -- اختياري
--   "idempotency_key": "...",     -- اختياري: يمنع التكرار عند إعادة المحاولة
--   "auto_post": false,           -- اختياري: الافتراضي draft
--   "lines": [
--     {"line_number":1, "account_id":"...", "debit":100, "credit":0,
--      "currency_code":"SAR", "description":"...", "description_ar":"..."}
--   ]
-- }
CREATE OR REPLACE FUNCTION rpc_create_journal_entry(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org UUID;
    v_journal_id UUID;
    v_entry_id UUID;
    v_entry_number TEXT;
    v_entry_date DATE;
    v_total_debit NUMERIC := 0;
    v_total_credit NUMERIC := 0;
    v_line_count INTEGER := 0;
    v_idem TEXT;
    v_auto_post BOOLEAN := COALESCE((p_payload ->> 'auto_post')::boolean, false);
BEGIN
    -- 3.1 الهوية
    v_org := wardah_org_id(NULLIF(p_payload ->> 'org_id', '')::uuid);
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'TENANT_MISSING: تعذر تحديد هوية المؤسسة';
    END IF;

    -- 3.2 التاريخ والفترة
    v_entry_date := COALESCE(NULLIF(p_payload ->> 'entry_date', '')::date, CURRENT_DATE);
    PERFORM assert_period_open(v_org, v_entry_date);

    -- 3.3 Idempotency: نفس المفتاح ⇒ نفس القيد (بدون تكرار)
    v_idem := NULLIF(p_payload ->> 'idempotency_key', '');
    IF v_idem IS NOT NULL THEN
        SELECT id, entry_number INTO v_entry_id, v_entry_number
        FROM gl_entries
        WHERE org_id = v_org AND idempotency_key = v_idem
        LIMIT 1;
        IF v_entry_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true, 'entry_id', v_entry_id,
                'entry_number', v_entry_number, 'duplicate', true
            );
        END IF;
    END IF;

    -- 3.4 التوازن — يُحسب في الخادم من السطور نفسها، لا يُستلم من العميل
    SELECT COALESCE(SUM(COALESCE((l ->> 'debit')::numeric, 0)), 0),
           COALESCE(SUM(COALESCE((l ->> 'credit')::numeric, 0)), 0),
           COUNT(*)
    INTO v_total_debit, v_total_credit, v_line_count
    FROM jsonb_array_elements(p_payload -> 'lines') l;

    IF v_line_count < 2 THEN
        RAISE EXCEPTION 'EMPTY_ENTRY: القيد يحتاج سطرين على الأقل';
    END IF;
    IF round(v_total_debit, 2) <> round(v_total_credit, 2) THEN
        RAISE EXCEPTION 'UNBALANCED_ENTRY: مدين=% دائن=%', v_total_debit, v_total_credit;
    END IF;
    IF round(v_total_debit, 2) = 0 THEN
        RAISE EXCEPTION 'ZERO_ENTRY: قيمة القيد صفر';
    END IF;

    -- 3.5 دفتر اليومية (نفس منطق journal-service الحالي: الافتراضي أول دفتر نشط)
    v_journal_id := NULLIF(p_payload ->> 'journal_id', '')::uuid;
    IF v_journal_id IS NULL AND to_regclass('public.journals') IS NOT NULL THEN
        SELECT id INTO v_journal_id
        FROM journals
        WHERE org_id = v_org AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1;
    END IF;

    -- 3.6 رقم القيد — نعيد استخدام الدالة الحية التي تستدعيها الواجهة اليوم
    BEGIN
        v_entry_number := generate_entry_number(v_journal_id);
    EXCEPTION WHEN OTHERS THEN
        -- توقيع بديل موجود في بعض البيئات: (org_id, date)
        BEGIN
            v_entry_number := generate_entry_number(v_org, v_entry_date);
        EXCEPTION WHEN OTHERS THEN
            v_entry_number := 'JE-' || to_char(v_entry_date, 'YYYY') || '-' ||
                              lpad(floor(random() * 1000000)::text, 6, '0');
        END;
    END;

    -- 3.7 الرأس والسطور — داخل نفس المعاملة (الدالة كلها معاملة واحدة)
    INSERT INTO gl_entries (
        org_id, journal_id, entry_number, entry_date, entry_type,
        description, description_ar, reference_type, reference_number,
        status, total_debit, total_credit, idempotency_key
    ) VALUES (
        v_org, v_journal_id, v_entry_number, v_entry_date, 'manual',
        NULLIF(p_payload ->> 'description', ''),
        NULLIF(p_payload ->> 'description_ar', ''),
        NULLIF(p_payload ->> 'reference_type', ''),
        NULLIF(p_payload ->> 'reference_number', ''),
        'draft', v_total_debit, v_total_credit, v_idem
    )
    RETURNING id INTO v_entry_id;

    INSERT INTO gl_entry_lines (
        org_id, tenant_id, entry_id, line_number, account_id,
        debit, credit, currency_code, description, description_ar
    )
    SELECT
        v_org, v_org, v_entry_id,
        COALESCE((l.value ->> 'line_number')::int, l.ord::int),
        (l.value ->> 'account_id')::uuid,
        COALESCE((l.value ->> 'debit')::numeric, 0),
        COALESCE((l.value ->> 'credit')::numeric, 0),
        COALESCE(NULLIF(l.value ->> 'currency_code', ''), 'SAR'),
        NULLIF(l.value ->> 'description', ''),
        NULLIF(l.value ->> 'description_ar', '')
    FROM jsonb_array_elements(p_payload -> 'lines') WITH ORDINALITY AS l(value, ord);

    -- 3.8 ترحيل فوري اختياري (للقيود الآلية من الأحداث التشغيلية)
    IF v_auto_post THEN
        UPDATE gl_entries
        SET status = 'posted', posted_at = NOW()
        WHERE id = v_entry_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'entry_id', v_entry_id,
        'entry_number', v_entry_number,
        'total_debit', v_total_debit,
        'total_credit', v_total_credit,
        'status', CASE WHEN v_auto_post THEN 'posted' ELSE 'draft' END
    );
END;
$$;

-- عمود مفتاح عدم التكرار + فهرس فريد جزئي (إضافي — لا يمس البيانات الموجودة)
DO $$
BEGIN
    IF to_regclass('public.gl_entries') IS NOT NULL THEN
        ALTER TABLE gl_entries ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_entries_org_idem
            ON gl_entries (org_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL;
    END IF;
END $$;

-- =====================================================================
-- 4. خريطة الأحداث التشغيلية ⇒ الحسابات
-- =====================================================================
CREATE TABLE IF NOT EXISTS gl_event_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    event_code TEXT NOT NULL,          -- MATERIAL_ISSUE / LABOR_APPLIED / OH_APPLIED /
                                       -- FG_RECEIPT / ABNORMAL_SCRAP / PURCHASE_RECEIPT /
                                       -- COGS_DELIVERY / INVENTORY_ADJUSTMENT ...
    work_center_code TEXT,             -- تخصيص اختياري لكل مركز عمل (لأوفرهيد المراكز)
    debit_account_code TEXT NOT NULL,
    credit_account_code TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_event_mappings_key
    ON gl_event_mappings (org_id, event_code, COALESCE(work_center_code, ''));

ALTER TABLE gl_event_mappings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'gl_event_mappings' AND policyname = 'gl_event_mappings_org_isolation'
    ) THEN
        CREATE POLICY gl_event_mappings_org_isolation ON gl_event_mappings
            FOR ALL
            USING (org_id = wardah_org_id())
            WITH CHECK (org_id = wardah_org_id());
    END IF;
END $$;

-- دالة إدارة الخرائط (تتحقق أن الحسابات موجودة فعلاً في شجرة الحسابات)
CREATE OR REPLACE FUNCTION rpc_upsert_event_mapping(
    p_event_code TEXT,
    p_debit_account_code TEXT,
    p_credit_account_code TEXT,
    p_work_center_code TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_tenant UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org UUID := wardah_org_id(p_tenant);
    v_id UUID;
BEGIN
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'TENANT_MISSING: تعذر تحديد هوية المؤسسة';
    END IF;

    IF to_regclass('public.gl_accounts') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE org_id = v_org AND code = p_debit_account_code) THEN
            RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: الحساب المدين % غير موجود في شجرة الحسابات', p_debit_account_code;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE org_id = v_org AND code = p_credit_account_code) THEN
            RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: الحساب الدائن % غير موجود في شجرة الحسابات', p_credit_account_code;
        END IF;
    END IF;

    INSERT INTO gl_event_mappings (org_id, event_code, work_center_code,
                                   debit_account_code, credit_account_code, description)
    VALUES (v_org, upper(p_event_code), p_work_center_code,
            p_debit_account_code, p_credit_account_code, p_description)
    ON CONFLICT (org_id, event_code, COALESCE(work_center_code, ''))
    DO UPDATE SET debit_account_code = EXCLUDED.debit_account_code,
                  credit_account_code = EXCLUDED.credit_account_code,
                  description = COALESCE(EXCLUDED.description, gl_event_mappings.description),
                  is_active = true,
                  updated_at = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- =====================================================================
-- 5. rpc_post_event_journal — الدالة التي تستدعيها الواجهة منذ زمن ولم تكن موجودة
-- =====================================================================
-- التوقيع مطابق تماماً لاستدعاء src/services/accounting/posting-service.ts:67
CREATE OR REPLACE FUNCTION rpc_post_event_journal(
    p_event TEXT,
    p_amount NUMERIC,
    p_memo TEXT,
    p_ref_type TEXT,
    p_ref_id UUID DEFAULT NULL,
    p_tenant UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_jv_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org UUID := wardah_org_id(p_tenant);
    v_map RECORD;
    v_debit_id UUID;
    v_credit_id UUID;
    v_result JSONB;
BEGIN
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'TENANT_MISSING: تعذر تحديد هوية المؤسسة';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT: مبلغ الحدث يجب أن يكون موجباً (المستلم: %)', p_amount;
    END IF;

    -- الخريطة — خطأ واضح بدل حسابات افتراضية صامتة
    SELECT * INTO v_map
    FROM gl_event_mappings
    WHERE org_id = v_org AND event_code = upper(p_event)
      AND work_center_code IS NULL AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MAPPING_MISSING: لا توجد خريطة حسابات للحدث "%" — أضفها عبر rpc_upsert_event_mapping', p_event;
    END IF;

    -- تحويل أكواد الحسابات إلى معرفات
    SELECT id INTO v_debit_id FROM gl_accounts WHERE org_id = v_org AND code = v_map.debit_account_code;
    SELECT id INTO v_credit_id FROM gl_accounts WHERE org_id = v_org AND code = v_map.credit_account_code;
    IF v_debit_id IS NULL OR v_credit_id IS NULL THEN
        RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: أحد حسابي الخريطة (% / %) غير موجود',
            v_map.debit_account_code, v_map.credit_account_code;
    END IF;

    v_result := rpc_create_journal_entry(jsonb_build_object(
        'org_id', v_org,
        'entry_date', COALESCE(p_jv_date, CURRENT_DATE),
        'description', p_memo,
        'reference_type', p_ref_type,
        'reference_number', p_ref_id::text,
        'idempotency_key', p_idempotency_key,
        'auto_post', false,  -- يبقى Draft للمراجعة — يُفعَّل الترحيل الفوري لاحقاً بقرار
        'lines', jsonb_build_array(
            jsonb_build_object('line_number', 1, 'account_id', v_debit_id,
                               'debit', p_amount, 'credit', 0, 'description', p_memo),
            jsonb_build_object('line_number', 2, 'account_id', v_credit_id,
                               'debit', 0, 'credit', p_amount, 'description', p_memo)
        )
    ));

    RETURN (v_result ->> 'entry_id')::uuid;
END;
$$;

-- =====================================================================
-- 6. rpc_post_work_center_oh — توقيع مطابق لـ posting-service.ts:87
-- =====================================================================
CREATE OR REPLACE FUNCTION rpc_post_work_center_oh(
    p_work_center TEXT,
    p_amount NUMERIC,
    p_memo TEXT,
    p_ref_type TEXT,
    p_ref_id UUID DEFAULT NULL,
    p_tenant UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_jv_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org UUID := wardah_org_id(p_tenant);
    v_map RECORD;
    v_debit_id UUID;
    v_credit_id UUID;
    v_result JSONB;
BEGIN
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'TENANT_MISSING: تعذر تحديد هوية المؤسسة';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT: مبلغ الأوفرهيد يجب أن يكون موجباً';
    END IF;

    -- خريطة مخصصة لمركز العمل أولاً، ثم الخريطة العامة OH_APPLIED
    SELECT * INTO v_map
    FROM gl_event_mappings
    WHERE org_id = v_org AND event_code = 'OH_APPLIED'
      AND work_center_code = p_work_center AND is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        SELECT * INTO v_map
        FROM gl_event_mappings
        WHERE org_id = v_org AND event_code = 'OH_APPLIED'
          AND work_center_code IS NULL AND is_active = true
        LIMIT 1;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MAPPING_MISSING: لا توجد خريطة OH_APPLIED لمركز العمل "%" ولا خريطة عامة', p_work_center;
    END IF;

    SELECT id INTO v_debit_id FROM gl_accounts WHERE org_id = v_org AND code = v_map.debit_account_code;
    SELECT id INTO v_credit_id FROM gl_accounts WHERE org_id = v_org AND code = v_map.credit_account_code;
    IF v_debit_id IS NULL OR v_credit_id IS NULL THEN
        RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: أحد حسابي خريطة OH_APPLIED غير موجود';
    END IF;

    v_result := rpc_create_journal_entry(jsonb_build_object(
        'org_id', v_org,
        'entry_date', COALESCE(p_jv_date, CURRENT_DATE),
        'description', p_memo,
        'reference_type', p_ref_type,
        'reference_number', p_ref_id::text,
        'idempotency_key', p_idempotency_key,
        'auto_post', false,
        'lines', jsonb_build_array(
            jsonb_build_object('line_number', 1, 'account_id', v_debit_id,
                               'debit', p_amount, 'credit', 0,
                               'description', p_memo || ' [WC: ' || p_work_center || ']'),
            jsonb_build_object('line_number', 2, 'account_id', v_credit_id,
                               'debit', 0, 'credit', p_amount,
                               'description', p_memo || ' [WC: ' || p_work_center || ']')
        )
    ));

    RETURN (v_result ->> 'entry_id')::uuid;
END;
$$;

-- =====================================================================
-- 7. حماية القيود المرحّلة (Immutability) — محافظ ولا يكسر المسارات الحالية
-- =====================================================================
-- يسمح بـ: draft ⇒ posted (الترحيل)، posted ⇒ reversed/cancelled (العكس/الإلغاء)،
--          وتعديل الحقول الوصفية غير المالية على القيد المرحّل
-- يمنع:   حذف قيد مرحّل، وتغيير التاريخ/المبالغ/الدفتر لقيد مرحّل،
--          وأي لمس لسطور قيد مرحّل
CREATE OR REPLACE FUNCTION protect_posted_gl_entries()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('posted', 'reversed') THEN
            RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: لا يمكن حذف قيد مرحّل (%) — استخدم العكس', OLD.entry_number;
        END IF;
        RETURN OLD;
    END IF;

    -- UPDATE
    IF OLD.status IN ('posted', 'reversed') THEN
        -- الحقول المالية الجوهرية لا تتغير بعد الترحيل
        IF NEW.entry_date    IS DISTINCT FROM OLD.entry_date
           OR NEW.total_debit  IS DISTINCT FROM OLD.total_debit
           OR NEW.total_credit IS DISTINCT FROM OLD.total_credit
           OR NEW.journal_id   IS DISTINCT FROM OLD.journal_id THEN
            RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: لا يمكن تعديل الحقول المالية لقيد مرحّل (%) — استخدم العكس', OLD.entry_number;
        END IF;
        -- الرجوع من posted إلى draft ممنوع
        IF OLD.status = 'posted' AND NEW.status = 'draft' THEN
            RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: لا يمكن إرجاع قيد مرحّل إلى مسودة (%)', OLD.entry_number;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_posted_gl_entry_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_status TEXT;
    v_entry UUID := COALESCE(NEW.entry_id, OLD.entry_id);
BEGIN
    SELECT status INTO v_status FROM gl_entries WHERE id = v_entry;
    IF v_status IN ('posted', 'reversed') THEN
        RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: لا يمكن تعديل/حذف سطور قيد مرحّل — استخدم العكس';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.gl_entries') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_protect_posted_gl_entries ON gl_entries;
        CREATE TRIGGER trg_protect_posted_gl_entries
            BEFORE UPDATE OR DELETE ON gl_entries
            FOR EACH ROW EXECUTE FUNCTION protect_posted_gl_entries();
    END IF;

    IF to_regclass('public.gl_entry_lines') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trg_protect_posted_gl_entry_lines ON gl_entry_lines;
        CREATE TRIGGER trg_protect_posted_gl_entry_lines
            BEFORE UPDATE OR DELETE ON gl_entry_lines
            FOR EACH ROW EXECUTE FUNCTION protect_posted_gl_entry_lines();
    END IF;
END $$;

-- =====================================================================
-- 8. الصلاحيات
-- =====================================================================
GRANT EXECUTE ON FUNCTION wardah_org_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION assert_period_open(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_create_journal_entry(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_post_event_journal(TEXT, NUMERIC, TEXT, TEXT, UUID, UUID, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_post_work_center_oh(TEXT, NUMERIC, TEXT, TEXT, UUID, UUID, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_upsert_event_mapping(TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- =====================================================================
-- 9. أمثلة إعداد الخرائط (تُنفَّذ يدوياً لكل مؤسسة حسب شجرة حساباتها — لا تُنفَّذ آلياً)
-- =====================================================================
-- SELECT rpc_upsert_event_mapping('MATERIAL_ISSUE', '134100', '131000', NULL, 'صرف مواد للتصنيع: مدين WIP-مواد / دائن مخزون خام');
-- SELECT rpc_upsert_event_mapping('LABOR_APPLIED',  '134200', '210500', NULL, 'تحميل عمالة: مدين WIP-عمالة / دائن أجور مستحقة');
-- SELECT rpc_upsert_event_mapping('OH_APPLIED',     '134300', '540000', NULL, 'تحميل أوفرهيد: مدين WIP-أوفرهيد / دائن OH محمّل');
-- SELECT rpc_upsert_event_mapping('FG_RECEIPT',     '135000', '134100', NULL, 'استلام إنتاج تام: مدين مخزون تام / دائن WIP');
-- SELECT rpc_upsert_event_mapping('ABNORMAL_SCRAP', '590000', '134100', NULL, 'تالف غير طبيعي: مدين مصروف تالف / دائن WIP');

-- =====================================================================
-- 10. تحقق سريع بعد التطبيق
-- =====================================================================
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('rpc_create_journal_entry','rpc_post_event_journal','rpc_post_work_center_oh',
--    'rpc_upsert_event_mapping','wardah_org_id','assert_period_open');
-- SELECT COUNT(*) FROM gl_event_mappings;
