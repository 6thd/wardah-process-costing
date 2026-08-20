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
})
