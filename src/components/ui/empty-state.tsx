/**
 * EmptyState — حالة فارغة موحَّدة (P3-UI)
 * أفضل ممارسة: الحالة الفارغة ليست "لا بيانات" فقط —
 * بل توجيه: ماذا تعني؟ وما الخطوة التالية؟
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Inbox } from 'lucide-react'

export interface EmptyStateProps {
  /** أيقونة معبّرة عن السياق (افتراضي: صندوق فارغ) */
  readonly icon?: React.ReactNode
  readonly title: React.ReactNode
  /** شرح قصير: لماذا فارغ وما الذي يملؤه */
  readonly description?: React.ReactNode
  /** زر إجراء (مثال: "أنشئ أول أمر تصنيع") */
  readonly action?: React.ReactNode
  readonly className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-16 px-6',
        className
      )}
      role="status"
    >
      <div className="text-muted-foreground/40 mb-4 [&>svg]:h-12 [&>svg]:w-12">
        {icon ?? <Inbox aria-hidden="true" />}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mt-1.5 max-w-md">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export default EmptyState
