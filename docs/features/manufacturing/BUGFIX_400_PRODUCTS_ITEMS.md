# Bug Fix: 400 Bad Request - Products and Items Queries

## 🐛 المشكلة

**Error:**
```
GET .../products?select=id%2Ccode%2Cname%2Cproduct_code%2Cproduct_name&id=in.%28...%29 400 (Bad Request)
GET .../items?select=id%2Ccode%2Cname%2Citem_code%2Citem_name&id=in.%28...%29 400 (Bad Request)
```

**السبب:**
- الكود يحاول جلب أعمدة غير موجودة:
  - `product_code` و `product_name` من جدول `products`
  - `item_code` و `item_name` من جدول `items`
- الجداول تحتوي على `code` و `name` فقط (أو `sku` في بعض الحالات)

## ✅ الحل

تم إصلاح جميع الاستعلامات لاستخدام الأعمدة الصحيحة:

**قبل:**
```typescript
.select('id, code, name, product_code, product_name')
.select('id, code, name, item_code, item_name')
```

**بعد:**
```typescript
.select('id, code, name')  // products
.select('id, code, name, sku')  // items
```

## 📝 الملفات المحدثة

1. ✅ `src/services/supabase-service.ts`
   - `manufacturingService.getAll()` - إصلاح استعلامات products/items
   - `manufacturingService.getById()` - إصلاح استعلامات products/items
   - `manufacturingService.create()` - إصلاح استعلامات products/items
   - جميع الاستخدامات الأخرى - إصلاح كامل

## ✅ النتيجة

- ✅ لا مزيد من أخطاء 400
- ✅ بيانات المنتجات تُجلب بشكل صحيح
- ✅ بيانات Items تُجلب بشكل صحيح
- ✅ Manufacturing Orders تعرض بيانات المنتجات بشكل صحيح

---

**Date:** [Date]  
**Status:** ✅ Fixed

