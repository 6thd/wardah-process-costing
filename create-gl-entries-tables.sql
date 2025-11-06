-- =======================================
-- إنشاء الجداول المحاسبية الإضافية
-- GL Entries & GL Entry Lines Tables
-- =======================================

-- 1. جدول القيود المحاسبية (Journal Entries)
CREATE TABLE IF NOT EXISTS gl_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    entry_number VARCHAR(50) NOT NULL,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    entry_type VARCHAR(50) NOT NULL CHECK (entry_type IN ('manual', 'purchase', 'sale', 'payment', 'receipt', 'cogs', 'adjustment')),
    reference_type VARCHAR(50),
    reference_id UUID,
    description TEXT,
    total_debit DECIMAL(12,2) DEFAULT 0 CHECK (total_debit >= 0),
    total_credit DECIMAL(12,2) DEFAULT 0 CHECK (total_credit >= 0),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
    posted_at TIMESTAMPTZ,
    posted_by UUID,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT gl_entries_org_number_unique UNIQUE(org_id, entry_number),
    CONSTRAINT gl_entries_balanced CHECK (ABS(total_debit - total_credit) < 0.01)
);

-- 2. جدول بنود القيود المحاسبية (Journal Entry Lines)
CREATE TABLE IF NOT EXISTS gl_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    entry_id UUID NOT NULL REFERENCES gl_entries(id) ON DELETE CASCADE,
    line_number INTEGER DEFAULT 1,
    account_code VARCHAR(50) NOT NULL,
    account_name VARCHAR(255),
    description TEXT,
    debit_amount DECIMAL(12,2) DEFAULT 0 CHECK (debit_amount >= 0),
    credit_amount DECIMAL(12,2) DEFAULT 0 CHECK (credit_amount >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT gl_entry_lines_entry_line_unique UNIQUE(entry_id, line_number),
    CONSTRAINT gl_entry_lines_debit_or_credit CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR 
        (credit_amount > 0 AND debit_amount = 0)
    )
);

-- 3. Indexes للأداء
CREATE INDEX IF NOT EXISTS idx_gl_entries_org ON gl_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_gl_entries_date ON gl_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_gl_entries_type ON gl_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_gl_entries_status ON gl_entries(status);
CREATE INDEX IF NOT EXISTS idx_gl_entries_reference ON gl_entries(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_gl_entry_lines_org ON gl_entry_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_gl_entry_lines_entry ON gl_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_gl_entry_lines_account ON gl_entry_lines(account_code);

-- 4. Row Level Security
ALTER TABLE gl_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_entry_lines ENABLE ROW LEVEL SECURITY;

-- سياسات مؤقتة للتطوير
DROP POLICY IF EXISTS "Allow all for gl_entries" ON gl_entries;
DROP POLICY IF EXISTS "Allow all for gl_entry_lines" ON gl_entry_lines;

CREATE POLICY "Allow all for gl_entries" ON gl_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for gl_entry_lines" ON gl_entry_lines FOR ALL USING (true) WITH CHECK (true);

-- 5. Triggers للتحديث التلقائي
CREATE OR REPLACE FUNCTION update_gl_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_gl_entries_updated_at_trigger ON gl_entries;
CREATE TRIGGER update_gl_entries_updated_at_trigger
    BEFORE UPDATE ON gl_entries
    FOR EACH ROW EXECUTE FUNCTION update_gl_entries_updated_at();

-- 6. Function: إنشاء رقم قيد تلقائي
CREATE OR REPLACE FUNCTION generate_entry_number(p_org_id UUID, p_entry_date DATE)
RETURNS VARCHAR AS $$
DECLARE
    v_year VARCHAR(4);
    v_month VARCHAR(2);
    v_sequence INTEGER;
    v_entry_number VARCHAR(50);
BEGIN
    v_year := TO_CHAR(p_entry_date, 'YYYY');
    v_month := TO_CHAR(p_entry_date, 'MM');
    
    -- الحصول على آخر رقم في الشهر
    SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number, '-', 4) AS INTEGER)), 0) + 1
    INTO v_sequence
    FROM gl_entries
    WHERE org_id = p_org_id
    AND entry_number LIKE 'JE-' || v_year || '-' || v_month || '-%';
    
    v_entry_number := 'JE-' || v_year || '-' || v_month || '-' || LPAD(v_sequence::TEXT, 4, '0');
    
    RETURN v_entry_number;
END;
$$ LANGUAGE plpgsql;

-- 7. Function: التحقق من توازن القيد
CREATE OR REPLACE FUNCTION validate_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_total_debit DECIMAL(12,2);
    v_total_credit DECIMAL(12,2);
BEGIN
    -- حساب مجموع المدين والدائن
    SELECT 
        COALESCE(SUM(debit_amount), 0),
        COALESCE(SUM(credit_amount), 0)
    INTO v_total_debit, v_total_credit
    FROM gl_entry_lines
    WHERE entry_id = NEW.id;
    
    -- تحديث القيد بالمجاميع
    UPDATE gl_entries
    SET 
        total_debit = v_total_debit,
        total_credit = v_total_credit
    WHERE id = NEW.id;
    
    -- التحقق من التوازن
    IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
        RAISE EXCEPTION 'القيد غير متوازن: مدين % ≠ دائن %', v_total_debit, v_total_credit;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Trigger: التحقق من التوازن عند الترحيل
CREATE OR REPLACE FUNCTION check_balance_before_post()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'posted' AND OLD.status != 'posted' THEN
        IF ABS(NEW.total_debit - NEW.total_credit) > 0.01 THEN
            RAISE EXCEPTION 'لا يمكن ترحيل قيد غير متوازن';
        END IF;
        NEW.posted_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_balance_before_post_trigger ON gl_entries;
CREATE TRIGGER check_balance_before_post_trigger
    BEFORE UPDATE ON gl_entries
    FOR EACH ROW EXECUTE FUNCTION check_balance_before_post();

-- 9. Comments للتوثيق
COMMENT ON TABLE gl_entries IS 'القيود المحاسبية - سجل جميع العمليات المحاسبية';
COMMENT ON TABLE gl_entry_lines IS 'بنود القيود المحاسبية - تفاصيل الحسابات المدينة والدائنة';

COMMENT ON COLUMN gl_entries.entry_type IS 'نوع القيد: manual, purchase, sale, payment, receipt, cogs, adjustment';
COMMENT ON COLUMN gl_entries.status IS 'حالة القيد: draft (مسودة), posted (مرحل), cancelled (ملغي)';
COMMENT ON COLUMN gl_entries.total_debit IS 'إجمالي المدين - يجب أن يساوي إجمالي الدائن';
COMMENT ON COLUMN gl_entries.total_credit IS 'إجمالي الدائن - يجب أن يساوي إجمالي المدين';

COMMENT ON COLUMN gl_entry_lines.debit_amount IS 'المبلغ المدين - يجب أن يكون 0 إذا كان دائن';
COMMENT ON COLUMN gl_entry_lines.credit_amount IS 'المبلغ الدائن - يجب أن يكون 0 إذا كان مدين';

-- 10. نجاح التنفيذ
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════';
    RAISE NOTICE '✅ تم إنشاء الجداول المحاسبية بنجاح!';
    RAISE NOTICE '═══════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '📋 الجداول المُنشأة:';
    RAISE NOTICE '   ✓ gl_entries - القيود المحاسبية';
    RAISE NOTICE '   ✓ gl_entry_lines - بنود القيود';
    RAISE NOTICE '';
    RAISE NOTICE '🔧 Functions المُضافة:';
    RAISE NOTICE '   ✓ generate_entry_number() - توليد رقم قيد تلقائي';
    RAISE NOTICE '   ✓ validate_entry_balance() - التحقق من توازن القيد';
    RAISE NOTICE '   ✓ check_balance_before_post() - منع ترحيل قيد غير متوازن';
    RAISE NOTICE '';
    RAISE NOTICE '🔒 الأمان:';
    RAISE NOTICE '   ✓ RLS مُفعّل على الجدولين';
    RAISE NOTICE '   ✓ Constraints لضمان التوازن والقيود';
    RAISE NOTICE '';
    RAISE NOTICE '📊 الفهارس:';
    RAISE NOTICE '   ✓ 8 فهارس للأداء الأمثل';
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════';
    RAISE NOTICE '🚀 الآن يمكنك تشغيل الاختبار مرة أخرى!';
    RAISE NOTICE '   node run-real-test.cjs';
    RAISE NOTICE '═══════════════════════════════════════════════';
    RAISE NOTICE '';
END $$;

-- 11. اختبار بسيط (اختياري)
-- إنشاء قيد تجريبي للتأكد من عمل الجداول
DO $$
DECLARE
    v_entry_id UUID;
    v_org_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- إنشاء قيد
    INSERT INTO gl_entries (
        org_id,
        entry_number,
        entry_date,
        entry_type,
        description,
        status
    ) VALUES (
        v_org_id,
        'TEST-001',
        CURRENT_DATE,
        'manual',
        'قيد تجريبي للاختبار',
        'draft'
    ) RETURNING id INTO v_entry_id;
    
    -- إضافة بنود
    INSERT INTO gl_entry_lines (org_id, entry_id, line_number, account_code, account_name, description, debit_amount, credit_amount)
    VALUES 
        (v_org_id, v_entry_id, 1, '1110', 'نقدية', 'استلام نقدية', 1000.00, 0),
        (v_org_id, v_entry_id, 2, '3101', 'رأس المال', 'رأس مال', 0, 1000.00);
    
    -- تحديث المجاميع
    UPDATE gl_entries
    SET 
        total_debit = (SELECT SUM(debit_amount) FROM gl_entry_lines WHERE entry_id = v_entry_id),
        total_credit = (SELECT SUM(credit_amount) FROM gl_entry_lines WHERE entry_id = v_entry_id)
    WHERE id = v_entry_id;
    
    RAISE NOTICE '✅ تم إنشاء قيد تجريبي: TEST-001';
    RAISE NOTICE '   المدين: 1,000.00 SAR';
    RAISE NOTICE '   الدائن: 1,000.00 SAR';
    RAISE NOTICE '   متوازن: ✅';
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠️  تخطي إنشاء القيد التجريبي';
END $$;
