import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const mutate = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/manufacturing/useQuality', () => ({
  useRecordQualityInspection: () => ({ mutate, isPending: false }),
}))

import { InspectionDialog } from '../InspectionDialog'
import { QualityRpcError } from '@/services/manufacturing/qualityService'

const STAGES = [{ id: 'stage-1', label: 'ST1 — Mixing' }]

function renderDialog(status: string, onClose = vi.fn()) {
  render(
    <InspectionDialog
      order={{ id: 'mo-1', order_number: 'MO-1', status }}
      stages={STAGES}
      allowConditional={false}
      onClose={onClose}
    />
  )
  return onClose
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('InspectionDialog', () => {
  it('defaults to a FINAL inspection for an order under inspection and submits the entered quantities', () => {
    renderDialog('quality_check')
    expect(screen.queryByLabelText('quality.form.stage')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('quality.form.passed'), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText('quality.form.findings'), { target: { value: 'ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'quality.form.submit' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    const [vars] = mutate.mock.calls[0]
    expect(vars.moId).toBe('mo-1')
    expect(vars.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(vars.input).toMatchObject({
      inspection_type: 'FINAL', result: 'PASS', passed_quantity: 9, failed_quantity: 0,
      stage_id: null, findings: 'ok',
    })
  })

  it('defaults to an in-process inspection with a stage picker for an in-progress order', () => {
    renderDialog('in_progress')
    expect(screen.getByLabelText('quality.form.stage')).toBeInTheDocument()
    expect(screen.queryByText('quality.form.finalNeedsQualityCheck')).not.toBeInTheDocument()
  })

  it('asks for a disposition once a rejected quantity is entered and explains conditional release', () => {
    renderDialog('quality_check')
    expect(screen.queryByLabelText('quality.form.disposition')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('quality.form.failed'), { target: { value: '2' } })
    expect(screen.getByLabelText('quality.form.disposition')).toBeInTheDocument()
    expect(screen.getByText('quality.form.conditionalHint')).toBeInTheDocument()
  })

  it('reports success with the server number and closes; failures show the mapped error', () => {
    const onClose = renderDialog('quality_check')
    fireEvent.change(screen.getByLabelText('quality.form.passed'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'quality.form.submit' }))
    const [, callbacks] = mutate.mock.calls[0]

    callbacks.onSuccess({ replayed: false, inspection_number: 'QI-000007' })
    expect(toast.success).toHaveBeenCalledWith('quality.page.inspectSuccess')
    expect(onClose).toHaveBeenCalled()

    callbacks.onError(new QualityRpcError('QUALITY_SEGREGATION_OF_DUTIES', 'QUALITY_SEGREGATION_OF_DUTIES'))
    expect(toast.error).toHaveBeenCalledWith('quality.errors.QUALITY_SEGREGATION_OF_DUTIES')
  })
})
