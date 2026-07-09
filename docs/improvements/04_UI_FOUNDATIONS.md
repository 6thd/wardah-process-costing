# P3-UI: أساسات الواجهة الموحَّدة

> **المبدأ**: إضافي بالكامل — الشاشات القديمة تعمل كما هي، والمكوّنات الجديدة تُعتمد تدريجياً.

## المشكلة

قبل هذه المرحلة كانت كل شاشة تبني حالاتها يدوياً:
- **41 شاشة** تكرر نمط العنوان (`text-3xl font-bold` + وصف + `isRTL`)
- حالات فارغة متناثرة بأشكال مختلفة (بعضها مجرد نص، بعضها بلا توجيه)
- أخطاء تُعرض كنص أحمر بلا زر إعادة محاولة
- تحميل بـ spinner عام لا يشبه المحتوى القادم
- طباعة التقارير تُخرج القائمة الجانبية والأزرار معها

## المكوّنات الجديدة (`src/components/ui/`)

### 1. `PageHeader` — رأس صفحة موحَّد
```tsx
import { PageHeader } from '@/components/ui/page-header'

<PageHeader
  icon={<Scale />}
  title="تسوية الدفاتر الفرعية"
  description="مقارنة أرصدة المخزون مع GL"
  actions={<Button>طباعة</Button>}
/>
```
- RTL تلقائي عبر اتجاه المستند — لا حاجة لـ `isRTL` يدوياً
- مخفي عند الطباعة افتراضياً (`hideOnPrint={false}` لإبقائه)

### 2. `EmptyState` — حالة فارغة موجِّهة
```tsx
import { EmptyState } from '@/components/ui/empty-state'

<EmptyState
  icon={<FileBarChart />}
  title="لم يُحدَّد أمر تصنيع بعد"
  description="اختر أمر تصنيع من القائمة أعلاه"
  action={<Button>إنشاء أمر جديد</Button>}
/>
```
- أفضل ممارسة: الحالة الفارغة **توجيه** وليست "لا بيانات" — ماذا تعني؟ وما الخطوة التالية؟
- `role="status"` لقارئات الشاشة

### 3. `ErrorState` — خطأ بلغة المستخدم + إجراء
```tsx
import { ErrorState } from '@/components/ui/error-state'

<ErrorState
  title="تعذر توليد التقرير"
  message={error.message}
  onRetry={() => refetch()}
/>
```
- `role="alert"` + زر إعادة محاولة اختياري
- خدماتنا ترجع رسائل عربية واضحة (منذ P0) — تُعرض كما هي

### 4. `loading-state` — هياكل تحميل تطابق المحتوى
```tsx
import { TableSkeleton, CardSkeleton, ReportSkeleton } from '@/components/ui/loading-state'

{isFetching && !data && <ReportSkeleton />}
```
- أفضل ممارسة: skeleton يشبه المحتوى القادم بدل spinner عام
- `<output>` + `aria-label` لقارئات الشاشة

## طبقة الطباعة (`src/styles/print.css`)

تُحمَّل تلقائياً عبر `globals.css` — أي شاشة تصبح قابلة للطباعة باحترافية:
- `header/nav/aside` تُخفى تلقائياً + كل ما يحمل `print:hidden` أو `no-print`
- جداول بحدود واضحة ورأس يتكرر مع كل صفحة (`display: table-header-group`)
- البطاقات والصفوف لا تنقسم عبر الصفحات (`break-inside: avoid`)
- A4 بهوامش قياسية

## أين طُبِّقت كنموذج مرجعي

| الشاشة | المكوّنات |
|---|---|
| `/accounting/reconciliation` | PageHeader + ErrorState + ReportSkeleton |
| `/manufacturing/cost-of-production` | EmptyState + ErrorState + ReportSkeleton |

## خطة الاعتماد التدريجي

عند لمس أي شاشة قديمة لأي سبب، استبدل أنماطها اليدوية بالمكوّنات الموحَّدة —
**لا حاجة لحملة تعديل شاملة** تخاطر بكسر 41 شاشة دفعة واحدة.
