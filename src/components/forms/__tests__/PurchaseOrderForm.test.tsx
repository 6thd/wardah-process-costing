import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchaseOrderForm } from '../PurchaseOrderForm'

const useUomEngineEnabled = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => useUomEngineEnabled(),
}))

vi.mock('../LegacyPurchaseOrderForm', () => ({
  PurchaseOrderForm: () => <div data-testid="legacy-purchase-order-form">legacy</div>,
}))

vi.mock('../PurchaseOrderUomForm', () => ({
  PurchaseOrderForm: () => <div data-testid="uom-purchase-order-form">uom</div>,
}))

describe('PurchaseOrderForm rollout routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves the legacy purchase-order path while the flag is disabled', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false, isLoading: false })

    render(<PurchaseOrderForm open onOpenChange={vi.fn()} />)

    expect(screen.getByTestId('legacy-purchase-order-form')).toBeInTheDocument()
    expect(screen.queryByTestId('uom-purchase-order-form')).not.toBeInTheDocument()
  })

  it('preserves the legacy path while the flag value is still loading', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false, isLoading: true })

    render(<PurchaseOrderForm open onOpenChange={vi.fn()} />)

    expect(screen.getByTestId('legacy-purchase-order-form')).toBeInTheDocument()
    expect(screen.queryByTestId('uom-purchase-order-form')).not.toBeInTheDocument()
  })

  it('routes enabled organizations to the UoM-aware form', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })

    render(<PurchaseOrderForm open onOpenChange={vi.fn()} />)

    expect(screen.getByTestId('uom-purchase-order-form')).toBeInTheDocument()
    expect(screen.queryByTestId('legacy-purchase-order-form')).not.toBeInTheDocument()
  })
})
