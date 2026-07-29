-- =====================================================================
-- 152_ap_allow_fully_received_purchase_orders
-- =====================================================================
-- Migration 148's terminal accepted-receipt state is `fully_received`.
-- The 149 core accidentally allowed the obsolete/parallel spelling `received`
-- but not `fully_received`, so the most normal AP case — invoice after complete
-- receipt — failed with AP_PO_NOT_INVOICEABLE.
--
-- 150 renamed the implementation to rpc_create_matched_supplier_invoice_v149.
-- Patch that stored definition narrowly and fail closed if its expected predicate
-- is not present, avoiding a second hand-maintained copy of the 400+ line core.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_signature regprocedure :=
    'public.rpc_create_matched_supplier_invoice_v149(jsonb)'::regprocedure;
  v_definition text;
  v_old text := 'NOT IN (''approved'', ''partially_received'', ''received'', ''closed'')';
  v_new text := 'NOT IN (''approved'', ''partially_received'', ''fully_received'', ''received'', ''closed'')';
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;

  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'AP_152_DEFINITION_DRIFT: expected PO status predicate not found in %',
      v_signature;
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END $$;

-- Reassert the internal-only execution surface after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice_v149(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice_v149(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice_v149(jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice_v149(jsonb) FROM service_role;

COMMIT;
