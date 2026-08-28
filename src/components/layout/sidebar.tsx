import { useState, type KeyboardEvent } from 'react'
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
  Shield,
  type LucideIcon,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { usePermissions } from '@/hooks/usePermissions'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getGlassClasses } from '@/lib/wardah-ui-utils'
import {
  getVisibleProductNavigation,
  type ProductCatalogItem,
  type ProductIconKey,
} from '@/config/product-catalog'

const PRODUCT_ICONS: Record<ProductIconKey, LucideIcon> = {
  LayoutDashboard,
  Factory,
  Package,
  ShoppingCart,
  DollarSign,
  BookOpen,
  Users,
  BarChart3,
  Settings,
  Building2,
  Shield,
}

function getItemIcon(item: ProductCatalogItem): LucideIcon {
  return item.icon ? PRODUCT_ICONS[item.icon] : LayoutDashboard
}

function isItemActive(item: ProductCatalogItem, pathname: string): boolean {
  if (pathname.startsWith(item.href)) return true
  return item.children?.some(child => pathname.startsWith(child.href)) ?? false
}

function renderCollapsedItem(
  item: ProductCatalogItem,
  isActive: boolean,
  isRTL: boolean,
  t: (key: string) => string,
  handleItemClick: () => void,
) {
  const Icon = getItemIcon(item)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={item.landingHref ?? item.href}
          className={cn(
            'flex items-center justify-center p-3 rounded-lg text-sm font-medium transition-all duration-200',
            'hover:bg-accent/50 hover:scale-105',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            isActive && 'bg-primary text-primary-foreground shadow-md hover:bg-primary/90',
          )}
          onClick={handleItemClick}
        >
          <Icon className="h-5 w-5 shrink-0" />
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side={isRTL ? 'left' : 'right'} className="font-medium">
        {t(item.labelKey)}
      </TooltipContent>
    </Tooltip>
  )
}

function renderChildren(
  item: ProductCatalogItem,
  isExpanded: boolean,
  isRTL: boolean,
  t: (key: string) => string,
  ChevronIcon: LucideIcon,
  handleItemClick: () => void,
  pathname: string,
) {
  if (!item.children?.length) return null

  return (
    <div
      className={cn(
        'overflow-hidden transition-all duration-300 ease-in-out',
        isExpanded ? 'max-h-[42rem] opacity-100' : 'max-h-0 opacity-0',
        isRTL ? 'mr-4 pr-3 border-r-2 border-border/30' : 'ml-4 pl-3 border-l-2 border-border/30',
      )}
    >
      <div className="space-y-0.5 py-1">
        {item.children.map(child => {
          const isSubActive = pathname === child.href || pathname.startsWith(`${child.href}/`)
          return (
            <NavLink
              key={`${child.moduleCode}:${child.key}:${child.href}`}
              to={child.href}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-all duration-150',
                'text-muted-foreground hover:text-foreground hover:bg-accent/30 hover:translate-x-1',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSubActive && 'text-primary font-semibold bg-primary/10 border-l-2 border-primary',
                isRTL && 'hover:-translate-x-1',
              )}
              onClick={handleItemClick}
            >
              <ChevronIcon className="h-3 w-3 shrink-0 opacity-60" />
              <span className={cn('flex-1 truncate', isRTL ? 'text-right' : 'text-left')}>
                {t(child.labelKey)}
              </span>
            </NavLink>
          )
        })}
      </div>
    </div>
  )
}

function renderExpandedItem(
  item: ProductCatalogItem,
  isActive: boolean,
  isExpanded: boolean,
  isRTL: boolean,
  t: (key: string) => string,
  ChevronIcon: LucideIcon,
  toggleExpanded: (key: string) => void,
  handleItemClick: () => void,
  pathname: string,
) {
  const Icon = getItemIcon(item)
  const hasChildren = Boolean(item.children?.length)
  const landingHref = item.landingHref ?? item.href

  const itemClassName = cn(
    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group border-0',
    'hover:bg-accent/50 hover:shadow-sm',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isActive && 'bg-primary text-primary-foreground shadow-md hover:bg-primary/90',
    isRTL ? 'text-right' : 'text-left',
  )

  const itemContent = (
    <>
      <Icon className="h-5 w-5 shrink-0 transition-transform group-hover:scale-110" />
      <span className={cn('flex-1 truncate', isRTL ? 'text-right' : 'text-left')}>
        {t(item.labelKey)}
      </span>
      {hasChildren && (
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 transition-transform duration-200',
            isExpanded && 'rotate-180',
            isRTL && 'rotate-180',
          )}
        />
      )}
    </>
  )

  return (
    <>
      {hasChildren ? (
        <button type="button" className={itemClassName} onClick={() => toggleExpanded(item.key)}>
          {itemContent}
        </button>
      ) : (
        <NavLink to={landingHref} className={itemClassName} onClick={handleItemClick}>
          {itemContent}
        </NavLink>
      )}
      {renderChildren(item, isExpanded, isRTL, t, ChevronIcon, handleItemClick, pathname)}
    </>
  )
}

function renderMobileItem(
  item: ProductCatalogItem,
  isActive: boolean,
  isExpanded: boolean,
  isRTL: boolean,
  t: (key: string) => string,
  ChevronIcon: LucideIcon,
  toggleExpanded: (key: string) => void,
  handleItemClick: () => void,
  pathname: string,
) {
  const Icon = getItemIcon(item)
  const hasChildren = Boolean(item.children?.length)
  const landingHref = item.landingHref ?? item.href

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleExpanded(item.key)
    }
  }

  const itemClassName = cn(
    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group',
    'hover:bg-accent/50 hover:shadow-sm',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isActive && 'bg-primary text-primary-foreground shadow-md hover:bg-primary/90',
    isRTL ? 'text-right' : 'text-left',
  )

  const itemContent = (
    <>
      <Icon className="h-5 w-5 shrink-0 transition-transform group-hover:scale-110" />
      <span className={cn('flex-1 truncate', isRTL ? 'text-right' : 'text-left')}>
        {t(item.labelKey)}
      </span>
      {hasChildren && (
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 transition-transform duration-200',
            isExpanded && 'rotate-180',
            isRTL && 'rotate-180',
          )}
        />
      )}
    </>
  )

  return (
    <div key={item.key} className="space-y-1">
      {hasChildren ? (
        <div
          role="menuitem"
          tabIndex={0}
          className={cn(itemClassName, 'cursor-pointer')}
          onClick={() => toggleExpanded(item.key)}
          onKeyDown={handleKeyDown}
        >
          {itemContent}
        </div>
      ) : (
        <NavLink to={landingHref} role="menuitem" className={itemClassName} onClick={handleItemClick}>
          {itemContent}
        </NavLink>
      )}
      {renderChildren(item, isExpanded, isRTL, t, ChevronIcon, handleItemClick, pathname)}
    </div>
  )
}

export function Sidebar() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const { sidebarCollapsed, sidebarOpen, setSidebarOpen } = useUIStore()
  const [expandedItems, setExpandedItems] = useState<string[]>([])
  const { isOrgAdmin, isSuperAdmin, hasPermissionKey } = usePermissions()

  const isRTL = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith('ar')
  const ChevronIcon = isRTL ? ChevronLeft : ChevronRight

  const navigationItems = getVisibleProductNavigation({
    isOrgAdmin,
    isSuperAdmin,
    hasPermissionKey,
  })

  const toggleExpanded = (key: string) => {
    setExpandedItems(previous =>
      previous.includes(key) ? previous.filter(itemKey => itemKey !== key) : [...previous, key],
    )
  }

  const handleItemClick = () => {
    if (globalThis.window.innerWidth < 1024) setSidebarOpen(false)
  }

  return (
    <>
      <aside
        className={cn(
          'fixed top-16 z-40 h-[calc(100vh-4rem)] bg-card/95 backdrop-blur-sm border border-border/50 transition-all duration-300 shadow-lg',
          sidebarCollapsed ? 'w-16' : 'w-64',
          'hidden lg:block',
          isRTL ? 'right-0' : 'left-0',
          isRTL ? 'border-l border-r-0' : 'border-r border-l-0',
        )}
      >
        <ScrollArea className="h-full">
          <TooltipProvider delayDuration={300}>
            <nav className={cn('flex flex-col gap-1 p-3', getGlassClasses())}>
              {navigationItems.map(item => {
                const isActive = isItemActive(item, location.pathname)
                const isExpanded = expandedItems.includes(item.key)
                return (
                  <div key={item.key} className="space-y-1">
                    {sidebarCollapsed
                      ? renderCollapsedItem(item, isActive, isRTL, t, handleItemClick)
                      : renderExpandedItem(
                          item,
                          isActive,
                          isExpanded,
                          isRTL,
                          t,
                          ChevronIcon,
                          toggleExpanded,
                          handleItemClick,
                          location.pathname,
                        )}
                  </div>
                )
              })}
            </nav>
          </TooltipProvider>
        </ScrollArea>
      </aside>

      {sidebarOpen && (
        <>
          <button
            type="button"
            aria-label={t('common.closeSidebar')}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity duration-300 border-0 p-0 cursor-pointer"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className={cn(
              'fixed top-16 h-[calc(100vh-4rem)] bg-card/95 backdrop-blur-md border border-border/50 shadow-2xl z-50',
              'transition-transform duration-300 ease-in-out w-64',
              isRTL ? 'right-0' : 'left-0',
            )}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'Escape') setSidebarOpen(false)
            }}
          >
            <ScrollArea className="h-full">
              <nav className={cn('flex flex-col gap-1 p-3', getGlassClasses())}>
                {navigationItems.map(item => {
                  const isActive = isItemActive(item, location.pathname)
                  const isExpanded = expandedItems.includes(item.key)
                  return renderMobileItem(
                    item,
                    isActive,
                    isExpanded,
                    isRTL,
                    t,
                    ChevronIcon,
                    toggleExpanded,
                    handleItemClick,
                    location.pathname,
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
