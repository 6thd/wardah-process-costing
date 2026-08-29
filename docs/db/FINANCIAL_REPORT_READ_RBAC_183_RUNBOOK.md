# Financial Report Read RBAC — Migration 183 Runbook

**Issue:** SEC-172 / #172  
**Migration:** `183_financial_report_read_rbac.sql`  
**حالة المستودع:** تُثبت بعد دمج PR المخصص  
**حالة Production:** لا تُعد مطبقة إلا بعد ظهورها مرة واحدة في سجل migrations

## النطاق

Migration 183 تشدد أربعة حدود قراءة مالية بمفاتيح موجودة في كتالوج RBAC،
وتغلق مسار `v_trial_balance` المباشر بسحب القراءة من `authenticated/anon`؛
يبقى العرض متاحًا لـ`service_role` فقط.
لا تضيف جداول أو أعمدة أو فهارس، ولا تغير أرقامًا محاسبية، ولا تزرع منحًا
لمستخدمين أو أدوار.

تستبدل `rpc_get_trial_balance` مع إعادة إنتاج طبقة 182 كاملة؛ المرجع المركب:
[`TRIAL_BALANCE_CONTRACT_182_183_CHAIN.md`](./TRIAL_BALANCE_CONTRACT_182_183_CHAIN.md).

## فحوص ما قبل التطبيق

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 3;

SELECT permission_key
FROM public.permissions
WHERE permission_key IN (
  'accounting.accounts.read',
  'general_ledger.account_statement.view',
  'reports.financial.read'
)
ORDER BY permission_key;

SELECT to_regprocedure('public.wardah_178_assert_permission(uuid,text)'),
       to_regprocedure('public.wardah_has_exact_permission(uuid,uuid,text)'),
       to_regprocedure('public.wardah_assert_org_member(uuid)');
```

المتوقع: رأس السجل 182، المفاتيح الثلاثة موجودة، والمساعدات الثلاثة موجودة.

قبل التطبيق أيضًا يُقاس المستخدمون الفعليون بواسطة
`wardah_has_exact_permission` لا بعدّ `role_permissions` فقط، لأن Org Admin
وSuper Admin جزء من العقد. لقطة 2026-08-29 أثبتت أن مستخدم Production النشط
الوحيد Org Admin ويحمل كذلك المفاتيح الثلاثة عبر دور فعلي؛ فلا توجد حالة lockout
معروفة، لكن اللقطة تعاد وقت التطبيق.

## التطبيق

يُطبّق نص الملف المدموج على `main` فقط، عبر migration API، بالاسم:

```text
183_financial_report_read_rbac
```

لا SQL Editor، ولا تعديل يدوي للتعريف، ولا نسخ من فرع غير مدموج.

**شرط ترتيب:** لا تُطبق 183 على Production قبل نشر تحويل شاشة ميزان المراجعة
إلى `rpc_get_trial_balance` وحدها؛ سحب صلاحية العرض مقصود، وتطبيقها قبل نشر
المستهلك الجديد يكسر المسار الأول للواجهة.

## فحوص ما بعد التطبيق

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE name = '183_financial_report_read_rbac';

SELECT p.proname, pg_get_function_identity_arguments(p.oid),
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'get_account_statement',
    'rpc_get_trial_balance',
    'rpc_subledger_gl_reconciliation',
    'get_gl_accounts_by_category'
  )
ORDER BY p.proname;
```

ثم تُقرأ التعريفات ويُثبت لكل دالة وجود
`wardah_178_assert_permission` والمفتاح المخصص. ولـ`rpc_get_trial_balance`
يُثبت أيضًا:

- `gl_entries/gl_entry_lines` موجودان في الجسم.
- لا `FROM journal_entries/journal_lines`.
- `fiscal_year_start` و`account_id IS NULL` والاسم العربي موجودة.
- overload واحد فقط.
- `authenticated/anon` لا يملكان `SELECT` على `v_trial_balance`، و
  `service_role` يملكه.

## التحقق السلوكي الحي

بهوية `authenticated` حقيقية:

1. عضو نشط بلا المفتاح المطلوب يُرفض بـ`PERMISSION_DENIED: <key>`.
2. نفس العضو بعد منح المفتاح التام عبر دور نشط ينجح.
3. مفتاح شقيق في الوحدة نفسها لا يكفي.
4. طلب مؤسسة أخرى يُرفض بـ`NOT_ORG_MEMBER`.
5. بعد سحب المنحة يُرفض الاستدعاء التالي.
6. ميزان المراجعة للمستخدم المصرح يبقى مطابقًا للمقارنة الحسابية اليدوية ولنتيجة
   182 الموثقة؛ التغير أمني فقط.
7. القراءة المباشرة من `v_trial_balance` تفشل للمستخدم المصادق؛ والواجهة تعمل
   من الـRPC بلا أي fallback إلى العرض أو الجداول.

أي بيانات اختبار تشغيلية تُنشأ داخل معاملة تُلغى، ولا تُترك عضويات/أدوار مؤقتة
على Production.

## Advisor

بعد DDL تُشغل Security وPerformance advisors. تحذير
`authenticated_security_definer_function_executable` قد يبقى لأن الدوال
ممنوحة عمدًا لـ`authenticated`، لكن قبوله بعد 183 يعتمد على وجود حارسي
العضوية والصلاحية التامة معًا، لا على العضوية وحدها.
