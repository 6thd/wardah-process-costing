# BOM Enhancements Documentation
# توثيق تحسينات نظام BOM

## نظرة عامة

هذا التوثيق يشرح التحسينات الأربعة الرئيسية لنظام BOM في Wardah ERP:

1. **Multi-Level BOM Visualization** - عرض شجرة BOM متعددة المستويات
2. **BOM Costing Enhancement** - تحسين حساب تكلفة BOM
3. **Alternative BOMs** - BOMs البديلة
4. **BOM Routing** - عمليات التصنيع (Routing)

---

## 1. Multi-Level BOM Visualization

### الوظيفة
عرض شجرة BOM متعددة المستويات بشكل تفاعلي مع دعم البحث والتكلفة والتخزين المؤقت.

### المكونات الأساسية

#### قاعدة البيانات
- **`bom_tree_cache`**: جدول تخزين مؤقت للشجرة مع المسار المادي (Materialized Path)
- **`bom_settings`**: جدول إعدادات BOM لكل منظمة

#### الدوال SQL
- **`build_bom_tree()`**: بناء شجرة BOM كاملة مع دعم التخزين المؤقت
- **`cleanup_bom_tree_cache()`**: مسح cache المنتهي الصلاحية

#### الخدمات TypeScript
- **`bomTreeService`**: خدمة شاملة لإدارة شجرة BOM
  - `buildBOMTree()`: بناء الشجرة
  - `buildTreeStructure()`: تحويل القائمة المسطحة إلى هيكل شجري
  - `getNodePath()`: الحصول على مسار عقدة
  - `calculateTreeCost()`: حساب التكلفة الإجمالية
  - `searchInTree()`: البحث في الشجرة
  - `getBOMSettings()`: الحصول على الإعدادات
  - `updateBOMSettings()`: تحديث الإعدادات
  - `clearBOMCache()`: مسح cache

#### المكونات React
- **`BOMTreeView`**: مكون عرض الشجرة التفاعلي
  - دعم expand/collapse
  - البحث في الشجرة
  - عرض التكلفة
  - تمييز العقد الحرجة

### الاستخدام

```typescript
import { BOMTreeView } from '@/components/manufacturing/BOMTreeView'

<BOMTreeView
  bomId="bom-id"
  quantity={10}
  showCosts={true}
  showSearch={true}
  onNodeSelect={(node) => console.log(node)}
/>
```

### الميزات
- ✅ عرض هيكل شجري متعدد المستويات
- ✅ دعم التخزين المؤقت للأداء
- ✅ البحث في الشجرة
- ✅ حساب التكلفة لكل مستوى
- ✅ تمييز المكونات الحرجة
- ✅ دعم Phantom و Reference BOMs

---

## 2. BOM Costing Enhancement

### الوظيفة
حساب ومقارنة التكاليف المعيارية vs الفعلية مع تحليل التباينات التفصيلي.

### المكونات الأساسية

#### قاعدة البيانات
- **`bom_cost_analysis`**: جدول تحليل التكلفة
  - التكاليف المعيارية (Standard)
  - التكاليف الفعلية (Actual)
  - التباينات (Variances) - محسوبة تلقائياً
  - نسب التباين (Variance Percentages)
- **`bom_cost_details`**: تفاصيل تكلفة كل مكون

#### الدوال SQL
- **`calculate_bom_standard_cost()`**: حساب التكلفة المعيارية
  - تكلفة المواد (Material Cost)
  - تكلفة العمالة (Labor Cost)
  - التكاليف غير المباشرة (Overhead Cost)
- **`compare_bom_costs()`**: مقارنة المعياري vs الفعلي

#### الخدمات TypeScript
- **`bomCostingService`**: خدمة حساب تكلفة BOM
  - `calculateStandardCost()`: حساب التكلفة المعيارية
  - `compareCosts()`: مقارنة التكاليف
  - `createCostAnalysis()`: إنشاء تحليل تكلفة
  - `getCostAnalyses()`: الحصول على التحليلات
  - `getCostDetails()`: الحصول على التفاصيل
  - `updateCostAnalysis()`: تحديث التحليل
  - `approveCostAnalysis()`: الموافقة على التحليل

#### المكونات React
- **`BOMCostAnalysis`**: مكون تحليل التكلفة
  - عرض التكلفة المعيارية
  - مقارنة المعياري vs الفعلي
  - تحليل التباينات
  - رسوم بيانية للتباينات

### الاستخدام

```typescript
import { bomCostingService } from '@/services/manufacturing/bomCostingService'

// حساب التكلفة المعيارية
const standard = await bomCostingService.calculateStandardCost(bomId, 100)
// {
//   material_cost: 5000,
//   labor_cost: 2000,
//   overhead_cost: 300,
//   total_cost: 7300,
//   unit_cost: 73
// }

// مقارنة التكاليف
const comparison = await bomCostingService.compareCosts(bomId, 100)
// [
//   { cost_type: 'Material', standard_cost: 5000, actual_cost: 5200, variance: 200, variance_pct: 4 },
//   { cost_type: 'Labor', standard_cost: 2000, actual_cost: 1900, variance: -100, variance_pct: -5 },
//   ...
// ]
```

### الميزات
- ✅ حساب التكلفة المعيارية (مواد + عمالة + تكاليف غير مباشرة)
- ✅ مقارنة المعياري vs الفعلي
- ✅ تحليل التباينات التفصيلي
- ✅ نسب التباين المئوية
- ✅ تتبع تاريخ التحليلات
- ✅ الموافقة على التحليلات

---

## 3. Alternative BOMs

### الوظيفة
إدارة BOMs بديلة لنفس المنتج مع قواعد اختيار تلقائية بناءً على الشروط.

### المكونات الأساسية

#### قاعدة البيانات
- **`bom_alternatives`**: جدول BOMs البديلة
  - BOM الأساسي (Primary)
  - BOM البديل (Alternative)
  - الأولوية (Priority)
  - شروط الاستخدام (Quantity Range, Date Range)
  - أسباب البديل (Reason Code)
  - تكلفة الفرق
- **`bom_selection_rules`**: قواعد اختيار BOM
  - أنواع القواعد (Quantity, Date, Cost, Availability, Supplier, Custom)
  - شروط ديناميكية (JSON)
  - الأولوية

#### الدوال SQL
- **`select_optimal_bom()`**: اختيار BOM الأمثل
  - البحث عن BOM الأساسي
  - البحث عن البدائل
  - تقييم القواعد
  - اختيار الأقل تكلفة أو الأفضل حسب القواعد

#### الخدمات TypeScript
- **`bomAlternativeService`**: خدمة إدارة BOMs البديلة
  - `getAlternatives()`: الحصول على البدائل
  - `addAlternative()`: إضافة بديل
  - `updateAlternative()`: تحديث بديل
  - `deleteAlternative()`: حذف بديل
  - `selectOptimalBOM()`: اختيار BOM الأمثل
  - `getSelectionRules()`: الحصول على القواعد
  - `addSelectionRule()`: إضافة قاعدة
  - `updateSelectionRule()`: تحديث قاعدة

#### المكونات React
- **`BOMAlternatives`**: مكون إدارة البدائل
  - عرض قائمة البدائل
  - إضافة/تعديل/حذف بديل
  - اختيار بديل

### الاستخدام

```typescript
import { bomAlternativeService } from '@/services/manufacturing/bomAlternativeService'

// إضافة BOM بديل
await bomAlternativeService.addAlternative({
  primary_bom_id: 'primary-bom-id',
  alternative_bom_id: 'alternative-bom-id',
  priority: 1,
  min_quantity: 100,
  max_quantity: 1000,
  reason_code: 'COST',
  is_active: true,
  org_id: 'org-id'
})

// اختيار BOM الأمثل
const optimalBomId = await bomAlternativeService.selectOptimalBOM(
  'item-id',
  500, // quantity
  '2025-01-15' // order date
)
```

### الميزات
- ✅ إدارة BOMs بديلة متعددة
- ✅ قواعد اختيار تلقائية
- ✅ شروط كمية وتاريخية
- ✅ أسباب البديل (تكلفة، توفر، جودة، مورد)
- ✅ حساب تكلفة الفرق
- ✅ اختيار تلقائي للأمثل

---

## 4. BOM Routing

### الوظيفة
إدارة عمليات التصنيع (Routing) مع حساب التكاليف والأوقات لكل عملية.

### المكونات الأساسية

#### قاعدة البيانات
- **`bom_operations`**: جدول عمليات التصنيع
  - التسلسل (Sequence)
  - كود واسم العملية
  - مركز العمل (Work Center)
  - الأوقات (Setup, Run, Queue, Move)
  - التكاليف (Labor Rate, Machine Rate, Overhead Rate)
  - التكاليف المحسوبة (Setup Cost, Run Cost)
- **`bom_operation_materials`**: ربط العمليات بالمواد
  - المواد المطلوبة لكل عملية
  - نوع الإصدار (Auto, Manual, Backflush)

#### الدوال SQL
- **`calculate_routing_cost()`**: حساب تكلفة Routing
  - تكلفة الإعداد لكل عملية
  - تكلفة التشغيل لكل وحدة
  - التكلفة الإجمالية
  - الوقت الإجمالي
- **`calculate_total_routing_cost()`**: حساب إجمالي تكلفة Routing

#### الخدمات TypeScript
- **`bomRoutingService`**: خدمة إدارة Routing
  - `getOperations()`: الحصول على العمليات
  - `addOperation()`: إضافة عملية
  - `updateOperation()`: تحديث عملية
  - `deleteOperation()`: حذف عملية
  - `calculateRoutingCost()`: حساب تكلفة Routing
  - `calculateTotalRoutingCost()`: حساب الإجمالي
  - `getOperationMaterials()`: الحصول على مواد العملية
  - `addOperationMaterial()`: إضافة مادة للعملية

#### المكونات React
- **`BOMRouting`**: مكون إدارة Routing
  - عرض قائمة العمليات
  - إضافة/تعديل/حذف عملية
  - حساب التكاليف
  - عرض الأوقات

### الاستخدام

```typescript
import { bomRoutingService } from '@/services/manufacturing/bomRoutingService'

// إضافة عملية
await bomRoutingService.addOperation({
  bom_id: 'bom-id',
  operation_sequence: 1,
  operation_code: 'OP001',
  operation_name: 'قطع',
  work_center_id: 'wc-id',
  setup_time_minutes: 30,
  run_time_minutes: 5,
  labor_rate: 50,
  is_active: true,
  org_id: 'org-id'
})

// حساب تكلفة Routing
const costs = await bomRoutingService.calculateRoutingCost('bom-id', 100)
// [
//   {
//     operation_sequence: 1,
//     operation_code: 'OP001',
//     setup_cost: 25,
//     run_cost: 500,
//     total_cost: 525,
//     total_time_minutes: 530
//   },
//   ...
// ]
```

### الميزات
- ✅ إدارة عمليات التصنيع (Routing)
- ✅ حساب التكاليف تلقائياً
- ✅ حساب الأوقات (Setup, Run, Queue, Move)
- ✅ ربط العمليات بالمواد
- ✅ أنواع إصدار المواد (Auto, Manual, Backflush)
- ✅ حساب إجمالي تكلفة Routing

---

## الإعدادات (Settings)

### جدول `bom_settings`

إعدادات BOM لكل منظمة:

- **`bom_tree_cache_duration_hours`**: مدة صلاحية cache (افتراضي: 1 ساعة)
- **`bom_max_levels`**: الحد الأقصى لمستويات BOM (افتراضي: 20)
- **`bom_auto_calculate_cost`**: حساب التكلفة تلقائياً (افتراضي: true)

### المكون
- **`BOMSettings`**: مكون إدارة الإعدادات
  - تحديث مدة cache
  - تحديث الحد الأقصى للمستويات
  - تفعيل/تعطيل الحساب التلقائي

---

## ترتيب التنفيذ

### 1. قاعدة البيانات
```sql
-- تنفيذ بالترتيب:
1. sql/manufacturing/03_bom_tree_visualization.sql
2. sql/manufacturing/04_bom_costing_enhancements.sql
3. sql/manufacturing/05_alternative_boms.sql
4. sql/manufacturing/06_bom_routing.sql
```

### 2. الخدمات TypeScript
- `src/services/manufacturing/bomTreeService.ts`
- `src/services/manufacturing/bomCostingService.ts`
- `src/services/manufacturing/bomAlternativeService.ts`
- `src/services/manufacturing/bomRoutingService.ts`

### 3. المكونات React
- `src/components/manufacturing/BOMTreeView.tsx`
- `src/components/manufacturing/BOMCostAnalysis.tsx`
- `src/components/manufacturing/BOMAlternatives.tsx`
- `src/components/manufacturing/BOMRouting.tsx`
- `src/components/manufacturing/BOMSettings.tsx`

---

## أفضل الممارسات

### 1. الأداء
- استخدام Cache للشجرة لتقليل الاستعلامات
- استخدام Materialized Path للاستعلامات السريعة
- تنظيف Cache القديم تلقائياً

### 2. التكلفة
- تحديث التكاليف المعيارية بانتظام
- مقارنة المعياري vs الفعلي دورياً
- تحليل التباينات للتحسين المستمر

### 3. البدائل
- تحديد قواعد واضحة لاختيار البديل
- مراجعة البدائل بانتظام
- تحديث الأولويات حسب الأداء

### 4. Routing
- تحديد العمليات بدقة
- حساب الأوقات بدقة
- مراجعة التكاليف بانتظام

---

## الدعم والمساعدة

للمزيد من المعلومات أو المساعدة:
- راجع ملفات SQL للتفاصيل التقنية
- راجع ملفات TypeScript Services للاستخدام
- راجع ملفات React Components للأمثلة

---

**تم إنشاء هذا التوثيق بتاريخ:** 2025-01-15  
**الإصدار:** 1.0.0

