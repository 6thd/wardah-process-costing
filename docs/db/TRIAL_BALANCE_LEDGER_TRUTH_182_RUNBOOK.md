# Migration 182 — ميزان المراجعة على الدفتر القانوني (Runbook)

**الحالة:** 🟡 **مدمجة في `main`، غير مطبَّقة على Production بعد**
**الدمج:** PR #194 · `main@cdbe648cb2c64d9c4cbcf39daf4dcc7b24376e01`
**الملف:** `sql/migrations/182_trial_balance_ledger_truth.sql`
**البوابة:** `.github/workflows/trial-balance-ledger-truth.yml` (`RPC_CONTRACT=enforced`)
**عقد القبول:** `scripts/ci/fresh-db/acceptance_trial_balance_ledger_truth.sql`
**المرجع التحليلي:** [`TRIAL_BALANCE_CONSUMER_INVENTORY.md`](../ai-simulation-lab/TRIAL_BALANCE_CONSUMER_INVENTORY.md) · [`PRODUCTION_INTEGRITY_AUDIT_20260828.md`](../ai-simulation-lab/PRODUCTION_INTEGRITY_AUDIT_20260828.md)

---

## 1. ما تغلقه هذه الـmigration

`rpc_get_trial_balance` كانت تقرأ `journal_lines`/`journal_entries` — الدفتر
التاريخي المهجور — بينما كل مسارات الترحيل تكتب `gl_entries`/`gl_entry_lines`،
الدفتر القانوني بنص `CLAUDE.md`.

| القياس على Production (2026-08-28، قراءة فقط) | القيمة |
|---|---|
| ما يقرأه ميزان المراجعة (`journal_lines` المرحَّلة) | **2 سطر · 500.00** |
| الدفتر القانوني (`gl_entry_lines` المرحَّلة) | **22 سطرًا · 30,805.00** |

وأُعيد إنتاج العطل **مستقلًا على قاعدة نظيفة**: الدالة أعادت `0.00` لدفتر فيه
`2,000.00`. فالعطل خاصية في الدالة، لا أثر لبيانات تاريخية.

### عيبان إضافيان أُصلحا

| العيب | قبل | بعد |
|---|---|---|
| الأرصدة الافتتاحية | `0::NUMERIC` مثبَّتة في الكود، و`p_as_of_date` بلا أثر عليها | مشتقّة فعليًا (سنة مالية حتى التاريخ) |
| العمود العربي | `account_name_ar` يُغذَّى من `gl_accounts.name_en` (نص إنجليزي) | `COALESCE(name_ar, name)` — مطابق لـ`v_trial_balance` |

---

## 2. ما بقي كما هو بالضبط

| البند | الحالة |
|---|---|
| التوقيع `(p_tenant uuid, p_as_of_date date DEFAULT CURRENT_DATE)` | ✅ دون تغيير — `CREATE OR REPLACE` بلا `DROP` وبلا overload جديد |
| شكل الإرجاع (10 أعمدة بأسمائها) | ✅ دون تغيير — لا مستهلك يحتاج تعديلًا |
| حارس Migration 120 | ✅ `p_tenant` NULL يشتق من العضوية، ثم `wardah_assert_org_member` |
| المنح | ✅ `PUBLIC`/`anon` مسحوبان، `authenticated` و`service_role` ممنوحان |

---

## 3. تغييران سلوكيان مقصودان

كلاهما في اتجاه **الاكتمال**، ويجب أن يعرفهما المراجع:

1. **لم تعد الحسابات تُصفَّى بـ`allow_posting`/`is_active`.** حساب أُلغي تفعيله
   بعد أن حمل حركة يظل مالكًا لرصيده؛ استبعاده يُنقص ميزان المراجعة بصمت — وهو
   نفس صنف العطل الذي وُجدت هذه الـmigration لإزالته.
2. **الأسطر التي `account_id` فيها NULL** (صفوف تاريخية سابقة للعمود القانوني)
   تُطابَق بـ`account_code` داخل المؤسسة نفسها بدل إسقاطها، فلا يختفي شيء مرحَّل
   من التقرير.

**أثرهما المتوقع:** قد تظهر صفوف/أرصدة لم تكن تظهر. هذه استعادة لبيانات كانت
مفقودة، لا إضافة جديدة.

### 3.1 أثرهما المقاس على Production قبل التطبيق

نُفِّذت لقطة **قرائية فقط** بعد مراجعة PR #194 وقبل تطبيق 182. لم تغيّر اللقطة
أي صف، وكشفت أن مسار `account_id IS NULL` ليس حالة طرفية صغيرة بل يحمل غالبية
الحركة القانونية الحالية:

| القياس | النتيجة |
|---|---:|
| أسطر `gl_entry_lines` المرحَّلة | 22 |
| الأسطر المرحَّلة التي `account_id IS NULL` | 16 |
| المدين الذي تحمله تلك الأسطر | 19,910.00 من 30,805.00 (**64.6%**) |
| حسابات معطَّلة تحمل حركة | 0 |
| صفوف `accounting_periods` | 0 |
| `organizations.fiscal_year_start` | 1 (يناير) |

الرموز التاريخية السبعة هي: `1120`، `1130`، `1161`، `2101`، `2162`، `4001`،
`5001`. لا يطابق أيٌّ منها دليل `gl_accounts` الحالي (191 حسابًا برموز سداسية)،
وجدول `accounts` فارغ، و`gl_entry_lines.account_name` فارغ على الأسطر نفسها.

لذلك تتوقع مرحلة ما بعد التطبيق أن تستعيد المبالغ، لكن الصفوف السبعة ستظهر مؤقتًا
بالشكل الآتي حتى تُعالَج الروابط التاريخية:

| العمود | القيمة المتوقعة |
|---|---|
| `account_code` | الرمز الرباعي التاريخي |
| `account_name` | الرمز نفسه |
| `account_name_ar` | `NULL` |
| `account_type` | سلسلة فارغة |

هذه النتيجة أكمل من إسقاط 64.6% من المدين بصمت، لكنها تثبت دين سلامة بيانات مستقلًا
مسجلًا في [Issue #195](https://github.com/6thd/wardah-process-costing/issues/195).

---

## 4. تعريف الرصيد الافتتاحي

**سنة مالية حتى التاريخ (Fiscal-year-to-date):**

- الافتتاحي = حركة مرحَّلة **قبل** بداية السنة المالية التي يقع فيها `p_as_of_date`.
- الفترة = حركة مرحَّلة من تلك البداية حتى `p_as_of_date`.

بداية السنة المالية تُقرأ من `accounting_periods` (org-scoped، تحمل `fiscal_year`)؛
وعند غياب فترة تغطي `p_as_of_date` تُشتق من شهر `organizations.fiscal_year_start`،
بما في ذلك الرجوع إلى السنة الميلادية السابقة عندما يقع التاريخ قبل شهر البداية.
لا تُستخدم بداية يناير إلا إذا كان الإعداد غائبًا أو خارج النطاق `1..12`.

**لماذا مشتقّة لا ممرَّرة:** التوقيع لا يحمل تاريخ بداية، وإضافة معامل ثالث تُنشئ
دالة ثانية بتوقيع مختلف (overload) فتصير النداءات ثنائية المعاملات ملتبسة. الاشتقاق
يحافظ على التوقيع ولا يكسر أي مستهلك.

---

## 5. نتائج القبول — تشغيل فعلي

بيئة التحقق: PostgreSQL **16** محليًا. **CI يستخدم 17.**
فارقان ظهرا في الـBaseline على 16 فقط ولا وجود لهما على 17: `transaction_timeout`
و17 منح `MAINTAIN` — كلاهما معاملات/امتيازات خاصة بـPG17، صُفّيا محليًا دون
المساس بأي ملف في المستودع.

### 5.1 محاكاة CI كاملة من الصفر

```
build_apply_order (cutoff 181) → 182_trial_balance_ledger_truth.sql
run_chain                      → PASS=1 FAIL=0 NOT_RUN=0 TOTAL=1
```

### 5.2 عقد Ledger Truth بوضع `enforced`

| الفحص | النتيجة |
|---|---|
| LT-1 العرض = الدفتر القانوني | `view=2000.00 ledger=2000.00 aligned` ✅ |
| LT-2 الـRPC = الدفتر القانوني | `rpc=2000.0000 ledger=2000.00 aligned` ✅ |
| Case A ميزان متوازن | `closing dr=2000.0000 cr=2000.0000 balanced` ✅ |
| Case B أرصدة افتتاحية حقيقية من سنة مالية غير ميلادية | `opening dr=300.0000 period dr=2000.0000` ✅ |
| Case C عزل المستأجرين | `foreign org invisible and refused` ✅ |
| Case D الدفتر التاريخي بلا أثر | `legacy journal row present but inert (2300.0000 unchanged)` ✅ |
| Case E اكتمال الحساب/السطر والاسم العربي | `inactive account retained, NULL account_id matched, Arabic name=النقدية` ✅ |
| LT-3 إثبات احمرار LT-1 | `injected stale mirror → view=2425.00 ledger=2925.00 drift detected` ✅ |

### 5.3 السقّاطة — الحالات الأربع مُختبَرة

| حالة الـRPC | الوضع | النتيجة الفعلية |
|---|---|---|
| قبل 182 | `pending` | ✅ تمر — الفجوة مثبَّتة |
| قبل 182 | `enforced` | ❌ `LEDGER_TRUTH_LT2_FAIL` |
| بعد 182 | `pending` | ❌ `LEDGER_TRUTH_LT2_CONTRACT_STALE` |
| بعد 182 | `enforced` | ✅ تمر |

### 5.4 إثباتات الاحمرار للحالات نفسها

لم تُوصف بل نُفِّذت: رُكِّبت دوال معطوبة **بعمد** تمرّ من LT-2 لكن يجب أن تمسكها
حالة بعينها.

| الحقن | ما مرّ | ما احمرّ |
|---|---|---|
| دفتر قانوني صحيح لكن الافتتاحي مثبَّت على 0 (العطل القديم) | LT-1، LT-2، Case A | ❌ `CASE_B_FAIL: opening debit = 0, expected 300.00` |
| دفتر قانوني وافتتاحي صحيحان لكن **بلا حارس عضوية** | LT-1، LT-2، Case A، Case B | ❌ `CASE_C_FAIL: reading another organization's trial balance was permitted` |

ثم أُعيدت 182 وعادت الثمانية خضراء.

### 5.5 بوابات المستودع

| البوابة | النتيجة |
|---|---|
| `check_migration_syntax.py` (pglast) | ✅ 210 ملفًا صالحة |
| `check_definer_guards.py` | ✅ 52 migration بلا دالة DEFINER بلا حارس |
| `validate_migration_ledger.py` | ✅ `status: ok`، `repo_max: 182` |
| اختبارات سجل الترحيل + محلّل زوج الـBaseline | ✅ 5 + 10 ناجحة |
| `tsc --noEmit` | ✅ نظيف |
| مجموعة الاختبارات كاملة | ✅ **301 ملفًا · 4564 اختبارًا · صفر فشل** |
| صحة YAML للـworkflow | ✅ |

---

## 6. ترتيب التطبيق على Production (إلزامي)

هذه migration **بلا واجهة تابعة**: الواجهة لا تستدعي هذه الـRPC كمسار أساسي
(مسارها الأول عرض `v_trial_balance`)، ولا يتغير التوقيع. فالحالة هي «Migration بلا
واجهة تابعة» في جدول `CLAUDE.md`: **دمج DB PR → تطبيق → تحقق**.

دُمج PR #194 قبل `SEC-172` باستثناء تسلسلي صريح. سبب الاستثناء أن 182 تملك تعريف
`rpc_get_trial_balance` الصحيح؛ أما `SEC-172` فيجب أن يأتي بعدها كتغيير مستقل
(Migration 183) يضيف صلاحية القراءة الدقيقة فوق تعريف الدفتر القانوني، حتى لا
تُعيد 182 لاحقًا تعريفًا أقدم قائمًا على العضوية فقط. هذا الاستثناء **لا يجيز**
تطبيق Production؛ التطبيق أدناه يحتاج تفويضًا منفصلًا.

### 6.1 قبل التطبيق

```sql
-- لقطة مرجعية للمقارنة بعد التطبيق (قراءة فقط)
SELECT COALESCE(SUM(l.debit),0) AS legal_ledger_debit
FROM public.gl_entry_lines l
JOIN public.gl_entries e ON e.id = l.entry_id
WHERE e.org_id = :org AND e.status = 'posted';
-- المتوقع وقت كتابة هذا: 30,805.00

SELECT COALESCE(SUM(jl.debit),0) AS legacy_source_debit
FROM public.journal_lines jl
JOIN public.journal_entries je ON je.id = jl.entry_id AND je.status='posted'
WHERE je.org_id = :org;
-- المتوقع وقت كتابة هذا: 500.00
```

### 6.2 التطبيق

```
apply_migration('182_trial_balance_ledger_truth')
```

الاسم المرسل = stem الملف كاملًا، بلا لاحقة.

### 6.3 التحقق بعد التطبيق

```sql
-- 1) الدالة تقرأ الدفتر القانوني
SELECT (pg_get_functiondef(p.oid) ILIKE '%gl_entry_lines%') AS reads_legal,
       (pg_get_functiondef(p.oid) ILIKE '%journal_lines%')  AS reads_legacy
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='rpc_get_trial_balance';
-- المتوقع: reads_legal = true, reads_legacy = false

-- 2) المنح لم تنفرط
SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_must_be_false
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='rpc_get_trial_balance';
-- المتوقع: true, false

-- 3) السجل يحمل الاسم القانوني مرة واحدة
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '182_trial_balance_ledger_truth';
-- المتوقع: صف واحد بالضبط
```

**4) تحقق وظيفي بهوية مستخدم مصادق حقيقي** (لا `service_role`): استدعِ
`rpc_get_trial_balance(<org>, CURRENT_DATE)` وقارن مجموع `closing_debit` بمجموع
`closing_credit` — يجب أن يتساويا، وأن يتسق المجموع مع لقطة §6.1 (30,805.00 وقت
كتابة هذا، لا 500.00). وبالنسبة إلى الرموز السبعة في §3.1، أكِّد أن المبالغ لم
تُسقَط وأن شكل metadata يطابق الجدول هناك: الاسم = الرمز، الاسم العربي `NULL`،
والنوع سلسلة فارغة. النتيجة المالية المتوقعة وقت اللقطة:

`SUM(closing_debit) = SUM(closing_credit) = 30,805.00`

### 6.4 التراجع

لا حاجة لـmigration تراجع: الدالة تُستبدل بـ`CREATE OR REPLACE` ولا تمس بيانات ولا
بنية. التراجع الطارئ = إعادة تعريف الدالة السابقة من الـBaseline. **لكن ذلك يُفشل
بوابة Ledger Truth عمدًا** — وهو المقصود: لا عودة صامتة إلى الدفتر المهجور.

---

## 7. قائمة التحقق

### ✅ ما تم

- [x] جرد مستهلكي `rpc_get_trial_balance` وتحليل أثر الإصلاح (ست نسخ مكتشَفة)
- [x] إزالة معرّف المؤسسة المثبَّت من `useTrialBalance` + فشل مغلق بلا هوية
- [x] اختبار حراسة الهوية (4 اختبارات) + إثبات احمرار منفَّذ
- [x] عقد Ledger Truth على قاعدة حقيقية: LT-1، LT-2، LT-3
- [x] **Migration 182**: الـRPC على `gl_entries`/`gl_entry_lines`
- [x] أرصدة افتتاحية حقيقية (سنة مالية حتى التاريخ)
- [x] إصلاح `account_name_ar` (كان يُغذَّى من `name_en`)
- [x] الحفاظ على التوقيع وشكل الإرجاع والحارس والمنح
- [x] Case A — ميزان متوازن
- [x] Case B — أرصدة افتتاحية تظهر، وفترة غير ميلادية من `accounting_periods`،
      وfallback يحترم `organizations.fiscal_year_start`، + إثبات احمرار منفَّذ
- [x] Case C — عزل المستأجرين (إخفاء + رفض `NOT_ORG_MEMBER`)، + إثبات احمرار منفَّذ
- [x] Case D — صفوف `journal_lines` بلا أثر على النتيجة
- [x] Case E — الحساب المعطَّل لا يفقد رصيده، و`account_id = NULL` يُطابَق
      بالكود، و`account_name_ar` يعيد الاسم العربي
- [x] تحويل البوابة إلى `RPC_CONTRACT=enforced`
- [x] خطوة CI ترفض تشغيلًا تُتخطّى فيه الحالات A–E
- [x] السقّاطة مُختبَرة في الحالات الأربع
- [x] بوابات المستودع كلها خضراء (§5.5)
- [x] دمج PR #194 في `main` كـ`cdbe648c...` باستثناء تسلسلي موثَّق قبل `SEC-172`
- [x] لقطة Production القرائية قبل التطبيق (§3.1 و§6.1)
- [x] تسجيل الرموز التاريخية غير المرتبطة في Issue #195

### ⏳ ما تبقّى — خارج نطاق هذا الـPR

- [ ] **تطبيق 182 على Production** والتحقق وفق §6.3 — بعد الدمج
- [ ] **SEC-172** — إضافة صلاحيات القراءة المالية الدقيقة في Migration 183 فوق
      تعريف 182؛ لا يجوز أن تعيد الدالة إلى مصدر أو حارس أقدم
- [ ] تحديث Baseline بعد ظهور 182 في سجل Production (workflow مستقل، PR مستقل)
- [ ] **حسم مصدر الحقيقة الواحد** — 182 تجعل أربع نسخ صحيحة بدل ثلاث، ولا تلغي
      التعدّد. القرار المقترح: الـRPC مصدرًا وحيدًا، و`v_trial_balance` تحسين أداء
      يقرأه الـRPC لا العميل، وحذف السلسلة الاحتياطية من الواجهة
- [ ] **النسختان المعطَّلتان** `SupabaseAccountingRepository.getTrialBalance` و
      `accounting-service.getTrialBalance` (تستعلمان أعمدة غير موجودة) — قرار ADR:
      إصلاح كـadapter أم حذف
- [ ] **الاختبار الوهمي** `integration-accounting.test.ts:505` الذي يمر بينما الكود
      لا يعمل — إصلاح أو إزالة
- [ ] `keep-supabase-alive.yml` يحمل المعرّف المثبَّت نفسه (صيانة CI، مؤجَّل باتفاق)
- [ ] **دين أمني:** `GRANT ALL ON TABLE v_trial_balance TO anon` — تضييق المنح
      (مؤجَّل باتفاق؛ غير قابل للاستغلال حاليًا)
- [ ] معالجة بيانات Production التاريخية: 3 قيود مرحَّلة بلا أسطر، و`ADJ-000001`
      المزدوج — بعكس قانوني موثق لا حذف
- [ ] **Issue #195:** ربط الرموز التاريخية السبعة بحسابات `gl_accounts` القانونية
      بدليل مصدر موثوق، دون تخمين أو تغيير للمبالغ
- [ ] **Round 2** سلامة الترحيل: توسيع `check_balance_before_post` إلى
      `BEFORE INSERT OR UPDATE`، وقيد يربط مجموع الأسطر برأس القيد

---

## 8. حدود هذا العمل

1. لم تُطبَّق الـmigration على Production ولا على Staging — التحقق كله على قاعدة
   محلية مبنية من الـBaseline.
2. التحقق جرى على **PostgreSQL 16**؛ CI و Production على **17**. لم يظهر فارق
   يمس منطق الدالة، لكن التشغيل على 17 يحدث عند فتح الـPR.
3. لم تُقس كلفة أداء الدالة الجديدة على حجم بيانات حقيقي. الاستعلام يمسح
   `gl_entry_lines` للمؤسسة حتى التاريخ؛ عند نمو الدفتر قد يحتاج فهرسًا على
   `(org_id, status, entry_date)`. **لم يُضَف فهرس في هذه الـmigration** — قرار
   مؤجَّل حتى وجود قياس.
4. فُحص أثر التغييرين السلوكيين على Production قراءةً فقط (§3.1): لا توجد حركة
   على حسابات معطَّلة، لكن 16 من 22 سطرًا مرحَّلًا بلا `account_id` وتحمل 64.6%
   من المدين. 182 تستعيد مبالغها ولا تصلح روابط الدليل؛ معالجة الروابط في #195.
