import { describe, expect, it } from 'vitest'
import { AP_ERROR_CODES, isApError, mapApError } from '../ap-error-mapper'

describe('ap-error-mapper', () => {
  it('maps known server errors to clear Arabic copy', () => {
    const mapped = mapApError(
      new Error('AP_QUANTITY_EXCEEDS_RECEIPT: requested=10 available=4'),
    )

    expect(mapped.code).toBe('AP_QUANTITY_EXCEEDS_RECEIPT')
    expect(mapped.title).toContain('الرصيد')
    expect(mapped.description).toContain('حدّث المرشحين')
    expect(mapped.technicalDetails).toContain('requested=10')
  })

  it('preserves permission semantics for create-only callers', () => {
    const mapped = mapApError('AP_POST_PERMISSION_DENIED: requires approve')

    expect(mapped.description).toContain('تجهيز الفاتورة محليًا')
    expect(mapped.description).toContain('اعتماد')
  })

  it('does not expose unknown raw server text as user-facing copy', () => {
    const mapped = mapApError('socket disconnected after request write')

    expect(mapped.title).not.toContain('socket')
    expect(mapped.description).not.toContain('socket')
    expect(mapped.technicalDetails).toBe('socket disconnected after request write')
  })

  it('recognizes every registered AP code', () => {
    for (const code of AP_ERROR_CODES) {
      expect(isApError(`${code}: detail=value`), code).toBe(true)
      expect(mapApError(`${code}: detail=value`).code).toBe(code)
    }
  })
})
