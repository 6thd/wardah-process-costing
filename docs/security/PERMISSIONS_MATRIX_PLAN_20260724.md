# خطة نظام الصلاحيات الدقيق (Module × Sub-service × Action)

> **بسم الله الرحمن الرحيم**
>
> **الحالة:** خطة — لم يُنفَّذ منها شيء بعد.
> **تاريخ الفحص:** 2026-07-24
> **نطاق الفحص:** قراءة فقط — لم يُعدَّل أي ملف ولا أي كائن في قاعدة البيانات.
> **آخر migration في Repository وProduction:** 147 (متطابقان) ⇒ أي عمل جديد يبدأ من 148.

---

## جدول المحتويات

1. [خلاصة تنفيذية](#1-خلاصة-تنفيذية)
2. [الوضع الحالي الموثق](#2-الوضع-الحالي-الموثق)
3. [الفجوات المكتشفة](#3-الفجوات-المكتشفة--مرتبة-حسب-الخطورة)
4. [النموذج المستهدف](#4-النموذج-المستهدف)
5. [خطة قاعدة البيانات](#5-خطة-قاعدة-البيانات--migrations-إضافية-من-148)
6. [خطة الواجهة](#6-خطة-الواجهة)
7. [مراحل التنفيذ](#7-مراحل-التنفيذ)
8. [الاختبارات المطلوبة](#8-الاختبارات-المطلوبة)
9. [المخاطر](#9-المخاطر)
10. [ما لا يجب فعله](#10-ما-لا-يجب-فعله--تطبيق-القاعدة-الذهبية)
11. [علاقة هذه الوثيقة بالوثائق القائمة](#11-علاقة-هذه-الوثيقة-بالوثائق-القائمة)

---

## 1) خلاصة تنفيذية

البنية المطلوبة — صلاحيات لكل **موديول** و**خدمة فرعية** مقسّمة إلى قراءة/تعديل/حذف —
**موجودة بالفعل في قاعدة البيانات**، لكن الواجهة والدوال لا تستخدمها.

جدول `permissions` الحي يحتوي **166 صلاحية** موزعة على **10 موديولات** و**39 خدمة فرعية (`resource`)**
بمفتاح ثلاثي `module.resource.action`. أي أن الطبقة الأصعب (نمذجة البيانات) جاهزة.

المشكلة أن ثلاث طبقات فوقها تُسقط البُعد الأوسط (`resource`) أو تكسره:

- `usePermissions` يقرأ `module.name` و`action` فقط ويرمي `resource`.
- `ModuleGuard` يسأل عن `action='view'` بينما البذرة الحية تستخدم `read` لتسعة موديولات من عشرة.
- `has_permission` في قاعدة البيانات فيه **wildcard يمنح كل صلاحيات الموديول** لمن يملك أي صلاحية فيه.

**النتيجة الحالية:** النظام يبدو عاملاً فقط لأن المستخدم الوحيد هو `is_org_admin` ويتجاوز كل الفحوصات
(`user_roles` = 0 صفوف). أول مستخدم غير-أدمن سيُحجب عن كل الموديولات.

فالخطة ليست «بناء نظام صلاحيات» بل **إصلاح المسار من الجدول إلى الشاشة + بناء واجهة Pivot**.

---

## 2) الوضع الحالي الموثق

### 2.1 قاعدة البيانات الحية (`uutfztmqvajmsxnrqeiv`)

| الجدول | الحالة | RLS | Policies |
|---|---|---|---|
| `modules` | 10 صفوف | ✅ | 4 |
| `permissions` | 166 صف / 39 resource / 8 actions | ✅ | 4 |
| `roles` | 2 | ✅ | 4 |
| `role_permissions` | 166 | ✅ | 4 |
| `user_roles` | **0** | ✅ | 4 |
| `role_templates` | 17 | ✅ | 4 |
| `user_organizations` | 1 | ✅ | 4 |
| `super_admins` | **0** | ✅ | 4 |

توزيع الصلاحيات الحية لكل موديول:

| Module | Perms | Resources (الخدمات الفرعية) | Actions |
|---|---|---|---|
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

> لاحظ التعارض: `general_ledger` وحده يستعمل `view`/`edit`، والتسعة الباقون يستعملون `read`/`update`.

### 2.2 الكود

| الملف | الدور |
|---|---|
| `sql/migrations/40_multi_tenant_rbac_schema.sql` | مخطط RBAC + دالة `create_crud_permissions` |
| `sql/migrations/41_multi_tenant_rls_policies.sql:306` | `has_permission` |
| `sql/migrations/41_multi_tenant_rls_policies.sql:357` | `get_user_permissions` |
| `sql/migrations/53_seed_permissions_data.sql` | بذرة ثانية بنمط مفاتيح مختلف |
| `src/hooks/usePermissions.ts` | مصدر الحقيقة في الواجهة |
| `src/services/rbac-service.ts` | خدمة RBAC كاملة لكن **غير مستعملة من صفحة الأدوار** |
| `src/config/module-permissions.ts` | خريطة الموديولات + `subModules` |
| `src/components/auth/ModuleGuard.tsx` | حارس المسارات |
| `src/components/auth/ProtectedComponent.tsx` | حارس العناصر (+ نسخة مكرّرة في `withPermission.tsx`) |
| `src/pages/org-admin/roles.tsx` | واجهة الأدوار (Accordion، كتابة مباشرة على الجداول) |

---

## 3) الفجوات المكتشفة — مرتبة حسب الخطورة

### 🔴 S1 — `has_permission` يمنح صلاحيات لم تُمنح (تصعيد امتياز)

`sql/migrations/41_multi_tenant_rls_policies.sql:337`

```sql
p.permission_key LIKE REPLACE(SPLIT_PART(p_permission_key, '.', 1) || '.%', '*', '%')
```

الشرط يقتطع **الجزء الأول فقط** من المفتاح المطلوب ويطابق أي مفتاح يبدأ به.

عملياً: مستخدم يملك `inventory.items.read` يجتاز فحص `inventory.adjustments.delete`.
أي أن التقسيم إلى قراءة/تعديل/حذف **معطّل تماماً على مستوى قاعدة البيانات**،
والصلاحية الفعلية هي «موديول كامل» لا أكثر.

### 🔴 S2 — سياسات `roles` و`role_permissions` لا تفحص `is_active`

سياسات `role_permissions_{ins,upd,del}_m` و`roles_*` تستعمل subquery مضمّناً:

```sql
user_organizations.user_id = auth.uid() AND user_organizations.is_org_admin = true
```

بدون `AND is_active = true` — وهذا يخالف قاعدة `CLAUDE.md`:
«العضوية النشطة تعني `is_active IS TRUE`».
أدمن منظمة مُعطَّل يحتفظ بصلاحية تعديل الأدوار والصلاحيات.

> دالة `is_org_admin(uuid)` نفسها **صحيحة** وتفحص `is_active`؛ الخلل في الـ subqueries المضمّنة فقط.

### 🟠 S3 — تعارض مفردات الأفعال بين الواجهة والبيانات

`ModuleGuard` يستدعي `hasPermission(moduleCode, 'view')` لكل مسار (`routes.tsx:44`)،
و`ACTIONS` في `module-permissions.ts` يعرّف `VIEW`/`EDIT`.
البيانات الحية تستعمل `read`/`update` لتسعة موديولات، و`view`/`edit` لـ `general_ledger` فقط.

⇒ أول مستخدم غير-أدمن يُحجب عن كل شيء. الخلل مخفي حالياً لأن `user_roles` فارغ.

### 🟠 S4 — الواجهة تُسقط بُعد الخدمة الفرعية

`usePermissions.ts:173` يبني `{ module_code, action }` من `permission.module.name` ويهمل `permission.resource`.
وكل `subModules` في `module-permissions.ts` تشير إلى صلاحية الأب نفسها
(مثال: `inventory_adjustments` → `{ inventory, edit }`).

⇒ **لا توجد دقة على مستوى الخدمة الفرعية في الواجهة إطلاقاً** رغم توفرها في البيانات.

### 🟠 S5 — `/org-admin/*` بلا حارس على مستوى الراوتر

`routes.tsx:187` يحمّل `OrgAdminModule` بلا `ModuleGuard`.
الحماية موجودة داخل `pages/org-admin/index.tsx` (فحص `isOrgAdmin`) لكنها فحص متأخر بعد تحميل الوحدة،
ومسار `super-admin` يستعمل نمطاً مختلفاً (`SuperAdminGuard` + `setTimeout(3000)` قبل التوجيه).
النمط غير موحّد بين المسارين.

### 🟡 S6 — كتابة الأدوار من العميل بلا ذرية

`pages/org-admin/roles.tsx:307-321` — `DELETE role_permissions` ثم `INSERT` كطلبين منفصلين.
انقطاع بينهما ⇒ دور بلا صلاحيات. يخالف قاعدة «الكتابة التشغيلية داخل RPC ذرية واحدة».

كما أن `handleDeleteRole` يتجاوز فحص `is_system_role` الموجود في `rbac-service.deleteRole`
لأن الصفحة لا تستدعي الخدمة أصلاً.

### 🟡 S7 — `has_permission` / `get_user_permissions` تقبلان `p_user_id` عشوائياً

كلاهما `SECURITY DEFINER` مع `GRANT EXECUTE` لـ `authenticated`، وتأخذان `p_user_id` كوسيط.
أي مستخدم مصادَق يستطيع تعداد صلاحيات أي مستخدم آخر (كشف معلومات).

### 🟡 S8 — مصدرا بذر متعارضان

- `40_multi_tenant_rbac_schema.sql` ينتج `module.resource.action` (٣ أجزاء — الشكل الحي).
- `53_seed_permissions_data.sql` ينتج `module.module.action` وأفعالاً مختلفة (`view/edit/import/print`).
- `checkPermission` في `usePermissions.ts:309` يبني مفتاحاً من **جزأين** `${module}.${action}` لا يطابق أياً منهما.

### 🟡 S9 — تكرار وتشتت

- `withPermission` مُعرَّف مرتين (`ProtectedComponent.tsx` و`withPermission.tsx`).
- كاش الصلاحيات مُنفَّذ مرتين (`usePermissions.ts` على مستوى الموديول + `rbac-service.ts`)
  بدون إبطال مشترك عند تغيير الأدوار.
- `rbac-service.ts` — الأنظف والأكمل — غير مستعمل من صفحة الأدوار.

---

## 4) النموذج المستهدف

### 4.1 المفتاح القانوني

```
<module>.<resource>.<action>
```

ثلاثة أجزاء دائماً. `resource` = الخدمة الفرعية. لا مفاتيح من جزأين، ولا wildcard مشتق ضمنياً.

### 4.2 مفردات الأفعال الموحّدة

| Action | عربي | الدلالة |
|---|---|---|
| `read` | قراءة | عرض القوائم والتفاصيل |
| `create` | إنشاء | إنشاء سجل جديد |
| `update` | تعديل | تعديل سجل قائم |
| `delete` | حذف | حذف / إلغاء |
| `approve` | اعتماد | ترحيل / اعتماد (اختياري لكل `resource`) |
| `export` | تصدير | تصدير / طباعة (اختياري) |

`read/create/update/delete` هي الأساس المطلوب، و`approve/export` تُفعّل لكل خدمة فرعية على حدة.

`view`/`edit` تُعامَل **كمرادفات تاريخية**: تبقى في القاعدة (القاعدة الذهبية — لا حذف)
وتُطبَّع في طبقة القراءة فقط.

### 4.3 نموذج القرار

```
Super Admin              → يتجاوز كل شيء (يجب أن يُسجَّل في audit)
Org Admin (is_active)    → كل صلاحيات منظمته
غير ذلك                  → مطابقة دقيقة لمفتاح ثلاثي عبر user_roles → role_permissions
                            مع احترام expires_at و roles.is_active
Fail-closed              → غياب المفتاح = رفض، بلا استنتاج ولا wildcard ضمني
```

### 4.4 من يرى شاشة الصلاحيات

- **Super Admin:** كل المنظمات + إدارة كتالوج `modules` / `permissions` / `role_templates`.
- **Org Admin:** منظمته فقط، أدوارها فقط، بلا مساس بالكتالوج.
- **غير ذلك:** الشاشة غير ظاهرة أصلاً، ومحجوبة في الراوتر، ومرفوضة في RLS (ثلاث طبقات).

---

## 5) خطة قاعدة البيانات — migrations إضافية من 148

كلها `CREATE OR REPLACE` / أعمدة nullable / سياسات جديدة.
**لا حذف لأي جدول أو عمود أو صف تاريخي.**

### 148 — `148_permission_catalog_normalization.sql`

- إضافة أعمدة **nullable** إلى `permissions`:
  - `action_canonical text` — `read/create/update/delete/approve/export`
  - `is_active boolean DEFAULT true`
  - `display_order int`
- إضافة `code`, `display_order`, `is_active` إلى `modules` عند الغياب (`code` = `name` كقيمة أولية).
- `UPDATE` لتعبئة `action_canonical`: `view→read`, `edit→update`, وإلا الفعل نفسه.
- قيد `CHECK ... NOT VALID` على `permission_key ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+$'` —
  يمنع المفاتيح الجديدة الخاطئة دون كسر أي صف تاريخي.
- **لا حذف** لمفاتيح `module.module.action` الناتجة عن البذرة الثانية؛ تُعلَّم `is_active = false` فقط.
- Index: `permissions(module_id, resource, action_canonical)`.

### 149 — `149_fix_has_permission_wildcard.sql` 🔴 الأهم

`CREATE OR REPLACE FUNCTION has_permission(...)`:

- إزالة مطابقة `LIKE` على الجزء الأول (سبب S1).
- المطابقة الدقيقة: `p.permission_key = p_permission_key`.
- دعم wildcard **صريح فقط**: مفتاح مخزَّن `inventory.*.*` أو `inventory.items.*` يُطابق نزولاً؛
  ولا يُشتق أي wildcard من المفتاح المطلوب.
- تطبيع الفعل عبر `action_canonical` ليجتاز `view`/`read` الفحص نفسه.
- إضافة `AND r.is_active = true` على `roles` (غائب حالياً في `has_permission`).
- الإبقاء على فحص `expires_at`.
- `SET search_path = public, pg_temp`.
- إضافة overload `has_permission(p_org_id, p_permission_key)` يستنتج `auth.uid()` داخلياً،
  وسحب `EXECUTE` من النسخة ذات `p_user_id` عن `authenticated` (يعالج S7)
  مع إبقائها لـ `service_role`.
- **اختبار سلبي إلزامي:** دور يملك `inventory.items.read` فقط ⇒ `inventory.adjustments.delete` = `false`.

> ⚠️ هذا التغيير **يشدّ** الصلاحيات. يجب أن يسبقه تقرير «من يفقد ماذا»
> (استعلام قبل/بعد لكل صف في `user_roles`).
> حالياً `user_roles` فارغ ⇒ الأثر صفري، وهذه أفضل نافذة زمنية لتطبيقه.

### 150 — `150_rbac_policy_active_membership.sql` 🔴

إعادة كتابة سياسات `roles` و`role_permissions` لتستدعي `is_org_admin(org_id)`
بدل الـ subquery المضمّن الذي يهمل `is_active` — يعالج S2.

سياسة `SELECT` تبقى أوسع (عضو المنظمة يقرأ أدوار منظمته) لكن عبر `get_user_org_ids()`
التي تفحص `is_active` أصلاً.

### 151 — `151_rpc_role_permission_matrix.sql`

RPC ذرية بحارس معروف، تحل محل الكتابة المباشرة من العميل (يعالج S6):

| RPC | الوظيفة |
|---|---|
| `rpc_get_permission_matrix(p_org_id)` | الكتالوج + الأدوار + التعيينات في استدعاء واحد لبناء الـ Pivot |
| `rpc_set_role_permissions(p_org_id, p_role_id, p_permission_keys[])` | استبدال ذري كامل، يرفض `is_system_role`، يكتب audit |
| `rpc_toggle_role_permission(p_org_id, p_role_id, p_permission_key, p_granted)` | تبديل خلية واحدة (نمط Pivot) |
| `rpc_assign_user_roles(p_org_id, p_user_id, p_role_ids[])` | تعيين ذري لأدوار مستخدم |
| `rpc_my_permissions(p_org_id)` | مفاتيح المستخدم الحالي فقط — بديل آمن لـ `get_user_permissions` |

كلها: `SECURITY DEFINER` + `wardah_assert_org_admin(p_org_id)` كأول تعليمة،
مع `REVOKE EXECUTE ... FROM PUBLIC` و`GRANT` لـ `authenticated` فقط.

> `wardah_assert_org_admin` ليست ممنوحة لـ `authenticated` حالياً — وهذا صحيح؛
> فهي تُستدعى من داخل دوال `SECURITY DEFINER` لا من العميل.

### 152 — `152_seed_subservice_permissions.sql`

توسيع الكتالوج ليغطي الخدمات الفرعية الفعلية في التطبيق والناقصة اليوم،
عبر `create_crud_permissions` مع `ON CONFLICT DO NOTHING` (additive بحت). أمثلة من فحص الكود:

- `inventory`: `bins`, `transfers`, `valuation`, `uom`
- `manufacturing`: `wip`, `mo_completion`
- `purchasing`: `goods_receipts`
- `sales`: `collections`
- `general_ledger`: `journal_entries`, `trial_balance`, `gl_entries`
- `settings`: `system`, `backup`, `integrations`, `company`
- إضافة موديولَي `org_admin` و`super_admin` مع resources:
  `users`, `roles`, `invitations`, `audit_log`, `organizations`

### 153 — `153_permission_change_audit.sql`

جدول `permission_audit_log` (append-only): من غيّر أي مفتاح لأي دور،
القيمة قبل/بعد، `org_id`, `actor`, `at`, `ip`.

Trigger على `role_permissions` و`user_roles`.
السياسة: قراءة لأدمن المنظمة، و**لا `UPDATE` ولا `DELETE` لأحد**.
هذا ما يجعل تجاوز Super Admin مقبولاً في التدقيق.

---

## 6) خطة الواجهة

### 6.1 طبقة القراءة — `usePermissions` (إعادة كتابة، لا استبدال API)

- الانتقال إلى `rpc_my_permissions(orgId)` → `Set<string>` من مفاتيح ثلاثية.
- الاحتفاظ بالتوقيع الحالي `hasPermission(module, action)` **كواجهة توافق**
  تُترجَم إلى `can(module, '*', action)` حتى لا تنكسر الاستدعاءات القائمة.
- إضافة التوقيع الدقيق: `can(module, resource, action)` و`canAny` / `canAll`.
- تطبيع الفعل عند الفحص (`view→read`, `edit→update`) — يعالج S3 دون لمس البيانات.
- نقل الكاش إلى TanStack Query بمفتاح `['permissions', userId, orgId]`
  بدل المتغير على مستوى الموديول، مع `invalidateQueries` بعد أي RPC كتابة (يعالج S9).
- إبقاء تجاوز Org Admin / Super Admin، لكن بعلَم صريح `bypassReason` يُعرض في الواجهة
  («لديك وصول كامل بصفتك أدمن المنظمة») بدل الصمت.

### 6.2 الحرّاس

- توحيد `ModuleGuard` / `ProtectedComponent` / `withPermission` على تنفيذ واحد،
  مع إبقاء الأسماء الثلاثة كـ re-export (لا كسر للمستدعين).
- `guardedLazy` في `routes.tsx` تنتقل من `action="view"` إلى `action="read"` بعد التطبيع.
- **إضافة حارس صريح لـ `/org-admin/*`** (`requireOrgAdmin`) و`/super-admin/*` (`requireSuperAdmin`)
  في `routes.tsx` — يعالج S5، مع إبقاء الحارس الداخلي كطبقة ثانية.
- ربط `module-permissions.ts` بـ `resource` حقيقي لكل `subModule`
  (مثال: `inventory_adjustments` → `{ inventory, adjustments, read }`) — يعالج S4.

### 6.3 شاشة الـ Pivot — `/settings/permissions`

المسار `/settings/permissions` يعيد التوجيه حالياً إلى `/org-admin/roles`.
**المقترح:** يصبح الشاشة الحقيقية، ويبقى `/org-admin/roles` يوجّه إليه
(عكس اتجاه التوجيه، بلا كسر أي رابط قائم).

**التخطيط:**

```
الصفوف (هرمي، قابل للطي)          الأعمدة (دور واحد لكل عمود)
─────────────────────────────     ──────────────────────────────
▼ المخزون                    │ محاسب │ أمين مخزن │ مشرف │ …
    الأصناف                  │  ◐ R  │   ● RUD   │  ● * │
    التسويات                 │  ○    │   ◐ RU    │  ● * │
    المستودعات               │  ○    │   ● RUD   │  ● * │
▶ المبيعات                   │  ●    │   ○       │  ● * │
```

- **الخلية** = تقاطع (خدمة فرعية × دور)، وتحتوي شرائح صغيرة: `R U D` (+ `A`/`E` عند التفعيل).
- **رأس الصف** (اسم الموديول) = تحديد/إلغاء الموديول كاملاً لذلك الدور.
- **عمود الدور** يعرض عدّاداً حياً «٤٢/١٦٦».
- **ثلاث حالات بصرية:** `○` بلا صلاحية، `◐` جزئي، `●` كامل.
- **تجميد** العمود الأول والصف الأول (في RTL: العمود الأول على اليمين).
- **بحث وفلترة** بالموديول/الخدمة/الفعل + «إظهار الممنوح فقط».
- **حفظ صريح** مع «٧ تغييرات غير محفوظة» وزر تراجع — لا حفظ تلقائي عند كل نقرة.
- **أدوار النظام** (`is_system_role`) تُعرض للقراءة فقط بقفل ظاهر.
- الحفظ عبر `rpc_set_role_permissions` (استبدال ذري) لا عبر delete + insert.

**i18n:** كل النصوص عبر `t()`.
النمط الحالي `isRTL ? 'عربي' : 'English'` المستعمل في `src/features/settings/index.tsx`
تمنعه البوابة الحاجزة ولا يجوز نسخه إلى الشاشة الجديدة.

**الأداء:** 39 خدمة × ٤ أفعال × N أدوار.
التحديد عبر `Set<string>` من المفاتيح + `useMemo` لكل صف،
مع virtualization إذا تجاوزت الأدوار ١٥ عموداً.

**الإتاحة:** الخلية `<button role="checkbox" aria-checked>` مع `aria-label` كامل
(«المخزون ← التسويات ← حذف ← دور أمين مخزن») + تنقّل بالأسهم.

### 6.4 شاشة Super Admin

تبويب إضافي داخل الصفحة نفسها يظهر لـ Super Admin فقط:
إدارة كتالوج `modules` / `permissions` / `role_templates` عبر المنظمات.

مبرره أن سياسات `permissions` و`modules` تشترط `is_super_admin()` للكتابة أصلاً،
والواجهة الحالية لا تعرض ذلك إطلاقاً.

---

## 7) مراحل التنفيذ

كل مرحلة = PR مستقل.

| # | المرحلة | المحتوى | البوابة |
|---|---|---|---|
| **P0** | تقرير أساس | استعلامات قراءة فقط: من يملك ماذا اليوم، وأي مفاتيح ستتغير بعد إصلاح wildcard. لا كود. | مراجعة بشرية |
| **P1** | إصلاحات أمنية 🔴 | 148 + 149 + 150، مع اختبارات سلبية إلزامية. | Fresh DB + definer guard + اختبارات قبل/بعد |
| **P2** | RPC ذرية | 151. `rbac-service.ts` يصبح المسار الوحيد للكتابة. | CI كامل |
| **P3** | توحيد الواجهة | إعادة كتابة `usePermissions`، توحيد الحرّاس، حارس `/org-admin`، ربط `subModules` بـ `resource`. | TS + ESLint + unit |
| **P4** | شاشة Pivot | الشاشة + i18n + الإتاحة. | i18n gate + tests |
| **P5** | توسيع الكتالوج | 152 + تحديث القوالب الـ17. | Fresh DB |
| **P6** | تدقيق | 153 + عرض السجل في `/org-admin/audit-log`. | CI كامل |
| **P7** | E2E | Playwright على staging بحسابات اختبار حقيقية للأدوار. | Artifact ناجح |

**الترتيب غير قابل للتبديل:**

- P1 قبل كل شيء — الآن `user_roles` فارغ ⇒ كلفة الإصلاح صفر، وتزداد مع كل مستخدم يُضاف.
- P4 قبل P5 — شاشة تعرض ١٦٦ صلاحية أسهل تصحيحاً من ٣٠٠+.

**التطبيق على Production:** حسب `Migration workflow` في `CLAUDE.md` — دمج PR، ثم التطبيق بالترتيب،
ثم التحقق من ظهور الاسم القانوني مرة واحدة في `supabase_migrations.schema_migrations`،
وتحديث Baseline لاحقاً عبر workflow `Generate Schema Baseline` في PR منفصل فقط.

---

## 8) الاختبارات المطلوبة

### وحدة (Vitest)

- تطبيع الفعل: `view ≡ read`، `edit ≡ update`.
- `can()` fail-closed عند مفتاح غير موجود.
- **الاختبار الحاسم:** `inventory.items.read` **لا** يمنح `inventory.adjustments.delete`.
- wildcard صريح `inventory.*.*` يمنح نزولاً، ولا يُشتق ضمنياً من المفتاح المطلوب.
- انتهاء `expires_at` يُسقط الصلاحية.
- `roles.is_active = false` يُسقط كل صلاحيات الدور.

### تكامل SQL (Fresh DB acceptance، على نمط `scripts/ci/fresh-db/acceptance_147_*.sql`)

- `acceptance_149_permission_isolation.sql` — مصفوفة منح/منع كاملة.
- أدمن منظمة **مُعطَّل** (`is_active = false`) يُرفض على `roles` و`role_permissions` (اختبار S2).
- مستخدم منظمة (أ) لا يرى أدوار منظمة (ب).
- `rpc_set_role_permissions` يرفض `is_system_role`، ويرفض دوراً من منظمة أخرى.
- الذرية: فشل في منتصف `rpc_set_role_permissions` يترك الحالة السابقة كاملة.

### E2E (Playwright، staging)

ثلاثة حسابات × منظمتين: Super Admin، Org Admin، مستخدم بدور محدود.

السيناريو الحاسم: أدمن يمنح `read` فقط لخدمة فرعية ⇒ المستخدم يرى القائمة ولا يرى زر الحذف،
**و**استدعاء API مباشر للحذف يُرفض من RLS —
إثباتاً أن الواجهة ليست خط الدفاع الوحيد.

---

## 9) المخاطر

| الخطر | الأثر | التخفيف |
|---|---|---|
| إصلاح wildcard يقطع وصولاً قائماً | حجب مستخدمين | `user_roles` = 0 اليوم ⇒ نافذة صفرية + تقرير P0 قبل/بعد |
| تطبيع `view→read` يُغيّر السلوك | حجب مسارات | التطبيع ثنائي الاتجاه في طبقة القراءة، والبيانات لا تُلمس |
| ١٦٦ → ٣٠٠+ صلاحية يُربك الأدمن | سوء استخدام | القوالب الـ17 + الطي الافتراضي + العدّادات |
| اعتماد الواجهة وحدها للأمان | تجاوز عبر API | RLS + RPC حارسة هما خط الدفاع؛ الواجهة تجميلية — مُثبَت في E2E |
| تجاوز Super Admin غير مرئي | فجوة تدقيق | 153 يسجل كل تغيير مع الفاعل |
| توسيع Baseline | drift | Baseline يُحدَّث فقط بعد ظهور الأرقام في سجل Production، عبر الـ workflow |

---

## 10) ما لا يجب فعله — تطبيق القاعدة الذهبية

- ❌ حذف `permissions` أو `role_permissions` القديمة لتنظيف المفاتيح ← `is_active = false` بدلاً منها.
- ❌ حذف بذرة `53_seed_permissions_data.sql` أو تعديل migration مطبقة حياً ← migration جديدة تعاكس أثرها.
- ❌ `DROP FUNCTION has_permission` ← `CREATE OR REPLACE` فقط، حفاظاً على الـ GRANTs والاعتماديات.
- ❌ لمس `supabase_migrations.schema_migrations`.
- ❌ إضافة عمود `NOT NULL` بلا `DEFAULT` على `permissions`.
- ❌ منح `EXECUTE` على أي helper داخلي جديد لـ `anon` أو `authenticated`.

---

## 11) علاقة هذه الوثيقة بالوثائق القائمة

| الوثيقة | العلاقة |
|---|---|
| `docs/security/PERMISSIONS_MAP.md` | **قديمة ولا تطابق القاعدة الحية.** تستعمل مفاتيح من جزأين (`manufacturing.view`, `inventory.view`) وأفعال `view`/`edit`، وresources غير موجودة حياً (`manufacturing.cost`, `inventory.valuation`, `*.reports`). تُحدَّث في P5 بعد استقرار الكتالوج، ولا تُعتمد مرجعاً قبل ذلك. |
| `docs/MULTI_TENANT_RBAC_PLAN.md` | خطة RBAC الأصلية (نوفمبر 2025) — تصف البنية المنفَّذة في migrations 40/41/53. هذه الوثيقة امتداد تصحيحي لها لا بديل عنها. |
| `docs/security/SECURITY_MODEL.md` | نموذج الأمان العام. بنود S1 و S2 هنا تخالفه وتحتاج إغلاقاً. |
| `docs/security/SECURITY_DEFINER_AUDIT.md` | تدقيق دوال `SECURITY DEFINER` — بند S7 إضافة عليه. |
| `CLAUDE.md` | القاعدة الذهبية + Migration workflow — كل ما ورد أعلاه ملتزم بهما. |
