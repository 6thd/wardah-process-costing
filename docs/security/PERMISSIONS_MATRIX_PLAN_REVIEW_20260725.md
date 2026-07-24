# مراجعة خطة نظام الصلاحيات الدقيق — 2026-07-25

> **الوثيقة الأصلية:** `docs/security/PERMISSIONS_MATRIX_PLAN_20260724.md`  
> **النسخة التي تمت مراجعتها:** commit `e1e948b` على الفرع
> `claude/permissions-system-plan-0rqcgy`  
> **قاعدة البيانات التي تم التحقق منها:** المشروع الحي
> `uutfztmqvajmsxnrqeiv`  
> **الحكم:** الخطة سليمة معماريًا ومبنية على فحص حقيقي، لكنها تحتاج التعديلات
> الإلزامية أدناه قبل بدء التنفيذ.

---

## 1. الخلاصة التنفيذية للمراجعة

الخطة الأصلية أصابت جوهر المشكلة:

- كتالوج الصلاحيات الثلاثي موجود بالفعل.
- `usePermissions` يسقط `resource`.
- مفردات `view/edit` لا تطابق معظم البيانات الحية `read/update`.
- `has_permission` يحتوي wildcard ضمنيًا يسبب تصعيد امتياز.
- صفحة الأدوار تكتب مباشرة إلى الجداول وبعمليات غير ذرية.
- المستخدم الحالي Org Admin، و`user_roles` فارغ، ولذلك العيوب مخفية عمليًا.

لكن الفحص الحي كشف خمس نقاط يجب اعتبارها شروطًا مسبقة للتنفيذ:

1. أرقام migrations 148 و149 مستخدمة بالفعل على فرع GRN النشط؛ أرقام خطة RBAC
   يجب أن تبدأ من 150 إذا دُمج ذلك الفرع أولًا.
2. لا توجد أي سياسة RLS تجارية تستدعي فحص صلاحية دقيقة، ولا توجد RPC أعمال
   تستدعي `has_permission` أو `wardah_assert_permission`. إصلاح الشاشة وحدها لا
   يحقق الأمان المطلوب.
3. المستخدم العادي قد يحتفظ بصلاحياته بعد تعطيل عضويته، لأن المسار العادي داخل
   `has_permission` و`get_user_permissions` لا يتحقق من
   `user_organizations.is_active`.
4. `user_roles` لا يضمن على مستوى القيود أن الدور والمستخدم ينتميان إلى نفس
   المؤسسة المسجلة في الصف.
5. قوالب الأدوار الحية معطوبة بصورة كبيرة: 60 مرجعًا من أصل 67 لا يطابق مفتاحًا
   حاليًا، و16 قالبًا من أصل 17 متأثر. يوجد بالفعل دور `Accountant` حي بلا أي
   صلاحية، وهو أثر متسق مع هذا الخلل.

---

## 2. الأدلة الحية المؤكدة

### 2.1 الجداول والصفوف

| الجدول | الصفوف | RLS | عدد السياسات |
|---|---:|---:|---:|
| `modules` | 10 | نعم | 4 |
| `permissions` | 166 | نعم | 4 |
| `roles` | 2 | نعم | 4 |
| `role_permissions` | 166 | نعم | 4 |
| `user_roles` | 0 | نعم | 4 |
| `role_templates` | 17 | نعم | 4 |
| `user_organizations` | 1 | نعم | 4 |
| `super_admins` | 0 | نعم | 4 |

المستخدم الوحيد عضو نشط و`is_org_admin = true` في المؤسسة التجريبية.

### 2.2 الأدوار الحية

| الدور | System role | Active | الصلاحيات |
|---|---:|---:|---:|
| `Full Access` | لا | نعم | 166 |
| `Accountant` | لا | نعم | 0 |

هذا يعني أن حماية `is_system_role` لا تحمي أيًا من الدورين الحاليين، وأن دور
`Accountant` غير صالح للاستخدام كما هو.

### 2.3 الإنفاذ على الخادم

نتيجة فحص `pg_policies` وتعريفات الدوال:

- عدد سياسات RLS التي تستدعي `has_permission` أو `assert_permission`: **0**.
- عدد دوال الأعمال التي تستدعي فحص صلاحية دقيقة: **0**؛ الدالة الوحيدة التي
  تحتوي النص هي `has_permission` نفسها.
- السياسات التجارية الحالية تعتمد أساسًا على العضوية أو `org_id`، لا على
  `module.resource.action`.

أمثلة:

- `manufacturing_orders` يسمح CRUD لمن يطابق `org_id = auth_org_id()`.
- `stock_adjustments` يسمح عمليات واسعة لأعضاء المؤسسة، وبعض subqueries لا
  تفحص `is_active`.
- `purchase_orders` و`purchase_order_lines` لديهما قراءة مؤسسية فقط؛ الكتابة
  تمر عبر RPC أخرى، لكن تلك RPC لا تستدعي RBAC الدقيق الحالي.

**النتيجة:** المصفوفة الحالية كتالوج إداري وليست حتى الآن طبقة تفويض تشغيلية.

### 2.4 قوالب الأدوار

- إجمالي المراجع داخل `role_templates.permission_keys`: 67.
- المراجع التي لا تطابق صفًا في `permissions`: 60.
- القوالب المتأثرة: 16 من 17.

الأسباب تشمل:

- مفاتيح قديمة مثل `accounting.accounting.view`.
- أنماط `%` مثل `accounting.%` و`%.read`.
- نمط نجوم مثل `*.*.*` لا تتعامل معه الدالة الحالية كـwildcard فعلي.

الدالة `create_role_from_template` تنفذ `LIKE` على هذه القيم وقد تنشئ دورًا
فارغًا أو ناقصًا دون رفض العملية.

---

## 3. تصحيحات مباشرة على الفجوات S1–S9

### 3.1 S1 صحيح، لكن الحل المفضل هو المطابقة الدقيقة فقط

يجب حذف wildcard المشتق ضمنيًا من `has_permission` فورًا.

التوصية الأقوى:

- لا تُخزن wildcard في جدول `permissions` أو `role_permissions`.
- `has_permission` يطابق مفتاحًا قانونيًا واحدًا مطابقة دقيقة فقط.
- تحديد موديول كامل في شاشة Pivot يوسع الاختيار إلى المفاتيح الخرسانية الحالية
  ويحفظها كصفوف عادية.
- يجوز لقالب دور أن يستخدم Pattern DSL موثقًا، لكن RPC إنشاء الدور توسع النمط
  إلى مفاتيح خرسانية قبل الحفظ.

هذا يجعل التدقيق، العدادات، المقارنة، والـrevocation واضحة ولا يترك صلاحيات
مستقبلية تُمنح تلقائيًا عند إضافة resource جديد.

### 3.2 S2 يحتاج تصحيح النطاق

الخلل الحي موجود في سياسات `role_permissions` التي تستخدم subquery على
`user_organizations.is_org_admin = true` دون `is_active`.

أما سياسات `roles` الحية فتستدعي بالفعل:

```sql
is_org_admin(org_id)
```

ودالة `is_org_admin` تفحص `is_active = true`؛ لذلك لا ينبغي إعادة كتابة سياسات
`roles` بلا حاجة. يقتصر التغيير على `role_permissions` مع اختبارات regression
لسياسات `roles` الحالية.

### 3.3 S3 صحيح مع استثناء موثق

`general_ledger` يستخدم `view/edit` ويعمل وفق مفرداته التاريخية، بينما الموديولات
التسعة الأخرى تستخدم `read/update`. لذلك عبارة «يحجب كل الموديولات» تصح عمليًا
للتسعة الحديثة، مع بقاء Dashboard مفتوحًا وGeneral Ledger حالة استثنائية.

### 3.4 S6 أوسع من تحديث الصلاحيات

عدم الذرية موجود في دورة حياة الدور كاملة:

- إنشاء الدور ثم إدراج صلاحياته.
- تعديل بيانات الدور ثم حذف/إدراج صلاحياته.
- حذف `role_permissions` ثم `user_roles` ثم `roles`.
- تعيين أدوار المستخدمين من العميل.

ينبغي أن تصبح كل هذه العمليات RPC ذرية، وليس
`rpc_set_role_permissions` وحدها.

### 3.5 S7 صحيح ويشمل المسارين

يجب سحب `EXECUTE` من `authenticated` عن النسخ التي تستقبل `p_user_id` لكل من:

- `has_permission(uuid, uuid, varchar)`
- `get_user_permissions(uuid, uuid)`

وتبقى نسخ الإدارة الداخلية لـ`service_role` فقط. واجهة العميل تستخدم دوال تعتمد
`auth.uid()` ولا تقبل هوية مستهدفة.

---

## 4. فجوات إضافية إلزامية

### 🔴 S10 — RBAC غير منفذ على جداول وخدمات الأعمال

لا تكفي إعادة كتابة Hook وشاشة Pivot. يجب إعداد **خريطة إنفاذ** لكل مفتاح:

| Permission key | نقطة الإنفاذ | النوع |
|---|---|---|
| `purchasing.purchase_orders.read` | سياسة SELECT على PO | RLS |
| `purchasing.purchase_orders.create` | RPC إنشاء PO | `wardah_assert_permission` |
| `purchasing.purchase_orders.approve` | RPC اعتماد PO | `wardah_assert_permission` |
| `purchasing.goods_receipts.create` | RPC GRN | `wardah_assert_permission` |
| `inventory.adjustments.approve` | RPC اعتماد التسوية | `wardah_assert_permission` |
| `accounting.entries.reverse` | RPC العكس | `wardah_assert_permission` |

لكل resource/action يجب اختيار واحد صريح:

1. قراءة مباشرة محمية بـRLS دقيقة.
2. كتابة مباشرة محمية بـRLS دقيقة.
3. كتابة عبر RPC ذرية فقط، مع سحب DML المباشر من API roles.

لا يعتبر موديول مكتمل RBAC حتى توجد له خريطة إنفاذ واختبار REST/RPC مباشر.

### 🔴 S11 — العضوية المعطلة لا تسقط صلاحيات المستخدم العادي

المسار العادي في `has_permission` و`get_user_permissions` يربط:

```text
user_roles → role_permissions → permissions
```

دون ربط عضوية نشطة في `user_organizations`.

يجب أن يشترط قرار السماح كله:

- `auth.uid()` هو المستخدم الحالي.
- عضوية `(user_id, org_id)` موجودة و`is_active IS TRUE`.
- `roles.is_active IS TRUE`.
- `modules.is_active IS TRUE`.
- `permissions.is_active IS TRUE` بعد إضافة العمود.
- `expires_at` غير منتهٍ.

اختبار إلزامي: تعطيل العضوية مع بقاء `user_roles` يجب أن يجعل كل الفحوصات false
فورًا.

### 🔴 S12 — لا يوجد قيد يضمن تطابق مؤسسة الدور والتعيين

`user_roles` يملك FKs منفصلة إلى `roles` و`organizations`، لكنه لا يضمن:

```text
user_roles.role_id belongs to user_roles.org_id
```

كما لا يضمن أن `(user_id, org_id)` عضوية فعلية.

الإصلاح الدفاعي المقترح:

```sql
ALTER TABLE roles
  ADD CONSTRAINT roles_id_org_id_key UNIQUE (id, org_id);

ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_org_fkey
  FOREIGN KEY (role_id, org_id)
  REFERENCES roles(id, org_id)
  ON DELETE CASCADE;

ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_member_org_fkey
  FOREIGN KEY (user_id, org_id)
  REFERENCES user_organizations(user_id, org_id)
  ON DELETE CASCADE;
```

`user_roles` فارغ حاليًا، ولذلك هذه أفضل نافذة لإضافة القيود والتحقق منها.

### 🔴 S13 — قوالب الأدوار معطوبة ويجب عزلها قبل P5

لا ينبغي إبقاء تحديث القوالب إلى المرحلة P5 فقط بينما الشاشة الحالية تسمح
باستخدامها.

الإجراء المبكر:

- تقرير P0 لكل قالب: resolved/unresolved/expanded count.
- تعطيل القوالب غير الصالحة مؤقتًا (`is_active = false`) أو منع عرضها.
- جعل RPC إنشاء الدور تفشل بالكامل إذا كان أي Pattern غير صالح أو إذا كانت
  النتيجة صفر صلاحيات.
- عدم إنشاء دور جزئي بصمت.
- إعادة بناء القوالب القانونية في مرحلة توسيع الكتالوج.

### 🟠 S14 — تعارض حفظ المصفوفة المتزامن

`rpc_set_role_permissions` بنمط الاستبدال الكامل معرض لآخر كاتب يفوز إذا فتح
مديران الشاشة معًا.

يضاف إلى `roles` حقل إصدار، مثل:

```text
permissions_version bigint default 0
```

وتستقبل RPC:

```text
p_expected_version
```

ترفض الحفظ عند عدم التطابق، ثم تزيد الإصدار ذريًا. تعرض الواجهة رسالة تعارض
وتطلب إعادة التحميل بدل الكتابة فوق تعديل آخر.

### 🟠 S15 — استراتيجية التدقيق قد تسجل الحدث مرتين

الخطة الأصلية تقول إن RPC في migration 151 تكتب audit، ثم migration 153 تضيف
Triggers على الجداول. هذا قد ينتج سجلين للعملية نفسها.

الوضع الحالي يحتوي أصلًا:

- جدول `audit_logs` وفيه سجلات حية.
- Trigger على `roles`.
- Trigger على `user_roles`.
- لا يوجد Trigger على `role_permissions`.
- `log_activity()` يبتلع أخطاء التدقيق بـ`RAISE WARNING`، وهو غير مناسب لتغيير
  صلاحيات حساس.

يجب اختيار مصدر حقيقة واحد للتدقيق الأمني:

- **المفضل:** Trigger متخصص fail-closed يسجل كل تغيير فعلي، بينما RPC تمرر
  `reason/request_id` عبر transaction-local context.
- لا تكتب RPC صفًا ثانيًا يدويًا لنفس التغيير.
- `ip_address` و`user_agent` بيانات best-effort ولا تعد دليل هوية مستقلًا.
- منع UPDATE/DELETE عبر RLS وحده لا يكفي لمالك الجدول؛ يضاف Trigger منع أو مسار
  صيانة موثق.

---

## 5. تعديلات النموذج المستهدف

### 5.1 الأفعال

لا يعامل `delete` كمرادف عام لـ«إلغاء». الكتالوج الأساسي يبقى:

```text
read, create, update, delete, approve, export
```

وتضاف أفعال دورة الحياة عند الحاجة:

```text
submit, post, cancel, reverse, assign, manage
```

قواعد مهمة:

- `delete` للسجل القابل للحذف قانونيًا قبل الترحيل فقط.
- `cancel` لإلغاء وثيقة تشغيلية.
- `reverse` لعكس أثر مالي مرحل.
- `post` للترحيل المحاسبي أو المخزني.
- لا تمنح `update` تلقائيًا `approve/post/reverse`.

### 5.2 لا wildcard محفوظًا في الأدوار

المفتاح القانوني دائمًا ثلاثة أجزاء خرسانية:

```text
<module>.<resource>.<action>
```

النجمة و`%` ممنوعتان في `permissions.permission_key` وفي التعيينات النهائية.
الاختيار الجماعي في الواجهة والقوالب يوسع إلى قائمة مفاتيح قانونية لحظة الحفظ.

### 5.3 توافق الواجهة القديمة

لا تترجم:

```text
hasPermission(module, action)
```

إلى:

```text
can(module, '*', action)
```

لأن ذلك إما يفشل دائمًا عند عدم وجود wildcard، أو يعيد منطق «أي صلاحية تمنح
الموديول» بصورة غير واضحة.

التقسيم المقترح:

- `can(module, resource, action)`: قرار دقيق فقط.
- `canAccessModule(module)`: true إذا امتلك المستخدم صلاحية `read` واحدة على
  الأقل داخل الموديول؛ تستخدم للتنقل والمسار الرئيسي فقط.
- `canAny(keys[])` و`canAll(keys[])`: مفاتيح ثلاثية صريحة.
- `hasPermission(module, action)`: deprecated مؤقتًا، ولا تستخدم لحماية mutation.

كل sub-route وزر mutation يجب نقله إلى مفتاح ثلاثي قبل حذف واجهة التوافق.

### 5.4 موديولات الإدارة

لا يوصى بإضافة `super_admin` كصلاحيات قابلة للإسناد إلى أدوار المؤسسات؛ صفة
Super Admin مصدرها `super_admins` وحارس مستقل.

كذلك `org_admin` هو مستوى عضوية، لا permission عادية. يمكن إضافة موديول
`security` أو `settings` بموارد:

```text
roles, users, invitations, audit_log
```

فقط إذا تقرر لاحقًا تفويض بعض مهام الإدارة لغير Org Admin. أما شاشة إدارة
المنصة فتظل `requireSuperAdmin` ولا يمكن اكتسابها من Matrix مؤسسة.

### 5.5 تجاوزات الإدارة

لا يسجل كل فحص قراءة ناجح حتى لا يتحول التدقيق إلى ضوضاء. يسجل على الأقل:

- كل mutation نفذ عبر bypass إداري.
- كل وصول Super Admin إلى مؤسسة غير مؤسسته التشغيلية.
- تغييرات العضوية والأدوار والقوالب والكتالوج.
- عمليات export الحساسة.

---

## 6. ترقيم migrations المعدل

فرع `review/migration-148-hardening-2` يحتوي حاليًا:

- `148_uom_purchase_receipt_snapshots.sql`
- `149_require_approved_po_for_receipt.sql`

لذلك أرقام خطة RBAC تصبح، بعد دمج فرع GRN:

| Migration | المحتوى المعدل |
|---|---|
| **150** | `permission_catalog_normalization_and_integrity` |
| **151** | `permission_evaluation_hardening` |
| **152** | `rbac_policy_active_membership` |
| **153** | `rbac_atomic_admin_api` |
| **154** | `seed_subservice_permissions_and_templates` |
| **155** | `permission_audit_hardening` |

الأرقام تظل provisional حتى rebase على `main` وقت بدء التنفيذ.

### 6.1 Migration 150

- إضافة `modules.code` وتعبئته من `name` مع unique index.
- إضافة `permissions.is_active` و`display_order`.
- جعل `action_canonical` Generated Stored أو فرض اتساقه بقيد/trigger؛ لا يترك
  كعمود قابل للانحراف عن `action`.
- منع `*` و`%` في المفاتيح القانونية.
- إضافة القيود المركبة لـ`user_roles` المذكورة في S12.
- تقرير canonical duplicates قبل أي unique index.
- عزل القوالب غير الصالحة مؤقتًا.

### 6.2 Migration 151

- مطابقة دقيقة فقط، بلا wildcard.
- اشتراط العضوية النشطة والدور والموديول والصلاحية النشطة وعدم انتهاء التعيين.
- نسخة self تعتمد `auth.uid()`.
- سحب النسخ ذات `p_user_id` من `PUBLIC`, `anon`, `authenticated` ومنحها
  لـ`service_role` فقط عند الحاجة.
- `REVOKE/GRANT` بالتوقيع الكامل لكل overload.

### 6.3 Migration 152

- تعديل سياسات `role_permissions` فقط لاستخدام `is_org_admin`.
- عدم إعادة كتابة سياسات `roles` الصحيحة بلا سبب.
- مراجعة سياسات `stock_adjustments` وغيرها التي لا تفحص العضوية النشطة ضمن خطة
  الإنفاذ الموديولية.

### 6.4 Migration 153

RPC المقترحة:

- `rpc_get_permission_matrix`
- `rpc_create_role`
- `rpc_update_role`
- `rpc_archive_role` بدل الحذف المادي افتراضيًا
- `rpc_set_role_permissions(..., p_expected_version)`
- `rpc_assign_user_roles(..., p_expected_version)`
- `rpc_my_permissions`
- `rpc_create_role_from_template_safe`

`rpc_toggle_role_permission` لا يحتاج أن يدخل النسخة الأولى لأن الشاشة تعتمد
حفظًا صريحًا مجمعًا. تقليل عدد RPC يقلل سطح الهجوم.

كل RPC كتابة:

- حارس الإدارة أول تعليمة تشغيلية.
- يتحقق أن كل role/user/permission داخل النطاق الصحيح ونشط.
- يرفض unknown أو inactive keys.
- يرفض تعديل System role.
- يقفل الصف المستهدف أو يستخدم version optimistic.
- ذرية بالكامل.
- `REVOKE FROM PUBLIC, anon` قبل `GRANT authenticated` بالتوقيع الكامل.

### 6.5 Migration 154

- توسيع resources بعد جرد routes والخدمات وRPC الفعلية.
- إضافة أفعال دورة الحياة اللازمة.
- إعادة بناء القوالب الـ17 من مفاتيح قانونية أو Pattern DSL موثق يوسع إلى مفاتيح
  قانونية.
- عدم إنشاء موديول `super_admin` قابل للإسناد.
- إنشاء/تحديث Permission Enforcement Map كـartifact إلزامي.

### 6.6 Migration 155

- حسم قرار استخدام `audit_logs` الحالي أو ledger متخصص.
- منع الازدواج بين كتابة RPC وTriggers.
- Trigger متخصص على `role_permissions` وعمليات RBAC غير المغطاة.
- التدقيق الأمني fail-closed.
- actor, org, role/user, before/after, reason, request_id, source، ووقت الخادم.
- سياسة retention ومسار صيانة موثق.

---

## 7. مراحل التنفيذ المعدلة

| المرحلة | المحتوى | البوابة |
|---|---|---|
| P0 | Baseline + تقرير القوالب + تقرير من يفقد ماذا + جرد نقاط الإنفاذ | مراجعة بشرية |
| P1 | 150–152: سلامة الكتالوج والتقييم والسياسات | Fresh DB + negative SQL |
| P2 | 153: RPC ذرية + عزل الكتابة المباشرة من صفحة الأدوار | CI كامل |
| P3 | `usePermissions` + `can/canAccessModule` + الحرّاس الدقيقة | TS + ESLint + unit |
| P4 | Pilot إنفاذ خادمي على `settings/security` ثم `purchasing` | REST/RPC denial tests |
| P5 | شاشة Pivot مع optimistic concurrency | i18n + a11y + tests |
| P6 | 154: توسيع الكتالوج والقوالب + rollout لكل الموديولات | Enforcement map مكتملة |
| P7 | 155: تدقيق أمني وعرض السجل | exactly-once audit tests |
| P8 | E2E متعدد المؤسسات والأدوار على staging | Playwright artifact |

لا تنتقل خدمة إلى «RBAC مكتمل» بمجرد ظهورها في Pivot؛ تنتقل فقط بعد ربط جميع
عملياتها الحساسة بنقطة إنفاذ خادمية واختبارها.

---

## 8. اختبارات إضافية إلزامية

### SQL/Fresh DB

- العضوية المعطلة تسقط جميع الصلاحيات رغم بقاء `user_roles`.
- الدور المعطل، الموديول المعطل، والصلاحية المعطلة تسقط القرار.
- لا يمكن ربط مستخدم أو دور من مؤسسة أخرى في `user_roles` حتى عبر SQL مباشر.
- لا تقبل RPC مفتاحًا مجهولًا أو غير نشط.
- لا توجد نجمة أو `%` في مفاتيح `permissions` النهائية.
- القالب غير الصالح يفشل كاملًا ولا ينشئ دورًا فارغًا.
- القالب الصالح يوسع إلى العدد المتوقع من المفاتيح الخرسانية.
- نسخة `p_user_id` غير قابلة للتنفيذ من `authenticated`.
- Org Admin معطل يرفض على `role_permissions`; سياسات `roles` تبقى ناجحة للعضو
  النشط وفاشلة للمعطل.
- تعارض `permissions_version` يعيد خطأ conflict ولا يطمس التعديل السابق.
- كل mutation صلاحيات تنتج سجل تدقيق واحدًا فقط.

### واجهة

- `canAccessModule` يسمح بدخول الموديول عند وجود resource واحد مقروء فقط.
- دخول الموديول لا يمنح أزرار create/update/delete لخدمات أخرى.
- cache يعزل `(userId, orgId)` ويبطل فور نجاح mutation.
- تغيير المؤسسة أثناء الطلب لا يحقن نتيجة المؤسسة السابقة في الواجهة.
- System role ونسخة stale من الدور لا يمكن حفظهما.

### E2E/API

لكل موديول Pilot:

1. المستخدم يرى فقط resource الممنوح.
2. الزر غير الممنوح غير ظاهر.
3. REST مباشر للعملية غير الممنوحة يفشل.
4. RPC مباشرة للعملية غير الممنوحة تفشل.
5. نفس العملية تنجح بعد المنح وإبطال الكاش.
6. العملية تفشل فور تعطيل العضوية أو انتهاء التعيين.
7. محاولة Org B على كائن Org A تفشل حتى مع permission key مماثل.

---

## 9. مخاطر إضافية

| الخطر | التخفيف |
|---|---|
| استدعاء دالة صلاحية لكل صف يبطئ RLS | فهرسة صحيحة، `SELECT` init-plan حيث يلزم، وقياس `EXPLAIN ANALYZE` |
| recursion بين RLS وجداول RBAC | helpers محدودة ومراجعة `SECURITY DEFINER` مع `search_path` ثابت |
| قفل الأدمن خارج النظام | حساب break-glass موثق واختبار rollback قبل تفعيل السياسات |
| stale cache بعد تعديل دور | TanStack invalidation + version في الاستجابة + مدة قصيرة |
| دور جديد من قالب ناقص | fail-closed وعدم السماح بالإنشاء الجزئي |
| حفظان متزامنان للمصفوفة | optimistic concurrency |
| تضخم سجل التدقيق | retention وpartitioning عند الحاجة، دون السماح للمستخدم بحذفه |
| تعارض أرقام migration بين الفروع | rebase قبل التنفيذ وفحص أسماء migration على main وProduction |

---

## 10. قرارات مطلوبة قبل كتابة SQL

- [ ] اعتماد المطابقة الدقيقة فقط وعدم تخزين wildcard في الأدوار.
- [ ] اعتماد ترقيم 150–155 بعد دمج GRN 148/149.
- [ ] اعتماد `audit_logs` الحالي بعد تقويته أو ledger متخصص واحد، لا مسارين
      متوازيين لنفس الحدث.
- [ ] اعتماد `canAccessModule` بدل ترجمة التوافق إلى `resource='*'`.
- [ ] اعتماد أفعال دورة الحياة `submit/post/cancel/reverse` للموارد التي تحتاجها.
- [ ] عدم جعل `super_admin` permission قابلة للإسناد داخل المؤسسة.
- [ ] نقل إصلاح القوالب المعطوبة من P5 المتأخر إلى P0/P1 للعزل وP6 لإعادة البناء.
- [ ] جعل خريطة الإنفاذ الخادمي مخرجًا إلزاميًا لكل موديول.

---

## 11. التقييم النهائي

الخطة الأصلية **ممتازة كخطة اكتشاف وتصميم واجهة**، وتقييمها بعد الفحص:

- دقة وصف الكتالوج والواجهة: عالية.
- معالجة wildcard وكتابة الأدوار: صحيحة في الجوهر.
- تصميم Pivot: عملي ومناسب.
- تغطية الإنفاذ الخادمي: غير كافية قبل هذه المراجعة.
- سلامة العضوية والعلاقات المركبة: كانت ناقصة.
- خطة القوالب: كانت متأخرة مقارنة بخطرها الحي.
- ترقيم migrations: أصبح متعارضًا مع فرع GRN النشط.

بعد دمج التصحيحات الواردة هنا في الوثيقة الأصلية، تصبح الخطة قابلة للتحويل إلى
Backlog تنفيذي وPRs مستقلة دون إنشاء نظام RBAC ثانٍ أو الاعتماد على الواجهة كخط
دفاع.
