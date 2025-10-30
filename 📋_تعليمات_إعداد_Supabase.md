# 📋 تعليمات إعداد قاعدة البيانات في Supabase

## ⚠️ المشكلة الحالية

الخطأ الذي تراه:
```
Failed to load resource: net::ERR_NAME_NOT_RESOLVED
rytzljjlthouptdqeuxh.supabase.co
```

هذا يعني أن مشروع Supabase:
1. **إما متوقف (Paused)** - المشاريع المجانية تتوقف بعد فترة من عدم الاستخدام
2. **أو غير موجود** - تم حذفه أو العنوان غير صحيح

---

## ✅ الحل: تفعيل أو إنشاء مشروع Supabase

### الخطوة 1️⃣: التحقق من حالة المشروع

1. اذهب إلى: https://supabase.com/dashboard
2. سجل الدخول بحسابك
3. ابحث عن مشروع باسم قريب من `wardah` أو `rytzljjlthouptdqeuxh`

**إذا وجدت المشروع:**
- إذا كان عليه علامة "⏸ Paused":
  - اضغط على المشروع
  - اضغط زر **"Restore project"** أو **"Resume"**
  - انتظر 2-3 دقائق حتى يصبح نشطاً

**إذا لم تجد المشروع:**
- انتقل للخطوة 2️⃣

---

### الخطوة 2️⃣: إنشاء مشروع جديد (إذا لزم الأمر)

1. في Supabase Dashboard، اضغط **"New Project"**
2. املأ البيانات:
   - **Name**: `wardah-erp`
   - **Database Password**: احفظها في مكان آمن
   - **Region**: اختر `Southeast Asia` أو الأقرب لك
   - **Pricing Plan**: Free
3. اضغط **"Create new project"**
4. انتظر 2-3 دقائق حتى يكتمل الإعداد

---

### الخطوة 3️⃣: نسخ بيانات الاتصال الجديدة

بعد إنشاء أو تفعيل المشروع:

1. من صفحة المشروع، اذهب إلى **Settings** (⚙️)
2. اختر **API** من القائمة الجانبية
3. انسخ:
   - **Project URL** (يبدأ بـ `https://xxxxx.supabase.co`)
   - **anon public** key (مفتاح طويل يبدأ بـ `eyJ...`)

---

### الخطوة 4️⃣: تحديث ملف config.json

افتح ملف `config.json` في المجلد الرئيسي وغيّر:

```json
{
  "SUPABASE_URL": "ضع_هنا_الـ_Project_URL_الجديد",
  "SUPABASE_ANON_KEY": "ضع_هنا_الـ_anon_key_الجديد",
  ...باقي الإعدادات كما هي...
}
```

احفظ الملف. التطبيق سيُعاد تحميله تلقائياً.

---

### الخطوة 5️⃣: إنشاء الجداول في قاعدة البيانات

الآن قاعدة البيانات فارغة تماماً. نحتاج لإنشاء الجداول:

1. في Supabase Dashboard، اذهب إلى **SQL Editor** (أيقونة 📝)
2. اضغط **"New query"**
3. افتح ملف `supabase-setup.sql` (المفتوح حالياً في VS Code)
4. **انسخ المحتوى كله** (607 سطر)
5. **الصقه** في SQL Editor في Supabase
6. اضغط **"Run"** أو اضغط `Ctrl+Enter`

انتظر حتى ينتهي التنفيذ (5-10 ثواني).

**التحقق من النجاح:**
يجب أن ترى رسائل النجاح في الأسفل، وفي نهاية التنفيذ سترى:
```
✅ Wardah ERP Database Setup Complete!
📋 Next steps:
1. Update your config.json with your Supabase credentials
2. Import Chart of Accounts using the import functions
3. Import GL Mappings using the import functions
4. Configure users and organizations in your auth system
```

---

### الخطوة 6️⃣: إنشاء مستخدم للدخول

1. في Supabase Dashboard، اذهب إلى **Authentication** (أيقونة 👤)
2. اختر **Users** من القائمة الجانبية
3. اضغط **"Add user"** → **"Create new user"**
4. املأ البيانات:
   - **Email**: `admin@wardah.sa`
   - **Password**: `admin123`
   - اترك باقي الحقول فارغة
5. اضغط **"Create user"**

**انسخ الـ UUID الخاص بالمستخدم** (سنحتاجه في الخطوة التالية)

---

### الخطوة 7️⃣: ربط المستخدم بالمنظمة

1. في Supabase Dashboard → **SQL Editor**
2. افتح ملف `sql/urgent_fixes/03_create_default_organization.sql`
3. انسخ المحتوى كاملاً
4. الصقه في SQL Editor
5. اضغط **"Run"**

**التحقق:**
يجب أن ترى:
```
✅ Organization Created
✅ Setup Complete!
Organizations: 1
Users: 1
User Associations: 1
```

---

### الخطوة 8️⃣: اختبار تسجيل الدخول

الآن كل شيء جاهز! 

1. افتح: http://localhost:5173
2. سيتم توجيهك لصفحة تسجيل الدخول
3. أدخل:
   - **Email**: `admin@wardah.sa`
   - **Password**: `admin123`
4. اضغط **"تسجيل الدخول"**

**يجب أن تدخل للنظام بنجاح!** ✅

---

## 🆘 إذا واجهت مشاكل

### المشكلة: "Invalid login credentials"
- تأكد أنك أدخلت البريد وكلمة المرور بشكل صحيح
- تحقق من أن المستخدم تم إنشاؤه في Authentication > Users

### المشكلة: لا تزال أخطاء الاتصال موجودة
- تأكد من أنك حدّثت `config.json` بالبيانات الصحيحة
- تأكد أن المشروع في Supabase نشط وليس متوقفاً
- أعد تشغيل خادم التطوير: `Ctrl+C` ثم `npm run dev`

### المشكلة: "relation does not exist"
- تأكد من تنفيذ `supabase-setup.sql` بالكامل
- اذهب إلى **Table Editor** في Supabase وتحقق من وجود الجداول

---

## 📞 الحصول على المساعدة

إذا احتجت مساعدة في أي خطوة:
1. أخبرني في أي خطوة أنت
2. انسخ الرسائل التي تراها (إن وجدت)
3. سأساعدك في حل المشكلة

**حظاً موفقاً!** 🚀
