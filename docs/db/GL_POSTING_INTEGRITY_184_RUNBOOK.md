# GL Posting Integrity — Migration 184 Runbook

**Migration:** `184_gl_posting_integrity.sql`
**Round:** AI Simulation Lab / Round 2 — سلامة الترحيل
**الحالة:** لا تُعد مطبقة إلا بعد ظهورها مرة واحدة في سجل Production

## العقد

عند نهاية المعاملة، كل قيد لمسته المعاملة وحالته `posted` يجب أن يحقق معًا:

1. سطران قانونيان على الأقل.
2. مجموع `gl_entry_lines.debit` يساوي مجموع `credit` ضمن سماحية أقل من 0.01.
3. مجموع المدين القانوني يساوي `gl_entries.total_debit`، ومجموع الدائن يساوي
   `total_credit` ضمن السماحية نفسها.
4. إدخال رأس مرحّل مباشرة يمر من `check_balance_before_post`؛ الحارس يعمل
   `BEFORE INSERT OR UPDATE` لا UPDATE فقط.

الفحص مؤجل `DEFERRABLE INITIALLY DEFERRED` حتى يسمح للمسار الذري بإدخال الرأس
أولًا ثم السطور داخل المعاملة نفسها. المسودات قد تبقى ناقصة أثناء التحرير؛ العقد
يبدأ عند `posted`.

دالة الحارس المؤجل `wardah_184_assert_posted_entry_integrity()` تعمل
`SECURITY DEFINER` مع `search_path` مثبت. هذا مقصود ومحدود بحماية سلامة البيانات:
في PostgreSQL 17 قد يُقيّم الحدث المؤجل بعد عودة RPC ذات `SECURITY DEFINER` إلى
`authenticated`، وعندها يمكن لـRLS أن تخفي قيد مؤسسة أخرى عن دالة `SECURITY
INVOKER`. الحارس يجب أن يرى الحقيقة الفيزيائية للرأس والسطور حتى لا يتحول
`NOT FOUND` إلى تجاوز صامت للعقد. لا يملك `PUBLIC/anon/authenticated/service_role`
تنفيذ دالتي trigger مباشرة.

## ما لا تفعله 184

- لا تمسح الصفوف التاريخية عند الإنشاء، ولا تعيد كتابة بيانات Production.
- لا تختلق سطورًا للقيد ولا تغيّر أرقامه.
- لا تعالج القيود التاريخية الثلاثة المرحّلة بلا سطور؛ تبقى مسألة بيانات مستقلة
  تحتاج مصدرًا موثوقًا، لا تخمينًا.

لقطة ما قبل التنفيذ في 2026-08-29: 19 رأسًا، 12 مرحّلًا، 3 مرحّلة بلا سطور،
وصفر اختلافات بين الرأس والسطور في القيود المرحّلة التي لها سطور. رؤوس الحالات
الثلاث: `JE-2025-11-0001` و`JE-2025-11-0002` و`JE-2025-11-0003` بإجمالي
9,955.00 لكل جانب.

## شبكة القبول

`gl-posting-integrity-184-acceptance.yml` تبني PostgreSQL 17 مرتين:

- **قبل 184:** تثبت فعليًا أن `posted INSERT` بلا سطور، ورأس 100/100 مع سطور
  80/80، كانا يُقبلان.
- **بعد 184:** تثبت أن مسودة ناقصة مسموحة، وأن الرأس-أولًا مع سطور صحيحة في
  المعاملة نفسها مسموح، بينما غياب السطور واختلاف الرأس وعدم توازن السطور
  مرفوضة. كما تفحص أحداث trigger والمنح.
- **RLS/deferred regression:** مستخدم `authenticated` عضو في مؤسستين وبدون
  `org_id/tenant_id` claim يسقط إلى أقدم عضوية. fixture test-only ذات
  `SECURITY DEFINER` تنشئ رأسًا مرحّلًا معيبًا في المؤسسة الثانية ثم تعود إلى
  `authenticated` قبل forcing القيود. يثبت الاختبار أولًا أن RLS تخفي الرأس،
  ثم يطلب `SET CONSTRAINTS ALL IMMEDIATE` ويشترط ظهور
  `POSTED_ENTRY_LINES_MISSING`. بذلك لا يكفي اللون الأخضر إذا عاد الحارس إلى
  `SECURITY INVOKER` أو صار fail-open عبر RLS.

## التطبيق والتحقق

يُطبّق نص الملف المدموج على `main` فقط عبر migration API باسم:

```text
184_gl_posting_integrity
```

بعد التطبيق:

- يظهر الاسم مرة واحدة ورأسًا في `supabase_migrations.schema_migrations`.
- `check_balance_before_post_trigger` يحمل INSERT وUPDATE وBEFORE.
- constraint trigger على الرأس وآخر على السطور، وكلاهما deferred/initially
  deferred.
- `wardah_184_assert_posted_entry_integrity()` يظهر `prosecdef = true`.
- لا يملك `PUBLIC/anon/authenticated/service_role` تنفيذ دالتي trigger مباشرة.
- smoke test داخل معاملة ملغاة يثبت قبول الرأس والسطور الصحيحين ورفض الحالات
  الثلاث، إضافة إلى إثبات fail-closed تحت `authenticated` عندما تخفي RLS
  مؤسسة القيد عن المتصل.

ثم تُشغّل Security وPerformance advisors وتُوثق أي ملاحظة جديدة بدل طيها.
