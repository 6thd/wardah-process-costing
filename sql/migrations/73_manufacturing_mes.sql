-- =====================================================
-- Migration: Manufacturing Execution System (MES)
-- نظام تنفيذ التصنيع
-- Author: AI Assistant
-- Date: 2024-12-27
-- Description: نظام تتبع تنفيذ الإنتاج في الوقت الفعلي
-- =====================================================

-- =====================================================
-- 1. جدول أوامر العمل (Work Orders)
-- تمثل تنفيذ عملية واحدة من المسار
-- =====================================================
CREATE TABLE IF NOT EXISTS work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    
    -- الربط بأمر التصنيع والعملية
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    operation_id UUID REFERENCES routing_operations(id),
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    
    -- رقم أمر العمل
    work_order_number VARCHAR(50) NOT NULL,
    
    -- تسلسل العملية
    operation_sequence INTEGER NOT NULL,
    operation_name VARCHAR(200) NOT NULL,
    operation_name_ar VARCHAR(200),
    
    -- الكميات
    planned_quantity DECIMAL(12,4) NOT NULL,
    completed_quantity DECIMAL(12,4) DEFAULT 0,
    scrapped_quantity DECIMAL(12,4) DEFAULT 0,
    
    -- الأوقات المخططة (بالدقائق)
    planned_setup_time DECIMAL(10,2) DEFAULT 0,
    planned_run_time DECIMAL(10,2) DEFAULT 0,
    
    -- الأوقات الفعلية (بالدقائق)
    actual_setup_time DECIMAL(10,2) DEFAULT 0,
    actual_run_time DECIMAL(10,2) DEFAULT 0,
    actual_wait_time DECIMAL(10,2) DEFAULT 0,
    
    -- التواريخ المخططة
    planned_start_date TIMESTAMP WITH TIME ZONE,
    planned_end_date TIMESTAMP WITH TIME ZONE,
    
    -- التواريخ الفعلية
    actual_start_date TIMESTAMP WITH TIME ZONE,
    actual_end_date TIMESTAMP WITH TIME ZONE,
    
    -- الحالة
    status VARCHAR(30) DEFAULT 'PENDING' CHECK (status IN (
        'PENDING',       -- في الانتظار
        'READY',         -- جاهز للبدء
        'IN_SETUP',      -- في مرحلة الإعداد
        'IN_PROGRESS',   -- قيد التنفيذ
        'ON_HOLD',       -- معلق
        'COMPLETED',     -- مكتمل
        'CANCELLED'      -- ملغي
    )),
    
    -- الأولوية
    priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    
    -- المشغل الحالي
    current_operator_id UUID REFERENCES auth.users(id),
    
    -- ملاحظات
    notes TEXT,
    
    -- التدقيق
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- قيود
    UNIQUE(org_id, work_order_number)
);

-- =====================================================
-- 2. جدول سجل تنفيذ العمليات (Operation Logs)
-- تتبع كل حدث في تنفيذ العملية
-- =====================================================
CREATE TABLE IF NOT EXISTS operation_execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    
    -- نوع الحدث
    event_type VARCHAR(30) NOT NULL CHECK (event_type IN (
        'SETUP_START',       -- بدء الإعداد
        'SETUP_END',         -- انتهاء الإعداد
        'PRODUCTION_START',  -- بدء الإنتاج
        'PRODUCTION_PAUSE',  -- إيقاف مؤقت
        'PRODUCTION_RESUME', -- استئناف
        'PRODUCTION_END',    -- انتهاء الإنتاج
        'QUANTITY_REPORT',   -- تقرير كمية
        'SCRAP_REPORT',      -- تقرير خردة
        'QUALITY_CHECK',     -- فحص جودة
        'MACHINE_DOWN',      -- عطل آلة
        'MACHINE_UP',        -- إصلاح آلة
        'SHIFT_CHANGE',      -- تغيير وردية
        'NOTE_ADDED'         -- إضافة ملاحظة
    )),
    
    -- المشغل
    operator_id UUID REFERENCES auth.users(id),
    
    -- البيانات
    quantity_produced DECIMAL(12,4),
    quantity_scrapped DECIMAL(12,4),
    
    -- سبب التوقف/الخردة
    reason_code VARCHAR(50),
    reason_description TEXT,
    
    -- الوقت
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    duration_minutes DECIMAL(10,2),
    
    -- ملاحظات
    notes TEXT,
    
    -- التدقيق
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 3. جدول تسجيل وقت العمل (Labor Time Tracking)
-- تتبع دقيق لوقت العمالة
-- =====================================================
CREATE TABLE IF NOT EXISTS labor_time_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    
    -- المشغل
    employee_id UUID REFERENCES auth.users(id),
    employee_name VARCHAR(200),
    
    -- نوع العمل
    labor_type VARCHAR(30) DEFAULT 'DIRECT' CHECK (labor_type IN (
        'DIRECT',        -- عمل مباشر
        'INDIRECT',      -- عمل غير مباشر
        'SETUP',         -- إعداد
        'REWORK',        -- إعادة عمل
        'MAINTENANCE'    -- صيانة
    )),
    
    -- الأوقات
    clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
    clock_out TIMESTAMP WITH TIME ZONE,
    break_minutes DECIMAL(10,2) DEFAULT 0,
    
    -- الوقت المحسوب (بالدقائق)
    total_minutes DECIMAL(10,2),
    billable_minutes DECIMAL(10,2),
    
    -- معدل التكلفة
    hourly_rate DECIMAL(12,4),
    total_cost DECIMAL(12,4),
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'VOIDED')),
    
    -- ملاحظات
    notes TEXT,
    
    -- التدقيق
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 4. جدول فحوصات الجودة (Quality Inspections)
-- =====================================================
CREATE TABLE IF NOT EXISTS quality_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    
    -- رقم الفحص
    inspection_number VARCHAR(50) NOT NULL,
    
    -- نوع الفحص
    inspection_type VARCHAR(30) DEFAULT 'IN_PROCESS' CHECK (inspection_type IN (
        'INCOMING',      -- فحص وارد
        'IN_PROCESS',    -- فحص أثناء التصنيع
        'FINAL',         -- فحص نهائي
        'RANDOM'         -- فحص عشوائي
    )),
    
    -- المفتش
    inspector_id UUID REFERENCES auth.users(id),
    
    -- الكميات
    sample_size DECIMAL(12,4),
    passed_quantity DECIMAL(12,4),
    failed_quantity DECIMAL(12,4),
    
    -- النتيجة
    result VARCHAR(20) CHECK (result IN ('PASS', 'FAIL', 'CONDITIONAL')),
    
    -- تفاصيل الفحص
    inspection_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    specifications TEXT,
    findings TEXT,
    corrective_action TEXT,
    
    -- المرفقات
    attachments JSONB,
    
    -- التدقيق
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 5. جدول استهلاك المواد (Material Consumption / Backflushing)
-- =====================================================
CREATE TABLE IF NOT EXISTS material_consumption (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id),
    
    -- المادة
    item_id UUID NOT NULL REFERENCES items(id),
    
    -- الكميات
    planned_quantity DECIMAL(12,4),
    consumed_quantity DECIMAL(12,4) NOT NULL,
    
    -- نوع الاستهلاك
    consumption_type VARCHAR(30) DEFAULT 'BACKFLUSH' CHECK (consumption_type IN (
        'BACKFLUSH',     -- استهلاك آلي
        'MANUAL',        -- استهلاك يدوي
        'NEGATIVE'       -- إرجاع
    )),
    
    -- المخزون
    warehouse_id UUID,
    location_id UUID,
    lot_number VARCHAR(100),
    
    -- التكلفة
    unit_cost DECIMAL(12,4),
    total_cost DECIMAL(12,4),
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'POSTED', 'REVERSED')),
    
    -- تاريخ الاستهلاك
    consumption_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- ملاحظات
    notes TEXT,
    
    -- التدقيق
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 6. جدول أوقات توقف الآلات (Machine Downtime)
-- =====================================================
CREATE TABLE IF NOT EXISTS machine_downtime (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    work_order_id UUID REFERENCES work_orders(id),
    
    -- سبب التوقف
    downtime_reason VARCHAR(50) NOT NULL,
    downtime_category VARCHAR(30) CHECK (downtime_category IN (
        'BREAKDOWN',     -- عطل
        'PLANNED',       -- صيانة مخططة
        'CHANGEOVER',    -- تغيير إعداد
        'NO_MATERIAL',   -- نقص مواد
        'NO_OPERATOR',   -- نقص عمالة
        'QUALITY_ISSUE', -- مشكلة جودة
        'OTHER'          -- أخرى
    )),
    
    -- الأوقات
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    duration_minutes DECIMAL(10,2),
    
    -- التأثير
    units_lost DECIMAL(12,4),
    cost_impact DECIMAL(12,4),
    
    -- الإجراءات
    action_taken TEXT,
    resolved_by UUID REFERENCES auth.users(id),
    
    -- ملاحظات
    notes TEXT,
    
    -- التدقيق
    reported_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 7. جدول جلسات المشغل (Operator Sessions)
-- =====================================================
CREATE TABLE IF NOT EXISTS operator_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    
    -- المشغل
    operator_id UUID NOT NULL REFERENCES auth.users(id),
    
    -- مركز العمل
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    
    -- أمر العمل الحالي
    current_work_order_id UUID REFERENCES work_orders(id),
    
    -- الجلسة
    session_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    session_end TIMESTAMP WITH TIME ZONE,
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_BREAK', 'ENDED')),
    
    -- معلومات الجهاز
    device_info JSONB,
    
    -- التدقيق
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 8. فهارس الأداء
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_work_orders_org ON work_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_mo ON work_orders(mo_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_work_center ON work_orders(work_center_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_dates ON work_orders(planned_start_date, planned_end_date);

CREATE INDEX IF NOT EXISTS idx_operation_logs_work_order ON operation_execution_logs(work_order_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_timestamp ON operation_execution_logs(event_timestamp);
CREATE INDEX IF NOT EXISTS idx_operation_logs_operator ON operation_execution_logs(operator_id);

CREATE INDEX IF NOT EXISTS idx_labor_tracking_work_order ON labor_time_tracking(work_order_id);
CREATE INDEX IF NOT EXISTS idx_labor_tracking_employee ON labor_time_tracking(employee_id);
CREATE INDEX IF NOT EXISTS idx_labor_tracking_dates ON labor_time_tracking(clock_in, clock_out);

CREATE INDEX IF NOT EXISTS idx_material_consumption_work_order ON material_consumption(work_order_id);
CREATE INDEX IF NOT EXISTS idx_material_consumption_item ON material_consumption(item_id);

CREATE INDEX IF NOT EXISTS idx_machine_downtime_work_center ON machine_downtime(work_center_id);
CREATE INDEX IF NOT EXISTS idx_machine_downtime_times ON machine_downtime(start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_operator ON operator_sessions(operator_id);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_work_center ON operator_sessions(work_center_id);

-- =====================================================
-- 9. سياسات RLS
-- =====================================================
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_time_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_consumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_downtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_sessions ENABLE ROW LEVEL SECURITY;

-- سياسة موحدة للجداول
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'work_orders', 
        'operation_execution_logs', 
        'labor_time_tracking', 
        'quality_inspections',
        'material_consumption',
        'machine_downtime',
        'operator_sessions'
    ]) LOOP
        EXECUTE format('
            DROP POLICY IF EXISTS "%s_select_policy" ON %I;
            CREATE POLICY "%s_select_policy" ON %I
                FOR SELECT USING (
                    org_id IN (
                        SELECT organization_id FROM user_organizations 
                        WHERE user_id = auth.uid()
                    )
                );
            
            DROP POLICY IF EXISTS "%s_insert_policy" ON %I;
            CREATE POLICY "%s_insert_policy" ON %I
                FOR INSERT WITH CHECK (
                    org_id IN (
                        SELECT organization_id FROM user_organizations 
                        WHERE user_id = auth.uid()
                    )
                );
            
            DROP POLICY IF EXISTS "%s_update_policy" ON %I;
            CREATE POLICY "%s_update_policy" ON %I
                FOR UPDATE USING (
                    org_id IN (
                        SELECT organization_id FROM user_organizations 
                        WHERE user_id = auth.uid()
                    )
                );
            
            DROP POLICY IF EXISTS "%s_delete_policy" ON %I;
            CREATE POLICY "%s_delete_policy" ON %I
                FOR DELETE USING (
                    org_id IN (
                        SELECT organization_id FROM user_organizations 
                        WHERE user_id = auth.uid()
                    )
                );
        ', tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl);
    END LOOP;
END $$;

-- =====================================================
-- 10. دوال MES الأساسية
-- =====================================================

-- دالة إنشاء أوامر العمل من أمر التصنيع
CREATE OR REPLACE FUNCTION generate_work_orders_from_mo(
    p_mo_id UUID
)
RETURNS SETOF work_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mo RECORD;
    v_operation RECORD;
    v_work_order_number VARCHAR;
    v_sequence INTEGER := 0;
BEGIN
    -- الحصول على معلومات أمر التصنيع
    SELECT * INTO v_mo FROM manufacturing_orders WHERE id = p_mo_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing order not found: %', p_mo_id;
    END IF;
    
    -- إنشاء أوامر عمل لكل عملية في المسار
    FOR v_operation IN 
        SELECT ro.*, wc.name as work_center_name, wc.name_ar as work_center_name_ar
        FROM routing_operations ro
        JOIN work_centers wc ON ro.work_center_id = wc.id
        WHERE ro.routing_id = v_mo.routing_id
        AND ro.is_active = true
        ORDER BY ro.operation_sequence
    LOOP
        v_sequence := v_sequence + 1;
        v_work_order_number := v_mo.order_number || '-' || LPAD(v_sequence::TEXT, 3, '0');
        
        RETURN QUERY
        INSERT INTO work_orders (
            org_id, mo_id, operation_id, work_center_id,
            work_order_number, operation_sequence, operation_name, operation_name_ar,
            planned_quantity, planned_setup_time, planned_run_time,
            status, created_by
        ) VALUES (
            v_mo.org_id, p_mo_id, v_operation.id, v_operation.work_center_id,
            v_work_order_number, v_operation.operation_sequence, 
            v_operation.operation_name, v_operation.operation_name_ar,
            v_mo.quantity, v_operation.standard_setup_time,
            v_operation.standard_run_time_per_unit * v_mo.quantity,
            'PENDING', auth.uid()
        )
        RETURNING *;
    END LOOP;
END;
$$;

-- دالة بدء العملية
CREATE OR REPLACE FUNCTION start_operation(
    p_work_order_id UUID,
    p_operator_id UUID DEFAULT NULL,
    p_is_setup BOOLEAN DEFAULT true
)
RETURNS work_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_work_order work_orders;
    v_event_type VARCHAR;
BEGIN
    -- التحقق من حالة أمر العمل
    SELECT * INTO v_work_order FROM work_orders WHERE id = p_work_order_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order not found: %', p_work_order_id;
    END IF;
    
    IF v_work_order.status NOT IN ('PENDING', 'READY', 'ON_HOLD') THEN
        RAISE EXCEPTION 'Work order cannot be started. Current status: %', v_work_order.status;
    END IF;
    
    -- تحديد نوع الحدث
    IF p_is_setup THEN
        v_event_type := 'SETUP_START';
    ELSE
        v_event_type := 'PRODUCTION_START';
    END IF;
    
    -- تحديث أمر العمل
    UPDATE work_orders SET
        status = CASE WHEN p_is_setup THEN 'IN_SETUP' ELSE 'IN_PROGRESS' END,
        actual_start_date = COALESCE(actual_start_date, NOW()),
        current_operator_id = COALESCE(p_operator_id, auth.uid()),
        updated_at = NOW()
    WHERE id = p_work_order_id
    RETURNING * INTO v_work_order;
    
    -- تسجيل الحدث
    INSERT INTO operation_execution_logs (
        org_id, work_order_id, event_type, operator_id, event_timestamp
    ) VALUES (
        v_work_order.org_id, p_work_order_id, v_event_type,
        COALESCE(p_operator_id, auth.uid()), NOW()
    );
    
    -- بدء تسجيل الوقت
    INSERT INTO labor_time_tracking (
        org_id, work_order_id, employee_id, labor_type, clock_in, status
    ) VALUES (
        v_work_order.org_id, p_work_order_id, COALESCE(p_operator_id, auth.uid()),
        CASE WHEN p_is_setup THEN 'SETUP' ELSE 'DIRECT' END, NOW(), 'ACTIVE'
    );
    
    RETURN v_work_order;
END;
$$;

-- دالة إنهاء العملية
CREATE OR REPLACE FUNCTION complete_operation(
    p_work_order_id UUID,
    p_quantity_produced DECIMAL,
    p_quantity_scrapped DECIMAL DEFAULT 0,
    p_notes TEXT DEFAULT NULL
)
RETURNS work_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_work_order work_orders;
    v_labor_tracking labor_time_tracking;
    v_duration DECIMAL;
BEGIN
    -- الحصول على أمر العمل
    SELECT * INTO v_work_order FROM work_orders WHERE id = p_work_order_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order not found: %', p_work_order_id;
    END IF;
    
    -- إغلاق تسجيل الوقت
    UPDATE labor_time_tracking SET
        clock_out = NOW(),
        total_minutes = EXTRACT(EPOCH FROM (NOW() - clock_in)) / 60,
        billable_minutes = EXTRACT(EPOCH FROM (NOW() - clock_in)) / 60 - break_minutes,
        status = 'COMPLETED',
        updated_at = NOW()
    WHERE work_order_id = p_work_order_id AND status = 'ACTIVE'
    RETURNING * INTO v_labor_tracking;
    
    -- حساب الوقت الفعلي
    IF v_labor_tracking.labor_type = 'SETUP' THEN
        v_duration := COALESCE(v_labor_tracking.billable_minutes, 0);
        UPDATE work_orders SET
            actual_setup_time = actual_setup_time + v_duration
        WHERE id = p_work_order_id;
    ELSE
        v_duration := COALESCE(v_labor_tracking.billable_minutes, 0);
        UPDATE work_orders SET
            actual_run_time = actual_run_time + v_duration
        WHERE id = p_work_order_id;
    END IF;
    
    -- تحديث أمر العمل
    UPDATE work_orders SET
        completed_quantity = completed_quantity + p_quantity_produced,
        scrapped_quantity = scrapped_quantity + p_quantity_scrapped,
        status = CASE 
            WHEN (completed_quantity + p_quantity_produced + scrapped_quantity + p_quantity_scrapped) >= planned_quantity 
            THEN 'COMPLETED' 
            ELSE status 
        END,
        actual_end_date = CASE 
            WHEN (completed_quantity + p_quantity_produced + scrapped_quantity + p_quantity_scrapped) >= planned_quantity 
            THEN NOW() 
            ELSE actual_end_date 
        END,
        notes = COALESCE(notes || E'\n', '') || COALESCE(p_notes, ''),
        updated_at = NOW()
    WHERE id = p_work_order_id
    RETURNING * INTO v_work_order;
    
    -- تسجيل الحدث
    INSERT INTO operation_execution_logs (
        org_id, work_order_id, event_type, operator_id,
        quantity_produced, quantity_scrapped, notes, event_timestamp
    ) VALUES (
        v_work_order.org_id, p_work_order_id, 'PRODUCTION_END', v_work_order.current_operator_id,
        p_quantity_produced, p_quantity_scrapped, p_notes, NOW()
    );
    
    RETURN v_work_order;
END;
$$;

-- دالة Backflushing للمواد
CREATE OR REPLACE FUNCTION backflush_materials(
    p_work_order_id UUID,
    p_quantity_produced DECIMAL
)
RETURNS SETOF material_consumption
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_work_order RECORD;
    v_mo RECORD;
    v_bom_line RECORD;
BEGIN
    -- الحصول على أمر العمل وأمر التصنيع
    SELECT wo.*, mo.bom_id, mo.org_id as mo_org_id
    INTO v_work_order
    FROM work_orders wo
    JOIN manufacturing_orders mo ON wo.mo_id = mo.id
    WHERE wo.id = p_work_order_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order not found: %', p_work_order_id;
    END IF;
    
    -- استهلاك المواد بناءً على BOM
    FOR v_bom_line IN 
        SELECT bl.*, i.name as item_name
        FROM bom_lines bl
        JOIN items i ON bl.item_id = i.id
        WHERE bl.bom_id = v_work_order.bom_id
        AND bl.item_type IN ('RAW_MATERIAL', 'COMPONENT')
    LOOP
        RETURN QUERY
        INSERT INTO material_consumption (
            org_id, work_order_id, mo_id, item_id,
            planned_quantity, consumed_quantity, consumption_type,
            unit_cost, total_cost, status, consumption_date, created_by
        ) VALUES (
            v_work_order.mo_org_id, p_work_order_id, v_work_order.mo_id, v_bom_line.item_id,
            v_bom_line.quantity * (v_work_order.planned_quantity),
            v_bom_line.quantity * p_quantity_produced,
            'BACKFLUSH',
            v_bom_line.unit_cost,
            v_bom_line.unit_cost * v_bom_line.quantity * p_quantity_produced,
            'PENDING', NOW(), auth.uid()
        )
        RETURNING *;
    END LOOP;
END;
$$;

-- =====================================================
-- 11. Views للتقارير
-- =====================================================

-- عرض حالة أوامر العمل
CREATE OR REPLACE VIEW v_work_order_status AS
SELECT 
    wo.id,
    wo.org_id,
    wo.work_order_number,
    wo.operation_name,
    wo.status,
    mo.order_number as mo_number,
    wc.name as work_center_name,
    wo.planned_quantity,
    wo.completed_quantity,
    wo.scrapped_quantity,
    wo.planned_setup_time,
    wo.actual_setup_time,
    wo.planned_run_time,
    wo.actual_run_time,
    CASE 
        WHEN wo.planned_setup_time > 0 
        THEN ROUND(((wo.actual_setup_time - wo.planned_setup_time) / wo.planned_setup_time * 100)::NUMERIC, 2)
        ELSE 0 
    END as setup_variance_pct,
    CASE 
        WHEN wo.planned_run_time > 0 
        THEN ROUND(((wo.actual_run_time - wo.planned_run_time) / wo.planned_run_time * 100)::NUMERIC, 2)
        ELSE 0 
    END as run_variance_pct,
    u.email as current_operator
FROM work_orders wo
JOIN manufacturing_orders mo ON wo.mo_id = mo.id
JOIN work_centers wc ON wo.work_center_id = wc.id
LEFT JOIN auth.users u ON wo.current_operator_id = u.id;

-- عرض إنتاجية مركز العمل
CREATE OR REPLACE VIEW v_work_center_productivity AS
SELECT 
    wc.id as work_center_id,
    wc.org_id,
    wc.name as work_center_name,
    wc.capacity_hours_per_day,
    COUNT(DISTINCT wo.id) as total_work_orders,
    COUNT(DISTINCT wo.id) FILTER (WHERE wo.status = 'IN_PROGRESS') as active_work_orders,
    SUM(wo.completed_quantity) as total_produced,
    SUM(wo.scrapped_quantity) as total_scrapped,
    SUM(wo.actual_run_time) as total_run_time_minutes,
    ROUND(AVG(
        CASE 
            WHEN wo.planned_run_time > 0 
            THEN wo.actual_run_time / wo.planned_run_time * 100
            ELSE NULL 
        END
    )::NUMERIC, 2) as avg_efficiency_pct
FROM work_centers wc
LEFT JOIN work_orders wo ON wc.id = wo.work_center_id
GROUP BY wc.id, wc.org_id, wc.name, wc.capacity_hours_per_day;

-- =====================================================
-- تم إنشاء نظام MES بنجاح
-- =====================================================

