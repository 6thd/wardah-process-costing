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
  BookOpen,
  Users // Add Users icon for HR
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

const getNavigationItems = (t: (key: string) => string) => [
  {
    key: 'dashboard',
    icon: LayoutDashboard,
    href: '/dashboard',
    badge: null,
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
    badge: '2', // Active MOs
    subItems: [
      { key: 'overview', href: '/manufacturing/overview', label: t('navigation.overview') },
      { key: 'orders', href: '/manufacturing/orders', label: t('navigation.orders') },
      { key: 'process-costing', href: '/manufacturing/process-costing', label: t('navigation.process-costing') },
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
    badge: '3', // Pending POs
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
    key: 'general-ledger',
    icon: BookOpen,
    href: '/general-ledger',
    badge: null,
    subItems: [
      { key: 'overview', href: '/general-ledger/overview', label: t('navigation.overview') },
      { key: 'accounts', href: '/general-ledger/accounts', label: t('navigation.accounts') },
      { key: 'entries', href: '/general-ledger/entries', label: t('navigation.entries') },
      { key: 'trial-balance', href: '/general-ledger/trial-balance', label: t('navigation.trial-balance') },
      { key: 'posting', href: '/general-ledger/posting', label: t('navigation.posting') }
    ]
  },
  {
    key: 'hr', // Add HR module to navigation
    icon: Users,
    href: '/hr',
    badge: null,
    subItems: [
      { key: 'overview', href: '/hr/overview', label: t('navigation.overview') },
      { key: 'employees', href: '/hr/employees', label: t('navigation.employees') },
      { key: 'departments', href: '/hr/departments', label: t('navigation.departments') },
      { key: 'positions', href: '/hr/positions', label: t('navigation.positions') },
      { key: 'payroll', href: '/hr/payroll', label: t('navigation.payroll') },
      { key: 'attendance', href: '/hr/attendance', label: t('navigation.attendance') },
      { key: 'leave-types', href: '/hr/leave-types', label: t('navigation.leave-types') },
      { key: 'reports', href: '/hr/reports', label: t('navigation.reports') }
    ]
  },
  {
    key: 'reports',
    icon: BarChart3,
    href: '/reports',
    badge: null,
    subItems: [
      { key: 'financial', href: '/reports/financial', label: t('navigation.financial') },
      { key: 'inventory', href: '/reports/inventory', label: t('navigation.inventory') },
      { key: 'manufacturing', href: '/reports/manufacturing', label: t('navigation.manufacturing') },
      { key: 'sales', href: '/reports/sales', label: t('navigation.sales') },
      { key: 'purchasing', href: '/reports/purchasing', label: t('navigation.purchasing') },
      { key: 'analytics', href: '/reports/analytics', label: t('navigation.analytics') }
    ]
  },
  {
    key: 'settings',
    icon: Settings,
    href: '/settings',
    badge: null,
    subItems: [
      { key: 'company', href: '/settings/company', label: t('navigation.company') },
      { key: 'users', href: '/settings/users', label: t('navigation.users') },
      { key: 'permissions', href: '/settings/permissions', label: t('navigation.permissions') },
      { key: 'system', href: '/settings/system', label: t('navigation.system') },
      { key: 'integrations', href: '/settings/integrations', label: t('navigation.integrations') },
      { key: 'backup', href: '/settings/backup', label: t('navigation.backup') }
    ]
  },
]

export function Sidebar() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const { sidebarCollapsed, sidebarOpen, setSidebarOpen } = useUIStore()

  const isRTL = i18n.language === 'ar'
  const ChevronIcon = isRTL ? ChevronLeft : ChevronRight

  const handleItemClick = () => {
    // Close mobile sidebar when item is clicked
    if (window.innerWidth < 1024) {
      setSidebarOpen(false)
    }
  }

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "fixed top-16 z-40 h-[calc(100vh-4rem)] bg-card border border-border transition-all duration-300",
          sidebarCollapsed ? "w-16" : "w-64",
          "hidden lg:block",
          // RTL positioning
          isRTL ? (
            sidebarCollapsed ? "right-0" : "right-0"
          ) : (
            sidebarCollapsed ? "left-0" : "left-0"
          ),
          // RTL border
          isRTL ? "border-l border-r-0" : "border-r border-l-0"
        )}
      >
        <ScrollArea className="h-full">
          <nav className="flex flex-col gap-2 p-4">
            {navigationItems.map((item) => {
              const Icon = item.icon
              const isActive = location.pathname.startsWith(item.href)
              
              return (
                <div key={item.key}>
                  <NavLink
                    to={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                      "hover:bg-accent hover:text-accent-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "bg-primary text-primary-foreground hover:bg-primary/90",
                      sidebarCollapsed && "justify-center px-2",
                      // RTL text alignment
                      isRTL ? "text-right" : "text-left"
                    )}
                    onClick={handleItemClick}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    
                    {!sidebarCollapsed && (
                      <>
                        <span className={cn(
                          "flex-1",
                          isRTL ? "text-right" : "text-left"
                        )}>
                          {t(`navigation.${item.key}`)}
                        </span>
                        
                        {item.badge && (
                          <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                            {item.badge}
                          </Badge>
                        )}
                        
                        {isActive && (
                          <ChevronIcon className="h-4 w-4 flex-shrink-0" />
                        )}
                      </>
                    )}
                    
                    {sidebarCollapsed && item.badge && (
                      <Badge className={cn(
                        "absolute h-5 w-5 rounded-full p-0 text-xs",
                        isRTL ? "-left-1 -top-1" : "-right-1 -top-1"
                      )}>
                        {item.badge}
                      </Badge>
                    )}
                  </NavLink>
                  
                  {!sidebarCollapsed && isActive && item.subItems && item.subItems.length > 0 && (
                    <div className="ml-8 mt-1 space-y-1">
                      {item.subItems.map((subItem) => (
                        <NavLink
                          key={subItem.key}
                          to={subItem.href}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors",
                            "hover:bg-accent hover:text-accent-foreground",
                            location.pathname === subItem.href
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground"
                          )}
                          onClick={handleItemClick}
                        >
                          <span>{subItem.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* Mobile Sidebar */}
      <aside
        className={cn(
          "fixed top-16 z-50 h-[calc(100vh-4rem)] w-64 bg-card border border-border transition-transform duration-300 lg:hidden",
          sidebarOpen 
            ? "translate-x-0" 
            : isRTL 
              ? "translate-x-full" 
              : "-translate-x-full",
          // RTL positioning
          isRTL ? "right-0 border-l border-r-0" : "left-0 border-r border-l-0"
        )}
      >
        <ScrollArea className="h-full">
          <nav className="flex flex-col gap-2 p-4">
            {navigationItems.map((item) => {
              const Icon = item.icon
              const isActive = location.pathname.startsWith(item.href)
              
              return (
                <div key={item.key}>
                  <NavLink
                    to={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                      "hover:bg-accent hover:text-accent-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "bg-primary text-primary-foreground hover:bg-primary/90",
                      // RTL text alignment
                      isRTL ? "text-right" : "text-left"
                    )}
                    onClick={handleItemClick}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span className={cn(
                      "flex-1",
                      isRTL ? "text-right" : "text-left"
                    )}>
                      {t(`navigation.${item.key}`)}
                    </span>
                    
                    {item.badge && (
                      <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                        {item.badge}
                      </Badge>
                    )}
                    
                    {isActive && (
                      <ChevronIcon className="h-4 w-4 flex-shrink-0" />
                    )}
                  </NavLink>
                  
                  {isActive && item.subItems && item.subItems.length > 0 && (
                    <div className="ml-8 mt-1 space-y-1">
                      {item.subItems.map((subItem) => (
                        <NavLink
                          key={subItem.key}
                          to={subItem.href}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors",
                            "hover:bg-accent hover:text-accent-foreground",
                            location.pathname === subItem.href
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground"
                          )}
                          onClick={handleItemClick}
                        >
                          <span>{subItem.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        </ScrollArea>
      </aside>
    </>
  )
}