-- =====================================================
-- Migration: Manufacturing Routings (مسارات التصنيع)
-- Author: AI Assistant
-- Date: 2024-12-27
-- Description: إنشاء هيكل بيانات مسارات التصنيع
-- =====================================================

-- =====================================================
-- 1. جدول مسارات التصنيع الرئيسية (Routings)
-- =====================================================
CREATE TABLE IF NOT EXISTS routings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    
    -- بيانات المسار الأساسية
    routing_code VARCHAR(50) NOT NULL,
    routing_name VARCHAR(200) NOT NULL,
    routing_name_ar VARCHAR(200),
    description TEXT,
    description_ar TEXT,
    
    -- الإصدار والحالة
    version INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'OBSOLETE')), -- NOSONAR: SQL literal constants are acceptable
    is_active BOOLEAN DEFAULT true,
    
    -- ربط بالمنتج (اختياري - يمكن أن يكون المسار عام)
    item_id UUID REFERENCES items(id),
    
    -- تواريخ الفعالية
    effective_date DATE DEFAULT CURRENT_DATE,
    expiry_date DATE,
    
    -- الموافقة
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    
    -- التدقيق
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- قيود التفرد
    UNIQUE(org_id, routing_code, version)
);

-- =====================================================
-- 2. جدول عمليات المسار (Routing Operations)
-- =====================================================
CREATE TABLE IF NOT EXISTS routing_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    routing_id UUID NOT NULL REFERENCES routings(id) ON DELETE CASCADE,
    
    -- تسلسل العملية
    operation_sequence INTEGER NOT NULL,
    operation_code VARCHAR(50) NOT NULL,
    operation_name VARCHAR(200) NOT NULL,
    operation_name_ar VARCHAR(200),
    description TEXT,
    
    -- مركز العمل
    work_center_id UUID REFERENCES work_centers(id),
    
    -- الأوقات القياسية (بالدقائق)
    standard_setup_time DECIMAL(10,2) DEFAULT 0,      -- وقت الإعداد
    standard_run_time_per_unit DECIMAL(10,4) DEFAULT 0, -- وقت التشغيل لكل وحدة
    standard_queue_time DECIMAL(10,2) DEFAULT 0,      -- وقت الانتظار
    standard_move_time DECIMAL(10,2) DEFAULT 0,       -- وقت النقل
    
    -- وحدة القياس للوقت
    time_unit VARCHAR(20) DEFAULT 'MINUTES' CHECK (time_unit IN ('MINUTES', 'HOURS', 'DAYS')),
    
    -- معدلات التكلفة القياسية
    labor_rate_per_hour DECIMAL(12,4) DEFAULT 0,
    overhead_rate_per_hour DECIMAL(12,4) DEFAULT 0,
    
    -- نوع العملية
    operation_type VARCHAR(30) DEFAULT 'PRODUCTION' CHECK (operation_type IN (
        'PRODUCTION',    -- إنتاج
        'INSPECTION',    -- فحص جودة
        'SETUP',         -- إعداد
        'PACKAGING',     -- تغليف
        'TRANSFER',      -- نقل
        'SUBCONTRACT'    -- تصنيع خارجي
    )),
    
    -- خيارات التنفيذ
    is_outsourced BOOLEAN DEFAULT false,
    outsource_vendor_id UUID,
    outsource_cost DECIMAL(12,4),
    
    -- خيارات الجودة
    requires_inspection BOOLEAN DEFAULT false,
    inspection_instructions TEXT,
    
    -- حالة العملية
    is_active BOOLEAN DEFAULT true,
    
    -- التدقيق
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- قيود
    UNIQUE(routing_id, operation_sequence)
);

-- =====================================================
-- 3. جدول الموارد المطلوبة للعملية
-- =====================================================
CREATE TABLE IF NOT EXISTS operation_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    operation_id UUID NOT NULL REFERENCES routing_operations(id) ON DELETE CASCADE,
    
    -- نوع المورد
    resource_type VARCHAR(30) NOT NULL CHECK (resource_type IN (
        'LABOR',         -- عمالة
        'MACHINE',       -- آلة
        'TOOL',          -- أداة
        'SKILL'          -- مهارة مطلوبة
    )),
    
    -- تفاصيل المورد
    resource_code VARCHAR(50),
    resource_name VARCHAR(200),
    
    -- الكمية المطلوبة
    quantity_required DECIMAL(10,4) DEFAULT 1,
    unit_of_measure VARCHAR(20),
    
    -- التكلفة
    cost_rate DECIMAL(12,4) DEFAULT 0,
    
    -- ملاحظات
    notes TEXT,
    
    -- التدقيق
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 4. ربط BOM بالـ Routing
-- =====================================================
ALTER TABLE bom_headers 
ADD COLUMN IF NOT EXISTS routing_id UUID REFERENCES routings(id);

-- ربط أمر التصنيع بالـ Routing
ALTER TABLE manufacturing_orders 
ADD COLUMN IF NOT EXISTS routing_id UUID REFERENCES routings(id);

-- =====================================================
-- 5. تحديث مركز العمل لدعم الطاقة
-- =====================================================
ALTER TABLE work_centers 
ADD COLUMN IF NOT EXISTS capacity_hours_per_day DECIMAL(5,2) DEFAULT 8,
ADD COLUMN IF NOT EXISTS number_of_machines INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS efficiency_rate DECIMAL(5,4) DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS default_labor_rate DECIMAL(12,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS default_overhead_rate DECIMAL(12,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS calendar_id UUID;

-- =====================================================
-- 6. فهارس الأداء
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_routings_org ON routings(org_id);
CREATE INDEX IF NOT EXISTS idx_routings_item ON routings(item_id);
CREATE INDEX IF NOT EXISTS idx_routings_code ON routings(routing_code);
CREATE INDEX IF NOT EXISTS idx_routings_status ON routings(status);

CREATE INDEX IF NOT EXISTS idx_routing_operations_routing ON routing_operations(routing_id);
CREATE INDEX IF NOT EXISTS idx_routing_operations_work_center ON routing_operations(work_center_id);
CREATE INDEX IF NOT EXISTS idx_routing_operations_sequence ON routing_operations(routing_id, operation_sequence);

CREATE INDEX IF NOT EXISTS idx_operation_resources_operation ON operation_resources(operation_id);

-- =====================================================
-- 7. سياسات RLS
-- =====================================================
ALTER TABLE routings ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_resources ENABLE ROW LEVEL SECURITY;

-- سياسات routings
DROP POLICY IF EXISTS "routings_select_policy" ON routings;
CREATE POLICY "routings_select_policy" ON routings
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "routings_insert_policy" ON routings;
CREATE POLICY "routings_insert_policy" ON routings
    FOR INSERT WITH CHECK (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "routings_update_policy" ON routings;
CREATE POLICY "routings_update_policy" ON routings
    FOR UPDATE USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "routings_delete_policy" ON routings;
CREATE POLICY "routings_delete_policy" ON routings
    FOR DELETE USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

-- سياسات routing_operations
DROP POLICY IF EXISTS "routing_operations_select_policy" ON routing_operations;
CREATE POLICY "routing_operations_select_policy" ON routing_operations
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "routing_operations_insert_policy" ON routing_operations;
CREATE POLICY "routing_operations_insert_policy" ON routing_operations
    FOR INSERT WITH CHECK (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "routing_operations_update_policy" ON routing_operations;
CREATE POLICY "routing_operations_update_policy" ON routing_operations
    FOR UPDATE USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "routing_operations_delete_policy" ON routing_operations;
CREATE POLICY "routing_operations_delete_policy" ON routing_operations
    FOR DELETE USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

-- سياسات operation_resources
DROP POLICY IF EXISTS "operation_resources_select_policy" ON operation_resources;
CREATE POLICY "operation_resources_select_policy" ON operation_resources
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "operation_resources_insert_policy" ON operation_resources;
CREATE POLICY "operation_resources_insert_policy" ON operation_resources
    FOR INSERT WITH CHECK (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "operation_resources_update_policy" ON operation_resources;
CREATE POLICY "operation_resources_update_policy" ON operation_resources
    FOR UPDATE USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "operation_resources_delete_policy" ON operation_resources;
CREATE POLICY "operation_resources_delete_policy" ON operation_resources
    FOR DELETE USING (
        org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
        )
    );

-- =====================================================
-- 8. دوال مساعدة
-- =====================================================

-- دالة حساب إجمالي وقت المسار
CREATE OR REPLACE FUNCTION calculate_routing_total_time(
    p_routing_id UUID,
    p_quantity DECIMAL DEFAULT 1
)
RETURNS TABLE (
    total_setup_time DECIMAL,
    total_run_time DECIMAL,
    total_queue_time DECIMAL,
    total_move_time DECIMAL,
    total_lead_time DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(ro.standard_setup_time), 0) as total_setup_time,
        COALESCE(SUM(ro.standard_run_time_per_unit * p_quantity), 0) as total_run_time,
        COALESCE(SUM(ro.standard_queue_time), 0) as total_queue_time,
        COALESCE(SUM(ro.standard_move_time), 0) as total_move_time,
        COALESCE(SUM(
            ro.standard_setup_time + 
            (ro.standard_run_time_per_unit * p_quantity) + 
            ro.standard_queue_time + 
            ro.standard_move_time
        ), 0) as total_lead_time
    FROM routing_operations ro
    WHERE ro.routing_id = p_routing_id
    AND ro.is_active;
END;
$$;

-- دالة حساب تكلفة المسار القياسية
CREATE OR REPLACE FUNCTION calculate_routing_standard_cost(
    p_routing_id UUID,
    p_quantity DECIMAL DEFAULT 1
)
RETURNS TABLE (
    total_labor_cost DECIMAL,
    total_overhead_cost DECIMAL,
    total_routing_cost DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(
            ((ro.standard_setup_time + (ro.standard_run_time_per_unit * p_quantity)) / 60) * 
            COALESCE(ro.labor_rate_per_hour, wc.default_labor_rate, 0)
        ), 0) as total_labor_cost,
        COALESCE(SUM(
            ((ro.standard_setup_time + (ro.standard_run_time_per_unit * p_quantity)) / 60) * 
            COALESCE(ro.overhead_rate_per_hour, wc.default_overhead_rate, 0)
        ), 0) as total_overhead_cost,
        COALESCE(SUM(
            ((ro.standard_setup_time + (ro.standard_run_time_per_unit * p_quantity)) / 60) * 
            (COALESCE(ro.labor_rate_per_hour, wc.default_labor_rate, 0) + 
             COALESCE(ro.overhead_rate_per_hour, wc.default_overhead_rate, 0))
        ), 0) as total_routing_cost
    FROM routing_operations ro
    LEFT JOIN work_centers wc ON ro.work_center_id = wc.id
    WHERE ro.routing_id = p_routing_id
    AND ro.is_active;
END;
$$;

-- دالة نسخ مسار تصنيع
CREATE OR REPLACE FUNCTION copy_routing(
    p_routing_id UUID,
    p_new_code VARCHAR,
    p_new_version INTEGER DEFAULT 1
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_routing_id UUID;
BEGIN
    -- إنشاء المسار الجديد
    INSERT INTO routings (
        org_id, routing_code, routing_name, routing_name_ar, 
        description, description_ar, version, status, item_id,
        effective_date, created_by
    )
    SELECT 
        org_id, p_new_code, routing_name || ' (Copy)', routing_name_ar,
        description, description_ar, p_new_version, 'DRAFT', item_id,
        CURRENT_DATE, auth.uid()
    FROM routings 
    WHERE id = p_routing_id
    RETURNING id INTO v_new_routing_id;
    
    -- نسخ العمليات
    INSERT INTO routing_operations (
        org_id, routing_id, operation_sequence, operation_code, 
        operation_name, operation_name_ar, description, work_center_id,
        standard_setup_time, standard_run_time_per_unit, standard_queue_time,
        standard_move_time, time_unit, labor_rate_per_hour, overhead_rate_per_hour,
        operation_type, is_outsourced, requires_inspection
    )
    SELECT 
        org_id, v_new_routing_id, operation_sequence, operation_code,
        operation_name, operation_name_ar, description, work_center_id,
        standard_setup_time, standard_run_time_per_unit, standard_queue_time,
        standard_move_time, time_unit, labor_rate_per_hour, overhead_rate_per_hour,
        operation_type, is_outsourced, requires_inspection
    FROM routing_operations
    WHERE routing_id = p_routing_id;
    
    -- نسخ الموارد
    INSERT INTO operation_resources (
        org_id, operation_id, resource_type, resource_code, 
        resource_name, quantity_required, unit_of_measure, cost_rate, notes
    )
    SELECT 
        orr.org_id, 
        (SELECT nro.id FROM routing_operations nro 
         WHERE nro.routing_id = v_new_routing_id 
         AND nro.operation_sequence = ro.operation_sequence),
        orr.resource_type, orr.resource_code, orr.resource_name,
        orr.quantity_required, orr.unit_of_measure, orr.cost_rate, orr.notes
    FROM operation_resources orr
    JOIN routing_operations ro ON orr.operation_id = ro.id
    WHERE ro.routing_id = p_routing_id;
    
    RETURN v_new_routing_id;
END;
$$;

-- =====================================================
-- 9. Triggers للتحديث التلقائي
-- =====================================================
CREATE OR REPLACE FUNCTION update_routing_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_routing_timestamp ON routings;
CREATE TRIGGER trigger_update_routing_timestamp
    BEFORE UPDATE ON routings
    FOR EACH ROW
    EXECUTE FUNCTION update_routing_timestamp();

DROP TRIGGER IF EXISTS trigger_update_routing_operations_timestamp ON routing_operations;
CREATE TRIGGER trigger_update_routing_operations_timestamp
    BEFORE UPDATE ON routing_operations
    FOR EACH ROW
    EXECUTE FUNCTION update_routing_timestamp();

-- =====================================================
-- تم إنشاء هيكل مسارات التصنيع بنجاح
-- =====================================================

