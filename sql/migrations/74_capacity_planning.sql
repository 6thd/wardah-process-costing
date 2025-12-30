-- =====================================================
-- Migration: Capacity Planning & Scheduling
-- تخطيط الطاقة وجدولة الإنتاج
-- Author: AI Assistant
-- Date: 2024-12-27
-- Description: نظام تخطيط الطاقة الإنتاجية وجدولة الإنتاج
-- =====================================================

-- =====================================================
-- 1. جدول تقويم مركز العمل (Work Center Calendar)
-- =====================================================
CREATE TABLE IF NOT EXISTS work_center_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    work_center_id UUID NOT NULL REFERENCES work_centers(id) ON DELETE CASCADE,
    
    -- التاريخ
    calendar_date DATE NOT NULL,
    
    -- ساعات العمل
    available_hours DECIMAL(5,2) DEFAULT 8,
    planned_maintenance_hours DECIMAL(5,2) DEFAULT 0,
    
    -- الورديات
    shift_count INTEGER DEFAULT 1,
    
    -- الحالة
    is_working_day BOOLEAN DEFAULT true,
    is_holiday BOOLEAN DEFAULT false,
    holiday_name VARCHAR(100),
    
    -- ملاحظات
    notes TEXT,
    
    -- التدقيق
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- قيود
    UNIQUE(work_center_id, calendar_date)
);

-- =====================================================
-- 2. جدول حمل مركز العمل (Work Center Load)
-- =====================================================
CREATE TABLE IF NOT EXISTS work_center_load (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    work_center_id UUID NOT NULL REFERENCES work_centers(id),
    
    -- الفترة
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- الطاقة (بالساعات)
    available_capacity_hours DECIMAL(10,2) DEFAULT 0,
    planned_load_hours DECIMAL(10,2) DEFAULT 0,
    actual_load_hours DECIMAL(10,2) DEFAULT 0,
    
    -- النسب
    utilization_pct DECIMAL(5,2) DEFAULT 0,
    efficiency_pct DECIMAL(5,2) DEFAULT 0,
    
    -- عدد أوامر العمل
    planned_work_orders INTEGER DEFAULT 0,
    completed_work_orders INTEGER DEFAULT 0,
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'CONFIRMED', 'ACTUAL')),
    
    -- التدقيق
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- قيود
    UNIQUE(work_center_id, period_start, period_end)
);

-- =====================================================
-- 3. جدول جدولة الإنتاج (Production Schedule)
-- =====================================================
CREATE TABLE IF NOT EXISTS production_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    
    -- رقم الجدول
    schedule_number VARCHAR(50) NOT NULL,
    schedule_name VARCHAR(200),
    
    -- الفترة
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- الحالة
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN (
        'DRAFT',       -- مسودة
        'CONFIRMED',   -- مؤكد
        'IN_PROGRESS', -- قيد التنفيذ
        'COMPLETED',   -- مكتمل
        'CANCELLED'    -- ملغي
    )),
    
    -- إحصائيات
    total_work_orders INTEGER DEFAULT 0,
    total_planned_hours DECIMAL(10,2) DEFAULT 0,
    
    -- الموافقة
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    
    -- ملاحظات
    notes TEXT,
    
    -- التدقيق
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- قيود
    UNIQUE(org_id, schedule_number)
);

-- =====================================================
-- 4. جدول تفاصيل الجدولة (Schedule Details)
-- =====================================================
CREATE TABLE IF NOT EXISTS schedule_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    schedule_id UUID NOT NULL REFERENCES production_schedules(id) ON DELETE CASCADE,
    work_order_id UUID NOT NULL REFERENCES work_orders(id),
    
    -- التسلسل
    schedule_sequence INTEGER NOT NULL,
    
    -- التواريخ المجدولة
    scheduled_start TIMESTAMP WITH TIME ZONE NOT NULL,
    scheduled_end TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- الأولوية
    priority INTEGER DEFAULT 5,
    
    -- حالة الجدولة
    schedule_status VARCHAR(20) DEFAULT 'SCHEDULED' CHECK (schedule_status IN (
        'SCHEDULED',   -- مجدول
        'CONFIRMED',   -- مؤكد
        'STARTED',     -- بدأ
        'COMPLETED',   -- مكتمل
        'DELAYED',     -- متأخر
        'CANCELLED'    -- ملغي
    )),
    
    -- سبب التأخير
    delay_reason TEXT,
    delay_hours DECIMAL(10,2),
    
    -- التدقيق
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 5. جدول قيود الجدولة (Scheduling Constraints)
-- =====================================================
CREATE TABLE IF NOT EXISTS scheduling_constraints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    
    -- نوع القيد
    constraint_type VARCHAR(30) NOT NULL CHECK (constraint_type IN (
        'DEPENDENCY',       -- تبعية بين عمليات
        'RESOURCE',         -- قيد مورد
        'TIME_WINDOW',      -- نافذة زمنية
        'SEQUENCE',         -- تسلسل إجباري
        'EXCLUSION'         -- تضارب
    )),
    
    -- مرجع القيد
    source_work_order_id UUID REFERENCES work_orders(id),
    target_work_order_id UUID REFERENCES work_orders(id),
    work_center_id UUID REFERENCES work_centers(id),
    
    -- تفاصيل القيد
    min_lag_hours DECIMAL(10,2),
    max_lag_hours DECIMAL(10,2),
    time_window_start TIME,
    time_window_end TIME,
    
    -- الحالة
    is_active BOOLEAN DEFAULT true,
    
    -- ملاحظات
    description TEXT,
    
    -- التدقيق
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- 6. فهارس الأداء
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_wc_calendars_work_center ON work_center_calendars(work_center_id);
CREATE INDEX IF NOT EXISTS idx_wc_calendars_date ON work_center_calendars(calendar_date);

CREATE INDEX IF NOT EXISTS idx_wc_load_work_center ON work_center_load(work_center_id);
CREATE INDEX IF NOT EXISTS idx_wc_load_period ON work_center_load(period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_prod_schedules_org ON production_schedules(org_id);
CREATE INDEX IF NOT EXISTS idx_prod_schedules_period ON production_schedules(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_prod_schedules_status ON production_schedules(status);

CREATE INDEX IF NOT EXISTS idx_schedule_details_schedule ON schedule_details(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_details_work_order ON schedule_details(work_order_id);
CREATE INDEX IF NOT EXISTS idx_schedule_details_dates ON schedule_details(scheduled_start, scheduled_end);

-- =====================================================
-- 7. سياسات RLS
-- =====================================================
ALTER TABLE work_center_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_center_load ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_constraints ENABLE ROW LEVEL SECURITY;

-- تطبيق السياسات
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'work_center_calendars', 
        'work_center_load', 
        'production_schedules', 
        'schedule_details',
        'scheduling_constraints'
    ]) LOOP
        EXECUTE format('
            DROP POLICY IF EXISTS "%s_select_policy" ON %I;
            CREATE POLICY "%s_select_policy" ON %I
                FOR SELECT USING (
                    org_id IN (
                        SELECT org_id FROM user_organizations 
                        WHERE user_id = auth.uid()
                    )
                );
            
            DROP POLICY IF EXISTS "%s_insert_policy" ON %I;
            CREATE POLICY "%s_insert_policy" ON %I
                FOR INSERT WITH CHECK (
                    org_id IN (
                        SELECT org_id FROM user_organizations 
                        WHERE user_id = auth.uid()
                    )
                );
            
            DROP POLICY IF EXISTS "%s_update_policy" ON %I;
            CREATE POLICY "%s_update_policy" ON %I
                FOR UPDATE USING (
                    org_id IN (
                        SELECT org_id FROM user_organizations 
                        WHERE user_id = auth.uid()
                    )
                );
            
            DROP POLICY IF EXISTS "%s_delete_policy" ON %I;
            CREATE POLICY "%s_delete_policy" ON %I
                FOR DELETE USING (
                    org_id IN (
                        SELECT org_id FROM user_organizations 
                        WHERE user_id = auth.uid()
                    )
                );
        ', tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl, tbl);
    END LOOP;
END $$;

-- =====================================================
-- 8. دوال تخطيط الطاقة
-- =====================================================

-- دالة حساب الطاقة المتاحة لمركز عمل
CREATE OR REPLACE FUNCTION calculate_available_capacity(
    p_work_center_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    total_available_hours DECIMAL,
    working_days INTEGER,
    avg_daily_hours DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH calendar_data AS (
        SELECT 
            COALESCE(wcc.available_hours, wc.capacity_hours_per_day) - 
            COALESCE(wcc.planned_maintenance_hours, 0) as daily_hours,
            COALESCE(wcc.is_working_day, true) as is_working
        FROM generate_series(p_start_date, p_end_date, '1 day'::interval) d(date)
        CROSS JOIN work_centers wc
        LEFT JOIN work_center_calendars wcc 
            ON wcc.work_center_id = wc.id 
            AND wcc.calendar_date = d.date::DATE
        WHERE wc.id = p_work_center_id
    )
    SELECT 
        COALESCE(SUM(CASE WHEN is_working THEN daily_hours ELSE 0 END), 0)::DECIMAL as total_available_hours,
        COUNT(*) FILTER (WHERE is_working)::INTEGER as working_days,
        COALESCE(AVG(CASE WHEN is_working THEN daily_hours ELSE NULL END), 0)::DECIMAL as avg_daily_hours
    FROM calendar_data;
END;
$$;

-- دالة حساب الحمل المخطط لمركز عمل
CREATE OR REPLACE FUNCTION calculate_planned_load(
    p_work_center_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    total_planned_hours DECIMAL,
    total_work_orders INTEGER,
    pending_work_orders INTEGER,
    in_progress_work_orders INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM((wo.planned_setup_time + wo.planned_run_time) / 60), 0)::DECIMAL as total_planned_hours,
        COUNT(*)::INTEGER as total_work_orders,
        COUNT(*) FILTER (WHERE wo.status IN ('PENDING', 'READY'))::INTEGER as pending_work_orders,
        COUNT(*) FILTER (WHERE wo.status = 'IN_PROGRESS')::INTEGER as in_progress_work_orders
    FROM work_orders wo
    WHERE wo.work_center_id = p_work_center_id
    AND wo.status NOT IN ('COMPLETED', 'CANCELLED')
    AND (
        (wo.planned_start_date::DATE BETWEEN p_start_date AND p_end_date)
        OR (wo.planned_end_date::DATE BETWEEN p_start_date AND p_end_date)
        OR (wo.planned_start_date IS NULL AND wo.created_at::DATE BETWEEN p_start_date AND p_end_date)
    );
END;
$$;

-- دالة تحديث حمل مركز العمل
CREATE OR REPLACE FUNCTION update_work_center_load(
    p_work_center_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS work_center_load
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    C_STATUS_PLANNED CONSTANT VARCHAR := 'PLANNED';
    C_PERCENTAGE_MULTIPLIER CONSTANT NUMERIC := 100;
    C_DECIMAL_PLACES CONSTANT INTEGER := 2;
    v_org_id UUID;
    v_capacity RECORD;
    v_load RECORD;
    v_result work_center_load;
BEGIN
    -- الحصول على org_id
    SELECT org_id INTO v_org_id FROM work_centers WHERE id = p_work_center_id;
    
    -- حساب الطاقة المتاحة
    SELECT * INTO v_capacity FROM calculate_available_capacity(p_work_center_id, p_start_date, p_end_date);
    
    -- حساب الحمل المخطط
    SELECT * INTO v_load FROM calculate_planned_load(p_work_center_id, p_start_date, p_end_date);
    
    -- إدراج أو تحديث السجل
    INSERT INTO work_center_load (
        org_id, work_center_id, period_start, period_end,
        available_capacity_hours, planned_load_hours,
        utilization_pct, planned_work_orders, status, calculated_at
    ) VALUES (
        v_org_id, p_work_center_id, p_start_date, p_end_date,
        v_capacity.total_available_hours, v_load.total_planned_hours,
        CASE 
            WHEN v_capacity.total_available_hours > 0 
            THEN ROUND((v_load.total_planned_hours / v_capacity.total_available_hours * C_PERCENTAGE_MULTIPLIER)::NUMERIC, C_DECIMAL_PLACES)
            ELSE 0 
        END,
        v_load.total_work_orders, C_STATUS_PLANNED, NOW()
    )
    ON CONFLICT (work_center_id, period_start, period_end) 
    DO UPDATE SET
        available_capacity_hours = EXCLUDED.available_capacity_hours,
        planned_load_hours = EXCLUDED.planned_load_hours,
        utilization_pct = EXCLUDED.utilization_pct,
        planned_work_orders = EXCLUDED.planned_work_orders,
        calculated_at = NOW(),
        updated_at = NOW()
    RETURNING * INTO v_result;
    
    RETURN v_result;
END;
$$;

-- =====================================================
-- 9. دوال الجدولة
-- =====================================================

-- دالة جدولة أمر عمل
CREATE OR REPLACE FUNCTION schedule_work_order(
    p_work_order_id UUID,
    p_scheduled_start TIMESTAMP WITH TIME ZONE,
    p_schedule_id UUID DEFAULT NULL
)
RETURNS schedule_details
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_work_order work_orders;
    v_scheduled_end TIMESTAMP WITH TIME ZONE;
    v_result schedule_details;
    v_sequence INTEGER;
BEGIN
    -- الحصول على أمر العمل
    SELECT * INTO v_work_order FROM work_orders WHERE id = p_work_order_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order not found: %', p_work_order_id;
    END IF;
    
    -- حساب وقت الانتهاء المتوقع
    v_scheduled_end := p_scheduled_start + 
        ((v_work_order.planned_setup_time + v_work_order.planned_run_time) * INTERVAL '1 minute');
    
    -- تحديث أمر العمل
    UPDATE work_orders SET
        planned_start_date = p_scheduled_start,
        planned_end_date = v_scheduled_end,
        updated_at = NOW()
    WHERE id = p_work_order_id;
    
    -- إذا تم تحديد جدول
    IF p_schedule_id IS NOT NULL THEN
        -- الحصول على التسلسل التالي
        SELECT COALESCE(MAX(schedule_sequence), 0) + 1 INTO v_sequence
        FROM schedule_details WHERE schedule_id = p_schedule_id;
        
        -- إدراج تفاصيل الجدولة
        INSERT INTO schedule_details (
            org_id, schedule_id, work_order_id, schedule_sequence,
            scheduled_start, scheduled_end, priority, schedule_status
        ) VALUES (
            v_work_order.org_id, p_schedule_id, p_work_order_id, v_sequence,
            p_scheduled_start, v_scheduled_end, v_work_order.priority, 'SCHEDULED'
        )
        ON CONFLICT (schedule_id, work_order_id) 
        DO UPDATE SET
            scheduled_start = EXCLUDED.scheduled_start,
            scheduled_end = EXCLUDED.scheduled_end,
            updated_at = NOW()
        RETURNING * INTO v_result;
        
        RETURN v_result;
    END IF;
    
    RETURN NULL;
END;
$$;

-- دالة جدولة تلقائية (Forward Scheduling)
CREATE OR REPLACE FUNCTION auto_schedule_work_orders(
    p_work_center_id UUID,
    p_start_date TIMESTAMP WITH TIME ZONE,
    p_schedule_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_work_order RECORD;
    v_current_time TIMESTAMP WITH TIME ZONE := p_start_date;
    v_scheduled_count INTEGER := 0;
    v_daily_capacity DECIMAL;
    v_daily_used DECIMAL := 0;
    v_current_date DATE := p_start_date::DATE;
BEGIN
    -- الحصول على الطاقة اليومية
    SELECT capacity_hours_per_day * 60 INTO v_daily_capacity -- بالدقائق
    FROM work_centers WHERE id = p_work_center_id;
    
    -- جدولة أوامر العمل حسب الأولوية وتاريخ الاستحقاق
    FOR v_work_order IN 
        SELECT wo.*
        FROM work_orders wo
        JOIN manufacturing_orders mo ON wo.mo_id = mo.id
        WHERE wo.work_center_id = p_work_center_id
        AND wo.status IN ('PENDING', 'READY')
        ORDER BY wo.priority ASC, mo.due_date ASC NULLS LAST, wo.created_at ASC
    LOOP
        -- التحقق من الطاقة المتبقية لليوم
        IF v_daily_used + (v_work_order.planned_setup_time + v_work_order.planned_run_time) > v_daily_capacity THEN
            -- الانتقال لليوم التالي
            v_current_date := v_current_date + 1;
            v_current_time := v_current_date::TIMESTAMP WITH TIME ZONE + INTERVAL '8 hours'; -- بداية اليوم
            v_daily_used := 0;
        END IF;
        
        -- جدولة أمر العمل
        PERFORM schedule_work_order(v_work_order.id, v_current_time, p_schedule_id);
        
        -- تحديث الوقت الحالي والطاقة المستخدمة
        v_current_time := v_current_time + 
            ((v_work_order.planned_setup_time + v_work_order.planned_run_time) * INTERVAL '1 minute');
        v_daily_used := v_daily_used + (v_work_order.planned_setup_time + v_work_order.planned_run_time);
        v_scheduled_count := v_scheduled_count + 1;
    END LOOP;
    
    RETURN v_scheduled_count;
END;
$$;

-- دالة تحديد الاختناقات (Bottleneck Analysis)
CREATE OR REPLACE FUNCTION identify_bottlenecks(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    work_center_id UUID,
    work_center_name VARCHAR,
    available_hours DECIMAL,
    planned_hours DECIMAL,
    utilization_pct DECIMAL,
    is_bottleneck BOOLEAN,
    bottleneck_severity VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH load_data AS (
        SELECT 
            wc.id,
            wc.name,
            calc.total_available_hours,
            load.total_planned_hours,
            CASE 
                WHEN calc.total_available_hours > 0 
                THEN ROUND((load.total_planned_hours / calc.total_available_hours * 100)::NUMERIC, 2)
                ELSE 0 
            END as util_pct
        FROM work_centers wc
        CROSS JOIN LATERAL calculate_available_capacity(wc.id, p_start_date, p_end_date) calc
        CROSS JOIN LATERAL calculate_planned_load(wc.id, p_start_date, p_end_date) load
        WHERE wc.org_id = p_org_id
        AND wc.is_active = true
    )
    SELECT 
        ld.id,
        ld.name,
        ld.total_available_hours,
        ld.total_planned_hours,
        ld.util_pct,
        ld.util_pct > 85 as is_bottleneck,
        CASE 
            WHEN ld.util_pct > 100 THEN 'CRITICAL'
            WHEN ld.util_pct > 95 THEN 'HIGH'
            WHEN ld.util_pct > 85 THEN 'MEDIUM'
            ELSE 'LOW'
        END::VARCHAR as bottleneck_severity
    FROM load_data ld
    ORDER BY ld.util_pct DESC;
END;
$$;

-- =====================================================
-- 10. Views للتقارير
-- =====================================================

-- عرض ملخص الطاقة الإنتاجية
CREATE OR REPLACE VIEW v_capacity_summary AS
SELECT 
    wc.org_id,
    wc.id as work_center_id,
    wc.name as work_center_name,
    wc.capacity_hours_per_day,
    wc.number_of_machines,
    wcl.period_start,
    wcl.period_end,
    wcl.available_capacity_hours,
    wcl.planned_load_hours,
    wcl.actual_load_hours,
    wcl.utilization_pct,
    wcl.planned_work_orders,
    wcl.completed_work_orders,
    CASE 
        WHEN wcl.utilization_pct > 100 THEN 'OVERLOADED'
        WHEN wcl.utilization_pct > 85 THEN 'HIGH'
        WHEN wcl.utilization_pct > 50 THEN 'NORMAL'
        ELSE 'LOW'
    END as load_status
FROM work_centers wc
LEFT JOIN work_center_load wcl ON wc.id = wcl.work_center_id;

-- عرض جدول الإنتاج
CREATE OR REPLACE VIEW v_production_schedule_details AS
SELECT 
    ps.id as schedule_id,
    ps.schedule_number,
    ps.status as schedule_status,
    ps.period_start,
    ps.period_end,
    sd.schedule_sequence,
    sd.scheduled_start,
    sd.scheduled_end,
    sd.schedule_status as item_status,
    wo.work_order_number,
    wo.operation_name,
    wo.planned_quantity,
    wo.completed_quantity,
    mo.order_number as mo_number,
    wc.name as work_center_name,
    EXTRACT(EPOCH FROM (sd.scheduled_end - sd.scheduled_start)) / 3600 as duration_hours
FROM production_schedules ps
JOIN schedule_details sd ON ps.id = sd.schedule_id
JOIN work_orders wo ON sd.work_order_id = wo.id
JOIN manufacturing_orders mo ON wo.mo_id = mo.id
JOIN work_centers wc ON wo.work_center_id = wc.id;

-- =====================================================
-- 11. Triggers
-- =====================================================

-- Trigger لتحديث حمل مركز العمل عند تغيير أمر عمل
CREATE OR REPLACE FUNCTION trigger_update_load_on_work_order_change()
RETURNS TRIGGER AS $$
BEGIN
    -- تحديث الحمل للأسبوع الحالي
    PERFORM update_work_center_load(
        COALESCE(NEW.work_center_id, OLD.work_center_id),
        DATE_TRUNC('week', CURRENT_DATE)::DATE,
        (DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '6 days')::DATE
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_work_order_load_update ON work_orders;
CREATE TRIGGER trigger_work_order_load_update
    AFTER INSERT OR UPDATE OR DELETE ON work_orders
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_load_on_work_order_change();

-- =====================================================
-- تم إنشاء نظام تخطيط الطاقة والجدولة بنجاح
-- =====================================================

