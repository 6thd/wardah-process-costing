# #229 — الإصلاح المحلي وحالة بوابات التشغيل، 1 أكتوبر 2026

**القرار: NO-GO للتفعيل أو رفع M192 hold.** الواجهتان مكتملتان كمرشح محلي للقبول المعزول، ومرشح احتواء DB اجتاز الاختبارات المحلية. البدائل الوظيفية لمسارات الكتابة القديمة وقبول الهوية الحقيقية لم تُغلق.

سجل القبول أدناه أُنشئ محليًا قبل تفويض النشر، وتُنشر نسخة الواجهة الآن في Draft PR مستقل على `feat/229-material-issue-isolated-ui`. مرشح SQL وrunner موجودان في Draft منفصل على `docs/229-material-issue-db-containment-candidate`؛ لا توجد SQL مرشحة في PR الواجهة. الأدلة المشتركة محفوظة للمراجعة، ولا تعني تطبيقًا حيًا.

هذه الحزمة مبنية على رأس #279: `23ba8acdc6e29219a4d7320478d35afe7d1fd5fb`. لم يحدث push أو merge أو تعديل GitHub أثناء جولة القبول المحلي الأصلية. تفويض النشر اللاحق يرفع فرعي المراجعة فقط؛ لا يجيز دمجًا أو وصولًا إلى Production أو Staging. تغييرات الاختبارات السابقة في النسخة المحلية الأصلية تُركت كما هي.

## الحالة الحالية من GitHub

تمت إعادة القراءة من GitHub في هذه الجولة، وليس اعتمادًا على التقرير السابق:

| المرجع | الحالة المتحققة |
| --- | --- |
| main | `94400e1b78f7f5f1716568df96dba7cde2558d12` |
| [#279](https://github.com/6thd/wardah-process-costing/pull/279) | Open / Draft / Unmerged / mergeable؛ head `23ba8acd…` وbase `94400e1b…` |
| فحوص رأس #279 | Test & Build، inventory، SonarQube Scan ناجحة على SHA المذكور؛ Deploy to Production متخطى |
| [#229](https://github.com/6thd/wardah-process-costing/issues/229) | Open؛ تصحيح التتبع موجود بالفعل، لا حاجة لقضية مكررة |
| [#278](https://github.com/6thd/wardah-process-costing/issues/278)، [#170](https://github.com/6thd/wardah-process-costing/issues/170)، [#154](https://github.com/6thd/wardah-process-costing/issues/154) | Open |
| #230، #234، #259، #260، #160، #157 | Open؛ لا يثبت ذلك إعادة إنتاج أعطالها حيًا في هذه الجولة |
| #286–#290 | Open؛ ليست بديلًا لبوابات الصرف، ولا نؤخر قبول الصرف لحين إغلاق مسار التكلفة/التنظيف كله |

**policy-setter acceptance P2 = CLOSED على `23ba8acd…` وفق المراجعة المقبولة.** لم تُجرَ جولة mutations جديدة لهذا P2. الـ49 اختبارًا هنا اختبارات regression للعقد الموجود. نجاح فحوص GitHub المذكورة لا يغطي هذه التغييرات المحلية غير المدفوعة.

## ما تغيّر

- Employee Material Issue UI: اختيار صريح لـMO، stage، reservation، WO، warehouse، وbase UOM؛ لا افتراضات تلقائية. تدقيق نطاق الخيارات وكمال القراءة، وصلاحية كمية لا تتعرض لتقريب JavaScript صامت قبل تخصيص event.
- Durable recovery يستخدم عميل #279 الموجود: طلب immutable، event ثابت، إعادة محاولة بعد lost response/reload، ومنافسة التبويبات عبر IndexedDB. المحاولة غير المؤكدة لا تُحذف؛ definite rejection وحدها يمكن acknowledgment لها وفق قواعد العميل. تُستعاد المحاولة حتى إن لم تعد خيارات إنشاء حدث جديد قابلة للقراءة.
- تغيّر المؤسسة/المستخدم أو فشل/سحب الصلاحية يمنع النموذج؛ تحقق getUser قبل الفعل، إلغاء نتائج القراءات القديمة، وتحديث cache بعد receipt صحيحة فقط. فشل التخزين يمنع الإرسال.
- Org Admin Material-Issue Policy UI فوق getter/setter الموجودة: IN_PROGRESS إلزامية، READY/IN_SETUP اختياريتان، canonical statuses، latest-version reload، وسلوك last-writer-wins الموثق. فشل القراءة/الحفظ يمنع كتابة defaults. سحب Admin أثناء تحقق الهوية يمنع الحفظ.
- ترجمة عربية/إنجليزية، routes، وإدخالات catalog مخفية تحت #229. **Production build محجوب حتى مع تشغيل علم العزل.** معاينة dev فقط عند `VITE_MATERIAL_ISSUE_ISOLATED=true`؛ هذا ليس تصريحًا لربط dev ببيئة حية.
- مرشح DB مستقل: RPC قراءتين تحت active membership + exact consume permission، مع snapshot واحدة وتدقيق scope. قائمة MO تشمل terminal orders لاسترجاع receipt سابقة، لكن خيارات حدث جديد تشترط in_progress.
- مرشح DB يسحب امتيازات الكتابة الجدولية/الأعمدة وEXECUTE من الاثني عشر legacy writers الموثقة، بما فيها service_role، ويختبر الامتيازات الفعالة. **هذه quarantine تمنع إنشاء/تعديل/إطلاق MO وWO والحجز عبر المسارات القديمة حتى للـAdmin. لا توفر بدائل وظيفية، ولا تغلق #170/#154.**
- مراجعة RBAC delta مقابل النسخة الأصلية: إضافتا RPC قراءة فقط، لا كتابة جديدة ولا signature محذوفة؛ baseline 356/330، وتصنيف القراءة follow_up_required، لأن DB candidate غير مطبق.

## حدود دليل قاعدة البيانات والترتيب

الملف `195_material_issue_scope_candidate.sql` **مرشح غير مخصص الرقم وغير مطبق**، خارج `sql/migrations`. اسم الملف لا يخصص M195 ولا يغير ledger. يحتاج DB review مستقلة ورقمًا قانونيًا عند قبول نطاقه. لا توجد تغييرات في بايتات M190–M194 أو في materialIssueClient runtime.

الترتيب القانوني في القاعدة disposable نجح: baseline cutoff 189 → M190 → M191 → M192 → M193 → M194، خمس migrations ناجحة مرة واحدة. على أي بيئة أخرى يُطبق المفقود فقط، بعد ledger/postflight؛ لا يُعاد تطبيق الموجود.

[سجل M190](../M190_PRODUCTION_APPLICATION_20260927.md)، [M191](../M191_PRODUCTION_APPLICATION_20260928.md)، [M194](../M194_PRODUCTION_APPLICATION_20260930.md) على base الموثق تسجل التطبيق. **هذا دليل مستودع، وليس live readback جديدًا.** سجل M194 نفسه يستثني قبول ordinary-user/browser/live concurrency، ويسجل عدم وجود WIP تغطي الفترة الحالية آنذاك؛ يلزم التحقق من إعداد pilot قانوني قبل الصرف. مشاهدات Staging السابقة تبقى تاريخية وغير متحققة هنا.

بيئة الإثبات المحلي: PostgreSQL 17.11 من المصدر الرسمي، SHA-256 للأرشيف `dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979`، والـJWT shim الموجودة بالمستودع. لأن executor لا يملك سوى UID 0 داخل namespace بلا صلاحيات تغيير UID، عُدّلت **ثلاثة checks لبدء البرامج فقط** في initdb/main/pg_ctl لتسمح بـ`WARDAH_LOCAL_UID_NAMESPACE=1`. لم تعدل SQL roles أو RLS أو محرك التنفيذ. لهذا **إعادة الإثبات المستقلة على توزيع PostgreSQL 17 قياسي غير معدل ما زالت prerequisite**؛ لا نساوي هذا تشغيل Supabase Auth/PostgREST حقيقي.

SHA-256 لمرشح SQL المقبول محليًا: `d906c72a96468d4869d8341e1cc61c8b20383e5dd43284be0070c876c80987ca`.

## نتائج التحقق

| التحقق | النتيجة والدليل |
| --- | --- |
| UI/client/routes/catalog/sidebar | **133/133**: 32 UI، 49 client، 36 routes، 13 catalog، 3 sidebar؛ [السجل](evidence/20261001/ui-client-route-tests.log) |
| TypeScript / lint / production build | ناجحة؛ lint الإنتاج بلا errors؛ test file مستثناة افتراضيًا من lint، ولم يُدّع خلاف ذلك؛ build وDEMO_PASSWORD_BUILD_GATE_PASS ناجحان |
| RBAC / migration naming contract | ناجحان؛ [RBAC](evidence/20261001/rbac-inventory.log)، [migration contract](evidence/20261001/migration-contract.log) |
| DB containment + M192 | [PASS](evidence/20261001/db-candidate.log): valid scoped reads، foreign-org/reader denial، 36 direct INSERT/UPDATE/DELETE/TRUNCATE probes على صفوف populated لثلاث هويات وثلاث جداول مع SQLSTATE 42501، امتيازات table/column/RPC، canonical issue/replay، expiry/revoke/inactive membership؛ آثار الرفض ثابتة |
| DB reconciliation | حدث واحد: SLE واحدة −10، bin 990، consumption واحدة +10، reservation consumed 10، WIP material cost 100، receipt ثابتة؛ replay بلا أي أثر ثانٍ. هذه مصالحة DB محلية منفصلة عن متصفح المحاكاة |
| #278 regression | [PASS](evidence/20261001/m194-regressions.log): role/guard probes، M192 sequential + status matrix + two sessions، وثمانية سباقات WIP/issue/labor/close، دون تعديل M194 |
| Native browser | Chromium 154.0.8037.92، React StrictMode، IndexedDB حقيقية: lost response بعد simulated commit، reload/replay بنفس event/payload، two-tab claim + recovery بلا duplicate effect، simulated permission/org/user/admin changes، policy refresh، storage failure؛ [PASS](evidence/20261001/native-browser.log) و[RPC trace](evidence/20261001/simulated-rpc-trace.json) |
| حدود المتصفح | لا page/console errors أو Vite overlay. الحسابات وRPC **محاكاة محلية**؛ لا إثبات هويات حقيقية ولا browser→DB reconciliation. agent-browser لم يبدأ daemon بنجاح في executor؛ استُخدم Playwright مباشرة مع timeout محدود |

لقطات المعاينة: [Employee UI](evidence/20261001/employee.png)، [Policy UI](evidence/20261001/policy.png).

## المتبقي بالترتيب الدقيق

1. **مراجعة DB مستقلة على PG17 قياسي:** fresh inventory لكل caller/RPC/trigger/grant، تحديد قبول quarantine ومدى تعطل legacy clients، أو تنفيذ RPC بديلة بصلاحيات دقيقة لتصرفات reserve/update/release وWO eligibility/maintenance اللازمة للـpilot. المقترح الحالي لا ينفذها. إذا اختيرت البدائل، يلزم MO-first lock order، audit، template/Admin grant decision، وسباقات reserve/release/WO vs consume وفق [عقد #170/#154](../MANUFACTURING_WRITE_BOUNDARIES_170_154_CONTRACT.md). ثم تخصيص migration القانونية وفصل DB PR عن UI PR؛ DB أولًا.
2. **#278 application/behavior acceptance:** قبول implementation/application record الحالي بدل إعادة تنفيذ أو تطبيق M194؛ إعداد أو إثبات MO/WO/reservation وWIP للفترة الحالية عبر مسارات قانونية. لا يكفي وجود سجل تطبيق أو أصفار على بيانات بلا حركة.
3. **UI + real-browser/real-identity acceptance على بيئة معزولة مصرح بها:** موظف ممنوح وغير ممنوح، Org Admin، foreign org، inactive/expired/revoked grant، lost response/retry، reload، two tabs، org/user change، policy change، storage failure. كل حالة مرتبطة بمصالحة SLE/bins/reservations/consumption/WIP/receipt. لم يُطلب أو يُنفّذ الوصول لهذه البيئة هنا.
4. **قرار المالك بشأن cross-device:** التخزين محلي لكل browser؛ مسح البيانات/تغيير الجهاز يمكن أن يخصص event جديدًا لنفس النية. رسالة الدعم وطلب storage.persist ليستا ضمانًا أو حلًا عالميًا. يلزم قرار قبول مخاطر pilot محدد أو تصميم server recovery/idempotency عابر للأجهزة وقبوله قبل release.
5. **release gate على الرأس النهائي:** CI/Fresh DB والمراجعة المستقلة للتغييرات الجديدة، فصل DB/UI releases، خطة توافق callers والإغلاق الفعلي للمسارات القديمة، ثم قرار المالك للـpilot ورفع M192 hold. يبقى #279 Draft وغير مدموج إلى ذلك الحين.

physical counts مع #259، وباقي MES مع #154/#230، وbackflush مع #234، والتكلفة مع #260/#286–#290 تبقى مسارات مستقلة. لا ندّعي إطلاق دورة تصنيع/مخزون كاملة عند قبول pilot صرف يدوي محدود.

## إعادة التشغيل محليًا

أوامر DB أدناه تُشغّل من checkout فرع DB المنفصل أو الشجرة المجمعة محليًا؛ ملفات SQL وrunner لا توجد في PR الواجهة. أوامر المتصفح تُشغّل من فرع الواجهة.

```bash
# PostgreSQL 17 disposable فقط، بلا DATABASE_URL/PGSERVICE/SUPABASE_DB_URL
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres bash docs/db/material-issue-229/run_local.sh
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres bash docs/db/stage-wip-278/run_green.sh
# executable محلي لـChromium، fixture بلا اتصال بـSupabase
WARDAH_BROWSER_EXECUTABLE=/absolute/path/to/chromium \
WARDAH_BROWSER_OUTPUT=/tmp/wardah-issue-browser \
bash tests/fixtures/material-issue-browser/run_local.sh
```

الأصل المحلي محفوظ عند `40f0dde6` على `fix/229-material-issue-release-slices`. نُشرت منه حزمة DB وحزمة UI منفصلتان بتفويض المالك للمراجعة. لا دمج أو تطبيق أو إغلاق قضايا أو رفع M192 hold بموجب هذا النشر.
