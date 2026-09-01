# جرد مستهلكي المخزون القديم — Round 3 Consumers

**التاريخ:** 2026-09-01
**قاعدة الجرد:** `main@3ff77ba4c0a21aa119e85eaf9c5a6a0c2c0c3fed`
**النطاق:** `stock_movements` و`stock_moves` و`avg_rate`
**نوع التغيير:** تحليل أثر واختبار snapshot فقط؛ لا تعديل سلوك، لا migration، ولا كتابة على Production.

## 1. النتيجة التنفيذية

لا تمثل الأسماء الثلاثة عقدًا واحدًا:

| الاسم | الحالة القانونية الحالية | الحكم |
|---|---|---|
| `stock_movements` | الجدول غير موجود في Production ولا في `database.generated.ts` | مرجع schema قديم في adapter غير موصول بالواجهة الحالية |
| `stock_moves` | الجدول غير موجود في Production ولا في `database.generated.ts` | مراجع مختلطة: كود قديم خامل، fallback تطويري، ودوال Production حية بعضها محمي وبعضها معطّل عند الاستدعاء |
| `bins.avg_rate` | العمود غير موجود؛ العمود القانوني هو `bins.valuation_rate` | drift حقيقي داخل `SupabaseInventoryRepository`، لكنه في مسار غير موصول بالواجهة الحالية |
| `simulate_cogs.avg_rate` | حقل إرجاع موجود في عقد الـRPC والأنواع المولدة | اسم صالح مستقل، وليس عمود `bins`؛ لا يُستبدل آليًا |

شاشة حركات المخزون الحالية ليست مستهلكًا لأي من الجدولين القديمين. بعد PR #210
تقرأ `stock_ledger_entries`، وهو سجل الحركة القانوني الموثق في `CLAUDE.md`.

## 2. إثبات المخطط الحي — قراءة فقط

نُفذ فحص catalog read-only على Production (`uutfztmqvajmsxnrqeiv`) في
2026-09-01، دون أي كتابة:

| الكائن | `to_regclass` / catalog | الأنواع المولدة |
|---|---|---|
| `public.stock_movements` | `NULL` | غير موجود |
| `public.stock_moves` | `NULL` | غير موجود |
| `public.stock_ledger_entries` | موجود | موجود |
| `public.bins` | موجود | موجود |

أعمدة `bins` الحية والمولدة تشمل `valuation_rate` ولا تشمل `avg_rate`. ويطابق ذلك
`src/types/database.generated.ts` وBaseline الحالي
`sql/baseline/000_schema_baseline_20260830_083021.sql`.

## 3. `stock_movements` — مستهلكان داخل adapter خامل

`src/infrastructure/repositories/SupabaseInventoryRepository.ts` يحتوي مسارين
مباشرين:

| المعرّف | المسار | النوع | النتيجة لو استُدعي |
|---|---|---|---|
| SMV-01 | `recordStockMovement()` | كتابة مباشرة | يفشل لأن relation غير موجودة |
| SMV-02 | `getStockMovements()` | قراءة مباشرة | يفشل لأن relation غير موجودة |

سلسلة الوصول هي `IInventoryRepository` ← `InventoryAppService` ←
`src/application/hooks/useInventory.ts`. لا يوجد import إنتاجي لهذه hooks خارج
barrel التطبيق، ولا يوجد feature أو route يستدعي عمليتي الحركة. لذلك العطب حقيقي
بنيويًا لكنه غير واقع في شاشة المستخدم الحالية.

الاختبارات الحالية في
`src/infrastructure/repositories/__tests__/SupabaseInventoryRepository.test.ts`
تستبدل Supabase كله بـmock، وتعيد صفوف `stock_movements` بالشكل الذي يتوقعه الكود،
ولا تؤكد اسم الجدول في الاستدعاء. خضرتها لا تثبت توافق المخطط.

المراجع داخل migrations المبكرة (`03` و`04`) تاريخية؛ فحص أجسام الدوال الحية لم
يجد دالة Production ما زالت تشير إلى `stock_movements`. وتصنيف RBAC الموجود يضع
الاسم أصلًا تحت Issue #148 بوصفه `stale_not_in_production`.

## 4. `stock_moves` — خريطة المستهلكين

### 4.1 كود العميل

| المعرّف | المستهلك | الوصول | قابلية الوصول الحالية | الحكم |
|---|---|---|---|---|
| SM-01 | `enhanced-sales-service.ts` / `recordSalesInventoryMovement()` | INSERT | داخل fallback تطويري فقط؛ Production يفشل مغلقًا قبل fallback إذا غاب `rpc_post_delivery_note` | غير مستخدم في Production، لكنه يخصم `products.stock_quantity` أولًا ثم يتسامح مع غياب سجل الحركة في التطوير |
| SM-02 | `js/modules/{inventory,purchasing,sales,processCosting}.js` | قراءات وكتابات مباشرة | `js/main.js` يستوردها، لكن `index.html` يشغّل `/src/main.tsx` ولا يحمّل `js/main.js` | stack قديم غير موصول بتطبيق Vite الحالي |
| SM-03 | `inventory-validator.ts` → `validate_stock_balance` | RPC قراءة | singleton مُصدّر بلا مستدعٍ إنتاجي في `src` | الـRPC نفسها حية لكنها معطلة بسبب الجدول الغائب؛ الخطأ يتحول إلى warning إن استُخدم validator |
| SM-04 | `createOrder.ts` → `rpc_create_mo_with_reservation` | RPC كتابة | شاشة التصنيع الحالية تنشئ MO بلا `materials`، فلا تدخل هذا الفرع | تمرير مواد غير فارغة يجعل الدالة الحية تقرأ الجدول الغائب وتفشل |
| SM-05 | `updateStatus.ts` → `rpc_complete_manufacturing_order` | RPC كتابة | مسار إنتاجي | جسم الدالة يتحقق من `to_regclass` قبل INSERT، فيتجاوز المرآة القديمة بأمان |

المفاتيح `inventory.stock_moves.*` في route/RBAC catalog أسماء صلاحيات، لا وصولًا
إلى جدول `stock_moves`. وهي تحمي حاليًا شاشات الحركة والتحويل القانونية؛ لا تُحذف
لمجرد غياب الجدول الذي يشبه اسمها.

### 4.2 دوال Production الحية

فحص `pg_proc` read-only أعاد سبع دوال تحمل مرجعًا مباشرًا أو غير مباشر:

| الدالة | الوصول إلى `stock_moves` | الحارس | الحكم الحالي |
|---|---|---|---|
| `calculate_material_variances` | SELECT ديناميكي | `to_regclass` | آمنة وظيفيًا: تعيد صفوفًا فارغة عند غياب الجدول |
| `rpc_complete_manufacturing_order` | INSERT | `to_regclass` | آمنة من 42P01: تتجاوز كتابة المرآة القديمة |
| `rpc_create_mo_with_reservation` | SELECT مباشر عند مواد غير فارغة | لا يوجد | معطلة لذلك الفرع؛ لا تُختبر بكتابة Production في هذا الجرد |
| `consume_materials_for_mo` | INSERT مباشر | لا يوجد | معطلة عند الاستدعاء؛ ما زالت ممنوحة لـ`authenticated` و`service_role` بعد 185 |
| `validate_stock_balance` | SELECT مباشر | لا يوجد | معطلة عند الاستدعاء؛ ممنوحة حاليًا لـ`PUBLIC`/`anon`/`authenticated` |
| `comprehensive_data_integrity_check` | يستدعي `validate_stock_balance` | لا يوجد حول الاستدعاء | يرث فشل الدالة السابقة؛ ممنوحة حاليًا لـ`PUBLIC`/`anon`/`authenticated` |
| `simulate_cogs` | لا يقرأ `stock_moves` | غير منطبق | ظهر في البحث بسبب حقل الإرجاع `avg_rate` فقط |

هذا PR لا يعيد كتابة هذه الدوال ولا يسحب منحًا. إغلاقها يحتاج DB PR مستقلًا مع
migration إضافية واختبارات قبول، ثم تطبيق Production منفصل وفق ترتيب النشر
الموثق.

## 5. `avg_rate` — فصل الخطأ عن العقد الصحيح

### 5.1 drift غير صالح

`SupabaseInventoryRepository` يستخدم `bins.avg_rate` في أربعة مواضع:

1. `updateBin()` يرسل UPDATE لعمود غير موجود.
2. `createBin()` يرسل INSERT لعمود غير موجود.
3. `getStockBalance()` يطلب العمود داخل select string.
4. `mapBin()` يقرأه من الصف الوهمي.

العمود القانوني هو `valuation_rate`. والاختبار الحالي يمرر `avg_rate` داخل mock،
فيعيد إنتاج توقع الكود لا شكل قاعدة البيانات.

هذا المسار غير موصول بواجهة حالية، لكن إصلاح الاسم وحده لا يكفي لاعتماد adapter:
نفسه يحتوي كتابة مباشرة للمخزون و`stock_movements` الغائبة و`stock_reservations`
المصنفة تاريخية. قرار follow-up يجب أن يكون إما تقاعد adapter كاملًا، أو إعادة
كتابته على العقود القانونية وRPCs الذرية؛ لا ترقيع `avg_rate` منفردًا.

### 5.2 عقد صالح يجب الحفاظ عليه

`simulate_cogs(uuid,numeric)` يعيد حقلًا محسوبًا اسمه `avg_rate`، والاسم موجود في
`database.generated.ts`. لا يوجد عمود بهذا الاسم في `bins`، ولا تعارض بين
الحالتين. المستهلك المعرّف هو
`SupabaseInventoryValuationRepository.simulateCOGS()` عبر RPC، لكن service/DI
الحاليين لا يملكان feature إنتاجيًا مستدعيًا. صفحة `ValuationTesting.tsx` مستبعدة
صراحةً من TypeScript وغير موصولة بأي route وتستورد module محذوفًا.

منح `simulate_cogs` الحالية تقع ضمن فجوة قراءة المخزون المتتبعة أصلًا في Issue
#173؛ هذا الجرد لا يكرر إصلاح RBAC داخل PR توثيقي.

أما `avgRate` في مقياس ساعات مراكز العمل واختبار حساب متوسط ledger فهو متغير
محلي غير متعلق بمخطط `bins`، ولذلك خارج نطاق الإصلاح.

## 6. القرار الناتج وترتيب المتابعة

1. **هذا PR:** يحفظ الجرد واختبار snapshot فقط، بلا تغيير سلوك.
2. **مزامنة AI Simulation Lab:** بعد دمج هذا الجرد، تُحدّث حالة Round 3 والكتالوجات
   اعتمادًا عليه بدل إعادة الاكتشاف.
3. **PR-1R / DB follow-up:** يحسم الدوال الحية التي تشير إلى `stock_moves` الغائب
   (إعادة توجيه إلى `stock_ledger_entries`/`bins` أو تقاعد وسحب المنح) في migration
   مستقلة مع Red/Green وFresh DB.
4. **Application follow-up مستقل:** تقاعد `SupabaseInventoryRepository` القديم أو
   مواءمته كاملةً؛ لا يخلط مع DB/security ولا مع UI cleanup.
5. **Issue #173:** يبقى مسار تشديد صلاحيات read RPCs، ومنها `simulate_cogs` و
   `validate_stock_balance` إن بقيت الأخيرة أصلًا.

## 7. حدود الإثبات

- جرد المستودع كامل، وفحص Production كان catalog read-only فقط.
- لم تُستدعَ أي دالة كتابة، ولم تُنشأ fixture أو حركة مخزون.
- لا يثبت غياب import داخل المستودع عدم وجود مستهلك خارجي غير محفوظ هنا.
- لا يُعد هذا المستند قرارًا بإحياء `stock_moves` أو `stock_movements`؛ المصدر
  القانوني الحالي يبقى `stock_ledger_entries` مع `bins`.
