# تحسينات نظام القيود المحاسبية
# Journal Entries Enhancements

## الميزات المضافة ✅

### 1. Batch Posting (الترحيل المجمع)
- ترحيل قيود متعددة دفعة واحدة
- عرض نتائج الترحيل لكل قيد
- معالجة الأخطاء بشكل فردي

**الملفات:**
- `src/features/accounting/journal-entries/components/BatchPostDialog.tsx`
- `sql/02_gl_posting_functions_enhanced.sql` - دالة `batch_post_journal_entries`

### 2. Auto-numbering Enhanced (ترقيم محسّن)
- تنسيق أفضل: `PREFIX-YYYY-NNNNNN`
- دعم السنوات المختلفة
- Sequences منفصلة لكل سنة

**الملفات:**
- `sql/02_gl_posting_functions_enhanced.sql` - دالة `generate_entry_number_enhanced`

### 3. Approval Workflow (سير عمل الموافقات)
- موافقات متعددة المستويات
- قواعد موافقات قابلة للتكوين
- تتبع حالة كل مستوى موافقة

**الجداول:**
- `journal_entry_approvals` - سجلات الموافقات
- `journal_approval_rules` - قواعد الموافقات

**الملفات:**
- `src/features/accounting/journal-entries/components/ApprovalWorkflow.tsx`
- `src/services/accounting/journal-service.ts` - دوال الموافقات

### 4. Reversal Entries (القيود العكسية)
- عكس القيود المرحّلة
- تتبع القيود المعكوسة
- سبب العكس

**الملفات:**
- `sql/02_gl_posting_functions_enhanced.sql` - دالة `reverse_journal_entry_enhanced`
- `src/services/accounting/journal-service.ts` - دالة `reverseEntry`

### 5. Document Attachments (المرفقات)
- رفع ملفات للقيود
- عرض وتحميل المرفقات
- حذف المرفقات

**الجداول:**
- `journal_entry_attachments` - المرفقات

**الملفات:**
- `src/features/accounting/journal-entries/components/AttachmentsSection.tsx`
- `src/services/accounting/journal-service.ts` - دوال المرفقات

### 6. Comments & Notes (التعليقات والملاحظات)
- إضافة تعليقات على القيود
- أنواع مختلفة: Note, Comment, Internal
- حذف التعليقات

**الجداول:**
- `journal_entry_comments` - التعليقات

**الملفات:**
- `src/features/accounting/journal-entries/components/CommentsSection.tsx`
- `src/services/accounting/journal-service.ts` - دوال التعليقات

## الملفات الجديدة

### SQL
- `sql/02_gl_posting_functions_enhanced.sql` - دوال محسّنة

### Services
- `src/services/accounting/journal-service.ts` - خدمة القيود المحسّنة

### Components
- `src/features/accounting/journal-entries/components/BatchPostDialog.tsx`
- `src/features/accounting/journal-entries/components/ApprovalWorkflow.tsx`
- `src/features/accounting/journal-entries/components/AttachmentsSection.tsx`
- `src/features/accounting/journal-entries/components/CommentsSection.tsx`

### UI Components
- `src/components/ui/textarea.tsx` - مكون Textarea

## كيفية الاستخدام

### 1. تطبيق SQL
```sql
-- نفّذ الملف في Supabase SQL Editor
\i sql/02_gl_posting_functions_enhanced.sql
```

### 2. استخدام Batch Posting
1. افتح صفحة القيود المحاسبية
2. اضغط على زر "ترحيل مجمع"
3. اختر القيود المراد ترحيلها
4. اضغط "ترحيل المحدد"

### 3. استخدام الموافقات
1. افتح قيد مرحّل
2. انتقل إلى تبويب "الموافقات"
3. اضغط "موافقة" على المستوى المطلوب
4. أضف تعليقات (اختياري)

### 4. إضافة المرفقات
1. افتح قيد
2. انتقل إلى تبويب "المرفقات"
3. اضغط "رفع ملف"
4. اختر الملف

### 5. إضافة التعليقات
1. افتح قيد
2. انتقل إلى تبويب "التعليقات"
3. اختر نوع التعليق
4. اكتب التعليق واضغط "إضافة"

### 6. عكس القيد
1. افتح قائمة القيود
2. اضغط على زر "عكس" بجانب القيد المرحّل
3. أكد العملية

## ملاحظات مهمة

1. **Storage Bucket**: تأكد من إنشاء bucket باسم `documents` في Supabase Storage للمرفقات
2. **RLS Policies**: يجب إضافة RLS policies للجداول الجديدة
3. **Permissions**: تأكد من إعداد الصلاحيات للموافقات

## الخطوات التالية

- [ ] إضافة RLS policies للجداول الجديدة
- [ ] إعداد Approval Rules افتراضية
- [ ] إضافة إشعارات البريد الإلكتروني للموافقات
- [ ] إضافة Budget vs Actual comparison

