import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ItemUomStatusBadgeProps {
  /** When true (default) the badge links to the UoM repair screen. */
  readonly withLink?: boolean
  readonly className?: string
}

/**
 * Shared "needs unit setup" marker for item pickers across inventory, purchasing
 * and manufacturing. Renders a warning badge that navigates to the UoM repair
 * screen so the user is never left at a raw RPC error.
 */
export function ItemUomStatusBadge({ withLink = true, className }: ItemUomStatusBadgeProps) {
  const badge = (
    <Badge variant="outline" className={cn('border-amber-500 text-amber-600', className)}>
      يحتاج إعداد وحدة
    </Badge>
  )

  if (!withLink) return badge

  return (
    <Link
      to="/inventory/uom-issues"
      onClick={(event) => event.stopPropagation()}
      className="inline-flex"
      title="فتح شاشة إصلاح وحدات الأصناف"
    >
      {badge}
    </Link>
  )
}
