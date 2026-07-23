import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface UomStatusBadgeProps {
  /** When true (default) the badge links to the UoM repair screen. */
  readonly withLink?: boolean
  readonly className?: string
}

/**
 * Shared "needs unit setup" marker for product/item pickers across inventory,
 * purchasing and manufacturing. Renders a warning badge that navigates to the UoM
 * repair screen so the user is never left at a raw RPC error.
 *
 * Pass `withLink={false}` when the badge sits inside another interactive element
 * (e.g. a disabled picker button); nesting a link inside a disabled button is
 * invalid and keyboard-inaccessible. Render a separate link next to the control.
 */
export function UomStatusBadge({ withLink = true, className }: UomStatusBadgeProps) {
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
