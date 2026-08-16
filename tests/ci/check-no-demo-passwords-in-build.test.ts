/**
 * Pure unit tests for isWithinRoot(), the containment guard used by
 * scripts/ci/check-no-demo-passwords-in-build.mjs to keep the demo-password
 * build scan strictly inside the canonical dist/ root. No real filesystem
 * entries (directories, files, or symlinks) are created here — every case
 * is a plain string-path comparison, so the production script itself never
 * has to run self-tests that touch disk during `npm run build`.
 */
import { describe, it, expect } from 'vitest'
import { isWithinRoot } from '../../scripts/ci/check-no-demo-passwords-in-build.mjs'

describe('isWithinRoot', () => {
  const root = '/build/dist'

  it('accepts a file directly inside the root', () => {
    expect(isWithinRoot(root, '/build/dist/assets/index.js')).toBe(true)
  })

  it('accepts the root itself', () => {
    expect(isWithinRoot(root, '/build/dist')).toBe(true)
  })

  it('rejects a `..` escape out of the root', () => {
    expect(isWithinRoot(root, '/build/dist/../secrets.env')).toBe(false)
  })

  it('rejects a sibling directory that merely shares the root as a prefix', () => {
    expect(isWithinRoot(root, '/build/dist-backup/leak.js')).toBe(false)
  })

  it('rejects an unrelated absolute path entirely outside the root', () => {
    expect(isWithinRoot(root, '/etc/passwd')).toBe(false)
  })

  it('rejects a simulated post-realpath symlink target that resolves outside the root', () => {
    // A symlink at /build/dist/assets/escape pointing at /tmp/outside would,
    // once realpath'd, resolve to this candidate. isWithinRoot() must reject
    // it the same way it rejects any other out-of-root path — the caller
    // never needs to special-case "this came from a symlink".
    const resolvedSymlinkTarget = '/tmp/outside/leak.js'
    expect(isWithinRoot(root, resolvedSymlinkTarget)).toBe(false)
  })
})
