# قائمة التحقق من الاختبارات - Testing Checklist

## ✅ بعد تنفيذ جميع Migrations

### 1. التحقق من الجداول الجديدة

```sql
-- التحقق من وجود audit_logs
SELECT COUNT(*) FROM audit_logs;

-- التحقق من وجود material_reservations
SELECT COUNT(*) FROM material_reservations;

-- التحقق من وجود security_audit_reports
SELECT COUNT(*) FROM security_audit_reports;
```

**النتيجة المتوقعة:** ✅ جميع الجداول موجودة (حتى لو كانت فارغة)

---

### 2. التحقق من RLS Policies

```sql
-- التحقق من تفعيل RLS على الجداول الجديدة
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('audit_logs', 'material_reservations')
AND schemaname = 'public';

-- التحقق من وجود Policies
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('audit_logs', 'material_reservations')
ORDER BY tablename, cmd;
```

**النتيجة المتوقعة:** ✅ RLS مفعل و Policies موجودة

---

### 3. التحقق من الدوال المساعدة

```sql
-- التحقق من وجود الدوال
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN (
    'auth_org_id',
    'is_super_admin',
    'get_available_quantity',
    'check_materials_availability',
    'release_expired_reservations',
    'create_mo_with_reservation',
    'consume_materials_for_mo'
)
ORDER BY routine_name;
```

**النتيجة المتوقعة:** ✅ جميع الدوال موجودة

---

### 4. اختبار Audit Logging

#### أ. اختبار إنشاء سجل Audit

```typescript
// في console المتصفح أو component
import { auditLogger } from '@/lib/audit/AuditLogger';

// اختبار تسجيل حدث
await auditLogger.log({
  action: 'test',
  entity_type: 'user',
  entity_id: 'test-id',
  metadata: { test: true }
});
```

#### ب. التحقق في قاعدة البيانات

```sql
SELECT * FROM audit_logs 
WHERE entity_type = 'user' 
AND action = 'test'
ORDER BY created_at DESC 
LIMIT 1;
```

**النتيجة المتوقعة:** ✅ سجل تم إنشاؤه بنجاح

---

### 5. اختبار Material Reservation

#### أ. اختبار التحقق من التوفر

```typescript
import { inventoryTransactionService } from '@/services/inventory-transaction-service';

// اختبار (يحتاج item_id حقيقي)
const availability = await inventoryTransactionService.checkAvailability([
  { item_id: 'your-item-id', quantity: 10, unit_cost: 5 }
]);

console.log(availability);
```

#### ب. اختبار في قاعدة البيانات

```sql
-- اختبار دالة get_available_quantity
SELECT get_available_quantity(
    'your-org-id'::UUID,
    'your-item-id'::UUID,
    NULL
);
```

**النتيجة المتوقعة:** ✅ الدالة تعمل وتُرجع قيمة

---

### 6. اختبار Error Handling

```typescript
// في console
import ErrorHandler from '@/lib/errors/ErrorHandler';
import { ValidationError } from '@/lib/errors';

// اختبار معالجة خطأ
try {
  throw new ValidationError('Test error', [
    { field: 'test', message: 'Test message' }
  ]);
} catch (error) {
  ErrorHandler.handle(error);
}
```

**النتيجة المتوقعة:** ✅ يتم عرض toast notification

---

### 7. اختبار Tenant Isolation

```typescript
// في console
import { getTenantClient } from '@/lib/tenant-client';

const client = getTenantClient();
const query = await client.from('manufacturing_orders');
const { data, error } = await query.select('*').limit(5);

console.log('Data:', data);
console.log('All have same org_id?', 
  data?.every((r: any) => r.org_id === data[0]?.org_id)
);
```

**النتيجة المتوقعة:** ✅ جميع السجلات لها نفس org_id

---

### 8. اختبار TypeScript Compilation

```bash
npm run type-check
```

**النتيجة المتوقعة:** ✅ لا توجد أخطاء TypeScript

---

### 9. اختبار Unit Tests

```bash
npm run test:unit
```

**النتيجة المتوقعة:** ✅ جميع الاختبارات تمر (أو على الأقل لا توجد أخطاء syntax)

---

### 10. اختبار Security Tests

```bash
npm run test:security
```

**النتيجة المتوقعة:** ✅ الاختبارات تعمل (قد تحتاج إعداد test database)

---

## قائمة التحقق النهائية

### Database ✅
- [ ] جميع الجداول الجديدة موجودة
- [ ] جميع الدوال موجودة
- [ ] RLS policies مفعلة
- [ ] Indexes موجودة

### TypeScript ✅
- [ ] لا توجد أخطاء compilation
- [ ] جميع الوحدات يمكن استيرادها
- [ ] Types صحيحة

### Functionality ✅
- [ ] Audit logging يعمل
- [ ] Material reservation functions تعمل
- [ ] Error handling يعمل
- [ ] Tenant isolation يعمل

### Documentation ✅
- [ ] جميع ملفات Documentation موجودة
- [ ] Implementation Guide موجود
- [ ] Quick Start Guide موجود

---

## الخطوات التالية

بعد التحقق من كل شيء:

1. **اختبار في Staging:** نشر في بيئة staging
2. **اختبار End-to-End:** اختبار سيناريوهات كاملة
3. **Performance Testing:** اختبار الأداء
4. **Security Review:** مراجعة أمنية نهائية
5. **Production Deployment:** نشر في production

---

## ملاحظات

- بعض الاختبارات تحتاج بيانات حقيقية في قاعدة البيانات
- بعض الاختبارات تحتاج إعداد test environment
- راجع `docs/IMPLEMENTATION_GUIDE.md` للتفاصيل الكاملة

