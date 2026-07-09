/**
 * اختبارات env-guard (P4-C3)
 */
import { describe, it, expect } from 'vitest'
import { checkRequiredEnv, renderNotConfiguredScreen } from '../env-guard'

describe('checkRequiredEnv', () => {
  it('ينجح عند وجود المفاتيح', () => {
    const result = checkRequiredEnv({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key'
    })
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('يكشف المفاتيح الغائبة والفارغة', () => {
    const result = checkRequiredEnv({
      VITE_SUPABASE_URL: '   ',
      VITE_SUPABASE_ANON_KEY: undefined
    })
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
  })
})

describe('renderNotConfiguredScreen', () => {
  it('يعرض شاشة إرشاد RTL بأسماء المفاتيح المفقودة', () => {
    const root = document.createElement('div')
    renderNotConfiguredScreen(root, ['VITE_SUPABASE_URL'])

    expect(root.innerHTML).toContain('التطبيق غير مُهيّأ')
    expect(root.innerHTML).toContain('VITE_SUPABASE_URL')
    expect(root.innerHTML).toContain('dir="rtl"')
    expect(root.innerHTML).toContain('App not configured')
  })
})
