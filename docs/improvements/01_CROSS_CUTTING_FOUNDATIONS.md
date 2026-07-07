# الأساسات المشتركة (Cross-Cutting Foundations)

هذه التحسينات تخدم قسمي التصنيع والمحاسبة معاً، وبدونها أي تحسين في القسمين سيُبنى على أرض متحركة. مرتبة بالأولوية.

---

## 1. إيقاف ابتلاع الأخطاء وإرجاع النجاح الوهمي 🔴 P0

### الوضع الحالي

النمط التالي متكرر في خدمات التكاليف:

```ts
// src/services/process-costing-service.ts:129
if (error && !error.message.includes('Could not find')) {
  throw error
}
// ...
return {
  success: true,
  data: { id: data?.id || 'temp-id', totalLaborCost, ... }  // :136
}
```

المواضع المؤكدة: `process-costing-service.ts:129` (عمالة)، `:221` (أوفرهيد)، `:350` (تكلفة مرحلة)، `:392` (قراءة). نفس الفلسفة موجودة في `src/features/manufacturing/hooks/useManufacturingOrders.ts:19-22` (جدول غير موجود ⇒ مصفوفة فارغة بصمت) وفي `src/services/manufacturing/updateStatus.ts` (سلسلة fallbacks تعيد المحاولة بدون joins عند أخطاء PGRST200).

### لماذا هذا خطير

- خطأ `PGRST204/205` (عمود أو جدول غير موجود في Schema Cache) يعني أن **البيانات لم تُحفظ**، لكن المستخدم يرى Toast نجاح، وتكلفة العمالة تظهر له محسوبة لأنها حُسبت في المتصفح (`totalLaborCost = laborHours * hourlyRate` سطر 71) لا من قاعدة البيانات.
- هذه الأنماط كُتبت أصلاً كحِيَل مؤقتة أثناء تطوير الـ Schema (تعليقات "Fixed: use tenant_id instead of org_id" تشهد بذلك)، لكنها الآن تُخفي انحراف الـ Schema بدل كشفه.

### التحسين المقترح

1. **حذف كل فحوصات `error.message.includes('Could not find')`** — إذا كان الجدول غير موجود فهذه كارثة نشر يجب أن تنفجر، لا أن تُبتلع.
2. **نوع نتيجة موحّد** على مستوى المشروع بدل خليط `{success, data}` / `throw` / `null`:

```ts
// src/lib/result.ts
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E }
```

مع دالة `unwrapOrToast(result, t)` واحدة في طبقة الواجهة تتكفل بالعرض. يوجد أصلاً `AppError` و`InsufficientInventoryError` في `src/lib/errors/` — تُعمَّم على كل الخدمات بدل استخدامها في خدمة واحدة.

3. **حذف `'temp-id'` نهائياً** — أي دالة كتابة تُرجع إما صفاً حقيقياً من DB أو خطأ.
4. **قاعدة ESLint مخصصة** (`no-restricted-syntax`) تمنع `catch` يحتوي `console.error` فقط بدون rethrow/return error، لمنع رجوع النمط.

### معيار القبول
- بحث `grep -rn "temp-id\|Could not find" src/services` يرجع صفر نتائج.
- اختبار Vitest لكل خدمة يتحقق أن فشل INSERT يصل للمستدعي كخطأ.

---

## 2. توحيد هوية المستأجر (org_id vs tenant_id) واشتقاقها من الجلسة 🔴 P0

### الوضع الحالي — ثلاث مشاكل متراكبة

**أ. تسمية مزدوجة حسب الجدول:**

| الجدول | العمود | المصدر |
|---|---|---|
| `work_centers` | `org_id` | تعليق صريح في `process-costing-service.ts:97` |
| `labor_time_logs`, `moh_applied` | `tenant_id` | `process-costing-service.ts:115,207` |
| `stage_costs` | `org_id` في TS، لكن `tenant_id` في SQL `post_mo_stage_to_wip` | تضارب فعلي |
| `gl_entry_lines` | **الاثنان معاً** `org_id` + `tenant_id` | `journal-service.ts:195-196` |

**ب. مصدر الهوية غير موثوق:** `process-costing-service.ts:72-73` يقرأ `config.ORG_ID` من `loadConfig()` — قيمة ثابتة على مستوى التطبيق وليست من جلسة المستخدم. بينما خدمات أخرى تستخدم `getEffectiveTenantId()`. أي أن مستخدماً في مؤسسة B قد يكتب تكاليف على مؤسسة A إذا كان الـ Config قديماً.

**ج. دوال SQL منقسمة:** `post_mo_stage_to_wip` تعتمد `current_setting('app.current_tenant_id')` (يتطلب `set_config` لكل اتصال — هش مع PostgREST pooling)، بينما `apply_stock_move` تستقبل `p_org_id` معاملاً **من العميل بلا تحقق**.

### التحسين المقترح

1. **قرار تسمية واحد: `org_id`** (الأكثر انتشاراً في الجداول الحديثة)، مع Migration يُنشئ أعمدة موحّدة ويحوّل `tenant_id` إلى Generated Column أو View خلال فترة انتقالية ثم يُحذف.
2. **الاشتقاق من JWT حصراً** — دالة SQL واحدة تُستخدم في كل RLS Policy وكل RPC:

```sql
CREATE OR REPLACE FUNCTION auth_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'org_id',
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'org_id'
  )::uuid
$$;
```

3. **حذف كل معاملات `p_org_id`/`p_tenant` من واجهات RPC** التي تُستدعى من المتصفح (موجودة حالياً في `posting-service.ts:73,93,110` وغيرها) — الخادم يشتقها بنفسه. أي RPC بـ `SECURITY DEFINER` يجب أن يبدأ بـ `v_org_id := auth_org_id()`.
4. **حذف `config.ORG_ID`** من `loadConfig()` واستبدال كل استخداماته.
5. **اختبار RLS آلي**: سكربت pgTAP ينشئ مستخدمَين في مؤسستين ويثبت العزل على كل جدول مالي (يوجد أساس في `sql/wardah_implementation/08_rls_test_data.sql` يمكن تحويله لاختبار CI).

---

## 3. الذرّية: كل عملية مالية = معاملة قاعدة بيانات واحدة 🔴 P0

### الوضع الحالي

الاعتراف موجود في الكود نفسه:

```ts
// src/services/inventory-transaction-service.ts:211-213
// Use transaction to ensure atomicity
// Note: For now, we'll execute operations sequentially
// In production, use database transactions via RPC functions
```

الحالات المكسورة المؤكدة:
- **قيد يومي**: رأس ثم سطور في استدعاءين (`journal-service.ts:177-203`) — فشل السطور يترك رأس قيد بلا سطور بمجاميع غير صفرية.
- **أمر تصنيع + حجز**: `createOrder.ts:77-82` — فشل الحجز يُسجَّل في Console ويكمل بنجاح.
- **استهلاك مواد**: تحديث الحجز ثم إنشاء `stock_moves` في حلقة استدعاءات منفصلة (`inventory-transaction-service.ts:214-260`) — فشل في المنتصف = مخزون غير متسق.
- **فحص التوفر ثم الحجز**: `reserveMaterials` يفحص ثم يحجز في طلبات منفصلة — Race Condition كلاسيكي (TOCTOU): طلبان متزامنان يحجزان نفس الكمية.

### التحسين المقترح

**القاعدة المعمارية:** المتصفح لا يكتب في أكثر من جدول واحد أبداً. أي عملية متعددة الجداول = دالة PL/pgSQL واحدة (وهي ذرّية ضمنياً داخل معاملة).

قائمة الدوال المطلوبة (تفاصيل كل واحدة في ملفَي القسمين):

| RPC | تستبدل | القسم |
|---|---|---|
| `rpc_create_journal_entry(jsonb)` | رأس+سطور من المتصفح | محاسبة |
| `rpc_create_manufacturing_order(jsonb)` | إنشاء + حجز | تصنيع |
| `rpc_reserve_materials(mo_id, jsonb)` | فحص+حجز مع `FOR UPDATE` | تصنيع |
| `rpc_consume_materials(mo_id, jsonb)` | حلقة تحديث+moves | تصنيع |
| `rpc_apply_labor / rpc_apply_overhead` | INSERT مباشر من المتصفح | تصنيع |

مع ملاحظة أن `sql/functions/transaction_helpers.sql` موجود أصلاً — يُراجع ويُبنى عليه بدل البدء من الصفر.

---

## 4. مصدر حقيقة واحد للـ Schema (Migrations) 🟠 P1

### الوضع الحالي

- `supabase/migrations/` تحتوي **4 ملفات فقط** (سبتمبر 2024).
- `sql/migrations/` تحتوي **112 ملفاً** بينها ملفات تشخيص (`00_check_...`, `18_debug_...`)، وإصلاحات متسلسلة (`12a` حتى `12f` لنفس مشكلة journals)، وملفات متعارضة (`15_process_costing_enhancement.sql` و`_no_migration` نسخة منه).
- `sql/wardah_implementation/` نظام كامل موازٍ (21 ملفاً) بجداول تختلف أسماؤها عن المستخدمة في الواجهة (`labor_entries` vs `labor_time_logs`).
- لا يمكن لأي مطوّر جديد بناء قاعدة بيانات مطابقة للإنتاج من المستودع — **الـ Schema الحقيقي يعيش في Supabase فقط**.

هذا هو السبب الجذري لمشاكل "Could not find column" التي وُضعت الحِيَل لابتلاعها (بند 1)، ولانقسام نموذج التكاليف (ملف التصنيع، بند 1).

### التحسين المقترح

1. **سحب الـ Schema الفعلي من الإنتاج كخط أساس**: `supabase db pull` ⇒ ملف `supabase/migrations/<ts>_baseline.sql` واحد يمثل الواقع.
2. **من الآن فصاعداً**: كل تغيير = ملف migration جديد في `supabase/migrations/` عبر `supabase migration new`، ويُطبَّق بـ `supabase db push` في CI — **يُمنع** تشغيل SQL يدوي من محرر Supabase.
3. **أرشفة `sql/`** كاملة إلى `sql/archive-2026/` مع README يشرح أنها تاريخية (يوجد `sql/archive/` أصلاً — تُضم إليه).
4. **بيئة Shadow في CI**: خطوة GitHub Action تبني قاعدة فارغة من الـ migrations وتشغّل اختبارات pgTAP عليها — يكشف أي migration مكسور قبل الدمج.
5. **توليد أنواع TypeScript من الـ Schema**: `supabase gen types typescript --linked > src/types/database.types.ts` في CI، واستبدال الأنواع اليدوية (مثل `StageCostResult` في `process-costing-service.ts:29`) بها تدريجياً. هذا يحوّل انحراف الـ Schema من خطأ وقت تشغيل صامت إلى **خطأ ترجمة**.

---

## 5. توحيد طبقة جلب البيانات في الواجهة 🟡 P2

### الوضع الحالي

- المشروع يعلن React Query في التقنيات (`README.md`)، لكن الخطاطيف الفعلية يدوية: `useManufacturingOrders.ts` يستخدم `useState/useEffect` بلا كاش ولا إعادة تحقق ولا إلغاء طلبات، مع `loadOrders` يُستدعى يدوياً بعد كل Mutation.
- `variance-alerts.tsx:169` يستخدم React Query مع `refetchInterval: 30000` — أي أن النمطين يتعايشان.
- الخدمات مقسومة بين `supabase-service.ts` الضخم (1304 سطراً) وخدمات feature-level.

### التحسين المقترح

1. **معيار واحد**: كل قراءة = `useQuery` بمفتاح مُهيكل، كل كتابة = `useMutation` مع `invalidateQueries`. ملف `src/lib/query-keys.ts` مركزي:

```ts
export const qk = {
  mo: {
    all: (orgId: string) => ['mo', orgId] as const,
    detail: (id: string) => ['mo', 'detail', id] as const,
    stageCosts: (id: string) => ['mo', id, 'stage-costs'] as const,
  },
  gl: {
    entries: (filters: EntryFilters) => ['gl', 'entries', filters] as const,
    trialBalance: (asOf: string) => ['gl', 'tb', asOf] as const,
  },
}
```

2. **تفكيك `supabase-service.ts`**: أُنجز جزئياً (`createOrder.ts`, `updateStatus.ts`) — يُستكمل حتى حذف الملف، مع منع الاستيراد منه بقاعدة ESLint.
3. **Realtime بدل Polling** حيث يهم: `stage-costing-panel.tsx` يستخدم Realtime أصلاً — يُعمَّم على تنبيهات الانحرافات بدل `refetchInterval`.

---

## 6. سياسة اختبارات تحمي المنطق المالي 🟡 P2

### الوضع الحالي

اختبارات Domain ممتازة (`src/domain/__tests__/ias2-inventory-costing.test.ts` وغيرها) لكنها تختبر كائنات TypeScript معزولة. **المنطق المالي الحقيقي يعيش في PL/pgSQL** (`upsert_stage_cost`, `apply_stock_move`, `post_journal_entry`) وليس له أي اختبار ينفَّذ ضد Postgres حقيقي.

### التحسين المقترح

1. **pgTAP** في CI على قاعدة Shadow (انظر بند 4): اختبارات لـ AVCO (تسلسل إدخال/إخراج معروف ⇒ متوسط متوقع)، EUP (سيناريوهات الوثيقة `PROCESS_COSTING_LIMITATIONS.md` تصبح اختبارات قابلة للتنفيذ)، توازن القيود، العزل بين المستأجرين.
2. **اختبارات تكامل Vitest ضد Supabase محلي** (`supabase start`) لمسارات: إنشاء MO ⇒ حجز ⇒ استهلاك ⇒ إكمال ⇒ قيد GL، وإنشاء قيد ⇒ ترحيل ⇒ محاولة تعديل (يجب أن تفشل).
3. **عتبة تغطية إلزامية** على `src/services/**` و`src/domain/**` في `vitest.config.ts` تمنع التراجع.
