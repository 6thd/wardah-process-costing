import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  StockAdjustmentCreateAction,
  StockAdjustmentDetailsCard,
  StockAdjustmentFilters,
  StockAdjustmentProductPicker,
  StockAdjustmentsList,
  type StockAdjustmentRecord,
} from '../StockAdjustmentSections'

const adjustment: StockAdjustmentRecord = {
  id: 'adjustment-1',
  adjustment_number: 'ADJ-001',
  adjustment_date: '2026-08-20',
  adjustment_type: 'PHYSICAL_COUNT',
  status: 'DRAFT',
  reason: 'Behavior-preserving extraction',
  reference_number: 'REF-001',
  total_items: 2,
  total_qty_difference: 3,
  total_value_difference: 15,
  requires_approval: true,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('StockAdjustmentCreateAction', () => {
  it('requires create and every reference-data read before exposing the trigger', async () => {
    const onCreate = vi.fn()
    const { rerender } = render(
      <StockAdjustmentCreateAction
        canCreateAdjustment={false}
        canOpenAdjustmentForm
        onCreate={onCreate}
      />,
    )

    expect(screen.queryByRole('button', { name: /تسوية جديدة/ })).not.toBeInTheDocument()

    rerender(
      <StockAdjustmentCreateAction
        canCreateAdjustment
        canOpenAdjustmentForm={false}
        onCreate={onCreate}
      />,
    )
    expect(screen.queryByRole('button', { name: /تسوية جديدة/ })).not.toBeInTheDocument()

    rerender(
      <StockAdjustmentCreateAction
        canCreateAdjustment
        canOpenAdjustmentForm
        onCreate={onCreate}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /تسوية جديدة/ }))
    expect(onCreate).toHaveBeenCalledOnce()
  })
})

describe('StockAdjustmentDetailsCard', () => {
  it('keeps draft actions independently gated and delegates them to the parent', async () => {
    const onEdit = vi.fn()
    const onSubmit = vi.fn()
    const onCancel = vi.fn()

    render(
      <StockAdjustmentDetailsCard
        adjustment={adjustment}
        canUpdateAdjustment
        canApproveAdjustment
        canOpenAdjustmentForm
        onClose={vi.fn()}
        onEdit={onEdit}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /تعديل/ }))
    await userEvent.click(screen.getByRole('button', { name: /ترحيل/ }))
    await userEvent.click(screen.getByRole('button', { name: /إلغاء/ }))

    expect(onEdit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not let one draft permission expose another action', () => {
    const { rerender } = render(
      <StockAdjustmentDetailsCard
        adjustment={adjustment}
        canUpdateAdjustment={false}
        canApproveAdjustment
        canOpenAdjustmentForm
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /تعديل/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ترحيل/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /إلغاء/ })).not.toBeInTheDocument()

    rerender(
      <StockAdjustmentDetailsCard
        adjustment={adjustment}
        canUpdateAdjustment
        canApproveAdjustment={false}
        canOpenAdjustmentForm={false}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /تعديل/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ترحيل/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /إلغاء/ })).toBeInTheDocument()
  })

  it('never renders write actions for a non-draft adjustment', () => {
    render(
      <StockAdjustmentDetailsCard
        adjustment={{
          ...adjustment,
          status: 'SUBMITTED',
          reference_number: null,
          total_items: 0,
          total_qty_difference: 0,
          total_value_difference: 0,
          requires_approval: false,
        }}
        canUpdateAdjustment
        canApproveAdjustment
        canOpenAdjustmentForm
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('مرحل')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /تعديل/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ترحيل/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /إلغاء/ })).not.toBeInTheDocument()
  })
})

describe('StockAdjustmentFilters', () => {
  it('preserves the status and type filter callback values', async () => {
    const onStatusChange = vi.fn()
    const onTypeChange = vi.fn()
    render(
      <StockAdjustmentFilters
        filterStatus="all"
        filterType="all"
        onStatusChange={onStatusChange}
        onTypeChange={onTypeChange}
      />,
    )

    await userEvent.selectOptions(screen.getByLabelText('الحالة'), 'DRAFT')
    await userEvent.selectOptions(screen.getByLabelText('النوع'), 'PHYSICAL_COUNT')

    expect(onStatusChange).toHaveBeenCalledWith('DRAFT')
    expect(onTypeChange).toHaveBeenCalledWith('PHYSICAL_COUNT')
  })
})

describe('StockAdjustmentProductPicker', () => {
  const product = {
    id: 'product-1',
    name: 'Mapped product',
    code: 'P-001',
    stock_quantity: 12,
  }
  const baseProps = {
    warehouseId: 'warehouse-1',
    searchTerm: '',
    showProductSearch: false,
    filteredProducts: [product],
    selectedProduct: null,
    productUomStatus: { isEnabled: false, isLoading: false, isError: false },
    productNeedsUomSetup: vi.fn(() => false),
    onSearchTermChange: vi.fn(),
    onSearchFocus: vi.fn(),
    onProductSelect: vi.fn(),
    onAddItem: vi.fn(),
  }

  it('keeps warehouse and selected-product gating while delegating input and add actions', async () => {
    const { rerender } = render(
      <StockAdjustmentProductPicker {...baseProps} warehouseId="" />,
    )

    expect(screen.getByText('يجب اختيار المخزن أولاً قبل إضافة المنتجات')).toBeInTheDocument()
    expect(screen.getByLabelText('إضافة منتج')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'إضافة' })).toBeDisabled()

    rerender(
      <StockAdjustmentProductPicker
        {...baseProps}
        selectedProduct={product}
      />,
    )
    const searchInput = screen.getByLabelText('إضافة منتج')
    await userEvent.click(searchInput)
    await userEvent.type(searchInput, 'P')
    await userEvent.click(screen.getByRole('button', { name: 'إضافة' }))

    expect(baseProps.onSearchFocus).toHaveBeenCalledOnce()
    expect(baseProps.onSearchTermChange).toHaveBeenCalledWith('P')
    expect(baseProps.onAddItem).toHaveBeenCalledOnce()
  })

  it('renders the UoM loading, error and empty-result states', () => {
    const visibleProps = {
      ...baseProps,
      searchTerm: 'product',
      showProductSearch: true,
      productUomStatus: { isEnabled: true, isLoading: true, isError: false },
    }
    const { rerender } = render(<StockAdjustmentProductPicker {...visibleProps} />)

    expect(screen.getByText('جارٍ التحقق من إعداد وحدات الأصناف…')).toBeInTheDocument()

    rerender(
      <StockAdjustmentProductPicker
        {...visibleProps}
        productUomStatus={{ isEnabled: true, isLoading: false, isError: true }}
      />,
    )
    expect(screen.getByText(/تعذّر التحقق من حالة وحدات الأصناف/)).toBeInTheDocument()

    rerender(
      <StockAdjustmentProductPicker
        {...visibleProps}
        filteredProducts={[]}
        productUomStatus={{ isEnabled: false, isLoading: false, isError: false }}
      />,
    )
    expect(screen.getByText('لا توجد نتائج')).toBeInTheDocument()
  })

  it('keeps unmapped products non-interactive and delegates mapped selection', async () => {
    const unmappedProduct = {
      ...product,
      id: 'product-2',
      name: 'Unmapped product',
    }
    const onProductSelect = vi.fn()
    render(
      <MemoryRouter>
        <StockAdjustmentProductPicker
          {...baseProps}
          searchTerm="product"
          showProductSearch
          filteredProducts={[unmappedProduct, product]}
          productNeedsUomSetup={(productId) => productId === unmappedProduct.id}
          onProductSelect={onProductSelect}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('يحتاج إعداد وحدة')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Unmapped product/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Mapped product/ }))
    expect(onProductSelect).toHaveBeenCalledWith(product)
  })
})

describe('StockAdjustmentsList', () => {
  it('preserves the row label, status and selected record', async () => {
    const onSelect = vi.fn()
    const cancelledAdjustment = {
      ...adjustment,
      id: 'adjustment-2',
      status: 'CANCELLED',
      reference_number: null,
    }
    render(
      <StockAdjustmentsList
        adjustments={[adjustment, cancelledAdjustment]}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByText('مسودة')).toBeInTheDocument()
    expect(screen.getByText('ملغي')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'عرض تفاصيل تسوية المخزون adjustment-2' }),
    )
    expect(onSelect).toHaveBeenCalledWith(cancelledAdjustment)
  })

  it('preserves the empty state when no adjustments match', () => {
    render(<StockAdjustmentsList adjustments={[]} onSelect={vi.fn()} />)
    expect(screen.getByText('لا توجد تسويات مخزون بعد')).toBeInTheDocument()
  })
})
