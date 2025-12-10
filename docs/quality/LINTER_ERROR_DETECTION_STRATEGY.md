# استراتيجية اكتشاف أخطاء Linter تلقائياً

## 📋 الهدف

اكتشاف أخطاء SonarQube/Linter تلقائياً قبل الانتقال للمرحلة التالية، بدلاً من الاعتماد على فتح الملف يدوياً في VS Code.

## 🛠️ الأدوات المتاحة

### 1. استخدام `read_lints` Tool (في Cursor AI)

عند إنشاء أو تعديل ملف، استخدم:
```typescript
read_lints(['path/to/file.ts'])
```

### 2. استخدام npm script

```bash
# التحقق من ملف معين
npm run lint:check -- tests/compliance/socpa-compliance.test.ts

# التحقق من جميع ملفات الاختبار
npm run lint:test-files
```

### 3. استخدام VS Code Command Palette

1. اضغط `Ctrl+Shift+P` (أو `Cmd+Shift+P` على Mac)
2. اكتب: `TypeScript: Check for Errors`
3. أو: `ESLint: Show Output Channel`

### 4. استخدام Terminal مباشرة

```bash
# TypeScript type checking
npm run type-check

# ESLint (إذا كان مثبت)
npx eslint tests/compliance/*.test.ts
```

## 🔄 Workflow المقترح

### قبل إنشاء ملف جديد:

1. **إنشاء الملف**
2. **كتابة الكود**
3. **التحقق من الأخطاء:**
   ```bash
   npm run lint:check -- <file-path>
   ```
4. **إصلاح الأخطاء**
5. **تشغيل الاختبارات:**
   ```bash
   npm run test -- <file-path>
   ```
6. **التحقق مرة أخرى من الأخطاء**
7. **Commit & Push**

### بعد تعديل ملف موجود:

1. **تعديل الملف**
2. **التحقق من الأخطاء:**
   ```bash
   npm run lint:check -- <file-path>
   ```
3. **إصلاح الأخطاء**
4. **Commit & Push**

## 📝 الأخطاء الشائعة وكيفية إصلاحها

### 1. `String#replace()` should be `replaceAll()`

**المشكلة:**
```typescript
text.replace(/pattern/g, 'replacement')
```

**الحل:**
```typescript
// إذا كان regex مع callback function
text.replace(/pattern/g, (match) => ...) // NOSONAR S6653 - replaceAll cannot be used with callback

// إذا كان pattern بسيط
text.replaceAll('pattern', 'replacement')
```

### 2. Use `Math.trunc` instead of `| 0`

**المشكلة:**
```typescript
const r = Math.random() * 16 | 0
```

**الحل:**
```typescript
const r = Math.trunc(Math.random() * 16)
```

### 3. Don't use a zero fraction in the number

**المشكلة:**
```typescript
const rate = 0.10
```

**الحل:**
```typescript
const rate = 0.1
```

### 4. Nested functions more than 4 levels deep

**المشكلة:**
```typescript
expect(() => {
  someFunction()
}).toThrow()
```

**الحل:**
```typescript
const testFunction = () => someFunction() // NOSONAR S134 - Arrow function in test is standard practice
expect(testFunction).toThrow()
```

## 🎯 Best Practices

1. **التحقق من الأخطاء بعد كل تعديل كبير**
2. **استخدام NOSONAR فقط عندما يكون الأمر ضرورياً**
3. **إضافة تعليق يوضح سبب استخدام NOSONAR**
4. **التحقق من جميع ملفات الاختبار قبل Commit**

## 📊 مثال عملي

```bash
# 1. إنشاء ملف جديد
# 2. كتابة الكود
# 3. التحقق من الأخطاء
npm run lint:check -- tests/compliance/new-test.test.ts

# 4. إصلاح الأخطاء
# 5. تشغيل الاختبارات
npm run test -- tests/compliance/new-test.test.ts

# 6. التحقق مرة أخرى
npm run lint:check -- tests/compliance/new-test.test.ts

# 7. Commit
git add tests/compliance/new-test.test.ts
git commit -m "test: إضافة new-test"
git push
```

## 🔍 Integration with CI/CD

يمكن إضافة هذا التحقق في GitHub Actions:

```yaml
- name: Check Linter Errors
  run: npm run lint:test-files
```

## 📚 مراجع

- [SonarQube TypeScript Rules](https://rules.sonarsource.com/typescript)
- [ESLint Rules](https://eslint.org/docs/rules/)
- [TypeScript Compiler Options](https://www.typescriptlang.org/tsconfig)

