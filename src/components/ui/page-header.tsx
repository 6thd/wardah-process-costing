/**
 * PageHeader — رأس صفحة موحَّد (P3-UI)
 * يوحّد النمط المكرر في 41+ شاشة: عنوان + وصف + منطقة أزرار
 * RTL-aware تلقائياً عبر اتجاه المستند — لا يحتاج isRTL يدوياً
 */
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  readonly title: React.ReactNode
  readonly description?: React.ReactNode
  /** أزرار/عناصر تُعرض في الطرف المقابل للعنوان */
  readonly actions?: React.ReactNode
  /** أيقونة اختيارية بجانب العنوان */
  readonly icon?: React.ReactNode
  readonly className?: string
  /** إخفاء الرأس عند الطباعة (افتراضي: true — التقرير نفسه له رأسه) */
  readonly hideOnPrint?: boolean
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
  hideOnPrint = true
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-4',
        hideOnPrint && 'print:hidden',
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          {icon && <span className="text-muted-foreground [&>svg]:h-7 [&>svg]:w-7">{icon}</span>}
          <span className="truncate">{title}</span>
        </h1>
        {description && (
          <p className="text-muted-foreground mt-2 max-w-3xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

export default PageHeader
