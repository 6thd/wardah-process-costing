# 🗂️ Repository Reorganization Plan
**خطة إعادة تنظيم الريبو**

## 📊 الوضع الحالي: ✅ **مكتمل!**
- ✅ تم نقل 171 ملف markdown إلى docs/archive/
- ✅ تم نقل 138 ملف SQL إلى sql/archive/
- ✅ تم نقل 67 ملف script إلى scripts/archive/
- ✅ تم تنظيم 48 ملف SQL إلى sql/migrations/
- ✅ تم تنظيم 13 ملف function إلى sql/functions/
- ✅ تم تنظيم 2 ملف seed إلى sql/seeds/
- ✅ تم نقل 6 ملفات markdown من sql/ إلى docs/deployment/
- ✅ هيكل واضح ومنظم
- ✅ سهولة في العثور على أي شيء

## 🎯 الهدف:
✅ هيكل منظم واحترافي
✅ سهولة في التنقل
✅ onboarding سهل للمطورين الجدد
✅ maintenance أسهل

## 📁 الهيكل الجديد:

```
wardah-process-costing/
├── README.md                    # الدليل الرئيسي الوحيد
├── CONTRIBUTING.md              # للمساهمين
├── LICENSE
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── .env.example
│
├── docs/                        # كل التوثيق
│   ├── INDEX.md                 # الفهرس الرئيسي
│   ├── getting-started/
│   │   ├── installation.md
│   │   └── quick-start.md
│   ├── features/
│   │   ├── accounting/
│   │   ├── manufacturing/
│   │   ├── inventory/
│   │   └── hr/
│   ├── deployment/
│   │   ├── database-setup.md
│   │   └── sql-scripts.md
│   ├── troubleshooting/
│   │   ├── common-issues.md
│   │   └── performance.md
│   └── archive/                 # الملفات القديمة
│
├── sql/                         # كل الـ SQL
│   ├── migrations/              # Migrations مرتبة
│   ├── functions/              # RPC Functions
│   ├── views/                  # Database Views
│   ├── seeds/                  # Test Data
│   ├── performance/            # Performance Scripts
│   └── archive/                # SQL القديم
│
├── scripts/                     # Automation Scripts
│   ├── deploy/
│   ├── check/
│   ├── import/
│   └── archive/
│
├── src/                         # Frontend Code
├── tests/                       # Tests
└── public/                      # Static Assets
```

## 📋 خطوات التنفيذ:

### Phase 1: إنشاء الهيكل (5 دقائق)
- [x] إنشاء مجلدات docs/, sql/, scripts/
- [x] إنشاء المجلدات الفرعية

### Phase 2: نقل الملفات (30 دقيقة)
- [x] نقل جميع .md إلى docs/archive/
- [x] نقل جميع .sql إلى sql/archive/
- [x] نقل جميع .cjs/.js إلى scripts/archive/
- [x] نقل .html إلى scripts/archive/

### Phase 3: تنظيم التوثيق (1 ساعة)
- [x] دمج الملفات المكررة (تم نقلها إلى archive/)
- [x] إنشاء docs/INDEX.md
- [x] تنظيم docs/features/ (المجلدات موجودة)
- [x] تنظيم docs/deployment/ (تم نقل 6 ملفات markdown من sql/)

### Phase 4: تنظيم SQL (1 ساعة)
- [x] تنظيم sql/migrations/ (تم نقل 48 ملف)
- [x] تنظيم sql/functions/ (تم نقل 13 ملف)
- [x] تنظيم sql/views/
- [x] تنظيم sql/performance/ (موجود مسبقاً)
- [x] تنظيم sql/seeds/ (تم نقل 2 ملف)

### Phase 5: إنشاء README الرئيسي (30 دقيقة)
- [x] إنشاء README.md جديد (موجود)
- [x] تحديث CONTRIBUTING.md (موجود)
- [x] إنشاء docs/INDEX.md (موجود ومحدث)

### Phase 6: تنظيف الـ Root (10 دقائق)
- [x] حذف الملفات المكررة (تم نقلها)
- [x] الاحتفاظ بالملفات الأساسية فقط (✅ مكتمل)

## ⚠️ تحذيرات:
- ✅ لا نحذف أي ملف - ننقله فقط
- ✅ نحتفظ بكل شيء في archive/
- ✅ نتحقق من الروابط بعد النقل

## 🎯 النتيجة المتوقعة:
- ✅ root directory نظيف (10-15 ملف فقط)
- ✅ كل شيء منظم في مجلدات
- ✅ سهولة في العثور على أي شيء
- ✅ onboarding أسهل بكثير

