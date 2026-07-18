# Wardah Process Costing — Project Manifest

**آخر تحديث موثق:** 2026-07-18  
**Repository:** `6thd/wardah-process-costing`  
**Supabase project:** `uutfztmqvajmsxnrqeiv`

## القاعدة الذهبية

لا تحذف جدولًا أو عمودًا أو migration أو Baseline أو بيانات تاريخية لمعالجة مشكلة. فضّل دائمًا:

- additive migrations.
- `CREATE OR REPLACE FUNCTION`.
- أعمدة nullable للمواءمة.
- RPC ذرية وFail-closed.
- عكس قانوني موثق بدل تعديل أو حذف التاريخ.

أي تغيير Production يمر عبر PR وCI وrunbook واختبارات قبل/بعد التطبيق.

## Stack

React 18 + TypeScript + Vite، shadcn/ui + Tailwind، Zustand + TanStack Query، Supabase/PostgreSQL 17، Vitest + Playwright، GitHub Actions، ونشر خارجي عبر Vercel/Netlify.

## افصل حالات قاعدة البيانات

1. **Repository latest migration:** أعلى ملف مرقم في `sql/migrations/`.
2. **Fresh DB:** Baseline + migrations الأحدث من cutoff.
3. **Production:** سجل `supabase_migrations.schema_migrations`.

عند بداية PR #32:

- Baseline: `000_schema_baseline_20260717.sql`, cutoff 121.
- Production: مطبقة حتى 121.
- Repository: يحتوي 122، وPR #32 يضيف 123–127.
- لا تعتبر أي migration مطبقة حيًا لمجرد نجاح Fresh DB.

الترتيب القانوني المقترح بعد الدمج:

```text
122 → 123 → 124 → 125 → 126 → 127
```

المراجع:

- `sql/migrations/STATUS_122_124.md` — اسم تاريخي، والمحتوى ممتد حتى 127.
- `docs/db/INTEGRITY_HARDENING_122_124_RUNBOOK.md`
- `docs/db/INTEGRITY_HARDENING_125_127_ADDENDUM.md`
- `docs/db/BASELINE_PRODUCTION_CUTOFF_POLICY.md`

## Baseline

`.github/workflows/generate-baseline.yml` يقرأ cutoff من Production ويطابق اسم migration بملف المستودع. لا يستخدم أعلى رقم ملف بوصفه cutoff. اللقطات الجديدة تحمل timestamp وتُضاف دون حذف القديمة.

## Generated Columns

المخطط يحتوي 22 عمودًا `GENERATED ALWAYS AS ... STORED` وقت Baseline 121، منها:

- `bins.projected_qty`
- `stage_wip_log.cost_total`
- `stock_ledger_entries.posting_datetime`
- `sales_invoices.balance`
- `supplier_invoices.balance`
- `sales_invoice_lines.line_total`
- `purchase_order_lines.line_total`

لا ترسل Generated Columns في `INSERT` أو `UPDATE`. لا تستخدم `SELECT *` ثم spread كاملًا لإعادة الإدخال.

## Inventory architecture

- `stock_ledger_entries`: سجل الحركة القانوني.
- `bins`: الرصيد والتقييم حسب المنتج والمخزن.
- `products.stock_quantity`: مجمع مرجعي مشتق من bins للمنتجات ذات bins.
- `gl_entries/gl_entry_lines`: الدفتر المحاسبي القانوني.
- `journal_entries/journal_lines`: تاريخي، لا تنشئ مسارًا جديدًا عليه.

الكتابة التشغيلية يجب أن تكون داخل RPC ذرية واحدة. لا تفصل SLE وbin وproduct وGL إلى طلبات مستقلة.

PR #32 يضيف أو يحسن:

- `rpc_create_stock_adjustment`
- `rpc_submit_stock_adjustment`
- `rpc_cancel_stock_adjustment`
- `rpc_manual_stock_movement`
- `rpc_consume_reserved_materials`
- helper داخلي `wardah_apply_stock_outgoing`

قيمة GL لتسوية المخزون تُشتق من `stock_ledger_entries.stock_value_difference` الفعلية، لا من تقدير الواجهة. الحسابات القانونية:

- زيادة: مدين مخزون، دائن مكسب/فائض.
- نقص: مدين مصروف/خسارة، دائن مخزون.

## Security model

- RLS على جداول المؤسسات.
- `wardah_assert_org_member` و`wardah_assert_org_admin` للحراسة.
- العضوية النشطة تعني `is_active IS TRUE`.
- دوال `SECURITY DEFINER` الجديدة تحتاج حارسًا معروفًا أو سحب EXECUTE من PUBLIC والعملاء.
- helpers الداخلية لا تُمنح لـ`anon` أو `authenticated`.

`scripts/ci/check_definer_guards.py` يفحص migrations الأحدث من cutoff بحثًا عن مرجع حارس معروف أو سحب PUBLIC. لا يثبت ترتيب أول statement أو صحة المنطق كاملة؛ المراجعة البشرية والاختبارات السلبية لازمة.

## i18n

البوابة الحاجزة تمنع نمط legacy:

```text
isRTL ? 'نص عربي' : 'English text'
```

الفحص الموسع للنصوص العربية المباشرة في JSX وattributes إعلامي وليس بوابة صفر شاملة بعد.

## CI gates

1. i18n legacy gate.
2. generated types presence.
3. TypeScript.
4. ESLint.
5. unit/integration tests.
6. pglast migration syntax.
7. migration numbering.
8. SECURITY DEFINER guard.
9. Fresh DB على PostgreSQL 17.
10. build.
11. SonarCloud Quality Gate عند توفر `SONAR_TOKEN`.

## E2E

Playwright يحتاج staging URL وحسابات اختبار منفصلة للأدوار والمؤسستين. لا تعتبر T4 مثبتة دون تشغيل فعلي وArtifact ناجح. لا تستخدم حسابات Production الحقيقية.

## Migration workflow

1. ابدأ من أحدث `main`.
2. أضف migration جديدة؛ لا تغيّر migration مطبقة حيًا.
3. حدث runbook/status.
4. شغّل CI وFresh DB.
5. راجع SQL أمنيًا ووظيفيًا.
6. ادمج PR.
7. طبّق على Production بالترتيب.
8. نفذ استعلامات التحقق.
9. حدّث Baseline بعد ظهور migration في سجل Production فقط.

## Secrets

- `SUPABASE_DB_URL`: baseline workflow فقط.
- `SONAR_TOKEN`: SonarCloud.
- E2E: staging URL وحسابات اختبار.

لا تطبع أو تحفظ كلمات المرور في الوثائق أو commits.
