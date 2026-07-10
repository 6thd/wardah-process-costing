/**
 * LoadingState — حالات تحميل هيكلية موحَّدة (P3-UI)
 * أفضل ممارسة: Skeleton يطابق شكل المحتوى القادم بدلاً من spinner عام —
 * يقلل الوميض ويُشعر المستخدم أن الصفحة "تعرف" ما ستعرضه
 */
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

/** هيكل جدول: صف رأس + صفوف بيانات */
export function TableSkeleton({
  rows = 5,
  className
}: { readonly rows?: number; readonly className?: string }) {
  return (
    <output className={cn('block space-y-3', className)} aria-label="جارٍ التحميل">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </output>
  )
}

/** هيكل بطاقة تقرير: عنوان + سطور */
export function CardSkeleton({ className }: { readonly className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </CardContent>
    </Card>
  )
}

/** هيكل صفحة تقرير كاملة: بطاقتان */
export function ReportSkeleton({ className }: { readonly className?: string }) {
  return (
    <output className={cn('block space-y-6', className)} aria-label="جارٍ تحميل التقرير">
      <CardSkeleton />
      <CardSkeleton />
    </output>
  )
}
