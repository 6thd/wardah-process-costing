-- ===================================================================
-- Migration 109: عرض WIP حسب مراحل التصنيع
-- ===================================================================
-- الجداول المتوفرة فعلاً في الإنتاج (مُحقَّقة):
--   manufacturing_orders (total_cost, unit_cost, completed_quantity)
--   work_orders          (actual_run_time, actual_setup_time, status)
-- ملاحظة: stock_moves / labor_entries / overhead_allocations غير موجودة حتى الآن.
--   التكاليف مأخوذة من حقلَي total_cost/unit_cost على أمر التصنيع مباشرة.
-- ===================================================================

CREATE OR REPLACE VIEW wip_by_stage
WITH (security_invoker = on)
AS
SELECT
    mo.id,
    mo.org_id,
    mo.order_number,
    mo.product_id,
    p.name                              AS product_name,
    mo.status,
    mo.quantity                         AS qty_planned,
    COALESCE(mo.completed_quantity, 0)  AS qty_produced,
    -- نسبة إتمام العمليات (من work_orders)
    CASE
        WHEN COUNT(wo.id) = 0 THEN 0
        ELSE ROUND(
            100.0 * COUNT(wo.id) FILTER (WHERE wo.status = 'done')
            / NULLIF(COUNT(wo.id), 0), 1
        )
    END                                 AS operations_completion_pct,
    -- التكلفة الإجمالية المسجَّلة على الأمر
    COALESCE(mo.total_cost, 0)          AS total_wip_cost,
    -- تكلفة الوحدة
    COALESCE(mo.unit_cost, 0)           AS current_unit_cost,
    mo.start_date,
    mo.due_date
FROM manufacturing_orders mo
JOIN products p ON p.id = mo.product_id
LEFT JOIN work_orders wo ON wo.mo_id = mo.id
WHERE mo.status IN ('in_progress', 'quality_check', 'on_hold')
GROUP BY
    mo.id, mo.org_id, mo.order_number, mo.product_id, p.name,
    mo.status, mo.quantity, mo.completed_quantity,
    mo.total_cost, mo.unit_cost, mo.start_date, mo.due_date;
