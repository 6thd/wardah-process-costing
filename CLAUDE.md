# Wardah Process Costing — Project Manifest

**آخر تحديث موثق:** 2026-07-19  
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

<!-- DATABASE_STATE_START -->
الحالة الحية الموثقة في 19 يوليو 2026:

- Baseline الحالي: `000_schema_baseline_20260717.sql`, cutoff 121.
- Production: مطبقة حتى 127 (`127_stock_adjustment_ledger_valued_posting`).
- Repository: يحتوي migrations القانونية حتى 127.
- Fresh DB: يطبق 122→127 بعد Baseline 121.
- تحديث Baseline إلى 127 يجب أن يتم عبر `Generate Schema Baseline`؛ الـworkflow يقرأ سجل Production، يرفض drift غير موثق، يعيد بناء PostgreSQL 17 نظيفًا، ثم يفتح PR ولا يكتب مباشرة إلى `main`.
- لا تعدّ أي migration مطبقة حيًا لمجرد نجاح Fresh DB؛ سجل Production هو المرجع.
<!-- DATABASE_STATE_END -->

استثناءات سجل Production التاريخية محفوظة دون تعديل في:
`sql/migrations/migration_ledger_exceptions.json`:

- 101 و102 طُبقتا مرتين بإصدارات زمنية محددة؛ أي تكرار إضافي يفشل التدقيق.
- سجل 121 يحمل الاسم التاريخي `fail_closed_tenant_isolation` ويطابق قانونيًا الملف `121_fail_closed_tenant_isolation.sql`.

المراجع:

- `sql/migrations/STATUS_122_124.md` — اسم تاريخي، والمحتوى ممتد حتى 127.
- `docs/db/INTEGRITY_HARDENING_122_124_RUNBOOK.md`
- `docs/db/INTEGRITY_HARDENING_125_127_ADDENDUM.md`
- `docs/db/BASELINE_PRODUCTION_CUTOFF_POLICY.md`

## Baseline

`.github/workflows/generate-baseline.yml` يقرأ سجل Production كاملًا ويمرره إلى `scripts/ci/validate_migration_ledger.py`. لا يستخدم أعلى رقم ملف بوصفه cutoff، ولا يعتمد مطابقة glob ملتبسة. اللقطات الجديدة تحمل timestamp وتُضاف دون حذف القديمة، وتصل إلى `main` عبر PR فقط بعد نجاح إعادة البناء النظيفة.

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

PR #32 أضاف أو حسّن:

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
- helpers الداخلية لا تُمنح لـ`anon` أو`authenticated`.

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
8. migration governance: أسماء قانونية + أرقام غير مكررة + استثناءات سجل حية دقيقة.
9. SECURITY DEFINER guard.
10. Fresh DB على PostgreSQL 17.
11. build.
12. SonarCloud Quality Gate عند توفر `SONAR_TOKEN`.

التدقيق الحي لسجل Production يعمل أسبوعيًا وبشكل يدوي عبر
`Audit Production Migration Ledger`، وهو قراءة فقط ويرفع Artifact لمدة 90 يومًا.

## E2E

Playwright يحتاج staging URL وحسابات اختبار منفصلة للأدوار والمؤسستين. لا تعتبر T4 مثبتة دون تشغيل فعلي وArtifact ناجح. لا تستخدم حسابات Production الحقيقية.

## Migration workflow

1. ابدأ من أحدث `main`.
2. اسم الملف إلزاميًا `NNN_snake_case.sql`، والاسم المرسل إلى `apply_migration` يساوي stem الملف كاملًا.
3. أضف migration جديدة؛ لا تغيّر migration مطبقة حيًا.
4. حدث runbook/status.
5. شغّل CI وFresh DB وMigration Governance.
6. راجع SQL أمنيًا ووظيفيًا.
7. ادمج PR.
8. طبّق على Production بالترتيب.
9. نفذ استعلامات التحقق وتأكد من ظهور الاسم القانوني مرة واحدة في السجل.
10. حدّث Baseline بعد ظهور migration في سجل Production فقط عبر workflow المخصص وPR مستقل.

لا تعدّل أو تحذف صفوف `supabase_migrations.schema_migrations` لتجميل التاريخ؛ وثّق الاستثناء بدقة واجعل الحارس يرفض أي انحراف جديد.

## Secrets

- `SUPABASE_DB_URL`: baseline workflow + تدقيق سجل Production للقراءة فقط.
- `SONAR_TOKEN`: SonarCloud.
- E2E: staging URL وحسابات اختبار.

لا تطبع أو تحفظ كلمات المرور في الوثائق أو commits.
