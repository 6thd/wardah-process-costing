# كتالوج السيناريوهات — مصنع البلاستيك الافتراضي

**النطاق:** Phase 1–3 · شركة واحدة (`Plastic Co.`) · 15 ممثلًا
**مبني على:** [`CATALOG_RPC_SURFACE.md`](./CATALOG_RPC_SURFACE.md) — لا يستدعي أي سيناريو دالة خارج الـ64

> **حاجز قبل التنفيذ:** الكتالوج يصف السيناريو المستهدف، لا يدّعي أنه قابل للتشغيل
> اليوم كاملًا. جرد PR #211 أثبت عطل `rpc_create_mo_with_reservation`، وMigration
> 186 المقترحة في PR-1R تعيد توجيهها إلى bins مع قفل واختبار سباق. يبقى
> `SC-DAY-01` و`SC-RACE-08` محجوبين حتى نجاح رأس PR ودمجه وتجهيز بيئة المختبر؛
> لا يُستخدم fallback تاريخي لتجاوز الحاجز.

---

## 1. صيغة تعريف السيناريو

```yaml
id: SC-XXX-NN
title: ...
class: DAY | RACE | CHAOS | CLOSE
transport: postgrest | psql | mixed
actors: [...]
preconditions: [...]         # حالة يجب أن تتحقق قبل البدء
steps: [...]                 # استدعاءات RPC بالترتيب أو بالتوازي
expected:
  successes: N               # عدد النجاحات المتوقّع بالضبط
  rejections: [...]          # الرفض المتوقّع برسالته المحددة
invariants: [INV-..., ...]   # الثوابت المقيَّمة بعده
evidence: [...]              # ما يُحفظ عند الفشل
```

**قاعدة:** `expected.rejections` تذكر **رسالة الخطأ المحددة**. سيناريو يقبل «أي
خطأ» لا يميّز الحارس السليم عن الجمود عن الانهيار.

---

## 2. طاقم الممثلين

15 ممثلًا يعكسون توزيع صلاحيات مؤسسة حقيقية. **ليسوا جميعًا مسؤولين** — للسبب
الموثق في [ADR-SIM-002 §3.1](./ADR-SIM-002-rpc-only-actor-surface.md): فرع
`is_org_admin` في `has_permission()` لا يقرأ مفتاح الصلاحية أصلًا، فطاقم كله
مسؤولون يختبر «لا صلاحيات».

| # | الممثل | نوع الدور | RPCs الأساسية | ملاحظة سلوكية |
|---|---|---|---|---|
| 1 | CFO | org admin | `rpc_set_period_status`, `rpc_post_supplier_payment` | المسؤول الوحيد مع #2 |
| 2 | Financial Controller | دور صريح بالمفتاحين الحسّاسين | `rpc_post_*`, `rpc_reverse_manual_journal_entry` | يملك `accounting.vouchers.unpost/cancel` بمنح صريح لا بتجاوز |
| 3 | GL Accountant | محدود | `rpc_create_manual_journal_entry`, `rpc_update_manual_journal_entry` | ينشئ ولا يرحّل |
| 4 | Cost Accountant | محدود | `rpc_cost_of_production_report`, `rpc_post_manual_work_center_oh` | يراجع قبل الاعتماد |
| 5 | AP Accountant | محدود | `rpc_list_supplier_invoice_candidates`, `rpc_create_matched_supplier_invoice` | يحتاج صلاحيتَي D4 معًا |
| 6 | AR Accountant | محدود | `rpc_create_customer_receipt` | |
| 7 | Purchasing Manager | محدود | `rpc_approve_purchase_order` | يعتمد ولا ينشئ |
| 8 | Buyer A | محدود | `rpc_create_uom_purchase_order`, `rpc_submit_purchase_order` | سريع، دفعات كبيرة |
| 9 | Buyer B | محدود | نفس الأعلى | بطيء، يترك مسودات معلّقة |
| 10 | Warehouse Manager | محدود | `rpc_create_stock_adjustment`, `rpc_submit_stock_adjustment` | |
| 11 | Storekeeper A | محدود | `rpc_post_goods_receipt`, `rpc_post_delivery_note` | يُدخل متأخرًا (دفعات مساء) |
| 12 | Storekeeper B | محدود | نفس الأعلى | يُدخل فوريًا — مصدر التزامن مع #11 |
| 13 | Production Planner | محدود | `rpc_create_mo_with_reservation` | محجوب للمواد غير الفارغة حتى PR-1R / `OQ-09` |
| 14 | Production Supervisor | محدود | `rpc_transition_mo_status`, `rpc_complete_manufacturing_order` | |
| 15 | Operator | ضيّق جدًا | `rpc_consume_reserved_materials_v2` | **يُتوقع رفضه** في عمليات خارج نطاقه |

**الممثل #15 ليس زينة:** وجود ممثل يُرفض بانتظام هو ما يثبت أن طبقة الصلاحيات
تعمل تحت الحمل. رفضه نتيجة ناجحة.

**قبل كل تشغيلة** تُلتقط `rpc_permission_snapshot(:org)` لكل ممثل وتُحفظ ضمن أدلة
التشغيلة. بدونها لا يمكن تفسير أي قبول أو رفض لاحقًا.

---

## 3. سيناريو اليوم التشغيلي — `SC-DAY-01`

**الصنف:** DAY · **الناقل:** `postgrest` · **التكرار:** يوم واحد لكل يوم محاكاة

**الحالة الحالية:** `BLOCKED` قبل Phase 1. Migration 186 المقترحة تزيل 42P01،
ومرفق بها Fresh DB acceptance للحجز القانوني ينتظر نتيجة CI على رأس PR-1R؛
ولا يُفتح السيناريو حتى ينجح الرأس ويُدمج وتُبنى بيئة المختبر على المخطط
المدموج (`OQ-09`).

```
┌── 08:00  فتح اليوم
│         Planner: rpc_create_mo_with_reservation  (2–5 أوامر)
│         Buyer A/B: rpc_list_uom_purchase_order_options → rpc_create_uom_purchase_order
│
├── 09:00  اعتماد المشتريات
│         Buyer: rpc_submit_purchase_order
│         Purchasing Manager: rpc_approve_purchase_order
│         ⚠ Buyer B يترك 20% من الأوامر بلا submit — مسودات معلّقة مقصودة
│
├── 10:00  الاستلام  ← نقطة تزامن مقصودة
│         Storekeeper A + B: rpc_post_goods_receipt  (متزامنان على نفس المخزن)
│         استلام جزئي في 30% من الحالات
│
├── 11:00  الصرف للإنتاج
│         Supervisor: rpc_transition_mo_status (confirmed → in_progress)
│         Operator: rpc_consume_reserved_materials_v2  (لكل مرحلة)
│           Mixing → Extrusion → Printing → Cutting → Packing
│
├── 14:00  الجودة والهالك
│         Supervisor: rpc_transition_mo_status (→ quality_check)
│         Warehouse Manager: rpc_create_stock_adjustment (هالك) → rpc_submit_stock_adjustment
│
├── 15:00  الإنتاج التام  ← نقطة تزامن مقصودة
│         Supervisor: rpc_complete_manufacturing_order
│         (أمران لنفس المنتج التام في نفس النافذة ⇒ سباق المتوسط المرجّح)
│
├── 16:00  التسليم
│         Storekeeper: rpc_post_delivery_note
│
├── 17:00  الفواتير والمدفوعات
│         AP: rpc_list_supplier_invoice_candidates → rpc_create_matched_supplier_invoice
│         AP: rpc_create_supplier_payment → Controller: rpc_post_supplier_payment
│         AR: rpc_create_customer_receipt → Controller: rpc_post_customer_receipt
│
└── 18:00  إقفال اليوم + تقييم الثوابت QUIET
          INV-INV-01/02/03/04/06/07 · INV-MFG-01/02/03 · INV-GL-02/04/07
```

**ثوابت `CONT` تُقيَّم دوريًا خلال اليوم** لا في نهايته فقط: `INV-GL-01`،
`INV-GL-06`، `INV-GL-08`، `INV-SEC-02`.

---

## 4. سيناريوهات السباق المصمَّم

كلها بناقل `psql` وفق نمط
[ADR-SIM-003 §2.2](./ADR-SIM-003-dual-transport-actors.md): قفل blocker، ثم
انتظار **مؤكَّد بالفحص** على `pg_stat_activity` لا بـ`sleep`، ثم تحرير، ثم تأكيد
ثلاثي. المرجع العملي القائم: `scripts/ci/fresh-db/acceptance_175_rbac_concurrency.sh`.

### SC-RACE-01 — استلامان متزامنان لنفس أمر الشراء
**لماذا:** Migration 177 عالجت تصادم مولّد أرقام سندات الاستلام الذي كشفه Pilot
إنتاجي بعد **أول استلام جزئي**. أخطر ما يمكن أن يرتدّ.

- صف الالتقاء: أمر الشراء / عدّاد ترقيم الاستلام
- الممثلان: Storekeeper A و B على نفس `purchase_order_id`
- المتوقع: نجاحان بأرقام **مختلفة**، أو نجاح واحد برفض واضح — **لا** تصادم رقم
- الثوابت: `INV-INV-01`, `INV-INV-03`, `INV-GL-02`, `INV-INV-05`

### SC-RACE-02 — إتمام أمرَي تصنيع لنفس المنتج التام
**لماذا:** `rpc_complete_manufacturing_order` تأخذ `FOR UPDATE` على صف المنتج ثم
تحسب `(qty × cost + wip) / (qty + done)`. سباق هنا يفسد متوسط التكلفة **بصمت** —
لا خطأ، لا استثناء، فقط رقم خاطئ يتسرب إلى كل تكلفة لاحقة.

- صف الالتقاء: `products` للمنتج التام
- المتوقع: نجاحان متسلسلان، والمتوسط النهائي يطابق الحساب التسلسلي بالضبط
- الثوابت: `INV-INV-04`, `INV-MFG-01`, `INV-MFG-02`, `INV-GL-07`
- **عالي القيمة:** يفشل صامتًا إن كسر، ويوجد له عمود مرجعي (`products.cost_price`)

### SC-RACE-03 — إتمام مزدوج لنفس أمر التصنيع
**لماذا:** الترحيل الداخلي يستخدم `MATERIAL_ISSUE:<mo_id>` و`FG_RECEIPT:<mo_id>`
كمفاتيح idempotency. اختبار مباشر لعقد 179.

- المتوقع: نجاح واحد، والثاني يعود بـ`already_done` **دون** قيد ثانٍ
- الثوابت: `INV-GL-07` (الأهم), `INV-GL-02`, `INV-MFG-01`

### SC-RACE-04 — استهلاك متزامن لنفس الحجز
- صف الالتقاء: صف الحجز / bin الصنف
- الممثلان: Operator × Operator على `rpc_consume_reserved_materials_v2`
- المتوقع: لا استهلاك يتجاوز المحجوز؛ لا كمية سالبة
- الثوابت: `INV-INV-02`, `INV-INV-03`, `INV-MFG-01`

### SC-RACE-05 — إغلاق فترة أثناء دفعة ترحيل
**لماذا:** `gl_entries_period_guard` هو trigger على مستوى الصف، ودفعة الترحيل
`rpc_batch_post_manual_journal_entries` تعالج مصفوفة معرّفات.

- الممثلان: CFO (`rpc_set_period_status`) × Controller (دفعة ترحيل)
- المتوقع: **إما** ترحيل الدفعة كاملة قبل الإغلاق **أو** رفضها كاملة — لا دفعة
  نصف مرحَّلة
- الثوابت: `INV-GL-09`, `INV-GL-02`, `INV-GL-05`
- 🎯 **الأهم:** الترحيل الجزئي للدفعة كسر ذرّية، وهو من أصعب ما يُكتشف يدويًا

### SC-RACE-06 — إزالة عضو أثناء عمله
**لماذا:** يقاطع RBAC بالعمليات التجارية — منطقة لم تُختبر مقاطعتها بعد.

- الممثلان: CFO (`rpc_remove_org_member`) × Operator (عملية جارية)
- المتوقع: العملية الجارية تكتمل أو تُرفض بحارس واضح — **لا** صف يتيم بلا عضوية
- الثوابت: `INV-SEC-01`, `INV-SEC-04`, `INV-LAB-03`

### SC-RACE-07 — تسوية مخزون أثناء استلام على نفس الـbin
- صف الالتقاء: `bins` لـ(صنف، مخزن)
- المتوقع: كلا الأثرين ينعكسان في تسلسل `stock_ledger_entries` بلا فجوة
- الثوابت: `INV-INV-01`, `INV-INV-03`, `INV-INV-06`, `INV-INV-05`

> **`SC-RACE-08`** (التوأم التاريخي مقابل العقد القانوني) معرَّف في §7، لأنه ينبثق
> مباشرةً من فجوة السطح التاريخي المكتشفة في اشتقاق المنح.

---

## 5. سيناريوهات الاضطراب (Chaos)

| ID | الاضطراب | ما يُختبر | الثوابت |
|---|---|---|---|
| SC-CHAOS-01 | قطع الاتصال بين استدعاءين لنفس المستخدم | لا حالة وسيطة عالقة؛ المعاملة إما تمت أو لا | `INV-GL-02`, `INV-INV-01` |
| SC-CHAOS-02 | مورد متأخر — أمر شراء بلا استلام لأسابيع | الأثر على `ordered_qty` و`projected_qty` | `INV-INV-02` |
| SC-CHAOS-03 | نفاد خام أثناء أمر تصنيع مفتوح | رفض الاستهلاك برسالة واضحة، لا كمية سالبة | `INV-INV-02`, `INV-MFG-03` |
| SC-CHAOS-04 | إعادة استدعاء بنفس الحمولة (شبكة تعيد الطلب) | الـidempotency تحت التكرار العادي لا السباق | `INV-GL-07` |
| SC-CHAOS-05 | ممثل يفقد دوره أثناء اليوم | الرفض يبدأ فورًا لا بعد انتهاء الجلسة | `INV-SEC-01` |
| SC-CHAOS-06 | تعطيل/تفعيل `uom_engine_enabled` أثناء التشغيل | مسار UoM لا يترك حالات نصفية | `INV-INV-01`, `INV-INV-03` |

---

## 6. سيناريو الإقفال — `SC-CLOSE-01`

يُشغَّل في نهاية كل شهر محاكاة (3 مرات خلال هدف الـ90 يومًا):

```
1. سكون كامل — لا ممثل نشط
2. تقييم كل ثوابت QUIET
3. Controller: مراجعة الأرصدة
4. CFO: rpc_set_period_status (الفترة → مغلقة)
5. تقييم كل ثوابت CLOSE:
     INV-GL-05  ميزان المراجعة يقفل
     INV-INV-05 الدفتر الفرعي يطابق العام
6. أرشفة تقرير الشهر ضمن أدلة التشغيلة
```

**شرط الاجتياز:** صفر فشل `S0`/`S1` في الأشهر الثلاثة. انظر
[`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md).

---

## 7. ما لا يغطيه هذا الكتالوج بعد

| الفجوة | السبب | مرجع |
|---|---|---|
| دورة المبيعات من أمر البيع | لا RPC ممنوحة لإنشاء أمر بيع أو فاتورة | `OQ-03` |
| تسجيل ساعات العمل المباشرة | لا عقد `rpc_` — لكن `start_operation`/`complete_operation` **ممنوحتان** للعميل وتكتبان `labor_time_tracking` | `OQ-08` |
| استهلاك المواد بالمسار التاريخي | `consume_materials_for_mo` و`backflush_materials` ممنوحتان خارج تسمية `rpc_` | `OQ-08` |
| إنشاء MO بمواد عبر العقد القانوني | Migration 186 المقترحة تصلحه؛ ما زال ينتظر مراجعة/دمج PR-1R وتجهيز بيئة المختبر | `OQ-09` / PR-1R |
| الصيانة والجودة كوحدتين | خارج نطاق Phase 1–3 | — |
| تعدّد الشركات المتوازي | Phase 7 غير محسوم | `OQ-07` |

الفجوة في الصفّين الأول والثاني **ليست انعدام وصول بل انعدام عقد قانوني**، وهذا
تشخيص مختلف يقود إلى قرار منتج مختلف. المحاكاة لا تلتف عليها باستدعاء الدالة
التاريخية (ADR-SIM-002 §2.3.1)؛ تسجّلها وتختبر الدالة التاريخية بوصفها **سطح
خطر** عبر `SC-RACE-08`.

### SC-RACE-08 — التوأم التاريخي مقابل العقد القانوني
**الصنف:** RACE/SEC · **الناقل:** `mixed`

`create_mo_with_reservation` ممنوحة لـ`authenticated` **إلى جانب**
`rpc_create_mo_with_reservation`. السيناريو ينشئ أمرَي تصنيع لنفس المواد، أحدهما
عبر العقد القانوني والآخر عبر التوأم التاريخي، بالتوازي على نفس الـbin.

**الحالة الحالية:** `BLOCKED`. المقارنة لا تكون ذات معنى ما دام العقد القانوني
نفسه يفشل على relation غائبة. يُفعّل السيناريو بعد PR-1R، ولا يُعاد تعريف نجاحه
إلى «الدالتان تفشلان» لأن ذلك أخضر كاذب.

- المتوقع: التوأم التاريخي **لا** ينتج حالة يرفضها العقد القانوني (لا حجز يتجاوز
  المتاح، لا تجاوز لحارس عضوية أو صلاحية)
- الثوابت: `INV-SEC-05`, `INV-INV-02`, `INV-INV-03`, `INV-MFG-01`
- 🎯 أي فرق سلوكي هنا هو ثغرة أمنية/تكاملية مباشرة، لا ملاحظة أسلوبية

هذه الفجوات **نتائج مطلوبة** من دراسة السطح، لا عوائق. كل واحدة تقول: هنا عملية
تجارية بلا عقد قانوني — وذلك بلاغ منتج قبل أن يكون قيد اختبار.
