# اختبار حقول الإدخال - Journal Entries

## المشكلة الحالية
حقول "المدين" و "الدائن" لا تقبل إدخال الأرقام

## السبب الجذري
الكود صحيح لكن المتصفح لا يحمّل النسخة الجديدة

## الحل المؤكد

### 1. **أغلق المتصفح تماماً**
   - أغلق جميع نوافذ Chrome/Edge
   - تأكد من إغلاق Process من Task Manager إذا لزم الأمر

### 2. **نظّف Cache**
```powershell
# في PowerShell:
Remove-Item -Path "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Cache\*" -Recurse -Force -ErrorAction SilentlyContinue
```

### 3. **افتح Incognito Mode**
- Chrome: `Ctrl + Shift + N`
- Edge: `Ctrl + Shift + P`
- Firefox: `Ctrl + Shift + P`

### 4. **اذهب للصفحة**
```
http://localhost:5173/accounting/journal-entries
```

### 5. **اختبر الحقول**
- اضغط "قيد جديد"
- اختر نوع قيد
- أضف بند
- اختر حساب
- **الحقول يجب أن تكون فارغة**
- اكتب رقم في المدين (مثلاً: 5000)
- **يجب أن يقبل الإدخال!**

## التحقق من الكود

افتح Developer Tools (`F12`) واكتب:

```javascript
// تحقق من أن الحقول موجودة
document.querySelectorAll('input[type="text"][inputmode="decimal"]').length
// يجب أن يرجع: 2 (حقلين: مدين ودائن)

// تحقق من القيم
document.querySelectorAll('input[type="text"][inputmode="decimal"]').forEach(i => console.log(i.value))
// يجب أن يرجع: "" و "" (قيم فارغة)
```

## الكود الصحيح الموجود حالياً

```tsx
<Input
  type="text"
  inputMode="decimal"
  value={line.debit || ''}
  onChange={(e) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      updateLine(index, 'debit', value);
      if (value && Number(value) > 0) {
        updateLine(index, 'credit', '');
      }
    }
  }}
  onFocus={(e) => e.target.select()}
  placeholder="0.00"
  className="text-right"
/>
```

## إذا لم يعمل بعد

1. **تأكد من الكود في المتصفح:**
   - F12 → Sources → src/features/accounting/journal-entries/index.tsx
   - ابحث عن `type="text"`
   - إذا وجدت `type="number"` → المتصفح لم يحدّث

2. **أعد تشغيل Vite:**
   ```powershell
   # أوقف السيرفر (Ctrl+C)
   npm run dev
   ```

3. **امسح node_modules/.vite:**
   ```powershell
   Remove-Item -Path "node_modules/.vite" -Recurse -Force
   npm run dev
   ```

## النتيجة المتوقعة

✅ الحقول فارغة عند فتح قيد جديد
✅ يمكن كتابة أي رقم (صحيح أو عشري)
✅ عند الكتابة في المدين، الدائن يصبح فارغاً تلقائياً
✅ لا توجد أخطاء في Console
✅ يمكن الحفظ والترحيل

---

**آخر تحديث:** 29 أكتوبر 2025
**الحالة:** الكود جاهز ✅ | Cache المتصفح يحتاج تنظيف ⚠️
