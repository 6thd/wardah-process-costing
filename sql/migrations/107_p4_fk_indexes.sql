-- ===================================================================
-- Migration 107: P4 — فهرسة المفاتيح الأجنبية بلا فهارس (108 FK)
-- ===================================================================
-- المصدر: Supabase Advisor "unindexed_foreign_keys" (108 تحذير)
-- المنهجية: CREATE INDEX IF NOT EXISTS (خارج الترانزاكشن المفردة
--            لأن CONCURRENTLY غير متاحة داخل transactions)
-- الترتيب: مالي/GL ← HR ← تصنيع ← مشتريات/مبيعات ← مخزون ← metadata
-- ===================================================================

-- ===========================
-- 1. GL والمحاسبة (P0)
-- ===========================
CREATE INDEX IF NOT EXISTS idx_gl_entries_journal_id
    ON public.gl_entries (journal_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_journal_id
    ON public.journal_entries (journal_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_reversed_by
    ON public.journal_entries (reversed_by_entry_id);

CREATE INDEX IF NOT EXISTS idx_journal_lines_profit_center
    ON public.journal_lines (profit_center_id);

CREATE INDEX IF NOT EXISTS idx_journal_lines_segment
    ON public.journal_lines (segment_id);

CREATE INDEX IF NOT EXISTS idx_account_segments_parent
    ON public.account_segments (parent_id);

CREATE INDEX IF NOT EXISTS idx_accounts_parent
    ON public.accounts (parent_id);

-- ===========================
-- 2. HR والرواتب (P1)
-- ===========================
CREATE INDEX IF NOT EXISTS idx_hr_settlements_journal
    ON public.hr_settlements (journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_hr_settlement_lines_settlement
    ON public.hr_settlement_lines (settlement_id);

CREATE INDEX IF NOT EXISTS idx_hr_payroll_adjustments_run
    ON public.hr_payroll_adjustments (payroll_run_id);

CREATE INDEX IF NOT EXISTS idx_hr_payroll_locks_journal
    ON public.hr_payroll_locks (journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_hr_payroll_account_mappings_account
    ON public.hr_payroll_account_mappings (gl_account_id);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_journal
    ON public.payroll_runs (journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_payroll_details_employee
    ON public.payroll_details (employee_id);

CREATE INDEX IF NOT EXISTS idx_payroll_details_component
    ON public.payroll_details (component_id);

-- فهرس مركّب للـ FK المركّب (migration 101)
CREATE INDEX IF NOT EXISTS idx_payroll_details_employee_org
    ON public.payroll_details (employee_id, org_id);

CREATE INDEX IF NOT EXISTS idx_employees_manager
    ON public.employees (manager_id);

CREATE INDEX IF NOT EXISTS idx_departments_manager
    ON public.departments (manager_id);

CREATE INDEX IF NOT EXISTS idx_positions_department
    ON public.positions (department_id);

CREATE INDEX IF NOT EXISTS idx_employee_leaves_leave_type
    ON public.employee_leaves (leave_type_id);

-- فهارس مركّبة للـ FKs المركّبة (migration 101 — NOT VALID)
CREATE INDEX IF NOT EXISTS idx_attendance_records_employee_org
    ON public.attendance_records (employee_id, org_id);

CREATE INDEX IF NOT EXISTS idx_employee_leaves_employee_org
    ON public.employee_leaves (employee_id, org_id);

CREATE INDEX IF NOT EXISTS idx_employee_salary_structures_employee_org
    ON public.employee_salary_structures (employee_id, org_id);

CREATE INDEX IF NOT EXISTS idx_hr_settlements_employee_org
    ON public.hr_settlements (employee_id, org_id);

-- ===========================
-- 3. التصنيع
-- ===========================
CREATE INDEX IF NOT EXISTS idx_work_orders_operation
    ON public.work_orders (operation_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_current_operator
    ON public.work_orders (current_operator_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_created_by
    ON public.work_orders (created_by);

CREATE INDEX IF NOT EXISTS idx_manufacturing_orders_routing
    ON public.manufacturing_orders (routing_id);

CREATE INDEX IF NOT EXISTS idx_material_consumption_mo
    ON public.material_consumption (mo_id);

CREATE INDEX IF NOT EXISTS idx_material_consumption_created_by
    ON public.material_consumption (created_by);

CREATE INDEX IF NOT EXISTS idx_machine_downtime_work_order
    ON public.machine_downtime (work_order_id);

CREATE INDEX IF NOT EXISTS idx_machine_downtime_reported_by
    ON public.machine_downtime (reported_by);

CREATE INDEX IF NOT EXISTS idx_machine_downtime_resolved_by
    ON public.machine_downtime (resolved_by);

CREATE INDEX IF NOT EXISTS idx_quality_inspections_work_order
    ON public.quality_inspections (work_order_id);

CREATE INDEX IF NOT EXISTS idx_quality_inspections_inspector
    ON public.quality_inspections (inspector_id);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_work_order
    ON public.operator_sessions (current_work_order_id);

CREATE INDEX IF NOT EXISTS idx_scheduling_constraints_source
    ON public.scheduling_constraints (source_work_order_id);

CREATE INDEX IF NOT EXISTS idx_scheduling_constraints_target
    ON public.scheduling_constraints (target_work_order_id);

CREATE INDEX IF NOT EXISTS idx_scheduling_constraints_work_center
    ON public.scheduling_constraints (work_center_id);

CREATE INDEX IF NOT EXISTS idx_production_schedules_approved_by
    ON public.production_schedules (approved_by);

CREATE INDEX IF NOT EXISTS idx_production_schedules_created_by
    ON public.production_schedules (created_by);

CREATE INDEX IF NOT EXISTS idx_bom_headers_routing
    ON public.bom_headers (routing_id);

CREATE INDEX IF NOT EXISTS idx_bom_headers_approved_by
    ON public.bom_headers (approved_by);

CREATE INDEX IF NOT EXISTS idx_bom_versions_changed_by
    ON public.bom_versions (changed_by);

CREATE INDEX IF NOT EXISTS idx_routings_created_by
    ON public.routings (created_by);

CREATE INDEX IF NOT EXISTS idx_routings_updated_by
    ON public.routings (updated_by);

CREATE INDEX IF NOT EXISTS idx_routings_approved_by
    ON public.routings (approved_by);

CREATE INDEX IF NOT EXISTS idx_stage_wip_log_mo
    ON public.stage_wip_log (mo_id);

-- ===========================
-- 4. المشتريات والمبيعات
-- ===========================
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_po
    ON public.supplier_invoices (purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_gr
    ON public.supplier_invoices (goods_receipt_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_gr_line
    ON public.supplier_invoice_lines (goods_receipt_line_id);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_po_line
    ON public.goods_receipt_lines (purchase_order_line_id);

CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_si_line
    ON public.delivery_note_lines (sales_invoice_line_id);

CREATE INDEX IF NOT EXISTS idx_payment_vouchers_gl_entry
    ON public.payment_vouchers (gl_entry_id);

CREATE INDEX IF NOT EXISTS idx_payment_vouchers_account
    ON public.payment_vouchers (payment_account_id);

CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_gl_entry
    ON public.receipt_vouchers (gl_entry_id);

CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_account
    ON public.receipt_vouchers (payment_account_id);

CREATE INDEX IF NOT EXISTS idx_customer_collections_account
    ON public.customer_collections (payment_account_id);

-- ===========================
-- 5. المخزون
-- ===========================
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_journal
    ON public.stock_adjustments (journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_reversal_journal
    ON public.stock_adjustments (reversal_journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_warehouse
    ON public.stock_adjustments (warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_created_by
    ON public.stock_adjustments (created_by);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_approved_by
    ON public.stock_adjustments (approved_by);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_submitted_by
    ON public.stock_adjustments (submitted_by);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_cancelled_by
    ON public.stock_adjustments (cancelled_by);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_updated_by
    ON public.stock_adjustments (updated_by);

CREATE INDEX IF NOT EXISTS idx_stock_adjustment_items_warehouse
    ON public.stock_adjustment_items (warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_reposting_queue_org
    ON public.stock_reposting_queue (org_id);

CREATE INDEX IF NOT EXISTS idx_stock_reposting_queue_product
    ON public.stock_reposting_queue (product_id);

CREATE INDEX IF NOT EXISTS idx_stock_reposting_queue_warehouse
    ON public.stock_reposting_queue (warehouse_id);

CREATE INDEX IF NOT EXISTS idx_physical_count_items_warehouse
    ON public.physical_count_items (warehouse_id);

CREATE INDEX IF NOT EXISTS idx_physical_count_items_counted_by
    ON public.physical_count_items (counted_by);

CREATE INDEX IF NOT EXISTS idx_physical_count_items_verified_by
    ON public.physical_count_items (verified_by);

CREATE INDEX IF NOT EXISTS idx_physical_count_sessions_warehouse
    ON public.physical_count_sessions (warehouse_id);

CREATE INDEX IF NOT EXISTS idx_physical_count_sessions_created_by
    ON public.physical_count_sessions (created_by);

CREATE INDEX IF NOT EXISTS idx_physical_count_sessions_supervisor
    ON public.physical_count_sessions (supervisor_id);

CREATE INDEX IF NOT EXISTS idx_physical_count_sessions_adjustment
    ON public.physical_count_sessions (adjustment_id);

CREATE INDEX IF NOT EXISTS idx_storage_locations_parent
    ON public.storage_locations (parent_location_id);

CREATE INDEX IF NOT EXISTS idx_storage_bins_product
    ON public.storage_bins (dedicated_product_id);

CREATE INDEX IF NOT EXISTS idx_bins_org
    ON public.bins (org_id);

-- ===========================
-- 6. الحسابات والمخطط
-- ===========================
CREATE INDEX IF NOT EXISTS idx_warehouse_gl_mapping_org
    ON public.warehouse_gl_mapping (org_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_gl_mapping_stock_account
    ON public.warehouse_gl_mapping (stock_account);

CREATE INDEX IF NOT EXISTS idx_warehouse_gl_mapping_cogs
    ON public.warehouse_gl_mapping (default_cogs_account);

CREATE INDEX IF NOT EXISTS idx_warehouse_gl_mapping_adjustment_account
    ON public.warehouse_gl_mapping (stock_adjustment_account);

CREATE INDEX IF NOT EXISTS idx_warehouse_gl_mapping_snrb
    ON public.warehouse_gl_mapping (stock_received_but_not_billed);

-- ===========================
-- 7. الأدوار والمستخدمون
-- ===========================
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by
    ON public.invitations (invited_by);

CREATE INDEX IF NOT EXISTS idx_user_organizations_invited_by
    ON public.user_organizations (invited_by);

CREATE INDEX IF NOT EXISTS idx_user_roles_assigned_by
    ON public.user_roles (assigned_by);

CREATE INDEX IF NOT EXISTS idx_roles_created_by
    ON public.roles (created_by);

CREATE INDEX IF NOT EXISTS idx_role_permissions_created_by
    ON public.role_permissions (created_by);

CREATE INDEX IF NOT EXISTS idx_organizations_created_by
    ON public.organizations (created_by);

CREATE INDEX IF NOT EXISTS idx_security_audit_reports_org
    ON public.security_audit_reports (org_id);

-- ===========================
-- 8. التحقق
-- ===========================
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname LIKE 'idx_%'
      AND indexname IN (
        'idx_gl_entries_journal_id',
        'idx_hr_settlement_lines_settlement',
        'idx_payroll_details_employee',
        'idx_supplier_invoices_po',
        'idx_stock_adjustments_journal',
        'idx_work_orders_operation'
      );

    RAISE NOTICE 'Migration 107: % من 6 فهارس أساسية مُنشأة ✓', v_count;
END;
$$;
