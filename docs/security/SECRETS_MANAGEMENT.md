# إدارة الأسرار (Secrets Management)

## ⚠️ تحذير أمني مهم

تم إزالة جميع الأسرار المكشوفة (hardcoded secrets) من الكود المصدري. يجب استخدام متغيرات البيئة (environment variables) فقط.

## الإجراءات المطلوبة

### 1. إلغاء JWT Token المكشوف

**⚠️ عاجل:** يجب إلغاء JWT token الذي تم كشفه في الكود:

1. افتح Supabase Dashboard: https://app.supabase.com
2. اذهب إلى: Project Settings → API
3. ابحث عن "anon" أو "public" key
4. انقر على "Revoke" أو "Reset" لإلغاء المفتاح القديم
5. قم بإنشاء مفتاح جديد

### 2. إعداد متغيرات البيئة

#### للتنمية المحلية (Local Development)

1. انسخ ملف `.env.example` إلى `.env`:
   ```bash
   cp .env.example .env
   ```

2. افتح ملف `.env` واملأ القيم:
   ```env
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-new-anon-key-here
   ```

3. احصل على القيم من Supabase Dashboard:
   - Project Settings → API
   - انسخ "Project URL" و "anon/public" key

#### للإنتاج (Production)

**⚠️ مهم جداً:** في الإنتاج، يجب استخدام متغيرات البيئة فقط:

- **Vercel/Netlify:** أضف المتغيرات في Dashboard → Settings → Environment Variables
- **Docker:** استخدم `-e` flags أو ملف `.env`
- **CI/CD:** استخدم secrets management في منصة CI/CD

### 3. التحقق من الأمان

- ✅ لا توجد أسرار في الكود المصدري
- ✅ ملف `.env` موجود في `.gitignore`
- ✅ `config.json` لا يحتوي على أسرار حقيقية
- ✅ جميع الأسرار تستخدم متغيرات البيئة فقط

## الملفات المعدلة

1. **src/lib/supabase.ts**
   - تم إزالة جميع الـ hardcoded secrets
   - يعتمد الآن على `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` فقط

2. **public/config.json**
   - تم إزالة الأسرار المكشوفة
   - تم إضافة تحذيرات أمنية

3. **.env.example**
   - ملف مثال يحتوي على المتغيرات المطلوبة
   - يمكن نسخه إلى `.env` وملء القيم

## أفضل الممارسات

1. **لا تكتب أسرار في الكود أبداً** - حتى للقيم الافتراضية
2. **استخدم secret vault** في الإنتاج (AWS Secrets Manager, HashiCorp Vault, etc.)
3. **راجع سجلات المصادقة** للتحقق من أي استخدام غير مقصود للمفتاح المكشوف
4. **استخدم مفتاح جديد** بعد إلغاء المفتاح القديم

## مراجع

- [Supabase Security Best Practices](https://supabase.com/docs/guides/platform/security)
- [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

