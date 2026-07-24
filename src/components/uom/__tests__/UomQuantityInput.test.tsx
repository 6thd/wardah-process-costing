import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductUomOption } from '@/services/uom-service'
import { UomQuantityInput, type UomQuantityValue } from '../UomQuantityInput'

const useProductUoms = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-product-uoms', () => ({
  useProductUoms: (...args: unknown[]) => useProductUoms(...args),
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')

  interface SelectContextValue {
    disabled: boolean
    onValueChange: (value: string) => void
  }

  const SelectContext = React.createContext<SelectContextValue>({
    disabled: false,
    onValueChange: () => undefined,
  })

  interface SelectProps {
    children?: ReactNode
    disabled?: boolean
    onValueChange?: (value: string) => void
  }

  interface TriggerProps {
    children?: ReactNode
    'aria-label'?: string
  }

  interface ItemProps {
    children?: ReactNode
    value: string
  }

  return {
    Select: ({ children, disabled = false, onValueChange = () => undefined }: SelectProps) => (
      <SelectContext.Provider value={{ disabled, onValueChange }}>
        {children}
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children, 'aria-label': ariaLabel }: TriggerProps) => {
      const context = React.useContext(SelectContext)
      return (
        <button type="button" aria-label={ariaLabel} disabled={context.disabled}>
          {children}
        </button>
      )
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) => <div role="listbox">{children}</div>,
    SelectItem: ({ children, value }: ItemProps) => {
      const context = React.useContext(SelectContext)
      return (
        <button
          type="button"
          role="option"
          aria-selected="false"
          disabled={context.disabled}
          onClick={() => context.onValueChange(value)}
        >
          {children}
        </button>
      )
    },
  }
})

const piece: ProductUomOption = {
  id: 'piece',
  code: 'PCS',
  name: 'Piece',
  name_ar: 'قطعة',
  symbol: 'pcs',
  category_id: 'count',
  is_category_base: true,
  is_product_specific: false,
  decimal_places: 3,
  factor_to_base: 1,
  is_base: true,
  use_for_purchase: true,
  use_for_sale: true,
  barcode: null,
}

const carton: ProductUomOption = {
  id: 'carton',
  code: 'CTN',
  name: 'Carton',
  name_ar: 'كرتون',
  symbol: 'ctn',
  category_id: 'count',
  is_category_base: false,
  is_product_specific: true,
  decimal_places: 2,
  factor_to_base: 24,
  is_base: false,
  use_for_purchase: true,
  use_for_sale: false,
  barcode: null,
}

const tonne: ProductUomOption = {
  id: 'tonne',
  code: 'T',
  name: 'Tonne',
  name_ar: null,
  symbol: 't',
  category_id: 'mass',
  is_category_base: false,
  is_product_specific: false,
  decimal_places: 3,
  factor_to_base: 1000,
  is_base: false,
  use_for_purchase: true,
  use_for_sale: false,
  barcode: null,
}

const emptyValue: UomQuantityValue = {
  quantityEntered: 0,
  uomId: '',
  factorToBase: 1,
  baseQuantity: 0,
}

function setQueryState(overrides: Record<string, unknown> = {}) {
  useProductUoms.mockReturnValue({
    data: [piece, carton, tonne],
    isLoading: false,
    isError: false,
    ...overrides,
  })
}

describe('UomQuantityInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setQueryState()
  })

  it('asks for a product before rendering quantity controls', () => {
    render(
      <UomQuantityInput
        productId={null}
        value={emptyValue}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('اختر الصنف أولاً')).toBeInTheDocument()
    expect(useProductUoms).toHaveBeenCalledWith(null)
  })

  it('renders the loading state while legal product units are loading', () => {
    setQueryState({ data: undefined, isLoading: true })

    render(
      <UomQuantityInput
        productId="product-1"
        value={emptyValue}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('جاري تحميل الوحدات...')).toBeInTheDocument()
  })

  it('fails closed when the unit query fails', () => {
    setQueryState({ data: undefined, isError: true })

    render(
      <UomQuantityInput
        productId="product-1"
        value={emptyValue}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('لا توجد وحدة شراء قانونية للصنف')).toBeInTheDocument()
  })

  it('fails closed when purchase filtering leaves no legal option', () => {
    setQueryState({
      data: [{ ...carton, use_for_purchase: false }],
    })

    render(
      <UomQuantityInput
        productId="product-1"
        value={emptyValue}
        onChange={vi.fn()}
        purchaseOnly
      />,
    )

    expect(screen.getByText('لا توجد وحدة شراء قانونية للصنف')).toBeInTheDocument()
  })

  it('selects the preferred non-base purchase unit and defaults an empty quantity to one', async () => {
    const onChange = vi.fn()

    render(
      <UomQuantityInput
        productId="product-1"
        value={emptyValue}
        onChange={onChange}
        purchaseOnly
      />,
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        quantityEntered: 1,
        uomId: 'carton',
        factorToBase: 24,
        baseQuantity: 24,
      })
    })
  })

  it('falls back to the base unit when no alternative is enabled for purchase', async () => {
    const onChange = vi.fn()
    setQueryState({
      data: [piece, { ...carton, use_for_purchase: false }],
    })

    render(
      <UomQuantityInput
        productId="product-1"
        value={emptyValue}
        onChange={onChange}
        purchaseOnly
      />,
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        quantityEntered: 1,
        uomId: 'piece',
        factorToBase: 1,
        baseQuantity: 1,
      })
    })
  })

  it('keeps an existing legal selection and renders its base preview', () => {
    const onChange = vi.fn()

    render(
      <UomQuantityInput
        productId="product-1"
        value={{
          quantityEntered: 2,
          uomId: 'carton',
          factorToBase: 24,
          baseQuantity: 48,
        }}
        onChange={onChange}
        purchaseOnly
      />,
    )

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/48 pcs/)).toBeInTheDocument()
    expect(screen.getByText(/المعامل 24/)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'كرتون' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Tonne' })).toBeInTheDocument()
  })

  it('recalculates the base quantity when the entered quantity changes', () => {
    const onChange = vi.fn()

    render(
      <UomQuantityInput
        productId="product-1"
        value={{
          quantityEntered: 1,
          uomId: 'tonne',
          factorToBase: 1000,
          baseQuantity: 1000,
        }}
        onChange={onChange}
        purchaseOnly
      />,
    )

    fireEvent.change(screen.getByLabelText('الكمية المدخلة'), {
      target: { value: '2.5' },
    })

    expect(onChange).toHaveBeenCalledWith({
      quantityEntered: 2.5,
      uomId: 'tonne',
      factorToBase: 1000,
      baseQuantity: 2500,
    })
  })

  it('normalizes an empty quantity input to zero', () => {
    const onChange = vi.fn()

    render(
      <UomQuantityInput
        productId="product-1"
        value={{
          quantityEntered: 1,
          uomId: 'piece',
          factorToBase: 1,
          baseQuantity: 1,
        }}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('الكمية المدخلة'), {
      target: { value: '' },
    })

    expect(onChange).toHaveBeenCalledWith({
      quantityEntered: 0,
      uomId: 'piece',
      factorToBase: 1,
      baseQuantity: 0,
    })
  })

  it('recalculates the snapshot when the user switches units', () => {
    const onChange = vi.fn()

    render(
      <UomQuantityInput
        productId="product-1"
        value={{
          quantityEntered: 3,
          uomId: 'carton',
          factorToBase: 24,
          baseQuantity: 72,
        }}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('option', { name: 'قطعة' }))

    expect(onChange).toHaveBeenCalledWith({
      quantityEntered: 3,
      uomId: 'piece',
      factorToBase: 1,
      baseQuantity: 3,
    })
  })

  it('ignores an unknown unit selection', () => {
    const onChange = vi.fn()

    render(
      <UomQuantityInput
        productId="product-1"
        value={{
          quantityEntered: 3,
          uomId: 'carton',
          factorToBase: 24,
          baseQuantity: 72,
        }}
        onChange={onChange}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'وحدة الشراء' })
    fireEvent.change(trigger, { target: { value: 'unknown' } })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables both controls when the parent document is locked', () => {
    render(
      <UomQuantityInput
        productId="product-1"
        value={{
          quantityEntered: 3,
          uomId: 'piece',
          factorToBase: 1,
          baseQuantity: 3,
        }}
        onChange={vi.fn()}
        disabled
      />,
    )

    expect(screen.getByLabelText('الكمية المدخلة')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'وحدة الشراء' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'قطعة' })).toBeDisabled()
  })
})
