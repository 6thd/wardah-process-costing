import { MODULE_CODES } from './module-permissions';
import {
  resolveRoutePermission,
  satisfiesRouteRequirement,
  type RouteRequirement,
} from './route-permissions';

export type ProductReadiness = 'ga' | 'beta' | 'planned' | 'hidden';

export type ProductIconKey =
  | 'LayoutDashboard'
  | 'Factory'
  | 'Package'
  | 'ShoppingCart'
  | 'DollarSign'
  | 'BookOpen'
  | 'Users'
  | 'BarChart3'
  | 'Settings'
  | 'Building2'
  | 'Shield';

export interface ProductCatalogItem {
  readonly key: string;
  readonly labelKey: string;
  readonly href: string;
  readonly icon?: ProductIconKey;
  /** Primary product module. This is IA metadata, not a grant. */
  readonly moduleCode: string;
  /**
   * Exact route-entry requirements derived from route-permissions.ts.
   * Multiple requirements are OR-ed only for intentional cross-module groups
   * such as the unified Accounting + General Ledger navigation group.
   */
  readonly requirements?: readonly RouteRequirement[];
  readonly status: ProductReadiness;
  readonly requireOrgAdmin?: boolean;
  readonly requireSuperAdmin?: boolean;
  readonly compatibilityOnly?: boolean;
  readonly blockedByIssue?: number;
  readonly children?: readonly ProductCatalogItem[];
}

export interface ProductCatalogAccessContext {
  readonly isOrgAdmin: boolean;
  readonly isSuperAdmin: boolean;
  readonly hasPermissionKey: (permissionKey: string) => boolean;
}

function routeRequirement(moduleCode: string, moduleRoot: string, href: string): readonly RouteRequirement[] | undefined {
  const subPath = href === moduleRoot ? '/' : href.slice(moduleRoot.length) || '/';
  const requirement = resolveRoutePermission(moduleCode, subPath);
  return requirement ? [requirement] : undefined;
}

function child(
  moduleCode: string,
  moduleRoot: string,
  key: string,
  href: string,
  labelKey: string,
  status: ProductReadiness = 'ga',
  extra: Pick<ProductCatalogItem, 'blockedByIssue' | 'compatibilityOnly'> = {},
): ProductCatalogItem {
  return {
    key,
    labelKey,
    href,
    moduleCode,
    requirements: routeRequirement(moduleCode, moduleRoot, href),
    status,
    ...extra,
  };
}

function moduleItem(
  moduleCode: string,
  key: string,
  href: string,
  icon: ProductIconKey,
  children: readonly ProductCatalogItem[],
  status: ProductReadiness = 'ga',
): ProductCatalogItem {
  return {
    key,
    labelKey: `navigation.${key}`,
    href,
    icon,
    moduleCode,
    requirements: routeRequirement(moduleCode, href, `${href}/overview`),
    status,
    children,
  };
}

const dashboardChildren = [
  child(MODULE_CODES.DASHBOARD, '/dashboard', 'overview', '/dashboard/overview', 'navigation.overview'),
  child(MODULE_CODES.DASHBOARD, '/dashboard', 'analytics', '/dashboard/analytics', 'navigation.analytics'),
  child(MODULE_CODES.DASHBOARD, '/dashboard', 'performance', '/dashboard/performance', 'navigation.performance'),
] as const;

const manufacturingChildren = [
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'overview', '/manufacturing/overview', 'navigation.overview'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'orders', '/manufacturing/orders', 'navigation.orders'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'mes', '/manufacturing/mes', 'navigation.mes', 'beta'),
  // No manufacturing.routing.* catalog contract exists yet. Keep the product
  // concept in the catalog, but fail closed in navigation until #152 closes.
  child(
    MODULE_CODES.MANUFACTURING,
    '/manufacturing',
    'routing',
    '/manufacturing/routing',
    'navigation.routing',
    'hidden',
    { blockedByIssue: 152 },
  ),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'capacity', '/manufacturing/capacity', 'navigation.capacity', 'beta'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'efficiency', '/manufacturing/efficiency', 'navigation.efficiency', 'beta'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'process-costing', '/manufacturing/process-costing', 'navigation.process-costing', 'beta'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'equivalent-units', '/manufacturing/equivalent-units', 'navigation.equivalent-units', 'beta'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'cost-of-production', '/manufacturing/cost-of-production', 'navigation.cost-of-production', 'beta'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'variance-alerts', '/manufacturing/variance-alerts', 'navigation.variance-alerts', 'beta'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'stages', '/manufacturing/stages', 'navigation.stages'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'wip-log', '/manufacturing/wip-log', 'navigation.wipLog', 'beta'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'standard-costs', '/manufacturing/standard-costs', 'navigation.standardCosts', 'beta'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'workcenters', '/manufacturing/workcenters', 'navigation.workcenters'),
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'bom', '/manufacturing/bom', 'navigation.bom'),
  // Current mounted component is an inert Coming Soon screen.
  child(MODULE_CODES.MANUFACTURING, '/manufacturing', 'quality', '/manufacturing/quality', 'navigation.quality', 'planned'),
] as const;

const inventoryChildren = [
  child(MODULE_CODES.INVENTORY, '/inventory', 'overview', '/inventory/overview', 'navigation.overview'),
  child(MODULE_CODES.INVENTORY, '/inventory', 'items', '/inventory/items', 'navigation.items'),
  // Deliberately has no route requirement: no inventory.categories.* resource
  // exists. The old Sidebar exposed a link that could only fail closed.
  child(MODULE_CODES.INVENTORY, '/inventory', 'categories', '/inventory/categories', 'navigation.categories', 'hidden'),
  child(MODULE_CODES.INVENTORY, '/inventory', 'movements', '/inventory/movements', 'navigation.movements'),
  child(MODULE_CODES.INVENTORY, '/inventory', 'adjustments', '/inventory/adjustments', 'navigation.adjustments'),
  child(MODULE_CODES.INVENTORY, '/inventory', 'valuation', '/inventory/valuation', 'navigation.valuation'),
  child(MODULE_CODES.INVENTORY, '/inventory', 'warehouses', '/inventory/warehouses', 'navigation.warehouses'),
  child(MODULE_CODES.INVENTORY, '/inventory', 'locations', '/inventory/locations', 'navigation.locations'),
  // The route is permission-gated but currently mounts a static placeholder.
  child(MODULE_CODES.INVENTORY, '/inventory', 'bins', '/inventory/bins', 'navigation.bins', 'planned'),
  child(MODULE_CODES.INVENTORY, '/inventory', 'transfers', '/inventory/transfers', 'navigation.transfers'),
] as const;

const purchasingChildren = [
  child(MODULE_CODES.PURCHASING, '/purchasing', 'overview', '/purchasing/overview', 'navigation.overview'),
  child(MODULE_CODES.PURCHASING, '/purchasing', 'suppliers', '/purchasing/suppliers', 'navigation.suppliers'),
  child(MODULE_CODES.PURCHASING, '/purchasing', 'orders', '/purchasing/orders', 'navigation.orders'),
  child(MODULE_CODES.PURCHASING, '/purchasing', 'receipts', '/purchasing/receipts', 'navigation.receipts'),
  child(MODULE_CODES.PURCHASING, '/purchasing', 'invoices', '/purchasing/invoices', 'navigation.invoices'),
  child(MODULE_CODES.PURCHASING, '/purchasing', 'payments', '/purchasing/payments', 'navigation.payments'),
] as const;

const salesChildren = [
  child(MODULE_CODES.SALES, '/sales', 'overview', '/sales/overview', 'navigation.overview', 'beta'),
  child(MODULE_CODES.SALES, '/sales', 'customers', '/sales/customers', 'navigation.customers', 'beta'),
  child(MODULE_CODES.SALES, '/sales', 'orders', '/sales/orders', 'navigation.orders', 'beta'),
  child(MODULE_CODES.SALES, '/sales', 'invoices', '/sales/invoices', 'navigation.invoices', 'beta'),
  child(MODULE_CODES.SALES, '/sales', 'delivery', '/sales/delivery', 'navigation.delivery', 'beta'),
  child(MODULE_CODES.SALES, '/sales', 'collections', '/sales/collections', 'navigation.collections', 'beta'),
] as const;

const accountingChildren = [
  child(MODULE_CODES.ACCOUNTING, '/accounting', 'overview', '/accounting/overview', 'navigation.overview'),
  child(
    MODULE_CODES.GENERAL_LEDGER,
    '/general-ledger',
    'chart-of-accounts',
    '/general-ledger/accounts',
    'navigation.chart-of-accounts',
  ),
  child(MODULE_CODES.ACCOUNTING, '/accounting', 'journal-entries', '/accounting/journal-entries', 'navigation.journal-entries'),
  child(MODULE_CODES.ACCOUNTING, '/accounting', 'trial-balance', '/accounting/trial-balance', 'navigation.trial-balance', 'beta'),
  child(MODULE_CODES.ACCOUNTING, '/accounting', 'account-statement', '/accounting/account-statement', 'navigation.account-statement', 'beta'),
  child(MODULE_CODES.ACCOUNTING, '/accounting', 'posting', '/accounting/posting', 'navigation.posting'),
  child(MODULE_CODES.ACCOUNTING, '/accounting', 'reconciliation', '/accounting/reconciliation', 'navigation.reconciliation', 'beta'),
] as const;

const hrChildren = [
  child(MODULE_CODES.HR, '/hr', 'overview', '/hr/overview', 'navigation.hr-dashboard'),
  child(MODULE_CODES.HR, '/hr', 'employees', '/hr/employees', 'navigation.employees'),
  child(MODULE_CODES.HR, '/hr', 'attendance', '/hr/attendance', 'navigation.attendance'),
  child(MODULE_CODES.HR, '/hr', 'payroll', '/hr/payroll', 'navigation.payroll'),
  child(MODULE_CODES.HR, '/hr', 'leaves', '/hr/leaves', 'navigation.leaves'),
  child(MODULE_CODES.HR, '/hr', 'settlements', '/hr/settlements', 'navigation.settlements', 'beta'),
  child(MODULE_CODES.HR, '/hr', 'reports', '/hr/reports', 'navigation.reports', 'beta'),
  child(MODULE_CODES.HR, '/hr', 'settings', '/hr/settings', 'navigation.settings', 'hidden'),
] as const;

const reportsChildren = [
  child(MODULE_CODES.REPORTS, '/reports', 'financial', '/reports/financial', 'navigation.financial', 'beta'),
  child(MODULE_CODES.REPORTS, '/reports', 'inventory', '/reports/inventory', 'navigation.inventory'),
  child(MODULE_CODES.REPORTS, '/reports', 'manufacturing', '/reports/manufacturing', 'navigation.manufacturing', 'beta'),
  child(MODULE_CODES.REPORTS, '/reports', 'process-costing-dashboard', '/reports/process-costing-dashboard', 'navigation.process-costing-dashboard', 'beta'),
  child(MODULE_CODES.REPORTS, '/reports', 'sales', '/reports/sales', 'navigation.sales', 'beta'),
  child(MODULE_CODES.REPORTS, '/reports', 'purchasing', '/reports/purchasing', 'navigation.purchasing', 'beta'),
  child(MODULE_CODES.REPORTS, '/reports', 'advanced', '/reports/advanced', 'navigation.advanced', 'beta'),
  child(MODULE_CODES.REPORTS, '/reports', 'analytics', '/reports/analytics', 'navigation.analytics', 'beta'),
  child(MODULE_CODES.REPORTS, '/reports', 'reports-insights', '/reports/insights', 'navigation.reports-insights', 'beta'),
  child(
    MODULE_CODES.REPORTS,
    '/reports',
    'gemini-compat',
    '/reports/gemini',
    'navigation.reports-insights',
    'hidden',
    { compatibilityOnly: true },
  ),
] as const;

const settingsChildren = [
  child(MODULE_CODES.SETTINGS, '/settings', 'company', '/settings/company', 'navigation.company'),
  child(MODULE_CODES.SETTINGS, '/settings', 'system', '/settings/system', 'navigation.system', 'beta'),
  child(MODULE_CODES.SETTINGS, '/settings', 'backup', '/settings/backup', 'navigation.backup', 'beta'),
  child(MODULE_CODES.SETTINGS, '/settings', 'integrations', '/settings/integrations', 'navigation.integrations', 'hidden'),
] as const;

const orgAdminChildren: readonly ProductCatalogItem[] = [
  { key: 'dashboard', labelKey: 'navigation.orgAdminDashboard', href: '/org-admin/dashboard', moduleCode: MODULE_CODES.ORG_ADMIN, status: 'ga', requireOrgAdmin: true },
  { key: 'users', labelKey: 'navigation.users', href: '/org-admin/users', moduleCode: MODULE_CODES.ORG_ADMIN, status: 'ga', requireOrgAdmin: true },
  { key: 'invitations', labelKey: 'navigation.invitations', href: '/org-admin/invitations', moduleCode: MODULE_CODES.ORG_ADMIN, status: 'ga', requireOrgAdmin: true },
  { key: 'roles', labelKey: 'navigation.roles', href: '/org-admin/roles', moduleCode: MODULE_CODES.ORG_ADMIN, status: 'ga', requireOrgAdmin: true },
  { key: 'audit-log', labelKey: 'navigation.audit-log', href: '/org-admin/audit-log', moduleCode: MODULE_CODES.ORG_ADMIN, status: 'ga', requireOrgAdmin: true },
];

const superAdminChildren: readonly ProductCatalogItem[] = [
  { key: 'dashboard', labelKey: 'navigation.orgAdminDashboard', href: '/super-admin/dashboard', moduleCode: MODULE_CODES.SUPER_ADMIN, status: 'ga', requireSuperAdmin: true },
  { key: 'organizations', labelKey: 'navigation.organizations', href: '/super-admin/organizations', moduleCode: MODULE_CODES.SUPER_ADMIN, status: 'ga', requireSuperAdmin: true },
];

const accountingOverview = resolveRoutePermission(MODULE_CODES.ACCOUNTING, '/overview');
const generalLedgerOverview = resolveRoutePermission(MODULE_CODES.GENERAL_LEDGER, '/');

export const PRODUCT_CATALOG: readonly ProductCatalogItem[] = [
  {
    key: 'dashboard',
    labelKey: 'navigation.dashboard',
    href: '/dashboard',
    icon: 'LayoutDashboard',
    moduleCode: MODULE_CODES.DASHBOARD,
    status: 'ga',
    children: dashboardChildren,
  },
  moduleItem(MODULE_CODES.MANUFACTURING, 'manufacturing', '/manufacturing', 'Factory', manufacturingChildren, 'beta'),
  moduleItem(MODULE_CODES.INVENTORY, 'inventory', '/inventory', 'Package', inventoryChildren),
  moduleItem(MODULE_CODES.PURCHASING, 'purchasing', '/purchasing', 'ShoppingCart', purchasingChildren),
  moduleItem(MODULE_CODES.SALES, 'sales', '/sales', 'DollarSign', salesChildren, 'beta'),
  {
    key: 'accounting',
    labelKey: 'navigation.accounting',
    href: '/accounting',
    icon: 'BookOpen',
    moduleCode: MODULE_CODES.ACCOUNTING,
    requirements: [accountingOverview, generalLedgerOverview].filter((r): r is RouteRequirement => r !== undefined),
    status: 'beta',
    children: accountingChildren,
  },
  moduleItem(MODULE_CODES.HR, 'hr', '/hr', 'Users', hrChildren),
  moduleItem(MODULE_CODES.REPORTS, 'reports', '/reports', 'BarChart3', reportsChildren, 'beta'),
  moduleItem(MODULE_CODES.SETTINGS, 'settings', '/settings', 'Settings', settingsChildren),
  {
    key: 'org-admin',
    labelKey: 'navigation.org-admin',
    href: '/org-admin',
    icon: 'Building2',
    moduleCode: MODULE_CODES.ORG_ADMIN,
    status: 'ga',
    requireOrgAdmin: true,
    children: orgAdminChildren,
  },
  {
    key: 'super-admin',
    labelKey: 'navigation.super-admin',
    href: '/super-admin',
    icon: 'Shield',
    moduleCode: MODULE_CODES.SUPER_ADMIN,
    status: 'ga',
    requireSuperAdmin: true,
    children: superAdminChildren,
  },
] as const;

function isRenderableStatus(status: ProductReadiness): boolean {
  return status === 'ga' || status === 'beta';
}

export function canSeeCatalogItem(item: ProductCatalogItem, context: ProductCatalogAccessContext): boolean {
  if (!isRenderableStatus(item.status) || item.compatibilityOnly) return false;
  if (item.requireSuperAdmin) return context.isSuperAdmin;
  if (item.requireOrgAdmin) return context.isOrgAdmin || context.isSuperAdmin;
  if (item.moduleCode === MODULE_CODES.DASHBOARD) return true;
  if (!item.requirements || item.requirements.length === 0) return false;
  return item.requirements.some(requirement =>
    satisfiesRouteRequirement(requirement, context.hasPermissionKey),
  );
}

/**
 * Returns a permission-filtered navigation tree without mutating the catalog.
 * Child routes use the same exact route requirements as ModuleGuard; the
 * catalog controls product readiness/IA only.
 */
export function getVisibleProductNavigation(
  context: ProductCatalogAccessContext,
  catalog: readonly ProductCatalogItem[] = PRODUCT_CATALOG,
): ProductCatalogItem[] {
  return catalog.flatMap(item => {
    if (!canSeeCatalogItem(item, context)) return [];
    const children = item.children?.filter(childItem => canSeeCatalogItem(childItem, context));
    return [{ ...item, children }];
  });
}
