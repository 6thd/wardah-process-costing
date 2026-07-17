# -*- coding: utf-8 -*-
"""يبني ترتيب التطبيق القانوني من sql/migrations وفق قرارات MANIFEST.md.

الاستخدام:
  python3 build_apply_order.py <migrations_dir> [cutoff]

  cutoff (اختياري): رقم صحيح — يُخرج فقط migrations بأرقام **أكبر** من cutoff.
  يُستخدم مع baseline: بعد تطبيق baseline(cutoff=N)، نطبّق فقط N+1 فصاعداً.
  القيمة الافتراضية: -1 (بدون تصفية — كل الـmigrations).
"""
import os
import re
import sys

MIG    = sys.argv[1] if len(sys.argv) > 1 else 'sql/migrations'
CUTOFF = int(sys.argv[2]) if len(sys.argv) > 2 else -1

# النسخ غير القانونية حسب MANIFEST — تُتخطى
SKIP = {
    '12_simple_journals.sql',
    '14_backup_checklist.sql', '14_backup_checklist_auto_detect.sql',
    '15_process_costing_enhancement_no_migration.sql',
    '65_fix_stage_costs_complete.sql',
    'warehouse_accounting_integration.sql', 'warehouse_accounting_manual.sql',
    'warehouse_management_system.sql',
}

# غير المرقمة: تُطبَّق بعد 30 وقبل 50 حسب MANIFEST
# تُتخطى إن كان cutoff >= 30 (الـbaseline يشملها بالفعل)
UNNUMBERED_AFTER_30 = [
    'phase2_stock_ledger_system.sql', 'phase3_valuation_methods.sql',
    'migration_add_warehouse_to_goods_receipts.sql', 'fix_view_org_id_error.sql',
    'warehouse_accounting_fixed.sql', 'warehouse_management_system_fixed.sql',
]


def num_key(f):
    m = re.match(r'^(\d+)([a-z]?)_', f)
    return (int(m.group(1)), m.group(2), f) if m else None


files = [f for f in sorted(os.listdir(MIG)) if f.endswith('.sql')]

# تصفية: أرقام أكبر من CUTOFF فقط
numbered = sorted(
    (f for f in files
     if num_key(f) and f not in SKIP and num_key(f)[0] > CUTOFF),
    key=num_key,
)

# الـunnumbered: أُدرِجت بعد 30 — تُحذف إن كان CUTOFF >= 30
include_unnumbered = CUTOFF < 30

order = []
for i, f in enumerate(numbered):
    order.append(f)
    nxt = numbered[i + 1] if i + 1 < len(numbered) else None
    if include_unnumbered:
        n = num_key(f)[0]
        if n == 30 and (nxt is None or num_key(nxt)[0] > 30):
            # أضف فقط الـunnumbered الموجودة فعلياً في المجلد
            for uf in UNNUMBERED_AFTER_30:
                if os.path.isfile(os.path.join(MIG, uf)):
                    order.append(uf)

sys.stdout.write('\n'.join(order) + ('\n' if order else ''))
