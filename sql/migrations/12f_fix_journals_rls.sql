-- إصلاح RLS policies لجدول journals

-- 1. حذف جميع الـ policies القديمة
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON journals;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON journals;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON journals;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON journals;
DROP POLICY IF EXISTS "journals_select_policy" ON journals;
DROP POLICY IF EXISTS "journals_insert_policy" ON journals;
DROP POLICY IF EXISTS "journals_update_policy" ON journals;
DROP POLICY IF EXISTS "journals_delete_policy" ON journals;

-- 2. تعطيل RLS مؤقتاً للتحقق
ALTER TABLE journals DISABLE ROW LEVEL SECURITY;

-- 3. إعادة تفعيل RLS مع policies بسيطة جداً
ALTER TABLE journals ENABLE ROW LEVEL SECURITY;

-- 4. إنشاء policies جديدة (بسيطة - تسمح لجميع المستخدمين المسجلين)
CREATE POLICY "journals_select_policy"
ON journals
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "journals_insert_policy"
ON journals
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "journals_update_policy"
ON journals
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "journals_delete_policy"
ON journals
FOR DELETE
TO authenticated
USING (true);

-- 5. التحقق من الـ policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies 
WHERE tablename = 'journals';

-- 6. اختبار الاستعلام
SELECT 
    code, 
    name, 
    name_ar, 
    is_active,
    org_id
FROM journals 
WHERE is_active = true
ORDER BY code;

