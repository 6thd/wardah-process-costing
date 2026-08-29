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
// في الموديول تكفي". هذا يشمل عمدًا أي مسار داخل موديول معروف لا يطابق نمطًا
// مسجَّلًا: لا يوجد نمط `*` عام يعيد متطلب النظرة العامة لأي شيء غير مسجَّل —
// كان هذا موجودًا سابقًا واكتُشف أنه ليس fail-closed فعليًا (أي مسار مجهول كان
// يمر بصلاحية overview). الروابط المعروفة التي مجرد تعيد التوجيه (كـ
// /settings/integrations) لها سجلّ صريح خاص بها بدل الاعتماد على wildcard.
//
// صلاحيات الأفعال الدقيقة (create/update/cancel/unpost) تبقى منفصلة عن هذا
// العقد؛ هذا العقد يحكم فقط الوصول إلى الشاشة (route entry + تحميل بياناتها
// الأولي)، والمكوّنات تواصل فحص أفعالها الخاصة بنفسها (مثال: أزرار الإلغاء/فك
// الترحيل في CustomerReceipts وSupplierPayments تفحص accounting.vouchers.*
// بمعزل عن هذا العقد؛ وCustomersManagement تفحص sales.customers.create بمعزل
// عن sales.customers.read الذي يحكم دخول الشاشة).

export type RouteRequirement =
  | { readonly key: string }
  | { readonly anyOf: readonly string[] }
  | { readonly allOf: readonly string[] };

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
  // goods_receipts (GoodsReceiptManagement) has no dedicated catalog
  // resource, but every receipt is created against an existing purchase
  // order and cannot exist without one (see Migration 148's partial-receipt
  // gate, docs/db/UOM_PARTIAL_RECEIPT_148_RUNBOOK.md) — purchase_orders is
  // the actual underlying resource a receipt operates on, not a nearest
  // guess. GoodsReceiptManagement's list query now also checks this same
  // key itself (`canReadReceipts`), not just route entry.
  { pattern: '/receipts', requirement: { key: 'purchasing.purchase_orders.read' } },
  { pattern: '/invoices', requirement: { key: 'purchasing.purchase_invoices.read' } },
  { pattern: '/payments', requirement: { key: 'purchasing.payments.read' } },
];

// ============================================================
// inventory — catalog: items, products, stock_moves, warehouses, adjustments
// ============================================================

// adjustments.read كان غائبًا هنا رغم أن InventoryOverview تعرض بطاقة/رابط
// التسويات بمفتاحها بمعزل عن items/stock_moves/warehouses؛ مستخدم يملك
// adjustments.read وحده كان يُرفَض عند ModuleGuard قبل الوصول لتلك البطاقة أصلًا.
const INVENTORY_OVERVIEW: RouteRequirement = {
  anyOf: ['inventory.items.read', 'inventory.stock_moves.read', 'inventory.warehouses.read', 'inventory.adjustments.read'],
};

const INVENTORY_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: INVENTORY_OVERVIEW },
  { pattern: '/overview', requirement: INVENTORY_OVERVIEW },
  { pattern: '/items', requirement: { key: 'inventory.items.read' } },
  // UoM backfill/repair operates directly on product records
  // (ProductUomSettings mutates each product's UoM config) — items.read is
  // the actual underlying resource, not an approximation.
  { pattern: '/uom-issues', requirement: { key: 'inventory.items.read' } },
  // CategoriesManagement (categoriesService) reads/writes a standalone
  // `categories` table — unrelated to `items`/`products` beyond both
  // living under Inventory. items.read was a "nearest resource" guess, not
  // "the actual underlying resource it queries". No inventory.categories.*
  // key exists in the live catalog, so this pattern is intentionally absent:
  // resolveRoutePermission returns undefined and ModuleGuard fails closed —
  // no read, no write, no route entry, for anyone, until a real
  // categories.* resource is added to the catalog.
  { pattern: '/movements', requirement: { key: 'inventory.stock_moves.read' } },
  { pattern: '/adjustments', requirement: { key: 'inventory.adjustments.read' } },
  { pattern: '/valuation', requirement: { anyOf: ['inventory.items.read', 'inventory.stock_moves.read'] } },
  // storage_locations and storage_bins (warehouse-service.ts) are genuine
  // sub-resources of a warehouse — every row carries a warehouse_id and is
  // meaningless without one (StorageLocationsManagement loads locations only
  // after a warehouse is selected; CLAUDE.md's inventory architecture
  // documents bins as the per-warehouse balance/valuation unit). This is
  // "the actual underlying resource" read through its parent, not a
  // nearest-resource guess — there is no separate storage_locations/bins
  // table unrelated to warehouses the way categories is unrelated to items.
  // No inventory.locations.*/inventory.bins.* key exists, so warehouses.read
  // is the correct (and only defensible) gate until one is added.
  { pattern: '/locations', requirement: { key: 'inventory.warehouses.read' } },
  { pattern: '/warehouses', requirement: { key: 'inventory.warehouses.read' } },
  // The component actually mounted at /bins (StorageBinsPage) is a static
  // "under development" placeholder — it queries nothing. warehouses.read
  // gates entry to an inert page for consistency with /locations above; no
  // data is exposed either way. Update this comment when a real bins
  // component replaces the placeholder.
  { pattern: '/bins', requirement: { key: 'inventory.warehouses.read' } },
  { pattern: '/transfers', requirement: { key: 'inventory.stock_moves.read' } },
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
  // Routing (routingService.ts) reads/writes `routings`, `routing_operations`
  // and `operation_resources` — tables with no relationship to
  // manufacturing_stages beyond both living under Manufacturing. The
  // previous entries here mapped /routing* to manufacturing.stages.*, which
  // is not "the actual underlying resource it queries" — routing operations
  // (setup/run times, labor & overhead rates per operation, outsourcing)
  // are a distinct engineering-data resource stage_costs/stages was never
  // meant to gate. No manufacturing.routing.* key exists in the live
  // catalog, so /routing, /routing/new and /routing/:id are intentionally
  // absent here: resolveRoutePermission returns undefined for all three,
  // and ModuleGuard fails closed — no read, no write, no route entry, for
  // anyone, until a real routing.* resource is added to the catalog. Do not
  // reintroduce a manufacturing.stages.* (or any other) mapping here without
  // that catalog resource actually existing.
  { pattern: '/capacity', requirement: { key: 'manufacturing.work_centers.read' } },
  // EfficiencyDashboard (efficiencyService) reads across manufacturing_orders,
  // work_orders and material_consumption through views combining work-center
  // OEE, labor-cost variance (stage_costs domain) and BOM material
  // consumption — a genuine cross-cutting analytical view, not a single
  // resource. No manufacturing.efficiency.* key exists.
  //
  // This was previously anyOf: holding just one of the three keys let a user
  // reach the whole dashboard, which unconditionally invokes every
  // dashboard, work-center, labor, variance, OEE, and material hook
  // regardless of which single key was actually held — a real one-key-opens-
  // everything gap, not just an approximation. EfficiencyDashboard does not
  // (yet) gate its individual queries/sections per resource, so allOf is the
  // bounded fix: route entry now requires every one of the three real
  // resources the page actually queries. Loosening this back to anyOf is not
  // safe without first adding complete per-query/per-section permission
  // gating inside EfficiencyDashboard itself, with cache-revocation tests to
  // match — out of scope here.
  {
    pattern: '/efficiency',
    requirement: {
      allOf: ['manufacturing.work_centers.read', 'manufacturing.stage_costs.read', 'manufacturing.orders.read'],
    },
  },
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
  // QualityControlManagement (the component actually mounted at /quality)
  // is a static "coming soon" EmptyState — it queries nothing, the same
  // class of route as /inventory/bins above. There is no quality.* catalog
  // resource because there is no quality data yet to protect; this is not a
  // "nearest resource" approximation for a real query, since no query
  // exists. manufacturing.orders.read gates entry to this inert page for
  // consistency with the rest of the module; update this comment (and the
  // key, if warranted) when a real quality-control component with actual
  // queries replaces the placeholder.
  { pattern: '/quality', requirement: { key: 'manufacturing.orders.read' } },
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
  // hr_settlements has no dedicated catalog resource, but an end-of-service
  // settlement is a final payroll calculation (basic salary, allowances,
  // deductions, GOSI, EOS pay — see ACCOUNT_TYPES in SettingsPage.tsx) that
  // both reads and eventually posts payroll amounts; payroll.read is the
  // actual underlying resource domain, not a nearest-resource guess.
  // SettlementsPage's list query now also checks this same key itself
  // (`canReadSettlements`), not just route entry; every write action
  // (create/review/post/cancel) stays hard fail-closed pending a dedicated
  // hr.settlements.* key.
  { pattern: '/settlements', requirement: { key: 'hr.payroll.read' } },
  { pattern: '/reports', requirement: HR_OVERVIEW },
  // hr_policies (general leave/attendance/overtime policy config) and
  // payroll_account_mappings together have no single dedicated resource —
  // the page spans policy config and payroll GL wiring. Round 7 reused
  // hr.employees.read as a "broadest HR key" visibility proxy, but
  // employees.read is not a genuine parent resource for HR policies or
  // payroll GL mappings — holding it does not establish authorization for
  // either. /settings is intentionally unregistered here: resolveRoutePermission
  // returns undefined and ModuleGuard fails closed for everyone, including
  // org/super admins, until a real hr.settings.* (or equivalent) catalog
  // resource exists. SettingsPage's own canReadHrSettings gate mirrors this —
  // it no longer falls back to hr.employees.read either (see SettingsPage.tsx).
  // Do not substitute hr.payroll.read, hr.attendance.read, or another nearby
  // key here: none of them is the actual underlying resource either.
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
  { pattern: '/trial-balance', requirement: { key: 'reports.financial.read' } },
  // نفس مكوّن general_ledger.account_statement — يُقبل مفتاحها أيضًا.
  {
    pattern: '/account-statement',
    requirement: { anyOf: ['accounting.entries.read', 'accounting.accounts.read', 'general_ledger.account_statement.view'] },
  },
  // صفحة روابط ثابتة فقط، بلا بيانات خاصة بها.
  { pattern: '/posting', requirement: ACCOUNTING_OVERVIEW },
  { pattern: '/reconciliation', requirement: { key: 'accounting.entries.read' } },
];

// ============================================================
// general_ledger — catalog: chart_of_accounts, account_statement
// ============================================================

const GENERAL_LEDGER_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: { key: 'general_ledger.chart_of_accounts.view' } },
  { pattern: '/accounts', requirement: { key: 'general_ledger.chart_of_accounts.view' } },
  { pattern: '/account-statement', requirement: { key: 'general_ledger.account_statement.view' } },
];

// ============================================================
// reports — catalog: financial, inventory, manufacturing, sales, exports, ai_insights
// (لا يوجد reports.purchasing.* — انظر التقرير المرفق مع التسليم)
// ============================================================

// نظرة التقارير العامة تجمع بطاقات مربوطة أيضًا بـ reports.ai_insights.use
// وبمفتاحَي المشتريات التشغيلية (بطاقة "تقارير المشتريات" في ReportsOverview) —
// كانا غائبين هنا، فمستخدم يملك أيًّا منهما وحده كان يُرفَض عند ModuleGuard
// قبل الوصول لبطاقته أصلًا (نفس عائلة خلل settings.organization.read وحده).
const REPORTS_OVERVIEW: RouteRequirement = {
  anyOf: [
    'reports.financial.read', 'reports.inventory.read', 'reports.manufacturing.read', 'reports.sales.read',
    'reports.ai_insights.use',
    'purchasing.purchase_orders.read', 'purchasing.suppliers.read',
  ],
};

// "التقارير المتقدمة" في ReportsOverview مربوطة بهذه الأربعة تحديدًا (لا
// ai_insights ولا purchasing) — عقدها المستقل بدل REPORTS_OVERVIEW الموسَّعة.
const REPORTS_ADVANCED: RouteRequirement = {
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
  { pattern: '/advanced', requirement: REPORTS_ADVANCED },
  { pattern: '/insights', requirement: { key: 'reports.ai_insights.use' } },
  { pattern: '/gemini/legacy', requirement: { key: 'reports.ai_insights.use' } },
  // نفس مفتاح /gemini/legacy — صفحة مركز Gemini/AI لا نظرة تقارير عامة.
  { pattern: '/gemini', requirement: { key: 'reports.ai_insights.use' } },
];

// ============================================================
// settings — catalog: organization, roles, users
// ============================================================

const SETTINGS_ORGANIZATION: RouteRequirement = { key: 'settings.organization.read' };

// نظرة الإعدادات العامة تجمع بطاقات مربوطة بثلاثة مفاتيح مختلفة (organization/
// users/roles)، وكل بطاقة تُخفى داخل SettingsOverview بمفتاحها الفعلي — فامتلاك
// أي منها كافٍ لدخول الشاشة نفسها، لا organization.read وحده. مطابق لنمط anyOf
// المستخدم في نظرة كل موديول آخر (sales/purchasing/inventory/...).
const SETTINGS_OVERVIEW: RouteRequirement = {
  anyOf: ['settings.organization.read', 'settings.users.read', 'settings.roles.read'],
};

const SETTINGS_ROUTES: RoutePattern[] = [
  { pattern: '/', requirement: SETTINGS_OVERVIEW },
  { pattern: '/overview', requirement: SETTINGS_OVERVIEW },
  { pattern: '/company', requirement: SETTINGS_ORGANIZATION },
  // إعادة توجيه صرفة إلى /org-admin/users، الذي يفرض حراسته الخاصة — لكن
  // الدخول هنا يُفحص بمفتاح users نفسه لا organization: مستخدم يملك
  // settings.users.read فقط يجب أن يصل، ومستخدم يملك organization.read فقط
  // (بلا users.read) يجب ألا يُستخدم بديلًا عنه.
  { pattern: '/users', requirement: { key: 'settings.users.read' } },
  // إعادة توجيه صرفة إلى /org-admin/roles — نفس المنطق بمفتاح roles.
  { pattern: '/permissions', requirement: { key: 'settings.roles.read' } },
  // org_settings (key='system') is a per-organization settings row
  // (foreign-keyed to org_id, distinct from the `organizations` row itself
  // per SystemSettingsPage.tsx's own comment) — organization.read is used
  // as its parent resource, the same relationship as storage_locations to
  // warehouses above, not a nearest-resource guess. SystemSettingsPage's
  // getSystemSettings() read now also checks this same key itself
  // (`canReadSystemSettings`), not just route entry; saving stays hard
  // fail-closed pending a dedicated settings.system.* key.
  { pattern: '/system', requirement: SETTINGS_ORGANIZATION },
  { pattern: '/integrations', requirement: SETTINGS_ORGANIZATION },
  { pattern: '/backup', requirement: SETTINGS_ORGANIZATION },
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
 * يعيد undefined لموديول بلا عقد، أو مسار لا يطابق أي نمط مسجَّل بالضبط —
 * لا يوجد نمط عام (`*`) يلتقط الباقي. الاستدعاء المسؤول (ModuleGuard) يرفض
 * الوصول عند undefined (fail-closed)، بلا أي fallback إلى صلاحية النظرة
 * العامة أو غيرها.
 */
export function resolveRoutePermission(moduleCode: string, subPath: string): RouteRequirement | undefined {
  const patterns = MODULE_ROUTE_PERMISSIONS[moduleCode];
  if (!patterns) return undefined;

  const pathSegs = seg(subPath);

  for (const { pattern, requirement } of patterns) {
    const patternSegs = seg(pattern);
    if (patternSegs.length !== pathSegs.length) continue;
    if (patternSegs.every((s, i) => s.startsWith(':') || s === pathSegs[i])) {
      return requirement;
    }
  }

  return undefined;
}

/** يفحص إن كانت مجموعة مفاتيح المستخدم (عبر hasKey) تحقق متطلب مسار معيّن. */
export function satisfiesRouteRequirement(requirement: RouteRequirement, hasKey: (key: string) => boolean): boolean {
  if ('key' in requirement) return hasKey(requirement.key);
  if ('allOf' in requirement) return requirement.allOf.every(hasKey);
  return requirement.anyOf.some(hasKey);
}
