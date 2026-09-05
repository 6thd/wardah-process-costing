# Wardah ERP — Architecture Index

**آخر تحديث:** 2026-09-05  
**الغرض:** فهرس معماري حي. لا تُستخدم نسب اكتمال أو خطط قديمة كبديل عن قراءة `main` الحالي وحالة Production المتحققة.

## نقطة الاستئناف الحالية

- [`CURRENT_STABILIZATION_20260905.md`](./CURRENT_STABILIZATION_20260905.md) — **نقطة الاستئناف الحالية** بعد PR #227 وbaseline cutoff 189، مع صف انتظار متسلسل لموجة Astra stabilization.
- [`ASTRA_ARCHITECTURE_RED_TEAM_AUDIT_20260905.md`](./ASTRA_ARCHITECTURE_RED_TEAM_AUDIT_20260905.md) — Astra Architecture Red-Team Audit #1؛ يثبت F1–F5 ومرساة المراجعة وحدود الثقة.
- [`ASTRA_REMEDIATION_TODO_20260905.md`](./ASTRA_REMEDIATION_TODO_20260905.md) — سجل Findings/Status/TODO ومعايير الإغلاق والربط بالـIssues.
- [`EXECUTION_LEDGER.md`](./EXECUTION_LEDGER.md) — سجل التنفيذ التاريخي؛ مرساته العليا ما زالت تعكس مرحلة أقدم من cutoff 189، لذلك يُقرأ للسياق ولا يتجاوز Current Stabilization checkpoint إلى أن تتم مصالحته في PR مستقل.
- [`PRODUCT_SHAPE_ALIGNMENT_PLAN_20260826.md`](./PRODUCT_SHAPE_ALIGNMENT_PLAN_20260826.md) — خطة `ALIGN-P*` لمواءمة خريطة المنتج والتنقّل وهيكل المستودع.
- [`PRODUCT_ROUTE_PERMISSION_GAP_INVENTORY_20260827.md`](./PRODUCT_ROUTE_PERMISSION_GAP_INVENTORY_20260827.md) — snapshot تاريخي قبل `ALIGN-P1` مع توثيق نتيجة PR #193؛ ليس backlog حاليًا.

> لتجنب الالتباس لا تستخدم `P0/P1/P2/P3` وحدها.  
> `CORE-P*` = برنامج التحسينات الجوهرية التاريخي، `MFG-P*` = خارطة التصنيع المتقدمة، `ALIGN-P*` = مواءمة المنتج/المستودع، و`ASTRA-*` = موجة remediation الناتجة من Audit #1.

## ADRs المقبولة الموجودة

| ID | القرار | الحالة |
|---|---|---|
| [`ADR-001`](./ADR-001-Clean-Architecture.md) | Clean Architecture | Accepted historically; نطاق التطبيق الحالي انتقائي ويُراجع عند إعادة تنظيم الخدمات |
| [`ADR-002`](./ADR-002-CQRS-Pattern.md) | CQRS Pattern | Accepted historically; لا يعني أن كل مجال يستخدم CQRS |
| [`ADR-003`](./ADR-003-Process-Costing-Implementation.md) | Process Costing: EUP / Scrap / FIFO | Accepted foundation; اكتمال محرك SQL لا يعني اكتمال ربط الواجهة الحية |

### قاعدة ترقيم ADRs الجديدة

لا يُحجز رقم ADR من قائمة backlog قديمة فقط. قبل إنشاء ADR جديد يجب فحص الملفات الموجودة واختيار الرقم التالي غير المستخدم في `docs/architecture/` ثم فتح PR مراجعة مستقل عند الحاجة. لهذا السبب لا تعتبر عبارة "ADR-004" في أي خطة مقترحة رقمًا محجوزًا تلقائيًا.

## التصنيع وتكلفة المراحل

- [`../features/manufacturing/ADVANCED_MANUFACTURING_ROADMAP.md`](../features/manufacturing/ADVANCED_MANUFACTURING_ROADMAP.md) — خارطة `MFG-P*`; حالتها التنفيذية الحالية تُقرأ من Current Stabilization checkpoint ثم من السجل التاريخي عند الحاجة.
- [`PROCESS_COSTING_LIMITATIONS.md`](./PROCESS_COSTING_LIMITATIONS.md) — الحدود المعروفة.
- [`EUP_IMPLEMENTATION_SUMMARY.md`](./EUP_IMPLEMENTATION_SUMMARY.md) — سجل تطبيق EUP.
- [`FIFO_METHOD_SUMMARY.md`](./FIFO_METHOD_SUMMARY.md) — سجل FIFO.
- [`PROCESS_COSTING_COMPLETE_SUMMARY.md`](./PROCESS_COSTING_COMPLETE_SUMMARY.md) — ملخص تاريخي لطبقة المحرك؛ لا يُفسر على أنه اكتمال لمسار UI/GL الحالي.
- [`ASTRA_ARCHITECTURE_RED_TEAM_AUDIT_20260905.md`](./ASTRA_ARCHITECTURE_RED_TEAM_AUDIT_20260905.md) — المرجع الحالي للمخاطر المتقاطعة بين manufacturing/inventory/costing/GL/tenant identity.

## هيكل التطبيق والانتقال المعماري

- [`DOMAIN_IMPORTS_AUDIT.md`](./DOMAIN_IMPORTS_AUDIT.md) — تدقيق imports للطبقات.
- [`LEGACY_SERVICES_MIGRATION.md`](./LEGACY_SERVICES_MIGRATION.md) — سجل/خطة انتقال الخدمات القديمة.
- [`INVENTORY_VALUATION_REFACTORING.md`](./INVENTORY_VALUATION_REFACTORING.md) — توثيق إعادة هيكلة تقييم المخزون.

## مبادئ حاكمة للعمل الحالي

1. **DB-first للعقود الحساسة:** RPC/Schema/RLS قبل واجهة تعتمد عليها، مع Production apply/verify مستقل.
2. **PostgreSQL هو حد التفويض النهائي:** Product Catalog أو Sidebar يحددان الظهور وتجربة المستخدم، ولا يمنحان صلاحية أمنية.
3. **لا Big Bang:** التنظيم والنقل يتمان عبر PRs صغيرة، ولا يُخلط rename مع إعادة كتابة منطق.
4. **التاريخ لا يُحذف:** الوثائق القديمة تبقى مرجعًا تاريخيًا لكن تُوسم إذا أصبحت Superseded/Historical.
5. **لا تُرفع الثقة بلا دليل:** `Strong evidence` في audit يحتاج RED/live proof قبل أن يصبح runtime defect مؤكدًا.
6. **العقود المتقاطعة Contract-first:** اكتمال التصنيع/WIP/FG/GL لا يُصلح بتعديل منفرد قبل اعتماد العقد الرقمي المتوقع.
7. **التنفيذ متسلسل أثناء الاستقرار:** PR تنفيذي واحد Active في موجة Astra؛ الباقي يبقى queued/parked.
8. **حالة Production مستقلة:** لا يُستدل عليها من merge أو baseline وحده؛ يلزم ledger/live verification منفصل عند الحاجة.

## كيف تضيف قرارًا معماريًا جديدًا

أنشئ ADR عندما يكون القرار واسع الأثر أو يصعب عكسه، مثل سياسة Product Catalog/IA أو سياسة Stage→GL أو عقد manufacturing completion إذا استقر كقرار معماري دائم. يجب أن يحتوي على: السياق، القرار، البدائل، العواقب، الاختبارات/القبول، ومراجع التنفيذ. لا تُعدّل ADR تاريخيًا لإخفاء قرار سابق؛ عند الاستبدال أنشئ ADR جديدًا واربط القديم به.