# خطة التنفيذ المرحلية - Wardah ERP V2.0

## المرحلة الأولى: الأساسيات (الأسابيع 1-2)
**الهدف:** إنشاء أساس قوي وموثوق

### أولويات عالية:
1. **إعداد Supabase**
   - ✅ إنشاء مشروع جديد على Supabase
   - ✅ تنفيذ Schema الكامل (wardah-migration-schema.sql)
   - ✅ تطبيق RLS Policies (wardah-rls-policies.sql)
   - ✅ تفعيل AVCO Functions (wardah-avco-functions.sql)
   - ✅ استيراد البيانات الأساسية (COA + GL Mappings)

2. **تحديث Frontend إلى TypeScript**
   - ✅ تحويل app.js إلى TypeScript
   - ✅ إضافة Types للبيانات
   - ✅ إعداد Vite + React 18
   - ✅ تطبيق ESLint + Prettier

3. **ربط Frontend بـ Backend**
   - ✅ إعداد Supabase Client
   - ✅ إنشاء React Query Hooks
   - ✅ تحديث المكونات لاستخدام البيانات الحقيقية

### الخطوات التفصيلية:

#### اليوم 1-2: إعداد قاعدة البيانات
```bash
# خطوات Supabase
1. إنشاء حساب على supabase.com
2. إنشاء مشروع: "wardah-process-costing-v2"
3. في SQL Editor تنفيذ:
   - wardah-migration-schema.sql
   - wardah-rls-policies.sql
   - wardah-avco-functions.sql
4. استيراد CSV:
   - wardah_enhanced_coa.csv → gl_accounts
   - wardah_gl_mappings.csv → gl_mappings
```

#### اليوم 3-4: تحديث Frontend
```bash
# تحديث package.json
npm install @types/react @types/react-dom typescript @vitejs/plugin-react-swc

# إضافة ملفات التكوين
touch tsconfig.json vite.config.ts

# تحويل الملفات الرئيسية
mv app.js app.tsx
mv index.html → تحديث imports
```

#### اليوم 5-7: التكامل
```bash
# إنشاء بنية المجلدات
mkdir -p src/{components,hooks,lib,types,features}

# إضافة Supabase integration
npm install @supabase/supabase-js @tanstack/react-query

# تحديث المكونات الأساسية
```

---

## المرحلة الثانية: الوظائف المتقدمة (الأسابيع 3-4)
**الهدف:** إضافة الوظائف المتقدمة والتقارير

### أولويات متوسطة:
1. **نظام التقارير المتقدمة**
   - ✅ تقارير انحرافات المواد والعمالة
   - ✅ تقارير WIP بالمراحل
   - ✅ تحليل الربحية
   - ✅ لوحة معلومات التقارير

2. **تحسين نظام Process Costing**
   - ✅ حسابات AVCO متقدمة
   - ✅ تتبع التكاليف بالمراحل
   - ✅ تحديث StageCostingPanel

3. **نظام Realtime محسن**
   - ✅ اشتراكات ذكية
   - ✅ مؤشر اتصال متقدم
   - ✅ Optimistic updates

---

## المرحلة الثالثة: التحسين والاستقرار (الأسابيع 5-6)
**الهدف:** تحسين الأداء والاستقرار

### أولويات منخفضة:
1. **تحسين الأداء**
   - ✅ Cache persistence
   - ✅ Smart prefetching
   - ✅ Bundle optimization
   - ✅ Performance monitoring

2. **الاختبارات والجودة**
   - ✅ Unit tests للوظائف الحيوية
   - ✅ Integration tests للـ API
   - ✅ E2E tests للمسارات الهامة

3. **التوثيق والنشر**
   - ✅ توثيق API
   - ✅ دليل المطور
   - ✅ إعداد CI/CD

---

## قائمة المراجعة (Checklist)

### إعداد البيئة:
- [ ] إنشاء مشروع Supabase جديد
- [ ] نسخ PROJECT_URL و ANON_KEY
- [ ] إعداد متغيرات البيئة (.env.local)
- [ ] تحديث config.json بالبيانات الحقيقية

### قاعدة البيانات:
- [ ] تنفيذ wardah-migration-schema.sql
- [ ] تطبيق wardah-rls-policies.sql
- [ ] تفعيل wardah-avco-functions.sql
- [ ] استيراد wardah_enhanced_coa.csv (190+ حساب)
- [ ] استيراد wardah_gl_mappings.csv (72 خريطة)
- [ ] إنشاء organization تجريبية
- [ ] إنشاء مستخدم تجريبي

### Frontend:
- [ ] تحويل app.js إلى TypeScript
- [ ] إضافة TypeScript types
- [ ] إعداد Vite config
- [ ] تحديث package.json
- [ ] إنشاء Supabase client
- [ ] إضافة React Query provider
- [ ] تحديث المكونات لاستخدام البيانات الحقيقية

### الوظائف الأساسية:
- [ ] تسجيل الدخول والخروج
- [ ] عرض أوامر التصنيع
- [ ] إنشاء أمر تصنيع جديد
- [ ] تكاليف المراحل (StageCostingPanel)
- [ ] حركات المخزون
- [ ] تقارير أساسية

### الاختبار:
- [ ] إنشاء منتج تجريبي
- [ ] إنشاء BOM تجريبي
- [ ] إنشاء أمر تصنيع تجريبي
- [ ] تسجيل تكاليف مراحل
- [ ] فحص تقارير الانحرافات
- [ ] اختبار Realtime updates

---

## الأدوات والمتطلبات

### البيئة التطويرية:
```json
{
  "node": ">=18.0.0",
  "npm": ">=9.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "typescript": "^5.2.2",
    "@supabase/supabase-js": "^2.57.4",
    "@tanstack/react-query": "^5.8.4",
    "tailwindcss": "^3.3.5",
    "@radix-ui/react-*": "latest"
  }
}
```

### قاعدة البيانات:
- Supabase (PostgreSQL 15+)
- RLS enabled
- Realtime enabled
- Functions enabled

---

## المخاطر المحتملة والحلول

### 1. تعارض في البيانات:
**المشكلة:** قد تتعارض البيانات الجديدة مع الموجودة
**الحل:** استخدام UPSERT وTransaction safety

### 2. بطء في الاستعلامات:
**المشكلة:** استعلامات معقدة قد تكون بطيئة
**الحل:** إضافة Indexes مناسبة و Query optimization

### 3. مشاكل RLS:
**المشكلة:** صعوبة في الوصول للبيانات مع RLS
**الحل:** استخدام Service Role للعمليات المعقدة

### 4. تحديثات Realtime مفرطة:
**المشكلة:** كثرة التحديثات قد تؤثر على الأداء
**الحل:** Debouncing وFiltering على مستوى القاعدة

---

## التقدير الزمني

| المرحلة | المدة | المهام |
|---------|------|--------|
| الأساسيات | 2 أسبوع | Database + TypeScript + Integration |
| الوظائف المتقدمة | 2 أسبوع | Reports + Advanced Costing + Realtime |
| التحسين والاستقرار | 2 أسبوع | Performance + Testing + Documentation |
| **المجموع** | **6 أسابيع** | **نظام متكامل جاهز للإنتاج** |

---

## معايير النجاح

### الأداء:
- [ ] تحميل الصفحة < 3 ثواني
- [ ] استجابة الاستعلامات < 500ms
- [ ] معدل نجاح Realtime > 99%

### الوظائف:
- [ ] جميع الوظائف الأساسية تعمل
- [ ] التقارير تعرض بيانات دقيقة
- [ ] حسابات AVCO صحيحة

### الجودة:
- [ ] لا توجد أخطاء JavaScript
- [ ] TypeScript types كاملة
- [ ] Test coverage > 80%

### الأمان:
- [ ] RLS يعمل بشكل صحيح
- [ ] لا تسريب للبيانات بين المؤسسات
- [ ] المصادقة آمنة

**🚀 المشروع جاهز للبدء! ابدأ بالمرحلة الأولى واتبع القائمة خطوة بخطوة.**