# Bug Fix: Config Import Error

## 🐛 المشكلة

**Error:**
```
process-costing-service.ts:7 Uncaught SyntaxError: The requested module '/src/lib/config.ts' does not provide an export named 'config'
```

**السبب:**
- `src/lib/config.ts` لا يصدر `config` مباشرة
- يصدر `loadConfig()` و `getConfig()` فقط
- `process-costing-service.ts` كان يستورد `config` مباشرة

## ✅ الحل

تم تحديث `src/services/process-costing-service.ts`:

**قبل:**
```typescript
import { config } from '@/lib/config'
// ...
const orgId = config.ORG_ID
```

**بعد:**
```typescript
import { loadConfig } from '@/lib/config'
// ...
const config = await loadConfig()
const orgId = config.ORG_ID
```

## 📝 التغييرات

1. ✅ تغيير الاستيراد من `config` إلى `loadConfig`
2. ✅ إضافة `await loadConfig()` في كل دالة تستخدم `config`
3. ✅ تحديث 3 مواضع:
   - `applyLaborTime()`
   - `applyOverhead()`
   - `upsertStageCost()`

## ✅ النتيجة

- ✅ الخطأ تم إصلاحه
- ✅ التطبيق يجب أن يعمل الآن
- ✅ لا توجد أخطاء في Console

---

**Date:** [Date]  
**Status:** ✅ Fixed

