# Manifest Addendum — Migrations 128–135

> هذا الملحق قانوني للفرع إلى حين دمجه في `MANIFEST.md` بعد اجتياز فحوص PR. لا تُطبّق الملفات خارج الترتيب.

| Migration | الغرض | نوع التغيير | شرط النشر |
|---|---|---|---|
| 128 | تصحيح Weighted-Average EUP وفصل مواد/تحويل/Transferred-In | additive + replace trigger | اختبار WIP وعدم إعادة احتساب المقفل |
| 129 | تأسيس كتالوج UoM والتحويلات الخاصة بالصنف ولقطات المستند | additive | RLS وفحص المخطط |
| 130 | Seed/Backfill غير تخميني + `numeric(18,6)` + فهارس FK الحية | widening + guarded backfill | معالجة الوحدات الغامضة قبل الحركات الجديدة |
| 131 | محرك تحويل fail-closed وRPC محروس | functions | اختبارات الفئة/العامل/الصلاحية |
| 132 | جسر `items`/`products` واستهلاك مواد ذري | additive + replace RPC | لا خرائط مفقودة للأصناف التشغيلية |
| 133 | استلام وتسليم UoM-aware عبر SLE، وCOGS من التقييم الفعلي | replace RPC | نشر العميل الصارم في الإصدار نفسه |
| 134 | حركة يدوية وتسوية جرد بالوحدة الأساسية | additive v2 + trigger | اختبار المخزن والتقييم |
| 135 | معالجة Advisors الآمنة وأرشفة اللقطات الفارغة | guarded governance | Snapshot + نافذة صيانة + acceptance suite |

## الترتيب الإلزامي

`128 → 129 → 130 → 131 → 132 → 133 → 134 → 135`

## حالة الإنتاج

هذه migrations **غير مطبقة على القاعدة الحية** وقت إنشاء الفرع. نشرها يحتاج مراجعة PR، اختبار fresh-chain/staging، لقطة قاعدة، وخطة rollback تشغيلية.
