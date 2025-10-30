# 🚀 دليل التطبيق - خطوة بخطوة

## ⚡ الطريقة السريعة (3 خطوات)

### 1️⃣ افتح Supabase SQL Editor
- اذهب إلى: https://app.supabase.com
- اختر مشروعك
- اضغط على **SQL Editor** من القائمة الجانبية

### 2️⃣ اختبار سريع (اختياري)
انسخ والصق محتوى: `00_quick_check.sql`
- سيعرض لك الجداول الموجودة
- سيحدد إذا كان النظام يستخدم `items` أو `products`
- ✅ إذا ظهرت رسائل بدون أخطاء = جاهز للمتابعة

### 3️⃣ تطبيق BOM System
انسخ والصق محتوى: `01_bom_system_setup.sql` **بالكامل**
- اضغط **Run** أو Ctrl+Enter
- انتظر حتى ينتهي التنفيذ (30-60 ثانية)
- ✅ يجب أن ترى: "BOM System Setup Complete!"

---

## ✅ ماذا بعد التطبيق؟

### تحقق من النجاح:
```sql
-- عرض الجداول المنشأة
SELECT table_name 
FROM information_schema.tables 
WHERE table_name LIKE '%bom%'
ORDER BY table_name;
```

يجب أن ترى:
- ✅ bom_explosion_cache
- ✅ bom_headers
- ✅ bom_lines
- ✅ bom_versions
- ✅ bom_where_used

### اختبار الدوال:
```sql
-- عرض الدوال المنشأة
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name LIKE '%bom%'
ORDER BY routine_name;
```

يجب أن ترى:
- ✅ calculate_bom_cost
- ✅ create_bom_version
- ✅ explode_bom
- ✅ get_where_used
- ✅ update_bom_where_used

---

## 🐛 حل المشاكل

### مشكلة: "relation does not exist"
**الحل:** شغّل السكريبت بالكامل مرة واحدة (لا تشغل أجزاء منه)

### مشكلة: "permission denied"
**الحل:** تأكد من أنك مسجل دخول بحساب له صلاحيات admin

### مشكلة: RLS errors
**الحل:** شغّل `02_bom_rls_simple.sql` للسياسات المبسطة

---

## 📝 ملاحظات مهمة

### ✅ النظام يدعم كلا من:
- جدول `items` (إذا كان موجوداً)
- جدول `products` (كبديل)
- الدوال تتعرف تلقائياً على الجدول المتاح

### ✅ أسماء الأعمدة المدعومة:
- `code` أو `item_code` أو `product_code`
- `name` أو `item_name` أو `product_name`  
- `unit` أو `uom` أو `unit_of_measure`
- `unit_cost` أو `standard_cost` أو `cost_price`

### ✅ لا حاجة لإنشاء جدول items/products أولاً:
- السكريبت يعمل بدونهم
- الربط سيحدث تلقائياً عند توفر البيانات

---

## 🎯 الخطوة التالية

بعد التطبيق الناجح:
1. ✅ اختبر الواجهة: `/manufacturing/bom`
2. ✅ جرّب إنشاء BOM جديد
3. ✅ اختبر الدوال

**هل واجهت مشكلة؟** راجع ملف `BOM_DATABASE_DEPLOYMENT.md` للدليل الكامل
