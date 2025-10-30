# 📦 BOM Management System
## نظام إدارة قوائم المواد

> **تم تطوير هذا النظام في 30 أكتوبر 2025**  
> نظام متقدم لإدارة قوائم المواد (Bill of Materials) مع دعم فك القوائم متعددة المستويات وحساب التكاليف

---

## 🎯 ما تم إنجازه

### ✅ قاعدة البيانات
- [x] تحديث جدول `bom_headers` (إضافة 8 أعمدة جديدة)
- [x] تحديث جدول `bom_lines` (إضافة 7 أعمدة جديدة)
- [x] إنشاء جدول `bom_versions` (تتبع الإصدارات)
- [x] إنشاء جدول `bom_explosion_cache` (للأداء)
- [x] إنشاء جدول `bom_where_used` (استخدام المكونات)
- [x] Triggers تلقائية لتحديث البيانات
- [x] Row Level Security (RLS) policies
- [x] فهارس للأداء

### ✅ دوال قاعدة البيانات
- [x] `explode_bom()` - فك قائمة المواد متعددة المستويات
- [x] `calculate_bom_cost()` - حساب التكلفة الإجمالية
- [x] `get_where_used()` - تقرير استخدام المكون

### ✅ الخدمات (Services)
- [x] `bomService.ts` - خدمة شاملة للتعامل مع BOM
  - getAllBOMs()
  - getBOMById()
  - createBOM()
  - updateBOM()
  - deleteBOM()
  - approveBOM()
  - explodeBOM()
  - calculateBOMCost()
  - getWhereUsed()
  - copyBOM()
  - searchBOMs()

### ✅ React Hooks
- [x] `useBOM.ts` - React Query hooks
  - useBOMs()
  - useBOM()
  - useCreateBOM()
  - useUpdateBOM()
  - useDeleteBOM()
  - useApproveBOM()
  - useBOMExplosion()
  - useBOMCost()
  - useWhereUsed()
  - useCopyBOM()
  - useSearchBOMs()

### ✅ المكونات (Components)
- [x] `BOMManagement.tsx` - Dashboard رئيسي
  - عرض جميع قوائم المواد
  - بطاقات إحصائية
  - بحث وتصفية
  - إجراءات (تعديل، حذف، نسخ، اعتماد)
  
- [x] `BOMBuilder.tsx` - منشئ قوائم المواد
  - إنشاء BOM جديد
  - تعديل BOM موجود
  - إضافة/حذف/تعديل المكونات
  - جدول تفاعلي للمكونات
  - ملخص إحصائي

### ✅ المسارات (Routes)
- [x] `/manufacturing/bom` - Dashboard
- [x] `/manufacturing/bom/new` - إنشاء جديد
- [x] `/manufacturing/bom/:bomId/edit` - تعديل

---

## 📁 هيكل الملفات

```
wardah-process-costing/
├── sql/manufacturing/
│   └── 01_bom_system_setup.sql         # Database setup
│
├── src/
│   ├── features/manufacturing/bom/
│   │   ├── BOMManagement.tsx           # Dashboard
│   │   ├── BOMBuilder.tsx              # Builder
│   │   └── index.tsx                   # Exports
│   │
│   ├── hooks/manufacturing/
│   │   └── useBOM.ts                   # React Query hooks
│   │
│   ├── services/manufacturing/
│   │   └── bomService.ts               # API service
│   │
│   └── features/manufacturing/
│       └── index.tsx                   # Routes ✅ Updated
```

---

## 🚀 كيفية الاستخدام

### 1. تطبيق Database Migration

```bash
# نفذ SQL Script على Supabase
psql -h <supabase-host> -U <user> -d <database> -f sql/manufacturing/01_bom_system_setup.sql
```

أو من Supabase Dashboard:
1. افتح SQL Editor
2. الصق محتوى `01_bom_system_setup.sql`
3. اضغط Run

### 2. استخدام الواجهة

#### إنشاء قائمة مواد جديدة

```tsx
// الانتقال إلى الصفحة
navigate('/manufacturing/bom/new')

// أو من Dashboard
<Button onClick={() => navigate('/manufacturing/bom/new')}>
  قائمة جديدة
</Button>
```

#### عرض قوائم المواد

```tsx
import { BOMManagement } from '@/features/manufacturing/bom'

// في المسار
<Route path="bom" element={<BOMManagement />} />
```

#### استخدام Hooks

```tsx
import { useBOMs, useCreateBOM } from '@/hooks/manufacturing/useBOM'

function MyComponent() {
  const orgId = 'your-org-id'
  const { data: boms, isLoading } = useBOMs(orgId)
  const createBOM = useCreateBOM(orgId)
  
  const handleCreate = async () => {
    await createBOM.mutateAsync({
      header: {
        bom_number: 'BOM-001',
        item_id: 'item-id',
        // ...
      },
      lines: [
        {
          line_number: 10,
          item_id: 'component-id',
          quantity: 2,
          // ...
        }
      ]
    })
  }
}
```

---

## 📊 ميزات متقدمة

### BOM Explosion (فك القوائم متعددة المستويات)

```tsx
import { useBOMExplosion } from '@/hooks/manufacturing/useBOM'

const { data: explosion } = useBOMExplosion(bomId, quantity, orgId)

// النتيجة:
// [
//   { level: 0, item_code: 'FINAL', quantity_required: 1 },
//   { level: 1, item_code: 'PART-A', quantity_required: 2 },
//   { level: 2, item_code: 'RAW-MAT-1', quantity_required: 4 },
// ]
```

### حساب التكلفة

```tsx
import { useBOMCost } from '@/hooks/manufacturing/useBOM'

const { data: totalCost } = useBOMCost(bomId, quantity)
// totalCost = 1234.56
```

### Where-Used Report

```tsx
import { useWhereUsed } from '@/hooks/manufacturing/useBOM'

const { data: whereUsed } = useWhereUsed(itemId, orgId)

// النتيجة: قائمة بجميع BOMs التي تستخدم هذا المكون
```

---

## 🔧 التخصيص

### إضافة حقول مخصصة

```sql
-- في قاعدة البيانات
ALTER TABLE bom_headers ADD COLUMN custom_field VARCHAR(100);

-- في TypeScript
interface BOMHeader {
  // ...existing fields
  custom_field?: string
}
```

### إضافة Validation

```tsx
// في BOMBuilder.tsx
const handleSave = async () => {
  // Custom validation
  if (bomLines.some(line => line.quantity <= 0)) {
    alert('الكمية يجب أن تكون أكبر من صفر')
    return
  }
  
  // ...existing code
}
```

---

## 📋 الحقول الأساسية

### BOM Header

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bom_number` | string | ✅ | رقم القائمة |
| `item_id` | UUID | ✅ | معرّف الصنف |
| `bom_version` | integer | ✅ | رقم الإصدار |
| `is_active` | boolean | ✅ | نشط؟ |
| `effective_date` | date | ✅ | تاريخ السريان |
| `unit_cost` | numeric | - | التكلفة |
| `status` | enum | ✅ | DRAFT/APPROVED/OBSOLETE |

### BOM Line

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `line_number` | integer | ✅ | رقم السطر |
| `item_id` | UUID | ✅ | معرّف المادة |
| `quantity` | numeric | ✅ | الكمية |
| `unit_of_measure` | string | ✅ | الوحدة |
| `line_type` | enum | ✅ | COMPONENT/PHANTOM/REFERENCE |
| `scrap_factor` | numeric | - | نسبة الهالك % |
| `is_critical` | boolean | - | حرج؟ |
| `yield_percentage` | numeric | - | نسبة المخرجات % |

---

## 🔒 الأمان (Security)

- ✅ Row Level Security (RLS) enabled
- ✅ سياسات RLS للقراءة فقط للمستخدمين المصرح لهم
- ✅ التحقق من org_id في جميع العمليات
- ✅ Triggers تلقائية للحفاظ على سلامة البيانات

---

## 🎨 واجهة المستخدم

### المكونات المستخدمة

- `Card` - البطاقات
- `Button` - الأزرار
- `Input` - حقول الإدخال
- `Badge` - الشارات
- `Label` - التسميات
- Wardah Glass Card Design System

### الألوان والحالات

- 🟢 Green - Approved (معتمد)
- 🟡 Orange - Draft (مسودة)
- 🔴 Red - Obsolete/Critical (ملغى/حرج)
- ⚪ Gray - Inactive (غير نشط)

---

## 📈 الخطوات التالية

### قريباً
- [ ] BOM Viewer Component (عرض تفصيلي)
- [ ] BOM Comparison Tool (مقارنة الإصدارات)
- [ ] Cost Rollup Visualization (رسم بياني للتكاليف)
- [ ] Export to Excel/PDF
- [ ] Import from Excel

### المستقبل
- [ ] Multi-level BOM Tree View
- [ ] BOM Change Orders
- [ ] Engineering Change Management (ECM)
- [ ] Material Substitution
- [ ] BOM Analytics Dashboard

---

## 🐛 المشاكل المعروفة

1. **orgId hardcoded** - يجب استخراجه من user context
2. **Item selection** - يحتاج Modal للبحث والاختيار
3. **Validation** - يحتاج validation أكثر شمولاً

---

## 💡 نصائح

### الأداء
- استخدم `bom_explosion_cache` للقوائم الكبيرة
- Indexes موجودة على الحقول الهامة
- Pagination موصى بها لأكثر من 100 BOM

### Best Practices
- دائماً استخدم `bom_version` عند التحديث
- لا تحذف BOMs المعتمدة، اجعلها `OBSOLETE`
- استخدم `scrap_factor` للمواد ذات الهالك المرتفع
- `is_critical` للمواد التي تتطلب اهتمام خاص

---

## 📞 الدعم

للأسئلة والمساعدة:
- راجع `MANUFACTURING_MODULE_DEVELOPMENT_PLAN.md`
- راجع `MANUFACTURING_QUICK_START_GUIDE.md`
- افتح Issue على GitHub

---

**تم بحمد الله ✨**  
**BOM Management System v1.0**  
**30 أكتوبر 2025**
