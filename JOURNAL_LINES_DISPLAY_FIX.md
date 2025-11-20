# 🔧 إصلاح عرض بنود القيد

## 🔍 المشكلة من الصورة:

```
الحساب: 5001 -    (0.00 مدين، 0.00 دائن)
الحساب: 1130 -    (0.00 مدين، 0.00 دائن)
```

**المشاكل**:
1. ❌ اسم الحساب مفقود (يظهر فقط الكود)
2. ❌ جميع المبالغ = 0.00
3. ❌ البنود تُحفظ في `gl_entry_lines` لكن لا تُعرض بشكل صحيح

---

## 🔍 التشخيص:

### المشكلة المحتملة 1: البيانات غير محفوظة

عند **إنشاء القيد**:
- ✅ تظهر الحسابات في النموذج
- ❌ لكن عند الحفظ، القيم تُفقد أو تُحفظ كـ 0

**الحل**: تحقق من `handleSave` في `index.tsx`

### المشكلة المحتملة 2: account_name مفقود

عند **عرض القيد**:
- ✅ `account_code` موجود (5001, 1130)
- ❌ `account_name` مفقود (فراغ بعد -)

**الحل**: تحقق من `getEntryWithDetails` في `journal-service.ts`

---

## 🔍 الفحص المطلوب:

### 1. افحص البيانات المحفوظة:

```sql
-- في Supabase SQL Editor
SELECT 
  l.line_number,
  l.account_id,
  l.debit,
  l.credit,
  l.description,
  a.code AS account_code,
  a.name AS account_name
FROM gl_entry_lines l
LEFT JOIN gl_accounts a ON a.id = l.account_id
WHERE l.entry_id = 'YOUR_ENTRY_ID'
ORDER BY l.line_number;
```

**استبدل `YOUR_ENTRY_ID`** بـ ID القيد من الصورة.

**النتيجة المتوقعة**:
```
line_number | account_id | debit    | credit   | account_code | account_name
------------|------------|----------|----------|--------------|-------------
1           | uuid-xxx   | 1560.00  | 0.00     | 5001         | اسم الحساب
2           | uuid-yyy   | 0.00     | 1560.00  | 1130         | اسم الحساب
```

---

## ✅ الحلول:

### إذا كانت debit/credit = 0 في قاعدة البيانات:

**المشكلة**: البيانات لم تُحفظ بشكل صحيح.

**الحل**: تحقق من `handleSave` في `index.tsx`:

```typescript
// يجب أن يكون:
debit: Number(line.debit) || 0,
credit: Number(line.credit) || 0,

// وليس:
debit: line.debit,  // قد يكون string
credit: line.credit,
```

### إذا كانت account_name فارغة:

**المشكلة**: `gl_accounts` لا يحتوي على `name` أو الـ join فاشل.

**الحل**: تحقق من `gl_accounts`:

```sql
SELECT id, code, name, name_ar, name_en
FROM gl_accounts
WHERE code IN ('5001', '1130');
```

---

## 🎯 الإصلاح المباشر:

### 1. تحديث `journal-service.ts` لضمان جلب الأسماء:

ملف: `src/services/accounting/journal-service.ts`

في `getEntryWithDetails`:

```typescript
// Fetch account details for each line
for (const line of lines) {
  const { data: account } = await supabase
    .from('gl_accounts')
    .select('code, name, name_ar')
    .eq('id', line.account_id)
    .single();
  
  if (account) {
    line.account_code = account.code;
    line.account_name = account.name;
    line.account_name_ar = account.name_ar || account.name;
  }
}
```

### 2. تحديث `index.tsx` لضمان حفظ الأرقام:

ملف: `src/features/accounting/journal-entries/index.tsx`

في `handleSave`:

```typescript
lines: formData.lines.map((line, index) => ({
  line_number: index + 1,
  account_id: line.account_id,
  debit: Number(line.debit) || 0,  // تأكد من التحويل لـ Number
  credit: Number(line.credit) || 0,
  currency_code: 'SAR',
  description: line.description,
}))
```

---

## 📊 التحقق:

بعد الإصلاح، يجب أن ترى:

```
الحساب: 5001 - المصروفات العمومية    (1,560.00 مدين، 0.00 دائن)
الحساب: 1130 - النقدية بالصندوق       (0.00 مدين، 1,560.00 دائن)
```

---

## 🚀 الخطوات:

1. ✅ نفّذ الاستعلام SQL لفحص البيانات المحفوظة
2. ✅ شاركني النتيجة لأحدد المشكلة بدقة
3. ✅ سأصلح الكود المناسب

---

**شاركني نتيجة الاستعلام SQL!** 🔍

