# 🔄 حل مشكلة إيقاف Supabase التلقائي
# Keep Supabase Database Active - Setup Guide

## 📋 المشكلة
Supabase Free Tier توقف المشاريع غير النشطة بعد **7 أيام** من عدم الاستخدام.

## ✅ الحل المُطبّق
استخدام **GitHub Actions** لإرسال استعلامات حقيقية كل 5 أيام.

---

## 🚀 خطوات التفعيل

### 1️⃣ إضافة Secret في GitHub

1. اذهب إلى مستودع GitHub الخاص بك
2. اضغط على **Settings** (الإعدادات)
3. من القائمة الجانبية، اختر **Secrets and variables** → **Actions**
4. اضغط **New repository secret**
5. أدخل:
   - **Name**: `SUPABASE_ANON_KEY`
   - **Value**: المفتاح من Supabase (من ملف `.env` أو Dashboard)
6. اضغط **Add secret**

### 2️⃣ رفع الملفات إلى GitHub

```bash
git add .github/workflows/keep-supabase-alive.yml
git commit -m "Add Supabase keep-alive workflow"
git push
```

### 3️⃣ التحقق من التشغيل

1. اذهب إلى **Actions** في GitHub
2. يجب أن ترى workflow اسمه **Keep Supabase Database Active**
3. يمكنك تشغيله يدوياً بالضغط على **Run workflow**

---

## ⚙️ كيف يعمل؟

الـ workflow يرسل **3 استعلامات حقيقية** كل 5 أيام:

1. **فحص جدول Journals**
   ```sql
   SELECT count(*) FROM journals
   ```

2. **فحص جدول GL Accounts**
   ```sql
   SELECT count(*) FROM gl_accounts LIMIT 1
   ```

3. **تشغيل دالة ميزان المراجعة**
   ```sql
   SELECT rpc_get_trial_balance('00000000-0000-0000-0000-000000000001', '2025-12-31')
   ```

هذا يضمن أن قاعدة البيانات تتلقى **طلبات فعلية** وليس فقط زيارة للرابط.

---

## 📅 الجدول الزمني

```yaml
cron: '0 12 */5 * *'  # كل 5 أيام الساعة 12 ظهراً UTC
```

- **تكرار**: كل 5 أيام
- **التوقيت**: 12 ظهراً بتوقيت UTC (3 مساءً بتوقيت السعودية)

### تعديل التوقيت:
لتغيير التكرار، عدّل السطر في الملف:
- `*/5` = كل 5 أيام
- `*/3` = كل 3 أيام
- `*/7` = كل 7 أيام (الحد الأقصى الآمن)

---

## ✅ مميزات الحل

- ✅ **مجاني 100%** (GitHub Actions مجاني للمستودعات العامة والخاصة)
- ✅ **استعلامات حقيقية** تحافظ على نشاط القاعدة
- ✅ **تلقائي بالكامل** - لا يحتاج تدخل يدوي
- ✅ **يمكن تشغيله يدوياً** عند الحاجة
- ✅ **سجلات واضحة** لمتابعة التنفيذ

---

## 🔍 مراقبة الأداء

### لمشاهدة آخر تشغيل:
1. اذهب إلى **Actions** في GitHub
2. اختر **Keep Supabase Database Active**
3. شاهد السجلات (logs)

### رسائل النجاح المتوقعة:
```
✅ Database is active and responding!
✅ GL Accounts table is accessible!
✅ Trial balance function executed successfully!
🎉 Keep-Alive Job Completed Successfully!
```

---

## ⚠️ استكشاف الأخطاء

### خطأ 401 (Unauthorized):
- **السبب**: `SUPABASE_ANON_KEY` غير صحيح
- **الحل**: تحقق من المفتاح في GitHub Secrets

### خطأ 404 (Not Found):
- **السبب**: اسم الجدول أو الدالة غير صحيح
- **الحل**: تحقق من أسماء الجداول في Supabase

### لم يتم التشغيل تلقائياً:
- **السبب**: المستودع خاص وليس لديك GitHub Actions مفعّل
- **الحل**: تأكد أن Actions مفعّلة في إعدادات المستودع

---

## 📦 ملفات إضافية (اختياري)

### حل بديل: استخدام Vercel Cron (مجاني)

إذا كنت تستضيف التطبيق على Vercel، يمكنك استخدام:

```javascript
// /api/cron/keep-alive.js
export default async function handler(req, res) {
  const response = await fetch(
    'https://uutfztmqvajmsxnrqeiv.supabase.co/rest/v1/journals?select=count',
    {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY
      }
    }
  );
  
  return res.json({ status: response.status });
}
```

ثم أضف في `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/keep-alive",
    "schedule": "0 12 */5 * *"
  }]
}
```

---

## 🎯 الخلاصة

- ✅ **GitHub Actions مفعّل** - يشتغل تلقائياً كل 5 أيام
- ✅ **استعلامات حقيقية** - تحافظ على نشاط القاعدة
- ✅ **مجاني** - بدون تكلفة إضافية
- ✅ **موثوق** - مستخدم من آلاف المطورين

**قاعدة البيانات الآن محمية من الإيقاف التلقائي!** 🎉

---

## 📚 مراجع
- [Supabase Free Tier Limits](https://supabase.com/pricing)
- [GitHub Actions Cron Syntax](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)
- [Supabase REST API](https://supabase.com/docs/guides/api)
