# دليل الـ Migrations القانوني — Wardah ERP

> **القاعدة**: عند بناء بيئة جديدة طبّق الملفات بالترتيب الرقمي.
> عند وجود نسخ متعددة لنفس الرقم، هذا الدليل يحدد **القانونية** منها.
> النسخ المتجاوزة تبقى في المستودع للتاريخ — لا تُحذف ولا تُطبَّق.

## الجوهر المطبَّق على قاعدة البيانات الحية ✅

| Migration | الغرض | الحالة |
|---|---|---|
| 66-69 | WIP fields + EUP متوسط مرجّح + Scrap + FIFO | ✅ مطبَّقة |
| 76 | القيد الذرّي `rpc_create_journal_entry` + بوابة الأحداث + `wardah_org_id` | ✅ مطبَّقة |
| 77 | زرع خرائط الأحداث المحاسبية | ✅ مطبَّقة |
| 78 | آلة حالات MO + الحجز الذرّي | ✅ مطبَّقة |
| 79 | فرض إقفال الفترات + إدارتها | ✅ مطبَّقة |
| 80 | تقرير تكلفة الإنتاج (EUP) | ✅ مطبَّقة |
| 81 | تسوية الدفاتر الفرعية مع GL | ✅ مطبَّقة |
| **82** | **أمني: إزالة execute_sql** | ⚠️ **بانتظار التطبيق** |
| **83** | **أمني: عزل المؤسسات RLS** (rollback جاهز في `sql/rollback/`) | ⚠️ **بانتظار التطبيق** |
| **84** | **قيد GL للاستلام (GRNI)** | ⚠️ **بانتظار التطبيق** |
| **85** | **إذن التسليم الذرّي + COGS** | ⚠️ **بانتظار التطبيق** |

## حسم النسخ المتعددة (القانونية بالخط العريض)

| الرقم | النسخ | القانونية |
|---|---|---|
| 12 | `12_create_default_journals` / `12_simple_journals` / 12a-12f | **12_create_default_journals** ثم **12f** للسياسات (لاحقاً استُبدلت 12f بـ **83**) — البقية سكربتات تشخيص لمرة واحدة |
| 14 | `14_backup_checklist` / `_auto_detect` / `_fixed` | **14_backup_checklist_fixed** |
| 15 | `15_process_costing_enhancement` / `_no_migration` | **15_process_costing_enhancement** — `_no_migration` بديل يدوي قديم |
| 65 | `65_fix_stage_costs_complete` / `_v2` | **65_fix_stage_costs_complete_v2** |
| warehouse | `warehouse_accounting_integration` / `_fixed` / `_manual` | **warehouse_accounting_fixed** |
| warehouse mgmt | `warehouse_management_system` / `_fixed` | **warehouse_management_system_fixed** |
| غير مرقّمة | `phase2_stock_ledger_system`, `phase3_valuation_methods`, `migration_add_warehouse_to_goods_receipts`, `fix_view_org_id_error` | تُطبَّق بعد 30 وقبل 50 (نظام المستودعات) — مطبَّقة تاريخياً |

## ملاحظات معمارية مهمة

1. **ثلاثة مخططات GL تاريخية**: `gl_entries/gl_entry_lines` (القانوني — يكتب عبر
   `rpc_create_journal_entry` فقط منذ P4-B2)، و`journal_entries/journal_entry_lines`
   (يستخدمه stock-adjustment-service فقط — موثَّق، توحيده مؤجل).
2. **rollback scripts**: تحت `sql/rollback/` — حالياً `83_rollback_org_scoped_rls.sql`.
3. **أرقام جديدة**: التالي هو **86**. أي migration جديدة = ملف جديد مرقّم + سطر هنا.
