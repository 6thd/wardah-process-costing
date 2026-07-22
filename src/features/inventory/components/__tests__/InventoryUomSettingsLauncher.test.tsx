import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryUomSettingsLauncher } from '../InventoryUomSettingsLauncher'

const useUomEngineEnabled = vi.fn()
const productUomSettings = vi.fn()

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => useUomEngineEnabled(),
}))

vi.mock('../ProductUomSettings', () => ({
  ProductUomSettings: (props: { itemId: string; productName: string }) => {
    productUomSettings(props)
    return (
      <div data-testid="product-uom-settings">
        {props.itemId}:{props.productName}
      </div>
    )
  },
}))

vi.mock('@/features/manufacturing/components/ProductPickerDialog', () => ({
  ProductPickerDialog: ({
    open,
    onOpenChange,
    onPick,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onPick: (product: {
      id: string
      code: string
      name: string
      unit: string | null
      cost_price: number | null
      stock_quantity: number | null
    }) => void
  }) => open ? (
    <div role="dialog" aria-label="منتقي الأصناف">
      <button
        type="button"
        onClick={() => onPick({
          id: 'product-1',
          code: 'P-001',
          name: 'صنف تجريبي',
          unit: 'pcs',
          cost_price: 10,
          stock_quantity: 5,
        })}
      >
        اختر الصنف
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        إغلاق المنتقي
      </button>
    </div>
  ) : null,
}))

function renderLauncher(path = '/inventory/items') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <InventoryUomSettingsLauncher />
    </MemoryRouter>,
  )
}

describe('InventoryUomSettingsLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
  })

  it('renders nothing outside the inventory items route', () => {
    const { container } = renderLauncher('/inventory/overview')

    expect(container).toBeEmptyDOMElement()
  })

  it('fails closed while the organization flag is loading', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false, isLoading: true })

    const { container } = renderLauncher()

    expect(container).toBeEmptyDOMElement()
  })

  it('fails closed when the organization flag is disabled', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false, isLoading: false })

    const { container } = renderLauncher()

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the launcher action when the flag is enabled on the items route', () => {
    renderLauncher()

    expect(screen.getByRole('button', { name: 'إعداد وحدات صنف' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'منتقي الأصناف' })).not.toBeInTheDocument()
  })

  it('opens the product picker and closes it through the dialog callback', () => {
    renderLauncher()

    fireEvent.click(screen.getByRole('button', { name: 'إعداد وحدات صنف' }))
    expect(screen.getByRole('dialog', { name: 'منتقي الأصناف' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'إغلاق المنتقي' }))
    expect(screen.queryByRole('dialog', { name: 'منتقي الأصناف' })).not.toBeInTheDocument()
  })

  it('selects a product, exposes its UoM settings, and allows clearing the selection', () => {
    renderLauncher()

    fireEvent.click(screen.getByRole('button', { name: 'إعداد وحدات صنف' }))
    fireEvent.click(screen.getByRole('button', { name: 'اختر الصنف' }))

    expect(screen.getByText('P-001')).toBeInTheDocument()
    expect(screen.getByText('صنف تجريبي')).toBeInTheDocument()
    expect(screen.getByTestId('product-uom-settings')).toHaveTextContent('product-1:صنف تجريبي')
    expect(productUomSettings).toHaveBeenCalledWith({
      itemId: 'product-1',
      productName: 'صنف تجريبي',
    })

    fireEvent.click(screen.getByRole('button', { name: 'إلغاء اختيار الصنف' }))

    expect(screen.getByRole('button', { name: 'إعداد وحدات صنف' })).toBeInTheDocument()
    expect(screen.queryByTestId('product-uom-settings')).not.toBeInTheDocument()
  })
})
