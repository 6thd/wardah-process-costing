/**
 * RED→GREEN for the demo-credentials hard-coded password fix
 * (SonarCloud typescript:S2068, src/config/demo-credentials.ts:20,25).
 *
 * A VITE_* value is inlined into the built browser bundle at compile time,
 * so it is exactly as visible as a literal — there is no client-safe way
 * to ship a demo password today. The fix removes every literal fallback
 * and every VITE_*-sourced password, leaving `password: null`.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { DEMO_CREDENTIALS } from '@/config/demo-credentials'

const SOURCE_PATH = 'src/config/demo-credentials.ts'

describe('demo-credentials: no hard-coded password ships in the buildable source', () => {
  it('the source file contains neither removed literal password', () => {
    const src = fs.readFileSync(SOURCE_PATH, 'utf8')
    expect(src).not.toContain('manager123')
    expect(src).not.toContain('employee123')
    expect(src).not.toContain('admin123')
  })

  it('the source file never sources a password from a VITE_* env var either', () => {
    // VITE_* values are inlined into the client bundle at build time by Vite,
    // so assigning a real or demo password to one is exactly as unsafe as a
    // literal — the fix must not just move the literal into an env fallback.
    const src = fs.readFileSync(SOURCE_PATH, 'utf8')
    expect(src).not.toMatch(/VITE_DEMO_\w*PASSWORD/)
  })

  it('no NOSONAR suppression is used to silence the rule instead of fixing it', () => {
    const src = fs.readFileSync(SOURCE_PATH, 'utf8')
    expect(src).not.toMatch(/NOSONAR/)
  })

  it('DEMO_CREDENTIALS carries no usable password value at runtime', () => {
    expect(DEMO_CREDENTIALS.admin.password).toBeFalsy()
    expect(DEMO_CREDENTIALS.manager.password).toBeFalsy()
    expect(DEMO_CREDENTIALS.employee.password).toBeFalsy()
  })
})
