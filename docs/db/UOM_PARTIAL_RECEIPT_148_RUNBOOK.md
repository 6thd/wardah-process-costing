# Migration 148 — Runbook: الاستلام الجزئي على Snapshot أمر الشراء

**الحالة:** ✅ **مطبقة على Production** في 2026-07-25، نسخة السجل `20260725145856`،
ومسجّلة **مرة واحدة**.
**سجل Production:** ينتهي عند `148_uom_purchase_receipt_snapshots`.
**الاعتماد:** 147 (إنشاء أمر شراء ذرّي بوحدات القياس) و139 (تطبيع سطور المستندات).
**Baseline:** ما زال عند cutoff 121 وقت كتابة هذا السطر؛ تحديثه يتم عبر
`Generate Schema Baseline` وPR مستقل. راجع §6.

---

## 1. ما تعالجه هذه الـMigration

### 1.1 انقطاع مسار الاستلام

Migration 147 تُنشئ كل أمر شراء بحالة `draft`، والاستلام لا يقبل إلا
`approved` أو `partially_received`. لم يكن في النظام أي انتقال
حالة محروس: المسار الوحيد كان `updatePurchaseOrderStatus` وهو تحديث مباشر من
العميل بلا تحقق من العضوية ولا من صلاحية الاعتماد ولا من شرعية الانتقال، ولم
يكن مربوطًا بأي زر في الواجهة أصلًا. النتيجة: أمر شراء يُنشأ عبر مسار UoM
الجديد لا يمكن استلامه إطلاقًا.

تضيف 148 دالتين محروستين:

| الدالة | الحارس | الانتقال |
|---|---|---|
| `rpc_submit_purchase_order` | عضوية فعّالة | `draft → submitted` |
| `rpc_approve_purchase_order` | مدير المؤسسة | `draft │ submitted → approved` |

الاعتماد يفتح الأمر للاستلام، وبالتالي لأثر مخزوني ومحاسبي، لذلك حارسه
`wardah_assert_org_admin` لا العضوية وحدها.

**`submitted` ليست قابلة للاستلام.** الحالات المقبولة للاستلام وللظهور في قائمة
الأوامر القابلة للاستلام هي `approved` و`partially_received` فقط. لو قُبل
`submitted` لأمكن الالتفاف على بوابة الاعتماد نفسها: يكفي أن يرسل عضو الأمر ثم
يستلمه دون اعتماد مدير.

### 1.2 الكمية المرفوضة كانت تُغلق أمر الشراء

**هذا العيب موجود في Production منذ Migration 133 (والمسار الأقدم 89/94/95/96)،
ولا تُنشئه 148 بل ترثه عند استبدال الدالة.**

كان `received_quantity` يزداد لكل سطر مهما كانت حالة الجودة، بينما المخزون
والقيد المحاسبي ينفذان فقط عند `accepted`. ثم تُحدَّد حالة أمر الشراء من
`received_quantity` نفسها. النتيجة: أمر بـ100 وحدة استُلمت كلها مرفوضة يصبح
`fully_received` بمخزون صفر وGRNI صفر، ولا يمكن استلام البديل من المورد بسبب
`OVER_RECEIPT`.

**فحص أثر على Production بتاريخ 2026-07-24 (قراءة فقط):**

| الفحص | النتيجة |
|---|---|
| إجمالي سطور الاستلام | 6 |
| السطور المرتبطة بأمر شراء | 1 |
| سطور `rejected` مرتبطة بـPO | 0 |
| سطور `pending_inspection` مرتبطة بـPO | 0 |
| أوامر أُغلقت بكمية غير مقبولة | 0 |
| سطور PO غير أساسية بلا Snapshot | 0 |

لا توجد بيانات متضررة، لذلك الإصلاح **للأمام فقط** ولا يحتاج عكسًا قانونيًا ولا
تصحيح أرصدة تاريخية.

### 1.3 التدهور الصامت عند غياب Snapshot

كان المسار يحسب `COALESCE(NULLIF(conversion_factor_snapshot,0),1)`، أي يعامل
سطرًا بلا Snapshot كأن معامله 1. backfill في Migration 139 غطّى فقط الصفوف ذات
`uom_id IS NULL`، والقيد `purchase_order_lines_uom_snapshot_check` معرَّف
`NOT VALID` ويقبل `NULL`. فسطر بوحدة غير أساسية وSnapshot فارغ كان يُنتج كمية
وتكلفة أساس خاطئتين **دون أي خطأ**.

---

## 2. عقد الكميات الجديد

أعمدة إضافية nullable على `purchase_order_lines`:

| العمود | المعنى |
|---|---|
| `quantity` | المطلوب بوحدة الأساس (بلا تغيير) |
| `received_quantity` | المستلم ماديًا بوحدة الأساس، لكل حالات الجودة (بلا تغيير في المعنى) |
| `accepted_quantity` | المقبول جودةً — **هو ما يغلق التزام المورد** |
| `rejected_quantity` | المرفوض جودةً — يحرّر رصيد التعاقد للاستبدال |
| قيد الفحص | مشتق: `received - accepted - rejected`، ويظل محتجزًا للرصيد |

### حالات الجودة على سطر مرتبط بأمر شراء

| الحالة | المخزون وGRNI | رصيد التعاقد |
|---|---|---|
| `accepted` | يُرحَّل | يُستهلك، ويخضع لـ`OVER_RECEIPT` |
| `rejected` | لا شيء | يتحرّر، ويخضع لسقف مستقل هو `REJECTED_QUANTITY_EXCEEDS_OPEN_BALANCE` |
| `pending_inspection` | — | **مرفوض** بـ`PENDING_INSPECTION_REQUIRES_RESOLUTION_FLOW` |

**لماذا سقف مستقل للمرفوض؟** لأن المرفوض لا يستهلك الرصيد، فهو خارج تغطية
`OVER_RECEIPT` تمامًا. بدون سقفه الخاص يمكن تسجيل رفض كمية غير محدودة على أمر
منتهٍ، فينتفخ `received_quantity` بلا أي رابط بالمتعاقد عليه.

**لماذا مُنع `pending_inspection`؟** لا يوجد بعد مسار حسم ينقل الكمية المعلّقة
إلى مقبولة أو مرفوضة. قبولها يعني احتجاز رصيد التعاقد **إلى الأبد**: لا مخزون،
ولا GRNI، ولا إمكانية إغلاق الأمر ولا إعادة فتحه. الرفض عند المدخل أصح من إنشاء
حالة لا يمكن الخروج منها. تبقى الحالة مشروعة على استلام مباشر بلا أمر شراء، حيث
لا رصيد تعاقدي يُحتجز. ومع ذلك تُبقي حسابات الرصيد طرح `pending` في محلها كي
تُحتسب الصفوف الناتجة عن مسار حسم مستقبلي أو عن تعديل خارجي، بدل تجاهلها بصمت.

**الرصيد التعاقدي** `= quantity - accepted - pending`. حالة الأمر تُحدَّد من
`accepted_quantity` لا من `received_quantity`.

### Backfill

الصفوف القائمة تُعبَّأ بـ`accepted_quantity = received_quantity` و
`rejected_quantity = 0`. هذا **يحفظ التفسير الحالي للنظام حرفيًا** ولا يعيد
تفسير التاريخ: كل ما استُلم سابقًا كان يُعامل كمغلِق للتعاقد فعلًا. لا يتغيّر
أي رصيد ولا تنقلب حالة أي أمر بسبب هذه الـMigration.

قيد `purchase_order_lines_quality_quantity_check` يُضاف `NOT VALID` — يحرس
الكتابات الجديدة دون رفض أي صف تاريخي.

---

## 3. عقد Feature Flag

`uom_engine_enabled` يحكم **الإنشاء والواجهة فقط**:

- ✅ `rpc_create_uom_purchase_order` (147) — fail-closed على العلم.
- ✅ `rpc_list_uom_receivable_purchase_orders` (148) — fail-closed على العلم.
- ❌ `rpc_post_goods_receipt` — **لا يُطبّق العلم عمدًا**.

السبب: سطر أمر شراء يحمل Snapshot قانونيًا هو **واقعة محاسبية مخزَّنة**. ولأن
إطفاء علم الطرح لا يجوز أن يمنع استلام مستندات قائمة ولا أن يغيّر تفسيرها، فلا
يُطبَّق العلم على `rpc_post_goods_receipt`؛ **وجود Snapshot القانوني هو الذي
يحدد مسار المعالجة**. وأي مؤسسة العلم مطفأ لديها كانت ستفقد استلام كل أمر شراء
فورًا لو طُبِّق العلم على الاستلام.

> **تصحيح موثق (2026-07-25).** كانت النسخة الأولى من هذا المستند — ومعها وصف
> PR #49 ورسائل commits — تقول إن `uom_engine_enabled` **مطفأ في كل المؤسسات**.
> ذلك غير صحيح: العلم **مفعّل للمؤسسة DEFAULT بمرحلة pilot**. الخلاصة التصميمية
> لم تتغير، لكن الفرضية كانت ناقصة وترتب عليها خطر تسلسل موثق أدناه.

المُميِّز الصحيح هو **المستند لا المؤسسة**: وجود Snapshot يحدد المسار.

### وفي الواجهة كذلك

العلم يختار **أي نموذج** يُفتح، ولا يحجب الشاشة:

| العلم | نموذج الإنشاء | قائمة سندات الاستلام |
|---|---|---|
| مطفأ | `GoodsReceiptForm` التقليدي | ظاهرة |
| مفعّل (DEFAULT اليوم) | `UomGoodsReceiptForm` الجديد | ظاهرة |

هذا نفس نمط `LegacyPurchaseOrderForm` في PR #42. وقراءة العلم fail-closed: أثناء
التحميل أو عند فشل القراءة أو غياب المؤسسة يبقى المسار التقليدي هو العامل.

**والنموذج التقليدي يجب أن يطابق عقد الخادم.** كان يستعلم عن
`['confirmed','partially_received','draft']` ولا يطلب `approved` إطلاقًا، بينما
الخادم لا يقبل إلا `approved` و`partially_received`. فكانت النتيجة أن الأمر
المعتمد — الوحيد القانوني لأول استلام — لا يظهر، بينما تظهر أوامر `draft` و
`confirmed` وتفشل حتمًا عند الإرسال بـ`PO_NOT_RECEIVABLE`. الاستعلام الآن
`['approved','partially_received']` بالضبط.

**الخطأ الذي يجب تجنّبه:** ربط الشاشة كلها — أو نموذجها الوحيد — بـRPC مُقيَّدة
بالعلم. عند إطفاء العلم في أي مؤسسة يجب أن يبقى مسار الاستلام التقليدي عاملًا؛
وإلا تحوّل علم الطرح من أداة لاختيار المسار الجديد إلى مفتاح يعطّل الوظيفة
الأساسية بالكامل.

يحرس هذا العقدَ اختباران في بوابة CI المخصصة، ولا يغني أحدهما عن الآخر:

| الاختبار | ما يثبته | ما لا يثبته |
|---|---|---|
| `goods-receipt-rollout-gate.test.tsx` | **أي** نموذج يُفتح حسب العلم، وبقاء قائمة السندات | لا يشغّل النموذج — يستبدله بـmock |
| `goods-receipt-legacy-contract.test.tsx` | النموذج التقليدي **يعمل**: يطلب الحالات الصحيحة، ويعرض المعتمد، ويصل إلى `receiveGoods` بعقد وحدة الإدخال | — |

اختبار البوابة وحده كان أخضر رغم أن النموذج لا يعرض أي أمر معتمد، لأنه يستبدل
النموذج بالكامل. لذلك كان اختبار العقد الفعلي لازمًا.

### ⚠️ ترتيب النشر: `repository-first` للـMigration ثم `DB-first` للواجهة

**الدمج ينشر الواجهة تلقائيًا عبر Vercel/Netlify، بينما قاعدة البيانات لا تتغير
بالدمج.** فأي واجهة مدموجة تستدعي RPC أو Schema لم تُطبَّق بعد تكون معطّلة عند
كل مؤسسة تصل إليها.

وقد حدث ذلك فعلًا مع 148: بين دمج PR #49 وتطبيق الـmigration، كانت شاشة الاستلام
لدى المؤسسة ذات العلم المفعّل تستدعي `rpc_list_uom_receivable_purchase_orders`
غير الموجودة. أُغلقت الفجوة بالتطبيق السريع في اليوم نفسه.

**القاعدة شقّان، ولا يُفصل أحدهما عن الآخر:**

1. **`repository-first` للـMigration:** الملف يصل إلى `main` **قبل** تطبيقه على
   Production. سجل Production هو المرجع القانوني، لكن
   `Audit Production Migration Ledger` و`Generate Schema Baseline` يقرآن `main`
   ويطالبان بملف مطابق تمامًا لكل صف حي. فتطبيق SQL غير مدموجة يجعل Production
   متقدمًا على المستودع ويُفشل التدقيق طوال تلك النافذة؛ وإن تعذّر دمج الـPR
   لاحقًا يصبح التقدّم دائمًا بلا ملف يقابله.
2. **`DB-first` للواجهة:** لا تُدمج واجهة تعتمد على RPC أو Schema جديدة قبل
   تطبيق الـmigration على Production والتحقق منها.

**النتيجة العملية: الـmigration والواجهة التي تعتمد عليها لا يُدمجان في PR
واحد.** PR قاعدة بيانات مستقل يُدمج ويُطبَّق ويُتحقَّق منه، ثم PR الواجهة التابعة
له. هذا بالضبط ما لم يحدث في 148: الملف نفسه اتّبع `repository-first` (PR #49
دُمج ثم طُبِّق)، لكن الواجهة شُحنت في الدمج نفسه، فوُلدت نافذة الانقطاع أعلاه.
الفصل إلى PRين كان سيمنعها.

| الحالة | القرار |
|---|---|
| Migration بلا واجهة تابعة | **دمج DB PR → تطبيق → تحقق** |
| واجهة تعتمد على RPC أو Schema جديدة | **دمج DB PR مستقل → تطبيق وتحقق → دمج UI PR** |
| يتعذر تجهيز DB أولًا، والعلم مطفأ في كل المؤسسات | أبقِ UI PR غير مدموج، أو جمّد العلم واضمن تطبيق DB قبل تفعيله. **ولا تطبّق SQL غير موجودة في `main` في أي حال** |
| العلم مفعّل لأي مؤسسة | **يُمنع** دمج UI PR حتى اكتمال DB PR وتطبيقه |

**لماذا لا يكفي فحص العلم لقلب الترتيب؟** لأن حالة العلم ليست ثابتة بين الدمج
والتطبيق: قد يفعّله مسؤول آخر في تلك النافذة. فحص العلم يحدد **حجم الخطر
الفوري** ونطاق المؤسسات المتأثرة، لكنه لا يجعل نشر الواجهة قبل قاعدة البيانات
آمنًا. وإطفاء العلم إجراء احتواء مؤقت، لا بديل دائم عن هذا الترتيب.

```sql
-- لتحديد نطاق الخطر، لا لقلب الترتيب:
SELECT org_id, value FROM public.org_settings WHERE key = 'uom_engine_enabled';
```

---

## 4. عقد Payload للاستلام

| السطر | الحقول المطلوبة |
|---|---|
| مرتبط بـPO ومعامله ≠ 1 | `purchase_order_line_id` + `qty_entered` (+ `uom_id` و`unit_cost_entered` للتحقق) |
| مرتبط بـPO ومعامله = 1 | يقبل `received_quantity`/`unit_cost` التاريخيين |
| غير مرتبط بـPO | كما كان: `received_quantity` أو `qty_entered` مع `unit_cost` |

**سبب التشدد:** الواجهة قبل 148 كانت ترسل `received_quantity` و`unit_cost`
بقيم **وحدة الأساس** (`GoodsReceiptForm` كان يقرأ `line.quantity` و
`line.unit_price`)، بينما 133/148 تفسّرانهما كقيم **وحدة الإدخال** وتضربانهما
في المعامل. عند معامل 12 هذا انتفاخ 12 ضعفًا. القيمتان متطابقتان **فقط** عند
معامل 1، فحيثما اختلفتا يُرفض الطلب بـ`RECEIPT_SNAPSHOT_CONTRACT_REQUIRED` بدل
التخمين.

### أكواد الأخطاء الجديدة

| الكود | المعنى |
|---|---|
| `PO_LINE_SNAPSHOT_MISSING` | سطر بوحدة غير أساسية بلا Snapshot قانوني |
| `RECEIPT_SNAPSHOT_CONTRACT_REQUIRED` | حمولة ملتبسة على سطر بمعامل ≠ 1 |
| `RECEIPT_UOM_MISMATCH` | وحدة الحمولة تخالف Snapshot أمر الشراء |
| `RECEIPT_COST_MISMATCH` | تكلفة الحمولة تخالف Snapshot أمر الشراء |
| `PO_NOT_SUBMITTABLE` / `PO_NOT_APPROVABLE` | انتقال حالة غير قانوني |
| `PO_HAS_NO_LINES` | إرسال/اعتماد أمر بلا أسطر |
| `PENDING_INSPECTION_REQUIRES_RESOLUTION_FLOW` | حالة معلّقة على سطر مرتبط بأمر شراء |
| `REJECTED_QUANTITY_EXCEEDS_OPEN_BALANCE` | رفض كمية تتجاوز الرصيد المفتوح |

---

## 4b. ترتيب حسم إعادة المحاولة

`idempotency_key` يُحسم **قبل كل بوابة عمل**: قبل فحص المورد والمخزن وحالة أمر
الشراء والفترة المحاسبية.

السبب عملي وليس تجميليًا: الاستلام الذي يُغلق أمر الشراء ينقله إلى
`fully_received`. فلو جاء فحص الحالة أولًا، لفشلت إعادة المحاولة على **آخر
استلام في كل أمر** بـ`PO_NOT_RECEIVABLE` بدل إرجاع السند الأصلي — أي أن انقطاع
شبكة عند الاستلام الأخير يترك المستخدم عاجزًا عن تأكيد ما إذا كان الاستلام قد
سُجّل. ينطبق الأمر نفسه على إقفال الفترة المحاسبية واستنفاد رصيد السطر: كلها
حالات ينتجها الاستدعاء الأصلي بنفسه، فلا يجوز أن تحجب إعادة قراءته.

القفل الاستشاري `pg_advisory_xact_lock` يُؤخذ **قبل** فحص المفتاح كي ينتظر
الطلب المكرر المتزامن عنده ويجد الصف المثبَّت، بدل أن يتجاوز الفحص ويُنشئ سندًا
ثانيًا.

---

## 5. التحقق قبل الدمج

| البوابة | الحالة محليًا |
|---|---|
| pglast migration syntax | ✅ 185 ملفًا |
| migration numbering + governance | ✅ `repo_max=148` |
| SECURITY DEFINER guard | ✅ 27 migration بلا دالة غير محروسة |
| Fresh DB chain (baseline 121 → 148) | ✅ `PASS=27 FAIL=0` |
| Acceptance 148 | ✅ `ACCEPTANCE_148_PASS` |
| TypeScript | ✅ |
| Vitest | ✅ |

### ثلاثة ضوابط سالبة

اختبار القبول أُثبت أنه غير فارغ بإعادة العيوب عمدًا:

1. إعادة إغلاق الأمر على `received_quantity` ⇒ يفشل عند
   `expected PO status partially_received, got fully_received`.
2. إزالة حارس Snapshot ⇒ يفشل عند
   `expected [PO_LINE_SNAPSHOT_MISSING] ... but it succeeded`.
3. إعادة بوابة حالة أمر الشراء قبل حسم `idempotency_key` ⇒ يفشل عند
   `PO_NOT_RECEIVABLE: fully_received` في اختبار إعادة محاولة الاستلام المُغلِق.

---

## 6. التطبيق على Production

### ✅ سجل التطبيق — 2026-07-25

| البند | النتيجة |
|---|---|
| نسخة السجل | `20260725145856` |
| عدد مرات التسجيل | **1** |
| عمودا الجودة | أُضيفا، الافتراضي 0 |
| backfill | 8 سطور أوامر شراء · صفوف NULL بعده: **0** |
| مخالفات عقد الكميات · شذوذ backfill | **0 · 0** |
| `purchase_order_lines_quality_quantity_check` | موجود · `convalidated = false` (NOT VALID كما صُمم) |
| توزيع حالات أوامر الشراء | **لم يتغيّر** — 5 `draft` + 6 `fully_received` قبل وبعد، وبصمة متطابقة `e6728d40…` |
| الدوال الأربع | موجودة · `authenticated` ✅ / `anon` ❌ · `SECURITY DEFINER` |
| Smoke Test (قراءة فقط) | نُفّذ بهوية عضو نشط؛ أعاد مصفوفة صحيحة |
| Rollback | غير مطلوب |

لم تُنفَّذ عمليات إرسال أو اعتماد أو استلام تجريبية، تجنبًا لإنشاء مستندات
تجارية حقيقية في Production.

**فحص Supabase Advisors:** لا فشل متعلق بـ148. التحذيرات القائمة سابقة وخارج
النطاق (ترقية أمنية لـPostgreSQL، حماية كلمات المرور المسرّبة،
`uom_normalize_alias` بلا `search_path` — وهي من Migration 129 و`LANGUAGE sql`
غير `SECURITY DEFINER` فلا تصعيد صلاحيات، و`journal_entries`/`journal_lines`
بـRLS دون سياسات). تستحق PR أمنيًا مستقلًا.

### الترتيب المتبع (للمرجع مستقبلًا)

1. أخذ snapshot للقاعدة.
2. تشغيل استعلامات ما قبل التطبيق (القسم 7).
3. تطبيق `148_uom_purchase_receipt_snapshots` باسم يساوي stem الملف كاملًا.
4. تشغيل استعلامات ما بعد التطبيق.
5. التأكد من ظهور الاسم القانوني **مرة واحدة** في `supabase_migrations.schema_migrations`.
6. تحديث Baseline **فقط** بعد ظهور 148 في سجل Production، وعبر
   `Generate Schema Baseline` وPR مستقل.

العلم `uom_engine_enabled` يبقى على حاله؛ هذه الـMigration لا تفعّله ولا تتطلبه.

### حالة Baseline بعد التطبيق

الخطوة 6 **لم تكتمل بعد**: تشغيل `Generate Schema Baseline` في 2026-07-25 فشل عند
قراءة السجل الحي بـ`password authentication failed for user "postgres"` — أي أن
سرّ `SUPABASE_DB_URL` في GitHub Actions يحمل بيانات اعتماد قديمة أو ناقصة لاحقة
المشروع في اسم المستخدم. الـworkflow توقف قبل توليد أي شيء، فلم يُنشئ فرعًا ولا
PR ولا عدّل أي ملف، وأثره على Production صفر لأنه قراءة فقط.

**الأثر التشغيلي محدود:** Baseline يبقى عند cutoff 121، فتطبّق سلسلة Fresh DB في
CI 27 migration بعده بدل صفر — أبطأ لكنه صحيح ولا يمنع أي بوابة.

**الإصلاح:** تحديث سرّ `SUPABASE_DB_URL` من Supabase → Project Settings →
Database → Connection string، ثم إعادة تشغيل الـworkflow.

### ملاحظة تشغيلية للمستخدمين

بعد التطبيق، المؤسسة ذات العلم المفعّل ترى نموذج `UomGoodsReceiptForm` الذي يعرض
`approved` و`partially_received` فقط. وبما أن أوامر Production الحالية كلها
`draft` أو `fully_received`، فقائمة الأوامر القابلة للاستلام **فارغة** — وهذا
سلوك صحيح لا عطل.

لفتح أول استلام يجب اعتماد أحد أوامر المسودة عبر البوابة الجديدة:

```
تفاصيل أمر الشراء ← «إرسال للاعتماد» (عضو) ← «اعتماد الأمر» (مدير مؤسسة)
```

يُستحسن إبلاغ المستخدمين بهذا الانتقال قبل أن يُفسَّر خلوّ القائمة على أنه خلل.

---

## 7. استعلامات التحقق

### قبل التطبيق — يجب أن تكون النتيجة صفرًا

```sql
-- سطور PO بوحدة غير أساسية وبلا Snapshot قانوني: ستفشل بعد التطبيق
-- بـPO_LINE_SNAPSHOT_MISSING عند محاولة استلامها.
SELECT count(*) AS lines_missing_snapshot
FROM public.purchase_order_lines pol
JOIN public.products p ON p.id = pol.product_id AND p.org_id = pol.org_id
WHERE pol.uom_id IS DISTINCT FROM p.base_uom_id
  AND (pol.conversion_factor_snapshot IS NULL OR pol.conversion_factor_snapshot <= 0);

-- أوامر أُغلقت تاريخيًا بكمية غير مقبولة.
SELECT count(*) AS orders_closed_by_unaccepted
FROM public.purchase_orders po
WHERE po.status = 'fully_received'
  AND EXISTS (
    SELECT 1 FROM public.goods_receipt_lines grl
    JOIN public.goods_receipts gr ON gr.id = grl.goods_receipt_id
    WHERE gr.purchase_order_id = po.id
      AND grl.quality_status <> 'accepted'
  );
```

### بعد التطبيق

```sql
-- 1) الأعمدة والقيد موجودة.
SELECT count(*) FILTER (WHERE column_name = 'accepted_quantity') AS accepted_col,
       count(*) FILTER (WHERE column_name = 'rejected_quantity') AS rejected_col
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'purchase_order_lines';

SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = 'public.purchase_order_lines'::regclass
  AND conname = 'purchase_order_lines_quality_quantity_check';

-- 2) الـbackfill حفظ التفسير القائم: لا سطر مقبولُه أقل من مستلمه دون رفض.
SELECT count(*) AS backfill_anomalies
FROM public.purchase_order_lines
WHERE COALESCE(accepted_quantity,0) + COALESCE(rejected_quantity,0)
      <> COALESCE(received_quantity,0);
-- المتوقع: 0 مباشرة بعد التطبيق (كل مستلم صار مقبولًا).

-- 3) لم تنقلب حالة أي أمر بسبب التطبيق.
SELECT status, count(*) FROM public.purchase_orders GROUP BY status ORDER BY status;
-- قارن بلقطة ما قبل التطبيق: يجب أن تتطابق تمامًا.

-- 4) الدوال موجودة وعقد الصلاحيات سليم.
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'rpc_submit_purchase_order', 'rpc_approve_purchase_order',
    'rpc_list_uom_receivable_purchase_orders', 'rpc_post_goods_receipt')
ORDER BY p.proname;
-- المتوقع: auth_exec = true و anon_exec = false للأربع.

-- 5) السجل يحمل الاسم القانوني مرة واحدة.
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '148_uom_purchase_receipt_snapshots';
```

---

## 8. الرجوع

الـMigration لا تحذف شيئًا، فالرجوع لا يحتاج حذف أعمدة:

- لاستعادة السلوك السابق للدوال: أعد تطبيق تعريفات 133 و147 عبر
  `CREATE OR REPLACE` في migration جديدة لاحقة — **لا تعدّل 148 بعد تطبيقها**.
- الأعمدة `accepted_quantity` و`rejected_quantity` تبقى؛ وجودها غير ضار للمسار
  القديم لأنه لا يقرأها.
- القيد `NOT VALID` يمكن إسقاطه وحده إن لزم دون مساس بالبيانات.

---

## 9. خارج النطاق

- مسار حسم للكمية المعلّقة (`pending_inspection`) على أمر شراء.
- مسار إرجاع/مردود رسمي للكمية المرفوضة (Credit Note).
- فاتورة المورد والمطابقة الثلاثية — تتبعها Issue #46 وPR #47.
- المسار الاحتياطي القديم في `receiveGoods` (يعمل فقط عند غياب
  `rpc_post_goods_receipt`) لا يكتب الأعمدة الجديدة؛ وهو متسق ذاتيًا لأن غياب
  الدالة يعني غياب 148 كاملة.
