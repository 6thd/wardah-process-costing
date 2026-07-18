# Wardah Process Costing — Project Manifest

**آخر تحديث موثق:** 2026-07-18  
**Repository:** `6thd/wardah-process-costing`  
**Supabase project:** `uutfztmqvajmsxnrqeiv`

## القاعدة الذهبية

لا تحذف جدولًا أو عمودًا أو migration أو Baseline أو بيانات تاريخية لمعالجة مشكلة. فضّل:

- additive migrations.
- `CREATE OR REPLACE FUNCTION`.
- أعمدة جديدة nullable عند الحاجة للمواءمة.
- RPC ذرية وFail-closed.
- عكس قانوني موثق بدل تعديل/حذف التاريخ.

أي تغيير Production يمر عبر PR وCI وrunbook واختبارات قبل/بعد التطبيق.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| UI | shadcn/ui, Tailwind CSS, RTL |
| Backend | Supabase, PostgreSQL 17, PostgREST, Auth, Storage |
| State | Zustand, TanStack Query |
| Forms | React Hook Form, Zod |
| Tests | Vitest + Playwright |
| CI | GitHub Actions |
| Deployment | Vercel/Netlify integrations outside the placeholder deploy job |

## حالة قاعدة البيانات

افصل دائمًا بين ثلاث حالات:

1. **Repository latest migration**: أعلى ملف مرقم في `sql/migrations/`.
2. **Fresh DB state**: Baseline + migrations الأحدث من cutoff.
3. **Production applied state**: سجل `supabase_migrations.schema_migrations`.

عند كتابة هذا الملف:

- Baseline الحالي: `000_schema_baseline_20260717.sql`, cutoff 121.
- Production كانت مطبقة حتى 121 عند بداية PR #32.
- Migration 122 موجودة في المستودع وتحتاج تطبيقًا قبل 123 و124.
- PR #32 يضيف 123 و124؛ لا تعتبرهما مطبقتين حيًا لمجرد وجودهما في GitHub.

مرجع التطبيق والتحقق:

- `docs/db/INTEGRITY_HARDENING_122_124_RUNBOOK.md`
- `docs/db/BASELINE_PRODUCTION_CUTOFF_POLICY.md`

## Baseline

`.github/workflows/generate-baseline.yml` يجب أن يقرأ cutoff من Production، ثم يطابق اسم migration بملف المستودع. لا تستخدم أعلى رقم ملف بوصفه cutoff.

اللقطات الجديدة تُضاف باسم timestamp ولا تستبدل اللقطات القديمة.

## PostgreSQL Generated Columns

المخطط يحتوي 22 عمودًا `GENERATED ALWAYS AS ... STORED` وقت Baseline 121، منها:

- `bins.projected_qty`
- `stage_wip_log.cost_total`
- `stock_ledger_entries.posting_datetime`
- `sales_invoices.balance`
- `supplier_invoices.balance`
- `sales_invoice_lines.line_total`
- `purchase_order_lines.line_total`

القاعدة: لا ترسل أي Generated Column في `INSERT` أو `UPDATE`. لا تستخدم `SELECT *` ثم spread كاملًا لإعادة الإدخال.

## Inventory architecture

- `stock_ledger_entries`: سجل الحركات القانوني.
- `bins`: الرصيد والتقييم حسب المنتج والمخزن.
- `products.stock_quantity`: مجمع مرجعي مشتق من bins للمنتجات ذات bins.
- `gl_entries/gl_entry_lines`: الدفتر المحاسبي القانوني.
- `journal_entries/journal_lines`: تاريخي؛ لا تنشئ مسارًا جديدًا عليه.

الكتابة التشغيلية يجب أن تكون داخل RPC ذرية واحدة. لا تفصل SLE وbin وproduct وGL إلى طلبات شبكة مستقلة.

PR #32 يضيف:

- `rpc_create_stock_adjustment`
- `rpc_submit_stock_adjustment`
- `rpc_cancel_stock_adjustment`
- `rpc_manual_stock_movement`
- `rpc_consume_reserved_materials`
- helper داخلي `wardah_apply_stock_outgoing`

## Security model

- RLS على جداول المؤسسات.
- `wardah_assert_org_member` و`wardah_assert_org_admin` للحراسة الداخلية.
- العضوية النشطة تعني `is_active IS TRUE`، لا `COALESCE(is_active, TRUE)`.
- دوال `SECURITY DEFINER` الجديدة تحتاج حارسًا معروفًا أو سحب EXECUTE من `PUBLIC` والعملاء.
- helpers الداخلية لا تُمنح لـ`anon` أو `authenticated`.

`scripts/ci/check_definer_guards.py` يفحص migrations الأحدث من Baseline cutoff بحثًا عن مرجع حارس معروف أو سحب PUBLIC. لا تدّع أنه يثبت ترتيب أول statement أو صحة المنطق كاملة؛ المراجعة البشرية والاختبارات السلبية لازمة.

## i18n

البوابة الحاجزة الحالية تمنع عودة نمط legacy:

```text
isRTL ? 'نص عربي' : 'English text'
```

الفحص الموسع للنصوص العربية المباشرة في JSX وattributes إعلامي حاليًا، وليس صفرًا مضمونًا ولا بوابة حاجزة بعد.

## CI gates

الـPR يجب أن يمر عبر:

1. i18n legacy gate.
2. generated types presence check.
3. TypeScript.
4. ESLint.
5. unit/integration tests.
6. PostgreSQL migration syntax via pglast.
7. migration numbering.
8. SECURITY DEFINER guard scan.
9. Fresh DB chain.
10. application build.
11. SonarCloud Quality Gate عند توفر `SONAR_TOKEN`.

Fresh DB يجب أن يستخدم PostgreSQL 17 لمطابقة Production.

## E2E

Playwright workflow يحتاج staging URL وحسابات اختبار منفصلة للأدوار والمؤسستين. لا تعتبر T4 مثبتة دون تشغيل فعلي وتقرير artifact ناجح. لا تستخدم حسابات Production الحقيقية.

## Migration workflow

1. ابدأ من أحدث `main`.
2. استخدم رقم migration التالي.
3. لا تعدّل migration مطبقة حيًا لتغيير السلوك؛ أضف migration جديدة.
4. حدّث runbook/manifest.
5. شغّل CI وFresh DB.
6. راجع SQL أمنيًا ووظيفيًا.
7. ادمج PR.
8. طبّق على Production بالترتيب.
9. نفذ استعلامات التحقق.
10. حدث Baseline فقط بعد ظهور migration في سجل Production.

## Secrets

- `SUPABASE_DB_URL`: baseline workflow فقط؛ يبقى في GitHub Actions Secrets.
- `SONAR_TOKEN`: SonarCloud.
- E2E: staging URL وحسابات الاختبار.

لا تطبع كلمات المرور أو تحفظها في الوثائق أو commits.

## ملفات مرجعية

- `.github/workflows/ci-cd.yml`
- `.github/workflows/generate-baseline.yml`
- `sql/migrations/MANIFEST.md`
- `sql/migrations/skipped_migration_numbers.yml`
- `sql/baseline/README.md`
- `docs/db/INTEGRITY_HARDENING_122_124_RUNBOOK.md`
- `docs/security/SECURITY_DEFINER_AUDIT.md`
