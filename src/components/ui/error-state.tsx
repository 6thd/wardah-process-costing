/**
 * ErrorState — حالة خطأ موحَّدة (P3-UI)
 * أفضل ممارسة: الخطأ يُعرض بلغة المستخدم مع إجراء واضح (إعادة المحاولة)
 * — لا شاشة حمراء صامتة ولا [object Object]
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export interface ErrorStateProps {
  readonly title?: React.ReactNode
  /** رسالة الخطأ الفعلية — تُعرض كما هي (خدماتنا ترجع رسائل عربية واضحة) */
  readonly message?: React.ReactNode
  /** استدعاء إعادة المحاولة — إن وُجد يظهر زر */
  readonly onRetry?: () => void
  readonly retryLabel?: React.ReactNode
  readonly className?: string
}

export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel,
  className
}: ErrorStateProps) {
  return (
    <Card className={cn('border-destructive/50', className)}>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center text-center py-8 px-4" role="alert">
          <AlertTriangle className="h-10 w-10 text-destructive mb-3" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-destructive">
            {title ?? 'حدث خطأ'}
          </h3>
          {message && (
            <p className="text-sm text-muted-foreground mt-1.5 max-w-lg break-words">
              {message}
            </p>
          )}
          {onRetry && (
            <Button variant="outline" onClick={onRetry} className="mt-5 gap-2">
              <RefreshCw className="h-4 w-4" />
              {retryLabel ?? 'إعادة المحاولة'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default ErrorState
