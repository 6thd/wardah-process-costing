# دليل التنفيذ - Implementation Guide

## نظرة عامة

هذا الدليل يوضح ترتيب تنفيذ الملفات والتحقق من نجاح كل خطوة.

---

## ترتيب التنفيذ

### المرحلة 0: Foundation & Security Audit

#### 1. Security Audit Scripts

**الملفات:**
- `sql/migrations/58_security_audit_report.sql`
- `scripts/security/test_rls_policies.sql`

**خطوات التنفيذ:**

```bash
# 1. تشغيل Security Audit Report
# في Supabase SQL Editor:
\i sql/migrations/58_security_audit_report.sql

# 2. مراجعة النتائج
SELECT * FROM security_audit_reports ORDER BY report_date DESC LIMIT 1;

# 3. تشغيل RLS Policies Test
\i scripts/security/test_rls_policies.sql
```

**التحقق من النجاح:**
- ✅ لا توجد جداول بدون RLS
- ✅ جميع الجداول لديها policies
- ✅ لا توجد تحذيرات حرجة

---

#### 2. Backup Strategy

**الملفات:**
- `scripts/backup/backup-database.sh`
- `scripts/backup/restore-database.sh`
- `scripts/backup/backup-config.json`

**خطوات التنفيذ:**

```bash
# 1. جعل السكربت قابل للتنفيذ
chmod +x scripts/backup/backup-database.sh
chmod +x scripts/backup/restore-database.sh

# 2. إعداد متغيرات البيئة
export SUPABASE_DB_URL="postgresql://user:password@host:port/database"
# أو
export SUPABASE_DB_HOST="your-host"
export SUPABASE_DB_NAME="your-database"
export SUPABASE_DB_USER="your-user"
export SUPABASE_DB_PASSWORD="your-password"

# 3. اختبار Backup
./scripts/backup/backup-database.sh

# 4. التحقق من وجود الملف
ls -lh backups/
```

**التحقق من النجاح:**
- ✅ ملف backup تم إنشاؤه
- ✅ حجم الملف معقول (> 0 bytes)
- ✅ ملف metadata موجود

---

#### 3. Environment Validation

**الملفات:**
- `scripts/env/validate-env.ts`

**خطوات التنفيذ:**

```bash
# 1. تثبيت tsx إذا لم يكن مثبتاً
npm install -D tsx

# 2. التحقق من Environment
npm run validate-env
```

**التحقق من النجاح:**
- ✅ جميع المتغيرات المطلوبة موجودة
- ✅ لا توجد أخطاء في التحقق
- ✅ قد توجد تحذيرات (غير حرجة)

---

### المرحلة 1: Core Security & Audit Logging

#### 4. RLS Policy Fixes

**الملفات:**
- `sql/migrations/59_fix_rls_policies.sql`

**خطوات التنفيذ:**

```sql
-- في Supabase SQL Editor:
\i sql/migrations/59_fix_rls_policies.sql
```

**التحقق من النجاح:**
- ✅ لا توجد أخطاء في التنفيذ
- ✅ جميع الجداول لديها policies
- ✅ رسائل "✓" لكل جدول

---

#### 5. Audit Logs Table

**الملفات:**
- `sql/migrations/60_create_audit_logs_table.sql`

**خطوات التنفيذ:**

```sql
-- في Supabase SQL Editor:
\i sql/migrations/60_create_audit_logs_table.sql
```

**التحقق من النجاح:**

```sql
-- التحقق من وجود الجدول
SELECT * FROM audit_logs LIMIT 1;

-- التحقق من RLS
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'audit_logs';
```

---

#### 6. Tenant-Aware Client

**الملفات:**
- `src/lib/tenant-client.ts`
- `src/lib/tenant-validator.ts`

**خطوات التنفيذ:**

```bash
# 1. التحقق من عدم وجود أخطاء TypeScript
npm run type-check

# 2. اختبار الاستيراد
# في ملف test:
import { getTenantClient } from '@/lib/tenant-client';
```

**التحقق من النجاح:**
- ✅ لا توجد أخطاء TypeScript
- ✅ يمكن استيراد الوحدات بنجاح

---

### المرحلة 2: Error Handling & Transactions

#### 7. Error Classes

**الملفات:**
- `src/lib/errors/*.ts`

**خطوات التنفيذ:**

```bash
# التحقق من عدم وجود أخطاء
npm run type-check
```

**التحقق من النجاح:**

```typescript
// اختبار في console:
import { AppError, ValidationError } from '@/lib/errors';

const error = new ValidationError('Test', []);
console.log(error.code); // Should be 'VALIDATION_ERROR'
```

---

#### 8. Transaction Helpers

**الملفات:**
- `sql/functions/transaction_helpers.sql`

**خطوات التنفيذ:**

```sql
-- في Supabase SQL Editor:
\i sql/functions/transaction_helpers.sql
```

**التحقق من النجاح:**

```sql
-- التحقق من وجود الدوال
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
  'create_mo_with_reservation',
  'consume_materials_for_mo'
);
```

---

### المرحلة 3: Manufacturing-Inventory Integration

#### 9. Material Reservations Table

**الملفات:**
- `sql/migrations/61_add_material_reservations.sql`

**خطوات التنفيذ:**

```sql
-- في Supabase SQL Editor:
\i sql/migrations/61_add_material_reservations.sql
```

**التحقق من النجاح:**

```sql
-- التحقق من وجود الجدول
SELECT * FROM material_reservations LIMIT 1;

-- التحقق من الدوال المساعدة
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name LIKE 'get_available_quantity%'
   OR routine_name LIKE 'check_materials_availability%';
```

---

#### 10. Data Validation Scripts

**الملفات:**
- `sql/scripts/validate-data-integrity.sql`

**خطوات التنفيذ:**

```sql
-- في Supabase SQL Editor:
\i sql/scripts/validate-data-integrity.sql
```

**التحقق من النجاح:**

```sql
-- اختبار الدوال
SELECT * FROM validate_stock_balance('your-org-id');
SELECT * FROM validate_reservations('your-org-id');
```

---

## اختبار شامل بعد التنفيذ

### 1. اختبار Security

```bash
# تشغيل Security Tests
npm run test:security
```

**النتائج المتوقعة:**
- ✅ جميع الاختبارات تمر
- ✅ لا توجد ثغرات أمنية

---

### 2. اختبار Error Handling

```typescript
// في console المتصفح:
import ErrorHandler from '@/lib/errors/ErrorHandler';
import { ValidationError } from '@/lib/errors';

// اختبار معالجة خطأ
try {
  throw new ValidationError('Test error', []);
} catch (error) {
  ErrorHandler.handle(error);
}
```

**النتائج المتوقعة:**
- ✅ يتم عرض toast notification
- ✅ لا توجد أخطاء في console

---

### 3. اختبار Material Reservation

```typescript
// في console أو component:
import { inventoryTransactionService } from '@/services/inventory-transaction-service';

// اختبار التحقق من التوفر
const availability = await inventoryTransactionService.checkAvailability([
  { item_id: 'test-item-id', quantity: 10 }
]);

console.log(availability);
```

**النتائج المتوقعة:**
- ✅ يتم إرجاع نتائج التحقق
- ✅ لا توجد أخطاء

---

### 4. اختبار Audit Logging

```typescript
// في console:
import { auditLogger } from '@/lib/audit/AuditLogger';

// اختبار تسجيل حدث
await auditLogger.log({
  action: 'test',
  entity_type: 'user',
  entity_id: 'test-id',
});
```

**التحقق:**

```sql
-- في Supabase SQL Editor:
SELECT * FROM audit_logs 
WHERE entity_type = 'user' 
ORDER BY created_at DESC 
LIMIT 1;
```

**النتائج المتوقعة:**
- ✅ يتم إنشاء سجل في audit_logs
- ✅ البيانات صحيحة

---

### 5. اختبار Tenant Isolation

```typescript
// في console:
import { getTenantClient } from '@/lib/tenant-client';

const client = getTenantClient();
const query = await client.from('manufacturing_orders');
const { data } = await query.select('*').limit(5);

// التحقق أن جميع السجلات تنتمي للـ tenant الحالي
console.log(data);
```

**النتائج المتوقعة:**
- ✅ جميع السجلات لها نفس org_id
- ✅ لا توجد سجلات من tenants أخرى

---

## قائمة التحقق النهائية

### Security ✅
- [ ] RLS policies مفعلة على جميع الجداول
- [ ] Security audit لا يظهر مشاكل
- [ ] Cross-tenant tests تمر

### Backup ✅
- [ ] Backup script يعمل
- [ ] Restore script يعمل
- [ ] Backup files يتم إنشاؤها

### Error Handling ✅
- [ ] Error classes تعمل
- [ ] Error Handler يعرض notifications
- [ ] Error Boundary يعمل

### Transactions ✅
- [ ] Transaction functions موجودة في DB
- [ ] Transaction wrapper يعمل

### Material Reservations ✅
- [ ] جدول material_reservations موجود
- [ ] Helper functions موجودة
- [ ] Service يعمل

### Audit Logging ✅
- [ ] جدول audit_logs موجود
- [ ] AuditLogger يعمل
- [ ] يمكن إنشاء سجلات

### Testing ✅
- [ ] Unit tests تمر
- [ ] Integration tests تمر
- [ ] Security tests تمر

---

## حل المشاكل الشائعة

### مشكلة: RLS Policy Error

**الحل:**
```sql
-- التحقق من وجود الدوال المساعدة
SELECT routine_name FROM information_schema.routines 
WHERE routine_name IN ('auth_org_id', 'is_super_admin');

-- إعادة إنشاء الدوال إذا لزم الأمر
\i sql/migrations/59_fix_rls_policies.sql
```

---

### مشكلة: Tenant ID Not Found

**الحل:**
```typescript
// التحقق من وجود user و org
import { getEffectiveTenantId } from '@/lib/supabase';

const tenantId = await getEffectiveTenantId();
console.log('Tenant ID:', tenantId);

// إذا كان null، تحقق من:
// 1. المستخدم مسجل دخول
// 2. المستخدم مرتبط بـ organization
```

---

### مشكلة: Migration Fails

**الحل:**
1. تحقق من وجود الجدول/الدالة مسبقاً
2. استخدم `IF NOT EXISTS` أو `CREATE OR REPLACE`
3. راجع رسائل الخطأ في Supabase SQL Editor

---

## الخطوات التالية

بعد إكمال جميع الخطوات:

1. **اختبار شامل:** تشغيل جميع الاختبارات
2. **مراجعة Documentation:** التأكد من تحديث جميع الوثائق
3. **Staging Deployment:** نشر في بيئة staging
4. **Production Deployment:** نشر في production بعد اختبار staging

---

## الدعم

إذا واجهت أي مشاكل:
1. راجع رسائل الخطأ بعناية
2. تحقق من logs في Supabase
3. راجع documentation في `docs/`
4. تحقق من أن جميع dependencies مثبتة

