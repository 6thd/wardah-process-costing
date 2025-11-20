-- =======================================
-- إضافة مورد وعميل تجريبي سريع
-- Quick Add Test Vendor & Customer
-- =======================================

-- الخطوة 1: الحصول على org_id
-- انسخ org_id من هذا الاستعلام:
SELECT id, name FROM organizations LIMIT 1;

-- =======================================
-- الخطوة 2: بعد الحصول على org_id، استبدل 'YOUR_ORG_ID' أدناه ثم نفذ:
-- =======================================

-- إضافة مورد
INSERT INTO vendors (
    org_id,
    code,
    name,
    contact_person,
    phone,
    email,
    is_active
) VALUES (
    'YOUR_ORG_ID',  -- ← ضع org_id هنا
    'V001',
    'شركة المواد الخام',
    'أحمد محمد',
    '0551234567',
    'supplier@test.com',
    true
)
ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name
RETURNING id, code, name;

-- إضافة عميل
INSERT INTO customers (
    org_id,
    code,
    name,
    contact_person,
    phone,
    email,
    credit_limit,
    is_active
) VALUES (
    'YOUR_ORG_ID',  -- ← ضع org_id هنا
    'C001',
    'مؤسسة التجارة',
    'خالد أحمد',
    '0557654321',
    'customer@test.com',
    50000.00,
    true
)
ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name
RETURNING id, code, name;

-- =======================================
-- الخطوة 3: احفظ المعرفات
-- =======================================
-- بعد التنفيذ، احفظ:
-- - vendor_id (من نتيجة INSERT الأول)
-- - customer_id (من نتيجة INSERT الثاني)
