# 📊 Inventory Valuation System - نظام تقييم المخزون

## نظرة عامة

نظام متكامل لتقييم المخزون يدعم ثلاث طرق محاسبية معتمدة دولياً:
- **FIFO** - First In First Out (الوارد أولاً صادر أولاً)
- **LIFO** - Last In First Out (الوارد أخيراً صادر أولاً)  
- **Weighted Average / AVCO** - المتوسط المرجح

---

## ✅ ما تم إنجازه

### 1. Classes و Services ✅
- ✅ `ValuationStrategy.ts` - Interface أساسي
- ✅ `FIFOValuation.ts` - تطبيق FIFO كامل
- ✅ `LIFOValuation.ts` - تطبيق LIFO كامل
- ✅ `WeightedAverageValuation.ts` - تطبيق AVCO كامل
- ✅ `ValuationFactory.ts` - Factory pattern للتبديل بين الطرق
- ✅ `valuation.ts` - Integration layer مع نظام المخزون

### 2. Database Schema ✅
- ✅ `01_valuation_methods_setup.sql` - SQL script كامل يتضمن:
  - إضافة `valuation_method` column للـ products
  - إضافة `stock_queue` JSONB لحفظ batches
  - إضافة `stock_value` لحفظ القيمة الإجمالية
  - Triggers للتحقق التلقائي
  - Functions مساعدة (get_product_batches, simulate_cogs)
  - Views للتقارير

---

## 🎯 كيف يعمل النظام

### FIFO - First In First Out
```typescript
// الوارد أولاً صادر أولاً
// مثال:
Queue: [
  {qty: 100, rate: 45}, // Oldest
  {qty: 50, rate: 55}   // Newest
]

// عند صرف 120 وحدة:
// 1. خذ 100 من الدفعة الأقدم (100 × 45 = 4,500)
// 2. خذ 20 من الدفعة التالية (20 × 55 = 1,100)
// COGS = 5,600 ريال
// Remaining: [{qty: 30, rate: 55}]
```

**الاستخدام الأمثل:**
- ✅ المواد الغذائية
- ✅ الأدوية
- ✅ أي منتج له تاريخ صلاحية
- ✅ متوافق مع IFRS و GAAP

### LIFO - Last In First Out
```typescript
// الوارد أخيراً صادر أولاً
// مثال:
Stack: [
  {qty: 100, rate: 45}, // Oldest
  {qty: 50, rate: 55}   // Newest - يُصرف أولاً
]

// عند صرف 70 وحدة:
// 1. خذ 50 من الدفعة الأحدث (50 × 55 = 2,750)
// 2. خذ 20 من الدفعة السابقة (20 × 45 = 900)
// COGS = 3,650 ريال
// Remaining: [{qty: 80, rate: 45}]
```

**الاستخدام الأمثل:**
- ⚠️ غير مقبول تحت IFRS
- ✅ مسموح في US GAAP
- 💡 ميزة ضريبية في بعض الحالات (COGS أعلى = ضريبة أقل)
- 📊 المنتجات غير القابلة للتلف

### Weighted Average (AVCO)
```typescript
// المتوسط المرجح
// مثال:
// الرصيد الحالي: 100 وحدة × 45 ريال = 4,500 ريال
// استلام: 50 وحدة × 55 ريال = 2,750 ريال

// الحساب:
newQty = 100 + 50 = 150 وحدة
newValue = 4,500 + 2,750 = 7,250 ريال
newRate = 7,250 ÷ 150 = 48.33 ريال/وحدة

// عند الصرف: يُستخدم نفس المتوسط (48.33) للجميع
```

**الاستخدام الأمثل:**
- ✅ الأكثر شيوعاً وبساطة
- ✅ متوافق مع جميع المعايير المحاسبية
- ✅ مناسب لمعظم الصناعات
- ✅ سهل الفهم والتطبيق

---

## 📝 طريقة الاستخدام

### 1. تطبيق Database Schema

```sql
-- نفذ على Supabase SQL Editor
\i sql/inventory/01_valuation_methods_setup.sql
```

### 2. استخدام في الكود

```typescript
import { 
  processIncomingStock, 
  processOutgoingStock,
  ValuationFactory 
} from '@/domain/inventory/valuation';

// مثال: استلام بضاعة
const product = {
  id: 'prod-123',
  code: 'RM-001',
  name: 'Raw Material',
  valuation_method: 'FIFO', // أو 'LIFO' أو 'Weighted Average'
  stock_quantity: 100,
  cost_price: 45,
  stock_queue: [{ qty: 100, rate: 45 }]
};

// استلام 50 وحدة بسعر 55 ريال
const incomingResult = await processIncomingStock(
  product,
  50,  // quantity
  55   // rate
);

console.log(incomingResult);
// {
//   newQty: 150,
//   newRate: 48.33,  // للـ AVCO
//   newValue: 7250,
//   newQueue: [...]  // batches حسب الطريقة
// }

// صرف 120 وحدة
const outgoingResult = await processOutgoingStock(
  {
    ...product,
    stock_quantity: incomingResult.newQty,
    stock_queue: incomingResult.newQueue
  },
  120  // quantity
);

console.log(outgoingResult);
// {
//   newQty: 30,
//   newRate: ...,
//   newValue: ...,
//   costOfGoodsSold: 5600  // COGS
// }
```

### 3. تغيير طريقة التقييم

```typescript
import { convertValuationMethod } from '@/domain/inventory/valuation';

// تحويل من AVCO إلى FIFO
const converted = await convertValuationMethod(
  product,
  'FIFO'
);

// ⚠️ ملاحظة: هذه عملية حرجة تؤثر على التقييم المالي
```

---

## 🔍 SQL Functions المتوفرة

### 1. الحصول على تفاصيل الدفعات
```sql
SELECT * FROM get_product_batches('product-id-here');

-- النتيجة:
-- batch_no | qty  | rate  | value  | age_days
-- 1        | 100  | 45.00 | 4500   | NULL
-- 2        | 50   | 55.00 | 2750   | NULL
```

### 2. محاكاة حساب COGS
```sql
SELECT * FROM simulate_cogs('product-id-here', 120);

-- النتيجة:
-- method            | cogs    | avg_rate | remaining_qty | remaining_value
-- Weighted Average  | 5799.60 | 48.33    | 30            | 1450.40
```

### 3. تقرير التقييم حسب الطريقة
```sql
SELECT * FROM vw_stock_valuation_by_method;

-- النتيجة:
-- valuation_method  | product_count | total_quantity | total_value | avg_unit_cost
-- Weighted Average  | 85            | 15000          | 750000      | 50.00
-- FIFO              | 20            | 5000           | 275000      | 55.00
-- LIFO              | 9             | 2000           | 95000       | 47.50
```

---

## 🎨 UI Components المطلوبة

### 1. Product Form - اختيار طريقة التقييم
```tsx
<select name="valuation_method">
  <option value="Weighted Average">
    المتوسط المرجح (الأكثر شيوعاً)
  </option>
  <option value="FIFO">
    الوارد أولاً صادر أولاً (للمواد القابلة للتلف)
  </option>
  <option value="LIFO">
    الوارد أخيراً صادر أولاً (محدود الاستخدام)
  </option>
</select>
```

### 2. Stock Valuation Report
```tsx
// عرض تفاصيل الدفعات للمنتجات FIFO/LIFO
<BatchDetailsTable product={product} />

// محاكاة COGS قبل الصرف الفعلي
<COGSSimulator product={product} quantity={120} />
```

---

## ✅ Checklist التطبيق

### قاعدة البيانات
- [ ] تنفيذ `01_valuation_methods_setup.sql` على Supabase
- [ ] التحقق من إضافة الأعمدة الجديدة للـ products
- [ ] اختبار `get_product_batches()` function
- [ ] اختبار `simulate_cogs()` function
- [ ] اختبار trigger `trg_validate_stock_queue`

### الكود
- [x] ✅ Classes (FIFO, LIFO, AVCO) مكتملة
- [x] ✅ ValuationFactory جاهز
- [x] ✅ Integration layer (valuation.ts) جاهز
- [ ] تحديث `inventory.js` لاستخدام ValuationFactory
- [ ] تحديث `recordInventoryMovement` function
- [ ] إضافة support للـ stock_queue في Supabase queries

### واجهة المستخدم
- [ ] إضافة valuation method selector في Product Form
- [ ] إنشاء Batch Details component
- [ ] إنشاء COGS Simulator component
- [ ] إضافة Stock Valuation Report
- [ ] إضافة tooltips لشرح كل طريقة

### الاختبار
- [ ] اختبار FIFO مع حركات متعددة
- [ ] اختبار LIFO مع حركات متعددة
- [ ] اختبار AVCO ومقارنته مع النظام القديم
- [ ] اختبار التبديل بين الطرق
- [ ] اختبار stock queue integrity

---

## 📊 أمثلة عملية

### سيناريو 1: مصنع بلاستيك (FIFO)
```typescript
// PP Raw Material - يجب استخدام الأقدم أولاً
const ppRawMaterial = {
  code: 'RM-PP-001',
  valuation_method: 'FIFO',
  // ...
};

// Day 1: شراء 1000 كجم بـ 10 ريال
await processIncomingStock(ppRawMaterial, 1000, 10);

// Day 5: شراء 500 كجم بـ 12 ريال (السعر ارتفع)
await processIncomingStock(ppRawMaterial, 500, 12);

// Day 10: صرف للإنتاج 1200 كجم
const result = await processOutgoingStock(ppRawMaterial, 1200);

// COGS = (1000 × 10) + (200 × 12) = 12,400 ريال
// Remaining = 300 كجم بسعر 12 ريال
```

### سيناريو 2: قطع غيار (Weighted Average)
```typescript
// قطع غيار - لا فرق بين القديم والجديد
const sparePart = {
  code: 'SP-MOTOR-001',
  valuation_method: 'Weighted Average',
  // ...
};

// شراء دفعات متفرقة
await processIncomingStock(sparePart, 10, 500);
await processIncomingStock(sparePart, 15, 520);
await processIncomingStock(sparePart, 5, 480);

// سيتم حساب متوسط مرجح واحد للكل
// عند الصرف: نفس المتوسط لجميع الوحدات
```

---

## 🔐 اعتبارات الأمان

```typescript
// التحقق من صحة stock queue قبل الحفظ
const isValid = validateStockQueue(product);
if (!isValid) {
  // إصلاح تلقائي
  product = repairStockQueue(product);
}

// منع الصرف الزائد
if (quantity > product.stock_quantity) {
  throw new Error('Insufficient stock');
}
```

---

## 📚 المراجع المحاسبية

### IAS 2 - Inventories
- الفقرة 23-25: طرق تقييم المخزون
- FIFO و Weighted Average مقبولان
- LIFO غير مقبول تحت IFRS

### US GAAP
- جميع الطرق الثلاثة مقبولة
- LIFO له ميزات ضريبية في بعض الحالات

### Saudi GAAP (SOCPA)
- متوافق مع IFRS
- Weighted Average الأكثر شيوعاً

---

## 🎉 الخلاصة

✅ **النظام جاهز ومكتمل من الناحية البرمجية**

**المتبقي:**
1. تطبيق SQL على Supabase
2. تحديث inventory.js للتكامل
3. إضافة UI components
4. الاختبار الشامل

**وقت التطبيق المتوقع:** 2-3 ساعات

---

*تم التطوير في: 10 نوفمبر 2025*
*النظام: Wardah ERP - Process Costing Module*
