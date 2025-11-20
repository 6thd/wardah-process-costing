# 🔧 إصلاح مشكلة المرفقات (403 Forbidden)

## 🔍 المشكلة:

```
Error: new row violates row-level security policy for table "journal_entry_attachments"
```

**السبب**: RLS policies غير صحيحة أو مفقودة.

---

## ✅ الحل (خطوتين):

### الخطوة 1️⃣: فحص الحالة الحالية

نفّذ في **Supabase SQL Editor**:

```sql
-- File: sql/08_check_attachments_table.sql
```

**سيُظهر لك**:
- ✅ هل الجدول موجود؟
- ✅ هل `org_id` موجودة؟
- ✅ هل RLS مُفعّل؟
- ✅ كم عدد الـ policies؟
- ✅ ما هي الـ policies الحالية؟

---

### الخطوة 2️⃣: تطبيق الإصلاح

نفّذ في **Supabase SQL Editor**:

```sql
-- File: sql/07_fix_attachments_rls.sql
```

**سيقوم بـ**:
1. ✅ حذف الـ policies القديمة
2. ✅ إنشاء 4 policies جديدة:
   - `SELECT` - عرض المرفقات
   - `INSERT` - إضافة مرفقات
   - `UPDATE` - تعديل مرفقات
   - `DELETE` - حذف مرفقات

---

## 📊 النتيجة المتوقعة:

بعد تنفيذ Script 07:

```
✓ Dropped existing policies for journal_entry_attachments
✓ RLS enabled for journal_entry_attachments
✓ Created SELECT policy
✓ Created INSERT policy
✓ Created UPDATE policy
✓ Created DELETE policy
✓ Total policies for journal_entry_attachments: 4
✅ Attachments RLS Fix Complete!
```

---

## 🎯 بعد التنفيذ:

**لا تحتاج** إعادة تشغيل Dev Server!
فقط:

1. **Hard Refresh المتصفح**:
   ```
   Ctrl + Shift + R
   ```

2. **جرّب رفع ملف** في القيد

---

## 🔍 إذا استمرت المشكلة:

### تحقق من الـ policies:

```sql
SELECT * FROM pg_policies 
WHERE tablename = 'journal_entry_attachments';
```

يجب أن ترى **4 policies**:
1. `Users can view own org attachments` (SELECT)
2. `Users can insert own org attachments` (INSERT)
3. `Users can update own org attachments` (UPDATE)
4. `Users can delete own org attachments` (DELETE)

### تحقق من org_id:

```sql
SELECT column_name, data_type 
FROM information_schema.columns
WHERE table_name = 'journal_entry_attachments'
AND column_name = 'org_id';
```

يجب أن ترى:
```
column_name | data_type
------------+----------
org_id      | uuid (or text)
```

---

## 🚨 إذا كان الجدول مفقود:

إذا أظهر Script 08 أن الجدول غير موجود:

```sql
-- Create table
CREATE TABLE IF NOT EXISTS journal_entry_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES gl_entries(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT,
  org_id TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_journal_entry_attachments_entry_id 
ON journal_entry_attachments(entry_id);

CREATE INDEX IF NOT EXISTS idx_journal_entry_attachments_org_id 
ON journal_entry_attachments(org_id);
```

---

## 📝 ملخص:

1. ✅ نفّذ `sql/08_check_attachments_table.sql` للفحص
2. ✅ نفّذ `sql/07_fix_attachments_rls.sql` للإصلاح
3. ✅ Hard Refresh (Ctrl+Shift+R)
4. ✅ جرّب رفع ملف

---

**ابدأ الآن!** 🚀

