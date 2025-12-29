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

import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { usePermissions } from '@/hooks/usePermissions'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { getGlassClasses } from '@/lib/wardah-ui-utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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
        { key: 'overview', href: '/dashboard/overview', label: t('navigation.overview') },
        { key: 'analytics', href: '/dashboard/analytics', label: t('navigation.analytics') },
        { key: 'performance', href: '/dashboard/performance', label: t('navigation.performance') }
      ]
    },
    {
      key: 'manufacturing',
      icon: Factory,
      href: '/manufacturing',
      badge: '2',
      moduleCode: MODULE_CODES.MANUFACTURING,
      subItems: [
        { key: 'overview', href: '/manufacturing/overview', label: t('navigation.overview') },
        { key: 'orders', href: '/manufacturing/orders', label: t('navigation.orders') },
        { key: 'mes', href: '/manufacturing/mes', label: isRTL ? 'تنفيذ التصنيع (MES)' : 'MES Dashboard' },
        { key: 'routing', href: '/manufacturing/routing', label: isRTL ? 'مسارات التصنيع' : 'Routings' },
        { key: 'capacity', href: '/manufacturing/capacity', label: isRTL ? 'تخطيط الطاقة' : 'Capacity Planning' },
        { key: 'efficiency', href: '/manufacturing/efficiency', label: isRTL ? 'الكفاءة والأداء' : 'Efficiency & OEE' },
        { key: 'process-costing', href: '/manufacturing/process-costing', label: t('navigation.process-costing') },
        { key: 'stages', href: '/manufacturing/stages', label: t('navigation.stages', { defaultValue: 'مراحل التصنيع' }) },
        { key: 'wip-log', href: '/manufacturing/wip-log', label: t('navigation.wipLog', { defaultValue: 'سجلات WIP' }) },
        { key: 'standard-costs', href: '/manufacturing/standard-costs', label: t('navigation.standardCosts', { defaultValue: 'التكاليف القياسية' }) },
        { key: 'workcenters', href: '/manufacturing/workcenters', label: t('navigation.workcenters') },
        { key: 'bom', href: '/manufacturing/bom', label: t('navigation.bom') },
        { key: 'quality', href: '/manufacturing/quality', label: t('navigation.quality') }
      ]
    },
    {
      key: 'inventory',
      icon: Package,
      href: '/inventory',
      badge: null,
      moduleCode: MODULE_CODES.INVENTORY,
      subItems: [
        { key: 'overview', href: '/inventory/overview', label: t('navigation.overview') },
        { key: 'items', href: '/inventory/items', label: t('navigation.items') },
        { key: 'movements', href: '/inventory/movements', label: t('navigation.movements') },
        { key: 'adjustments', href: '/inventory/adjustments', label: t('navigation.adjustments') },
        { key: 'valuation', href: '/inventory/valuation', label: t('navigation.valuation') },
        { key: 'locations', href: '/inventory/locations', label: t('navigation.locations') }
      ]
    },
    {
      key: 'purchasing',
      icon: ShoppingCart,
      href: '/purchasing',
      badge: '3',
      moduleCode: MODULE_CODES.PURCHASING,
      subItems: [
        { key: 'overview', href: '/purchasing/overview', label: t('navigation.overview') },
        { key: 'suppliers', href: '/purchasing/suppliers', label: t('navigation.suppliers') },
        { key: 'orders', href: '/purchasing/orders', label: t('navigation.orders') },
        { key: 'receipts', href: '/purchasing/receipts', label: t('navigation.receipts') },
        { key: 'invoices', href: '/purchasing/invoices', label: t('navigation.invoices') },
        { key: 'payments', href: '/purchasing/payments', label: t('navigation.payments') }
      ]
    },
    {
      key: 'sales',
      icon: DollarSign,
      href: '/sales',
      badge: null,
      moduleCode: MODULE_CODES.SALES,
      subItems: [
        { key: 'overview', href: '/sales/overview', label: t('navigation.overview') },
        { key: 'customers', href: '/sales/customers', label: t('navigation.customers') },
        { key: 'orders', href: '/sales/orders', label: t('navigation.orders') },
        { key: 'invoices', href: '/sales/invoices', label: t('navigation.invoices') },
        { key: 'delivery', href: '/sales/delivery', label: t('navigation.delivery') },
        { key: 'collections', href: '/sales/collections', label: t('navigation.collections') }
      ]
    },
    {
      key: 'accounting',
      icon: BookOpen,
      href: '/accounting',
      badge: null,
      moduleCode: MODULE_CODES.ACCOUNTING,
      subItems: [
        { key: 'overview', href: '/accounting/overview', label: isRTL ? 'نظرة عامة' : 'Overview' },
        { key: 'chart-of-accounts', href: '/general-ledger/accounts', label: isRTL ? 'دليل الحسابات' : 'Chart of Accounts' },
        { key: 'journal-entries', href: '/accounting/journal-entries', label: isRTL ? 'قيود اليومية' : 'Journal Entries' },
        { key: 'trial-balance', href: '/accounting/trial-balance', label: isRTL ? 'ميزان المراجعة' : 'Trial Balance' },
        { key: 'account-statement', href: '/accounting/account-statement', label: isRTL ? 'كشف حساب' : 'Account Statement' },
        { key: 'posting', href: '/accounting/posting', label: isRTL ? 'الترحيل' : 'Posting' }
      ]
    },
    {
      key: 'general-ledger',
      icon: BookOpen,
      href: '/general-ledger',
      badge: null,
      moduleCode: MODULE_CODES.GENERAL_LEDGER,
      subItems: [
        { key: 'accounts', href: '/general-ledger/accounts', label: isRTL ? 'دليل الحسابات' : 'Chart of Accounts' },
        { key: 'account-statement', href: '/general-ledger/account-statement', label: isRTL ? 'كشف حساب' : 'Account Statement' }
      ]
    },
    {
      key: 'hr',
      icon: Users,
      href: '/hr',
      badge: null,
      moduleCode: MODULE_CODES.HR,
      subItems: [
        { key: 'overview', href: '/hr/overview', label: isRTL ? 'لوحة التحكم' : 'Dashboard' },
        { key: 'employees', href: '/hr/employees', label: isRTL ? 'الموظفون' : 'Employees' },
        { key: 'attendance', href: '/hr/attendance', label: isRTL ? 'الحضور' : 'Attendance' },
        { key: 'payroll', href: '/hr/payroll', label: isRTL ? 'الرواتب' : 'Payroll' },
        { key: 'leaves', href: '/hr/leaves', label: isRTL ? 'الإجازات' : 'Leaves' },
        { key: 'settlements', href: '/hr/settlements', label: isRTL ? 'التسويات' : 'Settlements' },
        { key: 'reports', href: '/hr/reports', label: isRTL ? 'التقارير' : 'Reports' },
        { key: 'settings', href: '/hr/settings', label: isRTL ? 'الإعدادات' : 'Settings' }
      ]
    },
    {
      key: 'reports',
      icon: BarChart3,
      href: '/reports',
      badge: null,
      moduleCode: MODULE_CODES.REPORTS,
      subItems: [
        { key: 'financial', href: '/reports/financial', label: t('navigation.financial') },
        { key: 'inventory', href: '/reports/inventory', label: t('navigation.inventory') },
        { key: 'manufacturing', href: '/reports/manufacturing', label: t('navigation.manufacturing') },
        { key: 'process-costing-dashboard', href: '/reports/process-costing-dashboard', label: isRTL ? 'لوحة تكاليف المراحل' : 'Process Costing Dashboard' },
        { key: 'sales', href: '/reports/sales', label: t('navigation.sales') },
        { key: 'purchasing', href: '/reports/purchasing', label: t('navigation.purchasing') },
        { key: 'analytics', href: '/reports/analytics', label: t('navigation.analytics') },
        { key: 'gemini-dashboard', href: '/reports/gemini', label: t('navigation.gemini-dashboard') }
      ]
    },
    {
      key: 'settings',
      icon: Settings,
      href: '/settings',
      badge: null,
      moduleCode: MODULE_CODES.SETTINGS,
      subItems: [
        { key: 'company', href: '/settings/company', label: t('navigation.company') },
        { key: 'users', href: '/settings/users', label: t('navigation.users') },
        { key: 'permissions', href: '/settings/permissions', label: t('navigation.permissions') },
        { key: 'system', href: '/settings/system', label: t('navigation.system') },
        { key: 'integrations', href: '/settings/integrations', label: t('navigation.integrations') },
        { key: 'backup', href: '/settings/backup', label: t('navigation.backup') }
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
        { key: 'dashboard', href: '/org-admin/dashboard', label: isRTL ? 'لوحة التحكم' : 'Dashboard' },
        { key: 'users', href: '/org-admin/users', label: isRTL ? 'المستخدمين' : 'Users' },
        { key: 'invitations', href: '/org-admin/invitations', label: isRTL ? 'الدعوات' : 'Invitations' },
        { key: 'roles', href: '/org-admin/roles', label: isRTL ? 'الأدوار' : 'Roles' },
        { key: 'audit-log', href: '/org-admin/audit-log', label: isRTL ? 'سجل التدقيق' : 'Audit Log' }
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
        { key: 'dashboard', href: '/super-admin/dashboard', label: isRTL ? 'لوحة التحكم' : 'Dashboard' },
        { key: 'organizations', href: '/super-admin/organizations', label: isRTL ? 'المنظمات' : 'Organizations' }
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
                const Icon = item.icon
                const isActive = location.pathname.startsWith(item.href)
                const isExpanded = expandedItems.includes(item.key)
                const hasSubItems = item.subItems && item.subItems.length > 0
                
                return (
                  <div key={item.key} className="space-y-1">
                    {sidebarCollapsed ? (
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
                    ) : (
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
                          onClick={() => {
                            if (hasSubItems) {
                              toggleExpanded(item.key)
                            } else {
                              handleItemClick()
                            }
                          }}
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
                              {item.subItems.map((subItem) => {
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
                                      {subItem.label}
                                    </span>
                                  </NavLink>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
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
            aria-label="إغلاق القائمة الجانبية"
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
                  const Icon = item.icon
                  const isActive = location.pathname.startsWith(item.href)
                  const isExpanded = expandedItems.includes(item.key)
                  const hasSubItems = item.subItems && item.subItems.length > 0
                  
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
                        onClick={() => {
                          if (hasSubItems) {
                            toggleExpanded(item.key)
                          } else {
                            handleItemClick()
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (hasSubItems) {
                              toggleExpanded(item.key)
                            } else {
                              handleItemClick()
                            }
                          }
                        }}
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
                            {item.subItems.map((subItem) => {
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
                                    {subItem.label}
                                  </span>
                                </NavLink>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </nav>
            </ScrollArea>
          </aside>
        </>
      )}
    </>
  )
}