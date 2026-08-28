# Wardah ERP — Architecture Index

**آخر تحديث:** 2026-08-27  
**الغرض:** فهرس معماري حي. لا تُستخدم نسب اكتمال أو خطط قديمة كبديل عن قراءة `main` الحالي وسجل التنفيذ.

## نقطة الاستئناف الحالية

- [`EXECUTION_LEDGER.md`](./EXECUTION_LEDGER.md) — المصدر الأول لمعرفة أين توقف العمل، وما الذي انتهى أو بقي جزئيًا أو يحتاج تدقيقًا.
- [`PRODUCT_SHAPE_ALIGNMENT_PLAN_20260826.md`](./PRODUCT_SHAPE_ALIGNMENT_PLAN_20260826.md) — خطة `ALIGN-P*` لمواءمة خريطة المنتج والتنقّل وهيكل المستودع.
- [`PRODUCT_ROUTE_PERMISSION_GAP_INVENTORY_20260827.md`](./PRODUCT_ROUTE_PERMISSION_GAP_INVENTORY_20260827.md) — snapshot تاريخي قبل `ALIGN-P1` مع توثيق نتيجة PR #193؛ ليس backlog حاليًا.

> لتجنب الالتباس لا تستخدم `P0/P1/P2/P3` وحدها.  
> `CORE-P*` = برنامج التحسينات الجوهرية التاريخي، `MFG-P*` = خارطة التصنيع المتقدمة، `ALIGN-P*` = مواءمة المنتج/المستودع.

## ADRs المقبولة الموجودة

| ID | القرار | الحالة |
|---|---|---|
| [`ADR-001`](./ADR-001-Clean-Architecture.md) | Clean Architecture | Accepted historically; نطاق التطبيق الحالي انتقائي ويُراجع عند إعادة تنظيم الخدمات |
| [`ADR-002`](./ADR-002-CQRS-Pattern.md) | CQRS Pattern | Accepted historically; لا يعني أن كل مجال يستخدم CQRS |
| [`ADR-003`](./ADR-003-Process-Costing-Implementation.md) | Process Costing: EUP / Scrap / FIFO | Accepted foundation; اكتمال محرك SQL لا يعني اكتمال ربط الواجهة الحية |

### قاعدة ترقيم ADRs الجديدة

لا يُحجز رقم ADR من قائمة backlog قديمة فقط. قبل إنشاء ADR جديد يجب فحص الملفات الموجودة واختيار الرقم التالي غير المستخدم في `docs/architecture/` ثم فتح PR مراجعة مستقل عند الحاجة. لهذا السبب لا تعتبر عبارة "ADR-004" في أي خطة مقترحة رقمًا محجوزًا تلقائيًا.

## التصنيع وتكلفة المراحل

- [`../features/manufacturing/ADVANCED_MANUFACTURING_ROADMAP.md`](../features/manufacturing/ADVANCED_MANUFACTURING_ROADMAP.md) — خارطة `MFG-P*`; حالتها التنفيذية الحالية تُقرأ من `EXECUTION_LEDGER.md`.
- [`PROCESS_COSTING_LIMITATIONS.md`](./PROCESS_COSTING_LIMITATIONS.md) — الحدود المعروفة.
- [`EUP_IMPLEMENTATION_SUMMARY.md`](./EUP_IMPLEMENTATION_SUMMARY.md) — سجل تطبيق EUP.
- [`FIFO_METHOD_SUMMARY.md`](./FIFO_METHOD_SUMMARY.md) — سجل FIFO.
- [`PROCESS_COSTING_COMPLETE_SUMMARY.md`](./PROCESS_COSTING_COMPLETE_SUMMARY.md) — ملخص تاريخي لطبقة المحرك؛ لا يُفسر على أنه اكتمال لمسار UI/GL الحالي.

## هيكل التطبيق والانتقال المعماري

- [`DOMAIN_IMPORTS_AUDIT.md`](./DOMAIN_IMPORTS_AUDIT.md) — تدقيق imports للطبقات.
- [`LEGACY_SERVICES_MIGRATION.md`](./LEGACY_SERVICES_MIGRATION.md) — سجل/خطة انتقال الخدمات القديمة.
- [`INVENTORY_VALUATION_REFACTORING.md`](./INVENTORY_VALUATION_REFACTORING.md) — توثيق إعادة هيكلة تقييم المخزون.

## مبادئ حاكمة للعمل الحالي

1. **DB-first للعقود الحساسة:** RPC/Schema/RLS قبل واجهة تعتمد عليها، مع Production apply/verify مستقل.
2. **PostgreSQL هو حد التفويض النهائي:** Product Catalog أو Sidebar يحددان الظهور وتجربة المستخدم، ولا يمنحان صلاحية أمنية.
3. **لا Big Bang:** التنظيم والنقل يتمان عبر PRs صغيرة، ولا يُخلط rename مع إعادة كتابة منطق.
4. **التاريخ لا يُحذف:** الوثائق القديمة تبقى مرجعًا تاريخيًا لكن تُوسم إذا أصبحت Superseded.
5. **الحالة التنفيذية المتغيرة في سجل واحد:** `EXECUTION_LEDGER.md` هو checkpoint الدائم؛ GitHub Issues/PRs توفر الدليل التفصيلي الحي.

## كيف تضيف قرارًا معماريًا جديدًا

أنشئ ADR عندما يكون القرار واسع الأثر أو يصعب عكسه، مثل سياسة Product Catalog/IA أو سياسة Stage→GL. يجب أن يحتوي على: السياق، القرار، البدائل، العواقب، الاختبارات/القبول، ومراجع التنفيذ. لا تُعدّل ADR تاريخيًا لإخفاء قرار سابق؛ عند الاستبدال أنشئ ADR جديدًا واربط القديم به.
