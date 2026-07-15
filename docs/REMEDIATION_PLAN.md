# خطة معالجة تدقيق Codex الأمني — Wardah Process Costing

> **آخر تحديث**: 15 يوليو 2026
> **المشروع**: `uutfztmqvajmsxnrqeiv` (Manufacturing Process — us-east-1)
> **الفرع الرئيسي**: `main` — SHA الأخير بعد الدمج: `812eef1`

---

## الحالة العامة

| المرحلة | الوصف | الحالة |
|---|---|:---:|
| 0 | تثبيت خط الأساس | ✅ مكتملة |
| 1 | P0 — الصلاحيات والتصعيد والدعوات | 🔶 جزئية |
| 2 | توحيد GitHub ↔ Supabase | ⬜ لم تبدأ |
| 3 | تنظيف المخطط وسلامة البيانات | ⬜ لم تبدأ |
| 4 | الأداء | ⬜ لم تبدأ |
| 5 | جودة كود TypeScript | ⬜ لم تبدأ |
| 6 | الاختبارات وCI/CD | ⬜ لم تبدأ |
| 7 | التصميم وتجربة الاستخدام | ⬜ لم تبدأ |

---

## المرحلة 0 — تثبيت خط الأساس ✅

- ✅ تأكيد `project_id = uutfztmqvajmsxnrqeiv`
- ✅ رصد 12 سياسة `USING(true)` على الجداول المالية (تتجاوز العزل رغم وجود سياسات org-scoped)
- ✅ تأكيد وجود `user_orgs_update_own` بلا `WITH CHECK` (ثغرة تصعيد)
- ✅ تأكيد `invitations_by_token USING(true)` (كشف توكنات وبريد)
- ✅ تأكيد fail-open في `checkIsOrgAdmin` و`org-admin/index.tsx`
- ✅ تأكيد `DEFAULT_ORG_ID` fallbacks في AuthContext وsupabase.ts

---

## المرحلة 1 — P0 الأمني 🔶

### 1.1 ثغرة تصعيد `is_org_admin` ✅
- ✅ حذف `user_orgs_update_own` من `user_organizations`
- ✅ إنشاء `rpc_set_org_admin(p_target_user_id, p_org_id, p_value)` — SECURITY DEFINER + بوابة `wardah_is_org_admin` + منع ترقية الذات + منع حذف آخر مدير
- ✅ `setUserAsOrgAdmin()` في `org-admin-service.ts` تستدعي RPC بدل UPDATE مباشر

### 1.2 fail-open في حارس الأدمن ✅
- ✅ `checkIsOrgAdmin` → fail-closed عبر `wardah_is_org_admin` RPC (لا `return true` عند الخطأ)
- ✅ `org-admin/index.tsx` → `!currentOrgId` يُنتج «غير مصرّح» لا وصول مؤقت
- ✅ `catch` في حارس الأدمن يُنتج `false` لا `true`

### 1.3 كشف توكنات الدعوات ✅
- ✅ حذف `invitations_by_token USING(true)`
- ✅ `rpc_get_invitation_preview(token)` — قابلة لـ `anon`، تُعيد email/org_name/status/is_valid فقط (بلا توكن ولا role_ids)
- ✅ `rpc_accept_invitation(token)` — تشتق `user_id` من `auth.uid()` خادمياً، قفل `FOR UPDATE`، فحص تطابق البريد، ذرّية كاملة
- ✅ `signupHandlers.ts` → `acceptInvitation(inviteToken)` بلا `user.id`
- ✅ `signup.tsx` → تستخدم `rpc_get_invitation_preview` بدل قراءة الجدول مباشرةً
- ⬜ **متبقّي**: تخزين `token_hash` (SHA-256) بدل التوكن الخام في عمود `invitations.token` + ترحيل الصفوف القائمة (Migration 104)

### 1.4 `DEFAULT_ORG_ID` fallback ✅
- ✅ حذف `DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001'` من `AuthContext.tsx`
- ✅ حذف `LEGACY_DEFAULT_ORG_ID` من `supabase.ts`
- ✅ `resolveOrgIdWithFallback` يرفع exception بدل UUID وهمي
- ✅ `setCurrentOrgId` يتحقق من عضوية المستخدم قبل القبول
- ✅ الحالة الصحيحة عند غياب مؤسسة = `null` (لا fallback)

### 1.5 Views وDEFINER functions ✅
- ✅ تحويل 10 views إلى `security_invoker = on`:
  `v_work_order_status`, `v_capacity_summary`, `v_production_schedule_details`,
  `v_work_center_productivity`, `v_all_public_functions`, `v_labor_efficiency`,
  `v_work_center_efficiency_summary`, `v_cost_variance_report`,
  `v_material_consumption_report`, `v_oee_report`
- ✅ إزالة `JOIN auth.users` من `v_work_order_status` (كانت تكشف بريد المشغّل)
- ✅ تثبيت `SET search_path = public` لـ 23 دالة ذات مسار متغيّر
- ✅ سحب `EXECUTE` من `PUBLIC`/`anon` على 18 دالة DEFINER داخلية
- ✅ تفعيل RLS على `test_init` + سياسة `is_super_admin()` فقط
- ⬜ **متبقّي**: `rpc_set_org_admin` ما زال قابلاً للاستدعاء من `anon` (المنطق fail-closed لكن الأنظف سحب EXECUTE من anon تحديداً — Migration 104)

### 1.6 إعدادات Supabase وStorage ⬜
- ⬜ ترقية PostgreSQL (النسخة الحالية `17.4.1.075` — Advisor يُصنّفها قديمة)
- ⬜ تفعيل Leaked Password Protection (Supabase Dashboard → Auth)
- ⬜ جعل bucket المستندات المالية خاصًا + Signed URLs
- ⬜ منع رفع SVG في bucket الشعارات (تعقيم أو حظر MIME)
- ⬜ تعطيل `pg_graphql` (التطبيق يستخدم REST فقط — GraphQL exposure في Advisor)
- ⬜ 4 سياسات `USING(true)` متبقية على جداول غير مالية:
  - `audit_logs` → `audit_insert`
  - `bill_of_materials_20250905_1900` → `authenticated_all_bill_materials`
  - `users_profiles_20250905_1900` → `safe_insert_profiles` / `safe_update_profiles`
- ⬜ مراجعة grants الواسعة لـ `anon` على جداول حساسة (`gl_entries`, `invitations`, `user_organizations`)
- ⬜ اختبارات تصعيد سلبية pgTAP في `sql/tests/103_authz_negative.sql`

### نتائج التحقق الحي — Migration 103
| الفحص | النتيجة |
|---|:---:|
| سياسات `USING(true)` على الجداول المالية الـ12 | 0 ✅ |
| `user_orgs_update_own` | محذوفة ✅ |
| `invitations_by_token USING(true)` | محذوفة ✅ |
| `rpc_set_org_admin` | موجودة ✅ |
| `rpc_accept_invitation` | موجودة ✅ |
| `rpc_get_invitation_preview` | موجودة ✅ |
| 10 views بـ `security_invoker=on` | ✅ |
| 3597 اختبار TypeScript | تمر ✅ |

---

## المرحلة 2 — توحيد GitHub ↔ Supabase ⬜

**المشكلة**: MANIFEST يوثّق ≈140 migration؛ سجل Supabase يسجّل عدداً أقل بكثير؛ migrations مبعثرة في 4 جذور (`sql/migrations/`, `supabase/migrations/`, `src/database/migrations/`, `src/migrations/`).

- ⬜ Backup واختبار الاستعادة
- ⬜ إنشاء Supabase Staging Branch
- ⬜ سحب Baseline من الإنتاج عبر Supabase CLI → اعتماد هيكل `supabase/{config.toml,migrations/,functions/,tests/}`
- ⬜ مقارنة ملفات 1–102 مع Baseline؛ الفارق فقط يصير migration رسمية
- ⬜ تطبيق migrations 100/101/102 المعلّقة على Staging ثم الإنتاج
- ⬜ نقل Edge Functions إلى GitHub أو حذف غير المستخدم
- ⬜ أرشفة/حذف جداول `*_20250905_1900` بعد تأكيد عدم استخدامها
- ⬜ منع DDL مباشر على الإنتاج: كل تغيير = migration + PR + Staging
- ⬜ CI يبني قاعدة فارغة من الصفر ويقارن المخطط الناتج بالمتوقّع

**معيار النجاح**: بيئة staging مطابقة للإنتاج تُبنى من GitHub وحده.

---

## المرحلة 3 — تنظيف المخطط وسلامة البيانات ⬜

### المحاسبة
- ⬜ توحيد على `gl_entries/gl_entry_lines` (القانوني). ترحيل `journal_entries/journal_lines` (يستخدمه `stock-adjustment-service` فقط) ثم إيقاف المخطط القديم
- ⬜ إصلاح الكود المستعلم عن `journal_entry_lines`/`journal_lines`: `useEntryLines.ts`, `trial-balance-helpers.ts`, `account-statement`, `gemini-financial-service`

### المخزون
- ⬜ إكمال هجرة `items → products` للقراءات المتبقية في: `financial-dashboard`, `sales-reports`, `gemini-financial`, بعض `manufacturing/*` (`items` جدول ميت فارغ؛ `products` فيه 118 صنفاً)

### التصنيع
- ⬜ توحيد حالات أوامر التصنيع: القاعدة `in_progress` مقابل الكود `in-progress` (normalizers في `manufacturing/helpers.ts:15`, `manufacturing-helpers.ts:175`)
- ⬜ اعتماد `manufacturing_orders_status_check` (حالياً `NOT VALID`)

### القيود والجداول
- ⬜ تصنيف جداول `*_20250905_1900` (ترحيل/أرشفة/حذف)
- ⬜ فرض قيود: كميات/تكاليف `≥ 0`، مدين = دائن، تفرّد داخل المؤسسة
- ⬜ منع تعديل القيود المرحّلة، تفرّد مفاتيح idempotency داخل المؤسسة
- ⬜ مراجعة الجداول بلا عمود `org_id` (عام مقصود / تابع / قديم)

---

## المرحلة 4 — الأداء ⬜

> **ملاحظة**: تُنفَّذ بعد المرحلة 1 — إصلاح RLS يزيل جزءاً من 526 سياسة متداخلة و222 initPlan تلقائياً.

- ⬜ فهرسة 104 مفتاح أجنبي بلا فهارس (أولوية: GL ← التصنيع ← المخزون ← الرواتب)
- ⬜ إزالة 11 فهرس مكرر بعد مقارنة التعريف والاستخدام
- ⬜ فهارس مركّبة على `(org_id, status)`, `(org_id, created_at)`, `(org_id, product_id)`
- ⬜ `EXPLAIN (ANALYZE, BUFFERS)` لأهم 10 استعلامات؛ Pagination؛ إلغاء `select('*')`
- ⬜ لا حذف للـ 334 فهرس «Unused» حالياً (نشاط قليل → إحصائية غير كافية)
- ⬜ SLO: صفحة معتادة < 1s، استعلام P95 < 300–500ms

---

## المرحلة 5 — جودة كود TypeScript ⬜

### الأنواع
- ⬜ توليد Database types من Supabase واستخدام `createClient<Database>` (حالياً `supabase.ts:181` غير مُنمَّط)
- ⬜ `src/types/database.ts` (969 سطر) — كود ميت غير مستورد؛ يُحذف أو يُوحَّد مع المولَّد
- ⬜ تقسيم `src/lib/supabase.ts` (621 سطر) إلى `supabase/client` + `repositories/{accounting,inventory,manufacturing}`
- ⬜ تفعيل `strict: true` تدريجياً؛ إزالة الاستثناءات من `tsconfig`/ESLint/Sonar؛ إزالة `any`

### الخدمات والأخطاء
- ⬜ توحيد أخطاء (شبكة/RLS/validation/business) — منع تحويل خطأ صلاحية إلى شاشة فارغة
- ⬜ React Query لكل Server State بدل useEffect اليدوي
- ⬜ إلغاء الطلبات عند مغادرة الصفحة
- ⬜ تفريغ كاش React Query عند تبديل المؤسسة؛ تضمين `userId+orgId` في مفاتيح الاستعلامات

### التبعيات
- ⬜ حذف `@supabase/auth-helpers-react` (deprecated — `package.json:38`)
- ⬜ توحيد `recharts`/`apexcharts` (كلاهما موجود — `package.json:43,65`)
- ⬜ `npm audit` + Dependency Review + فحص أسرار

---

## المرحلة 6 — الاختبارات وCI/CD ⬜

### الاختبارات
- ⬜ Unit: الحساب/التكاليف/الرواتب
- ⬜ Integration: خدمات React Query مع Supabase mock بالعقود
- ⬜ pgTAP سلبية: عزل مؤسستين، تصعيد الصلاحيات، الدعوات، الإقفال، idempotency، توازن القيود
- ⬜ `sql/tests/103_authz_negative.sql` — اختبارات تصعيد المرحلة 1

### E2E Playwright في CI
- ⬜ دخول + تبديل مؤسسة
- ⬜ شراء → استلام → مخزون → GL
- ⬜ تصنيع → استهلاك → إتمام → FG/GL
- ⬜ مبيعات → تسليم → COGS
- ⬜ رواتب → اعتماد → GL

### CI/CD
- ⬜ جعل Sonar Quality Gate حاجزاً (`sonar.qualitygate.wait=true`)؛ إزالة `continue-on-error`
- ⬜ منع ثغرات High/Critical من الدمج
- ⬜ حماية `main`: PR + مراجعة + فحوص مطلوبة
- ⬜ رفع عتبة التغطية: إجمالي ≥70%، فروع ≥60%، المحاسبة/المخزون/الرواتب/الصلاحيات ≥90%
- ⬜ إصلاح `ci-cd.yml:68` (نشر = `echo` حالياً — لا نشر حقيقي)

---

## المرحلة 7 — التصميم وتجربة الاستخدام ⬜

### الاتساق البصري
- ⬜ توحيد صفحات Org Admin (slate/teal الصلبة) مع Design System العام
- ⬜ تقليل glassmorphism في الشاشات التشغيلية

### RTL وi18n
- ⬜ تحويل `text-left/right`, `ml/mr`, `pl/pr` إلى خصائص منطقية (`text-start`, `ms/me`, `ps/pe`)
- ⬜ إصلاح `table.tsx` لـ RTL + `scope="col"` + محاذاة أرقام لليسار
- ⬜ إكمال i18n (خلط نص عربي ثابت / مترجم / تاريخ en-US في اللوحة)
- ⬜ «الإجراءات السريعة» تفتح نموذج الإنشاء الحقيقي (لا placeholder)

### مكونات مشتركة
- ⬜ توحيد PageHeader / الفلاتر / Empty / Error / Loading
- ⬜ Sticky headers؛ كثافة Compact/Comfortable؛ حفظ الأعمدة والفلاتر
- ⬜ تصدير/طباعة موحّدة؛ عرض Mobile

### إمكانية الوصول (WCAG 2.2 AA)
- ⬜ تنقّل كامل بلوحة المفاتيح + focus واضح
- ⬜ `aria-label` لكل أزرار الأيقونات
- ⬜ فحص contrast في الوضعين (فاتح/داكن)
- ⬜ `prefers-reduced-motion`؛ بديل جدولي للرسوم البيانية
- ⬜ مصفوفة اختبار: عربي/إنجليزي × فاتح/داكن × 360/768/1440

---

## الخطوة التالية المقترحة — Migration 104

بنود محددة وقصيرة تُغلق ما تبقّى من المرحلة 1:

```sql
-- 1. سحب EXECUTE من anon على rpc_set_org_admin
REVOKE EXECUTE ON FUNCTION public.rpc_set_org_admin(UUID, UUID, BOOLEAN) FROM anon;

-- 2. إصلاح سياسات USING(true) المتبقية على الجداول غير المالية
DROP POLICY IF EXISTS "audit_insert" ON audit_logs;
CREATE POLICY "audit_insert" ON audit_logs
  FOR INSERT WITH CHECK (org_id = wardah_org_id());

-- 3. تخزين token_hash بدل التوكن الخام في invitations
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS token_hash TEXT;
-- (ترحيل الصفوف القائمة + تحديث rpc_get_invitation_preview/rpc_accept_invitation)
```

---

## Commits المرتبطة

| SHA | الوصف |
|---|---|
| `64321e8` | fix(security): P0 — migration 103 + TypeScript fail-closed |
| `6ab569c` | docs(manifest): إضافة سطر 103، الرقم التالي 104 |
| `dc627f2` | docs(rollback): rollback script لـ migration 103 |
| `812eef1` | merge: PR #18 → main |

---

*آخر تحديث بواسطة Claude Code — جلسة معالجة تدقيق Codex الأمني*
