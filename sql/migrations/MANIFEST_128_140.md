# Manifest Addendum — Migrations 128–140

> ملحق حوكمة للفرع إلى حين دمجه في `MANIFEST.md`. لا تُطبق الملفات خارج الترتيب، ولا على الإنتاج قبل preflight وstaging evidence.

| Migration | الغرض | نوع التغيير | شرط النشر |
|---|---|---|---|
| 128 | تصحيح Weighted-Average EUP وفصل مواد/تحويل/Transferred-In مع توافق WIP القديم | additive + replace trigger | اختبار WIP وعدم إعادة احتساب المقفل |
| 129 | تأسيس كتالوج UoM والتحويلات الخاصة بالصنف ولقطات المستند | additive | RLS وفحص المخطط |
| 130 | Seed/Backfill غير تخميني + `numeric(18,6)` مع حفظ views/generated expressions | widening + guarded reconstruction | Fresh DB + preflight NULLs |
| 131 | محرك تحويل fail-closed وRPC محروس | functions | اختبارات الفئة/العامل/الصلاحية |
| 132 | جسر `items`/`products` واستهلاك مواد ذري أساسي | additive + replace RPC | لا خرائط مفقودة للأصناف التشغيلية |
| 133 | استلام وتسليم UoM-aware عبر SLE، وCOGS من التقييم الفعلي | replace RPC | نشر العميل الصارم في الإصدار نفسه |
| 134 | حركة يدوية وتسوية جرد بالوحدة الأساسية | additive v2 + trigger | اختبار المخزن والتقييم |
| 135 | معالجة Advisors الآمنة، RLS initplan، timestamps قابلة للتعديل وأرشفة اللقطات | guarded governance | Snapshot + preflight + نافذة صيانة |
| 136 | RPC إداري ذري لتخليف عوامل التحويل زمنيًا | function | منع الكتابة المباشرة من العميل |
| 137 | أوزان المنتج والتحويل الصنفي العابر للفئات بعلم صريح | additive + replace functions | اختبار C1 = 5.4 KG |
| 138 | تطبيع BOM وربط الخصم الجزئي وCOGS الفعلي بـWIP | additive + replace functions/triggers | اختبار BOM/حجز/استهلاك/WIP ذري |
| 139 | تطبيع PO وSales Invoice عند إدخال السطر | triggers + backfill snapshots | اختبار over-receipt/over-delivery |
| 140 | وحدات مخصصة للمستأجر مع RLS وRPC إداري | additive + policies/functions | اختبار عزل المؤسسات |

## الترتيب الإلزامي

`128 → 129 → 130 → 131 → 132 → 133 → 134 → 135 → 136 → 137 → 138 → 139 → 140`

## بوابات النشر

1. لقطة قاعدة البيانات وخطة rollback.
2. `scripts/verify/warehouse_assessment_preflight.sql` على نسخة مماثلة للإنتاج.
3. Fresh DB chain وCI وSonarQube أخضر.
4. تطبيق كامل على staging ثم `scripts/verify/warehouse_assessment_acceptance.sql`.
5. سيناريو C1: كرتون واحد = 5.4 كجم، BOM متعدد الوحدات، خصم جزئي، وتدفق القيمة إلى WIP.
6. إعادة فحص Supabase Advisors والاحتفاظ بأدلة قبل/بعد.

## حالة الإنتاج

هذه migrations **غير مطبقة على القاعدة الحية**. الدمج لا يعني النشر؛ التطبيق الحي يحتاج نافذة صيانة وموافقة تشغيلية مستقلة.
