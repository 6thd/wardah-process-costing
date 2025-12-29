-- =====================================================
-- Migration: Manufacturing Integration
-- تكامل أوامر التصنيع مع المسارات و Backflushing التلقائي
-- Author: AI Assistant
-- Date: 2024-12-27
-- =====================================================

-- =====================================================
-- 1. تحسين جدول أوامر التصنيع لدعم المسارات
-- =====================================================

-- إضافة حقول إضافية لأمر التصنيع
ALTER TABLE manufacturing_orders 
ADD COLUMN IF NOT EXISTS work_orders_generated BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_backflush BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS backflush_timing VARCHAR(20) DEFAULT 'ON_COMPLETION' 
    CHECK (backflush_timing IN ('ON_START', 'ON_COMPLETION', 'MANUAL'));

-- =====================================================
-- 2. Trigger لإنشاء أوامر العمل تلقائياً
-- =====================================================

CREATE OR REPLACE FUNCTION auto_generate_work_orders()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_operation RECORD;
    v_sequence INTEGER := 0;
    v_work_order_number VARCHAR;
BEGIN
    -- فقط عند تغيير الحالة إلى RELEASED أو IN_PROGRESS
    IF NEW.status IN ('RELEASED', 'IN_PROGRESS') 
       AND (OLD.status IS NULL OR OLD.status NOT IN ('RELEASED', 'IN_PROGRESS'))
       AND NEW.routing_id IS NOT NULL
       AND NEW.work_orders_generated = false THEN
        
        -- إنشاء أوامر عمل لكل عملية في المسار
        FOR v_operation IN 
            SELECT ro.*, wc.name as work_center_name, wc.name_ar as work_center_name_ar
            FROM routing_operations ro
            JOIN work_centers wc ON ro.work_center_id = wc.id
            WHERE ro.routing_id = NEW.routing_id
            AND ro.is_active = true
            ORDER BY ro.operation_sequence
        LOOP
            v_sequence := v_sequence + 1;
            v_work_order_number := NEW.order_number || '-WO-' || LPAD(v_sequence::TEXT, 3, '0');
            
            INSERT INTO work_orders (
                org_id, mo_id, operation_id, work_center_id,
                work_order_number, operation_sequence, operation_name, operation_name_ar,
                planned_quantity, planned_setup_time, planned_run_time,
                status, priority, created_by
            ) VALUES (
                NEW.org_id, NEW.id, v_operation.id, v_operation.work_center_id,
                v_work_order_number, v_operation.operation_sequence, 
                v_operation.operation_name, v_operation.operation_name_ar,
                NEW.quantity, v_operation.standard_setup_time,
                v_operation.standard_run_time_per_unit * NEW.quantity,
                'PENDING', 5, auth.uid()
            );
        END LOOP;
        
        -- تحديث علامة إنشاء أوامر العمل
        NEW.work_orders_generated := true;
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_generate_work_orders ON manufacturing_orders;
CREATE TRIGGER trigger_auto_generate_work_orders
    BEFORE UPDATE ON manufacturing_orders
    FOR EACH ROW
    EXECUTE FUNCTION auto_generate_work_orders();

-- =====================================================
-- 3. Trigger لـ Backflushing التلقائي
-- =====================================================

CREATE OR REPLACE FUNCTION auto_backflush_materials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mo RECORD;
    v_bom_line RECORD;
    v_qty_to_consume DECIMAL;
BEGIN
    -- فقط عند تسجيل كمية منتجة جديدة
    IF NEW.completed_quantity > COALESCE(OLD.completed_quantity, 0) THEN
        
        -- الحصول على معلومات أمر التصنيع
        SELECT mo.*, mo.auto_backflush, mo.backflush_timing, mo.bom_id
        INTO v_mo
        FROM manufacturing_orders mo
        WHERE mo.id = NEW.mo_id;
        
        -- التحقق من تفعيل Backflushing التلقائي
        IF v_mo.auto_backflush = true AND v_mo.backflush_timing = 'ON_COMPLETION' THEN
            
            v_qty_to_consume := NEW.completed_quantity - COALESCE(OLD.completed_quantity, 0);
            
            -- استهلاك المواد بناءً على BOM
            FOR v_bom_line IN 
                SELECT bl.*, i.name as item_name
                FROM bom_lines bl
                JOIN items i ON bl.item_id = i.id
                WHERE bl.bom_id = v_mo.bom_id
                AND bl.item_type IN ('RAW_MATERIAL', 'COMPONENT')
            LOOP
                -- تسجيل الاستهلاك
                INSERT INTO material_consumption (
                    org_id, work_order_id, mo_id, item_id,
                    planned_quantity, consumed_quantity, consumption_type,
                    unit_cost, total_cost, status, consumption_date, created_by
                ) VALUES (
                    NEW.org_id, NEW.id, NEW.mo_id, v_bom_line.item_id,
                    v_bom_line.quantity * v_qty_to_consume,
                    v_bom_line.quantity * v_qty_to_consume,
                    'BACKFLUSH',
                    COALESCE(v_bom_line.unit_cost, 0),
                    COALESCE(v_bom_line.unit_cost, 0) * v_bom_line.quantity * v_qty_to_consume,
                    'POSTED', NOW(), auth.uid()
                );
            END LOOP;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_backflush ON work_orders;
CREATE TRIGGER trigger_auto_backflush
    AFTER UPDATE ON work_orders
    FOR EACH ROW
    EXECUTE FUNCTION auto_backflush_materials();

-- =====================================================
-- 4. دالة ربط أمر التصنيع بالمسار
-- =====================================================

CREATE OR REPLACE FUNCTION assign_routing_to_mo(
    p_mo_id UUID,
    p_routing_id UUID
)
RETURNS manufacturing_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mo manufacturing_orders;
BEGIN
    -- التحقق من صلاحية المسار
    IF NOT EXISTS (
        SELECT 1 FROM routings 
        WHERE id = p_routing_id 
        AND status = 'APPROVED' 
        AND is_active = true
    ) THEN
        RAISE EXCEPTION 'Routing must be approved and active';
    END IF;
    
    -- تحديث أمر التصنيع
    UPDATE manufacturing_orders SET
        routing_id = p_routing_id,
        updated_at = NOW()
    WHERE id = p_mo_id
    RETURNING * INTO v_mo;
    
    RETURN v_mo;
END;
$$;

-- =====================================================
-- 5. دالة بدء أمر التصنيع مع إنشاء أوامر العمل
-- =====================================================

CREATE OR REPLACE FUNCTION release_manufacturing_order(
    p_mo_id UUID
)
RETURNS manufacturing_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_mo manufacturing_orders;
BEGIN
    -- تحديث حالة أمر التصنيع لـ RELEASED
    UPDATE manufacturing_orders SET
        status = 'RELEASED',
        start_date = COALESCE(start_date, CURRENT_DATE),
        updated_at = NOW()
    WHERE id = p_mo_id
    AND status IN ('PENDING', 'PLANNED')
    RETURNING * INTO v_mo;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing order not found or invalid status';
    END IF;
    
    RETURN v_mo;
END;
$$;

-- =====================================================
-- 6. Views لتقارير الكفاءة
-- =====================================================

-- عرض كفاءة العمالة
CREATE OR REPLACE VIEW v_labor_efficiency AS
SELECT 
    wo.org_id,
    wo.work_center_id,
    wc.name as work_center_name,
    mo.order_number,
    wo.work_order_number,
    wo.operation_name,
    wo.planned_setup_time,
    wo.actual_setup_time,
    wo.planned_run_time,
    wo.actual_run_time,
    wo.planned_quantity,
    wo.completed_quantity,
    wo.scrapped_quantity,
    -- كفاءة وقت الإعداد
    CASE 
        WHEN wo.actual_setup_time > 0 
        THEN ROUND((wo.planned_setup_time / wo.actual_setup_time * 100)::NUMERIC, 2)
        ELSE 100 
    END as setup_efficiency_pct,
    -- كفاءة وقت التشغيل
    CASE 
        WHEN wo.actual_run_time > 0 
        THEN ROUND((wo.planned_run_time / wo.actual_run_time * 100)::NUMERIC, 2)
        ELSE 100 
    END as run_efficiency_pct,
    -- الكفاءة الإجمالية
    CASE 
        WHEN (wo.actual_setup_time + wo.actual_run_time) > 0 
        THEN ROUND(((wo.planned_setup_time + wo.planned_run_time) / (wo.actual_setup_time + wo.actual_run_time) * 100)::NUMERIC, 2)
        ELSE 100 
    END as overall_efficiency_pct,
    -- نسبة الخردة
    CASE 
        WHEN wo.completed_quantity + wo.scrapped_quantity > 0 
        THEN ROUND((wo.scrapped_quantity / (wo.completed_quantity + wo.scrapped_quantity) * 100)::NUMERIC, 2)
        ELSE 0 
    END as scrap_rate_pct,
    wo.actual_start_date,
    wo.actual_end_date,
    wo.status
FROM work_orders wo
JOIN manufacturing_orders mo ON wo.mo_id = mo.id
JOIN work_centers wc ON wo.work_center_id = wc.id
WHERE wo.status = 'COMPLETED';

-- عرض ملخص كفاءة مركز العمل
CREATE OR REPLACE VIEW v_work_center_efficiency_summary AS
SELECT 
    wo.org_id,
    wo.work_center_id,
    wc.name as work_center_name,
    wc.name_ar as work_center_name_ar,
    DATE_TRUNC('day', wo.actual_end_date) as production_date,
    COUNT(*) as completed_operations,
    SUM(wo.completed_quantity) as total_produced,
    SUM(wo.scrapped_quantity) as total_scrapped,
    SUM(wo.planned_setup_time) as total_planned_setup,
    SUM(wo.actual_setup_time) as total_actual_setup,
    SUM(wo.planned_run_time) as total_planned_run,
    SUM(wo.actual_run_time) as total_actual_run,
    ROUND(AVG(
        CASE 
            WHEN wo.actual_setup_time > 0 
            THEN wo.planned_setup_time / wo.actual_setup_time * 100
            ELSE 100 
        END
    )::NUMERIC, 2) as avg_setup_efficiency,
    ROUND(AVG(
        CASE 
            WHEN wo.actual_run_time > 0 
            THEN wo.planned_run_time / wo.actual_run_time * 100
            ELSE 100 
        END
    )::NUMERIC, 2) as avg_run_efficiency,
    ROUND(AVG(
        CASE 
            WHEN (wo.actual_setup_time + wo.actual_run_time) > 0 
            THEN (wo.planned_setup_time + wo.planned_run_time) / (wo.actual_setup_time + wo.actual_run_time) * 100
            ELSE 100 
        END
    )::NUMERIC, 2) as avg_overall_efficiency
FROM work_orders wo
JOIN work_centers wc ON wo.work_center_id = wc.id
WHERE wo.status = 'COMPLETED'
AND wo.actual_end_date IS NOT NULL
GROUP BY wo.org_id, wo.work_center_id, wc.name, wc.name_ar, DATE_TRUNC('day', wo.actual_end_date);

-- عرض تباين التكاليف
CREATE OR REPLACE VIEW v_cost_variance_report AS
SELECT 
    wo.org_id,
    mo.order_number,
    wo.work_order_number,
    wo.operation_name,
    wc.name as work_center_name,
    -- تكلفة العمالة المخططة
    ROUND(((wo.planned_setup_time + wo.planned_run_time) / 60 * COALESCE(ro.labor_rate_per_hour, wc.default_labor_rate, 0))::NUMERIC, 2) as planned_labor_cost,
    -- تكلفة العمالة الفعلية
    ROUND(((wo.actual_setup_time + wo.actual_run_time) / 60 * COALESCE(ro.labor_rate_per_hour, wc.default_labor_rate, 0))::NUMERIC, 2) as actual_labor_cost,
    -- تباين العمالة
    ROUND((((wo.actual_setup_time + wo.actual_run_time) - (wo.planned_setup_time + wo.planned_run_time)) / 60 * COALESCE(ro.labor_rate_per_hour, wc.default_labor_rate, 0))::NUMERIC, 2) as labor_variance,
    -- تكلفة المصاريف غير المباشرة المخططة
    ROUND(((wo.planned_setup_time + wo.planned_run_time) / 60 * COALESCE(ro.overhead_rate_per_hour, wc.default_overhead_rate, 0))::NUMERIC, 2) as planned_overhead_cost,
    -- تكلفة المصاريف غير المباشرة الفعلية
    ROUND(((wo.actual_setup_time + wo.actual_run_time) / 60 * COALESCE(ro.overhead_rate_per_hour, wc.default_overhead_rate, 0))::NUMERIC, 2) as actual_overhead_cost,
    -- تباين المصاريف غير المباشرة
    ROUND((((wo.actual_setup_time + wo.actual_run_time) - (wo.planned_setup_time + wo.planned_run_time)) / 60 * COALESCE(ro.overhead_rate_per_hour, wc.default_overhead_rate, 0))::NUMERIC, 2) as overhead_variance,
    wo.status,
    wo.actual_end_date
FROM work_orders wo
JOIN manufacturing_orders mo ON wo.mo_id = mo.id
JOIN work_centers wc ON wo.work_center_id = wc.id
LEFT JOIN routing_operations ro ON wo.operation_id = ro.id
WHERE wo.status = 'COMPLETED';

-- عرض استهلاك المواد
CREATE OR REPLACE VIEW v_material_consumption_report AS
SELECT 
    mc.org_id,
    mo.order_number,
    wo.work_order_number,
    i.code as item_code,
    i.name as item_name,
    mc.planned_quantity,
    mc.consumed_quantity,
    mc.consumed_quantity - mc.planned_quantity as variance_qty,
    CASE 
        WHEN mc.planned_quantity > 0 
        THEN ROUND(((mc.consumed_quantity - mc.planned_quantity) / mc.planned_quantity * 100)::NUMERIC, 2)
        ELSE 0 
    END as variance_pct,
    mc.unit_cost,
    mc.total_cost,
    mc.consumption_type,
    mc.consumption_date,
    mc.status
FROM material_consumption mc
JOIN manufacturing_orders mo ON mc.mo_id = mo.id
JOIN work_orders wo ON mc.work_order_id = wo.id
JOIN items i ON mc.item_id = i.id;

-- عرض OEE (Overall Equipment Effectiveness)
CREATE OR REPLACE VIEW v_oee_report AS
WITH daily_data AS (
    SELECT 
        wo.org_id,
        wo.work_center_id,
        DATE_TRUNC('day', wo.actual_end_date) as production_date,
        -- الوقت المتاح (بالدقائق)
        wc.capacity_hours_per_day * 60 as available_time,
        -- وقت التشغيل الفعلي
        SUM(wo.actual_setup_time + wo.actual_run_time) as operating_time,
        -- وقت التوقف
        COALESCE(SUM(md.duration_minutes), 0) as downtime,
        -- الكمية المنتجة
        SUM(wo.completed_quantity) as total_produced,
        -- الكمية الجيدة (بعد خصم الخردة)
        SUM(wo.completed_quantity - wo.scrapped_quantity) as good_quantity,
        -- الكمية المخططة
        SUM(wo.planned_quantity) as planned_quantity,
        -- وقت الدورة القياسي (دقائق لكل وحدة)
        AVG(ro.standard_run_time_per_unit) as ideal_cycle_time
    FROM work_orders wo
    JOIN work_centers wc ON wo.work_center_id = wc.id
    LEFT JOIN machine_downtime md ON wo.work_center_id = md.work_center_id 
        AND DATE_TRUNC('day', md.start_time) = DATE_TRUNC('day', wo.actual_end_date)
    LEFT JOIN routing_operations ro ON wo.operation_id = ro.id
    WHERE wo.status = 'COMPLETED'
    AND wo.actual_end_date IS NOT NULL
    GROUP BY wo.org_id, wo.work_center_id, wc.capacity_hours_per_day, DATE_TRUNC('day', wo.actual_end_date)
)
SELECT 
    dd.org_id,
    dd.work_center_id,
    wc.name as work_center_name,
    dd.production_date,
    dd.available_time,
    dd.operating_time,
    dd.downtime,
    dd.total_produced,
    dd.good_quantity,
    -- التوافر (Availability)
    ROUND(((dd.operating_time) / NULLIF(dd.available_time, 0) * 100)::NUMERIC, 2) as availability_pct,
    -- الأداء (Performance)
    ROUND((CASE 
        WHEN dd.operating_time > 0 AND dd.ideal_cycle_time > 0
        THEN (dd.total_produced * dd.ideal_cycle_time) / dd.operating_time * 100
        ELSE 100 
    END)::NUMERIC, 2) as performance_pct,
    -- الجودة (Quality)
    ROUND((CASE 
        WHEN dd.total_produced > 0 
        THEN dd.good_quantity / dd.total_produced * 100
        ELSE 100 
    END)::NUMERIC, 2) as quality_pct,
    -- OEE
    ROUND((
        (dd.operating_time / NULLIF(dd.available_time, 0)) *
        (CASE WHEN dd.operating_time > 0 AND dd.ideal_cycle_time > 0 THEN (dd.total_produced * dd.ideal_cycle_time) / dd.operating_time ELSE 1 END) *
        (CASE WHEN dd.total_produced > 0 THEN dd.good_quantity / dd.total_produced ELSE 1 END) * 100
    )::NUMERIC, 2) as oee_pct
FROM daily_data dd
JOIN work_centers wc ON dd.work_center_id = wc.id;

-- =====================================================
-- 7. دوال تقارير الكفاءة
-- =====================================================

-- دالة حساب كفاءة العمالة لفترة معينة
CREATE OR REPLACE FUNCTION get_labor_efficiency_summary(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_work_center_id UUID DEFAULT NULL
)
RETURNS TABLE (
    work_center_id UUID,
    work_center_name VARCHAR,
    completed_operations INTEGER,
    total_planned_time DECIMAL,
    total_actual_time DECIMAL,
    efficiency_pct DECIMAL,
    total_produced DECIMAL,
    total_scrapped DECIMAL,
    scrap_rate_pct DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wo.work_center_id,
        wc.name::VARCHAR as work_center_name,
        COUNT(*)::INTEGER as completed_operations,
        SUM(wo.planned_setup_time + wo.planned_run_time)::DECIMAL as total_planned_time,
        SUM(wo.actual_setup_time + wo.actual_run_time)::DECIMAL as total_actual_time,
        ROUND((SUM(wo.planned_setup_time + wo.planned_run_time) / 
               NULLIF(SUM(wo.actual_setup_time + wo.actual_run_time), 0) * 100)::NUMERIC, 2)::DECIMAL as efficiency_pct,
        SUM(wo.completed_quantity)::DECIMAL as total_produced,
        SUM(wo.scrapped_quantity)::DECIMAL as total_scrapped,
        ROUND((SUM(wo.scrapped_quantity) / 
               NULLIF(SUM(wo.completed_quantity + wo.scrapped_quantity), 0) * 100)::NUMERIC, 2)::DECIMAL as scrap_rate_pct
    FROM work_orders wo
    JOIN work_centers wc ON wo.work_center_id = wc.id
    WHERE wo.org_id = p_org_id
    AND wo.status = 'COMPLETED'
    AND wo.actual_end_date::DATE BETWEEN p_start_date AND p_end_date
    AND (p_work_center_id IS NULL OR wo.work_center_id = p_work_center_id)
    GROUP BY wo.work_center_id, wc.name;
END;
$$;

-- دالة حساب OEE لفترة معينة
CREATE OR REPLACE FUNCTION get_oee_summary(
    p_org_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_work_center_id UUID DEFAULT NULL
)
RETURNS TABLE (
    work_center_id UUID,
    work_center_name VARCHAR,
    availability_pct DECIMAL,
    performance_pct DECIMAL,
    quality_pct DECIMAL,
    oee_pct DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        v.work_center_id,
        v.work_center_name::VARCHAR,
        ROUND(AVG(v.availability_pct)::NUMERIC, 2)::DECIMAL,
        ROUND(AVG(v.performance_pct)::NUMERIC, 2)::DECIMAL,
        ROUND(AVG(v.quality_pct)::NUMERIC, 2)::DECIMAL,
        ROUND(AVG(v.oee_pct)::NUMERIC, 2)::DECIMAL
    FROM v_oee_report v
    WHERE v.org_id = p_org_id
    AND v.production_date::DATE BETWEEN p_start_date AND p_end_date
    AND (p_work_center_id IS NULL OR v.work_center_id = p_work_center_id)
    GROUP BY v.work_center_id, v.work_center_name;
END;
$$;

-- =====================================================
-- 8. تحديث حالة أمر التصنيع تلقائياً
-- =====================================================

CREATE OR REPLACE FUNCTION update_mo_status_from_work_orders()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_work_orders INTEGER;
    v_completed_work_orders INTEGER;
    v_in_progress_work_orders INTEGER;
    -- Removed unused variables: v_total_completed, v_mo_quantity
BEGIN
    -- الحصول على إحصائيات أوامر العمل
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'COMPLETED'),
        COUNT(*) FILTER (WHERE status IN ('IN_SETUP', 'IN_PROGRESS'))
    INTO v_total_work_orders, v_completed_work_orders, v_in_progress_work_orders
    FROM work_orders
    WHERE mo_id = NEW.mo_id;
    
    -- Removed useless assignments: v_total_completed and v_mo_quantity are not used in subsequent logic
    
    -- تحديث حالة أمر التصنيع
    IF v_completed_work_orders = v_total_work_orders AND v_total_work_orders > 0 THEN
        -- جميع أوامر العمل مكتملة
        UPDATE manufacturing_orders SET
            status = 'COMPLETED',
            actual_end_date = NOW(),
            updated_at = NOW()
        WHERE id = NEW.mo_id
        AND status != 'COMPLETED';
    ELSIF v_in_progress_work_orders > 0 THEN
        -- يوجد أوامر عمل قيد التنفيذ
        UPDATE manufacturing_orders SET
            status = 'IN_PROGRESS',
            updated_at = NOW()
        WHERE id = NEW.mo_id
        AND status NOT IN ('IN_PROGRESS', 'COMPLETED');
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_mo_status ON work_orders;
CREATE TRIGGER trigger_update_mo_status
    AFTER UPDATE ON work_orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION update_mo_status_from_work_orders();

-- =====================================================
-- تم إنشاء التكامل بنجاح
-- =====================================================

