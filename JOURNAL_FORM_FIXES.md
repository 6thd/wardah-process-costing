# 🔧 إصلاح نموذج القيود اليومية

## المشاكل المكتشفة:

### 1. ❌ قائمة "نوع القيد" فارغة
**السبب**: جدول `journals` لا يحتوي على بيانات أو RLS يمنع الوصول

**الحل**: إضافة بيانات افتراضية

### 2. ❌ المرفقات والتعليقات لا تظهر في النموذج
**السبب**: تظهر فقط في dialog العرض، ليس في dialog التعديل

---

## ✅ الحل: SQL Script لإنشاء أنواع القيود

نفّذ هذا السكربت في Supabase:

```sql
-- إنشاء أنواع القيود الافتراضية
DO $$
DECLARE
    v_org_id UUID := '00000000-0000-0000-0000-000000000001'::uuid;
    v_gen_id UUID;
    v_sales_id UUID;
    v_purch_id UUID;
BEGIN
    RAISE NOTICE 'Creating default journals...';
    
    -- 1. قيد عام (General Journal)
    INSERT INTO journals (
        code,
        name,
        name_ar,
        journal_type,
        sequence_prefix,
        is_active,
        org_id
    ) VALUES (
        'GEN',
        'General Journal',
        'قيد عام',
        'general',
        'JE-',
        true,
        v_org_id
    )
    ON CONFLICT (org_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        name_ar = EXCLUDED.name_ar,
        is_active = true
    RETURNING id INTO v_gen_id;
    
    RAISE NOTICE '  ✓ Created General Journal: %', v_gen_id;
    
    -- 2. قيد مبيعات (Sales Journal)
    INSERT INTO journals (
        code,
        name,
        name_ar,
        journal_type,
        sequence_prefix,
        is_active,
        org_id
    ) VALUES (
        'SALES',
        'Sales Journal',
        'قيد المبيعات',
        'sales',
        'SJ-',
        true,
        v_org_id
    )
    ON CONFLICT (org_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        name_ar = EXCLUDED.name_ar,
        is_active = true
    RETURNING id INTO v_sales_id;
    
    RAISE NOTICE '  ✓ Created Sales Journal: %', v_sales_id;
    
    -- 3. قيد مشتريات (Purchase Journal)
    INSERT INTO journals (
        code,
        name,
        name_ar,
        journal_type,
        sequence_prefix,
        is_active,
        org_id
    ) VALUES (
        'PURCH',
        'Purchase Journal',
        'قيد المشتريات',
        'purchase',
        'PJ-',
        true,
        v_org_id
    )
    ON CONFLICT (org_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        name_ar = EXCLUDED.name_ar,
        is_active = true
    RETURNING id INTO v_purch_id;
    
    RAISE NOTICE '  ✓ Created Purchase Journal: %', v_purch_id;
    
    -- 4. قيد بنك (Bank Journal)
    INSERT INTO journals (
        code,
        name,
        name_ar,
        journal_type,
        sequence_prefix,
        is_active,
        org_id
    ) VALUES (
        'BANK',
        'Bank Journal',
        'قيد البنك',
        'bank',
        'BJ-',
        true,
        v_org_id
    )
    ON CONFLICT (org_id, code) DO NOTHING;
    
    RAISE NOTICE '  ✓ Created Bank Journal';
    
    -- 5. قيد صندوق (Cash Journal)
    INSERT INTO journals (
        code,
        name,
        name_ar,
        journal_type,
        sequence_prefix,
        is_active,
        org_id
    ) VALUES (
        'CASH',
        'Cash Journal',
        'قيد الصندوق',
        'cash',
        'CJ-',
        true,
        v_org_id
    )
    ON CONFLICT (org_id, code) DO NOTHING;
    
    RAISE NOTICE '  ✓ Created Cash Journal';
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ Default Journals Created Successfully!';
    RAISE NOTICE '========================================';
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '❌ Error: %', SQLERRM;
END $$;

-- Verify
SELECT 
    code,
    name,
    name_ar,
    sequence_prefix,
    is_active
FROM journals
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code;
```

---

## 📊 النتيجة المتوقعة:

بعد تنفيذ السكربت، ستظهر في قائمة "نوع القيد":

| الكود | الاسم بالإنجليزية | الاسم بالعربية | البادئة |
|-------|-------------------|----------------|----------|
| BANK  | Bank Journal      | قيد البنك      | BJ-      |
| CASH  | Cash Journal      | قيد الصندوق    | CJ-      |
| GEN   | General Journal   | قيد عام        | JE-      |
| PURCH | Purchase Journal  | قيد المشتريات  | PJ-      |
| SALES | Sales Journal     | قيد المبيعات   | SJ-      |

---

## 🔧 بالنسبة للمرفقات والتعليقات:

### الوضع الحالي:
- ✅ تظهر عند **عرض** قيد موجود
- ❌ لا تظهر عند **إنشاء/تعديل** قيد

### الحل المطلوب:
يجب تعديل الكود ليظهر المرفقات والتعليقات في dialog التعديل أيضاً.

سأقوم بإنشاء نسخة محدثة من الملف...

---

## 🚀 الخطوات:

1. **نفّذ SQL script أعلاه** في Supabase
2. **Hard Refresh** المتصفح (`Ctrl+Shift+R`)
3. **جرّب إنشاء قيد جديد** - يجب أن ترى قائمة نوع القيد ممتلئة
4. **للمرفقات والتعليقات**: سأرسل لك التعديل القادم

---

**نفّذ السكربت الآن!** 🎯

