/**
 * Pure unit tests for the new-source Sonar coverage gate
 * (scripts/ci/check-new-source-sonar-coverage.mjs). No real git commands,
 * filesystem walks, or network calls happen here — every case works
 * directly on in-memory glob lists, lcov text, and added-file lists, the
 * same way tests/ci/check-no-demo-passwords-in-build.test.ts only exercises
 * the pure isWithinRoot() guard rather than the disk-walking script around it.
 */
import { describe, it, expect } from 'vitest'
import {
  parseSonarProperties,
  parseLcovSourceFiles,
  findNewSourceCoverageGaps,
  isSafeGitRef,
  matchesAnyGlob,
} from '../../scripts/ci/check-new-source-sonar-coverage.mjs'

describe('parseSonarProperties', () => {
  it('parses comma-separated single-line values and backslash-continued multi-line glob lists', () => {
    const text = [
      '# comment lines are ignored',
      'sonar.sources=src,sql',
      'sonar.exclusions=\\',
      '  **/node_modules/**,\\',
      '  **/*.test.tsx',
      '',
      'sonar.coverage.exclusions=\\',
      '  **/src/features/accounting/journal-entries/components/**,\\',
      '  **/src/features/accounting/journal-entries/index.tsx',
    ].join('\n')

    const config = parseSonarProperties(text)

    expect(config.sources).toEqual(['src', 'sql'])
    expect(config.exclusions).toEqual(['**/node_modules/**', '**/*.test.tsx'])
    expect(config.coverageExclusions).toEqual([
      '**/src/features/accounting/journal-entries/components/**',
      '**/src/features/accounting/journal-entries/index.tsx',
    ])
  })
})

describe('parseLcovSourceFiles', () => {
  it('extracts SF: entries into a normalized path set', () => {
    const lcov = [
      'TN:',
      'SF:src/features/accounting/journal-entries/components/JournalEntrySections.tsx',
      'LF:10',
      'LH:10',
      'end_of_record',
      'SF:./src/features/inventory/components/StockAdjustmentSections.tsx',
      'end_of_record',
    ].join('\n')

    const files = parseLcovSourceFiles(lcov)

    expect(files.has('src/features/accounting/journal-entries/components/JournalEntrySections.tsx')).toBe(true)
    expect(files.has('src/features/inventory/components/StockAdjustmentSections.tsx')).toBe(true)
    expect(files.size).toBe(2)
  })
})

describe('findNewSourceCoverageGaps', () => {
  const sonarConfig = {
    sources: ['src', 'sql'],
    exclusions: ['**/*.test.tsx', '**/__tests__/**'],
    coverageExclusions: ['**/src/features/accounting/journal-entries/components/**'],
  }

  it('fails a new file silently hidden by a pre-existing broad coverage-exclusion glob, even though it is 100% covered in lcov', () => {
    const addedFiles = ['src/features/accounting/journal-entries/components/JournalEntrySections.tsx']
    const lcovSourceFiles = new Set([
      'src/features/accounting/journal-entries/components/JournalEntrySections.tsx',
    ])

    const { checked, errors } = findNewSourceCoverageGaps({ addedFiles, sonarConfig, lcovSourceFiles })

    expect(checked).toEqual(addedFiles)
    expect(errors).toEqual([
      expect.objectContaining({
        file: 'src/features/accounting/journal-entries/components/JournalEntrySections.tsx',
        reason: 'excluded-by-coverage-glob',
      }),
    ])
  })

  it('passes a properly covered new file and skips test files and files outside sonar.sources', () => {
    const addedFiles = [
      'src/features/inventory/components/StockAdjustmentSections.tsx',
      'src/features/inventory/components/__tests__/stock-adjustment-sections.test.tsx',
      'docs/db/SOME_RUNBOOK.md',
    ]
    const lcovSourceFiles = new Set(['src/features/inventory/components/StockAdjustmentSections.tsx'])

    const { checked, errors } = findNewSourceCoverageGaps({ addedFiles, sonarConfig, lcovSourceFiles })

    expect(checked).toEqual(['src/features/inventory/components/StockAdjustmentSections.tsx'])
    expect(errors).toEqual([])
  })

  it('skips a new SQL migration and a non-JS asset under src, since neither can ever appear in coverage/lcov.info', () => {
    const addedFiles = [
      'sql/migrations/176_new_thing.sql',
      'src/assets/logo.svg',
      'src/types/database.generated.d.ts',
    ]
    const lcovSourceFiles = new Set()

    const { checked, errors } = findNewSourceCoverageGaps({ addedFiles, sonarConfig, lcovSourceFiles })

    expect(checked).toEqual([])
    expect(errors).toEqual([])
  })

  it('allows a coverage-exclusions entry the same diff introduces, without demanding lcov coverage for it', () => {
    const addedFiles = ['src/features/accounting/journal-entries/components/NewCoordinator.tsx']
    const lcovSourceFiles = new Set() // deliberately excluded — never instrumented
    const newlyAddedCoverageExclusionGlobs = new Set([
      '**/src/features/accounting/journal-entries/components/**',
    ])

    const { checked, errors } = findNewSourceCoverageGaps({
      addedFiles,
      sonarConfig,
      lcovSourceFiles,
      newlyAddedCoverageExclusionGlobs,
    })

    expect(checked).toEqual(addedFiles)
    expect(errors).toEqual([])
  })
})

describe('isSafeGitRef', () => {
  it('accepts real ref shapes and rejects a leading dash (git argument injection) or unsafe characters', () => {
    expect(isSafeGitRef('HEAD')).toBe(true)
    expect(isSafeGitRef('HEAD^')).toBe(true)
    expect(isSafeGitRef('HEAD~1')).toBe(true)
    expect(isSafeGitRef('origin/main')).toBe(true)
    expect(isSafeGitRef('ffb3b9ea16ae38aef43d4a95eced4a58076b46a7')).toBe(true)

    expect(isSafeGitRef('--upload-pack=evil')).toBe(false)
    expect(isSafeGitRef('-x')).toBe(false)
    expect(isSafeGitRef('origin/main; rm -rf /')).toBe(false)
    expect(isSafeGitRef('')).toBe(false)
    expect(isSafeGitRef(undefined)).toBe(false)
  })
})

describe('matchesAnyGlob', () => {
  it('matches sonar.coverage.exclusions-style `**/dir/**` globs via path.matchesGlob (positive and negative cases)', () => {
    const globs = ['**/src/features/accounting/journal-entries/components/**']

    // positive: a file inside the excluded directory
    expect(matchesAnyGlob('src/features/accounting/journal-entries/components/JournalEntrySections.tsx', globs)).toBe(true)
    // negative: a sibling file one level up, outside the excluded directory
    expect(matchesAnyGlob('src/features/accounting/journal-entries/index.tsx', globs)).toBe(false)
    // negative: an unrelated directory that only shares a suffix
    expect(matchesAnyGlob('src/features/inventory/components/StockAdjustmentSections.tsx', globs)).toBe(false)
  })

  it('keeps HR page coordinators excluded without hiding nested report helpers', () => {
    const globs = ['**/src/features/hr/pages/*.tsx']

    expect(matchesAnyGlob('src/features/hr/pages/ReportsPage.tsx', globs)).toBe(true)
    expect(matchesAnyGlob('src/features/hr/pages/reports/report-builders.ts', globs)).toBe(false)
  })
})
