import { useState } from 'react'
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
  Users
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { getGlassClasses } from '@/lib/wardah-ui-utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function Sidebar() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const { sidebarCollapsed, sidebarOpen, setSidebarOpen } = useUIStore()
  const [expandedItems, setExpandedItems] = useState<string[]>([])

  const isRTL = i18n.language === 'ar'
  const ChevronIcon = isRTL ? ChevronLeft : ChevronRight

  const toggleExpanded = (key: string) => {
    setExpandedItems(prev => 
      prev.includes(key) 
        ? prev.filter(k => k !== key) 
        : [...prev, key]
    )
  }

  const navigationItems = [
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
        { key: 'journal-entries', href: '/accounting/journal-entries', label: isRTL ? 'قيود اليومية' : 'Journal Entries' },
        { key: 'trial-balance', href: '/accounting/trial-balance', label: isRTL ? 'ميزان المراجعة' : 'Trial Balance' },
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
        { key: 'analytics', href: '/reports/analytics', label: t('navigation.analytics') },
        { key: 'gemini-dashboard', href: '/reports/gemini', label: t('navigation.gemini-dashboard') }
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
                        <div
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
        <div 
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity duration-300"
          onClick={() => setSidebarOpen(false)}
        >
          <aside
            className={cn(
              "fixed top-16 h-[calc(100vh-4rem)] bg-card/95 backdrop-blur-md border border-border/50 shadow-2xl",
              "transition-transform duration-300 ease-in-out w-64",
              // RTL positioning
              isRTL ? "right-0" : "left-0"
            )}
            onClick={(e) => e.stopPropagation()}
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
        </div>
      )}
    </>
  )
}