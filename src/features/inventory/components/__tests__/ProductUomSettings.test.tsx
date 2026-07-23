import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductUomSettings } from '../ProductUomSettings'

const useUomEngineEnabled = vi.fn()
const useAuth = vi.fn()
const resolveProductIdForItem = vi.fn()
const getProductUomMasterProfile = vi.fn()
const getProductBaseUomChangeGuard = vi.fn()
const listUomCatalog = vi.fn()
const listProductUomConversionHistory = vi.fn()
const assignProductBaseUom = vi.fn()
const convertProductQuantity = vi.fn()
const saveProductUomConversion = vi.fn()
const setProductPhysicalWeight = vi.fn()

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => useUomEngineEnabled(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuth(),
}))

vi.mock('@/services/uom-master-data-service', () => ({
  resolveProductIdForItem: (...args: unknown[]) => resolveProductIdForItem(...args),
  getProductUomMasterProfile: (...args: unknown[]) => getProductUomMasterProfile(...args),
  getProductBaseUomChangeGuard: (...args: unknown[]) => getProductBaseUomChangeGuard(...args),
  listUomCatalog: (...args: unknown[]) => listUomCatalog(...args),
  listProductUomConversionHistory: (...args: unknown[]) => listProductUomConversionHistory(...args),
  assignProductBaseUom: (...args: unknown[]) => assignProductBaseUom(...args),
}))

vi.mock('@/services/uom-service', () => ({
  convertProductQuantity: (...args: unknown[]) => convertProductQuantity(...args),
  saveProductUomConversion: (...args: unknown[]) => saveProductUomConversion(...args),
  setProductPhysicalWeight: (...args: unknown[]) => setProductPhysicalWeight(...args),
}))

vi.mock('@/services/uom-error-mapper', () => ({
  mapUomError: () => ({
    code: 'TEST',
    title: 'خطأ',
    description: 'وصف',
    context: {},
  }),
}))

function renderComponent() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={client}>
      <ProductUomSettings itemId="item-1" productName="صنف تجريبي" />
    </QueryClientProvider>,
  )
}

function mappedProfile() {
  return {
    product_id: 'product-1',
    org_id: 'org-1',
    base_uom_id: 'piece',
    base_uom: {
      id: 'piece',
      code: 'PCS',
      name: 'Piece',
      name_ar: 'قطعة',
      symbol: 'pcs',
      category_id: 'count',
      is_category_base: true,
      is_product_specific: false,
      decimal_places: 6,
    },
    uom_migration_status: 'MAPPED',
    net_weight: 0.015,
    gross_weight: 0.017,
    weight_uom_id: 'kg',
    weight_uom: {
      id: 'kg',
      code: 'KG',
      name: 'Kilogram',
      name_ar: 'كيلوجرام',
      symbol: 'kg',
      category_id: 'mass',
      is_category_base: true,
      is_product_specific: false,
      decimal_places: 6,
    },
    conversions: [],
  }
}

function unmappedProfile() {
  return {
    product_id: 'product-1',
    org_id: 'org-1',
    base_uom_id: null,
    base_uom: null,
    uom_migration_status: 'NO_UNIT',
    net_weight: null,
    gross_weight: null,
    weight_uom_id: null,
    weight_uom: null,
    conversions: [],
  }
}

describe('ProductUomSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({ currentOrgId: 'org-1' })
    resolveProductIdForItem.mockResolvedValue('product-1')
    getProductUomMasterProfile.mockResolvedValue(mappedProfile())
    getProductBaseUomChangeGuard.mockResolvedValue({
      has_movements: true,
      base_uom_locked: true,
    })
    listProductUomConversionHistory.mockResolvedValue([])
    assignProductBaseUom.mockResolvedValue(undefined)
    saveProductUomConversion.mockResolvedValue(undefined)
    setProductPhysicalWeight.mockResolvedValue(undefined)
    convertProductQuantity.mockResolvedValue({ base_quantity: 42 })
    listUomCatalog.mockResolvedValue({
      categories: [
        { id: 'count', code: 'COUNT', name: 'Count', name_ar: 'عدد', dimension: 'count', is_system: true },
        { id: 'mass', code: 'MASS', name: 'Mass', name_ar: 'كتلة', dimension: 'mass', is_system: true },
      ],
      uoms: [
        {
          id: 'piece', code: 'PCS', name: 'Piece', name_ar: 'قطعة', symbol: 'pcs',
          category_id: 'count', is_category_base: true, is_product_specific: false, decimal_places: 6,
        },
        {
          id: 'kg', code: 'KG', name: 'Kilogram', name_ar: 'كيلوجرام', symbol: 'kg',
          category_id: 'mass', is_category_base: true, is_product_specific: false, decimal_places: 6,
        },
      ],
    })
  })

  it('fails closed and renders nothing while the organization flag is disabled', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false, isLoading: false })
    const { container } = renderComponent()
    expect(container).toBeEmptyDOMElement()
    expect(resolveProductIdForItem).not.toHaveBeenCalled()
  })

  it('exposes the settings action when the organization flag is enabled', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    renderComponent()
    expect(screen.getByRole('button', { name: /إعدادات الوحدات/ })).toBeInTheDocument()
    expect(resolveProductIdForItem).not.toHaveBeenCalled()
  })

  it('fails closed while the flag value is loading', () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: false, isLoading: true })
    const { container } = renderComponent()
    expect(container).toBeEmptyDOMElement()
  })

  it('offers first base-unit assignment when unset and no movement exists', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    getProductUomMasterProfile.mockResolvedValue(unmappedProfile())
    getProductBaseUomChangeGuard.mockResolvedValue({ has_movements: false, base_uom_locked: false })

    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    expect(await screen.findByRole('button', { name: 'تعيين وحدة الأساس' })).toBeInTheDocument()
    expect(screen.getByText('غير محددة')).toBeInTheDocument()
    expect(screen.queryByText('الوحدة الأساسية ثابتة')).not.toBeInTheDocument()
  })

  it('blocks late assignment when an unresolved product already has movements', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    getProductUomMasterProfile.mockResolvedValue(unmappedProfile())
    getProductBaseUomChangeGuard.mockResolvedValue({ has_movements: true, base_uom_locked: true })

    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    expect(await screen.findByText('لا يمكن تعيين الوحدة')).toBeInTheDocument()
    expect(screen.getByText(/توجد حركة مخزون سابقة/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'تعيين وحدة الأساس' })).not.toBeInTheDocument()
  })

  it('does not expose a base-unit change action after first assignment', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    expect(await screen.findByText('الوحدة الأساسية ثابتة')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /تغيير وحدة الأساس/ })).not.toBeInTheDocument()
  })

  it('renders a mapped blocking error instead of partial settings', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    getProductUomMasterProfile.mockRejectedValue(new Error('PRODUCT_BASE_UOM_INVALID'))

    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    expect(await screen.findByText('خطأ')).toBeInTheDocument()
    expect(screen.getByText('وصف')).toBeInTheDocument()
    expect(screen.queryByText('الوحدة الأساسية القانونية')).not.toBeInTheDocument()
  })

  it('renders conversion-history errors separately from an empty history', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    listProductUomConversionHistory.mockRejectedValue(new Error('HISTORY_FAILED'))

    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    expect(await screen.findByText('تاريخ التحويلات السابقة')).toBeInTheDocument()
    expect(screen.getByText('خطأ')).toBeInTheDocument()
    expect(screen.queryByText('لا يوجد تاريخ تحويلات لهذا الصنف.')).not.toBeInTheDocument()
  })

  it('renders current conversions and the versioned conversion history', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    const carton = {
      id: 'carton', code: 'CTN', name: 'Carton', name_ar: 'كرتون', symbol: 'ctn',
      category_id: 'count', is_category_base: false, is_product_specific: true, decimal_places: 6,
    }
    getProductUomMasterProfile.mockResolvedValue({
      ...mappedProfile(),
      net_weight: null,
      gross_weight: null,
      weight_uom_id: null,
      weight_uom: null,
      conversions: [{
        id: 'conv-1', uom: carton, factor_to_base: 24,
        use_for_purchase: true, use_for_sale: false, barcode: null, notes: null,
        allow_cross_dimension: false, valid_from: '2026-07-22T00:00:00.000Z',
      }],
    })
    listProductUomConversionHistory.mockResolvedValue([
      { id: 'h-1', uom: carton, uom_id: 'carton', factor_to_base: 24, is_active: true, valid_from: '2026-07-22T00:00:00.000Z', valid_to: null },
      { id: 'h-0', uom: carton, uom_id: 'carton', factor_to_base: 12, is_active: false, valid_from: '2026-07-01T00:00:00.000Z', valid_to: '2026-07-22T00:00:00.000Z' },
    ])

    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    expect(await screen.findByText('تاريخ التحويلات السابقة')).toBeInTheDocument()
    expect(screen.getAllByText('كرتون (ctn)').length).toBeGreaterThan(0)
    expect(screen.getByText('سارية')).toBeInTheDocument()
    expect(screen.getByText('مغلقة')).toBeInTheDocument()
  })

  it('saves the physical weight through the canonical server service', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    const saveWeight = await screen.findByRole('button', { name: 'حفظ الوزن' })
    fireEvent.click(saveWeight)

    await waitFor(() => {
      expect(setProductPhysicalWeight).toHaveBeenCalledWith({
        productId: 'product-1',
        netWeight: 0.015,
        grossWeight: 0.017,
        weightUomId: 'kg',
      })
    })
  })

  it('runs conversion simulation through the server and renders its result', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    const calculate = await screen.findByRole('button', { name: 'احسب' })
    fireEvent.click(calculate)

    await waitFor(() => {
      expect(convertProductQuantity).toHaveBeenCalledWith({
        productId: 'product-1',
        quantity: 1,
        uomId: 'piece',
      })
    })
    expect(await screen.findByText('42')).toBeInTheDocument()
  })

  it('loads the legal product profile only after opening the dialog', async () => {
    useUomEngineEnabled.mockReturnValue({ isEnabled: true, isLoading: false })
    renderComponent()

    fireEvent.click(screen.getByRole('button', { name: /إعدادات الوحدات/ }))

    expect(await screen.findByText('الوحدة الأساسية القانونية')).toBeInTheDocument()
    expect(screen.getAllByText('قطعة (pcs)').length).toBeGreaterThan(0)
    expect(screen.getByText('الوحدة الأساسية ثابتة')).toBeInTheDocument()
    expect(screen.getByText('لا توجد تحويلات مخصصة للصنف.')).toBeInTheDocument()
    expect(resolveProductIdForItem).toHaveBeenCalledWith('org-1', 'item-1')
    expect(getProductUomMasterProfile).toHaveBeenCalledWith('org-1', 'product-1')
    expect(getProductBaseUomChangeGuard).toHaveBeenCalledWith('org-1', 'product-1')
    expect(listUomCatalog).toHaveBeenCalledTimes(1)
  })
})
