import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  Factory, 
  Package, 
  ShoppingCart, 
  DollarSign, 
  BarChart3, 
  Settings,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  BookOpen,
  Users,
  Building2,
  Shield
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { usePermissions } from '@/hooks/usePermissions'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getGlassClasses } from '@/lib/wardah-ui-utils'

// تعريف أكواد الموديولات للصلاحيات
const MODULE_CODES = {
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

// Helper functions to reduce cognitive complexity
const shouldShowNavigationItem = (
  item: { key: string; requireSuperAdmin?: boolean; requireOrgAdmin?: boolean },
  isOrgAdmin: boolean,
  isSuperAdmin: boolean
): boolean => {
  if (item.key === 'dashboard') return true
  if (item.requireSuperAdmin) return isSuperAdmin
  if (item.requireOrgAdmin) return isOrgAdmin || isSuperAdmin
  return true
}

// Helper function to render collapsed sidebar item
const renderCollapsedItem = (
  item: { key: string; icon: any; href: string; badge: string | null },
  isActive: boolean,
  isRTL: boolean,
  t: (key: string) => string,
  handleItemClick: () => void
) => {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={item.href}
          className={cn(
            "flex items-center justify-center p-3 rounded-lg text-sm font-medium transition-all duration-200",
            "hover:bg-accent/50 hover:scale-105",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isActive && "bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
          )}
          onClick={handleItemClick}
        >
          <Icon className="h-5 w-5 shrink-0" />
          {item.badge && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
          )}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side={isRTL ? "left" : "right"} className="font-medium">
        {t(`navigation.${item.key}`)}
        {item.badge && (
          <Badge variant="secondary" className="ml-2 text-xs">
            {item.badge}
          </Badge>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

// Helper function to render expanded sidebar item
const renderExpandedItem = (
  item: { key: string; icon: any; href: string; badge: string | null; subItems?: Array<{ key: string; href: string; labelKey: string }> },
  isActive: boolean,
  isExpanded: boolean,
  hasSubItems: boolean,
  isRTL: boolean,
  t: (key: string) => string,
  ChevronIcon: any,
  toggleExpanded: (key: string) => void,
  handleItemClick: () => void,
  location: { pathname: string }
) => {
  const Icon = item.icon
  const handleItemAction = () => {
    if (hasSubItems) {
      toggleExpanded(item.key)
    } else {
      handleItemClick()
    }
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group border-0",
          "hover:bg-accent/50 hover:shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isActive && "bg-primary text-primary-foreground shadow-md hover:bg-primary/90",
          isRTL ? "text-right" : "text-left"
        )}
        onClick={handleItemAction}
      >
        <Icon className="h-5 w-5 shrink-0 transition-transform group-hover:scale-110" />
        <span className={cn(
          "flex-1 truncate",
          isRTL ? "text-right" : "text-left"
        )}>
          {t(`navigation.${item.key}`)}
        </span>
        {item.badge && (
          <Badge 
            variant={isActive ? "outline" : "secondary"} 
            className={cn(
              "text-xs font-semibold px-2 py-0.5",
              isActive && "border-primary-foreground/20"
            )}
          >
            {item.badge}
          </Badge>
        )}
        {hasSubItems && (
          <ChevronDown 
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200",
              isExpanded && "rotate-180",
              isRTL && "rotate-180"
            )} 
          />
        )}
      </button>
      
      {/* Sub-items with animation */}
      {hasSubItems && (
        <div
          className={cn(
            "overflow-hidden transition-all duration-300 ease-in-out",
            isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0",
            isRTL ? "mr-4 pr-3 border-r-2 border-border/30" : "ml-4 pl-3 border-l-2 border-border/30"
          )}
        >
          <div className="space-y-0.5 py-1">
            {item.subItems?.map((subItem) => {
              const isSubActive = location.pathname === subItem.href
              return (
                <NavLink
                  key={subItem.key}
                  to={subItem.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-all duration-150",
                    "text-muted-foreground hover:text-foreground hover:bg-accent/30 hover:translate-x-1",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSubActive && "text-primary font-semibold bg-primary/10 border-l-2 border-primary",
                    isRTL && "hover:-translate-x-1"
                  )}
                  onClick={handleItemClick}
                >
                  <ChevronIcon className="h-3 w-3 shrink-0 opacity-60" />
                  <span className={cn(
                    "flex-1 truncate",
                    isRTL ? "text-right" : "text-left"
                  )}>
                    {t(subItem.labelKey)}
                  </span>
                </NavLink>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

// Helper function to render mobile sidebar item
const renderMobileItem = (
  item: { key: string; icon: any; href: string; badge: string | null; subItems?: Array<{ key: string; href: string; labelKey: string }> },
  isActive: boolean,
  isExpanded: boolean,
  hasSubItems: boolean,
  isRTL: boolean,
  t: (key: string) => string,
  ChevronIcon: any,
  toggleExpanded: (key: string) => void,
  handleItemClick: () => void,
  location: { pathname: string }
) => {
  const Icon = item.icon
  const handleItemAction = () => {
    if (hasSubItems) {
      toggleExpanded(item.key)
    } else {
      handleItemClick()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleItemAction()
    }
  }

  return (
    <div key={item.key} className="space-y-1">
      <div
        role="menuitem"
        tabIndex={0}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer group",
          "hover:bg-accent/50 hover:shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isActive && "bg-primary text-primary-foreground shadow-md hover:bg-primary/90",
          isRTL ? "text-right" : "text-left"
        )}
        onClick={handleItemAction}
        onKeyDown={handleKeyDown}
      >
        <Icon className="h-5 w-5 shrink-0 transition-transform group-hover:scale-110" />
        <span className={cn(
          "flex-1 truncate",
          isRTL ? "text-right" : "text-left"
        )}>
          {t(`navigation.${item.key}`)}
        </span>
        {item.badge && (
          <Badge 
            variant={isActive ? "outline" : "secondary"} 
            className={cn(
              "text-xs font-semibold px-2 py-0.5",
              isActive && "border-primary-foreground/20"
            )}
          >
            {item.badge}
          </Badge>
        )}
        {hasSubItems && (
          <ChevronDown 
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200",
              isExpanded && "rotate-180",
              isRTL && "rotate-180"
            )} 
          />
        )}
      </div>
      
      {/* Sub-items with animation */}
      {hasSubItems && (
        <div
          className={cn(
            "overflow-hidden transition-all duration-300 ease-in-out",
            isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0",
            isRTL ? "mr-4 pr-3 border-r-2 border-border/30" : "ml-4 pl-3 border-l-2 border-border/30"
          )}
        >
          <div className="space-y-0.5 py-1">
            {item.subItems?.map((subItem) => {
              const isSubActive = location.pathname === subItem.href
              return (
                <NavLink
                  key={subItem.key}
                  to={subItem.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-all duration-150",
                    "text-muted-foreground hover:text-foreground hover:bg-accent/30 hover:translate-x-1",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSubActive && "text-primary font-semibold bg-primary/10 border-l-2 border-primary",
                    isRTL && "hover:-translate-x-1"
                  )}
                  onClick={handleItemClick}
                >
                  <ChevronIcon className="h-3 w-3 shrink-0 opacity-60" />
                  <span className={cn(
                    "flex-1 truncate",
                    isRTL ? "text-right" : "text-left"
                  )}>
                    {t(subItem.labelKey)}
                  </span>
                </NavLink>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const { sidebarCollapsed, sidebarOpen, setSidebarOpen } = useUIStore()
  const [expandedItems, setExpandedItems] = useState<string[]>([])
  
      // 🔐 استخدام صلاحيات المستخدم
      const { isOrgAdmin, isSuperAdmin } = usePermissions()

  const isRTL = i18n.language === 'ar'
  const ChevronIcon = isRTL ? ChevronLeft : ChevronRight

  const toggleExpanded = (key: string) => {
    setExpandedItems(prev => 
      prev.includes(key) 
        ? prev.filter(k => k !== key) 
        : [...prev, key]
    )
  }

  // تعريف عناصر التنقل مع الصلاحيات
  const allNavigationItems = [
    {
      key: 'dashboard',
      icon: LayoutDashboard,
      href: '/dashboard',
      badge: null,
      moduleCode: MODULE_CODES.DASHBOARD, // لا يحتاج صلاحية - متاح للجميع
      subItems: [
        { key: 'overview', href: '/dashboard/overview', labelKey: 'navigation.overview' },
        { key: 'analytics', href: '/dashboard/analytics', labelKey: 'navigation.analytics' },
        { key: 'performance', href: '/dashboard/performance', labelKey: 'navigation.performance' }
      ]
    },
    {
      key: 'manufacturing',
      icon: Factory,
      href: '/manufacturing',
      badge: '2',
      moduleCode: MODULE_CODES.MANUFACTURING,
      subItems: [
        { key: 'overview', href: '/manufacturing/overview', labelKey: 'navigation.overview' },
        { key: 'orders', href: '/manufacturing/orders', labelKey: 'navigation.orders' },
        { key: 'mes', href: '/manufacturing/mes', labelKey: 'navigation.mes' },
        { key: 'routing', href: '/manufacturing/routing', labelKey: 'navigation.routing' },
        { key: 'capacity', href: '/manufacturing/capacity', labelKey: 'navigation.capacity' },
        { key: 'efficiency', href: '/manufacturing/efficiency', labelKey: 'navigation.efficiency' },
        { key: 'process-costing', href: '/manufacturing/process-costing', labelKey: 'navigation.process-costing' },
        { key: 'equivalent-units', href: '/manufacturing/equivalent-units', labelKey: 'navigation.equivalent-units' },
        { key: 'cost-of-production', href: '/manufacturing/cost-of-production', labelKey: 'navigation.cost-of-production' },
        { key: 'variance-alerts', href: '/manufacturing/variance-alerts', labelKey: 'navigation.variance-alerts' },
        { key: 'stages', href: '/manufacturing/stages', labelKey: 'navigation.stages' },
        { key: 'wip-log', href: '/manufacturing/wip-log', labelKey: 'navigation.wipLog' },
        { key: 'standard-costs', href: '/manufacturing/standard-costs', labelKey: 'navigation.standardCosts' },
        { key: 'workcenters', href: '/manufacturing/workcenters', labelKey: 'navigation.workcenters' },
        { key: 'bom', href: '/manufacturing/bom', labelKey: 'navigation.bom' },
        { key: 'quality', href: '/manufacturing/quality', labelKey: 'navigation.quality' }
      ]
    },
    {
      key: 'inventory',
      icon: Package,
      href: '/inventory',
      badge: null,
      moduleCode: MODULE_CODES.INVENTORY,
      subItems: [
        { key: 'overview', href: '/inventory/overview', labelKey: 'navigation.overview' },
        { key: 'items', href: '/inventory/items', labelKey: 'navigation.items' },
        { key: 'categories', href: '/inventory/categories', labelKey: 'navigation.categories' },
        { key: 'movements', href: '/inventory/movements', labelKey: 'navigation.movements' },
        { key: 'adjustments', href: '/inventory/adjustments', labelKey: 'navigation.adjustments' },
        { key: 'valuation', href: '/inventory/valuation', labelKey: 'navigation.valuation' },
        { key: 'warehouses', href: '/inventory/warehouses', labelKey: 'navigation.warehouses' },
        { key: 'locations', href: '/inventory/locations', labelKey: 'navigation.locations' },
        { key: 'bins', href: '/inventory/bins', labelKey: 'navigation.bins' },
        { key: 'transfers', href: '/inventory/transfers', labelKey: 'navigation.transfers' }
      ]
    },
    {
      key: 'purchasing',
      icon: ShoppingCart,
      href: '/purchasing',
      badge: '3',
      moduleCode: MODULE_CODES.PURCHASING,
      subItems: [
        { key: 'overview', href: '/purchasing/overview', labelKey: 'navigation.overview' },
        { key: 'suppliers', href: '/purchasing/suppliers', labelKey: 'navigation.suppliers' },
        { key: 'orders', href: '/purchasing/orders', labelKey: 'navigation.orders' },
        { key: 'receipts', href: '/purchasing/receipts', labelKey: 'navigation.receipts' },
        { key: 'invoices', href: '/purchasing/invoices', labelKey: 'navigation.invoices' },
        { key: 'payments', href: '/purchasing/payments', labelKey: 'navigation.payments' }
      ]
    },
    {
      key: 'sales',
      icon: DollarSign,
      href: '/sales',
      badge: null,
      moduleCode: MODULE_CODES.SALES,
      subItems: [
        { key: 'overview', href: '/sales/overview', labelKey: 'navigation.overview' },
        { key: 'customers', href: '/sales/customers', labelKey: 'navigation.customers' },
        { key: 'orders', href: '/sales/orders', labelKey: 'navigation.orders' },
        { key: 'invoices', href: '/sales/invoices', labelKey: 'navigation.invoices' },
        { key: 'delivery', href: '/sales/delivery', labelKey: 'navigation.delivery' },
        { key: 'collections', href: '/sales/collections', labelKey: 'navigation.collections' }
      ]
    },
    {
      key: 'accounting',
      icon: BookOpen,
      href: '/accounting',
      badge: null,
      moduleCode: MODULE_CODES.ACCOUNTING,
      subItems: [
        { key: 'overview', href: '/accounting/overview', labelKey: 'navigation.overview' },
        { key: 'chart-of-accounts', href: '/general-ledger/accounts', labelKey: 'navigation.chart-of-accounts' },
        { key: 'journal-entries', href: '/accounting/journal-entries', labelKey: 'navigation.journal-entries' },
        { key: 'trial-balance', href: '/accounting/trial-balance', labelKey: 'navigation.trial-balance' },
        { key: 'account-statement', href: '/accounting/account-statement', labelKey: 'navigation.account-statement' },
        { key: 'posting', href: '/accounting/posting', labelKey: 'navigation.posting' },
        { key: 'reconciliation', href: '/accounting/reconciliation', labelKey: 'navigation.reconciliation' }
      ]
    },
    // قائمة «دفتر الأستاذ» المكرّرة حُذفت: عنصراها موجودان في قائمة المحاسبة،
    // ومسارات /general-ledger/* تبقى عاملة (توافق URLs).
    {
      key: 'hr',
      icon: Users,
      href: '/hr',
      badge: null,
      moduleCode: MODULE_CODES.HR,
      subItems: [
        { key: 'overview', href: '/hr/overview', labelKey: 'navigation.hr-dashboard' },
        { key: 'employees', href: '/hr/employees', labelKey: 'navigation.employees' },
        { key: 'attendance', href: '/hr/attendance', labelKey: 'navigation.attendance' },
        { key: 'payroll', href: '/hr/payroll', labelKey: 'navigation.payroll' },
        { key: 'leaves', href: '/hr/leaves', labelKey: 'navigation.leaves' },
        { key: 'settlements', href: '/hr/settlements', labelKey: 'navigation.settlements' },
        { key: 'reports', href: '/hr/reports', labelKey: 'navigation.reports' },
        { key: 'settings', href: '/hr/settings', labelKey: 'navigation.settings' }
      ]
    },
    {
      key: 'reports',
      icon: BarChart3,
      href: '/reports',
      badge: null,
      moduleCode: MODULE_CODES.REPORTS,
      subItems: [
        { key: 'financial', href: '/reports/financial', labelKey: 'navigation.financial' },
        { key: 'inventory', href: '/reports/inventory', labelKey: 'navigation.inventory' },
        { key: 'manufacturing', href: '/reports/manufacturing', labelKey: 'navigation.manufacturing' },
        { key: 'process-costing-dashboard', href: '/reports/process-costing-dashboard', labelKey: 'navigation.process-costing-dashboard' },
        { key: 'sales', href: '/reports/sales', labelKey: 'navigation.sales' },
        { key: 'purchasing', href: '/reports/purchasing', labelKey: 'navigation.purchasing' },
        { key: 'advanced', href: '/reports/advanced', labelKey: 'navigation.advanced' },
        { key: 'analytics', href: '/reports/analytics', labelKey: 'navigation.analytics' },
        { key: 'gemini-dashboard', href: '/reports/gemini', labelKey: 'navigation.gemini-dashboard' }
      ]
    },
    {
      key: 'settings',
      icon: Settings,
      href: '/settings',
      badge: null,
      moduleCode: MODULE_CODES.SETTINGS,
      subItems: [
        { key: 'company', href: '/settings/company', labelKey: 'navigation.company' },
        // users/permissions حُذفا: مجرد redirect لإدارة المؤسسة المكرَّرة في قائمتها.
        // integrations مخفيّة حتى تُبنى تكاملات فعلية (قرار المالك).
        { key: 'system', href: '/settings/system', labelKey: 'navigation.system' },
        { key: 'backup', href: '/settings/backup', labelKey: 'navigation.backup' }
      ]
    },
    {
      key: 'org-admin',
      icon: Building2,
      href: '/org-admin',
      badge: null,
      moduleCode: MODULE_CODES.ORG_ADMIN,
      requireOrgAdmin: true, // يتطلب صلاحية Org Admin
      subItems: [
        { key: 'dashboard', href: '/org-admin/dashboard', labelKey: 'navigation.orgAdminDashboard' },
        { key: 'users', href: '/org-admin/users', labelKey: 'navigation.users' },
        { key: 'invitations', href: '/org-admin/invitations', labelKey: 'navigation.invitations' },
        { key: 'roles', href: '/org-admin/roles', labelKey: 'navigation.roles' },
        { key: 'audit-log', href: '/org-admin/audit-log', labelKey: 'navigation.audit-log' }
      ]
    },
    {
      key: 'super-admin',
      icon: Shield,
      href: '/super-admin',
      badge: null,
      moduleCode: MODULE_CODES.SUPER_ADMIN,
      requireSuperAdmin: true, // يتطلب صلاحية Super Admin
      subItems: [
        { key: 'dashboard', href: '/super-admin/dashboard', labelKey: 'navigation.orgAdminDashboard' },
        { key: 'organizations', href: '/super-admin/organizations', labelKey: 'navigation.organizations' }
      ]
    },
  ]

  // 🔐 فلترة العناصر بناءً على الصلاحيات
  const navigationItems = useMemo(() => {
    return allNavigationItems.filter(item => 
      shouldShowNavigationItem(item, isOrgAdmin, isSuperAdmin)
    )
  }, [isOrgAdmin, isSuperAdmin])

  const handleItemClick = () => {
    // Close mobile sidebar when item is clicked
    if (globalThis.window.innerWidth < 1024) {
      setSidebarOpen(false)
    }
  }

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "fixed top-16 z-40 h-[calc(100vh-4rem)] bg-card/95 backdrop-blur-sm border border-border/50 transition-all duration-300 shadow-lg",
          sidebarCollapsed ? "w-16" : "w-64",
          "hidden lg:block",
          // RTL positioning
          isRTL ? "right-0" : "left-0",
          // RTL border
          isRTL ? "border-l border-r-0" : "border-r border-l-0"
        )}
      >
        <ScrollArea className="h-full">
          <TooltipProvider delayDuration={300}>
            <nav className={cn("flex flex-col gap-1 p-3", getGlassClasses())}>
              {navigationItems.map((item) => {
                const isActive = location.pathname.startsWith(item.href)
                const isExpanded = expandedItems.includes(item.key)
                const hasSubItems = item.subItems && item.subItems.length > 0
                
                return (
                  <div key={item.key} className="space-y-1">
                    {sidebarCollapsed 
                      ? renderCollapsedItem(item, isActive, isRTL, t, handleItemClick)
                      : renderExpandedItem(item, isActive, isExpanded, hasSubItems, isRTL, t, ChevronIcon, toggleExpanded, handleItemClick, location)
                    }
                  </div>
                )
              })}
            </nav>
          </TooltipProvider>
        </ScrollArea>
      </aside>

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <>
          <button
            type="button"
            aria-label={t('common.closeSidebar')}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity duration-300 border-0 p-0 cursor-pointer"
            onClick={() => setSidebarOpen(false)}
          />
          <aside // NOSONAR S6855 - Event listeners needed for mobile sidebar interaction (stopPropagation and Escape key)
            className={cn(
              "fixed top-16 h-[calc(100vh-4rem)] bg-card/95 backdrop-blur-md border border-border/50 shadow-2xl z-50",
              "transition-transform duration-300 ease-in-out w-64",
              // RTL positioning
              isRTL ? "right-0" : "left-0"
            )}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSidebarOpen(false);
              }
            }}
          >
            <ScrollArea className="h-full">
              <nav className={cn("flex flex-col gap-1 p-3", getGlassClasses())}>
                {navigationItems.map((item) => {
                  const isActive = location.pathname.startsWith(item.href)
                  const isExpanded = expandedItems.includes(item.key)
                  const hasSubItems = item.subItems && item.subItems.length > 0
                  
                  return renderMobileItem(item, isActive, isExpanded, hasSubItems, isRTL, t, ChevronIcon, toggleExpanded, handleItemClick, location)
                })}
              </nav>
            </ScrollArea>
          </aside>
        </>
      )}
    </>
  )
}