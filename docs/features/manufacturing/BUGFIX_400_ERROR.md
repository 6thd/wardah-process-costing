# Bug Fix: 400 Error in Manufacturing Orders Query

## 🐛 المشكلة

**Error:**
```
Failed to load resource: the server responded with a status of 400
manufacturing_orders?select=*%2Citem%3Aproducts%28*%29
```

**السبب:**
- استعلام `manufacturingService.create` كان يستخدم join مباشر:
  ```typescript
  .select(`
    *,
    item:products(*)
  `)
  ```
- العلاقة `item:products` غير موجودة أو غير صحيحة في Supabase
- هذا يسبب خطأ 400 Bad Request

## ✅ الحل

تم إصلاح `manufacturingService.create` لاستخدام نفس النهج المستخدم في `getAll`:
1. إدراج البيانات بدون joins أولاً
2. جلب بيانات المنتجات بشكل منفصل إذا لزم الأمر
3. معالجة الأخطاء بشكل أنيق

**قبل:**
```typescript
const { data, error } = await supabase
  .from('manufacturing_orders')
  .insert(order)
  .select(`
    *,
    item:products(*)
  `)
  .single()
```

**بعد:**
```typescript
// Insert without joins first
const { data, error } = await supabase
  .from('manufacturing_orders')
  .insert(order)
  .select('*')
  .single()

// Handle missing relationship gracefully
if (error && (error.code === 'PGRST200' || error.message?.includes('Could not find a relationship'))) {
  // Try again without joins
  // ...
}

// Try to load product data separately if needed
if (data) {
  const itemId = (data as any).item_id || (data as any).product_id
  if (itemId) {
    // Fetch from products or items separately
    // ...
  }
}
```

## 📝 الملفات المحدثة

1. ✅ `src/services/supabase-service.ts`
   - `manufacturingService.create()` - إصلاح كامل

## ✅ النتيجة

- ✅ لا مزيد من أخطاء 400
- ✅ البيانات تُحفظ بشكل صحيح
- ✅ بيانات المنتجات تُجلب بشكل منفصل إذا لزم الأمر
- ✅ معالجة أنيقة للأخطاء

---

**Date:** [Date]  
**Status:** ✅ Fixed

