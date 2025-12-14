# Multi-Tenant Security - شعارات المؤسسات
## Organization Logos Storage Security

تاريخ: 13 ديسمبر 2025

---

## 🔒 آلية العزل (Isolation Mechanism)

تم تصميم نظام رفع الشعارات بأمان كامل لمنع التداخل بين المؤسسات:

### 1. هيكل المجلدات (Folder Structure)

```
organization-logos/
├── {org_id_1}/
│   ├── logo-1234567890.png
│   └── logo-1234567891.jpg
├── {org_id_2}/
│   ├── logo-1234567892.png
│   └── logo-1234567893.webp
└── {org_id_3}/
    └── logo-1234567894.svg
```

**كل مؤسسة لها مجلد منفصل باسم `org_id` الخاص بها**

### 2. الكود في `organization.ts`

```typescript
// السطر 190
const fileName = `${orgId}/logo-${Date.now()}.${fileExt}`;
//                 ^^^^^^ 
//                 معرف المؤسسة - يضمن العزل التام
```

### 3. سياسات الأمان (RLS Policies)

#### ✅ سياسة الرفع (INSERT)
```sql
WITH CHECK (
    bucket_id = 'organization-logos'
    AND (storage.foldername(name))[1] IN (
        SELECT org_id::TEXT 
        FROM user_organizations 
        WHERE user_id = auth.uid() 
          AND is_active = true
          AND role IN ('admin', 'manager')
    )
)
```

**ما تفعله هذه السياسة:**
1. تتحقق أن المستخدم مسجل الدخول
2. تستخرج `org_id` من اسم الملف (المجلد الأول)
3. تتحقق أن المستخدم ينتمي لهذه المؤسسة
4. تتحقق أن له صلاحية Admin أو Manager
5. ✅ **إذا حاول رفع ملف في مجلد مؤسسة أخرى → رفض تلقائي**

#### ✅ سياسة التحديث (UPDATE)
نفس المنطق - لا يمكن تحديث إلا ملفات المؤسسة الخاصة به

#### ✅ سياسة الحذف (DELETE)
نفس المنطق - لا يمكن حذف إلا ملفات المؤسسة الخاصة به

#### ✅ سياسة القراءة (SELECT)
```sql
USING (bucket_id = 'organization-logos')
```
عامة - الجميع يمكنه رؤية الشعارات (لأنها public)

---

## 🛡️ سيناريوهات الحماية

### ❌ سيناريو هجوم 1: محاولة رفع ملف في مجلد مؤسسة أخرى

```typescript
// مستخدم من org_id = "abc123"
// يحاول رفع ملف باسم: "xyz456/logo.png"

const fileName = "xyz456/logo.png"; // ❌ سيفشل
await supabase.storage.from('organization-logos').upload(fileName, file);

// النتيجة: Permission denied
// السبب: (storage.foldername(name))[1] = "xyz456"
//        لكن المستخدم ينتمي لـ "abc123" فقط
```

### ❌ سيناريو هجوم 2: محاولة حذف شعار مؤسسة أخرى

```typescript
// مستخدم من org_id = "abc123"
// يحاول حذف: "xyz456/logo.png"

await supabase.storage
  .from('organization-logos')
  .remove(['xyz456/logo.png']); // ❌ سيفشل

// النتيجة: Permission denied
```

### ✅ سيناريو صحيح: رفع شعار للمؤسسة الخاصة

```typescript
// مستخدم من org_id = "abc123"
const orgId = await getEffectiveTenantId(); // = "abc123"
const fileName = `${orgId}/logo-${Date.now()}.png`; // = "abc123/logo-xxx.png"

await supabase.storage
  .from('organization-logos')
  .upload(fileName, file); // ✅ نجح

// السبب: المجلد يطابق org_id المستخدم
```

---

## 📋 Checklist للتحقق من الأمان

- [x] كل ملف يُحفظ في مجلد `{org_id}/`
- [x] RLS Policies تتحقق من `storage.foldername(name)[1]`
- [x] الصلاحيات محصورة في `admin` و `manager`
- [x] `getEffectiveTenantId()` تُستخدم في كل عملية
- [x] لا يوجد hardcoded org_id في أي مكان
- [x] الكود في `organization.ts` يستخدم `orgId` من Context
- [x] `OrganizationSelector` يعرض الشعار من `organization.logo_url`

---

## 🔍 كيفية التحقق من العزل

### 1. من Supabase Dashboard

```sql
-- اعرض جميع الملفات مع المجلدات
SELECT 
    name,
    (storage.foldername(name))[1] as org_folder,
    bucket_id,
    owner
FROM storage.objects
WHERE bucket_id = 'organization-logos'
ORDER BY created_at DESC;
```

### 2. من Application

```typescript
// في Console
const { data } = await supabase.storage
  .from('organization-logos')
  .list('', { limit: 100 });

console.log(data); // ستجد مجلدات بأسماء org_id فقط
```

---

## ⚠️ تحذيرات مهمة

1. **لا تُخزن الملفات في الجذر**
   ```typescript
   // ❌ خطأ
   const fileName = `logo.png`;
   
   // ✅ صحيح
   const fileName = `${orgId}/logo.png`;
   ```

2. **لا تستخدم org_id يدوياً**
   ```typescript
   // ❌ خطأ
   const orgId = "00000000-0000-0000-0000-000000000001";
   
   // ✅ صحيح
   const orgId = await getEffectiveTenantId();
   ```

3. **تحقق من الـ Policies بعد التطبيق**
   ```sql
   -- في Supabase SQL Editor
   SELECT * FROM storage.policies 
   WHERE bucket_id = 'organization-logos';
   ```

---

## 📝 ملفات ذات علاقة

1. **Backend:**
   - `src/lib/organization.ts` - دوال رفع/حذف الشعار
   - `src/lib/supabase.ts` - `getEffectiveTenantId()`

2. **Frontend:**
   - `src/components/organization-selector.tsx` - عرض الشعار
   - `src/features/settings/CompanySettings.tsx` - رفع الشعار

3. **Database:**
   - `sql/migrations/70_organization_profile_enhancement.sql` - حقل `logo_url`
   - `sql/migrations/71_create_organization_logos_bucket.sql` - Storage + Policies

---

## 🎯 النتيجة النهائية

✅ **عزل كامل بين المؤسسات**
✅ **لا يمكن لمستخدم رؤية/تعديل/حذف ملفات مؤسسة أخرى**
✅ **الشعارات عامة للقراءة فقط**
✅ **الصلاحيات محصورة في الإداريين**

---

تم التوثيق بواسطة: مجاهد
التاريخ: 13 ديسمبر 2025

