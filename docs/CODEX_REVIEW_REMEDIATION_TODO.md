# خطة معالجة ملاحظات مراجعة كودكس — 16 يوليو 2026

> **المصدر**: المراجعة الخارجية (كودكس) بتاريخ 16 يوليو 2026 — تقييم عام 7.7/10،
> ثم **مراجعة حية ثانية (كودكس، 2026-07-16 مساءً) خفّضت التقييم إلى 5.8/10**
> بعد إثبات ثغرة عزل مؤسسات P0 حيّة (انظر T1b).
> **الهدف**: الوصول إلى نطاق 9/10 عبر إغلاق عزل المؤسسات عند الجذر،
> وإنجاح بناء القاعدة من الصفر بنسبة 100%، وتغطية E2E، وتوحيد الترجمة.
> **القاعدة**: لا يُنقل بند إلى «مكتمل» إلا بمعيار قبول مُتحقَّق منه (اختبار أو فحص حي).
>
> **تحديث الحالة (2026-07-16 مساءً)**: أُغلقت P0 الجديدة بـ **Migration 121**
> (مطبَّقة + مختبرة حيّاً 10/10 — T1b)؛ أُصلحت علّة useMemo في الـsidebar وارتُقيت
> اختبارات i18n (T5 ✅)؛ أُكملت المرحلة 1 من توحيد الترجمة (T6-م1 ✅).

---

## صفر — حقائق تم التحقق منها قبل كتابة الخطة (تُعدِّل ملاحظات كودكس)

هذه الفحوصات أُجريت على المستودع مباشرة وتغيّر بعض تفاصيل المعالجة:

1. **لغز 148 = 60 + 87 محلول**: التقرير الخام
   (`docs/db/fresh_db_chain_report_20260716.txt`) يحوي 147 سطرًا بالضبط
   (60 PASS + 87 FAIL). الملف الغائب هو
   **`119_consolidate_overlapping_policies.sql`** — لم يُنفَّذ أصلًا لأن
   السلسلة توقفت بعد فشل 118 (آخر سطر في التقرير). التصحيح الصحيح:
   **60 نجحت / 87 فشلت / 1 لم تُشغَّل — من 148**.
2. **خيار REVOKE غير متاح لأي دالة من الفئة C**: فحص مواقع الاستدعاء في
   `src/` أظهر أن **كل الدوال الـ28** (بما فيها الـ11 عالية الخطورة) لها
   call sites فعلية في الواجهة (`journal-service.ts`، `mesService.ts`،
   `capacityService.ts`، `routingService.ts`، `efficiencyService.ts`،
   `rbac-service.ts`، `posting-service.ts`، `ui/events.ts`،
   `account-statement/index.tsx`، `useTrialBalance.ts`،
   `VarianceAnalysisReport.tsx`، `journalEntryService.ts`).
   ⇒ المعالجة الوحيدة الممكنة: **حارس داخلي** أو **تحويل إلى SECURITY INVOKER**.
3. **النصوص المكتوبة مباشرة (`isRTL ? '..' : '..'`) ليست مشكلة sidebar فقط**:
   العدّ اليدوي السابق (1,022 / 891 / 781) كان متضاربًا. الرقم الآلي الآن عبر
   `scripts/i18n/count-hardcoded.mjs`: **753 موضعًا في 49 ملفًا** (النمط
   `isRTL ? '<عربي>'`، مع استثناء ملفات الاختبار). ⇒ يُعتمد ناتج السكربت مصدرًا
   وحيدًا للرقم بدل العدّ اليدوي؛ التوحيد الكامل مشروع تدريجي مُقسَّم على مراحل.
4. **الثغرة الأخطر كانت في طبقة المحلّل لا في الدوال**: فحص migration 120
   الختامي كان false-negative لأنه اعتبر مجرد ورود `wardah_org_id`/
   `get_current_tenant_id` "حماية"، بينما هذان الجذران نفساهما لم يتحققا من
   العضوية وكانا يسقطان للمؤسسة الافتراضية `000…001`. ⇒ عولج في **T1b /
   Migration 121** بجعل الجذرين fail-closed.

---

## P0 — أمني وبنية قاعدة (يبدأ فورًا، لا شيء قبله)

### ⚠️ T1 — Migration 120: تحصين دوال الفئة C الـ28 (جزئية — الجذر لم يُغطَّ)

> **تحديث بعد المراجعة الحية الثانية**: Migration 120 حصّنت 17 دالة فعلاً وحوّلت
> 10 إلى INVOKER، لكنها **لم تُغلق P0 بالكامل**: فحصها الختامي كان false-negative
> (وثِق بـ`wardah_org_id`/`get_current_tenant_id` دون التحقق من أنهما يفحصان
> العضوية)، وملف الاختبار السلبي `test_definer_org_guards.sql` لم يُنشأ. الإغلاق
> الفعلي في **T1b / Migration 121** أدناه. تبقى T1 «جزئية» لا «مكتملة».

**المرجع**: `docs/security/SECURITY_DEFINER_AUDIT.md`

**خطوات التنفيذ**:

1. **حارس معياري واحد** بدل تكرار الكود في 28 جسمًا:
   ```sql
   CREATE OR REPLACE FUNCTION wardah_assert_org_member(p_org uuid)
   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
   BEGIN
     IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
     IF NOT EXISTS (SELECT 1 FROM user_organizations
                    WHERE user_id = auth.uid() AND org_id = p_org AND is_active = true)
     THEN RAISE EXCEPTION 'NOT_ORG_MEMBER'; END IF;
   END $$;
   REVOKE EXECUTE ON FUNCTION wardah_assert_org_member(uuid) FROM PUBLIC, anon, authenticated;
   ```
   وحارس إداري مرافق `wardah_assert_org_admin(p_org)` يستدعي
   `wardah_is_org_admin` القائمة.

2. **الدوال الكتابية عالية الخطورة (🔴 الإحدى عشرة)** — حارس عضوية + بوابة
   عملية، **واشتقاق org من السجل المستهدف لا من معامل العميل**:

   | الدالة | مصدر org الصحيح | البوابة الإضافية |
   |---|---|---|
   | `approve_journal_entry` | من صف `gl_entries` عبر `p_entry_id` | صلاحية اعتماد (admin أو `has_permission`) |
   | `batch_post_journal_entries` | من كل صف في `p_entry_ids` (رفض الكل إن اختلط) | صلاحية ترحيل |
   | `reverse_journal_entry_enhanced` | من صف القيد | صلاحية عكس (admin) |
   | `release_manufacturing_order` | من صف `manufacturing_orders` | عضوية تكفي |
   | `complete_operation` / `start_operation` / `backflush_materials` | من صف `work_orders`→MO | عضوية تكفي |
   | `create_role_from_template` | `p_org_id` بعد `wardah_assert_org_admin` | **تجاهل `p_created_by` واستخدام `auth.uid()`** |
   | `get_account_statement` | `wardah_org_id()` داخليًا | عضوية تكفي (قراءة مالية) |
   | `rpc_get_trial_balance` | تحقق أن المستدعي عضو في `p_tenant` | عضوية تكفي |
   | `upsert_stage_cost` | تحقق أن المستدعي عضو في `p_tenant` + ملكية MO لنفس org | عضوية تكفي |

3. **الدوال القرائية الحسابية (🟠/🟡)** — القرار لكل دالة:
   - `calculate_*` / `get_*_summary` / `identify_bottlenecks` /
     `check_entry_approval_required`: تحويل إلى **SECURITY INVOKER**
     إن كانت كل الجداول التي تقرؤها محمية بسياسات RLS عاملة (تحقق فردي)،
     وإلا حارس عضوية.
   - الكتابية منها (`auto_schedule_work_orders`, `schedule_work_order`,
     `update_work_center_load`, `assign_routing_to_mo`, `copy_routing`,
     `generate_work_orders_from_mo`, `generate_entry_number`): حارس عضوية
     مشتق من السجل المستهدف.

4. **اختبارات سلبية بمؤسستين** —
   `scripts/security/test_definer_org_guards.sql` (على نمط
   `test_payroll_rbac.sql` القائم): User A عضو Org A يمرر معرفات Org B
   لكل دالة من الـ28 ⇒ **النتيجة المطلوبة `RAISE EXCEPTION` صريح
   (NOT_ORG_MEMBER)، وليس 0 صف**.

5. **حارس CI دائم**: إضافة فحص إلى `scripts/ci/` يفشل الـPR إذا ظهرت:
   - دالة DEFINER جديدة قابلة للتنفيذ من `anon` (غير المستثناة الموثقة)؛
   - دالة DEFINER جديدة لـ`authenticated` بلا سطر تحقق عضوية في جسمها
     (نمط regex المعتمد في التدقيق).

6. **التطبيق**: staging أولًا ثم إنتاج عبر `apply_migration` + سطر جديد في
   `MANIFEST.md` + تحديث `SECURITY_DEFINER_AUDIT.md` (الفئة C ⇒ 0).

**معيار القبول**: اختبار المؤسستين يمر 28/28 برفض صريح، وAdvisor لا يُظهر
دالة C جديدة، وجميع شاشات الواجهة المستدعية تعمل لعضو المؤسسة الشرعي
(smoke على: القيود، ميزان المراجعة، كشف الحساب، MES، الجدولة، الأدوار).

---

### ✅ T1b — Migration 121: إغلاق ثغرة عزل المؤسسات عند الجذر (P0 — مطبَّقة)

**المرجع**: `sql/migrations/121_fail_closed_tenant_isolation.sql` +
`scripts/security/test_definer_org_guards.sql`

**الثغرة المُثبتة حيّاً (قبل 121)**: هوية `authenticated` بلا أي عضوية في
`user_organizations` كانت تُحلّ إلى المؤسسة الافتراضية `000…001` وتقرأ/تكتب
بياناتها (مثبت: 118 منتجًا + 11 قيد GL مرئية + `UPDATE products` ناجح). الجذر:
- `get_current_tenant_id()` تُرجع `000…001` كـ fallback في المسار الطبيعي **وفي
  معالج EXCEPTION**.
- `wardah_org_id(p_explicit)` تُرجع قيمة العميل بلا فحص عضوية. **كل 99 سياسة RLS
  (54 جدولًا) تعتمد `wardah_org_id`** ⇒ الثغرة قراءةً وكتابةً.
- 17 دالة RPC بصفة DEFINER (كودكس ذكر 9؛ الفحص الحي وجد 17) تشتق org عبر الجذر
  غير الآمن.

**ما نُفِّذ**:
1. **`wardah_org_id` = الجذر الأمني الموثّق**: لا يُرجع أبدًا مؤسسة ليس المستخدم
   عضوًا نشطًا فيها (NULL بدلًا من ذلك)؛ **لا يرفع استثناءً** (لأنه في مسند 99
   سياسة RLS — الاستثناء داخل مسند سياسة يُفجّر كل استعلام بـ500 بدل الإغلاق
   الصامت). NULL ⇒ `org_id = NULL` ⇒ لا صف يطابق قراءةً وWITH CHECK يرفض كتابةً.
2. **`get_current_tenant_id`** بلا مؤسسة افتراضية إطلاقًا: claim الـJWT يُقبل بعد
   تأكيد العضوية، وإلا العضوية الوحيدة النشطة، وإلا NULL؛ EXCEPTION ⇒ NULL.
3. دالة boolean جديدة `wardah_is_org_member` (لا ترفع استثناءً — مناسبة للجذر).
4. حارس صريح `wardah_assert_org_member` على `rpc_create_mo_with_reservation`
   (الوحيدة بين الـ17 بلا `IF v_org IS NULL`؛ الباقية تُغلَق بتحصين الجذر لأنها
   تحتوي أصلًا `IF v_org IS NULL THEN RAISE`).
5. **فحص ختامي صارم** يستبدل فحص 120 الضعيف: يتحقق أولًا أن الجذرين محصَّنان
   فعلًا (لا UUID افتراضي + يفحصان `user_organizations`) ثم يثق بورودهما.

**قرار معماري موثق**: لم تُعَد كتابة الـ99 سياسة RLS إلى `EXISTS` مباشر في هذه
الدفعة — تحصين الجذر يجعلها fail-closed فعليًا، وتغيير 99 سياسة دفعةً واحدة blast
radius غير مبرَّر الآن (نُقل إلى متابعة FU-1 أدناه).

**معيار القبول — مُتحقَّق حيّاً (2026-07-16)**: `test_definer_org_guards.sql`
يمر **10/10**: هوية بلا عضوية ⇒ 0 صف قراءةً/كتابةً وRPC مرفوض؛ العضو الشرعي ⇒
118 منتجًا (لم ينكسر)؛ `p_explicit=OrgB` وJWT مزوّر بـdefault ⇒ مرفوضان.
`get_advisors(security)` بعد التطبيق: لا lint أمني جديد من 121.

---

### ☐ T2 — Schema Baseline قانوني من الإنتاج

**المرجع**: `docs/db/FRESH_DB_REBUILD_REPORT.md` (العلاج المقترح فيه معتمد).

1. توليد baseline (يتطلب بيانات اعتماد المشروع — Supabase CLI أو GitHub Action):
   ```bash
   supabase db dump --project-ref uutfztmqvajmsxnrqeiv \
     -f sql/baseline/000_schema_baseline_YYYYMMDD.sql
   ```
   **يُولَّد بعد تطبيق Migration 121** حتى يتضمن الجذر المحصَّن الجديد.
2. قاعدة جديدة = baseline + migrations أحدث من تاريخ الـbaseline فقط
   (الملفات 1–119 تبقى للتاريخ).
3. تحديث `MANIFEST.md`: قسم «بناء بيئة جديدة» يبدأ من baseline.

**معيار القبول**: `psql -f baseline` على PostgreSQL 16 نظيف (مع
`supabase_shim.sql`) ينجح بلا أخطاء، ثم `pg_dump --schema-only` للناتج
يُقارن بالإنتاج (فرق مقبول: تعليقات/ترتيب فقط).

### ☐ T3 — fresh-db CI ينجح 100% (وليس توثيق 87 فشلًا)

1. بعد T2: job CI (GitHub Actions) يطبق baseline + كل migration رقمها
   ≥ رقم الـbaseline على Postgres فارغ **في كل PR** — الأدوات جاهزة في
   `scripts/ci/fresh-db/`.
2. **إصلاح `run_chain.sh`**: تسجيل سطر لكل ملف في السلسلة حتى عند التوقف
   المبكر (`NOT_RUN`) — يمنع تكرار غموض 147/148، ويُضاف تحقق ختامي
   `عدد الأسطر == عدد ملفات الترتيب`.

**معيار القبول**: الـjob أخضر على PR فارغ، ويفشل عند دسّ migration
بصياغة خاطئة (اختبار سلبي واحد موثق).

**فجوات مؤكَّدة في الـworkflow الحالي (من المراجعة الحية — تُصلَح ضمن T3)**:
- لا خدمة PostgreSQL معرَّفة في `ci-cd.yml` (يحسب PGHOST/PGUSER لخادم غير موجود).
- `BASELINE_TS` يُحسب ولا يُستخدَم.
- `scripts/ci/fresh-db/build_apply_order.py` لا يقبل cutoff/تاريخ ⇒ يولّد كل
  السلسلة 1–120 فوق الـbaseline بدل «الأحدث من baseline فقط».
- فحص ترقيم migrations `grep -qE "\b${i}\b" "$MANIFEST"` فضفاض (أي ظهور للرقم في
  نثر MANIFEST يمرّره) ⇒ يُستبدَل بملف فجوات machine-readable (انظر FU-2).

---

## P1 — اختبارات شاملة وتوحيد الترجمة

### ☐ T4 — E2E بـ Playwright لكل route رئيسي

الموجود فعلًا: `playwright.config.ts` + مجلد `e2e/` — يُبنى عليهما.

1. **حسابات اختبار** في staging: مستخدم عادي + Org Admin + Super Admin،
   وموزعة على **مؤسستين** (Org A / Org B) لسيناريوهات العزل.
2. **مصفوفة السيناريوهات**:
   - تسجيل الدخول والخروج لكل دور.
   - فتح كل route رئيسي (من تعريفات القوائم في `sidebar.tsx`) والتحقق من:
     تحميل بيانات (لا صفحة فارغة)، **صفر أخطاء console**، صفر أخطاء
     Supabase API (تُلتقط عبر page.on('response')).
   - عمليات CRUD أساسية: إنشاء قيد + اعتماد + ترحيل؛ أمر تصنيع + إتمام؛
     استلام بضاعة.
   - **عزل المؤسسات من الواجهة**: مستخدم Org A لا يرى بيانات Org B في
     أي شاشة (مكمل لاختبارات SQL في T1).
   - viewport هاتف (390×844) للـroutes الخمسة الأكثر استخدامًا.
3. تشغيل في CI ليلي (وليس على كل PR — مدته أطول).

**معيار القبول**: المصفوفة خضراء على staging، وتقرير HTML مُرفق كـartifact.

### ✅ T5 — اختبار i18n للقوائم الفرعية (React Testing Library)

> **مكتملة** — بالإضافة إلى إصلاح علّة `useMemo` الجذرية في `sidebar.tsx`.

**علّة أُصلحت أولًا**: كانت subItems تخزّن `label: t('navigation.X')` مُقيَّمة عند
الإنشاء، و`useMemo` بـ deps `[isOrgAdmin, isSuperAdmin]` (بلا اللغة) يجمّدها ⇒ عند
تبديل اللغة تبقى القوائم الفرعية بالعربية. الإصلاح: تُخزَّن `labelKey` (مفتاح ثابت)
وتُترجَم عند العرض `t(subItem.labelKey)` — العناوين الرئيسية كانت تُترجَم live أصلًا.

**الاختبار** (`src/components/layout/__tests__/sidebar-i18n.test.tsx`، 9/9 أخضر):
1. dir/lang يتغيّران بلا reload، والعودة للعربية.
2. **استخراج آلي** لكل مفاتيح `navigation.*` (القوائم الرئيسية + كل subItems) من
   مصدر المكوّن عبر `?raw`، والتأكد من وجودها في `ar` و`en` (بدل القائمة اليدوية
   الناقصة سابقًا).
3. **فتح القوائم الفرعية** (كل الصلاحيات مفعّلة ⇒ كل القوائم في DOM) والتحقق أنه
   **لا يبقى أي حرف عربي** (regex `[؀-ۿ]`) بعد التحويل إلى الإنجليزية.

**معيار القبول**: مُتحقَّق — الاختبار يمر ويمسك الـfreeze (يفشل لو بقيت subItems
مجمَّدة)، ويفشل عند حذف أي مفتاح navigation.

### ◐ T6 — توحيد الترجمة (تدريجي — الرقم الآلي: 753 موضعًا في 49 ملفًا)

- **✅ المرحلة 1 (مكتملة)**: طبقة التنقل والحماية —
  `sidebar.tsx` (تسميات القوائم + aria-label الجانبية) + `main-layout.tsx`
  (`aria-label` ⇒ `common.closeSidebar`) + `language-toggle.tsx`
  (`Toggle language` ⇒ `common.toggleLanguage`) + `ModuleGuard.tsx`
  (5 نصوص ⇒ `auth.accessDenied/accessDeniedDescription/goBack/goToDashboard/
  checkingPermissions`). أُضيفت المفاتيح في `ar` و`en`. (كانت
  `HeaderUserMenuItems`/`HeaderUserMenu` قد رُحِّلت في دفعة سابقة.)
- **✅ عدّاد آلي**: `scripts/i18n/count-hardcoded.mjs` (يعدّ `isRTL ? '<عربي>'`)
  — يُعتمد مصدرًا وحيدًا للرقم بدل العدّ اليدوي المتضارب. الحالي: **753/49**.
- **☐ المرحلة 2**: الشاشات عالية الاستخدام (أعلى الملفات من ناتج العدّاد:
  `salesReportsExport.ts` 63، `EfficiencyDashboard.tsx` 62،
  `general-ledger/index.tsx` 60، `cost-of-production-report.tsx` 56،
  `CapacityDashboard.tsx` 49) — دفعات ≤ 200 موضع لكل PR، ويُعاد تشغيل العدّاد
  بعد كل دفعة لتحديث الرقم.
- **☐ المرحلة 3**: قاعدة ESLint مخصصة (no-restricted-syntax على نمط
  `ConditionalExpression` بسلاسل عربية) تمنع **إضافة** النمط الجديد،
  مع قائمة بيضاء تتقلص للملفات غير المُهاجَرة.

**معيار القبول للمرحلة 1**: ✅ مُتحقَّق — صفر hardcoded في طبقة التنقل/الحماية +
اختبار T5 أخضر (9/9) + TypeScript صفر أخطاء + كل الاختبارات 3607/3607.

---

## P2 — تصحيح التوثيق وتحسينات البناء

### ✅ T7 — تصحيح `sql/migrations/MANIFEST.md` (ستة تصحيحات)

1. **الأرقام**: «60 نجحت / 87 فشلت» ⇒
   «**60 نجحت / 87 فشلت / 1 لم تُشغَّل (119 — توقفت السلسلة بعد فشل 118) = 148**»،
   والتصحيح نفسه في `FRESH_DB_REBUILD_REPORT.md`.
2. **ترتيب الجدول**: إعادة ترتيب «الجوهر المطبَّق» تصاعديًا
   (100 → 119 بعد 99)، أو فصله إلى قسمين معنونين: «تاريخي 66–99» و«الموحَّد 100–119».
3. **تكرار 110**: حذف السطر الثاني المكرر في قسم «أرقام جديدة»
   (السطران 145 و147 حاليًا).
4. **وصف 108**: من «ستُعيد خطأ عند التنفيذ» إلى
   «النسخة الأصلية اعتمدت جداول غائبة؛ **حُصِّن التنفيذ في 117**
   (to_regclass ⇒ فارغ بأمان)».
5. **صياغة 106**: «صفر دوال DEFINER مكشوفة لـ anon» ⇒
   «صفر دوال **غير مقصودة** لـ anon؛ الاستثناء الوحيد الموثق
   `rpc_get_invitation_preview` (عمدًا — راجع SECURITY_DEFINER_AUDIT)».
6. **تقييد عبارة التمثيل**: توضيح أن المستودع يمثل migrations 101–119
   حرفيًا/دلاليًا، لكنه **لا يوفر بعد baseline مستقلًا** لإعادة بناء
   المخطط التاريخي من الصفر (يُغلق نهائيًا بـ T2).

### ☐ T8 — تحسينات البناء (لا تحجب شيئًا، تُنفَّذ آخرًا)

1. **الاستيراد المزدوج لـ`purchasing-service`**: توحيد المسار —
   `GoodsReceiptForm` يستورد ثابتًا بينما `purchasing/index` ديناميكيًا ⇒
   اعتماد الثابت في الموضعين (أو العكس) ليستقيم code splitting.
2. **تقسيم الحزم الثقيلة**: `React.lazy`/`import()` عند فتح الشاشة فقط لـ:
   ApexCharts (~584KB)، XLSX (~430KB)، jsPDF (~388KB) — التصدير Excel/PDF
   يُحمَّل عند ضغط زر التصدير لا عند فتح التطبيق.
3. **تحديث بيانات المتصفحات**: `npx update-browserslist-db@latest`
   (caniuse-lite أقدم بـ8 أشهر).
4. **تحذيرات sourcemap** لمكونات `src/components/ui/`
   (select/dialog/checkbox/alert-dialog/separator/switch/command):
   تشخيص السبب (غالبًا تحويل sourcemap في مكتبة وسيطة) ومعالجته أو كتمه
   المعلَّل في `vite.config.ts`.

**معيار القبول**: بناء إنتاجي نظيف من التحذيرات المذكورة، وأول تحميل
(main chunk) أصغر بشكل قابل للقياس (توثيق قبل/بعد بالأرقام).

---

## ملخص تنفيذي — الترتيب والاعتماديات

| # | المهمة | الأولوية | يعتمد على | معيار القبول المختصر |
|---|---|---|---|---|
| T1 ⚠️ | Migration 120 — تحصين 28 دالة DEFINER (جزئية) | **P0** | — | حصّنت 17؛ الجذر عولج في T1b |
| **T1b ✅** | **Migration 121 — عزل مؤسسات fail-closed عند الجذر** | **P0** | — | **10/10 اختبار سلبي حي؛ مطبَّقة على الإنتاج** |
| T2 | Schema baseline من الإنتاج | **P0** | T1b | baseline يبني قاعدة نظيفة مطابقة |
| T3 | fresh-db CI أخضر 100% | **P0** | T2 | job أخضر + يفشل على صياغة خاطئة |
| T4 | E2E Playwright (أدوار + مؤسستان) | P1 | T1b | المصفوفة خضراء على staging |
| T5 ✅ | اختبار i18n للقوائم الفرعية + إصلاح useMemo | P1 | — | 9/9؛ لا حرف عربي بعد التبديل |
| T6 ◐ | توحيد الترجمة (مرحلة 1 ✅ / 2–3 ☐) | P1 | T5 | م1: صفر hardcoded في طبقة التنقل |
| T7 ✅ | تصحيح MANIFEST (6 بنود) | P2 | — | البنود الستة مطبقة |
| T8 | تحسينات البناء والحزم | P2 | — | بناء نظيف + chunks أصغر |

### مهام متابعة موثَّقة (FU) — من المراجعة الحية، لا تحجب الجاهزية الأمنية

| # | المتابعة | الأولوية | ملاحظة |
|---|---|---|---|
| FU-1 | إعادة كتابة 99 سياسة RLS إلى `EXISTS(user_organizations…)` مباشر بدل الاعتماد على المحلّل | P2 | بعد 121 السياسات fail-closed فعليًا؛ هذه صلابة إضافية بـblast radius كبير |
| FU-2 | ملف فجوات ترقيم machine-readable (`skipped_migration_numbers.yml`) + سكربت يفحصه بدل `grep -qE "\b${i}\b"` | P2 | يُغلق ثغرة الفحص الفضفاض (T3) |
| FU-3 | fresh-db: تعريف خدمة Postgres + تمرير cutoff إلى `build_apply_order.py` + استخدام `BASELINE_TS` | P1 | ضمن T3 عمليًا |
| FU-4 | خطوة CI تولّد `database.generated.ts` وتقارنه (`git diff --exit-code`) بدل فحص عدد الأسطر | P2 | تحتاج secret على staging |
| FU-5 | إصلاح **SonarQube Quality Gate** الفاشل على `main` | P1 | CI/CD Pipeline نفسه أخضر؛ Sonar Gate فقط فاشل |

**حالة CI الحقيقية (2026-07-16)**: **CI/CD Pipeline أخضر** على أحدث `main`
(`381ad90`: TypeScript + ESLint + الاختبارات + فحص SQL). **SonarQube Analysis
فاشل** لسبب واحد: `QUALITY GATE STATUS: FAILED` (بوابة جودة، لا خطأ تقني) ⇒ FU-5.

**ملاحظات جدولة**:
- **T1b أُنجزت وأغلقت P0 الجديدة** — الأولوية الآن T2+T3 (البنية) ثم T4 (الإثبات).
- T2 بعد T1b عمدًا: الـbaseline يجب أن يلتقط الجذر المحصَّن الجديد لا ما قبله.
- لا يُرفع تقييم الجاهزية متعدد المؤسسات إلا بعد T2+T3 ثم T4.
