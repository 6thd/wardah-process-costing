# خطة معالجة ملاحظات مراجعة كودكس — 16 يوليو 2026

> **المصدر**: المراجعة الخارجية (كودكس) بتاريخ 16 يوليو 2026 — تقييم عام 7.7/10.
> **الهدف**: الوصول إلى نطاق 9/10 عبر إغلاق الفئة C من دوال SECURITY DEFINER،
> وإنجاح بناء القاعدة من الصفر بنسبة 100%، وتغطية E2E، وتوحيد الترجمة.
> **القاعدة**: لا يُنقل بند إلى «مكتمل» إلا بمعيار قبول مُتحقَّق منه (اختبار أو فحص حي).

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
   **1,022 موضعًا في 66 ملفًا** عبر `src/` (منها 35 فقط في `sidebar.tsx`).
   ⇒ التوحيد الكامل مشروع تدريجي مُقسَّم على مراحل، وليس مهمة واحدة.

---

## P0 — أمني وبنية قاعدة (يبدأ فورًا، لا شيء قبله)

### ✅ T1 — Migration 120: تحصين دوال الفئة C الـ28 (الأولوية المطلقة)

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

### ☐ T2 — Schema Baseline قانوني من الإنتاج

**المرجع**: `docs/db/FRESH_DB_REBUILD_REPORT.md` (العلاج المقترح فيه معتمد).

1. توليد baseline (يتطلب بيانات اعتماد المشروع — Supabase CLI أو GitHub Action):
   ```bash
   supabase db dump --project-ref uutfztmqvajmsxnrqeiv \
     -f sql/baseline/000_schema_baseline_YYYYMMDD.sql
   ```
   **يُولَّد بعد تطبيق Migration 120** حتى يتضمن الحواجز الجديدة.
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

### ☐ T5 — اختبار i18n للقوائم الفرعية (React Testing Library)

ملف جديد `src/components/layout/__tests__/sidebar-i18n.test.tsx`:

1. Render للـSidebar داخل مزودي i18n/Zustand الفعليين.
2. اختيار العربية ⇒ فتح **كل** قائمة رئيسية ⇒ التحقق من النصوص العربية.
3. التبديل إلى الإنجليزية **دون إعادة تحميل** ⇒ التحقق من:
   - تغيّر كل نصوص القوائم الفرعية (assertion: لا يبقى نص عربي —
     regex `[؀-ۿ]` على نص القائمة).
   - `document.documentElement.dir === 'ltr'` و`lang === 'en'`.
4. العودة للعربية ⇒ `dir === 'rtl'`.
5. فحص اكتمال مفاتيح `navigation.*`: كل مفتاح مستخدم في sidebar موجود في
   ملفي `ar` و`en` (اختبار يعدّد المفاتيح آليًا).

**معيار القبول**: الاختبار يمر، ويفشل عند حذف أي مفتاح navigation متعمَّدًا.

### ☐ T6 — توحيد الترجمة (تدريجي — 1,022 موضعًا في 66 ملفًا)

- **المرحلة 1 (ضمن هذه الدفعة)**: طبقة التنقل —
  `sidebar.tsx` (35) + `HeaderUserMenuItems.tsx` (11) + `HeaderUserMenu.tsx`
  + `HeaderSearch.tsx` + `main-layout.tsx` + `ModuleGuard.tsx`
  ⇒ كلها إلى مفاتيح `navigation.*` / `common.*` في `translation.json`.
- **إصلاحان لغويان فوريان** (ضمن المرحلة 1):
  - `sidebar.tsx:501`: `'المستخدمين'` ⇒ `'المستخدمون'` (عنوان مرفوع).
  - نص قارئ الشاشة في مبدل اللغة: `Toggle language` ⇒
    `t('common.toggleLanguage')` بمفتاحين ar/en.
- **المرحلة 2**: الشاشات عالية الاستخدام (accounting/journal-entries،
  trial-balance، manufacturing/index، reports) — دفعات ≤ 200 موضع لكل PR
  مع مرور اختبار T5 بعد كل دفعة.
- **المرحلة 3**: قاعدة ESLint مخصصة (no-restricted-syntax على نمط
  `ConditionalExpression` بسلاسل عربية) تمنع **إضافة** النمط الجديد،
  مع استثناء الملفات القديمة غير المُهاجَرة بعد (قائمة بيضاء تتقلص).

**معيار القبول للمرحلة 1**: صفر `isRTL ? '` في `src/components/layout/` +
اختبار T5 أخضر + مراجعة بصرية للقائمتين ar/en.

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
| T1 ✅ | Migration 120 — تحصين 28 دالة DEFINER | **P0** | — | اختبار مؤسستين 28/28 رفض صريح |
| T2 | Schema baseline من الإنتاج | **P0** | T1 (يُدمج فيه) | baseline يبني قاعدة نظيفة مطابقة |
| T3 | fresh-db CI أخضر 100% | **P0** | T2 | job أخضر + يفشل على صياغة خاطئة |
| T4 | E2E Playwright (أدوار + مؤسستان) | P1 | T1 | المصفوفة خضراء على staging |
| T5 | اختبار i18n للقوائم الفرعية | P1 | — | التبديل بلا reload يغيّر كل النصوص |
| T6 | توحيد الترجمة (مرحلة 1: التنقل) | P1 | T5 | صفر hardcoded في layout/ |
| T7 ✅ | تصحيح MANIFEST (6 بنود) | P2 | — | البنود الستة مطبقة |
| T8 | تحسينات البناء والحزم | P2 | — | بناء نظيف + chunks أصغر |

**ملاحظات جدولة**:
- T7 رخيصة ويمكن تنفيذها فورًا بالتوازي مع T1 (لا تلمس القاعدة).
- T5 قبل T6 عمدًا: الاختبار يحمي عملية النقل من الكسر الصامت.
- T2 بعد T1 عمدًا: الـbaseline يجب أن يلتقط الحواجز الجديدة لا ما قبلها.
- لا يُرفع تقييم الجاهزية إلا بعد T1+T2+T3 (الأمن والبنية) ثم T4 (الإثبات).
