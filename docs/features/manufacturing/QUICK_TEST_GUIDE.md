# Quick Test Guide - دليل الاختبار السريع

## 🚀 ابدأ الاختبار الآن!

### الخطوة 1: إعداد بيانات الاختبار
```sql
-- شغّل هذا السكريبت في Supabase SQL Editor
-- File: sql/migrations/31_test_data_setup.sql
```

### الخطوة 2: ابدأ الاختبار

#### ✅ Test 1: Manufacturing Stages
- اذهب إلى: `/manufacturing/stages`
- تحقق: 5 مراحل تظهر

#### ✅ Test 2: Stage Costing Panel
- اذهب إلى: `/manufacturing/process-costing`
- اختر MO → Stage → Work Center
- اختبر: Apply Labor Time → Apply Overhead → Calculate

#### ✅ Test 3: Equivalent Units
- نفس الصفحة → تبويب "Equivalent Units"
- اختر Stage من Dropdown
- احسب Equivalent Units

#### ✅ Test 4: WIP Log
- اذهب إلى: `/manufacturing/wip-log`
- اختبر التصفية: MO, Stage, Date Range

#### ✅ Test 5: Standard Costs
- اذهب إلى: `/manufacturing/standard-costs`
- أنشئ تكلفة قياسية جديدة
- اختبر: Edit, Delete, Filter

---

## 📋 Checklist السريع

- [ ] Manufacturing Stages تظهر (5 مراحل)
- [ ] Stage Costing Panel - Dropdown يعمل
- [ ] Stage Costing Panel - Apply Labor Time يعمل
- [ ] Stage Costing Panel - Apply Overhead يعمل
- [ ] Stage Costing Panel - Calculate يعمل
- [ ] Equivalent Units - Dropdown يعمل
- [ ] Equivalent Units - Calculate يعمل
- [ ] WIP Log - الصفحة تفتح
- [ ] WIP Log - التصفية تعمل
- [ ] Standard Costs - الصفحة تفتح
- [ ] Standard Costs - Create يعمل
- [ ] Standard Costs - Edit يعمل
- [ ] Standard Costs - Delete يعمل

---

## 📖 للتفاصيل الكاملة:
راجع: `docs/features/manufacturing/PHASE1_TESTING_STEPS.md`

---

**جاهز للاختبار!** 🎉

