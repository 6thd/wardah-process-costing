# دليل تطبيق قاعدة بيانات BOM System

## 📋 نظرة عامة

هذا الدليل يشرح كيفية تطبيق تحديثات قاعدة البيانات لنظام BOM (Bill of Materials).

## ✅ المتطلبات الأساسية

- [ ] الوصول إلى Supabase Dashboard
- [ ] صلاحيات تشغيل SQL queries
- [ ] التأكد من وجود جدول `items` أو `products`

## 🚀 خطوات التطبيق

### الخطوة 0: التحقق من المتطلبات (مهم جداً!)

**قبل تطبيق BOM، شغّل سكريبت التحقق:**

1. افتح: `sql/manufacturing/00_pre_bom_verification.sql`
2. انسخ المحتوى والصقه في Supabase SQL Editor
3. اضغط **Run**
4. تحقق من أن جميع الفحوصات ✅
5. إذا كان هناك ❌، يجب حل المشكلة أولاً

**المتطلبات الأساسية:**
- ✅ جدول `items` يجب أن يكون موجوداً
- ✅ جدول `organizations` يجب أن يكون موجوداً
- ✅ جدول `user_organizations` يجب أن يكون موجوداً

### الخطوة 1: فتح Supabase SQL Editor

1. اذهب إلى [Supabase Dashboard](https://app.supabase.com)
2. اختر المشروع: `wardah-process-costing`
3. من القائمة الجانبية، اختر **SQL Editor**

### الخطوة 2: نسخ ولصق السكريبت

1. افتح الملف: `sql/manufacturing/01_bom_system_setup.sql`
2. انسخ **المحتوى بالكامل** (Ctrl+A ثم Ctrl+C)
3. الصق في SQL Editor في Supabase
4. اضغط **Run** أو Ctrl+Enter

### الخطوة 3: التحقق من النجاح

بعد التشغيل، يجب أن ترى:

```
✅ BOM System Setup Complete!
✅ Tables Created/Updated: bom_headers, bom_lines
✅ Tables Created: bom_versions, bom_explosion_cache, bom_where_used
✅ Functions Created: explode_bom, calculate_bom_cost, get_where_used
✅ Triggers Created: trg_bom_version_tracking, trg_bom_where_used_update
```

### الخطوة 4: التحقق من الجداول

شغّل هذا الاستعلام للتأكد:

```sql
-- التحقق من وجود الجداول
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%bom%'
ORDER BY table_name;
```

يجب أن يظهر:
- ✅ `bom_explosion_cache`
- ✅ `bom_headers`
- ✅ `bom_lines`
- ✅ `bom_versions`
- ✅ `bom_where_used`

### الخطوة 5: التحقق من الدوال (Functions)

```sql
-- التحقق من الدوال
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name LIKE '%bom%'
ORDER BY routine_name;
```

يجب أن يظهر:
- ✅ `calculate_bom_cost`
- ✅ `create_bom_version`
- ✅ `explode_bom`
- ✅ `get_where_used`
- ✅ `update_bom_where_used`

## 📊 هيكل قاعدة البيانات

### الجداول المحدّثة

#### 1. `bom_headers` - رؤوس قوائم المواد

| العمود | النوع | الوصف |
|--------|-------|-------|
| id | UUID | المعرّف الفريد |
| org_id | UUID | معرّف المؤسسة |
| bom_number | VARCHAR(100) | رقم قائمة المواد |
| item_id | UUID | معرّف الصنف النهائي |
| bom_version | INTEGER | رقم الإصدار |
| status | VARCHAR(20) | الحالة (DRAFT/APPROVED/OBSOLETE) |
| is_active | BOOLEAN | نشط؟ |
| effective_date | DATE | تاريخ السريان |
| unit_cost | NUMERIC(18,4) | تكلفة الوحدة |
| approved_by | UUID | من قام بالاعتماد |
| approved_at | TIMESTAMP | تاريخ الاعتماد |
| notes | TEXT | ملاحظات |

#### 2. `bom_lines` - تفاصيل قوائم المواد

| العمود | النوع | الوصف |
|--------|-------|-------|
| id | UUID | المعرّف الفريد |
| bom_id | UUID | معرّف القائمة |
| item_id | UUID | معرّف المكون |
| quantity | NUMERIC(18,6) | الكمية المطلوبة |
| line_type | VARCHAR(20) | نوع المكون |
| scrap_factor | NUMERIC(5,2) | نسبة الهالك % |
| is_critical | BOOLEAN | مادة حرجة؟ |
| yield_percentage | NUMERIC(5,2) | نسبة المخرجات % |
| operation_sequence | INTEGER | تسلسل العملية |
| effective_from | DATE | ساري من |
| effective_to | DATE | ساري حتى |

### الجداول الجديدة

#### 3. `bom_versions` - سجل الإصدارات
تتبع تاريخ التغييرات في قوائم المواد

#### 4. `bom_explosion_cache` - ذاكرة التفجير
تخزين نتائج تفجير BOM لتحسين الأداء

#### 5. `bom_where_used` - استخدام المكونات
تتبع استخدام كل مكون في القوائم المختلفة

## 🔧 الدوال (Functions)

### 1. `explode_bom(p_bom_id, p_quantity, p_org_id)`
فك قائمة المواد متعددة المستويات

**مثال:**
```sql
SELECT * FROM explode_bom(
    'bom-uuid-here'::UUID,
    10,  -- الكمية
    'org-uuid-here'::UUID
);
```

### 2. `calculate_bom_cost(p_bom_id, p_quantity)`
حساب التكلفة الإجمالية

**مثال:**
```sql
SELECT calculate_bom_cost(
    'bom-uuid-here'::UUID,
    5  -- الكمية
);
```

### 3. `get_where_used(p_item_id, p_org_id)`
معرفة أين يُستخدم المكون

**مثال:**
```sql
SELECT * FROM get_where_used(
    'item-uuid-here'::UUID,
    'org-uuid-here'::UUID
);
```

## ⚠️ ملاحظات مهمة

### 1. العلاقات (Foreign Keys)

تأكد من وجود الجداول التالية:
- ✅ `items` أو `products` (للأصناف)
- ✅ `organizations` (للمؤسسات)
- ✅ `auth.users` (للمستخدمين)
- ✅ `user_organizations` (لربط المستخدمين بالمؤسسات)

### 2. صلاحيات RLS

السكريبت يضيف Row Level Security لحماية البيانات:
- ✅ المستخدم يرى فقط بيانات المؤسسات التابع لها
- ✅ التحقق التلقائي من الصلاحيات

### 3. الفهارس (Indexes)

تم إنشاء 12 فهرس لتحسين الأداء:
- على الحالة (status)
- على التفعيل (is_active)
- على الأصناف (item_id)
- على العلاقات (foreign keys)

## 🐛 حل المشاكل

### المشكلة: "relation does not exist"

**الحل:**
- تأكد من تشغيل السكريبت بالكامل
- لا تشغّل أجزاء منفصلة من السكريبت

### المشكلة: "foreign key constraint"

**الحل:**
```sql
-- تحقق من وجود جدول items
SELECT table_name FROM information_schema.tables 
WHERE table_name = 'items';

-- إذا لم يكن موجوداً، أنشئه
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_code VARCHAR(100) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    unit_of_measure VARCHAR(50),
    unit_cost NUMERIC(18,4) DEFAULT 0,
    org_id UUID NOT NULL
);
```

### المشكلة: "permission denied"

**الحل:**
- تأكد من تسجيل الدخول بحساب admin
- تحقق من صلاحيات المستخدم في Supabase

## ✅ التحقق النهائي

شغّل هذا الاستعلام للتأكد من جاهزية النظام:

```sql
-- عدد الجداول
SELECT COUNT(*) as bom_tables 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%bom%';
-- يجب أن يكون: 5

-- عدد الدوال
SELECT COUNT(*) as bom_functions
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name LIKE '%bom%';
-- يجب أن يكون: 5

-- عدد الفهارس
SELECT COUNT(*) as bom_indexes
FROM pg_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE '%bom%';
-- يجب أن يكون: 12+
```

## 📞 الدعم

في حالة وجود مشاكل:
1. راجع قسم "حل المشاكل" أعلاه
2. تحقق من logs في Supabase
3. تأكد من اتباع جميع الخطوات بالترتيب

---

**تم بحمد الله ✨**

آخر تحديث: 2025-01-30
