# نظام Multi-Tenant Authentication - وردة ERP

## نظرة عامة

تم تطوير نظام مصادقة متعدد المؤسسات (Multi-Tenant) احترافي يسمح بإدارة عدة منظمات في نفس التطبيق.

## الميزات الرئيسية

### 1. تسجيل حساب جديد (Sign Up) ✅

صفحة تسجيل حديثة مع خيارين:
- **الانضمام لمنظمة موجودة**: المستخدم يدخل رمز المنظمة للانضمام
- **إنشاء منظمة جديدة**: المستخدم يصبح Admin للمنظمة الجديدة

**المسار**: `/signup`

**الحقول المطلوبة**:
- الاسم الكامل
- البريد الإلكتروني
- كلمة المرور
- تأكيد كلمة المرور
- رمز المنظمة (للانضمام) أو بيانات المنظمة الجديدة (للإنشاء)

### 2. تسجيل الدخول المحسّن (Login) ✅

- إضافة رابط للتسجيل الجديد
- تحميل تلقائي لمنظمات المستخدم بعد تسجيل الدخول
- تخزين آخر منظمة مستخدمة في localStorage

**المسار**: `/login`

### 3. اختيار المنظمة (Organization Selector) ✅

مكون ذكي في الـ Header يسمح بـ:
- عرض المنظمة الحالية
- التبديل بين المنظمات (للمستخدمين المنتمين لأكثر من منظمة)
- إعادة تحميل الصفحة لتطبيق سياق المنظمة الجديدة

**الموقع**: Header (أعلى الصفحة)

### 4. إدارة السياق (AuthContext) ✅

تم تحديث `AuthContext` لدعم:
- `currentOrgId`: المنظمة الحالية
- `organizations`: قائمة منظمات المستخدم
- `setCurrentOrgId()`: تغيير المنظمة الحالية
- `refreshOrganizations()`: تحديث قائمة المنظمات

## البنية التقنية

### 1. الجداول الأساسية

```sql
-- جدول المنظمات
CREATE TABLE organizations (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    code VARCHAR(50) UNIQUE NOT NULL,
    settings JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- جدول ربط المستخدمين بالمنظمات
CREATE TABLE user_organizations (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL, -- References auth.users
    org_id UUID REFERENCES organizations(id),
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'manager', 'admin')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. الخدمات (Services)

**organization-service.ts**:
- `getOrganizationByCode()`: جلب منظمة برمزها
- `getUserOrganizations()`: جلب منظمات المستخدم
- `createOrganization()`: إنشاء منظمة جديدة
- `addUserToOrganization()`: إضافة مستخدم لمنظمة
- `checkUserOrgAccess()`: التحقق من صلاحية الوصول

### 3. المكونات (Components)

1. **SignUpPage** (`src/pages/signup.tsx`)
   - نموذج تسجيل شامل
   - دعم Tabs للتبديل بين وضعي الانضمام والإنشاء
   - التحقق من صحة البيانات

2. **OrganizationSelector** (`src/components/organization-selector.tsx`)
   - Dropdown menu للمنظمات
   - عرض دور المستخدم في كل منظمة
   - تخزين الاختيار في localStorage

3. **LoginPage** (`src/pages/login.tsx`)
   - إضافة رابط للتسجيل
   - تكامل مع AuthContext الجديد

## استخدام النظام

### للمطورين

#### 1. الحصول على المنظمة الحالية

```typescript
import { useAuth } from '@/contexts/AuthContext';

function MyComponent() {
  const { currentOrgId, organizations } = useAuth();
  
  // استخدام currentOrgId في الاستعلامات
  const { data } = useQuery({
    queryKey: ['data', currentOrgId],
    queryFn: () => fetchData(currentOrgId)
  });
}
```

#### 2. التحقق من صلاحيات المستخدم

```typescript
import { useAuth } from '@/contexts/AuthContext';

function AdminPanel() {
  const { organizations, currentOrgId } = useAuth();
  
  const currentUserOrg = organizations.find(
    uo => uo.org_id === currentOrgId
  );
  
  const isAdmin = currentUserOrg?.role === 'admin';
  
  if (!isAdmin) {
    return <div>غير مصرح لك بالوصول</div>;
  }
  
  // عرض لوحة الإدارة
}
```

#### 3. إنشاء منظمة برمجياً

```typescript
import { createOrganization } from '@/services/organization-service';

const result = await createOrganization({
  name: 'My Company',
  name_ar: 'شركتي',
  code: 'MYCO',
  userId: user.id
});

if (result.success) {
  console.log('Organization created:', result.organization);
}
```

### للمستخدمين النهائيين

#### 1. إنشاء حساب جديد

1. انتقل إلى `/signup`
2. اختر "إنشاء منظمة جديدة"
3. أدخل البيانات المطلوبة
4. سيتم إنشاء حسابك كمسؤول (Admin)

#### 2. الانضمام لمنظمة موجودة

1. انتقل إلى `/signup`
2. اختر "الانضمام لمنظمة"
3. أدخل رمز المنظمة (اطلبه من المسؤول)
4. أكمل بقية البيانات

#### 3. تبديل المنظمات

1. سجّل الدخول
2. ابحث عن "Organization Selector" في الـ Header
3. اختر المنظمة المطلوبة
4. ستُحدّث الصفحة تلقائياً

## أفضل الممارسات

### 1. RLS (Row Level Security)

تأكد من تطبيق RLS على كل الجداول:

```sql
-- مثال على policy
CREATE POLICY "Users can access their org data"
ON table_name
FOR ALL
USING (org_id = (SELECT current_setting('app.current_org_id')::UUID));
```

### 2. التحقق من الصلاحيات

دائماً تحقق من:
- المستخدم مسجل دخول
- له صلاحية الوصول للمنظمة
- دوره يسمح بالعملية المطلوبة

### 3. تخزين الـ org_id

عند إرسال البيانات للـ backend، تأكد من تضمين `org_id`:

```typescript
const { currentOrgId } = useAuth();

const newRecord = {
  ...data,
  org_id: currentOrgId
};
```

## الملفات المضافة/المعدلة

```
src/
  ├── services/
  │   └── organization-service.ts          ✅ جديد
  ├── pages/
  │   ├── signup.tsx                       ✅ جديد
  │   ├── login.tsx                        ✅ معدّل
  │   └── routes.tsx                       ✅ معدّل
  ├── components/
  │   ├── organization-selector.tsx        ✅ جديد
  │   └── layout/
  │       └── header.tsx                   ✅ معدّل
  └── contexts/
      └── AuthContext.tsx                  ✅ معدّل
```

## الخطوات القادمة (اختياري)

1. **إدارة المنظمات**: صفحة لإدارة إعدادات المنظمة
2. **دعوة المستخدمين**: نظام دعوات عبر البريد
3. **صلاحيات متقدمة**: RBAC كامل بدلاً من 3 أدوار فقط
4. **Audit Log**: تسجيل جميع العمليات حسب المنظمة
5. **تخصيص المنظمة**: شعار، ألوان، إعدادات خاصة

## الدعم

لأي استفسارات أو مشاكل، يرجى التواصل مع فريق التطوير.

---

**تاريخ الإنشاء**: نوفمبر 2025  
**الإصدار**: 2.0.0  
**الحالة**: ✅ جاهز للاستخدام

