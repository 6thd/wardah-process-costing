# ملحق Runbook — Migrations 125–127

هذا الملحق يكمل `INTEGRITY_HARDENING_122_124_RUNBOOK.md` ولا يستبدله.

## Migration 125 — الحسابات القانونية للتسوية

أُضيف حقل nullable:

```text
stock_adjustments.inventory_account_id → gl_accounts(id)
```

مع إبقاء جميع الحقول التاريخية. الخريطة القانونية:

- زيادة المخزون: مدين مخزون، دائن مكسب/فائض.
- نقص المخزون: مدين مصروف/خسارة، دائن مخزون.

`canonical_gl_entry_id` و`canonical_reversal_gl_entry_id` يشيران إلى `gl_entries`، ولا تُجبر الحقول القديمة المرتبطة بـ`journal_entries` على حمل UUID من جدول آخر.

## Migration 126 — توقيت اختيار الحسابات ودلالة المخزن

- يسمح بإنشاء Draft دون حسابات، حفاظًا على دورة العمل الحالية.
- يظل الترحيل Fail-closed ولا يعمل دون الحسابات المطلوبة.
- لا يعامل `location_id` كـ`warehouse_id`.
- عند عدم تمرير مخزن لا يُخمن إلا إذا كان للمنتج bin واحد موجب داخل المؤسسة؛ وإلا يعيد `WAREHOUSE_REQUIRED_FOR_CONSUMPTION`.

## Migration 127 — التقييم من Ledger الفعلي

قيمة القيد لا تؤخذ من `value_difference` المرسلة من الواجهة عند الترحيل. بعد تطبيق حركات المخزون داخل المعاملة، تجمع الدالة:

```sql
SUM(stock_ledger_entries.stock_value_difference)
```

للتسوية نفسها، ثم تستخدم القيمة الفعلية في GL. هذا مهم لـFIFO/LIFO لأن تكلفة الصرف قد تختلف عن السعر الظاهر في النموذج.

كذلك ترفض الدالة وجود أكثر من سطر لنفس `(product_id, warehouse_id)` داخل التسوية، حتى يكون مسار الإلغاء والاستعادة محددًا وغير ملتبس.

## ترتيب التطبيق الكامل

```text
122 → 123 → 124 → 125 → 126 → 127
```

نفذ استعلامات التحقق بعد كل خطوة، ثم اختبارات transaction مع `ROLLBACK` قبل نشر الواجهة.

## تحقق القيد

بعد ترحيل تسوية اختبار داخل transaction:

```sql
SELECT sa.id,
       sa.total_value_difference,
       sum(sle.stock_value_difference) AS ledger_value,
       sa.canonical_gl_entry_id
FROM stock_adjustments sa
JOIN stock_ledger_entries sle
  ON sle.voucher_type = 'Stock Adjustment'
 AND sle.voucher_id = sa.id
WHERE sa.id = :adjustment_id
  AND NOT COALESCE(sle.is_cancelled, false)
GROUP BY sa.id;
```

المعيار: `total_value_difference = ledger_value`.

```sql
SELECT e.id, e.total_debit, e.total_credit,
       sum(l.debit) AS lines_debit,
       sum(l.credit) AS lines_credit
FROM gl_entries e
JOIN gl_entry_lines l ON l.entry_id = e.id
WHERE e.id = :canonical_gl_entry_id
GROUP BY e.id;
```

المعيار: الرأس والسطور متوازنة والقيمة تساوي القيمة المطلقة لحركة Ledger.

## الإلغاء

الإلغاء يرفض التنفيذ عند وجود حركة نشطة أحدث لنفس المنتج والمخزن. هذا السلوك مقصود؛ يمنع استعادة snapshot قديمة فوق معاملات لاحقة.

لا تتجاوز هذا الحارس بتعديل مباشر. عند وجود حركات لاحقة استخدم سند تسوية جديدًا أو إجراء عكس متخصص يراعي طبقات التقييم.
