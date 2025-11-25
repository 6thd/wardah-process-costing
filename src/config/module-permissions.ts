// src/config/module-permissions.ts
// بسم الله الرحمن الرحيم
// تعريف صلاحيات الموديولات

// =====================================
// أكواد الموديولات
// =====================================

export const MODULE_CODES = {
  DASHBOARD: 'dashboard',
  MANUFACTURING: 'manufacturing',
  INVENTORY: 'inventory',
  PURCHASING: 'purchasing',
  SALES: 'sales',
  ACCOUNTING: 'accounting',
  GENERAL_LEDGER: 'general_ledger',
  HR: 'hr',
  REPORTS: 'reports',
  SETTINGS: 'settings',
  ORG_ADMIN: 'org_admin',
  SUPER_ADMIN: 'super_admin',
} as const;

// =====================================
// أنواع الإجراءات
// =====================================

export const ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  DELETE: 'delete',
  APPROVE: 'approve',
  EXPORT: 'export',
  IMPORT: 'import',
  PRINT: 'print',
  MANAGE: 'manage',
} as const;

// =====================================
// تعريف صلاحيات كل موديول
// =====================================

export interface ModulePermissionConfig {
  code: string;
  name: string;
  nameAr: string;
  icon: string;
  path: string;
  requiredPermission?: {
    module: string;
    action: string;
  };
  requireOrgAdmin?: boolean;
  requireSuperAdmin?: boolean;
  subModules?: ModulePermissionConfig[];
}

export const MODULE_PERMISSIONS: ModulePermissionConfig[] = [
  {
    code: MODULE_CODES.DASHBOARD,
    name: 'Dashboard',
    nameAr: 'لوحة التحكم',
    icon: 'LayoutDashboard',
    path: '/dashboard',
    // الداشبورد متاح لجميع المستخدمين
  },
  {
    code: MODULE_CODES.MANUFACTURING,
    name: 'Manufacturing',
    nameAr: 'التصنيع',
    icon: 'Factory',
    path: '/manufacturing',
    requiredPermission: { module: MODULE_CODES.MANUFACTURING, action: ACTIONS.VIEW },
    subModules: [
      {
        code: 'manufacturing_orders',
        name: 'Manufacturing Orders',
        nameAr: 'أوامر التصنيع',
        icon: 'ClipboardList',
        path: '/manufacturing/orders',
        requiredPermission: { module: MODULE_CODES.MANUFACTURING, action: ACTIONS.VIEW },
      },
      {
        code: 'process_costing',
        name: 'Process Costing',
        nameAr: 'تكلفة المراحل',
        icon: 'Calculator',
        path: '/manufacturing/process-costing',
        requiredPermission: { module: MODULE_CODES.MANUFACTURING, action: ACTIONS.VIEW },
      },
      {
        code: 'bom',
        name: 'Bill of Materials',
        nameAr: 'قائمة المواد',
        icon: 'FileSpreadsheet',
        path: '/manufacturing/bom',
        requiredPermission: { module: MODULE_CODES.MANUFACTURING, action: ACTIONS.VIEW },
      },
    ],
  },
  {
    code: MODULE_CODES.INVENTORY,
    name: 'Inventory',
    nameAr: 'المخزون',
    icon: 'Package',
    path: '/inventory',
    requiredPermission: { module: MODULE_CODES.INVENTORY, action: ACTIONS.VIEW },
    subModules: [
      {
        code: 'inventory_items',
        name: 'Items',
        nameAr: 'الأصناف',
        icon: 'Box',
        path: '/inventory/items',
        requiredPermission: { module: MODULE_CODES.INVENTORY, action: ACTIONS.VIEW },
      },
      {
        code: 'inventory_movements',
        name: 'Movements',
        nameAr: 'الحركات',
        icon: 'ArrowLeftRight',
        path: '/inventory/movements',
        requiredPermission: { module: MODULE_CODES.INVENTORY, action: ACTIONS.VIEW },
      },
      {
        code: 'inventory_adjustments',
        name: 'Adjustments',
        nameAr: 'التسويات',
        icon: 'Settings2',
        path: '/inventory/adjustments',
        requiredPermission: { module: MODULE_CODES.INVENTORY, action: ACTIONS.EDIT },
      },
    ],
  },
  {
    code: MODULE_CODES.PURCHASING,
    name: 'Purchasing',
    nameAr: 'المشتريات',
    icon: 'ShoppingCart',
    path: '/purchasing',
    requiredPermission: { module: MODULE_CODES.PURCHASING, action: ACTIONS.VIEW },
    subModules: [
      {
        code: 'purchasing_suppliers',
        name: 'Suppliers',
        nameAr: 'الموردين',
        icon: 'Users',
        path: '/purchasing/suppliers',
        requiredPermission: { module: MODULE_CODES.PURCHASING, action: ACTIONS.VIEW },
      },
      {
        code: 'purchasing_orders',
        name: 'Purchase Orders',
        nameAr: 'أوامر الشراء',
        icon: 'FileText',
        path: '/purchasing/orders',
        requiredPermission: { module: MODULE_CODES.PURCHASING, action: ACTIONS.VIEW },
      },
      {
        code: 'purchasing_invoices',
        name: 'Invoices',
        nameAr: 'الفواتير',
        icon: 'Receipt',
        path: '/purchasing/invoices',
        requiredPermission: { module: MODULE_CODES.PURCHASING, action: ACTIONS.VIEW },
      },
      {
        code: 'purchasing_payments',
        name: 'Payments',
        nameAr: 'المدفوعات',
        icon: 'Wallet',
        path: '/purchasing/payments',
        requiredPermission: { module: MODULE_CODES.PURCHASING, action: ACTIONS.VIEW },
      },
    ],
  },
  {
    code: MODULE_CODES.SALES,
    name: 'Sales',
    nameAr: 'المبيعات',
    icon: 'TrendingUp',
    path: '/sales',
    requiredPermission: { module: MODULE_CODES.SALES, action: ACTIONS.VIEW },
    subModules: [
      {
        code: 'sales_customers',
        name: 'Customers',
        nameAr: 'العملاء',
        icon: 'Users',
        path: '/sales/customers',
        requiredPermission: { module: MODULE_CODES.SALES, action: ACTIONS.VIEW },
      },
      {
        code: 'sales_orders',
        name: 'Sales Orders',
        nameAr: 'أوامر البيع',
        icon: 'ClipboardList',
        path: '/sales/orders',
        requiredPermission: { module: MODULE_CODES.SALES, action: ACTIONS.VIEW },
      },
      {
        code: 'sales_invoices',
        name: 'Invoices',
        nameAr: 'الفواتير',
        icon: 'FileText',
        path: '/sales/invoices',
        requiredPermission: { module: MODULE_CODES.SALES, action: ACTIONS.VIEW },
      },
      {
        code: 'sales_collections',
        name: 'Collections',
        nameAr: 'التحصيلات',
        icon: 'Banknote',
        path: '/sales/collections',
        requiredPermission: { module: MODULE_CODES.SALES, action: ACTIONS.VIEW },
      },
    ],
  },
  {
    code: MODULE_CODES.ACCOUNTING,
    name: 'Accounting',
    nameAr: 'المحاسبة',
    icon: 'Calculator',
    path: '/accounting',
    requiredPermission: { module: MODULE_CODES.ACCOUNTING, action: ACTIONS.VIEW },
    subModules: [
      {
        code: 'journal_entries',
        name: 'Journal Entries',
        nameAr: 'قيود اليومية',
        icon: 'BookOpen',
        path: '/accounting/journal-entries',
        requiredPermission: { module: MODULE_CODES.ACCOUNTING, action: ACTIONS.VIEW },
      },
      {
        code: 'trial_balance',
        name: 'Trial Balance',
        nameAr: 'ميزان المراجعة',
        icon: 'Scale',
        path: '/accounting/trial-balance',
        requiredPermission: { module: MODULE_CODES.ACCOUNTING, action: ACTIONS.VIEW },
      },
    ],
  },
  {
    code: MODULE_CODES.GENERAL_LEDGER,
    name: 'General Ledger',
    nameAr: 'الأستاذ العام',
    icon: 'BookOpen',
    path: '/general-ledger',
    requiredPermission: { module: MODULE_CODES.GENERAL_LEDGER, action: ACTIONS.VIEW },
    subModules: [
      {
        code: 'chart_of_accounts',
        name: 'Chart of Accounts',
        nameAr: 'شجرة الحسابات',
        icon: 'GitBranch',
        path: '/general-ledger/accounts',
        requiredPermission: { module: MODULE_CODES.GENERAL_LEDGER, action: ACTIONS.VIEW },
      },
    ],
  },
  {
    code: MODULE_CODES.HR,
    name: 'Human Resources',
    nameAr: 'الموارد البشرية',
    icon: 'Users',
    path: '/hr',
    requiredPermission: { module: MODULE_CODES.HR, action: ACTIONS.VIEW },
    subModules: [
      {
        code: 'hr_employees',
        name: 'Employees',
        nameAr: 'الموظفين',
        icon: 'UserCircle',
        path: '/hr/employees',
        requiredPermission: { module: MODULE_CODES.HR, action: ACTIONS.VIEW },
      },
      {
        code: 'hr_payroll',
        name: 'Payroll',
        nameAr: 'الرواتب',
        icon: 'Wallet',
        path: '/hr/payroll',
        requiredPermission: { module: MODULE_CODES.HR, action: ACTIONS.VIEW },
      },
      {
        code: 'hr_attendance',
        name: 'Attendance',
        nameAr: 'الحضور',
        icon: 'Clock',
        path: '/hr/attendance',
        requiredPermission: { module: MODULE_CODES.HR, action: ACTIONS.VIEW },
      },
    ],
  },
  {
    code: MODULE_CODES.REPORTS,
    name: 'Reports',
    nameAr: 'التقارير',
    icon: 'BarChart3',
    path: '/reports',
    requiredPermission: { module: MODULE_CODES.REPORTS, action: ACTIONS.VIEW },
  },
  {
    code: MODULE_CODES.SETTINGS,
    name: 'Settings',
    nameAr: 'الإعدادات',
    icon: 'Settings',
    path: '/settings',
    requiredPermission: { module: MODULE_CODES.SETTINGS, action: ACTIONS.VIEW },
  },
  {
    code: MODULE_CODES.ORG_ADMIN,
    name: 'Organization Admin',
    nameAr: 'إدارة المنظمة',
    icon: 'Building2',
    path: '/org-admin',
    requireOrgAdmin: true,
  },
  {
    code: MODULE_CODES.SUPER_ADMIN,
    name: 'Super Admin',
    nameAr: 'مدير النظام',
    icon: 'Shield',
    path: '/super-admin',
    requireSuperAdmin: true,
  },
];

// =====================================
// دالة للحصول على صلاحية موديول
// =====================================

export function getModuleConfig(moduleCode: string): ModulePermissionConfig | undefined {
  return MODULE_PERMISSIONS.find(m => m.code === moduleCode);
}

export function getModuleByPath(path: string): ModulePermissionConfig | undefined {
  // البحث في الموديولات الرئيسية
  const mainModule = MODULE_PERMISSIONS.find(m => path.startsWith(m.path));
  if (mainModule) return mainModule;
  
  // البحث في الموديولات الفرعية
  for (const module of MODULE_PERMISSIONS) {
    if (module.subModules) {
      const subModule = module.subModules.find(sm => path.startsWith(sm.path));
      if (subModule) return subModule;
    }
  }
  
  return undefined;
}

// =====================================
// قائمة جميع الصلاحيات المتاحة
// =====================================

export const ALL_PERMISSIONS = Object.values(MODULE_CODES).flatMap(moduleCode => 
  Object.values(ACTIONS).map(action => ({
    module: moduleCode,
    action,
    key: `${moduleCode}:${action}`,
    label: `${moduleCode} - ${action}`,
  }))
);

export default MODULE_PERMISSIONS;

