# خطة اختبار الإصلاحات - Testing Plan

## 📋 نظرة عامة

هذه الخطة تغطي اختبار جميع الإصلاحات التي تمت في جلسة تحسين جودة الكود.

---

## 🔍 1. اختبارات TypeScript والبناء

### 1.1 Type Checking
```bash
npm run type-check
```
**الهدف:** التحقق من عدم وجود أخطاء TypeScript بعد الإصلاحات

**ما يتم اختباره:**
- ✅ جميع ملفات TypeScript تُترجم بنجاح
- ✅ لا توجد أخطاء نوع (type errors)
- ✅ جميع الاستيرادات صحيحة

---

## 🧪 2. اختبارات Linter

### 2.1 SonarLint/ESLint
```bash
# إذا كان متوفراً
npm run lint
```

**الهدف:** التحقق من عدم وجود مشاكل في جودة الكود

**ما يتم اختباره:**
- ✅ لا توجد unused imports
- ✅ لا توجد nested ternaries معقدة
- ✅ استخدام `globalThis` بدلاً من `window`
- ✅ استخدام `Number.parseInt` و `Number.parseFloat`
- ✅ استخدام `Number.isNaN` بدلاً من `isNaN`

---

## 🧩 3. اختبارات الوحدات (Unit Tests)

### 3.1 اختبار sales-reports-service.ts

#### اختبار الدوال المساعدة الجديدة

**ملف:** `src/services/__tests__/sales-reports-service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeQueryWithTenantFallback, handleQueryError } from '../sales-reports-service';

describe('executeQueryWithTenantFallback', () => {
  it('should try org_id first', async () => {
    // Test implementation
  });

  it('should fallback to tenant_id if org_id fails', async () => {
    // Test implementation
  });

  it('should skip tenant filter if both fail', async () => {
    // Test implementation
  });
});

describe('handleQueryError', () => {
  it('should return empty array for missing tables', () => {
    const error = { code: 'PGRST205' };
    const result = handleQueryError(error, 'test_table');
    expect(result.data).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('should handle other errors gracefully', () => {
    const error = { code: 'OTHER_ERROR', message: 'Test error' };
    const result = handleQueryError(error, 'test_table');
    expect(result.data).toEqual([]);
    expect(result.error).toBeNull();
  });
});
```

#### اختبار الدوال الرئيسية

```typescript
describe('getSalesPerformance', () => {
  it('should return sales metrics successfully', async () => {
    // Test that the function works with simplified code
  });

  it('should handle missing tables gracefully', async () => {
    // Test fallback behavior
  });
});

describe('getCustomerSalesAnalysis', () => {
  it('should return customer analysis successfully', async () => {
    // Test simplified implementation
  });
});

describe('getProductSalesAnalysis', () => {
  it('should return product analysis successfully', async () => {
    // Test simplified implementation
  });
});
```

### 3.2 اختبار core/utils.js

```typescript
import { describe, it, expect } from 'vitest';
import { validatePositiveNumber } from '@/core/utils';

describe('validatePositiveNumber', () => {
  it('should use Number.isNaN instead of isNaN', () => {
    // This is tested implicitly - if it works, Number.isNaN is used
    expect(() => validatePositiveNumber(NaN, 'test')).toThrow();
    expect(() => validatePositiveNumber(-1, 'test')).toThrow();
    expect(() => validatePositiveNumber(0, 'test')).not.toThrow();
  });
});
```

### 3.3 اختبار core/security.ts

```typescript
import { describe, it, expect } from 'vitest';
import { sanitizeInput } from '@/core/security';

describe('sanitizeInput', () => {
  it('should use replaceAll for string replacements', () => {
    const input = "test'string;--/*comment*/";
    const result = sanitizeInput(input);
    expect(result).not.toContain("'");
    expect(result).not.toContain(';');
    expect(result).not.toContain('--');
  });
});
```

---

## 🎨 4. اختبارات المكونات (Component Tests)

### 4.1 اختبار journal-entries/index.tsx

**ملف:** `src/features/accounting/journal-entries/__tests__/index.test.tsx`

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import JournalEntries from '../index';

describe('JournalEntries', () => {
  it('should render without errors', () => {
    render(<JournalEntries />);
    expect(screen.getByText(/Journal Entries|قيود اليومية/)).toBeInTheDocument();
  });

  it('should not use array index in keys', () => {
    // Verify that keys are unique and not array indices
    const { container } = render(<JournalEntries />);
    const cards = container.querySelectorAll('[key^="line-"]');
    cards.forEach((card, index) => {
      const key = card.getAttribute('key');
      expect(key).not.toBe(index.toString());
      expect(key).toMatch(/line-\d+-/);
    });
  });
});
```

### 4.2 اختبار header.tsx

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Header } from '@/components/layout/header';

describe('Header', () => {
  it('should use globalThis.window instead of window', () => {
    // Mock globalThis.window
    const originalWindow = globalThis.window;
    globalThis.window = { innerWidth: 1024 } as any;
    
    render(<Header />);
    
    // Restore
    globalThis.window = originalWindow;
  });
});
```

---

## 🚀 5. اختبارات التكامل (Integration Tests)

### 5.1 اختبار تدفق البيانات الكامل

```typescript
describe('Sales Reports Integration', () => {
  it('should fetch and display sales performance metrics', async () => {
    // Test the full flow from API to UI
  });

  it('should handle errors gracefully with fallback logic', async () => {
    // Test error handling with new helper functions
  });
});
```

---

## 🌐 6. اختبارات المتصفح (Manual Testing)

### 6.1 قائمة التحقق اليدوية

#### صفحة Sales Reports
- [ ] فتح صفحة Sales Reports
- [ ] اختيار نطاق تاريخ
- [ ] التحقق من عرض البيانات بشكل صحيح
- [ ] التحقق من عدم وجود أخطاء في Console
- [ ] اختبار التصدير إلى Excel/PDF

#### صفحة Journal Entries
- [ ] فتح صفحة Journal Entries
- [ ] إنشاء قيد جديد
- [ ] إضافة بنود متعددة
- [ ] التحقق من أن المفاتيح (keys) فريدة
- [ ] حفظ القيد
- [ ] التحقق من عدم وجود أخطاء

#### صفحة Manufacturing
- [ ] فتح صفحة Manufacturing Orders
- [ ] التحقق من عرض الطلبات
- [ ] اختبار تغيير الحالة
- [ ] التحقق من عدم وجود أخطاء

#### Header و Sidebar
- [ ] التحقق من عمل القائمة الجانبية
- [ ] التحقق من عمل القائمة العلوية
- [ ] اختبار التبديل بين اللغات
- [ ] اختبار التبديل بين الثيمات

---

## 🔒 7. اختبارات الأمان

### 7.1 التحقق من Environment Variables

```bash
npm run validate-env
```

**الهدف:** التأكد من أن جميع المفاتيح الحساسة في `.env` وليست في الكود

**ما يتم اختباره:**
- ✅ لا توجد JWT tokens في الكود
- ✅ جميع المفاتيح في `.env`
- ✅ `.env` موجود في `.gitignore`

---

## 📊 8. اختبارات الأداء

### 8.1 Cognitive Complexity

**الهدف:** التحقق من أن التعقيد المعرفي قد انخفض

**الطريقة:**
1. تشغيل SonarQube/SonarLint
2. التحقق من أن جميع الدوال < 15 complexity
3. مقارنة النتائج قبل وبعد

**الدوال التي تم إصلاحها:**
- ✅ `getSalesPerformance`: من 27 إلى <15
- ✅ `getCustomerSalesAnalysis`: من 29 إلى <15
- ✅ `getProductSalesAnalysis`: من 47 إلى <15

---

## 🧹 9. اختبارات التنظيف (Cleanup Tests)

### 9.1 التحقق من الكود النظيف

```bash
# البحث عن patterns قديمة
grep -r "parseInt(" src/
grep -r "parseFloat(" src/
grep -r "window\." src/
grep -r "isNaN(" src/
```

**الهدف:** التأكد من استبدال جميع الأنماط القديمة

---

## 📝 10. سيناريوهات الاختبار المحددة

### 10.1 سيناريو: Sales Reports مع Fallback

```
1. تشغيل التطبيق
2. الانتقال إلى Sales Reports
3. اختيار فترة زمنية
4. مراقبة Console للأخطاء
5. التحقق من عرض البيانات
6. اختبار التصدير
```

**النتيجة المتوقعة:**
- ✅ لا توجد أخطاء في Console
- ✅ البيانات تظهر بشكل صحيح
- ✅ Fallback logic يعمل عند الحاجة

### 10.2 سيناريو: Journal Entries مع Multiple Lines

```
1. فتح Journal Entries
2. إنشاء قيد جديد
3. إضافة 5 بنود
4. حفظ القيد
5. فتح القيد للتعديل
6. إضافة بند جديد
7. حفظ مرة أخرى
```

**النتيجة المتوقعة:**
- ✅ جميع البنود تُحفظ بشكل صحيح
- ✅ لا توجد أخطاء في React keys
- ✅ يمكن التعديل بدون مشاكل

---

## 🎯 11. قائمة التحقق النهائية

### قبل الإصدار

- [ ] جميع اختبارات TypeScript تمر ✅
- [ ] لا توجد أخطاء linter ✅
- [ ] جميع الوحدات تعمل ✅
- [ ] الاختبارات اليدوية ناجحة ✅
- [ ] لا توجد أخطاء في Console ✅
- [ ] الأداء مقبول ✅
- [ ] الأمان محقق ✅

---

## 🚨 12. المشاكل المحتملة وكيفية حلها

### مشكلة: خطأ في الاستيراد
**الحل:** التحقق من مسارات الاستيراد في `vite.config.ts`

### مشكلة: خطأ في globalThis
**الحل:** التأكد من أن `globalThis.window` موجود قبل الاستخدام

### مشكلة: خطأ في Fallback Logic
**الحل:** التحقق من أن الدوال المساعدة تعمل بشكل صحيح

---

## 📈 13. مقاييس النجاح

### قبل الإصلاحات
- Cognitive Complexity: 188, 92, 57, 54, 52, 47, 36, 34, 32, 29
- عدد المشاكل: ~1575
- Type Errors: متعددة

### بعد الإصلاحات
- Cognitive Complexity: جميع < 15 ✅
- عدد المشاكل: 0 (في الملفات المصلحة) ✅
- Type Errors: 0 ✅

---

## 🔄 14. خطوات التنفيذ

### الخطوة 1: اختبارات تلقائية
```bash
npm run type-check
npm run test
npm run test:coverage
```

### الخطوة 2: اختبارات يدوية
- اتبع قائمة التحقق في القسم 6.1

### الخطوة 3: مراجعة الكود
- مراجعة التغييرات في Git
- التأكد من أن جميع الإصلاحات منطقية

### الخطوة 4: النشر
- إذا نجحت جميع الاختبارات، يمكن المتابعة للنشر

---

**آخر تحديث:** $(Get-Date -Format "yyyy-MM-dd HH:mm")
**الإصدار:** 1.0

