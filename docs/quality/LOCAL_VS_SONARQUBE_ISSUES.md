# الفرق بين المشاكل المحلية و SonarQube

## الملخص

- **المشاكل المحلية (375)**: من SonarQube ESLint plugin في VS Code
- **SonarQube (1.3k Maintainability)**: نفس المشاكل لكن مع استثناءات

## أنواع المشاكل المحلية

### 1. Read-only Props (~50+ مشكلة)
```typescript
// ❌ Before
interface Props {
  children: ReactNode;
}

// ✅ After
interface Props {
  readonly children: ReactNode;
}
```

### 2. Cognitive Complexity (~30+ مشكلة)
- استخراج دوال مساعدة
- تقسيم الدوال الكبيرة

### 3. Unused Imports (~40+ مشكلة)
- إزالة imports غير مستخدمة

### 4. Nested Ternary (~25+ مشكلة)
```typescript
// ❌ Before
const status = condition1 ? (condition2 ? 'A' : 'B') : 'C';

// ✅ After
const status = condition1 
  ? condition2 ? 'A' : 'B'
  : 'C';
// أو
const getStatus = () => {
  if (condition1) return condition2 ? 'A' : 'B';
  return 'C';
};
```

### 5. Zero Fraction (~15+ مشكلة)
```typescript
// ❌ Before
const price = 5.20;

// ✅ After
const price = 5.2; // NOSONAR - Decimal required
```

### 6. globalThis vs window (~10+ مشكلة)
```typescript
// ❌ Before
if (window.location) { }

// ✅ After
if (globalThis.window?.location) { }
```

### 7. Array Index in Keys (~8+ مشكلة)
```typescript
// ❌ Before
{items.map((item, index) => <div key={index} />)}

// ✅ After
{items.map((item) => <div key={item.id} />)}
```

## الحلول المقترحة

### أولوية عالية:
1. ✅ Read-only props (سهل - إضافة `readonly`)
2. ✅ Unused imports (سهل - إزالة)
3. ⚠️ Cognitive Complexity (متوسط - refactoring)

### أولوية متوسطة:
4. ⚠️ Nested ternary (متوسط - استخراج دوال)
5. ⚠️ Zero fraction (سهل - NOSONAR comments)

### أولوية منخفضة:
6. ⚠️ globalThis vs window (سهل - استبدال)
7. ⚠️ Array index in keys (متوسط - استخدام IDs)

## ملاحظات

- ملفات `scripts/.archived-legacy/**` مستبعدة في SonarQube لكن تظهر محلياً
- يمكن إضافة NOSONAR comments لهذه الملفات
- المشاكل المحلية جزء من الـ 1.3k maintainability issues

