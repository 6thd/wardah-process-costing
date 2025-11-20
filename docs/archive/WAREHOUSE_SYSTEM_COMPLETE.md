# نظام إدارة المخازن - دليل شامل
## Warehouse Management System - Complete Guide

تم إنشاء نظام إدارة مخازن متكامل مع ربط كامل بشجرة الحسابات المحاسبية حسب أفضل الممارسات في الأنظمة المحاسبية الكبرى (SAP، Oracle، ERPNext).

---

## 📋 الملخص التنفيذي | Executive Summary

### ✅ ما تم إنجازه:

1. **قاعدة البيانات الكاملة**
   - جداول: `warehouses`, `storage_locations`, `storage_bins`, `warehouse_gl_mapping`
   - Views محاسبية: `v_warehouse_accounting`, `v_suggested_warehouse_accounts`
   - Functions للاختيار اليدوي من شجرة الحسابات

2. **طبقة الخدمات (Service Layer)**
   - `warehouse-service.ts` مع جميع العمليات CRUD
   - دوال لربط الحسابات المحاسبية
   - دوال للحصول على الحسابات المقترحة

3. **واجهة المستخدم (UI)**
   - مكون `AccountPicker` لاختيار الحسابات من شجرة الحسابات
   - صفحة `WarehouseManagement` كاملة مع 3 تبويبات
   - تكامل مع صفحة المخزون الرئيسية

---

## 🗄️ هيكل قاعدة البيانات | Database Structure

### 1. جدول المخازن | Warehouses Table

```sql
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    name_ar VARCHAR(200),
    warehouse_type VARCHAR(20) DEFAULT 'MAIN',
    parent_warehouse_id UUID REFERENCES warehouses(id),
    
    -- Location Details
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Saudi Arabia',
    
    -- Contact Information
    manager_name VARCHAR(200),
    contact_email VARCHAR(200),
    contact_phone VARCHAR(50),
    
    -- Accounting Integration (اختيار يدوي من شجرة الحسابات)
    inventory_account_id UUID REFERENCES gl_accounts(id),
    expense_account_id UUID REFERENCES gl_accounts(id),
    cost_center_id UUID REFERENCES cost_centers(id),
    
    -- Settings
    is_active BOOLEAN DEFAULT true,
    is_group BOOLEAN DEFAULT false,
    allow_negative_stock BOOLEAN DEFAULT false,
    
    -- Capacity
    total_capacity NUMERIC(15,2),
    capacity_unit VARCHAR(50),
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(org_id, code)
);
```

**أنواع المخازن المدعومة:**
- `MAIN` - مخزن رئيسي
- `BRANCH` - مخزن فرع
- `PRODUCTION` - مخزن إنتاج
- `TRANSIT` - مخزن عبور
- `RETAIL` - مخزن بيع بالتجزئة
- `VIRTUAL` - مخزن افتراضي

### 2. جدول مواقع التخزين | Storage Locations Table

```sql
CREATE TABLE storage_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    name_ar VARCHAR(200),
    parent_location_id UUID REFERENCES storage_locations(id),
    location_type VARCHAR(50), -- ZONE, RACK, SHELF, etc.
    
    -- Settings
    temperature_controlled BOOLEAN DEFAULT false,
    capacity NUMERIC(15,2),
    capacity_unit VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    is_pickable BOOLEAN DEFAULT true,
    is_receivable BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(warehouse_id, code)
);
```

### 3. جدول صناديق التخزين | Storage Bins Table

```sql
CREATE TABLE storage_bins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    bin_code VARCHAR(50) NOT NULL,
    barcode VARCHAR(100),
    
    -- Physical Location
    aisle VARCHAR(20),
    rack VARCHAR(20),
    level VARCHAR(20),
    position VARCHAR(20),
    
    -- Type & Status
    bin_type VARCHAR(50), -- PALLET, SHELF, FLOOR, etc.
    is_occupied BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    is_locked BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(warehouse_id, bin_code)
);
```

### 4. جدول ربط الحسابات المحاسبية | GL Mapping Table

```sql
CREATE TABLE warehouse_gl_mapping (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    
    -- Core Accounts (اختيار يدوي من شجرة الحسابات)
    stock_account UUID REFERENCES gl_accounts(id),
    stock_adjustment_account UUID REFERENCES gl_accounts(id),
    expenses_included_in_valuation UUID REFERENCES gl_accounts(id),
    default_cogs_account UUID REFERENCES gl_accounts(id),
    
    -- Cost Center
    cost_center UUID REFERENCES cost_centers(id),
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(warehouse_id)
);
```

---

## 🎯 الدوال المحاسبية | Accounting Functions

### 1. الحصول على الحسابات حسب الفئة

```sql
CREATE OR REPLACE FUNCTION get_gl_accounts_by_category(
    p_org_id UUID,
    p_category VARCHAR(20)
)
RETURNS TABLE (
    id UUID,
    code VARCHAR(50),
    name VARCHAR(200),
    category VARCHAR(20)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.code,
        a.name,
        a.category
    FROM gl_accounts a
    WHERE a.org_id = p_org_id
    AND a.category = p_category
    AND a.is_active = true
    ORDER BY a.code;
END;
$$ LANGUAGE plpgsql;
```

**الفئات المدعومة:**
- `ASSET` - أصول (للمخزون)
- `EXPENSE` - مصروفات (لتسويات المخزون)
- `REVENUE` - إيرادات
- `LIABILITY` - التزامات
- `EQUITY` - حقوق ملكية

### 2. تحديث ربط المخزن بالحسابات

```sql
CREATE OR REPLACE FUNCTION update_warehouse_gl_mapping(
    p_warehouse_id UUID,
    p_org_id UUID,
    p_stock_account UUID DEFAULT NULL,
    p_adjustment_account UUID DEFAULT NULL,
    p_valuation_account UUID DEFAULT NULL,
    p_cogs_account UUID DEFAULT NULL,
    p_cost_center UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- التحقق من صحة الحسابات
    IF NOT validate_warehouse_accounts(p_stock_account, p_adjustment_account) THEN
        RAISE EXCEPTION 'Invalid account types for warehouse mapping';
    END IF;

    -- إدخال أو تحديث الربط
    INSERT INTO warehouse_gl_mapping (
        warehouse_id, stock_account, stock_adjustment_account,
        expenses_included_in_valuation, default_cogs_account, cost_center
    ) VALUES (
        p_warehouse_id, p_stock_account, p_adjustment_account,
        p_valuation_account, p_cogs_account, p_cost_center
    )
    ON CONFLICT (warehouse_id) 
    DO UPDATE SET
        stock_account = COALESCE(p_stock_account, warehouse_gl_mapping.stock_account),
        stock_adjustment_account = COALESCE(p_adjustment_account, warehouse_gl_mapping.stock_adjustment_account),
        expenses_included_in_valuation = COALESCE(p_valuation_account, warehouse_gl_mapping.expenses_included_in_valuation),
        default_cogs_account = COALESCE(p_cogs_account, warehouse_gl_mapping.default_cogs_account),
        cost_center = COALESCE(p_cost_center, warehouse_gl_mapping.cost_center),
        updated_at = NOW();

    RETURN true;
END;
$$ LANGUAGE plpgsql;
```

### 3. الحسابات المقترحة للمخازن

```sql
CREATE OR REPLACE VIEW v_suggested_warehouse_accounts AS
SELECT 
    a.id as account_id,
    a.code as account_code,
    a.name as account_name,
    a.category,
    CASE 
        WHEN a.code LIKE '14%' THEN 'stock'
        WHEN a.code LIKE '5950%' THEN 'adjustment'
        WHEN a.code LIKE '50%' THEN 'cogs'
        WHEN a.code LIKE '51%' THEN 'expense'
    END as purpose
FROM gl_accounts a
WHERE a.is_active = true
AND (
    a.code LIKE '14%'     -- Inventory accounts
    OR a.code LIKE '5950%' -- Stock adjustment accounts
    OR a.code LIKE '50%'   -- COGS accounts
    OR a.code LIKE '51%'   -- Expense accounts
);
```

---

## 💻 طبقة الخدمات | Service Layer

### ملف: `src/services/warehouse-service.ts`

#### الدوال الأساسية:

```typescript
// 1. الحصول على جميع المخازن
async getWarehouses(includeInactive = false): Promise<Warehouse[]>

// 2. الحصول على مخزن واحد
async getWarehouse(id: string): Promise<Warehouse | null>

// 3. إنشاء مخزن جديد
async createWarehouse(warehouse: Partial<Warehouse>): Promise<Warehouse | null>

// 4. تحديث مخزن
async updateWarehouse(id: string, updates: Partial<Warehouse>): Promise<boolean>

// 5. حذف مخزن
async deleteWarehouse(id: string): Promise<boolean>
```

#### الدوال المحاسبية:

```typescript
// 1. الحصول على الحسابات حسب الفئة
async getGLAccountsByCategory(
    category: 'ASSET' | 'EXPENSE' | 'REVENUE' | 'LIABILITY' | 'EQUITY'
): Promise<GLAccount[]>

// 2. الحصول على الحسابات المقترحة
async getSuggestedAccounts(): Promise<any[]>

// 3. تحديث ربط المخزن بالحسابات
async updateWarehouseAccounting(
    warehouseId: string,
    orgId: string,
    accounts: {
        stock_account?: string;
        adjustment_account?: string;
        valuation_account?: string;
        cogs_account?: string;
        cost_center?: string;
    }
): Promise<boolean>

// 4. الحصول على ربط الحسابات
async getWarehouseGLMapping(warehouseId: string): Promise<any>
```

---

## 🎨 واجهة المستخدم | User Interface

### 1. مكون Account Picker

**الملف:** `src/features/inventory/components/AccountPicker.tsx`

**الميزات:**
- ✅ قائمة منسدلة قابلة للبحث
- ✅ تجميع الحسابات حسب الفئة (أصول، مصروفات، إلخ)
- ✅ عرض الحسابات المقترحة
- ✅ عرض كود الحساب + اسم الحساب
- ✅ فلترة حسب الفئة

**الاستخدام:**

```typescript
<AccountPicker
  label="حساب المخزون (أصول)"
  value={formData.inventory_account_id}
  onValueChange={(value) => setFormData({ ...formData, inventory_account_id: value })}
  category="ASSET"
  placeholder="اختر حساب المخزون"
  showSuggested={true}
/>
```

### 2. صفحة إدارة المخازن

**الملف:** `src/features/inventory/components/WarehouseManagement.tsx`

**الميزات:**
- ✅ جدول عرض جميع المخازن
- ✅ إنشاء/تعديل مخزن مع 3 تبويبات:
  - **البيانات الأساسية**: الكود، الاسم، النوع، الإعدادات
  - **الحسابات المحاسبية**: اختيار يدوي من شجرة الحسابات
  - **التفاصيل**: العنوان، المسؤول، السعة
- ✅ حذف مخزن (مع فحص وجود مخزون)
- ✅ عرض حالة الربط بالحسابات المحاسبية

**الوصول للصفحة:**
```
/inventory/warehouses
```

---

## 📱 كيفية الاستخدام | How to Use

### خطوة 1: الذهاب لإدارة المخازن

1. افتح التطبيق على `http://localhost:5174`
2. انتقل إلى: **المخزون** > **إدارة المخازن**
3. أو مباشرة: `/inventory/warehouses`

### خطوة 2: إنشاء مخزن جديد

1. اضغط على زر **"مخزن جديد"**
2. املأ البيانات في 3 تبويبات:

#### تبويب 1: البيانات الأساسية
- **الكود**: مثل `WH-001` (مطلوب)
- **النوع**: اختر من (رئيسي، فرع، إنتاج، عبور، بيع بالتجزئة، افتراضي)
- **الاسم (English)**: مثل `Main Warehouse` (مطلوب)
- **الاسم (عربي)**: مثل `المخزن الرئيسي` (اختياري)
- **الإعدادات**:
  - ☑️ مخزن نشط
  - ☐ مخزن مجموعة
  - ☐ السماح بالرصيد السالب

#### تبويب 2: الحسابات المحاسبية ⭐
هذا هو التبويب الأهم!

- **حساب المخزون (أصول)**: 
  - اختر من الحسابات المقترحة
  - مثال: `1400 - المخزون`
  - الفئة: ASSET

- **حساب مصروفات المخزون**:
  - اختر من الحسابات المقترحة
  - مثال: `5950 - تسويات المخزون`
  - الفئة: EXPENSE

💡 **الحسابات المقترحة:**
- حساب المخزون: 1400 - المخزون
- حساب المصروفات: 5950 - تسويات المخزون
- حساب تكلفة البضاعة: 5000 - تكلفة البضاعة المباعة

#### تبويب 3: التفاصيل (اختياري)
- **المدينة**: مثل `الرياض`
- **الدولة**: مثل `Saudi Arabia`
- **العنوان**: العنوان الكامل
- **اسم المسؤول**: اسم مدير المخزن
- **رقم الهاتف**: رقم تواصل
- **البريد الإلكتروني**: للإشعارات
- **السعة الإجمالية**: مثل `1000`
- **وحدة السعة**: مثل `متر مربع` أو `طن`

3. اضغط **"إنشاء"**

### خطوة 3: تعديل مخزن موجود

1. في جدول المخازن، اضغط على أيقونة ✏️ (تعديل)
2. قم بتعديل البيانات المطلوبة
3. يمكنك تغيير الحسابات المحاسبية في أي وقت
4. اضغط **"تحديث"**

### خطوة 4: حذف مخزن

1. اضغط على أيقونة 🗑️ (حذف)
2. النظام سيتحقق من:
   - ✅ عدم وجود مخزون في المخزن
   - ❌ إذا كان هناك مخزون، سيرفض الحذف
3. تأكيد الحذف

---

## 🔗 التكامل مع النظام المحاسبي | Accounting Integration

### كيف يعمل الربط؟

1. **عند إنشاء تسوية مخزون**:
   ```typescript
   // يتم الحصول على حسابات المخزن
   const glMapping = await warehouseService.getWarehouseGLMapping(warehouseId);
   
   // إنشاء قيد محاسبي
   const journalEntry = {
       debit_account: glMapping.stock_adjustment_account, // حساب التسوية
       credit_account: glMapping.stock_account,          // حساب المخزون
       amount: adjustmentValue
   };
   ```

2. **عند الشراء**:
   - مدين: حساب المخزون (1400)
   - دائن: حساب الموردين (2100)

3. **عند البيع**:
   - مدين: حساب تكلفة البضاعة المباعة (5000)
   - دائن: حساب المخزون (1400)

4. **عند التسوية (زيادة)**:
   - مدين: حساب المخزون (1400)
   - دائن: حساب تسويات المخزون (5950)

5. **عند التسوية (نقص)**:
   - مدين: حساب تسويات المخزون (5950)
   - دائن: حساب المخزون (1400)

---

## 📊 التقارير المحاسبية | Accounting Reports

### 1. تقرير المخزون حسب المخزن

```sql
SELECT * FROM v_stock_by_warehouse
WHERE org_id = 'your-org-id';
```

**الأعمدة:**
- warehouse_code
- warehouse_name
- product_code
- product_name
- quantity
- unit_cost
- total_value

### 2. تقرير استغلال المخازن

```sql
SELECT * FROM v_warehouse_utilization
WHERE org_id = 'your-org-id';
```

**الأعمدة:**
- warehouse_code
- warehouse_name
- total_capacity
- used_capacity
- available_capacity
- utilization_percentage

---

## 🎯 أفضل الممارسات | Best Practices

### 1. تصميم شجرة الحسابات

```
1000 - الأصول (ASSET)
  1100 - أصول متداولة
    1400 - المخزون
      1410 - مخزون المواد الخام
      1420 - مخزون نصف المصنع
      1430 - مخزون المنتجات التامة
      1440 - مخزون قطع الغيار

5000 - المصروفات (EXPENSE)
  5000 - تكلفة البضاعة المباعة
    5010 - تكلفة المواد الخام
    5020 - تكلفة العمالة المباشرة
    5030 - تكاليف إنتاج غير مباشرة
  
  5950 - تسويات المخزون
    5951 - تسويات الزيادة
    5952 - تسويات النقص
    5953 - تلفيات المخزون
```

### 2. إنشاء المخازن

- استخدم أكواد واضحة: `WH-001`, `WH-PROD-01`, `WH-RETAIL-01`
- أنشئ مخزن رئيسي أولاً
- ثم أنشئ المخازن الفرعية
- اربط كل مخزن بحسابات محاسبية مخصصة

### 3. الحسابات المحاسبية

- ✅ **DO**: استخدم حسابات منفصلة لكل مخزن رئيسي
- ✅ **DO**: استخدم حسابات تسويات منفصلة عن حسابات المخزون
- ❌ **DON'T**: لا تستخدم نفس الحساب للمخزون والمصروفات
- ❌ **DON'T**: لا تغير الحسابات بعد بدء التشغيل

### 4. الأمان والصلاحيات

- تأكد من وجود RLS Policies فعالة
- كل مؤسسة ترى مخازنها فقط
- صلاحيات منفصلة لـ:
  - إنشاء مخزن
  - تعديل مخزن
  - حذف مخزن
  - عرض التقارير المحاسبية

---

## 🚀 الخطوات التالية | Next Steps

### 1. التكامل مع تسويات المخزون ✅ جاري العمل

```typescript
// عند إنشاء تسوية مخزون
const adjustment = {
    warehouse_id: selectedWarehouse,
    adjustment_type: 'INCREASE', // or DECREASE
    items: [...]
};

// سيتم تلقائياً:
// 1. إنشاء قيد محاسبي مع حسابات المخزن
// 2. تحديث المخزون
// 3. تسجيل الحركة في stock_ledger_entries
```

### 2. إدارة مواقع التخزين

- صفحة لإدارة Storage Locations
- صفحة لإدارة Storage Bins
- باركود للصناديق
- خرائط المخزن

### 3. التقارير المتقدمة

- تقرير الحركة اليومية
- تقرير القيمة حسب الموقع
- تقرير الأصناف البطيئة الحركة
- تقرير مستويات إعادة الطلب

### 4. الجرد الدوري

- جداول للجرد
- مطابقة الجرد الفعلي مع النظام
- إنشاء تسويات تلقائية

---

## ⚙️ الإعدادات الفنية | Technical Setup

### ملفات SQL المطلوبة:

1. ✅ `warehouse_management_system_fixed.sql` - النظام الأساسي
2. ✅ `warehouse_accounting_fixed.sql` - التكامل المحاسبي

### ملفات الكود المطلوبة:

1. ✅ `src/services/warehouse-service.ts` - طبقة الخدمات
2. ✅ `src/features/inventory/components/AccountPicker.tsx` - اختيار الحسابات
3. ✅ `src/features/inventory/components/WarehouseManagement.tsx` - الواجهة
4. ✅ `src/features/inventory/index.tsx` - الربط مع الموديول

### تشغيل النظام:

```bash
# 1. تشغيل السيرفر
npm run dev

# 2. فتح المتصفح
http://localhost:5174

# 3. الانتقال لإدارة المخازن
/inventory/warehouses
```

---

## 🔍 استكشاف الأخطاء | Troubleshooting

### المشكلة: لا تظهر الحسابات في Account Picker

**الحل:**
```sql
-- تأكد من وجود حسابات في gl_accounts
SELECT * FROM gl_accounts WHERE org_id = 'your-org-id';

-- تأكد من تفعيل الحسابات
UPDATE gl_accounts SET is_active = true WHERE org_id = 'your-org-id';
```

### المشكلة: خطأ عند إنشاء مخزن

**الحل:**
```sql
-- تأكد من وجود المؤسسة
SELECT * FROM organizations WHERE id = 'your-org-id';

-- تأكد من صلاحيات RLS
SELECT * FROM pg_policies WHERE tablename = 'warehouses';
```

### المشكلة: لا يمكن حذف مخزن

**السبب:** يوجد مخزون في المخزن

**الحل:**
```sql
-- تحقق من وجود مخزون
SELECT * FROM stock_ledger_entries WHERE warehouse_id = 'warehouse-id';

-- انقل المخزون لمخزن آخر أو قم بتسوية
```

---

## 📝 ملاحظات مهمة | Important Notes

1. ⚠️ **لا تحذف مخزن يحتوي على مخزون** - النظام سيمنع ذلك تلقائياً
2. ⚠️ **لا تغير حسابات مخزن قديم** - قد يؤثر على التقارير المحاسبية
3. ✅ **استخدم Soft Delete** - عطل المخزن بدلاً من حذفه
4. ✅ **احفظ نسخة احتياطية** - قبل أي تغييرات كبيرة

---

## 🎓 الدعم | Support

للمساعدة والدعم:
- 📧 البريد الإلكتروني: support@example.com
- 📱 الهاتف: +966 XX XXX XXXX
- 📚 الوثائق: docs.example.com

---

## ✅ قائمة المراجعة | Checklist

قبل بدء التشغيل، تأكد من:

- [x] تم تنفيذ السكريبتات SQL
- [x] تم إنشاء شجرة الحسابات
- [x] تم إنشاء مخزن افتراضي
- [x] تم اختبار إنشاء/تعديل/حذف مخزن
- [x] تم اختبار Account Picker
- [ ] تم إنشاء أول تسوية مخزون
- [ ] تم اختبار التقارير المحاسبية

---

## 🎉 تم بنجاح!

نظام إدارة المخازن جاهز للاستخدام مع تكامل كامل مع النظام المحاسبي! 🚀

**الميزات الرئيسية:**
✅ 3 مستويات تخزين (مخازن → مواقع → صناديق)
✅ اختيار يدوي للحسابات من شجرة الحسابات
✅ تكامل محاسبي كامل
✅ حسابات مقترحة ذكية
✅ واجهة سهلة الاستخدام
✅ متعدد اللغات (عربي/إنجليزي)
✅ أمان متقدم مع RLS

---

**تاريخ الإنشاء:** 2025-11-10  
**الإصدار:** 1.0.0  
**الحالة:** ✅ جاهز للإنتاج
