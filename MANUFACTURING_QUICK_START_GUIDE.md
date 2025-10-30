# 🚀 دليل البدء السريع - قسم التصنيع
## Manufacturing Module Quick Start Guide

> **للبدء الفوري في تطوير قسم التصنيع**

---

## 📋 المحتويات

1. [البداية السريعة](#البداية-السريعة)
2. [الهيكل الحالي](#الهيكل-الحالي)
3. [خطوات التطوير الأولى](#خطوات-التطوير-الأولى)
4. [أمثلة عملية](#أمثلة-عملية)

---

## 🎯 البداية السريعة

### **ما الذي لديك الآن؟**

```
✅ نظام Process Costing متقدم
✅ لوحة احتساب مراحل التصنيع (Stage Costing Panel)
✅ نظام الوحدات المكافئة (Equivalent Units)
✅ تنبيهات الانحرافات (Variance Alerts)
✅ Real-time Subscriptions
✅ 5 مراحل تصنيع محددة
```

### **ما الذي تحتاجه بشكل عاجل؟**

```
🔴 CRITICAL:
1. نظام إدارة قوائم المواد (BOM)
2. تحسين إدارة مراكز العمل
3. نظام التحكم في أرضية الإنتاج
4. التكامل مع المخزون

🟡 IMPORTANT:
5. نظام التكاليف المعيارية
6. نظام ضبط الجودة
7. التقارير الشاملة
```

---

## 📂 الهيكل الحالي

### **ملفات القسم:**

```
src/features/manufacturing/
├── index.tsx                          # الواجهة الرئيسية
├── stage-costing-panel.tsx            # لوحة التكاليف
├── equivalent-units-dashboard.tsx     # الوحدات المكافئة
├── variance-alerts.tsx                # تنبيهات الانحرافات
└── stage-costing-actions.js          # العمليات

src/domain/manufacturing/
├── processCosting.ts                  # منطق Process Costing
└── equivalentUnits.ts                 # منطق الوحدات المكافئة

Database Tables:
├── manufacturing_orders               # أوامر التصنيع
├── work_centers                       # مراكز العمل
├── stage_costs                        # تكاليف المراحل
├── bom_headers                        # رؤوس قوائم المواد
├── bom_lines                          # تفاصيل قوائم المواد
└── labor_time_entries                 # تسجيل أوقات العمالة
```

---

## 🛠️ خطوات التطوير الأولى

### **الأسبوع الأول: إعداد BOM Management**

#### **1. تحديث قاعدة البيانات**

```sql
-- أضف الأعمدة المفقودة
ALTER TABLE bom_headers ADD COLUMN IF NOT EXISTS
    bom_version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    effective_date DATE,
    unit_cost NUMERIC(18,4) DEFAULT 0;

ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS
    line_type VARCHAR(20) DEFAULT 'COMPONENT',
    scrap_factor NUMERIC(5,2) DEFAULT 0,
    is_critical BOOLEAN DEFAULT false;

-- أنشئ جدول الإصدارات
CREATE TABLE IF NOT EXISTS bom_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bom_id UUID NOT NULL REFERENCES bom_headers(id),
    version_number INTEGER NOT NULL,
    change_description TEXT,
    changed_at TIMESTAMP DEFAULT NOW(),
    org_id UUID NOT NULL,
    UNIQUE(bom_id, version_number)
);
```

#### **2. أنشئ واجهة BOM Builder**

```typescript
// src/features/manufacturing/bom/BOMBuilder.tsx

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardContent } from '@/components/ui/card'

interface BOMLine {
    id: string
    itemId: string
    itemName: string
    quantity: number
    unit: string
    scrapFactor: number
}

export function BOMBuilder() {
    const [bomHeader, setBomHeader] = useState({
        itemId: '',
        bomNumber: '',
        description: '',
        version: 1
    })
    
    const [bomLines, setBomLines] = useState<BOMLine[]>([])
    
    const addLine = () => {
        setBomLines([...bomLines, {
            id: crypto.randomUUID(),
            itemId: '',
            itemName: '',
            quantity: 0,
            unit: 'EA',
            scrapFactor: 0
        }])
    }
    
    const saveBOM = async () => {
        // حفظ BOM في قاعدة البيانات
    }
    
    return (
        <div className="space-y-6">
            <Card className="wardah-glass-card">
                <CardHeader>
                    <h2 className="text-xl font-bold wardah-text-gradient-google">
                        قائمة المواد (BOM)
                    </h2>
                </CardHeader>
                <CardContent>
                    {/* معلومات الرأس */}
                    <div className="grid md:grid-cols-3 gap-4 mb-6">
                        <div>
                            <label>رقم القائمة</label>
                            <Input 
                                value={bomHeader.bomNumber}
                                onChange={(e) => setBomHeader({...bomHeader, bomNumber: e.target.value})}
                            />
                        </div>
                        <div>
                            <label>الصنف</label>
                            <select className="w-full px-3 py-2 border rounded-md">
                                <option>اختر الصنف</option>
                            </select>
                        </div>
                        <div>
                            <label>الإصدار</label>
                            <Input type="number" value={bomHeader.version} readOnly />
                        </div>
                    </div>
                    
                    {/* خطوط BOM */}
                    <div className="mb-4">
                        <Button onClick={addLine}>+ إضافة مادة</Button>
                    </div>
                    
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="border-b">
                                <th className="text-right p-2">المادة</th>
                                <th className="text-right p-2">الكمية</th>
                                <th className="text-right p-2">الوحدة</th>
                                <th className="text-right p-2">نسبة الهالك %</th>
                                <th className="text-right p-2">إجراءات</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bomLines.map((line, index) => (
                                <tr key={line.id} className="border-b">
                                    <td className="p-2">
                                        <select className="w-full px-2 py-1 border rounded">
                                            <option>اختر المادة</option>
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <Input 
                                            type="number" 
                                            value={line.quantity}
                                            className="w-24"
                                        />
                                    </td>
                                    <td className="p-2">
                                        <Input value={line.unit} className="w-20" />
                                    </td>
                                    <td className="p-2">
                                        <Input 
                                            type="number" 
                                            value={line.scrapFactor}
                                            className="w-20"
                                        />
                                    </td>
                                    <td className="p-2">
                                        <Button 
                                            size="sm" 
                                            variant="destructive"
                                            onClick={() => {
                                                setBomLines(bomLines.filter((_, i) => i !== index))
                                            }}
                                        >
                                            حذف
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    
                    <div className="mt-6 flex gap-3">
                        <Button onClick={saveBOM} className="bg-green-600">
                            حفظ القائمة
                        </Button>
                        <Button variant="outline">
                            إلغاء
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
```

#### **3. أضف المسار للواجهة**

```typescript
// src/features/manufacturing/index.tsx

// أضف هذا في Routes
<Route path="bom" element={<BOMManagement />} />
<Route path="bom/:bomId" element={<BOMBuilder />} />
```

---

### **الأسبوع الثاني: تحسين Work Centers**

#### **1. تحديث قاعدة البيانات**

```sql
ALTER TABLE work_centers ADD COLUMN IF NOT EXISTS
    daily_capacity NUMERIC(10,2),
    efficiency_rate NUMERIC(5,2) DEFAULT 100,
    cost_per_hour NUMERIC(10,2);
```

#### **2. واجهة إعداد مركز العمل**

```typescript
// src/features/manufacturing/workcenters/WorkCenterForm.tsx

export function WorkCenterForm() {
    const [formData, setFormData] = useState({
        code: '',
        name: '',
        description: '',
        dailyCapacity: 0,
        efficiencyRate: 100,
        costPerHour: 0
    })
    
    return (
        <Card className="wardah-glass-card">
            <CardHeader>
                <h2 className="text-xl font-bold">إعداد مركز العمل</h2>
            </CardHeader>
            <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                    <div>
                        <label>رمز المركز</label>
                        <Input 
                            value={formData.code}
                            onChange={(e) => setFormData({...formData, code: e.target.value})}
                        />
                    </div>
                    <div>
                        <label>اسم المركز</label>
                        <Input 
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                        />
                    </div>
                    <div>
                        <label>الطاقة اليومية (ساعات)</label>
                        <Input 
                            type="number"
                            value={formData.dailyCapacity}
                            onChange={(e) => setFormData({...formData, dailyCapacity: parseFloat(e.target.value)})}
                        />
                    </div>
                    <div>
                        <label>معدل الكفاءة (%)</label>
                        <Input 
                            type="number"
                            value={formData.efficiencyRate}
                            onChange={(e) => setFormData({...formData, efficiencyRate: parseFloat(e.target.value)})}
                        />
                    </div>
                    <div>
                        <label>تكلفة الساعة (ريال)</label>
                        <Input 
                            type="number"
                            value={formData.costPerHour}
                            onChange={(e) => setFormData({...formData, costPerHour: parseFloat(e.target.value)})}
                        />
                    </div>
                </div>
                
                <div className="mt-6">
                    <Button className="bg-green-600">حفظ</Button>
                </div>
            </CardContent>
        </Card>
    )
}
```

---

### **الأسبوع الثالث: Shop Floor Terminal (بسيط)**

#### **1. نموذج مبسط لـ Terminal**

```typescript
// src/features/manufacturing/shopfloor/ShopFloorTerminal.tsx

export function ShopFloorTerminal() {
    const [selectedOperation, setSelectedOperation] = useState<string | null>(null)
    const [clockedIn, setClockedIn] = useState(false)
    const [quantityProduced, setQuantityProduced] = useState(0)
    
    const handleClockIn = () => {
        setClockedIn(true)
        // حفظ وقت البداية
    }
    
    const handleClockOut = () => {
        setClockedIn(false)
        // حفظ وقت النهاية + الكمية المنتجة
    }
    
    return (
        <div className="max-w-4xl mx-auto p-6 space-y-6">
            <Card className="wardah-glass-card">
                <CardHeader>
                    <h1 className="text-2xl font-bold text-center">
                        محطة أرضية الإنتاج
                    </h1>
                </CardHeader>
                <CardContent>
                    {/* اختيار العملية */}
                    <div className="mb-6">
                        <label className="text-lg font-medium">اختر العملية</label>
                        <select 
                            className="w-full p-3 border rounded-lg mt-2 text-lg"
                            value={selectedOperation || ''}
                            onChange={(e) => setSelectedOperation(e.target.value)}
                        >
                            <option value="">-- اختر العملية --</option>
                            <option value="op1">MO-001 - Stage 10 - Rolling</option>
                            <option value="op2">MO-002 - Stage 20 - Transparency</option>
                        </select>
                    </div>
                    
                    {/* أزرار التسجيل */}
                    {selectedOperation && (
                        <div className="space-y-4">
                            <div className="flex gap-4">
                                {!clockedIn ? (
                                    <Button 
                                        onClick={handleClockIn}
                                        className="flex-1 h-20 text-xl bg-green-600"
                                    >
                                        🕐 بدء العمل
                                    </Button>
                                ) : (
                                    <Button 
                                        onClick={handleClockOut}
                                        className="flex-1 h-20 text-xl bg-red-600"
                                    >
                                        🕐 إنهاء العمل
                                    </Button>
                                )}
                            </div>
                            
                            {clockedIn && (
                                <div className="mt-6">
                                    <label className="text-lg font-medium">الكمية المنتجة</label>
                                    <Input 
                                        type="number"
                                        value={quantityProduced}
                                        onChange={(e) => setQuantityProduced(parseInt(e.target.value))}
                                        className="mt-2 text-2xl text-center h-16"
                                        placeholder="أدخل الكمية"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
            
            {/* عرض الحالة */}
            {clockedIn && (
                <Card className="wardah-glass-card bg-green-50">
                    <CardContent className="p-6 text-center">
                        <div className="text-4xl font-bold text-green-600">
                            {new Date().toLocaleTimeString('ar-SA')}
                        </div>
                        <div className="text-lg mt-2 text-green-700">
                            ⏱️ جاري العمل...
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
```

---

## 📊 أمثلة عملية

### **مثال 1: حساب تكلفة المرحلة**

```typescript
// استخدام النظام الحالي
import { processCostingCalculator } from '@/domain/manufacturing/processCosting'

const calculateStageCost = async () => {
    const result = processCostingCalculator.calculateStageCost(
        10, // Stage number
        1000, // Good quantity
        50, // Scrap quantity
        {
            directMaterialsCost: 5000,
            directLaborCost: 2000,
            manufacturingOverheadCost: 1500
        },
        0 // Previous stage unit cost
    )
    
    console.log('Total Cost:', result.totalCost)
    console.log('Unit Cost:', result.unitCost)
    console.log('Efficiency:', result.efficiency)
}
```

### **مثال 2: تسجيل وقت العمالة**

```typescript
import { processCostingCalculator } from '@/domain/manufacturing/processCosting'

const applyLabor = async () => {
    const laborCost = await processCostingCalculator.applyLaborCost(
        'mo-id-123',
        10, // Stage number
        8, // Hours worked
        50, // Hourly rate
        'أحمد علي' // Worker name
    )
    
    console.log('Labor Cost Applied:', laborCost)
}
```

### **مثال 3: تحليل الانحرافات**

```typescript
import { equivalentUnitsService } from '@/domain/manufacturing/equivalentUnits'

const analyzeVariances = async () => {
    const variance = await equivalentUnitsService.performVarianceAnalysis(
        'mo-id-123',
        10 // Stage number
    )
    
    console.log('Material Variance:', variance.materialCostVariance)
    console.log('Labor Variance:', variance.laborCostVariance)
    console.log('Severity:', variance.varianceSeverity)
}
```

---

## 🎯 نصائح البدء

### **1. ابدأ بسيط**
- لا تحاول تطوير كل شيء مرة واحدة
- ابدأ بـ MVP (Minimum Viable Product)
- اختبر كل ميزة بشكل مستقل

### **2. استخدم ما لديك**
- النظام الحالي قوي جداً
- Process Costing يعمل بشكل ممتاز
- Real-time system جاهز

### **3. التكامل تدريجياً**
- BOM أولاً (أهم شيء)
- Work Centers ثانياً
- Shop Floor ثالثاً
- Quality Control رابعاً

### **4. اختبر باستمرار**
- Unit Tests لكل دالة
- Integration Tests للتكامل
- E2E Tests للواجهات

### **5. وثق كل شيء**
- JSDoc للأكواد
- README للوحدات
- User Guide للمستخدمين

---

## 🔗 روابط مفيدة

### **الملفات الهامة:**
```
📄 MANUFACTURING_MODULE_DEVELOPMENT_PLAN.md    (الخطة الكاملة)
📄 src/features/manufacturing/index.tsx        (الواجهة الرئيسية)
📄 src/domain/manufacturing/processCosting.ts  (منطق التكاليف)
📄 supabase-setup.sql                          (قاعدة البيانات)
```

### **التوثيق:**
- Process Costing Methodology
- Equivalent Units Calculation
- Variance Analysis
- Real-time Subscriptions

---

## ✅ Checklist للأسبوع الأول

- [ ] فهم الهيكل الحالي
- [ ] قراءة الملفات الأساسية
- [ ] تشغيل النظام محلياً
- [ ] اختبار Stage Costing Panel
- [ ] تحديث قاعدة البيانات (BOM)
- [ ] إنشاء BOM Builder بسيط
- [ ] اختبار حفظ BOM
- [ ] إضافة المسار للواجهة
- [ ] كتابة اختبارات بسيطة
- [ ] توثيق التغييرات

---

## 🆘 الدعم

**إذا واجهت أي مشاكل:**
1. راجع الملفات الموجودة
2. اختبر النظام الحالي
3. ابدأ بنسخة بسيطة
4. اطلب المساعدة

**الملفات المرجعية:**
- `stage-costing-panel.tsx` - مثال على واجهة متقدمة
- `processCosting.ts` - مثال على منطق معقد
- `equivalent-units-dashboard.tsx` - مثال على Dashboard

---

## 🚀 البدء الآن!

**الخطوة الأولى:**
```bash
# 1. افتح المشروع
cd wardah-process-costing

# 2. تأكد من تشغيل الخادم
npm run dev

# 3. افتح المتصفح
http://localhost:5173/manufacturing

# 4. ابدأ التطوير!
```

**الخطوة الثانية:**
- افتح `src/features/manufacturing/bom/BOMBuilder.tsx`
- ابدأ البرمجة
- احفظ وشاهد النتائج فوراً

**الخطوة الثالثة:**
- اختبر الميزة
- وثق التغييرات
- انتقل للميزة التالية

---

**🎉 مبروك! أنت الآن جاهز للبدء في تطوير قسم التصنيع!**

---

*تم إعداد هذا الدليل لمساعدتك على البدء السريع والفعال*  
*راجع الخطة الشاملة في `MANUFACTURING_MODULE_DEVELOPMENT_PLAN.md` للتفاصيل الكاملة*
