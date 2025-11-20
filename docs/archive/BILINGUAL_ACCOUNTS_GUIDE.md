# دليل الحسابات ثنائية اللغة | Bilingual Accounts Guide

## 📋 نظرة عامة | Overview

تم تفعيل نظام الحسابات ثنائي اللغة (عربي/إنجليزي) في نظام وردة ERP. يتيح هذا النظام للمستخدمين رؤية أسماء الحسابات باللغة التي يختارونها.

The bilingual accounts system (Arabic/English) has been activated in Wardah ERP. This system allows users to view account names in their preferred language.

---

## ✅ ما تم إنجازه | Completed Work

### 1. قاعدة البيانات | Database

#### إضافة عمود الترجمة | Translation Column Addition
```sql
ALTER TABLE gl_accounts 
ADD COLUMN IF NOT EXISTS name_en VARCHAR(255);
```

#### الترجمة الكاملة | Complete Translation
- **إجمالي الحسابات | Total Accounts**: 190
- **حسابات مُترجمة | Translated Accounts**: 190 (100%)
- **حسابات متبقية | Remaining Accounts**: 0

**ملفات الترجمة | Translation Files**:
- `add-english-names.sql` - الدفعة الأولى (90 حساب)
- `complete-translations.sql` - باقي الحسابات (~100 حساب)
- `complete-all-translations.sql` - جميع الحسابات المتبقية (123 حساب)
- `translation-report.sql` - تقرير التحقق

### 2. الواجهة الأمامية | Frontend

#### تحديثات TypeScript

**src/lib/supabase.ts**
```typescript
export interface GLAccount {
    id: string;
    code: string;
    name: string;
    name_ar?: string;
    name_en?: string;  // ✅ تمت الإضافة
    category?: string;
    normal_balance?: 'Debit' | 'Credit';
    allow_posting?: boolean;
    is_active?: boolean;
    children?: GLAccount[];
    parent_code?: string;
    org_id: string;
    parent_id: string | null;
}
```

**src/features/general-ledger/index.tsx**

##### عرض شجرة الحسابات | Account Tree Display
```tsx
// قبل | Before:
<p className="font-medium">{account.code} - {account.name_ar || account.name}</p>

// بعد | After:
<p className="font-medium">
  {account.code} - {isRTL ? (account.name_ar || account.name) : (account.name_en || account.name)}
</p>
```

##### رسالة الحذف | Delete Confirmation
```tsx
// قبل | Before:
window.confirm(`هل أنت متأكد من حذف الحساب "${account.name_ar || account.name}"؟`)

// بعد | After:
const accountName = isRTL ? (account.name_ar || account.name) : (account.name_en || account.name);
window.confirm(`هل أنت متأكد من حذف الحساب "${accountName}"؟`)
```

##### التصدير لـ Excel | Excel Export
```tsx
const worksheetData = flatData.map(item => ({
    'المستوى': ' '.repeat(item.level * 2) + item.code,
    'الاسم العربي': item.name_ar || item.name,
    'الاسم الانجليزي': item.name_en || item.name,  // ✅ تم التحديث
    'النوع': item.category,
}));
```

##### التصدير لـ PDF | PDF Export
```tsx
const accountNameField = isRTL ? 'name_ar' : 'name_en';
const tableData = flatData.map(item => [
    ' '.repeat(item.level * 2) + item.code,
    item[accountNameField] || item.name,
    item.category,
]);

(doc as any).autoTable({
    head: [[
        isRTL ? 'رمز الحساب' : 'Account Code', 
        isRTL ? 'اسم الحساب' : 'Account Name', 
        isRTL ? 'النوع' : 'Category'
    ]],
    body: tableData,
    styles: { font: 'Arial', halign: isRTL ? 'right' : 'left' },
    headStyles: { halign: isRTL ? 'right' : 'left' },
});
```

---

## 🎯 كيفية الاستخدام | How to Use

### للمستخدم النهائي | For End Users

1. **تغيير اللغة | Change Language**
   - انقر على أيقونة اللغة في شريط العنوان
   - Click the language icon in the header
   - اختر العربية أو English
   - Choose Arabic or English

2. **عرض الحسابات | View Accounts**
   - انتقل إلى: دفتر الأستاذ > شجرة الحسابات
   - Navigate to: General Ledger > Chart of Accounts
   - ستظهر الأسماء باللغة المختارة تلقائياً
   - Names will appear in the selected language automatically

3. **التصدير | Export**
   - ملف Excel سيحتوي على كلا اللغتين
   - Excel file will contain both languages
   - ملف PDF سيستخدم اللغة المختارة فقط
   - PDF file will use only the selected language

---

## 📊 إحصائيات الترجمة | Translation Statistics

### توزيع الحسابات حسب الفئة | Accounts by Category

| الفئة | Category | العدد | Count |
|------|----------|------|-------|
| أصول | Assets | 100 | 100 |
| خصوم | Liabilities | 32 | 32 |
| حقوق ملكية | Equity | 14 | 14 |
| إيرادات | Revenue | 11 | 11 |
| مصروفات | Expenses | 33 | 33 |
| **الإجمالي** | **Total** | **190** | **190** |

### أمثلة من الترجمات | Translation Examples

| الكود | العربي | English |
|------|--------|---------|
| 100000 | أصول | Assets |
| 110100 | النقد وما في حكمه | Cash and Cash Equivalents |
| 110201 | بنك الراجحي - حساب جاري | Al Rajhi Bank - Current Account |
| 130101 | خامات - حبيبات PP | Raw Materials - PP Granules |
| 150101 | آلات البثق | Extrusion Machines |
| 517100 | مركز تكلفة الخلط والتحضير | Mixing and Preparation Cost Center |
| 540000 | تكلفة البضاعة المباعة | Cost of Goods Sold |
| 591100 | انحراف سعر المواد (PPV) | Material Price Variance (PPV) |

---

## 🔍 التحقق من الترجمة | Verify Translation

### في Supabase SQL Editor

```sql
-- تشغيل تقرير التحقق | Run verification report
\i translation-report.sql

-- أو استعلام مباشر | Or direct query
SELECT 
    COUNT(*) as total_accounts,
    COUNT(CASE WHEN name_en IS NOT NULL AND name_en != name THEN 1 END) as translated,
    COUNT(CASE WHEN name_en IS NULL OR name_en = name THEN 1 END) as remaining
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';
```

### النتيجة المتوقعة | Expected Result
```
total_accounts | translated | remaining
---------------|------------|----------
     190       |    190     |    0
```

---

## 🛠️ الصيانة المستقبلية | Future Maintenance

### إضافة حساب جديد | Adding New Account

عند إضافة حساب جديد، تأكد من:
When adding a new account, make sure to:

1. **ملء الحقول الثلاثة | Fill all three fields**:
   - `name` - الاسم الأساسي (عادةً إنجليزي)
   - `name_ar` - الاسم العربي
   - `name_en` - الاسم الإنجليزي

2. **استخدام المصطلحات المحاسبية الصحيحة | Use correct accounting terminology**:
   - راجع GAAP/IFRS للمصطلحات القياسية
   - Review GAAP/IFRS for standard terms
   - استشر المحاسب المسؤول
   - Consult the responsible accountant

### مثال على إدخال SQL | SQL Insert Example

```sql
INSERT INTO gl_accounts (
    code, 
    name, 
    name_ar, 
    name_en, 
    category, 
    normal_balance, 
    org_id
) VALUES (
    '110501',
    'Petty Cash - Marketing',  -- الاسم الأساسي
    'صندوق صغير - تسويق',      -- الاسم العربي
    'Petty Cash - Marketing',  -- الاسم الإنجليزي
    'ASSET',
    'Debit',
    '00000000-0000-0000-0000-000000000001'
);
```

---

## 📝 ملاحظات تقنية | Technical Notes

### آلية العرض | Display Mechanism

```typescript
// منطق اختيار اللغة | Language selection logic
const displayName = isRTL 
    ? (account.name_ar || account.name)  // عربي: استخدم name_ar أو ارجع لـ name
    : (account.name_en || account.name); // English: Use name_en or fallback to name
```

### ترتيب الأولوية | Priority Order

**للعربية | For Arabic**:
1. `name_ar` (الاسم العربي الكامل)
2. `name` (الاسم الأساسي كبديل)

**للإنجليزية | For English**:
1. `name_en` (English translation)
2. `name` (Base name as fallback)

---

## 🐛 استكشاف الأخطاء | Troubleshooting

### المشكلة: الأسماء لا تتغير عند تبديل اللغة
**Problem: Names don't change when switching language**

**الحل | Solution**:
1. تحقق من أن المتصفح قام بتحديث الصفحة
   - Verify browser refreshed the page
2. افحص أن `name_en` موجود في قاعدة البيانات
   - Check that `name_en` exists in database
3. راجع console للأخطاء
   - Review console for errors

```javascript
// في console المتصفح | In browser console
console.log('Current language:', i18n.language);
```

### المشكلة: حساب جديد لا يظهر بالإنجليزية
**Problem: New account doesn't show in English**

**الحل | Solution**:
تأكد من ملء حقل `name_en` عند الإضافة:
Make sure to fill `name_en` field when adding:

```sql
UPDATE gl_accounts 
SET name_en = 'English Name Here'
WHERE code = 'ACCOUNT_CODE';
```

---

## 📚 الملفات ذات الصلة | Related Files

### قاعدة البيانات | Database
- `add-english-names.sql` - ترجمات دفعة 1
- `complete-translations.sql` - ترجمات دفعة 2  
- `complete-all-translations.sql` - ترجمات دفعة 3
- `translation-report.sql` - تقرير التحقق

### الكود البرمجي | Source Code
- `src/lib/supabase.ts` - تعريفات الأنواع
- `src/features/general-ledger/index.tsx` - واجهة شجرة الحسابات

### التوثيق | Documentation
- `BILINGUAL_ACCOUNTS_GUIDE.md` - هذا الملف
- `FINAL_SUMMARY.md` - ملخص المشروع الشامل

---

## ✅ قائمة التحقق | Checklist

- [x] إضافة عمود `name_en` للجدول
- [x] ترجمة جميع الـ 190 حساب
- [x] تحديث واجهة TypeScript
- [x] تحديث عرض شجرة الحسابات
- [x] تحديث رسالة الحذف
- [x] تحديث التصدير لـ Excel
- [x] تحديث التصدير لـ PDF
- [x] اختبار تبديل اللغة
- [x] توثيق الميزة

---

## 🎉 الخلاصة | Summary

نظام الحسابات الآن يدعم بشكل كامل اللغتين العربية والإنجليزية مع:
The accounts system now fully supports both Arabic and English with:

✅ **190 حساب مُترجم بالكامل** | 190 fully translated accounts  
✅ **تبديل تلقائي للغة** | Automatic language switching  
✅ **تصدير ثنائي اللغة** | Bilingual export  
✅ **واجهة محدثة بالكامل** | Fully updated interface  

---

**تاريخ الإنجاز | Completion Date**: October 29, 2025  
**الإصدار | Version**: 1.0  
**الحالة | Status**: ✅ مكتمل | Complete
