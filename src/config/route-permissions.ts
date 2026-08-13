// src/config/route-permissions.ts
// بسم الله الرحمن الرحيم
//
// عقد مركزي: كل subroute داخل موديول مربوط صراحة بمفتاح صلاحية `read`/`view`
// أو بقائمة anyOf محددة صراحة. هذا يحل محل الافتراض القديم بأن امتلاك أي
// صلاحية داخل الموديول يكفي لكل مساراته — مستخدم يملك `sales.receipts.read`
// فقط يجب ألا يصل إلى `/sales/customers`.
//
// مسار غير مذكور هنا (أو موديول لا سجلّ له) يفشل مغلقًا: resolveRoutePermission
// تُعيد undefined، وModuleGuard يرفض الوصول — لا يوجد fallback إلى "أي صلاحية
// في الموديول تكفي".
//
// صلاحيات الأفعال الدقيقة (create/update/cancel/unpost) تبقى منفصلة عن هذا
// العقد؛ هذا العقد يحكم فقط الوصول إلى الشاشة (route entry + تحميل بياناتها
// الأولي)، والمكوّنات تواصل فحص أفعالها الخاصة بنفسها (مثال: أزرار الإلغاء/فك
// الترحيل في CustomerReceipts وSupplierPayments تفحص accounting.vouchers.*
// بمعزل عن هذا العقد).

export type RouteRequirement =
  | { readonly key: string }
  | { readonly anyOf: readonly string[] };

interface RoutePattern {
  /** نمط نسبي لجذر الموديول: "/", "/customers", "/bom/:bomId/edit". */
  readonly pattern: string;
  readonly requirement: RouteRequirement;
}

function seg(pattern: string): string[] {
  const normalized = pattern.replace(/\/+$/, '');
  return normalized === '' || normalized === '/' ? [] : normalized.replace(/^\//, '').split('/');
}

// ============================================================
// sales — catalog: customers, delivery_notes, receipts, sales_invoices, sales_orders
// ============================================================

const SALES_OVERVIEW: RouteRequirement = {
  anyOf: ['sales.customers.read', 'sales.sales_orders.read', 'sales.sales_invoices.read'],
};

const SALES_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: SALES_OVERVIEW },
  { pattern: '/overview', requirement: SALES_OVERVIEW },
  { pattern: '/customers', requirement: { key: 'sales.customers.read' } },
  { pattern: '/orders', requirement: { key: 'sales.sales_orders.read' } },
  { pattern: '/invoices', requirement: { key: 'sales.sales_invoices.read' } },
  { pattern: '/delivery', requirement: { key: 'sales.delivery_notes.read' } },
  // /collections و/receipts يعرضان نفس مكوّن CustomerReceipts.
  { pattern: '/collections', requirement: { key: 'sales.receipts.read' } },
  { pattern: '/receipts', requirement: { key: 'sales.receipts.read' } },
  { pattern: '*', requirement: SALES_OVERVIEW },
];

// ============================================================
// purchasing — catalog: suppliers, purchase_orders, purchase_invoices, payments
// ============================================================

const PURCHASING_OVERVIEW: RouteRequirement = {
  anyOf: [
    'purchasing.suppliers.read',
    'purchasing.purchase_orders.read',
    'purchasing.purchase_invoices.read',
    'purchasing.payments.read',
  ],
};

const PURCHASING_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: PURCHASING_OVERVIEW },
  { pattern: '/overview', requirement: PURCHASING_OVERVIEW },
  { pattern: '/suppliers', requirement: { key: 'purchasing.suppliers.read' } },
  { pattern: '/orders', requirement: { key: 'purchasing.purchase_orders.read' } },
  // لا يوجد مفتاح مخصص لاستلام البضاعة في الكتالوج الحي؛ أقرب مورد هو أوامر
  // الشراء التي يُستلَم عليها.
  { pattern: '/receipts', requirement: { key: 'purchasing.purchase_orders.read' } },
  { pattern: '/invoices', requirement: { key: 'purchasing.purchase_invoices.read' } },
  { pattern: '/payments', requirement: { key: 'purchasing.payments.read' } },
  { pattern: '*', requirement: PURCHASING_OVERVIEW },
];

// ============================================================
// inventory — catalog: items, products, stock_moves, warehouses, adjustments
// ============================================================

const INVENTORY_OVERVIEW: RouteRequirement = {
  anyOf: ['inventory.items.read', 'inventory.stock_moves.read', 'inventory.warehouses.read'],
};

const INVENTORY_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: INVENTORY_OVERVIEW },
  { pattern: '/overview', requirement: INVENTORY_OVERVIEW },
  { pattern: '/items', requirement: { key: 'inventory.items.read' } },
  // إصلاح مشاكل UoM للأصناف — بيانات أصناف، لا مورد مخصص في الكتالوج.
  { pattern: '/uom-issues', requirement: { key: 'inventory.items.read' } },
  // فئات الأصناف — لا مورد مخصص في الكتالوج.
  { pattern: '/categories', requirement: { key: 'inventory.items.read' } },
  { pattern: '/movements', requirement: { key: 'inventory.stock_moves.read' } },
  { pattern: '/adjustments', requirement: { key: 'inventory.adjustments.read' } },
  { pattern: '/valuation', requirement: { anyOf: ['inventory.items.read', 'inventory.stock_moves.read'] } },
  // مواقع التخزين وصناديقها — مورد فرعي من المخازن، لا مفتاح مخصص لهما.
  { pattern: '/locations', requirement: { key: 'inventory.warehouses.read' } },
  { pattern: '/warehouses', requirement: { key: 'inventory.warehouses.read' } },
  { pattern: '/bins', requirement: { key: 'inventory.warehouses.read' } },
  { pattern: '/transfers', requirement: { key: 'inventory.stock_moves.read' } },
  { pattern: '*', requirement: INVENTORY_OVERVIEW },
];

// ============================================================
// manufacturing — catalog: boms, orders, stage_costs, stages, work_centers
// ============================================================

const MANUFACTURING_OVERVIEW: RouteRequirement = {
  anyOf: [
    'manufacturing.orders.read',
    'manufacturing.boms.read',
    'manufacturing.stages.read',
    'manufacturing.work_centers.read',
    'manufacturing.stage_costs.read',
  ],
};

const MANUFACTURING_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: MANUFACTURING_OVERVIEW },
  { pattern: '/overview', requirement: MANUFACTURING_OVERVIEW },
  { pattern: '/orders', requirement: { key: 'manufacturing.orders.read' } },
  { pattern: '/mes', requirement: { key: 'manufacturing.work_centers.read' } },
  // التوجيه (routing) يعرّف تسلسل عمليات المراحل — أقرب مورد هو stages.
  { pattern: '/routing', requirement: { key: 'manufacturing.stages.read' } },
  { pattern: '/routing/new', requirement: { key: 'manufacturing.stages.create' } },
  { pattern: '/routing/:id', requirement: { key: 'manufacturing.stages.update' } },
  { pattern: '/capacity', requirement: { key: 'manufacturing.work_centers.read' } },
  // لوحة الكفاءة تقيس أداء مراكز العمل — لا مورد "efficiency" مخصص.
  { pattern: '/efficiency', requirement: { key: 'manufacturing.work_centers.read' } },
  { pattern: '/process-costing', requirement: { key: 'manufacturing.stage_costs.read' } },
  { pattern: '/equivalent-units', requirement: { key: 'manufacturing.stage_costs.read' } },
  { pattern: '/cost-of-production', requirement: { key: 'manufacturing.stage_costs.read' } },
  { pattern: '/variance-alerts', requirement: { key: 'manufacturing.stage_costs.read' } },
  { pattern: '/workcenters', requirement: { key: 'manufacturing.work_centers.read' } },
  { pattern: '/stages', requirement: { key: 'manufacturing.stages.read' } },
  { pattern: '/wip-log', requirement: { key: 'manufacturing.stage_costs.read' } },
  { pattern: '/standard-costs', requirement: { key: 'manufacturing.stage_costs.read' } },
  { pattern: '/bom', requirement: { key: 'manufacturing.boms.read' } },
  { pattern: '/bom/new', requirement: { key: 'manufacturing.boms.create' } },
  { pattern: '/bom/:bomId/edit', requirement: { key: 'manufacturing.boms.update' } },
  // صفحة "قيد الإنشاء" بلا بيانات فعلية بعد — افتراضي بأقرب مورد.
  { pattern: '/quality', requirement: { key: 'manufacturing.orders.read' } },
  { pattern: '*', requirement: MANUFACTURING_OVERVIEW },
];

// ============================================================
// hr — catalog: employees, attendance, payroll, leaves
// ============================================================

const HR_OVERVIEW: RouteRequirement = {
  anyOf: ['hr.employees.read', 'hr.attendance.read', 'hr.payroll.read', 'hr.leaves.read'],
};

const HR_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: HR_OVERVIEW },
  { pattern: '/overview', requirement: HR_OVERVIEW },
  { pattern: '/employees', requirement: { key: 'hr.employees.read' } },
  { pattern: '/employees/:id', requirement: { key: 'hr.employees.read' } },
  { pattern: '/attendance', requirement: { key: 'hr.attendance.read' } },
  { pattern: '/payroll', requirement: { key: 'hr.payroll.read' } },
  { pattern: '/leaves', requirement: { key: 'hr.leaves.read' } },
  // التسويات = تصفية رواتب نهائية — لا مورد "settlements" مخصص.
  { pattern: '/settlements', requirement: { key: 'hr.payroll.read' } },
  { pattern: '/reports', requirement: HR_OVERVIEW },
  // إعدادات الموارد البشرية (أنواع الإجازات...) — لا مورد مخصص.
  { pattern: '/settings', requirement: { key: 'hr.employees.read' } },
  { pattern: '*', requirement: HR_OVERVIEW },
];

// ============================================================
// accounting — catalog: accounts, cost_centers, entries, journals
// (لا يوجد مفتاح accounting.vouchers.read — .cancel/.unpost فقط، لأفعال دقيقة)
// ============================================================

const ACCOUNTING_OVERVIEW: RouteRequirement = {
  anyOf: [
    'accounting.journals.read',
    'accounting.entries.read',
    'accounting.accounts.read',
    'accounting.cost_centers.read',
  ],
};

const ACCOUNTING_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: ACCOUNTING_OVERVIEW },
  { pattern: '/overview', requirement: ACCOUNTING_OVERVIEW },
  { pattern: '/journal-entries', requirement: { key: 'accounting.journals.read' } },
  { pattern: '/trial-balance', requirement: { anyOf: ['accounting.entries.read', 'accounting.accounts.read'] } },
  // نفس مكوّن general_ledger.account_statement — يُقبل مفتاحها أيضًا.
  {
    pattern: '/account-statement',
    requirement: { anyOf: ['accounting.entries.read', 'accounting.accounts.read', 'general_ledger.account_statement.view'] },
  },
  // صفحة روابط ثابتة فقط، بلا بيانات خاصة بها.
  { pattern: '/posting', requirement: ACCOUNTING_OVERVIEW },
  { pattern: '/reconciliation', requirement: { key: 'accounting.entries.read' } },
  { pattern: '*', requirement: ACCOUNTING_OVERVIEW },
];

// ============================================================
// general_ledger — catalog: chart_of_accounts, account_statement
// ============================================================

const GENERAL_LEDGER_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: { key: 'general_ledger.chart_of_accounts.view' } },
  { pattern: '/accounts', requirement: { key: 'general_ledger.chart_of_accounts.view' } },
  { pattern: '/account-statement', requirement: { key: 'general_ledger.account_statement.view' } },
  { pattern: '*', requirement: { key: 'general_ledger.chart_of_accounts.view' } },
];

// ============================================================
// reports — catalog: financial, inventory, manufacturing, sales, exports, ai_insights
// (لا يوجد reports.purchasing.* — انظر التقرير المرفق مع التسليم)
// ============================================================

const REPORTS_OVERVIEW: RouteRequirement = {
  anyOf: ['reports.financial.read', 'reports.inventory.read', 'reports.manufacturing.read', 'reports.sales.read'],
};

const REPORTS_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: REPORTS_OVERVIEW },
  { pattern: '/financial', requirement: { key: 'reports.financial.read' } },
  { pattern: '/inventory', requirement: { key: 'reports.inventory.read' } },
  { pattern: '/manufacturing', requirement: { key: 'reports.manufacturing.read' } },
  { pattern: '/process-costing', requirement: { key: 'reports.manufacturing.read' } },
  { pattern: '/process-costing-dashboard', requirement: { key: 'reports.manufacturing.read' } },
  { pattern: '/sales', requirement: { key: 'reports.sales.read' } },
  // لا مفتاح reports.purchasing.* في الكتالوج الحي؛ الاعتماد على صلاحية
  // المشتريات التشغيلية نفسها بدل فتحها لأي صلاحية تقارير عامة.
  { pattern: '/purchasing', requirement: { anyOf: ['purchasing.purchase_orders.read', 'purchasing.suppliers.read'] } },
  { pattern: '/analytics', requirement: { key: 'reports.ai_insights.use' } },
  { pattern: '/advanced', requirement: REPORTS_OVERVIEW },
  { pattern: '/insights', requirement: { key: 'reports.ai_insights.use' } },
  { pattern: '/gemini/legacy', requirement: { key: 'reports.ai_insights.use' } },
  { pattern: '/gemini', requirement: REPORTS_OVERVIEW },
  { pattern: '*', requirement: REPORTS_OVERVIEW },
];

// ============================================================
// settings — catalog: organization, roles, users
// ============================================================

const SETTINGS_ORGANIZATION: RouteRequirement = { key: 'settings.organization.read' };

const SETTINGS_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: SETTINGS_ORGANIZATION },
  { pattern: '/company', requirement: SETTINGS_ORGANIZATION },
  // إعادة توجيه صرفة إلى /org-admin/*، الذي يفرض حراسته الخاصة.
  { pattern: '/users', requirement: SETTINGS_ORGANIZATION },
  { pattern: '/permissions', requirement: SETTINGS_ORGANIZATION },
  { pattern: '/system', requirement: SETTINGS_ORGANIZATION },
  { pattern: '/integrations', requirement: SETTINGS_ORGANIZATION },
  { pattern: '/backup', requirement: SETTINGS_ORGANIZATION },
  { pattern: '*', requirement: SETTINGS_ORGANIZATION },
];

// ============================================================

const MODULE_ROUTE_PERMISSIONS: Record<string, readonly RoutePattern[]> = {
  sales: SALES_ROUTES,
  purchasing: PURCHASING_ROUTES,
  inventory: INVENTORY_ROUTES,
  manufacturing: MANUFACTURING_ROUTES,
  hr: HR_ROUTES,
  accounting: ACCOUNTING_ROUTES,
  general_ledger: GENERAL_LEDGER_ROUTES,
  reports: REPORTS_ROUTES,
  settings: SETTINGS_ROUTES,
};

/**
 * يبحث عن متطلب الصلاحية لمسار فرعي (نسبي لجذر الموديول) داخل موديول معيّن.
 * يعيد undefined لموديول بلا عقد، أو مسار لا يطابق أي نمط معروف ولا `*` —
 * الاستدعاء المسؤول (ModuleGuard) يرفض الوصول في هذه الحالة (fail-closed).
 */
export function resolveRoutePermission(moduleCode: string, subPath: string): RouteRequirement | undefined {
  const patterns = MODULE_ROUTE_PERMISSIONS[moduleCode];
  if (!patterns) return undefined;

  const pathSegs = seg(subPath);

  for (const { pattern, requirement } of patterns) {
    if (pattern === '*') continue;
    const patternSegs = seg(pattern);
    if (patternSegs.length !== pathSegs.length) continue;
    if (patternSegs.every((s, i) => s.startsWith(':') || s === pathSegs[i])) {
      return requirement;
    }
  }

  return patterns.find(p => p.pattern === '*')?.requirement;
}

/** يفحص إن كانت مجموعة مفاتيح المستخدم (عبر hasKey) تحقق متطلب مسار معيّن. */
export function satisfiesRouteRequirement(requirement: RouteRequirement, hasKey: (key: string) => boolean): boolean {
  return 'key' in requirement ? hasKey(requirement.key) : requirement.anyOf.some(hasKey);
}
