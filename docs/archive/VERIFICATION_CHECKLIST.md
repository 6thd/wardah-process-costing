# قائمة التحقق من التكامل - Integration Verification Checklist

## ✅ بعد تطبيق SQL في Supabase

### 1. تطبيق ملفات SQL بالترتيب

- [ ] ✅ `sql/02_gl_posting_functions_enhanced.sql` - تم تطبيقه
- [ ] ✅ `sql/03_general_ledger_enhancements.sql` - تم تطبيقه
- [ ] ⚠️ `sql/04_rls_policies_enhancements.sql` - **يجب تطبيقه الآن!**

### 2. التحقق من الجداول (10 جداول)

افتح Supabase → Table Editor:

- [ ] `journal_entry_approvals`
- [ ] `journal_approval_rules`
- [ ] `journal_entry_attachments`
- [ ] `journal_entry_comments`
- [ ] `cost_centers`
- [ ] `profit_centers`
- [ ] `account_segments`
- [ ] `currency_exchange_rates`
- [ ] `account_reconciliations`
- [ ] `reconciliation_items`

### 3. التحقق من الدوال (10 دوال)

افتح Supabase → Database → Functions:

- [ ] `batch_post_journal_entries`
- [ ] `check_entry_approval_required`
- [ ] `approve_journal_entry`
- [ ] `reverse_journal_entry_enhanced`
- [ ] `generate_entry_number_enhanced`
- [ ] `get_account_statement`
- [ ] `reconcile_account`
- [ ] `get_exchange_rate`
- [ ] `translate_amount`
- [ ] `get_segment_report`

### 4. إعداد Storage

- [ ] إنشاء bucket باسم `documents` في Supabase Storage
- [ ] إعداد Policies حسب الحاجة

### 5. اختبار الواجهة الأمامية

#### صفحة القيود (`/accounting/journal-entries`)

- [ ] الصفحة تفتح بدون أخطاء
- [ ] زر "ترحيل مجمع" (Batch Post) يظهر في الأعلى
- [ ] عند فتح قيد مرحّل → زر "عرض" → تظهر 4 تبويبات:
  - [ ] Details (التفاصيل)
  - [ ] Approvals (الموافقات)
  - [ ] Attachments (المرفقات)
  - [ ] Comments (التعليقات)
- [ ] زر "عكس" (Reverse) يظهر بجانب القيود المرحّلة

#### صفحة كشف الحساب (`/accounting/account-statement`)

- [ ] الصفحة تفتح بدون أخطاء
- [ ] قائمة الحسابات تظهر
- [ ] عند اختيار حساب وتاريخ → تظهر الحركات
- [ ] الأرصدة الافتتاحية والختامية صحيحة
- [ ] زر Export (Excel/PDF) يعمل

### 6. فحص Console

افتح Developer Tools (F12) → Console:

- [ ] لا توجد أخطاء `Table does not exist`
- [ ] لا توجد أخطاء `Function does not exist`
- [ ] لا توجد أخطاء `Permission denied`
- [ ] لا توجد أخطاء `RLS policy violation`

### 7. اختبار الميزات

#### Batch Posting
- [ ] أنشئ قيدين مسودة
- [ ] اضغط "ترحيل مجمع"
- [ ] اختر القيود وترحيلها
- [ ] ✅ رسالة نجاح تظهر

#### Attachments
- [ ] افتح قيد مرحّل
- [ ] تبويب "المرفقات"
- [ ] اضغط "رفع ملف"
- [ ] ✅ الملف يظهر في القائمة

#### Comments
- [ ] افتح قيد
- [ ] تبويب "التعليقات"
- [ ] اكتب تعليق واضغط "إضافة"
- [ ] ✅ التعليق يظهر

#### Account Statement
- [ ] افتح `/accounting/account-statement`
- [ ] اختر حساب
- [ ] اختر فترة
- [ ] اضغط "عرض"
- [ ] ✅ الحركات والأرصدة تظهر

## 🔧 في حالة وجود مشاكل

### خطأ: "Function does not exist"
```sql
-- نفّذ:
-- sql/02_gl_posting_functions_enhanced.sql
```

### خطأ: "Table does not exist"
```sql
-- نفّذ:
-- sql/03_general_ledger_enhancements.sql
```

### خطأ: "Permission denied" أو "RLS policy violation"
```sql
-- نفّذ:
-- sql/04_rls_policies_enhancements.sql
```

### خطأ: "Storage bucket not found"
- أنشئ bucket باسم `documents` في Supabase Storage

## 📝 ملاحظات

1. **RLS Policies مهمة جداً**: بدونها لن تعمل الواجهة
2. **Storage Bucket**: مطلوب للمرفقات
3. **Tenant ID**: تأكد من أنه مضبوط بشكل صحيح
4. **Console**: راجع دائماً للأخطاء

## ✅ النتيجة المتوقعة

بعد إكمال جميع الخطوات:
- ✅ جميع الميزات الجديدة تعمل
- ✅ لا توجد أخطاء في Console
- ✅ الواجهة سلسة وسريعة
- ✅ البيانات تظهر بشكل صحيح

