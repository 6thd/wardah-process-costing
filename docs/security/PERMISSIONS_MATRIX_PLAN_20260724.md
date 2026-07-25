# خطة نظام الصلاحيات الدقيق (Module × Sub-service × Action) — v2

> **بسم الله الرحمن الرحيم**
>
> **الإصدار:** v2 (موحّدة) — 2026-07-25
> **الحالة:** خطة — لم يُنفَّذ منها شيء بعد.
> **المصدر:** دمج الخطة الأصلية (`e1e948b`, 2026-07-24) مع المراجعة التنفيذية
> (`5b89a3e`, `PERMISSIONS_MATRIX_PLAN_REVIEW_20260725.md`) بعد التحقق المستقل من كل بند.
> **نطاق الفحص:** قراءة فقط — لم يُعدَّل أي ملف مصدري ولا أي كائن في قاعدة البيانات.
> **قاعدة البيانات:** المشروع الحي `uutfztmqvajmsxnrqeiv`.

## سجل الإصدارات

| الإصدار | التاريخ | التغيير |
|---|---|---|
| v1 | 2026-07-24 | الخطة الأولى — الفجوات S1–S9، migrations 148–153، مراحل P0–P7 |
| **v2** | 2026-07-25 | دمج المراجعة: تصحيح نطاق S2، إضافة S10–S15، إلغاء wildcard المخزَّن، إعادة ترقيم 150–155، إعادة ترتيب المراحل P0–P8، وإضافة **تبعية دمج GRN** كشرط بوابة CI |

**ما تغيّر جوهريًا بين v1 و v2 — اقرأه قبل أي شيء:**

1. **S2 كان مبالَغًا في نطاقه.** سياسات `roles` سليمة أصلًا؛ الخلل في `role_permissions` وحدها.
2. **S10 هي الفجوة الحرجة الحقيقية، لا S1.** الإنفاذ الخادمي **صفر مطلق**، فإصلاح `has_permission`
   وحده لا يقلل أي مخاطرة عملية.
3. **wildcard المخزَّن أُلغي كليًا** — كان v1 يسمح بـ`inventory.*.*`.
4. **الترقيم انتقل من 148–153 إلى 150–155**، وهو **تبعية دمج** لا مجرد إعادة تسمية.
5. **إصلاح القوالب انتقل من P5 المتأخرة إلى P0/P1** لأن 60 مرجعًا من 67 غير صالح حيًّا.

---

## جدول المحتويات

1. [خلاصة تنفيذية](#1-خلاصة-تنفيذية)
2. [الأدلة الحية](#2-الأدلة-الحية)
3. [الفجوات S1–S15](#3-الفجوات-s1s15)
4. [النموذج المستهدف](#4-النموذج-المستهدف)
5. [خطة قاعدة البيانات — 150 إلى 155](#5-خطة-قاعدة-البيانات--150-إلى-155)
6. [خطة الواجهة](#6-خطة-الواجهة)
7. [مراحل التنفيذ P0–P8](#7-مراحل-التنفيذ-p0p8)
8. [الاختبارات الإلزامية](#8-الاختبارات-الإلزامية)
9. [المخاطر](#9-المخاطر)
10. [ما لا يجب فعله](#10-ما-لا-يجب-فعله--تطبيق-القاعدة-الذهبية)
11. [قرارات مطلوبة قبل كتابة SQL](#11-قرارات-مطلوبة-قبل-كتابة-sql)
12. [علاقة هذه الوثيقة بالوثائق القائمة](#12-علاقة-هذه-الوثيقة-بالوثائق-القائمة)

---

## 1) خلاصة تنفيذية

البنية المطلوبة — صلاحيات لكل **موديول** و**خدمة فرعية** مقسّمة إلى قراءة/تعديل/حذف —
**موجودة بالفعل في قاعدة البيانات**: 166 صلاحية على 10 موديولات و39 خدمة فرعية،
بمفتاح ثلاثي `module.resource.action`.

لكن الفحص الحي كشف أن المشكلة أعمق من «الواجهة لا تستخدم البيانات»:

**النظام يملك كتالوج صلاحيات، ولا يملك طبقة تفويض.**

- **0 من 316** سياسة RLS تستدعي فحص صلاحية دقيقة.
- **0 من 198** دالة تستدعي `has_permission`.
- السياسات التجارية تعتمد العضوية و`org_id` فقط، لا `module.resource.action`.

فالخطة ثلاثية لا ثنائية:

1. **تصحيح المقيِّم** (`has_permission`) كي يصبح صالحًا للبناء عليه — S1، S11.
2. **سلامة العلاقات والكتالوج** — S12، S13، S8.
3. **بناء الإنفاذ الخادمي فعليًا** — S10، وهي العمل الأكبر والأهم.

وشاشة الـ Pivot هي **واجهة إدارة** لهذه الطبقة، لا الطبقة نفسها.

**نافذة زمنية حاسمة:** `user_roles` = 0 صفوف، `super_admins` = 0، والمستخدم الوحيد `is_org_admin`
يتجاوز كل الفحوصات. فكل تشديد أمني اليوم كلفته **صفر**، وتزداد مع أول مستخدم حقيقي.

---

## 2) الأدلة الحية

### 2.1 الجداول

| الجدول | الصفوف | RLS | Policies |
|---|---:|---:|---:|
| `modules` | 10 | ✅ | 4 |
| `permissions` | 166 (39 resource / 8 actions) | ✅ | 4 |
| `roles` | 2 | ✅ | 4 |
| `role_permissions` | 166 | ✅ | 4 |
| `user_roles` | **0** | ✅ | 4 |
| `role_templates` | 17 | ✅ | 4 |
| `user_organizations` | 1 | ✅ | 4 |
| `super_admins` | **0** | ✅ | 4 |

### 2.2 توزيع الصلاحيات

| Module | Perms | Resources (الخدمات الفرعية) | Actions |
|---|---:|---|---|
| `accounting` | 18 | accounts, cost_centers, entries, journals | approve, create, delete, **read**, **update** |
| `dashboard` | 8 | analytics, overview | create, delete, **read**, **update** |
| `general_ledger` | 6 | account_statement, chart_of_accounts | create, delete, **edit**, export, **view** |
| `hr` | 18 | attendance, employees, leaves, payroll | approve, create, delete, **read**, **update** |
| `inventory` | 22 | adjustments, items, products, stock_moves, warehouses | approve, create, delete, **read**, **update** |
| `manufacturing` | 22 | boms, orders, stage_costs, stages, work_centers | approve, create, delete, **read**, **update** |
| `purchasing` | 19 | payments, purchase_invoices, purchase_orders, suppliers | approve, create, delete, **read**, **update** |
| `reports` | 17 | exports, financial, inventory, manufacturing, sales | create, delete, export, **read**, **update** |
| `sales` | 24 | customers, delivery_notes, receipts, sales_invoices, sales_orders | approve, create, delete, **read**, **update** |
| `settings` | 12 | organization, roles, users | create, delete, **read**, **update** |

`general_ledger` وحده يستعمل `view`/`edit`؛ التسعة الباقون `read`/`update`.

### 2.3 الأدوار الحية

| الدور | System | الصلاحيات |
|---|---:|---:|
| `Full Access` | لا | 166 |
| `Accountant` | لا | **0** |

حماية `is_system_role` **لا تحمي أيًا من الدورين**، ودور `Accountant` غير صالح للاستخدام —
أثر مباشر لخلل القوالب (S13).

### 2.4 الإنفاذ الخادمي

| القياس | النتيجة |
|---|---:|
| سياسات RLS تستدعي `has_permission` | **0 / 316** |
| دوال تستدعي `has_permission` | **0 / 198** |

> الدالة الوحيدة التي طابقت نصيًا هي `can_proceed_transaction`، والمطابقة من **تعليق**:
> `-- e.g., check if org is active, user has permission, etc.` — لا استدعاء.

### 2.5 القوالب

| القياس | النتيجة |
|---|---:|
| إجمالي المراجع في `role_templates.permission_keys` | 67 |
| مراجع لا تطابق أي صف في `permissions` | **60** |
| القوالب المتأثرة | **16 / 17** |

الأسباب: مفاتيح قديمة (`accounting.accounting.view`)، أنماط `%` (`accounting.%`, `%.read`)،
ونجوم (`*.*.*`) لا تعاملها الدالة الحالية كـwildcard فعلي.

### 2.6 التدقيق

| الجدول | Trigger تدقيق |
|---|---|
| `roles` | ✅ `audit_roles` → `log_activity` |
| `user_roles` | ✅ `audit_user_roles` → `log_activity` |
| `user_organizations` | ✅ `audit_user_organizations` → `log_activity` |
| `role_permissions` | ❌ **لا يوجد** |

و`log_activity()` يحتوي `EXCEPTION … RAISE WARNING` — يبتلع أخطاء التدقيق.

### 2.7 الكود

| الملف | الدور |
|---|---|
| `sql/migrations/40_multi_tenant_rbac_schema.sql` | مخطط RBAC + `create_crud_permissions` |
| `sql/migrations/41_multi_tenant_rls_policies.sql:306` | `has_permission` |
| `sql/migrations/41_multi_tenant_rls_policies.sql:357` | `get_user_permissions` |
| `sql/migrations/53_seed_permissions_data.sql` | بذرة ثانية بنمط مفاتيح مختلف |
| `src/hooks/usePermissions.ts` | مصدر الحقيقة في الواجهة |
| `src/services/rbac-service.ts` | خدمة RBAC كاملة لكن **غير مستعملة من صفحة الأدوار** |
| `src/config/module-permissions.ts` | خريطة الموديولات + `subModules` |
| `src/components/auth/ModuleGuard.tsx` | حارس المسارات |
| `src/components/auth/ProtectedComponent.tsx` | حارس العناصر (+ نسخة مكرّرة في `withPermission.tsx`) |
| `src/pages/org-admin/roles.tsx` | واجهة الأدوار (Accordion، كتابة مباشرة، غير ذرية) |

---

## 3) الفجوات S1–S15

### 🔴 S10 — RBAC غير منفَّذ على عمليات الأعمال إطلاقًا

**الفجوة الحرجة الأولى.** الكتالوج موجود، والإنفاذ صفر (§2.4).
إصلاح `has_permission` اليوم **لا يقلل أي مخاطرة عملية** لأن لا أحد يستدعيه.

المطلوب: **Permission Enforcement Map** — لكل مفتاح نقطة إنفاذ خادمية صريحة:

| Permission key | نقطة الإنفاذ | النوع |
|---|---|---|
| `purchasing.purchase_orders.read` | سياسة SELECT على PO | RLS |
| `purchasing.purchase_orders.create` | RPC إنشاء PO | `wardah_assert_permission` |
| `purchasing.purchase_orders.approve` | RPC اعتماد PO | `wardah_assert_permission` |
| `purchasing.goods_receipts.create` | RPC GRN | `wardah_assert_permission` |
| `inventory.adjustments.approve` | RPC اعتماد التسوية | `wardah_assert_permission` |
| `accounting.entries.reverse` | RPC العكس | `wardah_assert_permission` |

لكل resource/action يُختار واحد صريح:

1. قراءة محمية بـRLS دقيقة.
2. كتابة محمية بـRLS دقيقة.
3. كتابة عبر RPC ذرية فقط، مع سحب DML المباشر من أدوار API.

**لا يُعتبر موديول مكتمل RBAC حتى توجد له خريطة إنفاذ واختبار REST/RPC مباشر يفشل بلا صلاحية.**

### 🔴 S1 — `has_permission` يمنح صلاحيات لم تُمنح

`sql/migrations/41_multi_tenant_rls_policies.sql:337`

```sql
p.permission_key LIKE REPLACE(SPLIT_PART(p_permission_key, '.', 1) || '.%', '*', '%')
```

يقتطع **الجزء الأول فقط** من المفتاح المطلوب ويطابق أي مفتاح يبدأ به.
مَن يملك `inventory.items.read` يجتاز فحص `inventory.adjustments.delete`.

> **ملاحظة v2:** هذه الفجوة **شرط لازم غير كافٍ**. تصحيحها يجعل المقيِّم صالحًا للبناء عليه،
> لكن خفض المخاطرة الفعلي يأتي من S10 وحدها.

### 🔴 S11 — العضوية المعطلة لا تسقط صلاحيات المستخدم العادي

المسار العادي يربط `user_roles → role_permissions → permissions` دون المرور بـ`user_organizations`.
فمستخدم عُطِّلت عضويته يحتفظ بصلاحياته ما دامت صفوف `user_roles` قائمة.

يجب أن يشترط قرار السماح **كل** ما يلي:

- `auth.uid()` هو المستخدم الحالي.
- عضوية `(user_id, org_id)` موجودة و`is_active IS TRUE`.
- `roles.is_active IS TRUE`.
- `modules.is_active IS TRUE`.
- `permissions.is_active IS TRUE` (بعد إضافة العمود).
- `user_roles.expires_at` غير منتهٍ.

### 🔴 S12 — لا قيد يضمن تطابق مؤسسة الدور والتعيين

`user_roles` يملك ثلاثة FK منفصلة و`UNIQUE(user_id, role_id, org_id)`، لكنه **لا يضمن**
أن `role_id` ينتمي إلى `org_id` نفسه، ولا أن `(user_id, org_id)` عضوية فعلية.

```sql
ALTER TABLE roles
  ADD CONSTRAINT roles_id_org_id_key UNIQUE (id, org_id);

ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_org_fkey
  FOREIGN KEY (role_id, org_id) REFERENCES roles(id, org_id) ON DELETE CASCADE;

ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_member_org_fkey
  FOREIGN KEY (user_id, org_id) REFERENCES user_organizations(user_id, org_id) ON DELETE CASCADE;
```

**حالة الأهداف المطلوبة (متحقَّق منها حيًّا):**

- `user_organizations` فيه `UNIQUE(user_id, org_id)` ✅ — جاهز فورًا.
- `roles` فيه `PK(id)` و`UNIQUE(org_id, name)` فقط — **يجب إضافة `UNIQUE(id, org_id)` أولًا**.

`user_roles` فارغ ⇒ أفضل نافذة لإضافة القيود بلا أي backfill.

### 🔴 S13 — قوالب الأدوار معطوبة ويجب عزلها مبكرًا

60 مرجعًا غير صالح من 67، و16 قالبًا من 17 (§2.5).
و`create_role_from_template` تنفذ `LIKE` على هذه القيم وقد تُنشئ **دورًا فارغًا بصمت** —
وهو ما حدث فعليًا لدور `Accountant` الحي.

الإجراء المبكر (P0/P1، لا P5):

- تقرير لكل قالب: resolved / unresolved / expanded count.
- تعطيل القوالب غير الصالحة مؤقتًا (`is_active = false`) أو منع عرضها.
- جعل RPC إنشاء الدور **تفشل كاملًا** عند نمط غير صالح أو نتيجة صفر صلاحيات.
- عدم إنشاء دور جزئي بصمت إطلاقًا.

### 🟠 S2 — سياسات `role_permissions` لا تفحص العضوية النشطة

> **تصحيح v2:** كانت v1 تقول «سياسات `roles` و`role_permissions`». **الشطر الخاص بـ`roles` خطأ.**
> سياسات `roles_{sel,ins,upd,del}_m` تستدعي `is_org_admin(org_id)` وهي دالة تفحص `is_active` — سليمة.

الخلل مقصور على `role_permissions_{ins,upd,del}_m` التي تستعمل subquery مضمّنًا:

```sql
user_organizations.user_id = auth.uid() AND user_organizations.is_org_admin = true
```

بلا `AND is_active = true` — يخالف قاعدة `CLAUDE.md`: «العضوية النشطة تعني `is_active IS TRUE`».

⇒ التغيير يقتصر على `role_permissions`، مع **اختبارات regression** تثبت بقاء سياسات `roles` سليمة.

### 🟠 S3 — تعارض مفردات الأفعال

`ModuleGuard` يستدعي `hasPermission(moduleCode, 'view')` (`routes.tsx:44`)، و`ACTIONS` يعرّف `VIEW`/`EDIT`،
بينما البيانات الحية `read`/`update` لتسعة موديولات.

> **دقة v2:** الأثر يصيب الموديولات التسعة الحديثة؛ `dashboard` يبقى مفتوحًا بلا حارس،
> و`general_ledger` حالة استثنائية تعمل وفق مفرداته التاريخية.

### 🟠 S4 — الواجهة تُسقط بُعد الخدمة الفرعية

`usePermissions.ts:173` يبني `{ module_code, action }` ويهمل `permission.resource`.
وكل `subModules` في `module-permissions.ts` تشير إلى صلاحية الأب
(`inventory_adjustments` → `{ inventory, edit }`).

### 🟠 S5 — `/org-admin/*` بلا حارس على مستوى الراوتر

`routes.tsx:187` يحمّل `OrgAdminModule` بلا `ModuleGuard`. الحماية داخل `pages/org-admin/index.tsx`
فحص متأخر بعد تحميل الوحدة، و`super-admin` يستعمل نمطًا مختلفًا (`SuperAdminGuard` + `setTimeout(3000)`).

### 🟠 S14 — تعارض حفظ المصفوفة المتزامن

`rpc_set_role_permissions` بنمط الاستبدال الكامل ⇒ آخر كاتب يفوز إذا فتح مديران الشاشة معًا.

الحل: `roles.permissions_version bigint DEFAULT 0`، وRPC تستقبل `p_expected_version`،
ترفض عند عدم التطابق ثم تزيد الإصدار ذريًا. الواجهة تعرض تعارضًا وتطلب إعادة التحميل.

### 🟠 S15 — ازدواج التدقيق

v1 كانت تجعل RPC (151) تكتب audit ثم Triggers (153) تكتب أيضًا ⇒ سجلان للحدث نفسه.

**مصدر حقيقة واحد — المفضل:** Trigger متخصص fail-closed يسجل كل تغيير فعلي،
وRPC تمرر `reason`/`request_id` عبر transaction-local context. لا تكتب RPC صفًا ثانيًا يدويًا.

- `ip_address`/`user_agent` بيانات best-effort، لا دليل هوية مستقل.
- منع `UPDATE`/`DELETE` عبر RLS **وحده لا يكفي لمالك الجدول** ⇒ Trigger منع أو مسار صيانة موثق.

### 🟡 S6 — دورة حياة الدور كلها غير ذرية

`pages/org-admin/roles.tsx:307-321` — `DELETE` ثم `INSERT` كطلبين منفصلين.

> **توسيع v2:** عدم الذرية يشمل الدورة كاملة، لا تحديث الصلاحيات فقط:
> إنشاء الدور ثم إدراج صلاحياته؛ تعديل الدور ثم حذف/إدراج؛
> حذف `role_permissions` ثم `user_roles` ثم `roles`؛ تعيين أدوار المستخدمين من العميل.

كما أن `handleDeleteRole` يتجاوز فحص `is_system_role` الموجود في `rbac-service.deleteRole`.

### 🟡 S7 — دوال تقبل `p_user_id` عشوائيًا

`has_permission(uuid, uuid, varchar)` و`get_user_permissions(uuid, uuid)` كلاهما
`SECURITY DEFINER` ممنوح لـ`authenticated` ⇒ أي مستخدم يعدّد صلاحيات أي مستخدم آخر.

يُسحب `EXECUTE` من `authenticated` عن **كلتيهما** بالتوقيع الكامل، وتبقى لـ`service_role`.
واجهة العميل تستخدم نسخًا تعتمد `auth.uid()` ولا تقبل هوية مستهدفة.

### 🟡 S8 — مصدرا بذر متعارضان

- `40_…` ينتج `module.resource.action` (٣ أجزاء — الشكل الحي).
- `53_…` ينتج `module.module.action` وأفعالًا مختلفة (`view/edit/import/print`).
- `checkPermission` (`usePermissions.ts:309`) يبني مفتاحًا من **جزأين** لا يطابق أيًا منهما.

### 🟡 S9 — تكرار وتشتت

`withPermission` مُعرَّف مرتين؛ الكاش مُنفَّذ مرتين بلا إبطال مشترك؛
`rbac-service.ts` — الأنظف — غير مستعمل من صفحة الأدوار.

---

## 4) النموذج المستهدف

### 4.1 المفتاح القانوني — خرساني دائمًا

```
<module>.<resource>.<action>
```

ثلاثة أجزاء **خرسانية**. **`*` و`%` ممنوعتان** في `permissions.permission_key` وفي التعيينات النهائية.

> **انعكاس v2:** كانت v1 تسمح بـwildcard مخزَّن (`inventory.*.*`). أُلغي.
> التحديد الجماعي في الواجهة أو القوالب **يوسّع** إلى قائمة مفاتيح قانونية **لحظة الحفظ**.
> السبب: منع منح صلاحيات مستقبلية تلقائيًا لمجرد إضافة خدمة جديدة لاحقًا،
> وجعل التدقيق والعدّادات والمقارنة والـrevocation واضحة.

### 4.2 مفردات الأفعال

**الأساس:**

| Action | عربي | الدلالة |
|---|---|---|
| `read` | قراءة | عرض القوائم والتفاصيل |
| `create` | إنشاء | إنشاء سجل جديد |
| `update` | تعديل | تعديل سجل قائم |
| `delete` | حذف | حذف سجل قابل للحذف قانونيًا **قبل الترحيل فقط** |
| `approve` | اعتماد | اعتماد وثيقة |
| `export` | تصدير | تصدير/طباعة |

**أفعال دورة الحياة** (تُضاف للموارد المحتاجة فقط):

| Action | عربي | الدلالة |
|---|---|---|
| `submit` | تقديم | إرسال للاعتماد |
| `post` | ترحيل | ترحيل محاسبي أو مخزني |
| `cancel` | إلغاء | إلغاء وثيقة تشغيلية |
| `reverse` | عكس | عكس أثر مالي مُرحَّل |
| `assign` | إسناد | إسناد مسؤولية/دور |

**قواعد ملزِمة:**

- `delete` ليس مرادفًا عامًا لـ«إلغاء» — للسجل القابل للحذف قبل الترحيل فقط.
- **`update` لا تمنح تلقائيًا `approve` أو `post` أو `reverse`.**
- `view`/`edit` مرادفات تاريخية: تبقى في القاعدة (القاعدة الذهبية) وتُطبَّع في طبقة القراءة فقط.

### 4.3 نموذج القرار — fail-closed

```
Super Admin              → يتجاوز (كل mutation عبر التجاوز تُسجَّل)
Org Admin (is_active)    → كل صلاحيات منظمته
غير ذلك                  → مطابقة دقيقة لمفتاح ثلاثي خرساني، بشرط:
                            عضوية نشطة + دور نشط + موديول نشط
                            + صلاحية نشطة + تعيين غير منتهٍ
غياب المفتاح             → رفض. بلا استنتاج، بلا wildcard، بلا LIKE
```

### 4.4 الإدارة ليست صلاحية قابلة للإسناد

> **انعكاس v2:** كانت v1 تقترح موديولَي `org_admin` و`super_admin` في الكتالوج. أُلغي.

- **Super Admin** صفة مصدرها جدول `super_admins` وحارس مستقل — **لا يمكن اكتسابها من Matrix مؤسسة**.
- **Org Admin** مستوى عضوية (`user_organizations.is_org_admin`)، لا permission عادية.
- يجوز لاحقًا إضافة موديول `security` بموارد `roles, users, invitations, audit_log`
  **فقط** إذا تقرر تفويض بعض مهام الإدارة لغير Org Admin.
- شاشة إدارة المنصة تبقى `requireSuperAdmin` دائمًا.

### 4.5 ما يُسجَّل في التدقيق

لا يُسجَّل كل فحص قراءة ناجح (ضوضاء). يُسجَّل على الأقل:

- كل mutation نُفِّذ عبر تجاوز إداري.
- كل وصول Super Admin إلى مؤسسة غير مؤسسته التشغيلية.
- تغييرات العضوية والأدوار والقوالب والكتالوج.
- عمليات export الحساسة.

---

## 5) خطة قاعدة البيانات — 150 إلى 155

### 5.0 ⚠️ تبعية دمج إلزامية — اقرأها قبل الترقيم

الأرقام 148 و149 **مستخدمة بالفعل** على فروع غير مدموجة:

| الرقم | الملف | الفرع |
|---|---|---|
| 148 | `148_uom_purchase_receipt_snapshots.sql` | `feat/uom-grn-partial-receipts`، `claude/migration-148-pr-47-ub9c7e` |
| 149 | `149_require_approved_po_for_receipt.sql` | `review/migration-148-hardening-2` |

**وهذه ليست مسألة تسمية بل بوابة CI صلبة.** خطوة `Validate migration numbering`
(`.github/workflows/ci-cd.yml:107`) تحسب:

```python
missing = [i for i in range(1, max_num + 1) if i not in existing and i not in skipped]
```

فرع الصلاحيات الذي يضيف 150–155 بلا وجود ملفَّي 148 و149 يجعل `max_num = 155`
ويُبلِّغ عن 148 و149 مفقودَين ⇒ **CI يفشل فشلًا صلبًا**.

**النتيجة العملية:**

1. **يجب دمج فرع GRN (148 + 149) إلى `main` أولًا**، ثم إعادة بناء فرع الصلاحيات فوقه.
2. **يُمنع** تسجيل 148/149 في `sql/migrations/skipped_migration_numbers.yml` —
   الملف مخصص للأرقام المتجاوزة **عمدًا**، وهذان migration معلَّقان حقيقيان؛
   تسجيلهما يفسد الحوكمة ويخفي عملًا قائمًا.
3. الأرقام 150–155 تبقى **provisional** حتى rebase فعلي على `main` وقت بدء التنفيذ.

### الجدول

| Migration | المحتوى |
|---|---|
| **150** | `permission_catalog_normalization_and_integrity` |
| **151** | `permission_evaluation_hardening` |
| **152** | `rbac_policy_active_membership` |
| **153** | `rbac_atomic_admin_api` |
| **154** | `seed_subservice_permissions_and_templates` |
| **155** | `permission_audit_hardening` |

كلها `CREATE OR REPLACE` / أعمدة nullable / قيود وسياسات جديدة.
**لا حذف لأي جدول أو عمود أو صف تاريخي.**

### 5.1 — Migration 150: تطبيع الكتالوج وسلامة العلاقات

- `modules.code` (مُعبَّأ من `name`) + unique index، و`display_order`, `is_active` عند الغياب.
- `permissions.is_active` و`display_order` (nullable).
- `permissions.action_canonical`: **Generated Stored** أو قيد/trigger يفرض اتساقه مع `action` —
  **لا يُترك عمودًا حرًا قابلًا للانحراف**.
- قيد يمنع `*` و`%` في المفاتيح القانونية.
- قيد `CHECK ... NOT VALID` على `permission_key ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+$'` —
  يمنع الجديد الخاطئ دون كسر التاريخي.
- **قيود S12 المركبة** — بالترتيب: `roles UNIQUE(id, org_id)` أولًا، ثم FK المركبان على `user_roles`.
- **تقرير canonical duplicates قبل أي unique index** — قد يتصادم `view` و`read` على نفس
  `(module, resource)` بعد التطبيع.
- عزل القوالب غير الصالحة (`is_active = false`) — S13.
- مفاتيح `module.module.action` من البذرة الثانية: `is_active = false`، **لا حذف**.
- Index: `permissions(module_id, resource, action_canonical)`.

### 5.2 — Migration 151: تقوية تقييم الصلاحيات 🔴

`CREATE OR REPLACE FUNCTION has_permission(...)`:

- **مطابقة دقيقة فقط.** إزالة `LIKE`/`SPLIT_PART` كليًا. لا wildcard مشتق ولا مخزَّن.
- تطبيع الفعل عبر `action_canonical` (`view≡read`, `edit≡update`).
- اشتراط **كل** شروط S11: عضوية نشطة + `roles.is_active` + `modules.is_active`
  + `permissions.is_active` + `expires_at` غير منتهٍ.
- نسخة `self` تعتمد `auth.uid()` ولا تقبل هوية مستهدفة.
- سحب `EXECUTE` من `PUBLIC`, `anon`, `authenticated` عن نسخ `p_user_id`
  (`has_permission` و`get_user_permissions`)، ومنحها لـ`service_role` عند الحاجة —
  **بالتوقيع الكامل لكل overload**.
- `SET search_path = public, pg_temp`.

> ⚠️ تغيير **مشدِّد**. يسبقه تقرير P0 «من يفقد ماذا». حاليًا `user_roles` فارغ ⇒ الأثر صفري.

### 5.3 — Migration 152: سياسات العضوية النشطة

- تعديل سياسات **`role_permissions` فقط** لاستخدام `is_org_admin(org_id)`.
- **عدم** إعادة كتابة سياسات `roles` الصحيحة (تصحيح S2) — مع regression تثبت سلامتها.
- مراجعة سياسات أخرى لا تفحص العضوية النشطة (مثل `stock_adjustments`)
  ضمن خطة الإنفاذ الموديولية لا هنا.

### 5.4 — Migration 153: واجهات إدارة الأدوار الذرية

| RPC | الوظيفة |
|---|---|
| `rpc_get_permission_matrix(p_org_id)` | الكتالوج + الأدوار + التعيينات في استدعاء واحد |
| `rpc_create_role(...)` | إنشاء الدور وصلاحياته ذريًا |
| `rpc_update_role(...)` | تعديل البيانات والصلاحيات ذريًا |
| `rpc_archive_role(...)` | أرشفة بدل الحذف المادي افتراضيًا |
| `rpc_set_role_permissions(..., p_expected_version)` | استبدال ذري مع optimistic concurrency |
| `rpc_assign_user_roles(..., p_expected_version)` | تعيين ذري لأدوار مستخدم |
| `rpc_my_permissions(p_org_id)` | مفاتيح المستخدم الحالي فقط |
| `rpc_create_role_from_template_safe(...)` | fail-closed، يوسّع الأنماط إلى مفاتيح خرسانية |

> `rpc_toggle_role_permission` **حُذف من النسخة الأولى** — الشاشة تعتمد حفظًا صريحًا مجمعًا،
> وتقليل عدد RPC يقلل سطح الهجوم.

كل RPC كتابة:

- حارس الإدارة **أول تعليمة تشغيلية**.
- يتحقق أن كل role/user/permission داخل النطاق الصحيح ونشط.
- يرفض المفاتيح المجهولة أو غير النشطة.
- يرفض تعديل System role.
- يقفل الصف المستهدف أو يستخدم `permissions_version`.
- ذري بالكامل.
- `REVOKE FROM PUBLIC, anon` قبل `GRANT authenticated` بالتوقيع الكامل.

### 5.5 — Migration 154: توسيع الكتالوج والقوالب

- توسيع resources **بعد جرد فعلي** للـroutes والخدمات وRPC — لا تخمينًا.
  مرشحون من فحص الكود: `inventory`: `bins`, `transfers`, `valuation`, `uom` —
  `manufacturing`: `wip`, `mo_completion` — `purchasing`: `goods_receipts` —
  `sales`: `collections` — `general_ledger`: `journal_entries`, `trial_balance`, `gl_entries` —
  `settings`: `system`, `backup`, `integrations`, `company`.
- إضافة أفعال دورة الحياة اللازمة (§4.2).
- **إعادة بناء القوالب الـ17** من مفاتيح قانونية، أو Pattern DSL موثق يوسّع إلى مفاتيح خرسانية.
- **عدم** إنشاء موديول `super_admin` قابل للإسناد (§4.4).
- إنشاء/تحديث **Permission Enforcement Map** كـartifact إلزامي.

### 5.6 — Migration 155: تقوية سجل التدقيق

- حسم: تقوية `audit_logs` الحالي **أو** ledger متخصص — لا مسارين متوازيين لنفس الحدث (S15).
- Trigger متخصص على `role_permissions` (غير مغطى اليوم) وبقية عمليات RBAC.
- تدقيق **fail-closed** — لا `RAISE WARNING` يبتلع الأخطاء.
- الحقول: actor, org, role/user, before/after, reason, request_id, source, وقت الخادم.
- منع `UPDATE`/`DELETE`: RLS **+ Trigger منع**، مع مسار صيانة موثق.
- سياسة retention (وpartitioning عند الحاجة) دون السماح للمستخدم بالحذف.

---

## 6) خطة الواجهة

### 6.1 طبقة القراءة — `usePermissions`

- الانتقال إلى `rpc_my_permissions(orgId)` → `Set<string>` من مفاتيح ثلاثية خرسانية.
- الكاش في TanStack Query بمفتاح `['permissions', userId, orgId]`،
  مع `invalidateQueries` بعد أي RPC كتابة (يعالج S9).
- تجاوز Org Admin / Super Admin يبقى، مع علَم `bypassReason` يُعرض للمستخدم.

**واجهة القرار — تقسيم صريح:**

> **انعكاس v2:** كانت v1 تترجم `hasPermission(module, action)` إلى `can(module, '*', action)`.
> أُلغي — كان يعيد منطق wildcard من الباب الخلفي، وإما يفشل دائمًا بعد إلغاء التخزين النجمي،
> أو يعيد «أي صلاحية تمنح الموديول» بصورة غير واضحة.

| الدالة | الاستخدام |
|---|---|
| `can(module, resource, action)` | **القرار الدقيق** — الوحيد المسموح لحماية mutation |
| `canAccessModule(module)` | `true` عند امتلاك `read` واحدة على الأقل داخل الموديول — **للتنقل والمسار الرئيسي فقط** |
| `canAny(keys[])` / `canAll(keys[])` | مفاتيح ثلاثية صريحة |
| `hasPermission(module, action)` | **deprecated مؤقتًا** — يُمنع استخدامها لحماية mutation |

كل sub-route وكل زر mutation يُنقل إلى مفتاح ثلاثي **قبل** حذف واجهة التوافق.

### 6.2 الحرّاس

- توحيد `ModuleGuard` / `ProtectedComponent` / `withPermission` على تنفيذ واحد،
  مع إبقاء الأسماء كـre-export.
- `guardedLazy` في `routes.tsx` تنتقل إلى `canAccessModule(moduleCode)` — لا `action="view"`.
- حارس صريح لـ`/org-admin/*` (`requireOrgAdmin`) و`/super-admin/*` (`requireSuperAdmin`) — S5،
  مع إبقاء الحارس الداخلي كطبقة ثانية.
- ربط كل `subModule` في `module-permissions.ts` بـ`resource` حقيقي — S4.

### 6.3 شاشة الـ Pivot — `/settings/permissions`

المسار يعيد التوجيه اليوم إلى `/org-admin/roles`؛ يصبح الشاشة الحقيقية ويوجّه القديم إليه.

```
الصفوف (هرمي، قابل للطي)          الأعمدة (دور واحد لكل عمود)
─────────────────────────────     ──────────────────────────────
▼ المخزون                    │ محاسب │ أمين مخزن │ مشرف │ …
    الأصناف                  │  ◐ R  │   ● RUD   │  ● *  │
    التسويات                 │  ○    │   ◐ RU    │  ● *  │
    المستودعات               │  ○    │   ● RUD   │  ● *  │
▶ المبيعات                   │  ●    │   ○       │  ● *  │
```

- **الخلية** = تقاطع (خدمة فرعية × دور)، شرائح `R U D` (+ `A`/`E`/دورة الحياة عند التفعيل).
- **رأس الصف** يحدد الموديول كاملًا — **ويوسّع إلى المفاتيح الخرسانية لحظة الحفظ**، لا إلى نجمة.
- **عمود الدور** بعدّاد حي «٤٢/١٦٦».
- ثلاث حالات: `○` بلا صلاحية، `◐` جزئي، `●` كامل.
- تجميد العمود الأول والصف الأول (RTL: الأول على اليمين).
- بحث وفلترة + «إظهار الممنوح فقط».
- **حفظ صريح مجمّع** مع «٧ تغييرات غير محفوظة» وزر تراجع.
- **optimistic concurrency**: الشاشة تحمل `permissions_version` وترسله؛ عند التعارض
  تعرض رسالة وتطلب إعادة التحميل بدل الكتابة فوق تعديل غيرها (S14).
- أدوار `is_system_role` للقراءة فقط بقفل ظاهر.

**i18n:** كل النصوص عبر `t()`. النمط `isRTL ? 'عربي' : 'English'` المستعمل في
`src/features/settings/index.tsx` تمنعه البوابة الحاجزة ولا يجوز نسخه.

**الأداء:** `Set<string>` للمفاتيح + `useMemo` لكل صف + virtualization فوق ١٥ عمودًا.

**الإتاحة:** الخلية `<button role="checkbox" aria-checked>` مع `aria-label` كامل
(«المخزون ← التسويات ← حذف ← دور أمين مخزن») + تنقّل بالأسهم.

### 6.4 تبويب Super Admin

تبويب داخل الصفحة نفسها لإدارة كتالوج `modules` / `permissions` / `role_templates`،
يظهر لـSuper Admin فقط — لأن سياسات الكتابة على هذه الجداول تشترط `is_super_admin()` أصلًا،
والواجهة الحالية لا تعرضها إطلاقًا.

---

## 7) مراحل التنفيذ P0–P8

| المرحلة | المحتوى | البوابة |
|---|---|---|
| **P0** | تقرير أساس: من يملك ماذا + تقرير القوالب (resolved/unresolved) + **جرد نقاط الإنفاذ**. لا كود. | مراجعة بشرية |
| **P1** | 150–152: سلامة الكتالوج والعلاقات + تقوية التقييم + سياسات العضوية النشطة | Fresh DB + negative SQL |
| **P2** | 153: RPC ذرية + عزل الكتابة المباشرة من صفحة الأدوار | CI كامل |
| **P3** | `usePermissions` + `can`/`canAccessModule` + توحيد الحرّاس + ربط subModules | TS + ESLint + unit |
| **P4** | **Pilot إنفاذ خادمي** على `settings/security` ثم `purchasing` | REST/RPC denial tests |
| **P5** | شاشة Pivot مع optimistic concurrency | i18n + a11y + tests |
| **P6** | 154: توسيع الكتالوج والقوالب + rollout لكل الموديولات | Enforcement Map مكتملة |
| **P7** | 155: تدقيق أمني + عرض السجل في `/org-admin/audit-log` | exactly-once audit tests |
| **P8** | E2E متعدد المؤسسات والأدوار على staging | Playwright artifact |

**قواعد ترتيب ملزِمة:**

- **دمج GRN (148+149) شرط سابق لـP1** — وإلا فشل CI (§5.0).
- **P4 قبل P5**: الإنفاذ الخادمي يسبق واجهة إدارته. بناء الشاشة أولًا يُنتج وهم أمان.
- **عزل القوالب في P0/P1** لا P6 — الشاشة الحالية تسمح باستخدامها وهي معطوبة.
- **لا تنتقل خدمة إلى «RBAC مكتمل» بمجرد ظهورها في Pivot** — بل بعد ربط كل عملياتها
  الحساسة بنقطة إنفاذ خادمية واختبارها.

**التطبيق على Production:** حسب `Migration workflow` في `CLAUDE.md` — دمج PR، ثم التطبيق بالترتيب،
ثم التحقق من ظهور الاسم القانوني مرة واحدة في `supabase_migrations.schema_migrations`،
وتحديث Baseline لاحقًا عبر workflow `Generate Schema Baseline` في PR منفصل فقط.

---

## 8) الاختبارات الإلزامية

### SQL / Fresh DB

- **الاختبار الحاسم:** `inventory.items.read` **لا** يمنح `inventory.adjustments.delete`.
- العضوية المعطلة تُسقط جميع الصلاحيات رغم بقاء `user_roles`.
- الدور المعطل، الموديول المعطل، والصلاحية المعطلة تُسقط القرار.
- `expires_at` منتهٍ يُسقط الصلاحية.
- **لا يمكن ربط مستخدم أو دور من مؤسسة أخرى في `user_roles` حتى عبر SQL مباشر** (S12).
- لا تقبل RPC مفتاحًا مجهولًا أو غير نشط.
- **لا نجمة ولا `%` في مفاتيح `permissions` النهائية**.
- القالب غير الصالح يفشل كاملًا ولا يُنشئ دورًا فارغًا؛ القالب الصالح يوسّع إلى العدد المتوقع.
- نسخة `p_user_id` غير قابلة للتنفيذ من `authenticated`.
- **Org Admin معطل يُرفض على `role_permissions`؛ وسياسات `roles` تبقى ناجحة للعضو النشط
  وفاشلة للمعطل** (regression لتصحيح S2).
- تعارض `permissions_version` يعيد خطأ conflict ولا يطمس التعديل السابق.
- **كل mutation صلاحيات تُنتج سجل تدقيق واحدًا فقط** (exactly-once).
- ذرية: فشل في منتصف أي RPC يترك الحالة السابقة كاملة.

### واجهة (Vitest)

- تطبيع الفعل: `view ≡ read`، `edit ≡ update`.
- `can()` fail-closed عند مفتاح غير موجود.
- `canAccessModule` يسمح بالدخول عند وجود resource واحد مقروء فقط.
- **دخول الموديول لا يمنح أزرار create/update/delete لخدمات أخرى داخله.**
- الكاش يعزل `(userId, orgId)` ويُبطَل فور نجاح mutation.
- تغيير المؤسسة أثناء الطلب لا يحقن نتيجة المؤسسة السابقة.
- System role ونسخة stale من الدور لا يمكن حفظهما.

### E2E / API — لكل موديول Pilot

1. المستخدم يرى فقط الـresource الممنوح.
2. الزر غير الممنوح غير ظاهر.
3. **REST مباشر للعملية غير الممنوحة يفشل.**
4. **RPC مباشرة للعملية غير الممنوحة تفشل.**
5. نفس العملية تنجح بعد المنح وإبطال الكاش.
6. العملية تفشل فور تعطيل العضوية أو انتهاء التعيين.
7. محاولة Org B على كائن Org A تفشل حتى مع permission key مماثل.

> البنود 3 و4 هي جوهر الإثبات: الواجهة ليست خط الدفاع.

---

## 9) المخاطر

| الخطر | الأثر | التخفيف |
|---|---|---|
| إصلاح wildcard يقطع وصولًا قائمًا | حجب مستخدمين | `user_roles` = 0 اليوم ⇒ نافذة صفرية + تقرير P0 قبل/بعد |
| **تعارض أرقام migration بين الفروع** | **فشل CI صلب** | دمج GRN أولًا ثم rebase؛ ويُمنع تسجيلها كـskipped (§5.0) |
| استدعاء دالة صلاحية لكل صف يبطئ RLS | تدهور أداء | فهرسة صحيحة، `SELECT` init-plan حيث يلزم، قياس `EXPLAIN ANALYZE` |
| recursion بين RLS وجداول RBAC | تعطّل استعلامات | helpers محدودة + `SECURITY DEFINER` بـ`search_path` ثابت |
| **قفل الأدمن خارج النظام** | فقد السيطرة | **حساب break-glass موثق واختبار rollback قبل تفعيل السياسات** |
| stale cache بعد تعديل دور | صلاحيات وهمية | TanStack invalidation + version في الاستجابة + مدة قصيرة |
| دور جديد من قالب ناقص | صلاحيات صامتة ناقصة | fail-closed، ومنع الإنشاء الجزئي |
| حفظان متزامنان للمصفوفة | فقد تعديل | optimistic concurrency (S14) |
| تضخم سجل التدقيق | كلفة تخزين | retention وpartitioning، دون السماح بالحذف من المستخدم |
| اعتماد الواجهة وحدها للأمان | تجاوز عبر API | RLS + RPC حارسة هما خط الدفاع — مُثبَت في E2E بندَي 3 و4 |
| تجاوز Super Admin غير مرئي | فجوة تدقيق | 155 يسجل كل mutation عبر تجاوز |
| توسيع Baseline | drift | Baseline يُحدَّث فقط بعد ظهور الأرقام في سجل Production عبر الـworkflow |

---

## 10) ما لا يجب فعله — تطبيق القاعدة الذهبية

- ❌ حذف `permissions` أو `role_permissions` القديمة لتنظيف المفاتيح ← `is_active = false`.
- ❌ حذف بذرة `53_seed_permissions_data.sql` أو تعديل migration مطبقة حيًّا ← migration معاكسة.
- ❌ `DROP FUNCTION has_permission` ← `CREATE OR REPLACE` فقط، حفاظًا على الـGRANTs والاعتماديات.
- ❌ لمس `supabase_migrations.schema_migrations`.
- ❌ **تسجيل 148/149 في `skipped_migration_numbers.yml`** لتجاوز فشل CI.
- ❌ إضافة عمود `NOT NULL` بلا `DEFAULT` على `permissions`.
- ❌ منح `EXECUTE` على أي helper داخلي جديد لـ`anon` أو `authenticated`.
- ❌ تخزين `*` أو `%` في `permission_key` أو في تعيينات الأدوار.
- ❌ جعل `super_admin` صلاحية قابلة للإسناد داخل مؤسسة.
- ❌ الحذف المادي للأدوار افتراضيًا ← أرشفة.

---

## 11) قرارات مطلوبة قبل كتابة SQL

- [ ] اعتماد المطابقة الدقيقة فقط وعدم تخزين wildcard في الأدوار.
- [ ] **اعتماد دمج GRN (148+149) كشرط سابق، واعتماد ترقيم 150–155 بعده.**
- [ ] اعتماد `audit_logs` الحالي بعد تقويته **أو** ledger متخصص واحد — لا مسارين لنفس الحدث.
- [ ] اعتماد `canAccessModule` بدل ترجمة التوافق إلى `resource='*'`.
- [ ] اعتماد أفعال دورة الحياة `submit/post/cancel/reverse` للموارد التي تحتاجها.
- [ ] عدم جعل `super_admin` permission قابلة للإسناد داخل المؤسسة.
- [ ] نقل إصلاح القوالب المعطوبة إلى P0/P1 للعزل وP6 لإعادة البناء.
- [ ] جعل **Permission Enforcement Map** مخرجًا إلزاميًا لكل موديول.
- [ ] اعتماد حساب break-glass واختبار rollback قبل تفعيل أي سياسة إنفاذ.

---

## 12) علاقة هذه الوثيقة بالوثائق القائمة

| الوثيقة | العلاقة |
|---|---|
| `docs/security/PERMISSIONS_MATRIX_PLAN_REVIEW_20260725.md` | **المراجعة التنفيذية — مدموجة بالكامل في v2 هذه.** تُحفظ كسجل للمراجعة ولا تُحذف؛ هذه الوثيقة هي المرجع النافذ. |
| `docs/security/PERMISSIONS_MAP.md` | **قديمة ولا تطابق القاعدة الحية.** مفاتيح من جزأين (`manufacturing.view`) وأفعال `view`/`edit` وresources غير موجودة (`manufacturing.cost`, `inventory.valuation`, `*.reports`). تُحدَّث في P6 بعد استقرار الكتالوج، ولا تُعتمد مرجعًا قبل ذلك. |
| `docs/MULTI_TENANT_RBAC_PLAN.md` | خطة RBAC الأصلية (نوفمبر 2025) — تصف البنية المنفَّذة في migrations 40/41/53. هذه الوثيقة امتداد تصحيحي لها لا بديل عنها. |
| `docs/security/SECURITY_MODEL.md` | نموذج الأمان العام. بنود S1، S2، S10، S11 تخالفه وتحتاج إغلاقًا. |
| `docs/security/SECURITY_DEFINER_AUDIT.md` | تدقيق دوال `SECURITY DEFINER` — بند S7 إضافة عليه. |
| `sql/migrations/skipped_migration_numbers.yml` | آلية توثيق الأرقام المتجاوزة عمدًا — **لا تُستعمل** لتجاوز تعارض 148/149. |
| `CLAUDE.md` | القاعدة الذهبية + Migration workflow — كل ما ورد أعلاه ملتزم بهما. |
