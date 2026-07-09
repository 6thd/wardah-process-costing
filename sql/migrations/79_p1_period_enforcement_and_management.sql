-- =====================================================================
-- Migration 79: P1 — فرض إقفال الفترات على كل مسارات الترحيل + إدارة الفترات
-- =====================================================================
-- المتطلب: Migration 76 (wardah_org_id, assert_period_open v1)
-- آمن تماماً: IF NOT EXISTS / CREATE OR REPLACE — لا حذف ولا تضييق
--
-- المشكلة التي يحلها:
--  * assert_period_open v1 تبحث بعمود org_id بينما جدول الفترات القديم
--    (01_gl_foundation.sql) يستخدم tenant_id — الحارس كان يسمح دائماً بصمت
--  * مسارات ترحيل كاملة غير محمية: batch_post_journal_entries،
--    reverse_journal_entry_enhanced، وأي INSERT مباشر في gl_entries
--  * لا توجد أدوات لإنشاء/إقفال/إعادة فتح الفترات من الواجهة
--
-- محتويات:
--  1. wardah_periods_org_col()      — اكتشاف عمود الهوية (org_id/tenant_id)
--  2. جدول accounting_periods        — يُنشأ إن لم يوجد (بـ org_id) + RLS
--  3. assert_period_open() v2       — متكيّفة مع اسم العمود، تُغطي كل حالات الإقفال
--  4. Trigger gl_entries_period_guard — يحمي كل مسارات الإدخال/الترحيل
--  5. rpc_list_periods()            — قراءة الفترات
--  6. rpc_generate_fiscal_periods() — توليد 12 فترة شهرية لسنة مالية
--  7. rpc_set_period_status()       — إقفال/إعادة فتح بضوابط
--  8. GRANT EXECUTE to authenticated
-- =====================================================================

-- =====================================================================
-- 1. اكتشاف عمود الهوية في accounting_periods (org_id أم tenant_id؟)
-- =====================================================================
CREATE OR REPLACE FUNCTION wardah_periods_org_col()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'accounting_periods'
              AND column_name = 'org_id'
        ) THEN 'org_id'
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'accounting_periods'
              AND column_name = 'tenant_id'
        ) THEN 'tenant_id'
        ELSE NULL
    END;
$$;

-- =====================================================================
-- 2. جدول الفترات — يُنشأ فقط إن لم يوجد (لا يمس جدولاً قائماً)
-- =====================================================================
CREATE TABLE IF NOT EXISTS accounting_periods (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL,
    period_code TEXT NOT NULL,                    -- '2026-07'
    period_name TEXT NOT NULL,
    period_type TEXT NOT NULL DEFAULT 'month'
                CHECK (period_type IN ('month', 'quarter', 'year')),
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    fiscal_year INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'closed', 'permanently_closed')),
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (org_id, period_code),
    CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_accounting_periods_org_dates
    ON accounting_periods (org_id, start_date, end_date);

-- RLS — فقط إذا كان الجدول جديداً بعمود org_id (الجدول القديم له سياساته)
DO $$
BEGIN
    IF wardah_periods_org_col() = 'org_id' THEN
        ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'accounting_periods'
        ) THEN
            CREATE POLICY accounting_periods_org_isolation ON accounting_periods
                FOR ALL USING (org_id = wardah_org_id(NULL));
        END IF;
    END IF;
END;
$$;

-- =====================================================================
-- 3. assert_period_open v2 — متكيّفة مع اسم عمود الهوية
-- =====================================================================
-- Fail-Open فقط عندما: لا جدول فترات، أو لا فترة تُغطي التاريخ
-- Fail-Closed عندما: توجد فترة تغطي التاريخ وحالتها ليست 'open'
CREATE OR REPLACE FUNCTION assert_period_open(p_org UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_status TEXT;
    v_col    TEXT;
BEGIN
    IF to_regclass('public.accounting_periods') IS NULL THEN
        RETURN; -- لا يوجد نظام فترات — نسمح
    END IF;

    v_col := wardah_periods_org_col();
    IF v_col IS NULL THEN
        RETURN; -- بنية غير معروفة — لا نكسر الإدخال
    END IF;

    EXECUTE format(
        'SELECT status FROM accounting_periods
         WHERE %I = $1 AND $2 BETWEEN start_date AND end_date
         ORDER BY start_date DESC LIMIT 1',
        v_col
    )
    INTO v_status
    USING p_org, p_date;

    IF v_status IS NOT NULL AND v_status <> 'open' THEN
        RAISE EXCEPTION 'PERIOD_CLOSED: لا يمكن القيد بتاريخ % — الفترة المحاسبية بحالة "%"',
            p_date, v_status;
    END IF;
END;
$$;

COMMENT ON FUNCTION assert_period_open(UUID, DATE) IS
'حارس الفترات v2: متكيّف مع org_id/tenant_id. يرفض PERIOD_CLOSED إن كانت الفترة مقفلة، ويسمح إن لم تُعرَّف فترات.';

-- =====================================================================
-- 4. الحارس على مستوى الجدول — يحمي *كل* المسارات
--    (rpc_create_journal_entry، batch_post، العكس، الـ INSERT المباشر)
-- =====================================================================
CREATE OR REPLACE FUNCTION trg_gl_entries_period_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- قيد جديد في فترة مقفلة؟
        PERFORM assert_period_open(NEW.org_id, NEW.entry_date);

    ELSIF TG_OP = 'UPDATE' THEN
        -- ترحيل قيد (draft → posted) في فترة مقفلة؟
        IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'posted' THEN
            PERFORM assert_period_open(NEW.org_id, NEW.entry_date);
        END IF;
        -- نقل قيد إلى تاريخ في فترة مقفلة؟
        IF NEW.entry_date IS DISTINCT FROM OLD.entry_date THEN
            PERFORM assert_period_open(NEW.org_id, NEW.entry_date);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.gl_entries') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS gl_entries_period_guard ON gl_entries;
        CREATE TRIGGER gl_entries_period_guard
            BEFORE INSERT OR UPDATE ON gl_entries
            FOR EACH ROW
            EXECUTE FUNCTION trg_gl_entries_period_guard();
    END IF;
END;
$$;

-- ملاحظة: تعليم القيد الأصلي 'reversed' لا يُمنع — الأثر المالي للعكس
-- يقع في قيد العكس الجديد وتاريخه يُفحص عند الإدراج (INSERT أعلاه).

-- =====================================================================
-- 5. قراءة الفترات
-- =====================================================================
CREATE OR REPLACE FUNCTION rpc_list_periods(
    p_fiscal_year INTEGER DEFAULT NULL,
    p_tenant      UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_org UUID := wardah_org_id(p_tenant);
    v_col TEXT := wardah_periods_org_col();
    v_out JSONB;
BEGIN
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'TENANT_MISSING: تعذر تحديد هوية المؤسسة';
    END IF;
    IF v_col IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    EXECUTE format(
        'SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.start_date), ''[]''::jsonb)
         FROM (
            SELECT id, period_code, period_name, period_type,
                   start_date, end_date, fiscal_year, status
            FROM accounting_periods
            WHERE %I = $1 AND ($2 IS NULL OR fiscal_year = $2)
         ) t',
        v_col
    )
    INTO v_out
    USING v_org, p_fiscal_year;

    RETURN v_out;
END;
$$;

-- =====================================================================
-- 6. توليد 12 فترة شهرية لسنة مالية (ON CONFLICT DO NOTHING — آمن للتكرار)
-- =====================================================================
CREATE OR REPLACE FUNCTION rpc_generate_fiscal_periods(
    p_year   INTEGER,
    p_tenant UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org     UUID := wardah_org_id(p_tenant);
    v_col     TEXT := wardah_periods_org_col();
    v_month   INTEGER;
    v_start   DATE;
    v_end     DATE;
    v_code    TEXT;
    v_created INTEGER := 0;
    v_rows    INTEGER;
BEGIN
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'TENANT_MISSING: تعذر تحديد هوية المؤسسة';
    END IF;
    IF v_col IS NULL THEN
        RAISE EXCEPTION 'PERIODS_TABLE_MISSING: جدول accounting_periods غير موجود أو بنيته غير معروفة';
    END IF;
    IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
        RAISE EXCEPTION 'INVALID_YEAR: السنة المالية غير صالحة (%)', p_year;
    END IF;

    FOR v_month IN 1..12 LOOP
        v_start := make_date(p_year, v_month, 1);
        v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
        v_code  := to_char(v_start, 'YYYY-MM');

        EXECUTE format(
            'INSERT INTO accounting_periods
                (%I, period_code, period_name, period_type,
                 start_date, end_date, fiscal_year, status)
             VALUES ($1, $2, $3, ''month'', $4, $5, $6, ''open'')
             ON CONFLICT DO NOTHING',
            v_col
        )
        USING v_org, v_code,
              'الفترة ' || v_code, v_start, v_end, p_year;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_created := v_created + v_rows;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'fiscal_year', p_year,
        'periods_created', v_created,
        'periods_existing', 12 - v_created
    );
END;
$$;

-- =====================================================================
-- 7. تغيير حالة فترة — بضوابط
--    open → closed، closed → open (إعادة فتح)، closed → permanently_closed
--    permanently_closed نهائية لا رجعة فيها
-- =====================================================================
CREATE OR REPLACE FUNCTION rpc_set_period_status(
    p_period_code TEXT,
    p_status      TEXT,
    p_tenant      UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org     UUID := wardah_org_id(p_tenant);
    v_col     TEXT := wardah_periods_org_col();
    v_current TEXT;
    v_id      UUID;
BEGIN
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'TENANT_MISSING: تعذر تحديد هوية المؤسسة';
    END IF;
    IF v_col IS NULL THEN
        RAISE EXCEPTION 'PERIODS_TABLE_MISSING: جدول accounting_periods غير موجود أو بنيته غير معروفة';
    END IF;
    IF p_status NOT IN ('open', 'closed', 'permanently_closed') THEN
        RAISE EXCEPTION 'INVALID_STATUS: الحالة "%" غير صالحة — المسموح: open / closed / permanently_closed', p_status;
    END IF;

    EXECUTE format(
        'SELECT id, status FROM accounting_periods WHERE %I = $1 AND period_code = $2 LIMIT 1',
        v_col
    )
    INTO v_id, v_current
    USING v_org, p_period_code;

    IF v_id IS NULL THEN
        RAISE EXCEPTION 'PERIOD_NOT_FOUND: الفترة "%" غير موجودة', p_period_code;
    END IF;

    IF v_current = 'permanently_closed' THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: الفترة "%" مقفلة نهائياً ولا يمكن تغيير حالتها', p_period_code;
    END IF;

    IF v_current = p_status THEN
        RETURN jsonb_build_object(
            'success', true, 'period_code', p_period_code,
            'status', p_status, 'changed', false
        );
    END IF;

    EXECUTE format(
        'UPDATE accounting_periods SET status = $1, updated_at = now()
         WHERE %I = $2 AND period_code = $3',
        v_col
    )
    USING p_status, v_org, p_period_code;

    RETURN jsonb_build_object(
        'success', true,
        'period_code', p_period_code,
        'previous_status', v_current,
        'status', p_status,
        'changed', true
    );
END;
$$;

-- =====================================================================
-- 8. منح الصلاحيات
-- =====================================================================
GRANT EXECUTE ON FUNCTION wardah_periods_org_col()                       TO authenticated;
GRANT EXECUTE ON FUNCTION assert_period_open(UUID, DATE)                 TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_list_periods(INTEGER, UUID)                TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_generate_fiscal_periods(INTEGER, UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_set_period_status(TEXT, TEXT, UUID)        TO authenticated;

-- =====================================================================
-- تحقق سريع بعد التطبيق:
-- =====================================================================
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('wardah_periods_org_col','rpc_list_periods',
--    'rpc_generate_fiscal_periods','rpc_set_period_status',
--    'trg_gl_entries_period_guard');
-- -- المتوقع: 5 صفوف
--
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'gl_entries'::regclass
--   AND tgname = 'gl_entries_period_guard';
-- -- المتوقع: صف واحد
--
-- -- تجربة عملية (اختياري):
-- SELECT rpc_generate_fiscal_periods(2026);          -- 12 فترة
-- SELECT rpc_set_period_status('2026-01', 'closed'); -- إقفال يناير
-- -- الآن أي قيد بتاريخ يناير 2026 سيُرفض بـ PERIOD_CLOSED
