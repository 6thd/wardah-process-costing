# 📋 ترتيب تنفيذ SQL Scripts

## ✅ الترتيب الصحيح للتنفيذ

قم بتنفيذ السكريبتات بهذا الترتيب **بالضبط**:

---

### Phase 0: Pre-fixes (اختياري)
```sql
-- ✅ تم تنفيذه
00a_pre_fix_drop_views.sql
```
**الغرض:** حذف Views إشكالية قبل تعديل الجداول

---

### Phase 1: Critical Schema Fixes ⭐ **مهم جداً**
```sql
-- ✅ تم تنفيذه
00_critical_schema_fixes.sql
```
**الغرض:** 
- توحيد `org_id` vs `tenant_id`
- إنشاء `items` table
- إصلاح `gl_accounts` columns
- إضافة `name_ar`, `name_en`, `subtype`

---

### Phase 2: Immediate Error Fixes ⭐ **مهم جداً**
```sql
-- ✅ تم تنفيذه  
01_fix_immediate_errors.sql
```
**الغرض:**
- إصلاح RPC functions (get_account_statement, check_entry_approval_required)
- إنشاء `journals` table
- إنشاء `journal_entries` و `journal_lines` views

---

### Phase 3: Sales & Payment Vouchers ⭐ **مهم جداً**
```sql
-- ✅ تم تنفيذه
02_complete_phaseB_fixes.sql
```
**الغرض:**
- إصلاح `sales_invoices` و `sales_invoice_lines`
- إنشاء `payment_vouchers` و `receipt_vouchers`
- إضافة Indexes, RLS, Audit triggers
- Helper functions

---

### Phase 4: Storage Buckets (للمرفقات)
```sql
-- ⚠️ لا تنفذه! استخدم Dashboard فقط
03_create_storage_buckets.sql
```
**⚠️ ملاحظة:** 
- هذا السكريبت **للتوثيق فقط**
- يجب إنشاء `documents` bucket عبر **Supabase Dashboard**
- راجع: `STORAGE_BUCKET_QUICK_GUIDE.md`

---

### Phase 5: RPC Functions Final Fix ⭐ **مطلوب الآن**
```sql
-- 🔥 نفذ هذا الآن!
04_fix_rpc_functions_final.sql
```
**الغرض:**
- إصلاح `get_account_statement` ليستخدم `category` بدلاً من `account_type`
- إصلاح `check_entry_approval_required` ليستخدم `org_id` بدلاً من `tenant_id`
- إنشاء `generate_voucher_number` function

**🎯 هذا يحل أخطاء Console!**

---

## 📊 ملخص الحالة

| السكريبت | الحالة | الملاحظات |
|----------|--------|-----------|
| 00a | ✅ مكتمل | اختياري |
| 00 | ✅ مكتمل | Critical fixes |
| 01 | ✅ مكتمل | RPC fixes (v1) |
| 02 | ✅ مكتمل | Sales & Vouchers |
| 03 | ⚠️ Dashboard | Storage bucket |
| 04 | 🔥 **نفذ الآن** | RPC fixes (v2 - Final) |

---

## 🚀 الخطوات التالية

### 1. نفذ السكريبت 04
```sql
-- في Supabase SQL Editor
\i sql/04_fix_rpc_functions_final.sql
```

### 2. أنشئ Documents Bucket
- اذهب إلى: Supabase Dashboard → Storage
- Create bucket: `documents` (Private)
- راجع: `STORAGE_BUCKET_QUICK_GUIDE.md`

### 3. اختبر التطبيق
- ✅ Chart of Accounts (إضافة/تعديل/حذف)
- ✅ Trial Balance (أسماء الحسابات)
- ✅ Account Statement (كشف حساب)
- ✅ Journal Entries (رفع مرفقات)

---

## ❌ أخطاء Console المُحلّة

بعد تنفيذ السكريبت 04:

### ✅ تم إصلاحها:
- ❌ `column "account_type" does not exist` → ✅ يستخدم `category` الآن
- ❌ `column je.tenant_id does not exist` → ✅ يستخدم `org_id` الآن
- ❌ `RPC function failed` → ✅ تم إصلاح جميع RPC functions

### ⚠️ متبقية (تحتاج Dashboard):
- `Bucket not found` → إنشاء `documents` bucket يدوياً

---

## 🔍 التحقق من النجاح

بعد التنفيذ، افتح Console وتحقق:

```javascript
// يجب ألا تظهر هذه الأخطاء:
❌ column "account_type" does not exist
❌ column je.tenant_id does not exist
❌ RPC function failed

// يجب أن يعمل:
✅ Trial Balance → أسماء حسابات صحيحة
✅ Account Statement → بدون أخطاء
✅ Chart of Accounts → CRUD كامل
```

---

## 📞 المساعدة

### إذا ظهرت أخطاء أخرى:
1. تأكد من تنفيذ السكريبتات بالترتيب
2. راجع Console للأخطاء الجديدة
3. تحقق من Supabase logs في Dashboard

### ملفات مساعدة:
- `FIXES_COMPLETED_2025-01-17.md` - ملخص الإصلاحات
- `STORAGE_BUCKET_QUICK_GUIDE.md` - دليل Storage
- `STORAGE_BUCKET_SETUP.md` - دليل مفصل للStorage

---

**آخر تحديث:** 2025-01-17  
**الحالة:** 🟢 جاهز للتنفيذ

