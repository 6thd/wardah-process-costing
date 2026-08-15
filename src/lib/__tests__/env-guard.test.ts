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

describe('checkRequiredEnv: default parameter never captures the whole import.meta.env object', () => {
  // Vite inlines `import.meta.env.SPECIFIC_KEY` as just that one string, but
  // inlines the bare `import.meta.env` object as *every* VITE_*-prefixed
  // variable configured at build time. A default parameter of the bare
  // object therefore bundles any leftover VITE_* var (e.g. a stale
  // VITE_DEMO_*_PASSWORD still configured in Vercel Preview) even though no
  // application code references it. Reproduced for real on PR #119: a
  // Vercel Preview build with VITE_DEMO_MANAGER_PASSWORD=manager123 set
  // shipped that literal in dist/assets/index-DIgUO1go.js — caught only by
  // the separate build-output gate (scripts/ci/check-no-demo-passwords-in-build.mjs),
  // not by anything at the source level. This asserts the source-level fix.
  it('the default parameter is not the bare import.meta.env object', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/lib/env-guard.ts', 'utf8')
    expect(src).not.toMatch(/=\s*import\.meta\.env\s*\)/)
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
