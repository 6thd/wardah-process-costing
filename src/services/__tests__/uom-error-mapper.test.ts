import { describe, expect, it } from 'vitest'
import {
  isUomError,
  mapUomError,
  UOM_ERROR_PREFIXES,
} from '../uom-error-mapper'

describe('uom-error-mapper', () => {
  it('matches Postgres errors by prefix and extracts appended context', () => {
    const mapped = mapUomError(
      new Error('CONSUMPTION_EXCEEDS_RESERVATION: remaining=2.5, requested_base=5'),
      'en-US',
    )

    expect(mapped.code).toBe('CONSUMPTION_EXCEEDS_RESERVATION')
    expect(mapped.context).toEqual({ remaining: '2.5', requested_base: '5' })
    expect(mapped.description).toContain('2.5')
    expect(mapped.technicalDetails).toContain('requested_base=5')
  })

  it('returns the legal remediation action for interactive errors', () => {
    expect(mapUomError('PRODUCT_BASE_UOM_REQUIRED: product=p1', 'ar').action)
      .toBe('OPEN_PRODUCT_UOM_SETTINGS')
    expect(mapUomError('WAREHOUSE_REQUIRED_FOR_CONSUMPTION', 'en').action)
      .toBe('PICK_WAREHOUSE')
    expect(mapUomError('OPEN_STAGE_WIP_LOG_NOT_FOUND', 'en').action)
      .toBe('OPEN_STAGE_WIP_LOGS')
  })

  it('accepts a PostgREST-shaped error object', () => {
    const mapped = mapUomError({
      message: 'PRODUCT_UOM_CONVERSION_MISSING: product=p1, uom=u1',
      code: 'P0001',
    }, 'en')

    expect(mapped.code).toBe('PRODUCT_UOM_CONVERSION_MISSING')
    expect(mapped.action).toBe('OPEN_PRODUCT_UOM_SETTINGS')
    expect(mapped.context).toEqual({ product: 'p1', uom: 'u1' })
  })

  it('fails safely for unknown errors without exposing raw text as user copy', () => {
    const mapped = mapUomError('socket disconnected while posting', 'en')

    expect(mapped.code).toBe('SOCKET DISCONNECTED WHILE POSTING')
    expect(mapped.action).toBe('CONTACT_SUPPORT')
    expect(mapped.title).not.toContain('socket')
    expect(mapped.description).not.toContain('socket')
    expect(mapped.technicalDetails).toBe('socket disconnected while posting')
  })

  it('recognizes every registered legal prefix', () => {
    for (const prefix of UOM_ERROR_PREFIXES) {
      expect(isUomError(`${prefix}: detail=value`), prefix).toBe(true)
      expect(mapUomError(`${prefix}: detail=value`, 'en').action)
        .not.toBe('CONTACT_SUPPORT')
    }
  })

  it('does not classify unrelated database errors as UoM errors', () => {
    expect(isUomError('permission denied for table customers')).toBe(false)
  })
})
