/**
 * اختبارات مكوّنات الحالة الموحَّدة (P3-UI)
 * PageHeader + EmptyState + ErrorState + LoadingState
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PageHeader } from '../page-header'
import { EmptyState } from '../empty-state'
import { ErrorState } from '../error-state'
import { TableSkeleton, CardSkeleton, ReportSkeleton } from '../loading-state'
import { FileBarChart } from 'lucide-react'

describe('PageHeader', () => {
  it('يعرض العنوان والوصف', () => {
    render(<PageHeader title="تقرير التسوية" description="مقارنة الأرصدة" />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('تقرير التسوية')
    expect(screen.getByText('مقارنة الأرصدة')).toBeInTheDocument()
  })

  it('يعرض منطقة الأزرار عند تمريرها', () => {
    render(<PageHeader title="عنوان" actions={<button type="button">طباعة</button>} />)

    expect(screen.getByRole('button', { name: 'طباعة' })).toBeInTheDocument()
  })

  it('مخفي عند الطباعة افتراضياً وقابل للتعطيل', () => {
    const { container, rerender } = render(<PageHeader title="عنوان" />)
    expect(container.firstElementChild?.className).toContain('print:hidden')

    rerender(<PageHeader title="عنوان" hideOnPrint={false} />)
    expect(container.firstElementChild?.className).not.toContain('print:hidden')
  })
})

describe('EmptyState', () => {
  it('يعرض العنوان والوصف والإجراء بدور status', () => {
    render(
      <EmptyState
        icon={<FileBarChart />}
        title="لا توجد بيانات"
        description="أنشئ أول سجل للبدء"
        action={<button type="button">إنشاء</button>}
      />
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument()
    expect(screen.getByText('أنشئ أول سجل للبدء')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'إنشاء' })).toBeInTheDocument()
  })

  it('يعمل بأيقونة افتراضية بدون props اختيارية', () => {
    render(<EmptyState title="فارغ" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  it('يعرض الرسالة بدور alert مع زر إعادة المحاولة', () => {
    const onRetry = vi.fn()
    render(<ErrorState title="فشل التحميل" message="MO_NOT_FOUND" onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('MO_NOT_FOUND')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('بدون onRetry لا يظهر زر', () => {
    render(<ErrorState message="خطأ ما" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('LoadingState skeletons', () => {
  it('TableSkeleton يعرض عدد الصفوف المطلوب بدور output', () => {
    const { container } = render(<TableSkeleton rows={3} />)
    expect(container.querySelector('output')).toBeInTheDocument()
    // رأس + 3 صفوف = 4 عناصر skeleton
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4)
  })

  it('CardSkeleton وReportSkeleton يُعرضان بدون أخطاء', () => {
    const { container: c1 } = render(<CardSkeleton />)
    const { container: c2 } = render(<ReportSkeleton />)
    expect(c1.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(c2.querySelector('output')).toBeInTheDocument()
  })
})
