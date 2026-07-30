#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]

migration = ROOT / "sql/migrations/153_financial_gl_legal_amount_contract.sql"
text = migration.read_text(encoding="utf-8")
atomic_sql = '-- ---------------------------------------------------------------------\n-- 9. Atomic payment-voucher posting\n-- ---------------------------------------------------------------------\nCREATE OR REPLACE FUNCTION public.wardah_create_posted_voucher_gl(\n  p_org uuid,\n  p_entry_date date,\n  p_reference_type text,\n  p_reference_id uuid,\n  p_reference_number text,\n  p_description text,\n  p_debit_account_id uuid,\n  p_credit_account_id uuid,\n  p_amount numeric,\n  p_actor uuid\n)\nRETURNS uuid\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $function$\nDECLARE\n  v_entry_id uuid;\n  v_entry_number text;\n  v_journal_id uuid;\n  v_idempotency_key text := p_reference_type || \':\' || p_reference_id::text;\nBEGIN\n  IF p_org IS NULL OR p_reference_id IS NULL OR p_actor IS NULL THEN\n    RAISE EXCEPTION \'VOUCHER_GL_SCOPE_REQUIRED: org, reference and actor are required\';\n  END IF;\n  IF p_amount IS NULL OR round(p_amount, 2) <= 0 THEN\n    RAISE EXCEPTION \'VOUCHER_GL_AMOUNT_INVALID: amount must be positive\';\n  END IF;\n  IF p_debit_account_id = p_credit_account_id THEN\n    RAISE EXCEPTION \'VOUCHER_GL_SAME_ACCOUNT: debit and credit accounts must differ\';\n  END IF;\n\n  IF NOT EXISTS (\n    SELECT 1 FROM public.gl_accounts a\n    WHERE a.id = p_debit_account_id\n      AND a.org_id = p_org\n      AND coalesce(a.is_active, true)\n      AND coalesce(a.allow_posting, true)\n  ) OR NOT EXISTS (\n    SELECT 1 FROM public.gl_accounts a\n    WHERE a.id = p_credit_account_id\n      AND a.org_id = p_org\n      AND coalesce(a.is_active, true)\n      AND coalesce(a.allow_posting, true)\n  ) THEN\n    RAISE EXCEPTION \'VOUCHER_GL_ACCOUNT_INVALID: account is missing, inactive, non-postable or cross-org\';\n  END IF;\n\n  PERFORM public.assert_period_open(p_org, p_entry_date);\n\n  SELECT e.id INTO v_entry_id\n  FROM public.gl_entries e\n  WHERE e.org_id = p_org\n    AND e.idempotency_key = v_idempotency_key\n  FOR UPDATE;\n\n  IF v_entry_id IS NOT NULL THEN\n    IF NOT EXISTS (\n      SELECT 1 FROM public.gl_entries e\n      WHERE e.id = v_entry_id\n        AND e.status = \'posted\'\n        AND e.reference_type = p_reference_type\n        AND e.reference_id = p_reference_id\n        AND round(e.total_debit, 2) = round(p_amount, 2)\n        AND round(e.total_credit, 2) = round(p_amount, 2)\n    ) THEN\n      RAISE EXCEPTION \'VOUCHER_GL_IDEMPOTENCY_CONFLICT: existing entry does not match voucher\';\n    END IF;\n    RETURN v_entry_id;\n  END IF;\n\n  SELECT j.id INTO v_journal_id\n  FROM public.journals j\n  WHERE j.org_id = p_org AND coalesce(j.is_active, true)\n  ORDER BY\n    CASE WHEN j.journal_type IN (\'cash\',\'bank\',\'general\') THEN 0 ELSE 1 END,\n    j.created_at NULLS LAST,\n    j.id\n  LIMIT 1;\n\n  BEGIN\n    v_entry_number := public.generate_entry_number(v_journal_id);\n  EXCEPTION WHEN OTHERS THEN\n    BEGIN\n      v_entry_number := public.generate_entry_number(p_org, p_entry_date);\n    EXCEPTION WHEN OTHERS THEN\n      v_entry_number := \'PV-\' || to_char(p_entry_date, \'YYYYMMDD\') || \'-\' ||\n                        substr(replace(p_reference_id::text, \'-\', \'\'), 1, 12);\n    END;\n  END;\n\n  INSERT INTO public.gl_entries (\n    org_id, journal_id, entry_number, entry_date, entry_type,\n    reference_type, reference_id, reference_number,\n    description, description_ar, status,\n    total_debit, total_credit, posted_at, posted_by, created_by,\n    idempotency_key\n  ) VALUES (\n    p_org, v_journal_id, v_entry_number, p_entry_date, \'manual\',\n    p_reference_type, p_reference_id, p_reference_number,\n    p_description, p_description, \'draft\',\n    round(p_amount, 2), round(p_amount, 2), null, null, p_actor,\n    v_idempotency_key\n  )\n  RETURNING id INTO v_entry_id;\n\n  INSERT INTO public.gl_entry_lines (\n    org_id, tenant_id, entry_id, line_number, account_id,\n    debit, credit, currency_code, description, description_ar\n  ) VALUES\n    (p_org, p_org, v_entry_id, 1, p_debit_account_id,\n     round(p_amount, 2), 0, \'SAR\', p_description, p_description),\n    (p_org, p_org, v_entry_id, 2, p_credit_account_id,\n     0, round(p_amount, 2), \'SAR\', p_description, p_description);\n\n  UPDATE public.gl_entries\n  SET status = \'posted\',\n      posted_at = clock_timestamp(),\n      posted_by = p_actor\n  WHERE id = v_entry_id;\n\n  RETURN v_entry_id;\nEND\n$function$;\n\nREVOKE ALL ON FUNCTION public.wardah_create_posted_voucher_gl(\n  uuid,date,text,uuid,text,text,uuid,uuid,numeric,uuid\n) FROM PUBLIC, anon, authenticated, service_role;\n\nCREATE OR REPLACE FUNCTION public.rpc_post_customer_receipt_atomic(p_receipt_id uuid)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $function$\nDECLARE\n  v_actor uuid := auth.uid();\n  v_receipt public.customer_collections%ROWTYPE;\n  v_payment_account uuid;\n  v_ar_account uuid;\n  v_entry_id uuid;\n  v_alloc_total numeric;\n  v_line_count integer;\n  v_bad_count integer;\n  r record;\nBEGIN\n  IF v_actor IS NULL THEN\n    RAISE EXCEPTION \'AUTH_REQUIRED: authenticated user required\';\n  END IF;\n\n  SELECT * INTO v_receipt\n  FROM public.customer_collections\n  WHERE id = p_receipt_id\n  FOR UPDATE;\n\n  IF NOT FOUND THEN\n    RAISE EXCEPTION \'CUSTOMER_RECEIPT_NOT_FOUND\';\n  END IF;\n  IF NOT public.wardah_is_org_member(v_receipt.org_id) THEN\n    RAISE EXCEPTION \'CROSS_ORG_OR_MEMBERSHIP_REQUIRED\';\n  END IF;\n  IF v_receipt.status = \'posted\' THEN\n    IF v_receipt.gl_entry_id IS NULL THEN\n      RAISE EXCEPTION \'CUSTOMER_RECEIPT_POSTED_WITHOUT_GL\';\n    END IF;\n    RETURN jsonb_build_object(\n      \'success\', true, \'duplicate\', true,\n      \'receipt_id\', v_receipt.id, \'gl_entry_id\', v_receipt.gl_entry_id,\n      \'status\', v_receipt.status\n    );\n  END IF;\n  IF v_receipt.status <> \'draft\' THEN\n    RAISE EXCEPTION \'CUSTOMER_RECEIPT_NOT_DRAFT: status=%\', v_receipt.status;\n  END IF;\n\n  v_payment_account := v_receipt.payment_account_id;\n  IF v_payment_account IS NULL THEN\n    SELECT a.id INTO v_payment_account\n    FROM public.gl_accounts a\n    WHERE a.org_id = v_receipt.org_id\n      AND a.subtype = CASE WHEN v_receipt.payment_method = \'cash\' THEN \'CASH\' ELSE \'BANK\' END\n      AND coalesce(a.is_active, true)\n      AND coalesce(a.allow_posting, true)\n    ORDER BY a.code, a.id\n    LIMIT 1;\n  END IF;\n\n  SELECT a.id INTO v_ar_account\n  FROM public.gl_accounts a\n  WHERE a.org_id = v_receipt.org_id\n    AND a.subtype = \'ACCOUNTS_RECEIVABLE\'\n    AND coalesce(a.is_active, true)\n    AND coalesce(a.allow_posting, true)\n  ORDER BY a.code, a.id\n  LIMIT 1;\n\n  IF v_payment_account IS NULL OR v_ar_account IS NULL THEN\n    RAISE EXCEPTION \'CUSTOMER_RECEIPT_GL_ACCOUNTS_MISSING\';\n  END IF;\n\n  SELECT count(*),\n         coalesce(sum(l.allocated_amount), 0),\n         count(*) FILTER (WHERE coalesce(l.discount_amount,0) <> 0)\n  INTO v_line_count, v_alloc_total, v_bad_count\n  FROM public.customer_collection_lines l\n  WHERE l.collection_id = v_receipt.id;\n\n  IF v_line_count = 0 THEN\n    RAISE EXCEPTION \'CUSTOMER_RECEIPT_ALLOCATIONS_REQUIRED\';\n  END IF;\n  IF v_bad_count <> 0 THEN\n    RAISE EXCEPTION \'CUSTOMER_RECEIPT_DISCOUNT_UNMAPPED: discount posting requires a separate approved account mapping\';\n  END IF;\n  IF round(v_alloc_total, 2) <> round(v_receipt.amount, 2) THEN\n    RAISE EXCEPTION \'CUSTOMER_RECEIPT_ALLOCATION_MISMATCH: allocated=% receipt=%\',\n      v_alloc_total, v_receipt.amount;\n  END IF;\n\n  SELECT count(*) INTO v_bad_count\n  FROM public.customer_collection_lines l\n  LEFT JOIN public.sales_invoices i ON i.id = l.invoice_id\n  WHERE l.collection_id = v_receipt.id\n    AND (\n      l.invoice_id IS NULL OR i.id IS NULL\n      OR i.org_id <> v_receipt.org_id\n      OR i.customer_id <> v_receipt.customer_id\n      OR round(coalesce(i.paid_amount,0) + l.allocated_amount, 2) > round(i.total_amount, 2)\n    );\n  IF v_bad_count <> 0 THEN\n    RAISE EXCEPTION \'CUSTOMER_RECEIPT_INVALID_OR_OVER_ALLOCATED_INVOICE: bad_lines=%\', v_bad_count;\n  END IF;\n\n  FOR r IN\n    SELECT i.id\n    FROM public.customer_collection_lines l\n    JOIN public.sales_invoices i ON i.id = l.invoice_id\n    WHERE l.collection_id = v_receipt.id\n    ORDER BY i.id\n    FOR UPDATE OF i\n  LOOP\n    NULL;\n  END LOOP;\n\n  SELECT count(*) INTO v_bad_count\n  FROM public.customer_collection_lines l\n  JOIN public.sales_invoices i ON i.id = l.invoice_id\n  WHERE l.collection_id = v_receipt.id\n    AND round(coalesce(i.paid_amount,0) + l.allocated_amount, 2) > round(i.total_amount, 2);\n  IF v_bad_count <> 0 THEN\n    RAISE EXCEPTION \'CUSTOMER_RECEIPT_OVER_ALLOCATION_AFTER_LOCK\';\n  END IF;\n\n  v_entry_id := public.wardah_create_posted_voucher_gl(\n    v_receipt.org_id,\n    v_receipt.collection_date,\n    \'CUSTOMER_RECEIPT\',\n    v_receipt.id,\n    v_receipt.collection_number,\n    \'سند قبض \' || v_receipt.collection_number,\n    v_payment_account,\n    v_ar_account,\n    v_receipt.amount,\n    v_actor\n  );\n\n  UPDATE public.sales_invoices i\n  SET paid_amount = round(coalesce(i.paid_amount,0) + x.allocated_amount, 2),\n      payment_status = CASE\n        WHEN round(coalesce(i.paid_amount,0) + x.allocated_amount, 2) = round(i.total_amount, 2)\n          THEN \'paid\'\n        ELSE \'partially_paid\'\n      END,\n      updated_at = clock_timestamp()\n  FROM (\n    SELECT invoice_id, sum(allocated_amount) AS allocated_amount\n    FROM public.customer_collection_lines\n    WHERE collection_id = v_receipt.id\n    GROUP BY invoice_id\n  ) x\n  WHERE i.id = x.invoice_id;\n\n  UPDATE public.customer_collections\n  SET status = \'posted\',\n      gl_entry_id = v_entry_id,\n      posted_at = clock_timestamp(),\n      posted_by = v_actor,\n      updated_at = clock_timestamp()\n  WHERE id = v_receipt.id;\n\n  RETURN jsonb_build_object(\n    \'success\', true, \'duplicate\', false,\n    \'receipt_id\', v_receipt.id, \'gl_entry_id\', v_entry_id,\n    \'status\', \'posted\'\n  );\nEND\n$function$;\n\nCREATE OR REPLACE FUNCTION public.rpc_post_supplier_payment_atomic(p_payment_id uuid)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $function$\nDECLARE\n  v_actor uuid := auth.uid();\n  v_payment public.supplier_payments%ROWTYPE;\n  v_payment_account uuid;\n  v_ap_account uuid;\n  v_entry_id uuid;\n  v_alloc_total numeric;\n  v_line_count integer;\n  v_bad_count integer;\n  r record;\nBEGIN\n  IF v_actor IS NULL THEN\n    RAISE EXCEPTION \'AUTH_REQUIRED: authenticated user required\';\n  END IF;\n\n  SELECT * INTO v_payment\n  FROM public.supplier_payments\n  WHERE id = p_payment_id\n  FOR UPDATE;\n\n  IF NOT FOUND THEN\n    RAISE EXCEPTION \'SUPPLIER_PAYMENT_NOT_FOUND\';\n  END IF;\n  IF NOT public.wardah_is_org_member(v_payment.org_id) THEN\n    RAISE EXCEPTION \'CROSS_ORG_OR_MEMBERSHIP_REQUIRED\';\n  END IF;\n  IF v_payment.status = \'posted\' THEN\n    IF v_payment.gl_entry_id IS NULL THEN\n      RAISE EXCEPTION \'SUPPLIER_PAYMENT_POSTED_WITHOUT_GL\';\n    END IF;\n    RETURN jsonb_build_object(\n      \'success\', true, \'duplicate\', true,\n      \'payment_id\', v_payment.id, \'gl_entry_id\', v_payment.gl_entry_id,\n      \'status\', v_payment.status\n    );\n  END IF;\n  IF v_payment.status <> \'draft\' THEN\n    RAISE EXCEPTION \'SUPPLIER_PAYMENT_NOT_DRAFT: status=%\', v_payment.status;\n  END IF;\n\n  v_payment_account := v_payment.payment_account_id;\n  IF v_payment_account IS NULL THEN\n    SELECT a.id INTO v_payment_account\n    FROM public.gl_accounts a\n    WHERE a.org_id = v_payment.org_id\n      AND a.subtype = CASE WHEN v_payment.payment_method = \'cash\' THEN \'CASH\' ELSE \'BANK\' END\n      AND coalesce(a.is_active, true)\n      AND coalesce(a.allow_posting, true)\n    ORDER BY a.code, a.id\n    LIMIT 1;\n  END IF;\n\n  SELECT a.id INTO v_ap_account\n  FROM public.gl_accounts a\n  WHERE a.org_id = v_payment.org_id\n    AND a.subtype = \'ACCOUNTS_PAYABLE\'\n    AND coalesce(a.is_active, true)\n    AND coalesce(a.allow_posting, true)\n  ORDER BY a.code, a.id\n  LIMIT 1;\n\n  IF v_payment_account IS NULL OR v_ap_account IS NULL THEN\n    RAISE EXCEPTION \'SUPPLIER_PAYMENT_GL_ACCOUNTS_MISSING\';\n  END IF;\n\n  SELECT count(*),\n         coalesce(sum(l.allocated_amount), 0),\n         count(*) FILTER (WHERE coalesce(l.discount_amount,0) <> 0)\n  INTO v_line_count, v_alloc_total, v_bad_count\n  FROM public.supplier_payment_lines l\n  WHERE l.payment_id = v_payment.id;\n\n  IF v_line_count = 0 THEN\n    RAISE EXCEPTION \'SUPPLIER_PAYMENT_ALLOCATIONS_REQUIRED\';\n  END IF;\n  IF v_bad_count <> 0 THEN\n    RAISE EXCEPTION \'SUPPLIER_PAYMENT_DISCOUNT_UNMAPPED: discount posting requires a separate approved account mapping\';\n  END IF;\n  IF round(v_alloc_total, 2) <> round(v_payment.amount, 2) THEN\n    RAISE EXCEPTION \'SUPPLIER_PAYMENT_ALLOCATION_MISMATCH: allocated=% payment=%\',\n      v_alloc_total, v_payment.amount;\n  END IF;\n\n  SELECT count(*) INTO v_bad_count\n  FROM public.supplier_payment_lines l\n  LEFT JOIN public.supplier_invoices i ON i.id = l.invoice_id\n  WHERE l.payment_id = v_payment.id\n    AND (\n      l.invoice_id IS NULL OR i.id IS NULL\n      OR i.org_id <> v_payment.org_id\n      OR i.vendor_id <> v_payment.vendor_id\n      OR i.status NOT IN (\'approved\',\'partially_paid\',\'overdue\')\n      OR round(coalesce(i.paid_amount,0) + l.allocated_amount, 2) > round(i.total_amount, 2)\n    );\n  IF v_bad_count <> 0 THEN\n    RAISE EXCEPTION \'SUPPLIER_PAYMENT_INVALID_OR_OVER_ALLOCATED_INVOICE: bad_lines=%\', v_bad_count;\n  END IF;\n\n  FOR r IN\n    SELECT i.id\n    FROM public.supplier_payment_lines l\n    JOIN public.supplier_invoices i ON i.id = l.invoice_id\n    WHERE l.payment_id = v_payment.id\n    ORDER BY i.id\n    FOR UPDATE OF i\n  LOOP\n    NULL;\n  END LOOP;\n\n  SELECT count(*) INTO v_bad_count\n  FROM public.supplier_payment_lines l\n  JOIN public.supplier_invoices i ON i.id = l.invoice_id\n  WHERE l.payment_id = v_payment.id\n    AND round(coalesce(i.paid_amount,0) + l.allocated_amount, 2) > round(i.total_amount, 2);\n  IF v_bad_count <> 0 THEN\n    RAISE EXCEPTION \'SUPPLIER_PAYMENT_OVER_ALLOCATION_AFTER_LOCK\';\n  END IF;\n\n  v_entry_id := public.wardah_create_posted_voucher_gl(\n    v_payment.org_id,\n    v_payment.payment_date,\n    \'SUPPLIER_PAYMENT\',\n    v_payment.id,\n    v_payment.payment_number,\n    \'سند صرف \' || v_payment.payment_number,\n    v_ap_account,\n    v_payment_account,\n    v_payment.amount,\n    v_actor\n  );\n\n  UPDATE public.supplier_invoices i\n  SET paid_amount = round(coalesce(i.paid_amount,0) + x.allocated_amount, 2),\n      status = CASE\n        WHEN round(coalesce(i.paid_amount,0) + x.allocated_amount, 2) = round(i.total_amount, 2)\n          THEN \'paid\'\n        ELSE \'partially_paid\'\n      END,\n      updated_at = clock_timestamp()\n  FROM (\n    SELECT invoice_id, sum(allocated_amount) AS allocated_amount\n    FROM public.supplier_payment_lines\n    WHERE payment_id = v_payment.id\n    GROUP BY invoice_id\n  ) x\n  WHERE i.id = x.invoice_id;\n\n  UPDATE public.supplier_payments\n  SET status = \'posted\',\n      gl_entry_id = v_entry_id,\n      posted_at = clock_timestamp(),\n      posted_by = v_actor,\n      updated_at = clock_timestamp()\n  WHERE id = v_payment.id;\n\n  RETURN jsonb_build_object(\n    \'success\', true, \'duplicate\', false,\n    \'payment_id\', v_payment.id, \'gl_entry_id\', v_entry_id,\n    \'status\', \'posted\'\n  );\nEND\n$function$;\n\nREVOKE ALL ON FUNCTION public.rpc_post_customer_receipt_atomic(uuid) FROM PUBLIC, anon;\nREVOKE ALL ON FUNCTION public.rpc_post_supplier_payment_atomic(uuid) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.rpc_post_customer_receipt_atomic(uuid) TO authenticated, service_role;\nGRANT EXECUTE ON FUNCTION public.rpc_post_supplier_payment_atomic(uuid) TO authenticated, service_role;\n\nCOMMENT ON FUNCTION public.rpc_post_customer_receipt_atomic(uuid) IS\n  \'Migration 153: atomically posts a customer receipt, legal GL entry and invoice balances with membership/cross-org/idempotency guards.\';\nCOMMENT ON FUNCTION public.rpc_post_supplier_payment_atomic(uuid) IS\n  \'Migration 153: atomically posts a supplier payment, legal GL entry and invoice balances with membership/cross-org/idempotency guards.\';\n'
marker = """-- ---------------------------------------------------------------------
-- 8. Prove posted immutability is active again before commit
-- ---------------------------------------------------------------------"""
if "rpc_post_customer_receipt_atomic" not in text:
    if marker not in text:
        raise SystemExit("migration marker not found")
    text = text.replace(marker, atomic_sql + "\n" + marker.replace("-- 8.", "-- 10."), 1)
migration.write_text(text, encoding="utf-8")

fixture = ROOT / "scripts/ci/fresh-db/setup_153_pre_migration_fixture.sql"
text = fixture.read_text(encoding="utf-8")
fixture_sql = '-- Atomic payment-voucher fixtures (pre-153 schema).\nINSERT INTO auth.users (id, email) VALUES\n  (\'53000000-0000-0000-0000-000000000001\', \'finance-a@example.test\'),\n  (\'53000000-0000-0000-0000-000000000002\', \'finance-b@example.test\');\n\nINSERT INTO public.user_organizations\n  (id, user_id, org_id, role, is_active, is_org_admin)\nVALUES\n  (\'53010000-0000-0000-0000-000000000001\', \'53000000-0000-0000-0000-000000000001\',\n   \'53111111-1111-1111-1111-111111111111\', \'accountant\', true, false),\n  (\'53010000-0000-0000-0000-000000000002\', \'53000000-0000-0000-0000-000000000002\',\n   \'53222222-2222-2222-2222-222222222222\', \'accountant\', true, false);\n\nINSERT INTO public.gl_accounts\n  (id, org_id, code, name, name_en, name_ar, category, subtype, normal_balance,\n   allow_posting, is_active)\nVALUES\n  (\'53a00000-0000-0000-0000-000000000005\', \'53111111-1111-1111-1111-111111111111\',\n   \'110200\', \'Bank A\', \'Bank A\', \'بنك أ\', \'ASSET\', \'BANK\', \'DEBIT\', true, true),\n  (\'53a00000-0000-0000-0000-000000000006\', \'53111111-1111-1111-1111-111111111111\',\n   \'120100\', \'AR A\', \'AR A\', \'ذمم مدينة أ\', \'ASSET\', \'ACCOUNTS_RECEIVABLE\', \'DEBIT\', true, true),\n  (\'53a00000-0000-0000-0000-000000000007\', \'53111111-1111-1111-1111-111111111111\',\n   \'210100\', \'AP A\', \'AP A\', \'ذمم دائنة أ\', \'LIABILITY\', \'ACCOUNTS_PAYABLE\', \'CREDIT\', true, true),\n  (\'53a00000-0000-0000-0000-000000000008\', \'53222222-2222-2222-2222-222222222222\',\n   \'120100\', \'AR B\', \'AR B\', \'ذمم مدينة ب\', \'ASSET\', \'ACCOUNTS_RECEIVABLE\', \'DEBIT\', true, true),\n  (\'53a00000-0000-0000-0000-000000000009\', \'53222222-2222-2222-2222-222222222222\',\n   \'210100\', \'AP B\', \'AP B\', \'ذمم دائنة ب\', \'LIABILITY\', \'ACCOUNTS_PAYABLE\', \'CREDIT\', true, true);\n\nINSERT INTO public.journals\n  (id, org_id, code, name, name_ar, journal_type, sequence_prefix, is_active)\nVALUES\n  (\'53900000-0000-0000-0000-000000000001\', \'53111111-1111-1111-1111-111111111111\',\n   \'F153-PVA\', \'Voucher Journal A\', \'يومية السندات أ\', \'general\', \'PVA\', true),\n  (\'53900000-0000-0000-0000-000000000002\', \'53222222-2222-2222-2222-222222222222\',\n   \'F153-PVB\', \'Voucher Journal B\', \'يومية السندات ب\', \'general\', \'PVB\', true);\n\nINSERT INTO public.customers (id, org_id, code, name) VALUES\n  (\'53c00000-0000-0000-0000-000000000001\', \'53111111-1111-1111-1111-111111111111\', \'C-A\', \'Customer A\'),\n  (\'53c00000-0000-0000-0000-000000000002\', \'53222222-2222-2222-2222-222222222222\', \'C-B\', \'Customer B\');\n\nINSERT INTO public.vendors (id, org_id, code, name) VALUES\n  (\'53d00000-0000-0000-0000-000000000001\', \'53111111-1111-1111-1111-111111111111\', \'V-A\', \'Vendor A\'),\n  (\'53d00000-0000-0000-0000-000000000002\', \'53222222-2222-2222-2222-222222222222\', \'V-B\', \'Vendor B\');\n\nINSERT INTO public.sales_invoices\n  (id, org_id, invoice_number, customer_id, invoice_date, delivery_status,\n   payment_status, subtotal, discount_amount, tax_amount, total_amount, paid_amount, status)\nVALUES\n  (\'53f00000-0000-0000-0000-000000000001\', \'53111111-1111-1111-1111-111111111111\',\n   \'SI-A-1\', \'53c00000-0000-0000-0000-000000000001\', \'2026-07-30\', \'fully_delivered\',\n   \'unpaid\', 100, 0, 0, 100, 0, \'POSTED\'),\n  (\'53f00000-0000-0000-0000-000000000002\', \'53111111-1111-1111-1111-111111111111\',\n   \'SI-A-2\', \'53c00000-0000-0000-0000-000000000001\', \'2026-07-30\', \'fully_delivered\',\n   \'unpaid\', 100, 0, 0, 100, 0, \'POSTED\'),\n  (\'53f00000-0000-0000-0000-000000000003\', \'53222222-2222-2222-2222-222222222222\',\n   \'SI-B-1\', \'53c00000-0000-0000-0000-000000000002\', \'2026-07-30\', \'fully_delivered\',\n   \'unpaid\', 100, 0, 0, 100, 0, \'POSTED\');\n\nINSERT INTO public.supplier_invoices\n  (id, org_id, invoice_number, vendor_id, invoice_date,\n   subtotal, discount_amount, tax_amount, total_amount, paid_amount, status)\nVALUES\n  (\'53f10000-0000-0000-0000-000000000001\', \'53111111-1111-1111-1111-111111111111\',\n   \'PI-A-1\', \'53d00000-0000-0000-0000-000000000001\', \'2026-07-30\',\n   200, 0, 0, 200, 0, \'approved\'),\n  (\'53f10000-0000-0000-0000-000000000002\', \'53222222-2222-2222-2222-222222222222\',\n   \'PI-B-1\', \'53d00000-0000-0000-0000-000000000002\', \'2026-07-30\',\n   200, 0, 0, 200, 0, \'approved\');\n\nINSERT INTO public.customer_collections\n  (id, org_id, collection_number, customer_id, collection_date, amount,\n   payment_method, payment_account_id, status, created_by)\nVALUES\n  (\'53800000-0000-0000-0000-000000000001\', \'53111111-1111-1111-1111-111111111111\',\n   \'CR-ATOMIC-OK\', \'53c00000-0000-0000-0000-000000000001\', \'2026-07-30\', 100,\n   \'cash\', \'53a00000-0000-0000-0000-000000000001\', \'draft\',\n   \'53000000-0000-0000-0000-000000000001\'),\n  (\'53800000-0000-0000-0000-000000000002\', \'53111111-1111-1111-1111-111111111111\',\n   \'CR-ATOMIC-OVER\', \'53c00000-0000-0000-0000-000000000001\', \'2026-07-30\', 150,\n   \'cash\', \'53a00000-0000-0000-0000-000000000001\', \'draft\',\n   \'53000000-0000-0000-0000-000000000001\'),\n  (\'53800000-0000-0000-0000-000000000003\', \'53222222-2222-2222-2222-222222222222\',\n   \'CR-ATOMIC-B\', \'53c00000-0000-0000-0000-000000000002\', \'2026-07-30\', 100,\n   \'cash\', \'53a00000-0000-0000-0000-000000000003\', \'draft\',\n   \'53000000-0000-0000-0000-000000000002\');\n\nINSERT INTO public.customer_collection_lines\n  (collection_id, invoice_id, allocated_amount, discount_amount)\nVALUES\n  (\'53800000-0000-0000-0000-000000000001\', \'53f00000-0000-0000-0000-000000000001\', 100, 0),\n  (\'53800000-0000-0000-0000-000000000002\', \'53f00000-0000-0000-0000-000000000002\', 150, 0),\n  (\'53800000-0000-0000-0000-000000000003\', \'53f00000-0000-0000-0000-000000000003\', 100, 0);\n\nINSERT INTO public.supplier_payments\n  (id, org_id, payment_number, vendor_id, payment_date, amount,\n   payment_method, payment_account_id, status, created_by)\nVALUES\n  (\'53700000-0000-0000-0000-000000000001\', \'53111111-1111-1111-1111-111111111111\',\n   \'SP-ATOMIC-OK\', \'53d00000-0000-0000-0000-000000000001\', \'2026-07-30\', 200,\n   \'bank_transfer\', \'53a00000-0000-0000-0000-000000000005\', \'draft\',\n   \'53000000-0000-0000-0000-000000000001\');\n\nINSERT INTO public.supplier_payment_lines\n  (payment_id, invoice_id, allocated_amount, discount_amount)\nVALUES\n  (\'53700000-0000-0000-0000-000000000001\', \'53f10000-0000-0000-0000-000000000001\', 200, 0);\n'
final = "SELECT 'SETUP_153_PRE_MIGRATION_PASS' AS result;"
if "CR-ATOMIC-OK" not in text:
    if final not in text:
        raise SystemExit("fixture final marker not found")
    text = text.replace(final, fixture_sql + "\n" + final, 1)
fixture.write_text(text, encoding="utf-8")

acceptance = ROOT / "scripts/ci/fresh-db/acceptance_153_atomic_payment_vouchers.sql"
acceptance.write_text('\n\\set ON_ERROR_STOP on\n\nCREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)\nRETURNS void LANGUAGE plpgsql AS $$\nDECLARE v_succeeded boolean := false;\nBEGIN\n  BEGIN\n    EXECUTE p_sql;\n    v_succeeded := true;\n  EXCEPTION WHEN OTHERS THEN\n    IF SQLERRM NOT LIKE \'%\' || p_needle || \'%\' THEN\n      RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: expected [%], got [%]\', p_needle, SQLERRM;\n    END IF;\n  END;\n  IF v_succeeded THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: expected error [%], but call succeeded\', p_needle;\n  END IF;\nEND $$;\n\nDO $$\nBEGIN\n  IF has_function_privilege(\'anon\', \'public.rpc_post_customer_receipt_atomic(uuid)\', \'EXECUTE\')\n     OR has_function_privilege(\'anon\', \'public.rpc_post_supplier_payment_atomic(uuid)\', \'EXECUTE\') THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: anon can execute atomic voucher RPC\';\n  END IF;\n  IF NOT has_function_privilege(\'authenticated\', \'public.rpc_post_customer_receipt_atomic(uuid)\', \'EXECUTE\')\n     OR NOT has_function_privilege(\'authenticated\', \'public.rpc_post_supplier_payment_atomic(uuid)\', \'EXECUTE\') THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: authenticated lacks atomic voucher RPC\';\n  END IF;\n  IF has_function_privilege(\'authenticated\',\n       \'public.wardah_create_posted_voucher_gl(uuid,date,text,uuid,text,text,uuid,uuid,numeric,uuid)\',\n       \'EXECUTE\') THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: client can execute internal GL helper\';\n  END IF;\nEND $$;\n\nSET ROLE authenticated;\nSELECT set_config(\'request.jwt.claim.sub\', \'53000000-0000-0000-0000-000000000001\', true);\nSELECT set_config(\'request.jwt.claim.role\', \'authenticated\', true);\nSELECT set_config(\n  \'request.jwt.claims\',\n  \'{"sub":"53000000-0000-0000-0000-000000000001","role":"authenticated","org_id":"53111111-1111-1111-1111-111111111111"}\',\n  true\n);\n\nSELECT public.rpc_post_customer_receipt_atomic(\n  \'53800000-0000-0000-0000-000000000001\'\n);\n\nDO $$\nDECLARE\n  v_entry uuid;\n  v_count bigint;\n  v_paid numeric;\n  v_status text;\nBEGIN\n  SELECT gl_entry_id, status INTO v_entry, v_status\n  FROM public.customer_collections\n  WHERE id=\'53800000-0000-0000-0000-000000000001\';\n\n  IF v_entry IS NULL OR v_status <> \'posted\' THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: receipt not posted/linked\';\n  END IF;\n\n  SELECT paid_amount INTO v_paid\n  FROM public.sales_invoices\n  WHERE id=\'53f00000-0000-0000-0000-000000000001\';\n  IF v_paid <> 100 THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: sales invoice paid=%\', v_paid;\n  END IF;\n\n  SELECT count(*) INTO v_count\n  FROM public.gl_entries e\n  WHERE e.id=v_entry\n    AND e.status=\'posted\'\n    AND e.reference_type=\'CUSTOMER_RECEIPT\'\n    AND e.reference_id=\'53800000-0000-0000-0000-000000000001\'\n    AND e.total_debit=100 AND e.total_credit=100;\n  IF v_count <> 1 THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: receipt GL header invalid\';\n  END IF;\n\n  SELECT count(*) INTO v_count\n  FROM public.gl_entry_lines l\n  WHERE l.entry_id=v_entry\n    AND l.account_id IS NOT NULL\n    AND ((l.debit=100 AND l.credit=0) OR (l.debit=0 AND l.credit=100))\n    AND l.debit_amount=l.debit\n    AND l.credit_amount=l.credit;\n  IF v_count <> 2 THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: receipt GL lines invalid count=%\', v_count;\n  END IF;\nEND $$;\n\n-- Retry is idempotent: no second GL and no second invoice mutation.\nSELECT public.rpc_post_customer_receipt_atomic(\n  \'53800000-0000-0000-0000-000000000001\'\n);\n\nDO $$\nDECLARE v_count bigint; v_paid numeric;\nBEGIN\n  SELECT count(*) INTO v_count\n  FROM public.gl_entries\n  WHERE org_id=\'53111111-1111-1111-1111-111111111111\'\n    AND idempotency_key=\'CUSTOMER_RECEIPT:53800000-0000-0000-0000-000000000001\';\n  SELECT paid_amount INTO v_paid FROM public.sales_invoices\n  WHERE id=\'53f00000-0000-0000-0000-000000000001\';\n  IF v_count <> 1 OR v_paid <> 100 THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: receipt retry count=% paid=%\', v_count, v_paid;\n  END IF;\nEND $$;\n\nSELECT public.rpc_post_supplier_payment_atomic(\n  \'53700000-0000-0000-0000-000000000001\'\n);\n\nDO $$\nDECLARE\n  v_entry uuid;\n  v_count bigint;\n  v_paid numeric;\n  v_status text;\nBEGIN\n  SELECT gl_entry_id, status INTO v_entry, v_status\n  FROM public.supplier_payments\n  WHERE id=\'53700000-0000-0000-0000-000000000001\';\n  IF v_entry IS NULL OR v_status <> \'posted\' THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: supplier payment not posted/linked\';\n  END IF;\n\n  SELECT paid_amount, status INTO v_paid, v_status\n  FROM public.supplier_invoices\n  WHERE id=\'53f10000-0000-0000-0000-000000000001\';\n  IF v_paid <> 200 OR v_status <> \'paid\' THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: supplier invoice paid/status=%/%\', v_paid, v_status;\n  END IF;\n\n  SELECT count(*) INTO v_count\n  FROM public.gl_entries e\n  WHERE e.id=v_entry\n    AND e.status=\'posted\'\n    AND e.reference_type=\'SUPPLIER_PAYMENT\'\n    AND e.reference_id=\'53700000-0000-0000-0000-000000000001\'\n    AND e.total_debit=200 AND e.total_credit=200;\n  IF v_count <> 1 THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: supplier GL header invalid\';\n  END IF;\nEND $$;\n\n-- Over-allocation must roll back everything.\nSELECT pg_temp.expect_error(\n  $$SELECT public.rpc_post_customer_receipt_atomic(\n      \'53800000-0000-0000-0000-000000000002\')$$,\n  \'CUSTOMER_RECEIPT_INVALID_OR_OVER_ALLOCATED_INVOICE\'\n);\n\nDO $$\nDECLARE v_count bigint; v_paid numeric; v_status text; v_gl uuid;\nBEGIN\n  SELECT status, gl_entry_id INTO v_status, v_gl\n  FROM public.customer_collections\n  WHERE id=\'53800000-0000-0000-0000-000000000002\';\n  SELECT paid_amount INTO v_paid\n  FROM public.sales_invoices\n  WHERE id=\'53f00000-0000-0000-0000-000000000002\';\n  SELECT count(*) INTO v_count\n  FROM public.gl_entries\n  WHERE idempotency_key=\'CUSTOMER_RECEIPT:53800000-0000-0000-0000-000000000002\';\n  IF v_status <> \'draft\' OR v_gl IS NOT NULL OR v_paid <> 0 OR v_count <> 0 THEN\n    RAISE EXCEPTION \'ACCEPTANCE_153_VOUCHER_FAIL: rollback status=% gl=% paid=% entries=%\',\n      v_status, v_gl, v_paid, v_count;\n  END IF;\nEND $$;\n\n-- User A cannot post a voucher belonging to org B.\nSELECT pg_temp.expect_error(\n  $$SELECT public.rpc_post_customer_receipt_atomic(\n      \'53800000-0000-0000-0000-000000000003\')$$,\n  \'CROSS_ORG_OR_MEMBERSHIP_REQUIRED\'\n);\n\nRESET ROLE;\n\nSELECT \'ACCEPTANCE_153_ATOMIC_PAYMENT_VOUCHERS_PASS\' AS result;\n', encoding="utf-8")

gate = ROOT / "scripts/ci/fresh-db/run_financial_gl_153_gate.sh"
text = gate.read_text(encoding="utf-8")
needle = """psql -v ON_ERROR_STOP=1 -X -d "$MAIN_DB" \
  -f scripts/ci/fresh-db/acceptance_153_financial_gl_contract.sql
"""
addition = needle + """psql -v ON_ERROR_STOP=1 -X -d "$MAIN_DB" \
  -f scripts/ci/fresh-db/acceptance_153_atomic_payment_vouchers.sql
"""
if "acceptance_153_atomic_payment_vouchers.sql" not in text:
    if needle not in text:
        raise SystemExit("gate insertion point not found")
    text = text.replace(needle, addition, 1)
gate.write_text(text, encoding="utf-8")

service = ROOT / "src/services/payment-vouchers-service.ts"
text = service.read_text(encoding="utf-8")

text = re.sub(
    r"/\*\*\n \* Determine payment status based on amounts\n \*/.*?(?=/\*\*\n \* Post customer receipt)",
    "",
    text,
    flags=re.S,
)
receipt_replacement = r"""/**
 * Post customer receipt atomically in PostgreSQL.
 * Migration 153 owns voucher status, invoice balances and legal GL posting.
 */
export async function postCustomerReceipt(
  receiptId: string
): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const { data, error } = await supabase.rpc('rpc_post_customer_receipt_atomic', {
      p_receipt_id: receiptId
    })

    if (error) throw error
    if (!data?.success) {
      throw new Error('CUSTOMER_RECEIPT_ATOMIC_POST_FAILED')
    }

    return { success: true, data }
  } catch (error: any) {
    console.error('Error posting customer receipt:', error)
    return { success: false, error: error.message || error }
  }
}

"""
text, n = re.subn(
    r"/\*\*\n \* Post customer receipt \(إقرار سند القبض\)\n \*/.*?(?=/\*\*\n \* Get all customer receipts)",
    receipt_replacement,
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f"receipt posting replacement count={n}")

text = re.sub(
    r"/\*\*\n \* Update supplier invoice paid amounts\n \*/.*?(?=/\*\*\n \* Post supplier payment)",
    "",
    text,
    flags=re.S,
)
payment_replacement = r"""/**
 * Post supplier payment atomically in PostgreSQL.
 * Migration 153 owns voucher status, invoice balances and legal GL posting.
 */
export async function postSupplierPayment(
  paymentId: string
): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const { data, error } = await supabase.rpc('rpc_post_supplier_payment_atomic', {
      p_payment_id: paymentId
    })

    if (error) throw error
    if (!data?.success) {
      throw new Error('SUPPLIER_PAYMENT_ATOMIC_POST_FAILED')
    }

    return { success: true, data }
  } catch (error: any) {
    console.error('Error posting supplier payment:', error)
    return { success: false, error: error.message || error }
  }
}

"""
text, n = re.subn(
    r"/\*\*\n \* Post supplier payment \(إقرار سند الصرف\)\n \*/.*?(?=/\*\*\n \* Get all supplier payments)",
    payment_replacement,
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f"supplier posting replacement count={n}")

service.write_text(text, encoding="utf-8")

contract = ROOT / "src/services/payment-vouchers-legal-gl-contract.test.ts"
contract.write_text(r"""import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const servicePath = resolve(process.cwd(), 'src/services/payment-vouchers-service.ts')
const source = readFileSync(servicePath, 'utf8')

describe('payment voucher legal GL writer contract', () => {
  it('routes both posting operations through atomic database RPCs only', () => {
    expect(source.match(/rpc_post_customer_receipt_atomic/g)).toHaveLength(1)
    expect(source.match(/rpc_post_supplier_payment_atomic/g)).toHaveLength(1)
    expect(source).not.toContain('rpc_create_journal_entry')
    expect(source).not.toContain(".from('gl_entries')")
    expect(source).not.toContain(".from('gl_entry_lines')")
  })

  it('contains no client-side invoice or voucher posting mutations', () => {
    expect(source).not.toContain('updateInvoicePaidAmounts')
    expect(source).not.toContain('updateSupplierInvoicePaidAmounts')
    expect(source).not.toContain('updateReceiptStatus')
    expect(source).not.toContain('updatePaymentStatus')
    expect(source).not.toMatch(/\bdebit_amount\s*:/)
    expect(source).not.toMatch(/\bcredit_amount\s*:/)
  })

  it('uses stable voucher identifiers as the only RPC inputs', () => {
    expect(source).toContain("p_receipt_id: receiptId")
    expect(source).toContain("p_payment_id: paymentId")
  })
})
""", encoding="utf-8")

spec = ROOT / "docs/FINANCIAL_REPORTING_ENGINE_SPEC.md"
text = spec.read_text(encoding="utf-8")
text = text.replace("**الإصدار:** `1.3`", "**الإصدار:** `1.4`")
adr_marker = "## 4. عقد الحجر القابل للفرض"
adr = """### ADR-FR-008 — ترحيل سندات القبض والصرف الذرّي

بما أن Migration 153 لم تُطبق على Production، يُعدّل ملفها قبل التطبيق ليضم عقد الترحيل الذرّي للسندات بوصفه بوابة لازمة لاعتماد `debit/credit`:

- RPC واحدة لكل نوع سند تنفذ قفل السند، فحص العضوية والمؤسسة، فحص الحسابات والتخصيصات، إنشاء وترحيل GL القانوني، تحديث الفواتير وتحديث السند داخل معاملة PostgreSQL واحدة.
- يمنع أي تحديث مالي من المتصفح بعد إنشاء GL.
- إعادة المحاولة تعيد نفس `gl_entry_id` دون مضاعفة الرصيد أو القيد.
- الخصومات غير ذات الحساب المعتمد تُرفض fail-closed ولا تُسقط من القيد.
- helper إنشاء GL داخلية بلا EXECUTE للعميل؛ RPCs العامة فقط لـ`authenticated/service_role`.
- تطبيق 153 على Production يتطلب نافذة نشر منضبطة: نشر التطبيق fail-closed أولًا، ثم 153، ثم Pilot موثق.

لا يغير هذا التوسيع حجز Migration 154 أو قرارات الأكواد التاريخية السبعة.

"""
if "ADR-FR-008" not in text:
    text = text.replace(adr_marker, adr + adr_marker, 1)
text = text.replace(
    "| **PR-A1-DB** | Migration 153 وحدها | Fresh DB، preflight، parent-first concurrency، استعادة حماية posted، حفظ المجاميع |",
    "| **PR-A1-DB** | Migration 153: عقد GL القانوني + ترحيل السندات الذرّي | Fresh DB، preflight، concurrency، rollback/idempotency/cross-org، حفظ المجاميع |"
)
spec.write_text(text, encoding="utf-8")

runbook = ROOT / "docs/db/FINANCIAL_GL_153_RUNBOOK.md"
text = runbook.read_text(encoding="utf-8")
text = text.replace("**Contract:** `WRD-FIN-REP-SRS-001` v1.3", "**Contract:** `WRD-FIN-REP-SRS-001` v1.4")
text = text.replace(
    "- إعادة حماية أسطر القيود المرحّلة قبل إنهاء المعاملة.",
    "- إعادة حماية أسطر القيود المرحّلة قبل إنهاء المعاملة.\n"
    "- إضافة RPCs ذرّية لسندات القبض والصرف تربط السند والفواتير والقيد القانوني في معاملة واحدة."
)
text = text.replace("## 8. حاجز تطبيق Production المكتشف", "## 8. عقد السندات الذرّي وحاجز تطبيق Production")
text = text.replace(
    "- يجوز مراجعة ودمج **DB PR** بعد اخضرار بواباته.\n"
    "- **يُمنع تطبيق 153 على Production** قبل إصلاح هذا الكاتب إلى `account_id + debit/credit` ونشره والتحقق منه.\n"
    "- لا تُضعف 153 لتخمين المبالغ من legacy في كتابة جديدة.\n"
    "- إصلاح الكاتب يجب أن يكون متوافقًا مع قاعدة ما قبل 153؛ الأعمدة القانونية موجودة أصلًا، لذلك يمكن نشر الإصلاح أولًا دون اعتماد Schema جديدة.\n"
    "- بعد نشر الإصلاح، تُنفذ تجربة سند قبض وسند صرف وتُفحص السطور الناتجة قبل السماح بتطبيق 153.",
    "- خدمة السندات تستدعي فقط `rpc_post_customer_receipt_atomic` و`rpc_post_supplier_payment_atomic`.\n"
    "- RPCs تنفذ GL والفواتير وحالة السند في معاملة واحدة مع rollback كامل.\n"
    "- التطبيق يُنشر أولًا بصورة fail-closed؛ قبل وجود RPC يعرض فشلًا ولا ينفذ writer قديمًا.\n"
    "- بعد ذلك تُطبق 153 في نافذة نشر منضبطة، ثم يُنفذ Pilot لسند قبض وصرف وإعادة محاولة وفشل متعمد.\n"
    "- لا تُضعف 153 لتخمين المبالغ من legacy في كتابة جديدة."
)
text = text.replace(
    "- اختبار سلبي مستقل: mixed-source row يسقط Migration ويثبت rollback الكامل.",
    "- اختبار سلبي مستقل: mixed-source row يسقط Migration ويثبت rollback الكامل.\n"
    "- سند قبض وصرف ذرّيان، retry idempotent، over-allocation rollback، ورفض cross-org."
)
runbook.write_text(text, encoding="utf-8")
