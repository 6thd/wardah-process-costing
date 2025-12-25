/* eslint-disable no-console */
/**
 * Ensure Istanbul/Vitest coverage artifacts exist.
 *
 * - If `coverage/coverage-final.json` exists and is valid (non-empty object), we do nothing.
 * - Otherwise, we run `npm run test:coverage` to generate coverage.
 *
 * Usage:
 *   node scripts/ensure-coverage.cjs           # ensure coverage exists
 *   node scripts/ensure-coverage.cjs --force   # regenerate coverage
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const args = new Set(process.argv.slice(2))
const force = args.has('--force') || args.has('-f')

const projectRoot = process.cwd()
const coverageJsonPath = path.join(projectRoot, 'coverage', 'coverage-final.json')

function isValidCoverageFile() {
  if (!fs.existsSync(coverageJsonPath)) return false
  try {
    const raw = fs.readFileSync(coverageJsonPath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0
  } catch {
    return false
  }
}

if (!force && isValidCoverageFile()) {
  console.log('[coverage] OK: coverage artifacts exist:', coverageJsonPath)
  process.exit(0)
}

console.log(
  force
    ? '[coverage] Regenerating coverage (forced)...'
    : '[coverage] Missing/invalid coverage artifacts; generating coverage...'
)

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const res = spawnSync(npmCmd, ['run', 'test:coverage'], { stdio: 'inherit', cwd: projectRoot })

if (res.status !== 0) process.exit(res.status ?? 1)

if (!isValidCoverageFile()) {
  console.error('[coverage] ERROR: test:coverage succeeded but coverage-final.json is still missing/invalid:', coverageJsonPath)
  process.exit(1)
}

console.log('[coverage] DONE: coverage artifacts generated:', coverageJsonPath)





