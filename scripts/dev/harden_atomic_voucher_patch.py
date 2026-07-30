#!/usr/bin/env python3
from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]

service = root / 'src/services/payment-vouchers-service.ts'
text = service.read_text(encoding='utf-8')
text, n1 = re.subn(
    r"/\*\*\n \* Determine payment status based on amounts\n \*/.*?(?=/\*\*\n \* Post customer receipt)",
    "",
    text,
    count=1,
    flags=re.S,
)
text, n2 = re.subn(
    r"/\*\*\n \* Update supplier invoice paid amounts\n \*/.*?(?=/\*\*\n \* Post supplier payment)",
    "",
    text,
    count=1,
    flags=re.S,
)
if n1 != 1 or n2 != 1:
    raise SystemExit(f'service cleanup mismatch customer={n1} supplier={n2}')
service.write_text(text, encoding='utf-8')

migration = root / 'sql/migrations/153_financial_gl_legal_amount_contract.sql'
text = migration.read_text(encoding='utf-8')
old = """  SELECT e.id INTO v_entry_id
  FROM public.gl_entries e
  WHERE e.org_id = p_org AND e.idempotency_key = v_idempotency_key
  FOR UPDATE;
  IF v_entry_id IS NOT NULL THEN
    RETURN v_entry_id;
  END IF;
"""
new = """  PERFORM public.assert_period_open(p_org, coalesce(p_entry_date, current_date));

  SELECT e.id INTO v_entry_id
  FROM public.gl_entries e
  WHERE e.org_id = p_org AND e.idempotency_key = v_idempotency_key
  FOR UPDATE;
  IF v_entry_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.gl_entries e
      WHERE e.id = v_entry_id
        AND e.org_id = p_org
        AND e.status = 'posted'
        AND e.reference_type = p_reference_type
        AND e.reference_id = p_reference_id
        AND e.reference_number IS NOT DISTINCT FROM p_reference_number
        AND e.entry_date = coalesce(p_entry_date, current_date)
        AND round(e.total_debit, 2) = round(p_amount, 2)
        AND round(e.total_credit, 2) = round(p_amount, 2)
        AND (
          SELECT count(*)
          FROM public.gl_entry_lines l
          WHERE l.entry_id = e.id
            AND l.org_id = p_org
            AND (
              (l.account_id = p_debit_account_id AND round(l.debit,2) = round(p_amount,2) AND l.credit = 0)
              OR
              (l.account_id = p_credit_account_id AND l.debit = 0 AND round(l.credit,2) = round(p_amount,2))
            )
        ) = 2
    ) THEN
      RAISE EXCEPTION 'VOUCHER_GL_IDEMPOTENCY_CONFLICT: existing entry does not match voucher contract';
    END IF;
    RETURN v_entry_id;
  END IF;
"""
if old not in text:
    raise SystemExit('migration idempotency block not found')
text = text.replace(old, new, 1)
migration.write_text(text, encoding='utf-8')

contract = root / 'src/services/payment-vouchers-legal-gl-contract.test.ts'
text = contract.read_text(encoding='utf-8')
needle = """    expect(source).not.toContain(\".from('gl_entry_lines')\")
"""
addition = needle + """    expect(source).not.toContain('updateInvoicePaidAmounts')
    expect(source).not.toContain('updateSupplierInvoicePaidAmounts')
    expect(source).not.toContain('updateReceiptStatus')
    expect(source).not.toContain('updatePaymentStatus')
"""
if 'updateInvoicePaidAmounts' not in text:
    if needle not in text:
        raise SystemExit('contract insertion point not found')
    text = text.replace(needle, addition, 1)
contract.write_text(text, encoding='utf-8')
