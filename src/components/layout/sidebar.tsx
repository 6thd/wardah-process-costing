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
  ChevronLeft
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
  },
  {
    key: 'manufacturing',
    icon: Factory,
    href: '/manufacturing',
    badge: '2', // Active MOs
  },
  {
    key: 'inventory',
    icon: Package,
    href: '/inventory',
    badge: null,
  },
  {
    key: 'purchasing',
    icon: ShoppingCart,
    href: '/purchasing',
    badge: '3', // Pending POs
  },
  {
    key: 'sales',
    icon: DollarSign,
    href: '/sales',
    badge: null,
  },
  {
    key: 'reports',
    icon: BarChart3,
    href: '/reports',
    badge: null,
  },
  {
    key: 'settings',
    icon: Settings,
    href: '/settings',
    badge: null,
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