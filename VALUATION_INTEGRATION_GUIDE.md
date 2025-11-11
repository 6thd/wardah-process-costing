# 🎯 دليل التكامل - نظام تقييم المخزون المتعدد الطرق

## 📋 نظرة عامة

تم دمج نظام تقييم المخزون بنجاح مع نظام Wardah ERP. النظام يدعم 4 طرق تقييم:
- **FIFO** (الوارد أولاً صادر أولاً)
- **LIFO** (الوارد أخيراً صادر أولاً) 
- **Weighted Average** (المتوسط المرجح)
- **Moving Average** (المتوسط المتحرك)

---

## 🗂️ هيكل الملفات

### 1. ملفات الـ Valuation Strategies
```
src/services/valuation/
├── FIFOValuation.ts          # استراتيجية FIFO
├── LIFOValuation.ts          # استراتيجية LIFO
├── WeightedAverageValuation.ts  # استراتيجية المتوسط المرجح
├── ValuationFactory.ts       # Factory Pattern
└── __tests__/
    └── ValuationMethods.test.ts  # 22 اختبار وحدة
```

### 2. ملفات التكامل
```
src/domain/
├── inventory.js                           # النظام القديم (AVCO فقط)
├── inventory-valuation-integration.js     # ✨ النظام الجديد (متعدد الطرق)
└── inventory/
    └── valuation.ts                       # طبقة التكامل
```

### 3. مكونات الواجهة
```
src/features/
├── inventory/
│   ├── index.tsx                          # نموذج المخزون (يحتوي على dropdown للطريقة)
│   └── components/
│       └── BatchDetails.tsx               # ✨ عرض تفاصيل الدفعات
└── testing/
    └── ValuationTesting.tsx               # ✨ صفحة الاختبار التفاعلية
```

### 4. SQL Scripts
```
sql/inventory/
└── 01_valuation_methods_setup.sql        # تم تطبيقه على Supabase ✅
```

---

## 🔄 API الجديد مقابل القديم

### القديم (AVCO فقط)
```javascript
import { recordInventoryMovement } from '../domain/inventory.js'

// استخدام calculateNewAVCO داخلياً
await recordInventoryMovement({
  itemId: 'xxx',
  moveType: 'PURCHASE_IN',
  qtyIn: 100,
  unitCost: 50
})
```

### الجديد (متعدد الطرق)
```javascript
import { recordInventoryMovementV2 } from '../domain/inventory-valuation-integration.js'

// استخدام processIncomingStock/processOutgoingStock
// يختار الاستراتيجية حسب valuation_method للمنتج
await recordInventoryMovementV2({
  itemId: 'xxx',
  moveType: 'PURCHASE_IN',
  qtyIn: 100,
  unitCost: 50
})
```

---

## 📊 قاعدة البيانات

### الأعمدة المضافة للجدول `items`
```sql
valuation_method VARCHAR(50) DEFAULT 'Weighted Average'
stock_queue JSONB                -- للـ FIFO/LIFO batches
stock_value DECIMAL(18,6)        -- القيمة الإجمالية
```

### الدوال المضافة
```sql
-- الحصول على دفعات المنتج
get_product_batches(p_product_id UUID)

-- محاكاة COGS دون الصرف الفعلي
simulate_cogs(p_product_id UUID, p_quantity DECIMAL)

-- Trigger للتحقق من صحة stock_queue
validate_stock_queue()
```

### View للتقارير
```sql
vw_stock_valuation_by_method
-- يعرض المنتجات مع تفاصيل التقييم حسب الطريقة
```

---

## 🎨 مكونات الواجهة

### 1. Dropdown في نموذج المنتج (موجود مسبقاً ✅)
```tsx
// في src/features/inventory/index.tsx (السطر 512-521)
<select
  value={newItem.valuation_method}
  onChange={(e) => setNewItem({...newItem, valuation_method: e.target.value})}
>
  <option value="Weighted Average">المتوسط المرجح</option>
  <option value="FIFO">الوارد أولاً صادر أولاً</option>
  <option value="LIFO">الوارد أخيراً صادر أولاً</option>
  <option value="Moving Average">المتوسط المتحرك</option>
</select>
```

### 2. BatchDetails Component (جديد ✨)
```tsx
import BatchDetails from './components/BatchDetails'

<BatchDetails
  productId={product.id}
  productCode={product.code}
  productName={product.name}
  valuationMethod={product.valuation_method}
  totalStock={product.stock_quantity}
  totalValue={product.stock_value}
/>
```

**الميزات:**
- عرض قائمة الدفعات مع رقم، كمية، سعر، قيمة
- تمييز الدفعة التي سيتم صرفها أولاً (🟢 FIFO / 🔵 LIFO)
- رسم بياني لنسبة كل دفعة
- حساب المتوسط المرجح

### 3. ValuationTesting Page (جديد ✨)
```tsx
import ValuationTesting from './features/testing/ValuationTesting'

// صفحة تفاعلية كاملة للاختبار
<Route path="/testing/valuation" element={<ValuationTesting />} />
```

**الميزات:**
- إنشاء منتجات اختبارية
- إضافة حركات استلام/صرف
- عرض سجل الحركات
- محاكاة COGS قبل الصرف الفعلي
- عرض BatchDetails للمنتجات FIFO/LIFO

---

## 🧪 الاختبارات

### Unit Tests (22/22 ✅)
```bash
npx vitest run src/services/valuation/__tests__/ValuationMethods.test.ts
```

**التغطية:**
- ✅ FIFO: 4 اختبارات (incoming, outgoing, multiple batches, edge cases)
- ✅ LIFO: 4 اختبارات (incoming, outgoing, stack behavior, edge cases)
- ✅ Weighted Average: 4 اختبارات (incoming, outgoing, recalculation, edge cases)
- ✅ Factory: 7 اختبارات (strategy creation, validation, Arabic names)
- ✅ Integration: 3 اختبارات (complete lifecycle, FIFO vs LIFO, price fluctuations)

### Practical Testing

استخدم صفحة `/testing/valuation` لاختبار عملي:

#### سيناريو 1: اختبار FIFO
```
1. أنشئ منتج TEST-001 بطريقة FIFO
2. استلم 100 @ 50 ر.س
3. استلم 50 @ 60 ر.س
4. اصرف 120
5. تحقق: COGS = (100 × 50) + (20 × 60) = 6200 ر.س
6. الرصيد المتبقي: 30 @ 60 ر.س = 1800 ر.س
```

#### سيناريو 2: اختبار LIFO
```
1. أنشئ منتج TEST-002 بطريقة LIFO
2. استلم 100 @ 50 ر.س
3. استلم 50 @ 60 ر.س
4. اصرف 120
5. تحقق: COGS = (50 × 60) + (70 × 50) = 6500 ر.س
6. الرصيد المتبقي: 30 @ 50 ر.س = 1500 ر.س
```

#### سيناريو 3: اختبار Weighted Average
```
1. أنشئ منتج TEST-003 بطريقة Weighted Average
2. استلم 100 @ 50 ر.س (القيمة: 5000)
3. استلم 50 @ 60 ر.س (القيمة: 3000)
4. المتوسط الجديد: 8000 / 150 = 53.33 ر.س
5. اصرف 120
6. تحقق: COGS = 120 × 53.33 = 6400 ر.س
7. الرصيد المتبقي: 30 @ 53.33 ر.س = 1600 ر.س
```

---

## 🔧 خطوات التكامل في الكود الموجود

### خطوة 1: استبدال imports
```javascript
// قديم
import { 
  recordInventoryMovement,
  receivePurchase,
  shipSales
} from './domain/inventory.js'

// جديد
import { 
  recordInventoryMovementV2,
  receivePurchaseV2,
  shipSalesV2
} from './domain/inventory-valuation-integration.js'
```

### خطوة 2: تحديث الـ calls
استبدل جميع استدعاءات الدوال القديمة بالجديدة (نفس الـ API):
```javascript
// قديم
await receivePurchase({ itemId, quantity, unitCost })

// جديد
await receivePurchaseV2({ itemId, quantity, unitCost })
```

### خطوة 3: إضافة BatchDetails للواجهة
في صفحة عرض المنتج أو المخزون:
```tsx
{product.valuation_method === 'FIFO' || product.valuation_method === 'LIFO' ? (
  <BatchDetails
    productId={product.id}
    productCode={product.code}
    productName={product.name}
    valuationMethod={product.valuation_method}
    totalStock={product.stock_quantity}
    totalValue={product.stock_value}
  />
) : null}
```

---

## 📈 الميزات المضافة

### 1. دعم متعدد الطرق ✨
- كل منتج يمكن أن يكون له طريقة تقييم مختلفة
- يتم اختيار الاستراتيجية تلقائياً حسب `valuation_method`

### 2. تتبع الدفعات (FIFO/LIFO) 📦
- كل استلام يُنشئ دفعة جديدة
- الصرف يتم من الدفعات حسب الطريقة
- `stock_queue` يحفظ جميع الدفعات بصيغة JSONB

### 3. حساب COGS دقيق 💰
- FIFO: من أقدم دفعة
- LIFO: من أحدث دفعة
- AVCO: من المتوسط المرجح

### 4. محاكاة COGS 🔍
```javascript
// قبل الصرف الفعلي، شاهد كم ستكون التكلفة
const result = await simulateCOGS(productId, 100)
console.log(`COGS المتوقع: ${result.data} ر.س`)
```

### 5. تقارير حسب الطريقة 📊
```javascript
const result = await getInventoryValuationByMethod()
// يعرض المخزون مجموع حسب طريقة التقييم
```

---

## 🚨 ملاحظات هامة

### 1. التوافق مع النظام القديم
- الملف `inventory.js` لم يُعدّل - النظام القديم يعمل كما هو
- الملف الجديد `inventory-valuation-integration.js` يعمل بالتوازي
- يمكن الانتقال التدريجي من V1 إلى V2

### 2. LIFO والمعايير المحاسبية ⚠️
- LIFO **غير مقبول** في IFRS (المعيار الدولي)
- LIFO **مقبول** في US GAAP (المعيار الأمريكي)
- معظم دول الخليج تستخدم IFRS

**توصية:** إخفاء خيار LIFO أو إضافة تحذير:
```tsx
<option value="LIFO" className="text-yellow-600">
  ⚠️ الوارد أخيراً صادر أولاً (غير مقبول في IFRS)
</option>
```

### 3. تحويل طريقة التقييم 🔄
```typescript
// تحويل منتج من FIFO إلى AVCO
const updatedProduct = await convertValuationMethod(product, 'Weighted Average')
// ⚠️ عملية مدمرة: يتم دمج جميع الدفعات في دفعة واحدة
```

### 4. الأداء 
- المنتجات ذات الدفعات الكثيرة (>100) قد تبطئ الاستعلامات
- استخدم pagination في `getProductBatches()`
- JSONB في PostgreSQL سريع لكن ليس بسرعة الأعمدة العادية

---

## 📚 مراجع إضافية

### الملفات ذات الصلة
- `VALUATION_SYSTEM_README.md` - الوثائق الفنية الكاملة
- `VALUATION_SYSTEM_COMPLETE.md` - ملخص الإنجازات
- `src/services/valuation/__tests__/ValuationMethods.test.ts` - أمثلة كود

### الدوال المساعدة
```javascript
// في ValuationFactory
ValuationFactory.getMethodNameAr('FIFO')  // => 'الوارد أولاً صادر أولاً'
ValuationFactory.isValidMethod('FIFO')    // => true
ValuationFactory.getAvailableMethods()    // => ['FIFO', 'LIFO', ...]
```

---

## ✅ Checklist التكامل النهائي

- [x] ✅ FIFO/LIFO/AVCO Classes
- [x] ✅ ValuationFactory
- [x] ✅ SQL Schema Applied
- [x] ✅ UI Dropdown (موجود مسبقاً)
- [x] ✅ Unit Tests (22/22)
- [x] ✅ Integration Layer (`inventory-valuation-integration.js`)
- [x] ✅ BatchDetails Component
- [x] ✅ ValuationTesting Page
- [ ] ⏳ استبدال V1 بـ V2 في الكود الموجود
- [ ] ⏳ اختبار عملي على بيانات حقيقية
- [ ] ⏳ إضافة تحذير LIFO/IFRS

---

## 🎯 الخطوات التالية

### فوري
1. اختبار صفحة ValuationTesting
2. مراجعة BatchDetails Component
3. اختبار مع بيانات حقيقية

### قصير المدى
1. استبدال `recordInventoryMovement` بـ `recordInventoryMovementV2` في:
   - PurchaseOrderForm
   - SalesOrderForm  
   - ManufacturingOrderForm
   - InventoryAdjustmentForm

2. إضافة BatchDetails في:
   - صفحة تفاصيل المنتج
   - تقرير المخزون

### طويل المدى
1. تقارير متقدمة:
   - مقارنة COGS بين الطرق المختلفة
   - تحليل تأثير تغيير الطريقة
   - توقع COGS للفترة القادمة

2. تحسينات الأداء:
   - Caching للـ stock_queue
   - Indexing على JSONB
   - Background jobs لإعادة حساب التقييم

---

**تم التكامل بنجاح! 🎉**

للأسئلة أو الدعم، راجع الملفات التالية:
- `VALUATION_SYSTEM_README.md`
- `src/services/valuation/__tests__/ValuationMethods.test.ts`
