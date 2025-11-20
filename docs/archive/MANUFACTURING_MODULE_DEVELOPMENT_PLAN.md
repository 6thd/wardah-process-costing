# 📊 خطة تطوير شاملة لقسم التصنيع - Wardah ERP
## Manufacturing Module Comprehensive Development Plan

> **بصفتي محاسب تكاليف محترف ومصمم أنظمة ERP عالمية**  
> تم إعداد هذه الخطة بناءً على أفضل الممارسات الدولية ومعايير محاسبة التكاليف

---

## 📋 جدول المحتويات

1. [التقييم الحالي](#1-التقييم-الحالي)
2. [نقاط القوة](#2-نقاط-القوة)
3. [الفجوات والتحديات](#3-الفجوات-والتحديات)
4. [خطة التطوير الشاملة](#4-خطة-التطوير-الشاملة)
5. [المراحل التنفيذية](#5-المراحل-التنفيذية)
6. [معايير الجودة والقياس](#6-معايير-الجودة-والقياس)

---

## 1. التقييم الحالي
### Current System Assessment

### ✅ **المكونات الموجودة:**

#### **أ. البنية التحتية (Infrastructure)**
- ✅ Process Costing System - نظام تكاليف المراحل
- ✅ Stage Costing Panel - لوحة احتساب مراحل التصنيع
- ✅ Equivalent Units Dashboard - لوحة الوحدات المكافئة
- ✅ Variance Alerts System - نظام تنبيهات الانحرافات
- ✅ Real-time Subscriptions - اشتراكات البيانات الحية
- ✅ React Query Integration - تكامل مع React Query

#### **ب. قاعدة البيانات (Database Schema)**
```sql
✅ manufacturing_orders   - أوامر التصنيع
✅ work_centers          - مراكز العمل
✅ stage_costs           - تكاليف المراحل
✅ bom_headers           - رؤوس قوائم المواد
✅ bom_lines             - تفاصيل قوائم المواد
✅ labor_time_entries    - تسجيل أوقات العمالة
✅ overhead_allocations  - تخصيصات التكاليف غير المباشرة
```

#### **ج. منطق الأعمال (Business Logic)**
- ✅ Process Costing Calculator - حاسبة تكاليف المراحل
- ✅ Equivalent Units Service - خدمة الوحدات المكافئة
- ✅ Variance Analysis Engine - محرك تحليل الانحرافات
- ✅ AVCO Integration - تكامل مع نظام المتوسط المرجح

#### **د. المراحل المحددة (5 Stages)**
```
Stage 10: Rolling Stage (المرحلة الأولى - تصنيع الرول)
Stage 20: Transparency Processing (معالجة الشفافية)
Stage 30: Lid Formation (تشكيل الأغطية)
Stage 40: Container Formation (تشكيل العلب)
Stage 50: Regrind Processing (معالجة الهالك والإرجاع)
```

---

## 2. نقاط القوة
### System Strengths

### 🌟 **التميز التقني:**

1. **نظام Process Costing متقدم**
   - Transferred-in Costs Logic - تكاليف محولة من مراحل سابقة
   - Equivalent Units Calculation - حساب الوحدات المكافئة
   - Multi-stage Cost Tracking - تتبع التكاليف عبر المراحل

2. **Real-time System Architecture**
   - Supabase Realtime Subscriptions
   - Automatic UI Updates
   - Connection Status Monitoring

3. **Variance Analysis Intelligence**
   - Multi-level Severity (LOW/MEDIUM/HIGH)
   - Automatic GL Posting for Significant Variances
   - Notification System Integration

4. **Cost Component Breakdown**
   ```typescript
   - Direct Materials Cost
   - Direct Labor Cost
   - Manufacturing Overhead Cost
   - Regrind Processing Cost
   - Waste Credit Value
   ```

5. **Professional UI/UX**
   - Wardah Glass Cards Design
   - Animation Effects
   - Bilingual Support (AR/EN)
   - Responsive Layout

---

## 3. الفجوات والتحديات
### Gaps and Challenges

### 🔴 **المستوى الحرج (Critical Issues):**

#### **A. Bill of Materials (BOM) System - قوائم المواد**
```typescript
❌ لا توجد واجهة لإدارة BOM
❌ لا يوجد نظام لحساب المواد المطلوبة
❌ لا يوجد تكامل مع المخزون
❌ لا يوجد تتبع للنسخ والإصدارات

الحل المطلوب:
✅ BOM Builder Interface
✅ Material Requirements Planning (MRP)
✅ BOM Version Control
✅ Cost Rollup Calculator
✅ Where-Used Reports
```

#### **B. Work Centers Management - مراكز العمل**
```typescript
❌ لا توجد واجهة إدارة كاملة
❌ لا يوجد جدولة الإنتاج
❌ لا يوجد تتبع الطاقة الإنتاجية
❌ لا يوجد حساب تكلفة الساعة

الحل المطلوب:
✅ Work Center Configuration
✅ Capacity Planning
✅ Machine Hour Tracking
✅ Efficiency Monitoring
✅ Maintenance Scheduling
```

#### **C. Shop Floor Control - التحكم في أرضية الإنتاج**
```typescript
❌ لا يوجد نظام تتبع الإنتاج الفعلي
❌ لا يوجد Barcode/QR Code Scanning
❌ لا يوجد تسجيل الدخول/الخروج للعمليات
❌ لا يوجد تتبع حركة المواد

الحل المطلوب:
✅ Shop Floor Terminal
✅ Operation Check-in/out
✅ Material Movement Tracking
✅ Real-time Progress Updates
✅ Mobile App Integration
```

#### **D. Quality Control - ضبط الجودة**
```typescript
❌ لا يوجد نظام فحص الجودة
❌ لا يوجد تسجيل العيوب
❌ لا يوجد إدارة الشهادات
❌ لا يوجد تتبع المطابقة للمعايير

الحل المطلوب:
✅ Quality Inspection Workflows
✅ Defect Tracking & Classification
✅ Certificate Management
✅ Statistical Process Control (SPC)
✅ Non-Conformance Reports (NCR)
```

### 🟡 **المستوى المتوسط (Medium Priority):**

#### **E. Production Planning - تخطيط الإنتاج**
```typescript
❌ لا يوجد Master Production Schedule (MPS)
❌ لا يوجد Material Requirements Planning (MRP)
❌ لا يوجد Capacity Requirements Planning (CRP)
❌ لا يوجد نظام الأولويات

الحل المطلوب:
✅ MPS Module
✅ MRP Engine
✅ CRP Analysis
✅ Priority Scheduling
✅ What-If Scenarios
```

#### **F. Costing Enhancements - تحسينات التكاليف**
```typescript
❌ لا يوجد Standard Costing System
❌ لا يوجد Activity-Based Costing (ABC)
❌ لا يوجد Target Costing
❌ لا يوجد Cost Simulation

الحل المطلوب:
✅ Standard Cost Master
✅ ABC Implementation
✅ Target Cost Analysis
✅ Cost Simulation Tools
✅ Make vs. Buy Analysis
```

#### **G. Reporting & Analytics - التقارير والتحليلات**
```typescript
❌ محدودية التقارير المالية
❌ لا توجد تقارير إنتاجية شاملة
❌ لا يوجد Cost Variance Reports
❌ لا يوجد Profitability Analysis

الحل المطلوب:
✅ Comprehensive Report Builder
✅ Production Efficiency Reports
✅ Cost Variance Analysis
✅ Product Profitability
✅ Trend Analysis Dashboards
```

### 🟢 **المستوى المنخفض (Nice to Have):**

#### **H. Advanced Features - ميزات متقدمة**
```typescript
⚪ AI-Powered Demand Forecasting
⚪ Predictive Maintenance
⚪ Digital Twin Simulation
⚪ IoT Integration
⚪ Blockchain Traceability
```

---

## 4. خطة التطوير الشاملة
### Comprehensive Development Plan

## 📦 المرحلة 1: أساسيات الإنتاج (8-10 أسابيع)
### Phase 1: Production Fundamentals

### **1.1 Bill of Materials (BOM) Management** ⏱️ 3 أسابيع

#### **أ. Database Schema Extensions**
```sql
-- Add missing columns
ALTER TABLE bom_headers ADD COLUMN IF NOT EXISTS
    bom_version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    effective_date DATE,
    obsolete_date DATE,
    engineering_change_number VARCHAR(50),
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMP,
    unit_cost NUMERIC(18,4) DEFAULT 0,
    manufacturing_lead_time INTEGER DEFAULT 0; -- في الأيام

ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS
    line_type VARCHAR(20) DEFAULT 'COMPONENT', -- COMPONENT, SUBASSEMBLY, PHANTOM
    scrap_factor NUMERIC(5,2) DEFAULT 0,
    is_critical BOOLEAN DEFAULT false,
    substitute_item_id UUID REFERENCES items(id),
    operation_sequence INTEGER,
    backflush BOOLEAN DEFAULT false,
    planning_percentage NUMERIC(5,2) DEFAULT 100;

-- New tables needed
CREATE TABLE bom_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bom_id UUID NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    change_description TEXT,
    change_type VARCHAR(50), -- ENGINEERING, COST_REDUCTION, QUALITY
    changed_by UUID REFERENCES auth.users(id),
    changed_at TIMESTAMP DEFAULT NOW(),
    approved BOOLEAN DEFAULT false,
    org_id UUID NOT NULL REFERENCES organizations(id),
    UNIQUE(bom_id, version_number)
);

CREATE TABLE bom_cost_rollup (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bom_id UUID NOT NULL REFERENCES bom_headers(id),
    calculation_date TIMESTAMP DEFAULT NOW(),
    material_cost NUMERIC(18,4) DEFAULT 0,
    labor_cost NUMERIC(18,4) DEFAULT 0,
    overhead_cost NUMERIC(18,4) DEFAULT 0,
    total_cost NUMERIC(18,4) DEFAULT 0,
    org_id UUID NOT NULL REFERENCES organizations(id)
);
```

#### **ب. BOM Builder Interface**
```typescript
// src/features/manufacturing/bom/BOMBuilder.tsx

interface BOMBuilderProps {
    itemId?: string
    bomId?: string
    mode: 'create' | 'edit' | 'view' | 'copy'
}

export function BOMBuilder({ itemId, bomId, mode }: BOMBuilderProps) {
    // Features:
    // 1. Header Information
    //    - Item selection
    //    - BOM version control
    //    - Effective dates
    //    - Engineering change tracking
    
    // 2. Component Lines
    //    - Drag & drop reordering
    //    - Quantity calculations
    //    - Scrap factor
    //    - Operation sequence
    //    - Substitute items
    
    // 3. Cost Rollup
    //    - Real-time cost calculation
    //    - Multi-level BOM explosion
    //    - Cost breakdown by category
    
    // 4. Actions
    //    - Copy BOM
    //    - Create new version
    //    - Mass update
    //    - Export/Import Excel
    
    return (
        <div className="bom-builder-container">
            {/* Implementation */}
        </div>
    )
}
```

#### **ج. BOM Explosion & Where-Used**
```typescript
// src/domain/manufacturing/bomExplosion.ts

export class BOMExplosionService {
    /**
     * Multi-level BOM explosion with cost rollup
     */
    async explodeBOM(
        itemId: string,
        quantity: number,
        levels: number = 99
    ): Promise<BOMExplosionResult> {
        // Recursive explosion
        // Calculate total requirements
        // Apply scrap factors
        // Return hierarchical structure
    }
    
    /**
     * Where-Used analysis
     */
    async getWhereUsed(
        itemId: string,
        levels: number = 99
    ): Promise<WhereUsedResult[]> {
        // Find all BOMs using this item
        // Calculate impact of cost changes
        // Return parent hierarchy
    }
    
    /**
     * Cost Rollup Calculator
     */
    async calculateBOMCost(
        bomId: string,
        costBasis: 'standard' | 'average' | 'latest'
    ): Promise<BOMCostBreakdown> {
        // Calculate material cost
        // Add labor & overhead
        // Apply yield losses
        // Return detailed breakdown
    }
}
```

#### **د. Material Requirements Planning (MRP)**
```typescript
// src/features/manufacturing/planning/MRPEngine.tsx

export class MRPEngine {
    /**
     * Calculate material requirements
     */
    async calculateMaterialRequirements(
        moId: string,
        quantity: number,
        requiredDate: Date
    ): Promise<MaterialRequirement[]> {
        // Explode BOM
        // Check on-hand inventory
        // Consider lead times
        // Generate purchase/production suggestions
    }
    
    /**
     * Generate planned orders
     */
    async generatePlannedOrders(
        requirements: MaterialRequirement[]
    ): Promise<PlannedOrder[]> {
        // Create purchase requisitions
        // Create manufacturing orders
        // Consider lot sizes
        // Apply safety stock
    }
}
```

---

### **1.2 Work Centers Management** ⏱️ 2 أسابيع

#### **أ. Database Enhancements**
```sql
ALTER TABLE work_centers ADD COLUMN IF NOT EXISTS
    capacity_uom VARCHAR(20) DEFAULT 'HOURS', -- HOURS, UNITS, PIECES
    daily_capacity NUMERIC(10,2),
    efficiency_rate NUMERIC(5,2) DEFAULT 100,
    utilization_rate NUMERIC(5,2) DEFAULT 80,
    cost_per_hour NUMERIC(10,2),
    setup_time_minutes INTEGER DEFAULT 0,
    queue_time_hours NUMERIC(8,2) DEFAULT 0,
    move_time_hours NUMERIC(8,2) DEFAULT 0,
    calendar_id UUID, -- Work calendar (shifts, holidays)
    department VARCHAR(100),
    supervisor_id UUID REFERENCES auth.users(id);

CREATE TABLE work_center_calendar (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    day_of_week INTEGER, -- 0=Sunday, 6=Saturday
    shift_start TIME,
    shift_end TIME,
    is_working_day BOOLEAN DEFAULT true,
    org_id UUID NOT NULL REFERENCES organizations(id)
);

CREATE TABLE work_center_capacity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    log_date DATE NOT NULL,
    planned_hours NUMERIC(8,2),
    actual_hours NUMERIC(8,2),
    downtime_hours NUMERIC(8,2),
    efficiency NUMERIC(5,2),
    org_id UUID NOT NULL REFERENCES organizations(id)
);
```

#### **ب. Work Center Configuration UI**
```typescript
// src/features/manufacturing/workcenters/WorkCenterConfig.tsx

export function WorkCenterConfig() {
    // Features:
    // 1. Basic Info
    //    - Code, Name, Description
    //    - Department, Location
    //    - Supervisor assignment
    
    // 2. Capacity Planning
    //    - Daily/weekly capacity
    //    - Shift schedule
    //    - Efficiency rates
    
    // 3. Costing
    //    - Labor rate per hour
    //    - Machine cost per hour
    //    - Overhead allocation
    
    // 4. Time Standards
    //    - Setup time
    //    - Queue time
    //    - Move time
    
    // 5. Maintenance Schedule
    //    - Preventive maintenance
    //    - Downtime planning
}
```

#### **ج. Capacity Requirements Planning (CRP)**
```typescript
// src/features/manufacturing/planning/CRPAnalysis.tsx

export function CRPAnalysis() {
    /**
     * Analyze capacity requirements vs. available capacity
     */
    async analyzeCapacity(
        startDate: Date,
        endDate: Date,
        workCenterId?: string
    ): Promise<CapacityAnalysisResult> {
        // Calculate required capacity from MOs
        // Compare to available capacity
        // Identify bottlenecks
        // Suggest load leveling
    }
    
    /**
     * Visual capacity loading chart
     */
    renderCapacityChart() {
        // Gantt-style chart
        // Color-coded by utilization %
        // Drag-drop rescheduling
    }
}
```

---

### **1.3 Shop Floor Control** ⏱️ 3 أسابيع

#### **أ. Database Schema**
```sql
CREATE TABLE shop_floor_operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id),
    operation_sequence INTEGER NOT NULL,
    operation_code VARCHAR(50),
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    standard_setup_time NUMERIC(8,2),
    standard_run_time_per_unit NUMERIC(8,2),
    quantity_to_produce NUMERIC(18,4),
    quantity_completed NUMERIC(18,4) DEFAULT 0,
    quantity_scrapped NUMERIC(18,4) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED, CANCELLED
    scheduled_start TIMESTAMP,
    scheduled_end TIMESTAMP,
    actual_start TIMESTAMP,
    actual_end TIMESTAMP,
    assigned_to UUID REFERENCES auth.users(id),
    org_id UUID NOT NULL REFERENCES organizations(id)
);

CREATE TABLE operation_time_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operation_id UUID NOT NULL REFERENCES shop_floor_operations(id),
    employee_id UUID REFERENCES auth.users(id),
    clock_in TIMESTAMP NOT NULL,
    clock_out TIMESTAMP,
    break_minutes INTEGER DEFAULT 0,
    quantity_produced NUMERIC(18,4),
    notes TEXT,
    org_id UUID NOT NULL REFERENCES organizations(id)
);

CREATE TABLE material_movement_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id),
    item_id UUID NOT NULL REFERENCES items(id),
    from_location VARCHAR(100),
    to_location VARCHAR(100),
    quantity NUMERIC(18,4),
    movement_type VARCHAR(20), -- ISSUE, RETURN, TRANSFER, SCRAP
    moved_by UUID REFERENCES auth.users(id),
    moved_at TIMESTAMP DEFAULT NOW(),
    org_id UUID NOT NULL REFERENCES organizations(id)
);
```

#### **ب. Shop Floor Terminal Interface**
```typescript
// src/features/manufacturing/shopfloor/ShopFloorTerminal.tsx

export function ShopFloorTerminal() {
    // Features:
    // 1. Employee Login
    //    - Badge/QR scan
    //    - PIN entry
    //    - Shift selection
    
    // 2. Operation Selection
    //    - View assigned operations
    //    - Select operation to work on
    //    - View work instructions
    
    // 3. Time Tracking
    //    - Clock in/out
    //    - Break recording
    //    - Quantity reporting
    
    // 4. Material Consumption
    //    - Scan material barcode
    //    - Record quantity used
    //    - Report shortages
    
    // 5. Quality Recording
    //    - Report good quantity
    //    - Report scrap/rework
    //    - Document issues
    
    return (
        <div className="shop-floor-terminal">
            <OperationList />
            <TimeClockWidget />
            <QuantityReporter />
            <MaterialScanner />
            <QualityRecorder />
        </div>
    )
}
```

#### **ج. Real-time Production Monitoring**
```typescript
// src/features/manufacturing/monitoring/ProductionMonitor.tsx

export function ProductionMonitor() {
    /**
     * Real-time dashboard showing:
     * - Active operations by work center
     * - Current production rates
     * - Efficiency metrics
     * - Material consumption
     * - Quality issues
     */
    
    return (
        <div className="production-monitor">
            <LiveProductionMap />
            <EfficiencyGauges />
            <MaterialConsumptionTracker />
            <QualityAlerts />
            <BottleneckIdentifier />
        </div>
    )
}
```

---

### **1.4 Quality Control** ⏱️ 2 أسابيع

#### **أ. Database Schema**
```sql
CREATE TABLE quality_inspection_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_code VARCHAR(50) UNIQUE NOT NULL,
    plan_name VARCHAR(200) NOT NULL,
    item_id UUID REFERENCES items(id),
    inspection_type VARCHAR(50), -- RECEIVING, IN_PROCESS, FINAL, SAMPLING
    sampling_method VARCHAR(50), -- 100%, AQL, SKIP_LOT
    sample_size INTEGER,
    acceptance_level INTEGER,
    org_id UUID NOT NULL REFERENCES organizations(id)
);

CREATE TABLE quality_characteristics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID NOT NULL REFERENCES quality_inspection_plans(id),
    characteristic_name VARCHAR(200) NOT NULL,
    data_type VARCHAR(20), -- NUMERIC, TEXT, PASS_FAIL
    target_value NUMERIC(18,4),
    lower_spec_limit NUMERIC(18,4),
    upper_spec_limit NUMERIC(18,4),
    measurement_unit VARCHAR(50),
    is_critical BOOLEAN DEFAULT false,
    org_id UUID NOT NULL REFERENCES organizations(id)
);

CREATE TABLE quality_inspections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inspection_number VARCHAR(50) UNIQUE NOT NULL,
    plan_id UUID NOT NULL REFERENCES quality_inspection_plans(id),
    mo_id UUID REFERENCES manufacturing_orders(id),
    receipt_id UUID, -- For receiving inspections
    inspection_date TIMESTAMP DEFAULT NOW(),
    inspector_id UUID REFERENCES auth.users(id),
    lot_size NUMERIC(18,4),
    sample_size NUMERIC(18,4),
    accepted_quantity NUMERIC(18,4) DEFAULT 0,
    rejected_quantity NUMERIC(18,4) DEFAULT 0,
    overall_result VARCHAR(20), -- ACCEPTED, REJECTED, CONDITIONAL
    notes TEXT,
    org_id UUID NOT NULL REFERENCES organizations(id)
);

CREATE TABLE quality_measurements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inspection_id UUID NOT NULL REFERENCES quality_inspections(id),
    characteristic_id UUID NOT NULL REFERENCES quality_characteristics(id),
    measured_value NUMERIC(18,4),
    text_value TEXT,
    pass_fail_result BOOLEAN,
    is_out_of_spec BOOLEAN DEFAULT false,
    org_id UUID NOT NULL REFERENCES organizations(id)
);

CREATE TABLE non_conformance_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ncr_number VARCHAR(50) UNIQUE NOT NULL,
    inspection_id UUID REFERENCES quality_inspections(id),
    mo_id UUID REFERENCES manufacturing_orders(id),
    reported_date TIMESTAMP DEFAULT NOW(),
    reported_by UUID REFERENCES auth.users(id),
    severity VARCHAR(20), -- MINOR, MAJOR, CRITICAL
    defect_type VARCHAR(100),
    defect_description TEXT,
    root_cause TEXT,
    corrective_action TEXT,
    preventive_action TEXT,
    status VARCHAR(20) DEFAULT 'OPEN', -- OPEN, IN_REVIEW, RESOLVED, CLOSED
    closed_date TIMESTAMP,
    org_id UUID NOT NULL REFERENCES organizations(id)
);
```

#### **ب. Quality Inspection Interface**
```typescript
// src/features/manufacturing/quality/QualityInspection.tsx

export function QualityInspection() {
    // Features:
    // 1. Inspection Plan Selection
    // 2. Sample Size Calculator
    // 3. Measurement Entry
    //    - Numeric measurements
    //    - Pass/Fail checks
    //    - Photos/attachments
    // 4. Automated Acceptance Decision
    // 5. NCR Generation
    // 6. Statistical Analysis
    //    - Control charts (X-bar, R, p-chart)
    //    - Cp, Cpk calculation
    //    - Trend analysis
}
```

---

## 📦 المرحلة 2: تحسينات التكاليف (6-8 أسابيع)
### Phase 2: Costing Enhancements

### **2.1 Standard Costing System** ⏱️ 3 أسابيع

#### **أ. Database Schema**
```sql
CREATE TABLE standard_costs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id UUID NOT NULL REFERENCES items(id),
    cost_type VARCHAR(50) NOT NULL, -- MATERIAL, LABOR, OVERHEAD, TOTAL
    standard_cost NUMERIC(18,4) NOT NULL,
    effective_date DATE NOT NULL,
    expiry_date DATE,
    created_by UUID REFERENCES auth.users(id),
    approved_by UUID REFERENCES auth.users(id),
    approval_date TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    org_id UUID NOT NULL REFERENCES organizations(id),
    UNIQUE(item_id, cost_type, effective_date)
);

CREATE TABLE cost_variance_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_date TIMESTAMP DEFAULT NOW(),
    item_id UUID NOT NULL REFERENCES items(id),
    mo_id UUID REFERENCES manufacturing_orders(id),
    variance_type VARCHAR(50), -- MATERIAL_PRICE, MATERIAL_USAGE, LABOR_RATE, LABOR_EFFICIENCY, OVERHEAD
    standard_cost NUMERIC(18,4),
    actual_cost NUMERIC(18,4),
    variance_amount NUMERIC(18,4),
    variance_percentage NUMERIC(5,2),
    gl_posted BOOLEAN DEFAULT false,
    org_id UUID NOT NULL REFERENCES organizations(id)
);
```

#### **ب. Standard Cost Management**
```typescript
// src/features/manufacturing/costing/StandardCostManager.tsx

export class StandardCostManager {
    /**
     * Set standard costs for an item
     */
    async setStandardCost(
        itemId: string,
        materialCost: number,
        laborCost: number,
        overheadCost: number,
        effectiveDate: Date
    ): Promise<void> {
        // Validate input
        // Store standard costs
        // Version control
        // Approval workflow
    }
    
    /**
     * Calculate cost variances
     */
    async calculateVariances(
        moId: string
    ): Promise<CostVarianceBreakdown> {
        // Compare actual vs. standard
        // Break down by component
        // Post significant variances to GL
        // Generate variance reports
    }
    
    /**
     * Standard cost rollup from BOM
     */
    async rollupStandardCost(
        bomId: string
    ): Promise<StandardCostRollup> {
        // Explode BOM
        // Sum material costs
        // Add routing labor/overhead
        // Store as standard cost
    }
}
```

---

### **2.2 Activity-Based Costing (ABC)** ⏱️ 2 أسابيع

#### **أ. Database Schema**
```sql
CREATE TABLE cost_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_code VARCHAR(50) UNIQUE NOT NULL,
    pool_name VARCHAR(200) NOT NULL,
    pool_type VARCHAR(50), -- SETUP, MACHINE, MATERIAL_HANDLING, QUALITY
    total_cost NUMERIC(18,4) DEFAULT 0,
    cost_driver VARCHAR(100), -- SETUPS, MACHINE_HOURS, MOVES, INSPECTIONS
    total_driver_quantity NUMERIC(18,4) DEFAULT 0,
    rate_per_driver NUMERIC(18,4) DEFAULT 0,
    org_id UUID NOT NULL REFERENCES organizations(id)
);

CREATE TABLE activity_cost_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id),
    pool_id UUID NOT NULL REFERENCES cost_pools(id),
    driver_quantity NUMERIC(18,4),
    allocated_cost NUMERIC(18,4),
    allocation_date TIMESTAMP DEFAULT NOW(),
    org_id UUID NOT NULL REFERENCES organizations(id)
);
```

#### **ب. ABC Implementation**
```typescript
// src/features/manufacturing/costing/ABCEngine.tsx

export class ABCEngine {
    /**
     * Define cost pools and drivers
     */
    async defineCostPool(
        poolName: string,
        costDriver: string,
        totalCost: number
    ): Promise<CostPool> {
        // Create cost pool
        // Assign cost driver
        // Calculate rate
    }
    
    /**
     * Allocate costs to manufacturing orders
     */
    async allocateCosts(
        moId: string
    ): Promise<ABCAllocation[]> {
        // Identify activities consumed
        // Measure driver quantities
        // Calculate allocated costs
        // Update MO costs
    }
    
    /**
     * Product profitability analysis
     */
    async analyzeProductProfitability(
        itemId: string,
        period: DateRange
    ): Promise<ProfitabilityReport> {
        // Calculate true product cost (ABC)
        // Compare to selling price
        // Identify profit drivers
        // Recommend actions
    }
}
```

---

### **2.3 Target Costing & Cost Simulation** ⏱️ 2 أسابيع

#### **أ. Target Costing Interface**
```typescript
// src/features/manufacturing/costing/TargetCosting.tsx

export function TargetCosting() {
    /**
     * Define target cost based on market price
     */
    async calculateTargetCost(
        targetSellingPrice: number,
        desiredProfitMargin: number
    ): Promise<TargetCostBreakdown> {
        // Calculate allowable cost
        // Break down by component
        // Compare to current cost
        // Identify cost gap
    }
    
    /**
     * Cost reduction scenario analysis
     */
    renderCostSimulation() {
        // What-if scenarios
        // Material substitution
        // Process improvements
        // Supplier negotiations
    }
}
```

#### **ب. Make vs. Buy Analysis**
```typescript
// src/features/manufacturing/analysis/MakeBuyAnalysis.tsx

export class MakeBuyAnalyzer {
    async analyzeMakeBuy(
        itemId: string,
        annualVolume: number
    ): Promise<MakeBuyRecommendation> {
        // Calculate internal production cost
        // Get supplier quotes
        // Consider quality factors
        // Evaluate capacity constraints
        // Recommend decision
    }
}
```

---

## 📦 المرحلة 3: التقارير والتحليلات (4-5 أسابيع)
### Phase 3: Reporting & Analytics

### **3.1 Comprehensive Report Builder** ⏱️ 2 أسابيع

```typescript
// src/features/manufacturing/reports/ReportBuilder.tsx

export const manufacturingReports = {
    production: [
        'Manufacturing Order Status Report',
        'Production Schedule Report',
        'Work Center Load Report',
        'Operation Completion Report',
        'Production Efficiency Report'
    ],
    
    costing: [
        'Cost of Goods Manufactured (COGM)',
        'Cost Variance Analysis',
        'Product Cost Report',
        'Work in Process Valuation',
        'Overhead Allocation Report'
    ],
    
    quality: [
        'Quality Inspection Summary',
        'Defect Analysis Report',
        'Non-Conformance Report (NCR)',
        'Statistical Process Control (SPC)',
        'First Pass Yield Report'
    ],
    
    materials: [
        'Material Requirements Report',
        'Material Consumption Report',
        'BOM Analysis Report',
        'Where-Used Report',
        'Material Shortage Report'
    ]
}
```

### **3.2 Advanced Analytics Dashboards** ⏱️ 2 أسابيع

```typescript
// src/features/manufacturing/analytics/AdvancedDashboards.tsx

export function ManufacturingAnalytics() {
    return (
        <DashboardLayout>
            {/* KPI Cards */}
            <KPISection>
                <KPICard title="OEE" value="85.3%" trend="+2.1%" />
                <KPICard title="First Pass Yield" value="92.5%" trend="-1.2%" />
                <KPICard title="On-Time Delivery" value="88.7%" trend="+3.4%" />
                <KPICard title="Cost Variance" value="2.3%" status="warning" />
            </KPISection>
            
            {/* Production Trends */}
            <TrendCharts>
                <ProductionVolumeChart />
                <EfficiencyTrendChart />
                <CostTrendChart />
                <QualityTrendChart />
            </TrendCharts>
            
            {/* Bottleneck Analysis */}
            <BottleneckAnalysis />
            
            {/* Predictive Analytics */}
            <PredictiveMaintenanceWidget />
            <DemandForecastWidget />
        </DashboardLayout>
    )
}
```

---

## 📦 المرحلة 4: التكامل والأتمتة (3-4 أسابيع)
### Phase 4: Integration & Automation

### **4.1 Inventory Integration** ⏱️ 1 أسبوع

```typescript
// src/services/manufacturing/inventory-integration.ts

export class ManufacturingInventoryIntegration {
    /**
     * Automatic material reservation
     */
    async reserveMaterials(moId: string): Promise<void> {
        // Get BOM requirements
        // Check availability
        // Create reservations
        // Update allocation flags
    }
    
    /**
     * Automatic material backflushing
     */
    async backflushMaterials(
        moId: string,
        completedQuantity: number
    ): Promise<void> {
        // Calculate actual consumption
        // Post inventory transactions
        // Update GL accounts
        // Clear reservations
    }
    
    /**
     * Finished goods receiving
     */
    async receiveFinishedGoods(
        moId: string,
        quantity: number,
        unitCost: number
    ): Promise<void> {
        // Create receipt transaction
        // Update AVCO cost
        // Post to GL
        // Close manufacturing order
    }
}
```

### **4.2 Financial Integration** ⏱️ 1 أسبوع

```typescript
// src/services/manufacturing/financial-integration.ts

export class ManufacturingFinancialIntegration {
    /**
     * Automatic GL posting for manufacturing transactions
     */
    async postManufacturingCosts(
        moId: string,
        stageNo: number
    ): Promise<string> {
        // Get stage costs
        // Create journal entry:
        // DR: Work in Process
        // CR: Raw Materials
        // CR: Wages Payable
        // CR: Manufacturing Overhead
        // Post to GL
        // Return journal_id
    }
    
    /**
     * Cost variance posting
     */
    async postCostVariances(
        moId: string
    ): Promise<string> {
        // Calculate variances
        // Create journal entry:
        // DR/CR: Cost Variance accounts
        // CR/DR: WIP or Overhead
        // Post to GL
        // Return journal_id
    }
    
    /**
     * Period-end closing
     */
    async closePeriod(
        periodEnd: Date
    ): Promise<PeriodClosingResult> {
        // Calculate WIP balances
        // Post overhead allocations
        // Close completed orders
        // Generate closing reports
    }
}
```

### **4.3 Workflow Automation** ⏱️ 1 أسبوع

```typescript
// src/services/manufacturing/workflow-automation.ts

export class ManufacturingWorkflowEngine {
    /**
     * Automatic MO creation from sales orders
     */
    async autoCreateMO(salesOrderId: string): Promise<void> {
        // Check item type (Make vs. Buy)
        // Explode BOM
        // Check material availability
        // Create MO automatically
        // Schedule production
    }
    
    /**
     * Automatic approval workflows
     */
    async processApprovalWorkflow(
        entityType: string,
        entityId: string
    ): Promise<void> {
        // Get approval rules
        // Send notifications
        // Track approval status
        // Execute post-approval actions
    }
    
    /**
     * Automatic notifications
     */
    async sendNotifications(
        event: ManufacturingEvent
    ): Promise<void> {
        // Material shortages
        // Quality issues
        // Schedule delays
        // Cost variances
        // Completion milestones
    }
}
```

---

## 📦 المرحلة 5: ميزات متقدمة (اختياري - 6-8 أسابيع)
### Phase 5: Advanced Features (Optional)

### **5.1 Mobile Shop Floor App** ⏱️ 3 أسابيع

```typescript
// mobile-app/src/features/shopfloor/MobileShopFloor.tsx

export function MobileShopFloorApp() {
    // Features:
    // - Offline-first architecture
    // - Barcode/QR scanning
    // - Voice commands
    // - Photo capture for quality
    // - Push notifications
    // - Real-time sync
}
```

### **5.2 AI/ML Integration** ⏱️ 3 أسابيع

```typescript
// src/services/manufacturing/ai-services.ts

export class ManufacturingAIService {
    /**
     * Demand forecasting
     */
    async forecastDemand(
        itemId: string,
        horizon: number
    ): Promise<DemandForecast> {
        // Time series analysis
        // Seasonal adjustments
        // Confidence intervals
    }
    
    /**
     * Predictive maintenance
     */
    async predictMaintenance(
        workCenterId: string
    ): Promise<MaintenancePrediction> {
        // Analyze historical data
        // Detect patterns
        // Predict failures
        // Recommend actions
    }
    
    /**
     * Anomaly detection
     */
    async detectAnomalies(
        metricType: string,
        data: TimeSeries
    ): Promise<Anomaly[]> {
        // Statistical analysis
        // Pattern recognition
        // Alert generation
    }
}
```

### **5.3 IoT Integration** ⏱️ 2 أسابيع

```typescript
// src/services/manufacturing/iot-integration.ts

export class IoTIntegrationService {
    /**
     * Machine data collection
     */
    async collectMachineData(
        deviceId: string
    ): Promise<void> {
        // Connect to PLC/SCADA
        // Collect real-time data
        // Store time-series data
        // Calculate OEE metrics
    }
    
    /**
     * Sensor monitoring
     */
    async monitorSensors(): Promise<void> {
        // Temperature
        // Pressure
        // Vibration
        // Energy consumption
        // Alert on thresholds
    }
}
```

---

## 5. المراحل التنفيذية
### Implementation Phases

### **الجدول الزمني الإجمالي: 25-35 أسبوعاً (6-9 شهور)**

| المرحلة | المدة | الأولوية | الاعتماديات |
|---------|-------|---------|-------------|
| **المرحلة 1: أساسيات الإنتاج** | 8-10 أسابيع | 🔴 CRITICAL | - |
| 1.1 BOM Management | 3 أسابيع | 🔴 | - |
| 1.2 Work Centers | 2 أسبوع | 🔴 | - |
| 1.3 Shop Floor Control | 3 أسابيع | 🔴 | 1.1, 1.2 |
| 1.4 Quality Control | 2 أسبوع | 🟡 | 1.3 |
| **المرحلة 2: تحسينات التكاليف** | 6-8 أسابيع | 🟡 MEDIUM | المرحلة 1 |
| 2.1 Standard Costing | 3 أسابيع | 🟡 | 1.1 |
| 2.2 Activity-Based Costing | 2 أسبوع | 🟢 | 2.1 |
| 2.3 Target Costing | 2 أسبوع | 🟢 | 2.1 |
| **المرحلة 3: التقارير** | 4-5 أسابيع | 🟡 MEDIUM | المراحل 1+2 |
| 3.1 Report Builder | 2 أسبوع | 🟡 | - |
| 3.2 Analytics Dashboards | 2 أسبوع | 🟡 | 3.1 |
| **المرحلة 4: التكامل** | 3-4 أسابيع | 🔴 CRITICAL | جميع المراحل |
| 4.1 Inventory Integration | 1 أسبوع | 🔴 | 1.1, 1.3 |
| 4.2 Financial Integration | 1 أسبوع | 🔴 | 2.1 |
| 4.3 Workflow Automation | 1 أسبوع | 🟡 | - |
| **المرحلة 5: ميزات متقدمة** | 6-8 أسابيع | 🟢 NICE-TO-HAVE | اختياري |
| 5.1 Mobile App | 3 أسابيع | 🟢 | 1.3 |
| 5.2 AI/ML | 3 أسابيع | 🟢 | 3.2 |
| 5.3 IoT | 2 أسبوع | 🟢 | 1.2, 5.2 |

---

## 6. معايير الجودة والقياس
### Quality Standards & KPIs

### **أ. معايير الجودة البرمجية**

```typescript
// Code Quality Standards

1. TypeScript Strict Mode: Enabled
2. Test Coverage: > 80%
3. Component Testing: Jest + React Testing Library
4. E2E Testing: Playwright
5. Code Review: Mandatory for all PRs
6. Documentation: JSDoc for all public APIs
7. Performance: Lighthouse Score > 90
```

### **ب. مؤشرات الأداء الرئيسية (KPIs)**

#### **Production KPIs:**
- Overall Equipment Effectiveness (OEE) > 85%
- First Pass Yield (FPY) > 95%
- On-Time Delivery > 90%
- Cycle Time Reduction: 15% year-over-year
- Setup Time Reduction: 20% year-over-year

#### **Cost KPIs:**
- Cost Variance < 5%
- Standard Cost Accuracy > 95%
- Overhead Allocation Accuracy > 98%
- Cost Reduction Target: 10% year-over-year

#### **Quality KPIs:**
- Defect Rate < 2%
- Customer Returns < 0.5%
- Inspection Pass Rate > 97%
- NCR Resolution Time < 48 hours

#### **System KPIs:**
- System Uptime > 99.5%
- Average Response Time < 200ms
- Data Accuracy > 99.9%
- User Adoption Rate > 90%

---

## 7. الموارد المطلوبة
### Required Resources

### **أ. فريق التطوير:**

```
1. Senior Full-Stack Developer (Lead) - Full-time
2. React/TypeScript Developers (2) - Full-time
3. Backend/Database Developer - Full-time
4. UI/UX Designer - Part-time
5. QA Engineer - Full-time
6. DevOps Engineer - Part-time
7. Cost Accounting Consultant - Advisory
8. Manufacturing Domain Expert - Advisory
```

### **ب. البنية التحتية:**

```
1. Supabase Pro Plan (for production)
2. CI/CD Pipeline (GitHub Actions)
3. Staging Environment
4. Production Environment
5. Monitoring Tools (Sentry, DataDog)
6. Analytics Platform
7. Backup & Disaster Recovery
```

### **ج. التدريب:**

```
1. Development Team Training (1 week)
2. End User Training (2 weeks)
3. System Administrator Training (1 week)
4. Documentation & Training Materials
5. Ongoing Support Plan
```

---

## 8. المخاطر والتخفيف
### Risks & Mitigation

| المخاطر | التأثير | الاحتمالية | خطة التخفيف |
|---------|---------|------------|-------------|
| **تأخير في التطوير** | High | Medium | مراجعة أسبوعية للتقدم + Buffer time |
| **تغيير المتطلبات** | Medium | High | Agile methodology + Change control |
| **مشاكل الأداء** | High | Low | Load testing + Optimization sprints |
| **تعقيد التكامل** | High | Medium | POC للتكامل + Modular architecture |
| **مقاومة المستخدمين** | Medium | Medium | Early user involvement + Training |
| **قيود الميزانية** | High | Low | Phased approach + MVP first |

---

## 9. التوصيات النهائية
### Final Recommendations

### **🎯 الأولويات الفورية (الشهر الأول):**

1. ✅ **BOM Management** - أساسي لكل شيء آخر
2. ✅ **Work Centers Enhancement** - مطلوب للجدولة
3. ✅ **Inventory Integration** - ربط مع المخزون الموجود

### **🚀 Quick Wins (نتائج سريعة):**

1. ✅ تحسين واجهة Stage Costing الحالية
2. ✅ إضافة Standard Costing الأساسي
3. ✅ تطوير 5-10 تقارير حرجة
4. ✅ Automatic GL posting للتكاليف

### **📈 الاستراتيجية طويلة المدى:**

1. ✅ Build نظام MRP كامل
2. ✅ Implement ABC Costing
3. ✅ Advanced Analytics & AI
4. ✅ Mobile & IoT Integration

---

## 10. الخلاصة
### Conclusion

قسم التصنيع الحالي يمتلك **أساساً متيناً** مع Process Costing System متقدم، لكنه يحتاج إلى:

### **🔴 عاجل (Critical):**
- Bill of Materials (BOM) Management
- Work Centers Enhancement
- Shop Floor Control
- Inventory Integration

### **🟡 مهم (Important):**
- Standard Costing System
- Quality Control Module
- Comprehensive Reporting
- Financial Integration

### **🟢 مستقبلي (Future):**
- Activity-Based Costing
- Mobile Applications
- AI/ML Features
- IoT Integration

**التقدير الإجمالي:** 
- **MVP (Minimum Viable Product):** 12-14 أسبوعاً
- **Full Implementation:** 25-35 أسبوعاً
- **With Advanced Features:** 35-45 أسبوعاً

**الاستثمار المطلوب:**
- Development Team: 6-8 موارد
- Infrastructure: $500-1000/month
- Training & Support: $10,000-20,000

**العائد المتوقع (ROI):**
- Cost Reduction: 10-15% سنوياً
- Productivity Increase: 20-25%
- Quality Improvement: 30-40% reduction in defects
- Better Decision Making: Real-time data & analytics

---

## 📞 التواصل والمتابعة
### Contact & Follow-up

لأي استفسارات أو توضيحات إضافية، يرجى التواصل مع فريق التطوير.

**تم إعداد هذه الخطة بواسطة:**
- **محاسب التكاليف الاستشاري**
- **مصمم أنظمة ERP**
- **بتاريخ:** 30 أكتوبر 2025

---

**🎯 الهدف النهائي:**  
تحويل قسم التصنيع إلى نظام ERP متكامل عالمي المستوى يضاهي SAP, Oracle, Microsoft Dynamics في الوظائف والأداء.

**✨ رؤية 2026:**  
نظام تصنيع ذكي مدعوم بالذكاء الاصطناعي مع تتبع فوري للإنتاج والتكاليف والجودة.

