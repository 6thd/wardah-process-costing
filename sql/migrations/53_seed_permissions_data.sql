-- sql/migrations/53_seed_permissions_data.sql
-- بسم الله الرحمن الرحيم
-- إضافة بيانات الصلاحيات والموديولات الأولية

-- =====================================
-- 1. إضافة الموديولات
-- =====================================

INSERT INTO modules (code, name, name_ar, description, description_ar, icon, sort_order, is_active)
VALUES 
  ('dashboard', 'Dashboard', 'لوحة التحكم', 'Main dashboard and overview', 'لوحة التحكم الرئيسية والنظرة العامة', 'LayoutDashboard', 1, true),
  ('manufacturing', 'Manufacturing', 'التصنيع', 'Manufacturing orders and process costing', 'أوامر التصنيع وتكلفة المراحل', 'Factory', 2, true),
  ('inventory', 'Inventory', 'المخزون', 'Inventory management and stock control', 'إدارة المخزون والتحكم بالمخزون', 'Package', 3, true),
  ('purchasing', 'Purchasing', 'المشتريات', 'Purchase orders and supplier management', 'أوامر الشراء وإدارة الموردين', 'ShoppingCart', 4, true),
  ('sales', 'Sales', 'المبيعات', 'Sales orders and customer management', 'أوامر البيع وإدارة العملاء', 'TrendingUp', 5, true),
  ('accounting', 'Accounting', 'المحاسبة', 'Journal entries and financial reports', 'قيود اليومية والتقارير المالية', 'Calculator', 6, true),
  ('general_ledger', 'General Ledger', 'الأستاذ العام', 'Chart of accounts and ledger', 'شجرة الحسابات والأستاذ', 'BookOpen', 7, true),
  ('hr', 'Human Resources', 'الموارد البشرية', 'Employee and payroll management', 'إدارة الموظفين والرواتب', 'Users', 8, true),
  ('reports', 'Reports', 'التقارير', 'Financial and operational reports', 'التقارير المالية والتشغيلية', 'BarChart3', 9, true),
  ('settings', 'Settings', 'الإعدادات', 'System settings and configuration', 'إعدادات النظام والتكوين', 'Settings', 10, true),
  ('org_admin', 'Organization Admin', 'إدارة المنظمة', 'User and role management', 'إدارة المستخدمين والأدوار', 'Building2', 11, true),
  ('super_admin', 'Super Admin', 'مدير النظام', 'Platform administration', 'إدارة المنصة', 'Shield', 12, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  name_ar = EXCLUDED.name_ar,
  description = EXCLUDED.description,
  description_ar = EXCLUDED.description_ar,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

-- =====================================
-- 2. إضافة الصلاحيات لكل موديول
-- =====================================

-- دالة مساعدة لإضافة صلاحيات موديول
DO $$
DECLARE
  module_row RECORD;
  actions TEXT[] := ARRAY['view', 'create', 'edit', 'delete', 'approve', 'export', 'import', 'print'];
  action_names TEXT[] := ARRAY['View', 'Create', 'Edit', 'Delete', 'Approve', 'Export', 'Import', 'Print'];
  action_names_ar TEXT[] := ARRAY['عرض', 'إنشاء', 'تعديل', 'حذف', 'اعتماد', 'تصدير', 'استيراد', 'طباعة'];
  i INTEGER;
BEGIN
  FOR module_row IN SELECT id, code, name, name_ar FROM modules LOOP
    FOR i IN 1..array_length(actions, 1) LOOP
      INSERT INTO permissions (
        module_id, 
        key, 
        name, 
        name_ar, 
        description, 
        description_ar, 
        action, 
        is_active
      )
      VALUES (
        module_row.id,
        module_row.code || ':' || actions[i],
        action_names[i] || ' ' || module_row.name,
        action_names_ar[i] || ' ' || module_row.name_ar,
        'Permission to ' || lower(action_names[i]) || ' in ' || module_row.name,
        'صلاحية ' || action_names_ar[i] || ' في ' || module_row.name_ar,
        actions[i],
        true
      )
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        name_ar = EXCLUDED.name_ar,
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
  permissions_config, 
  is_active
)
VALUES 
  (
    'Full Access',
    'وصول كامل',
    'Full access to all modules and features',
    'وصول كامل لجميع الموديولات والميزات',
    '{"modules": ["*"], "actions": ["*"]}',
    true
  ),
  (
    'Accountant',
    'محاسب',
    'Access to accounting and financial modules',
    'وصول لموديولات المحاسبة والمالية',
    '{"modules": ["accounting", "general_ledger", "reports"], "actions": ["view", "create", "edit", "export", "print"]}',
    true
  ),
  (
    'Sales Manager',
    'مدير مبيعات',
    'Full access to sales module',
    'وصول كامل لموديول المبيعات',
    '{"modules": ["sales", "inventory", "reports"], "actions": ["view", "create", "edit", "delete", "approve", "export", "print"]}',
    true
  ),
  (
    'Purchasing Manager',
    'مدير مشتريات',
    'Full access to purchasing module',
    'وصول كامل لموديول المشتريات',
    '{"modules": ["purchasing", "inventory", "reports"], "actions": ["view", "create", "edit", "delete", "approve", "export", "print"]}',
    true
  ),
  (
    'Inventory Manager',
    'مدير مخزون',
    'Full access to inventory module',
    'وصول كامل لموديول المخزون',
    '{"modules": ["inventory", "reports"], "actions": ["view", "create", "edit", "delete", "export", "print"]}',
    true
  ),
  (
    'Production Manager',
    'مدير إنتاج',
    'Full access to manufacturing module',
    'وصول كامل لموديول التصنيع',
    '{"modules": ["manufacturing", "inventory", "reports"], "actions": ["view", "create", "edit", "delete", "approve", "export", "print"]}',
    true
  ),
  (
    'HR Manager',
    'مدير موارد بشرية',
    'Full access to HR module',
    'وصول كامل لموديول الموارد البشرية',
    '{"modules": ["hr", "reports"], "actions": ["view", "create", "edit", "delete", "approve", "export", "print"]}',
    true
  ),
  (
    'Viewer Only',
    'مشاهد فقط',
    'View-only access to all modules',
    'وصول للعرض فقط لجميع الموديولات',
    '{"modules": ["*"], "actions": ["view"]}',
    true
  ),
  (
    'Data Entry',
    'إدخال بيانات',
    'Basic data entry access',
    'وصول أساسي لإدخال البيانات',
    '{"modules": ["inventory", "sales", "purchasing"], "actions": ["view", "create"]}',
    true
  )
ON CONFLICT (name) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  description = EXCLUDED.description,
  description_ar = EXCLUDED.description_ar,
  permissions_config = EXCLUDED.permissions_config;

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

