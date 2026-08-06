# تقرير موحّد: الثغرات الأمنية وفجوات المعمارية بين الواجهة وقاعدة البيانات

**تاريخ التوثيق:** 2026-08-06
**الفرع:** `claude/security-architecture-gaps-report-hsn6vx`
**آخر commit مرجعي:** `2e16f16` (Migration 171)
**سجل Production وقت التحقق:** مطبّق حتى `171_ai_usage_daily_and_reports_insights_permission`

هذا الملف يدمج تقريرين منفصلين:

- **التقرير الأول:** تدقيق أمني (أسرار مكشوفة، RLS، مصادقة، CI، XSS).
- **التقرير الثاني:** تحليل الفروقات المعمارية بين الواجهة وقاعدة البيانات (سياق المؤسسة، عقود الكتابة، نموذج الصلاحيات).

**ملاحظة منهجية مهمة:** التقريران كُتبا قبل دمج مجموعة إصلاحات (PR #98، #99، #100، #101، و Migration 170/171). أُعيد التحقق من **كل بند** مقابل حالة المستودع وسجل Production الحيّ بتاريخ 2026-08-06، وسُجّلت الحالة الفعلية لكل بند بدل نقل التقرير الأصلي كما هو. البنود المغلقة أُبقيت في الوثيقة كسجل تاريخي — لا تُعاد معالجتها.

---

## مفتاح الحالة

| الرمز | المعنى |
|---|---|
| 🔴 **مفتوح** | مؤكَّد وما زال قائمًا في الشيفرة/القاعدة الآن |
| 🟢 **مغلق** | أُصلح ودُمج، وتم التحقق من الإصلاح |
| 🟡 **مغلق جزئيًا** | أُصلح جوهر المشكلة وبقي أثر ثانوي |
| ⚪ **ليس ثغرة** | فُحص وثبت أنه سلوك مقصود أو مخاطرة موثّقة مقبولة |

---

## ملخّص تنفيذي

| الفئة | المجموع | مفتوح | مغلق |
|---|---|---|---|
| ثغرات أمنية حرجة | 3 | 0 | 3 |
| ثغرات أمنية عالية | 5 | 2 | 3 |
| ثغرات أمنية متوسطة/منخفضة | 6 | 5 | 1 |
| فجوات معمارية (واجهة ↔ قاعدة بيانات) | 6 | 6 | 0 |

**الأولوية العملية الآن** — بعد إغلاق كل الحرج:

1. **الفجوة المعمارية 1** (سياق المؤسسة) — تكسر المستخدمين متعددي المؤسسات وتجعل مبدّل المؤسسة وهميًا.
2. **الفجوة المعمارية 2** (كتابة مباشرة على `gl_entries` مرفوضة بـRLS) — قيود اليومية اليدوية معطّلة فعليًا عبر هذه المسارات.
3. **الفجوة المعمارية 5** (نموذج الصلاحيات) — يقفل مستخدمين شرعيين، ولا يفرض فصل مهام على أي طبقة.
4. **الثغرة العالية 4** (وسيط مصادقة البروكسي يقبل أي Bearer) + **المتوسطة 9** (أسرار افتراضية ضعيفة) — نفس الخدمة، تُعالجان معًا.

---

# الجزء الأول: الثغرات الأمنية

## 🟢 حرجة — 1. مفتاح Google Gemini ومفتاح البروكسي مكشوفان في HTML يُخدَّم للعميل

**الحالة: مغلق** — أُصلح في `12443a3` (PR #99).

**الوصف الأصلي:** الملف `public/gemini-dashboard/gemini_enhanced_dashboard.html` يُخدَّم كأصل ثابت ويُحمَّل داخل التطبيق عبر iframe، وكان يحوي:

```js
this.geminiApiKey = 'AIzaSy...';                       // مفتاح Google فعّال
proxyAuthKey: 'S3cur3Pr0xyK3y!2025#WardahERP'          // مفتاح مصادقة البروكسي
```

أي زائر يستطيع استخراج المفتاحين من مصدر الصفحة: استنزاف حصة/فوترة Google، وانتحال مصادقة البروكسي. كان الملف مكرّرًا في `Gemini_enhanced_dashboard/`.

**التحقق (2026-08-06):** `grep -rn "AIzaSy\|S3cur3Pr0xyK3y"` على المستودع كاملًا (باستثناء `node_modules`) لا يعيد أي نتيجة. القيمة الاحتياطية المكشوفة في `gemini-proxy.routes.ts` أُزيلت أيضًا.

> ⚠️ **إجراء خارج المستودع لم يُتحقق منه هنا:** إزالة المفتاح من الشيفرة **لا تُبطله**. يجب التأكد يدويًا من أن مفتاح `AIzaSy...` أُبطل ودُوِّر في Google Cloud Console، وأن `PROXY_AUTH_KEY` دُوِّر في بيئة النشر. المفتاحان بقيا في تاريخ Git وفي أي نسخة مخبأة للصفحة. **افترضهما مسرَّبين حتى إثبات التدوير.**

---

## 🟢 حرجة — 2. تجاوز عزل المستأجرين (RLS) في جداول الجرد الفعلي

**الحالة: مغلق** — أُصلح في Migration 170 (`9bff64d` / PR #98)، ومطبَّق على Production.

**الوصف الأصلي:** ثماني سياسات على `physical_count_items` و`physical_count_sessions` فيها خطأ ارتباط في الاستعلام الفرعي:

```sql
-- sql/baseline/000_schema_baseline_20260729_210941.sql:26443
USING (organization_id IN (
  SELECT physical_count_items.organization_id     -- ← عمود الجدول الخارجي
  FROM public.user_organizations
  WHERE user_organizations.user_id = (SELECT auth.uid())
))
```

الاستعلام الفرعي يختار `physical_count_items.organization_id` (عمود الصف الخارجي) بدل `user_organizations.org_id`. الشرط ينحلّ إلى `organization_id IN (organization_id)` — **صحيح لكل صف في كل مؤسسة** طالما للمستخدم عضوية واحدة. النتيجة: قراءة/إدراج/تعديل/حذف بيانات جرد كل المستأجرين.

**التحقق (2026-08-06):** Migration 170 يعيد إنشاء السياسات الثماني بـ`FOR <command> TO authenticated` وربط صحيح على `user_organizations.org_id`. الاسم القانوني ظاهر في سجل Production.

---

## 🟢 حرجة — 3. سياسات RLS تعتمد على مؤسسة افتراضية ثابتة (default-org fallback)

**الحالة: مغلق** — أُصلح في Migration 170، ومطبَّق على Production.

**الوصف الأصلي:** `manufacturing_stages` و`stage_wip_log` و`standard_costs`:

```sql
-- sql/baseline/000_schema_baseline_20260729_210941.sql:25964
USING (org_id = COALESCE(
  (NULLIF(current_setting('request.jwt.claims',true)::jsonb->>'org_id',''))::uuid,
  (NULLIF(current_setting('request.jwt.claims',true)::jsonb->>'tenant_id',''))::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid))   -- ← مؤسسة حقيقية مبذورة
```

الـJWT لا يحمل `org_id`/`tenant_id` (المؤسسة تُدار من الواجهة — انظر الفجوة المعمارية 1)، فيسقط `COALESCE` دائمًا على المؤسسة الافتراضية. والسياسة بلا `FOR`/`TO` ⇒ تنطبق على كل الأوامر ولدور `PUBLIC` (بما فيه `anon`)، مع وجود `GRANT ALL ... TO anon` على الجداول الثلاثة. النتيجة: **وصول مجهول (قراءة وكتابة) لبيانات تكاليف تصنيع مؤسسة حقيقية**.

مشكلة موازية عبر `get_effective_org_id()` على `journal_entry_attachments` — تقرأ `current_setting('app.current_org_id')`، وهو GUC ميت لا يضبطه أي عميل (نمط أزالته Migration 118 على 38 جدولًا).

**التحقق (2026-08-06):** Migration 170 يستبدل السياسات بـ`FOR ALL TO authenticated` مبنية على `wardah_org_id()` (fail-closed، بلا أي fallback افتراضي)، ويضيف `REVOKE ALL ... FROM anon` على الجداول الثلاثة.

---

## 🔴 عالية — 4. وسيط مصادقة البروكسي يقبل أي رمز Bearer

**الحالة: مفتوح.**

```ts
// src/features/reports/proxy-service/server.ts:52
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  // تحقق من التوكن مع نظام وردة   ← تعليق فقط، لا تنفيذ
  next();
};
```

لا يوجد تحقق فعلي من التوقيع أو الصلاحية أو المؤسسة. أي `Authorization: Bearer x` يمرّ ويصل إلى `/api/wardah/financial` و`/accounting` و`/reports`.

**ملاحظة على نطاق الأثر:** يجب تحديد ما إذا كانت هذه الخدمة (`proxy-service`) منشورة فعليًا في أي بيئة أم أنها شيفرة غير مُشغَّلة. **إن لم تكن منشورة، الأولوية تنخفض بشدة لكن البند لا يُغلق** — الشيفرة قابلة للنشر كما هي.

**الإصلاح المقترح:** تحقق فعلي من JWT مقابل مفتاح Supabase (JWKS) + استخراج `sub` و`org_id` وتمريرهما، أو حذف الخدمة إن كانت ميتة.

---

## 🟢 عالية — 5. كلمة مرور تجريبية معروضة في واجهة تسجيل الدخول

**الحالة: مغلق** — أُصلح في `12443a3` (PR #99).

**الوصف الأصلي:** `src/pages/login.tsx` كان يعرض `admin@wardah.sa` وكلمة المرور دائمًا، بلا حارس بيئة.

**التحقق (2026-08-06):** الكتلة صارت داخل `{isDevelopment() && (...)}` وتقرأ من `DEMO_CREDENTIALS`.

> ⚠️ **إجراء خارج المستودع:** إن كان الحساب `admin@wardah.sa` موجودًا فعلًا في Supabase Auth بكلمة المرور المكشوفة سابقًا، يجب **تغيير كلمة مروره أو تعطيله**. الإصلاح في الواجهة لا يعالج تسريبًا سابقًا.

---

## 🔴 عالية — 6. تفويض RBAC في الواجهة فقط

**الحالة: مفتوح.** (يتقاطع كليًا مع **الفجوة المعمارية 5**؛ عولجا معًا هناك بتفصيل أوفى.)

الحماية عبر `<ModuleGuard>` و`hasPermission` في الواجهة فقط. RLS على جداول حسّاسة مثل `gl_accounts` و`bom_headers` تفحص **عضوية المؤسسة فقط** (`org_id = auth_org_id()`) لا الإجراء ولا الدور. إخفاء الأزرار في React لا يمنع نداءً مباشرًا بـanon key + جلسة المستخدم عبر PostgREST.

**النتيجة:** لا توجد طبقة تفرض فصل المهام. أي عضو نشط في المؤسسة يستطيع تعديل دليل الحسابات أو قوائم المواد مباشرة.

---

## 🟢 عالية — 7. حقن أوامر في GitHub Actions

**الحالة: مغلق** — أُصلح في `ec577ff` (PR #101).

**الوصف الأصلي:** `.github/workflows/generate-baseline.yml` كان يُدرج `${{ github.event.inputs.reason }}` داخل أمر shell مباشرةً، مع `contents: write` وسرّ `SUPABASE_DB_URL` في نفس الـjob — قابل للاستغلال بمدخل `workflow_dispatch` مُصاغ خبيثًا. نمط مشابه في `regenerate-uom-types.yml` (تنفيذ كود من `pull_request.head.sha` ثم `git push`).

**التحقق (2026-08-06):** المدخل صار يُمرَّر عبر `env:` (`REASON: ${{ github.event.inputs.reason }}` في السطر 348) ويُقرأ داخل السكربت كمتغيّر بيئة، فلا يُفسَّر كشيفرة shell.

---

## 🟢 عالية — 8. XSS عبر DOM

**الحالة: مغلق** — أُصلح في `fc582cb` (PR #100).

**الوصف الأصلي:**
- `public/gemini-dashboard/gemini_enhanced_dashboard.html`: رسائل الشات وردود النموذج تُدرج عبر `innerHTML` بلا تعقيم.
- `src/features/manufacturing/stage-costing-actions.js:392+`: `document.write` يدرج حقول قاعدة بيانات (`mo.order_number`, `mo.item?.name`) ⇒ **XSS مخزَّن** عبر أسماء الأصناف/الأوامر.

**التحقق (2026-08-06):** أُضيفت `escapeHtml()` في الملفين وتُستخدم على كل قيمة مُدرَجة (`gemini_enhanced_dashboard.html:1063`، `stage-costing-actions.js:390`).

---

## 🔴 متوسطة — 9. أسرار افتراضية ضعيفة مثبّتة في الشيفرة

**الحالة: مفتوح.**

```ts
// src/features/reports/proxy-service/config.ts:12-13
JWT_SECRET: 'dev_secret',
PROXY_AUTH_KEY: 'dev_proxy_key'
```

قيم احتياطية تعمل كـ**fail-open** إن غابت متغيّرات البيئة عند النشر. القاعدة الصحيحة: الغياب يجب أن يُسقط الخدمة عند الإقلاع، لا أن يُستبدل بقيمة معروفة. يُعالج مع البند 4 (نفس الخدمة).

---

## 🔴 متوسطة — 10. CSP في وضع Report-Only فقط

**الحالة: مفتوح.**

`vercel.json:30` يستخدم `Content-Security-Policy-Report-Only` — يُبلِّغ ولا يمنع. ويسمح بـ`'unsafe-inline'`، ما يُفرغ الحماية من مضمونها حتى لو حُوِّل إلى وضع الفرض. الانتقال إلى فرض فعلي يتطلب أولًا إزالة الاعتماد على السكربتات/الأنماط المضمّنة.

---

## 🟡 متوسطة — 11. دوال Edge بـCORS `*` وبلا مصادقة

**الحالة: مغلق جزئيًا** — أُضيفت بوابة مصادقة في `fc582cb` (PR #100).

`supabase/functions/translate-text` صارت ترفض الطلبات بلا `Authorization` وتتحقق من المستخدم عبر `supabase.auth.getUser()` قبل إنفاق حصة Google Translate.

**المتبقي:** `Access-Control-Allow-Origin: *` ما زال قائمًا، ولا يوجد حدّ معدّل (rate limit) لكل مستخدم — أي مستخدم مصادَق يستطيع استنزاف الحصة.

---

## 🔴 متوسطة — 12. خادم Vite على `0.0.0.0` مع `fs.allow: ['..']`

**الحالة: مفتوح** (مخاطرة تطويرية فقط).

`vite.config.ts:30,41` — الخادم يستمع على كل الواجهات ويسمح بقراءة ملفات خارج جذر المشروع. على شبكة محلية مشتركة، أي جهاز يستطيع الوصول إلى الخادم وقراءة ملفات المجلد الأب (بما فيها `.env` المحلي). لا يؤثر على الإنتاج.

---

## 🔴 منخفضة — 13. عضوية غير نشطة تُبقي صلاحيات الكتابة

**الحالة: مفتوح.**

سياسات جداول التصنيع/MES لا تفلتر `user_organizations.is_active`، خلافًا للقاعدة المعلنة في `CLAUDE.md` ("العضوية النشطة تعني `is_active IS TRUE`"). عضو مُعطَّل يحتفظ بصلاحية الكتابة على تلك الجداول.

---

## ⚪ فُحص وثبت أنه ليس ثغرة

| البند | السبب |
|---|---|
| `VITE_SUPABASE_ANON_KEY` في `.env` | علني بالتصميم في Supabase؛ الحماية من RLS لا من سرّية المفتاح. و`.env` غير متعقَّب في Git |
| ثغرات `xlsx@0.18.5` | موثّقة كمخاطرة مقبولة في `SECURITY.md` و`.nsprc` (استخدام تصدير فقط). **لكن موعد المراجعة المجدول فات — يحتاج تحديث تاريخ أو إعادة تقييم** |
| `has_permission` DEFINER (كشف صلاحيات مستخدمين آخرين) | كان ثغرة حقيقية؛ أُغلق في Migration 170 (البند 3 من الـmigration): صارت تقارن `p_user_id` بـ`auth.uid()` |

---

# الجزء الثاني: الفجوات المعمارية بين الواجهة وقاعدة البيانات

**كل بنود هذا الجزء مفتوحة.** لم يمسّها أي من إصلاحات #98–#101 ولا Migration 170/171.

## 🔴 الفجوة 1: سياق المؤسسة — ثلاث آليات لا تتفق

الواجهة **لا تضبط** `org_id`/`tenant_id` في الـJWT ولا في جلسة قاعدة البيانات (لا `set_current_org`، لا headers، لا claims). ومع ذلك يوجد ثلاثة مصادر مختلفة لـ"المؤسسة الحالية":

| الآلية | المصدر | تُستخدم في |
|---|---|---|
| اختيار المستخدم | `localStorage['current_org_id']` عبر `AuthContext` | تحميل الصلاحيات + العرض فقط |
| خدمات البيانات | `getTenantId()` = استعلام العضويّات بـ`.single()` | كل نداءات الجداول والـRPC |
| قاعدة البيانات | `wardah_org_id()` / `auth_org_id()` | فرض RLS |

```ts
// src/lib/supabase.ts:553
const { data, error } = await supabase
    .from('user_organizations')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single();
```

ثلاث مشاكل متراكبة:

1. **تتجاهل تمامًا المؤسسة التي اختارها المستخدم** ⇒ مبدّل المؤسسة في الواجهة **تجميلي فقط**، لا يغيّر البيانات المُعادة.
2. **`.single()` ترمي خطأ** لأي مستخدم عضو في أكثر من مؤسسة (أكثر من صف مُعاد) ⇒ المستخدمون متعددو المؤسسات يفشلون في كل الاستعلامات.
3. **حتى عند النجاح قد لا تطابق اختيار قاعدة البيانات:** `gl_accounts` تحسم المؤسسة بـ`auth_org_id()`، بينما `gl_entries` تحسمها بـ`wardah_org_id()`. المستخدم متعدد المؤسسات قد يرى **دليل حسابات مؤسسة وقيود مؤسسة أخرى**.

**الأثر:** عمل صحيح للمستخدم أحادي المؤسسة، وكسر شبه كامل لمتعدد المؤسسات، وسياق غير متسق بين جداول مترابطة.

---

## 🔴 الفجوة 2: كتابة مباشرة على جداول للقراءة-فقط في RLS

قاعدة البيانات تفرض عقدًا واضحًا: قيود اليومية تُكتب عبر RPC (`SECURITY DEFINER`)، والجداول نفسها للقراءة فقط:

```sql
-- sql/baseline/000_schema_baseline_20260729_210941.sql:25128
CREATE POLICY gl_entries_org_read ON public.gl_entries
  FOR SELECT TO authenticated USING (org_id = public.wardah_org_id(NULL::uuid));
```

**لا توجد أي سياسة INSERT/UPDATE/DELETE على `gl_entries` أو `gl_entry_lines`** — لا في الـBaseline ولا في أي migration حتى 171 (تم التحقق بـgrep على `sql/migrations/*.sql`). أي إدراج مباشر **يُرفض بـRLS**.

ومع ذلك تكتب الواجهة مباشرةً في:

```ts
// src/features/accounting/journal-entries/services/journalEntryService.ts:69
const { data: entry } = await supabase.from('gl_entries').insert(entryData)...
// ثم .from('gl_entry_lines').insert(lines)
```

المسارات المخالفة المؤكَّدة:

- `src/features/accounting/journal-entries/services/journalEntryService.ts` (أسطر 69، 125، 193)
- `src/components/forms/SupplierInvoiceForm.tsx` (414، 433، 446، 459)
- `src/infrastructure/repositories/SupabaseAccountingRepository.ts` (148، 168، 193، 233، 279، 336، 407، 457)
- `src/services/supabase-service.ts` (738، 753)
- `src/services/gemini-financial-service.ts` (301، 313)

> يوجد **اختبار عقد** يمنع هذا صراحةً: `src/services/payment-vouchers-legal-gl-contract.test.ts:18-19` يتحقق ألا تحتوي المصادر على `.from('gl_entries')` — لكنه يفحص ملفات محدّدة فقط، فتفلت منه المسارات أعلاه.

**المسار الصحيح موجود فعلًا:** `rpc_create_journal_entry` (يستخدمه `journal-service.ts`).

ملاحظتان إضافيتان:
- `gl_entry_lines` يُكتب بعمودَي `org_id` و`tenant_id` معًا — كتابة مزدوجة زائدة.
- `journal_entries`/`journal_lines` عليها RLS مفعّلة **بلا أي سياسة** ⇒ رفض تام. الواجهة تتجنّبها بحقّ.

---

## 🔴 الفجوة 3: تعدّد أسماء عمود المؤسسة

| العمود | الجداول | حالة الواجهة |
|---|---|---|
| `org_id` | الأغلبية: `gl_accounts`, `gl_entries`, `bom_*`, `manufacturing_*`, `user_organizations`, `invitations` | متوافقة غالبًا |
| `organization_id` | `physical_count_items`, `physical_count_sessions` | الواجهة تستخدم `org_id` في أماكن أخرى — خطر عدم تطابق |
| `tenant_id` | `cost_centers`, `profit_centers`, `currency_exchange_rates`, `account_reconciliations`, … | الوصول عبر RPC فقط حاليًا — لا كسر فعلي |

مواضع تكتب `tenant_id` صراحةً من الواجهة: `labor_time_logs` (بتعليق صريح "use tenant_id instead of org_id")، و`categoriesService`، ومسبار مزدوج دفاعي في `enhanced-sales-service` يجرّب `org_id` ثم `tenant_id`. **هذا التذبذب نفسه دليل على أن الواجهة غير متأكدة من العقد.**

---

## 🔴 الفجوة 4: سياسات `app.current_tenant_id` الميتة (11 جدولًا)

20 سياسة على 11 جدولًا تشترط GUC لا يضبطه أحد:

```sql
-- sql/baseline/000_schema_baseline_20260729_210941.sql:24864
CREATE POLICY cost_centers_tenant_isolation ON public.cost_centers
  USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);
```

الجداول المتأثرة: `account_reconciliations`, `account_segments`, `cost_centers`, `currency_exchange_rates`, `currency_translations`, `journal_approval_rules`, `journal_entry_approvals`, `journal_entry_attachments`, `journal_entry_comments`, `profit_centers`, `reconciliation_items`.

الواجهة **لا تضبط هذا الـGUC أبدًا** (و`set_current_org` تضبط `app.current_org_id` وهو اسم مختلف). أي استعلام مباشر يعيد **صفر صفوف** — فاشل-مغلق.

**التقييم:** ليست ثغرة استغلال بل عطب وظيفي كامن. الواجهة تتجنّب معظمها عبر RPC، لكنه سبب محتمل لـ"لوحات فارغة" عند أي وصول مباشر مستقبلي. **وهو نفس النمط الذي أزالته Migration 118 من 38 جدولًا — هذه بقايا لم تُنظَّف.**

---

## 🔴 الفجوة 5: نموذج الصلاحيات — الواجهة مقابل قاعدة البيانات

الواجهة تبني الصلاحيات محليًا و**تُسقِط جزء `resource`**:

```ts
// src/hooks/usePermissions.ts:172
perms.push({
  module_code: rp.permission.module.name,
  action: rp.permission.action,          // ← resource مفقود
});
```

والحرّاس يطلبون دائمًا `(module, 'view')`. لكن مخطّط قاعدة البيانات هو **`module.resource.action`** (ثلاثة أجزاء)، والبذرة نادرًا ما تحوي `view` مجرّدة (غالبًا تحت `general_ledger.*` فقط).

**ثلاث نتائج:**

1. مستخدم مُنِح فعليًا `manufacturing.orders.read` يُخزَّن كـ`{manufacturing, read}`، فيصير `hasPermission('manufacturing','view') = false` ⇒ **يُقفَل خارج وحدات يحق له رؤيتها**. النظام لا يعمل عمليًا إلا لمدير المؤسسة/السوبر أدمن (اللذين يتجاوزان الفحص).
2. دالة `has_permission` في قاعدة البيانات **لا تُستدعى إطلاقًا** من الواجهة الحيّة (توجد فقط في مساعد غير مستخدم يبني مفتاحًا خاطئًا من جزأين).
3. التعديلات الحسّاسة (دليل الحسابات، القيود، BOM، أوامر التصنيع، السندات) **غير محميّة بأي فحص صلاحية على مستوى الإجراء** في الواجهة، وقاعدة البيانات تفحص عضوية المؤسسة فقط. ⇒ **لا طبقة تفرض فصل المهام** (نفس البند الأمني 6).

---

## 🔴 الفجوة 6: تذبذب تسمية وسائط RPC

نداءات الواجهة تخلط `p_org_id` و`p_org` و`p_tenant` و`org_id`/`tenant_id` داخل `p_payload`. كلٌّ يعمل إن طابق دالته، لكنه هشّ ويكسر بصمت عند أي إعادة تسمية.

كذلك `get_effective_org_id` و`set_current_org` ما زالتا ممنوحتين لـ`anon` — ميتتان وظيفيًا بعد Migration 170 لكنهما رائحة كود تستحق التنظيف.

---

# الجزء الثالث: جدول الأولويات الموحّد

| # | البند | الفئة | الحالة | الأثر | الطبقة |
|---|---|---|---|---|---|
| A1 | تدوير مفتاح Gemini + `PROXY_AUTH_KEY` فعليًا | أمن | 🔴 خارج المستودع | تسريب مؤكَّد سابقًا | تشغيلي |
| A2 | تغيير/تعطيل حساب `admin@wardah.sa` | أمن | 🔴 خارج المستودع | تسريب مؤكَّد سابقًا | تشغيلي |
| B1 | الفجوة 1 — توحيد سياق المؤسسة | معمارية | 🔴 مفتوح | كسر متعدد المؤسسات + مبدّل وهمي | واجهة + DB |
| B2 | الفجوة 2 — إنهاء الكتابة المباشرة على `gl_entries` | معمارية | 🔴 مفتوح | قيود يدوية معطّلة | واجهة |
| B3 | الفجوة 5 + الأمنية 6 — نموذج الصلاحيات وفرض الإجراء | معمارية/أمن | 🔴 مفتوح | إقفال مستخدمين + غياب فصل مهام | واجهة + DB |
| C1 | الأمنية 4 + 9 — مصادقة البروكسي وأسراره | أمن | 🔴 مفتوح | يعتمد على كون الخدمة منشورة | خدمة منفصلة |
| C2 | الأمنية 13 — فلترة `is_active` في جداول التصنيع | أمن | 🔴 مفتوح | عضو معطَّل يكتب | DB |
| C3 | الأمنية 10 — تحويل CSP إلى وضع الفرض | أمن | 🔴 مفتوح | دفاع بالعمق | نشر |
| C4 | الأمنية 11 — CORS + rate limit لدوال Edge | أمن | 🟡 جزئي | استنزاف حصة | Edge |
| D1 | الفجوة 4 — تنظيف سياسات `app.current_tenant_id` | معمارية | 🔴 مفتوح | كامن (فاشل-مغلق) | DB |
| D2 | الفجوة 3 + 6 — توحيد أسماء الأعمدة ووسائط RPC | معمارية | 🔴 مفتوح | هشاشة | واجهة + DB |
| D3 | الأمنية 12 — إعدادات Vite | أمن | 🔴 مفتوح | تطويري فقط | تطوير |
| D4 | مراجعة `xlsx` — موعد المراجعة فات | تبعيات | 🔴 مفتوح | إداري | تبعيات |

---

## ملاحظات إلزامية للتنفيذ

قبل أي معالجة لبنود قاعدة البيانات، تنطبق قواعد `CLAUDE.md` كاملةً:

1. **القاعدة الذهبية:** لا حذف. `CREATE OR REPLACE`، سياسات تُعاد إنشاؤها لا تُسقط بلا بديل، أعمدة nullable.
2. **ترتيب النشر:** الـmigration والواجهة التي تعتمد عليها **لا يُدمجان في PR واحد**. `repository-first` للـmigration ثم `DB-first` للواجهة.
3. **B1 و B3 يمسّان الطبقتين معًا** ⇒ كلٌّ منهما يحتاج **PRين على الأقل**: PR قاعدة بيانات يُدمج ويُطبَّق ويُتحقَّق منه، ثم PR الواجهة.
4. **B2 قد يكون واجهة فقط** (تحويل المسارات إلى `rpc_create_journal_entry` القائمة) — يُتحقق أولًا من أن الـRPC تغطي كل الحالات قبل افتراض ذلك.
5. **CLAUDE.md بحاجة تحديث:** يذكر أن Production عند 152؛ الحالة الحيّة عند 171. والـBaseline الحالي cutoff 152 — أي 19 migration بعد الـcutoff.

---

## ملحق: أوامر إعادة التحقق

```bash
# الأسرار
grep -rn "AIzaSy\|S3cur3Pr0xyK3y" --include=*.html --include=*.ts --include=*.tsx --include=*.js . | grep -v node_modules

# الكتابة المباشرة على دفتر الأستاذ
grep -rn "from('gl_entries')\|from('gl_entry_lines')" src/ --include=*.ts --include=*.tsx

# سياسات الكتابة على gl_entries (يجب أن تبقى فارغة حتى يُتخذ قرار معماري)
grep -rn "POLICY.*gl_entries" sql/migrations/*.sql

# سياسات الـGUC الميت
grep -n "app.current_tenant_id" sql/baseline/000_schema_baseline_*.sql | grep -o "ON public\.[a-z_]*" | sort -u

# سجل Production الحيّ
# SELECT name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20;
```
