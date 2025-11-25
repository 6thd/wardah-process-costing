-- sql/migrations/53_seed_permissions_data.sql
-- بسم الله الرحمن الرحيم
-- إضافة بيانات الصلاحيات والموديولات الأولية

-- =====================================
-- 1. إضافة/تحديث الموديولات
-- =====================================

INSERT INTO modules (name, name_ar, description, description_ar, icon, display_order, is_active)
VALUES 
  ('dashboard', 'لوحة التحكم', 'Main dashboard and overview', 'لوحة التحكم الرئيسية والنظرة العامة', '📊', 1, true),
  ('manufacturing', 'التصنيع', 'Manufacturing orders and process costing', 'أوامر التصنيع وتكلفة المراحل', '🏭', 2, true),
  ('inventory', 'المخزون', 'Inventory management and stock control', 'إدارة المخزون والتحكم بالمخزون', '📦', 3, true),
  ('purchasing', 'المشتريات', 'Purchase orders and supplier management', 'أوامر الشراء وإدارة الموردين', '🛒', 4, true),
  ('sales', 'المبيعات', 'Sales orders and customer management', 'أوامر البيع وإدارة العملاء', '📈', 5, true),
  ('accounting', 'المحاسبة', 'Journal entries and financial reports', 'قيود اليومية والتقارير المالية', '🧮', 6, true),
  ('general_ledger', 'الأستاذ العام', 'Chart of accounts and ledger', 'شجرة الحسابات والأستاذ', '📒', 7, true),
  ('hr', 'الموارد البشرية', 'Employee and payroll management', 'إدارة الموظفين والرواتب', '👥', 8, true),
  ('reports', 'التقارير', 'Financial and operational reports', 'التقارير المالية والتشغيلية', '📊', 9, true),
  ('settings', 'الإعدادات', 'System settings and configuration', 'إعدادات النظام والتكوين', '⚙️', 10, true),
  ('org_admin', 'إدارة المنظمة', 'User and role management', 'إدارة المستخدمين والأدوار', '🏢', 11, true),
  ('super_admin', 'مدير النظام', 'Platform administration', 'إدارة المنصة', '🛡️', 12, true)
ON CONFLICT (name) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  description = EXCLUDED.description,
  description_ar = EXCLUDED.description_ar,
  icon = EXCLUDED.icon,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active;

-- =====================================
-- 2. إضافة الصلاحيات لكل موديول
-- =====================================

DO $$
DECLARE
  module_row RECORD;
  actions TEXT[] := ARRAY['view', 'create', 'edit', 'delete', 'approve', 'export', 'import', 'print'];
  action_names TEXT[] := ARRAY['View', 'Create', 'Edit', 'Delete', 'Approve', 'Export', 'Import', 'Print'];
  action_names_ar TEXT[] := ARRAY['عرض', 'إنشاء', 'تعديل', 'حذف', 'اعتماد', 'تصدير', 'استيراد', 'طباعة'];
  i INTEGER;
BEGIN
  FOR module_row IN SELECT id, name, name_ar FROM modules LOOP
    FOR i IN 1..array_length(actions, 1) LOOP
      INSERT INTO permissions (
        module_id, 
        resource,
        resource_ar,
        action, 
        action_ar,
        permission_key,
        description, 
        description_ar
      )
      VALUES (
        module_row.id,
        module_row.name,
        module_row.name_ar,
        actions[i],
        action_names_ar[i],
        module_row.name || '.' || module_row.name || '.' || actions[i],
        'Permission to ' || lower(action_names[i]) || ' in ' || module_row.name,
        'صلاحية ' || action_names_ar[i] || ' في ' || module_row.name_ar
      )
      ON CONFLICT (permission_key) DO UPDATE SET
        resource = EXCLUDED.resource,
        resource_ar = EXCLUDED.resource_ar,
        action_ar = EXCLUDED.action_ar,
        description = EXCLUDED.description,
        description_ar = EXCLUDED.description_ar;
    END LOOP;
  END LOOP;
END $$;

-- =====================================
-- 3. إضافة قوالب الأدوار الجاهزة
-- =====================================

INSERT INTO role_templates (
  name, 
  name_ar, 
  description, 
  description_ar, 
  permission_keys,
  category,
  is_active
)
VALUES 
  (
    'Full Access',
    'وصول كامل',
    'Full access to all modules and features',
    'وصول كامل لجميع الموديولات والميزات',
    ARRAY['*.*.*'],
    'admin',
    true
  ),
  (
    'Accountant',
    'محاسب',
    'Access to accounting and financial modules',
    'وصول لموديولات المحاسبة والمالية',
    ARRAY['accounting.accounting.view', 'accounting.accounting.create', 'accounting.accounting.edit', 'general_ledger.general_ledger.view', 'reports.reports.view'],
    'finance',
    true
  ),
  (
    'Sales Manager',
    'مدير مبيعات',
    'Full access to sales module',
    'وصول كامل لموديول المبيعات',
    ARRAY['sales.sales.view', 'sales.sales.create', 'sales.sales.edit', 'sales.sales.delete', 'sales.sales.approve', 'inventory.inventory.view', 'reports.reports.view'],
    'sales',
    true
  ),
  (
    'Purchasing Manager',
    'مدير مشتريات',
    'Full access to purchasing module',
    'وصول كامل لموديول المشتريات',
    ARRAY['purchasing.purchasing.view', 'purchasing.purchasing.create', 'purchasing.purchasing.edit', 'purchasing.purchasing.delete', 'purchasing.purchasing.approve', 'inventory.inventory.view', 'reports.reports.view'],
    'purchasing',
    true
  ),
  (
    'Inventory Manager',
    'مدير مخزون',
    'Full access to inventory module',
    'وصول كامل لموديول المخزون',
    ARRAY['inventory.inventory.view', 'inventory.inventory.create', 'inventory.inventory.edit', 'inventory.inventory.delete', 'reports.reports.view'],
    'inventory',
    true
  ),
  (
    'Production Manager',
    'مدير إنتاج',
    'Full access to manufacturing module',
    'وصول كامل لموديول التصنيع',
    ARRAY['manufacturing.manufacturing.view', 'manufacturing.manufacturing.create', 'manufacturing.manufacturing.edit', 'manufacturing.manufacturing.delete', 'manufacturing.manufacturing.approve', 'inventory.inventory.view', 'reports.reports.view'],
    'manufacturing',
    true
  ),
  (
    'HR Manager',
    'مدير موارد بشرية',
    'Full access to HR module',
    'وصول كامل لموديول الموارد البشرية',
    ARRAY['hr.hr.view', 'hr.hr.create', 'hr.hr.edit', 'hr.hr.delete', 'hr.hr.approve', 'reports.reports.view'],
    'hr',
    true
  ),
  (
    'Viewer Only',
    'مشاهد فقط',
    'View-only access to all modules',
    'وصول للعرض فقط لجميع الموديولات',
    ARRAY['dashboard.dashboard.view', 'manufacturing.manufacturing.view', 'inventory.inventory.view', 'sales.sales.view', 'purchasing.purchasing.view', 'reports.reports.view'],
    'viewer',
    true
  ),
  (
    'Data Entry',
    'إدخال بيانات',
    'Basic data entry access',
    'وصول أساسي لإدخال البيانات',
    ARRAY['inventory.inventory.view', 'inventory.inventory.create', 'sales.sales.view', 'sales.sales.create', 'purchasing.purchasing.view', 'purchasing.purchasing.create'],
    'data_entry',
    true
  )
ON CONFLICT (name) DO NOTHING;

-- =====================================
-- 4. التحقق من النتائج
-- =====================================

DO $$
DECLARE
  modules_count INTEGER;
  permissions_count INTEGER;
  templates_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO modules_count FROM modules;
  SELECT COUNT(*) INTO permissions_count FROM permissions;
  SELECT COUNT(*) INTO templates_count FROM role_templates;
  
  RAISE NOTICE '✅ تم إضافة البيانات بنجاح:';
  RAISE NOTICE '   - الموديولات: %', modules_count;
  RAISE NOTICE '   - الصلاحيات: %', permissions_count;
  RAISE NOTICE '   - قوالب الأدوار: %', templates_count;
END $$;
