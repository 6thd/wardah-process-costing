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
  BookOpen
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

const navigationItems = [
  {
    key: 'dashboard',
    icon: LayoutDashboard,
    href: '/dashboard',
    badge: null,
    subItems: [
      { key: 'overview', href: '/dashboard/overview', label: 'نظرة عامة' },
      { key: 'analytics', href: '/dashboard/analytics', label: 'التحليلات' },
      { key: 'performance', href: '/dashboard/performance', label: 'الأداء' }
    ]
  },
  {
    key: 'manufacturing',
    icon: Factory,
    href: '/manufacturing',
    badge: '2', // Active MOs
    subItems: [
      { key: 'overview', href: '/manufacturing/overview', label: 'نظرة عامة' },
      { key: 'orders', href: '/manufacturing/orders', label: 'أوامر التصنيع' },
      { key: 'process-costing', href: '/manufacturing/process-costing', label: 'تكاليف المراحل' },
      { key: 'workcenters', href: '/manufacturing/workcenters', label: 'مراكز العمل' },
      { key: 'bom', href: '/manufacturing/bom', label: 'قوائم المواد' },
      { key: 'quality', href: '/manufacturing/quality', label: 'ضبط الجودة' }
    ]
  },
  {
    key: 'inventory',
    icon: Package,
    href: '/inventory',
    badge: null,
    subItems: [
      { key: 'overview', href: '/inventory/overview', label: 'نظرة عامة' },
      { key: 'items', href: '/inventory/items', label: 'الأصناف' },
      { key: 'movements', href: '/inventory/movements', label: 'حركات المخزون' },
      { key: 'adjustments', href: '/inventory/adjustments', label: 'التسويات' },
      { key: 'valuation', href: '/inventory/valuation', label: 'تقييم المخزون' },
      { key: 'locations', href: '/inventory/locations', label: 'مواقع التخزين' }
    ]
  },
  {
    key: 'purchasing',
    icon: ShoppingCart,
    href: '/purchasing',
    badge: '3', // Pending POs
    subItems: [
      { key: 'overview', href: '/purchasing/overview', label: 'نظرة عامة' },
      { key: 'suppliers', href: '/purchasing/suppliers', label: 'الموردين' },
      { key: 'orders', href: '/purchasing/orders', label: 'أوامر الشراء' },
      { key: 'receipts', href: '/purchasing/receipts', label: 'استلام البضائع' },
      { key: 'invoices', href: '/purchasing/invoices', label: 'فواتير الموردين' },
      { key: 'payments', href: '/purchasing/payments', label: 'المدفوعات' }
    ]
  },
  {
    key: 'sales',
    icon: DollarSign,
    href: '/sales',
    badge: null,
    subItems: [
      { key: 'overview', href: '/sales/overview', label: 'نظرة عامة' },
      { key: 'customers', href: '/sales/customers', label: 'العملاء' },
      { key: 'orders', href: '/sales/orders', label: 'أوامر البيع' },
      { key: 'invoices', href: '/sales/invoices', label: 'فواتير المبيعات' },
      { key: 'delivery', href: '/sales/delivery', label: 'التسليم' },
      { key: 'collections', href: '/sales/collections', label: 'التحصيلات' }
    ]
  },
  {
    key: 'general-ledger',
    icon: BookOpen,
    href: '/general-ledger',
    badge: null,
    subItems: [
      { key: 'overview', href: '/general-ledger/overview', label: 'نظرة عامة' },
      { key: 'accounts', href: '/general-ledger/accounts', label: 'شجرة الحسابات' },
      { key: 'entries', href: '/general-ledger/entries', label: 'القيود اليومية' },
      { key: 'trial-balance', href: '/general-ledger/trial-balance', label: 'ميزان المراجعة' },
      { key: 'posting', href: '/general-ledger/posting', label: 'إدارة النشر' }
    ]
  },
  {
    key: 'reports',
    icon: BarChart3,
    href: '/reports',
    badge: null,
    subItems: [
      { key: 'financial', href: '/reports/financial', label: 'التقارير المالية' },
      { key: 'inventory', href: '/reports/inventory', label: 'تقارير المخزون' },
      { key: 'manufacturing', href: '/reports/manufacturing', label: 'تقارير التصنيع' },
      { key: 'sales', href: '/reports/sales', label: 'تقارير المبيعات' },
      { key: 'purchasing', href: '/reports/purchasing', label: 'تقارير المشتريات' },
      { key: 'analytics', href: '/reports/analytics', label: 'التحليلات المتقدمة' }
    ]
  },
  {
    key: 'settings',
    icon: Settings,
    href: '/settings',
    badge: null,
    subItems: [
      { key: 'company', href: '/settings/company', label: 'بيانات الشركة' },
      { key: 'users', href: '/settings/users', label: 'المستخدمين' },
      { key: 'permissions', href: '/settings/permissions', label: 'الصلاحيات' },
      { key: 'system', href: '/settings/system', label: 'إعدادات النظام' },
      { key: 'integrations', href: '/settings/integrations', label: 'التكاملات' },
      { key: 'backup', href: '/settings/backup', label: 'النسخ الاحتياطي' }
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
                <NavLink
                  key={item.key}
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
                <NavLink
                  key={item.key}
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
              )
            })}
          </nav>
        </ScrollArea>
      </aside>
    </>
  )
}