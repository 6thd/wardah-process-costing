# دليل تشغيل Supabase Database Linter

## 📋 نظرة عامة

Supabase Database Linter هو أداة مدمجة في Supabase Dashboard للتحقق من أمان قاعدة البيانات واكتشاف المشاكل الأمنية والأداء.

---

## 🚀 خطوات التشغيل

### الطريقة 1: من Supabase Dashboard (الموصى بها)

#### الخطوة 1: الدخول إلى Supabase Dashboard

1. اذهب إلى [Supabase Dashboard](https://supabase.com/dashboard)
2. سجل الدخول إلى حسابك
3. اختر المشروع المطلوب

#### الخطوة 2: الوصول إلى Database Linter

1. من القائمة الجانبية، اضغط على **"Reports"** أو **"Reports & Logs"**
2. أو اذهب مباشرة إلى:
   ```
   https://supabase.com/dashboard/project/[PROJECT_ID]/reports
   ```

#### الخطوة 3: فتح Database Linter

1. في صفحة Reports، ابحث عن قسم **"Database Linter"** أو **"Security & Performance"**
2. أو اذهب مباشرة إلى:
   ```
   https://supabase.com/dashboard/project/[PROJECT_ID]/reports/database-linter
   ```

#### الخطوة 4: تشغيل Linter

1. اضغط على زر **"Run Linter"** أو **"Analyze Database"**
2. انتظر حتى يكتمل التحليل (قد يستغرق 30-60 ثانية)
3. راجع النتائج

---

### الطريقة 2: من SQL Editor (للمستخدمين المتقدمين)

يمكنك أيضاً التحقق من بعض المشاكل يدوياً باستخدام SQL queries:

```sql
-- مثال: التحقق من Views مع SECURITY DEFINER
SELECT 
    schemaname,
    viewname,
    definition
FROM pg_views
WHERE schemaname = 'public'
AND definition LIKE '%SECURITY DEFINER%';

-- مثال: التحقق من RLS المفعّل
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
AND rowsecurity = false;
```

---

## 📊 فهم النتائج

### أنواع المشاكل:

#### 🔴 Errors (أخطاء):
- مشاكل أمنية حرجة
- يجب إصلاحها فوراً
- مثال: RLS غير مفعّل، SECURITY DEFINER views

#### ⚠️ Warnings (تحذيرات):
- مشاكل محتملة
- قد تحتاج مراجعة
- مثال: Indexes مفقودة، Queries بطيئة

#### ℹ️ Info (معلومات):
- توصيات للأداء
- تحسينات اختيارية

---

## 🔧 بعد تشغيل Linter

### 1. تصدير النتائج

1. في صفحة Linter Results، اضغط على **"Export"** أو **"Download CSV"**
2. احفظ الملف للمراجعة لاحقاً

### 2. إصلاح المشاكل

#### للـ Errors:
- ابحث عن الـ migration المناسب في `sql/migrations/`
- مثال: `62_fix_security_linter_issues.sql`

#### للـ Warnings:
- راجع كل warning
- قرر ما إذا كان يحتاج إصلاح أم لا

### 3. إعادة التشغيل

بعد إصلاح المشاكل:
1. شغّل Linter مرة أخرى
2. تأكد من أن Errors أصبحت 0
3. راجع Warnings الجديدة

---

## 📝 مثال عملي

### قبل الإصلاح:
```
❌ Errors: 7
⚠️ Warnings: 98
ℹ️ Info: 15
```

### بعد الإصلاح:
```
✅ Errors: 0
⚠️ Warnings: 98 (مراجعة لاحقة)
ℹ️ Info: 15
```

---

## 🔍 أنواع المشاكل الشائعة

### 1. SECURITY DEFINER Views
**المشكلة:**
```sql
CREATE VIEW v_example WITH (security_definer=true) AS ...
```

**الحل:**
```sql
CREATE VIEW v_example WITH (security_invoker=true) AS ...
```

### 2. RLS غير مفعّل
**المشكلة:**
- جدول بدون Row Level Security

**الحل:**
```sql
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
CREATE POLICY policy_name ON table_name ...
```

### 3. Indexes مفقودة
**المشكلة:**
- استعلامات بطيئة

**الحل:**
```sql
CREATE INDEX idx_name ON table_name(column_name);
```

---

## 📚 Migrations المتاحة في المشروع

### إصلاحات الأمان:
- ✅ `62_fix_security_linter_issues.sql` - إصلاح 7 Security Errors
- ✅ `65_fix_stage_costs_complete.sql` - إصلاح RLS على stage_costs

### التحقق:
- ✅ `62_verify_security_fixes.sql` - التحقق من الإصلاحات

---

## ✅ Checklist

قبل تشغيل Linter:
- [ ] تأكد من أنك في المشروع الصحيح
- [ ] احفظ أي تغييرات غير محفوظة
- [ ] خذ backup للبيانات المهمة

بعد تشغيل Linter:
- [ ] راجع جميع Errors
- [ ] صدر CSV للنتائج
- [ ] صلح جميع Errors
- [ ] شغّل Linter مرة أخرى
- [ ] راجع Warnings (اختياري)

---

## 🔗 روابط مفيدة

- [Supabase Database Linter Documentation](https://supabase.com/docs/guides/database/database-linter)
- [SECURITY DEFINER Views - Security Issues](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
- [RLS Disabled in Public Schema](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public)
- [Supabase Dashboard](https://supabase.com/dashboard)

---

## 📸 لقطات شاشة (Screen Guide)

### الخطوة 1: Dashboard Navigation
```
Dashboard → Reports → Database Linter
```

### الخطوة 2: Run Linter Button
```
[Run Linter] [Analyze Database] [Scan]
```

### الخطوة 3: Results View
```
Errors: 0 ✅
Warnings: 98 ⚠️
Info: 15 ℹ️
```

---

## 💡 نصائح

1. **شغّل Linter بانتظام**: مرة أسبوعياً على الأقل
2. **صلح Errors أولاً**: ثم راجع Warnings
3. **احفظ النتائج**: للمقارنة والمراجعة
4. **اختبر بعد الإصلاح**: تأكد من أن كل شيء يعمل

---

**آخر تحديث:** 2025  
**الحالة:** ✅ جاهز للاستخدام

