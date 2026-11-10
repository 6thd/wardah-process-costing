import { act, fireEvent, render, screen, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { QualityPolicy } from '@/services/manufacturing-settings-service'
import { ManufacturingSettingsPage } from '../ManufacturingSettingsPage'

vi.mock('@/components/ui/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) } }))

const service = vi.hoisted(() => ({
  getQualityPolicy: vi.fn(),
  setQualityPolicy: vi.fn(),
  getMaterialIssueStatuses: vi.fn(),
  setMaterialIssueStatuses: vi.fn(),
  listGlEventMappings: vi.fn(),
  listPostingAccounts: vi.fn(),
  listActiveWorkCenters: vi.fn(),
  setGlEventMapping: vi.fn(),
}))
vi.mock('@/services/manufacturing-settings-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/manufacturing-settings-service')>()),
  ...service,
}))

function quality(canManage: boolean, version = 3): QualityPolicy {
  return {
    release_gate_mode: 'off', inspection_scope: 'final_only', allow_conditional_release: false,
    segregation_of_duties: true, admins_subject_to_quality_controls: true, version, canManage,
  }
}

beforeEach(async () => {
  for (const fn of Object.values(service)) fn.mockReset()
  toastError.mockReset()
  toastSuccess.mockReset()
  service.getMaterialIssueStatuses.mockResolvedValue({ allowedStatuses: ['IN_PROGRESS'], version: 2 })
  service.listGlEventMappings.mockResolvedValue([
    { id: 'm1', eventCode: 'MATERIAL_ISSUE', workCenterCode: null, debitAccountCode: '134100',
      creditAccountCode: '131100', description: null, isActive: true },
    { id: 'm2', eventCode: 'OH_APPLIED', workCenterCode: 'WC-A', debitAccountCode: '134100',
      creditAccountCode: '520100', description: null, isActive: false },
  ])
  service.listPostingAccounts.mockResolvedValue([
    { code: '131100', name: 'Raw materials', nameAr: null },
    { code: '134100', name: 'WIP', nameAr: null },
    { code: '135100', name: 'Finished goods', nameAr: null },
  ])
  service.listActiveWorkCenters.mockResolvedValue([{ code: 'WC-A', name: 'Mixing', nameAr: null }])
  await act(async () => { await i18n.changeLanguage('en') })
})

describe('ManufacturingSettingsPage', () => {
  it('is read-only when the database says the user cannot manage settings', async () => {
    service.getQualityPolicy.mockResolvedValue(quality(false))
    const user = userEvent.setup()
    render(<ManufacturingSettingsPage />)

    expect(await screen.findByText(/You can view these settings/)).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: 'Ready' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: 'Quality' }))
    expect(await screen.findByLabelText('Release gate')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: 'GL mappings' }))
    const editButtons = await screen.findAllByRole('button', { name: /Edit mapping/ })
    expect(editButtons.every(button => (button as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.queryByRole('button', { name: /Add work-center override/ })).not.toBeInTheDocument()
    expect(service.listPostingAccounts).not.toHaveBeenCalled()
  })

  it('saves the material-issue statuses the user chose', async () => {
    service.getQualityPolicy.mockResolvedValue(quality(true))
    service.setMaterialIssueStatuses.mockResolvedValue({ allowedStatuses: ['IN_PROGRESS', 'READY'], version: 3 })
    const user = userEvent.setup()
    render(<ManufacturingSettingsPage />)

    const ready = await screen.findByRole('checkbox', { name: 'Ready' })
    await waitFor(() => expect(ready).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(ready)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(service.setMaterialIssueStatuses).toHaveBeenCalledWith(['READY']))
    expect(toastSuccess).toHaveBeenCalledWith('Settings saved')
  })

  it('on a version conflict shows the translated message and reloads the quality policy', async () => {
    // Another session saves version 4 while this user edits version 3.
    let serverVersion = 3
    service.getQualityPolicy.mockImplementation(async () => quality(true, serverVersion))
    service.setQualityPolicy.mockImplementation(async () => {
      serverVersion = 4
      throw new Error('QUALITY_POLICY_VERSION_CONFLICT: current=4')
    })
    const user = userEvent.setup()
    render(<ManufacturingSettingsPage />)

    await user.click(await screen.findByRole('tab', { name: 'Quality' }))
    const gate = await screen.findByLabelText('Release gate')
    await waitFor(() => expect(gate).toBeEnabled())
    fireEvent.change(gate, { target: { value: 'all_orders' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(service.setQualityPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ release_gate_mode: 'all_orders' }), 3))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      'Someone else saved these settings first. The latest values were reloaded; review and save again.'))
    expect(await screen.findByText('Version 4')).toBeInTheDocument()
  })

  it('lists every manufacturing event, flags the unmapped ones, and saves a mapping through the RPC', async () => {
    service.getQualityPolicy.mockResolvedValue(quality(true))
    service.setGlEventMapping.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ManufacturingSettingsPage />)

    await user.click(await screen.findByRole('tab', { name: 'GL mappings' }))
    const fgRow = (await screen.findByText('FG_RECEIPT')).closest('tr') as HTMLElement
    expect(within(fgRow).getByText('Not mapped')).toBeInTheDocument()
    expect(within(fgRow).getByText('Posted by rpc_post_event_journal')).toBeInTheDocument()
    const labor = (screen.getByText('LABOR_APPLIED')).closest('tr') as HTMLElement
    expect(within(labor).getByText('No posting path reads this event yet')).toBeInTheDocument()
    const override = screen.getAllByText('OH_APPLIED').map(cell => cell.closest('tr') as HTMLElement)
      .find(row => within(row).queryByText('WC-A'))
    expect(override && within(override).getByText('Inactive')).toBeInTheDocument()

    await waitFor(() => expect(within(fgRow).getByRole('button', { name: /Edit mapping/ })).toBeEnabled())
    await user.click(within(fgRow).getByRole('button', { name: /Edit mapping/ }))
    const form = await screen.findByRole('form', { name: 'GL mapping form' })
    await waitFor(() => expect(within(form).getAllByRole('option').length).toBeGreaterThan(2))
    await user.selectOptions(within(form).getByLabelText('Debit account'), '135100')
    await user.selectOptions(within(form).getByLabelText('Credit account'), '134100')
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(service.setGlEventMapping).toHaveBeenCalledWith({
      eventCode: 'FG_RECEIPT', workCenterCode: null, debitAccountCode: '135100',
      creditAccountCode: '134100', description: null, isActive: true,
    }))
  })

  it('shows a translated refusal when the database denies the save', async () => {
    service.getQualityPolicy.mockResolvedValue(quality(true))
    service.setMaterialIssueStatuses.mockRejectedValue(new Error('MANUFACTURING_SETTINGS_UPDATE_DENIED'))
    const user = userEvent.setup()
    render(<ManufacturingSettingsPage />)

    const ready = await screen.findByRole('checkbox', { name: 'Ready' })
    await waitFor(() => expect(ready).toBeEnabled())
    await user.click(ready)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      'You do not have permission to change manufacturing settings.'))
  })
})
