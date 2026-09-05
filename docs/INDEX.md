# Wardah ERP — Documentation Index

**آخر تحديث:** 2026-09-05
**الحالة:** فهرس حي — الروابط أدناه تشير فقط إلى موارد موجودة في المستودع وقت التحديث.

> المرجع التشغيلي لقاعدة البيانات وCI هو [`CLAUDE.md`](../CLAUDE.md).  
> نقطة استئناف العمل بين الجولات هي [`architecture/EXECUTION_LEDGER.md`](./architecture/EXECUTION_LEDGER.md).

## ابدأ من هنا

- [`architecture/EXECUTION_LEDGER.md`](./architecture/EXECUTION_LEDGER.md) — ما انتهى، ما هو نشط، ما هو متوقف، والخطوة التالية. استخدم أسماء المراحل المقيّدة مثل `CORE-P*` و`MFG-P*` و`ALIGN-P*` بدل `P0/P1` المجردة.
- [`architecture/PRODUCT_SHAPE_ALIGNMENT_PLAN_20260826.md`](./architecture/PRODUCT_SHAPE_ALIGNMENT_PLAN_20260826.md) — خطة مواءمة خريطة المنتج والتنقّل والمستودع.
- [`architecture/PRODUCT_ROUTE_PERMISSION_GAP_INVENTORY_20260827.md`](./architecture/PRODUCT_ROUTE_PERMISSION_GAP_INVENTORY_20260827.md) — جرد تاريخي قبل `ALIGN-P1` مع نتيجة PR #193؛ لا يُعامل كقائمة عمل حالية.
- [`architecture/README.md`](./architecture/README.md) — ADRs والمرجع المعماري.
- [`ai-simulation-lab/README.md`](./ai-simulation-lab/README.md) — فهرس مختبر المحاكاة (Phase 0 مؤجلة حتى إغلاق Round 3).
- [`ai-simulation-lab/DOCS_REVIEW_20260903.md`](./ai-simulation-lab/DOCS_REVIEW_20260903.md) — مراجعة توثيق المختبر مقابل Baseline cutoff 186.
- [`ai-simulation-lab/DOCS_REVIEW_20260904.md`](./ai-simulation-lab/DOCS_REVIEW_20260904.md) — متابعة بعد تطبيق ونشر cutoff 187.
- [`ai-simulation-lab/DOCS_REVIEW_20260905.md`](./ai-simulation-lab/DOCS_REVIEW_20260905.md) — متابعة Migration 188 وBaseline cutoff 188 المنشور واعتماديات HR المفتوحة.

## قاعدة البيانات والحوكمة

- [`db/`](./db/) — Runbooks وسجلات التصميم والمطابقة بين المستودع وProduction.
- [`../CLAUDE.md`](../CLAUDE.md) — حوكمة migrations/CI وحالة التشغيل المرجعية.
- [`../sql/migrations/`](../sql/migrations/) — سلسلة migrations القانونية في المستودع.
- [`../sql/baseline/`](../sql/baseline/) — baseline المولّد والمراجع.

لا يُستدل على حالة Production من وجود migration في المستودع فقط؛ حالة Production تحتاج ledger/live verification منفصلًا.

## المحاسبة والتقارير المالية

- [`FINANCIAL_REPORTING_ENGINE_SPEC.md`](./FINANCIAL_REPORTING_ENGINE_SPEC.md) — مواصفات موجودة لمحرك التقارير المالية، لكن خط أساسها 152 قديم؛ حالتها `AUDIT_REQUIRED` في `EXECUTION_LEDGER.md` قبل أي تنفيذ جديد.
- [`db/SUPPLIER_INVOICE_ATOMIC_LIFECYCLE_PLAN.md`](./db/SUPPLIER_INVOICE_ATOMIC_LIFECYCLE_PLAN.md) — سجل تصميم وتنفيذ دورة فاتورة المورد الذرية.
- [`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md) — قائمة تحقق تشغيلية عامة؛ لا تحل محل runbook خاص بكل تغيير.

العمل المفتوح والتصحيحات الأمنية تُتبع في GitHub Issues وتُربط من `EXECUTION_LEDGER.md` بدل نسخ حالتها يدويًا هنا.

## التصنيع وتكلفة المراحل

- [`features/manufacturing/`](./features/manufacturing/) — التوثيق الحي لمجال التصنيع.
- [`features/manufacturing/ADVANCED_MANUFACTURING_ROADMAP.md`](./features/manufacturing/ADVANCED_MANUFACTURING_ROADMAP.md) — خارطة التصنيع المتقدمة (`MFG-P*`).
- [`architecture/PROCESS_COSTING_LIMITATIONS.md`](./architecture/PROCESS_COSTING_LIMITATIONS.md) — الحدود المعروفة لمحرك تكلفة المراحل.
- [`architecture/ADR-003-Process-Costing-Implementation.md`](./architecture/ADR-003-Process-Costing-Implementation.md) — قرار معمارية Process Costing.

## التحسينات التاريخية

- [`improvements/README.md`](./improvements/README.md) — برنامج التحسينات الجوهرية في يوليو 2026 (`CORE-P*`). يُستخدم كسجل تاريخي، بينما الحالة الحالية لكل بند تُراجع من `EXECUTION_LEDGER.md` والمستودع الحي.
- [`REPOSITORY_REORGANIZATION_PLAN.md`](./REPOSITORY_REORGANIZATION_PLAN.md) — خطة إعادة تنظيم تاريخية/مستبدلة؛ لا تُستخدم كصورة حالية للمستودع.
- [`archive/`](./archive/) — مواد تاريخية. ليست مصدر حقيقة حيًا ما لم يُشر إليها Runbook/ADR حالي صراحةً.

## الجودة والأمن والاختبارات

- [`quality/`](./quality/) — تقارير ومراجعات الجودة الموجودة في المستودع.
- [`security/`](./security/) — توثيق الأمن الموجود في المستودع.
- [`testing/`](./testing/) — توثيق الاختبارات الموجود في المستودع.

## النشر والبيئات

- [`deployment/`](./deployment/) — توثيق النشر الموجود حاليًا.
- يوجد PR توثيقي مستقل لتثبيت سياسة Production/Staging/Preview؛ حالته الحالية تُتابع من `EXECUTION_LEDGER.md` بدل افتراض اكتمالها من هذا الفهرس.

## قاعدة الحفاظ على صدق الفهرس

1. لا يُضاف رابط إلى ملف/مجلد مخطط له قبل وجوده فعليًا.
2. الموارد التاريخية تُعلَّم Historical/Superseded ولا تُقدَّم كمصدر حقيقة حي.
3. `docs/db` و`CLAUDE.md` يبقيان منفصلين عن خطط UI/تنظيم المستودع.
4. تغيّر حالة مشروع/PR/Issue لا يُنسخ هنا إلا إذا كان جزءًا من عقد توثيق دائم؛ الحالة التنفيذية المتغيرة مكانها `EXECUTION_LEDGER.md`.
5. عند إضافة مجال منتج جديد، يُحدّث هذا الفهرس بعد أن يصبح مساره/توثيقه موجودًا فعلًا.
