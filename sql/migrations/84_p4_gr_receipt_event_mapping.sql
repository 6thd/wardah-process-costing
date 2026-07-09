-- ===================================================================
-- Migration 84: قيد GL لاستلام البضاعة — Dr مخزون / Cr GRNI
-- ===================================================================
-- المشكلة: استلام البضاعة (receiveGoods) كان يسجّل حركة المخزون
-- في Stock Ledger لكن **بلا أي قيد محاسبي** — قيمة المخزون ترتفع
-- في الدفتر الفرعي بينما GL لا يتحرك، ففجوة تقرير التسوية
-- (Migration 81) تكبر مع كل استلام.
--
-- الحل المحاسبي القياسي عند الاستلام قبل الفاتورة:
--   مدين: مخزون مواد خام (131100)
--   دائن: بضاعة مستلمة لم تُفوتر GRNI (210150 — يُنشأ هنا إن غاب)
-- وعند فاتورة المورد لاحقاً يُقفل GRNI مقابل ذمم الموردين.
--
-- المتطلب: Migration 76 (rpc_upsert_event_mapping) و77 (نمط الزرع)
-- المبدأ: إضافي 100% — حساب جديد + خريطة حدث جديدة، لا تعديل لأي قائم
-- ===================================================================

-- 1) إنشاء حساب GRNI إن لم يوجد — تحت الخصوم المتداولة 210000
--    (دفاعي: عمود name_ar قد لا يوجد في بعض النسخ — يُكشف ديناميكياً)
DO $$
DECLARE
    v_org UUID;
    v_parent_code TEXT;
    v_has_name_ar BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'gl_accounts'
          AND column_name = 'name_ar'
    ) INTO v_has_name_ar;

    FOR v_org IN SELECT DISTINCT org_id FROM gl_accounts
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM gl_accounts WHERE org_id = v_org AND code = '210150'
        ) THEN
            -- الأب: 210000 إن وُجد، وإلا 210100 كأقرب مرساة
            SELECT code INTO v_parent_code
            FROM gl_accounts
            WHERE org_id = v_org AND code IN ('210000', '210100')
            ORDER BY code
            LIMIT 1;

            IF v_has_name_ar THEN
                EXECUTE format(
                    'INSERT INTO gl_accounts (
                        org_id, code, name, name_ar, category, subtype,
                        parent_code, normal_balance, allow_posting, is_active, currency
                     ) VALUES ($1, ''210150'',
                        ''Goods Received Not Invoiced (GRNI)'',
                        ''بضاعة مستلمة لم تُفوتر'',
                        ''LIABILITY'', ''ACCRUAL'', $2, ''CREDIT'', true, true, ''SAR'')'
                ) USING v_org, v_parent_code;
            ELSE
                INSERT INTO gl_accounts (
                    org_id, code, name, category, subtype,
                    parent_code, normal_balance, allow_posting, is_active, currency
                ) VALUES (
                    v_org, '210150',
                    'Goods Received Not Invoiced (GRNI)',
                    'LIABILITY', 'ACCRUAL',
                    v_parent_code, 'CREDIT', true, true, 'SAR'
                );
            END IF;
            RAISE NOTICE 'أُنشئ حساب GRNI 210150 للمؤسسة %', v_org;
        ELSE
            RAISE NOTICE 'حساب GRNI 210150 موجود مسبقاً للمؤسسة % — لا تغيير', v_org;
        END IF;
    END LOOP;
END $$;

-- 2) زرع خريطة حدث الاستلام (UPSERT — التكرار آمن)
--    مدين مخزون مواد خام / دائن GRNI
SELECT rpc_upsert_event_mapping('GR_RECEIPT', '131100', '210150', NULL,
  'استلام بضاعة: مدين مخزون مواد خام LDPE / دائن بضاعة مستلمة لم تُفوتر (GRNI)');

-- ===================================================================
-- التحقق بعد التطبيق:
--   SELECT event_code, debit_account_code, credit_account_code
--   FROM gl_event_mappings WHERE event_code = 'GR_RECEIPT';
--   SELECT code, name_ar FROM gl_accounts WHERE code = '210150';
--
-- بعدها: أي استلام بضاعة جديد من الواجهة سيرحّل قيداً تلقائياً،
-- وتقرير تسوية Migration 81 يجب أن يتوقف عن التدهور.
-- ===================================================================
