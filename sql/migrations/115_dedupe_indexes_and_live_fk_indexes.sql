-- ===================================================================
-- Migration 115: إزالة الفهارس المكررة + فهرسة FKs الحية المتبقية (P4)
-- ===================================================================
-- المصدر: Performance Advisor — 11 مجموعة «Duplicate Index» +
--   16 «Unindexed foreign keys».
-- التحقق المسبق: كل مجموعة مكررة متطابقة التعريف حرفياً (btree عادي،
--   غير فريد، نفس الأعمدة والاتجاه) — الحذف آمن. نُبقي الاسم القانوني
--   idx_<table>_<columns> ونحذف البقية.
-- الـ FKs: نفهرس الجداول الحية الأربعة فقط؛ جداول legacy
--   `*_20250905_1900` (12 FK) تُترك عمداً لقرار أرشفة/حذف لاحق —
--   فهرستها إنفاق بلا عائد على جداول ميتة.
-- ===================================================================

BEGIN;

-- 1) حذف المكررات (12 فهرساً عبر 11 مجموعة)
DROP INDEX IF EXISTS public.idx_audit_entity;              -- يبقى idx_audit_logs_entity
DROP INDEX IF EXISTS public.idx_audit_logs_org_date;       -- يبقى idx_audit_logs_org_created
DROP INDEX IF EXISTS public.idx_audit_org_created;         -- (المجموعة الثلاثية نفسها)
DROP INDEX IF EXISTS public.idx_delivery_lines_product;    -- يبقى idx_delivery_note_lines_product_id
DROP INDEX IF EXISTS public.idx_gl_lines_account;          -- يبقى idx_gl_entry_lines_account
DROP INDEX IF EXISTS public.idx_gl_lines_entry;            -- يبقى idx_gl_entry_lines_entry
DROP INDEX IF EXISTS public.idx_journal_entries_status;    -- يبقى idx_journal_entries_org_status (كلاهما org_id,status)
DROP INDEX IF EXISTS public.idx_manufacturing_orders_status; -- يبقى idx_manufacturing_orders_org_status
DROP INDEX IF EXISTS public.idx_sales_lines_invoice;       -- يبقى idx_sales_invoice_lines_invoice_id
DROP INDEX IF EXISTS public.idx_sales_lines_product;       -- يبقى idx_sales_invoice_lines_product_id
DROP INDEX IF EXISTS public.idx_sales_invoices_customer;   -- يبقى idx_sales_invoices_customer_id
DROP INDEX IF EXISTS public.idx_sales_invoices_org;        -- يبقى idx_sales_invoices_org_id

-- 2) فهرسة FKs الحية الأربعة المتبقية
CREATE INDEX IF NOT EXISTS idx_employee_salary_structures_component_id
    ON public.employee_salary_structures (component_id);
CREATE INDEX IF NOT EXISTS idx_journal_approval_rules_journal_id
    ON public.journal_approval_rules (journal_id);
CREATE INDEX IF NOT EXISTS idx_standard_costs_product_id
    ON public.standard_costs (product_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_expense_account_id
    ON public.warehouses (expense_account_id);

-- 3) تحقق
DO $$
DECLARE
    v_dupes  INT;
    v_keep   INT;
    v_new    INT;
BEGIN
    -- المكررات المحذوفة اختفت
    SELECT COUNT(*) INTO v_dupes
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_audit_entity','idx_audit_logs_org_date','idx_audit_org_created',
        'idx_delivery_lines_product','idx_gl_lines_account','idx_gl_lines_entry',
        'idx_journal_entries_status','idx_manufacturing_orders_status',
        'idx_sales_lines_invoice','idx_sales_lines_product',
        'idx_sales_invoices_customer','idx_sales_invoices_org'
      );
    IF v_dupes > 0 THEN
        RAISE EXCEPTION 'FAIL[115-1] — % فهرس مكرر لم يُحذف', v_dupes;
    END IF;

    -- الفهارس القانونية المُبقاة سليمة (11)
    SELECT COUNT(*) INTO v_keep
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_audit_logs_entity','idx_audit_logs_org_created',
        'idx_delivery_note_lines_product_id',
        'idx_gl_entry_lines_account','idx_gl_entry_lines_entry',
        'idx_journal_entries_org_status','idx_manufacturing_orders_org_status',
        'idx_sales_invoice_lines_invoice_id','idx_sales_invoice_lines_product_id',
        'idx_sales_invoices_customer_id','idx_sales_invoices_org_id'
      );
    IF v_keep < 11 THEN
        RAISE EXCEPTION 'FAIL[115-2] — فهرس قانوني مفقود! (% من 11)', v_keep;
    END IF;

    -- فهارس الـ FK الجديدة موجودة (4)
    SELECT COUNT(*) INTO v_new
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_employee_salary_structures_component_id',
        'idx_journal_approval_rules_journal_id',
        'idx_standard_costs_product_id',
        'idx_warehouses_expense_account_id'
      );
    IF v_new < 4 THEN
        RAISE EXCEPTION 'FAIL[115-3] — فهرس FK جديد مفقود! (% من 4)', v_new;
    END IF;

    RAISE NOTICE 'VERIFY[115] ✓ — 12 مكرراً حُذف، 11 قانونياً باقٍ، 4 فهارس FK أُضيفت';
END;
$$;

COMMIT;
