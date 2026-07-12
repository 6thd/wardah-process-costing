# سجل أمان الرواتب — إغلاق مراجعة كودكس (P13)

سجل تدقيقي دائم لبنود أمان الرواتب/التسويات، منفصل عن CHANGELOG: كل بند يُغلق
هنا فقط بعد تسجيل **البيئة، التاريخ، نتيجة الاختبار الحي، وحالة FK**.
مرجع الاختبار الآلي: `scripts/security/test_payroll_rbac.sql`
(`psql -v ON_ERROR_STOP=1` — يفشل بـexit code عند أي نتيجة غير متوقعة).

## جدول البنود

| بند | الوصف | الإصلاح | Commit | حالة الكود | تحقق حي (بيئة/تاريخ/نتيجة) |
|---|---|---|---|---|---|
| P0-1 | Migration 97 أعادت فتح `wardah_apply_stock_incoming` | REVOKE في 101 §2 + فحص ختامي يفشل الـmigration إن بقيت مفتوحة | (دفعة 1) | ✅ مطبق بالكود | ⬜ يتطلب تشغيل 101 + سكربت الاختبار على staging |
| P0-2 | اعتماد المسير/التسوية بعضوية فقط | `wardah_is_org_admin` (نمط 96) **قبل** مسار replay في الدالتين | (دفعة 1) | ✅ | ⬜ member ⇒ NOT_AUTHORIZED_*، admin ⇒ يمر |
| P0-3 | الثقة بأرقام العميل | عقد payload_version=2: totals=Σسطور، buckets تُشتق من سطور بbucket من قائمة مغلقة، مبالغ >0، is_deduction صريح | (دفعة 1) | ✅ | ⬜ حمولة عبث ⇒ TOTALS_MISMATCH/BUCKETS_MISMATCH |
| P0-سرية | أي عضو يقرأ رواتب الجميع (سياسات 99) | SELECT admin-only على employee_salary_structures/payroll_runs/payroll_details/attendance_records/employee_leaves؛ إسقاط ديناميكي لكل السياسات القديمة | (دفعة 1) | ✅ | ⬜ member: SELECT payroll_details ⇒ 0 صف |
| P1-4 | لا تحقق موظف↔مؤسسة | EMPLOYEE_ORG_MISMATCH في الـRPC + `UNIQUE employees(id,org_id)` + FK مركب NOT VALID | (دفعة 1) | ✅ | ⬜ **FK convalidated؟** أبلغ الـmigration عن الصفوف المخالفة — البند لا يُغلق حتى convalidated=true |
| P1-6 | org_settings كتابة لكل عضو | كتابة خلف البوابة الإدارية (101 §7) | (دفعة 1) | ✅ | ⬜ |
| E1 | ازدواج تعديل الأوفرتايم في القسيمة | فصل OT (حضور) عن ADJ_OVERTIME (تعديل) + اختبار عقد | (دفعة 1) | ✅ اختبار vitest يمر | مغطى باختبار آلي دائم |
| P1-11 | تسوية بلا hash + إنهاء فوري | Migration 102: دورة draft→review→approved بـsnapshot/hash خادمي + request_hash + حراس إنهاء أربعة | (دفعة 3) | ✅ 10 اختبارات سلوكية محلية تمر | ⬜ يتطلب تطبيق 102 على staging |
| E7 | الإنهاء لا يحدث أصلاً من الواجهة (settlement_type كان يحمل نوع الإنهاء فلا يطابق شرط terminated) | فصل termination_type + ترحيل بيانات + شرط الإنهاء يعمل الآن | (دفعة 3) | ✅ اختبار C4 يثبت terminated | ⬜ |
| E8 | مصنّف البدلات لا يلتقط كود HOUSING (HOUSI≠HOUSE) ⇒ السكن يقع في «أخرى» ويخرج من وعاء GOSI | المطابقة على HOUS | (دفعة 3) | ✅ اختبار تكاملي | مغطى باختبار آلي |
| P2-13 | percentage_base مُهمل في المحرك وبلا واجهة | تفعيل basic/basic_housing بمرورين + منع الدائرية + CHECK في 102 + حقل اختيار الأساس في الواجهة + إصلاح إهمال calculation_type الصامت في الإسناد | (دفعة 3) | ✅ اختبارات وحدة وتكامل | مغطى باختبار آلي |

## قرارات موثقة

- **بوابة admin/owner مؤقتة**: نظام أدوار HR التفصيلي (hr_manager/payroll_officer/
  self-service للموظف) مرحلة لاحقة — يتطلب ربط `employees ↔ auth.uid` غير الموجود.
- **إعادة الحساب الخادمي الكامل للرواتب**: مؤجل موثق؛ العقد v2 يربط القيد
  بالتفاصيل لكنه لا يعيد حساب GOSI/الحضور خادمياً.
- **تكرار البند لنفس الموظف مسموح** في سطور المسير (تعديلات ADJ_* المتعددة مشروعة).
- **التعديلات السالبة مرفوضة** client-side برسالة إرشادية (سجّلها بالنوع المعاكس).
- **لا FORCE ROW LEVEL SECURITY**: دوال SECURITY DEFINER تكتب بصلاحية المالك — FORCE يكسرها.
- **جداول خارج نطاق 101**: `employees/departments/positions` (سياسات 15 القديمة)
  و`hr_*` (سياسات sql/hr/16-17 المقيدة بالأدوار بنمط LIMIT 1 الهش) — تُعاد صياغتها
  في مرحلة نظام الأدوار. `employees.salary` مكشوف لسياسات 15 القديمة — بند مرحلة الأدوار.

## نموذج تسجيل تحقق حي

```
بيئة: <staging/production project ref>
تاريخ: YYYY-MM-DD
منفّذ: <email>
Migration مطبقة: 101 (متبوعة بـ scripts/security/test_payroll_rbac.sql — PASS[1..7])
member: rpc_post_payroll_run ⇒ NOT_AUTHORIZED_PAYROLL_POST ✓ | SELECT payroll_details ⇒ 0 rows ✓
admin: مسير كامل ⇒ approved + قيد متزن ✓ | replay ⇒ replayed=true ✓ | عبث totals ⇒ TOTALS_MISMATCH ✓
rpc_post_goods_receipt (member): يعمل ✓
FK: convalidated=<true/false> (إن false: عدد الصفوف المخالفة=<n>، مهمة تنظيف=<رابط>)
حسابات فعلية: payroll buckets ⇒ <أكواد الحسابات من hr_payroll_account_mappings>
```
