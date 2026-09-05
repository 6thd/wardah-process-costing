# متابعة مراجعة توثيق AI Simulation Lab — cutoff 188 — 2026-09-05

**الغرض:** تثبيت أثر Migration 188 على أساس المختبر بعد دمجها وتطبيقها، ومراجعة
زوج Baseline cutoff 188 المولّد، دون خلط إصلاح RLS متعدد المؤسسات بجولة سلامة
المخزون أو بإعادة تصميم RBAC.

**نقطة المراجعة:** `main@2074695465080da81a2099973eb17d66c7b6ff86`
بعد نشر زوج baseline ذي الرأس
`26366ab877fca49f89d227c03575a7ade391b83d` عبر PR #224.

**حد السلطة:** قراءة Production التعريفية وتوثيق فقط. لا يفوض هذا الملف بذاته
أي دمج، أو تغيير بيانات HR، أو تطبيق migration إضافية، أو إخراج PR #221 من Draft.

## 1. مصادر الحقيقة

- سجل Production: `20260905070642 / 188_hr_multi_org_rls`.
- PR #223: merge `1fae01255617ca1e1ed32d99f1c421615221f1ae`.
- Generate Schema Baseline run `33952026388`, attempt 1.
- `sql/baseline/000_schema_baseline_20260905_071549.sql`, cutoff 188.
- `sql/baseline/001_system_reference_data_20260905_071549.sql`.
- PR #224: الرأس `26366ab877fca49f89d227c03575a7ade391b83d`، منشور على
  `main` عند merge commit `2074695465080da81a2099973eb17d66c7b6ff86`.

## 2. الحكم التنفيذي

Migration 188 تعالج defect حقيقيًا سابقًا: 75 سياسة على 19 جدول HR كانت تختار
عضوية واحدة بثلاثة أنماط غير صالحة لمستخدم متعدد المؤسسات. الحالة الحية الآن
تربط كل صف بمؤسسته عبر حارس membership/admin correlated، مع صفر scalar selector
أو `LIMIT 1` غير مرتب أو fallback `wardah_org_id(NULL)` ضمن تلك المجموعة.

هذا لا يحسم سؤالين آخرين:

1. **FU-6:** اختيار المؤسسة في الواجهة لا يزال لا ينتقل إلى الخادم للـRPCs
   والجداول التي تعتمد effective-org resolver.
2. **OQ-10 / #156:** بعض جداول HR الحساسة admin-only في RLS، بينما الواجهة تملك
   مفاتيح قراءة أدق قد تُمنح لغير المسؤول. الحفاظ على السرية في 188 صحيح، لكنه
   لا يقرر العقد المنتج المطلوب لتقارير #221.

Round 3 تبقى قيد التنفيذ كما كانت؛ Migration 188 إصلاح منصة HR مستقل ولا تغلق
`INV-01` أو `INV-03` أو `INV-04` أو `INV-06`.

## 3. Production evidence

| الفحص | النتيجة المتحققة |
|---|---:|
| جداول HR في النطاق | 19 / 19 |
| سياسات ما قبل 188 | 75 |
| scalar / `LIMIT 1` / fallback قبل 188 | 11 / 32 / 32 |
| سياسات ما بعد 188 | 75 |
| غير `authenticated` / legacy / بلا حارس بعد 188 | 0 / 0 / 0 |
| Green rollback acceptance | `HR_188_GREEN_ACCEPTANCE_PASS` |
| بقايا fixtures الاصطناعية | 0 |
| Advisor findings الموجهة لسياسات 188 | 0 |

التحقق قرأ metadata ولم يقرأ payload لصفوف موظفين حقيقية. اختبار Green استخدم
fixtures اصطناعية داخل معاملة انتهت بـ`ROLLBACK`، ثم أثبت فحص مستقل أن جميع صفوف
الـfixture صفر.

## 4. Baseline cutoff 188

| الحقيقة | القيمة |
|---|---:|
| ledger entries | 81 |
| repository migrations checked | 79 |
| repository/live cutoff | 188 / 188 |
| pending repository migrations | 0 |
| schema lines | 36,339 |
| rebuilt tables / functions / policies | 133 / 262 / 318 |
| reference tables / rows | 5 / 263 |

البيانات المرجعية تطابقت hash-by-hash بين Production واللقطة وإعادة البناء:
`modules` 10، `permissions` 171، `uom_categories` 6، وحدات النظام 17، والمرادفات
59؛ وصفر org-scoped rows متسربة.

ملف schema التشخيصي الخام يحتفظ بنهايات CRLF داخل أجسام بعض الدوال التاريخية،
بينما Git يطبّعها إلى LF عند الالتزام؛ لذلك يختلف hash البايتات وحده. عدد الأسطر
والـSQL الدلالي ثابتان، وإعادة البناء الرسمية نجحت. ملف reference data مطابق
byte-for-byte بين artifact والـcommit.

## 5. أثر المراجعة على وثائق المختبر

- تحديث `CLAUDE.md` وManifest وRunbook 188 من proposal إلى merged/applied.
- تثبيت أن PR #224 نشر زوج cutoff 188 بعد اكتمال مراجعته وقرار دمجه المستقل.
- تحديث FU-6 ليعكس أن 188 أغلقت الأنماط الثلاثة في HR فقط ولم تنشئ قناة اختيار.
- إضافة `OQ-10` لفجوة مفاتيح قراءة HR مقابل RLS admin-only وربطها بـ#156 و#221.
- إبقاء D-1/D-4 مفتوحين: أعداد سطح الدوال بقيت `70 / 64 / 181 / 117`، لكن
  كتالوجي RPC/invariants لم يُعاد اشتقاقهما بعد من cutoff 188.

## 6. الترتيب التالي

1. يصل تحديث التوثيق هذا بعد #224 في PR #225، مع إعادة استهداف إلى `main` وفحص drift.
2. حسم OQ-10 تحت #156 باختبار non-admin حقيقي قبل قرار دمج #221.
3. متابعة Round 3 حسب سجل المخزون؛ لا يبدأ Phase 0 بسبب نجاح 188 وحدها.
