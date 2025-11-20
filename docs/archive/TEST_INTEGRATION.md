# اختبار التكامل - Integration Testing Guide

## ✅ التحقق من التكامل بعد تطبيق SQL في Supabase

### 1. التحقق من الجداول الجديدة

قم بتشغيل هذه الاستعلامات في Supabase SQL Editor:

```sql
-- التحقق من وجود الجداول
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'journal_entry_approvals',
  'journal_approval_rules',
  'journal_entry_attachments',
  'journal_entry_comments',
  'cost_centers',
  'profit_centers',
  'account_segments',
  'currency_exchange_rates',
  'account_reconciliations',
  'reconciliation_items'
);

-- يجب أن ترى 10 جداول
```

### 2. التحقق من الدوال (Functions)

```sql
-- التحقق من وجود الدوال
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
  'batch_post_journal_entries',
  'check_entry_approval_required',
  'approve_journal_entry',
  'reverse_journal_entry_enhanced',
  'generate_entry_number_enhanced',
  'get_account_statement',
  'reconcile_account',
  'get_exchange_rate',
  'translate_amount',
  'get_segment_report'
);

-- يجب أن ترى 10 دوال
```

### 3. اختبار الدوال الأساسية

#### اختبار Batch Posting
```sql
-- إنشاء قيود تجريبية أولاً
-- ثم اختبار:
SELECT batch_post_journal_entries(ARRAY[
  'entry-id-1'::UUID,
  'entry-id-2'::UUID
]);
```

#### اختبار Account Statement
```sql
-- اختبار كشف حساب
SELECT * FROM get_account_statement(
  'account-id'::UUID,
  '2024-01-01'::DATE,
  CURRENT_DATE,
  false
);
```

#### اختبار Exchange Rate
```sql
-- اختبار سعر الصرف
SELECT get_exchange_rate('USD', 'SAR', CURRENT_DATE);
```

### 4. التحقق من RLS Policies

```sql
-- التحقق من تفعيل RLS
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN (
  'journal_entry_approvals',
  'journal_entry_attachments',
  'journal_entry_comments'
);

-- يجب أن يكون rowsecurity = true
```

### 5. اختبار الواجهة الأمامية

#### أ. صفحة القيود المحاسبية (`/accounting/journal-entries`)

**التحقق من:**
1. ✅ زر "ترحيل مجمع" (Batch Post) يظهر في الأعلى
2. ✅ عند فتح قيد مرحّل، تظهر تبويبات:
   - Details (التفاصيل)
   - Approvals (الموافقات)
   - Attachments (المرفقات)
   - Comments (التعليقات)
3. ✅ زر "عكس" (Reverse) يظهر بجانب القيود المرحّلة

**خطوات الاختبار:**
1. افتح `/accounting/journal-entries`
2. اضغط على زر "ترحيل مجمع"
3. اختر قيود مسودة وترحيلها
4. افتح قيد مرحّل واضغط "عرض"
5. تحقق من وجود التبويبات الأربعة

#### ب. صفحة كشف الحساب (`/accounting/account-statement`)

**التحقق من:**
1. ✅ الصفحة تفتح بدون أخطاء
2. ✅ قائمة الحسابات تظهر
3. ✅ عند اختيار حساب وتاريخ، تظهر الحركات
4. ✅ الأرصدة الافتتاحية والختامية صحيحة
5. ✅ زر Export (Excel/PDF) يعمل

**خطوات الاختبار:**
1. افتح `/accounting/account-statement`
2. اختر حساب
3. اختر فترة زمنية
4. اضغط "عرض"
5. تحقق من البيانات
6. جرب Export

### 6. اختبار الميزات الجديدة

#### أ. Approval Workflow
```typescript
// في Console المتصفح
// اختبار إنشاء موافقة
const entryId = 'your-entry-id';
const result = await supabase.rpc('check_entry_approval_required', {
  p_entry_id: entryId
});
console.log('Approval required:', result);
```

#### ب. Attachments
```typescript
// اختبار رفع ملف
const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
const result = await JournalService.uploadAttachment(entryId, file);
console.log('Upload result:', result);
```

#### ج. Comments
```typescript
// اختبار إضافة تعليق
const result = await JournalService.addComment(entryId, 'Test comment', 'comment');
console.log('Comment added:', result);
```

### 7. التحقق من الأخطاء الشائعة

#### خطأ: "Function does not exist"
**الحل:** تأكد من تطبيق ملف `02_gl_posting_functions_enhanced.sql`

#### خطأ: "Table does not exist"
**الحل:** تأكد من تطبيق ملف `03_general_ledger_enhancements.sql`

#### خطأ: "Permission denied"
**الحل:** أضف RLS Policies للجداول الجديدة

#### خطأ: "Storage bucket not found"
**الحل:** أنشئ bucket باسم `documents` في Supabase Storage

### 8. إضافة RLS Policies (مطلوب)

قم بتشغيل هذا SQL:

```sql
-- RLS Policies للجداول الجديدة
CREATE POLICY journal_entry_approvals_tenant_isolation 
ON journal_entry_approvals
FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY journal_entry_attachments_tenant_isolation 
ON journal_entry_attachments
FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY journal_entry_comments_tenant_isolation 
ON journal_entry_comments
FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY cost_centers_tenant_isolation 
ON cost_centers
FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY profit_centers_tenant_isolation 
ON profit_centers
FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY account_segments_tenant_isolation 
ON account_segments
FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY currency_exchange_rates_tenant_isolation 
ON currency_exchange_rates
FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY account_reconciliations_tenant_isolation 
ON account_reconciliations
FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
```

### 9. إعداد Storage Bucket (للمرفقات)

في Supabase Dashboard:
1. اذهب إلى Storage
2. أنشئ bucket جديد باسم `documents`
3. فعّل Public Access (أو أضف Policies حسب الحاجة)

### 10. Checklist النهائي

- [ ] جميع الجداول موجودة (10 جداول)
- [ ] جميع الدوال موجودة (10 دوال)
- [ ] RLS Policies مفعلة
- [ ] Storage Bucket `documents` موجود
- [ ] صفحة القيود تعمل بدون أخطاء
- [ ] زر Batch Post يعمل
- [ ] تبويبات View Entry تظهر
- [ ] صفحة Account Statement تعمل
- [ ] Export (Excel/PDF) يعمل
- [ ] لا توجد أخطاء في Console

## ملاحظات مهمة

1. **Tenant ID**: تأكد من أن `app.current_tenant_id` مضبوط بشكل صحيح
2. **User ID**: تأكد من أن `app.current_user_id` مضبوط للموافقات
3. **Storage**: تأكد من إعداد Storage Policies للمرفقات

## في حالة وجود مشاكل

1. راجع Console المتصفح للأخطاء
2. راجع Supabase Logs
3. تحقق من RLS Policies
4. تأكد من تطبيق جميع ملفات SQL

