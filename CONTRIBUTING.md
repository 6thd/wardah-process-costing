# Contributing to Wardah ERP

شكراً لاهتمامك بالمساهمة في نظام وردة! 🎉

## 📋 جدول المحتويات

- [Code of Conduct](#code-of-conduct)
- [كيفية المساهمة](#كيفية-المساهمة)
- [Development Workflow](#development-workflow)
- [معايير الكود](#معايير-الكود)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

هذا المشروع يلتزم بمدونة سلوك المساهمين. بالمشاركة، من المتوقع منك الالتزام بهذه المدونة.

## كيفية المساهمة

### 🐛 الإبلاغ عن الأخطاء

إذا وجدت خطأ:

1. **تأكد** أن الخطأ لم يُبلّغ عنه من قبل في [GitHub Issues](https://github.com/6thd/wardah-process-costing/issues)
2. **افتح** Issue جديد وأرفق:
   - عنوان واضح ووصف دقيق
   - خطوات لإعادة إنتاج الخطأ
   - السلوك المتوقع والفعلي
   - Screenshots إذا كان ممكناً
   - معلومات البيئة (Browser, OS, Version)

مثال:
```markdown
**نوع المشكلة:** Bug في Purchase Order

**الوصف:**
عند إنشاء Purchase Order، الـ FIFO valuation لا يعمل صح

**الخطوات:**
1. اذهب إلى Purchasing → Purchase Orders
2. أنشئ PO جديد
3. أضف منتج بطريقة FIFO
4. احفظ واستلم البضاعة

**السلوك المتوقع:**
يجب أن يحسب COGS بـ FIFO

**السلوك الفعلي:**
التكلفة المحسوبة خاطئة

**البيئة:**
- Browser: Chrome 120
- OS: Windows 11
- Version: 1.0.0
```

### ✨ اقتراح ميزة جديدة

لاقتراح ميزة:

1. **افتح** Issue بعنوان واضح
2. **اشرح** الميزة بالتفصيل
3. **وضّح** حالات الاستخدام
4. **أضف** mockups إذا كان ممكناً

### 💻 المساهمة بالكود

## Development Workflow

### 1. Fork المشروع

```bash
# Fork على GitHub ثم:
git clone https://github.com/YOUR_USERNAME/wardah-process-costing.git
cd wardah-process-costing
```

### 2. Setup البيئة

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env.local

# تأكد من تعديل .env.local بمعلومات Supabase الخاصة بك
```

### 3. أنشئ Branch

```bash
# من main branch
git checkout main
git pull origin main

# أنشئ feature branch
git checkout -b feature/amazing-feature

# أو bug fix branch
git checkout -b fix/issue-123
```

### 4. اعمل على التغييرات

```bash
# ابدأ development server
npm run dev

# اعمل على التغييرات...
```

### 5. اختبر التغييرات

```bash
# Type check
npm run type-check

# Lint
npm run lint

# Build
npm run build

# اختبر في البراوزر
npm run preview
```

### 6. Commit التغييرات

```bash
git add .
git commit -m "feat(purchasing): add FIFO valuation strategy"
```

### 7. Push للـ Fork

```bash
git push origin feature/amazing-feature
```

### 8. افتح Pull Request

اذهب إلى GitHub وافتح Pull Request من branch الخاص بك إلى `main`.

## معايير الكود

### TypeScript

- ✅ استخدم TypeScript في كل الملفات
- ✅ تجنب `any` type
- ✅ استخدم interfaces للكائنات المعقدة
- ✅ استخدم enums للقيم الثابتة

```typescript
// ✅ جيد
interface Product {
  id: string;
  code: string;
  name: string;
  cost_price: number;
  valuation_method: ValuationMethod;
}

enum ValuationMethod {
  FIFO = 'FIFO',
  LIFO = 'LIFO',
  WEIGHTED_AVERAGE = 'WEIGHTED_AVERAGE'
}

// ❌ سيء
function updateProduct(product: any) {
  // ...
}
```

### React Best Practices

- ✅ استخدم Functional Components
- ✅ استخدم Custom Hooks للمنطق المشترك
- ✅ Memoize expensive computations
- ✅ استخدم React Query للـ data fetching

```typescript
// ✅ جيد
const MyComponent: React.FC<Props> = ({ data }) => {
  const { isLoading, error } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts
  });

  const memoizedValue = useMemo(() => {
    return expensiveCalculation(data);
  }, [data]);

  return <div>{/* ... */}</div>;
};

// ❌ سيء
class MyComponent extends React.Component {
  // ...
}
```

### Naming Conventions

- **Components**: PascalCase (`PurchaseOrderForm.tsx`)
- **Files**: kebab-case (`stock-ledger-service.ts`)
- **Functions**: camelCase (`calculateCOGS()`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_TAX_RATE`)
- **Interfaces**: PascalCase with 'I' prefix optional (`Product` or `IProduct`)

### File Structure

```
src/
├── components/
│   ├── forms/
│   │   └── PurchaseOrderForm.tsx
│   └── ui/
│       └── button.tsx
├── services/
│   ├── purchasing-service.ts
│   └── stock-ledger-service.ts
├── hooks/
│   └── use-products.ts
└── types/
    └── purchasing.ts
```

### Style Guide

- ✅ استخدم Prettier للـ formatting
- ✅ استخدم ESLint للـ linting
- ✅ Maximum line length: 100 characters
- ✅ استخدم 2 spaces للـ indentation
- ✅ استخدم single quotes

## Commit Messages

نستخدم [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: ميزة جديدة
- `fix`: إصلاح خطأ
- `docs`: تحديث التوثيق
- `style`: تنسيق الكود (لا يؤثر على الوظائف)
- `refactor`: إعادة هيكلة بدون تغيير الوظائف
- `perf`: تحسين الأداء
- `test`: إضافة اختبارات
- `chore`: صيانة وأعمال تطويرية

### Scopes

- `purchasing`: المشتريات
- `stock`: المخزون
- `sales`: المبيعات
- `accounting`: المحاسبة
- `valuation`: التقييم
- `ui`: واجهة المستخدم
- `db`: قاعدة البيانات

### Examples

```bash
# Feature
git commit -m "feat(purchasing): implement FIFO valuation strategy"

# Bug fix
git commit -m "fix(stock): correct stock queue calculation in LIFO"

# Documentation
git commit -m "docs(readme): add setup instructions for Supabase"

# Breaking change
git commit -m "feat(valuation)!: change valuation API structure

BREAKING CHANGE: ValuationStrategy interface now requires getRate() method"
```

## Pull Request Process

### 1. قبل فتح PR

- ✅ تأكد أن الكود يعمل
- ✅ أضف tests إذا كان ممكناً
- ✅ حدّث التوثيق
- ✅ تأكد من ESLint و TypeScript checks نظيفة
- ✅ Rebase على آخر main

### 2. PR Description

استخدم هذا Template:

```markdown
## ما التغيير؟
<!-- وصف مختصر للتغييرات -->

## لماذا؟
<!-- شرح سبب التغيير -->

## كيف تم الاختبار؟
- [ ] Unit tests
- [ ] Manual testing
- [ ] Browser testing

## Screenshots (إذا كان applicable)
<!-- أضف صور للتغييرات في UI -->

## Checklist
- [ ] الكود يتبع معايير المشروع
- [ ] تم تحديث التوثيق
- [ ] تم إضافة/تحديث الاختبارات
- [ ] جميع الاختبارات تمر بنجاح
- [ ] لا توجد تحذيرات من ESLint/TypeScript

## Related Issues
<!-- اربط بـ Issue إذا كان موجود -->
Fixes #123
```

### 3. Code Review Process

- سيقوم المشرفون بمراجعة الكود
- قد يُطلب منك إجراء تعديلات
- بعد الموافقة، سيتم دمج الـ PR

## 🎯 أولويات المساهمة

### High Priority

- ✅ Phase 4: Sales Integration
- ✅ Testing Coverage
- ✅ Documentation Improvements

### Medium Priority

- 🔄 Performance Optimizations
- 🔄 UI/UX Enhancements
- 🔄 More Valuation Methods

### Low Priority

- 📋 Code Refactoring
- 📋 Additional Features

## 📚 موارد مفيدة

### للتعلم

- [ERPNext Documentation](https://docs.erpnext.com/)
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Supabase Documentation](https://supabase.com/docs)

### للتطوير

- [Shadcn/ui Components](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [React Query](https://tanstack.com/query/latest)

## 🤝 الحصول على المساعدة

إذا كنت بحاجة لمساعدة:

1. اقرأ التوثيق أولاً
2. ابحث في Issues الموجودة
3. افتح Discussion على GitHub
4. اسأل في Issue جديد

## 📝 الترخيص

بالمساهمة، أنت توافق على أن مساهماتك ستكون مرخصة تحت نفس ترخيص المشروع (MIT License).

---

**شكراً لمساهمتك في جعل Wardah ERP أفضل!** 🙏✨
